# Rotor API Python Client

Plug-and-play Python-Client fuer die REST-API aus `API_Dokumentation.md`.
Die Datei `rotor_client.py` nutzt fuer REST nur die Python-Standardbibliothek
und kann deshalb direkt in andere Projekte kopiert werden.

## Test-GUI

Mit `start_client_gui.bat` im Projektwurzelordner startet eine einfache
Tkinter-GUI zum Testen der Clientklasse.

Die GUI verwendet keine eigenen API-Verbindungen. Sie erstellt nur ein
`RotorApiClient`-Objekt und ruft dessen Funktionen auf. Sichtbar sind:

- Live-Status und Position aus dem autonomen Client-Cache
- Rotor-Verbindung, manuelle Bewegung, Stop, Zielpositionen, Home/Park
- App-Settings und Server-Settings laden und bearbeiten
- Routen laden, erstellen, aktualisieren, loeschen, starten und stoppen
- Debug-Snapshot mit Cache, Session, Events und letzten Fehlern

## Schnellstart

```python
from rotor_api_client import RotorApiClient, RotorApiError

client = RotorApiClient(host="localhost", http_port=8081)

connected = False
try:
    # Auto-Update laeuft ab hier bereits im Hintergrund.
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
- `start_auto_update()` / `stop_auto_update()`: Cache im Hintergrund starten/stoppen.
- `list_ports()`: serielle Ports listen.
- `connect(port, baud_rate=9600)` / `disconnect()`: Rotor verbinden/trennen.
- `get_status()` / `get_position()`: Status und Position lesen.
- `set_target(az, el)`: kalibriertes Ziel setzen.
- `set_target_async(az, el)` und weitere `*_async()`-Methoden:
  Steuerung ohne Blockieren des Hauptthreads.
- `set_target_raw(az=None, el=None)`: RAW-Ziel setzen.
- `manual_move(direction)` und `stop()`: manuell bewegen und stoppen.
- `home()` / `park()`: Presets anfahren.
- `get_settings()` / `update_settings(...)`: App-Konfiguration verwalten.
- `get_server_settings()` / `update_server_settings(...)`: Serverparameter verwalten.
- `list_routes()`, `create_route(...)`, `start_route(...)`: Routen verwalten.
- `websocket_events()`: optionale async WebSocket-Events, benoetigt `websockets`.

## Automatisch aktuelle Daten

`RotorApiClient()` startet standardmaessig autonom. Das bedeutet: Die Klasse
holt Session, Status, Position und Events in Hintergrundthreads, sobald ein
Objekt erzeugt wurde. Der Hauptthread der Anwendung wird dafuer nicht blockiert.

Der Server pusht per WebSocket Verbindungs-, Settings-, Client- und Routen-Events,
aber keine fortlaufenden Positionsdaten. Die Klasse kombiniert deshalb:

- WebSocket im Hintergrund fuer Events
- REST-Polling im Hintergrund fuer `current_status` und `current_position`

```python
import time
from rotor_api_client import RotorApiClient

client = RotorApiClient(auto_update_interval=1.0)

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
client = RotorApiClient(auto_update=False)
client.start_auto_update(poll_interval=0.25)

position = client.current_position
status = client.current_status
events = client.get_recent_events(clear=True)

client.stop_auto_update()
```

Direkte REST-Methoden wie `set_target()` sind bewusst synchron und liefern das
API-Ergebnis direkt zurueck. Fuer GUI- oder Hauptthread-schonende Steuerung gibt
es nicht-blockierende Varianten:

```python
future = client.set_target_async(180, 45)

# spaeter, falls das Ergebnis gebraucht wird:
result = future.result(timeout=5)
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
