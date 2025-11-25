# Rotor Interface GS232B - API Dokumentation

Diese Dokumentation beschreibt die aktuelle REST-API des Rotor Interface GS232B Servers. Alle Legacy-Endpunkte wurden entfernt - der Fokus liegt ausschließlich auf der aktiven Rotor-Steuerung inkl. Kalibrierungsfaktoren.

---

## Übersicht

- **Base URL:** `http://localhost:8081` (mit `--port` änderbar)
- **Content-Type:** `application/json`
- **CORS:** `Access-Control-Allow-Origin: *`
- **Authentifizierung:** keine - bitte nur im vertrauenswürdigen Netzwerk nutzen
- **Kalibrierung:** `rotor-config.ini` (Abschnitt `Calibration`) liefert Offsets & Skalierungsfaktoren, die automatisch auf `GET /api/rotor/status` und `GET /api/rotor/position` angewandt werden. Beide Endpunkte liefern immer die rohen RPH-Werte (direkt vom Rotor) **und** die berechneten Werte mit Faktor/Offset.

### Schnellstart

```bash
pip install -r requirements.txt
python python_server.py --port 8081
```

Der Server hostet gleichzeitig die Web-Oberfläche aus `src/renderer`.

---

## Endpunkt-Übersicht

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /api/rotor/ports` | Verfügbare COM-Ports des Servers abrufen |
| `POST /api/rotor/connect` | Verbindung zu einem COM-Port herstellen |
| `POST /api/rotor/disconnect` | Aktive Verbindung trennen |
| `POST /api/rotor/command` | GS-232B-Befehl an den Rotor senden |
| `GET /api/rotor/status` | Aktuellen Status inkl. RPH & faktorberechneten Werten lesen |
| `GET /api/rotor/position` | Position + Kegel-Visualisierung abrufen (ebenfalls RPH & Faktorwerte) |
| `GET /api/config/ini` | Aktuelle `rotor-config.ini` als Text herunterladen (read-only) |

---

## Endpunkte im Detail

Jeder Abschnitt enthält: Kurzbeschreibung, Request/Response, Beispielantwort, **einzeiligen cURL Befehl** und einen kompakten **Python-Snippet**.

### GET /api/rotor/ports

Listet alle COM-Ports, die der Server anzeigen kann (`pyserial` erforderlich).

- **Request:** keine Parameter
- **Response 200:**
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

- **Curl (einzeilig):**
```bash
curl -s http://localhost:8081/api/rotor/ports
```

- **Python (requests):**
```python
import requests
ports = requests.get("http://localhost:8081/api/rotor/ports").json()["ports"]
print("Ports:", ", ".join([p["path"] for p in ports]) or "keine")
```

---

### POST /api/rotor/connect

Verbindet den Server mit einem COM-Port (eine Verbindung gleichzeitig).

- **Body:**
```json
{
  "port": "COM3",
  "baudRate": 9600
}
```

- **Response 200:**
```json
{
  "status": "ok",
  "port": "COM3",
  "baudRate": 9600
}
```

- **Fehler 400:** z. B. `"port must be a non-empty string"` oder Serial-Fehlertext.

- **Curl (einzeilig):**
```bash
curl -s -X POST http://localhost:8081/api/rotor/connect -H "Content-Type: application/json" -d "{\"port\":\"COM3\",\"baudRate\":9600}"
```

- **Python (requests):**
```python
import requests
payload = {"port": "COM3", "baudRate": 9600}
print("Connect:", requests.post("http://localhost:8081/api/rotor/connect", json=payload).json())
```

---

### POST /api/rotor/disconnect

Trennt die aktive Verbindung; mehrfaches Aufrufen ist unkritisch.

- **Request:** kein Body
- **Response 200:** `{ "status": "ok" }`

- **Curl:**
```bash
curl -s -X POST http://localhost:8081/api/rotor/disconnect
```

- **Python:**
```python
import requests
print("Disconnect:", requests.post("http://localhost:8081/api/rotor/disconnect").json())
```

---

### POST /api/rotor/command

Sendet einen GS-232B-Befehl, während eine Verbindung besteht. Der Server ergänzt automatisch `\r`.

- **Body:**
```json
{ "command": "C2" }
```

- **Response 200:** `{ "status": "ok" }`
- **Fehler 400:** `"not connected"` oder `"command must be a non-empty string"`

- **Curl:**
```bash
curl -s -X POST http://localhost:8081/api/rotor/command -H "Content-Type: application/json" -d "{\"command\":\"C2\"}"
```

- **Python:**
```python
import requests
print("Send:", requests.post("http://localhost:8081/api/rotor/command", json={"command": "M180"}).json())
```

---

### GET /api/rotor/status

Liefert den aktuellen Rotorstatus. Die API greift automatisch auf die Kalibrierungswerte aus `rotor-config.ini` zu und stellt:

- **RPH-Werte:** unveränderte Rohdaten des Rotors (`status.rph`)
- **Faktor-/Offset-Werte:** mit Skalierungsfaktor & Offset berechnete Werte (`status.calibrated`)

- **Response 200 (verbunden):**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "status": {
    "timestamp": 1705320000000,
    "rawLine": "AZ=123 EL=045",
    "rph": {
      "azimuth": 123,
      "elevation": 45
    },
    "calibrated": {
      "azimuth": 123.0,
      "elevation": 45.0
    },
    "calibration": {
      "azimuthOffset": 0.0,
      "elevationOffset": 0.0,
      "azimuthScaleFactor": 1.0,
      "elevationScaleFactor": 1.0
    }
  }
}
```

