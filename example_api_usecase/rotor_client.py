"""Plug-and-play Python client for the Rotor Interface GS232B API.

Die Datei ist bewusst eigenstaendig gehalten: Fuer die REST-API wird nur die
Python-Standardbibliothek verwendet. Dadurch kann sie in ein anderes Projekt
kopiert und dort direkt importiert werden.
"""

from __future__ import annotations

import json
import math
import socket
import threading
import time
from collections import deque
from concurrent.futures import Future
from copy import deepcopy
from typing import Any, AsyncIterator, Dict, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen


JsonObject = Dict[str, Any]


class RotorApiError(Exception):
    """Basisklasse fuer alle Fehler dieses Clients."""


class RotorApiValidationError(RotorApiError, ValueError):
    """Lokaler Eingabefehler, bevor ein HTTP-Request gesendet wurde."""


class RotorApiConnectionError(RotorApiError, ConnectionError):
    """Die API war nicht erreichbar oder die Verbindung ist abgebrochen."""


class RotorApiTimeoutError(RotorApiConnectionError, TimeoutError):
    """Ein Request oder ein Wartevorgang hat das gesetzte Timeout erreicht."""


class RotorApiResponseError(RotorApiError):
    """Die API hat mit einem Fehlerstatuscode geantwortet."""

    def __init__(
        self,
        status_code: int,
        method: str,
        url: str,
        payload: Any = None,
        response_text: str = "",
    ) -> None:
        self.status_code = status_code
        self.method = method.upper()
        self.url = url
        self.payload = payload
        self.response_text = response_text
        super().__init__(self._build_message())

    @property
    def error(self) -> Optional[str]:
        """Fehlertext aus dem API-Payload, falls vorhanden."""
        if isinstance(self.payload, Mapping):
            value = self.payload.get("error")
            return str(value) if value is not None else None
        return None

    @property
    def message(self) -> Optional[str]:
        """Detailtext aus dem API-Payload, falls vorhanden."""
        if isinstance(self.payload, Mapping):
            value = self.payload.get("message")
            return str(value) if value is not None else None
        return None

    @property
    def code(self) -> Optional[str]:
        """Maschinenlesbarer Fehlercode aus dem API-Payload, falls vorhanden."""
        if isinstance(self.payload, Mapping):
            value = self.payload.get("code")
            return str(value) if value is not None else None
        return None

    def _build_message(self) -> str:
        detail = self.error or self.message or self.response_text or "HTTP error"
        return f"{self.method} {self.url} failed with HTTP {self.status_code}: {detail}"


class SessionRequiredError(RotorApiResponseError):
    """Der Server verlangt eine gueltige Session-ID."""


class SessionSuspendedError(RotorApiResponseError):
    """Die verwendete Session wurde vom Server gesperrt."""


class RotorDisconnectedError(RotorApiResponseError):
    """Ein Steuerbefehl wurde abgelehnt, weil kein Rotor verbunden ist."""


