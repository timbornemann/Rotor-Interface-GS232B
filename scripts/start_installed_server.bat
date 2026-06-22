@echo off
setlocal

set "APP_DIR=%~dp0.."
for %%I in ("%APP_DIR%") do set "APP_DIR=%%~fI"

set "SERVER_EXE=%APP_DIR%\server\RotorServer.exe"
set "SERVER_ROOT=%APP_DIR%\src\renderer"
set "CONFIG_DIR=%ProgramData%\Rotor Interface GS232B Server\data"

echo ========================================
echo Rotor Interface GS232B - Server
echo ========================================
echo.

if not exist "%SERVER_EXE%" (
    echo FEHLER: RotorServer.exe wurde nicht gefunden:
    echo   %SERVER_EXE%
    echo.
    pause
    exit /b 1
)

if not exist "%SERVER_ROOT%\index.html" (
    echo FEHLER: Weboberflaeche wurde nicht gefunden:
    echo   %SERVER_ROOT%
    echo.
    pause
    exit /b 1
)

if not exist "%CONFIG_DIR%" (
    mkdir "%CONFIG_DIR%" >nul 2>&1
)

:restart_loop
echo Beende eventuell laufende alte RotorServer-Prozesse...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$exe = [System.IO.Path]::GetFullPath('%SERVER_EXE%'); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'RotorServer.exe' -and $_.ExecutablePath -eq $exe } | ForEach-Object { Write-Host ('Beende alten Server-Prozess (PID {0})...' -f $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

echo.
echo Server wird initialisiert...
echo   Konfiguration: %CONFIG_DIR%
echo   Weboberflaeche: %SERVER_ROOT%
echo.
echo Web-Interface:
echo   http://localhost:8081
echo API-Dokumentation:
echo   http://localhost:8081/api/docs
echo ========================================
echo.

"%SERVER_EXE%" --port 8081 --websocket-port 8082 --config-dir "%CONFIG_DIR%" --server-root "%SERVER_ROOT%"
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="42" (
    echo.
    echo ========================================
    echo Server wird neu gestartet...
    echo ========================================
    timeout /t 2 /nobreak >nul
    echo.
    goto restart_loop
)

if "%EXIT_CODE%"=="0" (
    echo.
    echo Server wurde normal beendet.
) else (
    echo.
    echo Server wurde mit Fehler beendet (Code: %EXIT_CODE%)
)

echo.
pause
