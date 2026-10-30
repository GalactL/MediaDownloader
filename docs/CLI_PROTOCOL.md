# Protocole du CLI

Une application appelante (par exemple HUB) lance `MediaDownloader.Cli.exe` comme processus enfant, lit sa sortie standard
ligne par ligne et analyse chaque ligne comme un objet JSON UTF-8. La sortie
d'erreur est redirigée avec la sortie standard par le moteur lorsqu'il lance les
outils externes ; l'appelant ne doit donc pas analyser directement les messages de
`yt-dlp` ou FFmpeg.

## Lancement conseillé

```text
MediaDownloader.Cli.exe download
  --url <URL>
  --quality <best|hauteur>
  --format mp4
  --title <titre facultatif>
  --start-time <début en secondes facultatif>
  --end-time <fin en secondes facultative>
  --max-size-mb <taille facultative>
  --cookies-from-browser <navigateur facultatif>
  --low-resources   (facultatif)
```

Les options temporelles doivent être transmises ensemble. Les valeurs sont des
nombres finis supérieurs ou égaux à zéro et `end-time` doit être strictement
supérieur à `start-time`.

L'authentification accepte `edge`, `chrome`, `firefox`, `brave`, `opera` et
`vivaldi`. Elle doit rester facultative et n'être activée que pour les contenus
auxquels le compte local a légitimement accès. L'appelant ne doit jamais demander le mot
de passe du compte ni recopier les cookies dans ses propres fichiers de réglages.

`--low-resources` (option facultative, sans valeur) économise les ressources de la machine : FFmpeg est lancé en priorité
la plus basse (`nice 19` sous Linux, `IDLE_PRIORITY_CLASS` sous Windows) avec `-threads 2`. Sans cette option, les
arguments de FFmpeg et les événements sont exactement ceux d'avant. Le moteur traite de toute façon un seul job à la fois.

L'absence de `--output` sélectionne le dossier connu Windows `FOLDERID_Videos`,
indexé par la médiathèque Windows.

## Événements

| Type | Rôle | Champs principaux |
|---|---|---|
| `started` | Traitement accepté | `outputDirectory` |
| `log` | Information provenant du téléchargement | `level`, `message` |
| `progress` | Avancement chiffré | `percent`, `stage` facultatif, `pass` facultatif |
| `phase` | Début d'une phase sans pourcentage (facultatif) | `stage` |
| `encodingPlan` | Paramètres calculés | `durationSeconds`, `videoKbps`, `audioKbps` |
| `completed` | Fichier final disponible | `path`, `bytes` |
| `error` | Échec terminal | `code`, `message` |

### Événements `progress` et `phase`

`progress` garde son format d'origine : `percent` (0 à 100, une décimale) est toujours présent. `stage`
(`download` ou `encode`) l'accompagne quand la phase est connue, et `pass` (1 ou 2) n'apparaît que pour `encode`.

`phase` est un événement facultatif `{"type":"phase","stage":"…"}` émis au début d'une phase qui n'a pas de
pourcentage : l'appelant affiche alors une progression indéterminée avec le nom de la phase. Un appelant qui ne
connaît pas `phase` peut l'ignorer.

| Événement | `stage` | Quand |
|---|---|---|
| `phase` | `inspection` | juste après `started`, pendant que yt-dlp analyse la page |
| `phase` | `download` | début du transfert tant que yt-dlp ne fournit pas de pourcentage (extrait avec `--start-time`/`--end-time`, flux fragmentés sans nombre de fragments) |
| `phase` | `merge` | assemblage vidéo + audio par yt-dlp |
| `progress` | `download` | pourcentage global lissé du téléchargement (voir ci-dessous) |
| `progress` | `encode` | réencodage deux passes (avec `--max-size-mb`) : 0 à 100 sur les deux passes ; chaque passe est annoncée à son début (0 puis 50) |

Le dernier événement avant `completed` est toujours un `progress` à `percent` 100.

Le pourcentage `download` est monotone : yt-dlp télécharge la vidéo puis l'audio séparément (la progression repart de 0),
le moteur répartit donc la vidéo sur 0 à 85 % et l'audio sur 85 à 100 %. Un téléchargement d'un seul flux s'arrête à
85 % jusqu'à la fin réelle.

