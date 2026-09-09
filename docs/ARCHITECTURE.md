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
| `verify.ts` | Vérifications d'import : « tout doit être rouge » (D5) et « les solutions cumulées doivent tout laisser vert », dans une copie temporaire du workspace (D21) |
| `reveal.ts` | Indice suivant, écriture de la solution ; `planSolution` est partagé avec `verify.ts` |
| `reset.ts` | Recommencer depuis l'étape 1, ou supprimer `.learn/` (D23) |
| `humanize.ts` | Traduction des formes d'erreur Vitest fréquentes, sans jamais masquer le brut (D22) |
| `state.ts` | Lecture/écriture de `.learn/state.json`, progression, solutions révélées |
| `progression.ts` | Session, filtrage des sauvegardes, quel run lancer, quoi faire du résultat, `RunLoop` (debounce et annulation) |
| `finish.ts` | Fin de parcours : déplacement proposé de `.learn/tests/` (D17) |
| `paths.ts` | Résolution et **validation de sécurité** des chemins du parcours |
| `exec.ts` | Lancement des CLI sans shell, y compris sous Windows (D18, D24) ; résolution du CLI Vitest et refus explicite de Yarn PnP |

### `src/runner/` — exécution des tests, sans `vscode`

| Fichier | Responsabilité |
|---|---|
| `vitest.ts` | Construit l'argv depuis `runner.kind` (D14), lance le process sans shell, lit `--outputFile` |
| `parse.ts` | Sortie Vitest JSON → `RawResult`, sans jamais lever |
| `classify.ts` | Classe un run en `pass` / `missing-file` / `parse-error` / `assertion-failed` |

`classify.ts` est le module qui fait la qualité perçue du produit. À soigner et à
tester avec de vraies fixtures.

### `src/` — couche VSCode

| Fichier | Responsabilité |
|---|---|
| `extension.ts` | Activation, enregistrement des commandes, câblage |
| `watcher.ts` | `onDidSaveTextDocument`, rien d'autre : le debounce, l'annulation et la décision vivent dans `core/progression.ts` |
| `webview/panel.ts` | Branchement `vscode` du panneau : cycle de vie, `postMessage`, focus |

### `webview/` — interface du panneau

Sans framework. Le rendu est séparé de `vscode` pour être testable (**D20**) :

| Fichier | Responsabilité | Importe `vscode` |
|---|---|---|
| `core/viewmodel.ts` | Ce qu'il faut afficher, en structure pure | non |
| `webview/render.ts` | View model → fragments HTML (`header`, `main`, `status`) | non |
| `webview/markdown.ts` | Rendu de `explanation`, HTML brut désactivé (**D19**) | non |
| `webview/shell.ts` | Document, CSP, feuille de style `--vscode-*`, script client | non |
| `webview/protocol.ts` | Types des messages et validation de l'entrant | non |
| `webview/panel.ts` | Le reste, c'est-à-dire `vscode` | oui |

Affiche : titre, compteur `Étape n/N`, barre de progression, explication en markdown,
bloc « Attendu », indices progressifs, bouton Solution, zone d'état `aria-live`, bandeau
de régression séparé, récapitulatif de fin.

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
                  ├─ pass + une étape précédente cassée
                  │                  → étape validée, progression en pause (D16)
                  └─ pass            → state.advance() → webview.render(step+1)
```

`learnpath.runStep` entre dans ce flux à `runNow()`, juste après le debounce : aucune
branche parallèle.

## Fichiers créés dans le projet de l'utilisateur

```
.learn/
  parcours/<slug>.json
  tests/step-<id>.spec.ts
  vitest.config.mts
  state.json          ← à ajouter au .gitignore par l'extension
```

La sortie brute de Vitest n'est plus écrite ici : chaque run écrit son rapport dans un
temporaire système qu'il supprime ensuite (D14).

Rien en dehors de `.learn/`, à une exception près : l'écriture d'un fichier de
`expected.files` lors d'un clic sur « Solution ».

## Ce qui est explicitement hors périmètre du v1

- Génération du parcours dans l'extension (c'est le rôle de l'agent externe)
- Autre langage que JS/TS, autre runner que Vitest
- Synchronisation cloud, comptes, partage de parcours
- Multi-parcours simultanés (un seul parcours actif à la fois)
