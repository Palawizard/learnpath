# Fixtures de sortie Vitest

Sorties **réelles**, capturées depuis `examples/demo-project`. Aucune n'a été écrite ni
retouchée à la main : les chemins absolus qu'elles contiennent sont ceux de la machine de
capture, les tests les recalculent depuis la fixture (`name.split('/.learn/')[0]`) au lieu
de les supposer.

Préparation commune, dans `examples/demo-project` :

1. écrire les cinq `steps[].tests.content` de `examples/exemple-panier.json` dans
   `.learn/tests/`, plus le `.learn/vitest.config.mts` que génère `src/core/importer.ts` ;
2. `npm i -D vitest`.

Commande commune (celle que construit `src/runner/vitest.ts`) :

```
npx vitest run --config .learn/vitest.config.mts --reporter=json --outputFile=<fichier>
```

| Fixture | État de `examples/demo-project/src/panier.js` | Filtre `-t` | Ce qu'on observe |
|---|---|---|---|
| `a-fichier-absent.json` | absent | aucun | 5 fichiers `failed`, `numTotalTests: 0`, message `Cannot find module '../../src/panier.js'` |
| `b-syntaxe-invalide.json` | `createPanier` avec une accolade non fermée | aucun | 5 fichiers `failed`, `numTotalTests: 0`, message `Failed to parse source for import analysis…` **sans aucun chemin** |
| `c-assertion-echouee.json` | `createPanier` retourne `{ lignes: [1] }` | `-t "step 1\.1"` | 1 assertion `failed` avec `AssertionError: expected [ 1 ] to deeply equal []`, 1 `passed`, 13 `skipped` |
| `d-tout-passe.json` | solution complète de l'étape 1.5 | aucun | `success: true`, 15 assertions `passed` |
| `e-etape-tautologique.json` | absent, mais le test de l'étape 1.1 a été remplacé par un `expect(true).toBe(true)` qui n'importe rien | aucun | l'étape 1.1 passe alors que rien n'est écrit — c'est le cas que `verifyAllRed` doit rejeter. Le parcours correspondant est `src/core/__fixtures__/parcours-tautologique.json` |
| `f-module-inattendu.json` | absent, et le test de l'étape 1.1 importe `../../src/helpers-inexistants.js`, qui n'est **pas** dans `expected.files` | `-t "step 1\.1"` | même forme que (a), mais le module manquant n'est pas un fichier attendu : erreur réelle, pas « étape pas commencée » |

Deux constats qui ont dicté `classify.ts` :

- **`--outputFile` est bien écrit dans le cas (a)** : une erreur de collecte ne fait pas
  disparaître le rapport. Le fichier absent ou vide reste un cas géré (`parse.ts`), pas un
  plantage.
- **(a) et (b) sont indiscernables par les compteurs** : zéro test exécuté, tous les
  fichiers en `failed`. Seul le texte du message les sépare.

`examples/demo-project` a été remis dans son état d'origine après la capture.

- `g-messages-frequents.json` — sortie réelle de Vitest 4 pour les formes d'erreur que
  `src/core/humanize.ts` sait traduire : `is not a function` (qui recouvre aussi l'export
  manquant, voir plus bas), `to deeply equal` sur un objet, lecture d'une propriété de
  `undefined`, et le dépassement de délai. Deux surprises, vérifiées ici :
  - un **export manquant** ne produit pas « does not provide an export named » : la
    transformation SSR de Vite le fait ressortir en `is not a function`. On ne peut donc
    pas distinguer les deux cas, et le message traduit ne le prétend pas ;
  - un **dépassement de délai** perd son texte dans le rapport JSON, il ne reste que
    `Error: STACK_TRACE_ERROR`. « Test timed out in 300ms » n'apparaît nulle part.
