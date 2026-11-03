MediaDownloader v0.6.0 — Windows x64

Contenu de l'archive :
- MediaDownloader.Cli.exe : CLI et hôte de messagerie native.
- mediadownloader.xpi : extension Firefox.
- mediadownloader-chromium.zip : extension pour Opera, Chrome et Brave (chargement manuel).
- Installer.bat, Desinstaller.bat : installation et désinstallation.
- tools/bin : yt-dlp, ffmpeg et deno (moteur JavaScript pour YouTube).
- README.txt : cette notice.

Installation :
  1. Décompresser l'archive.
  2. Lancer un double-clic sur Installer.bat.
  3. Firefox s'ouvre sur mediadownloader.xpi : acceptez l'installation.

Ne déplacez pas le dossier après l'étape 2 ; sinon relancez-la.

 Firefox connecté à YouTube est utilisé automatiquement
lorsque la vidéo exige une session valide.

Opera, Chrome, Brave : l'installation enregistre aussi l'hôte natif. Décompressez mediadownloader-chromium.zip
dans un dossier à conserver, ouvrez opera://extensions, chrome://extensions ou brave://extensions, activez le mode
développeur, puis « Charger l'extension non empaquetée » et choisissez ce dossier. Non vérifié sur Opera sous Windows réel.

Désinstallation : lancer Desinstaller.bat, puis supprimer l'extension dans about:addons et le dossier.

Licences : yt-dlp est publié sous licence Unlicense (https://github.com/yt-dlp/yt-dlp). ffmpeg (build gyan.dev) est
redistribué sous licence GPL (https://www.gyan.dev/ffmpeg/builds/ et https://ffmpeg.org/legal.html).
Mode léger de l'extension Firefox (Firefox uniquement, YouTube, TikTok et X) : mediadownloader.xpi embarque
ffmpeg-core.wasm (@ffmpeg/core 0.12.10, FFmpeg compilé en WebAssembly avec des bibliothèques GPL, notamment
x264 et x265, ainsi que libvpx, LAME, Theora, Vorbis, Opus, zlib, libwebp, FreeType, FriBidi, libass et zimg).
Ce composant est distribué sous licence GPL (FFmpeg configuré avec --enable-gpl). Texte de la licence :
https://www.gnu.org/licenses/old-licenses/gpl-2.0.html ; informations légales de FFmpeg : https://ffmpeg.org/legal.html.

Offre de sources : le code source correspondant est fourni avec chaque version. L'archive
MediaDownloader-sources-<version>.tar.gz de la page de release contient les sources de MediaDownloader et le script
tools/fetch-lite-assets.mjs, qui fixe les adresses et les sommes SHA-256 exactes des composants embarqués. Les
sources amont de ffmpeg-core.wasm sont celles de https://github.com/ffmpegwasm/ffmpeg.wasm au tag v0.12.10
(scripts de compilation inclus) et des bibliothèques qu'il télécharge (FFmpeg, x264, x265, etc.), publiées sur
leurs sites officiels. Pendant au moins trois ans après la dernière distribution de cette version, vous pouvez
aussi en demander une copie en ouvrant une issue sur le dépôt GitHub du projet.

Autres composants embarqués par le mode léger : Pyodide 314.0.7 (MPL-2.0, avec la bibliothèque standard CPython
sous licence PSF), yt-dlp (Unlicense), yt-dlp-ejs (Unlicense, avec meriyah sous ISC et astring sous MIT) et
QuickJS-ng 0.18.0 compilé en WASI (MIT).

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
