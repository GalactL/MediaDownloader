# Signature et distribution de l'extension Firefox

Firefox stable n'installe que les extensions signées par Mozilla. Les releases
fournissent `mediadownloader.xpi` (dans chaque archive et en pièce jointe de la
release), produit par le job `extension` de `.github/workflows/release.yml` : le
contenu de `extension/` sans `test/` ni `README.md`.

## Signature (canal non répertorié)

Le job exécute `web-ext sign --channel=unlisted` uniquement si les deux secrets
du dépôt sont définis :

- `AMO_JWT_ISSUER` : clé API (« JWT issuer ») ;
- `AMO_JWT_SECRET` : secret API.

Ils se créent sur https://addons.mozilla.org/developers/addon/api/key/ . Les
secrets sont transmis par variables d'environnement et jamais affichés.

Sans secrets, le workflow n'échoue pas : il émet un avertissement et joint un
`.xpi` **non signé**, utilisable seulement avec Firefox Developer/Nightly
(`xpinstall.signatures.required` à `false`) ou en chargement temporaire.

Relances : Mozilla refusant de signer deux fois la même version, le job
interroge d'abord AMO (`tools/fetch-signed-xpi.mjs`, authentifié par JWT avec les
mêmes secrets). Si la version de `extension/manifest.json` est déjà signée, son
`.xpi` est téléchargé et réutilisé ; sinon (réponse 404) `web-ext sign` est
lancé. Une release dont le job a échoué après la signature peut donc être
relancée sans incrémenter la version. Aucun artefact GitHub n'est utilisé (quota de
stockage) : le job `extension` signe une fois, puis chaque job `build` relance
`tools/make-xpi.sh`, qui retrouve le `.xpi` déjà signé. Les points d'accès AMO utilisés n'ont pas
été éprouvés en conditions réelles.

## Points d'attention

- Mozilla refuse de signer deux fois la même version : incrémenter `version`
  dans `extension/manifest.json` avant chaque release dont l'extension change.
- L'identifiant `mediadownloader@localhost` (forme e-mail, valide pour AMO) est
  conservé ; il doit rester identique à celui de `install-host`
  (`allowed_extensions`).
- Le canal non répertorié n'est pas publié sur addons.mozilla.org : le fichier
  signé se distribue uniquement via la release GitHub.
- Le workflow n'a pas pu être exécuté lors de son écriture ; premier test réel :
  lancer `workflow_dispatch` avec les secrets définis.
