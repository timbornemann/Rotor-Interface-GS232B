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

### 1. Ohne Webserver

1. Repository klonen oder herunterladen.
2. Datei `src/renderer/index.html` im Browser öffnen (per Doppelklick oder via `file://`).
3. Simulation aktivieren oder – falls Web Serial verfügbar – `Port hinzufügen` klicken, Port auswählen, verbinden.

> Hinweis: Die Web-Serial-API steht nur in sicheren Kontexten (HTTPS oder `http://localhost`) zur Verfügung. Beim Öffnen per `file://` ist ausschließlich der Simulationsmodus möglich.

### 2. Mit leichtgewichtigem Dev-Server (optional)

```bash
npm install
npm run serve   # startet http-server auf http://localhost:4173
```

Der Dev-Server liefert automatisch einen sicheren Kontext für Web Serial.
`npm install` bringt lediglich den kleinen `http-server` ins Projekt; die App selbst benötigt kein Build.

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