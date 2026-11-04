#!/usr/bin/env bash
# Produit out/mediadownloader.xpi : réutilise la version déjà signée par AMO, la signe sinon,
# ou (sans secrets AMO) produit un zip non signé. Lancé par les jobs extension et package de release.yml.
set -euo pipefail
mkdir -p ext-src out
cp -r extension/. ext-src/
rm -rf ext-src/test ext-src/README.md ext-src/manifest.chromium.json
if [ -n "${WEB_EXT_API_KEY:-}" ] && [ -n "${WEB_EXT_API_SECRET:-}" ]; then
  # AMO refuse de signer deux fois la même version : on réutilise le .xpi déjà signé, ce qui rend les relances sûres.
  ext_id=$(node -p "require('./extension/manifest.json').browser_specific_settings.gecko.id")
  ext_version=$(node -p "require('./extension/manifest.json').version")
  code=0
  node tools/fetch-signed-xpi.mjs "$ext_id" "$ext_version" out/mediadownloader.xpi || code=$?
  if [ "$code" -eq 3 ]; then
    npx --yes web-ext@8.3.0 sign --channel=unlisted --source-dir ext-src --artifacts-dir signed
    cp signed/*.xpi out/mediadownloader.xpi
  elif [ "$code" -ne 0 ]; then
    exit "$code"
  fi
else
  echo "::warning::AMO_JWT_ISSUER/AMO_JWT_SECRET absents : mediadownloader.xpi n'est PAS signé (Firefox stable le refusera)."
  (cd ext-src && zip -r -X ../out/mediadownloader.xpi .)
fi
