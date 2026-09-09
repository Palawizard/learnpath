# Vérification manuelle avant publication

Ce que seul un humain devant un écran peut confirmer. Aucune session d'agent n'a d'accès à
l'Extension Development Host ni à VSCodium : **tout ce qui suit est non vérifié** tant que
quelqu'un n'a pas coché les cases.

Une ligne = un point à regarder, avec le résultat attendu. Coche, ou note ce que tu as vu.

## Comment se mettre en position

1. `npm install`, puis `F5` dans le dépôt : ça ouvre l'Extension Development Host.
2. Dans la fenêtre qui s'ouvre, ouvre un dossier vide contenant un `package.json`
   (`{ "name": "essai", "private": true, "type": "module" }`).
3. **LearnPath : Importer un parcours…** et choisis `examples/exemple-panier.json`.
4. Pour VSCodium : `npx vsce package`, puis dans VSCodium **Extensions → … → Installer à
   partir d'un VSIX**, et reprends au point 2.

Pour provoquer les états à la demande : supprimer le fichier de l'étape (fichier absent),
y écrire `function (` (code invalide), écrire une implémentation fausse mais valide
(assertion en échec).

---

## Import

| # | À vérifier | Attendu |
|---|---|---|
| 1 | Le dialogue de confirmation du setup | Affiche la commande **exacte** (`npm i -D vitest`), et rien ne s'installe si on refuse |
| 2 | Refuser le setup | Le projet est rendu tel qu'il était : pas de `.learn/`, `.gitignore` inchangé |
| 3 | La barre de progression pendant l'import | Visible, et le texte change à chaque étape vérifiée (« étape 1.3 (3/5) ») |
| 4 | Import d'un parcours fautif (`src/core/__fixtures__/solution-regressive.json`) | Message d'erreur nommant l'étape, et **rien** n'est laissé dans le projet |
| 5 | Le panneau après un import réussi | S'ouvre sur l'étape 1.1, sans que le curseur quitte l'éditeur |

## Les trois états rouges

| # | À vérifier | Attendu |
|---|---|---|
| 6 | Fichier de l'étape absent | **Rien** dans la zone d'état. Pas de rouge, pas de message d'erreur |
| 7 | Fichier présent mais code invalide | Ligne **grise** discrète « le fichier n'est pas encore valide » + le message brut. Jamais de rouge |
| 8 | Assertion en échec | Bandeau **rouge**, nom complet du test, attendu / reçu lisibles |
| 9 | Message traduit (ex. `is not a function`) | La traduction française passe en premier, le message brut est replié juste en dessous et se déplie |
| 10 | Erreur non reconnue | S'affiche seule, telle quelle, sans reformulation inventée |

## Run en cours

| # | À vérifier | Attendu |
|---|---|---|
| 11 | Sauvegarder le fichier de l'étape | Après ~0,5 s, la ligne « Tests en cours… » apparaît au-dessus de la zone d'état |
| 12 | Le bandeau de la tentative précédente pendant le run | **Grisé**, encore lisible, mais visiblement pas à jour |
| 13 | Sauvegarder deux fois de suite rapidement | L'indicateur reste allumé sans clignoter, un seul résultat s'affiche à la fin |
| 14 | Sauvegarder un fichier **hors** de l'étape | Rien ne se lance |

## Progression

| # | À vérifier | Attendu |
|---|---|---|
| 15 | Barre segmentée | Un segment par étape : plein = acquise, contour = en cours, vide = à venir. Jamais une jauge continue |
| 16 | Compteur et barre | « Étape 2 / 5 » et deux segments touchés : les deux comptent la même chose |
| 17 | Passage au vert | Flash vert bref, puis étape suivante. **Aucune modale** |
| 18 | Casser une étape déjà validée | L'étape courante reste verte, un bandeau **séparé** nomme l'étape qui ne passe plus, la progression est présentée comme en attente et non comme un échec |

## Indices et solution

