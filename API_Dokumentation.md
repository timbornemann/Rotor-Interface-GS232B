# Rotor Interface GS232B - API Dokumentation

Diese Datei beschreibt den aktuellen REST- und WebSocket-API-Stand der Anwendung.

Stand: 2026-06-08
API-Version: v2.0.0
HTTP-Server Header: RotorHTTP/2.0

## 1. Uebersicht

- REST Base URL: `http://<host>:<http-port>` (Standard lokal: `http://localhost:8081`)
- WebSocket URL: `ws://<host>:<websocket-port>` (Standard lokal: `ws://localhost:8082`)
- Content-Type bei JSON-Requests: `application/json`
- JSON-Responses enthalten CORS Header `Access-Control-Allow-Origin: *`
- Session-Header (falls genutzt): `X-Session-ID: <session-id>`

Wichtige Quellen fuer den API-Stand:

1. Laufende OpenAPI Spec: `GET /api/openapi.json`
2. Swagger UI: `GET /api/docs`
3. ReDoc UI: `GET /api/redoc`
4. Server-Handler Code in `server/api/handler.py` und `server/api/routes.py`
5. WebSocket-Code in `server/api/websocket.py`

## 2. Vollstaendige Endpunkt-Matrix

### 2.1 Session

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/session` | Session holen oder erzeugen |

### 2.2 Rotor

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/rotor/ports` | Verfuegbare serielle Ports |
| POST | `/api/rotor/connect` | Mit COM-Port verbinden |
| POST | `/api/rotor/disconnect` | Verbindung trennen |
| GET | `/api/rotor/status` | Rotorstatus (RAW, correctedRaw, calibrated) |
| GET | `/api/rotor/position` | Erweiterter Status inkl. `cone` |
| POST | `/api/rotor/command` | Direkten GS-232B Befehl senden |
| POST | `/api/rotor/manual` | Manuelle Bewegung starten |
| POST | `/api/rotor/stop` | Bewegung stoppen |
| POST | `/api/rotor/set_target` | Zielposition in kalibrierten Werten setzen |
| POST | `/api/rotor/set_target_raw` | Zielposition in RAW-Werten setzen |
| POST | `/api/rotor/home` | Home-Preset anfahren |
| POST | `/api/rotor/park` | Park-Preset anfahren |

### 2.3 Einstellungen

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/settings` | Gesamte Konfiguration laden |
| POST | `/api/settings` | Konfiguration teilweise aktualisieren |

### 2.4 Server

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/server/settings` | Aktive Serverparameter abrufen |
| POST | `/api/server/settings` | Serverparameter validieren/speichern |
| POST | `/api/server/restart` | Geordneten Neustart anfordern |

### 2.5 Clients

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/clients` | Alle Sessions listen |
| POST | `/api/clients/{id}/suspend` | Session sperren |
| POST | `/api/clients/{id}/resume` | Session entsperren |

### 2.6 Routen

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/routes` | Alle Routen laden |
| POST | `/api/routes` | Route anlegen |
| PUT | `/api/routes/{id}` | Route aktualisieren |
| DELETE | `/api/routes/{id}` | Route loeschen |
| POST | `/api/routes/{id}/start` | Route starten |
| POST | `/api/routes/stop` | Aktive Routenausfuehrung stoppen |
| POST | `/api/routes/continue` | Manuellen Wait-Schritt fortsetzen |
| GET | `/api/routes/execution` | Aktuellen Ausfuehrungsstatus lesen |

### 2.7 API-Dokumentation

| Methode | Endpoint | Beschreibung |
|---|---|---|
| GET | `/api/openapi.json` | OpenAPI 3.1 Spezifikation |
| GET | `/api/docs` | Swagger UI (Try it out) |
| GET | `/api/redoc` | ReDoc Ansicht |
| GET | `/api/docs/assets/{asset}` | Lokale Swagger/ReDoc Assets |

