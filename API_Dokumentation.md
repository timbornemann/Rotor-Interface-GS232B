# Rotor Interface GS232B - API Dokumentation

Diese Dokumentation beschreibt die vollständige REST-API des Rotor Interface GS232B Servers. Der Server bietet sowohl Low-Level-Steuerung (direkte GS-232B Befehle) als auch High-Level-Steuerung (abstrahierte Bewegungsbefehle) sowie umfangreiche Konfigurations- und Verwaltungsfunktionen.

---

## Übersicht

- **Base URL:** `http://localhost:8081` (mit `--port` änderbar)
- **Content-Type:** `application/json`
- **CORS:** `Access-Control-Allow-Origin: *`
- **Authentifizierung:** keine - bitte nur im vertrauenswürdigen Netzwerk nutzen
- **Session-Management:** Der Server verwaltet Client-Sessions zur Steuerung von Multi-User-Zugriff
- **Kalibrierung:** Alle Positions-Endpunkte liefern sowohl RAW (direkt vom Rotor) als auch KALIBRIERTE Werte (mit Offset/Skalierung)

### Schnellstart

```bash
pip install -r requirements.txt
python python_server.py --port 8081
```

Der Server hostet gleichzeitig die Web-Oberfläche aus `src/renderer` unter `http://localhost:8081`.

---

## Endpunkt-Übersicht

### Rotor-Steuerung

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/rotor/ports` | GET | Verfügbare COM-Ports auflisten |
| `/api/rotor/connect` | POST | Verbindung zu COM-Port herstellen |
| `/api/rotor/disconnect` | POST | Verbindung trennen |
| `/api/rotor/status` | GET | Aktuellen Status (Position, Verbindung) abrufen |
| `/api/rotor/position` | GET | Position mit Kegel-Visualisierungsparametern |
| `/api/rotor/command` | POST | **Direkter GS-232B Befehl** (Low-Level) |
| `/api/rotor/set_target` | POST | **Zielposition setzen** (kalibrierte Werte) |
| `/api/rotor/set_target_raw` | POST | **Zielposition setzen** (RAW Hardware-Werte) |
| `/api/rotor/manual` | POST | **Manuelle Bewegung** starten (left/right/up/down) |
| `/api/rotor/stop` | POST | **Alle Bewegungen stoppen** |

### Konfiguration

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/settings` | GET | Rotor-Konfiguration abrufen (Kalibrierung, Limits, etc.) |
| `/api/settings` | POST | Rotor-Konfiguration aktualisieren |
| `/api/config/ini` | GET | rotor-config.ini Datei lesen (read-only) |

### Server-Verwaltung

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/server/settings` | GET | Server-Einstellungen abrufen (Ports, Polling, etc.) |
| `/api/server/settings` | POST | Server-Einstellungen aktualisieren |
| `/api/server/restart` | POST | Server neu starten |

### Client-Verwaltung (Multi-User)

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/session` | GET | Eigene Session-ID abrufen |
| `/api/clients` | GET | Alle verbundenen Clients auflisten |
| `/api/clients/{id}/suspend` | POST | Client suspendieren (Zugriff sperren) |
| `/api/clients/{id}/resume` | POST | Client wieder aktivieren |

---

## Rotor-Steuerung

### GET /api/rotor/ports

Listet alle verfügbaren COM-Ports auf dem Server.

**Request:** keine Parameter

**Response 200:**
```json
{
  "ports": [
    {
      "path": "COM3",
      "friendlyName": "COM3 - USB Serial Port",
      "description": "USB Serial Port",
      "hwid": "USB VID:PID=1234:5678"
    }
  ]
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/rotor/ports
```

**Python:**
```python
import requests
ports = requests.get("http://localhost:8081/api/rotor/ports").json()["ports"]
print("Verfügbare Ports:", [p["path"] for p in ports])
```

---

### POST /api/rotor/connect

Verbindet den Server mit einem COM-Port. Nur eine Verbindung gleichzeitig möglich.

**Body:**
```json
{
  "port": "COM3",
  "baudRate": 9600
}
```

**Response 200:**
```json
{
  "status": "ok"
}
```

**Fehler:**
- `400 Bad Request`: Port fehlt oder bereits mit anderem Port verbunden
- `500 Internal Server Error`: Verbindungsfehler

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/connect -H "Content-Type: application/json" -d '{"port":"COM3","baudRate":9600}'
```

**Python:**
```python
import requests
response = requests.post("http://localhost:8081/api/rotor/connect", 
                        json={"port": "COM3", "baudRate": 9600})
