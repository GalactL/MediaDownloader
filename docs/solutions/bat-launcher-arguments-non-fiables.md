---
title: Ne jamais passer d'arguments non fiables par le lanceur .bat
tags: [securite, windows, cli, native-messaging]
areas: [docs/CLI_PROTOCOL.md, engine/main.ts]
verified_against: 635056f1fe5b599ee4e93ee22071b45ae07f793b
last_verified: 2026-11-04
---
# Un `.bat` n'est pas un point d'entrée sûr pour des arguments non fiables

**Symptôme** : une URL contenant `"&commande&"` injecte une commande (reproduit par la revue finale).

**Cause** : cmd.exe ne comprend pas l'échappement `\"` produit par Deno.Command, Node et Rust. Node 18.20+ et Rust refusent aussi de lancer un `.bat` sans shell.

**Non concerné** : Firefox native messaging (trames JSON sur stdin, aucun argument utilisateur).

**Règle** : les appelants programmatiques lancent `tools\bin\deno.exe run <flags> engine\main.ts` avec un tableau d'arguments ; ne jamais faire transiter une chaîne non fiable par le `.bat`. Documenté dans `docs/CLI_PROTOCOL.md` (« Appel programmatique »).

**Faits établis au spike T0** :
- Firefox 159 démarre l'hôte via `cmd.exe /s/c ""<bat>" "<manifeste>" <id>"` (sans `/d`).
- Les trames binaires, y compris les octets de longueur 0x0A, 0x0D, 0x1A, passent intactes.
- La conséquence d'une AutoRun cmd.exe n'a PAS été testée.
