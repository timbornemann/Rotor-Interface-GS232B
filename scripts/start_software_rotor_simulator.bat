@echo off
setlocal
cd /d "%~dp0.."
python dev\software_test\gs232b_rotor_simulator.py
if errorlevel 1 (
  echo.
  echo Der Software-Rotor-Simulator konnte nicht gestartet werden.
  echo Pruefe, ob Python und pyserial installiert sind.
  pause
)
