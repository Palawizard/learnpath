# Comportement de l'interface

## Point d'entrée — la barre d'activité

L'extension a **une icône dans la barre d'activité**, et le panneau vit dedans. C'est le
seul point d'entrée qui se voit : tant que tout passait par la palette de commandes, il
fallait connaître le nom d'une commande pour découvrir l'extension, y compris pour son
premier usage.

Les commandes de la palette restent, toutes les cinq. Elles ne sont simplement plus le
seul chemin.

### État d'accueil — aucun parcours actif

La vue ne reste jamais vide. Sans parcours dans le dossier, elle montre :

- **ce que fait l'extension, en deux lignes** : tu écris le code, les tests de l'étape
  tournent à chaque sauvegarde, le parcours avance quand ils passent — et le parcours est
  un fichier JSON produit en amont, l'extension n'appelle aucun modèle ;
- un bouton **« Générer le prompt »**, qui ouvre le formulaire décrit juste en dessous.
  C'est l'étape qui précède l'import, et il n'y avait aucun moyen de la trouver depuis
  l'éditeur ;
- un bouton **« Importer un parcours »**, qui ouvre exactement le même dialogue que la
  commande de la palette.

On y revient : supprimer le parcours ramène la vue à l'accueil, elle ne reste pas sur une
étape qui n'existe plus.

### Ouverture automatique

Quand `.learn/` contient un parcours, la vue s'ouvre **toute seule à l'activation** —
et **sans prendre le focus**, comme partout ailleurs dans ce document. L'activation arrive
pendant que l'utilisateur ouvre son projet et commence à taper : lui prendre le curseur
serait exactement le geste à ne pas faire.

### Quand un parcours est actif

Le titre de la vue porte les deux actions qu'on veut à portée de main sans quitter le
panneau :

- **Relancer les tests de l'étape**, en icône, directement visible ;
- **Réinitialiser le parcours**, dans le menu `…`, moins à portée de clic parce qu'il
  ouvre un dialogue destructeur.

Sans parcours actif, ces deux actions disparaissent du titre : proposer « Relancer les
tests » quand il n'y a pas d'étape ne veut rien dire. **Générer le prompt**, lui, reste
dans le menu `…` dans les deux cas — c'est le seul geste du titre qui ne dépend d'aucune
étape.

## Composer le prompt de génération

Le prompt à donner à l'agent de code est **composé par l'extension**, à partir du gabarit
qu'elle embarque (`prompts/generer-parcours.md`). Il n'y a plus rien à recopier depuis une
documentation : le prompt a existé en deux exemplaires divergents, et un parcours a fini par
être généré avec une version périmée (D37).

Le geste est **récurrent, pas un geste d'onboarding** : on génère un parcours par
fonctionnalité. Il reste donc accessible quand un parcours est déjà en cours — bouton sur
l'accueil, commande dans la palette, et entrée dans le menu `…` du titre de la vue, la
seule des quatre qui n'est pas conditionnée à `learnpath.active`.

**Un formulaire court**, dans un onglet d'éditeur à part et non dans la vue du parcours :
la vue est repeinte à chaque run de tests, ce qui effacerait la saisie en cours.

- **la fonctionnalité à implémenter** — zone de texte, seul champ obligatoire ;
- **le niveau** : débutant ou intermédiaire ;
- **les fichiers ou dossiers concernés** — facultatif, pour orienter le générateur.

**Puis le prompt complet est affiché, en entier, modifiable, avec un bouton « Copier ».**
Ce point n'est pas négociable. Un formulaire qui masque ce qu'on envoie retire toute prise
à l'utilisateur le jour où le résultat le déçoit — précisément le moment où il en a besoin.
Ce qui est copié est le contenu de la zone, ses retouches comprises, et la copie passe par
`vscode.env.clipboard` comme le bouton « Copier » de la solution.

Si le dossier ouvert ne ressemble ni à un projet JavaScript (`package.json`) ni à un projet
Python (`pyproject.toml`, `requirements.txt`, `setup.py`, `.venv`, `venv`), un bandeau le
signale — LearnPath ne joue que des parcours Vitest ou pytest — **sans rien bloquer** : le
formulaire fonctionne, le prompt se compose. Un dossier peut très bien devenir un projet à
l'étape suivante, et ce n'est pas à ce formulaire d'en décider.

## Panneau du parcours

```
┌────────────────────────────────────┐
│ Panier d'achat        Étape 2 / 5  │
│ ▓▓▓▓ ▒▒▒▒ ░░░░ ░░░░ ░░░░           │
├────────────────────────────────────┤
│ Ajouter un article                 │
│                                    │
│ <explanation en markdown>          │
│                                    │
│ ── Attendu ──────────────────────  │
│ src/panier.js                      │
│ addItem(panier, item, qty = 1)     │
│ • Ajoute une ligne si absent       │
│ • Incrémente qty si déjà présent   │
│ • Ne mute pas l'entrée             │
│                                    │
│ [ Indice ]          [ Solution ]   │
├────────────────────────────────────┤
│ <zone d'état du dernier run>       │
└────────────────────────────────────┘
```

