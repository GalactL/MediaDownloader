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
```

Les options temporelles doivent être transmises ensemble. Les valeurs sont des
nombres finis supérieurs ou égaux à zéro et `end-time` doit être strictement
supérieur à `start-time`.

L'authentification accepte `edge`, `chrome`, `firefox`, `brave`, `opera` et
`vivaldi`. Elle doit rester facultative et n'être activée que pour les contenus
auxquels le compte local a légitimement accès. L'appelant ne doit jamais demander le mot
de passe du compte ni recopier les cookies dans ses propres fichiers de réglages.

L'absence de `--output` sélectionne le dossier connu Windows `FOLDERID_Videos`,
indexé par la médiathèque Windows.

## Événements

| Type | Rôle | Champs principaux |
|---|---|---|
| `started` | Traitement accepté | `outputDirectory` |
| `log` | Information provenant du téléchargement | `level`, `message` |
| `progress` | Avancement | `stage`, `percent`, `pass` facultatif |
| `encodingPlan` | Paramètres calculés | `durationSeconds`, `videoKbps`, `audioKbps` |
| `completed` | Fichier final disponible | `path`, `bytes` |
| `error` | Échec terminal | `code`, `message` |

Après `completed`, l'appelant peut rafraîchir sa liste de vidéos. Un événement `error` ou un code de sortie non nul ne doit
pas déclencher de rafraîchissement.

## Commande `install-host`

`MediaDownloader.Cli install-host` (sans argument ; tout argument donne le code 2)
écrit le manifeste de messagerie native de Firefox (voir
[NATIVE_HOST_PROTOCOL.md](NATIVE_HOST_PROTOCOL.md)). La sortie standard reste vide :
le message de réussite est écrit sur la sortie d'erreur. En cas d'échec, un
événement `error` est émis et le code de sortie est `4`.

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
