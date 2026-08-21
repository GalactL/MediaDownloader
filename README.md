# MediaDownloader

Moteur natif de téléchargement et de conversion vidéo destiné à être intégré à
l'onglet **Vidéos** de HUB.

Le programme accepte une URL HTTP(S), télécharge la meilleure source compatible
avec la qualité demandée à l'aide de `yt-dlp`, puis peut réencoder la vidéo avec
FFmpeg afin de respecter une taille maximale (par exemple 10 Mo pour Discord).

## État du projet

La version 0.1 fournit une application Windows ouvrable par double-clic ainsi
qu'une interface en ligne de commande pour Windows, macOS et Linux, avec des événements JSON ligne par
ligne pour une future intégration dans HUB. YouTube, TikTok et X sont pris en
charge dans la mesure où la version installée de `yt-dlp` les prend en charge et
où le contenu est accessible sans contourner de DRM.

## Interface graphique

Ouvrir `build/Release/MediaDownloader.exe`, puis :

1. coller le lien de la vidéo ;
2. choisir éventuellement un titre personnalisé pour le fichier ;
3. choisir la qualité et le format ;
4. conserver le préréglage Discord à 10 Mo ou désactiver la limite ;
5. cliquer sur **Télécharger**. Pour YouTube, la session Firefox locale est
   utilisée automatiquement, notamment pour les vidéos exigeant une confirmation d'âge.

Le moteur s'exécute sans fenêtre de console. La progression, les éventuelles
erreurs et le chemin du fichier final sont affichés dans l'application.

## Plateformes de la v0.1.0

- Windows x64 : interface graphique et CLI ;
- macOS Apple Silicon et Intel : CLI ;
- Linux x64 : CLI.

La release GitHub contient une archive et une notice distinctes pour chaque cible.

## Prérequis

- compilateur C++20 et CMake 3.24+ pour compiler depuis les sources
- `yt-dlp`, `ffmpeg` et `ffprobe` (extensions `.exe` sous Windows)
- Node.js 22 ou plus récent, ou Deno 2.3+, pour résoudre les challenges JavaScript YouTube

Les trois outils sont recherchés, dans cet ordre :

1. chemins fournis avec `--yt-dlp`, `--ffmpeg` et `--ffprobe` ;
2. variables `MEDIADOWNLOADER_YTDLP`, `MEDIADOWNLOADER_FFMPEG` et
   `MEDIADOWNLOADER_FFPROBE` ;
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

- `build/Release/MediaDownloader.exe` : application graphique ouvrable par double-clic ;
- `build/Release/MediaDownloader.Cli.exe` : moteur en ligne de commande pour HUB.

Sur macOS et Linux :

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

Sans `--output`, les fichiers finaux sont placés dans le dossier **Vidéos** de
Windows ou dans `~/Videos` sur macOS et Linux. Le dossier Windows reste celui
indexé par HUB.

## Contrat avec HUB

La sortie standard contient exclusivement des objets JSON, un par ligne. Les
messages de diagnostic non structurés des outils externes sont convertis en
événements `log`.

```json
{"type":"progress","stage":"download","percent":42.0}
{"type":"progress","stage":"encode","percent":71.0}
{"type":"completed","path":"C:\\Users\\Utilisateur\\Videos\\video.mp4","bytes":9853214}
```

Les codes de sortie sont `0` en cas de réussite, `2` pour une erreur de saisie,
`3` lorsqu'un outil manque et `4` lorsqu'un traitement échoue.

## Tests

```powershell
ctest --test-dir build -C Release --output-on-failure
```
