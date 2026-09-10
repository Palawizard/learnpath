# Format de parcours — spécification v1

Contrat entre le générateur (Claude Code / Codex, hors extension) et l'extension VSCode.
Cible du prototype : JS/TS + Vitest, 5 à 10 étapes par fonctionnalité.

## Arborescence dans le projet de l'utilisateur

```
.learn/
  parcours/
    auth-jwt.json          <- le parcours importé
  tests/
    step-1.1.spec.ts       <- écrits sur disque à l'import
    step-1.2.spec.ts
  vitest.config.mts        <- config isolée, ne touche pas celle du projet
  state.json               <- progression (gitignoré)
```

Ajouter `.learn/state.json` au `.gitignore`. Le reste peut être commité :
les tests deviennent la suite de tests réelle du projet en fin de parcours.

## Schéma

```jsonc
{
  "version": 1,
  "slug": "auth-jwt",
  "title": "Authentification par JWT",
  "intro": "Markdown. Ce qu'on va construire et pourquoi.",

  "runner": {
    "kind": "vitest",            // seule valeur admise ; la commande est construite
                                 // par l'extension, pas fournie par le parcours (D14)
    "cwd": ".",
    "environment": "node",       // "node" | "jsdom" | "happy-dom" | "edge-runtime".
                                 // Absent : déduit du setup (D31). Un parcours qui monte
                                 // un composant a besoin de "jsdom".
    "setup": ["npm i -D vitest"] // joué une seule fois à l'import, liste blanche (D8)
  },

  "contract": {
    // Figé AVANT l'écriture des tests. Visible par l'étudiant.
    "files": {
      "src/auth/token.ts": "createToken(payload, secret) -> string ; verifyToken(token, secret) -> payload | null"
    }
  },

  "steps": [
    {
      "id": "1.1",
      "title": "Signer un token",
      "explanation": "Markdown. Le POURQUOI, pas le code. 3 à 8 lignes.",
      "expected": {
        "files": ["src/auth/token.ts"],
        "contract": "export function createToken(payload: object, secret: string): string",
        "acceptance": [
          "Retourne une chaîne de 3 segments séparés par des points",
          "Le payload est récupérable après décodage base64 du segment 2"
        ]
      },
      "tests": {
        "file": ".learn/tests/step-1.1.spec.ts",
        "grep": "step 1.1",
        "content": "import { describe, it, expect } from 'vitest'\n..."
      },
      "hints": [
        "Un JWT c'est header.payload.signature, chaque partie en base64url",
        "Le header minimal est { alg: 'HS256', typ: 'JWT' }"
      ],
      "solution": {
        "src/auth/token.ts": "// code complet de l'étape"
      }
    }
  ]
}
```

## Règles imposées au générateur

1. **Contrat d'abord.** Les noms de fichiers, exports et signatures sont figés dans
   `contract` avant que le moindre test soit écrit, et affichés à l'étudiant.
   Un test ne peut porter que sur ce qui est dans le contrat.
2. **Comportement, jamais structure.** Interdit de tester le contenu du source
   (`expect(src).toContain('for')`), les noms de variables internes, l'ordre des
   fonctions privées. On teste ce que la fonction fait.
3. **Un test = une étape.** Chaque `describe` commence par `step <id>` pour que le
   filtre `-t` fonctionne. Pas de test partagé entre deux étapes.
4. **Régression cumulative.** À l'étape N, l'extension relance aussi les tests des
   étapes 1..N-1. Le générateur doit donc écrire des tests qui restent verts quand
   le code grossit.
5. **La solution est le contenu complet et fonctionnel du fichier à ce stade**, jamais un
   extrait, jamais un commentaire de continuité (`// ... le reste inchangé ...`). Elle est
   écrite telle quelle sur le disque de l'étudiant : si elle ne contient que la nouveauté
   de l'étape, elle efface le travail des étapes précédentes. C'est le mode de défaillance
   le plus fréquent du contenu généré, et l'import le refuse (D21).
6. **5 à 10 étapes.** Une étape = une idée. Si une étape demande plus de ~15 lignes
   à l'étudiant, la couper en deux.

## Structure des tests

Un fichier de test mal formé ne se **collecte** pas : Vitest n'y trouve aucun test et
n'en exécute aucun. Vu de loin ça ressemble à un test rouge, sauf que le test n'existe
pas. C'est la faute la plus coûteuse du générateur, parce qu'elle ne se voit qu'à
l'import et qu'elle produit un message incompréhensible (« Vitest failed to find the
current suite », que Vitest lui-même attribue à un de ses bugs).

1. **Chaque `it()` est imbriqué dans un `describe()`**, jamais au niveau racine du
   fichier.
2. **Le callback de `describe()` est synchrone**, jamais `async`. Tout l'asynchrone va
   dans les `it()`, où il est attendu par le runner.
3. **Aucun `it()` ni `describe()` créé ailleurs** : pas dans un hook (`beforeEach`), pas
   dans un autre `it()`, pas dans un `setTimeout`, pas dans un `.then()`. La collecte est
   terminée quand ces codes s'exécutent.
4. **Avant de rendre le JSON, exécute réellement chaque fichier de test**, y compris —
   et surtout — avant que le code de l'étudiant existe. Ce qu'on vérifie là n'est pas
   qu'il échoue, c'est qu'il **se collecte** : Vitest doit annoncer le bon nombre de
   tests pour ce fichier.

