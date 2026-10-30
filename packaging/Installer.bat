@echo off
chcp 65001 >nul
set "DIR=%~dp0"
echo Installation de MediaDownloader...
"%DIR%MediaDownloader.Cli.exe" install-host
if errorlevel 1 (
  echo.
  echo Echec de l'installation de l'hote. Verifiez que MediaDownloader.Cli.exe est dans le meme dossier que ce script.
  pause
  exit /b 1
)
echo.
echo Ouverture de l'extension dans Firefox : acceptez l'installation quand Firefox le demande.
if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" (
  start "" "%ProgramFiles%\Mozilla Firefox\firefox.exe" "%DIR%mediadownloader.xpi"
) else if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" (
  start "" "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" "%DIR%mediadownloader.xpi"
) else (
  start "" "%DIR%mediadownloader.xpi"
)
echo.
echo Ne deplacez pas ce dossier ensuite ; sinon relancez Installer.bat.
pause
