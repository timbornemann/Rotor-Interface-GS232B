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

REM Auto-Restart-Loop: Startet Server neu, wenn Exit-Code 42 zurückgegeben wird
:restart_loop
REM Lese Ports aus web-settings.json (wenn vorhanden)
set HTTP_PORT=8081
set WS_PORT=8082

if exist "web-settings.json" (
    echo Lade Ports aus web-settings.json...
    for /f "tokens=*" %%a in ('powershell -Command "try { $config = Get-Content -Raw web-settings.json | ConvertFrom-Json; Write-Host $config.serverHttpPort } catch { Write-Host 8081 }"') do set HTTP_PORT=%%a
    for /f "tokens=*" %%b in ('powershell -Command "try { $config = Get-Content -Raw web-settings.json | ConvertFrom-Json; Write-Host $config.serverWebSocketPort } catch { Write-Host 8082 }"') do set WS_PORT=%%b
)

echo.
echo Server wird initialisiert...
echo   HTTP-Port: %HTTP_PORT%
echo   WebSocket-Port: %WS_PORT%
echo ========================================
echo.

python -m server.main --port %HTTP_PORT% --websocket-port %WS_PORT%
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE%==42 (
    echo.
    echo ========================================
    echo Server wird neu gestartet...
    echo ========================================
    timeout /t 2 /nobreak >nul
    echo.
    goto restart_loop
)

if %EXIT_CODE%==0 (
    echo.
    echo Server wurde normal beendet.
) else (
    echo.
    echo Server wurde mit Fehler beendet (Code: %EXIT_CODE%)
)

echo.
pause