La barre a **un segment par étape**, pas une jauge continue : plein pour une étape
acquise, contour pour l'étape en cours, vide ensuite. Une jauge en pourcentage affichait
« Étape 5 / 5 » avec une barre aux quatre cinquièmes — juste, mais illisible une seconde.
Segmentée, la barre et le compteur comptent la même chose.

## Un run en cours

Entre la sauvegarde et le résultat il y a le debounce, puis une seconde de Vitest ou de
pytest. Pendant
ce temps, ce qui est affiché date de la tentative précédente — et c'est souvent le rouge
qu'on vient justement de corriger.

- dès la fin du debounce, une ligne discrète « Tests en cours… » apparaît au-dessus de la
  zone d'état ;
- le bandeau de la tentative précédente est **grisé** tant que le run tourne. Il reste
  lisible, mais il ne se lit plus comme à jour.

Un run annulé par une nouvelle sauvegarde ne réaffiche rien : l'indicateur reste allumé,
puisqu'un run est bien encore en cours.

## Les trois états rouges

C'est le point qui décide si le produit est agréable ou insupportable.

`classify(raw, step)` (D15) retourne `{ state, message?, failures }` : `state` décide de
l'affichage, `message` est le détail à montrer quand il y en a un, `failures` porte les
assertions en échec de l'étape. Le tableau décrit exactement ce que le code retourne.

| Situation | Ce que retourne `classify` | Zone d'état |
|---|---|---|
| Fichier pas encore créé | `state: 'missing-file'`, `message` absent, `failures` vide — un import non résolu dont la cible est dans `expected.files`. Trois formulations pour cette seule cause, toutes reconnues (D33) : `Cannot find module`, `Cannot find package` (alias du projet), `Failed to resolve import` (Vite 8) | rien du tout. C'est l'état normal en début d'étape, afficher une erreur ici est décourageant et faux |
| Code en cours d'écriture | `state: 'collect-error'`, `message` toujours présent, `failures` vide — aucun test de l'étape n'a été collecté et l'erreur n'est pas un fichier attendu manquant | ligne grise discrète : « le fichier n'est pas encore valide », suivie du `message`. Jamais de rouge |
| Assertion en échec | `state: 'assertion-failed'`, `failures` non vide, `message` = premier `failureMessages` | rouge, `fullName` du test échoué, attendu / reçu tiré de `failures`, et déblocage de l'indice suivant |
| Étape réussie | `state: 'pass'`, `message` absent, `failures` vide | vert, puis progression |

### Traduction des messages

Les formes d'erreur Vitest et pytest fréquentes sont traduites en français
(`src/core/humanize.ts`, D22, D39). Un `assert a == b` de pytest n'est **pas** découpé en
« obtenu / attendu » : rien n'y dit lequel des deux est l'attendu. La traduction passe devant, **le message brut reste toujours accessible** juste en
dessous, replié. Une forme non reconnue n'est ni masquée ni reformulée : elle s'affiche
seule, telle quelle. On ne devine jamais l'intention.

Règle de rendu : **`message` présent ⇒ on le montre**. Il porte aussi les erreurs qui ne
sont pas de notre fait — un `Cannot find module 'lodash'` (ou `No module named 'requests'`)
hors `expected.files` sort en `collect-error` avec son message, il n'est jamais avalé en
« fichier pas encore créé ».

En Python, une étape pas commencée ne dit pas toujours « fichier absent » : dès l'étape 2,
le module existe et c'est `cannot import name '<fonction>' from '<module>'` qui sort, à la
collecte. Tant que le module est un fichier attendu de l'étape, c'est affiché comme un début
d'étape — rien — et pas comme « le fichier n'est pas encore valide » (D39).

L'état s'appelait `parse-error` jusqu'à D33. Le nom affirmait une cause — le fichier ne
*parse* pas — que rien ne permet de connaître : la collecte échoue aussi bien sur la config
Vite, sur un plugin ou sur le runner. Il ne dit plus que ce qu'on sait, « aucun test de
cette étape n'a été collecté ». L'affichage, lui, n'a pas changé.

## Progression

- Passage à l'étape suivante : automatique, sans clic, avec une transition visible pour que
  l'utilisateur comprenne ce qui vient de se passer. Un flash vert bref suffit.
- Jamais de modale bloquante sur un succès.
- Retour en arrière possible pour relire une étape passée, en lecture seule.

