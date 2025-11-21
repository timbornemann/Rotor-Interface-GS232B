# Rotor-Interface-GS232B

Browserbasierte Oberfläche zur Steuerung eines Yaesu GS-232B kompatiblen Rotors. Die Anwendung besteht nur aus HTML, CSS und JavaScript und kann direkt im Browser geöffnet werden – kein Electron, keine Installer, kein Build-Workflow.

## Highlights

- **Direkt im Browser starten:** `src/renderer/index.html` in Chrome/Edge (oder jedem Chromium-Browser) öffnen.
- **Web Serial Unterstützung:** Zugriff auf echte USB-/COM-Ports über die Web-Serial-API (erfordert HTTPS oder `http://localhost`).
- **Simulation inklusive:** Ohne Hardware nutzbar; der simulierte Port verhält sich wie ein echter Rotor.
- **Live-Visualisierung:** Kompass- und Radaransicht aktualisieren sich mit jedem Status-Update.
- **Komplette Steuerung:** Buttons für R/L/A, U/D/E, S sowie Goto-Azimut/Elevation und Modus 360°/450°.
- **History & CSV-Export:** Alle Polling-Werte werden protokolliert und lassen sich als CSV herunterladen.
- **Persistente Einstellungen:** Port, Baudrate, Modus und Polling-Intervall werden im `localStorage` abgelegt.

## Projektstruktur

```
src/
  renderer/
    assets/         # Icons
    index.html      # Startseite (direkt im Browser öffnen)
    styles.css      # Globales Styling
    main.js         # Einstiegspunkt
    services/       # Config-Store & Rotor-Service (Web Serial + Simulation)
    ui/             # UI-Komponenten (Kompass, Karte, Controls, History)
```

## Nutzung

### Direkt im Browser öffnen

1. Öffne `src/renderer/index.html` direkt im Browser (Doppelklick oder `file://`-Pfad).
2. Die Anwendung funktioniert sofort im Simulationsmodus.

### Web Serial verwenden

Die Web-Serial-API steht nur in sicheren Kontexten (HTTPS oder `http://localhost`) zur Verfügung. Für Web Serial benötigst du einen lokalen Webserver:

**Option 1: Mit Python (falls installiert)**
```bash
cd src/renderer
python -m http.server 4173
```
Öffne dann: `http://localhost:4173`

**Option 1b: Mit integriertem Auth-Server (empfohlen für Netzwerk-Zugriff)**
```bash
# Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten
python python_server.py --port 8081 --key rotor-secret-key
```
Öffne dann: `http://localhost:8081` (lokal) oder `http://<SERVER-IP>:8081` (vom Netzwerk).

Der Server liefert die UI aus `src/renderer` und stellt eine API zur Verfügung. Wenn die Anwendung von einem anderen Rechner aus aufgerufen wird, wird automatisch der Server-Modus verwendet, um auf COM-Ports am Server-Rechner zuzugreifen.

**Option 2: Mit PHP (falls installiert)**
```bash
cd src/renderer
php -S localhost:4173
```
Öffne dann: `http://localhost:4173`

**Option 3: Mit npm/http-server (optional)**
```bash
npm install
npm run serve
```
Öffne dann: `http://localhost:4173`

> **Hinweis:** Die Anwendung läuft komplett im Browser ohne Node.js zur Laufzeit. Ein Webserver wird nur für Web Serial benötigt; im Simulationsmodus funktioniert alles direkt per `file://`.

### Authentifizierter Python-Server & API

- Start: `python python_server.py --port 8081 --key rotor-secret-key`
- Authentifizierung: Per `X-API-Key` Header oder `?key=<API_KEY>` Query-Parameter.
- API:
  - `POST /api/commands` – JSON `{ "command": "R1", "meta": { ... } }` speichern.
  - `GET /api/commands` – alle bisher eingegangenen Kommandos abrufen.
  - `GET /api/rotor/ports` – verfügbare COM-Ports auflisten.
  - `POST /api/rotor/connect` – Verbindung zu einem COM-Port herstellen.
  - `POST /api/rotor/disconnect` – Verbindung trennen.
  - `POST /api/rotor/command` – Befehl an den Rotor senden.
  - `GET /api/rotor/status` – aktuellen Status abrufen.

Der Server läuft auf `0.0.0.0` und nutzt standardmäßig Port `8081`. Der API-Key
kann per `--key` überschrieben oder für lokale Tests hartcodiert bleiben.

**Wichtig:** Für COM-Port-Funktionalität ist `pyserial` erforderlich:
```bash
pip install -r requirements.txt
```

### Netzwerk-Zugriff (Remote-Steuerung)

Wenn die Web-Anwendung von einem anderen Rechner aus aufgerufen wird (z.B. `http://<SERVER-IP>:8081`), erkennt die Anwendung automatisch, dass Web Serial nicht verfügbar ist und verwendet den **Server-Modus**. In diesem Modus:

- Die COM-Ports werden vom Server verwaltet (nicht vom Browser)
- Alle Befehle werden über die API gesendet
- Der Status wird über die API abgerufen
- Server-Ports werden in der Port-Liste mit `[Server]` markiert

Dies ermöglicht es, den Rotor von jedem Rechner im Netzwerk aus zu steuern, solange der Server auf dem Rechner läuft, an dem der COM-Port angeschlossen ist.

## Arbeiten mit Web Serial

1. Browser: Aktuelles Chrome/Edge oder ein anderer Chromium-Browser.
2. Kontext: HTTPS-Domain oder `http://localhost`. Für lokale Tests empfiehlt sich der oben genannte Dev-Server.
3. Portzugriff:
   - Auf `Port hinzufügen` klicken.
   - Gewünschten COM-/USB-Port auswählen und Zugriff erlauben.
   - Port in der Dropdown-Liste wählen, Baudrate/Polling setzen und verbinden.

## Simulation Mode

- Checkbox „Simulation“ aktivieren oder den simulierten Port auswählen.
- Alle Steuerelemente funktionieren wie am echten Rotor.
- Ideal für UI-Demos, Tests und wenn kein Gerät angeschlossen ist.

## CSV-Export & History

- Jedes Polling-Resultat (AZ/EL) landet in der History-Tabelle.
- Über „Export CSV“ entsteht eine Datei im Format `timestamp_iso;azimuth_deg;elevation_deg;raw`.

## Lizenz

GPL-3.0-or-later – siehe `LICENSE`.