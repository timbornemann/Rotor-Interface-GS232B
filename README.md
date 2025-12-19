# Rotor-Interface GS232B

Browserbasierte Oberfläche zur Steuerung eines Yaesu GS-232B kompatiblen Rotors – wahlweise direkt im Browser (Simulation & Web Serial) oder per mitgeliefertem Python-Server für den Netzwerkzugriff. Die Anwendung kommt ohne Build-Tooling aus: HTML/CSS/JavaScript reichen.

---

## Inhalt

- [Hauptfunktionen](#hauptfunktionen)
- [Projektarchitektur](#projektarchitektur)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
  - [Simulation im Browser](#simulation-im-browser)
  - [Web-Serial-Zugriff](#web-serial-zugriff)
  - [Python-Server (Netzwerkbetrieb)](#python-server-netzwerkbetrieb)
  - [Alternative Dev-Server](#alternative-dev-server)
- [Bedienung](#bedienung)
  - [Ports & Verbindungen](#ports--verbindungen)
  - [Steuerung & Modi](#steuerung--modi)
  - [Historie & CSV-Export](#historie--csv-export)
  - [Persistente Einstellungen](#persistente-einstellungen)
- [API-Überblick](#api-überblick)
- [Konfiguration](#konfiguration)
- [Ordnerstruktur](#ordnerstruktur)
- [Weiterführende Doku](#weiterführende-doku)
- [Lizenz](#lizenz)

---

## Hauptfunktionen

- **Direktstart ohne Installation:** `src/renderer/index.html` per Doppelklick öffnen; Simulation läuft sofort.
- **Web Serial:** Zugriff auf echte USB-/COM-Ports in Chromium-Browsern (HTTPS oder `http://localhost`).
- **Python-Server für Remote-Zugriff:** Stellt API & COM-Port-Handling bereit, damit die Web-App im Netzwerk genutzt werden kann.
- **Simulation inklusive:** Realistische Rotor-Simulation ohne angeschlossene Hardware.
- **Live-Visualisierung:** Kompass, Radar-/Kartenansicht und Status aktualisieren sich mit jedem Polling.
- **Komplette Steuerung:** R/L/A, U/D/E, Stop sowie Goto-Azimut/Elevation, 360°/450°-Modus, Geschwindigkeitsvorgaben.
- **Historie & Export:** Polling-Daten werden mitgeschrieben und als CSV exportierbar.
- **Persistente Settings:** Port, Baudrate, Modus, Polling-Intervall usw. landen im `localStorage`.

---

## Projektarchitektur

```text
src/
  renderer/
    index.html      # Einstiegsseite (kann direkt im Browser geöffnet werden)
    styles.css      # Globales Styling
    main.js         # Bootstrapping & App-Logik
    assets/         # Icons & statische Assets
    services/       # Infrastruktur (Config-Store, INI-Handler, Rotor-Service WebSerial/Server)
    ui/             # UI-Komponenten (Kompass, Karte, Controls, History, Settings)
python_server.py   # Optionaler HTTP-Server + REST-API inkl. COM-Port-Management
rotor-config.ini   # Beispielkonfiguration für den Server
```

Kernidee: Die UI ist komplett clientseitig. Für Web Serial wird nur ein einfacher Webserver benötigt. Wenn die Anwendung von einem anderen Rechner aus genutzt wird, schaltet sie automatisch in den **Server-Modus** und spricht die API des Python-Servers an.

---

## Voraussetzungen

- **Browser:** Aktueller Chrome/Edge (oder ein anderer Chromium-Browser) für Web Serial. Für die reine Simulation genügt jeder moderne Browser.
- **Web Serial:** Erfordert HTTPS oder `http://localhost` und eine aktive User-Geste zum Öffnen des Ports.
- **Python-Server:** Python 3.9+ und optional `pyserial` für COM-Port-Zugriff (`pip install -r requirements.txt`).
- **Node/npm (optional):** Nur falls der alternative Dev-Server (`npm run serve`) genutzt wird; zur Laufzeit nicht nötig.

---

## Schnellstart

### Simulation im Browser

1. `src/renderer/index.html` per Doppelklick öffnen (oder `file://...` laden).
2. Simulation ist sofort aktiv; alle Bedienelemente funktionieren ohne Hardware.

### Web-Serial-Zugriff

Web Serial benötigt einen lokalen Webserver:

```bash
cd src/renderer
python -m http.server 4173
# oder: php -S localhost:4173
# oder: npm run serve
```

Danach `http://localhost:4173` im Browser öffnen und über **Port hinzufügen** einen COM-/USB-Port auswählen.

### Python-Server (Netzwerkbetrieb)

Der Python-Server liefert UI + API aus, verwaltet die COM-Ports und erlaubt Remote-Steuerung aus dem Netzwerk.

```bash
# Abhängigkeiten installieren (inkl. pyserial)
pip install -r requirements.txt

# Server starten (Standard-Port 8081)
python python_server.py --port 8081
```

Aufruf im Browser: `http://localhost:8081` oder aus dem LAN `http://<SERVER-IP>:8081`.

**Automatik:** Wird die Seite von einem anderen Rechner aus geöffnet, wechselt die App in den Server-Modus und nutzt die API, um Ports, Befehle und Status abzufragen.

### Alternative Dev-Server

- **PHP:** `php -S localhost:4173` in `src/renderer`
- **npm/http-server:** `npm install` & `npm run serve`

Hinweis: Die App benötigt kein Node.js zur Laufzeit – der Server wird nur für Web Serial oder Netzbetrieb verwendet.

---

## Bedienung

### Ports & Verbindungen

- **Simulation aktivieren:** Checkbox „Simulation“ wählen oder den simulierten Port in der Portliste auswählen.
- **Web Serial:** Über „Port hinzufügen“ einen Port freigeben, dann verbinden. Baudrate und Polling-Intervall lassen sich vor der Verbindung setzen.
- **Server-Modus:** Ports tragen den Präfix `[Server]`, Befehle/Status laufen über die API des Python-Servers.

### Steuerung & Modi

- **Bewegung:** R/L/A (Azimut), U/D/E (Elevation), S (Stop alles).
- **Goto:** Ziel-Azimut/Elevation eingeben und anfahren.
- **Modi:** 360°/450° per UI-Schalter (entspricht GS-232B `P36`/`P45`).
- **Geschwindigkeit:** Vorgabe für Azimut/Elevation (per UI, sendet die entsprechenden GS-232B Kommandos).

### Historie & CSV-Export

- Jeder Polling-Status (AZ/EL) landet in der History-Tabelle.
- Über **Export CSV** entsteht eine Datei im Format `timestamp_iso;azimuth_deg;elevation_deg;raw`.

### Persistente Einstellungen

- Port, Baudrate, Modus, Polling-Intervall, Anzeigepräferenzen usw. werden im `localStorage` gesichert und beim nächsten Start geladen.

---

## API-Überblick

Der Python-Server stellt eine schlanke REST-API bereit (ohne Authentifizierung; nur in vertrauenswürdigen Netzen einsetzen):

- `POST /api/commands` – Kommando speichern/weiterleiten
- `GET /api/commands` – bisherige Kommandos abrufen
- `GET /api/rotor/ports` – verfügbare COM-Ports auflisten
- `POST /api/rotor/connect` / `.../disconnect` – Port verbinden/trennen
- `POST /api/rotor/command` – GS-232B Befehl senden
- `GET /api/rotor/status` – letzten Status abrufen
- `GET /api/rotor/position` – (falls verfügbar) Position zurückgeben

Detailbeschreibung inkl. Beispiel-Requests: siehe **API_Dokumentation.md**.

---

## Konfiguration

- **Port/Key:** Standard-Port ist `8081`, API-Key ist in `python_server.py` hinterlegt (`DEFAULT_API_KEY`).
- **INI-Datei:** `rotor-config.ini` kann als Vorlage genutzt werden; `iniHandler.js` liest/aktualisiert die Werte im Client.
- **Polling:** Intervall in der UI einstellbar; History & CSV basieren auf diesen Polling-Werten.

---

## Ordnerstruktur

```text
GS232B_Befehle.md    # GS-232B Befehlsreferenz
API_Dokumentation.md # REST-API Dokumentation
Plan.md              # Projekt-Notizen/Planung
src/renderer/...     # UI, Services & Assets
python_server.py     # Statischer Server + API + COM-Port-Handling
requirements.txt     # Python-Abhängigkeiten (inkl. pyserial)
package.json         # Optionale Dev-Abhängigkeiten (http-server)
```

---

## Weiterführende Doku

- **API-Details:** [`API_Dokumentation.md`](API_Dokumentation.md)
- **GS-232B Befehle:** [`GS232B_Befehle.md`](GS232B_Befehle.md)
- **Hardware-Protokoll:** `GS232A.pdf` (Originalhandbuch)

---

## Lizenz

GPL-3.0-or-later – siehe [`LICENSE`](LICENSE).
