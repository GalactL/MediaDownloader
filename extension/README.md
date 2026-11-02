# Extension Firefox MediaDownloader

Menu dans la page (bouton icône « Télécharger » avant le groupe « J'aime / Je n'aime pas », ou icône de la barre d'outils) pour télécharger la vidéo de l'onglet
via l'hôte de messagerie native `media_downloader` (voir `docs/NATIVE_HOST_PROTOCOL.md`).
JavaScript pur, sans étape de build. Sites pris en charge : YouTube (vidéos, Shorts, direct), X (Twitter), TikTok et Instagram.

Un site = un adaptateur dans `sites.js`, seul endroit où figurent les sélecteurs du DOM de la page :
`{ id, matches(hostname, pathname), findAnchor(document), observeTarget(document), isDark(document), iconPath, css, diagnose(document) }`.
Pour porter l'extension vers un autre site, ajouter un objet à `ADAPTERS` (et le motif de ses pages vidéo à `SITES` dans `lib.js`),
puis le site à `content_scripts[0].matches`. Chaque adaptateur a des sélecteurs de repli ; ceux des sites autres que
YouTube classique sont écrits d'après la structure connue de leur page et n'ont pas été vérifiés sur le site en ligne
(ces sites renomment souvent leur DOM) : si l'ancre est introuvable, rien n'est ajouté à la page, une seule ligne
`console.debug` donne le nombre de correspondances de chaque sélecteur et l'icône de la barre d'outils reste utilisable.

| Site | Pages avec bouton | Ancre (le bouton est inséré juste avant, sauf mention) |
| --- | --- | --- |
| YouTube | `/watch?v=`, `youtu.be/<id>`, `/live/<id>` | groupe J'aime / Je n'aime pas |
| YouTube Shorts | `/shorts/<id>` | colonne verticale d'actions du short actif |
| X (`x.com`, `twitter.com`) | `/<compte>/status/<id>`, seulement si la publication contient une vidéo | dernier élément de la barre d'actions de la publication (après partager ; le bouton est inséré juste après) |
| TikTok | `/@<compte>/video/<id>` | colonne j'aime / commentaires / partage |
| Instagram | `/reel/<id>`, `/p/<id>` (avec vidéo) | rangée d'actions de la publication |

Sur tous les sites, le bouton affiche le logo de l'extension (`icons/icon.svg`, tracé en SVG intégré dans la couleur du texte : clair sur thème sombre, sombre sur thème clair, comme les variantes `icon-light.svg` / `icon-dark.svg` de la barre d'outils).

L'URL envoyée au moteur est toujours celle de la page (`lib.canonicalUrl` : sur YouTube sans `list=`/`index=`, ailleurs
le chemin de la publication sans paramètres de suivi), jamais l'adresse d'un flux vidéo ; yt-dlp l'interprète.
L'extension ne lit aucun cookie et ne demande aucun identifiant ; `cookiesFromBrowser` reste réservé à YouTube côté
moteur. Une vidéo qui exige une connexion échoue donc dans yt-dlp, et l'extension affiche un message d'erreur clair
(`error.probe_failed` / `error.download_failed`). Pendant une navigation sans rechargement (SPA), le bouton est
réinséré ou retiré sans doublon, et une analyse en cours est annulée puis relancée pour la nouvelle page.

Version Chromium (Opera, Chrome, Brave) : `manifest.chromium.json` (MV3, service worker `background.js`, clé publique `key`
qui fixe l'identifiant, à garder égal à `ChromiumExtensionId` de `src/Core.h`) sur le même code ; `shim.js` définit `browser` comme
`chrome` et `tools/make-chromium-zip.sh` produit le zip à charger en mode développeur. Les icônes PNG sont requises par Chromium.

Firefox : manifest V2 avec page d'événements (`persistent: false`) : Firefox la garde active tant que
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
- **Affichage du bouton** : « Sur la page » (bouton carré de 36 px, discret, placé à gauche du groupe J'aime / Je n'aime pas
  sans prendre de place dans la barre : un conteneur de largeur nulle l'accroche sans rien décaler, pas même la barre grise des
  « J'aime ») ou « Icône de la barre uniquement ». Ses couleurs sont explicites (clair ou sombre selon l'attribut `dark` de
  la page YouTube), indépendantes du réglage de thème de l'extension, qui ne concerne que la boîte. La boîte s'ouvre sous le
  bouton (au-dessus s'il manque de la place), le suit au défilement et se ferme quand le bouton sort de l'écran ; ouverte
  depuis l'icône de la barre d'outils sans bouton visible, elle reste dans le coin. Le bouton est réinséré après chaque
  navigation ou reconstruction de la barre d'actions ; si YouTube change sa structure et que l'ancre est introuvable, rien
  n'est affiché (une ligne `console.debug` liste les sélecteurs essayés) et l'icône de la barre d'outils reste utilisable.
  Dans le mode « icône », le bouton de la page disparaît aussitôt et l'icône MediaDownloader de la barre d'outils
  ouvre et ferme le menu. Elle n'agit que sur une page vidéo YouTube : pour revenir au bouton
  de la page, ouvrir une vidéo, cliquer sur l'icône puis sur l'engrenage.

## Permissions

- Accès aux pages : uniquement les hôtes pris en charge (le script de contenu n'est injecté nulle part ailleurs) :
  `*://*.youtube.com/*` et `*://youtu.be/*` (YouTube, Shorts compris), `*://x.com/*` et `*://www.x.com/*` (X),
  `*://twitter.com/*` et `*://www.twitter.com/*` (anciens liens X, qui y redirigent), `*://www.tiktok.com/*` (TikTok)
  et `*://www.instagram.com/*` (Instagram). Aucun sous-domaine d'API ou de CDN n'est demandé : la page est lue
  uniquement pour poser le bouton et obtenir son adresse.
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
4. Ouvrir une vidéo YouTube (ou une publication X, TikTok ou Instagram avec vidéo) et cliquer sur le bouton à icône « Télécharger » avant le groupe « J'aime / Je n'aime pas ».

Le chargement temporaire disparaît au redémarrage de Firefox.

## Tests

```
node --test extension/test/*.test.js
```