Verfuegbare Assets: `swagger-ui.css`, `swagger-ui-bundle.js`, `redoc.standalone.js`

## 3. Session, Zugriff, Security

### 3.1 Session-Grundlagen

- Session-ID wird ueber `GET /api/session` erzeugt oder geladen.
- Session kann per Header `X-Session-ID` oder per Cookie `session_id` uebermittelt werden.
- Session-Status ist `active` oder `suspended`.
- Bei WebSocket-Disconnect wird die zugehoerige Session entfernt (sofern registriert).
- Periodischer Session-Cleanup laeuft im Hintergrund (Intervall 60 s, Timeout konfigurierbar).

### GET /api/session

Beschreibung: Liefert vorhandene Session oder erstellt eine neue Session.

Response `200`:

```json
{
  "sessionId": "3b9f1c2a-...",
  "status": "active"
}
```

Fehler:

- `500`: Maximalanzahl aktiver Clients erreicht (`serverMaxClients`)

```json
{
  "error": "Could not create session"
}
```

Hinweis: Der Server setzt bei neuer Session kein Cookie automatisch in der Response. Clients muessen die `sessionId` selbst speichern und als Header oder Cookie mitsenden. Cookie-Format bei manuellem Setzen: `session_id=<id>; Path=/; HttpOnly; SameSite=Lax`.

### 3.2 `serverRequireSession`

Wenn `serverRequireSession=true` gesetzt ist:

- API-Requests ohne gueltige Session erhalten `401`.
- Gesperrte Sessions erhalten `403`.

Wenn `serverRequireSession=false`:

- Session ist optional.
- Gesperrte Sessions bleiben weiterhin blockiert (`403`).

Response `401` (fehlende/ungueltige Session):

```json
{
  "error": "Session required",
  "message": "Missing or invalid session ID."
}
```

Response `403` (suspendierte Session):

```json
{
  "error": "Session suspended",
  "message": "Your session has been suspended. Please reload the page to reconnect."
}
```

### 3.3 Oeffentliche API-Endpunkte (ohne Session-Pruefung)

- `GET /api/session`
- `GET /api/openapi.json`
- `GET /api/docs` und `GET /api/docs/`
- `GET /api/redoc` und `GET /api/redoc/`
- `GET /api/docs/assets/*`

### 3.4 CORS-Hinweis

- Preflight (`OPTIONS`) liefert aktuell `Access-Control-Allow-Methods: GET, POST, OPTIONS`.
- Erlaubte Header: `Content-Type`, `X-Session-ID`.
- Browser-Cross-Origin fuer `PUT`/`DELETE` kann dadurch blockiert sein.

## 4. API-Doku Endpunkte

### GET /api/openapi.json

Liefert die aktuelle OpenAPI 3.1 Spezifikation als JSON.

### GET /api/docs

Liefert lokale Swagger UI (ohne externes CDN).

### GET /api/redoc

Liefert lokale ReDoc Seite.

### GET /api/docs/assets/{asset}

Liefert lokale Swagger-/ReDoc-Assets mit Cache-Control (`max-age=86400`).

Fehler:

- `404`: `{"error": "Asset not found"}` oder `{"error": "Asset unavailable"}`

## 5. Rotor API im Detail

### Positionswerte in Status/Position

Die Felder `rph`, `correctedRaw` und `calibrated` werden serverseitig aus Hardware-Feedback und Konfiguration berechnet:

- `rph`: Rohwerte vom Controller (`azimuthRaw`/`elevationRaw`)
- `correctedRaw`: `rph` optional mit Feedback-Faktoren (`feedbackCorrectionEnabled`, `azimuthFeedbackFactor`, `elevationFeedbackFactor`)
- `calibrated`: `(correctedRaw + offset) / scaleFactor` (Offset/Scale aus Settings)

### GET /api/rotor/ports

Beschreibung: Serielle Ports auflisten.