print(response.json())
```

---

### POST /api/rotor/disconnect

Trennt die aktive Verbindung. Mehrfaches Aufrufen ist unkritisch.

**Request:** kein Body

**Response 200:**
```json
{
  "status": "ok",
  "message": "Disconnected"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/disconnect
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/rotor/disconnect")
```

---

### GET /api/rotor/status

Liefert den aktuellen Rotorstatus mit RAW- und kalibrierten Werten.

**Response 200 (verbunden):**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "clientCount": 2,
  "status": {
    "timestamp": 1705320000000,
    "rawLine": "AZ=123 EL=045",
    "rph": {
      "azimuth": 123,
      "elevation": 45
    },
    "calibrated": {
      "azimuth": 127.0,
      "elevation": 46.5
    }
  }
}
```

**Response 200 (nicht verbunden):**
```json
{
  "connected": false,
  "clientCount": 0
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/rotor/status | jq
```

**Python:**
```python
import requests
status = requests.get("http://localhost:8081/api/rotor/status").json()
if status["connected"]:
    print(f"Position: Az={status['status']['calibrated']['azimuth']}, "
          f"El={status['status']['calibrated']['elevation']}")
```

---

### GET /api/rotor/position

Erweiterte Positionsinformationen mit Kegel-Visualisierungsparametern.

**Query-Parameter (optional):**
- `coneAngle` (float, Grad, Standard: 10)
- `coneLength` (float, Meter, Standard: 1000)

**Response 200 (verbunden):**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "clientCount": 1,
  "position": {
    "timestamp": 1705320000000,
    "rawLine": "AZ=180 EL=045",
    "rph": {
      "azimuth": 180,
      "elevation": 45
    },
    "calibrated": {
      "azimuth": 182.0,
      "elevation": 46.5
    },
    "calibration": {
      "azimuthOffset": 4.0,
      "elevationOffset": 1.5,
      "azimuthScaleFactor": 1.0,
      "elevationScaleFactor": 1.0
    }
  },
  "cone": {
    "angle": 15,
    "length": 2000
  }
}
```

**cURL:**
```bash
curl -s "http://localhost:8081/api/rotor/position?coneAngle=15&coneLength=2000"
```

**Python:**
```python
import requests
pos = requests.get("http://localhost:8081/api/rotor/position", 
                   params={"coneAngle": 12, "coneLength": 1500}).json()
print("Kalibrierte Position:", pos["position"]["calibrated"])
```

---

### POST /api/rotor/command

**Low-Level-Steuerung:** Sendet einen direkten GS-232B Befehl an den Rotor. Der Server ergänzt automatisch `\r`.

**Body:**
```json
{
  "command": "C2"
}
```

**Response 200:**
```json
{
  "status": "ok"
}
```

**Fehler:**
- `400 Bad Request`: Nicht verbunden oder command fehlt
- `500 Internal Server Error`: Sendefehler

**GS-232B Befehlsreferenz:**

| Befehl | Wirkung |
|--------|---------|
| `C2` | Aktuellen Status abfragen |
| `Mxxx` | Azimut auf xxx Grad setzen (z.B. `M180`) |
| `Wxxx yyy` | Azimut + Elevation setzen (z.B. `W180 045`) |
| `R` / `L` | Dauerlauf rechts / links |
| `U` / `D` | Elevation hoch / runter |
| `A` | Stop Azimut |
| `E` | Stop Elevation |
| `S` | Stop alles |

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/command -H "Content-Type: application/json" -d '{"command":"C2"}'
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/rotor/command", json={"command": "M180"})
```

---

### POST /api/rotor/set_target

**High-Level-Steuerung:** Setzt eine Zielposition mit **kalibrierten** Werten. Der Server wendet automatisch Offsets und Skalierung an. Optional Ramping (sanftes Anfahren) möglich.

**Body:**
```json
{
  "az": 180.5,
  "el": 45.0
}
```

- `az`: Ziel-Azimut in Grad (kalibriert) - optional
- `el`: Ziel-Elevation in Grad (kalibriert) - optional

**Response 200:**
```json
{
  "status": "ok"
}
```

