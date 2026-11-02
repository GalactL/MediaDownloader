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

Signature de l'extension : voir docs/EXTENSION_SIGNATURE.md.
