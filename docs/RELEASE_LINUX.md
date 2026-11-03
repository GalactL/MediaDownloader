MediaDownloader v0.6.0 — Linux x64

Cette archive est autonome : elle fournit le CLI, yt-dlp, FFmpeg et Deno
(dans tools/bin). Aucune installation supplémentaire n'est nécessaire. Firefox connecté à
YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- mediadownloader-chromium.zip : extension pour Opera, Chrome et Brave (chargement manuel).
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

Mode léger de l'extension Firefox (Firefox uniquement, YouTube, TikTok et X) : mediadownloader.xpi embarque
ffmpeg-core.wasm (@ffmpeg/core 0.12.10, FFmpeg compilé en WebAssembly avec des bibliothèques GPL, notamment
x264 et x265, ainsi que libvpx, LAME, Theora, Vorbis, Opus, zlib, libwebp, FreeType, FriBidi, libass et zimg).
Ce composant est distribué sous licence GPL (FFmpeg configuré avec --enable-gpl) : https://www.gnu.org/licenses/
et https://ffmpeg.org/legal.html. L'avis complet est aussi dans le .xpi (licenses/NOTICE-GPL.txt).

Offre écrite de sources : les sources de ce composant sont celles de ffmpeg.wasm, commit 71aa99d3
(« RELEASE: @ffmpeg/core and @ffmpeg/core-mt v0.12.10 »,
https://github.com/ffmpegwasm/ffmpeg.wasm/commit/71aa99d37c02a7b4c435275ca9ef50e612f6efa1), dont les scripts de
compilation téléchargent celles de FFmpeg, x264, x265 et des autres bibliothèques (sites officiels). L'archive
MediaDownloader-sources-<version>.tar.gz de la page de release ne contient que les sources de MediaDownloader (dont
tools/fetch-lite-assets.mjs, qui fixe l'adresse et la somme SHA-256 du composant), pas celles de FFmpeg, x264 ni
x265. Pendant au moins trois ans après la dernière distribution de cette version, vous pouvez demander une copie du
code source correspondant en ouvrant une issue sur le dépôt GitHub du projet.

Autres composants embarqués par le mode léger : Pyodide 314.0.7 (MPL-2.0, avec la bibliothèque standard CPython
sous licence PSF), yt-dlp (Unlicense), yt-dlp-ejs (Unlicense, avec meriyah sous ISC et astring sous MIT) et
QuickJS-ng 0.18.0 compilé en WASI (MIT).

Opera, Chrome, Brave : l'installation enregistre aussi l'hôte natif. Décompressez mediadownloader-chromium.zip
dans un dossier à conserver, ouvrez opera://extensions, chrome://extensions ou brave://extensions, activez le mode
développeur, puis « Charger l'extension non empaquetée » et choisissez ce dossier. Non vérifié sur Opera sous Windows réel.

Désinstallation : lancer ./uninstall.sh, puis supprimer l'extension dans about:addons et le dossier.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
