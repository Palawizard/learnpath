# Instructions pour les agents de code

Lis ce fichier en entier avant de toucher au code. `CLAUDE.md` pointe ici.

## Le projet en trois phrases

LearnPath est une extension VSCode qui joue des parcours d'apprentissage au format JSON
dans le vrai projet de l'utilisateur. L'utilisateur écrit le code lui-même, l'extension
lance les tests de l'étape courante à chaque sauvegarde et avance toute seule quand ils
passent. **L'extension n'appelle jamais de modèle d'IA** : le parcours est généré en amont
par un agent externe et importé comme un fichier.

## Règles non négociables

1. **Aucun appel réseau.** Pas de `fetch`, pas de SDK d'IA, pas de télémétrie. Si tu penses
   avoir besoin d'un appel réseau, tu as mal compris le projet : arrête-toi et demande.
2. **Aucune API propriétaire.** Pas de `vscode.lm`, pas d'API proposée, pas de dépendance à
   Copilot. L'extension doit tourner à l'identique sur VSCodium. Voir `docs/RESEARCH.md`.
3. **On ne touche aux fichiers de l'utilisateur hors de `.learn/` que sur un geste
   explicite, et seulement dans les limites qu'il a vues.** Le bouton « Solution »
   *affiche* la solution, il ne l'écrit pas (D34) ; `verifyAllGreen` écrit les solutions
   dans sa copie temporaire, jamais dans le projet. La seule écriture dans le code de
   l'utilisateur est **« Refaire l'étape »** (D36) : elle est bornée aux `expected.files`
   de l'étape visée, chaque chemin repasse par `safeResolve`, et une confirmation modale
   les nomme un par un avant la moindre écriture. Toute écriture qui sort de cette liste
   est un bug. Le déplacement des tests en fin de parcours (D17) suit la même règle :
   liste montrée, puis écriture.
   `src/core/git.ts` écrit dans le dépôt (des objets et des références sous
   `refs/learnpath*`), jamais sur une branche : pas de `reset`, pas de `rebase`, pas de
   `commit --amend`, jamais `git add -A`.
4. **La config de test du projet est sacrée.** On écrit notre propre
   `.learn/vitest.config.ts` et on lance avec `--config`. On ne modifie jamais le
   `vitest.config.*` existant ni le champ `scripts.test` du `package.json` de l'utilisateur.
5. **Un parcours importé est une donnée non fiable.** Il vient d'un LLM. Valider contre le
   JSON Schema, valider les chemins (aucun `..`, aucun chemin absolu), et refuser proprement
   plutôt que de planter.
6. **Le prompt de génération n'existe qu'en un exemplaire :**
   `prompts/generer-parcours.md`. L'extension le lit, la spec et le README y renvoient. Ne
   le recopie nulle part — il a divergé une fois, et un parcours a été généré avec une
   version périmée (D37).
7. **Pas de dépendance runtime lourde.** L'extension doit rester légère. Actuellement
   autorisées : `ajv` pour la validation de schéma. Toute nouvelle dépendance runtime se
   discute d'abord dans `docs/DECISIONS.md`.

## Style de code

- TypeScript strict. `noImplicitAny`, `strictNullChecks` activés, on ne les désactive pas.
- Pas de `any`. Si un type est pénible, écris le type, ne le contourne pas.
- Le code métier (`src/core`, `src/runner`) ne doit **pas** importer `vscode`. Il prend des
  chemins et des chaînes en entrée et retourne des objets. C'est ce qui le rend testable
  hors extension. Seuls `src/extension.ts` et `src/webview` importent `vscode`.
- Messages d'erreur en français, noms de symboles en anglais.
- Pas de commentaire qui paraphrase le code. Un commentaire explique un *pourquoi*.

## Tests

- `npm test` lance Vitest sur `src/**/*.test.ts`.
- Tout ce qui est dans `src/core` et `src/runner` doit être testé unitairement.
- Le parsing de sortie Vitest se teste avec des fixtures JSON réelles, pas avec des objets
  inventés à la main. Range-les dans `src/runner/__fixtures__/`.

## Workflow de session

1. Lis `docs/HANDOFF.md` pour savoir où en est le projet.
2. Lis le lot de travail concerné dans `docs/IMPLEMENTATION_PLAN.md`.
3. Fais **un seul lot** par session. Ne pars pas en avant sur le lot suivant.
4. À la fin : mets à jour `docs/HANDOFF.md` (état, ce qui a été fait, ce qui bloque,
   prochaine action) et ajoute une entrée dans `docs/DECISIONS.md` si tu as tranché quelque
   chose de structurant.

## Pièges connus

- **Trois états rouges différents.** Un test qui échoue parce que le fichier n'existe pas
  encore, parce que le code ne parse pas, ou parce qu'une assertion échoue, ce sont trois
  situations à afficher différemment. Les confondre rend le produit désagréable. Détail
  dans `docs/UX.md`.
- **Vitest écrit son JSON dans un fichier**, pas proprement sur stdout. Toujours
  `--outputFile` puis lire le fichier. Parser stdout donnera des faux positifs.
- **Le debounce sur save est obligatoire.** Sans lui, on relance les tests pendant que
  l'utilisateur tape et on affiche du rouge en permanence.
- **`grep` de Vitest matche sur le nom complet du test**, `describe` inclus. C'est pour ça
  que chaque `describe` commence par `step <id>`.
