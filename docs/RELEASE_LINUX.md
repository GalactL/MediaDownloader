MediaDownloader v0.3.2 — Linux x64

Cette archive est autonome : elle fournit le CLI, yt-dlp, FFmpeg, FFprobe et Deno
(dans tools/bin). Aucune installation supplémentaire n'est nécessaire. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- tools/bin : yt-dlp, ffmpeg, ffprobe et deno (moteur JavaScript pour YouTube).
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

Licences : ffmpeg et ffprobe sont un build statique GPL (BtbN/FFmpeg-Builds),
redistribué sous licence GPL. Sources et licence : https://github.com/BtbN/FFmpeg-Builds
et https://ffmpeg.org/legal.html. yt-dlp est publié sous licence Unlicense
(https://github.com/yt-dlp/yt-dlp).

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
