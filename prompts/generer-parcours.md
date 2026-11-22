Ta tâche est d'écrire le fichier .learn/parcours/<slug>.json. N'affiche pas son contenu
dans ta réponse : écris-le directement sur le disque et confirme le chemin.

Ce fichier est un parcours d'apprentissage LearnPath, que j'importerai dans mon éditeur.
Je code les étapes moi-même, tu ne codes rien à ma place. Le but est que j'APPRENNE à
écrire ce code, pas seulement que les tests passent : chaque étape doit me donner de quoi
l'écrire seul, y compris la syntaxe du langage si je ne la connais pas.

Mon niveau en programmation : {{NIVEAU}}
Mon niveau dans ce langage ou ce framework : {{NIVEAU_LANGAGE}}
{{ACQUIS}}
{{FICHIERS}}
La fonctionnalité que je veux coder : {{FONCTIONNALITE}}

## Étape 0 — le périmètre, AVANT d'écrire quoi que ce soit

1. Découpe ma demande en tout ce qu'elle contient : fonctions, écrans, appels réseau, état,
   hooks, routes, validations, gestion d'erreurs…
2. Estime le nombre d'étapes pour TOUT couvrir, avec des étapes de 20 lignes au plus.
3. Si ça tient en 10 étapes : écris le parcours.
   Sinon : n'écris AUCUN fichier. Propose-moi un découpage en plusieurs parcours
   (« partie 1/3 : … », chacun de 10 étapes au plus, dans un ordre qui se construit) et
   attends ma réponse.
4. Ne réduis jamais le périmètre en silence. Ne choisis pas ce qui est facile à tester
   plutôt que ce que j'ai demandé : si ma demande touche au réseau, à un hook, à l'état ou
   au routage, teste-le (MSW ou fetch simulé avec vi.fn / vi.stubGlobal, renderHook,
   MemoryRouter ; en Python monkeypatch ou unittest.mock). Ce qui reste hors du parcours
   va dans "scope.notCovered", et l'intro ne prétend jamais couvrir plus que
   "scope.covered".

## Choisir le runner

Regarde mon projet :
- projet JavaScript ou TypeScript (package.json) → "kind": "vitest" ;
- projet Python (pyproject.toml, requirements.txt, fichiers .py, .venv) → "kind": "pytest".

## Format exact du fichier, ici pour un projet JavaScript

{
  "version": 1,
  "slug": "kebab-case-sans-espace",
  "title": "Titre lisible",
  "intro": "Markdown. Ce qu'on construit et pourquoi.",
  "scope": {
    "covered": ["Chaque élément de ma demande que le parcours couvre"],
    "notCovered": ["Chaque élément de ma demande laissé de côté ([] si rien)"]
  },
  "runner": { "kind": "vitest", "cwd": ".", "environment": "node", "setup": ["npm i -D vitest"] },
  "contract": {
    "files": { "src/chemin.js": "signature1(...) -> ... ; signature2(...) -> ..." }
  },
  "steps": [
    {
      "id": "1.1",
      "title": "Titre de l'étape",
      "explanation": "Markdown. Le pourquoi, puis ce que l'étape demande concrètement. Jamais la solution.",
      "examples": [
        {
          "title": "Ce que montre l'exemple (ex. « Un état avec useState »)",
          "code": "code court et complet, sur un AUTRE sujet que l'étape",
          "explanation": "Markdown. Ce qu'on lit, construction par construction."
        }
      ],
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
      "hints": ["Indice vague", "Indice plus précis", "Indice presque en code"],
      "scaffold": { "src/chemin.js": "contenu COMPLET du fichier, la partie de l'étape remplacée par des TODO" },
      "solution": { "src/chemin.js": "contenu COMPLET du fichier à ce stade" }
    }
  ]
}

