# Handoff

État courant du projet. **À mettre à jour à la fin de chaque session d'agent.**
Format : on écrase les sections, on n'accumule pas d'historique ici (l'historique est
dans git et dans `DECISIONS.md`).

---

## Date de dernière mise à jour

2026-09-10

## À VÉRIFIER PAR UN HUMAIN AVANT DE PUBLIER

Rien de ce qui suit n'a été fait, et rien ne peut l'être depuis une session d'agent :
aucun accès à l'Extension Development Host, aucun accès à VSCodium.

**La checklist complète est dans [`MANUAL-QA.md`](./MANUAL-QA.md) : 44 points, un par
ligne, avec le résultat attendu.** Dans l'ordre de priorité :

1. **Jouer le parcours panier de bout en bout dans VSCodium** (points 39 à 44). C'est la
   promesse centrale du projet et elle n'a jamais été démontrée.
2. **Les trois états rouges à l'écran** (points 6 à 10) : le point qui décide si le
   produit est agréable ou insupportable.
3. **Thème clair, thème sombre, thème à contraste élevé** (points 35 à 38).
4. **Non-vol du focus et annonce du lecteur d'écran** (points 30 à 34).
5. **Les nouveautés du lot 6 dans le vrai panneau** : « Tests en cours… », bandeau grisé,
   barre segmentée, écran de fin, les trois dialogues (points 1 à 5, 11 à 13, 22 à 28).
6. **Les captures d'écran** : trois emplacements sont marqués en commentaire dans le
   README, aucune image n'a été inventée. Le marketplace exige des URL https absolues,
   donc les fichiers doivent être poussés sur GitHub et référencés par `raw.githubusercontent`.

Ensuite seulement : `vsce publish` et `ovsx publish`. Le compte `Palawizard` doit exister
sur les deux (marketplace VS Code et Open VSX) — **il n'a pas été créé ni vérifié.**

## Lot en cours

**Troisième session de correction, hors lot** — trois garanties fausses signalées par un
diagnostic externe (D33). Traitées. Le lot 7 (Publication) reste terminé côté code ; la
vérification humaine ci-dessus est toujours à faire.

## Ce qui a été fait dans cette session

Trois garanties fausses, corrigées dans l'ordre de gravité. Le détail et le raisonnement
sont dans **D33** (`DECISIONS.md`).

### 1. `verifyAllRed` ne vérifiait pas ce qu'il prétendait

Il ne cherchait que les étapes `pass`. Une étape dont aucun test ne se collecte n'est pas
`pass` : elle passait pour rouge. La garantie « chaque étape échoue avant écriture » était
donc vraie sur un parcours dont rien ne s'exécute.

