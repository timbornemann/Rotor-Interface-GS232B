# Rotor Interface GS232B - API Dokumentation

Diese Datei beschreibt den aktuellen REST-API-Stand der Anwendung.

Stand: 2026-04-17
API-Version: v2.0.0
HTTP-Server Header: RotorHTTP/2.0

## 1. Uebersicht

- Base URL: `http://<host>:<http-port>` (Standard lokal: `http://localhost:8081`)
- Content-Type bei JSON-Requests: `application/json`
- JSON-Responses enthalten CORS Header `Access-Control-Allow-Origin: *`
- Session-Header (falls genutzt): `X-Session-ID: <session-id>`

Wichtige Quellen fuer den API-Stand:

1. Laufende OpenAPI Spec: `GET /api/openapi.json`
2. Swagger UI: `GET /api/docs`
3. ReDoc UI: `GET /api/redoc`
4. Server-Handler Code in `server/api/handler.py` und `server/api/routes.py`

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

## 3. Session, Zugriff, Security

### 3.1 Session-Grundlagen

- Session-ID wird ueber `GET /api/session` erzeugt oder geladen.
- Session kann per Header `X-Session-ID` oder per Cookie `session_id` uebermittelt werden.
- Session-Status ist `active` oder `suspended`.

### GET /api/session

Beschreibung: Liefert vorhandene Session oder erstellt eine neue Session.

Response `200`:

```json
{
  "sessionId": "3b9f1c2a-...",
  "status": "active"
}
```

### 3.2 `serverRequireSession`

Wenn `serverRequireSession=true` gesetzt ist:

- API-Requests ohne gueltige Session erhalten `401`.
- Gesperrte Sessions erhalten `403`.

Wenn `serverRequireSession=false`:

- Session ist optional.
- Gesperrte Sessions bleiben weiterhin blockiert (`403`).

### 3.3 Oeffentliche API-Endpunkte (ohne Session-Pruefung)

- `GET /api/session`
- `GET /api/openapi.json`
- `GET /api/docs` und `GET /api/docs/`
- `GET /api/redoc` und `GET /api/redoc/`
- `GET /api/docs/assets/*`

### 3.4 CORS-Hinweis

- Preflight (`OPTIONS`) liefert aktuell `Access-Control-Allow-Methods: GET, POST, OPTIONS`.
- Browser-Cross-Origin fuer `PUT`/`DELETE` kann dadurch blockiert sein.

## 4. API-Doku Endpunkte

### GET /api/openapi.json

Liefert die aktuelle OpenAPI 3.1 Spezifikation als JSON.

### GET /api/docs

Liefert lokale Swagger UI (ohne externes CDN).

### GET /api/redoc

Liefert lokale ReDoc Seite.

## 5. Rotor API im Detail

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
- `baudRate` muss positive Integer sein.

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

- `400`: bereits mit anderem Port verbunden
- `400`: ungueltige Parameter
- `500`: Verbindungsfehler

### POST /api/rotor/disconnect

Beschreibung: Aktive Verbindung trennen.

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
  },
  "clientCount": 1
}
```

### POST /api/rotor/command

Beschreibung: Direkten GS-232B Befehl senden.

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

- `400`: ungueltiger `command`
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)
- `500`: Sendefehler

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

### POST /api/rotor/stop

Beschreibung: Bewegung stoppen.

Response `200`:

```json
{
  "status": "ok"
}
```

### POST /api/rotor/set_target

Beschreibung: Zielposition in kalibrierten Werten setzen.

Request Body (`az` und `el` sind beide Pflicht und numerisch):

```json
{
  "az": 180.5,
  "el": 45.0
}
```

Response `200`:

```json
{
  "status": "ok"
}
```

Typische Fehler:

- `400`: `az` oder `el` fehlt/ungueltig
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)
- `500`: interne Ausfuehrungsfehler

### POST /api/rotor/set_target_raw

Beschreibung: Zielposition mit RAW-Werten setzen.

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
  "status": "ok"
}
```

Typische Fehler:

- `400`: weder `az` noch `el` gueltig gesetzt
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

- `400`: Presets deaktiviert
- `400`: Home konnte nicht gestartet werden
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

### POST /api/rotor/park

Beschreibung: Park-Preset anfahren.

Voraussetzungen und Fehler analog zu `/api/rotor/home`.

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

