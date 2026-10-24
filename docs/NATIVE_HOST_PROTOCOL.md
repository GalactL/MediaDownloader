# Protocole de l'hôte de messagerie native

`MediaDownloader.Cli host` est un hôte de messagerie native pour Firefox. Il
réutilise le même moteur que le CLI (voir [CLI_PROTOCOL.md](CLI_PROTOCOL.md)) mais
dialogue par messages JSON encadrés sur stdin/stdout.

## Lancement par Firefox

Firefox lit le manifeste `media_downloader.json` (modèle :
`native-host/media_downloader.json.template`), enregistré par
`tools/install-native-host.ps1` (Windows, clé de registre
`HKCU\Software\Mozilla\NativeMessagingHosts\media_downloader`) ou
`tools/install-native-host.sh` (macOS/Linux). Le champ `path` désigne un script
d'enveloppe (`media-downloader-host.cmd` ou `media-downloader-host.sh`) qui exécute
`MediaDownloader.Cli host`. Firefox ajoute à la ligne de commande le chemin du
manifeste et l'identifiant de l'extension ; l'enveloppe ne les transmet pas et ils
sont ignorés.

`MediaDownloader.Cli` détecte lui-même le lancement par Firefox : si le premier
argument n'est ni une commande ni une option mais un chemin de manifeste (`.json`)
ou un identifiant d'extension (`nom@domaine` ou `{uuid}`), il passe en mode `host`.
Les scripts d'enveloppe ne sont donc plus nécessaires (le manifeste peut pointer
directement vers l'exécutable) ; ils restent fonctionnels pour l'instant. Toute
autre commande inconnue renvoie toujours le code de sortie 2.

L'identifiant d'extension `mediadownloader@localhost` (`allowed_extensions`) est
provisoire : il sera remplacé à l'étape 2, lors de la création de l'extension.

## Encadrement

Sur stdin et stdout, chaque message est un entier non signé de 4 octets (ordre
des octets natif) donnant la longueur, suivi de ce nombre d'octets de JSON UTF-8.
stdout ne contient que des messages encadrés.

- Message entrant : 4 Mio maximum.
- Message sortant : 1 Mio maximum, sinon l'hôte répond `message_too_large`.

## Requêtes

Chaque requête peut contenir une chaîne `id`, recopiée dans toutes les réponses.

| Requête | Champs |
|---|---|
| `{"type":"doctor"}` | aucun |
| `{"type":"probe"}` | `url`, `cookiesFromBrowser` facultatif |
| `{"type":"download"}` | `url`, puis facultatifs : `quality`, `format`, `title`, `startTime`, `endTime`, `maxSizeMb`, `cookiesFromBrowser`, `outputDirectory`, `overwrite` |
| `{"type":"cancel"}` | aucun |

La validation est celle du CLI : `startTime` et `endTime` vont ensemble,
`endTime` > `startTime`, seules les URL `http(s)` sont acceptées. Sinon l'hôte
répond `invalid_arguments`.

## Réponses

Ce sont les événements du CLI (`started`, `log`, `progress`, `encodingPlan`,
`completed`, `error`, `doctor`) avec le champ `id` ajouté juste après `type`.

La réponse `probe` est compacte :

```json
{"type":"probe","id":"1","data":{"id":"abc","title":"Titre","duration":123.4,"uploader":"Chaîne","thumbnail":"https://...","webpage_url":"https://...","heights":[360,720,1080]}}
```

## Comportement

- Un seul travail à la fois : un second `probe` ou `download` reçoit `busy`.
- `cancel` arrête yt-dlp et FFmpeg, supprime le dossier temporaire et produit
  l'erreur `cancelled`. Sans travail en cours, `cancel` est ignoré.
- `doctor` est traité immédiatement, même pendant un travail.
- Une requête trop grande reçoit `message_too_large`, sans `id`.
- Un `id` qui n'est pas une chaîne est ignoré.
- Message mal formé ou de type inconnu : `invalid_message`.
- Fin de stdin (EOF) : le travail éventuel est annulé et l'hôte se termine avec le
  code `0`.

## Codes d'erreur

| Code | Signification |
|---|---|
| `invalid_message` | JSON mal formé ou type inconnu |
| `invalid_arguments` | champ de mauvais type ou validation des arguments échouée (comme le CLI) |
| `busy` | un travail est déjà en cours |
| `message_too_large` | réponse supérieure à 1 Mio |
| `cancelled` | travail annulé par `cancel` |

Les autres codes d'`error` sont ceux du CLI (par exemple `processing_failed`,
dépendance manquante) ; voir [CLI_PROTOCOL.md](CLI_PROTOCOL.md).

## Exemple

```text
-> {"type":"download","id":"7","url":"https://example.com/v","quality":"1080","maxSizeMb":10}
<- {"type":"started","id":"7","outputDirectory":"C:\\Users\\Moi\\Videos"}
<- {"type":"progress","id":"7","stage":"download","percent":42.0}
<- {"type":"completed","id":"7","path":"C:\\Users\\Moi\\Videos\\v.mp4","bytes":9853214}
-> {"type":"download","id":"8","url":"https://example.com/w"}
<- {"type":"error","id":"8","code":"busy","message":"Un traitement est déjà en cours."}
```

(Chaque ligne représente un message encadré par sa longueur.)
