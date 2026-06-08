@echo off
setlocal
cd /d "%~dp0"
python "%~dp0rotor_api_client\client_gui.py"
if errorlevel 1 (
  echo.
  echo Die Client-GUI konnte nicht gestartet werden. Ist Python installiert und im PATH?
  pause
)
