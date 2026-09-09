# Comportement de l'interface

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

Entre la sauvegarde et le résultat il y a le debounce, puis une seconde de Vitest. Pendant
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
| Fichier pas encore créé | `state: 'missing-file'`, `message` absent, `failures` vide — un `Cannot find module` dont le chemin résolu est dans `expected.files` | rien du tout. C'est l'état normal en début d'étape, afficher une erreur ici est décourageant et faux |
| Code en cours d'écriture | `state: 'parse-error'`, `message` toujours présent, `failures` vide — aucun test de l'étape n'a tourné et l'erreur n'est pas un fichier attendu manquant | ligne grise discrète : « le fichier n'est pas encore valide », suivie du `message`. Jamais de rouge |
| Assertion en échec | `state: 'assertion-failed'`, `failures` non vide, `message` = premier `failureMessages` | rouge, `fullName` du test échoué, attendu / reçu tiré de `failures`, et déblocage de l'indice suivant |
| Étape réussie | `state: 'pass'`, `message` absent, `failures` vide | vert, puis progression |

### Traduction des messages

Les formes d'erreur Vitest fréquentes sont traduites en français (`src/core/humanize.ts`,
D22). La traduction passe devant, **le message brut reste toujours accessible** juste en
dessous, replié. Une forme non reconnue n'est ni masquée ni reformulée : elle s'affiche
seule, telle quelle. On ne devine jamais l'intention.

Règle de rendu : **`message` présent ⇒ on le montre**. Il porte aussi les erreurs qui ne
sont pas de notre fait — un `Cannot find module 'lodash'` hors `expected.files` sort en
`parse-error` avec son message, il n'est jamais avalé en « fichier pas encore créé ».

## Progression

- Passage à l'étape suivante : automatique, sans clic, avec une transition visible pour que
  l'utilisateur comprenne ce qui vient de se passer. Un flash vert bref suffit.
- Jamais de modale bloquante sur un succès.
- Retour en arrière possible pour relire une étape passée, en lecture seule.

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
  abandonner ».
- Écrit le fichier, marque l'étape comme révélée, laisse les tests passer normalement.
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
zéro, les tests restent) et « Supprimer le parcours » (tout `.learn/` disparaît). Le texte
du dialogue dit explicitement que **le code écrit par l'utilisateur n'est jamais touché**.
C'est la peur qu'on a le doigt sur le bouton : elle se lève là (D23).
