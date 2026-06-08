# Rotor API Python Client

Plug-and-play Python-Client fuer die REST-API aus `API_Dokumentation.md`.
Die Datei `rotor_client.py` nutzt fuer REST nur die Python-Standardbibliothek
und kann deshalb direkt in andere Projekte kopiert werden.

## Schnellstart

```python
from rotor_api_client import RotorApiClient, RotorApiError

client = RotorApiClient(host="localhost", http_port=8081)

connected = False
try:
    client.ensure_session()
    client.connect("COM3", baud_rate=9600)
    connected = True
    client.set_target(az=180, el=45)
    client.stop()
finally:
    if connected:
        client.disconnect()
```

## Wichtige Methoden

- `ensure_session()`: Session holen und fuer Folge-Requests speichern.
- `start_auto_update()` / `stop_auto_update()`: Cache im Hintergrund aktuell halten.
- `list_ports()`: serielle Ports listen.
- `connect(port, baud_rate=9600)` / `disconnect()`: Rotor verbinden/trennen.
- `get_status()` / `get_position()`: Status und Position lesen.
- `set_target(az, el)`: kalibriertes Ziel setzen.
- `set_target_raw(az=None, el=None)`: RAW-Ziel setzen.
- `manual_move(direction)` und `stop()`: manuell bewegen und stoppen.
- `home()` / `park()`: Presets anfahren.
- `get_settings()` / `update_settings(...)`: App-Konfiguration verwalten.
- `get_server_settings()` / `update_server_settings(...)`: Serverparameter verwalten.
- `list_routes()`, `create_route(...)`, `start_route(...)`: Routen verwalten.
- `websocket_events()`: optionale async WebSocket-Events, benoetigt `websockets`.

## Automatisch aktuelle Daten

Der Server pusht per WebSocket Verbindungs-, Settings-, Client- und Routen-Events,
aber keine fortlaufenden Positionsdaten. Die Klasse kombiniert deshalb:

- WebSocket im Hintergrund fuer Events
- REST-Polling im Hintergrund fuer `current_status` und `current_position`

```python
import time
from rotor_api_client import RotorApiClient

client = RotorApiClient(auto_update=True, auto_update_interval=0.5)

try:
    time.sleep(1.0)  # ersten Poll abwarten
    print(client.current_status)
    print(client.current_position)
    print(client.get_recent_events())
finally:
    client.close()
```

Alternativ kann der Hintergrunddienst explizit gestartet werden:

```python
client = RotorApiClient()
client.start_auto_update(poll_interval=0.25)

position = client.current_position
status = client.current_status
events = client.get_recent_events(clear=True)

client.stop_auto_update()
```

## Fehlerbehandlung

Alle Client-Fehler erben von `RotorApiError`. Fuer typische Faelle gibt es
spezialisierte Exceptions:

- `RotorApiValidationError`: lokale Eingaben sind ungueltig.
- `RotorApiConnectionError`: Server nicht erreichbar.
- `RotorApiTimeoutError`: Request oder Wartevorgang hat zu lange gedauert.
- `RotorApiResponseError`: API antwortet mit Fehlerstatus.
- `RotorDisconnectedError`: Rotor ist fuer einen Steuerbefehl nicht verbunden.
- `SessionRequiredError` / `SessionSuspendedError`: Sessionproblem.

```python
from rotor_api_client import RotorApiClient, RotorDisconnectedError, RotorApiError

client = RotorApiClient()

try:
    client.set_target(180, 30)
except RotorDisconnectedError:
    print("Rotor erst verbinden.")
except RotorApiError as exc:
    print(f"API-Fehler: {exc}")
```

## WebSocket-Events

REST funktioniert ohne Zusatzpakete. Fuer WebSocket-Events:

```bash
pip install websockets
```

```python
import asyncio
from rotor_api_client import RotorApiClient

async def main():
    client = RotorApiClient()
    async for event in client.websocket_events():
        print(event)

asyncio.run(main())
```
