# Vérification manuelle avant publication

Ce que seul un humain devant un écran peut confirmer. Aucune session d'agent n'a d'accès à
l'Extension Development Host ni à VSCodium : **tout ce qui suit est non vérifié** tant que
quelqu'un n'a pas coché les cases.

Une ligne = un point à regarder, avec le résultat attendu. Coche, ou note ce que tu as vu.

## Comment se mettre en position

1. `npm install`, puis `F5` dans le dépôt : ça ouvre l'Extension Development Host.
2. Dans la fenêtre qui s'ouvre, ouvre un dossier vide contenant un `package.json`
   (`{ "name": "essai", "private": true, "type": "module" }`).
3. Clique l'**icône LearnPath dans la barre d'activité**, puis **« Importer un parcours »**
   dans l'état d'accueil, et choisis `examples/exemple-panier.json`. (La commande
   **LearnPath : Importer un parcours…** de la palette fait la même chose.)
4. Pour VSCodium : `npx vsce package`, puis dans VSCodium **Extensions → … → Installer à
   partir d'un VSIX**, et reprends au point 2.

Pour provoquer les états à la demande : supprimer le fichier de l'étape (fichier absent),
y écrire `function (` (code invalide), écrire une implémentation fausse mais valide
(assertion en échec).

---

## Import

| # | À vérifier | Attendu |
|---|---|---|
| 1 | Le dialogue de confirmation du setup | Affiche la commande **exacte** (`npm i -D vitest`), et rien ne s'installe si on refuse |
| 2 | Refuser le setup | Le projet est rendu tel qu'il était : pas de `.learn/`, `.gitignore` inchangé |
| 3 | La barre de progression pendant l'import | Visible, et le texte change à chaque étape vérifiée (« étape 1.3 (3/5) ») |
| 4 | Import d'un parcours fautif (`src/core/__fixtures__/solution-regressive.json`) | Message d'erreur nommant l'étape, et **rien** n'est laissé dans le projet |
| 5 | Le panneau après un import réussi | S'ouvre sur l'étape 1.1, sans que le curseur quitte l'éditeur |

## Les trois états rouges

| # | À vérifier | Attendu |
|---|---|---|
| 6 | Fichier de l'étape absent | **Rien** dans la zone d'état. Pas de rouge, pas de message d'erreur |
| 7 | Fichier présent mais code invalide | Ligne **grise** discrète « le fichier n'est pas encore valide » + le message brut. Jamais de rouge |
| 8 | Assertion en échec | Bandeau **rouge**, nom complet du test, attendu / reçu lisibles |
| 9 | Message traduit (ex. `is not a function`) | La traduction française passe en premier, le message brut est replié juste en dessous et se déplie |
| 10 | Erreur non reconnue | S'affiche seule, telle quelle, sans reformulation inventée |

## Run en cours

| # | À vérifier | Attendu |
|---|---|---|
| 11 | Sauvegarder le fichier de l'étape | Après ~0,5 s, la ligne « Tests en cours… » apparaît au-dessus de la zone d'état |
| 12 | Le bandeau de la tentative précédente pendant le run | **Grisé**, encore lisible, mais visiblement pas à jour |
| 13 | Sauvegarder deux fois de suite rapidement | L'indicateur reste allumé sans clignoter, un seul résultat s'affiche à la fin |
| 14 | Sauvegarder un fichier **hors** de l'étape | Rien ne se lance |

## Progression

| # | À vérifier | Attendu |
|---|---|---|
| 15 | Barre segmentée | Un segment par étape : plein = acquise, contour = en cours, vide = à venir. Jamais une jauge continue |
| 16 | Compteur et barre | « Étape 2 / 5 » et deux segments touchés : les deux comptent la même chose |
| 17 | Passage au vert | Flash vert bref, puis étape suivante. **Aucune modale** |
| 18 | Casser une étape déjà validée | L'étape courante reste verte, un bandeau **séparé** nomme l'étape qui ne passe plus, la progression est présentée comme en attente et non comme un échec |

## Indices et solution