Response `200`:

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

Hinweis: Ohne installiertes `pyserial` ist die Liste leer.

### POST /api/rotor/connect

Beschreibung: Verbindung zum seriellen Port aufbauen.

Request Body:

```json
{
  "port": "COM3",
  "baudRate": 9600
}
```

Validierung:

- `port` muss non-empty string sein.
- `baudRate` muss positive Integer sein (Default: `9600`).

Response `200`:

```json
{
  "status": "ok"
}
```

Alternative `200` bei bereits verbundenem gleichen Port:

```json
{
  "status": "ok",
  "message": "Already connected"
}
```

Typische Fehler:

- `400`: `{"error": "Already connected to another port"}`
- `400`: `{"error": "port must be a non-empty string"}`
- `400`: `{"error": "baudRate must be an integer"}` oder `{"error": "baudRate must be a positive integer"}`
- `500`: Verbindungsfehler (Exception-Text in `error`)

Side-Effect: Bei erfolgreichem Connect wird `connection_state_changed` per WebSocket broadcastet (`reason: "manual_connect"`).

### POST /api/rotor/disconnect

Beschreibung: Aktive Verbindung trennen.

Side-Effect vor dem Trennen:

- Wenn `autoParkOnDisconnect=true` und `parkPositionsEnabled=true`, wird zuerst das Park-Preset angefahren.

Response `200` (verbunden):

```json
{
  "status": "ok",
  "message": "Disconnected"
}
```

Response `200` (nicht verbunden):

```json
{
  "status": "ok",
  "message": "Not connected"
}
```

Side-Effect: WebSocket-Broadcast `connection_state_changed` mit `reason: "manual_disconnect"`.

### GET /api/rotor/status

Beschreibung: Aktueller Verbindungs- und Positionsstatus.

Response `200` (verbunden):

```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "status": {
    "rawLine": "AZ=123 EL=045",
    "timestamp": 1705320000000,
    "rph": {
      "azimuth": 123,
      "elevation": 45
    },
    "correctedRaw": {
      "azimuth": 123.0,
      "elevation": 45.0
    },
    "calibrated": {
      "azimuth": 127.0,
      "elevation": 46.5
    }
  },
  "clientCount": 2
}
```

Response `200` (nicht verbunden):

```json
{
  "connected": false,
  "clientCount": 0
}
```

### GET /api/rotor/position

Beschreibung: Status plus Cone-Parameter und Kalibrierungsblock.

Optionale Query-Parameter:

- `coneAngle` (default: `10`)
- `coneLength` (default: `1000`)

Response `200` (verbunden):

```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 9600,
  "position": {
    "rawLine": "AZ=180 EL=045",
    "timestamp": 1705320000000,
    "rph": {
      "azimuth": 180,
      "elevation": 45
    },
    "correctedRaw": {
      "azimuth": 180.0,
      "elevation": 45.0
    },
    "calibrated": {
      "azimuth": 184.0,
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
  },
  "clientCount": 1
}
```

Hinweis: `cone.angle`/`cone.length` kommen aus den Query-Parametern, nicht aus den persistierten Settings.

### POST /api/rotor/command

Beschreibung: Direkten GS-232B Befehl senden.

Hinweis: Bewegungsbefehle werden bei aktiven Soft-Limits vor dem Senden begrenzt. Das gilt fuer Positionsbefehle (`M...`, `W...`) und kontinuierliche Richtungsbefehle (`L`, `R`, `U`, `D`).

Request Body:

```json
{
  "command": "C2"
}
```

Response `200`:

```json
{
  "status": "ok"
}
```

Typische Fehler:

