# Fixtures de sortie pytest (JUnit XML)

Rapports **réels** de pytest 9.1.1 (Python 3.14), capturés depuis un projet vide où l'on
a écrit les cinq `steps[].tests.content` de `examples/exemple-panier-python.json` dans
`.learn/tests/`, avec le `.learn/pytest.ini` que génère `src/core/importer.ts`. Aucun n'a
été écrit ni retouché à la main : les chemins absolus sont ceux de la machine de capture.

Commande commune (celle que construit `src/runner/pytest.ts`, au rapport près) :

```
PYTHONDONTWRITEBYTECODE=1 python -m pytest -c .learn/pytest.ini --rootdir=. -p no:cacheprovider \
  --continue-on-collection-errors -q --tb=short --junitxml=<fichier> <fichiers de test>
```

| Fixture | État de `panier.py` | Fichiers passés | Ce qu'on observe |
|---|---|---|---|
| `a-fichier-absent.xml` | absent | les cinq | 5 `<testcase classname="">` avec `<error message="collection failure">`, `ModuleNotFoundError: No module named 'panier'` |
| `b-syntaxe-invalide.xml` | `def creer_panier(:` | les cinq | même forme que (a), `SyntaxError: invalid syntax` avec l'extrait de code et le curseur |
| `c-assertion-echouee.xml` | `creer_panier` retourne `{"lignes": [1], …}` | 1.1 | 1 `<failure message="assert [1] == []…">`, 1 test passé |
| `d-tout-passe.xml` | solution de l'étape 1.5 | les cinq | 15 tests passés, aucun enfant |
| `e-nom-pas-encore-ecrit.xml` | solution de l'étape 1.1 | 1.1 et 1.2 | 1.1 passe ; 1.2 ne se collecte pas : `ImportError: cannot import name 'ajouter_article' from 'panier'` |
| `f-module-inattendu.xml` | absent, le test importe `helpers_inexistants` | 1.1 | `No module named 'helpers_inexistants'` : pas un fichier attendu |
| `g-messages-frequents.xml` | module de test ad hoc `test_step_2_1.py` | 2.1 | formes traduites par `humanize` : `AttributeError: module … has no attribute`, `takes 0 positional arguments but 1 was given`, `missing 1 required positional argument`, `KeyError`, `'NoneType' object is not subscriptable`, `NameError`, et un `assert … == …` |
| `h-test-mal-forme.xml` | — | un test mal indenté | `IndentationError` à la collecte |

Constats qui ont dicté le code :

- **Sans `--continue-on-collection-errors`, pytest interrompt toute la session** dès qu'un
  module ne se collecte pas. L'étape courante pas encore commencée ferait alors passer
  toutes les étapes précédentes pour des régressions.
- **Le cas (e) est le début normal de chaque étape après la première** : en Python,
  `from panier import ajouter_article` échoue à la collecte dès que le module existe sans
  la fonction, là où JavaScript échoue à l'exécution. `classify.ts` le range en
  `missing-file`.
- **Une erreur de collecte n'a pas de `classname`** : le `name` porte le module pointé
  (`.learn.tests.test_step_1_1`). C'est ce qui impose des noms de fichier de test sans
  point ni tiret (`parcours.ts`).
- **`pythonpath` d'un ini passé par `-c` est relatif au dossier de l'ini**, pas au
  `rootdir` : `pythonpath = .` ne rend pas le projet importable, `pythonpath = ..` oui.
- **Rien n'est écrit dans le projet** : ni `__pycache__` ni `.pytest_cache` après ces huit
  captures.
