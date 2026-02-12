# Rotor-Interface GS232B

Browserbasierte Oberfläche zur Steuerung eines Yaesu GS-232B kompatiblen Rotors. Der modulare Python-Server stellt eine REST-API und WebSocket-Schnittstelle bereit, verwaltet die serielle Verbindung zum Rotor und synchronisiert mehrere Clients in Echtzeit. Die Web-UI (HTML/CSS/JavaScript) wird direkt vom Server ausgeliefert und kommt ohne Build-Tooling aus.

---

## Inhalt

- [Hauptfunktionen](#hauptfunktionen)
- [Projektarchitektur](#projektarchitektur)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
  - [Python-Server (empfohlen)](#python-server-empfohlen)
  - [Windows-Schnellstart](#windows-schnellstart)
  - [Simulation im Browser](#simulation-im-browser)
  - [Web-Serial-Zugriff (lokal)](#web-serial-zugriff-lokal)
- [Bedienung](#bedienung)
  - [Ports & Verbindungen](#ports--verbindungen)
  - [Steuerung & Modi](#steuerung--modi)
  - [Routen & Positionen](#routen--positionen)
  - [Kalibrierung](#kalibrierung)
  - [Historie & CSV-Export](#historie--csv-export)
  - [Multi-Client-Betrieb](#multi-client-betrieb)
- [API-Überblick](#api-überblick)
- [WebSocket-Schnittstelle](#websocket-schnittstelle)
- [Konfiguration](#konfiguration)
- [Ordnerstruktur](#ordnerstruktur)
- [Tests](#tests)
- [Weiterführende Doku](#weiterführende-doku)
- [Lizenz](#lizenz)

---

## Hauptfunktionen

- **Modularer Python-Server:** REST-API + WebSocket-Server mit COM-Port-Verwaltung, Multi-Client-Synchronisation und serverseitiger Rotorsteuerung.
- **Echtzeit-Updates:** WebSocket-Broadcasting liefert Positions-, Verbindungs- und Settings-Updates an alle verbundenen Clients.
- **Live-Visualisierung:** Kompass, Kartenansicht (Leaflet mit ArcGIS/OSM/Google Tiles) und Kegel-Visualisierung aktualisieren sich in Echtzeit.
- **Simulation inklusive:** Realistische Rotor-Simulation ohne angeschlossene Hardware.
- **Komplette Steuerung:** Manuelle Bewegung (R/L/U/D), Goto-Ziel (Azimut/Elevation), 360°/450°-Modus, Soft-Limits und Geschwindigkeitsvorgaben.
- **Routen-System:** Routen mit Positions-, Warte- und Loop-Schritten erstellen, speichern und serverseitig ausführen.
- **Positionsmanager:** Häufig genutzte Positionen speichern und per Klick anfahren.
- **Kalibrierung:** Offset-/Skalierungsfaktoren sowie Mehrpunkt-Kalibrierungsassistent für präzise Positionsanzeige.
- **Softstart/Softstop (Ramping):** PI-Regler für sanftes Anfahren und Abbremsen.
- **Home/Park-Positionen:** Vordefinierte Positionen mit optionalem Auto-Park bei Trennung.
- **Historie & Export:** Polling-Daten werden mitgeschrieben und als CSV exportierbar.
- **Multi-Client-Verwaltung:** Session-Management mit Möglichkeit, einzelne Clients zu suspendieren.
- **Persistente Settings:** Alle Einstellungen werden serverseitig in `web-settings.json` gespeichert und über alle Clients synchronisiert.
- **Web Serial (lokal):** Alternativ kann der Browser direkt über Web Serial auf USB-/COM-Ports zugreifen (Chromium, HTTPS oder `localhost`).
- **Arduino-Hardware:** Enthält Firmware und Schaltplan für einen Arduino-basierten GS-232B-Emulator (Ordner `hardware_test/`).

---

## Projektarchitektur

```text
server/                     # Modularer Python-Server
  core/                     #   Server-Lifecycle, State-Singleton, Session-Manager
  api/                      #   HTTP-Handler, Routen-Dispatch, Middleware, WebSocket-Manager
  config/                   #   Settings-Manager, Default-Werte
  connection/               #   Serielle Verbindung, Port-Scanner
  control/                  #   Rotor-Logik (Kalibrierung, Limits, Ramping, Mathematik)
  routes/                   #   Routen-Manager (CRUD) & Routen-Executor
  utils/                    #   Logging

src/renderer/               # Web-UI (wird vom Server statisch ausgeliefert)
  index.html                #   Einstiegsseite
  styles.css                #   Globales Styling
  main.js                   #   Bootstrapping & App-Logik
  manifest.webmanifest      #   PWA-Manifest
  assets/                   #   Icons & Logo
  services/                 #   ConfigStore, RotorService, WebSocketService, RouteExecutor
  ui/                       #   UI-Komponenten (Elevation, MapView, Controls, HistoryLog,
                            #     SettingsModal, CalibrationWizard, RouteManager, PositionManager,
                            #     AlertModal)

python_server.py            # Kompatibilitäts-Wrapper (delegiert an server/)
start_server.bat            # Windows-Starter mit Auto-Restart
```

**Kernarchitektur:** Der Python-Server (`server/`) übernimmt die gesamte serielle Kommunikation und Rotorsteuerung. Die Web-UI kommuniziert ausschließlich über REST-API und WebSocket mit dem Server. Alle Einstellungen werden serverseitig in `web-settings.json` verwaltet und per WebSocket an die Clients synchronisiert.

---

## Voraussetzungen

- **Python 3.9+** mit `pyserial` und `websockets` (`pip install -r requirements.txt`).
- **Browser:** Aktueller Chrome, Edge oder Firefox für die Web-UI.
- **Web Serial (optional):** Chromium-Browser + HTTPS oder `http://localhost` für direkten Browser-Zugriff auf serielle Ports (ohne Python-Server).
- **Node/npm (optional):** Nur für den alternativen Dev-Server (`npm run serve`); zur Laufzeit nicht nötig.

---

## Schnellstart

### Python-Server (empfohlen)

```bash
# Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten (Standard: HTTP-Port 8081, WebSocket-Port 8082)
python -m server.main --port 8081

# Alternativ (Kompatibilitäts-Wrapper):
python python_server.py --port 8081
```

Aufruf im Browser: `http://localhost:8081` oder im LAN `http://<SERVER-IP>:8081`.

Der Server zeigt beim Start alle erreichbaren URLs (lokale IP-Adressen) an.

### Windows-Schnellstart

`start_server.bat` doppelklicken – das Skript liest die Ports aus `web-settings.json`, startet den Server und führt bei einem Neustart-Request (Exit-Code 42) automatisch einen Restart durch.

### Simulation im Browser

1. `src/renderer/index.html` per Doppelklick öffnen (oder `file://...` laden).
2. Simulation ist sofort aktiv; alle Bedienelemente funktionieren ohne Hardware.

### Web-Serial-Zugriff (lokal)

Web Serial benötigt einen lokalen Webserver:

```bash
cd src/renderer
python -m http.server 4173
# oder: npm run serve
```

Danach `http://localhost:4173` im Browser öffnen und über **Port hinzufügen** einen COM-/USB-Port auswählen. Web Serial funktioniert nur in Chromium-Browsern und nur über HTTPS oder `localhost`.

---

## Bedienung

### Ports & Verbindungen

- **Simulation:** Simulierten Port in der Portliste auswählen – funktioniert ohne Hardware.
- **Server-Modus (empfohlen):** Ports werden über den Python-Server verwaltet. Ports tragen den Präfix `[Server]`, Befehle und Status laufen über die REST-API.
- **Web Serial:** Über „Port hinzufügen" einen USB-/COM-Port im Browser freigeben und direkt verbinden (nur lokal).

### Steuerung & Modi

- **Manuelle Bewegung:** R/L (Azimut rechts/links), U/D (Elevation hoch/runter), S (Stop alles).
- **Goto:** Ziel-Azimut und/oder Elevation eingeben und anfahren (kalibriert oder RAW).
- **Kartenklick:** Auf die Kartenansicht klicken, um den Rotor in die angeklickte Richtung zu drehen.
- **Modi:** 360°/450° per Einstellungen umschaltbar (GS-232B `P36`/`P45`).
- **Soft-Limits:** Minimale und maximale Azimut-/Elevationsgrenzen konfigurierbar.
- **Geschwindigkeit:** Azimut- und Elevationsgeschwindigkeit in °/s einstellbar.
- **Softstart/Softstop:** Optionaler PI-Regler (Ramping) für sanftes Anfahren und Abbremsen, konfigurierbar über Kp, Ki, Abtastzeit und Toleranz.

### Routen & Positionen

- **Routen:** Sequenzen aus Positionsschritten, Wartezeiten und Schleifen erstellen, bearbeiten und speichern. Routen werden serverseitig in `routes.json` gespeichert und können vom Server ausgeführt werden – mit Echtzeit-Fortschrittsanzeige über WebSocket.
- **Positionsmanager:** Häufig genutzte Positionen (Azimut/Elevation) speichern, per Drag & Drop sortieren und per Klick anfahren.
- **Home/Park:** Vordefinierte Home- und Park-Positionen mit optionalem Auto-Park bei Trennung.

### Kalibrierung

- **Offset & Skalierung:** Azimut-/Elevations-Offset und Skalierungsfaktoren konfigurierbar.
- **Mehrpunkt-Kalibrierung:** Interaktiver Assistent, der mehrere Referenzpunkte (RAW ↔ tatsächlicher Winkel) aufnimmt und daraus eine Kalibrierungstabelle erstellt.
- **Kalibriermodus:** Wahlweise nur Anzeige-Korrektur (`display-only`) oder bidirektionale Korrektur auch beim Senden von Befehlen.

### Historie & CSV-Export

- Jeder Polling-Status (AZ/EL) landet in der History-Tabelle.
- Über **Export CSV** entsteht eine Datei im Format `timestamp_iso;azimuth_deg;elevation_deg;raw`.

### Multi-Client-Betrieb

- Mehrere Browser-Clients können gleichzeitig verbunden sein.
- Verbindungsstatus, Einstellungen und Routenausführung werden per WebSocket an alle Clients synchronisiert.
- Über die Client-Verwaltung in den Einstellungen können einzelne Sessions eingesehen und bei Bedarf suspendiert werden.

---

## API-Überblick

Der Python-Server stellt eine REST-API bereit (ohne Authentifizierung; nur in vertrauenswürdigen Netzen einsetzen):

### Rotor-Steuerung

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/rotor/ports` | GET | Verfügbare COM-Ports auflisten |
| `/api/rotor/connect` | POST | Verbindung zu COM-Port herstellen |
| `/api/rotor/disconnect` | POST | Verbindung trennen |
| `/api/rotor/status` | GET | Aktuellen Status (Position, Verbindung) abrufen |
| `/api/rotor/position` | GET | Position mit Kegel-Visualisierungsparametern |
| `/api/rotor/command` | POST | Direkter GS-232B Befehl (Low-Level) |
| `/api/rotor/set_target` | POST | Zielposition setzen (kalibrierte Werte) |
| `/api/rotor/set_target_raw` | POST | Zielposition setzen (RAW Hardware-Werte) |
| `/api/rotor/manual` | POST | Manuelle Bewegung starten (left/right/up/down) |
| `/api/rotor/stop` | POST | Alle Bewegungen stoppen |

### Konfiguration & Server

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/settings` | GET/POST | Rotor-Konfiguration lesen/aktualisieren |
| `/api/config/ini` | GET | `rotor-config.ini` lesen (read-only) |
| `/api/server/settings` | GET/POST | Server-Einstellungen lesen/aktualisieren |
| `/api/server/restart` | POST | Server neu starten |

### Client-Verwaltung

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/session` | GET | Eigene Session-ID abrufen |
| `/api/clients` | GET | Alle verbundenen Clients auflisten |
| `/api/clients/{id}/suspend` | POST | Client suspendieren |
| `/api/clients/{id}/resume` | POST | Client wieder aktivieren |

Detailbeschreibung inkl. Beispiel-Requests und Python-Client-Klasse: siehe **[`API_Dokumentation.md`](API_Dokumentation.md)**.

---

## WebSocket-Schnittstelle

Der Server betreibt einen WebSocket-Server (Standard-Port `8082`) für Echtzeit-Updates. Alle Nachrichten sind JSON-Objekte mit `type` und `data`:

```json
{ "type": "connection_state_changed", "data": { "connected": true, "port": "COM3", "baudRate": 9600 } }
```

**Event-Typen:**

- **`connection_state_changed`** – Verbindungsstatus (connect/disconnect)
- **`client_list_updated`** – Aktualisierte Client-Liste
- **`settings_updated`** – Konfigurationsänderungen
- **`route_list_updated`** – Routenliste aktualisiert
- **`route_execution_started`** / **`route_execution_progress`** / **`route_execution_stopped`** / **`route_execution_completed`** – Routenausführungs-Events
- **`client_suspended`** – Suspendierungs-Benachrichtigung

**Verbindung:** Clients verbinden sich mit `ws://localhost:8082` und registrieren ihre Session-ID (abgerufen über `GET /api/session`) per `{ "type": "register_session", "sessionId": "..." }`.

---

## Konfiguration

- **`web-settings.json`:** Zentrale Konfigurationsdatei, die alle Einstellungen enthält (Verbindung, Karte, Kegel, Geschwindigkeit, Ramping, Limits, Kalibrierung, Server-Ports usw.). Wird vom Server verwaltet und per API und WebSocket synchronisiert.
- **`rotor-config.ini`:** INI-Datei als Vorlage/Referenz für die Konfigurationsstruktur. Kann über `GET /api/config/ini` abgerufen werden.
- **`routes.json`:** Gespeicherte Routen (Positionsabfolgen, Schleifen, Wartezeiten).
- **Server-Ports:** HTTP-Port (Standard `8081`) und WebSocket-Port (Standard `8082`), konfigurierbar über CLI-Parameter (`--port`, `--websocket-port`) oder `web-settings.json`.
- **Polling:** Server-seitiges Polling-Intervall in den Settings einstellbar (Standard 500 ms).

---

## Ordnerstruktur

```text
server/                  # Modularer Python-Server (Hauptkomponente)
  core/                  #   server.py, state.py, session_manager.py
  api/                   #   handler.py, routes.py, middleware.py, websocket.py
  config/                #   settings.py, defaults.py
  connection/            #   serial_connection.py, port_scanner.py
  control/               #   rotor_logic.py, math_utils.py
  routes/                #   route_manager.py, route_executor.py
  utils/                 #   logging.py

src/renderer/            # Web-UI (HTML/CSS/JavaScript)
  services/              #   configStore.js, rotorService.js, websocketService.js, routeExecutor.js
  ui/                    #   controls.js, elevation.js, mapView.js, historyLog.js,
                         #     settingsModal.js, calibrationWizard.js, routeManager.js,
                         #     positionManager.js, alertModal.js
  assets/                #   Icons & Logo

tests/                   # Python- & JavaScript-Tests
diagrams/                # Architektur- und Ablaufdiagramme (PNG)
hardware_test/           # Arduino-Firmware & Schaltplan (GS-232B-Emulator)

python_server.py         # Kompatibilitäts-Wrapper → server/
start_server.bat         # Windows-Starter mit Auto-Restart
web-settings.json        # Persistente Konfiguration (serverseitig)
rotor-config.ini         # INI-Konfigurationsvorlage
routes.json              # Gespeicherte Routen
api-test-page.html       # Interaktive API-Testseite
migrate_routes.py        # Migrationsskript: Routen aus web-settings.json → routes.json
requirements.txt         # Python-Abhängigkeiten (pyserial, websockets, pytest)
package.json             # Optionale Dev-Abhängigkeiten (http-server)
API_Dokumentation.md     # Vollständige REST-API-Dokumentation
GS232B_Befehle.md        # GS-232B Befehlsreferenz
Plan.md                  # Projekt-Notizen/Planung
```

---

## Tests

```bash
# Python-Tests (pytest)
pip install -r requirements.txt
pytest tests/

# JavaScript-Tests (Node.js)
npm test
```

---

## Weiterführende Doku

- **API-Details & Python-Client:** [`API_Dokumentation.md`](API_Dokumentation.md)
- **GS-232B Befehle:** [`GS232B_Befehle.md`](GS232B_Befehle.md)
- **Arduino-Hardware:** [`hardware_test/README.md`](hardware_test/README.md) – Schaltplan, BOM und Firmware für den Arduino-basierten GS-232B-Emulator
- **Architektur-Diagramme:** [`diagrams/`](diagrams/) – Systemarchitektur, Datenfluss, Threading, WebSocket-Broadcasting u. v. m.
- **API-Testseite:** [`api-test-page.html`](api-test-page.html) – Interaktive Testseite für alle API-Endpunkte

---

## Lizenz

GPL-3.0-or-later – siehe [`LICENSE`](LICENSE).
