# Rotor-Interface-GS232B

Electron-Anwendung zur Steuerung eines Yaesu GS-232B kompatiblen Rotors (z. B. ueber das WinRotorPlus-USB-Interface). Die App verbindet sich ueber eine serielle Schnittstelle, visualisiert Azimut/Elevation in Echtzeit und erlaubt das Senden saemtlicher relevanter GS-232B-Kommandos. Ein Simulation Mode ermoeglicht die Arbeit ohne angeschlossene Hardware.

## Features

- Serielle Kommunikation via `serialport` (wahlweise Simulation ohne Hardware)
- Steuerung aller Kernbefehle (R/L/A, U/D/E, S, Mxxx, Wxxx yyy, P36/P45 ...)
- Live-Visualisierung mit Kompass und Radaransicht
- Positions-History inkl. CSV-Export
- Konfiguration (Port, Baudrate, Modus 360deg/450deg, Polling-Intervall) wird lokal gespeichert
- Packaging zu einer Windows-EXE via `electron-builder`

## Projektstruktur

```
src/
  main/               # Electron-Mainprozess, Serial Manager, Rotor Controller
  preload/            # IPC-Bridge Renderer <-> Main
  renderer/           # UI (HTML, CSS, TS) + Unterordner services/ui
  common/             # Geteilte Typdefinitionen
```

## Setup

1. Node.js (>= 18) installieren.
2. Abhaengigkeiten installieren:

   ```bash
   npm install
   ```

3. Build ausfuehren und Anwendung starten:

   ```bash
   npm run build
   npm start
   ```

    `npm start` fuehrt einen frischen Build aus und startet anschliessend Electron.

4. Fuer kontinuierliche Entwicklung kann der TypeScript-Watcher genutzt werden:

   ```bash
   npm run dev
   # in einem zweiten Terminal:
   npm start
   ```

## Wichtige Skripte

| Script          | Beschreibung                                            |
| --------------- | ------------------------------------------------------- |
| `npm run dev`   | TypeScript Build im Watch-Modus                         |
| `npm run build` | Aufraeumen, TypeScript-Compile und Kopieren statischer Dateien |
| `npm start`     | Build + Start der Electron-App                          |
| `npm run dist`  | Build + Paketierung zur Windows-EXE via `electron-builder` |

Die fertigen Installer liegen anschliessend im Ordner `release/`.

## Simulation Mode

- Aktivierung ueber die Checkbox "Simulation" oder durch Auswahl des simulierten Ports.
- Alle Kommandos und Visualisierungen funktionieren ohne echte Hardware.
- Ideal fuer UI-Tests und CI/CD Builds.

## CSV-Export & History

- Jede Statusaktualisierung wird protokolliert.
- Export erzeugt eine `*.csv` mit `timestamp_iso;azimuth_deg;elevation_deg;raw`.

## Lizenz

GPL-3.0-or-later - siehe `LICENSE`.