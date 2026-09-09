# Architecture

## Vue d'ensemble

```
                 hors extension                    dans l'extension
   ┌──────────────────────────────┐    ┌──────────────────────────────────────┐
   │ Claude Code / Codex          │    │  importer  →  state  →  webview      │
   │ + prompt de génération       │──▶ │      ↓          ↑         ↓          │
   │ = parcours.json              │    │   runner  ──────┘    watcher (save)  │
   └──────────────────────────────┘    └──────────────────────────────────────┘
```

La frontière est le fichier JSON. Tout ce qui est à gauche est du ressort de
l'utilisateur et de son agent. L'extension ne fait que consommer le fichier.

## Modules

### `src/core/` — logique métier, sans `vscode`

| Fichier | Responsabilité |
|---|---|
| `parcours.ts` | Types du parcours, chargement, validation via JSON Schema |
| `importer.ts` | Écrit `.learn/`, les tests, la config Vitest, joue `setup` |
| `verify.ts` | Vérification « tout doit être rouge » à l'import |
| `state.ts` | Lecture/écriture de `.learn/state.json`, progression, solutions révélées |
| `paths.ts` | Résolution et **validation de sécurité** des chemins du parcours |

### `src/runner/` — exécution des tests, sans `vscode`

| Fichier | Responsabilité |
|---|---|
| `vitest.ts` | Construit la commande, lance le process, lit `--outputFile` |
| `parse.ts` | Sortie Vitest JSON → `StepResult` |
| `classify.ts` | Classe un échec en `missing-file` / `parse-error` / `assertion-failed` |

`classify.ts` est le module qui fait la qualité perçue du produit. À soigner et à
tester avec de vraies fixtures.

### `src/` — couche VSCode

| Fichier | Responsabilité |
|---|---|
| `extension.ts` | Activation, enregistrement des commandes, câblage |
| `watcher.ts` | `onDidSaveTextDocument` + debounce + filtrage par `expected.files` |
| `webview/panel.ts` | Panneau du parcours, messages vers/depuis l'UI |

### `webview-ui/` — interface du panneau

HTML/CSS/TS simple, sans framework pour l'instant. Affiche : titre, compteur
`Étape n/N`, explication en markdown, attendu, hints progressifs, bouton Solution,
état du dernier run.

## Flux : de la sauvegarde à l'étape suivante

```
save fichier
  └─ le fichier est-il dans steps[current].expected.files ?  (sinon: ignorer)
      └─ debounce 500ms
          └─ runner.run(step.id + ids précédents en régression)
              └─ parse + classify
                  ├─ missing-file    → ne rien afficher, état initial
                  ├─ parse-error     → indicateur discret « code incomplet »
                  ├─ assertion-failed→ diff + hint suivant disponible
                  └─ pass            → state.advance() → webview.render(step+1)
```

## Fichiers créés dans le projet de l'utilisateur

```
.learn/
  parcours/<slug>.json
  tests/step-<id>.spec.ts
  vitest.config.ts
  state.json          ← à ajouter au .gitignore par l'extension
  .result.json        ← sortie brute Vitest, gitignorée
```

Rien en dehors de `.learn/`, à une exception près : l'écriture d'un fichier de
`expected.files` lors d'un clic sur « Solution ».

## Ce qui est explicitement hors périmètre du v1

- Génération du parcours dans l'extension (c'est le rôle de l'agent externe)
- Autre langage que JS/TS, autre runner que Vitest
- Synchronisation cloud, comptes, partage de parcours
- Multi-parcours simultanés (un seul parcours actif à la fois)
