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
2. **Demande le parcours à ton agent de code.** Le bouton « Générer le prompt » de
   l'accueil compose le prompt à lui donner (section suivante) — tu le relis, tu le
   modifies si tu veux, tu le copies. Ton agent produit un fichier JSON — enregistre-le
   où tu veux, par exemple `~/Téléchargements/panier.json`.
3. **Clique l'icône LearnPath dans la barre d'activité**, puis **« Importer un parcours »**,
   et choisis le fichier. (Par la palette de commandes, `Ctrl+Shift+P` / `Cmd+Shift+P` →
   **LearnPath : Importer un parcours…**, ça marche aussi.)
4. **Confirme l'installation.** L'extension te montre la commande exacte qu'elle veut
   lancer (`npm i -D vitest` en général) et attend ton accord. Rien ne se lance sans lui.
5. **Attends la vérification.** L'extension joue elle-même le parcours entier dans une
   copie temporaire de ton projet : chaque étape doit être rouge au départ, et chaque
   solution doit rendre vertes toutes les étapes jouées jusque-là. Un parcours bancal est
   refusé ici, avec le nom de l'étape fautive — et rien n'est laissé derrière.
   Compte une dizaine de secondes, une barre de progression t'accompagne.
6. **Le panneau s'ouvre sur l'étape 1**, dans la barre d'activité, sans te prendre le
   curseur. Écris le code dans le fichier indiqué, sauvegarde.
   Les tests tournent tout seuls.

<!-- CAPTURE 2 — le dialogue de confirmation du setup, avec la commande exacte affichée. -->

Ensuite le panneau s'ouvre tout seul à chaque ouverture du projet, tant qu'un parcours est
en cours — sans jamais prendre le focus. L'icône de la barre d'activité le ramène s'il a été
masqué. Si tu as sauvegardé ailleurs que dans le fichier attendu et que rien ne se lance :
le bouton **Relancer les tests** en haut du panneau, ou la commande **LearnPath : Relancer
les tests de l'étape**.

## Le prompt de génération

**Tu n'as plus à le recopier : l'extension le compose.** Bouton **« Générer le prompt »**
sur l'accueil du panneau, ou commande **LearnPath : Générer le prompt du parcours…** — elle
reste disponible avec un parcours en cours, puisqu'on génère un parcours par
fonctionnalité.

Un formulaire court, trois champs :

- **la fonctionnalité à implémenter** — le seul obligatoire ;
- **ton niveau** : débutant ou intermédiaire ;
- **les fichiers ou dossiers concernés**, facultatif, pour orienter le générateur.

Puis le prompt complet s'affiche, **en entier et modifiable**, avec un bouton **Copier**.
Tu vois exactement ce que tu envoies, et tu peux le retoucher avant : c'est ce qui te reste
comme prise le jour où le résultat te déçoit.

Le texte de référence est [`prompts/generer-parcours.md`](prompts/generer-parcours.md), la
seule copie qui existe — l'extension le lit, ce README n'en garde pas de double. Il avait
divergé de la spec, et un parcours a été généré avec une version périmée.

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

**Rien d'autre**, sauf deux choses que tu déclenches toi-même et qui sont décrites juste
en dessous : les points de restauration git, et « Refaire l'étape ». Le bouton « Solution »
n'écrit pas : la solution s'affiche dans le panneau, avec un bouton « Copier » par fichier,
et c'est toi qui la recopies.

Et ce que l'extension **ne touche jamais** :

- ton `vitest.config.*` et le champ `scripts.test` de ton `package.json` : jamais lus,
  jamais modifiés. LearnPath lance Vitest avec `--config .learn/vitest.config.mts`, ta
  suite de tests et la sienne s'ignorent dans les deux sens ;
- ton code : **aucun de tes fichiers n'est écrit** sans que tu l'aies demandé étape par
  étape. Le bouton « Solution » n'écrit rien ; « Refaire l'étape » réécrit uniquement les
  fichiers déclarés par l'étape que tu as choisie, après une confirmation qui les nomme ;
- ta branche git, tes commits, ton index : voir ci-dessous ;
- ton `node_modules`, en dehors de l'installation de Vitest que tu as confirmée ;
- le réseau.

## Refaire une étape déjà validée

Tu peux relire n'importe quelle étape passée, et refaire celle que tu veux avec le code tel
qu'il était **avant** elle. Ce sont deux gestes distincts dans le panneau :

- **Relire** (« Relire une étape passée ») est en lecture seule. Ça ne touche à rien : ni
  ton code, ni ta progression.
- **Refaire l'étape** restaure des fichiers. Le bouton n'existe que dans l'écran de
  relecture, dans son propre encadré, et il ouvre une confirmation qui liste exactement les
  fichiers concernés avant la moindre écriture.

Pour que ce soit possible, LearnPath s'appuie sur git plutôt que de réimplémenter un
versionnement à lui :

| Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|
| après chaque étape validée, un commit contenant **uniquement** les fichiers déclarés par l'étape | jamais de `git add -A` : ton travail en cours ailleurs n'est jamais emporté |
| ce commit est posé sur une référence à lui, `refs/learnpath/<slug>/<étape>` | il ne crée aucun tag et n'ajoute rien à ta liste de tags |
| il est fabriqué dans un index temporaire | **ta branche, ton `HEAD`, ton index et ton arbre de travail ne bougent pas** — `git status` et `git log` sont exactement les mêmes avant et après |
| avant une restauration, l'état actuel des fichiers concernés est mis de côté sous `refs/learnpath-backup/` | rien n'est jamais supprimé de ton historique : pas de `reset`, pas de `rebase`, pas de `commit --amend` |

Si un fichier concerné a des modifications non sauvegardées dans l'éditeur, LearnPath le
**sauvegarde d'abord** (VSCode ne recharge pas un buffer modifié), et ce contenu part dans
le point de restauration : ta dernière tentative reste récupérable avec git.

Pour tout supprimer : `git for-each-ref --format='%(refname)' refs/learnpath refs/learnpath-backup |
xargs -n1 git update-ref -d`.

**La fonctionnalité est indisponible**, avec l'explication affichée dans le panneau, si le
projet n'est pas un dépôt git, si l'arbre de travail n'était pas propre au moment de
l'import, ou si tu as désactivé l'option **`learnpath.gitCheckpoints`**. Cette option est
active par défaut ; désactivée, LearnPath ne crée aucun commit et « Refaire l'étape »
n'apparaît plus.

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
l'étape 1 (les tests restent en place) ou supprimer la progression, les tests, la config
et les caches. Dans ce second cas, le JSON généré reste dans `.learn/parcours/` : tu peux
le réimporter sans payer une nouvelle génération. Dans les deux cas, **le code que tu as
écrit n'est pas touché**.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| LearnPath : Ouvrir le parcours | ouvre le panneau |
| LearnPath : Générer le prompt du parcours… | compose le prompt à donner à ton agent |
| LearnPath : Importer un parcours… | importe un fichier JSON |
| LearnPath : Relancer les tests de l'étape | relance à la main |
| LearnPath : Réinitialiser le parcours | recommencer, ou supprimer |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `learnpath.debounceMs` | `500` | délai entre ta sauvegarde et le lancement des tests |
| `learnpath.autoAdvance` | `true` | passer à l'étape suivante automatiquement au vert |
| `learnpath.gitCheckpoints` | `true` | enregistrer chaque étape validée sous `refs/learnpath/`, pour pouvoir refaire une étape. Désactivée : aucun commit, et « Refaire l'étape » est indisponible |

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
