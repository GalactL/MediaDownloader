# Extension Firefox MediaDownloader

Menu dans la page (bouton flottant en bas à droite) pour télécharger la vidéo de l'onglet
via l'hôte de messagerie native `media_downloader` (voir `docs/NATIVE_HOST_PROTOCOL.md`).
JavaScript pur, sans étape de build. Pour l'instant uniquement YouTube ; d'autres sites
s'ajoutent en modifiant `content_scripts[0].matches` dans `manifest.json`.

Manifest V2 avec page d'événements (`persistent: false`) : Firefox la garde active tant que
le port `connectNative` est ouvert, et c'est le plus simple pour `runtime.connectNative`.

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