Pour un projet Python, seuls "runner", les chemins, le code et "tests" changent :

  "runner": { "kind": "pytest", "cwd": ".", "setup": ["python -m venv .venv", "pip install pytest"] },
  ...
      "expected": { "files": ["panier.py"], "contract": "def nom(args) -> retour", ... },
      "tests": {
        "file": ".learn/tests/test_step_1_1.py",
        "grep": "step 1.1",
        "content": "from panier import nom\n\n\ndef test_ce_qui_doit_etre_vrai():\n    assert nom(...) == ...\n"
      },
      "scaffold": { "panier.py": "..." },
      "solution": { "panier.py": "contenu COMPLET du fichier à ce stade" }

## Règles pédagogiques — ce qui fait que j'apprends

A. "explanation" : le POURQUOI, puis ce que l'étape demande concrètement (quelle fonction ou
   quel composant, ce qu'il reçoit, ce qu'il renvoie ou affiche). 3 à 10 lignes. Jamais la
   solution.

B. "examples" : OBLIGATOIRE à chaque étape, 1 à 3 exemples. C'est là que j'apprends la
   syntaxe : une explication ne montre pas comment on écrit le code.
   - Chaque exemple montre, écrite et fonctionnelle, la syntaxe exacte dont l'étape a besoin
     (déclarer une fonction, importer, un .map en JSX, useState, une compréhension de liste,
     un appel fetch avec await, un test avec renderHook…).
   - Il porte sur un AUTRE sujet que l'étape : autres noms, autres données, autre domaine.
     Je dois transposer, pas recopier. L'import REFUSE un exemple dont plus de la moitié des
     lignes se retrouvent dans la solution de l'étape.
   - Code court (3 à 15 lignes), complet, qui tournerait tel quel.
   - "explanation" de l'exemple : une puce par construction du langage, ce qu'elle fait et
     comment la lire.
   - Adapte-toi à mon niveau dans ce langage :
     « je découvre la syntaxe » → chaque construction nouvelle pour moi a son exemple, même
     la plus basique ; ne suppose rien de connu.
     « je connais les bases » → exemples sur les constructions moins courantes et sur ce qui
     est propre au framework.
     « à l'aise » → un exemple court, qui rappelle l'API ou le motif utilisé.

C. "hints" : au moins 3, du plus vague au plus précis. Le dernier est presque du code (la
   ligne clé ou la structure), sans être la solution complète.

D. "scaffold" : le fichier de l'étape avec des trous. Contenu COMPLET du fichier (le code
   des étapes précédentes compris), où la partie propre à l'étape est remplacée par sa
   structure (signature, blocs) et des commentaires TODO qui disent quoi écrire. Il doit
   être différent de la solution, et ne porter que sur des fichiers de "expected.files".
   « je découvre la syntaxe » → un squelette à chaque étape. « je connais les bases » → à
   chaque étape de plus de 10 lignes. « à l'aise » → facultatif.

E. Taille : une étape = une idée, et au plus 20 lignes à écrire. Les lignes comptées sont
   celles que la solution de l'étape N ajoute ou modifie par rapport à celle de l'étape
   N-1, hors lignes vides et lignes qui ne font que fermer un bloc (}, ), </div>). L'import
   REFUSE une étape qui dépasse : coupe-la en deux plutôt.
   « je découvre la syntaxe » → vise 8 à 15 lignes par étape.

F. "acceptance" dit tout ce que le test exige et que je ne peux pas deviner : textes
   exacts affichés, libellés, rôles ARIA, noms de champs, codes d'erreur.

## Règles techniques non négociables

1. Contrat d'abord : fige les fichiers, exports et signatures dans "contract" avant
   d'écrire le moindre test. Un test ne porte que sur ce qui est dans le contrat.
2. Teste le comportement, jamais la structure. Interdit de tester le texte du source,
   les noms de variables internes, l'ordre des fonctions privées.
3. Un fichier de test par étape, et "grep" vaut "step <id>". Avec Vitest, chaque describe
   commence par "step <id>" — c'est le filtre utilisé pour ne lancer que les tests de
   l'étape. Avec pytest, c'est le fichier qui fait l'étape : les noms des fonctions de test
   sont libres, mais commencent par test_.
4. Régression cumulative : à l'étape N, les tests des étapes 1..N-1 sont relancés. Écris
   des tests qui restent verts quand le code grossit.