- `400`: `{"error": "command must be a non-empty string"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)
- `500`: `{"error": "Failed to send command", "message": "..."}`

### POST /api/rotor/manual

Beschreibung: Dauerbewegung starten.

Request Body:

```json
{
  "direction": "right"
}
```

Gueltige Werte:

- `left`, `right`, `up`, `down`
- `L`, `R`, `U`, `D`

Response `200`:

```json
{
  "status": "ok"
}
```

Typische Fehler:

- `400`: `{"error": "direction must be one of: left, right, up, down, L, R, U, D"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

### POST /api/rotor/stop

Beschreibung: Bewegung stoppen.

Voraussetzung: Rotor muss verbunden sein.

Response `200`:

```json
{
  "status": "ok"
}
```

Typische Fehler:

- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)
- `500`: `{"error": "Failed to stop motion", "message": "..."}`

### POST /api/rotor/set_target

Beschreibung: Zielposition in kalibrierten Werten setzen. Aktive Soft-Limits werden serverseitig angewendet.

Request Body (`az` oder `el` oder beide):

```json
{
  "az": 180.5,
  "el": 45.0
}
```

Response `200`:

```json
{
  "status": "ok",
  "appliedTarget": {
    "azimuth": 180.5,
    "elevation": 45.0
  }
}
```

Typische Fehler:

