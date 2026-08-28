@echo off
cd /d "%~dp0"
setlocal

if not exist ".venv\Scripts\python.exe" (
  echo [LOI] Chua co moi truong ao. Chay "setup.bat" truoc.
  pause
  exit /b 1
)

REM Bo nho dem model dat NGAY TRONG thu muc dich vu (~600MB), khong de roi vao
REM C:\Users\...\.cache. May dev thuong het cho o C: nhung con nhieu o o chua
REM repo. Da co HF_HOME rieng thi ton trong lua chon do.
if not defined HF_HOME set HF_HOME=%~dp0.hf-cache

echo Dang khoi dong clip-service tren cong 8001...
echo (lan chay dau se tai model CLIP ~600MB)
.venv\Scripts\python.exe main.py