5. "solution" est le contenu COMPLET et fonctionnel du fichier à ce stade, jamais un
   extrait, jamais "// ... le reste inchangé ..." ni "# ... inchangé ...". Il est écrit tel
   quel sur mon disque : un extrait effacerait le travail des étapes précédentes. C'est la
   faute la plus fréquente, et l'import la refuse.
6. Chaque étape doit être ROUGE avant que j'écrive quoi que ce soit. Un test qui passe
   d'entrée fait refuser tout le parcours.
7. 5 à 10 étapes, chacune dans les limites de la règle E.
8. "runner" ne contient que "kind", "cwd", "environment" et "setup". N'invente ni
   "command" ni "filterFlag" : la commande de test est construite par l'extension et ces
   champs sont refusés par le schéma. Aucun && ni | ni ; dans "setup".
   - Vitest : "setup" ne contient que des commandes npm, npx, pnpm ou yarn. "environment"
     vaut "jsdom" dès qu'un test monte un composant ou touche au DOM (React, Vue, Svelte),
     "node" sinon. Les plugins et les alias de mon projet sont hérités de mon vite.config,
     il n'y a rien à redéclarer.
   - pytest : pas de champ "environment". "setup" ne contient que pip, uv, poetry, ou
     python limité à "python -m venv <dossier>" et "python -m pip …". pip s'exécute avec le
     Python de mon environnement virtuel (.venv ou venv du projet) : si j'en ai déjà un
     avec pytest, laisse "setup" vide ; sinon crée-le avec "python -m venv .venv" avant
     "pip install pytest". Ma config pytest (pytest.ini, pyproject.toml, conftest.py à la
     racine) n'est PAS appliquée aux tests du parcours : chaque fichier de test se suffit à
     lui-même. Les imports se résolvent depuis la racine du projet : "panier.py" s'importe
     "from panier import …", "app/panier.py" s'importe "from app.panier import …".
9. Structure des fichiers de test. Sinon le fichier ne se COLLECTE pas : le runner n'y voit
   aucun test, n'en exécute aucun, et l'import refuse le parcours.
   - Vitest : chaque it() est à l'intérieur d'un describe(), jamais au niveau racine, et le
     callback de describe() est synchrone, jamais async. Ne crée jamais un it() dans un
     hook, dans un autre it() ou dans un setTimeout.
   - pytest : le nom du fichier est un nom de module Python (lettres, chiffres, _, pas de
     point ni de tiret : "test_step_1_1.py", jamais "step-1.1.py"). Les tests sont des
     fonctions test_… au niveau du module, ou des méthodes test_… d'une classe Test… sans
     __init__. Importe ce que l'étape teste en tête du fichier, directement depuis le
     module du contrat.

## Avant d'écrire le fichier

Exécute réellement les tests et vérifie, dans cet ordre :
- chaque fichier de test SE COLLECTE (le runner annonce le bon nombre de tests pour ce
  fichier), y compris avant que mon code existe. « Le test échoue » et « le test ne
  s'exécute pas » ne sont pas la même chose : un fichier mal formé échoue aussi, mais pour
  la mauvaise raison. Avant que mon code existe, un import qui échoue parce que le module
  ou la fonction de l'étape n'existe pas encore est normal ;
- une fois collecté, chaque test ÉCHOUE sur le projet actuel ;
- les solutions appliquées dans l'ordre laissent, après chaque étape N, les tests des
  étapes 1 à N tous verts.

Vérifie aussi, étape par étape : au moins un exemple, sur un autre sujet que l'étape ; au
plus 20 lignes ajoutées par rapport à la solution précédente ; au moins 3 indices ; un
squelette quand mon niveau le demande ; "scope" présent et honnête.

Regarde mon projet pour en respecter les conventions : style, structure de dossiers,
langage, gestionnaire de paquets. Écris le fichier sur le disque, puis réponds en trois
lignes au plus : son chemin, ce que le parcours couvre, et ce qu'il ne couvre pas.
Ne recopie pas le JSON dans ta réponse.
