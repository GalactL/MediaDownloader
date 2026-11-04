# Changelog

## Non publié

- Moteur : réécrit en TypeScript et exécuté par Deno (`engine/`), à la place du moteur C++ (supprimé). Les protocoles du CLI et de l'hôte natif, les codes de sortie, le plan d'encodage et les invariants sont inchangés.
- Distribution : l'archive ne contient plus aucun programme tiers et pèse moins de 1 Mo (contrôle de taille dans la release). `Installer.bat` / `install.sh` téléchargent Deno, yt-dlp et FFmpeg (environ 270 Mo) avec versions et sommes SHA-256 épinglées (`engine/deps.json`), sans droit administrateur ; aucun fichier non vérifié n'est installé en cas d'échec. Le CLI et l'hôte sont lancés par `MediaDownloader.Cli.bat` (Windows) ou `MediaDownloader.Cli` (Linux).
- Distribution : version portable, tout reste dans le dossier d'installation (outils, cache de Deno) ; après un déplacement, relancer l'installateur.
- Distribution : macOS n'est plus pris en charge ; seuls Windows x64 et Linux x64 le sont. Archives : `.zip` pour Windows, `.tar.gz` pour Linux (conserve le bit exécutable).
- Licences : FFmpeg (build BtbN GPL) n'est plus embarqué dans l'archive Linux mais téléchargé à l'installation ; la notice indique les sources correspondantes.
- Changements incompatibles : `MediaDownloader.Cli.exe` n'existe plus ; le point d'entrée est `MediaDownloader.Cli.bat` (Windows) ou `MediaDownloader.Cli` (Linux), le protocole de sortie restant inchangé. Un appelant programmatique (HUB, script) ne doit jamais faire passer de chaîne non fiable par le `.bat` (`cmd.exe` interprète mal `"` et `&` : injection de commande) mais lancer `tools\bin\deno.exe` directement avec un tableau d'arguments (voir « Appel programmatique » dans `docs/CLI_PROTOCOL.md`).
- Plateformes : Linux testé en CI seulement (tests du moteur) ; installateur, lanceur et Firefox non vérifiés sur machine Linux réelle. Prérequis : curl ou wget, unzip (ou python3 ou bsdtar), tar et xz, sha256sum ou shasum, dossier temporaire exécutable. Windows : `System32\tar.exe` (Windows 10 1803+) et dossier d'installation au chemin court (MAX_PATH).
- Hôte natif : sous Windows, le sélecteur de dossier est la boîte classique en arborescence (PowerShell `FolderBrowserDialog`), plus lente à s'ouvrir, et peut échouer avec `pick_failed` en mode de langage restreint de PowerShell ; l'utilisateur peut toujours saisir le chemin.
- Distribution : `update` (`yt-dlp -U`) remplace le yt-dlp épinglé ; l'installateur ou `deps --check` verront une autre somme SHA-256, et relancer l'installateur restaure la version épinglée.
- Installateurs : messages d'échec corrigés (un `deno` vérifié peut rester dans `tools/bin` après un échec à l'étape 2 ; l'étape 1 de `Installer.bat` utilise le proxy système, `HTTPS_PROXY` n'agit que sur l'étape 2 ; indication tar/xz sous Linux).
- Correction : un dossier d'installation contenant des espaces fonctionne ; les chemins avec virgule sont refusés clairement et la racine d'un disque est gérée.
- Correction : un pourcentage (`%`) dans le dossier de sortie n'est plus mal interprété.
- Développement : suppression de CMake, de `tools/build-native.mjs` et de `tools/install-dependencies.ps1` ; CI et release exécutent `deno check` et `deno test`.

## v0.6.0 (2026-11-02)