| # | À vérifier | Attendu |
|---|---|---|
| 19 | Bouton « Indice » | Révèle un indice à la fois, du plus vague au plus précis ; un indice révélé le reste après rechargement du panneau |
| 20 | Dialogue « Solution » | Texte neutre, sans culpabilisation ; il ne parle pas d'écriture de fichier ; annuler n'affiche rien |
| 21 | Confirmer « Solution » | La solution s'affiche **dans le panneau** (un bloc par fichier, chemin en en-tête, code coloré) ; l'étape est marquée révélée |
| 21b | Confirmer « Solution » avec une tentative non sauvegardée dans l'éditeur | Le buffer ouvert n'est **pas** modifié, aucun fichier du projet n'est touché (D34) |
| 21c | Bouton « Copier » d'un bloc de solution | Le contenu du fichier est dans le presse-papiers, et lui seul |

## Écran de fin

| # | À vérifier | Attendu |
|---|---|---|
| 22 | Après la dernière étape | L'énoncé, le bloc « Attendu » et les boutons **disparaissent** |
| 23 | Le récapitulatif | Étapes réussies seules / avec indices / révélées, distinguées |
| 24 | Le compteur | « Parcours terminé — 5 étapes », tous les segments pleins |
| 25 | La proposition de déplacer `.learn/tests/` | Présente et compréhensible |

## Réinitialiser

| # | À vérifier | Attendu |
|---|---|---|
| 26 | **LearnPath : Réinitialiser le parcours** | **Un seul** dialogue, deux choix, et un texte qui dit explicitement que le code écrit n'est jamais touché |
| 27 | « Recommencer depuis l'étape 1 » | Progression remise à zéro, `.learn/tests/` toujours là, code de l'utilisateur intact |
| 28 | « Supprimer le parcours (garder le JSON généré) » | Progression, tests, config et caches supprimés ; seul `.learn/parcours/*.json` reste, inchangé et réimportable ; code de l'utilisateur intact |
| 29 | Réinitialiser avec un `state.json` volontairement corrompu | Fonctionne quand même (le parcours est relu directement) |
| 29b | Série (D44) : trois JSON dans `.learn/parcours/`, aucun importé ; importer le **deuxième** par ordre alphabétique | Import accepté ; le panneau affiche bien ce parcours-là, y compris après rechargement de la fenêtre ; les deux autres fichiers sont inchangés |
| 29c | Parcours en cours, importer un autre JSON de la série | Refusé : le message nomme le parcours en cours et dit « Réinitialiser le parcours » puis « Supprimer le parcours (garder le JSON généré) » ; rien n'est modifié |
| 29d | Après « Supprimer le parcours », importer le suivant de la série | Accepté sans rien déplacer ; les JSON des autres parcours sont toujours là |

## Focus et accessibilité

| # | À vérifier | Attendu |
|---|---|---|
| 30 | Ouverture du panneau pendant qu'on tape | Le curseur **reste** dans l'éditeur, la frappe n'est pas interrompue |
| 31 | Passage d'étape pendant qu'on tape | Idem : aucun vol de focus, aucune modale |
| 32 | Lecteur d'écran (NVDA, VoiceOver ou Orca) | Le changement d'état est **annoncé** via la région `aria-live` : « Tests en cours », le résultat, le passage d'étape |
| 33 | Navigation au clavier seul | Les boutons Indice et Solution sont atteignables par Tab, avec un contour de focus visible |
| 34 | Réglage système « réduire les animations » | Le flash vert ne s'anime plus (`prefers-reduced-motion`) |

## Thèmes

Rejouer les points 6, 8, 15 et 22 dans chaque thème — c'est là que les couleurs codées en
dur se voient.

| # | À vérifier | Attendu |
|---|---|---|
| 35 | Thème clair (Light+ / Light Modern) | Texte lisible, rouge et vert distinguables, bandeau grisé encore lisible |
| 36 | Thème sombre (Dark+ / Dark Modern) | Idem |
| 37 | Thème à contraste élevé (High Contrast Dark **et** Light) | Toutes les bordures visibles, aucun texte gris sur gris, segments de la barre distinguables sans la couleur |
| 38 | Un thème communautaire quelconque | Rien ne devient illisible : le panneau n'utilise que des variables `--vscode-*` |

## VSCodium — le parcours panier de bout en bout

Le point qui compte le plus : la promesse du projet est « ça tourne à l'identique sur
VSCodium ».

| # | À vérifier | Attendu |
|---|---|---|
| 39 | Installation du VSIX dans VSCodium | S'installe et s'active sans erreur dans la console |
| 40 | Import de `examples/exemple-panier.json` | Réussit, même durée qu'en VS Code (~10 s) |
| 41 | Les cinq étapes jouées **en écrivant le code soi-même** | Chaque étape passe au vert et enchaîne toute seule |
| 42 | L'écran de fin | Identique à VS Code |
| 43 | Console de développement (Aide → Bascule Outils de développement) | Aucune erreur, aucun avertissement de CSP |
| 44 | Après désinstallation de l'extension | Le projet reste utilisable : `.learn/tests/` tourne toujours avec Vitest |

