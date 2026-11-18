@echo off
rem DPILS server kit: double-click to host your own Daugavpils server. Nothing to install.
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0launcher.mjs" %*
echo.
pause