- Extension : version Chromium (Opera, Chrome, Brave), manifeste MV3 `extension/manifest.chromium.json` (service worker, clé publique `key` qui fixe l'identifiant ; la clé privée n'est pas conservée) sur le même code que Firefox, avec une cale `extension/shim.js` (`browser` = `chrome`). Le manifeste Firefox ne change que de version. Livrée en `mediadownloader-chromium.zip` (`tools/make-chromium-zip.sh`) dans les archives Windows et Linux et jointe à la release ; à charger à la main en mode développeur (voir README). Non vérifiée sur Opera sous Windows réel.
- CLI : `install-host` enregistre aussi l'hôte natif pour Opera, Chrome et Brave (manifeste avec `allowed_origins`, sous Linux dans `~/.config/<navigateur>/NativeMessagingHosts`, sous Windows clés `HKCU` pointant vers `native-host\media_downloader.chromium.json`) ; `uninstall-host` les retire. Le lancement par Chromium (origine `chrome-extension://…` en premier argument) est reconnu comme `host`.
- Distribution : le workflow de release n'utilise plus les artefacts GitHub (quota de stockage atteint) : chaque job de build reconstruit le `.xpi` (`tools/make-xpi.sh`, qui réutilise la version signée) et publie lui-même son archive sur la release ; le job `publish` disparaît.
- Distribution : l'extension signée `mediadownloader.xpi` est de nouveau jointe seule à la release (depuis le job Linux).
- Distribution : le job `extension` récupère le `.xpi` déjà signé par AMO si la version existe (AMO refuse de signer deux fois), ce qui rend les relances de release sûres ; les artefacts intermédiaires sont conservés 1 jour (`retention-days: 1`).

## v0.5.1 (2026-10-30)

