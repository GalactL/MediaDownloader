MediaDownloader v0.2.0 — Linux x64

Cette première version fournit le CLI. Installez yt-dlp, FFmpeg et Node.js ou
Deno avec le gestionnaire de paquets de votre distribution. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.
