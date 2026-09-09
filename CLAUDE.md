# CLAUDE.md

Les instructions de ce dépôt sont dans **[AGENTS.md](./AGENTS.md)**. Lis-le avant toute
modification, il fait foi.

Rappel des trois points qui cassent le projet si on les oublie :

1. L'extension n'appelle **aucun** modèle d'IA et ne fait **aucun** appel réseau.
2. Rien de propriétaire, rien de spécifique à VS Code Microsoft : ça doit tourner sur VSCodium.
3. `src/core` et `src/runner` n'importent jamais `vscode`.

Avant de commencer : `docs/HANDOFF.md` puis `docs/IMPLEMENTATION_PLAN.md`.
Après avoir fini : mettre à jour `docs/HANDOFF.md`.
