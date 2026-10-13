@echo off
REM Inicia el mostrador: servidor local + pantalla del vendedor + pantalla del cliente.
REM Ajustá SEGUNDO_MONITOR_X al ancho en píxeles del monitor principal.
set SEGUNDO_MONITOR_X=1920
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

cd /d "%~dp0"
if not exist node_modules call npm install
if not exist dist call npm run build

REM Si el servidor ya esta abierto no se inicia otro; despues espera a que responda antes de abrir Chrome.
set URL=http://localhost:3000
curl -s -o nul %URL%/vendedor && goto abrir
start "Servidor Mostrador" /min node server\index.js
set INTENTOS=0
:esperar
timeout /t 1 /nobreak >nul
curl -s -o nul %URL%/vendedor && goto abrir
set /a INTENTOS+=1
if %INTENTOS% lss 60 goto esperar
echo El servidor no respondio despues de 60 segundos. Revisa la ventana "Servidor Mostrador".
pause
exit /b 1

:abrir

start "" %CHROME% --new-window --app=%URL%/vendedor --start-maximized
start "" %CHROME% --user-data-dir="%LOCALAPPDATA%\MostradorPantallaCliente" --window-position=%SEGUNDO_MONITOR_X%,0 --kiosk --no-first-run %URL%/cliente
