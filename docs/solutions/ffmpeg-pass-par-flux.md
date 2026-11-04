---
title: Utiliser -pass:v (pas -pass) et tester les arguments contre le binaire épinglé
tags: [ffmpeg, encodage, tests]
areas: [engine/core.ts, engine/test/encode-real.test.ts]
verified_against: 635056f1fe5b599ee4e93ee22071b45ae07f793b
last_verified: 2026-11-04
retire_when: le binaire FFmpeg épinglé (BtbN N-128352, engine/deps.json) change ; relancer encode-real.test.ts contre le nouveau binaire
---
# `-pass N` s'applique à tous les flux de sortie

**Symptôme** : la passe 2 échoue avec `Error reading log file 'ffmpeg-pass-1.log' for pass-2 encoding`.

**Cause** : `-pass N` nu vaut pour chaque flux de sortie. Avec FFmpeg récent (BtbN N-128352), l'encodeur audio AAC tente lui aussi de lire `ffmpeg-pass-1.log`. Le FFmpeg gyan 9.0.2 et les faux outils des tests acceptaient la forme nue.

**Détection** : uniquement par le test de bout en bout avec le vrai Firefox. Les tests unitaires avec faux outils ne peuvent pas voir un comportement propre à une version.

**Règle** :
- Utiliser `-pass:v N` (`buildEncodeArguments` dans `engine/core.ts`).
- Toute liste d'arguments passée à un outil externe doit être exécutée au moins une fois contre le binaire exact épinglé : test optionnel `engine/test/encode-real.test.ts`, et faux outils qui rejettent la forme nue.

**Preuves** : commits a4a4ea4 et 635056f (branche feat/deno-engine-61).
