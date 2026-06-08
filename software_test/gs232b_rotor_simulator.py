"""Software GS-232B rotor simulator with a small Tkinter UI.

The simulator opens one side of a virtual null-modem COM-port pair and behaves
like a GS-232B compatible rotor controller. The main Rotor Interface
application can then connect to the other COM port without any code changes.
"""

from __future__ import annotations

import json
import math
import queue
import re
import threading
import time
import tkinter as tk
from dataclasses import dataclass, asdict
from tkinter import messagebox, ttk
from typing import Any, Optional

try:
    import serial
    from serial.tools import list_ports

    SERIAL_AVAILABLE = True
except ImportError:
    serial = None
    list_ports = None
    SERIAL_AVAILABLE = False


@dataclass
class SimulatorState:
    """Thread-safe snapshot data for the simulated rotor."""

    azimuth: float = 0.0
    elevation: float = 0.0
    target_azimuth: Optional[float] = None
    target_elevation: Optional[float] = None
    manual_azimuth_direction: int = 0
    manual_elevation_direction: int = 0
    azimuth_speed_dps: float = 8.0
    elevation_speed_dps: float = 4.0
    azimuth_mode: int = 450
    elevation_max: int = 90
    connected: bool = False
    port: Optional[str] = None
    baud_rate: int = 9600
    last_command: Optional[str] = None
    command_count: int = 0
    response_count: int = 0


