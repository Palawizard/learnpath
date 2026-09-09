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
     complet du fichier.
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

# Prompt de génération (à coller dans Claude Code / Codex)

> Tu vas produire un parcours d'apprentissage au format JSON défini ci-dessous, à
> partir de la fonctionnalité que je veux implémenter dans ce projet.
>
> Contexte : lis le projet pour respecter ses conventions (style, structure de
> dossiers, TS ou JS, gestionnaire de paquets).
>
> Fonctionnalité voulue : <DÉCRIRE ICI>
> Niveau de l'apprenant : <débutant | intermédiaire>
>
> Contraintes :
> - 5 à 10 étapes, une idée par étape, ~15 lignes de code max par étape
> - Fige d'abord le `contract` (fichiers, exports, signatures), puis écris les tests
> - Les tests portent sur le comportement observable uniquement
> - Chaque `describe` commence par `step <id>`
> - Les tests des étapes précédentes doivent rester verts quand le code grossit
> - `explanation` explique le POURQUOI et ne contient jamais la solution
> - `hints` va du plus vague au plus précis, sans donner le code
> - `solution` contient le **contenu complet et fonctionnel du fichier à ce stade** :
>   tout ce que les étapes précédentes ont fait écrire y est encore, en entier. Jamais un
>   extrait, jamais `// ... le reste inchangé ...` : ce texte est écrit tel quel sur le
>   disque de l'étudiant et remplace le fichier
> - `runner` ne contient que `kind` (`"vitest"`), `cwd` et `setup`. N'invente ni
>   `command` ni `filterFlag` : la commande de test est construite par l'extension et ces
>   champs sont refusés par le schéma. `setup` ne peut commencer que par npm, npx, pnpm
>   ou yarn.
>
> Avant de me rendre le JSON, vérifie toi-même :
> 1. chaque test échoue sur le projet actuel
> 2. les solutions appliquées **dans l'ordre** font passer, après chaque étape N, les
>    tests des étapes 1 à N — pas seulement ceux de l'étape N
>
> Écris le résultat dans `.learn/parcours/<slug>.json`.