## Barre d'activité et état d'accueil

| # | À vérifier | Attendu |
|---|---|---|
| 45 | L'icône LearnPath dans la barre d'activité | Présente, lisible en thème clair, sombre et contrasté, infobulle « LearnPath » |
| 46 | Clic sur l'icône dans un projet **sans** `.learn/` | La vue s'ouvre sur l'état d'accueil : ce que fait l'extension en deux lignes, le bouton « Générer le prompt » et le bouton « Importer un parcours » |
| 47 | Le bouton « Importer un parcours » de l'accueil | Ouvre exactement le même dialogue de fichier que la commande de la palette |
| 48 | Le bouton « Générer le prompt » de l'accueil | Ouvre l'onglet du formulaire. **Aucune** erreur de CSP dans la console de développement |
| 49 | Ouvrir un projet qui contient déjà un parcours, en tapant dans l'éditeur | La vue s'ouvre toute seule dans la barre d'activité et le curseur **reste** dans l'éditeur |
| 50 | Titre de la vue, parcours actif | Deux actions : l'icône « Relancer les tests de l'étape », et « Réinitialiser le parcours » dans le menu `…` |
| 51 | Les deux mêmes actions, projet sans parcours | **Absentes** du titre de la vue (elles restent dans la palette). « Générer le prompt du parcours… », lui, reste dans le menu `…` dans les deux cas |
| 52 | « Supprimer le parcours » depuis la vue | La vue revient à l'état d'accueil, elle ne reste pas sur l'étape supprimée |
| 53 | Les cinq commandes de la palette | Toujours là et toujours fonctionnelles : la palette n'est plus le seul chemin, elle n'a pas disparu |
| 54 | Masquer puis réafficher la vue (autre icône, puis retour) | Le contenu et le scroll sont retrouvés, l'étape affichée est la bonne |

## Composer le prompt de génération (D37)

| # | À vérifier | Attendu |
|---|---|---|
| 74 | « Générer le prompt » depuis l'accueil, et la commande de la palette | Le même onglet « LearnPath — prompt de génération ». Un second clic **révèle l'onglet déjà ouvert**, il n'en crée pas un deuxième |
| 75 | La commande **avec un parcours en cours** | Disponible dans la palette et dans le menu `…` du titre, et elle ouvre le formulaire. La vue du parcours n'a pas bougé |
| 76 | Envoyer le formulaire avec la fonctionnalité vide | Le navigateur refuse l'envoi et pointe le champ. Rien n'est composé |
| 77 | Remplir la fonctionnalité seule, envoyer | Le prompt s'affiche **en entier** en dessous. Il contient « La fonctionnalité que je veux coder : … », « Mon niveau en programmation : intermédiaire » et « Mon niveau dans ce langage ou ce framework : je découvre la syntaxe », et **aucune** ligne « Fichiers ou dossiers concernés » ni « Ce que je connais déjà » |
| 78 | Remplir aussi « Ce que tu connais déjà » et « Fichiers ou dossiers concernés » | Les deux lignes apparaissent, juste avant la fonctionnalité |
| 79 | Le prompt affiché | **Modifiable** : on peut y taper. Aucun `{{…}}` ne subsiste nulle part dans le texte |
| 80 | Modifier le texte, puis « Copier » | La barre d'état dit « prompt copié », et un collage ailleurs rend **le texte modifié**, pas le texte d'origine |
| 81 | Comparer le prompt copié à `prompts/generer-parcours.md` | Identique, aux cinq champs près. C'est tout l'objet de D37 |
| 82 | Le formulaire dans un dossier **sans** `package.json` | Un bandeau le signale, et le formulaire **fonctionne quand même** : on compose et on copie |
| 83 | Le formulaire en thème clair, sombre et contrasté | Champs, bouton et bandeaux lisibles ; le focus clavier se voit sur chaque champ et chaque bouton |
| 84 | Passer à un autre onglet puis revenir | La saisie et le prompt composé sont toujours là |

## Relire une étape passée, et refaire une étape (D36)

À dérouler dans un projet **dépôt git, arbre propre au moment de l'import**, après avoir
validé au moins deux étapes.

