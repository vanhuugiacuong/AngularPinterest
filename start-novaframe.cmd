@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-novaframe.ps1" %*
if errorlevel 1 (
  echo.
  echo NovaFrame khoi dong that bai. Vui long xem thong bao ben tren.
  pause
)
