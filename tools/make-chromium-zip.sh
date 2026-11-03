#!/usr/bin/env bash
# Produit out/mediadownloader-chromium.zip : l'extension MV3 non empaquetée pour Opera, Chrome et Brave
# (même code que Firefox, manifeste Chromium). Sans signature ni secret : on la charge en mode développeur.
set -euo pipefail
rm -rf chromium-src out/mediadownloader-chromium.zip
mkdir -p chromium-src out
cp -r extension/. chromium-src/
rm -rf chromium-src/test chromium-src/README.md chromium-src/manifest.json
# Le mode léger (Pyodide, ffmpeg.wasm, GPL) est réservé à Firefox : ni lite/ ni ses binaires dans le zip Chromium.
rm -rf chromium-src/lite
mv chromium-src/manifest.chromium.json chromium-src/manifest.json
# Valide le manifeste produit : MV3, clé publique (identifiant fixe) et fichiers référencés présents.
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync("chromium-src/manifest.json", "utf8"));
const files = [m.background.service_worker, ...m.content_scripts.flatMap((c) => c.js), ...Object.values(m.icons)];
if (m.manifest_version !== 3 || !m.key || !m.version) throw new Error("manifeste Chromium invalide");
for (const f of files) if (!fs.existsSync("chromium-src/" + f)) throw new Error("fichier manquant : " + f);
'
# zip sur Linux ; les runners Windows n'ont que 7z.
if command -v zip >/dev/null; then
  (cd chromium-src && zip -r -X ../out/mediadownloader-chromium.zip .)
else
  (cd chromium-src && 7z a -tzip -bd ../out/mediadownloader-chromium.zip .)
fi
