# Changelog

## À venir

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
