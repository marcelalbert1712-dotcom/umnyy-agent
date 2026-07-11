@echo off
title Vite Server (auto-restart)
cd /d "C:\Users\!!!~1\Documents\OPENCO~1\umnyy-agent"
:loop
echo [%date% %time%] Starting Vite...
node node_modules/vite/bin/vite.js
echo [%date% %time%] Vite crashed! Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop