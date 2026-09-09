# Handoff

État courant du projet. **À mettre à jour à la fin de chaque session d'agent.**
Format : on écrase les sections, on n'accumule pas d'historique ici (l'historique est
dans git et dans `DECISIONS.md`).

---

## Date de dernière mise à jour

2026-09-09

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

**Lot 7 (Publication) terminé côté code et paquet.** Il ne reste que la vérification
humaine ci-dessus et l'acte de publication lui-même.

## Ce qui a été fait dans ce lot

### 1. Deux correctifs de fond sur la vérification des solutions

**`node_modules` n'est plus ouvert en écriture au bac à sable (D25).** Le lien de jonction
posé sur le dossier entier renvoyait dans le projet de l'utilisateur deux écritures bien
réelles de Vite : son cache (`node_modules/.vite/`, présent dans le dépôt, constaté) et la
version transpilée du fichier de config (`node_modules/.vite-temp/`, chemin imposé par
`findNearestNodeModules`, non configurable). Deux verrous : `.learn/vitest.config.mts`
fixe `cacheDir` sur `.learn/.vite` — ce qui vaut aussi pour les runs ordinaires pendant que
l'étudiant code —, et le bac à sable relie `node_modules` **entrée par entrée**. Test de
non-régression dans `verify.test.ts`, sans vrai run Vitest ; il échoue bien si on remet le
lien unique.

Seule commande qui tourne dans le bac à sable : Vitest. `runner.setup` est joué avant,
dans le vrai projet, après confirmation explicite.

**La copie du workspace suit `.gitignore` (D26).** `git ls-files -c -o --exclude-standard`
quand le projet est un dépôt, parcours récursif avec liste d'exclusion sinon, plus un
avertissement explicite au-delà de 100 Mo. Mesuré sur de vrais projets, pas sur
`demo-project` : un dépôt de 740 Mo passe de 726 Mo copiés en 2,7 s à **179 fichiers en
0,67 s**, parce que les 733 Mo de son dossier de données sont dans son `.gitignore` et dans
aucune liste d'exclusion imaginable. Tableau complet dans D26.

### 2. Métadonnées du paquet

`LICENSE` MIT à la racine (le README l'annonçait, le fichier n'existait pas ; `ovsx` le
réclame). `package.json` : `publisher: Palawizard`, `repository`, `bugs`, `homepage`,
`keywords`, `icon`, `galleryBanner`, `vscode:prepublish`, version passée en `0.1.0`.
`media/icon.png` : 256×256, la barre segmentée du panneau — un placeholder honnête, à
remplacer si quelqu'un sait dessiner.

`.vscodeignore` complété : `schema/` en sort (il est importé par `src/core/parcours.ts`
donc déjà dans le bundle, il serait parti en double), plus `.github/`, `vitest.config.mts`,
`package-lock.json`, `AGENTS.md`, `CLAUDE.md`. `esbuild` minifie hors mode `--watch` : le
bundle passe de 600 ko à 329 ko.

**Contenu du VSIX, vérifié avec `vsce ls`** — 7 fichiers, **117 Ko** :

```
extension/LICENSE.txt        1,04 Ko
extension/package.json       2,32 Ko
extension/readme.md          9,41 Ko
extension/dist/extension.js  329,04 Ko   (ajv + markdown-it bundlés, aucun node_modules)
extension/media/icon.png     1,05 Ko
[Content_Types].xml, extension.vsixmanifest
```

### 3. CI

`.github/workflows/ci.yml` : `ubuntu-latest` × `windows-latest` × Node 20 et 22,
`npm ci` + `npm run compile` + `npm test`, `fail-fast: false`. Node 22 et Windows ne sont
pas des extras : c'est la combinaison qui a produit les deux bugs spécifiques du projet
(refus de `spawn` sur un `.cmd`, résolution du CLI de Vitest). **Jamais exécutée** : le
dépôt n'a pas encore reçu de push avec ce fichier.

### 4. Recherche : le dépassement de délai perdu dans le rapport JSON (D27)

Cause trouvée dans le code de `@vitest/runner`, pas devinée : `makeTimeoutError` écrase
`error.stack` avec un `replace` dont les arguments semblent inversés, et le reporter JSON
émet `e.stack || e.message`. `error.message` est correct, seul `stack` est faux.

Le reporter `junit` **conserve** le message (vérifié sur un vrai dépassement), et les deux
reporters cohabitent en un seul run. Coût : migrer sur junit est cher (parseur XML,
revalidation des quatre classifications) ; ajouter junit à côté du JSON vaut environ une
heure. **Décision : ni l'un ni l'autre pour l'instant**, `humanize.ts` reste tel quel, la
limite est notée dans le README et le détail dans D27.

### 5. README pour l'utilisateur final

Réécrit de zéro. Ce que ça fait et ce que ça ne fait pas, l'installation, la procédure
complète depuis « je veux coder cette fonctionnalité » jusqu'à la première étape, le prompt
de génération dans **un seul bloc copiable**, les commandes, les réglages, les limites
connues. Et une section « Ce que l'extension écrit dans ton projet » avec un tableau
chemin / quand / contenu, puis la liste de ce qui n'est jamais touché — c'est la question
que les gens se posent vraiment avant d'installer.

L'ancien contenu (table des documents internes, état du prototype) a disparu : il
s'adressait à quelqu'un qui travaille sur le projet, et ce lecteur-là entre par `AGENTS.md`.

### 6. `docs/MANUAL-QA.md`

44 points, une ligne chacun, avec le résultat attendu, regroupés par thème : import, les
trois états rouges, run en cours, progression, indices et solution, écran de fin,
réinitialisation, focus et accessibilité, thèmes, et le parcours panier de bout en bout sur
VSCodium. Avec la marche à suivre pour se mettre en position et pour provoquer chaque état.

## État des vérifications automatiques

`npm run compile` et `npm test` au vert : **238 tests, 17 fichiers** (+1 par rapport au
lot 6). VSIX produit : `learnpath-0.1.0.vsix`, 117 Ko, 7 fichiers.

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
   Reporter le résultat ici : ce qui est confirmé sort de la liste en tête, ce qui échoue
   devient une ligne dans « Ce qui bloque ».
3. Prendre les trois captures d'écran, les pousser, remplacer les commentaires du README.
4. Créer les comptes `Palawizard`, puis `vsce publish` et `ovsx publish`.
