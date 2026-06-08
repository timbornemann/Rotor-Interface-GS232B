"""Simple Tkinter GUI for testing the RotorApiClient.

Die GUI spricht nicht selbst mit der API. Alle Steuer-, Settings- und Debug-
Aktionen laufen ueber `RotorApiClient`.
"""

from __future__ import annotations

import json
import tkinter as tk
from concurrent.futures import Future
from datetime import datetime
from tkinter import messagebox, ttk
from typing import Any, Callable, Optional

try:
    from rotor_api_client import RotorApiClient, RotorApiError
except ImportError:
    from rotor_client import RotorApiClient, RotorApiError


class RotorClientGui(tk.Tk):
    """Minimal GUI that exercises the plug-and-play client module."""

    REFRESH_MS = 500

    def __init__(self) -> None:
        super().__init__()
        self.title("Rotor API Client GUI")
        self.geometry("1180x760")
        self.minsize(980, 620)

        self.client: Optional[RotorApiClient] = None
        self.settings_data: dict[str, Any] = {}
        self.server_settings_data: dict[str, Any] = {}
        self.routes_data: list[dict[str, Any]] = []
        self._selected_setting_source = "app"

        self._build_ui()
        self._create_client()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(self.REFRESH_MS, self._refresh_from_cache)

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        top = ttk.Frame(self, padding=8)
        top.pack(fill=tk.X)

        ttk.Label(top, text="Host").pack(side=tk.LEFT)
        self.host_var = tk.StringVar(value="localhost")
        ttk.Entry(top, textvariable=self.host_var, width=18).pack(side=tk.LEFT, padx=(4, 10))

        ttk.Label(top, text="HTTP").pack(side=tk.LEFT)
        self.http_port_var = tk.StringVar(value="8081")
        ttk.Entry(top, textvariable=self.http_port_var, width=7).pack(side=tk.LEFT, padx=(4, 10))

        ttk.Label(top, text="WebSocket").pack(side=tk.LEFT)
        self.ws_port_var = tk.StringVar(value="8082")
        ttk.Entry(top, textvariable=self.ws_port_var, width=7).pack(side=tk.LEFT, padx=(4, 10))

        ttk.Label(top, text="Poll s").pack(side=tk.LEFT)
        self.poll_var = tk.StringVar(value="1.0")
        ttk.Entry(top, textvariable=self.poll_var, width=7).pack(side=tk.LEFT, padx=(4, 10))

        ttk.Button(top, text="Client neu starten", command=self._restart_client).pack(side=tk.LEFT)

        self.connection_label = ttk.Label(top, text="Status: unbekannt")
        self.connection_label.pack(side=tk.RIGHT)

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        self._build_control_tab()
        self._build_settings_tab()
        self._build_routes_tab()
        self._build_debug_tab()

    def _build_control_tab(self) -> None:
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="Steuerung")

        status_frame = ttk.LabelFrame(tab, text="Live-Status", padding=8)
        status_frame.pack(fill=tk.X)

        self.status_text = tk.Text(status_frame, height=9, wrap=tk.WORD)
        self.status_text.pack(fill=tk.X)
        self.status_text.configure(state=tk.DISABLED)

        controls = ttk.Frame(tab)
        controls.pack(fill=tk.BOTH, expand=True, pady=(10, 0))

        left = ttk.LabelFrame(controls, text="Verbindung", padding=8)
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 6))

        port_row = ttk.Frame(left)
        port_row.pack(fill=tk.X)
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(port_row, textvariable=self.port_var, values=[], width=26)
        self.port_combo.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(port_row, text="Ports laden", command=self._load_ports).pack(side=tk.LEFT, padx=(6, 0))

        baud_row = ttk.Frame(left)
        baud_row.pack(fill=tk.X, pady=(8, 0))
        ttk.Label(baud_row, text="Baud").pack(side=tk.LEFT)
        self.baud_var = tk.StringVar(value="9600")
        ttk.Entry(baud_row, textvariable=self.baud_var, width=12).pack(side=tk.LEFT, padx=(6, 0))

        button_row = ttk.Frame(left)
        button_row.pack(fill=tk.X, pady=(8, 0))
        ttk.Button(button_row, text="Verbinden", command=self._connect_rotor).pack(side=tk.LEFT)
        ttk.Button(button_row, text="Trennen", command=self._disconnect_rotor).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(button_row, text="Stop", command=lambda: self._run_client_call("stop")).pack(side=tk.LEFT, padx=(6, 0))

        command_row = ttk.Frame(left)
        command_row.pack(fill=tk.X, pady=(12, 0))
        ttk.Label(command_row, text="GS-232B").pack(side=tk.LEFT)
        self.command_var = tk.StringVar(value="C2")
        ttk.Entry(command_row, textvariable=self.command_var, width=18).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(command_row, text="Senden", command=self._send_command).pack(side=tk.LEFT, padx=(6, 0))

        middle = ttk.LabelFrame(controls, text="Bewegung", padding=8)
        middle.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=6)

        pad = ttk.Frame(middle)
        pad.pack()
        ttk.Button(pad, text="Up", command=lambda: self._run_client_call("manual_move", "up")).grid(row=0, column=1, padx=4, pady=4)
        ttk.Button(pad, text="Left", command=lambda: self._run_client_call("manual_move", "left")).grid(row=1, column=0, padx=4, pady=4)
        ttk.Button(pad, text="Stop", command=lambda: self._run_client_call("stop")).grid(row=1, column=1, padx=4, pady=4)
        ttk.Button(pad, text="Right", command=lambda: self._run_client_call("manual_move", "right")).grid(row=1, column=2, padx=4, pady=4)
        ttk.Button(pad, text="Down", command=lambda: self._run_client_call("manual_move", "down")).grid(row=2, column=1, padx=4, pady=4)

        preset_row = ttk.Frame(middle)
        preset_row.pack(pady=(12, 0))
        ttk.Button(preset_row, text="Home", command=lambda: self._run_client_call("home")).pack(side=tk.LEFT)
        ttk.Button(preset_row, text="Park", command=lambda: self._run_client_call("park")).pack(side=tk.LEFT, padx=(6, 0))

        right = ttk.LabelFrame(controls, text="Zielposition", padding=8)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(6, 0))

        target_grid = ttk.Frame(right)
        target_grid.pack(fill=tk.X)
        ttk.Label(target_grid, text="Az").grid(row=0, column=0, sticky=tk.W)
        self.az_var = tk.StringVar(value="180")
        ttk.Entry(target_grid, textvariable=self.az_var, width=12).grid(row=0, column=1, padx=6, pady=3)
        ttk.Label(target_grid, text="El").grid(row=0, column=2, sticky=tk.W)
        self.el_var = tk.StringVar(value="45")
        ttk.Entry(target_grid, textvariable=self.el_var, width=12).grid(row=0, column=3, padx=6, pady=3)
        ttk.Button(target_grid, text="Kalibriert setzen", command=self._set_target).grid(row=0, column=4, padx=6)

        ttk.Label(target_grid, text="Raw Az").grid(row=1, column=0, sticky=tk.W)
        self.raw_az_var = tk.StringVar(value="180")
        ttk.Entry(target_grid, textvariable=self.raw_az_var, width=12).grid(row=1, column=1, padx=6, pady=3)
        ttk.Label(target_grid, text="Raw El").grid(row=1, column=2, sticky=tk.W)
        self.raw_el_var = tk.StringVar(value="45")
        ttk.Entry(target_grid, textvariable=self.raw_el_var, width=12).grid(row=1, column=3, padx=6, pady=3)
        ttk.Button(target_grid, text="Raw setzen", command=self._set_target_raw).grid(row=1, column=4, padx=6)

    def _build_settings_tab(self) -> None:
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="Einstellungen")

        top = ttk.Frame(tab)
        top.pack(fill=tk.X)
        ttk.Button(top, text="App-Settings laden", command=self._load_settings).pack(side=tk.LEFT)
        ttk.Button(top, text="Server-Settings laden", command=self._load_server_settings).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Auswahl speichern", command=self._save_selected_setting).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="JSON speichern", command=self._save_settings_json).pack(side=tk.LEFT, padx=(6, 0))

        body = ttk.PanedWindow(tab, orient=tk.HORIZONTAL)
        body.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

        left = ttk.Frame(body)
        body.add(left, weight=2)
        self.settings_tree = ttk.Treeview(left, columns=("source", "key", "type", "value"), show="headings")
        for col, width in (("source", 90), ("key", 240), ("type", 90), ("value", 360)):
            self.settings_tree.heading(col, text=col)
            self.settings_tree.column(col, width=width, anchor=tk.W)
        self.settings_tree.pack(fill=tk.BOTH, expand=True)
        self.settings_tree.bind("<<TreeviewSelect>>", self._on_setting_select)

        right = ttk.Frame(body)
        body.add(right, weight=1)
        ttk.Label(right, text="Ausgewaehlter Wert").pack(anchor=tk.W)
        self.setting_value_text = tk.Text(right, height=6, wrap=tk.WORD)
        self.setting_value_text.pack(fill=tk.X, pady=(4, 8))

        ttk.Label(right, text="Komplette Settings als JSON").pack(anchor=tk.W)
        self.settings_json_text = tk.Text(right, wrap=tk.NONE)
        self.settings_json_text.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

    def _build_routes_tab(self) -> None:
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="Routen")

        top = ttk.Frame(tab)
        top.pack(fill=tk.X)
        ttk.Button(top, text="Routen laden", command=self._load_routes).pack(side=tk.LEFT)
        ttk.Button(top, text="JSON neu speichern", command=self._create_route_from_json).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Auswahl aktualisieren", command=self._update_selected_route).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Auswahl loeschen", command=self._delete_selected_route).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Route starten", command=self._start_selected_route).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Route stoppen", command=lambda: self._run_client_call("stop_route")).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(top, text="Wait fortsetzen", command=lambda: self._run_client_call("continue_route")).pack(side=tk.LEFT, padx=(6, 0))

        body = ttk.PanedWindow(tab, orient=tk.HORIZONTAL)
        body.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

        left = ttk.Frame(body)
        body.add(left, weight=1)
        self.routes_tree = ttk.Treeview(left, columns=("id", "name", "steps"), show="headings")
        for col, width in (("id", 240), ("name", 240), ("steps", 80)):
            self.routes_tree.heading(col, text=col)
            self.routes_tree.column(col, width=width, anchor=tk.W)
        self.routes_tree.pack(fill=tk.BOTH, expand=True)
        self.routes_tree.bind("<<TreeviewSelect>>", self._on_route_select)

        right = ttk.Frame(body)
        body.add(right, weight=1)
        ttk.Label(right, text="Route JSON").pack(anchor=tk.W)
        self.route_json_text = tk.Text(right, wrap=tk.NONE)
        self.route_json_text.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

    def _build_debug_tab(self) -> None:
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="Debug")

        top = ttk.Frame(tab)
        top.pack(fill=tk.X)
        ttk.Button(top, text="Snapshot aktualisieren", command=self._update_debug_text).pack(side=tk.LEFT)
        ttk.Button(top, text="Events leeren", command=self._clear_events).pack(side=tk.LEFT, padx=(6, 0))

        self.debug_text = tk.Text(tab, wrap=tk.NONE)
        self.debug_text.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

        self.log_var = tk.StringVar(value="Bereit")
        ttk.Label(self, textvariable=self.log_var, anchor=tk.W, padding=(8, 4)).pack(fill=tk.X)

    # ------------------------------------------------------------------
    # Client lifecycle and async helpers
    # ------------------------------------------------------------------

    def _create_client(self) -> None:
        old_client = self.client
        if old_client is not None:
            old_client.close()

        try:
            self.client = RotorApiClient(
                host=self.host_var.get().strip() or "localhost",
                http_port=int(self.http_port_var.get()),
                websocket_port=int(self.ws_port_var.get()),
                auto_update=True,
                auto_update_interval=float(self.poll_var.get()),
            )
        except Exception as exc:
            self.client = None
            self._log(f"Client konnte nicht erstellt werden: {exc}")
            messagebox.showerror("Client Fehler", str(exc))
            return

        self._log("Client gestartet")

    def _restart_client(self) -> None:
        self._create_client()

    def _run_client_call(
        self,
        method_name: str,
        *args: Any,
        callback: Optional[Callable[[Any], None]] = None,
        **kwargs: Any,
    ) -> None:
        if self.client is None:
            self._log("Kein Client aktiv")
            return

        try:
            future = self.client.call_async(method_name, *args, **kwargs)
        except Exception as exc:
            self._log(str(exc))
            messagebox.showerror("Aufruf fehlgeschlagen", str(exc))
            return

        future.add_done_callback(lambda done: self.after(0, self._handle_future, done, callback, method_name))

    def _handle_future(
        self,
        future: Future,
        callback: Optional[Callable[[Any], None]],
        label: str,
    ) -> None:
        try:
            result = future.result()
        except Exception as exc:
            self._log(f"{label}: {exc}")
            return

        self._log(f"{label}: ok")
        if callback:
            callback(result)

    # ------------------------------------------------------------------
    # Control actions
    # ------------------------------------------------------------------

    def _load_ports(self) -> None:
        self._run_client_call("list_ports", callback=self._show_ports)

    def _show_ports(self, ports: list[dict[str, Any]]) -> None:
        labels = [str(port.get("path", "")) for port in ports if port.get("path")]
        self.port_combo.configure(values=labels)
        if labels and not self.port_var.get():
            self.port_var.set(labels[0])

    def _connect_rotor(self) -> None:
        try:
            baud_rate = int(self.baud_var.get())
        except ValueError:
            self._log("Baud muss eine ganze Zahl sein")
            return
        self._run_client_call("connect", self.port_var.get(), baud_rate)

    def _disconnect_rotor(self) -> None:
        self._run_client_call("disconnect")

    def _send_command(self) -> None:
        self._run_client_call("send_command", self.command_var.get())

    def _set_target(self) -> None:
        try:
            az = float(self.az_var.get())
            el = float(self.el_var.get())
        except ValueError:
            self._log("Az und El muessen Zahlen sein")
            return
        self._run_client_call("set_target", az, el)

    def _set_target_raw(self) -> None:
        try:
            az = self._optional_float(self.raw_az_var.get())
            el = self._optional_float(self.raw_el_var.get())
        except ValueError:
            self._log("Raw Az und Raw El muessen leer oder Zahlen sein")
            return
        self._run_client_call("set_target_raw", az=az, el=el)

    # ------------------------------------------------------------------
    # Settings actions
    # ------------------------------------------------------------------

    def _load_settings(self) -> None:
        self._run_client_call("get_settings", callback=self._show_settings)

    def _load_server_settings(self) -> None:
        self._run_client_call("get_server_settings", callback=self._show_server_settings)

    def _show_settings(self, settings: dict[str, Any]) -> None:
        self.settings_data = dict(settings)
        self._populate_settings_tree()
        self._set_text(self.settings_json_text, json.dumps(self.settings_data, indent=2, sort_keys=True))

    def _show_server_settings(self, settings: dict[str, Any]) -> None:
        self.server_settings_data = dict(settings)
        self._populate_settings_tree()

    def _populate_settings_tree(self) -> None:
        self.settings_tree.delete(*self.settings_tree.get_children())
        for source, data in (("app", self.settings_data), ("server", self.server_settings_data)):
            for key in sorted(data):
                value = data[key]
                self.settings_tree.insert("", tk.END, values=(source, key, type(value).__name__, self._short_value(value)))

    def _on_setting_select(self, _event: object) -> None:
        selected = self.settings_tree.selection()
        if not selected:
            return
        source, key, _type_name, _value = self.settings_tree.item(selected[0], "values")
        self._selected_setting_source = source
        data = self.settings_data if source == "app" else self.server_settings_data
        self._set_text(self.setting_value_text, json.dumps(data.get(key), indent=2))

    def _save_selected_setting(self) -> None:
        selected = self.settings_tree.selection()
        if not selected:
            self._log("Keine Einstellung ausgewaehlt")
            return
        source, key, _type_name, _value = self.settings_tree.item(selected[0], "values")
        value = self._parse_json_or_string(self.setting_value_text.get("1.0", tk.END).strip())
        if source == "app":
            self._run_client_call("update_settings", {key: value}, callback=lambda _r: self._load_settings())
        else:
            server_key = self._server_response_key_to_update_key(key)
            self._run_client_call("update_server_settings", {server_key: value}, callback=lambda _r: self._load_server_settings())

    def _save_settings_json(self) -> None:
        try:
            payload = json.loads(self.settings_json_text.get("1.0", tk.END))
        except json.JSONDecodeError as exc:
            self._log(f"Settings JSON ungueltig: {exc}")
            return
        if not isinstance(payload, dict):
            self._log("Settings JSON muss ein Objekt sein")
            return
        self._run_client_call("update_settings", payload, callback=lambda _r: self._load_settings())

    # ------------------------------------------------------------------
    # Route actions
    # ------------------------------------------------------------------

    def _load_routes(self) -> None:
        self._run_client_call("list_routes", callback=self._show_routes)

    def _show_routes(self, routes: list[dict[str, Any]]) -> None:
        self.routes_data = routes
        self.routes_tree.delete(*self.routes_tree.get_children())
        for route in routes:
            steps = route.get("steps") if isinstance(route.get("steps"), list) else []
            self.routes_tree.insert("", tk.END, values=(route.get("id", ""), route.get("name", ""), len(steps)))

    def _on_route_select(self, _event: object) -> None:
        route = self._get_selected_route()
        if route is not None:
            self._set_text(self.route_json_text, json.dumps(route, indent=2, sort_keys=True))

    def _start_selected_route(self) -> None:
        route = self._get_selected_route()
        if route is None:
            self._log("Keine Route ausgewaehlt")
            return
        self._run_client_call("start_route", route["id"])

    def _create_route_from_json(self) -> None:
        route = self._read_route_json()
        if route is None:
            return
        self._run_client_call("create_route", route, callback=lambda _r: self._load_routes())

    def _update_selected_route(self) -> None:
        selected_route = self._get_selected_route()
        route = self._read_route_json()
        if selected_route is None or route is None:
            self._log("Keine Route ausgewaehlt oder JSON ungueltig")
            return
        self._run_client_call("update_route", selected_route["id"], route, callback=lambda _r: self._load_routes())

    def _delete_selected_route(self) -> None:
        route = self._get_selected_route()
        if route is None:
            self._log("Keine Route ausgewaehlt")
            return
        if not messagebox.askyesno("Route loeschen", f"Route '{route.get('id')}' wirklich loeschen?"):
            return
        self._run_client_call("delete_route", route["id"], callback=lambda _r: self._load_routes())

    # ------------------------------------------------------------------
    # Cache refresh and debug
    # ------------------------------------------------------------------

    def _refresh_from_cache(self) -> None:
        if self.client is not None:
            snapshot = self.client.get_cache_snapshot()
            status = snapshot.get("status")
            position = snapshot.get("position")
            connected = None if status is None else bool(status.get("connected"))
            self.connection_label.configure(text=f"Status: {connected}")
            self._set_text(self.status_text, json.dumps({"status": status, "position": position}, indent=2))
            if self.notebook.index(self.notebook.select()) == 3:
                self._update_debug_text()
        self.after(self.REFRESH_MS, self._refresh_from_cache)

    def _update_debug_text(self) -> None:
        if self.client is None:
            self._set_text(self.debug_text, "Kein Client aktiv")
            return
        data = {
            "baseUrl": self.client.base_url,
            "websocketUrl": self.client.websocket_url,
            "sessionId": self.client.session_id,
            "autoUpdateRunning": self.client.auto_update_running,
            "lastError": str(self.client.last_error) if self.client.last_error else None,
            "snapshot": self.client.get_cache_snapshot(),
            "recentEvents": self.client.get_recent_events(),
        }
        self._set_text(self.debug_text, json.dumps(data, indent=2, default=str))

    def _clear_events(self) -> None:
        if self.client is not None:
            self.client.get_recent_events(clear=True)
        self._update_debug_text()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_selected_route(self) -> Optional[dict[str, Any]]:
        selected = self.routes_tree.selection()
        if not selected:
            return None
        route_id = self.routes_tree.item(selected[0], "values")[0]
        return next((route for route in self.routes_data if route.get("id") == route_id), None)

    def _read_route_json(self) -> Optional[dict[str, Any]]:
        try:
            route = json.loads(self.route_json_text.get("1.0", tk.END))
        except json.JSONDecodeError as exc:
            self._log(f"Route JSON ungueltig: {exc}")
            return None
        if not isinstance(route, dict):
            self._log("Route JSON muss ein Objekt sein")
            return None
        return route

    def _set_text(self, widget: tk.Text, value: str) -> None:
        state = str(widget.cget("state"))
        if state == tk.DISABLED:
            widget.configure(state=tk.NORMAL)
        widget.delete("1.0", tk.END)
        widget.insert(tk.END, value)
        if state == tk.DISABLED:
            widget.configure(state=tk.DISABLED)

    def _log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_var.set(f"{timestamp}  {message}")

    @staticmethod
    def _optional_float(value: str) -> Optional[float]:
        stripped = value.strip()
        return None if not stripped else float(stripped)

    @staticmethod
    def _parse_json_or_string(value: str) -> Any:
        if value == "":
            return ""
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value

    @staticmethod
    def _short_value(value: Any) -> str:
        text = json.dumps(value, ensure_ascii=True, default=str)
        return text if len(text) <= 140 else text[:137] + "..."

    @staticmethod
    def _server_response_key_to_update_key(key: str) -> str:
        mapping = {
            "httpPort": "serverHttpPort",
            "webSocketPort": "serverWebSocketPort",
            "pollingIntervalMs": "serverPollingIntervalMs",
            "sessionTimeoutS": "serverSessionTimeoutS",
            "maxClients": "serverMaxClients",
            "loggingLevel": "serverLoggingLevel",
            "requireSession": "serverRequireSession",
        }
        return mapping.get(key, key)

    def _on_close(self) -> None:
        if self.client is not None:
            self.client.close()
        self.destroy()


def main() -> None:
    app = RotorClientGui()
    app.mainloop()


if __name__ == "__main__":
    main()