| # | À vérifier | Attendu |
|---|---|---|
| 19 | Bouton « Indice » | Révèle un indice à la fois, du plus vague au plus précis ; un indice révélé le reste après rechargement du panneau |
| 20 | Dialogue « Solution » | Texte neutre, sans culpabilisation ; annuler n'écrit rien |
| 21 | Confirmer « Solution » | Le fichier de l'étape est écrit, les tests passent normalement, l'étape est marquée révélée |

## Écran de fin

| # | À vérifier | Attendu |
|---|---|---|
| 22 | Après la dernière étape | L'énoncé, le bloc « Attendu » et les boutons **disparaissent** |
| 23 | Le récapitulatif | Étapes réussies seules / avec indices / révélées, distinguées |
| 24 | Le compteur | « Parcours terminé — 5 étapes », tous les segments pleins |
| 25 | La proposition de déplacer `.learn/tests/` | Présente et compréhensible |

## Réinitialiser

| # | À vérifier | Attendu |
|---|---|---|
| 26 | **LearnPath : Réinitialiser le parcours** | **Un seul** dialogue, deux choix, et un texte qui dit explicitement que le code écrit n'est jamais touché |
| 27 | « Recommencer depuis l'étape 1 » | Progression remise à zéro, `.learn/tests/` toujours là, code de l'utilisateur intact |
| 28 | « Supprimer le parcours » | `.learn/` disparaît entièrement, code de l'utilisateur intact |
| 29 | Réinitialiser avec un `state.json` volontairement corrompu | Fonctionne quand même (le parcours est relu directement) |

## Focus et accessibilité

| # | À vérifier | Attendu |
|---|---|---|
| 30 | Ouverture du panneau pendant qu'on tape | Le curseur **reste** dans l'éditeur, la frappe n'est pas interrompue |
| 31 | Passage d'étape pendant qu'on tape | Idem : aucun vol de focus, aucune modale |
| 32 | Lecteur d'écran (NVDA, VoiceOver ou Orca) | Le changement d'état est **annoncé** via la région `aria-live` : « Tests en cours », le résultat, le passage d'étape |
| 33 | Navigation au clavier seul | Les boutons Indice et Solution sont atteignables par Tab, avec un contour de focus visible |
| 34 | Réglage système « réduire les animations » | Le flash vert ne s'anime plus (`prefers-reduced-motion`) |

## Thèmes

Rejouer les points 6, 8, 15 et 22 dans chaque thème — c'est là que les couleurs codées en
dur se voient.

| # | À vérifier | Attendu |
|---|---|---|
| 35 | Thème clair (Light+ / Light Modern) | Texte lisible, rouge et vert distinguables, bandeau grisé encore lisible |
| 36 | Thème sombre (Dark+ / Dark Modern) | Idem |
| 37 | Thème à contraste élevé (High Contrast Dark **et** Light) | Toutes les bordures visibles, aucun texte gris sur gris, segments de la barre distinguables sans la couleur |
| 38 | Un thème communautaire quelconque | Rien ne devient illisible : le panneau n'utilise que des variables `--vscode-*` |

## VSCodium — le parcours panier de bout en bout

Le point qui compte le plus : la promesse du projet est « ça tourne à l'identique sur
VSCodium ».

| # | À vérifier | Attendu |
|---|---|---|
| 39 | Installation du VSIX dans VSCodium | S'installe et s'active sans erreur dans la console |
| 40 | Import de `examples/exemple-panier.json` | Réussit, même durée qu'en VS Code (~10 s) |
| 41 | Les cinq étapes jouées **en écrivant le code soi-même** | Chaque étape passe au vert et enchaîne toute seule |
| 42 | L'écran de fin | Identique à VS Code |
| 43 | Console de développement (Aide → Bascule Outils de développement) | Aucune erreur, aucun avertissement de CSP |
| 44 | Après désinstallation de l'extension | Le projet reste utilisable : `.learn/tests/` tourne toujours avec Vitest |

---

## Quand c'est fini

Reporte le résultat dans `docs/HANDOFF.md`, section « Ce qui n'a pas pu être vérifié » :
ce qui est confirmé sort de la liste, ce qui a échoué devient une ligne dans « Ce qui
bloque ». Sans ça, la publication reste en attente.