- **Response 200 (nicht verbunden):** `{ "connected": false }`

- **Curl:**
```bash
curl -s http://localhost:8081/api/rotor/status | jq
```

- **Python:**
```python
import requests, json
status = requests.get("http://localhost:8081/api/rotor/status").json()
print(json.dumps(status, indent=2))
```

---

### GET /api/rotor/position

Baut auf dem Status-Endpunkt auf, liefert aber zusätzliche Kegel-Parameter zur Visualisierung. Auch hier werden **immer** RPH- und faktorberechnete Werte ausgegeben.

- **Query-Parameter (optional):**
  - `coneAngle` (float, Grad, Standard 10)
  - `coneLength` (float, Meter, Standard 1000)

- **Response 200 (verbunden):**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
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
    "angle": 10,
    "length": 1000
  }
}
```

- **Curl:**
```bash
curl -s "http://localhost:8081/api/rotor/position?coneAngle=15&coneLength=2000"
```

- **Python:**
```python
import requests
position = requests.get("http://localhost:8081/api/rotor/position", params={"coneAngle": 12, "coneLength": 1500}).json()
print("Cal Az:", position.get("position", {}).get("calibrated"))
```

---

### GET /api/config/ini

Stellt die komplette `rotor-config.ini` bereit (read-only). Damit können externe Tools prüfen, welche Kalibrierungswerte aktuell gelten.

- **Response 200:**
```json
{ "content": "...INI-Datei als Text..." }
```

- **Curl:**
```bash
curl -s http://localhost:8081/api/config/ini
```

- **Python:**
```python
import requests
ini = requests.get("http://localhost:8081/api/config/ini").json()["content"]
print(ini.splitlines()[:5])
```

---

## Fehlerbehandlung

| Code | Beschreibung |
|------|--------------|
| `200 OK` | Standard-Antwort bei Erfolg |
| `400 Bad Request` | Ungültige Eingaben (z. B. fehlender Port, kein Command, nicht verbunden) |
| `404 Not Found` | Endpunkt existiert nicht |
| `405 Method Not Allowed` | Schreibzugriff auf `api/config/ini` |
| `500 Internal Server Error` | Unerwarteter Fehler (selten) |

Fehlerantworten folgen immer dem Schema:
```json
{ "error": "Fehlermeldung" }
```

---

## GS-232B Kurzreferenz

| Befehl | Wirkung |
|--------|--------|
| `C2` | Aktuellen Status abfragen |
| `Mxxx` | Azimut setzen (`xxx` Grad) |
| `WAAA BBB` | Azimut & Elevation setzen |
| `R` / `L` | Dauerlauf rechts / links |
| `U` / `D` | Elevation hoch / runter |
| `A` / `E` / `S` | Stop Azimut / Stop Elevation / Stop alles |

Weitere Befehle siehe `GS232B_Befehle.md`. Kommandos immer ohne `\r` senden.

---

## Vollständige Python-Klasse

Die folgende Klasse kapselt alle Endpunkte, loggt konsolenfreundlich und berücksichtigt automatisch RPH- und Faktor-Werte:

```python
import json
import time
from typing import Dict, Optional

import requests