| # | À vérifier | Attendu |
|---|---|---|
| 55 | Après chaque étape validée : `git status` et `git log` | **Strictement identiques** à avant. Aucun commit sur la branche, rien de nouveau dans l'index |
| 56 | `git for-each-ref refs/learnpath` | Une référence par étape validée, plus `…/base`. `git tag --list` est inchangé |
| 57 | Laisser des modifications non commitées dans un fichier **hors** du parcours, puis valider une étape | Le fichier n'est ni commité, ni modifié. `git status` le montre toujours modifié |
| 58 | Le lien « Relire une étape passée » | Discret, sous les actions de l'étape, séparé d'« Indice » et « Solution » |
| 59 | L'écran de relecture | Annonce la lecture seule **avant** l'énoncé. Ni « Indice », ni « Solution », ni zone d'état du dernier run |
| 60 | La barre de progression en relecture | Montre toujours la progression réelle du parcours, pas l'étape relue. Le compteur dit « Relecture — étape n / N » |
| 61 | La navigation en relecture | On ne va que d'une étape validée à une autre ; « Revenir à l'étape en cours » ramène à l'étape courante, sans rien modifier |
| 62 | Le bouton « Refaire l'étape n… » | Dans son propre encadré, style d'action destructive, et il **nomme les fichiers** avant le clic |
| 63 | Clic sur « Refaire l'étape n… » | Une modale s'ouvre. **Rien n'a encore été écrit** — vérifier le fichier sur le disque |
| 64 | Le texte de la modale | Liste chaque fichier, distingue « remplacé » de « supprimé », annonce le point de restauration et le retour du parcours à cette étape |
| 65 | Annuler la modale | Aucun fichier touché, la progression n'a pas bougé |
| 66 | Confirmer, **avec le fichier ouvert et modifié non sauvegardé** | Le contenu d'avant l'étape s'affiche dans l'éditeur (le buffer se recharge). C'est le point qui casse si la sauvegarde préalable saute |
| 67 | Après la restauration : le reste du projet | Aucun autre fichier modifié. `git status` ne montre que le fichier de l'étape |
| 68 | Après la restauration : le panneau | Revient à l'étape refaite, sans zone d'état périmée. Sauvegarder relance bien les tests de cette étape |
| 69 | `git for-each-ref refs/learnpath-backup` | Une référence contenant la tentative remplacée. `git show <ref>:<fichier>` la rend |
| 70 | Refaire une étape, la revalider, alors qu'on était plus loin | La progression réenchaîne les étapes suivantes (leur code est toujours écrit) et revient là où on était |
| 71 | Projet **sans** git | La relecture marche, et l'encadré affiche l'explication à la place du bouton |
| 72 | Projet git avec un arbre **sale au moment de l'import** | Idem : indisponible avec l'explication, et la vue Sortie porte la raison dès l'import |
| 73 | `learnpath.gitCheckpoints` à `false` | Aucun commit n'est créé, et l'encadré nomme l'option. Repasser l'option à `true` sur un parcours importé sans base : toujours indisponible, avec l'invitation à réimporter |

## Parcours Python (pytest, D39)

Dossier vide (sans `package.json`), avec Python 3 installé. Importer
`examples/exemple-panier-python.json` (ou ouvrir `examples/demo-project-python`).

