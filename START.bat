@echo off
cd /d "%~dp0"
title WiFiCall
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js install nahi hai. README_URDU.txt mein installation ka tareeqa dekhein.
 pause
 exit /b
)
if not exist node_modules (
 echo Pehli dafa zaroori files download ho rahi hain...
 call npm install
 if errorlevel 1 pause & exit /b
)
echo WiFiCall server shuru ho raha hai...
call npm start
pause
