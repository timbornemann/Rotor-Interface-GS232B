@echo off
REM Rotor Interface GS232B - Server Starter
REM Startet den Python-Server für die Rotor-Interface-Anwendung

echo ========================================
echo Rotor Interface GS232B - Server
echo ========================================
echo.

REM Prüfe ob Python installiert ist
python --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Python ist nicht installiert oder nicht im PATH!
    echo Bitte installieren Sie Python 3.7 oder höher.
    echo.
    pause
    exit /b 1
)

REM Prüfe ob das server Verzeichnis existiert
if not exist "server" (
    echo FEHLER: server/ Verzeichnis wurde nicht gefunden!
    echo Bitte starten Sie die Datei aus dem Projektverzeichnis.
    echo.
    pause
    exit /b 1
)

echo Starte Server...
echo.
echo Server läuft auf: http://localhost:8081
echo Keine Authentifizierung erforderlich
echo.
echo Zum Beenden: Strg+C drücken
echo ========================================
echo.

REM Starte den Server mit Standard-Parametern
REM Nutzt das neue modulare Package
python -m server.main --port 8081

pause