- Distribution : le workflow de release exécute d'abord les tests (moteur et extension) ; la signature Mozilla de l'extension n'a lieu qu'une fois ces tests passés.
- Distribution : macOS n'est plus pris en charge, ni compilé ni empaqueté (archives macOS x64 et arm64, notice `RELEASE_MACOS.md`, CI macOS et code spécifique macOS supprimés). Windows x64 et Linux x64 restent livrés. `install.sh` ne gère plus macOS.
- Extension : la taille maximale n'est plus plafonnée à 20 Mo (tout nombre supérieur à 0 est accepté) ; un bouton aux couleurs de Discord, « 20 Mo », remplit le champ avec la limite Discord.
- Distribution : scripts d'installation et de désinstallation dans chaque archive (`Installer.bat` et `Desinstaller.bat` sous Windows, `install.sh` et `uninstall.sh` sous Linux) : ils lancent `install-host` / `uninstall-host` puis ouvrent `mediadownloader.xpi` dans Firefox. FFprobe n'est plus embarqué dans l'archive Linux.
- Moteur : ffprobe n'est plus nécessaire. La durée de la vidéo est lue avec `ffmpeg -i` (ligne `Duration:`). Le champ `ffprobe` disparaît de l'événement `doctor` (CLI et hôte natif) ; l'option `--ffprobe` reste acceptée mais est ignorée. Retiré aussi de CMake, du script `install-dependencies.ps1` et de la documentation.
- Moteur : `doctor` n'exige un runtime JavaScript (Deno ou Node) que pour une URL YouTube (`doctor --url`), et l'avertissement « Aucun runtime JavaScript » du téléchargement n'apparaît plus que pour YouTube.
- CLI : nouvelle commande `update` (`yt-dlp -U`, sortie relayée en événements `log`, codes 0, 3 ou 4) et nouvelle commande `uninstall-host` (supprime le manifeste et, sous Windows, la clé de registre ; sans effet si rien n'est installé).
- Moteur : sur X (Twitter), le téléchargement d'un tweet qui en cite un autre récupère maintenant la vidéo du tweet lui-même et non celle du tweet cité (`--playlist-items 1` pour x.com et twitter.com). Un tweet sans vidéo propre qui cite une vidéo télécharge toujours la vidéo citée.

## v0.4.0 (2026-10-25)

- Extension : le bouton de la page affiche le logo de l'extension (tracé SVG intégré, clair sur thème sombre et sombre sur thème clair) sur tous les sites, YouTube compris, à la place du pictogramme « télécharger ». Bouton TikTok : l'ancre reste le bouton « J'aime » (ou son conteneur) même si les autres actions de la colonne ne sont pas des `<button>`.
- Extension : adaptateurs pour YouTube Shorts, X (Twitter), TikTok et Instagram (`extension/sites.js`). Bouton « Télécharger » dans la colonne d'actions des Shorts, dans la barre d'actions d'une publication X (seulement si elle contient une vidéo), dans la colonne d'actions d'une vidéo TikTok et dans la rangée d'actions d'un reel ou d'une publication Instagram avec vidéo. `lib.isVideoPage` et `lib.canonicalUrl` dépendent maintenant du site ; l'URL envoyée au moteur est celle de la page, jamais celle du flux. Nouveaux accès du script de contenu : `x.com`, `twitter.com`, `www.tiktok.com`, `www.instagram.com` (voir `extension/README.md`). Aucun cookie lu, `cookiesFromBrowser` reste réservé à YouTube ; les erreurs « analyse impossible » et « téléchargement échoué » précisent qu'une vidéo exigeant une connexion n'est pas accessible. Pendant une navigation sans rechargement, une analyse en cours est annulée puis relancée pour la nouvelle page (plus d'erreur « traitement en cours »). Sélecteurs non vérifiés sur les sites en ligne, avec sélecteurs de repli et un diagnostic `console.debug` unique si l'ancre est introuvable.
- Extension : le bouton flottant est remplacé par un bouton carré de 36 px, discret (infobulle « Télécharger »), placé à gauche du groupe J'aime / Je n'aime pas de la page vidéo YouTube sans prendre de place dans la barre ni décaler quoi que ce soit (ni la barre grise des « J'aime »). La boîte s'ouvre sous (ou au-dessus du) bouton et le suit au défilement ; elle se ferme quand le bouton sort de l'écran. Le bouton est réinséré après navigation ou reconstruction de la barre, et disparaît avec le réglage « icône de la barre uniquement ». Si la structure de la page est introuvable, l'icône de la barre d'outils reste disponible. Les sélecteurs vivent dans des adaptateurs par site (`extension/sites.js`).
- Moteur : la progression du téléchargement fonctionne enfin. `--print` imposait `--quiet` à yt-dlp, qui n'émettait plus aucune ligne de progression : le moteur passe maintenant `--progress` et des `--progress-template` stables, et un nouvel événement facultatif `phase` (`inspection`, `download`, `merge`) signale les phases sans pourcentage. `progress` garde `percent` toujours présent (avec `stage` facultatif, et `pass` pour `encode`). Le pourcentage de téléchargement est lissé (vidéo puis audio, sans retour en arrière). Le format de `progress` existant est inchangé (voir `docs/CLI_PROTOCOL.md`).
- Moteur : option facultative `--low-resources` du CLI (champ `lowResources` de la requête `download` de l'hôte) : FFmpeg en priorité basse avec 2 threads. Sans elle, rien ne change.
- Extension : deux nouveaux réglages dans le panneau de réglages, conservés dans `storage.local` (aucune nouvelle permission) : « Optimiser l'application (économie de ressources) », désactivée par défaut (FFmpeg en priorité basse, animations réduites, plus de sondage en arrière-plan), et « Langue » (Automatique d'après la langue de Firefox, français ou anglais ; repli sur le français). Les animations sont aussi réduites quand Firefox demande `prefers-reduced-motion`.
- Extension : interface traduite avec un petit catalogue maison (`extension/i18n.js`, français et anglais) ; plus aucune chaîne visible codée en dur, les erreurs sont affichées à partir de `error.code`.
- Extension : la barre suit tout le job (une seule barre, téléchargement puis encodage) et le libellé indique la phase (Inspection, Téléchargement, Assemblage, Encodage passe 1/2) ; barre indéterminée sur les événements `phase` (statique et partielle en mode animations réduites), « Terminé » seulement à la fin réelle.
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
