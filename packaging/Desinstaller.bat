@echo off
chcp 65001 >nul
set "DIR=%~dp0"
echo Desinstallation de MediaDownloader...
"%DIR%MediaDownloader.Cli.exe" uninstall-host
if errorlevel 1 (
  echo.
  echo Echec de la desinstallation de l'hote.
  pause
  exit /b 1
)
echo.
echo Hote retire. Il reste a :
echo   1. Supprimer l'extension dans Firefox : ouvrez about:addons, puis Extensions, MediaDownloader, Supprimer.
echo   2. Supprimer ce dossier.
pause
