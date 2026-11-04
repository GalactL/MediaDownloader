# Protocole de l'hôte de messagerie native

`MediaDownloader.Cli host` est un hôte de messagerie native pour Firefox et pour les navigateurs Chromium (Opera, Chrome, Brave). Il
réutilise le même moteur que le CLI (voir [CLI_PROTOCOL.md](CLI_PROTOCOL.md)) mais
dialogue par messages JSON encadrés sur stdin/stdout.

## Lancement par Firefox

`MediaDownloader.Cli install-host` écrit le manifeste Firefox `media_downloader.json`
(généré par le code, `path` = chemin absolu du lanceur `MediaDownloader.Cli.bat` ou `MediaDownloader.Cli`) :

- Windows : `<dossier du lanceur>\native-host\media_downloader.json`, et la valeur par
  défaut de `HKCU\Software\Mozilla\NativeMessagingHosts\media_downloader` pointe
  vers ce fichier ;
- Linux : `~/.mozilla/native-messaging-hosts/media_downloader.json`.

Firefox ajoute à la ligne de commande le chemin du manifeste et l'identifiant de
l'extension.

Le moteur détecte lui-même le lancement par Firefox : si le premier
argument n'est ni une commande ni une option mais un chemin de manifeste (`.json`)
ou un identifiant d'extension (`nom@domaine` ou `{uuid}`), il passe en mode `host`.
Le manifeste pointe vers le lanceur, qui exécute le moteur avec Deno. Toute autre commande inconnue renvoie toujours le code de sortie 2.

L'identifiant d'extension autorisé (`allowed_extensions`) est `mediadownloader@localhost`,
celui de `extension/manifest.json`.

## Lancement par Opera, Chrome et Brave

`install-host` écrit aussi un manifeste Chromium de même nom (`media_downloader`) : `allowed_origins`
vaut `["chrome-extension://jjclljkpbmlceplpicnjkmkjifhhghne/"]` (pas d'`allowed_extensions`). Cet identifiant est
fixé par la clé publique `key` de `extension/manifest.chromium.json` (la clé privée n'est pas conservée) ; il est
la constante `chromiumExtensionId` de `engine/core.ts`, et un test (`extension/test/chromium.test.js`) vérifie qu'ils concordent.

- Windows : `<dossier du lanceur>\native-host\media_downloader.chromium.json`, et la valeur par défaut de
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\media_downloader`,
  `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\media_downloader` et
  `HKCU\Software\Opera Software\Opera Stable\NativeMessagingHosts\media_downloader` pointe vers ce fichier ;
- Linux : `~/.config/google-chrome/NativeMessagingHosts/media_downloader.json`, `~/.config/chromium/...`,
  `~/.config/BraveSoftware/Brave-Browser/...` et `~/.config/opera/...` (mêmes noms de fichier).

Les emplacements Opera (registre Windows) et Brave n'ont pas été vérifiés sur machine réelle ; c'est pourquoi tous les
emplacements plausibles sont écrits. Chromium lance le lanceur avec l'origine de l'extension
(`chrome-extension://<id>/`) en premier argument (et `--parent-window=<n>` sous Windows) : le moteur reconnaît cette
origine comme un lancement d'hôte, comme pour Firefox. `uninstall-host` supprime tous ces manifestes et clés.

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
| `{"type":"download"}` | `url`, puis facultatifs : `quality`, `format`, `title`, `startTime`, `endTime`, `maxSizeMb`, `cookiesFromBrowser`, `outputDirectory`, `overwrite`, `lowResources` |
| `{"type":"cancel"}` | aucun |
| `{"type":"openFolder"}` | aucun : ouvre le dossier de sortie du dernier téléchargement dans le gestionnaire de fichiers |
| `{"type":"pickFolder"}` | aucun : ouvre le sélecteur de dossier du système |

`lowResources` (booléen facultatif, `false` par défaut) équivaut à `--low-resources` du CLI : FFmpeg en priorité basse
avec 2 threads (voir [CLI_PROTOCOL.md](CLI_PROTOCOL.md)). Absent ou `false`, les arguments et les événements sont
inchangés ; un autre type est refusé par `invalid_arguments`. L'hôte traite de toute façon un seul travail à la fois.

La validation est celle du CLI : `startTime` et `endTime` vont ensemble,
`endTime` > `startTime`, seules les URL `http(s)` sont acceptées. Sinon l'hôte
répond `invalid_arguments`.

## Réponses

Ce sont les événements du CLI (`started`, `log`, `progress`, `phase`, `encodingPlan`,
`completed`, `error`, `doctor`) avec le champ `id` ajouté juste après `type`. `progress` porte toujours `percent`
(plus `stage`, et `pass` pour `encode`) ; `phase` (`stage` = `inspection`, `download` ou `merge`) annonce le début
d'une phase sans pourcentage et peut être ignoré (détails dans [CLI_PROTOCOL.md](CLI_PROTOCOL.md)).

`openFolder` répond `{"type":"opened","id":"…"}`. Aucun chemin n'est accepté du client : seul le dernier dossier de sortie est ouvrable, sinon `no_folder`.

`pickFolder` répond `{"type":"folderPicked","id":"…","path":"<chemin absolu>"}` lorsque l'utilisateur choisit un
dossier, ou `{"type":"folderPicked","id":"…"}` sans champ `path` s'il annule (annuler = pas de chemin). Si aucun
sélecteur n'est disponible ou s'il échoue, l'hôte répond l'erreur `pick_failed`. Le sélecteur est
la boîte « Rechercher un dossier » de Windows (`FolderBrowserDialog`, lancée par PowerShell), `zenity` puis `kdialog` (Linux).

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
  ouvert. `cancel` ferme le sélecteur et la réponse est alors un `folderPicked` sans `path`.
- `doctor` est traité immédiatement, même pendant un travail.
- Une requête trop grande reçoit `message_too_large`, sans `id`.
- Un `id` qui n'est pas une chaîne est ignoré.
- Message mal formé ou de type inconnu : `invalid_message`.
- Fin de stdin (EOF) : le travail éventuel est annulé et l'hôte se termine avec le
  code `0` (code `1` si stdin se ferme au milieu d'un message). L'hôte lit stdin pendant tout travail, si bien
  qu'un navigateur arrêté brutalement arrête aussi yt-dlp et FFmpeg.

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
<- {"type":"phase","id":"7","stage":"inspection"}
<- {"type":"progress","id":"7","stage":"download","percent":42.5}
<- {"type":"completed","id":"7","path":"C:\\Users\\Moi\\Videos\\v.mp4","bytes":9853214}
-> {"type":"download","id":"8","url":"https://example.com/w"}
<- {"type":"error","id":"8","code":"busy","message":"Un traitement est déjà en cours."}
```

(Chaque ligne représente un message encadré par sa longueur.)