class RotorApiClient:
    """Sicherer Convenience-Client fuer die Rotor Interface GS232B REST-API.

    Typische Verwendung:

        client = RotorApiClient()
        client.ensure_session()
        client.connect("COM3")
        client.set_target(180, 45)
        client.stop()

    Args:
        host: Hostname oder IP-Adresse des HTTP-Servers.
        http_port: HTTP-Port des Servers, standardmaessig 8081.
        websocket_port: WebSocket-Port des Servers, standardmaessig 8082.
        base_url: Vollstaendige HTTP-Basis-URL, z. B. "http://localhost:8081".
            Wenn gesetzt, ueberschreibt sie host/http_port.
        websocket_url: Vollstaendige WebSocket-URL. Wenn nicht gesetzt, wird sie
            aus host/base_url und websocket_port abgeleitet.
        timeout: HTTP-Timeout in Sekunden.
        session_id: Bereits bekannte Session-ID.
        auto_session: Holt automatisch eine Session, sobald ein geschuetzter
            Endpunkt ohne Session-ID aufgerufen wird.
        default_headers: Zusaetzliche Header fuer alle Requests.
        auto_update: Startet Hintergrund-Updates direkt beim Erzeugen des Clients.
        auto_update_interval: Schonendes Polling-Intervall in Sekunden.
        auto_update_websocket: Liest WebSocket-Events im Hintergrund mit.
        command_workers: Maximale Anzahl paralleler Hintergrundbefehle fuer
            `call_async()` und die `*_async()`-Convenience-Methoden.
    """

    DEFAULT_HTTP_PORT = 8081
    DEFAULT_WEBSOCKET_PORT = 8082
    DEFAULT_TIMEOUT = 5.0
    ROTOR_DISCONNECTED_CODE = "ROTOR_DISCONNECTED"
    VALID_DIRECTIONS = frozenset({"left", "right", "up", "down", "L", "R", "U", "D"})
    SERVER_SETTING_KEYS = frozenset(
        {
            "serverHttpPort",
            "serverWebSocketPort",
            "serverPollingIntervalMs",
            "serverSessionTimeoutS",
            "serverMaxClients",
            "serverLoggingLevel",
            "serverRequireSession",
        }
    )

    def __init__(
        self,
        host: str = "localhost",
        http_port: int = DEFAULT_HTTP_PORT,
        websocket_port: int = DEFAULT_WEBSOCKET_PORT,
        *,
        base_url: Optional[str] = None,
        websocket_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        session_id: Optional[str] = None,
        auto_session: bool = True,
        default_headers: Optional[Mapping[str, str]] = None,
        auto_update: bool = True,
        auto_update_interval: float = 1.0,
        auto_update_websocket: bool = True,
        command_workers: int = 4,
    ) -> None:
        if base_url is None and "://" in host:
            base_url = host

        if base_url is None:
            clean_host = self._require_non_empty_string(host, "host")
            if ":" in clean_host and not clean_host.startswith("["):
                clean_host = f"[{clean_host}]"
            clean_port = self._require_port(http_port, "http_port", min_port=1)
            base_url = f"http://{clean_host}:{clean_port}"

        self.base_url = self._normalize_http_url(base_url)
        self.websocket_url = (
            self._normalize_websocket_url(websocket_url)
            if websocket_url is not None
            else self._build_websocket_url(self.base_url, websocket_port)
        )
        self.timeout = self._require_positive_number(timeout, "timeout")
        self.auto_session = bool(auto_session)
        self.command_workers = self._require_positive_int(command_workers, "command_workers")
        self.session_id: Optional[str] = None
        self.default_headers = {
            "Accept": "application/json",
            "User-Agent": "RotorApiClient/1.0",
        }
        if default_headers:
            self.default_headers.update({str(k): str(v) for k, v in default_headers.items()})
        if session_id is not None:
            self.set_session_id(session_id)

        self._session_lock = threading.Lock()
        self._cache_lock = threading.RLock()
        self._auto_update_stop = threading.Event()
        self._poll_thread: Optional[threading.Thread] = None
        self._websocket_thread: Optional[threading.Thread] = None
        self._command_semaphore = threading.BoundedSemaphore(self.command_workers)
        self._event_history: deque[JsonObject] = deque(maxlen=100)
        self._current_status: Optional[JsonObject] = None
        self._current_position: Optional[JsonObject] = None
        self._current_settings: Optional[JsonObject] = None
        self._current_clients: Optional[list[JsonObject]] = None
        self._current_routes: Optional[list[JsonObject]] = None
        self._current_route_execution: Optional[JsonObject] = None
        self._latest_route_progress: Optional[JsonObject] = None
        self._latest_event: Optional[JsonObject] = None
        self._last_update_at: Optional[float] = None
        self._last_event_at: Optional[float] = None
        self._last_error: Optional[BaseException] = None

        if auto_update:
            self.start_auto_update(
                poll_interval=auto_update_interval,
                use_websocket=auto_update_websocket,
            )

    def __enter__(self) -> "RotorApiClient":
        """Erlaubt die Verwendung als Context Manager."""
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """Stoppt Hintergrund-Threads beim Verlassen eines with-Blocks."""
        self.close()

    def close(self) -> None:
        """Stoppt Hintergrund-Updates. Netzwerkverbindungen des Servers bleiben bestehen."""
        self.stop_auto_update()

    def call_async(self, method_name: str, *args: Any, **kwargs: Any) -> Future:
        """Fuehrt eine Client-Methode in einem Daemon-Hintergrundthread aus.

        So kann eine GUI oder Hauptanwendung Steuerbefehle ausloesen, ohne den
        eigenen Hauptthread auf den HTTP-Request warten zu lassen.

        Beispiel:
            future = client.call_async("set_target", 180, 45)
        """
        method_name = self._require_non_empty_string(method_name, "method_name")
        if method_name.startswith("_"):
            raise RotorApiValidationError("method_name must refer to a public method.")
        method = getattr(self, method_name, None)
        if not callable(method):
            raise RotorApiValidationError(f"Unknown client method: {method_name}")

        future: Future = Future()

        def worker() -> None:
            acquired = self._command_semaphore.acquire(blocking=False)
            if not acquired:
                future.set_exception(
                    RotorApiError(
                        "Too many background commands are already running. "
                        f"Limit: {self.command_workers}"
                    )
                )
                return
            try:
                if not future.set_running_or_notify_cancel():
                    return
                result = method(*args, **kwargs)
            except Exception as exc:
                future.set_exception(exc)
            else:
                future.set_result(result)
            finally:
                self._command_semaphore.release()

        threading.Thread(
            target=worker,
            name=f"RotorApiClientCall-{method_name}",
            daemon=True,
        ).start()
        return future

    # ------------------------------------------------------------------
    # Session
    # ------------------------------------------------------------------

    def set_session_id(self, session_id: str) -> None:
        """Setzt eine bekannte Session-ID fuer folgende Requests."""
        self.session_id = self._require_non_empty_string(session_id, "session_id")

    def clear_session(self) -> None:
        """Entfernt die lokal gespeicherte Session-ID."""
        self.session_id = None

    def get_session(self) -> JsonObject:
        """Holt oder erzeugt eine Session und speichert deren ID lokal."""
        data = self._request("GET", "/api/session", require_session=False)
        session_id = data.get("sessionId") if isinstance(data, Mapping) else None
        if not isinstance(session_id, str) or not session_id.strip():
            raise RotorApiError("Session response did not contain a valid sessionId.")
        self.session_id = session_id
        return data

    def ensure_session(self) -> str:
        """Stellt sicher, dass eine Session-ID lokal vorhanden ist."""
        if self.session_id:
            return self.session_id
        with self._session_lock:
            if self.session_id:
                return self.session_id
            return self.get_session()["sessionId"]

    # ------------------------------------------------------------------
    # Auto-Update und Cache
    # ------------------------------------------------------------------

    def start_auto_update(
        self,
        *,
        poll_interval: float = 0.5,
        poll_status: bool = True,
        poll_position: bool = True,
        use_websocket: bool = True,
        websocket_ping_interval: float = 15.0,
        event_history_size: int = 100,
    ) -> None:
        """Startet Hintergrund-Updates fuer Status, Position und WebSocket-Events.

        Der Server sendet per WebSocket keine fortlaufenden Positionsdaten.
        Darum werden Positionsdaten per REST gepollt, waehrend WebSocket-Events
        parallel mitgelesen und im Event-Cache gespeichert werden.

        Args:
            poll_interval: Abstand zwischen REST-Statuspolls in Sekunden.
            poll_status: Aktualisiert `current_status` ueber `/api/rotor/status`.
            poll_position: Aktualisiert `current_position` ueber `/api/rotor/position`.
            use_websocket: Liest WebSocket-Events in einem zweiten Hintergrundthread.
            websocket_ping_interval: Keepalive-/Reconnect-Takt fuer WebSocket.
            event_history_size: Maximale Anzahl gespeicherter Events.
        """
        poll_interval = self._require_positive_number(poll_interval, "poll_interval")
        websocket_ping_interval = self._require_positive_number(
            websocket_ping_interval,
            "websocket_ping_interval",
        )
        event_history_size = self._require_positive_int(event_history_size, "event_history_size")
        if not poll_status and not poll_position and not use_websocket:
            raise RotorApiValidationError("At least one auto-update source must be enabled.")

        if self.auto_update_running:
            return

        with self._cache_lock:
            self._event_history = deque(self._event_history, maxlen=event_history_size)
            self._last_error = None

        self._auto_update_stop = threading.Event()

        if poll_status or poll_position:
            self._poll_thread = threading.Thread(
                target=self._poll_loop,
                kwargs={
                    "poll_interval": poll_interval,
                    "poll_status": bool(poll_status),
                    "poll_position": bool(poll_position),
                },
                name="RotorApiClientPoller",
                daemon=True,
            )
            self._poll_thread.start()

        if use_websocket:
            self._websocket_thread = threading.Thread(
                target=self._websocket_loop,
                kwargs={"ping_interval": websocket_ping_interval},
                name="RotorApiClientWebSocket",
                daemon=True,
            )
            self._websocket_thread.start()

    def stop_auto_update(self, *, timeout: float = 3.0) -> None:
        """Stoppt laufende Hintergrund-Updates."""
        timeout = self._require_non_negative_number(timeout, "timeout")
        self._auto_update_stop.set()
        current_thread = threading.current_thread()

        for thread in (self._poll_thread, self._websocket_thread):
            if thread and thread.is_alive() and thread is not current_thread:
                thread.join(timeout=timeout)

        if self._poll_thread and not self._poll_thread.is_alive():
            self._poll_thread = None
        if self._websocket_thread and not self._websocket_thread.is_alive():
            self._websocket_thread = None

    @property
    def auto_update_running(self) -> bool:
        """True, wenn mindestens ein Hintergrund-Update-Thread aktiv ist."""
        return any(
            thread is not None and thread.is_alive()
            for thread in (self._poll_thread, self._websocket_thread)
        )

    @property
    def current_status(self) -> Optional[JsonObject]:
        """Letzter gepollter Rotorstatus oder None, falls noch keiner vorliegt."""
        return self.get_cached_status()

    @property
    def current_position(self) -> Optional[JsonObject]:
        """Letzte gepollte Positionsantwort oder None, falls noch keine vorliegt."""
        return self.get_cached_position()

    @property
    def current_event(self) -> Optional[JsonObject]:
        """Letztes empfangenes WebSocket-Event."""
        return self.get_latest_event()

    @property
    def connected(self) -> Optional[bool]:
        """Letzter bekannter Verbindungsstatus oder None, falls unbekannt."""
        status = self.get_cached_status()
        if status is None:
            return None
        return bool(status.get("connected"))

    @property
    def last_error(self) -> Optional[BaseException]:
        """Letzter Hintergrundfehler oder None."""
        with self._cache_lock:
            return self._last_error

    @property
    def last_update_at(self) -> Optional[float]:
        """Unix-Zeitstempel des letzten Cache-Updates."""
        with self._cache_lock:
            return self._last_update_at

    @property
    def last_event_at(self) -> Optional[float]:
        """Unix-Zeitstempel des letzten WebSocket-Events."""
        with self._cache_lock:
            return self._last_event_at

    def refresh_cache(self, *, include_position: bool = True) -> JsonObject:
        """Aktualisiert den Cache einmalig synchron per REST."""
        status = self.get_status()
        position = self.get_position() if include_position else None
        with self._cache_lock:
            self._current_status = deepcopy(status)
            if position is not None:
                self._current_position = deepcopy(position)
            self._last_update_at = time.time()
            self._last_error = None
        return self.get_cache_snapshot()

    def get_cached_status(self) -> Optional[JsonObject]:
        """Gibt eine Kopie des letzten Status-Caches zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_status)

    def get_cached_position(self) -> Optional[JsonObject]:
        """Gibt eine Kopie des letzten Positions-Caches zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_position)

    def get_cached_settings(self) -> Optional[JsonObject]:
        """Gibt die zuletzt per Event gesehene Settings-Aktualisierung zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_settings)

    def get_cached_clients(self) -> Optional[list[JsonObject]]:
        """Gibt die zuletzt per Event gesehene Clientliste zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_clients)

    def get_cached_routes(self) -> Optional[list[JsonObject]]:
        """Gibt die zuletzt per Event gesehene Routenliste zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_routes)

    def get_cached_route_execution(self) -> Optional[JsonObject]:
        """Gibt den zuletzt bekannten Routenausfuehrungsstatus zurueck."""
        with self._cache_lock:
            return deepcopy(self._current_route_execution)

    def get_latest_route_progress(self) -> Optional[JsonObject]:
        """Gibt das letzte `route_execution_progress`-Event-Data-Objekt zurueck."""
        with self._cache_lock:
            return deepcopy(self._latest_route_progress)

    def get_latest_event(self) -> Optional[JsonObject]:
        """Gibt eine Kopie des letzten WebSocket-Events zurueck."""
        with self._cache_lock:
            return deepcopy(self._latest_event)

    def get_recent_events(self, *, clear: bool = False) -> list[JsonObject]:
        """Gibt gespeicherte WebSocket-Events zurueck.

        Args:
            clear: Wenn True, wird der Event-Cache nach dem Lesen geleert.
        """
        with self._cache_lock:
            events = [deepcopy(event) for event in self._event_history]
            if clear:
                self._event_history.clear()
            return events

    def get_cache_snapshot(self) -> JsonObject:
        """Gibt eine konsistente Kopie aller gecachten Daten zurueck."""
        with self._cache_lock:
            return {
                "status": deepcopy(self._current_status),
                "position": deepcopy(self._current_position),
                "settings": deepcopy(self._current_settings),
                "clients": deepcopy(self._current_clients),
                "routes": deepcopy(self._current_routes),
                "routeExecution": deepcopy(self._current_route_execution),
                "routeProgress": deepcopy(self._latest_route_progress),
                "latestEvent": deepcopy(self._latest_event),
                "lastUpdateAt": self._last_update_at,
                "lastEventAt": self._last_event_at,
                "lastError": str(self._last_error) if self._last_error else None,
                "autoUpdateRunning": self.auto_update_running,
            }

    # ------------------------------------------------------------------
    # Rotor
    # ------------------------------------------------------------------

    def list_ports(self) -> list[JsonObject]:
        """Listet verfuegbare serielle Ports."""
        data = self._request("GET", "/api/rotor/ports")
        ports = data.get("ports") if isinstance(data, Mapping) else None
        if not isinstance(ports, list):
            raise RotorApiError("Port response did not contain a ports list.")
        return ports

    def connect(self, port: str, baud_rate: int = 9600) -> JsonObject:
        """Verbindet den Server mit einem seriellen Rotor-Port."""
        payload = {
            "port": self._require_non_empty_string(port, "port"),
            "baudRate": self._require_positive_int(baud_rate, "baud_rate"),
        }
        return self._request("POST", "/api/rotor/connect", payload)

    def connect_async(self, port: str, baud_rate: int = 9600) -> Future:
        """Nicht-blockierende Variante von `connect()`."""
        return self.call_async("connect", port, baud_rate)

    def connect_first_available(self, baud_rate: int = 9600) -> JsonObject:
        """Verbindet mit dem ersten gefundenen Port.

        Diese Convenience-Funktion ist praktisch fuer Tests, sollte aber in
        produktiven Programmen nur verwendet werden, wenn klar ist, dass genau
        der erste Port der richtige Rotor-Port ist.
        """
        ports = self.list_ports()
        if not ports:
            raise RotorApiValidationError("No serial ports are available.")
        path = ports[0].get("path") if isinstance(ports[0], Mapping) else None
        if not isinstance(path, str) or not path.strip():
            raise RotorApiError("First port entry does not contain a valid path.")
        return self.connect(path, baud_rate=baud_rate)

    def disconnect(self) -> JsonObject:
        """Trennt die aktive Rotor-Verbindung."""
        return self._request("POST", "/api/rotor/disconnect")

    def disconnect_async(self) -> Future:
        """Nicht-blockierende Variante von `disconnect()`."""
        return self.call_async("disconnect")

    def get_status(self) -> JsonObject:
        """Liest den aktuellen Verbindungs- und Positionsstatus."""
        return self._request("GET", "/api/rotor/status")

    def is_connected(self) -> bool:
        """Gibt True zurueck, wenn der Server einen verbundenen Rotor meldet."""
        return bool(self.get_status().get("connected"))

    def get_position(self, cone_angle: float = 10, cone_length: float = 1000) -> JsonObject:
        """Liest den erweiterten Positionsstatus inklusive Cone-Parametern."""
        params = {
            "coneAngle": self._coerce_number(cone_angle, "cone_angle"),
            "coneLength": self._coerce_number(cone_length, "cone_length"),
        }
        return self._request("GET", "/api/rotor/position", params=params)

    def send_command(self, command: str) -> JsonObject:
        """Sendet einen direkten GS-232B-Befehl, z. B. "C2"."""
        payload = {"command": self._require_non_empty_string(command, "command")}
        return self._request("POST", "/api/rotor/command", payload)

    def send_command_async(self, command: str) -> Future:
        """Nicht-blockierende Variante von `send_command()`."""
        return self.call_async("send_command", command)

    def manual_move(self, direction: str) -> JsonObject:
        """Startet eine manuelle Dauerbewegung.

        Erlaubt sind "left", "right", "up", "down" sowie "L", "R", "U", "D".
        Die Bewegung sollte anschliessend mit stop() beendet werden.
        """
        direction = self._require_non_empty_string(direction, "direction")
        if direction not in self.VALID_DIRECTIONS:
            valid = ", ".join(sorted(self.VALID_DIRECTIONS))
            raise RotorApiValidationError(f"direction must be one of: {valid}")
        return self._request("POST", "/api/rotor/manual", {"direction": direction})

    def manual_move_async(self, direction: str) -> Future:
        """Nicht-blockierende Variante von `manual_move()`."""
        return self.call_async("manual_move", direction)

    def move_left(self) -> JsonObject:
        """Startet eine manuelle Bewegung nach links."""
        return self.manual_move("left")

    def move_right(self) -> JsonObject:
        """Startet eine manuelle Bewegung nach rechts."""
        return self.manual_move("right")

    def move_up(self) -> JsonObject:
        """Startet eine manuelle Bewegung nach oben."""
        return self.manual_move("up")

    def move_down(self) -> JsonObject:
        """Startet eine manuelle Bewegung nach unten."""
        return self.manual_move("down")

    def stop(self) -> JsonObject:
        """Stoppt die aktuelle Rotor-Bewegung."""
        return self._request("POST", "/api/rotor/stop")

    def stop_async(self) -> Future:
        """Nicht-blockierende Variante von `stop()`."""
        return self.call_async("stop")

    def set_target(self, az: float, el: float) -> JsonObject:
        """Setzt eine Zielposition in kalibrierten Werten."""
        payload = {
            "az": self._coerce_number(az, "az"),
            "el": self._coerce_number(el, "el"),
        }
        return self._request("POST", "/api/rotor/set_target", payload)

    def set_target_async(self, az: float, el: float) -> Future:
        """Nicht-blockierende Variante von `set_target()`."""
        return self.call_async("set_target", az, el)

    def set_target_raw(self, az: Optional[float] = None, el: Optional[float] = None) -> JsonObject:
        """Setzt eine Zielposition in RAW-Werten.

        Mindestens einer der Werte muss gesetzt sein. Nicht gesetzte Werte
        werden vom Server unveraendert gelassen.
        """
        payload: JsonObject = {}
        if az is not None:
            payload["az"] = self._coerce_number(az, "az")
        if el is not None:
            payload["el"] = self._coerce_number(el, "el")
        if not payload:
            raise RotorApiValidationError("At least one of az or el must be provided.")
        return self._request("POST", "/api/rotor/set_target_raw", payload)

    def set_target_raw_async(self, az: Optional[float] = None, el: Optional[float] = None) -> Future:
        """Nicht-blockierende Variante von `set_target_raw()`."""
        return self.call_async("set_target_raw", az=az, el=el)

    def home(self) -> JsonObject:
        """Faehrt das konfigurierte Home-Preset an."""
        return self._request("POST", "/api/rotor/home")

    def home_async(self) -> Future:
        """Nicht-blockierende Variante von `home()`."""
        return self.call_async("home")

    def park(self) -> JsonObject:
        """Faehrt das konfigurierte Park-Preset an."""
        return self._request("POST", "/api/rotor/park")

    def park_async(self) -> Future:
        """Nicht-blockierende Variante von `park()`."""
        return self.call_async("park")

    def wait_for_connection_state(
        self,
        connected: bool = True,
        *,
        timeout: float = 10.0,
        poll_interval: float = 0.25,
    ) -> JsonObject:
        """Wartet, bis der Server den gewuenschten Verbindungsstatus meldet."""
        timeout = self._require_non_negative_number(timeout, "timeout")
        poll_interval = self._require_positive_number(poll_interval, "poll_interval")
        deadline = time.monotonic() + timeout
        while True:
            status = self.get_status()
            if bool(status.get("connected")) is bool(connected):
                return status
            if time.monotonic() >= deadline:
                state = "connected" if connected else "disconnected"
                raise RotorApiTimeoutError(f"Timed out waiting for rotor to become {state}.")
            time.sleep(poll_interval)

    # ------------------------------------------------------------------
    # Settings und Server
    # ------------------------------------------------------------------

    def get_settings(self) -> JsonObject:
        """Liest die gesamte Anwendungskonfiguration."""
        return self._request("GET", "/api/settings")

    def update_settings(
        self,
        settings: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> JsonObject:
        """Aktualisiert Anwendungseinstellungen teilweise.

        Beispiel:
            client.update_settings({"baudRate": 9600})
            client.update_settings(parkPositionsEnabled=True)
        """
        payload = self._merge_payload(settings, kwargs, "settings")
        return self._request("POST", "/api/settings", payload)

    def update_settings_async(
        self,
        settings: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> Future:
        """Nicht-blockierende Variante von `update_settings()`."""
        return self.call_async("update_settings", settings, **kwargs)

    def get_server_settings(self) -> JsonObject:
        """Liest aktive Serverparameter."""
        return self._request("GET", "/api/server/settings")

    def update_server_settings(
        self,
        settings: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> JsonObject:
        """Validiert und speichert Serverparameter.

        Ports, Polling-Intervall, Session-Timeout, Max-Clients, Logging-Level
        und Session-Pflicht werden lokal vorgeprueft.
        """
        payload = self._merge_payload(settings, kwargs, "server settings")
        payload = self._validate_server_settings(payload)
        return self._request("POST", "/api/server/settings", payload)

    def update_server_settings_async(
        self,
        settings: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> Future:
        """Nicht-blockierende Variante von `update_server_settings()`."""
        return self.call_async("update_server_settings", settings, **kwargs)

    def restart_server(self) -> JsonObject:
        """Fordert einen geordneten Server-Neustart an."""
        return self._request("POST", "/api/server/restart")

    def restart_server_async(self) -> Future:
        """Nicht-blockierende Variante von `restart_server()`."""
        return self.call_async("restart_server")

    # ------------------------------------------------------------------
    # Clients
    # ------------------------------------------------------------------

    def list_clients(self) -> list[JsonObject]:
        """Listet alle bekannten Client-Sessions."""
        data = self._request("GET", "/api/clients")
        clients = data.get("clients") if isinstance(data, Mapping) else None
        if not isinstance(clients, list):
            raise RotorApiError("Client response did not contain a clients list.")
        return clients

    def suspend_client(self, client_id: str) -> JsonObject:
        """Sperrt eine Client-Session."""
        client_id = quote(self._require_non_empty_string(client_id, "client_id"), safe="")
        return self._request("POST", f"/api/clients/{client_id}/suspend")

    def resume_client(self, client_id: str) -> JsonObject:
        """Entsperrt eine Client-Session."""
        client_id = quote(self._require_non_empty_string(client_id, "client_id"), safe="")
        return self._request("POST", f"/api/clients/{client_id}/resume")

    # ------------------------------------------------------------------
    # Routen
    # ------------------------------------------------------------------

    def list_routes(self) -> list[JsonObject]:
        """Liest alle gespeicherten Routen."""
        data = self._request("GET", "/api/routes")
        routes = data.get("routes") if isinstance(data, Mapping) else None
        if not isinstance(routes, list):
            raise RotorApiError("Route response did not contain a routes list.")
        return routes

    def create_route(self, route: Mapping[str, Any]) -> JsonObject:
        """Legt eine neue Route an. Das Feld "id" ist Pflicht."""
        payload = self._ensure_json_object(route, "route")
        route_id = payload.get("id")
        self._require_non_empty_string(route_id, "route['id']")
        return self._request("POST", "/api/routes", payload)

    def create_route_async(self, route: Mapping[str, Any]) -> Future:
        """Nicht-blockierende Variante von `create_route()`."""
        return self.call_async("create_route", route)

    def update_route(self, route_id: str, route: Mapping[str, Any]) -> JsonObject:
        """Aktualisiert eine bestehende Route."""
        clean_id = quote(self._require_non_empty_string(route_id, "route_id"), safe="")
        payload = self._ensure_json_object(route, "route")
        return self._request("PUT", f"/api/routes/{clean_id}", payload)

    def update_route_async(self, route_id: str, route: Mapping[str, Any]) -> Future:
        """Nicht-blockierende Variante von `update_route()`."""
        return self.call_async("update_route", route_id, route)

    def delete_route(self, route_id: str) -> JsonObject:
        """Loescht eine Route."""
        clean_id = quote(self._require_non_empty_string(route_id, "route_id"), safe="")
        return self._request("DELETE", f"/api/routes/{clean_id}")

    def delete_route_async(self, route_id: str) -> Future:
        """Nicht-blockierende Variante von `delete_route()`."""
        return self.call_async("delete_route", route_id)

    def start_route(self, route_id: str) -> JsonObject:
        """Startet die Ausfuehrung einer Route."""
        clean_id = quote(self._require_non_empty_string(route_id, "route_id"), safe="")
        return self._request("POST", f"/api/routes/{clean_id}/start")

    def start_route_async(self, route_id: str) -> Future:
        """Nicht-blockierende Variante von `start_route()`."""
        return self.call_async("start_route", route_id)

    def stop_route(self) -> JsonObject:
        """Stoppt eine laufende Routenausfuehrung."""
        return self._request("POST", "/api/routes/stop")

    def stop_route_async(self) -> Future:
        """Nicht-blockierende Variante von `stop_route()`."""
        return self.call_async("stop_route")

    def continue_route(self) -> JsonObject:
        """Setzt einen manuellen Wait-Schritt fort."""
        return self._request("POST", "/api/routes/continue")

    def continue_route_async(self) -> Future:
        """Nicht-blockierende Variante von `continue_route()`."""
        return self.call_async("continue_route")

    def get_route_execution(self) -> JsonObject:
        """Liest den aktuellen Routenausfuehrungsstatus."""
        return self._request("GET", "/api/routes/execution")

    # ------------------------------------------------------------------
    # Dokumentation und WebSocket
    # ------------------------------------------------------------------

    def get_openapi_spec(self) -> JsonObject:
        """Liest die laufende OpenAPI-Spezifikation des Servers."""
        return self._request("GET", "/api/openapi.json", require_session=False)

    async def websocket_events(
        self,
        *,
        register_session: bool = True,
        ping_interval: Optional[float] = None,
    ) -> AsyncIterator[JsonObject]:
        """Liest WebSocket-Events als async Iterator.

        Fuer diese optionale Funktion muss das Paket "websockets" installiert
        sein. Die REST-Funktionen dieses Clients benoetigen keine externen
        Abhaengigkeiten.

        Beispiel:
            async for event in client.websocket_events():
                print(event["type"], event.get("data"))
        """
        try:
            import asyncio
            import websockets
        except ImportError as exc:
            raise RotorApiError(
                "WebSocket support requires the optional package 'websockets'. "
                "Install it with: pip install websockets"
            ) from exc

        session_id = self.ensure_session() if register_session else None
        if ping_interval is not None:
            ping_interval = self._require_positive_number(ping_interval, "ping_interval")

        async with websockets.connect(self.websocket_url) as websocket:
            if session_id:
                await websocket.send(json.dumps({"type": "register_session", "sessionId": session_id}))

            while True:
                try:
                    if ping_interval is None:
                        raw_message = await websocket.recv()
                    else:
                        raw_message = await asyncio.wait_for(websocket.recv(), timeout=ping_interval)
                except asyncio.TimeoutError:
                    await websocket.send(json.dumps({"type": "ping"}))
                    continue

                yield self._decode_websocket_message(raw_message)

    def _poll_loop(self, *, poll_interval: float, poll_status: bool, poll_position: bool) -> None:
        """Background worker fuer REST-Status- und Positionspolling."""
        while not self._auto_update_stop.is_set():
            wait_time = poll_interval
            try:
                status = self.get_status() if poll_status else None
                position = None
                if poll_position:
                    if status is not None and status.get("connected") is False:
                        position = {
                            "connected": False,
                            "clientCount": status.get("clientCount"),
                        }
                    else:
                        position = self.get_position()

                with self._cache_lock:
                    if status is not None:
                        self._current_status = deepcopy(status)
                    if position is not None:
                        self._current_position = deepcopy(position)
                    self._last_update_at = time.time()
                    self._last_error = None
            except Exception as exc:
                self._set_last_error(exc)
                wait_time = min(max(poll_interval * 2.0, 1.0), 5.0)

            self._auto_update_stop.wait(wait_time)

    def _websocket_loop(self, *, ping_interval: float) -> None:
        """Background worker fuer WebSocket-Events mit Reconnect-Schleife."""
        try:
            import websockets  # noqa: F401
        except ImportError as exc:
            self._set_last_error(
                RotorApiError(
                    "WebSocket auto-update disabled because the optional package "
                    "'websockets' is not installed. REST polling remains active."
                )
            )
            return

        reconnect_delay = 1.0
        while not self._auto_update_stop.is_set():
            try:
                import asyncio

                asyncio.run(self._consume_websocket_events(ping_interval=ping_interval))
                reconnect_delay = 1.0
            except Exception as exc:
                self._set_last_error(exc)

            if not self._auto_update_stop.is_set():
                self._auto_update_stop.wait(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2.0, 30.0)

    async def _consume_websocket_events(self, *, ping_interval: float) -> None:
        async for event in self.websocket_events(register_session=True, ping_interval=ping_interval):
            if self._auto_update_stop.is_set():
                return
            self._record_event(event)

    def _record_event(self, event: Mapping[str, Any]) -> None:
        payload = deepcopy(dict(event))
        event_type = payload.get("type")
        event_data = payload.get("data")
        now = time.time()

        with self._cache_lock:
            self._event_history.append(payload)
            self._latest_event = payload
            self._last_event_at = now
            self._last_update_at = now
            self._last_error = None

            if event_type == "connection_state_changed" and isinstance(event_data, Mapping):
                self._apply_connection_event(event_data)
            elif event_type == "settings_updated" and isinstance(event_data, Mapping):
                self._current_settings = deepcopy(dict(event_data))
            elif event_type == "client_list_updated" and isinstance(event_data, Mapping):
                clients = event_data.get("clients")
                if isinstance(clients, list):
                    self._current_clients = deepcopy(clients)
            elif event_type == "route_list_updated" and isinstance(event_data, Mapping):
                routes = event_data.get("routes")
                if isinstance(routes, list):
                    self._current_routes = deepcopy(routes)
            elif event_type == "route_execution_started" and isinstance(event_data, Mapping):
                self._current_route_execution = {
                    "executing": True,
                    "routeId": event_data.get("routeId"),
                    "routeName": event_data.get("routeName"),
                }
            elif event_type == "route_execution_progress" and isinstance(event_data, Mapping):
                self._latest_route_progress = deepcopy(dict(event_data))
                if self._current_route_execution is None:
                    self._current_route_execution = {"executing": True}
                self._current_route_execution["executing"] = True
            elif event_type == "route_execution_stopped":
                self._mark_route_idle()
            elif event_type == "route_execution_completed" and isinstance(event_data, Mapping):
                self._mark_route_idle()
                if self._current_route_execution is not None:
                    self._current_route_execution["routeId"] = event_data.get("routeId")
                    self._current_route_execution["success"] = event_data.get("success")
                    self._current_route_execution["error"] = event_data.get("error")

    def _apply_connection_event(self, event_data: Mapping[str, Any]) -> None:
        connected = bool(event_data.get("connected"))
        connection_update = {
            "connected": connected,
            "port": event_data.get("port"),
            "baudRate": event_data.get("baudRate"),
        }

        if self._current_status is None:
            self._current_status = dict(connection_update)
        else:
            self._current_status.update(connection_update)

        if self._current_position is not None:
            self._current_position.update(connection_update)

    def _mark_route_idle(self) -> None:
        if self._current_route_execution is None:
            self._current_route_execution = {}
        self._current_route_execution.update({"executing": False})

    def _set_last_error(self, exc: BaseException) -> None:
        with self._cache_lock:
            self._last_error = exc

    # ------------------------------------------------------------------
    # HTTP internals
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Mapping[str, Any]] = None,
        *,
        params: Optional[Mapping[str, Any]] = None,
        require_session: bool = True,
    ) -> JsonObject:
        if require_session and self.auto_session and not self.session_id:
            self.ensure_session()

        method = method.upper()
        url = self._build_url(path, params=params)
        headers = dict(self.default_headers)
        body: Optional[bytes] = None

        if self.session_id:
            headers["X-Session-ID"] = self.session_id

        if payload is not None:
            self._ensure_json_serializable(payload, "payload")
            body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = Request(url, data=body, headers=headers, method=method)

        try:
            with urlopen(request, timeout=self.timeout) as response:
                return self._decode_json_response(response.read(), method, url)
        except HTTPError as exc:
            error_payload, response_text = self._read_error_payload(exc)
            self._raise_response_error(exc.code, method, url, error_payload, response_text)
        except (socket.timeout, TimeoutError) as exc:
            raise RotorApiTimeoutError(f"{method} {url} timed out after {self.timeout} seconds.") from exc
        except URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                raise RotorApiTimeoutError(f"{method} {url} timed out after {self.timeout} seconds.") from exc
            raise RotorApiConnectionError(f"{method} {url} failed: {exc.reason}") from exc
        except OSError as exc:
            raise RotorApiConnectionError(f"{method} {url} failed: {exc}") from exc

        raise RotorApiError(f"{method} {url} failed unexpectedly.")

    def _build_url(self, path: str, *, params: Optional[Mapping[str, Any]] = None) -> str:
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.base_url}{path}"
        if params:
            clean_params = {key: value for key, value in params.items() if value is not None}
            if clean_params:
                url = f"{url}?{urlencode(clean_params, doseq=True)}"
        return url

    def _decode_json_response(self, raw: bytes, method: str, url: str) -> JsonObject:
        if not raw:
            return {}
        text = raw.decode("utf-8", errors="replace")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RotorApiError(f"{method} {url} returned invalid JSON: {text[:200]}") from exc
        if not isinstance(data, dict):
            raise RotorApiError(f"{method} {url} returned JSON that is not an object.")
        return data

    def _read_error_payload(self, exc: HTTPError) -> tuple[Any, str]:
        raw = exc.read()
        text = raw.decode("utf-8", errors="replace") if raw else ""
        if not text:
            return None, ""
        try:
            return json.loads(text), text
        except json.JSONDecodeError:
            return None, text

    def _raise_response_error(
        self,
        status_code: int,
        method: str,
        url: str,
        payload: Any,
        response_text: str,
    ) -> None:
        error_cls = RotorApiResponseError
        if isinstance(payload, Mapping):
            if payload.get("code") == self.ROTOR_DISCONNECTED_CODE:
                error_cls = RotorDisconnectedError
            elif status_code == 401:
                error_cls = SessionRequiredError
            elif status_code == 403:
                error_cls = SessionSuspendedError
        elif status_code == 401:
            error_cls = SessionRequiredError
        elif status_code == 403:
            error_cls = SessionSuspendedError

        raise error_cls(status_code, method, url, payload=payload, response_text=response_text)

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    @classmethod
    def _normalize_http_url(cls, value: str) -> str:
        value = cls._require_non_empty_string(value, "base_url")
        if "://" not in value:
            value = f"http://{value}"
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"}:
            raise RotorApiValidationError("base_url scheme must be http or https.")
        if not parsed.netloc:
            raise RotorApiValidationError("base_url must include a host.")
        if parsed.query or parsed.fragment:
            raise RotorApiValidationError("base_url must not include query or fragment parts.")
        path = parsed.path.rstrip("/")
        return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))

    @classmethod
    def _normalize_websocket_url(cls, value: str) -> str:
        value = cls._require_non_empty_string(value, "websocket_url")
        parsed = urlparse(value)
        if parsed.scheme not in {"ws", "wss"}:
            raise RotorApiValidationError("websocket_url scheme must be ws or wss.")
        if not parsed.netloc:
            raise RotorApiValidationError("websocket_url must include a host.")
        if parsed.query or parsed.fragment:
            raise RotorApiValidationError("websocket_url must not include query or fragment parts.")
        path = parsed.path.rstrip("/")
        return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))

    @classmethod
    def _build_websocket_url(cls, base_url: str, websocket_port: int) -> str:
        parsed = urlparse(base_url)
        port = cls._require_port(websocket_port, "websocket_port", min_port=1)
        host = parsed.hostname
        if not host:
            raise RotorApiValidationError("base_url must include a valid host.")
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return f"{scheme}://{host}:{port}"

    @staticmethod
    def _require_non_empty_string(value: Any, name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise RotorApiValidationError(f"{name} must be a non-empty string.")
        return value.strip()

    @classmethod
    def _require_port(cls, value: Any, name: str, *, min_port: int = 1) -> int:
        port = cls._require_positive_int(value, name)
        if port < min_port or port > 65535:
            raise RotorApiValidationError(f"{name} must be between {min_port} and 65535.")
        return port

    @staticmethod
    def _require_positive_int(value: Any, name: str) -> int:
        if isinstance(value, bool):
            raise RotorApiValidationError(f"{name} must be a positive integer.")
        if isinstance(value, int):
            number = value
        elif isinstance(value, float):
            if not math.isfinite(value) or not value.is_integer():
                raise RotorApiValidationError(f"{name} must be a positive integer.")
            number = int(value)
        elif isinstance(value, str):
            stripped = value.strip()
            if not stripped or not stripped.isdecimal():
                raise RotorApiValidationError(f"{name} must be a positive integer.")
            number = int(stripped)
        else:
            raise RotorApiValidationError(f"{name} must be a positive integer.")
        if number <= 0:
            raise RotorApiValidationError(f"{name} must be a positive integer.")
        return number

    @classmethod
    def _coerce_number(cls, value: Any, name: str) -> float:
        number = cls._require_number(value, name)
        return number

    @staticmethod
    def _require_number(value: Any, name: str) -> float:
        if isinstance(value, bool):
            raise RotorApiValidationError(f"{name} must be a finite number.")
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise RotorApiValidationError(f"{name} must be a finite number.") from exc
        if not math.isfinite(number):
            raise RotorApiValidationError(f"{name} must be a finite number.")
        return number

    @classmethod
    def _require_positive_number(cls, value: Any, name: str) -> float:
        number = cls._require_number(value, name)
        if number <= 0:
            raise RotorApiValidationError(f"{name} must be greater than 0.")
        return number

    @classmethod
    def _require_non_negative_number(cls, value: Any, name: str) -> float:
        number = cls._require_number(value, name)
        if number < 0:
            raise RotorApiValidationError(f"{name} must be greater than or equal to 0.")
        return number

    @classmethod
    def _ensure_json_object(cls, value: Mapping[str, Any], name: str) -> JsonObject:
        if not isinstance(value, Mapping):
            raise RotorApiValidationError(f"{name} must be a mapping/object.")
        payload = dict(value)
        cls._ensure_json_serializable(payload, name)
        return payload

    @staticmethod
    def _ensure_json_serializable(value: Any, name: str) -> None:
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise RotorApiValidationError(f"{name} must be JSON serializable.") from exc

    @classmethod
    def _merge_payload(
        cls,
        values: Optional[Mapping[str, Any]],
        kwargs: Mapping[str, Any],
        name: str,
    ) -> JsonObject:
        payload: JsonObject = {}
        if values is not None:
            payload.update(cls._ensure_json_object(values, name))
        payload.update(kwargs)
        cls._ensure_json_serializable(payload, name)
        if not payload:
            raise RotorApiValidationError(f"{name} must contain at least one value.")
        return payload

    @classmethod
    def _validate_server_settings(cls, payload: Mapping[str, Any]) -> JsonObject:
        clean = cls._ensure_json_object(payload, "server settings")
        unknown = set(clean) - cls.SERVER_SETTING_KEYS
        if unknown:
            joined = ", ".join(sorted(unknown))
            raise RotorApiValidationError(f"Unknown server setting(s): {joined}")

        for key in ("serverHttpPort", "serverWebSocketPort"):
            if key in clean:
                clean[key] = cls._require_port(clean[key], key, min_port=1024)

        if (
            "serverHttpPort" in clean
            and "serverWebSocketPort" in clean
            and clean["serverHttpPort"] == clean["serverWebSocketPort"]
        ):
            raise RotorApiValidationError("serverHttpPort and serverWebSocketPort must be different.")

        if "serverPollingIntervalMs" in clean:
            value = cls._require_positive_int(clean["serverPollingIntervalMs"], "serverPollingIntervalMs")
            if value < 250 or value > 2000:
                raise RotorApiValidationError("serverPollingIntervalMs must be between 250 and 2000.")
            clean["serverPollingIntervalMs"] = value

        if "serverSessionTimeoutS" in clean:
            value = cls._require_positive_int(clean["serverSessionTimeoutS"], "serverSessionTimeoutS")
            if value < 60 or value > 3600:
                raise RotorApiValidationError("serverSessionTimeoutS must be between 60 and 3600.")
            clean["serverSessionTimeoutS"] = value

        if "serverMaxClients" in clean:
            value = cls._require_positive_int(clean["serverMaxClients"], "serverMaxClients")
            if value < 1 or value > 100:
                raise RotorApiValidationError("serverMaxClients must be between 1 and 100.")
            clean["serverMaxClients"] = value

        if "serverLoggingLevel" in clean:
            value = clean["serverLoggingLevel"]
            if value not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
                raise RotorApiValidationError(
                    "serverLoggingLevel must be one of: DEBUG, INFO, WARNING, ERROR."
                )

        if "serverRequireSession" in clean and not isinstance(clean["serverRequireSession"], bool):
            raise RotorApiValidationError("serverRequireSession must be a boolean.")

        return clean

    @staticmethod
    def _decode_websocket_message(raw_message: Any) -> JsonObject:
        if isinstance(raw_message, bytes):
            raw_message = raw_message.decode("utf-8", errors="replace")
        if not isinstance(raw_message, str):
            raise RotorApiError("WebSocket message was neither text nor bytes.")
        try:
            event = json.loads(raw_message)
        except json.JSONDecodeError as exc:
            raise RotorApiError(f"WebSocket message was invalid JSON: {raw_message[:200]}") from exc
        if not isinstance(event, dict):
            raise RotorApiError("WebSocket message JSON was not an object.")
        return event
