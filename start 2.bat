@echo off
title NRLDC Schedule Discrepancy Portal
echo ==============================================================
echo    NRLDC SCHEDULE DISCREPANCY MONITORING PORTAL LAUNCHER
echo ==============================================================
echo.
echo [1/3] Installing backend dependencies...
cd server
call npm install
cd ..

echo.
echo [2/3] Installing frontend dependencies...
call npm install

echo.
echo [3/3] Starting Backend (port 3001) + Frontend (port 5173)...
echo        Backend logs will appear in this window.
echo        Open http://localhost:5173 in your browser.
echo.
call npm run dev:all
pause
