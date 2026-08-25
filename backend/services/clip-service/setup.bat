@echo off
cd /d "%~dp0"
echo Dang tao Python virtual environment...
py -m venv venv
call venv\Scripts\activate.bat
echo Dang cai dat thu vien (torch, transformers...) - co the mat vai phut...
pip install -r requirements.txt
echo.
echo Xong! Chay "run.bat" de khoi dong clip-service.
pause