Rouge se prouve maintenant : `assertion-failed` (tests collectés, en échec) ou
`missing-file` (le fichier attendu n'est pas encore écrit). Zéro test collecté est un échec
de vérification distinct, avec son propre message. Non-régression : `b-syntaxe-invalide`
(cinq fichiers qui ne se collectent pas) est rejetée, et le parcours `test-mal-forme` est
désormais refusé par `verifyAllRed`, avant qu'on arrive aux solutions.

### 2. `classify` n'invente plus la cause d'une collecte ratée

`parse-error` est devenu `collect-error`. Le nom affirmait une cause qu'on ne connaît pas.
Vérifié sur deux vraies sorties Vitest : un fichier de test mal formé et un fichier importé
mal formé produisent le **même** message, sans chemin. Le texte ne permet pas de trancher.

La seule séparation honnête vient du run, pas du texte : si une autre étape a reçu un
verdict, l'outillage marche et la cause est locale à ce fichier ; sinon on ne désigne
personne. L'affichage côté étudiant n'a pas changé.

### 3. La stack complète est conservée

`RawResult` porte la stderr du process, entière (bornée à 32 ko **en queue** : la ligne qui
nomme la cause est en haut d'une stack, pas en bas). En cas d'échec, tout part dans
`.learn/verify.log` et le message d'erreur donne ce chemin. Le rollback de l'import préserve
ce fichier, pour la même raison que le fichier de parcours (D28).

### 4. Trois bugs trouvés en chemin — tous « une seule formulation connue »

- **Vite 8 dit `Failed to resolve import "<spec>" from "<fichier>"`** pour un fichier pas
  encore écrit, pas `Cannot find module`. Sur cette pile, **chaque étape non commencée
  sortait en erreur de collecte** au lieu de « pas encore commencée » : l'étudiant voyait
  « le fichier n'est pas encore valide » et un message brut de Vite dès l'ouverture d'une
  étape, ce que `UX.md` interdit explicitement. Fixture réelle capturée :
  `h-import-non-resolu-vite8.json`.
- **`Cannot find package '<spec>'`** : même cause, formulation produite quand un alias du
  projet pointe un fichier absent.
- Un spécificateur d'**alias** ne peut pas être comparé à `expected.files` par résolution de
  chemin. On compare les noms de fichier, et `missing-file` porte désormais le spécificateur
  non résolu dans un champ `missing`, hors de `message`.

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

`npm run compile` et `npm test` au vert : **265 tests, 17 fichiers**. Le test d'héritage de
config est un **vrai run Vitest** : un alias déclaré dans le `vite.config.ts` d'un projet
temporaire doit résoudre dans les tests du parcours, et le même parcours sans cette config
doit échouer — le contrôle négatif est là pour que le test prouve l'héritage et pas la
présence d'une ligne dans un fichier.

Trois tests de non-régression ajoutés cette session, dont deux qui lancent de vrais runs
Vitest : un parcours dont aucun test ne se collecte est **refusé** par `verifyAllRed` ; un
parcours dont un seul fichier de test ne se collecte pas est refusé sans accuser la
solution ; et `.learn/verify.log` existe après l'échec, contient plus que la première ligne,
et **survit au rollback**.

Import complet rejoué en vrai cette session, hors extension : **Vite 8.2.2 + plugin-react
6.1.1 + React 19.3 + Vitest 4.1.11**, config du projet en forme d'objet puis en forme de
fonction — il passe dans les deux cas. Les imports des sessions précédentes (projet vanilla
`examples/demo-project`, et Vite 5 + React 18 + `@vitejs/plugin-react@4` + Vitest 1) n'ont
**pas** été rejoués ici.

## Ce qui bloque

Rien techniquement. La publication est bloquée sur la vérification humaine et sur la
création des comptes `Palawizard` (marketplace VS Code, Open VSX).

## Décisions en attente

- Retour en arrière pour relire une étape passée en lecture seule (`UX.md`, section
  « Progression ») : toujours pas implémenté. Le view model s'y prête — il suffirait de lui
  passer une étape au lieu de la lire dans le state.
- `runner.cwd` différent de `.` n'a toujours jamais été essayé en vrai.
- Sur régression : commande d'échappement `learnpath.skipRegression`, à décider avec de
  vrais utilisateurs (D16).
- Support réel de Yarn PnP (lancer Vitest à travers `.pnp.loader.mjs`) : refusé proprement
  aujourd'hui, à rouvrir sur demande réelle.
- Reporter `junit` en second pour récupérer le message des dépassements de délai (D27) : à
  rouvrir si le cas remonte d'un vrai utilisateur.

## Prochaine action concrète

1. Pousser la branche : la CI se déclenche pour la première fois, sur les quatre
   combinaisons. Corriger ce qu'elle trouve avant tout le reste.
2. Dérouler `docs/MANUAL-QA.md` dans l'Extension Development Host, puis dans VSCodium.
   Trois points nouveaux à y ajouter, non couverts par les 44 existants : provoquer un échec
   de setup et vérifier que `.learn/parcours/<slug>.json` est toujours là (D28), vérifier
   que la vue Sortie s'ouvre bien sur un import refusé (D29), et jouer un parcours React de
   bout en bout dans un vrai projet Vite (D31) — l'import est vérifié, la boucle de jeu ne
   l'a jamais été sur un composant.
   Reporter le résultat ici : ce qui est confirmé sort de la liste en tête, ce qui échoue
   devient une ligne dans « Ce qui bloque ».
3. Prendre les trois captures d'écran, les pousser, remplacer les commentaires du README.
4. Créer les comptes `Palawizard`, puis `vsce publish` et `ovsx publish`.
