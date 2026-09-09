# LearnPath

Extension VSCode / VSCodium qui transforme une fonctionnalité que tu veux coder en
parcours guidé, dans ton vrai projet.

## Le problème

Quand on apprend à coder avec une IA, il n'y a que deux modes :

- « donne-moi le code » → ça marche, on n'a rien appris
- « explique sans coder » → on ne comprend pas, et on redemande le code cinq minutes après

LearnPath ajoute l'entre-deux : un plan d'implémentation découpé en étapes, où **c'est
toi qui écris le code**, l'extension détecte automatiquement quand c'est bon, et la
solution reste accessible en un clic si tu bloques.

## Comment ça marche

```
1. Tu décris ta fonctionnalité à Claude Code / Codex avec le prompt fourni
2. L'agent produit un parcours JSON (étapes, explications, tests, solutions)
3. Tu l'importes dans LearnPath
4. Tu codes. Tu sauvegardes. Les tests de l'étape tournent tout seuls.
5. Vert → étape suivante. Bloqué → bouton Solution.
```

L'extension **n'appelle aucun modèle d'IA**. Pas de clé API, pas de quota, pas de
dépendance à Copilot. La génération se fait en amont avec l'outil que tu utilises déjà.
C'est aussi ce qui la rend utilisable telle quelle sur VSCodium.

## À la fin d'un parcours

Les tests écrits pendant le parcours peuvent être déplacés dans la suite de tests réelle
du projet. Tu repars avec du code fonctionnel et testé, pas avec un badge de complétion.

## État

Prototype en cours. Cible du v1 : JS/TS + Vitest, parcours de 5 à 10 étapes par
fonctionnalité.

## Documentation

| Fichier | Contenu |
|---|---|
| [AGENTS.md](./AGENTS.md) | Instructions pour les agents de code. **À lire en premier.** |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Modules, flux de données, frontières |
| [docs/SPEC-PARCOURS.md](./docs/SPEC-PARCOURS.md) | Format du JSON de parcours |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) | Lots de travail, dans l'ordre |
| [docs/HANDOFF.md](./docs/HANDOFF.md) | État courant, à mettre à jour à chaque session |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | Décisions techniques et leurs raisons |
| [docs/RESEARCH.md](./docs/RESEARCH.md) | Antériorité et contraintes plateforme |
| [docs/UX.md](./docs/UX.md) | Comportement de l'interface |

## Licence

MIT
