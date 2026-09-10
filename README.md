# LearnPath

Tu veux coder une fonctionnalité **et** la comprendre. LearnPath la découpe en étapes,
te laisse écrire le code, et lance les tests de l'étape en cours à chaque sauvegarde.
Vert, on passe à la suivante.

Ça se joue **dans ton vrai projet**, pas dans un bac à sable.

<!-- CAPTURE 1 — le panneau pendant une étape : titre du parcours, barre segmentée,
     énoncé, bloc « Attendu », boutons Indice / Solution, zone d'état verte.
     À placer ici. Le marketplace exige une URL https absolue pour les images du README :
     pointer sur https://raw.githubusercontent.com/Palawizard/learnpath/main/media/… -->

## Ce que ça fait, et ce que ça ne fait pas

- **Ça fait** : afficher une étape, surveiller tes sauvegardes, lancer les tests de
  l'étape et des étapes précédentes, avancer tout seul, donner des indices un par un,
  et révéler la solution si tu bloques.
- **Ça ne fait pas** : générer le parcours. C'est un fichier JSON produit en amont par
  l'agent de code que tu utilises déjà (Claude Code, Codex, Copilot Chat, ce que tu veux).

**L'extension n'appelle aucun modèle d'IA et ne fait aucun appel réseau.** Pas de clé
API, pas de quota, pas de télémétrie. C'est aussi ce qui la rend utilisable telle quelle
sur VSCodium.

## Installation

Cherche « LearnPath » dans le panneau Extensions, ou :

```
code --install-extension Palawizard.learnpath
codium --install-extension Palawizard.learnpath
```

Il te faut un projet JavaScript ou TypeScript avec un `package.json`. Vitest est installé
par l'extension au moment de l'import s'il n'est pas déjà là.

## De « je veux coder cette fonctionnalité » à la première étape

1. **Ouvre ton projet** dans VS Code ou VSCodium.
2. **Demande le parcours à ton agent de code**, avec le prompt de la section suivante.
   Il produit un fichier JSON — enregistre-le où tu veux, par exemple
   `~/Téléchargements/panier.json`.
3. **Palette de commandes** (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **LearnPath : Importer un
   parcours…**, et choisis le fichier.
4. **Confirme l'installation.** L'extension te montre la commande exacte qu'elle veut
   lancer (`npm i -D vitest` en général) et attend ton accord. Rien ne se lance sans lui.
5. **Attends la vérification.** L'extension joue elle-même le parcours entier dans une
   copie temporaire de ton projet : chaque étape doit être rouge au départ, et chaque
   solution doit rendre vertes toutes les étapes jouées jusque-là. Un parcours bancal est
   refusé ici, avec le nom de l'étape fautive — et rien n'est laissé derrière.
   Compte une dizaine de secondes, une barre de progression t'accompagne.
6. **Le panneau s'ouvre sur l'étape 1.** Écris le code dans le fichier indiqué, sauvegarde.
   Les tests tournent tout seuls.

<!-- CAPTURE 2 — le dialogue de confirmation du setup, avec la commande exacte affichée. -->

Si le panneau se ferme, **LearnPath : Ouvrir le parcours** le ramène. Si tu as sauvegardé
ailleurs que dans le fichier attendu et que rien ne se lance : **LearnPath : Relancer les
tests de l'étape**.

## Le prompt de génération

Colle ce bloc à ton agent de code, dans le projet concerné, en remplaçant la dernière
ligne par ce que tu veux construire.

````text
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
8. "setup" ne peut contenir que des commandes npm, npx, pnpm ou yarn, sans && ni | ni ;.
   "environment" vaut "jsdom" dès qu'un test monte un composant ou touche au DOM (React,
   Vue, Svelte), "node" sinon. Les plugins et les alias de mon projet sont hérités de mon
   vite.config, il n'y a rien à redéclarer.
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

Regarde mon projet pour choisir les chemins, le style et les conventions existantes.
Écris le fichier sur le disque et confirme son chemin. Ne recopie pas le JSON dans ta
réponse.

