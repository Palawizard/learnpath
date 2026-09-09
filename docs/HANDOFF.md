# Handoff

État courant du projet. **À mettre à jour à la fin de chaque session d'agent.**
Format : on écrase les sections, on n'accumule pas d'historique ici (l'historique est
dans git et dans `DECISIONS.md`).

---

## Date de dernière mise à jour

2026-09-09

## Lot en cours

**Lot 0 (Socle) terminé.** Prochain lot : Lot 1 (Types et validation du parcours).

## Ce qui existe

- Documentation complète (`docs/`), spécification du format de parcours figée
- Un parcours d'exemple écrit à la main et valide : `examples/exemple-panier.json`
- Chaîne de build **exécutée et fonctionnelle** : `npm install`, `npm run compile`
  (`tsc --noEmit` + esbuild) et `npm test` passent.
- `src/extension.ts` : `activate`/`deactivate`, enregistre les quatre commandes.
  `learnpath.open` ouvre le panneau ; `import`, `runStep` et `reset` affichent
  « pas encore implémenté ».
- `src/webview/panel.ts` : `ParcoursPanel`, panneau webview singleton, HTML minimal,
  CSP `default-src 'none'` avec nonce, couleurs uniquement via les variables CSS de
  VSCode. Affiche le nom de l'espace de travail.
- `.vscode/tasks.json` : le `problemMatcher` `$esbuild-watch` (inexistant) a été
  remplacé par un matcher d'arrière-plan explicite, sinon F5 échouait avant de lancer
  l'hôte d'extension.
- `package.json` : `npm test` prend `--passWithNoTests` (aucun test tant que `core`
  et `runner` sont vides).
- `schema/parcours.schema.json` est un stub, à écrire au lot 1
- `src/core`, `src/runner`, `src/util` sont toujours vides (`.gitkeep`)

## Ce qui bloque

Rien.

## Vérification manuelle du lot 0

1. `npm install` puis `npm run compile`
2. Ouvrir le dépôt dans VSCode/VSCodium, F5 (configuration « Lancer l'extension »).
   La tâche `npm: watch` démarre, puis une fenêtre « Extension Development Host »
   s'ouvre sur `examples/demo-project`.
3. Dans cette fenêtre : Ctrl+Shift+P → « LearnPath: Ouvrir le parcours ».
   Un panneau s'ouvre à côté de l'éditeur, titre « LearnPath », avec
   « Espace de travail : demo-project ».
4. Relancer la commande : le panneau existant est révélé, aucun second panneau.
5. Les trois autres commandes affichent la notification « pas encore implémenté ».

## Décisions en attente

- Framework de la webview : rien pour l'instant, HTML/TS simple. À rediscuter seulement
  si le lot 5 devient pénible sans.
- Nom définitif de l'extension et identifiant de publisher.

## Prochaine action concrète

Lot 1 : écrire `schema/parcours.schema.json` d'après `SPEC-PARCOURS.md`, puis
`src/core/parcours.ts` (`loadParcours`) et `src/core/paths.ts` (`safeResolve`), avec
leurs tests unitaires. Au premier test ajouté, restreindre l'`include` de Vitest à
`src/**/*.test.ts` (une config Vitest à la racine) pour ne pas ramasser les fichiers de
`examples/demo-project/.learn/`, et retirer `--passWithNoTests`.