class Gs232bRotorSimulator:
    """GS-232B protocol simulator backed by a serial COM port."""

    READ_INTERVAL_S = 0.02
    MOTION_INTERVAL_S = 0.05

    def __init__(self, log_queue: "queue.Queue[str]") -> None:
        self.log_queue = log_queue
        self.state = SimulatorState()
        self.state_lock = threading.RLock()
        self.serial_lock = threading.RLock()
        self.serial_port: Optional[Any] = None
        self.stop_event = threading.Event()
        self.read_thread: Optional[threading.Thread] = None
        self.motion_thread: Optional[threading.Thread] = None
        self.response_delay_s = 0.02
        self.line_ending = "\r"
        self._buffer = ""

    def open(self, port: str, baud_rate: int = 9600) -> None:
        """Open a serial port and start simulator worker threads."""
        if not SERIAL_AVAILABLE:
            raise RuntimeError("pyserial is not installed. Install with: pip install pyserial")
        if self.is_open:
            self.close()

        port = port.strip()
        if not port:
            raise ValueError("Port must not be empty.")
        if baud_rate <= 0:
            raise ValueError("Baud rate must be positive.")

        serial_port = serial.Serial(
            port=port,
            baudrate=baud_rate,
            bytesize=8,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.05,
            write_timeout=0.5,
        )

        self.stop_event = threading.Event()
        with self.serial_lock:
            self.serial_port = serial_port
            self._buffer = ""

        with self.state_lock:
            self.state.connected = True
            self.state.port = port
            self.state.baud_rate = baud_rate

        self.read_thread = threading.Thread(target=self._read_loop, name="Gs232bSimRead", daemon=True)
        self.motion_thread = threading.Thread(target=self._motion_loop, name="Gs232bSimMotion", daemon=True)
        self.read_thread.start()
        self.motion_thread.start()
        self._log(f"Opened simulator port {port} at {baud_rate} baud")

    def close(self) -> None:
        """Close the simulated controller port."""
        self.stop_event.set()
        current_thread = threading.current_thread()
        for thread in (self.read_thread, self.motion_thread):
            if thread and thread.is_alive() and thread is not current_thread:
                thread.join(timeout=1.0)

        with self.serial_lock:
            if self.serial_port is not None:
                try:
                    self.serial_port.close()
                except Exception as exc:
                    self._log(f"Close error: {exc}")
            self.serial_port = None

        with self.state_lock:
            self.state.connected = False
            self.state.port = None
            self.state.manual_azimuth_direction = 0
            self.state.manual_elevation_direction = 0
            self.state.target_azimuth = None
            self.state.target_elevation = None

        self._log("Simulator port closed")

    @property
    def is_open(self) -> bool:
        """True if the simulator serial port is open."""
        with self.serial_lock:
            return bool(self.serial_port and getattr(self.serial_port, "is_open", False))

    def snapshot(self) -> dict[str, Any]:
        """Return a copy of current state."""
        with self.state_lock:
            data = asdict(self.state)
            data["moving"] = self._is_moving_locked()
            data["statusLine"] = self._status_line_locked()
            return data

    def set_position(self, azimuth: float, elevation: float) -> None:
        """Set current simulated position from the UI."""
        with self.state_lock:
            self.state.azimuth = self._clamp(float(azimuth), 0.0, float(self.state.azimuth_mode))
            self.state.elevation = self._clamp(float(elevation), 0.0, float(self.state.elevation_max))
            self.state.target_azimuth = None
            self.state.target_elevation = None
            self.state.manual_azimuth_direction = 0
            self.state.manual_elevation_direction = 0
        self._log(f"Position set manually: AZ={azimuth:.1f} EL={elevation:.1f}")

    def reset_position(self) -> None:
        """Reset simulated position to zero."""
        self.set_position(0.0, 0.0)

    def inject_command(self, command: str) -> None:
        """Process a command from the UI without serial input."""
        command = command.strip()
        if command:
            self._handle_command(command, injected=True)

    def set_speeds(self, azimuth_speed_dps: float, elevation_speed_dps: float) -> None:
        """Update movement speeds."""
        with self.state_lock:
            self.state.azimuth_speed_dps = max(0.1, float(azimuth_speed_dps))
            self.state.elevation_speed_dps = max(0.1, float(elevation_speed_dps))
        self._log("Speeds updated")

    def set_mode(self, azimuth_mode: int, elevation_max: int) -> None:
        """Update motion limits."""
        azimuth_mode = 450 if int(azimuth_mode) == 450 else 360
        elevation_max = max(1, int(elevation_max))
        with self.state_lock:
            self.state.azimuth_mode = azimuth_mode
            self.state.elevation_max = elevation_max
            self.state.azimuth = self._clamp(self.state.azimuth, 0.0, float(azimuth_mode))
            self.state.elevation = self._clamp(self.state.elevation, 0.0, float(elevation_max))
        self._log(f"Mode updated: AZ max {azimuth_mode}, EL max {elevation_max}")

    def _read_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                with self.serial_lock:
                    port = self.serial_port
                if port is None or not getattr(port, "is_open", False):
                    self.stop_event.wait(self.READ_INTERVAL_S)
                    continue

                waiting = port.in_waiting
                if waiting:
                    raw = port.read(waiting)
                    text = raw.decode("utf-8", errors="ignore")
                    self._buffer += text
                    self._consume_buffer()
                else:
                    self.stop_event.wait(self.READ_INTERVAL_S)
            except Exception as exc:
                self._log(f"Serial read error: {exc}")
                self.close()
                return

    def _consume_buffer(self) -> None:
        while "\r" in self._buffer or "\n" in self._buffer:
            cr_index = self._buffer.find("\r") if "\r" in self._buffer else math.inf
            lf_index = self._buffer.find("\n") if "\n" in self._buffer else math.inf
            line_end = int(min(cr_index, lf_index))
            line = self._buffer[:line_end].strip()
            self._buffer = self._buffer[line_end + 1 :]
            if line:
                self._handle_command(line)

    def _motion_loop(self) -> None:
        last = time.monotonic()
        while not self.stop_event.is_set():
            now = time.monotonic()
            dt = max(0.0, now - last)
            last = now
            self._step_motion(dt)
            self.stop_event.wait(self.MOTION_INTERVAL_S)

    def _step_motion(self, dt: float) -> None:
        with self.state_lock:
            state = self.state
            if state.manual_azimuth_direction:
                state.azimuth += state.manual_azimuth_direction * state.azimuth_speed_dps * dt
                state.azimuth = self._clamp(state.azimuth, 0.0, float(state.azimuth_mode))

            if state.manual_elevation_direction:
                state.elevation += state.manual_elevation_direction * state.elevation_speed_dps * dt
                state.elevation = self._clamp(state.elevation, 0.0, float(state.elevation_max))

            if state.target_azimuth is not None:
                state.azimuth, reached = self._move_towards(
                    state.azimuth,
                    state.target_azimuth,
                    state.azimuth_speed_dps * dt,
                )
                if reached:
                    state.target_azimuth = None

            if state.target_elevation is not None:
                state.elevation, reached = self._move_towards(
                    state.elevation,
                    state.target_elevation,
                    state.elevation_speed_dps * dt,
                )
                if reached:
                    state.target_elevation = None

    def _handle_command(self, command: str, *, injected: bool = False) -> None:
        command = command.strip().upper()
        if not command:
            return

        with self.state_lock:
            self.state.last_command = command
            self.state.command_count += 1
        self._log(("UI -> " if injected else "RX -> ") + command)

        if command == "C2":
            self._write_response(self._status_line())
            return
        if command == "C":
            with self.state_lock:
                self._write_response(f"AZ={self._format_angle(self.state.azimuth)}")
            return
        if command == "B":
            with self.state_lock:
                self._write_response(f"EL={self._format_angle(self.state.elevation)}")
            return

        if command in {"R", "L", "U", "D", "A", "E", "S"}:
            self._handle_motion_command(command)
            return

        move_match = re.fullmatch(r"M\s*(\d{1,3})", command)
        if move_match:
            self._set_target(azimuth=float(move_match.group(1)), elevation=None)
            return

        move_both_match = re.fullmatch(r"W\s*(\d{1,3})\s+(\d{1,3})", command)
        if move_both_match:
            self._set_target(
                azimuth=float(move_both_match.group(1)),
                elevation=float(move_both_match.group(2)),
            )
            return

        if command == "P36":
            self.set_mode(360, self.snapshot()["elevation_max"])
            return
        if command == "P45":
            self.set_mode(450, self.snapshot()["elevation_max"])
            return

        speed_match = re.fullmatch(r"([SBX])\s*(\d{1,3})", command)
        if speed_match:
            self._handle_speed_command(speed_match.group(1), int(speed_match.group(2)))
            return

        if command == "Z":
            self._log("Z command received; no-op in simulator")
            return

        self._log(f"Unknown command ignored: {command}")

    def _handle_motion_command(self, command: str) -> None:
        with self.state_lock:
            if command == "R":
                self.state.manual_azimuth_direction = 1
                self.state.target_azimuth = None
            elif command == "L":
                self.state.manual_azimuth_direction = -1
                self.state.target_azimuth = None
            elif command == "U":
                self.state.manual_elevation_direction = 1
                self.state.target_elevation = None
            elif command == "D":
                self.state.manual_elevation_direction = -1
                self.state.target_elevation = None
            elif command == "A":
                self.state.manual_azimuth_direction = 0
                self.state.target_azimuth = None
            elif command == "E":
                self.state.manual_elevation_direction = 0
                self.state.target_elevation = None
            elif command == "S":
                self.state.manual_azimuth_direction = 0
                self.state.manual_elevation_direction = 0
                self.state.target_azimuth = None
                self.state.target_elevation = None

    def _set_target(self, azimuth: Optional[float], elevation: Optional[float]) -> None:
        with self.state_lock:
            self.state.manual_azimuth_direction = 0
            self.state.manual_elevation_direction = 0
            if azimuth is not None:
                self.state.target_azimuth = self._clamp(azimuth, 0.0, float(self.state.azimuth_mode))
            if elevation is not None:
                self.state.target_elevation = self._clamp(elevation, 0.0, float(self.state.elevation_max))

    def _handle_speed_command(self, target: str, value: int) -> None:
        with self.state_lock:
            speed = max(0.1, float(value))
            if target == "S":
                self.state.azimuth_speed_dps = speed
            elif target == "B":
                self.state.elevation_speed_dps = speed
            elif target == "X":
                level = self._clamp(value, 1, 4)
                self.state.azimuth_speed_dps = 4.0 + level * 2.0
                self.state.elevation_speed_dps = 2.0 + level
        self._log(f"Speed command applied: {target}{value:03d}")

    def _write_response(self, line: str) -> None:
        if self.response_delay_s > 0:
            time.sleep(self.response_delay_s)
        payload = f"{line}{self.line_ending}".encode("utf-8")
        with self.serial_lock:
            port = self.serial_port
            if port is not None and getattr(port, "is_open", False):
                port.write(payload)
        with self.state_lock:
            self.state.response_count += 1
        self._log(f"TX <- {line}")

    def _status_line(self) -> str:
        with self.state_lock:
            return self._status_line_locked()

    def _status_line_locked(self) -> str:
        return (
            f"AZ={self._format_angle(self.state.azimuth)} "
            f"EL={self._format_angle(self.state.elevation)}"
        )

    def _is_moving_locked(self) -> bool:
        return bool(
            self.state.manual_azimuth_direction
            or self.state.manual_elevation_direction
            or self.state.target_azimuth is not None
            or self.state.target_elevation is not None
        )

    @staticmethod
    def _format_angle(value: float) -> str:
        return f"{int(round(value)):03d}"

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(float(value), maximum))

    @staticmethod
    def _move_towards(current: float, target: float, max_delta: float) -> tuple[float, bool]:
        delta = target - current
        if abs(delta) <= max_delta:
            return target, True
        return current + (max_delta if delta > 0 else -max_delta), False

    def _log(self, message: str) -> None:
        timestamp = time.strftime("%H:%M:%S")
        self.log_queue.put(f"{timestamp}  {message}")


