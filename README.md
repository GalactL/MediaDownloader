# MediaDownloader

Outil natif et indépendant de téléchargement et de conversion vidéo : un CLI, un
hôte de messagerie native et une extension (menu dans la page) pour Firefox, Opera, Chrome et Brave.

Le programme accepte une URL HTTP(S), télécharge la meilleure source compatible
avec la qualité demandée à l'aide de `yt-dlp`, puis peut réencoder la vidéo avec
FFmpeg afin de respecter une taille maximale (par exemple 10 Mo pour Discord).

## État du projet

La version 0.6.0 fournit un CLI pour Windows et Linux, avec des événements JSON ligne par
ligne exploitables par toute application appelante. Le protocole de sortie est inchangé, mais le point d'entrée a changé :
`MediaDownloader.Cli.exe` n'existe plus (changement incompatible pour les appelants du CLI, dont HUB, à adapter ; appel
programmatique : voir [docs/CLI_PROTOCOL.md](docs/CLI_PROTOCOL.md)), ainsi que l'extension Firefox, l'extension Chromium et leur hôte natif. Les modifications non publiées
(moteur TypeScript sur Deno, installateur qui télécharge les dépendances, macOS retiré) sont décrites dans le
[CHANGELOG](CHANGELOG.md). L'extension ajoute un bouton de téléchargement sur
YouTube (vidéos et Shorts), X (Twitter), TikTok et Instagram ; le CLI accepte toute URL HTTP(S). Ces sites sont pris en
charge dans la mesure où la version installée de `yt-dlp` les prend en charge et
où le contenu est accessible sans contourner de DRM.

## Plateformes de la v0.6.0

- Windows x64 et Linux x64 : CLI, hôte de messagerie native, extension Firefox et extension Chromium (Opera, Chrome, Brave).
- macOS n'est plus pris en charge (ni moteur, ni archive, ni installateur).
- Linux : testé en CI seulement (tests du moteur) ; installateur, lanceur et Firefox non vérifiés sur machine Linux réelle.
  Prérequis : curl ou wget, unzip (ou python3 ou bsdtar), tar et xz (archive FFmpeg `.tar.xz`), sha256sum ou shasum, et un
  dossier temporaire où l'on peut exécuter des programmes (le binaire `yt-dlp_linux` se décompresse lui-même à l'exécution).
- Windows : l'installateur exige `System32\tar.exe` (Windows 10 1803 ou plus) et un dossier d'installation au chemin court
  (limite MAX_PATH lors de l'extraction de FFmpeg).

La release GitHub contient une archive et une notice distinctes pour chaque cible.

## Installation (release)

L'archive pèse moins de 1 Mo et ne contient aucun programme tiers : l'installateur télécharge Deno, yt-dlp et FFmpeg
(environ 270 Mo, versions et sommes SHA-256 épinglées dans `engine/deps.json`) dans `tools/bin`. Il faut donc une
connexion Internet (proxy : variables `https_proxy` / `HTTPS_PROXY` sous Linux). Aucun droit administrateur n'est requis.

1. Décompresser l'archive dans un dossier à conserver.
2. Windows : double-cliquer sur `Installer.bat`. Linux : exécuter `./install.sh`.
3. Firefox s'ouvre sur `mediadownloader.xpi` : accepter l'installation de l'extension.

Le dossier est portable : tout reste dedans. Si vous le déplacez, relancez l'installateur (le manifeste de l'hôte natif
contient son chemin). Désinstallation : `Desinstaller.bat` (Windows) ou `./uninstall.sh`, puis supprimer l'extension dans
`about:addons` et le dossier.

Contenu de l'archive :

```text
MediaDownloader.Cli.bat (Windows) ou MediaDownloader.Cli (Linux) : lanceur
engine/   le moteur TypeScript
Installer.bat, Desinstaller.bat (Windows) ; install.sh, uninstall.sh (Linux)
mediadownloader.xpi
mediadownloader-chromium.zip
README.txt
```

Après l'installation, `tools/bin/` contient `deno`, `yt-dlp` et `ffmpeg` (`.exe` sous Windows) et `tools/deno-cache/` le
cache de Deno.

### Dépannage

