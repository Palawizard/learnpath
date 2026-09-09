# Plan d'implémentation

Un lot = une session d'agent. Faire les lots dans l'ordre. Ne pas anticiper sur le suivant.
Chaque lot doit finir avec `npm run compile` et `npm test` au vert.

---

## Lot 0 — Socle

**But** : l'extension s'active et affiche un panneau vide.

- `package.json` : manifest complet (commandes, activation, vue latérale)
- `tsconfig.json` strict, build esbuild, `npm run watch`
- `src/extension.ts` : activation, commande `learnpath.open` qui ouvre une webview vide
- `.vscode/launch.json` fonctionnel (F5 lance l'Extension Development Host)

**Fini quand** : F5 ouvre une fenêtre, la commande « LearnPath: Ouvrir » affiche un panneau
avec le titre du projet.

---

## Lot 1 — Types et validation du parcours

**But** : charger un JSON de parcours et le refuser proprement s'il est mauvais.

- `schema/parcours.schema.json` : JSON Schema complet du format (voir `SPEC-PARCOURS.md`)
- `src/core/parcours.ts` : types TS dérivés du schéma, `loadParcours(json) → Result`
- `src/core/paths.ts` : `safeResolve(root, p)` qui rejette `..`, les chemins absolus, et
  tout ce qui sort de `root`. **Tester ce module agressivement**, c'est la surface d'attaque.
- Tests unitaires avec `examples/exemple-panier.json` comme cas nominal, plus des variantes
  volontairement cassées.

**Fini quand** : `loadParcours` accepte l'exemple et rejette avec un message utile un
parcours sans `runner`, avec un `tests.file` contenant `..`, avec deux étapes de même id.

---

## Lot 2 — Import dans le workspace

**But** : matérialiser un parcours sur disque.

- `src/core/importer.ts` :
  - crée `.learn/`, écrit les fichiers de test depuis `steps[].tests.content`
  - génère `.learn/vitest.config.ts` (include = `.learn/tests/**`, root = workspace)
  - joue `runner.setup` avec sortie visible pour l'utilisateur
  - ajoute `.learn/state.json` et `.learn/.result.json` au `.gitignore` s'il existe
- `src/core/state.ts` : création, lecture, écriture, avancement, solutions révélées
- Commande `learnpath.import` avec sélecteur de fichier

**Fini quand** : importer `exemple-panier.json` dans un projet vide crée l'arborescence
complète et `npx vitest run --config .learn/vitest.config.ts` s'exécute (en échouant).

---

## Lot 3 — Runner et classification

**But** : le cœur technique. Lancer, parser, classer.

- `src/runner/vitest.ts` : construit et lance la commande, avec timeout et annulation
- `src/runner/parse.ts` : lit `.learn/.result.json` → structure exploitable
- `src/runner/classify.ts` : `missing-file` | `parse-error` | `assertion-failed` | `pass`
- Fixtures réelles dans `src/runner/__fixtures__/` : capturer de vraies sorties Vitest pour
  chacun des quatre cas, ne pas les écrire à la main
- `src/core/verify.ts` : à l'import, lance tout et exige que **chaque étape soit rouge**.
  Une étape verte avant écriture = parcours invalide, on le signale en nommant l'étape.

**Fini quand** : les quatre classifications sont couvertes par des tests sur fixtures, et
`verify` rejette un parcours dont une étape passe d'entrée.

---

## Lot 4 — Watcher et boucle de progression

**But** : la magie « ça avance tout seul ».

- `src/watcher.ts` : `onDidSaveTextDocument`, filtre sur `expected.files` de l'étape
  courante, debounce 500ms, annule un run en cours si un nouveau save arrive
- Régression : lancer l'étape courante **et** les étapes précédentes
- Au vert : `state.advance()`, notification discrète, rendu de l'étape suivante
- Commande manuelle `learnpath.runStep` en secours
- Fin de parcours : écran de fin + proposition de déplacer `.learn/tests/` vers le dossier
  de tests du projet

**Fini quand** : sur le projet démo, coller la solution de l'étape 1 et sauvegarder fait
passer l'UI à l'étape 2 sans aucun clic.

---

## Lot 5 — Interface du panneau

**But** : rendre le tout agréable.

- Rendu markdown de `explanation`
- Compteur `Étape n/N`, barre de progression
- Bloc « Attendu » : contrat + critères d'acceptation
- Hints révélés un par un
- Bouton « Solution » avec confirmation, marque l'étape comme révélée dans le state
- Affichage différencié des trois états rouges (voir `UX.md`)
- Thème : utiliser les variables CSS de VSCode, jamais de couleur en dur

**Fini quand** : le parcours panier se joue de bout en bout confortablement.

---

## Lot 6 — Robustesse et publication

- Projet existant qui a déjà Vitest : vérifier la non-interférence
- Reprise après fermeture de l'éditeur en cours de parcours
- Reset de parcours
- README, capture d'écran, publication sur Open VSX **et** le marketplace VS Code
- Test manuel complet sur VSCodium

---

## Après le v1

Dans cet ordre de priorité présumé, à revalider avec de vrais utilisateurs :

1. pytest, pour ouvrir à Python
2. Un générateur intégré optionnel, via CLI locale en sous-processus
3. Parcours multiples et historique
