MediaDownloader v0.4.0 — macOS

Cette version fournit le CLI et Deno (dans tools/bin). Installez le reste avec Homebrew :
  brew install yt-dlp ffmpeg

Firefox connecté à YouTube est utilisé automatiquement lorsque la vidéo exige
une session valide.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- install.sh, uninstall.sh : installation et désinstallation.
- tools/bin : deno (moteur JavaScript pour YouTube).
- README.txt : cette notice.

Installation :
  1. Décompresser l'archive.
  2. Lancer ./install.sh.
  3. Firefox s'ouvre sur mediadownloader.xpi : acceptez l'installation.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

Désinstallation : lancer ./uninstall.sh, puis supprimer l'extension dans about:addons et le dossier.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
