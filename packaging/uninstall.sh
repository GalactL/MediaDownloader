#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
echo "Désinstallation de MediaDownloader..."
"$DIR/MediaDownloader.Cli" uninstall-host
echo "Hôte retiré. Il reste à :"
echo "  1. Supprimer l'extension dans Firefox : about:addons, Extensions, MediaDownloader, Supprimer."
echo "  2. Supprimer ce dossier."