La fonctionnalité que je veux coder : <DÉCRIS-LA ICI>
````

Si l'import refuse le parcours, le message nomme l'étape et la faute : recolle-le à ton
agent, il corrige en général du premier coup.

## Ce que l'extension écrit dans ton projet

Tout tient dans un dossier, plus deux lignes de `.gitignore` :

| Chemin | Quand | Contenu |
|---|---|---|
| `.learn/parcours/<slug>.json` | à l'import | le parcours tel que tu l'as importé |
| `.learn/tests/step-*.spec.js` | à l'import | les tests des étapes |
| `.learn/vitest.config.mts` | à l'import | une config Vitest isolée, qui ne lit que `.learn/tests/` ; elle hérite des plugins et alias de ton `vite.config.*` s'il existe, jamais de ta config de test |
| `.learn/state.json` | en continu | ta progression : étape en cours, indices vus, solutions révélées |
| `.learn/.vite/` | pendant les runs | le cache de Vitest, jetable |
| `.gitignore` | à l'import | deux lignes ajoutées sous un commentaire `# LearnPath` |
| le fichier de l'étape | **seulement si tu cliques sur « Solution »** | le contenu écrit par la solution |

Et ce que l'extension **ne touche jamais** :

- ton `vitest.config.*` et le champ `scripts.test` de ton `package.json` : jamais lus,
  jamais modifiés. LearnPath lance Vitest avec `--config .learn/vitest.config.mts`, ta
  suite de tests et la sienne s'ignorent dans les deux sens ;
- ton code, en dehors des fichiers listés dans `expected.files` de l'étape, et uniquement
  quand tu cliques sur « Solution » ;
- ton `node_modules`, en dehors de l'installation de Vitest que tu as confirmée ;
- le réseau.

Les rapports de test sont écrits dans un dossier temporaire du système, jamais chez toi.
Si l'import échoue à mi-chemin, tout ce qui avait été créé est supprimé, `.gitignore`
compris.

**En fin de parcours**, `.learn/tests/` contient une vraie suite de tests de ta
fonctionnalité : l'écran de fin te propose de la déplacer dans le dossier de tests du
projet. Tu repars avec du code testé, pas avec un badge.

<!-- CAPTURE 3 — l'écran de fin : récapitulatif des étapes, indices utilisés, solutions
     révélées, et la proposition de déplacer les tests. -->

## Désinstaller un parcours

**LearnPath : Réinitialiser le parcours** propose deux choses : recommencer depuis
l'étape 1 (les tests restent en place) ou supprimer `.learn/` entièrement. Dans les deux
cas, **le code que tu as écrit n'est pas touché**.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| LearnPath : Ouvrir le parcours | ouvre le panneau |
| LearnPath : Importer un parcours… | importe un fichier JSON |
| LearnPath : Relancer les tests de l'étape | relance à la main |
| LearnPath : Réinitialiser le parcours | recommencer, ou supprimer |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `learnpath.debounceMs` | `500` | délai entre ta sauvegarde et le lancement des tests |
| `learnpath.autoAdvance` | `true` | passer à l'étape suivante automatiquement au vert |

## Limites connues

- **JavaScript / TypeScript et Vitest uniquement.** pytest est la prochaine cible.
- **Yarn Plug'n'Play n'est pas supporté** : passe le projet en `nodeLinker: node-modules`.
- **Un parcours à la fois** par projet.
- Un test qui dépasse son délai est signalé comme tel, mais Vitest ne transmet pas la
  durée dans son rapport JSON : le message reste générique.

## Vie privée

Aucun appel réseau, aucune télémétrie, aucun modèle d'IA. Ton code ne quitte pas ta
machine, et l'extension fonctionne hors ligne.

## Contribuer

Le code, les décisions techniques et le format de parcours sont documentés dans le
dépôt : [github.com/Palawizard/learnpath](https://github.com/Palawizard/learnpath).
Le point d'entrée pour un contributeur est [AGENTS.md](AGENTS.md).

MIT.