**Fehler:**
- `400 Bad Request`: Nicht verbunden
- `500 Internal Server Error`: Logic nicht initialisiert

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/set_target -H "Content-Type: application/json" -d '{"az":180,"el":45}'
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/rotor/set_target", json={"az": 180, "el": 45})
```

---

### POST /api/rotor/set_target_raw

**Raw Hardware-Steuerung:** Setzt eine Zielposition mit **RAW Hardware-Werten** ohne Kalibrierung. Nützlich für direkte Hardware-Kontrolle oder Kalibrierungstests.

**Body:**
```json
{
  "az": 180,
  "el": 45
}
```

**Response 200:**
```json
{
  "status": "ok"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/set_target_raw -H "Content-Type: application/json" -d '{"az":180,"el":45}'
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/rotor/set_target_raw", json={"az": 180, "el": 45})
```

---

### POST /api/rotor/manual

**Manuelle Bewegung:** Startet eine kontinuierliche Bewegung in eine Richtung. Bewegung läuft bis `stop` aufgerufen wird oder ein Limit erreicht wird.

**Body:**
```json
{
  "direction": "right"
}
```

**Gültige Richtungen:**
- `left` / `right` - Azimut
- `up` / `down` - Elevation
- `L` / `R` / `U` / `D` - GS-232B Protokoll-Befehle (Backward-Kompatibilität)

**Response 200:**
```json
{
  "status": "ok"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/manual -H "Content-Type: application/json" -d '{"direction":"right"}'
```

**Python:**
```python
import requests
import time

# Rechts bewegen für 3 Sekunden
requests.post("http://localhost:8081/api/rotor/manual", json={"direction": "right"})
time.sleep(3)
requests.post("http://localhost:8081/api/rotor/stop")
```

---

### POST /api/rotor/stop

Stoppt alle aktiven Bewegungen (manuelle Bewegung oder Zielfahrt).

**Request:** kein Body

**Response 200:**
```json
{
  "status": "ok"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/rotor/stop
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/rotor/stop")
```

---

## Konfiguration

### GET /api/settings

Ruft alle Rotor-Konfigurationseinstellungen ab (Kalibrierung, Limits, Geschwindigkeit, etc.).

**Response 200:**
```json
{
  "azimuthMinLimit": 0,
  "azimuthMaxLimit": 360,
  "elevationMinLimit": 0,
  "elevationMaxLimit": 90,
  "azimuthMode": 360,
  "azimuthOffset": 4.0,
  "elevationOffset": 1.5,
  "azimuthScaleFactor": 1.0,
  "elevationScaleFactor": 1.0,
  "azimuthSpeedDegPerSec": 4.0,
  "elevationSpeedDegPerSec": 2.0,
  "rampEnabled": false,
  "rampKp": 0.4,
  "rampSampleTimeMs": 400
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/settings | jq
```

**Python:**
```python
import requests
settings = requests.get("http://localhost:8081/api/settings").json()
print(f"Azimuth Offset: {settings['azimuthOffset']}")
```

---

### POST /api/settings

Aktualisiert Rotor-Konfigurationseinstellungen. Nur die übergebenen Felder werden geändert.

**Body (Beispiel - alle Felder optional):**
```json
{
  "azimuthOffset": 5.0,
  "elevationOffset": 2.0,
  "azimuthMinLimit": 0,
  "azimuthMaxLimit": 450,
  "azimuthMode": 450
}
```

**Response 200:**
```json
{
  "status": "ok",
  "settings": {
    "azimuthOffset": 5.0,
    "elevationOffset": 2.0,
    ...
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/settings -H "Content-Type: application/json" -d '{"azimuthOffset":5.0}'
```

**Python:**
```python
import requests
requests.post("http://localhost:8081/api/settings", 
             json={"azimuthOffset": 5.0, "elevationOffset": 2.0})
```

---

### GET /api/config/ini

Liefert den kompletten Inhalt der `rotor-config.ini` Datei (read-only). Nützlich für Backup oder externe Konfigurationstools.

**Response 200:**
```json
{
  "content": "[Calibration]\nazimuthOffset = 4.0\nelevationOffset = 1.5\n..."
}
```

**Response 404:** rotor-config.ini nicht gefunden

**cURL:**
```bash
curl -s http://localhost:8081/api/config/ini
```

**Python:**
```python
import requests
ini = requests.get("http://localhost:8081/api/config/ini").json()["content"]
print(ini)
```

---

## Server-Verwaltung

### GET /api/server/settings

Ruft Server-spezifische Einstellungen ab (Ports, Polling-Intervall, Session-Timeout, etc.).

**Response 200:**
```json
{
  "httpPort": 8081,
  "webSocketPort": 8082,
  "pollingIntervalMs": 500,
  "sessionTimeoutS": 300,
  "maxClients": 10,
  "loggingLevel": "INFO"
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/server/settings
```

---

### POST /api/server/settings

Aktualisiert Server-Einstellungen. Einige Änderungen (z.B. Ports) erfordern einen Neustart.

**Body (Beispiel):**
```json
{
  "serverPollingIntervalMs": 250,
  "serverSessionTimeoutS": 600,
  "serverLoggingLevel": "DEBUG"
}
```

**Gültige Felder:**
- `serverHttpPort`: 1024-65535
- `serverWebSocketPort`: 1024-65535
- `serverPollingIntervalMs`: 250-2000
- `serverSessionTimeoutS`: 60-3600
- `serverMaxClients`: 1-100
- `serverLoggingLevel`: "DEBUG", "INFO", "WARNING", "ERROR"

**Response 200:**
```json
{
  "status": "ok",
  "message": "Server settings saved. Restart required for port changes to take effect.",
  "restartRequired": false
}
```

**Fehler:**
- `400 Bad Request`: Validierungsfehler (z.B. ungültige Port-Nummer)

**cURL:**
```bash
curl -X POST http://localhost:8081/api/server/settings -H "Content-Type: application/json" -d '{"serverPollingIntervalMs":250}'
```

---

### POST /api/server/restart

Startet den Server neu. Sinnvoll nach Port-Änderungen. Der Batch-Wrapper startet den Server automatisch neu (Exit-Code 42).

**Request:** kein Body

**Response 200:**
```json
{
  "status": "restarting",
  "message": "Server is restarting..."
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/server/restart
```

---

## Client-Verwaltung (Multi-User)

### GET /api/session

Erstellt eine Session (falls noch keine existiert) und liefert die Session-ID zurück.

**Response 200:**
```json
{
  "sessionId": "abc123...",
  "status": "active"
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/session
```

---

### GET /api/clients

Listet alle verbundenen Client-Sessions auf.

**Response 200:**
```json
{
  "clients": [
    {
      "id": "abc123...",
      "status": "active",
      "lastSeen": 1705320000000,
      "userAgent": "Mozilla/5.0..."
    },
    {
      "id": "xyz789...",
      "status": "suspended",
      "lastSeen": 1705320100000,
      "userAgent": "Python/3.10..."
    }
  ]
}
```

**cURL:**
```bash
curl -s http://localhost:8081/api/clients
```

---

### POST /api/clients/{id}/suspend

Suspendiert einen Client. Suspendierte Clients erhalten HTTP 403 auf API-Anfragen (außer session-Endpunkt).

**Response 200:**
```json
{
  "status": "ok",
  "message": "Client abc123... suspended"
}
```

**Fehler:**
- `404 Not Found`: Client-ID existiert nicht

**cURL:**
```bash
curl -X POST http://localhost:8081/api/clients/abc123.../suspend
```

---

### POST /api/clients/{id}/resume

Hebt die Suspendierung eines Clients auf.

**Response 200:**
```json
{
  "status": "ok",
  "message": "Client abc123... resumed"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8081/api/clients/abc123.../resume
```

---

## Fehlerbehandlung

| Code | Beschreibung |
|------|--------------|
| `200 OK` | Erfolg |
| `400 Bad Request` | Ungültige Eingabe, fehlende Parameter |
| `403 Forbidden` | Client suspendiert |
| `404 Not Found` | Endpunkt oder Ressource nicht gefunden |
| `405 Method Not Allowed` | Falsche HTTP-Methode |
| `500 Internal Server Error` | Server-Fehler |

**Fehlerantworten:**
```json
{
  "error": "Fehlermeldung",
  "message": "Detaillierte Beschreibung (optional)"
}
```

---

## Python Client-Klasse

Vollständiger Python-Client für alle API-Endpunkte:

```python
import json
import time
from typing import Dict, Optional, Any

import requests


class RotorClient:
    """Vollständiger Client für die Rotor Interface GS232B API."""

    def __init__(self, base_url: str = "http://localhost:8081"):
        self.base_url = base_url.rstrip("/")
        self.session_id: Optional[str] = None
        print(f"[RotorClient] API unter {self.base_url}")
        self._init_session()

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _log(self, label: str, response: requests.Response) -> Dict:
        data = response.json()
        print(f"[RotorClient] {label} -> {response.status_code}")
        if response.status_code != 200:
            print(json.dumps(data, indent=2))
        return data

    def _init_session(self) -> None:
        """Initialisiere Session."""
        try:
            response = requests.get(self._url("/api/session"))
            data = response.json()
            self.session_id = data.get("sessionId")
            print(f"[RotorClient] Session: {self.session_id[:8]}...")
        except Exception as e:
            print(f"[RotorClient] Session-Fehler: {e}")

    # --- Rotor Control ---

    def list_ports(self) -> Dict:
        """Verfügbare COM-Ports auflisten."""
        response = requests.get(self._url("/api/rotor/ports"))
        return self._log("Ports", response)

    def connect(self, port: str, baud_rate: int = 9600) -> Dict:
        """Verbindung zu COM-Port herstellen."""
        payload = {"port": port, "baudRate": baud_rate}
        response = requests.post(self._url("/api/rotor/connect"), json=payload)
        return self._log(f"Connect {port}", response)

    def disconnect(self) -> Dict:
        """Verbindung trennen."""
        response = requests.post(self._url("/api/rotor/disconnect"))
        return self._log("Disconnect", response)

    def get_status(self) -> Dict:
        """Aktuellen Status abrufen."""
        response = requests.get(self._url("/api/rotor/status"))
        return response.json()

    def get_position(self, cone_angle: Optional[float] = None, 
                    cone_length: Optional[float] = None) -> Dict:
        """Position mit Kegel-Parametern abrufen."""
        params = {}
        if cone_angle is not None:
            params["coneAngle"] = cone_angle
        if cone_length is not None:
            params["coneLength"] = cone_length
        response = requests.get(self._url("/api/rotor/position"), params=params or None)
        return self._log("Position", response)

    def send_command(self, command: str) -> Dict:
        """Direkten GS-232B Befehl senden (Low-Level)."""
        response = requests.post(self._url("/api/rotor/command"), json={"command": command})
        return self._log(f"Command {command}", response)

    def set_target(self, az: Optional[float] = None, el: Optional[float] = None) -> Dict:
        """Zielposition setzen (kalibrierte Werte)."""
        payload = {}
        if az is not None:
            payload["az"] = az
        if el is not None:
            payload["el"] = el
        response = requests.post(self._url("/api/rotor/set_target"), json=payload)
        return self._log("SetTarget", response)

    def set_target_raw(self, az: Optional[float] = None, el: Optional[float] = None) -> Dict:
        """Zielposition setzen (RAW Hardware-Werte)."""
        payload = {}
        if az is not None:
            payload["az"] = az
        if el is not None:
            payload["el"] = el
        response = requests.post(self._url("/api/rotor/set_target_raw"), json=payload)
        return self._log("SetTargetRaw", response)

    def manual_move(self, direction: str) -> Dict:
        """Manuelle Bewegung starten (left/right/up/down)."""
        response = requests.post(self._url("/api/rotor/manual"), json={"direction": direction})
        return self._log(f"Manual {direction}", response)

    def stop(self) -> Dict:
        """Alle Bewegungen stoppen."""
        response = requests.post(self._url("/api/rotor/stop"))
        return self._log("Stop", response)

    # --- Configuration ---

    def get_settings(self) -> Dict:
        """Rotor-Einstellungen abrufen."""
        response = requests.get(self._url("/api/settings"))
        return response.json()

    def update_settings(self, settings: Dict[str, Any]) -> Dict:
        """Rotor-Einstellungen aktualisieren."""
        response = requests.post(self._url("/api/settings"), json=settings)
        return self._log("UpdateSettings", response)

    def get_config_ini(self) -> str:
        """rotor-config.ini Inhalt abrufen."""
        response = requests.get(self._url("/api/config/ini"))
        data = response.json()
        return data.get("content", "")

    # --- Server Management ---

    def get_server_settings(self) -> Dict:
        """Server-Einstellungen abrufen."""
        response = requests.get(self._url("/api/server/settings"))
        return response.json()

    def update_server_settings(self, settings: Dict[str, Any]) -> Dict:
        """Server-Einstellungen aktualisieren."""
        response = requests.post(self._url("/api/server/settings"), json=settings)
        return self._log("UpdateServerSettings", response)

    def restart_server(self) -> Dict:
        """Server neu starten."""
        response = requests.post(self._url("/api/server/restart"))
        return self._log("Restart", response)

    # --- Client Management ---

    def list_clients(self) -> Dict:
        """Alle verbundenen Clients auflisten."""
        response = requests.get(self._url("/api/clients"))
        return response.json()

    def suspend_client(self, client_id: str) -> Dict:
        """Client suspendieren."""
        response = requests.post(self._url(f"/api/clients/{client_id}/suspend"))
        return self._log(f"Suspend {client_id[:8]}", response)

    def resume_client(self, client_id: str) -> Dict:
        """Client wieder aktivieren."""
        response = requests.post(self._url(f"/api/clients/{client_id}/resume"))
        return self._log(f"Resume {client_id[:8]}", response)

    # --- Convenience Methods ---

    def poll_status(self, duration_sec: float = 5.0, interval_sec: float = 0.5) -> None:
        """Status periodisch abrufen (nützlich für Monitoring)."""
        start = time.time()
        while time.time() - start < duration_sec:
            status = self.get_status()
            if status.get("connected"):
                rph = status["status"]["rph"]
                cal = status["status"]["calibrated"]
                print(f"[Poll] RAW: Az={rph['azimuth']} El={rph['elevation']} | "
                      f"CAL: Az={cal['azimuth']:.1f} El={cal['elevation']:.1f}")
            else:
                print("[Poll] Nicht verbunden")
            time.sleep(interval_sec)


# Beispiel-Nutzung
if __name__ == "__main__":
    client = RotorClient()
    
    # Ports auflisten
    ports = client.list_ports().get("ports", [])
    print(f"Gefundene Ports: {[p['path'] for p in ports]}")
    
    if ports:
        # Verbinden
        client.connect(ports[0]["path"], 9600)
        time.sleep(1)
        
        # Status abfragen
        client.send_command("C2")
        time.sleep(0.5)
        
        # Position setzen (kalibriert)
        client.set_target(az=180, el=45)
        time.sleep(5)
        
        # Manuelle Bewegung
        client.manual_move("right")
        time.sleep(2)
        client.stop()
        
        # Status überwachen
        client.poll_status(duration_sec=3)
        
        # Einstellungen anzeigen
        settings = client.get_settings()
        print(f"Azimuth Offset: {settings.get('azimuthOffset')}")
        
        # Trennen
        client.disconnect()
    else:
        print("Keine Ports verfügbar - Simulation verwenden oder Hardware prüfen")
```

---

## Steuerungskonzepte

### Low-Level vs. High-Level Steuerung

**Low-Level (direkter GS-232B Befehl):**
```python
# Direkter Hardware-Befehl
client.send_command("M180")  # Fahre zu 180° Azimut (RAW)
```

**High-Level (kalibrierte Position):**
```python
# Kalibrierte Position mit Offset/Skalierung
client.set_target(az=180, el=45)  # Server wendet Kalibrierung an
```

**High-Level (RAW Hardware-Wert):**
```python
# RAW Hardware-Position ohne Kalibrierung
client.set_target_raw(az=180, el=45)  # Direkter Hardware-Wert
```

### Kalibrierung

Alle Positions-APIs (`/status`, `/position`) liefern sowohl:
- **RPH-Werte**: Direkte Rotor-Hardware-Position
- **Kalibrierte Werte**: Mit Offset/Skalierung berechnet

**Formel:**
```
kalibriert = (raw + offset) / scale_factor
raw = (kalibriert * scale_factor) - offset
```

**Konfiguration über:**
```python
client.update_settings({
    "azimuthOffset": 4.0,
    "elevationOffset": 1.5,
    "azimuthScaleFactor": 1.0,
    "elevationScaleFactor": 1.0
})
```

### Multi-User Session-Management

Der Server verwaltet Client-Sessions:
- Jeder Client erhält automatisch eine Session-ID
- Suspendierte Clients erhalten HTTP 403
- Admins können Clients über `/api/clients` verwalten

---

## Betrieb & Support

- **Server starten:** `python python_server.py [--port 8081]`
- **Batch-Start (Windows):** `start_server.bat` (mit Auto-Restart bei Exit-Code 42)
- **Web-UI:** `http://localhost:8081`
- **WebSocket:** Port 8082 (konfigurierbar)
- **Abhängigkeiten:** `pip install -r requirements.txt` (pyserial erforderlich)
- **Logs:** Konsolen-Output, Level über `/api/server/settings` anpassbar

**Weitere Dokumentation:**
- `GS232B_Befehle.md` - Vollständige GS-232B Befehlsreferenz
- `Plan.md` - Projekt-Roadmap
- `README.md` - Projekt-Übersicht

---

**Letzte Aktualisierung:** 2025  
**Server-Version:** RotorHTTP/2.0  
**API-Version:** v2.0
