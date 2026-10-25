# Extension Firefox MediaDownloader

Menu dans la page (bouton flottant en bas à droite ou icône de la barre d'outils) pour télécharger la vidéo de l'onglet
via l'hôte de messagerie native `media_downloader` (voir `docs/NATIVE_HOST_PROTOCOL.md`).
JavaScript pur, sans étape de build. Pour l'instant uniquement YouTube ; d'autres sites
s'ajoutent en modifiant `content_scripts[0].matches` dans `manifest.json`.

Manifest V2 avec page d'événements (`persistent: false`) : Firefox la garde active tant que
le port `connectNative` est ouvert, et c'est le plus simple pour `runtime.connectNative`.

## Réglages

L'engrenage de l'en-tête du menu ouvre les réglages dans la même boîte (stockés avec
`storage.local`, appliqués immédiatement sans recharger) :

- **Dossier de téléchargement** : chemin absolu ; vide = dossier Vidéos par défaut. « Parcourir… » ouvre le
  sélecteur de dossier de l'hôte (le champ reste modifiable ; rien n'est enregistré avant « Enregistrer »). Si
  le dossier est inutilisable au moment du téléchargement, la vidéo va dans le dossier Vidéos et le menu l'indique.
- **Thème** : clair ou sombre (sombre par défaut).
- **Affichage du bouton** : « Sur la page » (bouton flottant) ou « Icône de la barre uniquement ».
  Dans ce second mode, le bouton ⬇ disparaît et l'icône MediaDownloader de la barre d'outils
  ouvre et ferme le menu. Elle n'agit que sur une page vidéo YouTube : pour revenir au bouton
  flottant, ouvrir une vidéo, cliquer sur l'icône puis sur l'engrenage.

## Installation

Release : voir l'étape 3 de l'installation dans le `README.md` racine (glisser
`mediadownloader.xpi` dans Firefox, après `MediaDownloader.Cli install-host`). Signature :
`docs/EXTENSION_SIGNATURE.md`. Le fichier `.xpi` contient `extension/` sans `test/` ni `README.md`.

## Chargement temporaire

1. Compiler le projet puis exécuter `MediaDownloader.Cli install-host` (enregistre l'hôte
   pour l'identifiant `mediadownloader@localhost`).
2. Dans Firefox, ouvrir `about:debugging#/runtime/this-firefox`.
3. « Charger un module complémentaire temporaire… » puis choisir `extension/manifest.json`.
4. Ouvrir une vidéo YouTube et cliquer sur le bouton ⬇.

Le chargement temporaire disparaît au redémarrage de Firefox.

## Tests

```
node --test extension/test/lib.test.js
```