Hinweis: Das Objekt enthaelt viele weitere Felder (Map, Ramp, Limits, Presets, Server etc.).

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
    "azimuthOffset": 4.0,
    "elevationOffset": 1.5
  }
}
```

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

### POST /api/server/settings

Beschreibung: Validiert und speichert Serverparameter.

Request Body Felder:

- `serverHttpPort` (1024..65535)
- `serverWebSocketPort` (1024..65535)
- `serverPollingIntervalMs` (250..2000)
- `serverSessionTimeoutS` (60..3600)
- `serverMaxClients` (1..100)
- `serverLoggingLevel` (`DEBUG`, `INFO`, `WARNING`, `ERROR`)
- `serverRequireSession` (`true`/`false`)

Beispiel:

```json
{
  "serverPollingIntervalMs": 250,
  "serverSessionTimeoutS": 600,
  "serverLoggingLevel": "DEBUG",
  "serverRequireSession": true
}
```

Response `200`:

```json
{
  "status": "ok",
  "message": "Server settings saved. Restart required for port changes to take effect.",
  "restartRequired": true
}
```

Validierungsfehler `400`:

```json
{
  "error": "Validation failed",
  "details": [
    "HTTP port must be between 1024 and 65535"
  ]
}
```

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
      "connectedAt": "2026-04-17T14:30:12.123456",
      "lastSeen": "2026-04-17T14:35:08.654321",
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

- `404`: Client nicht gefunden

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

- `404`: Client nicht gefunden

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

- `position`: faehrt RAW auf `azimuth`/`elevation`
- `wait`: 
  - `duration` in ms (>0) = zeitbasiert
  - `duration` `0` oder `null` = manueller Wait
- `loop`:
  - `iterations` > 0 = feste Wiederholungen
  - `iterations` `0`, `null` oder unendlich = Endlosschleife (mit Sicherheitslimit)

### GET /api/routes

Response `200`:

```json
{
  "routes": []
}
```

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

- `400`: fehlende/duplizierte Route-ID

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

- `404`: Route nicht gefunden

### DELETE /api/routes/{id}

Response `200`:

```json
{
  "status": "ok"
}
```

Fehler:

- `404`: Route nicht gefunden

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

- `400`: nicht startbar (nicht gefunden / bereits aktiv)
- `400`: Rotor nicht verbunden (`code: ROTOR_DISCONNECTED`)

### POST /api/routes/stop

Beschreibung: Aktive Route stoppen.

Response `200`:

```json
{
  "status": "ok"
}
```

### POST /api/routes/continue

Beschreibung: Manuellen Wait-Schritt fortsetzen.

Response `200`:

```json
{
  "status": "ok"
}
```

Fehler:

- `400`: kein manueller Wait aktiv

### GET /api/routes/execution

Beschreibung: Aktueller Laufzustand.

Response `200`:

```json
{
  "executing": true,
  "routeId": "route_1",
  "routeName": "Demo",
  "currentStepIndex": 1,
  "totalSteps": 5
}
```

### 9.3 Laufzeitregeln der Ausfuehrung

- Positionstoleranz: `2.0` Grad
- Timeout pro Positionsschritt: `60` Sekunden
- Positionscheck-Intervall: `0.2` Sekunden
- Endlosschleifen-Sicherheitsgrenze: `100000` Iterationen

## 10. Einheitliches Fehlerverhalten

### 10.1 Typische Statuscodes

- `200` OK
- `400` Bad Request
- `401` Unauthorized (bei aktivem `serverRequireSession` und fehlender/ungueltiger Session)
- `403` Forbidden (suspendierte Session)
- `404` Not Found
- `500` Internal Server Error

### 10.2 Standard-Fehlerobjekt

```json
{
  "error": "Fehlermeldung",
  "message": "Optionale Detailinfo"
}
```

### 10.3 Rotor-Disconnected Spezialfall

Mehrere Rotor-Steuerendpunkte liefern bei fehlender Verbindung:

```json
{
  "error": "Not connected to rotor",
  "code": "ROTOR_DISCONNECTED"
}
```

## 11. Kurze cURL Beispiele

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

## 12. Hinweise zur Pflege

- Bei API-Aenderungen immer zuerst `server/api/routes.py`, `server/api/handler.py` und `server/api/openapi.py` pruefen.
- Diese Datei soll mit `GET /api/openapi.json` konsistent bleiben.
- Die Detailbeispiele hier sind exemplarisch; zusaetzliche Felder in `settings` oder Route-Schritten sind moeglich.
