@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
REM Rotor Interface GS232B - Server Starter
REM Startet den Python-Server fuer die Rotor-Interface-Anwendung

echo ========================================
echo Rotor Interface GS232B - Server
echo ========================================
echo.

set "PYTHON_CMD="

REM Bevorzugt Python Launcher (neueste Python-3-Version), Fallback python3/python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"

if not defined PYTHON_CMD (
    python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python3"
)

if not defined PYTHON_CMD (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
    echo FEHLER: Python 3.10 oder hoeher ist erforderlich!
    echo.
    echo Gefundene Versionen:
    where py >nul 2>&1 && for /f "delims=" %%v in ('py -0p 2^>nul') do echo   %%v
    python --version >nul 2>&1 && for /f "delims=" %%v in ('python --version 2^>^&1') do echo   %%v ^(python^)
    python3 --version >nul 2>&1 && for /f "delims=" %%v in ('python3 --version 2^>^&1') do echo   %%v ^(python3^)
    echo.
    echo Hinweis: Wenn "py --version" 3.14 zeigt, aber "python" noch 3.7 ist,
    echo installieren Sie Python 3.10+ oder nutzen Sie nach dem Update dieses Skript.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('%PYTHON_CMD% -c "import sys; print(sys.version.split()[0])"') do set "PY_VERSION=%%v"
echo Verwende Python %PY_VERSION% ^(%PYTHON_CMD%^)
echo.

if not exist "server" (
    echo FEHLER: server/ Verzeichnis wurde nicht gefunden!
    echo Bitte pruefen Sie, ob die Projektstruktur vollstaendig ist.
    echo.
    pause
    exit /b 1
)

REM Auto-Restart-Loop: Startet Server neu, wenn Exit-Code 42 zurueckgegeben wird
:restart_loop
set HTTP_PORT=8081
set WS_PORT=8082

REM Beende haengende alte Rotor-Server-Prozesse (python -m server.main)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python(\.exe)?$' -and $_.CommandLine -match 'server\.main' } | ForEach-Object { Write-Host ('Beende alten Server-Prozess (PID {0})...' -f $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

if exist "data\web-settings.json" (
    echo Lade Ports aus data\web-settings.json...
    for /f "tokens=*" %%a in ('powershell -Command "try { $config = Get-Content -Raw data\web-settings.json | ConvertFrom-Json; Write-Host $config.serverHttpPort } catch { Write-Host 8081 }"') do set HTTP_PORT=%%a
    for /f "tokens=*" %%b in ('powershell -Command "try { $config = Get-Content -Raw data\web-settings.json | ConvertFrom-Json; Write-Host $config.serverWebSocketPort } catch { Write-Host 8082 }"') do set WS_PORT=%%b
)

echo.
echo Server wird initialisiert...
echo   HTTP-Port: %HTTP_PORT%
echo   WebSocket-Port: %WS_PORT%
echo.
echo API-Dokumentation:
echo   GET /api/openapi.json - OpenAPI 3.1 Spezifikation
echo     http://localhost:%HTTP_PORT%/api/openapi.json
echo   GET /api/docs - Swagger UI (interaktiv, inkl. "Try it out")
echo     http://localhost:%HTTP_PORT%/api/docs
echo   GET /api/redoc - ReDoc-Ansicht
echo     http://localhost:%HTTP_PORT%/api/redoc
echo ========================================
echo.

%PYTHON_CMD% -m server.main --port %HTTP_PORT% --websocket-port %WS_PORT%
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
