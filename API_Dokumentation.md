# Rotor Interface GS232B - API Dokumentation

Diese Dokumentation beschreibt die REST-API des Rotor Interface GS232B Servers. Die API ermöglicht es, Rotor-Befehle zu senden und abzurufen, um die Anwendung in andere Programme zu integrieren.

## Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Authentifizierung](#authentifizierung)
- [Endpunkte](#endpunkte)
  - [POST /api/commands](#post-apicommands)
  - [GET /api/commands](#get-apicommands)
- [Fehlerbehandlung](#fehlerbehandlung)
- [Beispiele](#beispiele)
  - [cURL](#curl)
  - [Python](#python)
  - [JavaScript/Node.js](#javascriptnodejs)
  - [PowerShell](#powershell)
- [GS-232B Befehlsreferenz](#gs-232b-befehlsreferenz)

---

## Übersicht

**Base URL:** `http://localhost:8081` (Standard-Port, konfigurierbar)

**API Version:** 0.1

**Content-Type:** `application/json`

**CORS:** Unterstützt (Access-Control-Allow-Origin: *)

Die API verwendet JSON für alle Anfragen und Antworten. Alle Endpunkte erfordern eine Authentifizierung über einen API-Key.

---

## Authentifizierung

Alle API-Anfragen müssen mit einem gültigen API-Key authentifiziert werden. Der Standard-API-Key ist `rotor-secret-key` (konfigurierbar beim Serverstart).

### Authentifizierungsmethoden

Es gibt zwei Möglichkeiten, den API-Key zu übermitteln:

#### 1. HTTP Header (empfohlen)

```
X-API-Key: rotor-secret-key
```

#### 2. Query Parameter

```
?key=rotor-secret-key
```

### Beispiel mit Header

```http
POST /api/commands HTTP/1.1
Host: localhost:8081
Content-Type: application/json
X-API-Key: rotor-secret-key

{
  "command": "C2",
  "meta": {}
}
```

### Beispiel mit Query Parameter

```http
POST /api/commands?key=rotor-secret-key HTTP/1.1
Host: localhost:8081
Content-Type: application/json

{
  "command": "C2",
  "meta": {}
}
```

---

## Endpunkte

### POST /api/commands

Sendet einen Rotor-Befehl an den Server. Der Befehl wird im internen Log gespeichert.

#### Request

**URL:** `/api/commands`

**Method:** `POST`

**Headers:**
- `Content-Type: application/json` (erforderlich)
- `X-API-Key: <API_KEY>` (erforderlich, alternativ als Query-Parameter)

**Query Parameter (optional):**
- `key` - API-Key (Alternative zum Header)

**Body (JSON):**
```json
{
  "command": "string",  // Erforderlich: GS-232B Befehl (z.B. "C2", "M180", "R")
  "meta": {}            // Optional: Zusätzliche Metadaten als Objekt
}
```

**Body-Felder:**
- `command` (string, erforderlich): Der GS-232B Befehl ohne `\r` (wird automatisch hinzugefügt). Muss nicht leer sein.
- `meta` (object, optional): Beliebige Metadaten als JSON-Objekt. Standard: `{}`

#### Response

**Status Code:** `201 Created` (bei Erfolg)

**Body (JSON):**
```json
{
  "status": "ok",
  "entry": {
    "received_at": "2025-01-15T10:30:45.123456+00:00",
    "command": "C2",
    "meta": {}
  }
}
```

**Response-Felder:**
- `status` (string): Immer `"ok"` bei Erfolg
- `entry` (object): Das gespeicherte Kommando-Objekt
  - `received_at` (string): ISO 8601 Zeitstempel (UTC)
  - `command` (string): Der gesendete Befehl
  - `meta` (object): Die übermittelten Metadaten

#### Fehlerantworten

**400 Bad Request:**
```json
{
  "error": "command must be a non-empty string"
}
```
Tritt auf, wenn `command` fehlt, kein String ist oder leer ist.

**401 Unauthorized:**
```json
{
  "error": "unauthorized"
}
```
Tritt auf, wenn der API-Key fehlt oder ungültig ist.

**404 Not Found:**
```json
{
  "error": "not found"
}
```
Tritt auf, wenn der Endpunkt nicht existiert.

#### Beispiel-Requests

**Einfacher Befehl:**
```json
{
  "command": "C2"
}
```

**Befehl mit Metadaten:**
```json
{
  "command": "M180",
  "meta": {
    "source": "external_app",
    "user": "admin",
    "priority": "high"
  }
}
```

---

### GET /api/commands

Ruft alle bisher gesendeten Kommandos aus dem internen Log ab.

#### Request

**URL:** `/api/commands`

**Method:** `GET`

**Headers:**
- `X-API-Key: <API_KEY>` (erforderlich, alternativ als Query-Parameter)

**Query Parameter (optional):**
- `key` - API-Key (Alternative zum Header)

#### Response

**Status Code:** `200 OK`

**Body (JSON):**
```json
{
  "commands": [
    {
      "received_at": "2025-01-15T10:30:45.123456+00:00",
      "command": "C2",
      "meta": {}
    },
    {
      "received_at": "2025-01-15T10:30:50.789012+00:00",
      "command": "M180",
      "meta": {
        "source": "external_app"
      }
    }
  ]
}
```

**Response-Felder:**
- `commands` (array): Liste aller gespeicherten Kommandos, chronologisch sortiert (älteste zuerst)
  - Jedes Element hat die gleiche Struktur wie bei POST `/api/commands`

#### Fehlerantworten

**401 Unauthorized:**
```json
{
  "error": "unauthorized"
}
```
Tritt auf, wenn der API-Key fehlt oder ungültig ist.

**Hinweis:** Das Log wird im Speicher gehalten und geht beim Neustart des Servers verloren.

---

## Fehlerbehandlung

### HTTP Status Codes

| Code | Bedeutung | Beschreibung |
|------|-----------|--------------|
| 200 | OK | Anfrage erfolgreich (GET) |
| 201 | Created | Kommando erfolgreich gespeichert (POST) |
| 400 | Bad Request | Ungültige Anfrage (z.B. fehlendes oder leeres `command`) |
| 401 | Unauthorized | API-Key fehlt oder ist ungültig |
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

#### Kommando senden (mit Header)

```bash
curl -X POST http://localhost:8081/api/commands \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rotor-secret-key" \
  -d '{
    "command": "C2",
    "meta": {
      "source": "curl_script"
    }
  }'
```

#### Kommando senden (mit Query-Parameter)

```bash
curl -X POST "http://localhost:8081/api/commands?key=rotor-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "M180"
  }'
```

#### Alle Kommandos abrufen

```bash
curl -X GET http://localhost:8081/api/commands \
  -H "X-API-Key: rotor-secret-key"
```

#### Alle Kommandos abrufen (mit Query-Parameter)

```bash
curl -X GET "http://localhost:8081/api/commands?key=rotor-secret-key"
```

---

### Python

#### Einfaches Beispiel

```python
import requests

API_BASE = "http://localhost:8081"
API_KEY = "rotor-secret-key"

# Kommando senden
response = requests.post(
    f"{API_BASE}/api/commands",
    json={
        "command": "C2",
        "meta": {"source": "python_script"}
    },
    headers={"X-API-Key": API_KEY}
)

if response.status_code == 201:
    data = response.json()
    print(f"Kommando gesendet: {data['entry']['command']}")
    print(f"Zeitstempel: {data['entry']['received_at']}")
else:
    print(f"Fehler: {response.status_code} - {response.json()}")

# Alle Kommandos abrufen
response = requests.get(
    f"{API_BASE}/api/commands",
    headers={"X-API-Key": API_KEY}
)

if response.status_code == 200:
    data = response.json()
    print(f"\nGespeicherte Kommandos: {len(data['commands'])}")
    for cmd in data['commands']:
        print(f"  - {cmd['command']} ({cmd['received_at']})")
```

#### Klasse für einfache Nutzung

```python
import requests
from typing import Dict, List, Optional

class RotorAPI:
    def __init__(self, base_url: str = "http://localhost:8081", api_key: str = "rotor-secret-key"):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.headers = {"X-API-Key": api_key}
    
    def send_command(self, command: str, meta: Optional[Dict] = None) -> Dict:
        """Sendet einen Rotor-Befehl."""
        payload = {
            "command": command,
            "meta": meta or {}
        }
        response = requests.post(
            f"{self.base_url}/api/commands",
            json=payload,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()
    
    def get_commands(self) -> List[Dict]:
        """Ruft alle gespeicherten Kommandos ab."""
        response = requests.get(
            f"{self.base_url}/api/commands",
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()["commands"]
    
    def get_last_command(self) -> Optional[Dict]:
        """Ruft das letzte gesendete Kommando ab."""
        commands = self.get_commands()
        return commands[-1] if commands else None

# Verwendung
api = RotorAPI()

# Status abfragen
api.send_command("C2")

# Azimut auf 180° setzen
api.send_command("M180", meta={"source": "tracking_script"})

# Alle Kommandos anzeigen
for cmd in api.get_commands():
    print(f"{cmd['received_at']}: {cmd['command']}")
```

---

### JavaScript/Node.js

#### Mit fetch (Browser oder Node.js 18+)

```javascript
const API_BASE = 'http://localhost:8081';
const API_KEY = 'rotor-secret-key';

// Kommando senden
async function sendCommand(command, meta = {}) {
  const response = await fetch(`${API_BASE}/api/commands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify({
      command: command,
      meta: meta
    })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return await response.json();
}

// Alle Kommandos abrufen
async function getCommands() {
  const response = await fetch(`${API_BASE}/api/commands`, {
    headers: {
      'X-API-Key': API_KEY
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  const data = await response.json();
  return data.commands;
}

// Verwendung
(async () => {
  try {
    // Status abfragen
    const result = await sendCommand('C2', { source: 'nodejs_script' });
    console.log('Kommando gesendet:', result.entry);
    
    // Alle Kommandos abrufen
    const commands = await getCommands();
    console.log(`Gespeicherte Kommandos: ${commands.length}`);
  } catch (error) {
    console.error('Fehler:', error);
  }
})();
```

#### Mit axios (Node.js)

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:8081';
const API_KEY = 'rotor-secret-key';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'X-API-Key': API_KEY
  }
});

// Kommando senden
async function sendCommand(command, meta = {}) {
  const response = await api.post('/api/commands', {
    command: command,
    meta: meta
  });
  return response.data;
}

// Alle Kommandos abrufen
async function getCommands() {
  const response = await api.get('/api/commands');
  return response.data.commands;
}

// Verwendung
sendCommand('M180', { source: 'axios_example' })
  .then(result => console.log('Erfolg:', result))
  .catch(error => console.error('Fehler:', error));
```

---

### PowerShell

#### Kommando senden

```powershell
$apiBase = "http://localhost:8081"
$apiKey = "rotor-secret-key"

$body = @{
    command = "C2"
    meta = @{
        source = "powershell_script"
    }
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $apiKey
}

$response = Invoke-RestMethod -Uri "$apiBase/api/commands" `
    -Method Post `
    -Headers $headers `
    -Body $body

Write-Host "Kommando gesendet: $($response.entry.command)"
Write-Host "Zeitstempel: $($response.entry.received_at)"
```

#### Alle Kommandos abrufen

```powershell
$apiBase = "http://localhost:8081"
$apiKey = "rotor-secret-key"

$headers = @{
    "X-API-Key" = $apiKey
}

$response = Invoke-RestMethod -Uri "$apiBase/api/commands" `
    -Method Get `
    -Headers $headers

Write-Host "Gespeicherte Kommandos: $($response.commands.Count)"
$response.commands | ForEach-Object {
    Write-Host "  - $($_.command) ($($_.received_at))"
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

**Mit benutzerdefiniertem API-Key:**
```bash
python python_server.py --key mein-geheimer-schlüssel
```

**Beide Optionen:**
```bash
python python_server.py --port 9000 --key mein-geheimer-schlüssel
```

**Mit Batch-Datei (Windows):**
```batch
start_server.bat
```

### Standardwerte

- **Port:** 8081
- **API-Key:** `rotor-secret-key`
- **Host:** `0.0.0.0` (alle Interfaces)

---

## Best Practices

1. **API-Key sicher aufbewahren:** Verwenden Sie einen starken API-Key in Produktionsumgebungen
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
- Überprüfen Sie den API-Key
- Siehe auch: `GS232B_Befehle.md` für Rotor-Befehle

