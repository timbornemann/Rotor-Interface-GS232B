# Projektplanung für "Rotor-Interface-GS232B": Electron-Rotorsteuerung für Yaesu GS-232B (WinRotorPlus-Interface)

## 0. Ziel und Scope

Erstelle eine Windows-Desktop-Anwendung (EXE) mit Electron, die:

- einen Rotor mit Yaesu-GS-232B-kompatiblem Protokoll über die serielle Schnittstelle (WinRotorPlus-USB-Interface) steuert,
- den aktuellen Azimut (und optional Elevation) **live visualisiert**:
  - Kompass (Richtungspfeil),
  - einfache „Karten“-Ansicht (z.B. stilisierte Umgebung / Weltkarte / Radar-Ansicht),
- alle relevanten GS-232B-Befehle senden kann (R, L, A, U, D, E, S, C, B, C2, Maaa, Wxxx yyy, P36, P45, etc.),
- aktuelle Positions- und Rotationsdaten:
  - anzeigen,
  - in einer History-Liste protokollieren,
  - als CSV exportieren kann,
- als **eine klickbare .exe für Windows** ausgeliefert wird.

Zielplattform:  
- Windows 10/11, x64  
- Node.js + Electron  
- Serielle Kommunikation mit `serialport`-Bibliothek.

---

## 1. Projektstruktur anlegen

