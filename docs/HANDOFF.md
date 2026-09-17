# Handoff

État courant du projet. **À mettre à jour à la fin de chaque session d'agent.**
Format : on écrase les sections, on n'accumule pas d'historique ici (l'historique est
dans git et dans `DECISIONS.md`).

---

## Date de dernière mise à jour

2026-09-17

## À VÉRIFIER PAR UN HUMAIN AVANT DE PUBLIER

Rien de ce qui suit n'a été fait, et rien ne peut l'être depuis une session d'agent :
aucun accès à l'Extension Development Host, aucun accès à VSCodium.

**La checklist complète est dans [`MANUAL-QA.md`](./MANUAL-QA.md) : 112 points, un par
ligne, avec le résultat attendu.** Dans l'ordre de priorité :

000. **Une série de parcours** (points 29b à 29d) : import du parcours 1 d'`Inventaire/frontend`
   avec les parcours 2 et 3 présents dans le même dossier.
00. **Les aides pédagogiques dans le vrai panneau** (points 97 à 110, nouveaux) : exemples,
   squelette, solution en diff, « À propos », refus d'import pédagogique, et surtout le
   **point 108** — un parcours importé avant la mise à jour doit toujours se jouer.

0. **Jouer le parcours Python de bout en bout dans VSCodium** (points 85 à 96, nouveaux) :
   `examples/exemple-panier-python.json`, dans `examples/demo-project-python`. La boucle
   est vérifiée par de vrais runs pytest hors éditeur, jamais dans un vrai hôte — et le
   point 96 (alias Microsoft Store sous Windows) n'a pu être testé qu'en simulation.
1. **Jouer le parcours panier de bout en bout dans VSCodium** (points 39 à 44). C'est la
   promesse centrale du projet et elle n'a jamais été démontrée.
2. **Les trois états rouges à l'écran** (points 6 à 10) : le point qui décide si le
   produit est agréable ou insupportable.
3. **Thème clair, thème sombre, thème à contraste élevé** (points 35 à 38).
4. **Non-vol du focus et annonce du lecteur d'écran** (points 30 à 34).
5. **Les nouveautés du lot 6 dans le vrai panneau** : « Tests en cours… », bandeau grisé,
   barre segmentée, écran de fin, les trois dialogues (points 1 à 5, 11 à 13, 22 à 28).
6. **La barre d'activité et l'état d'accueil** (points 45 à 54) : l'icône, la vue
   d'accueil sans parcours, l'ouverture automatique sans vol de focus, et les deux actions
   du titre de la vue.
7. **Composer le prompt de génération** (points 74 à 84, nouveaux) : que le prompt copié
   soit bien celui de `prompts/generer-parcours.md` aux trois champs près, et qu'il soit
   **affiché en entier et modifiable** avant la copie (points 79 à 81).
8. **Refaire une étape** (points 55 à 73) : que `git status` et `git log` soient
   rigoureusement inchangés après une étape validée, et surtout le **point 66** — refaire
   une étape dont le fichier est ouvert **et modifié non sauvegardé**. C'est le cas qui a
   produit le bug de D34 ; il est traité par une sauvegarde préalable, et rien ici n'a pu le
   vérifier dans un vrai hôte.
9. **Les captures d'écran** : trois emplacements sont marqués en commentaire dans le
   README, aucune image n'a été inventée. Le marketplace exige des URL https absolues,
   donc les fichiers doivent être poussés sur GitHub et référencés par `raw.githubusercontent`.

Ensuite seulement : `vsce publish` et `ovsx publish`. Le compte `Palawizard` doit exister
sur les deux (marketplace VS Code et Open VSX) — **il n'a pas été créé ni vérifié.**

## Lot en cours

**Lot 9 — Pédagogie**, sur `dev`. Fait côté code ; reste la vérification à l'écran (points
97 à 110). Version **0.3.3** (correctif D45), installée dans VSCodium.

