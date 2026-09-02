@echo off
setlocal
echo ============================================================
echo   RLDC Portal - FRESH START
echo ============================================================
echo.
echo   This WIPES the entire database and creates ONE account:
echo.
echo       Username : admin@nldc
echo       Password : Password@123   (change it after signing in)
echo.
echo   All existing users, plants and discrepancies will be LOST.
echo   The five RLDC regions are recreated empty, ready for the
echo   national admin to appoint each region's administrator.
echo ============================================================
echo.
echo   Press Ctrl+C now to ABORT, or
pause
cd /d "%~dp0server"
node init_fresh.js --yes
echo.
echo Done. You can close this window.
pause
endlocal
