MediaDownloader v0.2.0 — macOS

Cette première version fournit le CLI. Installez les dépendances avec Homebrew :
  brew install yt-dlp ffmpeg node

Firefox connecté à YouTube est utilisé automatiquement lorsque la vidéo exige
une session valide.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

Extension Firefox (messagerie native) :
  ./MediaDownloader.Cli install-host