| # | Point | Attendu |
|---|---|---|
| 85 | Le dialogue de setup | Montre exactement `python -m venv .venv` puis `pip install pytest` |
| 86 | Après confirmation, la vue Sortie | Montre la création du venv puis l'installation de pytest **dans `.venv`** (le chemin `.venv/bin/python -m pip` ou `.venv\Scripts\python.exe`), pas dans le Python du système |
| 87 | Réimporter après « Supprimer le parcours » | La vue Sortie dit « L'environnement .venv existe déjà » et ne recrée pas le venv |
| 88 | L'étape 1 avant d'écrire `panier.py` | Aucune erreur affichée : état normal de début d'étape |
| 89 | Écrire `def creer_panier(:` et sauvegarder | Indicateur discret « pas encore valide », traduction « n'est pas du Python valide (SyntaxError…) » |
| 90 | Écrire une version fausse (`"lignes": [1]`) | Test en échec nommé `step 1.1 › test_lignes_vides_et_aucune_promo`, message `assert [1] == []` visible |
| 91 | Coller la solution de 1.1 et sauvegarder | Passage automatique à 1.2 |
| 92 | L'étape 1.2 **avant** d'écrire `ajouter_article` | Aucune erreur affichée (c'est `cannot import name` sous le capot), pas de bandeau de régression |
| 93 | Casser `creer_panier` pendant l'étape 1.2 | Bandeau de régression sur l'étape 1.1, séparé de l'état de 1.2 |
| 94 | Après une dizaine de runs : l'arborescence du projet | Aucun `__pycache__` ni `.pytest_cache`, ni à la racine ni dans `.learn/` |
| 95 | Un `pytest.ini` du projet avec `addopts = -x --inexistant` et un `conftest.py` qui lève | L'import et les runs marchent comme si ces fichiers n'existaient pas ; ils ne sont pas modifiés |
| 96 | Windows : projet sans `.venv`, seul l'alias Microsoft Store de `python.exe` présent | Message « Aucun interpréteur Python n'a été trouvé », pas d'ouverture du Store ni de blocage |

## Pédagogie : exemples, squelette, diff, périmètre (D40 à D43)

Importer `examples/exemple-panier.json` dans `examples/demo-project`.

| # | Point | Attendu |
|---|---|---|
| 97 | L'étape 1.1 | « À propos de ce parcours » est **ouvert**, avec « Ce que le parcours couvre » et « Ce qu'il ne couvre pas ». À l'étape 1.2 il est **replié** |
| 98 | Le bloc « Exemple de syntaxe » | Juste après l'explication, code coloré, notes en puces lisibles ; en thème clair, sombre et contrasté |
| 99 | « Ce que vérifie le test » dans « Attendu » | Replié par défaut ; déplié, le contenu de `.learn/tests/step-1.x.spec.js`, coloré |
| 100 | Les boutons à l'étape 1.2 | Dans l'ordre « Indice », « Squelette », « Solution » ; ils passent à la ligne proprement dans une barre latérale étroite |
| 101 | Cliquer « Squelette » | **Aucune** boîte de dialogue ; le bloc « Squelette » s'affiche, le bouton devient « Squelette affiché » grisé ; aucun fichier du projet ne change |
| 102 | « Copier » du squelette | Le presse-papiers contient le fichier complet avec ses `TODO` |
| 103 | Afficher la solution de 1.2 | « Ce que l'étape change dans le fichier » : les lignes d'`addItem` surlignées, `⋯` pour le contexte lointain, « Fichier complet » replié ; « Copier » copie le fichier **complet** |
| 104 | Afficher aussi la solution de 1.3 | Le bandeau « Deux solutions affichées de suite » apparaît sous la solution, sans modale |
| 105 | Finir le parcours | Le récapitulatif dit « squelette affiché » pour une étape aidée ainsi, et « Reste à faire, hors de ce parcours » liste `scope.notCovered` |
| 106 | Importer un parcours **sans** `scope` ni `examples` | Refusé **avant** toute écriture ni confirmation de setup ; la vue Sortie liste tous les problèmes, étape par étape |
| 107 | Importer un parcours dont une étape ajoute 30 lignes | Refusé en nommant l'étape et « 30 lignes à écrire, le maximum est 20 » |
| 108 | Un parcours déjà importé avant la mise à jour (sans `examples` ni `scope`) | Il se rouvre et se joue normalement : pas d'exemple, pas d'« À propos » avec périmètre, aucune erreur |
| 109 | Le formulaire du prompt | Deux listes de niveau (« je découvre la syntaxe » présélectionné) et le champ « Ce que tu connais déjà » ; la ligne d'aide sous le niveau de langage est lisible |
| 110 | Parcours Python : `examples/exemple-panier-python.json` | Exemples colorés en Python (`def`, commentaires `#`), squelette et diff comme en JS |
| 111 | Importer un parcours dont une étape modifie 3 lignes d'un gros fichier **déjà présent** dans le projet | Import accepté ; `.learn/baseline/<slug>.json` contient ce fichier tel qu'avant l'import |
| 112 | À cette étape, « Solution » puis « Squelette » | Diff contre le fichier d'origine (3 lignes surlignées), pas le fichier entier ; idem après rechargement de la fenêtre |

---

## Quand c'est fini

Reporte le résultat dans `docs/HANDOFF.md`, section « Ce qui n'a pas pu être vérifié » :
ce qui est confirmé sort de la liste, ce qui a échoué devient une ligne dans « Ce qui
bloque ». Sans ça, la publication reste en attente.
