@echo off
cd /d "%~dp0"
setlocal

REM ---------------------------------------------------------------------------
REM Dung Python 3.12, KHONG dung "py" chung chung.
REM Ly do: torch==2.2.1 khong co goi cho Python 3.13/3.14. May nao cai san 3.14
REM ma goi "py -m venv" se tao venv 3.14 roi pip that bai giua chung, rat kho
REM doan ra nguyen nhan. Neu chua co 3.12, tai tai python.org/downloads.
REM ---------------------------------------------------------------------------
set PY=
for %%P in ("D:\Python312\python.exe" "C:\Python312\python.exe") do (
  if exist %%~P set PY=%%~P
)
if not defined PY (
  py -3.12 --version >nul 2>&1 && set PY=py -3.12
)
if not defined PY (
  echo [LOI] Khong tim thay Python 3.12.
  echo       Tai tai https://www.python.org/downloads/release/python-31210/
  echo       Torch 2.2.1 khong chay duoc tren Python 3.13/3.14.
  pause
  exit /b 1
)

echo Dung interpreter: %PY%
%PY% -m venv .venv
if errorlevel 1 ( echo [LOI] Tao venv that bai. & pause & exit /b 1 )

REM Bo nho dem dat NGAY TRONG thu muc dich vu, khong de o C:. Torch + model
REM chiem vai GB; nhieu may dev het cho o C: nhung con nhieu o o chua repo.
set PIP_CACHE_DIR=%~dp0.pip-cache

echo Dang cai torch, transformers... (vai tram MB, mat vai phut)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 ( echo [LOI] Cai thu vien that bai. & pause & exit /b 1 )

echo.
echo Xong! Chay "run.bat" de khoi dong clip-service.
pause