class RotorClient:
    """Klient für den Rotor Interface GS232B Server."""

    def __init__(self, base_url: str = "http://localhost:8081"):
        self.base_url = base_url.rstrip("/")
        print(f"[RotorClient] Verwende API unter {self.base_url}")

    # --- Helpers ---------------------------------------------------------
    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _log_response(self, label: str, response: requests.Response) -> Dict:
        data = response.json()
        print(f"[RotorClient] {label} -> {response.status_code}")
        print(json.dumps(data, indent=2))
        return data

    def _post_command(self, command: str, label: Optional[str] = None) -> Dict:
        response = requests.post(self._url("/api/rotor/command"), json={"command": command})
        return self._log_response(label or f"Command {command}", response)

    # --- Public API ------------------------------------------------------
    def list_ports(self) -> Dict:
        response = requests.get(self._url("/api/rotor/ports"))
        return self._log_response("Ports", response)

    def connect(self, port: str, baud_rate: int = 9600) -> Dict:
        payload = {"port": port, "baudRate": baud_rate}
        response = requests.post(self._url("/api/rotor/connect"), json=payload)
        return self._log_response(f"Connect {port}", response)

    def disconnect(self) -> Dict:
        response = requests.post(self._url("/api/rotor/disconnect"))
        return self._log_response("Disconnect", response)

    def send_raw_command(self, command: str) -> Dict:
        """Sende einen beliebigen GS-232B Befehl."""
        return self._post_command(command)

    def move_to(self, azimuth: Optional[int] = None, elevation: Optional[int] = None) -> Dict:
        """Fahre gezielt zu Azimut und optional Elevation."""
        if azimuth is None and elevation is None:
            raise ValueError("Mindestens azimuth oder elevation angeben.")
        if azimuth is not None and elevation is not None:
            cmd = f"W{azimuth:03d} {elevation:03d}"
        elif azimuth is not None:
            cmd = f"M{azimuth:03d}"
        else:
            cmd = f"X{elevation:03d}"  # GS-232B: nur Elevation setzen (X=Elevation)
        return self._post_command(cmd, "MoveTo")

    def move_azimuth_right(self) -> Dict:
        return self._post_command("R", "Azimuth Right")

    def move_azimuth_left(self) -> Dict:
        return self._post_command("L", "Azimuth Left")

    def move_elevation_up(self) -> Dict:
        return self._post_command("U", "Elevation Up")

    def move_elevation_down(self) -> Dict:
        return self._post_command("D", "Elevation Down")

    def stop_azimuth(self) -> Dict:
        return self._post_command("A", "Stop Azimuth")

    def stop_elevation(self) -> Dict:
        return self._post_command("E", "Stop Elevation")

    def stop_all(self) -> Dict:
        return self._post_command("S", "Stop All")

    def request_status(self) -> Dict:
        return self._post_command("C2", "Request Status")

    def get_status(self) -> Dict:
        response = requests.get(self._url("/api/rotor/status"))
        return self._log_response("Status", response)

    def get_position(self, cone_angle: Optional[float] = None, cone_length: Optional[float] = None) -> Dict:
        params = {}
        if cone_angle is not None:
            params["coneAngle"] = cone_angle
        if cone_length is not None:
            params["coneLength"] = cone_length
        response = requests.get(self._url("/api/rotor/position"), params=params or None)
        return self._log_response("Position", response)

    def tap_status_loop(self, duration_sec: float = 5.0, interval_sec: float = 0.5) -> None:
        """Pollt den Status, damit die Unterschiede zwischen RPH und Faktor sichtbar werden."""
        start = time.time()
        while time.time() - start < duration_sec:
            status = self.get_status()
            if status.get("connected"):
                rph = status["status"]["rph"]
                calibrated = status["status"]["calibrated"]
                print(f"[RotorClient] RPH Az={rph.get('azimuth')} / Kalibriert Az={calibrated.get('azimuth')}")
            time.sleep(interval_sec)


if __name__ == "__main__":
    client = RotorClient()
    ports = client.list_ports().get("ports", [])
    if ports:
        target = ports[0]["path"]
        client.connect(target, 9600)
        client.request_status()
        client.tap_status_loop()
        client.move_to(180, 45)
        time.sleep(2)
        client.move_azimuth_right()
        time.sleep(1)
        client.stop_all()
        client.get_position(cone_angle=15, cone_length=2000)
        client.disconnect()
    else:
        print("[RotorClient] Keine Ports vorhanden - Simulation verwenden oder Hardware prüfen.")
```

---

## Betrieb & Support

- **Server starten:** `python python_server.py [--port 9000]`
- **Abhängigkeit:** `pyserial` für COM-Port Zugriff
- **Konfiguration:** `rotor-config.ini` → `Calibration` Abschnitt verwaltet Offsets/Skalierungsfaktoren (wirksam für Status & Position)
- **Netzwerkzugriff:** Server lauscht auf `0.0.0.0`; UI unter `http://<server>:8081`
- **Support:** Logs in der Server-Konsole prüfen, GS232B-Befehlsliste (`GS232B_Befehle.md`) heranziehen

Letzte Aktualisierung: 2025  
Server-Version: `RotorHTTP/0.1`
