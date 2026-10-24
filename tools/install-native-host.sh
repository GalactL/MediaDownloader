#!/bin/sh
# Enregistre l'hôte de messagerie native de MediaDownloader pour Firefox (macOS/Linux).
# Usage : install-native-host.sh [--uninstall] [chemin/vers/MediaDownloader.Cli]
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
name=media_downloader
dir="${XDG_DATA_HOME:-$HOME/.local/share}/MediaDownloader/native-host"
if [ "$(uname)" = Darwin ]; then
  mdir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  mdir="$HOME/.mozilla/native-messaging-hosts"
fi

if [ "${1:-}" = --uninstall ]; then
  rm -f "$mdir/$name.json"
  rm -rf "$dir"
  echo "Hôte natif désinstallé."
  exit 0
fi

cli="${1:-$root/dist/MediaDownloader.Cli}"
[ -x "$cli" ] || { echo "MediaDownloader.Cli introuvable : $cli" >&2; exit 1; }
cli=$(cd "$(dirname "$cli")" && pwd)/$(basename "$cli")
mkdir -p "$dir" "$mdir"

# Firefox ajoute des arguments (manifeste, id d'extension) : on ne les transmet pas.
printf '#!/bin/sh\nexec "%s" host\n' "$cli" > "$dir/media-downloader-host.sh"
chmod +x "$dir/media-downloader-host.sh"

# shortcut: chemin sans caractère '|' ni '&', suffisant pour un dossier personnel usuel.
sed "s|@HOST_PATH@|$dir/media-downloader-host.sh|" "$root/native-host/media_downloader.json.template" > "$mdir/$name.json"
echo "Hôte natif installé : $mdir/$name.json"