class SimulatorGui(tk.Tk):
    """Tkinter test UI for the software rotor simulator."""

    REFRESH_MS = 150

    def __init__(self) -> None:
        super().__init__()
        self.title("GS-232B Software Rotor Simulator")
        self.geometry("1120x760")
        self.minsize(980, 620)

        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.simulator = Gs232bRotorSimulator(self.log_queue)

        self._build_ui()
        self._refresh_ports()
        self._refresh_ui()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        top = ttk.Frame(self, padding=8)
        top.pack(fill=tk.X)

        ttk.Label(top, text="Simulator COM").pack(side=tk.LEFT)
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(top, textvariable=self.port_var, width=18)
        self.port_combo.pack(side=tk.LEFT, padx=(4, 8))
        ttk.Button(top, text="Ports", command=self._refresh_ports).pack(side=tk.LEFT)

        ttk.Label(top, text="Baud").pack(side=tk.LEFT, padx=(12, 0))
        self.baud_var = tk.StringVar(value="9600")
        ttk.Entry(top, textvariable=self.baud_var, width=8).pack(side=tk.LEFT, padx=(4, 8))

        ttk.Button(top, text="Oeffnen", command=self._open_port).pack(side=tk.LEFT)
        ttk.Button(top, text="Schliessen", command=self._close_port).pack(side=tk.LEFT, padx=(6, 0))

        self.connection_var = tk.StringVar(value="Nicht verbunden")
        ttk.Label(top, textvariable=self.connection_var).pack(side=tk.RIGHT)

        info = ttk.Label(
            self,
            text=(
                "Hinweis: Dieses Programm oeffnet eine Seite eines virtuellen Nullmodem-COM-Paares. "
                "Die Rotor-Software muss die andere Seite verbinden."
            ),
            padding=(8, 0),
        )
        info.pack(fill=tk.X)

        notebook = ttk.Notebook(self)
        notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        self._build_simulation_tab(notebook)
        self._build_protocol_tab(notebook)
        self._build_debug_tab(notebook)

    def _build_simulation_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=10)
        notebook.add(tab, text="Simulation")

        live = ttk.LabelFrame(tab, text="Live-Position", padding=8)
        live.pack(fill=tk.X)

        self.azimuth_var = tk.StringVar(value="AZ 000")
        self.elevation_var = tk.StringVar(value="EL 000")
        self.status_line_var = tk.StringVar(value="AZ=000 EL=000")
        ttk.Label(live, textvariable=self.azimuth_var, font=("Segoe UI", 18, "bold")).pack(side=tk.LEFT, padx=(0, 20))
        ttk.Label(live, textvariable=self.elevation_var, font=("Segoe UI", 18, "bold")).pack(side=tk.LEFT, padx=(0, 20))
        ttk.Label(live, textvariable=self.status_line_var).pack(side=tk.LEFT)

        bars = ttk.Frame(tab)
        bars.pack(fill=tk.X, pady=(10, 0))
        ttk.Label(bars, text="Azimuth").grid(row=0, column=0, sticky=tk.W)
        self.azimuth_progress = ttk.Progressbar(bars, maximum=450)
        self.azimuth_progress.grid(row=0, column=1, sticky=tk.EW, padx=8, pady=4)
        ttk.Label(bars, text="Elevation").grid(row=1, column=0, sticky=tk.W)
        self.elevation_progress = ttk.Progressbar(bars, maximum=90)
        self.elevation_progress.grid(row=1, column=1, sticky=tk.EW, padx=8, pady=4)
        bars.columnconfigure(1, weight=1)

        controls = ttk.Frame(tab)
        controls.pack(fill=tk.BOTH, expand=True, pady=(12, 0))

        motion = ttk.LabelFrame(controls, text="Manuelle Simulator-Steuerung", padding=8)
        motion.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 6))

        pad = ttk.Frame(motion)
        pad.pack()
        ttk.Button(pad, text="Up", command=lambda: self.simulator.inject_command("U")).grid(row=0, column=1, padx=4, pady=4)
        ttk.Button(pad, text="Left", command=lambda: self.simulator.inject_command("L")).grid(row=1, column=0, padx=4, pady=4)
        ttk.Button(pad, text="Stop", command=lambda: self.simulator.inject_command("S")).grid(row=1, column=1, padx=4, pady=4)
        ttk.Button(pad, text="Right", command=lambda: self.simulator.inject_command("R")).grid(row=1, column=2, padx=4, pady=4)
        ttk.Button(pad, text="Down", command=lambda: self.simulator.inject_command("D")).grid(row=2, column=1, padx=4, pady=4)

        target = ttk.LabelFrame(controls, text="Position setzen", padding=8)
        target.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=6)

        ttk.Label(target, text="Aktuelle AZ").grid(row=0, column=0, sticky=tk.W)
        self.set_az_var = tk.StringVar(value="0")
        ttk.Entry(target, textvariable=self.set_az_var, width=10).grid(row=0, column=1, padx=6, pady=3)
        ttk.Label(target, text="Aktuelle EL").grid(row=1, column=0, sticky=tk.W)
        self.set_el_var = tk.StringVar(value="0")
        ttk.Entry(target, textvariable=self.set_el_var, width=10).grid(row=1, column=1, padx=6, pady=3)
        ttk.Button(target, text="Direkt setzen", command=self._set_position).grid(row=2, column=0, columnspan=2, sticky=tk.EW, pady=(6, 0))
        ttk.Button(target, text="Reset 0/0", command=self.simulator.reset_position).grid(row=3, column=0, columnspan=2, sticky=tk.EW, pady=(6, 0))

        settings = ttk.LabelFrame(controls, text="Simulator-Parameter", padding=8)
        settings.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(6, 0))

        ttk.Label(settings, text="AZ Speed deg/s").grid(row=0, column=0, sticky=tk.W)
        self.az_speed_var = tk.StringVar(value="8")
        ttk.Entry(settings, textvariable=self.az_speed_var, width=10).grid(row=0, column=1, padx=6, pady=3)
        ttk.Label(settings, text="EL Speed deg/s").grid(row=1, column=0, sticky=tk.W)
        self.el_speed_var = tk.StringVar(value="4")
        ttk.Entry(settings, textvariable=self.el_speed_var, width=10).grid(row=1, column=1, padx=6, pady=3)
        ttk.Button(settings, text="Speeds uebernehmen", command=self._set_speeds).grid(row=2, column=0, columnspan=2, sticky=tk.EW, pady=(6, 0))

        ttk.Label(settings, text="AZ Mode").grid(row=3, column=0, sticky=tk.W, pady=(10, 3))
        self.mode_var = tk.StringVar(value="450")
        ttk.Combobox(settings, textvariable=self.mode_var, values=["360", "450"], width=8, state="readonly").grid(row=3, column=1, padx=6, pady=(10, 3))
        ttk.Label(settings, text="EL Max").grid(row=4, column=0, sticky=tk.W)
        self.el_max_var = tk.StringVar(value="90")
        ttk.Entry(settings, textvariable=self.el_max_var, width=10).grid(row=4, column=1, padx=6, pady=3)
        ttk.Button(settings, text="Limits uebernehmen", command=self._set_mode).grid(row=5, column=0, columnspan=2, sticky=tk.EW, pady=(6, 0))

    def _build_protocol_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=10)
        notebook.add(tab, text="Protokoll")

        top = ttk.Frame(tab)
        top.pack(fill=tk.X)
        ttk.Label(top, text="Befehl injizieren").pack(side=tk.LEFT)
        self.inject_var = tk.StringVar(value="C2")
        ttk.Entry(top, textvariable=self.inject_var, width=18).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Ausfuehren", command=lambda: self.simulator.inject_command(self.inject_var.get())).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Log leeren", command=self._clear_log).pack(side=tk.LEFT, padx=(6, 0))

        help_text = (
            "Unterstuetzte Befehle: C, B, C2, R, L, U, D, A, E, S, Mxxx, Wxxx yyy, "
            "P36, P45, Sxxx, Bxxx, Xn, Z"
        )
        ttk.Label(tab, text=help_text).pack(fill=tk.X, pady=(8, 0))

        self.log_text = tk.Text(tab, wrap=tk.NONE)
        self.log_text.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

    def _build_debug_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=10)
        notebook.add(tab, text="Debug")
        self.debug_text = tk.Text(tab, wrap=tk.NONE)
        self.debug_text.pack(fill=tk.BOTH, expand=True)

    def _refresh_ports(self) -> None:
        if not SERIAL_AVAILABLE:
            self.port_combo.configure(values=[])
            messagebox.showerror("pyserial fehlt", "pyserial ist nicht installiert. Installiere: pip install pyserial")
            return
        ports = [entry.device for entry in list_ports.comports()]
        self.port_combo.configure(values=ports)
        if ports and not self.port_var.get():
            self.port_var.set(ports[0])

    def _open_port(self) -> None:
        try:
            self.simulator.open(self.port_var.get(), int(self.baud_var.get()))
        except Exception as exc:
            messagebox.showerror("Port konnte nicht geoeffnet werden", str(exc))

    def _close_port(self) -> None:
        self.simulator.close()

    def _set_position(self) -> None:
        try:
            self.simulator.set_position(float(self.set_az_var.get()), float(self.set_el_var.get()))
        except ValueError:
            messagebox.showerror("Ungueltige Position", "AZ und EL muessen Zahlen sein.")

    def _set_speeds(self) -> None:
        try:
            self.simulator.set_speeds(float(self.az_speed_var.get()), float(self.el_speed_var.get()))
        except ValueError:
            messagebox.showerror("Ungueltige Geschwindigkeit", "Speed-Werte muessen Zahlen sein.")

    def _set_mode(self) -> None:
        try:
            self.simulator.set_mode(int(self.mode_var.get()), int(self.el_max_var.get()))
        except ValueError:
            messagebox.showerror("Ungueltige Limits", "Mode und EL Max muessen Zahlen sein.")

    def _refresh_ui(self) -> None:
        self._drain_log_queue()
        snapshot = self.simulator.snapshot()

        self.connection_var.set(
            f"Verbunden: {snapshot['connected']}  Port: {snapshot['port'] or '-'}"
        )
        self.azimuth_var.set(f"AZ {snapshot['azimuth']:.1f}")
        self.elevation_var.set(f"EL {snapshot['elevation']:.1f}")
        self.status_line_var.set(snapshot["statusLine"])
        self.azimuth_progress.configure(maximum=max(1, snapshot["azimuth_mode"]))
        self.elevation_progress.configure(maximum=max(1, snapshot["elevation_max"]))
        self.azimuth_progress["value"] = snapshot["azimuth"]
        self.elevation_progress["value"] = snapshot["elevation"]

        self._set_text(self.debug_text, json.dumps(snapshot, indent=2, default=str))
        self.after(self.REFRESH_MS, self._refresh_ui)

    def _drain_log_queue(self) -> None:
        while True:
            try:
                line = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_text.insert(tk.END, f"{line}\n")
            self.log_text.see(tk.END)

    def _clear_log(self) -> None:
        self.log_text.delete("1.0", tk.END)

    @staticmethod
    def _set_text(widget: tk.Text, value: str) -> None:
        widget.delete("1.0", tk.END)
        widget.insert(tk.END, value)

    def _on_close(self) -> None:
        self.simulator.close()
        self.destroy()


def main() -> None:
    app = SimulatorGui()
    app.mainloop()


if __name__ == "__main__":
    main()
