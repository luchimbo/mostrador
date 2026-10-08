@echo off
REM Inicia el mostrador: servidor local + pantalla del vendedor + pantalla del cliente.
REM Ajustá SEGUNDO_MONITOR_X al ancho en píxeles del monitor principal.
set SEGUNDO_MONITOR_X=1920
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

cd /d "%~dp0"
if not exist node_modules call npm install
if not exist dist call npm run build

start "Servidor Mostrador" /min node server\index.js
timeout /t 3 /nobreak >nul

start "" %CHROME% --new-window --app=http://localhost:3000/vendedor --start-maximized
start "" %CHROME% --user-data-dir="%LOCALAPPDATA%\MostradorPantallaCliente" --window-position=%SEGUNDO_MONITOR_X%,0 --kiosk --no-first-run http://localhost:3000/cliente
