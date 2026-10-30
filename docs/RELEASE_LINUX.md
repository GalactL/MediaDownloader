MediaDownloader v0.5.0 — Linux x64

Cette archive est autonome : elle fournit le CLI, yt-dlp, FFmpeg et Deno
(dans tools/bin). Aucune installation supplémentaire n'est nécessaire. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- install.sh, uninstall.sh : installation et désinstallation.
- tools/bin : yt-dlp, ffmpeg et deno (moteur JavaScript pour YouTube).
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

Licences : ffmpeg est un build statique GPL (BtbN/FFmpeg-Builds),
redistribué sous licence GPL. Sources et licence : https://github.com/BtbN/FFmpeg-Builds
et https://ffmpeg.org/legal.html. yt-dlp est publié sous licence Unlicense
(https://github.com/yt-dlp/yt-dlp).

Désinstallation : lancer ./uninstall.sh, puis supprimer l'extension dans about:addons et le dossier.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