## Ce qui a été fait dans cette session

**Correctif D45 — une étape sur un fichier existant du projet se mesure contre ce fichier.**
Versions **0.3.2** puis **0.3.3**. Un parcours qui modifiait 3 lignes dans des handlers MSW
existants était refusé (« 90 lignes à écrire ») : un fichier qu'aucune étape précédente
n'écrit était compté en entier. Désormais l'import lit ces fichiers (`readBaseline`), les
fige dans `.learn/baseline/<slug>.json`, et `contentBefore` s'en sert en repli — pour la
taille des étapes, pour le diff du panneau (via `Session.baseline`), et pour un réimport en
cours de parcours, qui repart de la base figée. Tests : `pedagogy`, `importer`, `viewmodel`.
QA manuelle **111 et 112**.

**Session d'avant — correctif D44** (0.3.1) : `state.json` désigne le parcours actif ; une
série `1-…`, `2-…`, `3-…` se joue depuis le même dossier.

## Ce qui a été fait dans la session précédente (lot 9)

**Un parcours apprend à coder, syntaxe comprise, et dit ce qu'il ne couvre pas.** Point de
départ : un vrai parcours React (`stock-movements-react`) où l'étudiant a dû afficher la
solution à chaque étape — explications sans code, étapes de 30 à 56 lignes, périmètre réduit
en silence. Raisonnement complet dans **D40 à D43**.

- **Format** (facultatif au schéma, exigé à l'import) : `steps[].examples` (syntaxe sur un
  autre sujet), `steps[].scaffold` (fichier à trous), `scope` à la racine.
- **`src/core/pedagogy.ts`** (neuf) : `checkPedagogy`, appelé par la commande d'import avant
  toute écriture — `scope` présent, un exemple par étape qui ne recopie pas la solution, au
  plus **20 lignes significatives** ajoutées par étape. Pas dans `loadParcours`, pour que les
  parcours déjà importés restent jouables. **`src/core/diff.ts`** (neuf) : LCS ligne à ligne.
