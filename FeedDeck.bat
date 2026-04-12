@echo off
title FeedDeck

:: Find the directory this script lives in
cd /d "%~dp0"

:: Check if node_modules exists, install if not
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)

:: Kill any existing FeedDeck processes on ports 3000/3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING 2^>nul') do taskkill /PID %%a /F >nul 2>&1

:: Wait a beat then open the browser
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: Start both servers (this keeps the window alive)
call npm run dev