Le moteur lance yt-dlp avec `--progress` (`--print` impose `--quiet`, qui supprime sinon toute progression) et trois
gabarits dont les lignes ne sont jamais recopiées dans les événements `log` :

- `--progress-template download:__MD_PROGRESS__:<status>|<downloaded_bytes>|<total_bytes>|<total_bytes_estimate>|<fragment_index>|<fragment_count>|<format_id>`
  (champ absent = `NA`) ;
- `--progress-template postprocess:__MD_POST__:<status>|<postprocessor>` (`started|Merger` = début de l'assemblage) ;
- `--print before_dl:__MD_DL__:<id>` (fin de l'analyse, début du transfert).

Après `completed`, l'appelant peut rafraîchir sa liste de vidéos. Un événement `error` ou un code de sortie non nul ne doit
pas déclencher de rafraîchissement.

## Commande `doctor`

`doctor` émet un événement `{"type":"doctor","tools":{"yt-dlp":…,"ffmpeg":…,"javascript-runtime":…}}` (il n'y a plus
de champ `ffprobe` : la durée est lue avec `ffmpeg -i`). Code `0` si yt-dlp et FFmpeg sont trouvés, `3` sinon. Le
runtime JavaScript (Deno ou Node) n'est exigé que si `--url` désigne une URL YouTube ; sinon il est seulement
rapporté. L'option `--ffprobe` reste acceptée mais est ignorée. Le téléchargement n'émet l'avertissement « Aucun
runtime JavaScript compatible » que pour une URL YouTube.

## Commande `update`

`MediaDownloader.Cli update` (sans argument ; tout argument donne le code 2) exécute `yt-dlp -U` ; chaque ligne de
sortie est relayée dans un événement `log` de niveau `info`. Pas de nouveau type d'événement. Code `0` en cas de succès,
`3` (`error` `tool_missing`) si yt-dlp est introuvable, `4` en cas d'échec (`error` `update_failed`) ou d'annulation.
Non exposée par l'hôte natif.

## Commande `uninstall-host`

`MediaDownloader.Cli uninstall-host` (sans argument ; tout argument donne le code 2) supprime le manifeste écrit par
`install-host` et, sous Windows, la clé de registre `HKCU\Software\Mozilla\NativeMessagingHosts\media_downloader`.
Rien à supprimer n'est pas une erreur (code `0`). La sortie standard reste vide, le message est écrit sur la sortie
d'erreur ; en cas d'échec, un événement `error` est émis et le code est `4`.

## Commande `install-host`

`MediaDownloader.Cli install-host` (sans argument ; tout argument donne le code 2)
écrit le manifeste de messagerie native de Firefox (voir
[NATIVE_HOST_PROTOCOL.md](NATIVE_HOST_PROTOCOL.md)). La sortie standard reste vide :
le message de réussite est écrit sur la sortie d'erreur. En cas d'échec, un
événement `error` est émis et le code de sortie est `4`.

Si le dossier `--output` est inutilisable (fichier existant, création impossible, droits d'écriture refusés ;
l'écriture est vérifiée par un fichier témoin), le téléchargement n'échoue pas : le moteur se replie sur le dossier
Vidéos et émet avant `started` un événement `log` de niveau `warning` (« Dossier de sortie inutilisable (…),
enregistrement dans le dossier Vidéos : … »). `started` porte le dossier réellement utilisé. Seul un dossier Vidéos
lui-même inutilisable produit l'événement `error` `invalid_output_directory` (message en français contenant le
chemin) et le code de sortie `4`.

## Codes de sortie

- `0` : réussite ;
- `2` : arguments invalides ;
- `3` : dépendance externe manquante ;
- `4` : téléchargement, inspection, encodage ou annulation en échec.

## Annulation

L'appelant doit envoyer `CTRL_BREAK_EVENT` au groupe de processus lorsque cela est
possible. Le moteur interrompt le processus externe actif et supprime son dossier
temporaire. Il ne place le fichier dans Vidéos qu'après validation complète.

## Précautions d'interface

- Ne jamais construire une ligne de commande par concaténation non échappée dans
  l'appelant : transmettre chaque option comme un argument distinct.
- Afficher les messages `error.message`, mais utiliser `error.code` pour décider
  du comportement de l'interface.
- Désactiver un second lancement dans le même panneau tant que le premier n'a pas
  produit `completed` ou `error`.
