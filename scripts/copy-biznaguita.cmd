@echo off
cd /d "%~dp0.."
node scripts\copy-biznaguita.js
echo EXITCODE=%ERRORLEVEL%