- **`loadParcours`** : squelette sur un fichier non déclaré, ou identique à la solution, refusé.
- **State** : `scaffoldsRevealed` (relu vide sur un ancien `state.json`).
- **Panneau** : « À propos de ce parcours » (intro + périmètre, ouvert à l'étape 1), exemples
  colorés (Python ajouté au coloriseur), « Ce que vérifie le test » replié, bouton
  **Squelette** entre Indice et Solution (copie par l'hôte, uniquement si affiché), solution
  et squelette **en diff** quand le fichier existait, bandeau « deux solutions de suite »,
  « Reste à faire » en fin de parcours, récapitulatif « squelette affiché ». Corrigé au
  passage : les indices s'affichaient numérotés deux fois (« 1. 1. »).
- **Prompt** : étape 0 de périmètre (découper et attendre au-delà de dix étapes), règles
  pédagogiques A à F, deux niveaux (`{{NIVEAU}}`, `{{NIVEAU_LANGAGE}}`) et `{{ACQUIS}}`.
  Le formulaire suit, « je découvre la syntaxe » par défaut.
- **Exemples livrés** enrichis (exemples, squelettes 1.1 à 1.4, `scope`), JS et Python.
- Docs : `SPEC-PARCOURS.md`, `UX.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md` (lot 9),
  `MANUAL-QA.md` (77, 78, 81, 97 à 110), `README`, `DECISIONS.md` (D40 à D43).

## Ce qui a été fait dans la session antérieure (lot 8)

**Les parcours Python se jouent avec pytest, avec les mêmes garanties que Vitest.**
Raisonnement complet dans **D39**. Version **0.2.0**.

- **Format** : `runner.kind: "pytest"`. `environment` refusé ; fichier de test imposé en nom
  de module (`.learn/tests/test_step_1_1.py`) ; liste blanche de `setup` par runner (`pip`,
  `uv`, `poetry`, `python -m venv|pip`). Exemple : `examples/exemple-panier-python.json`,
  projet démo `examples/demo-project-python/`.
- **`src/runner/pytest.ts`** (neuf) : `-c .learn/pytest.ini`, fichiers des étapes jouées,
  `--continue-on-collection-errors`, `--junitxml` en temporaire, sans cache ni bytecode.
  **`junit.ts`** (neuf) lit le rapport en `RawResult` sans dépendance. **`run-tests.ts`**
  (neuf) est l'aiguillage unique ; **`spawn.ts`** (neuf) factorise le lancement borné.
- **`exec.ts`** : `pythonFor` (`.venv`, `venv`, `VIRTUAL_ENV`, PATH sans alias du Store) et
  `setupLauncher` (`pip` → `<python> -m pip`, `python -m venv` par le Python système, non
  rejoué si le venv existe).
- **`classify.ts`** : `No module named` et `cannot import name` d'un module attendu =
  `missing-file`. **`humanize.ts`** : sept formes Python traduites.
- **Import** : `.learn/pytest.ini` au lieu de la config Vitest, `.gitignore` sans `.vite`.
- **Prompt** (`prompts/generer-parcours.md`) : choix du runner selon le projet, règles
  pytest. Le bandeau du formulaire reconnaît un projet Python.
- **UI** : « Message brut du runner de tests » au lieu de « … de Vitest ».
- **CI** : `setup-python`, `pip install pytest`, `LEARNPATH_REQUIRE_PYTEST=1`.
- Docs : `AGENTS.md` (règle 4, tests, pièges), `SPEC-PARCOURS.md` (section « Parcours
  pytest »), `ARCHITECTURE.md`, `UX.md`, `IMPLEMENTATION_PLAN.md` (lot 8), `MANUAL-QA.md`
  (85 à 96), `README`, `DECISIONS.md` (D39).

## Ce qui a été fait dans la session précédente

**« Supprimer le parcours » ne détruit plus le résultat coûteux de la génération.**
Raisonnement complet dans **D38**.

- `removeParcours` supprime progression, tests, config et caches, mais garde les fichiers
  ordinaires `.learn/parcours/*.json`, inchangés. Sans JSON, `.learn/` disparaît comme avant.
- Une erreur de lecture de `parcours/` arrête tout le nettoyage au lieu d'être prise pour
  un dossier vide. Un dossier ou un autre fichier simplement nommé `*.json` n'est pas
  conservé.
- Le dialogue annonce précisément ce qui part et ce qui reste ; le message final donne le
  chemin conservé et invite à le réimporter. Le `state.json` étant supprimé, rien ne se
  réactive seul.
- Version **0.1.6** ; README, architecture, UX, plan et point 28 de la QA manuelle à jour.
  `learnpath-0.1.6.vsix` a été généré puis installé dans VSCodium, qui confirme
  `palawizard.learnpath@0.1.6`.
- Première CI de cette version : Linux était vert, Windows 20/22 révélait deux hypothèses
  Unix. Les dépôts Git temporaires des tests fixent maintenant `core.autocrlf=false`, et
  le message du journal affiche le chemin portable `.learn/verify.log` plutôt qu'un chemin
  absolu avec les séparateurs de l'OS.

## Ce qui a été fait dans la session antérieure à la précédente

**Le prompt de génération est composé par l'extension.** Raisonnement complet dans **D37**.

- **`prompts/generer-parcours.md`** (neuf) : la source unique, livrée dans le paquet. Le
  prompt existait en deux exemplaires divergents (spec et README) et un parcours a été
  généré avec une version périmée ; la spec et le README n'en gardent plus aucun double, ils
  y renvoient.
- **`src/core/prompt.ts`** (neuf) : `composePrompt(gabarit, champs)`. Substitue
  `{{FONCTIONNALITE}}`, `{{NIVEAU}}`, `{{FICHIERS}}` (ligne effacée si vide), refuse une
  fonctionnalité vide, un niveau inconnu, et **un gabarit dont un marqueur reste**.
- **`src/webview/prompt-form.ts`** (neuf, sans `vscode`, testable) et
  **`src/webview/prompt-panel.ts`** (neuf, le câblage) : un onglet d'éditeur à part, pas la
  vue du parcours — celle-ci est repeinte à chaque run et effacerait la saisie. Même CSP,
  un seul onglet à la fois.
- **Le prompt composé est affiché en entier et modifiable**, et « Copier » copie le contenu
  de la zone, retouches comprises, via `vscode.env.clipboard`.
- **Commande `learnpath.generatePrompt`** : palette, bouton de l'accueil, et menu `…` du
  titre de la vue — la seule entrée du titre qui n'est **pas** conditionnée à
  `learnpath.active`, parce qu'on génère un parcours par fonctionnalité.
- Sans `package.json`, un bandeau le dit et **ne bloque rien**.
- Docs à jour : `SPEC-PARCOURS.md` et `README` (renvoi au fichier, plus de copie),
  `UX.md`, `MANUAL-QA.md` (points 74 à 84), `DECISIONS.md` (D37).

## Ce qui a été fait dans la session antérieure

**Sixième session de correction, hors lot** — nouvelle fonctionnalité demandée : refaire une
étape déjà validée en retrouvant le code d'avant elle (D36). Le lot 7 (Publication) reste
terminé côté code ; la vérification humaine ci-dessus est toujours à faire.

**Refaire une étape déjà validée, en s'appuyant sur git.** Le raisonnement complet est dans
**D36** (`DECISIONS.md`). Deux arbitrages ont été posés à l'utilisateur avant d'écrire une
ligne, et tranchés par lui : les commits vivent dans une **chaîne parallèle** (HEAD ne bouge
pas) plutôt que sur sa branche, et refaire l'étape N ne restaure **que** les fichiers de N.

- **`src/core/git.ts`** (neuf) : la plomberie. Un commit d'étape est fabriqué dans un
  `GIT_INDEX_FILE` temporaire (`read-tree` → `add -f` → `write-tree` → `commit-tree`) et posé
  sur `refs/learnpath/<slug>/<id>` avec `--create-reflog`. **HEAD, la branche, l'index et
  l'arbre de travail ne bougent jamais**, et jamais de `git add -A`. La restauration passe
  par `git restore --source … --worktree`, pas par `checkout`, qui écrirait dans l'index.
- **`src/core/redo.ts`** (neuf) : disponibilité, point de restauration par étape validée,
  `planRedo` (ce qui serait remplacé, ce qui serait supprimé) et `applyRedo`.
- **Le buffer non sauvegardé, traité avant l'écriture** : la confirmation nomme les éditeurs
  modifiés, `document.save()` est appelé sur eux, **puis** l'instantané
  `refs/learnpath-backup/` est pris, **puis** la restauration écrit. C'est ce qui rend vraie
  la phrase « rien n'est perdu » : sans la sauvegarde préalable, la dernière tentative
  n'existait nulle part.
- **Confirmation modale obligatoire**, fichier par fichier, qui distingue « remplacé » de
  « supprimé » (un fichier créé par l'étape n'existait pas avant elle).
- **Indisponible proprement** : les conditions sont mesurées au **début de l'import**, avant
  la moindre écriture. Sans dépôt, sans commit initial, avec un arbre sale, ou avec l'option
  coupée, la référence `…/base` n'est pas posée — son absence est le seul marqueur, rien de
  plus n'est stocké dans `state.json`. La vue de relecture affiche la raison à la place du
  bouton.
- **Option `learnpath.gitCheckpoints`**, active par défaut. Coupée : aucun commit, reprise
  indisponible. Relue à chaque geste.
- **Navigation** : la relecture d'une étape passée (lecture seule, qui ne touche à rien) est
  franchement séparée de la reprise (qui restaure des fichiers) — annonce avant l'énoncé,
  pas d'indice ni de solution, pas de zone d'état, bouton « Refaire » dans son propre
  encadré avec un libellé en « … ». Détail dans `UX.md`.
- Docs à jour : **règle 3 d'`AGENTS.md`** (l'écriture hors `.learn/` est désormais bornée et
  explicite, plus interdite), `README` (ce que l'extension écrit, la nouvelle section
  « Refaire une étape déjà validée », l'option), `ARCHITECTURE.md` (deux modules, un flux de
  plus), `UX.md`, `MANUAL-QA.md` (points 55 à 73).

## Point 4 — la cause probable : **infirmée sur cette pile**

L'hypothèse était : le hook `configEnvironment` d'`@vitejs/plugin-react` lit `env.config`
sans garde et reçoit `undefined`, à cause de l'héritage D31, des jonctions `node_modules` ou
du lancement sous `process.execPath = Code.exe`.

**Reproduction faite, hypothèse non confirmée. D31 n'est pas en cause, rien n'a été touché.**

Projet neuf, **Vite 8.2.2 / @vitejs/plugin-react 6.1.1 / React 19.3 / Vitest 4.1.11**,
parcours React d'une étape qui monte un composant. Import complet : **il passe**, y compris
`verifyAllGreen`, donc y compris le bac à sable à `node_modules` relié par jonctions.
Testé avec un `vite.config.ts` en forme d'objet **et** en forme de fonction (`defineConfig(
({ mode, command }) => …)`, avec une garde qui lève si l'`env` reçu est incomplet — elle
n'a jamais levé).

Ce que dit la lecture de `@vitejs/plugin-react@6.1.1/dist/index.js` :

- le hook s'appelle **`applyToEnvironment`**, pas `configEnvironment` ;
- il lit bien `env.config` sans garde (l. 119), et `reactCompilerPreset` fait pareil (l. 49) ;
- mais `viteRefreshWrapper`, qui porte ce hook, est déclaré **`apply: "serve"`**. Il ne
  tourne donc pas sous `vitest run`. Celui de `reactCompilerPreset` ne tourne que si le
  React Compiler est activé.

L'échec initial sur cette pile était **le bug Vite 8 du point 4 ci-dessus** — l'étape non
commencée prise pour une erreur de collecte — pas un plantage de plugin.

**Ce qui reste non testé, et ne peut pas l'être ici :** le lancement sous
`process.execPath = Code.exe` dans l'hôte d'extension, et les jonctions Windows (la
reproduction est sous Linux, où ce sont des liens symboliques). Si le plantage revient, le
`.learn/verify.log` porte maintenant la stack entière — c'est lui qu'il faut lire.

## État des vérifications automatiques

`npm run compile` et `npm test` au vert : **441 tests, 24 fichiers** après D44 ;
**437 tests, 24 fichiers** (5 sautés sans pytest
local), rejoués avec `VIRTUAL_ENV` et `LEARNPATH_REQUIRE_PYTEST=1` pour les runs pytest réels
— l'exemple Python enrichi s'importe et se joue. Nouveaux cette session : `diff.test.ts`,
`pedagogy.test.ts` (dont les deux exemples livrés acceptés), squelette dans `parcours`,
`reveal`, `state`, `viewmodel`, rendu et protocole dans `panel.test.ts`, prompt à deux
niveaux. Avant cette session : **395 tests, 22 fichiers**, dont les vrais runs
pytest (lancés avec `VIRTUAL_ENV` pointant un venv avec pytest 9.1.1 et
`LEARNPATH_REQUIRE_PYTEST=1`). Sans Python avec pytest, les 5 tests de `pytest réel` sont
sautés localement ; la CI les exige.

Les 72 tests Python : `junit.test.ts` (fixtures JUnit réelles, robustesse), `python.test.ts`
(format, liste blanche, classification et traductions sur fixtures réelles, résolution de
l'interpréteur, import avec runs injectés) et `pytest.test.ts` (import complet de l'exemple,
boucle de jeu jusqu'à 1.3 avec régression, config du projet ignorée, paquet `app/`, solution
régressive refusée, aucun `__pycache__` ni `.pytest_cache`, Python ou pytest introuvables).
Hors suite, rejoué une fois : import avec le vrai setup (`python -m venv .venv` puis
`pip install pytest`, réseau pour pip) et réimport qui ne recrée pas le venv.

Les 13 tests de `reset.test.ts` couvrent notamment la conservation octet pour octet du
JSON, la suppression de tout le reste, l'absence de reprise automatique, l'idempotence,
le cas sans JSON et le refus sûr quand `parcours/` ne peut pas être lu.

Les 11 tests de cette session : `prompt.test.ts` lit **le fichier livré**
(`prompts/generer-parcours.md`), pas une copie de test — c'est ce qui fait tomber la suite
si le gabarit perd un champ ou en renomme un. Le reste couvre la page du formulaire (les
trois champs, la zone modifiable et son bouton Copier, la CSP au nonce, le bandeau « pas de
package.json » qui n'enlève pas le formulaire), le bouton de l'accueil et le message
`generatePrompt` accepté par `parseWebviewMessage`.

Les 29 tests de cette session : `redo.test.ts` tourne dans de **vrais dépôts git
temporaires**, jamais sur un faux `git` — commit par étape et rattachement de la chaîne,
travail non commité ailleurs qui n'entre ni dans le commit ni dans l'index, restauration
limitée aux bons fichiers (avec une comparaison de **toute** l'arborescence avant/après :
seuls le fichier de l'étape et `.learn/state.json` diffèrent), suppression d'un fichier qui
n'existait pas encore, instantané de sauvegarde relu avec `git show`, historique inchangé
(`HEAD`, `log`, branche, reflog), projet sans git, dépôt sans commit, arbre sale à l'import,
option coupée. Le reste couvre le view model en relecture, le rendu des deux écrans, et le
fait qu'un **run annulé n'écrit plus le state** — sans ça, un run lancé avant la reprise
pouvait réécrire une avancée par-dessus le retour en arrière.

Le test d'héritage de config est un **vrai run Vitest** : un alias déclaré dans le `vite.config.ts` d'un projet
temporaire doit résoudre dans les tests du parcours, et le même parcours sans cette config
doit échouer — le contrôle négatif est là pour que le test prouve l'héritage et pas la
présence d'une ligne dans un fichier.

Deux tests autour de D35 : l'état d'accueil (le texte, le bouton
d'import, le lien vers le prompt) et le message `import` accepté par `parseWebviewMessage`,
avec `{ type: 'importer' }` ajouté à la liste de ce qui doit être refusé. Le reste du panneau
n'a pas bougé : `panel.ts` n'est que du branchement `vscode`, il n'est toujours pas testable
ici — c'est ce que couvrent les points 45 à 54 de `MANUAL-QA.md`. Même chose pour le
branchement `vscode` de la reprise d'étape (confirmation modale, sauvegarde des éditeurs
modifiés) : il vit dans `watcher.ts`, il n'est pas testable ici, ce sont les points 63 à 68.

Neuf tests autour de D34 : l'affichage de la solution pour une étape
à un fichier et à plusieurs, le contenu porté par le view model, l'échappement du HTML de la
solution, et la non-régression « aucune écriture hors de `.learn/` ». Les tests de
`applySolution` sont remplacés par ceux de `revealCurrentSolution` et de `planSolution`.

Les trois tests de non-régression plus anciens, dont deux qui lancent de vrais runs
Vitest : un parcours dont aucun test ne se collecte est **refusé** par `verifyAllRed` ; un
parcours dont un seul fichier de test ne se collecte pas est refusé sans accuser la
solution ; et `.learn/verify.log` existe après l'échec, contient plus que la première ligne,
et **survit au rollback**.

Import complet rejoué en vrai deux sessions plus tôt, hors extension : **Vite 8.2.2 + plugin-react
6.1.1 + React 19.3 + Vitest 4.1.11**, config du projet en forme d'objet puis en forme de
fonction — il passe dans les deux cas. Les imports des sessions précédentes (projet vanilla
`examples/demo-project`, et Vite 5 + React 18 + `@vitejs/plugin-react@4` + Vitest 1) n'ont
**pas** été rejoués ici.

## Ce qui bloque

Rien techniquement. La publication est bloquée sur la vérification humaine et sur la
création des comptes `Palawizard` (marketplace VS Code, Open VSX).

## Décisions en attente

- `runner.cwd` différent de `.` n'a toujours jamais été essayé en vrai.
- Sur régression : commande d'échappement `learnpath.skipRegression`, à décider avec de
  vrais utilisateurs (D16).
- Support réel de Yarn PnP (lancer Vitest à travers `.pnp.loader.mjs`) : refusé proprement
  aujourd'hui, à rouvrir sur demande réelle.
- Reporter `junit` en second pour récupérer le message des dépassements de délai (D27) : à
  rouvrir si le cas remonte d'un vrai utilisateur.

## Prochaine action concrète

000. Régénérer le parcours d'`Inventaire/frontend` avec le nouveau prompt (« je découvre la
    syntaxe »), en commençant par la partie manquante (client API, hook, MSW, routes), et
    dérouler les points **97 à 110** sur ce vrai parcours React.

00. Pousser `feat/python` et regarder la CI : c'est la première fois que les runs pytest
    tournent sous **Windows** (`python.exe`, `Scripts\`, chemins du rapport JUnit). Puis
    dérouler les points **85 à 96** de `MANUAL-QA.md` dans VSCodium.
0. Vérifier le point **28** de `MANUAL-QA.md` dans VSCodium : après suppression, seul le
   JSON doit rester et il doit pouvoir être réimporté sans nouvelle génération.
1. Dérouler les points **74 à 84** de `MANUAL-QA.md` : c'est la nouveauté de cette session,
   et rien du formulaire n'a pu tourner dans un vrai hôte. Le point 81 (le prompt copié est
   celui de `prompts/generer-parcours.md`) est celui qui décide si D37 tient.
2. Dérouler les points **55 à 73** de `MANUAL-QA.md` dans un vrai dépôt git : c'est la
   nouveauté de cette session, et le point 66 (fichier ouvert et modifié non sauvegardé)
   est celui qui décide si D36 tient ou reproduit le bug de D34.
3. Dérouler `docs/MANUAL-QA.md` dans l'Extension Development Host, puis dans VSCodium.
   Les points 45 à 54 (barre d'activité, accueil, actions du titre) sont neufs et n'ont
   jamais tourné dans un vrai hôte : c'est le premier changement de cette session à
   vérifier. Trois points restent à ajouter, non couverts par la checklist : provoquer un
   échec de setup et vérifier que `.learn/parcours/<slug>.json` est toujours là (D28),
   vérifier que la vue Sortie s'ouvre bien sur un import refusé (D29), et jouer un parcours
   React de bout en bout dans un vrai projet Vite (D31) — l'import est vérifié, la boucle de
   jeu ne l'a jamais été sur un composant.
   Reporter le résultat ici : ce qui est confirmé sort de la liste en tête, ce qui échoue
   devient une ligne dans « Ce qui bloque ».
4. Prendre les trois captures d'écran (l'état d'accueil dans la barre d'activité est un bon
   candidat pour la première), les pousser, remplacer les commentaires du README.
5. Créer les comptes `Palawizard`, puis `vsce publish` et `ovsx publish`.
