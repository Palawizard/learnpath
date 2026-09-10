Ta tâche est d'écrire le fichier .learn/parcours/<slug>.json. N'affiche pas son contenu
dans ta réponse : écris-le directement sur le disque et confirme le chemin.

Ce fichier est un parcours d'apprentissage LearnPath, que j'importerai dans mon éditeur.
Je code les étapes moi-même, tu ne codes rien à ma place.

Format exact du fichier :

{
  "version": 1,
  "slug": "kebab-case-sans-espace",
  "title": "Titre lisible",
  "intro": "Markdown. Ce qu'on construit et pourquoi.",
  "runner": { "kind": "vitest", "cwd": ".", "environment": "node", "setup": ["npm i -D vitest"] },
  "contract": {
    "files": { "src/chemin.js": "signature1(...) -> ... ; signature2(...) -> ..." }
  },
  "steps": [
    {
      "id": "1.1",
      "title": "Titre de l'étape",
      "explanation": "Markdown. Le POURQUOI, 3 à 8 lignes. Jamais le code.",
      "expected": {
        "files": ["src/chemin.js"],
        "contract": "export function nom(args): retour",
        "acceptance": ["Ce qui doit être vrai", "En français, comportemental"]
      },
      "tests": {
        "file": ".learn/tests/step-1.1.spec.js",
        "grep": "step 1.1",
        "content": "import { describe, it, expect } from 'vitest'\n\ndescribe('step 1.1 — ...', () => {\n  it('...', () => { ... })\n})\n"
      },
      "hints": ["Indice vague", "Indice plus précis"],
      "solution": { "src/chemin.js": "contenu COMPLET du fichier à ce stade" }
    }
  ]
}

Règles non négociables :

1. Contrat d'abord : fige les fichiers, exports et signatures dans "contract" avant
   d'écrire le moindre test. Un test ne porte que sur ce qui est dans le contrat.
2. Teste le comportement, jamais la structure. Interdit de tester le texte du source,
   les noms de variables internes, l'ordre des fonctions privées.
3. Chaque describe commence par "step <id>" — c'est le filtre utilisé pour ne lancer que
   les tests de l'étape.
4. Régression cumulative : à l'étape N, les tests des étapes 1..N-1 sont relancés. Écris
   des tests qui restent verts quand le code grossit.
5. "solution" est le contenu COMPLET et fonctionnel du fichier à ce stade, jamais un
   extrait, jamais "// ... le reste inchangé ...". Il est écrit tel quel sur mon disque :
   un extrait effacerait le travail des étapes précédentes. C'est la faute la plus
   fréquente, et l'import la refuse.
6. Chaque étape doit être ROUGE avant que j'écrive quoi que ce soit. Un test qui passe
   d'entrée fait refuser tout le parcours.
7. 5 à 10 étapes. Une étape = une idée, environ 15 lignes de code de ma part au plus.
8. "runner" ne contient que "kind" ("vitest"), "cwd", "environment" et "setup". N'invente
   ni "command" ni "filterFlag" : la commande de test est construite par l'extension et
   ces champs sont refusés par le schéma. "setup" ne peut contenir que des commandes npm,
   npx, pnpm ou yarn, sans && ni | ni ;. "environment" vaut "jsdom" dès qu'un test monte
   un composant ou touche au DOM (React, Vue, Svelte), "node" sinon. Les plugins et les
   alias de mon projet sont hérités de mon vite.config, il n'y a rien à redéclarer.
9. Structure des fichiers de test : chaque it() est à l'intérieur d'un describe(), jamais
   au niveau racine, et le callback de describe() est synchrone, jamais async. Ne crée
   jamais un it() dans un hook, dans un autre it() ou dans un setTimeout. Sinon le fichier
   ne se COLLECTE pas : Vitest n'y voit aucun test, n'en exécute aucun, et l'import refuse
   le parcours avec un message que je ne peux pas décoder.

Avant d'écrire le fichier, exécute réellement les tests et vérifie, dans cet ordre :
- chaque fichier de test SE COLLECTE (Vitest annonce le bon nombre de tests pour ce
  fichier), y compris avant que mon code existe. « Le test échoue » et « le test ne
  s'exécute pas » ne sont pas la même chose : un fichier mal formé échoue aussi, mais pour
  la mauvaise raison ;
- une fois collecté, chaque test ÉCHOUE sur le projet actuel ;
- les solutions appliquées dans l'ordre laissent, après chaque étape N, les tests des
  étapes 1 à N tous verts.

Regarde mon projet pour en respecter les conventions : style, structure de dossiers, TS ou
JS, gestionnaire de paquets. Écris le fichier sur le disque et confirme son chemin. Ne
recopie pas le JSON dans ta réponse.

Mon niveau : {{NIVEAU}}
{{FICHIERS}}
La fonctionnalité que je veux coder : {{FONCTIONNALITE}}
