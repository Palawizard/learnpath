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
  - génère `.learn/vitest.config.mts` (include = `.learn/tests/**`, root = workspace)
  - joue `runner.setup` avec sortie visible pour l'utilisateur
  - ajoute `.learn/state.json` au `.gitignore`, et le crée s'il n'existe pas (D13)
- `src/core/state.ts` : création, lecture, écriture, avancement, solutions révélées
- Commande `learnpath.import` avec sélecteur de fichier

**Fini quand** : importer `exemple-panier.json` dans un projet vide crée l'arborescence
complète et `npx vitest run --config .learn/vitest.config.mts` s'exécute (en échouant).

---

## Lot 3 — Runner et classification

**But** : le cœur technique. Lancer, parser, classer.

- `src/runner/vitest.ts` : construit et lance la commande, avec timeout et annulation
- `src/runner/parse.ts` : lit le rapport JSON du run → structure exploitable
- `src/runner/classify.ts` : `missing-file` | `collect-error` | `assertion-failed` | `pass`
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

## Lot 6 — Fiabilisation

Le lot 6 initial mélangeait la fiabilisation et la publication. Les deux ne se jugent pas
avec les mêmes critères : la publication attend un produit dont on est sûr. Scindé.

- `verifyAllGreen` : à l'import, appliquer les solutions étape par étape dans une copie
  temporaire du workspace et exiger après chaque étape N que les étapes 1..N soient toutes
  vertes. Attrape la solution qui régresse **et** celle qui ne passe pas ses propres tests,
  et les nomme différemment (D21)
- `src/core/humanize.ts` : traduction des formes d'erreur Vitest fréquentes, le message
  brut toujours visible en dessous, aucune forme non reconnue reformulée (D22)
- Indicateur de run en cours dès la fin du debounce, et affichage périmé de la tentative
  précédente pendant ce temps
- Ergonomie : panneau de fin réduit au récapitulatif, barre de progression segmentée
  cohérente avec le compteur
- `learnpath.reset` : recommencer depuis l'étape 1, ou nettoyer le parcours en gardant son JSON généré (D23, D38)
- Gestionnaires de paquets : pnpm traité, Yarn PnP refusé avec un message clair
- Non-interférence avec un projet qui a déjà Vitest et sa config, dans les deux sens
- Reprise à la bonne étape après fermeture de l'éditeur

**Fini quand** : les deux parcours fautifs de `src/core/__fixtures__/` sont refusés avec le
bon diagnostic, l'import est mesuré sur un vrai projet npm, un vrai projet pnpm et un
projet qui a déjà Vitest.

---

## Lot 7 — Publication

- README pour l'utilisateur final, emplacements des captures
- LICENSE, métadonnées du paquet, icône, `.vscodeignore`, VSIX
- CI GitHub Actions : ubuntu + windows, Node 20 et 22
- `docs/MANUAL-QA.md` : la checklist de ce qu'un humain doit vérifier à l'écran
- Publication sur Open VSX **et** le marketplace VS Code
- Test manuel complet sur VSCodium, et sur l'Extension Development Host de VS Code :
  focus, thème contrasté, annonce `aria-live`, animation

**Fait, sauf** la publication elle-même et tout ce qui demande un écran : voir
`MANUAL-QA.md` et la tête de `HANDOFF.md`.

---

## Lot 8 — Python (pytest)

**But** : jouer un parcours Python avec la même boucle, les mêmes garanties et la même
interface que les parcours Vitest (D39).

- `runner.kind: "pytest"` dans le schéma ; `environment` refusé, nom de fichier de test
  imposé (module Python), liste blanche de `setup` propre à l'écosystème
- `src/runner/pytest.ts` + `junit.ts` : argv construit, config isolée `.learn/pytest.ini`,
  rapport JUnit XML natif, fixtures réelles dans `src/runner/__fixtures__/pytest/`
- `src/runner/run-tests.ts` : l'aiguillage unique, branché dans `verify.ts` et
  `progression.ts`
- Résolution de l'interpréteur (`.venv`, `venv`, `VIRTUAL_ENV`, PATH) et exécution de
  `pip`/`python -m venv` avec le bon Python
- `classify`, `humanize` : formes pytest (`No module named`, `cannot import name`…)
- Prompt de génération, bandeau du formulaire, exemple `exemple-panier-python.json`, CI

**Fait**, vrais runs pytest compris. Reste la vérification à l'écran : points 85 à 96 de
`MANUAL-QA.md`.

---

## Après le v1

Dans cet ordre de priorité présumé, à revalider avec de vrais utilisateurs :

1. ~~pytest, pour ouvrir à Python~~ — fait au lot 8 (D39)
2. Un générateur intégré optionnel, via CLI locale en sous-processus
3. Parcours multiples et historique
