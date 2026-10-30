#!/bin/sh
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
echo "Installation de MediaDownloader..."
"$DIR/MediaDownloader.Cli" install-host
echo "Ouverture de l'extension dans Firefox : acceptez l'installation quand Firefox le demande."
if [ "$(uname)" = Darwin ]; then
  open -a Firefox "$DIR/mediadownloader.xpi"
elif command -v firefox >/dev/null 2>&1; then
  firefox "$DIR/mediadownloader.xpi" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/mediadownloader.xpi" >/dev/null 2>&1 &
else
  echo "Firefox introuvable : glissez $DIR/mediadownloader.xpi dans une fenêtre Firefox."
fi
echo "Ne déplacez pas ce dossier ensuite ; sinon relancez install.sh."
