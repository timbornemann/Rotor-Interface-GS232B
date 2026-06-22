@echo off
setlocal
cd /d "%~dp0.."
python example_api_usecase\client_gui.py
if errorlevel 1 (
  echo.
  echo Die Client-GUI konnte nicht gestartet werden. Ist Python installiert und im PATH?
  pause
)