### Relire une étape passée, et refaire une étape

Ce sont **deux choses différentes**, et l'une est destructive : refaire une étape ne doit
jamais pouvoir être déclenché en croyant relire (D36).

**Relire** — « Relire une étape passée », un lien discret sous les actions de l'étape
courante, jamais dans la même rangée que « Indice » et « Solution » : relire ne fait rien,
ça ne se clique pas par réflexe. L'écran de relecture s'annonce **avant l'énoncé** (« Lecture
seule — étape 1.2, déjà validée »), ne propose ni indice ni solution, et n'affiche pas la
zone d'état du dernier run — elle décrit l'étape courante, la lire à côté d'une étape passée
la ferait prendre pour le résultat de celle-là. La barre de progression, elle, continue de
montrer où en est le parcours, pas où en est la lecture. On navigue entre les étapes déjà
validées, et on revient à l'étape en cours.

**Refaire** — dans son propre encadré, en bas de l'écran de relecture, à l'écart de la
navigation. Il nomme les fichiers concernés avant même le clic, son libellé se termine par
des points de suspension (« Refaire l'étape 1.2… ») parce qu'un clic ouvre une boîte et ne
restaure rien, et son style est celui d'une action destructive, pas d'un bouton ordinaire.
La confirmation modale liste chaque fichier réécrit, chaque fichier supprimé, les
modifications non sauvegardées qui vont être sauvegardées puis remplacées, et dit où est le
point de restauration.

Quand la fonctionnalité est indisponible — pas de dépôt git, arbre sale à l'import, option
coupée — l'encadré affiche la raison **à la place du bouton**. Il n'y a rien à cliquer qui
échouerait.

### Régression sur une étape précédente

L'étape courante passe, mais une étape déjà validée ne passe plus : la progression est
**en pause**, on n'avance pas (D16). Trois choses distinctes à l'écran, et surtout pas un
échec de l'étape courante :

- l'étape courante est marquée validée, visuellement verte, elle est acquise ;
- un bandeau séparé nomme l'étape qui ne passe plus, le test échoué et son fichier ;
- la progression est présentée comme en attente, pas comme un refus.

Formulation : « Étape 1.3 validée. En attente : l'étape 1.2 ne passe plus depuis ta
dernière modification. » Ça dit ce qui est acquis, ce qui bloque, et où regarder.

## Indices

Révélés un par un, du plus vague au plus précis. Un indice révélé le reste. Le nombre
d'indices utilisés est enregistré dans le state : c'est la donnée la plus intéressante à
montrer à l'utilisateur en fin de parcours.

## Solution

- Demande une confirmation, sans culpabiliser. Un texte neutre, pas « es-tu sûr de vouloir
  abandonner ». Elle dit ce qui va s'afficher et que rien ne sera écrit.
- **La solution s'affiche dans le panneau, elle n'est jamais écrite dans les fichiers de
  l'utilisateur** (D34). Un bloc par fichier quand l'étape en touche plusieurs : chemin en
  en-tête, code coloré en dessous, un bouton « Copier » par fichier.
- C'est l'utilisateur qui recopie. Recopier fait passer le code par les yeux et les doigts ;
  un fichier rempli tout seul ne le fait pas. Et surtout : écrire le fichier faisait perdre
  du travail en silence — VSCode ne recharge pas un buffer modifié, l'utilisateur ne voyait
  pas la solution et sa sauvegarde suivante écrasait ce qu'on venait d'écrire.
- Marque l'étape comme révélée, et laisse les tests passer normalement quand l'utilisateur
  sauvegarde son propre fichier.
- Une étape dont la solution a été révélée reste marquée comme telle dans le récapitulatif
  de fin. Pas de pénalité, juste une information honnête.

## Fin de parcours

L'écran de fin est un écran à part entière, pas une étape avec une section ajoutée :
l'énoncé, le bloc « Attendu » et les boutons de la dernière étape **disparaissent**. Il ne
reste que le récapitulatif — étapes réussies seules, étapes avec indices, étapes révélées —
et le compteur devient « Parcours terminé — N étapes », tous les segments pleins.

Puis la proposition la plus importante : déplacer `.learn/tests/` vers le dossier de tests
du projet.

## Réinitialiser

Un seul dialogue, deux choix : « Recommencer depuis l'étape 1 » (la progression repart à
zéro, les tests restent) et « Supprimer le parcours (garder le JSON généré) » (progression,
tests, config et caches disparaissent ; `.learn/parcours/*.json` reste). Le texte du
dialogue dit explicitement que **le code écrit par l'utilisateur n'est jamais touché** et
que le JSON peut être réimporté sans nouvelle génération. C'est la peur qu'on a le doigt
sur le bouton : elle se lève là (D23, D38).
