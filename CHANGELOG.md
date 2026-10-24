# Changelog

## Non publié

## v0.3.1 (2026-10-24)

- Correction de la vérification de somme de contrôle de Deno sur Windows (la release v0.3.0 n'a pas été publiée avec ses archives).

## v0.3.0 (2026-10-24)

- Détection automatique du lancement par Firefox : plus de script d'enveloppe, le manifeste pointe vers `MediaDownloader.Cli`.
- Commande `install-host` : écrit le manifeste de messagerie native (et la clé de registre sous Windows).
- Extension Firefox (`extension/`) avec menu dans la page : qualité, taille maximale, extrait, progression et annulation.
- Archive Linux x64 autonome : `yt-dlp` (binaire officiel, somme SHA-256 vérifiée), `ffmpeg` et `ffprobe` (build statique GPL de BtbN) inclus dans `tools/bin`. macOS exige toujours yt-dlp et FFmpeg (Homebrew).
- CI sur les pull requests (Windows, Linux, macOS) : compilation, tests natifs et tests de l'extension.
- Deno inclus dans `tools/bin` des archives de release.
- Empaquetage de `mediadownloader.xpi` dans chaque archive et signature Mozilla (canal non répertorié) lorsque les secrets sont définis.
- Installation en trois étapes : décompresser, `install-host`, glisser le `.xpi` dans Firefox.
- Suppression de l'interface graphique Win32 (`MediaDownloader.exe`) : l'extension Firefox la remplace. `MediaDownloader.Cli.exe` reste livré avec `tools/bin`.

## v0.2.0

- Nettoyage automatique et sûr des dossiers temporaires `.mediadownloader-*` orphelins.
- Journalisation des échecs de suppression des fichiers temporaires.
- Prise en charge des plages temporelles dans le CLI avec `--start-time` et `--end-time`.

## v0.1.0

- Initialisation du projet.
- Ajout du moteur natif en ligne de commande.
- Détection de `yt-dlp`, FFmpeg et ffprobe.
- Téléchargement avec sélection de résolution.
- Réencodage deux passes vers une taille maximale.
- Sortie JSON ligne par ligne pour l'intégration HUB.
- Ajout d'une application Windows graphique ouvrable par double-clic.
- Champs URL, qualité, format et taille maximale avec préréglage Discord 10 Mo.
- Progression, journal, erreurs et annulation dans l'interface.
- Séparation du moteur dans `MediaDownloader.Cli.exe`.
- Choix facultatif du titre du fichier final avec nettoyage des caractères Windows interdits.
- Authentification YouTube via la session Edge, Chrome, Firefox, Brave, Opera ou Vivaldi.
- Prise en charge des vidéos 18+ lorsque le compte local connecté possède l'accès requis.
- Détection automatique des liens YouTube et utilisation exclusive de la session Firefox locale.
- Suppression du choix manuel de navigateur dans l'interface.
- Activation automatique de Node ou Deno pour les challenges JavaScript YouTube.
- Portage du moteur CLI vers macOS et Linux.
- Ajout de quatre archives de release : Windows x64, Linux x64, macOS Intel et macOS Apple Silicon.
- Ajout d'une notice d'installation propre à chaque plateforme.
