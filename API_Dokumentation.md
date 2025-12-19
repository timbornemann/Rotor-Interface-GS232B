# Rotor Interface GS232B - API Dokumentation

Diese Dokumentation beschreibt die REST-API des Rotor Interface GS232B Servers. Die API ermöglicht es, Rotor-Befehle zu senden und abzurufen, um die Anwendung in andere Programme zu integrieren.

## Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Endpunkte](#endpunkte)
  - [Rotor-Steuerung](#rotor-steuerung)
    - [GET /api/rotor/ports](#get-apirotorports)
    - [POST /api/rotor/connect](#post-apirotorconnect)
    - [POST /api/rotor/disconnect](#post-apirotordisconnect)
    - [POST /api/rotor/command](#post-apirotorcommand)
    - [GET /api/rotor/status](#get-apirotorstatus)
    - [GET /api/rotor/position](#get-apirotorposition)
- [Fehlerbehandlung](#fehlerbehandlung)
- [Beispiele](#beispiele)
  - [cURL](#curl)
  - [Python](#python)
  - [JavaScript/Node.js](#javascriptnodejs)
  - [PowerShell](#powershell)
- [GS-232B Befehlsreferenz](#gs-232b-befehlsreferenz)

---

## Übersicht

**Base URL:** `http://localhost:8081` (Standard-Port, über `--port` änderbar)

**API Version:** 0.1

**Content-Type:** `application/json`

**CORS:** Aktiviert (Access-Control-Allow-Origin: *)

**Authentifizierung:** Derzeit **keine** – bitte nur in vertrauenswürdigen Netzen einsetzen.

Die API verwendet JSON für alle Anfragen und Antworten und kann wahlweise echte COM-Ports (Server-Modus) oder die Simulation bedienen. Der Python-Server hostet gleichzeitig die Web-Oberfläche aus `src/renderer`.

### Schnellstart

```bash
pip install -r requirements.txt        # pyserial inklusive
python python_server.py --port 8081    # API + UI bereitstellen
```

Anschließend ist die Oberfläche unter `http://localhost:8081` erreichbar und die Endpunkte stehen unter `/api/...` bereit.

---

## Endpunkte

### Legacy Endpunkte

Die früheren `/api/commands`-Routen wurden entfernt, damit ausschließlich die serverseitigen Rotor-Endpunkte genutzt werden. Alle Befehle laufen über die unten beschriebenen `/api/rotor/*` Endpunkte.

### Rotor-Steuerung

Die folgenden Endpunkte ermöglichen die direkte Steuerung des Rotor-Controllers über COM-Ports, die am Server-Rechner angeschlossen sind. Dies ist besonders nützlich, wenn die Web-Anwendung von einem anderen Rechner aus aufgerufen wird.

#### GET /api/rotor/ports

Listet alle verfügbaren COM-Ports auf dem Server-Rechner auf.

##### Request

**URL:** `/api/rotor/ports`

**Method:** `GET`


##### Response

**Status Code:** `200 OK`

**Body (JSON):**
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

**Response-Felder:**
- `ports` (array): Liste aller verfügbaren COM-Ports
  - `path` (string): Port-Name (z.B. "COM3" oder "/dev/ttyUSB0")
  - `friendlyName` (string): Anzeigename
  - `description` (string): Port-Beschreibung
  - `hwid` (string): Hardware-ID

**Hinweis:** Erfordert installiertes `pyserial`. Wenn nicht installiert, wird ein leeres Array zurückgegeben.

---

#### POST /api/rotor/connect

Stellt eine Verbindung zu einem COM-Port her.

##### Request

**URL:** `/api/rotor/connect`

**Method:** `POST`

**Headers:**
- `Content-Type: application/json` (erforderlich)

**Body (JSON):**
```json
{
  "port": "COM3",
  "baudRate": 9600,
  "pollingIntervalMs": 1000
}
```

**Body-Felder:**
- `port` (string, erforderlich): COM-Port-Name (z.B. "COM3", "/dev/ttyUSB0")
- `baudRate` (number, optional): Baudrate (Standard: 9600)
- `pollingIntervalMs` (number, optional): Intervall, mit dem der Server den Rotor per `C2` abfragt (Standard: 1000ms)

##### Response

**Status Code:** `200 OK` (bei Erfolg)

**Body (JSON):**
```json
{
  "status": "ok",
  "port": "COM3",
  "baudRate": 9600,
  "pollingIntervalMs": 1000
}
```

##### Fehlerantworten

**400 Bad Request:**
```json
{
  "error": "port must be a non-empty string"
}
```
oder
```json
{
  "error": "Failed to connect to COM3: [serial error]"
}
```

**Hinweis:** Nur eine Verbindung kann gleichzeitig aktiv sein. Eine bestehende Verbindung wird automatisch getrennt. Nach erfolgreicher Verbindung pollt der Server den Rotor eigenständig mit dem angegebenen Intervall.

---

#### POST /api/rotor/disconnect

Trennt die aktuelle Verbindung zum COM-Port.

##### Request

**URL:** `/api/rotor/disconnect`

**Method:** `POST`


##### Response

**Status Code:** `200 OK`

**Body (JSON):**
```json
{
  "status": "ok"
}
```

---

#### POST /api/rotor/command

Sendet einen Befehl an den Rotor-Controller.

##### Request

**URL:** `/api/rotor/command`

**Method:** `POST`

**Headers:**
- `Content-Type: application/json` (erforderlich)

**Body (JSON):**
```json
{
  "command": "C2"
}
```

**Body-Felder:**
- `command` (string, erforderlich): GS-232B Befehl (z.B. "C2", "M180", "R")

##### Response

**Status Code:** `200 OK`

**Body (JSON):**
```json
{
  "status": "ok"
}
```

##### Fehlerantworten

**400 Bad Request:**
```json
{
  "error": "not connected"
}
```
Tritt auf, wenn keine Verbindung zum COM-Port besteht.

**400 Bad Request:**
```json
{
  "error": "command must be a non-empty string"
}
```
Tritt auf, wenn `command` fehlt oder leer ist.

**Hinweis:** Der Befehl wird automatisch mit `\r` (Carriage Return) abgeschlossen, falls nicht bereits vorhanden.

---

#### GET /api/rotor/status

Ruft den aktuellen Status des Rotor-Controllers ab.

##### Request

**URL:** `/api/rotor/status`

**Method:** `GET`


##### Response

**Status Code:** `200 OK`

**Body (JSON) - Verbunden:**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "status": {
    "raw": "AZ=123 EL=045",
    "timestamp": 1705320000000,
    "azimuthRaw": 123,
    "azimuth": 123,
    "elevationRaw": 45,
    "elevation": 45
  }
}
```

**Body (JSON) - Nicht verbunden:**
```json
{
  "connected": false
}
```

**Response-Felder:**
- `connected` (boolean): Ob eine Verbindung besteht
- `port` (string, optional): COM-Port-Name (nur wenn verbunden)
- `baudRate` (number, optional): Baudrate (nur wenn verbunden)
- `status` (object, optional): Aktueller Status (nur wenn verbunden)
  - `raw` (string): Rohe Antwort vom Rotor
  - `timestamp` (number): Zeitstempel in Millisekunden
  - `azimuthRaw` (number, optional): Roher Azimut-Wert
  - `azimuth` (number, optional): Kalibrierter Azimut-Wert
  - `elevationRaw` (number, optional): Roher Elevation-Wert
  - `elevation` (number, optional): Kalibrierter Elevation-Wert

**Hinweis:** Der Server pollt den Rotor zyklisch mit dem konfigurierten `pollingIntervalMs` und aktualisiert den Status. Die Web-Anwendung ruft lediglich den Server-Status ab (Standard: alle 1s).

---

#### GET /api/rotor/position

Ruft die aktuelle Position (C2-Status) mit Kegel-Einstellungen ab. Dieser Endpunkt ist speziell für die Visualisierung mit Kegel-Darstellung gedacht.

##### Request

**URL:** `/api/rotor/position`

**Method:** `GET`

**Query Parameter (optional):**
- `coneAngle` (number): Kegel-Winkel in Grad (Standard: 10)
- `coneLength` (number): Kegel-Länge in Metern (Standard: 1000)

##### Response

**Status Code:** `200 OK`

**Body (JSON) - Verbunden:**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "position": {
    "azimuth": 180,
    "elevation": 45,
    "azimuthRaw": 180,
    "elevationRaw": 45,
    "timestamp": 1705320000000,
    "raw": "AZ=180 EL=045"
  },
  "cone": {
    "angle": 10,
    "length": 1000
  }
}
```

**Body (JSON) - Nicht verbunden:**
```json
{
  "connected": false
}
```

**Response-Felder:**
- `connected` (boolean): Ob eine Verbindung besteht
- `port` (string, optional): COM-Port-Name (nur wenn verbunden)
- `baudRate` (number, optional): Baudrate (nur wenn verbunden)
- `position` (object, optional): Aktuelle Position (nur wenn verbunden)
  - `azimuth` (number, optional): Kalibrierter Azimut-Wert
  - `elevation` (number, optional): Kalibrierter Elevation-Wert
  - `azimuthRaw` (number, optional): Roher Azimut-Wert
  - `elevationRaw` (number, optional): Roher Elevation-Wert
  - `timestamp` (number): Zeitstempel in Millisekunden
  - `raw` (string): Rohe Antwort vom Rotor (C2-Status)
- `cone` (object): Kegel-Einstellungen
  - `angle` (number): Kegel-Winkel in Grad
  - `length` (number): Kegel-Länge in Metern

**Hinweis:** Die Kegel-Einstellungen können als Query-Parameter übergeben werden. Wenn nicht angegeben, werden Standardwerte verwendet (10° Winkel, 1000m Länge).

**Beispiel mit Query-Parametern:**
```
GET /api/rotor/position?coneAngle=15&coneLength=2000
```

---

## Fehlerbehandlung

### HTTP Status Codes

| Code | Bedeutung | Beschreibung |
|------|-----------|--------------|
| 200 | OK | Anfrage erfolgreich |
| 400 | Bad Request | Ungültige Anfrage (z.B. fehlendes oder leeres `command`) |
| 404 | Not Found | Endpunkt existiert nicht |
| 500 | Internal Server Error | Serverfehler (selten) |

### Fehlerantwort-Format

Alle Fehlerantworten haben folgendes Format:

```json
{
  "error": "error_message"
}
```

---

## Beispiele

### cURL

#### Variablen setzen (für alle Beispiele)

```bash
API_BASE="http://localhost:8081"
```

#### Rotor-Steuerung - Vollständiger Workflow

**1. Verfügbare Ports auflisten:**
```bash
curl -X GET "${API_BASE}/api/rotor/ports"
```

**2. Verbindung zu einem Port herstellen:**
```bash
curl -X POST "${API_BASE}/api/rotor/connect" \
  -H "Content-Type: application/json" \
  -d '{
    "port": "COM3",
    "baudRate": 9600
  }'
```

**3. Aktuellen Status abrufen:**
```bash
curl -X GET "${API_BASE}/api/rotor/status"
```

**Position mit Kegel-Einstellungen abrufen:**
```bash
curl -X GET "${API_BASE}/api/rotor/position"
```

**Position mit benutzerdefinierten Kegel-Einstellungen:**
```bash
curl -X GET "${API_BASE}/api/rotor/position?coneAngle=15&coneLength=2000"
```

**4. Befehle an den Rotor senden:**

**Status abfragen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "C2"
  }'
```

**Azimut auf 180° setzen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "M180"
  }'
```

**Azimut und Elevation setzen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "W180 045"
  }'
```

**Azimut nach rechts drehen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "R"
  }'
```

**Azimut stoppen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "A"
  }'
```

**Alles stoppen:**
```bash
curl -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "S"
  }'
```

**5. Verbindung trennen:**
```bash
curl -X POST "${API_BASE}/api/rotor/disconnect"
```

#### Vollständiges Beispiel-Script

```bash
#!/bin/bash
# Vollständiges Beispiel: Rotor steuern

API_BASE="http://localhost:8081"
API_KEY="rotor-secret-key"

echo "=== Verfügbare Ports ==="
curl -s -X GET "${API_BASE}/api/rotor/ports" | jq '.'

echo -e "\n=== Verbindung herstellen ==="
curl -s -X POST "${API_BASE}/api/rotor/connect" \
  -H "Content-Type: application/json" \
  -d '{"port": "COM3", "baudRate": 9600}' | jq '.'

echo -e "\n=== Status abrufen ==="
curl -s -X GET "${API_BASE}/api/rotor/status" | jq '.'

echo -e "\n=== Status abfragen (C2) ==="
curl -s -X POST "${API_BASE}/api/rotor/command" \
  -H "Content-Type: application/json" \
  -d '{"command": "C2"}' | jq '.'

sleep 1

echo -e "\n=== Status erneut abrufen ==="
curl -s -X GET "${API_BASE}/api/rotor/status" | jq '.'

echo -e "\n=== Verbindung trennen ==="
curl -s -X POST "${API_BASE}/api/rotor/disconnect" | jq '.'
```

---

### Python

#### Einfaches Beispiel

```python
import requests

API_BASE = "http://localhost:8081"
# Verbindung aufbauen (Server pollt Status automatisch)
requests.post(
    f"{API_BASE}/api/rotor/connect",
    json={"port": "COM3", "baudRate": 9600, "pollingIntervalMs": 1000}
)

# Aktuellen Status abrufen
response = requests.get(f"{API_BASE}/api/rotor/status")
print(response.json())

# Azimut setzen
requests.post(
    f"{API_BASE}/api/rotor/command",
    json={"command": "M180"}
)
```

#### Vollständige API-Klasse mit allen Funktionen

```python
import requests
from typing import Dict, List, Optional

class RotorAPI:
    """Vollständige API-Klasse für Rotor Interface GS232B."""
    
    def __init__(self, base_url: str = "http://localhost:8081"):
        self.base_url = base_url.rstrip('/')
        self.headers = {}
    
    # Rotor-Steuerung Endpunkte
    def list_ports(self) -> List[Dict]:
        """Listet alle verfügbaren COM-Ports auf dem Server auf."""
        response = requests.get(f"{self.base_url}/api/rotor/ports")
        response.raise_for_status()
        return response.json()["ports"]
    
    def connect(self, port: str, baud_rate: int = 9600) -> Dict:
        """Stellt eine Verbindung zu einem COM-Port her."""
        payload = {
            "port": port,
            "baudRate": baud_rate
        }
        response = requests.post(
            f"{self.base_url}/api/rotor/connect",
            json=payload
        )
        response.raise_for_status()
        return response.json()
    
    def disconnect(self) -> Dict:
        """Trennt die aktuelle Verbindung zum COM-Port."""
        response = requests.post(f"{self.base_url}/api/rotor/disconnect")
        response.raise_for_status()
        return response.json()
    
    def send_rotor_command(self, command: str) -> Dict:
        """Sendet einen Befehl direkt an den Rotor-Controller."""
        payload = {"command": command}
        response = requests.post(
            f"{self.base_url}/api/rotor/command",
            json=payload
        )
        response.raise_for_status()
        return response.json()
    
    def get_status(self) -> Dict:
        """Ruft den aktuellen Status des Rotor-Controllers ab."""
        response = requests.get(f"{self.base_url}/api/rotor/status")
        response.raise_for_status()
        return response.json()
    
    def is_connected(self) -> bool:
        """Prüft, ob eine Verbindung zum Rotor besteht."""
        status = self.get_status()
        return status.get("connected", False)
    
    def get_current_position(self) -> Optional[Dict]:
        """Ruft die aktuelle Position (Azimut/Elevation) ab."""
        status = self.get_status()
        if status.get("connected") and "status" in status:
            return {
                "azimuth": status["status"].get("azimuth"),
                "elevation": status["status"].get("elevation"),
                "azimuthRaw": status["status"].get("azimuthRaw"),
                "elevationRaw": status["status"].get("elevationRaw")
            }
        return None
    
    def get_position(self, cone_angle: Optional[float] = None, cone_length: Optional[float] = None) -> Dict:
        """Ruft die aktuelle Position mit Kegel-Einstellungen ab."""
        url = f"{self.base_url}/api/rotor/position"
        if cone_angle is not None or cone_length is not None:
            params = []
            if cone_angle is not None:
                params.append(f"coneAngle={cone_angle}")
            if cone_length is not None:
                params.append(f"coneLength={cone_length}")
            if params:
                url += "?" + "&".join(params)
        response = requests.get(url)
        response.raise_for_status()
        return response.json()

# Verwendung - Legacy Endpunkte
api = RotorAPI()

# Status abfragen (Legacy)
api.send_command("C2", meta={"source": "python_script"})

# Azimut auf 180° setzen (Legacy)
api.send_command("M180", meta={"source": "tracking_script"})

# Alle Kommandos anzeigen
for cmd in api.get_commands():
    print(f"{cmd['received_at']}: {cmd['command']}")

# Verwendung - Rotor-Steuerung
print("\n=== Verfügbare Ports ===")
ports = api.list_ports()
for port in ports:
    print(f"  - {port['path']}: {port['friendlyName']}")

if ports:
    print("\n=== Verbindung herstellen ===")
    result = api.connect("COM3", baud_rate=9600)
    print(f"Verbindung: {result}")
    
    print("\n=== Status abrufen ===")
    status = api.get_status()
    print(f"Verbunden: {status.get('connected')}")
    if status.get('connected'):
        print(f"Port: {status.get('port')}")
        print(f"Baudrate: {status.get('baudRate')}")
    
    print("\n=== Befehle senden ===")
    api.send_rotor_command("C2")  # Status abfragen
    
    import time
    time.sleep(1)  # Warten auf Antwort
    
    position = api.get_current_position()
    if position:
        print(f"Aktuelle Position: Az={position['azimuth']}°, El={position['elevation']}°")
    
    api.send_rotor_command("M180")  # Azimut auf 180° setzen
    api.send_rotor_command("W180 045")  # Azimut 180°, Elevation 45°
    api.send_rotor_command("R")  # Azimut nach rechts
    api.send_rotor_command("A")  # Azimut stoppen
    api.send_rotor_command("S")  # Alles stoppen
    
    print("\n=== Verbindung trennen ===")
    result = api.disconnect()
    print(f"Getrennt: {result}")
```

#### Einfache Beispiele ohne Klasse

**Verfügbare Ports auflisten:**
```python
import requests

API_BASE = "http://localhost:8081"

response = requests.get(f"{API_BASE}/api/rotor/ports")
ports = response.json()["ports"]
print("Verfügbare Ports:")
for port in ports:
    print(f"  - {port['path']}: {port['friendlyName']}")
```

**Verbindung herstellen:**
```python
response = requests.post(
    f"{API_BASE}/api/rotor/connect",
    json={"port": "COM3", "baudRate": 9600}
)
if response.status_code == 200:
    print("Verbindung hergestellt:", response.json())
else:
    print(f"Fehler: {response.status_code} - {response.json()}")
```

**Status abrufen:**
```python
response = requests.get(f"{API_BASE}/api/rotor/status")
status = response.json()
if status.get("connected"):
    print(f"Verbunden: {status['port']} @ {status['baudRate']} baud")
    if "status" in status:
        pos = status["status"]
        print(f"Position: Az={pos.get('azimuth')}°, El={pos.get('elevation')}°")
else:
    print("Nicht verbunden")
```

**Befehle senden:**
```python
# Status abfragen
response = requests.post(
    f"{API_BASE}/api/rotor/command",
    json={"command": "C2"},
    headers={"X-API-Key": API_KEY}
)
print("Status abgefragt:", response.json())

# Azimut auf 180° setzen
response = requests.post(
    f"{API_BASE}/api/rotor/command",
    json={"command": "M180"},
    headers={"X-API-Key": API_KEY}
)
print("Azimut gesetzt:", response.json())

# Azimut und Elevation setzen
response = requests.post(
    f"{API_BASE}/api/rotor/command",
    json={"command": "W180 045"},
    headers={"X-API-Key": API_KEY}
)
print("Position gesetzt:", response.json())

# Bewegungsbefehle
commands = ["R", "A", "U", "E", "S"]  # Rechts, Azimut-Stopp, Hoch, Elevation-Stopp, Alles-Stopp
for cmd in commands:
    response = requests.post(
        f"{API_BASE}/api/rotor/command",
        json={"command": cmd}
    )
    print(f"Befehl {cmd} gesendet: {response.json()}")
```

**Verbindung trennen:**
```python
response = requests.post(f"{API_BASE}/api/rotor/disconnect")
print("Verbindung getrennt:", response.json())
```

#### Vollständiges Beispiel-Script

```python
#!/usr/bin/env python3
"""Vollständiges Beispiel: Rotor über API steuern."""

import requests
import time

API_BASE = "http://localhost:8081"
API_KEY = "rotor-secret-key"
HEADERS = {"X-API-Key": API_KEY}

def main():
    print("=== Verfügbare Ports ===")
    response = requests.get(f"{API_BASE}/api/rotor/ports", headers=HEADERS)
    if response.status_code == 200:
        ports = response.json()["ports"]
        for port in ports:
            print(f"  - {port['path']}: {port['friendlyName']}")
        
        if not ports:
            print("  Keine Ports verfügbar")
            return
        
        # Verwende ersten verfügbaren Port
        selected_port = ports[0]["path"]
        print(f"\n=== Verbindung zu {selected_port} herstellen ===")
        
        response = requests.post(
            f"{API_BASE}/api/rotor/connect",
            json={"port": selected_port, "baudRate": 9600},
            headers=HEADERS
        )
        
        if response.status_code == 200:
            print(f"  Erfolg: {response.json()}")
            
            print("\n=== Status abrufen ===")
            response = requests.get(f"{API_BASE}/api/rotor/status", headers=HEADERS)
            if response.status_code == 200:
                status = response.json()
                print(f"  Verbunden: {status.get('connected')}")
                if status.get('connected'):
                    print(f"  Port: {status.get('port')}")
                    print(f"  Baudrate: {status.get('baudRate')}")
            
            print("\n=== Befehle senden ===")
            
            # Status abfragen
            print("  Sende C2 (Status abfragen)...")
            response = requests.post(
                f"{API_BASE}/api/rotor/command",
                json={"command": "C2"},
                headers=HEADERS
            )
            print(f"  Antwort: {response.json()}")
            
            time.sleep(1)  # Warten auf Antwort
            
            # Status erneut abrufen
            response = requests.get(f"{API_BASE}/api/rotor/status", headers=HEADERS)
            if response.status_code == 200:
                status = response.json()
                if status.get("connected") and "status" in status:
                    pos = status["status"]
                    print(f"  Aktuelle Position: Az={pos.get('azimuth')}°, El={pos.get('elevation')}°")
            
            # Azimut auf 180° setzen
            print("\n  Sende M180 (Azimut auf 180°)...")
            response = requests.post(
                f"{API_BASE}/api/rotor/command",
                json={"command": "M180"},
                headers=HEADERS
            )
            print(f"  Antwort: {response.json()}")
            
            time.sleep(2)  # Warten auf Bewegung
            
            # Status erneut abrufen
            response = requests.get(f"{API_BASE}/api/rotor/status", headers=HEADERS)
            if response.status_code == 200:
                status = response.json()
                if status.get("connected") and "status" in status:
                    pos = status["status"]
                    print(f"  Neue Position: Az={pos.get('azimuth')}°, El={pos.get('elevation')}°")
            
            print("\n=== Verbindung trennen ===")
            response = requests.post(f"{API_BASE}/api/rotor/disconnect", headers=HEADERS)
            print(f"  {response.json()}")
        else:
            print(f"  Fehler: {response.status_code} - {response.json()}")
    else:
        print(f"Fehler beim Abrufen der Ports: {response.status_code}")

if __name__ == "__main__":
    main()
```

---

### JavaScript/Node.js

#### Mit fetch (Browser oder Node.js 18+)

```javascript
const API_BASE = 'http://localhost:8081';

async function connect(port, baudRate = 9600, pollingIntervalMs = 1000) {
  const response = await fetch(`${API_BASE}/api/rotor/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ port, baudRate, pollingIntervalMs })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

async function sendRotorCommand(command) {
  const response = await fetch(`${API_BASE}/api/rotor/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ command })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

async function getStatus() {
  const response = await fetch(`${API_BASE}/api/rotor/status`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// Verwendung
(async () => {
  try {
    await connect('COM3');
    await sendRotorCommand('C2');
    const status = await getStatus();
    console.log('Status:', status);
  } catch (error) {
    console.error('Fehler:', error);
  }
})();
```

#### Mit axios (Node.js)

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:8081';

const api = axios.create({
  baseURL: API_BASE
});

async function connect(port, baudRate = 9600, pollingIntervalMs = 1000) {
  const response = await api.post('/api/rotor/connect', { port, baudRate, pollingIntervalMs });
  return response.data;
}

async function sendRotorCommand(command) {
  const response = await api.post('/api/rotor/command', { command });
  return response.data;
}

async function getStatus() {
  const response = await api.get('/api/rotor/status');
  return response.data;
}

// Verwendung
connect('COM3')
  .then(() => sendRotorCommand('M180'))
  .then(() => getStatus())
  .then(status => console.log('Status:', status))
  .catch(error => console.error('Fehler:', error));
```

---

### PowerShell

#### Kommando senden

```powershell
$apiBase = "http://localhost:8081"

$body = @{
    command = "C2"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
}

$response = Invoke-RestMethod -Uri "$apiBase/api/rotor/command" `
    -Method Post `
    -Headers $headers `
    -Body $body

Write-Host "Kommando gesendet"
```

#### Status abrufen

```powershell
$apiBase = "http://localhost:8081"

$response = Invoke-RestMethod -Uri "$apiBase/api/rotor/status" `
    -Method Get

Write-Host "Verbunden: $($response.connected)"
if ($response.status) {
    Write-Host "Azimut: $($response.status.azimuth)"
    Write-Host "Elevation: $($response.status.elevation)"
}
```

---

## GS-232B Befehlsreferenz

Die API akzeptiert alle GS-232B kompatiblen Befehle. Eine vollständige Liste finden Sie in `GS232B_Befehle.md`.

### Häufig verwendete Befehle

| Befehl | Beschreibung | Beispiel |
|--------|-------------|----------|
| `C2` | Azimut und Elevation abfragen | `{"command": "C2"}` |
| `M180` | Azimut auf 180° setzen | `{"command": "M180"}` |
| `W180 045` | Azimut 180°, Elevation 45° setzen | `{"command": "W180 045"}` |
| `R` | Azimut nach rechts drehen | `{"command": "R"}` |
| `L` | Azimut nach links drehen | `{"command": "L"}` |
| `U` | Elevation nach oben | `{"command": "U"}` |
| `D` | Elevation nach unten | `{"command": "D"}` |
| `A` | Azimut stoppen | `{"command": "A"}` |
| `E` | Elevation stoppen | `{"command": "E"}` |
| `S` | Alles stoppen | `{"command": "S"}` |
| `P36` | 360° Modus aktivieren | `{"command": "P36"}` |
| `P45` | 450° Modus aktivieren | `{"command": "P45"}` |

**Wichtig:** Die Befehle werden ohne `\r` (Carriage Return) gesendet. Der Server fügt dies automatisch hinzu, wenn der Befehl an den Rotor weitergegeben wird.

---

## Server-Konfiguration

### Server starten

**Standard:**
```bash
python python_server.py
```

**Mit benutzerdefiniertem Port:**
```bash
python python_server.py --port 9000
```


**Mit Batch-Datei (Windows):**
```batch
start_server.bat
```

### Abhängigkeiten

Für COM-Port-Funktionalität ist `pyserial` erforderlich:

```bash
pip install -r requirements.txt
```

oder

```bash
pip install pyserial
```

### Standardwerte

- **Port:** 8081
- **Host:** `0.0.0.0` (alle Interfaces)
- **Authentifizierung:** Keine (alle Endpunkte öffentlich)

### Netzwerk-Zugriff

Der Server läuft standardmäßig auf `0.0.0.0`, was bedeutet, dass er von anderen Rechnern im Netzwerk erreichbar ist. Um die Web-Anwendung von einem anderen Rechner aus zu nutzen:

1. Starte den Server auf dem Rechner, an dem der COM-Port angeschlossen ist
2. Öffne die Web-Anwendung von einem anderen Rechner: `http://<SERVER-IP>:8081`
3. Die Anwendung erkennt automatisch, dass Web Serial nicht verfügbar ist und verwendet den Server-Modus
4. Wähle einen COM-Port aus der Liste (markiert mit `[Server]`)
5. Die Steuerung erfolgt über die API-Endpunkte

---

## Best Practices

1. **Sicherheit:** Die API ist ohne Authentifizierung - verwenden Sie sie nur in vertrauenswürdigen Netzwerken
2. **Metadaten nutzen:** Verwenden Sie das `meta`-Feld, um zusätzliche Informationen zu speichern (z.B. Quelle, Benutzer, Priorität)
3. **Fehlerbehandlung:** Prüfen Sie immer den HTTP-Status-Code und behandeln Sie Fehler entsprechend
4. **Rate Limiting:** Vermeiden Sie zu viele Anfragen in kurzer Zeit (empfohlen: max. 10 Anfragen/Sekunde)
5. **Logging:** Das interne Log ist flüchtig - speichern Sie wichtige Kommandos extern, wenn nötig

---

## Version

**API-Version:** 0.1  
**Server-Version:** RotorHTTP/0.1  
**Letzte Aktualisierung:** 2025

---

## Support

Bei Fragen oder Problemen:
- Prüfen Sie die Server-Logs in der Konsole
- Stellen Sie sicher, dass der Server läuft (`http://localhost:8081`)
- Siehe auch: `GS232B_Befehle.md` für Rotor-Befehle
