MediaDownloader v0.6.0 — Windows x64

Cette archive est légère (moins de 1 Mo) et ne contient aucun programme tiers : l'installateur télécharge
Deno, yt-dlp et FFmpeg (environ 270 Mo au total) dans le dossier tools\bin. Il faut donc une connexion Internet
pendant l'installation. Aucun droit administrateur n'est nécessaire.

Contenu de l'archive :
- MediaDownloader.Cli.bat : CLI et hôte de messagerie native (lanceur du moteur TypeScript).
- engine : le moteur (TypeScript, exécuté par Deno).
- Installer.bat, Desinstaller.bat : installation et désinstallation.
- mediadownloader.xpi : extension Firefox.
- mediadownloader-chromium.zip : extension pour Opera, Chrome et Brave (chargement manuel).
- README.txt : cette notice.
Après l'installation s'ajoute tools\bin (deno.exe, yt-dlp.exe, ffmpeg.exe) et tools\deno-cache.

Installation :
  1. Décompresser l'archive dans un dossier à conserver (pas de virgule dans le chemin).
  2. Double-cliquer sur Installer.bat : il télécharge et vérifie (SHA-256) les trois outils, enregistre l'hôte natif
     puis ouvre l'extension dans Firefox.
  3. Firefox s'ouvre sur mediadownloader.xpi : acceptez l'installation.

Le dossier est portable : tout reste dedans, rien n'est écrit ailleurs (hors enregistrement de l'hôte natif dans le
registre de l'utilisateur). Si vous le déplacez, relancez Installer.bat.

Firefox connecté à YouTube est utilisé automatiquement lorsque la vidéo exige une session valide.

Diagnostic :
  MediaDownloader.Cli.bat doctor

En cas de problème :
- « Deno est introuvable » ou code de sortie 3 : relancez Installer.bat (connexion Internet requise, proxy compris).
- L'installateur refuse un chemin contenant une virgule : déplacez le dossier.
- Si une commande est exécutée automatiquement à chaque ouverture de cmd.exe (clé de registre « AutoRun ») et affiche du
  texte, elle corrompt la communication avec Firefox : supprimez-la ou faites-la rester silencieuse. Non vérifié sur
  une machine qui en possède une.
- Les outils téléchargés sont dans tools\bin ; vous pouvez les supprimer, Installer.bat les retélécharge.
- L'étape 2 exige System32\tar.exe (Windows 10 1803 ou plus). Choisissez un dossier d'installation au chemin court :
  l'extraction de FFmpeg peut dépasser la limite MAX_PATH.
- Proxy : l'étape 1 utilise le proxy système de Windows ; seule l'étape 2 utilise la variable HTTPS_PROXY.
- Un échec à l'étape 2 peut laisser un deno.exe déjà vérifié dans tools\bin ; relancer Installer.bat reprend.
- La commande « update » (yt-dlp -U) remplace le yt-dlp épinglé : une vérification ultérieure verra une autre somme
  SHA-256 ; relancer Installer.bat restaure la version épinglée.
- Le sélecteur de dossier est la boîte classique en arborescence (PowerShell), plus lente à s'ouvrir, et peut échouer
  (pick_failed) en mode de langage restreint ; le chemin reste saisissable à la main.
- Appelants programmatiques : ne passez jamais de chaîne non fiable par le .bat ; lancez tools\bin\deno.exe avec un
  tableau d'arguments (voir docs/CLI_PROTOCOL.md).

Opera, Chrome, Brave : l'installation enregistre aussi l'hôte natif. Décompressez mediadownloader-chromium.zip
dans un dossier à conserver, ouvrez opera://extensions, chrome://extensions ou brave://extensions, activez le mode
développeur, puis « Charger l'extension non empaquetée » et choisissez ce dossier. Non vérifié sur Opera sous Windows réel.

Désinstallation : lancer Desinstaller.bat, puis supprimer l'extension dans about:addons et le dossier.

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md dans le dépôt.

LICENCES

Cette archive ne contient aucun binaire GPL : l'installateur télécharge les outils depuis leurs sources officielles,
avec une somme SHA-256 épinglée (engine/deps.json).
- FFmpeg : build BtbN/FFmpeg-Builds autobuild-2026-11-03-12-50, variante « gpl » (ffmpeg N-128352-gec887b13a8,
  compilé avec --enable-gpl --enable-version3, donc sous GPL version 3 ou ultérieure). Code source correspondant :
  commit ec887b13a88afbaf44fb28c3045bda5d434da8dc de https://github.com/FFmpeg/FFmpeg ; recette de compilation :
  https://github.com/BtbN/FFmpeg-Builds au même tag autobuild-2026-11-03-12-50.
- yt-dlp 2026.10.26 : licence Unlicense (https://github.com/yt-dlp/yt-dlp).
- Deno 2.9.8 : téléchargé depuis https://github.com/denoland/deno/releases ; sa licence n'a pas été vérifiée ici.
Non vérifié : les licences des bibliothèques tierces intégrées au build de FFmpeg ; consultez
https://ffmpeg.org/legal.html et le dépôt BtbN/FFmpeg-Builds.
