# MediaDownloader

Outil natif et indépendant de téléchargement et de conversion vidéo : un CLI, un
hôte de messagerie native et une extension (menu dans la page) pour Firefox, Opera, Chrome et Brave.

Le programme accepte une URL HTTP(S), télécharge la meilleure source compatible
avec la qualité demandée à l'aide de `yt-dlp`, puis peut réencoder la vidéo avec
FFmpeg afin de respecter une taille maximale (par exemple 10 Mo pour Discord).

## État du projet

La version 0.4 fournit un CLI pour Windows et Linux, avec des événements JSON ligne par
ligne exploitables par toute application appelante (l'utilisation depuis HUB est inchangée),
ainsi que l'extension Firefox et son hôte natif. L'extension ajoute un bouton de téléchargement sur
YouTube (vidéos et Shorts), X (Twitter), TikTok et Instagram ; le CLI accepte toute URL HTTP(S). Ces sites sont pris en
charge dans la mesure où la version installée de `yt-dlp` les prend en charge et
où le contenu est accessible sans contourner de DRM.

## Plateformes de la v0.6.0

- Windows x64 et Linux x64 : CLI, hôte de messagerie native, extension Firefox et extension Chromium (Opera, Chrome, Brave).

La release GitHub contient une archive et une notice distinctes pour chaque cible.

## Installation (release)

1. Décompresser l'archive.
2. Windows : double-cliquer sur `Installer.bat`. Linux : exécuter `./install.sh`.
3. Firefox s'ouvre sur `mediadownloader.xpi` : accepter l'installation de l'extension.

Désinstallation : `Desinstaller.bat` (Windows) ou `./uninstall.sh`, puis supprimer l'extension dans `about:addons` et le dossier.

Contenu de l'archive :

```text
MediaDownloader.Cli(.exe)
Installer.bat, Desinstaller.bat (Windows) ; install.sh, uninstall.sh (Linux)
mediadownloader.xpi
mediadownloader-chromium.zip
tools/bin/   yt-dlp, ffmpeg, deno (Windows, Linux)
README.txt
```

### Opera, Chrome et Brave

`Installer.bat` / `./install.sh` enregistrent aussi l'hôte natif pour Opera, Chrome et Brave (`install-host`) ; en
revanche l'extension se charge à la main, car elle n'est pas publiée sur un store :

1. Décompresser `mediadownloader-chromium.zip` dans un dossier à garder (ne pas le supprimer ensuite).
2. Ouvrir la page des extensions : `opera://extensions` (Opera), `chrome://extensions` (Chrome) ou `brave://extensions` (Brave).
3. Activer le **mode développeur**, puis cliquer sur **Charger l'extension non empaquetée** et choisir le dossier décompressé.

L'identifiant de l'extension est fixe (clé publique dans le manifeste), ce qui permet à l'hôte natif de l'autoriser.
**Non vérifié** : le chargement et l'hôte natif n'ont pas encore été testés sur Opera sous Windows réel ; les emplacements
du manifeste et de la clé de registre pour Opera et Brave restent à confirmer (tous les emplacements plausibles sont écrits).

Sous Linux, l'archive est autonome : `yt-dlp`, `ffmpeg` (build statique GPL de BtbN/FFmpeg-Builds, redistribué sous licence GPL ; sources et licence : https://github.com/BtbN/FFmpeg-Builds et https://ffmpeg.org/legal.html) et `deno` sont dans `tools/bin`.
Sous Windows, ne pas déplacer le dossier après l'installation : le manifeste
contient son chemin. Signature de l'extension : [docs/EXTENSION_SIGNATURE.md](docs/EXTENSION_SIGNATURE.md).

## Prérequis

- compilateur C++20 et CMake 3.24+ pour compiler depuis les sources
- `yt-dlp` et `ffmpeg` (extensions `.exe` sous Windows)
- Node.js 22 ou plus récent, ou Deno 2.3+, pour résoudre les challenges JavaScript YouTube

Les outils sont recherchés, dans cet ordre :

1. chemins fournis avec `--yt-dlp` et `--ffmpeg` (`--ffprobe` est accepté et ignoré) ;
2. variables `MEDIADOWNLOADER_YTDLP` et `MEDIADOWNLOADER_FFMPEG` ;
3. dossier `tools/bin` voisin du projet ou de l'exécutable ;
4. `PATH`.

Pour les installer uniquement dans le projet :

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-dependencies.ps1
```

## Compilation Windows

```powershell
node tools/build-native.mjs
```

Le script nettoie également le doublon `Path`/`PATH` que certains environnements
d'automatisation transmettent à MSBuild. Une compilation CMake classique reste
possible depuis un terminal développeur Visual Studio.

La compilation génère :

- `build/Release/MediaDownloader.Cli.exe` : moteur en ligne de commande et hôte de messagerie native.

L'extension (`extension/`, JavaScript pur) ne se compile pas : voir [extension/README.md](extension/README.md). `tools/make-chromium-zip.sh` produit `out/mediadownloader-chromium.zip`.

Sous Linux :

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

## Commandes

Diagnostic des dépendances :

```powershell
MediaDownloader.Cli.exe doctor
```

`doctor` n'exige un runtime JavaScript que pour une URL YouTube (`doctor --url URL`).

Mise à jour de yt-dlp (`yt-dlp -U`, sortie relayée en événements `log`) :

```powershell
MediaDownloader.Cli.exe update
```

Inspection d'un lien :

```powershell
MediaDownloader.Cli.exe probe --url "https://www.youtube.com/watch?v=..."
```

Téléchargement en 1080p maximum :

```powershell
MediaDownloader.Cli.exe download --url "https://..." --quality 1080
```

Téléchargement limité à 10 Mo :

```powershell
MediaDownloader.Cli.exe download --url "https://..." --quality 1080 --max-size-mb 10
```

Téléchargement d'un extrait de 30 à 95,5 secondes :

```powershell
MediaDownloader.Cli.exe download --url "https://..." --start-time 30 --end-time 95.5
```

Les deux bornes doivent être fournies ensemble. La compression et la limite de
taille sont calculées à partir de la durée du fichier extrait.

Option `--low-resources` : FFmpeg tourne en priorité basse avec 2 threads (sans elle,
rien ne change).

Titre personnalisé et session YouTube connectée :

```powershell
MediaDownloader.Cli.exe download --url "https://..." --title "Mon titre" --cookies-from-browser edge
```

Pour une vidéo YouTube réservée aux adultes, le compte ouvert dans le navigateur
doit être connecté et avoir l'âge requis. MediaDownloader ne contourne pas la
restriction : il transmet à yt-dlp la session locale du navigateur sélectionné.
Il ne demande et n'enregistre jamais le mot de passe YouTube.

MediaDownloader reconnaît les domaines YouTube et ajoute silencieusement
`--cookies-from-browser firefox`. Aucun choix de navigateur n'est présenté dans
l'interface. Le programme ne lance pas Firefox et ne tente aucune reconnexion :
une session Firefox valide doit déjà exister sur le compte Windows.
Pour les autres sites (X, TikTok, Instagram…), aucun cookie n'est lu : une vidéo qui exige une connexion
ne peut pas être téléchargée et l'extension affiche un message d'erreur clair.

Sans `--output`, les fichiers finaux sont placés dans le dossier **Vidéos** de
Windows ou dans `~/Videos` sous Linux. Le dossier Windows est celui
indexé par la médiathèque Windows.

## Protocole

La sortie standard contient exclusivement des objets JSON, un par ligne. Les
messages de diagnostic non structurés des outils externes sont convertis en
événements `log`.

```json
{"type":"phase","stage":"inspection"}
{"type":"progress","stage":"download","percent":42.0}
{"type":"progress","stage":"encode","percent":71.0}
{"type":"completed","path":"C:\\Users\\Utilisateur\\Videos\\video.mp4","bytes":9853214}
```

`phase` est un événement facultatif (`inspection`, `download` ou `merge`) émis quand une
phase n'a pas de pourcentage ; `progress` garde toujours `percent`, avec `stage`
facultatif (et `pass` pour `encode`).

Les codes de sortie sont `0` en cas de réussite, `2` pour une erreur de saisie,
`3` lorsqu'un outil manque et `4` lorsqu'un traitement échoue.
Contrat complet : [docs/CLI_PROTOCOL.md](docs/CLI_PROTOCOL.md).

## Hôte natif (Firefox, Opera, Chrome, Brave)

`MediaDownloader.Cli host` dialogue avec une extension Firefox sur stdin/stdout
(messages JSON préfixés par leur longueur). Protocole :
[docs/NATIVE_HOST_PROTOCOL.md](docs/NATIVE_HOST_PROTOCOL.md).

Firefox lance directement l'exécutable : `MediaDownloader.Cli` reconnaît ce lancement
(chemin du manifeste ou identifiant d'extension en premier argument) et passe en mode `host`.

`MediaDownloader.Cli install-host` écrit le manifeste pour Firefox et, avec `allowed_origins`, pour Opera, Chrome et Brave (sous Windows, il
enregistre aussi les clés de registre `HKCU`). Il se relance après un déplacement de l'exécutable.

```text
MediaDownloader.Cli install-host
```

`MediaDownloader.Cli uninstall-host` fait l'inverse : il supprime tous les manifestes (et les clés de registre sous Windows).
Sans rien à retirer, il réussit quand même.

L'extension ajoute un bouton (le logo de MediaDownloader) dans la page : avant le groupe « J'aime / Je n'aime pas » sur YouTube, dans la
colonne d'actions des Shorts et de TikTok, dans la barre d'actions d'une publication X ou Instagram contenant une vidéo.
Le même menu permet de choisir la qualité, la taille maximale et un extrait. Détails par site (pages concernées,
permissions, sélecteurs de repli) : [extension/README.md](extension/README.md).

## Tests

```powershell
ctest --test-dir build -C Release --output-on-failure
node --test extension/test/*.test.js
```
