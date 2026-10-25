# Changelog

## Non publié

- Extension : le bouton flottant est remplacé par un bouton à icône seule (infobulle « Télécharger »), clone d'un bouton natif de la page vidéo YouTube (Partager…) inséré juste avant le groupe J'aime / Je n'aime pas, donc au style natif (thème, survol), posé dans un conteneur sans largeur : le bouton ne prend pas de place dans la barre et ne décale rien (ni la barre grise des « J'aime »). La boîte s'ouvre sous (ou au-dessus du) bouton et le suit au défilement ; elle se ferme quand le bouton sort de l'écran ; il est réinséré après navigation ou reconstruction de la barre, et disparaît avec le réglage « icône de la barre uniquement ». Si la structure de la page est introuvable, l'icône de la barre d'outils reste disponible. Les sélecteurs vivent dans des adaptateurs par site (`extension/sites.js`).
- Moteur : la progression du téléchargement fonctionne enfin. `--print` imposait `--quiet` à yt-dlp, qui n'émettait plus aucune ligne de progression : le moteur passe maintenant `--progress` et des `--progress-template` stables, et un nouvel événement facultatif `phase` (`inspection`, `download`, `merge`) signale les phases sans pourcentage. `progress` garde `percent` toujours présent (avec `stage` facultatif, et `pass` pour `encode`). Le pourcentage de téléchargement est lissé (vidéo puis audio, sans retour en arrière). Le format de `progress` existant est inchangé (voir `docs/CLI_PROTOCOL.md`).
- Moteur : option facultative `--low-resources` du CLI (champ `lowResources` de la requête `download` de l'hôte) : FFmpeg en priorité basse avec 2 threads. Sans elle, rien ne change.
- Extension : deux nouveaux réglages dans le panneau de réglages, conservés dans `storage.local` (aucune nouvelle permission) : « Optimiser l'application (économie de ressources) », désactivée par défaut (FFmpeg en priorité basse, animations réduites, plus de sondage en arrière-plan), et « Langue » (Automatique d'après la langue de Firefox, français ou anglais ; repli sur le français). Les animations sont aussi réduites quand Firefox demande `prefers-reduced-motion`.
- Extension : interface traduite avec un petit catalogue maison (`extension/i18n.js`, français et anglais) ; plus aucune chaîne visible codée en dur, les erreurs sont affichées à partir de `error.code`.
- Extension : la barre suit tout le job (une seule barre, téléchargement puis encodage) et le libellé indique la phase (Inspection, Téléchargement, Assemblage, Encodage passe 1/2) ; barre indéterminée sur les événements `phase` (statique et partielle en mode animations réduites), « Terminé » seulement à la fin réelle.

## v0.4.0 (2026-10-25)

- Extension : réglages dans le menu (engrenage) : dossier de téléchargement, thème clair ou sombre, affichage du bouton (sur la page ou icône de la barre d'outils uniquement). Les changements s'appliquent immédiatement.
- Moteur : un dossier de sortie inutilisable (fichier, droits, lecture seule) ne fait plus échouer le téléchargement, qui se replie sur le dossier Vidéos avec un avertissement ; nouvelle requête d'hôte `pickFolder` (sélecteur de dossier du système).
- Extension : icône MediaDownloader dans la barre d'outils, qui ouvre et ferme le menu ; nouvelle permission `storage`.
- Extension : bouton « Parcourir… » dans les réglages pour choisir le dossier de téléchargement avec le sélecteur de l'hôte ; si le dossier choisi est inutilisable, le menu indique où la vidéo a été enregistrée (dossier Vidéos).
- Extension : « Télécharger la vidéo » et « Réglages » sont deux cartes séparées avec une animation de glissement horizontal (désactivée avec `prefers-reduced-motion`) ; « Enregistrer » revient à la carte principale. Nouvelle présentation : champ « Nom du fichier », unité « Mo » et icônes d'horloge dans les champs, interrupteur pour « Découper la vidéo », pastille d'état, icônes sur « Télécharger » et « Enregistrer », bouton dossier intégré au champ du dossier de téléchargement.

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