1. Erstelle ein neues Projektverzeichnis, z.B. `rotor-control-electron`.
2. Initialisiere Node-Projekt:

   ```bash
   npm init -y

3. Lege folgende Struktur an:

rotor-control-electron/
  package.json
  electron-builder.yml          # Build-Konfiguration (später)
  src/
    main/
      main.ts or main.js        # Electron-Main-Prozess
      serialManager.ts          # Serielle Schnittstellen-Logik
      ipcHandlers.ts            # IPC zwischen Main und Renderer
    renderer/
      index.html
      styles.css
      main.ts or main.js        # Einstiegspunkt Renderer
      ui/
        compass.ts              # Kompass-Rendering
        mapView.ts              # Karten-/Radar-Ansicht
        controls.ts             # Buttons & Formulare
        historyLog.ts           # Positions-History & Export
      services/
        rotorApi.ts             # Abstraktion GS-232B-Befehle
        configStore.ts          # Speichern von COM-Port/Settings
    preload/
      preload.ts                # IPC-Bridge Renderer <-> Main


4. Optional: TypeScript verwenden (empfohlen). Wenn ja, tsconfig.json anlegen und Build-Skripte für Transpile einrichten.




---

2. Dependencies installieren

Installiere:

Electron + Builder

serialport

optional: irgendeine kleine Helper-Lib für CSV (oder selbst schreiben)


npm install --save serialport
npm install --save-dev electron electron-builder

Passe package.json an:

{
  "name": "rotor-control",
  "version": "1.0.0",
  "main": "dist/main/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron .",
    "build": "tsc",               // falls TypeScript
    "dist": "npm run build && electron-builder"
  },
  "build": {
    "appId": "de.tim.rotorcontrol",
    "productName": "RotorControl",
    "directories": {
      "output": "release"
    },
    "win": {
      "target": "nsis"
    }
  }
}

> Anpassung: Falls kein TypeScript verwendet wird, main auf src/main/main.js setzen und build-Script anpassen.




---

3. Electron-Main-Prozess implementieren

Datei: src/main/main.ts

Aufgaben:

Electron-App starten,

BrowserWindow erstellen,

preload.js registrieren,

ipcHandlers (Serial & Rotor-API) initialisieren.


Pseudo-Code:

import { app, BrowserWindow } from 'electron'
import path from 'path'
import { registerIpcHandlers } from './ipcHandlers'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})


---

4. Serielle Kommunikation kapseln

Datei: src/main/serialManager.ts

Ziele:

Serielle Ports auflisten,

Verbindung zu einem Port herstellen (COMx, Baudrate, 8N1),

Befehle an den Rotor senden,

Antworten lesen und als Events/Callbacks weitergeben,

reconnect/Fehler sauber behandeln.


Verwende serialport:

Standardparameter: baudRate z.B. 9600, dataBits: 8, stopBits: 1, parity: 'none'.

Jedes Kommando immer mit \r senden.


API-Entwurf (aus Sicht anderer Module):

interface SerialManager {
  listPorts(): Promise<PortInfo[]>
  openPort(path: string, options: SerialOptions): Promise<void>
  closePort(): Promise<void>
  isOpen(): boolean
  writeCommand(cmd: string): Promise<void>
  onData(callback: (data: string) => void): void
  onError(callback: (err: Error) => void): void
}

Die Implementation:

Pufferung eingehender Daten, bis \r oder \n (abhängig von Gerät).

Zeilenweise Forward an einen Callback (z.B. "AZ=123 EL=045").



---

5. Rotor-spezifische API implementieren

Datei: src/main/rotorApi.ts oder src/renderer/services/rotorApi.ts
(je nach Architektur, hier: im Main und via IPC erreichbar).

Aufgaben:

GS-232B-Kommandos kapseln:

sendAzimuthRight() -> R\r

sendAzimuthLeft() -> L\r

stopAzimuth() -> A\r

sendElevationUp() -> U\r

sendElevationDown() -> D\r

stopElevation() -> E\r

stopAll() -> S\r

queryAzimuth() -> C\r

queryElevation() -> B\r

queryAzEl() -> C2\r

setAzimuth(aaa: number) -> Maaa\r

setAzEl(az: number, el: number) -> Wxxx yyy\r

setMode360() -> P36\r

setMode450() -> P45\r

toggleNorthSouth() -> Z\r

etc.


Eingehende Strings parsen:

Formate wie "AZ=123" oder "AZ=123 EL=045".

Ausgabe als Objekt:

interface RotorStatus {
  azimuth?: number
  elevation?: number
  raw: string
  timestamp: number
}


Interne Polling-Funktion:

z.B. alle 500–1000 ms C2\r senden und Status aktualisieren.

Polling start/stop steuerbar.




---

6. IPC zwischen Main und Renderer

Datei: src/main/ipcHandlers.ts
Datei: src/preload/preload.ts

In ipcHandlers.ts

Registriere IPC-Kanäle:

rotor:listPorts → Liste verfügbarer Ports

rotor:connect → COM-Port + Optionen

rotor:disconnect

rotor:sendCommand → beliebiger Text, z.B. "C"

rotor:setAzimuth, rotor:setAzEl

rotor:control → "R", "L", "U", "D", "A", "E", "S"

rotor:startPolling, rotor:stopPolling

rotor:getCurrentStatus

Event-Kanal: rotor:statusUpdate (Main → Renderer, via webContents.send)



In preload.ts

Exponiere eine schlanke API nach window:


import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('rotor', {
  listPorts: () => ipcRenderer.invoke('rotor:listPorts'),
  connect: (config) => ipcRenderer.invoke('rotor:connect', config),
  disconnect: () => ipcRenderer.invoke('rotor:disconnect'),
  sendCommand: (cmd) => ipcRenderer.invoke('rotor:sendCommand', cmd),
  setAzimuth: (deg) => ipcRenderer.invoke('rotor:setAzimuth', deg),
  setAzEl: (az, el) => ipcRenderer.invoke('rotor:setAzEl', { az, el }),
  startPolling: (intervalMs) => ipcRenderer.invoke('rotor:startPolling', intervalMs),
  stopPolling: () => ipcRenderer.invoke('rotor:stopPolling'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('rotor:statusUpdate', (_, status) => callback(status))
  }
})

Im Renderer kann dann window.rotor.* verwendet werden.


---

7. Renderer-UI: Grundlayout

Datei: src/renderer/index.html

Layout-Idee (CSS Grid oder Flex):

Oben: Verbindungsleiste

Dropdown: COM-Port

Input: Baudrate

Button: Verbinden / Trennen

Statusanzeige (Connected / Disconnected)


Mitte links: Kompass

großer Kreis

N/O/S/W-Markierungen

drehbarer Pfeil oder „Beam“


Mitte rechts: Karte / Radar

stilisierter Kreis / Weltkarte / Richtungsrad

Linien / Sectoren optional


Unten links: Steuer-Panel

Buttons für:

Azimut: Links (L), Stop (A), Rechts (R)

Elevation: Runter (D), Stop (E), Hoch (U)

All Stop (S)


Numerische Eingabe:

Ziel-Azimut (0–360 bzw. 0–450)

Ziel-Elevation (0–90)

Buttons: „Goto AZ“, „Goto AZ/EL“



Unten rechts: Daten & History

Aktueller Azimut/Elevation (numerisch, groß)

Tabelle mit History (Zeit, Az, El)

Buttons: „History löschen“, „History als CSV exportieren“




---

8. Renderer-Logik: Einstiegspunkt

Datei: src/renderer/main.ts

Aufgaben:

DOM-Elemente referenzieren,

Event-Handler registrieren,

Verbindung zur window.rotor-API aufbauen,

Status-Updates an UI-Komponenten weiterleiten:

compass.update(azimuth)

mapView.update(azimuth, elevation)

historyLog.addEntry(status)


Beim Start:

Ports laden (rotor.listPorts()),

Standard-Baudrate setzen (z.B. 9600),

Polling nach erfolgreicher Verbindung starten (rotor.startPolling(1000)).




---

9. Kompass-Komponente

Datei: src/renderer/ui/compass.ts

Umsetzungsvorschlag:

Verwende SVG in index.html (oder dynamisch erzeugt):

Kreis

N/E/S/W-Texte

Pfeil als line oder polygon


update(azimuth: number):

transform: rotate(azimuth) auf der Pfeil-Gruppe anwenden

Mittelpunkt als Transformationszentrum setzen



Beispiel-API:

export class Compass {
  private needleElement: SVGElement

  constructor(rootElement: HTMLElement) {
    // needleElement via querySelector(...)
  }

  update(azimuth: number) {
    const normalized = (azimuth % 360 + 360) % 360
    this.needleElement.style.transform = `rotate(${normalized}deg)`
  }
}


---

10. Karten-/Radar-Ansicht

Datei: src/renderer/ui/mapView.ts

Ziel: einfache Visualisierung der Richtung, nicht Google Maps.

Variante:

Kreis als „Radar“,

Rasterlinien,

Punkt oder Linie in Richtung des aktuellen Azimuts,

optional: Elevation als Farbe oder Radius.


API:

export class MapView {
  constructor(rootElement: HTMLElement) { /* Setup Canvas oder SVG */ }

  update(azimuth: number, elevation?: number) {
    // Richtungslinie zeichnen / Element rotieren
  }
}

Wenn Canvas benutzt wird:

Bei jedem Update Canvas clearen,

Kreis, Hilfslinien, Richtung zeichnen.



---

11. History & CSV-Export

Datei: src/renderer/ui/historyLog.ts

Aufgaben:

Interne Liste:

interface HistoryEntry {
  timestamp: number
  azimuth?: number
  elevation?: number
  raw: string
}

Methoden:

addEntry(status: RotorStatus)

clear()

exportCsv() -> string (oder direkt Download triggern)



CSV-Format:

timestamp_iso;azimuth_deg;elevation_deg;raw
2025-11-19T12:34:56.789Z;123;45;AZ=123 EL=045
...

Im UI:

exportCsv() erstellt eine Blob und triggert a.download.



---

12. GS-232B-Befehlspanel

Datei: src/renderer/ui/controls.ts

Buttons verbinden mit window.rotor.controlXYZ(), z.B.:

btnAzLeft → rotor.sendCommand("L")

btnAzRight → rotor.sendCommand("R")

btnAzStop → rotor.sendCommand("A")

btnElUp → rotor.sendCommand("U")

btnElDown → rotor.sendCommand("D")

btnElStop → rotor.sendCommand("E")

btnAllStop → rotor.sendCommand("S")


Formular für Goto:

Input: azInput, elInput

„Goto AZ“: rotor.setAzimuth(parseFloat(azInput.value))

„Goto AZ/EL“: rotor.setAzEl(az, el)


Validierung:

Azimut 0–360 oder 0–450 (abhängig vom Modus, in Settings speicherbar)

Elevation 0–90




---

13. Konfiguration speichern

Datei: src/renderer/services/configStore.ts

Einfacher Ansatz: JSON-Datei im UserData-Verzeichnis (via IPC in Main gespeichert) oder localStorage.

Zu speichern:

letzter COM-Port

Baudrate

Azimutmodus (360/450)

Polling-Intervall



API-Beispiel:

interface AppConfig {
  portPath?: string
  baudRate: number
  azimuthMode: 360 | 450
  pollingIntervalMs: number
}


---

14. Test-Modus ohne Hardware

Ergänze optional einen „Simulation Mode“:

Konfigurationsoption simulation: boolean.

Wenn aktiv:

anstelle des echten SerialManager einen Mock verwenden, der auf Kommandos mit simulierten Antworten reagiert:

C2\r → z.B. AZ=123 EL=045

Azimut in kleinen Schritten verändern.



So kann GUI entwickelt/getestet werden, ohne Rotor angeschlossen zu haben.



---

15. Fehlerbehandlung & Robustheit

Wenn COM-Port getrennt wird:

Status „Disconnected“ anzeigen,

Polling stoppen,

Buttons (bis auf Connect) deaktivieren.


Bei Exceptions / Serial-Fehlern:

Fehlermeldung im UI anzeigen

Option „Reconnect“ anbieten.


Eingaben (Grad-Werte) stets validieren und bei Ungültigkeit Fehlermeldung anzeigen.



---

16. Build zur Windows-EXE

Nutze electron-builder.

1. Stelle sicher, dass main in package.json auf das gebaute Main-Script zeigt.


2. electron-builder.yml oder build-Key in package.json wie oben konfigurieren.


3. Build:

npm run dist


4. Erwartetes Ergebnis:

Im release/-Ordner liegt ein Installer (z.B. RotorControl Setup 1.0.0.exe)

Nach Installation ist RotorControl als normale Windows-Anwendung nutzbar.





---

17. Akzeptanzkriterien

Der Coding-Agent soll so lange iterieren, bis folgende Punkte erfüllt sind:

1. Anwendung startet ohne Fehler, öffnet ein Fenster mit:

Verbindungsleiste (Port/ Baudrate)

Kompass

Karten-/Radar-View

Steuer-Panel

Status-/Historybereich



2. Serielle Verbindung:

COM-Port kann ausgewählt werden

Verbindung wird aufgebaut

Senden von Befehlen (z.B. C\r) führt zu Empfang von Antworten

Antworten werden korrekt geparst (Azimut/Elevation)



3. Visualisierung:

Kompass aktualisiert sich sichtbar bei Änderung des Azimuts

Karten-/Radar-View zeigt die Richtung konsistent



4. Steuerung:

Buttons für R/L/A/U/D/E/S senden die richtigen Kommandos

„Goto AZ“ und „Goto AZ/EL“ bewegt den Rotor auf die Zielwerte (sofern Gerät das unterstützt)



5. History & Export:

Jede Status-Aktualisierung (Polling) erzeugt einen Eintrag in der History

Export erzeugt eine valide CSV-Datei



6. Packaging:

Der Buildprozess erzeugt eine funktionsfähige .exe, die auf einem frischen Windows-System ohne Node-Installation läuft. Die github Actions soll einen installer bauen mit dem die exe dann installiert werden kann 