**« Le test échoue » et « le test ne s'exécute pas » ne sont pas la même chose.** Un
fichier mal formé échoue aussi, mais pour la mauvaise raison, et l'extension le refuse.

| Ce que dit Vitest | Ce que ça veut dire |
|---|---|
| N tests, N en échec (assertion, module introuvable) | correct : le test existe et il est rouge parce que le code n'est pas écrit |
| 0 test collecté, erreur au niveau du fichier | **le fichier de test est mal formé** : à corriger avant de rendre le JSON |

## La config Vitest écrite par l'extension

`.learn/vitest.config.mts` est **générée**, jamais éditée à la main : elle est réécrite à
chaque import. Deux formes, selon le projet (D31) :

- **le projet a un `vite.config.*`** : la config générée l'importe et fusionne avec
  `mergeConfig`. Le projet apporte ses plugins (`@vitejs/plugin-react`, Vue, Svelte…), ses
  alias et son `resolve` ; on n'ajoute que le bloc `test`. Le `test` du projet, lui, est
  écarté : sa config de test n'est ni lue ni appliquée, sinon ses `include` s'ajouteraient
  aux nôtres et la vérification à l'import lancerait ses tests à lui.
- **pas de config Vite** : config autonome, comme avant.

`vitest.config.*` du projet n'est jamais lu — c'est sa configuration de test, elle est
sacrée (D3).

Ce qu'aucune config Vite ne contient, c'est l'environnement de test. Un test de composant
sous `environment: 'node'` échoue sur `document is not defined`. Il vient donc de
`runner.environment` ; à défaut, il est déduit de `setup` (installer `jsdom` ou
`happy-dom`, c'est en avoir besoin), et vaut `node` sinon.

## Validation à l'import (côté extension)

C'est le garde-fou le plus important, il attrape les parcours bidons :

1. Écrire les tests sur disque, jouer `runner.setup`.
2. Lancer **tous** les tests sur le projet en l'état.
3. **Chaque étape doit être rouge.** Une étape déjà verte avant que l'étudiant ait
   écrit quoi que ce soit = test vide ou tautologique -> refuser l'import et
   nommer l'étape fautive.
4. **Appliquer les `solution` étape par étape dans une copie temporaire du workspace**, et
   après chaque étape N exiger que les étapes 1..N soient **toutes vertes**. Deux fautes
   distinctes sont attrapées là, et nommées différemment :
   - la solution de l'étape N ne passe pas ses propres tests — l'étudiant n'a aucune chance ;
   - la solution de l'étape N casse une étape précédente — elle n'était pas le contenu
     complet du fichier ;
   - le fichier de test de l'étape N ne se collecte pas — aucun test n'a tourné, la
     solution n'est pas en cause, c'est le fichier de test qui est mal formé.
   Ça coûte un run de tests par étape (mesuré : environ 0,8 s par étape sur le parcours
   panier, cinq étapes). Ce n'est pas optionnel : c'est ce qui distingue un parcours
   jouable d'un parcours qui bloque l'étudiant à l'étape 4.

## Boucle d'exécution

- `onDidSaveTextDocument`, filtré sur `steps[current].expected.files`, debounce 500ms.
- Commande manuelle de relance en secours (l'étudiant sauvegardera ailleurs).
- La commande est construite par l'extension depuis `runner.kind` (D14) :
  `npx vitest run --config .learn/vitest.config.mts --reporter=json --outputFile=<temporaire>`.
- Filtre `-t "step <id>"`, plus les ids précédents en régression. Vitest interprète `-t`
  comme une expression régulière : les ids sont échappés et joints par `|`.
- Parser le fichier de sortie, pas stdout. Il est écrit dans un temporaire propre à chaque
  run, jamais dans un chemin fixe partagé.

Trois états rouges à distinguer dans l'UI :

| Cause | Signal Vitest | Ce qu'on affiche |
|---|---|---|
| Fichier pas encore créé | erreur de résolution de module | rien, état normal de début d'étape |
| Code en cours d'écriture | erreur de collecte / parse | indicateur discret, pas d'erreur rouge |
| Test réellement en échec | assertion failed | diff attendu / reçu + hint suivant |

Au vert : incrémenter, sauver `state.json`, charger l'étape suivante.

## Fin de parcours

Proposer de déplacer `.learn/tests/*` vers le dossier de tests du projet et de
fusionner la config. L'étudiant repart avec du code testé, pas avec un badge.

---

# Prompt de génération

**Le prompt vit dans [`prompts/generer-parcours.md`](../prompts/generer-parcours.md), et
nulle part ailleurs.** Il n'est recopié ni ici, ni dans le README, ni dans le code de la
webview : il a existé en deux exemplaires divergents, et un parcours a été généré avec une
version périmée — d'où D37.

Trois champs y sont marqués, et eux seuls : `{{FONCTIONNALITE}}`, `{{NIVEAU}}` et
`{{FICHIERS}}` (facultatif, sa ligne disparaît quand il est vide). `composePrompt`
(`src/core/prompt.ts`) les substitue et **refuse** un gabarit dont un marqueur reste :
un champ renommé se voit à la compilation du prompt, pas dans le presse-papiers de
l'utilisateur.

L'extension le compose elle-même — commande **LearnPath : Générer le prompt du parcours…**,
ou le bouton « Générer le prompt » de l'accueil. Le prompt composé est affiché en entier et
modifiable avant d'être copié : voir `UX.md`.
