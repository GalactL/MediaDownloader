# Protocole d'intégration HUB

HUB lance `MediaDownloader.Cli.exe` comme processus enfant, lit sa sortie standard
ligne par ligne et analyse chaque ligne comme un objet JSON UTF-8. La sortie
d'erreur est redirigée avec la sortie standard par le moteur lorsqu'il lance les
outils externes ; HUB ne doit donc pas analyser directement les messages de
`yt-dlp` ou FFmpeg.

## Lancement conseillé

```text
MediaDownloader.Cli.exe download
  --url <URL>
  --quality <best|hauteur>
  --format mp4
  --title <titre facultatif>
  --max-size-mb <taille facultative>
  --cookies-from-browser <navigateur facultatif>
```

L'authentification accepte `edge`, `chrome`, `firefox`, `brave`, `opera` et
`vivaldi`. Elle doit rester facultative et n'être activée que pour les contenus
auxquels le compte local a légitimement accès. HUB ne doit jamais demander le mot
de passe du compte ni recopier les cookies dans ses propres fichiers de réglages.

L'absence de `--output` sélectionne le dossier connu Windows `FOLDERID_Videos`,
identique à celui utilisé par la médiathèque HUB.

## Événements

| Type | Rôle | Champs principaux |
|---|---|---|
| `started` | Traitement accepté | `outputDirectory` |
| `log` | Information provenant du téléchargement | `level`, `message` |
| `progress` | Avancement | `stage`, `percent`, `pass` facultatif |
| `encodingPlan` | Paramètres calculés | `durationSeconds`, `videoKbps`, `audioKbps` |
| `completed` | Fichier final disponible | `path`, `bytes` |
| `error` | Échec terminal | `code`, `message` |

Après `completed`, HUB peut appeler sa méthode `LoadVideosAsync()` pour faire
apparaître le fichier. Un événement `error` ou un code de sortie non nul ne doit
pas déclencher de rafraîchissement.

## Codes de sortie

- `0` : réussite ;
- `2` : arguments invalides ;
- `3` : dépendance externe manquante ;
- `4` : téléchargement, inspection, encodage ou annulation en échec.

## Annulation

HUB doit envoyer `CTRL_BREAK_EVENT` au groupe de processus lorsque cela est
possible. Le moteur interrompt le processus externe actif et supprime son dossier
temporaire. Il ne place le fichier dans Vidéos qu'après validation complète.

## Précautions d'interface

- Ne jamais construire une ligne de commande par concaténation non échappée dans
  HUB : transmettre chaque option comme un argument distinct.
- Afficher les messages `error.message`, mais utiliser `error.code` pour décider
  du comportement de l'interface.
- Désactiver un second lancement dans le même panneau tant que le premier n'a pas
  produit `completed` ou `error`.