- Chemin du dossier : pas de virgule (Deno la traite comme séparateur de permissions) ; l'installateur le refuse avant de
  rien modifier. Une racine de disque (`D:\`) est gérée par l'installateur.
- Windows : une commande `AutoRun` de `cmd.exe` (clé de registre) qui affiche du texte corrompt la sortie du lanceur
  `.bat` et donc la communication avec Firefox. À supprimer ou à rendre silencieuse (non vérifié sur une machine qui en a une).
- Échec du téléchargement : un `deno` déjà vérifié peut rester dans `tools/bin` si l'échec survient à l'étape 2 ; vérifier la
  connexion et relancer. Proxy : l'étape 1 de `Installer.bat` utilise le proxy système de Windows, seule l'étape 2
  utilise `HTTPS_PROXY`.
- `update` (`yt-dlp -U`) remplace le yt-dlp épinglé : l'installateur ou `deps --check` verront ensuite une autre somme
  SHA-256 ; relancer l'installateur restaure la version épinglée.
- Windows : le sélecteur de dossier est la boîte classique en arborescence (PowerShell `FolderBrowserDialog`), plus lente à
  s'ouvrir, et peut échouer (`pick_failed`) en mode de langage restreint de PowerShell ; le chemin reste saisissable à la main.
- Code de sortie 3 au lancement : `tools/bin` est incomplet, relancer l'installateur.

### Opera, Chrome et Brave

`Installer.bat` / `./install.sh` enregistrent aussi l'hôte natif pour Opera, Chrome et Brave (`install-host`) ; en
revanche l'extension se charge à la main, car elle n'est pas publiée sur un store :

1. Décompresser `mediadownloader-chromium.zip` dans un dossier à garder (ne pas le supprimer ensuite).
2. Ouvrir la page des extensions : `opera://extensions` (Opera), `chrome://extensions` (Chrome) ou `brave://extensions` (Brave).
3. Activer le **mode développeur**, puis cliquer sur **Charger l'extension non empaquetée** et choisir le dossier décompressé.

L'identifiant de l'extension est fixe (clé publique dans le manifeste), ce qui permet à l'hôte natif de l'autoriser.
**Non vérifié** : le chargement et l'hôte natif n'ont pas encore été testés sur Opera sous Windows réel ; les emplacements
du manifeste et de la clé de registre pour Opera et Brave restent à confirmer (tous les emplacements plausibles sont écrits).

Signature de l'extension : [docs/EXTENSION_SIGNATURE.md](docs/EXTENSION_SIGNATURE.md).

### Licences

FFmpeg (build BtbN gpl, GPLv3 ou ultérieure) est téléchargé à l'installation, non redistribué dans l'archive ; sources et
recette : voir `docs/RELEASE_LINUX.md` (reprise dans `README.txt`). yt-dlp : Unlicense. Licence de Deno : non vérifiée ici (voir la notice).

## Prérequis et développement

Utilisateur : aucun, l'installateur fournit tout. Développeur : Deno (version de `engine/deps.json`) et Node.js 22+ pour
les tests de l'extension. Pour récupérer les outils dans une copie du dépôt (équivalent de l'installateur, vers `tools/bin`) :

```bash
deno run --no-check --allow-net --allow-read --allow-write --allow-run --allow-env=SystemRoot engine/deps.ts
```

Les outils sont recherchés, dans cet ordre :

1. chemins fournis avec `--yt-dlp` et `--ffmpeg` (`--ffprobe` est accepté et ignoré) ;
2. variables `MEDIADOWNLOADER_YTDLP` et `MEDIADOWNLOADER_FFMPEG` ;
3. dossier `tools/bin` voisin du lanceur ;
4. `PATH`.

Un runtime JavaScript (Deno, fourni, ou Node.js 22+) sert à résoudre les challenges YouTube.

L'extension (`extension/`, JavaScript pur) ne se compile pas : voir [extension/README.md](extension/README.md). `tools/make-chromium-zip.sh` produit `out/mediadownloader-chromium.zip`.

## Commandes

Sous Linux, le lanceur s'appelle `MediaDownloader.Cli` (`./MediaDownloader.Cli doctor`) ; les exemples utilisent le nom Windows.

Diagnostic des dépendances :

```powershell
MediaDownloader.Cli.bat doctor
```

`doctor` n'exige un runtime JavaScript que pour une URL YouTube (`doctor --url URL`).

Mise à jour de yt-dlp (`yt-dlp -U`, sortie relayée en événements `log`) :

```powershell
MediaDownloader.Cli.bat update
```

Inspection d'un lien :

```powershell
MediaDownloader.Cli.bat probe --url "https://www.youtube.com/watch?v=..."
```

Téléchargement en 1080p maximum :

```powershell
MediaDownloader.Cli.bat download --url "https://..." --quality 1080
```

Téléchargement limité à 10 Mo :

```powershell
MediaDownloader.Cli.bat download --url "https://..." --quality 1080 --max-size-mb 10
```

Téléchargement d'un extrait de 30 à 95,5 secondes :

```powershell
MediaDownloader.Cli.bat download --url "https://..." --start-time 30 --end-time 95.5
```

Les deux bornes doivent être fournies ensemble. La compression et la limite de
taille sont calculées à partir de la durée du fichier extrait.

Option `--low-resources` : FFmpeg tourne en priorité basse avec 2 threads (sans elle,
rien ne change).

Titre personnalisé et session YouTube connectée :

```powershell
MediaDownloader.Cli.bat download --url "https://..." --title "Mon titre" --cookies-from-browser edge
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

Firefox lance le lanceur (`MediaDownloader.Cli.bat` sous Windows, `MediaDownloader.Cli` sous Linux), qui exécute le moteur
avec Deno : le moteur reconnaît ce lancement (chemin du manifeste ou identifiant d'extension en premier argument) et
passe en mode `host`.

`MediaDownloader.Cli install-host` écrit le manifeste pour Firefox et, avec `allowed_origins`, pour Opera, Chrome et Brave (sous Windows, il
enregistre aussi les clés de registre `HKCU`). À relancer après un déplacement du dossier.

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
deno check engine/*.ts engine/test/*.ts tests/fake-tools/*.ts
deno test -A engine/test
node --test extension/test/*.test.js tools/fetch-signed-xpi.test.mjs
sh -n packaging/install.sh packaging/uninstall.sh packaging/MediaDownloader.Cli   # Linux
```