- `400`: `{"error": "At least one of 'az' or 'el' must be provided as a numeric value"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)
- `500`: `{"error": "Failed to set target", "message": "..."}`

### POST /api/rotor/set_target_raw

Beschreibung: Zielposition mit RAW-Werten setzen. Aktive Soft-Limits werden serverseitig auf die entsprechende RAW-Position angewendet.

Request Body (`az` oder `el` oder beide):

```json
{
  "az": 180,
  "el": 45
}
```

Regel: Mindestens eines der Felder muss numerisch gesetzt sein.

Response `200`:

```json
{
  "status": "ok",
  "appliedTarget": {
    "azimuth": 180,
    "elevation": 45
  }
}
```

Typische Fehler:

- `400`: `{"error": "At least one of 'az' or 'el' must be provided as a numeric value"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

### POST /api/rotor/home

Beschreibung: Home-Preset anfahren.

Voraussetzungen:

- Rotor verbunden
- `parkPositionsEnabled=true`

Response `200`:

```json
{
  "status": "ok"
}
```

Typische Fehler:

- `400`: `{"error": "Preset positions disabled"}`
- `400`: `{"error": "Failed to move to home preset"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

### POST /api/rotor/park

Beschreibung: Park-Preset anfahren.

Voraussetzungen und Fehler analog zu `/api/rotor/home`.

Typische Fehler zusaetzlich:

- `400`: `{"error": "Failed to move to park preset"}`

## 6. Einstellungen API

### GET /api/settings

Beschreibung: Gesamte persistierte Konfiguration (`web-settings.json`) laden.

Response `200`:

```json
{
  "baudRate": 9600,
  "pollingIntervalMs": 1000,
  "azimuthMode": 450,
  "azimuthOffset": 0,
  "elevationOffset": 0,
  "feedbackCorrectionEnabled": false,
  "serverHttpPort": 8081,
  "serverWebSocketPort": 8082,
  "serverRequireSession": false
}
```

Hinweis: Das Objekt enthaelt alle Felder aus `server/config/defaults.py` (Map, Ramp, Limits, Presets, Server etc.).

### POST /api/settings

Beschreibung: Teil-Update der Konfiguration.

Request Body: beliebiges JSON-Objekt mit zu aktualisierenden Feldern.

Beispiel:

```json
{
  "azimuthOffset": 4.0,
  "elevationOffset": 1.5,
  "feedbackCorrectionEnabled": true,
  "azimuthFeedbackFactor": 1.02
}
```

Response `200`:

```json
{
  "status": "ok",
  "settings": {
    "baudRate": 9600,
    "pollingIntervalMs": 1000,
    "azimuthOffset": 4.0,
    "elevationOffset": 1.5,
    "feedbackCorrectionEnabled": true,
    "azimuthFeedbackFactor": 1.02
  }
}
```

Hinweis: `settings` enthaelt die **gesamte** aktuelle Konfiguration nach dem Update, nicht nur die geaenderten Felder. Das Beispiel oben ist gekuerzt.

Side-Effect: WebSocket-Broadcast `settings_updated` mit vollstaendigem Settings-Objekt.

## 7. Server API

### GET /api/server/settings

Beschreibung: Aktive (laufende) Serverparameter.

Response `200`:

```json
{
  "httpPort": 8081,
  "webSocketPort": 8082,
  "pollingIntervalMs": 500,
  "sessionTimeoutS": 300,
  "maxClients": 10,
  "loggingLevel": "INFO",
  "requireSession": false
}
```

Hinweis: `pollingIntervalMs` reflektiert den aktuell aktiven Polling-Intervall der Rotor-Verbindung.

### POST /api/server/settings

Beschreibung: Validiert und speichert Serverparameter.

Request Body Felder:

- `serverHttpPort` (1024..65535)
- `serverWebSocketPort` (1024..65535)
- `serverPollingIntervalMs` (250..2000)
- `serverSessionTimeoutS` (60..3600)
- `serverMaxClients` (1..100)
- `serverLoggingLevel` (`DEBUG`, `INFO`, `WARNING`, `ERROR`)
- `serverRequireSession` (`true`/`false`, muss Boolean sein)

Zusaetzliche Validierung:

- HTTP- und WebSocket-Port duerfen nicht identisch sein.

Beispiel:

```json
{
  "serverPollingIntervalMs": 250,
  "serverSessionTimeoutS": 600,
  "serverLoggingLevel": "DEBUG",
  "serverRequireSession": true
}
```

Response `200` (mit Port-Aenderung):

```json
{
  "status": "ok",
  "message": "Server settings saved. Restart required for port changes to take effect.",
  "restartRequired": true
}
```

Response `200` (ohne Port-Aenderung):

```json
{
  "status": "ok",
  "message": "Server settings saved.",
  "restartRequired": false
}
```

Hinweis: `serverPollingIntervalMs`, `serverSessionTimeoutS`, `serverMaxClients` und `serverLoggingLevel` werden sofort angewendet. Port-Aenderungen erfordern Neustart.

Validierungsfehler `400`:

```json
{
  "error": "Validation failed",
  "details": [
    "HTTP port must be between 1024 and 65535"
  ]
}
```

Moegliche `details`-Eintraege:

- `"HTTP port must be between 1024 and 65535"`
- `"WebSocket port must be between 1024 and 65535"`
- `"HTTP and WebSocket ports must be different"`
- `"Polling interval must be between 250 and 2000 ms"`
- `"Session timeout must be between 60 and 3600 seconds"`
- `"Max clients must be between 1 and 100"`
- `"Logging level must be one of: DEBUG, INFO, WARNING, ERROR"`
- `"serverRequireSession must be a boolean"`

Side-Effect: WebSocket-Broadcast `settings_updated`.

### POST /api/server/restart

Beschreibung: Geordneten Neustart anfordern.

Response `200`:

```json
{
  "status": "restarting",
  "message": "Server is restarting..."
}
```

## 8. Clients API

### GET /api/clients

Beschreibung: Alle bekannten Sessions listen.

Response `200`:

```json
{
  "clients": [
    {
      "id": "3b9f1c2a-...",
      "ip": "192.168.1.20",
      "userAgent": "Chrome/136",
      "connectedAt": "2026-06-08T14:30:12.123456",
      "lastSeen": "2026-06-08T14:35:08.654321",
      "status": "active"
    }
  ]
}
```

### POST /api/clients/{id}/suspend

Beschreibung: Session sperren.

Response `200`:

```json
{
  "status": "ok",
  "message": "Client 3b9f1c2a... suspended"
}
```

Fehler:

- `404`: `{"error": "Client not found"}`
- `500`: `{"error": "Session manager not available"}`

Side-Effect: WebSocket `client_suspended` an den betroffenen Client.

### POST /api/clients/{id}/resume

Beschreibung: Session entsperren.

Response `200`:

```json
{
  "status": "ok",
  "message": "Client 3b9f1c2a... resumed"
}
```

Fehler:

- `404`: `{"error": "Client not found"}`
- `500`: `{"error": "Session manager not available"}`

## 9. Routen API

### 9.1 Routenobjekt

Eine Route ist ein JSON-Objekt, typischerweise:

```json
{
  "id": "route_1776423995375_ak3ijtces",
  "name": "Turn 180",
  "description": "",
  "order": 0,
  "steps": [
    {
      "id": "step_1",
      "type": "position",
      "name": "Position",
      "azimuth": 180,
      "elevation": 0
    },
    {
      "id": "step_2",
      "type": "wait",
      "duration": 5000,
      "message": ""
    },
    {
      "id": "step_3",
      "type": "loop",
      "iterations": 2,
      "steps": []
    }
  ]
}
```

### 9.2 Schritt-Typen

- `position`: sendet RAW-Ziel via `set_target_raw(azimuth, elevation)` und wartet auf Ankunft
- `wait`:
  - `duration` in ms (>0) = zeitbasiert
  - `duration` `0` oder `null` = manueller Wait (Fortsetzung via `POST /api/routes/continue`)
- `loop`:
  - `iterations` > 0 = feste Wiederholungen
  - `iterations` `0`, `null` = Endlosschleife (mit Sicherheitslimit 100000 Iterationen)

### GET /api/routes

Response `200`:

```json
{
  "routes": []
}
```

Fehler:

- `500`: `{"error": "Route manager not initialized"}`

### POST /api/routes

Beschreibung: Neue Route anlegen.

Wichtig:

- `id` ist Pflicht.
- `id` muss eindeutig sein.

Response `200`:

```json
{
  "status": "ok",
  "route": {
    "id": "route_1",
    "name": "Demo",
    "steps": []
  }
}
```

Fehler:

- `400`: `{"error": "Route must have an 'id' field"}`
- `400`: `{"error": "Route with ID 'route_1' already exists"}`

Side-Effect: WebSocket-Broadcast `route_list_updated`.

### PUT /api/routes/{id}

Beschreibung: Bestehende Route aktualisieren.

Wichtig:

- Pfad-`id` gewinnt; Body-`id` wird auf Pfadwert gesetzt.

Response `200`:

```json
{
  "status": "ok",
  "route": {
    "id": "route_1",
    "name": "Demo aktualisiert",
    "steps": []
  }
}
```

Fehler:

- `404`: `{"error": "Route not found"}`

Side-Effect: WebSocket-Broadcast `route_list_updated`.

### DELETE /api/routes/{id}

Response `200`:

```json
{
  "status": "ok"
}
```

Fehler:

- `404`: `{"error": "Route not found"}`

Side-Effect: WebSocket-Broadcast `route_list_updated`.

### POST /api/routes/{id}/start

Beschreibung: Routenausfuehrung starten.

Voraussetzungen:

- Rotor verbunden
- keine andere Route aktiv
- Route existiert

Response `200`:

```json
{
  "status": "ok"
}
```

Fehler:

- `400`: `{"error": "Failed to start route (already executing or not found)"}`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

Side-Effect: WebSocket-Broadcast `route_execution_started`.

### POST /api/routes/stop

Beschreibung: Aktive Route stoppen.

Response `200`:

```json
{
  "status": "ok"
}
```

Side-Effect: WebSocket-Broadcast `route_execution_stopped`.

### POST /api/routes/continue

Beschreibung: Manuellen Wait-Schritt fortsetzen.

Response `200`:

```json
{
  "status": "ok"
}
```

Fehler:

- `400`: `{"error": "No manual wait is active"}`

### GET /api/routes/execution

Beschreibung: Aktueller Laufzustand.

Response `200` (Route laeuft):

```json
{
  "executing": true,
  "routeId": "route_1",
  "routeName": "Demo",
  "currentStepIndex": 1,
  "totalSteps": 5
}
```

Response `200` (idle):

```json
{
  "executing": false,
  "routeId": null,
  "routeName": null,
  "currentStepIndex": 0,
  "totalSteps": 0
}
```

### 9.3 Laufzeitregeln der Ausfuehrung

- Positionstoleranz: `2.0` Grad
- Timeout pro Positionsschritt: `60` Sekunden (danach wird der Schritt mit Warning fortgesetzt, Route bricht nicht ab)
- Positionscheck-Intervall: `0.2` Sekunden
- Endlosschleifen-Sicherheitsgrenze: `100000` Iterationen
- Ankunftserkennung vergleicht RAW-Zielwerte mit **korrigierten Raw-Feedback-Werten** (`get_effective_raw_status`), nicht mit kalibrierten Werten

Fortschritt waehrend der Ausfuehrung wird per WebSocket als `route_execution_progress` gesendet (siehe Abschnitt 10).

## 10. WebSocket-Schnittstelle

### 10.1 Verbindung

- Standard: `ws://<host>:8082`
- Port konfigurierbar ueber `serverWebSocketPort`
- Separater Server-Thread (unabhaengig vom HTTP-Port)
- Keine Session-Pflicht beim Connect; Session-Registrierung empfohlen

### 10.2 Nachrichtenformat

Alle Nachrichten sind JSON-Objekte mit:

```json
{
  "type": "<event-type>",
  "data": { }
}
```

### 10.3 Client → Server

Session registrieren (nach `GET /api/session`):

```json
{
  "type": "register_session",
  "sessionId": "3b9f1c2a-..."
}
```

Keepalive:

```json
{ "type": "ping" }
```

Antwort:

```json
{ "type": "pong" }
```

### 10.4 Server → Client (Lifecycle-Events)

| Event | Beschreibung |
|---|---|
| `connection_state_changed` | Rotor-Verbindungsstatus geaendert |
| `client_list_updated` | Session-Liste aktualisiert |
| `client_suspended` | Eigene Session wurde gesperrt |
| `settings_updated` | Konfiguration geaendert |
| `route_list_updated` | Routenliste geaendert |
| `route_execution_started` | Routenausfuehrung gestartet |
| `route_execution_progress` | Fortschritt waehrend Ausfuehrung |
| `route_execution_stopped` | Route manuell gestoppt |
| `route_execution_completed` | Route beendet (Erfolg/Fehler) |

Beispiel `connection_state_changed`:

```json
{
  "type": "connection_state_changed",
  "data": {
    "connected": true,
    "port": "COM3",
    "baudRate": 9600,
    "reason": "manual_connect"
  }
}
```

Moegliche `reason`-Werte: `manual_connect`, `manual_disconnect`, `auto_reconnect_success`, `unexpected_disconnect`.

Beispiel `client_list_updated`:

```json
{
  "type": "client_list_updated",
  "data": {
    "clients": []
  }
}
```

Beispiel `settings_updated`:

```json
{
  "type": "settings_updated",
  "data": {
    "baudRate": 9600
  }
}
```

(`data` enthaelt das vollstaendige Settings-Objekt.)

Beispiel `route_execution_started`:

```json
{
  "type": "route_execution_started",
  "data": {
    "routeId": "route_1",
    "routeName": "Demo"
  }
}
```

Beispiel `route_execution_completed`:

```json
{
  "type": "route_execution_completed",
  "data": {
    "success": true,
    "routeId": "route_1",
    "error": null
  }
}
```

Beispiel `client_suspended`:

```json
{
  "type": "client_suspended",
  "data": {
    "clientId": "3b9f1c2a-...",
    "message": "Your session has been suspended"
  }
}
```

### 10.5 Server → Client (`route_execution_progress`)

Das `data`-Objekt enthaelt ein inneres `type`-Feld:

| Inneres `data.type` | Bedeutung |
|---|---|
| `step_started` | Schritt beginnt (`stepType`, `step`, `stepIndex`) |
| `step_completed` | Schritt abgeschlossen |
| `position_moving` | Positionsschritt gestartet (`target`) |
| `position_reached` | Position erreicht |
| `wait_manual` | Manueller Wait aktiv (`message`) |
| `wait_progress` | Zeitbasierter Wait (`elapsed`, `remaining`, `total` in ms) |
| `loop_iteration` | Loop-Iteration (`iteration`, `total`) |

Beispiel:

```json
{
  "type": "route_execution_progress",
  "data": {
    "type": "position_moving",
    "step": { "id": "step_1", "type": "position", "azimuth": 180, "elevation": 0 },
    "target": { "azimuth": 180, "elevation": 0 }
  }
}
```

## 11. Einheitliches Fehlerverhalten

### 11.1 Typische Statuscodes

- `200` OK
- `400` Bad Request
- `401` Unauthorized (bei aktivem `serverRequireSession` und fehlender/ungueltiger Session)
- `403` Forbidden (suspendierte Session)
- `404` Not Found
- `500` Internal Server Error

### 11.2 Standard-Fehlerobjekt

```json
{
  "error": "Fehlermeldung",
  "message": "Optionale Detailinfo"
}
```

Ungueltiger JSON-Body:

```json
{
  "error": "Invalid JSON",
  "message": "Request body contains invalid JSON."
}
```

Weitere Varianten: `"JSON request body must be an object."`, `"Request body is not valid UTF-8 JSON."`

Nicht gefundene REST-Routen (POST/PUT/DELETE):

```json
{
  "error": "Not Found"
}
```

Interner Serverfehler (POST/PUT/DELETE Handler):

```json
{
  "error": "Internal server error",
  "message": "..."
}
```

### 11.3 Rotor-Disconnected Spezialfall

Mehrere Rotor-Steuerendpunkte liefern bei fehlender Verbindung:

```json
{
  "error": "Not connected to rotor",
  "code": "ROTOR_DISCONNECTED"
}
```

Betroffene Endpunkte: `/api/rotor/command`, `/api/rotor/manual`, `/api/rotor/stop`, `/api/rotor/set_target`, `/api/rotor/set_target_raw`, `/api/rotor/home`, `/api/rotor/park`, `/api/routes/{id}/start`.

## 12. Kurze cURL Beispiele

Session holen:

```bash
curl -s http://localhost:8081/api/session
```

Ports listen:

```bash
curl -s http://localhost:8081/api/rotor/ports
```

Verbinden:

```bash
curl -X POST http://localhost:8081/api/rotor/connect \
  -H "Content-Type: application/json" \
  -d '{"port":"COM3","baudRate":9600}'
```

Kalibriertes Ziel setzen:

```bash
curl -X POST http://localhost:8081/api/rotor/set_target \
  -H "Content-Type: application/json" \
  -d '{"az":180,"el":45}'
```

Route starten:

```bash
curl -X POST http://localhost:8081/api/routes/route_1/start
```

OpenAPI abrufen:

```bash
curl -s http://localhost:8081/api/openapi.json
```

## 13. Hinweise zur Pflege

- Bei API-Aenderungen immer zuerst `server/api/routes.py`, `server/api/handler.py`, `server/api/openapi.py` und `server/api/websocket.py` pruefen.
- Diese Datei soll mit `GET /api/openapi.json` konsistent bleiben (REST-Teil).
- Die Detailbeispiele hier sind exemplarisch; zusaetzliche Felder in `settings` oder Route-Schritten sind moeglich.
- WebSocket-Events sind absichtlich nur in dieser Markdown-Doku detailliert, nicht in der OpenAPI-Spec.
