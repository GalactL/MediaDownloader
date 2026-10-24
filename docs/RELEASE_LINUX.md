MediaDownloader v0.2.0 — Linux x64

Cette version fournit le CLI et Deno (dans tools/bin). Installez yt-dlp et FFmpeg
avec le gestionnaire de paquets de votre distribution. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- tools/bin : deno (moteur JavaScript pour YouTube).
- README.txt : cette notice.

Installation :
  1. Décompresser l'archive.
  2. Exécuter : ./MediaDownloader.Cli install-host
  3. Glisser mediadownloader.xpi dans une fenêtre Firefox.

Rendez le programme exécutable si nécessaire :
  chmod +x MediaDownloader.Cli

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
