# Protocole de l'hôte de messagerie native

`MediaDownloader.Cli host` est un hôte de messagerie native pour Firefox. Il
réutilise le même moteur que le CLI (voir [CLI_PROTOCOL.md](CLI_PROTOCOL.md)) mais
dialogue par messages JSON encadrés sur stdin/stdout.

## Lancement par Firefox

`MediaDownloader.Cli install-host` écrit le manifeste Firefox `media_downloader.json`
(généré par le code, `path` = chemin absolu de l'exécutable en cours) :

- Windows : `<dossier de l'exe>\native-host\media_downloader.json`, et la valeur par
  défaut de `HKCU\Software\Mozilla\NativeMessagingHosts\media_downloader` pointe
  vers ce fichier ;
- macOS : `~/Library/Application Support/Mozilla/NativeMessagingHosts/media_downloader.json` ;
- Linux : `~/.mozilla/native-messaging-hosts/media_downloader.json`.

Firefox ajoute à la ligne de commande le chemin du manifeste et l'identifiant de
l'extension.

`MediaDownloader.Cli` détecte lui-même le lancement par Firefox : si le premier
argument n'est ni une commande ni une option mais un chemin de manifeste (`.json`)
ou un identifiant d'extension (`nom@domaine` ou `{uuid}`), il passe en mode `host`.
Le manifeste pointe directement vers l'exécutable. Toute autre commande inconnue renvoie toujours le code de sortie 2.

L'identifiant d'extension autorisé (`allowed_extensions`) est `mediadownloader@localhost`,
celui de `extension/manifest.json`.

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
| `{"type":"openFolder"}` | aucun : ouvre le dossier de sortie du dernier téléchargement dans le gestionnaire de fichiers |
| `{"type":"pickFolder"}` | aucun : ouvre le sélecteur de dossier du système |

La validation est celle du CLI : `startTime` et `endTime` vont ensemble,
`endTime` > `startTime`, seules les URL `http(s)` sont acceptées. Sinon l'hôte
répond `invalid_arguments`.

## Réponses

Ce sont les événements du CLI (`started`, `log`, `progress`, `encodingPlan`,
`completed`, `error`, `doctor`) avec le champ `id` ajouté juste après `type`.

`openFolder` répond `{"type":"opened","id":"…"}`. Aucun chemin n'est accepté du client : seul le dernier dossier de sortie est ouvrable, sinon `no_folder`.

`pickFolder` répond `{"type":"folderPicked","id":"…","path":"<chemin absolu>"}` lorsque l'utilisateur choisit un
dossier, ou `{"type":"folderPicked","id":"…"}` sans champ `path` s'il annule (annuler = pas de chemin). Si aucun
sélecteur n'est disponible ou s'il échoue, l'hôte répond l'erreur `pick_failed`. Le sélecteur est
`IFileOpenDialog` (Windows), `osascript` (macOS), `zenity` puis `kdialog` (Linux).

La réponse `probe` est compacte :

```json
{"type":"probe","id":"1","data":{"id":"abc","title":"Titre","duration":123.4,"uploader":"Chaîne","thumbnail":"https://...","webpage_url":"https://...","heights":[360,720,1080]}}
```

## Comportement

- Un seul travail à la fois : un second `probe` ou `download` reçoit `busy`.
- `cancel` arrête yt-dlp et FFmpeg, supprime le dossier temporaire et produit
  l'erreur `cancelled`. Sans travail en cours, `cancel` est ignoré.
- `pickFolder` ne bloque pas la lecture des requêtes. Il reçoit `busy` pendant un `probe` ou un `download`, ou
  pendant un autre `pickFolder` ; inversement `probe` et `download` reçoivent `busy` tant que le sélecteur est
  ouvert. `cancel` ferme le sélecteur (sauf sous Windows) et la réponse est alors un `folderPicked` sans `path`.
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
| `busy` | un travail ou un sélecteur de dossier est déjà en cours |
| `message_too_large` | réponse supérieure à 1 Mio |
| `cancelled` | travail annulé par `cancel` |
| `no_folder` | `openFolder` sans téléchargement préalable |
| `open_failed` | le gestionnaire de fichiers n'a pas pu s'ouvrir |
| `pick_failed` | `pickFolder` : sélecteur de dossier indisponible ou en échec |
| `invalid_output_directory` | le dossier Vidéos de repli est lui-même inutilisable ; le message contient le chemin |

Un `outputDirectory` inutilisable (fichier existant, création impossible, écriture refusée) ne produit pas d'erreur :
le moteur enregistre dans le dossier Vidéos et émet d'abord un `log` de niveau `warning` (« Dossier de sortie
inutilisable (…), enregistrement dans le dossier Vidéos : … ») ; `started.outputDirectory` donne le dossier réel.

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
