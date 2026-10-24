MediaDownloader v0.2.0 — Windows x64

Contenu :
- MediaDownloader.Cli.exe : interface en ligne de commande et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.

yt-dlp, FFmpeg et Deno (moteur JavaScript pour YouTube) sont inclus dans
tools/bin. Firefox connecté à YouTube est utilisé automatiquement
lorsque la vidéo exige une session valide.

Extension Firefox (messagerie native) :
  MediaDownloader.Cli.exe install-host

Extension Firefox signée : mediadownloader.xpi (voir docs/EXTENSION_SIGNATURE.md).
