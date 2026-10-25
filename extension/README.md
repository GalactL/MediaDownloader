# Extension Firefox MediaDownloader

Menu dans la page (bouton icône « Télécharger » avant le groupe « J'aime / Je n'aime pas », ou icône de la barre d'outils) pour télécharger la vidéo de l'onglet
via l'hôte de messagerie native `media_downloader` (voir `docs/NATIVE_HOST_PROTOCOL.md`).
JavaScript pur, sans étape de build. Pour l'instant uniquement YouTube.

Un site = un adaptateur dans `sites.js`, seul endroit où figurent les sélecteurs du DOM de la page :
`{ id, matches(hostname), findAnchor(document), observeTarget(document), css }`. Pour porter l'extension
vers Twitter ou Twitch, ajouter un objet à `ADAPTERS` et le site à `content_scripts[0].matches`.

Manifest V2 avec page d'événements (`persistent: false`) : Firefox la garde active tant que
le port `connectNative` est ouvert, et c'est le plus simple pour `runtime.connectNative`.

## Réglages

L'engrenage de l'en-tête du menu ouvre les réglages : « Télécharger la vidéo » et « Réglages » sont deux cartes
distinctes dans la même boîte, qui glissent horizontalement l'une vers l'autre (sans animation si le système
demande de réduire les animations ; la carte inactive est inerte et masquée aux lecteurs d'écran). La flèche de
retour ou « Enregistrer » ramène à la carte principale, et la boîte se rouvre toujours dessus. Les réglages sont
stockés avec `storage.local` et appliqués immédiatement sans recharger :

- **Dossier de téléchargement** : chemin absolu ; vide = dossier Vidéos par défaut. Le bouton dossier (« Parcourir… ») ouvre le
  sélecteur de dossier de l'hôte (le champ reste modifiable ; rien n'est enregistré avant « Enregistrer »). Si
  le dossier est inutilisable au moment du téléchargement, la vidéo va dans le dossier Vidéos et le menu l'indique.
- **Thème** : clair ou sombre (sombre par défaut).
- **Langue** : « Automatique (langue du navigateur) » (par défaut), français ou anglais. Un choix explicite l'emporte
  et s'applique tout de suite, boîte, bouton et messages d'erreur compris ; une langue de navigateur non prise en charge
  donne le français. Les textes sont dans le catalogue `i18n.js` (ajouter une langue = ajouter une table et son code
  dans `LANGUAGES` ; une clé manquante retombe sur le français). Les erreurs sont affichées à partir de `error.code`.
- **Optimiser l'application (économie de ressources)** : désactivée par défaut. Activée, le moteur lance FFmpeg en
  priorité basse avec 2 threads (champ `lowResources` de la requête `download`), les animations sont supprimées (comme
  `prefers-reduced-motion`, qui est aussi respecté sans le réglage) et le sondage de navigation de la page est arrêté.
- **Affichage du bouton** : « Sur la page » (bouton à icône seule « Télécharger » inséré juste avant le groupe J'aime / Je n'aime pas
  de la page vidéo ; la boîte s'ouvre sous lui) ou « Icône de la barre uniquement ». Le bouton reprend le thème clair ou
  sombre de YouTube (variables CSS `--yt-spec-*`), pas le réglage de l'extension, qui ne concerne que la boîte. Il est
  réinséré après chaque navigation ou reconstruction de la barre d'actions ; si YouTube change sa structure et que
  l'ancre est introuvable, rien n'est affiché et l'icône de la barre d'outils reste utilisable.
  Dans le mode « icône », le bouton de la page disparaît aussitôt et l'icône MediaDownloader de la barre d'outils
  ouvre et ferme le menu. Elle n'agit que sur une page vidéo YouTube : pour revenir au bouton
  de la page, ouvrir une vidéo, cliquer sur l'icône puis sur l'engrenage.

## Permissions

- Accès aux pages : uniquement `*://*.youtube.com/*` et `*://youtu.be/*` (le script de contenu n'est injecté nulle part ailleurs).
- `nativeMessaging` : parler à l'hôte `media_downloader` (yt-dlp et FFmpeg tournent hors du navigateur).
- `storage` : conserver les réglages dans `storage.local`.

## Installation

Release : voir l'étape 3 de l'installation dans le `README.md` racine (glisser
`mediadownloader.xpi` dans Firefox, après `MediaDownloader.Cli install-host`). Signature :
`docs/EXTENSION_SIGNATURE.md`. Le fichier `.xpi` contient `extension/` sans `test/` ni `README.md`.

## Chargement temporaire

1. Compiler le projet puis exécuter `MediaDownloader.Cli install-host` (enregistre l'hôte
   pour l'identifiant `mediadownloader@localhost`).
2. Dans Firefox, ouvrir `about:debugging#/runtime/this-firefox`.
3. « Charger un module complémentaire temporaire… » puis choisir `extension/manifest.json`.
4. Ouvrir une vidéo YouTube et cliquer sur le bouton à icône « Télécharger » avant le groupe « J'aime / Je n'aime pas ».

Le chargement temporaire disparaît au redémarrage de Firefox.

## Tests

```
node --test extension/test/*.test.js
```
