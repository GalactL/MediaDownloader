MediaDownloader v0.6.0 — Linux x64

Cette archive est légère (moins de 1 Mo) et ne contient aucun programme tiers : install.sh télécharge
Deno, yt-dlp et FFmpeg (environ 240 Mo au total) dans le dossier tools/bin. Il faut donc une connexion Internet
pendant l'installation (curl ou wget, et unzip, python3 ou bsdtar, sont requis). Aucun droit administrateur n'est nécessaire.

Contenu de l'archive :
- MediaDownloader.Cli : CLI et hôte de messagerie native (lanceur du moteur TypeScript).
- engine : le moteur (TypeScript, exécuté par Deno).
- install.sh, uninstall.sh : installation et désinstallation.
- mediadownloader.xpi : extension Firefox.
- mediadownloader-chromium.zip : extension pour Opera, Chrome et Brave (chargement manuel).
- README.txt : cette notice.
Après l'installation s'ajoute tools/bin (deno, yt-dlp, ffmpeg) et tools/deno-cache.

Installation :
  1. Décompresser l'archive (tar xzf, qui conserve le bit exécutable) dans un dossier à conserver, sans virgule dans le chemin.
  2. Lancer ./install.sh : il télécharge et vérifie (SHA-256) les trois outils, enregistre l'hôte natif
     puis ouvre l'extension dans Firefox.
  3. Firefox s'ouvre sur mediadownloader.xpi : acceptez l'installation.

Le dossier est portable : tout reste dedans, rien n'est écrit ailleurs (hors enregistrement de l'hôte natif dans
~/.mozilla et ~/.config). Si vous le déplacez, relancez ./install.sh.

Si les scripts ne sont pas exécutables (archive recompressée) :
  chmod +x install.sh uninstall.sh MediaDownloader.Cli

Firefox connecté à YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Diagnostic :
  ./MediaDownloader.Cli doctor

Sans --output, les vidéos sont enregistrées dans ~/Videos.

En cas de problème :
- « Deno est introuvable » ou code de sortie 3 : relancez ./install.sh (connexion Internet requise ; derrière un
  proxy, définissez https_proxy / HTTPS_PROXY).
- Seul Linux x86_64 est pris en charge.
- Les outils téléchargés sont dans tools/bin ; vous pouvez les supprimer, install.sh les retélécharge.

Opera, Chrome, Brave : l'installation enregistre aussi l'hôte natif. Décompressez mediadownloader-chromium.zip
dans un dossier à conserver, ouvrez opera://extensions, chrome://extensions ou brave://extensions, activez le mode
développeur, puis « Charger l'extension non empaquetée » et choisissez ce dossier. Non vérifié sur Opera sous Windows réel.

Désinstallation : lancer ./uninstall.sh, puis supprimer l'extension dans about:addons et le dossier.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md dans le dépôt.

LICENCES

Cette archive ne contient aucun binaire GPL : install.sh télécharge les outils depuis leurs sources officielles,
avec une somme SHA-256 épinglée (engine/deps.json).
- FFmpeg : build BtbN/FFmpeg-Builds autobuild-2026-11-03-12-50, variante « gpl » (ffmpeg N-128352-gec887b13a8,
  compilé avec --enable-gpl --enable-version3, donc sous GPL version 3 ou ultérieure). Code source correspondant :
  commit ec887b13a88afbaf44fb28c3045bda5d434da8dc de https://github.com/FFmpeg/FFmpeg ; recette de compilation :
  https://github.com/BtbN/FFmpeg-Builds au même tag autobuild-2026-11-03-12-50.
- yt-dlp 2026.10.26 : licence Unlicense (https://github.com/yt-dlp/yt-dlp).
- Deno 2.9.8 : licence MIT (https://github.com/denoland/deno).
Non vérifié : les licences des bibliothèques tierces intégrées au build de FFmpeg ; consultez
https://ffmpeg.org/legal.html et le dépôt BtbN/FFmpeg-Builds.
