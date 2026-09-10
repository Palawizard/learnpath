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
| `reveal.ts` | Indice suivant, marquage de la solution comme révélée ; `planSolution`, qui n'écrit plus que pour `verify.ts` (D34) |
| `reset.ts` | Recommencer depuis l'étape 1, ou supprimer `.learn/` (D23) |
| `git.ts` | Plomberie git : commit dans un index temporaire, références `refs/learnpath*`, restauration de chemins. Ne touche jamais HEAD, la branche ni l'index (D36) |
| `redo.ts` | Refaire une étape validée : disponibilité, point de restauration par étape, plan de reprise et application (D36) |
| `prompt.ts` | Compose le prompt de génération depuis le gabarit unique `prompts/generer-parcours.md`, qui lui est passé en argument (D37) |
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
| `classify.ts` | Classe un run en `pass` / `missing-file` / `collect-error` / `assertion-failed` |

`classify.ts` est le module qui fait la qualité perçue du produit. À soigner et à
tester avec de vraies fixtures.

### `src/` — couche VSCode

| Fichier | Responsabilité |
|---|---|
| `extension.ts` | Activation, enregistrement des commandes, câblage |
| `watcher.ts` | `onDidSaveTextDocument`, rien d'autre : le debounce, l'annulation et la décision vivent dans `core/progression.ts` |
| `webview/panel.ts` | Branchement `vscode` de la vue de la barre d'activité : `WebviewViewProvider`, `postMessage`, révélation sans focus |

### `webview/` — interface du panneau

Sans framework. Le rendu est séparé de `vscode` pour être testable (**D20**) :

| Fichier | Responsabilité | Importe `vscode` |
|---|---|---|
| `core/viewmodel.ts` | Ce qu'il faut afficher, en structure pure | non |
| `webview/render.ts` | View model → fragments HTML (`header`, `main`, `status`) | non |
| `webview/markdown.ts` | Rendu de `explanation`, HTML brut désactivé (**D19**) | non |
| `webview/shell.ts` | Document, CSP, feuille de style `--vscode-*`, script client | non |
| `webview/protocol.ts` | Types des messages et validation de l'entrant | non |
| `webview/prompt-form.ts` | Page du formulaire de génération du prompt : champs, zone modifiable, bouton Copier (**D37**) | non |
| `webview/panel.ts` | Le reste, c'est-à-dire `vscode` (fournisseur de la vue `learnpath.parcours`) | oui |
| `webview/prompt-panel.ts` | Onglet d'éditeur du générateur de prompt : lit le gabarit livré, compose, copie | oui |

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
                  ├─ collect-error   → indicateur discret « code incomplet »
                  ├─ assertion-failed→ diff + hint suivant disponible
                  ├─ pass + une étape précédente cassée
                  │                  → étape validée, progression en pause (D16)
                  └─ pass            → state.advance() → webview.render(step+1)
```

`learnpath.runStep` entre dans ce flux à `runNow()`, juste après le debounce : aucune
branche parallèle.

Une étape validée (au vert, sans régression) déclenche en plus `recordCheckpoint` : le
commit de l'étape sur `refs/learnpath/<slug>/<id>`. Il suit la validation, pas l'avancée du
state — `autoAdvance` à `false` n'y change rien. Une erreur git y est journalisée et
n'interrompt pas la progression (D36).

## Flux : refaire une étape

```
clic « Relire une étape passée »   (lecture seule, aucune écriture)
  └─ planRedo() : la reprise est-elle possible, et sur quels fichiers ?
      └─ clic « Refaire l'étape N… »
          └─ confirmation modale, fichier par fichier
              └─ save() des éditeurs modifiés concernés   (VSCode ne recharge pas un buffer sale)
                  └─ instantané → refs/learnpath-backup/
                      └─ restore --source=<réf d'avant N> -- <expected.files de N>
                          └─ rewindTo(state, N)
```

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

Rien en dehors de `.learn/` sans un geste explicite de l'utilisateur : depuis D34,
« Solution » affiche le code dans le panneau au lieu de l'écrire. La seule écriture de
solution restante vise la copie temporaire de `verifyAllGreen`, jamais le projet.

Deux exceptions, toutes deux déclenchées à la main et précédées d'une confirmation qui liste
les fichiers : le déplacement des tests en fin de parcours (D17), et **« Refaire l'étape »**
(D36), borné aux `expected.files` de l'étape visée.

Dans le dépôt git de l'utilisateur, LearnPath écrit des objets et des références sous
`refs/learnpath/<slug>/…` et `refs/learnpath-backup/<slug>/…`. Jamais sur une branche,
jamais sur `HEAD`, jamais dans l'index (D36).

## Ce qui est explicitement hors périmètre du v1

- Génération du parcours dans l'extension (c'est le rôle de l'agent externe)
- Autre langage que JS/TS, autre runner que Vitest
- Synchronisation cloud, comptes, partage de parcours
- Multi-parcours simultanés (un seul parcours actif à la fois)
