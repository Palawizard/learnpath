# Comportement de l'interface

## Panneau du parcours

```
┌────────────────────────────────────┐
│ Panier d'achat        Étape 2 / 5  │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░  │
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

## Les trois états rouges

C'est le point qui décide si le produit est agréable ou insupportable.

| Situation | Détection | Zone d'état |
|---|---|---|
| Fichier pas encore créé | erreur de résolution de module sur un chemin de `expected.files` | rien du tout. C'est l'état normal en début d'étape, afficher une erreur ici est décourageant et faux |
| Code en cours d'écriture | erreur de collecte / syntaxe | ligne grise discrète : « le fichier n'est pas encore valide ». Jamais de rouge |
| Assertion en échec | le test a tourné et échoué | rouge, nom du test échoué, attendu / reçu, et déblocage de l'indice suivant |

## Progression

- Passage à l'étape suivante : automatique, sans clic, avec une transition visible pour que
  l'utilisateur comprenne ce qui vient de se passer. Un flash vert bref suffit.
- Jamais de modale bloquante sur un succès.
- Retour en arrière possible pour relire une étape passée, en lecture seule.

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

Récapitulatif : étapes réussies seules, étapes avec indices, étapes révélées. Puis la
proposition la plus importante : déplacer `.learn/tests/` vers le dossier de tests du projet.
