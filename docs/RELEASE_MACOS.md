MediaDownloader v0.2.0 — macOS

Cette version fournit le CLI et Deno (dans tools/bin). Installez le reste avec Homebrew :
  brew install yt-dlp ffmpeg

Firefox connecté à YouTube est utilisé automatiquement lorsque la vidéo exige
une session valide.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

Extension Firefox (messagerie native) :
  ./MediaDownloader.Cli install-host

Extension Firefox signée : mediadownloader.xpi (voir docs/EXTENSION_SIGNATURE.md).
