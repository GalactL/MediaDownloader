#!/bin/sh
# Installateur MediaDownloader (Linux x64). L'archive ne contient aucun binaire tiers : ce script télécharge
# Deno, yt-dlp et FFmpeg (versions et SHA-256 épinglés) dans tools/bin, puis enregistre l'hôte natif et ouvre
# l'extension. Aucun droit administrateur. Les constantes DENO_* doivent égaler le bloc "deno" de
# engine/deps.json (vérifié par engine/test/deps.test.ts).
# Test uniquement : MEDIADOWNLOADER_INSTALLER_TEST=1 saute l'enregistrement de l'hôte et l'ouverture de Firefox.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DENO_VERSION='2.9.8'
DENO_URL='https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip'
DENO_SHA256='e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609'
DENO_EXE_SHA256='368bca08999e02c6911b8f248167b582276b1f547db5712b6e736d7eda1dbda7'

fail() {
  echo >&2
  echo "ÉCHEC de l'installation : $1" >&2
  echo "Rien de partiel n'a été laissé dans tools/bin. Vérifiez la connexion (proxy : variables https_proxy / HTTPS_PROXY), l'espace disque et les droits sur ce dossier, puis relancez install.sh." >&2
  exit 1
}

if [ "$(uname -s)" != "Linux" ]; then
  echo "MediaDownloader n'est pas pris en charge sur $(uname -s) : seuls Windows x64 et Linux x64 le sont." >&2
  exit 1
fi
if [ "$(uname -m)" != "x86_64" ]; then
  echo "MediaDownloader n'est pris en charge que sur Linux x86_64 (architecture détectée : $(uname -m))." >&2
  exit 1
fi

# Deno sépare --allow-read=/--allow-write= sur les virgules.
case "$DIR" in
  *,*)
    echo "ÉCHEC : le chemin de ce dossier contient une virgule ($DIR), ce que Deno ne gère pas." >&2
    echo "Déplacez le dossier vers un chemin sans virgule, puis relancez install.sh. Rien n'a été modifié." >&2
    exit 1
    ;;
esac

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "sha256sum (ou shasum) est introuvable : impossible de vérifier les téléchargements."
  fi
}

BIN="$DIR/tools/bin"
echo "Installation de MediaDownloader..."
echo
echo "[1/3] Deno $DENO_VERSION"
if [ -x "$BIN/deno" ] && [ "$(sha256 "$BIN/deno")" = "$DENO_EXE_SHA256" ]; then
  echo "  déjà installé."
else
  TMP="$DIR/tools/.tmp-deno-$$"
  trap 'rm -rf "$TMP"' EXIT
  trap 'exit 1' INT TERM
  mkdir -p "$TMP" || fail "impossible de créer $TMP (droits ou espace disque)."
  echo "  téléchargement..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1.2 -o "$TMP/deno.zip" "$DENO_URL" || fail "téléchargement de Deno impossible."
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --https-only -O "$TMP/deno.zip" "$DENO_URL" || fail "téléchargement de Deno impossible."
  else
    fail "ni curl ni wget n'est installé."
  fi
  [ "$(sha256 "$TMP/deno.zip")" = "$DENO_SHA256" ] || fail "la somme SHA-256 de Deno ne correspond pas (fichier corrompu ou modifié)."
  mkdir "$TMP/x"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$TMP/deno.zip" deno -d "$TMP/x" || fail "extraction de Deno impossible."
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$TMP/deno.zip" "$TMP/x" || fail "extraction de Deno impossible."
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$TMP/deno.zip" -C "$TMP/x" deno || fail "extraction de Deno impossible."
  else
    fail "unzip (ou python3, ou bsdtar) est requis pour extraire Deno."
  fi
  chmod +x "$TMP/x/deno"
  mkdir -p "$BIN" && mv -f "$TMP/x/deno" "$BIN/deno" || fail "impossible d'installer Deno dans $BIN."
  echo "  installé et vérifié."
fi

echo
echo "[2/3] yt-dlp et FFmpeg (plusieurs centaines de Mo : patientez)"
export DENO_NO_UPDATE_CHECK=1 DENO_DIR="$DIR/tools/deno-cache"
"$BIN/deno" run --no-check --no-config --no-prompt --allow-net --allow-read="$DIR" --allow-write="$DIR" --allow-run --allow-env=SystemRoot "$DIR/engine/deps.ts" --root "$DIR" || fail "téléchargement des dépendances impossible (voir ci-dessus)."

if [ -z "${MEDIADOWNLOADER_INSTALLER_TEST:-}" ]; then
  echo
  echo "[3/3] Enregistrement de l'hôte pour Firefox"
  "$DIR/MediaDownloader.Cli" install-host || fail "enregistrement de l'hôte impossible."
  echo "Ouverture de l'extension dans Firefox : acceptez l'installation quand Firefox le demande."
  if command -v firefox >/dev/null 2>&1; then
    firefox "$DIR/mediadownloader.xpi" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DIR/mediadownloader.xpi" >/dev/null 2>&1 &
  else
    echo "Firefox introuvable : glissez $DIR/mediadownloader.xpi dans une fenêtre Firefox."
  fi
fi
echo
echo "Installation terminée. Ne déplacez pas ce dossier ensuite ; sinon relancez install.sh."
