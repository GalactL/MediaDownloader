MediaDownloader v0.2.0 — Linux x64

Cette version fournit le CLI et Deno (dans tools/bin). Installez yt-dlp et FFmpeg
avec le gestionnaire de paquets de votre distribution. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

Extension Firefox (messagerie native) :
  ./MediaDownloader.Cli install-host
