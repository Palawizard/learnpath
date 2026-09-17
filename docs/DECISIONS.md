# Décisions techniques

Une entrée par décision structurante. Format : contexte, décision, conséquences.
Ne pas supprimer une entrée devenue fausse : ajouter une nouvelle entrée qui la remplace
et marquer l'ancienne comme *remplacée*.

---

## D1 — L'extension n'appelle aucun modèle d'IA

**Contexte.** L'idée initiale prévoyait de générer le parcours depuis l'extension, en
passant par le quota d'un abonnement plutôt que par une API payante. Les voies possibles
étaient : `vscode.lm` (nécessite Copilot), un proxy vers Copilot, ou une clé API.

**Décision.** La génération sort du périmètre de l'extension. Un agent externe (Claude Code,
Codex) produit un fichier JSON que l'utilisateur importe.

**Conséquences.**
- Aucune dépendance à Copilot, donc l'extension fonctionne sur VSCodium sans bricolage
- Aucun coût, aucun rate limit, aucune clé à gérer
- Pas de risque de bannissement lié à un usage détourné de quota
- L'utilisateur garde le choix de son modèle
- En contrepartie : friction d'onboarding, il faut fournir un très bon prompt de génération

---

## D2 — Validation par tests exécutés, pas par comparaison de code

**Contexte.** Détecter « le code est bon » pouvait se faire par comparaison textuelle,
analyse AST, ou jugement par un LLM.

**Décision.** Tests exécutés par le runner du projet.

**Conséquences.**
- Déterministe, rapide, explicable : l'utilisateur voit *pourquoi* c'est faux
- Accepte n'importe quelle implémentation correcte
- Impose que le générateur produise des tests corrects, d'où la vérification à l'import
- Impose un runner configuré, donc une étape de setup

---

## D3 — Config Vitest isolée dans `.learn/`

**Contexte.** Le projet de l'utilisateur peut déjà avoir Vitest et une config.

**Décision.** On écrit `.learn/vitest.config.mts` et on lance avec `--config`. On ne modifie
jamais la config existante ni les scripts npm de l'utilisateur.

**Conséquences.** Cohabitation propre, mais il faut gérer soi-même les alias et le `root`
pour que les tests puissent importer `src/`.

---

## D4 — Le noyau n'importe pas `vscode`

**Contexte.** Tester du code qui importe `vscode` demande de lancer un hôte d'extension.

**Décision.** `src/core` et `src/runner` sont du TypeScript pur. Seuls `extension.ts`,
`watcher.ts` et `webview/` connaissent l'API VSCode.

**Conséquences.** Tests unitaires rapides en Vitest sur toute la logique. Un peu de
plomberie supplémentaire dans `extension.ts`.

---

## D5 — Vérification « tout doit être rouge » à l'import

**Contexte.** Un LLM produit régulièrement des tests tautologiques qui passent sans que
rien ne soit implémenté. L'utilisateur enchaînerait alors des étapes sans rien écrire.

**Décision.** À l'import, on lance tous les tests. Toute étape verte avant que l'utilisateur
ait écrit quoi que ce soit invalide le parcours, avec le nom de l'étape fautive.

**Conséquences.** Transforme une défaillance silencieuse et démoralisante en erreur visible
immédiatement. Coûte un run complet à l'import, ce qui est acceptable.

---

## D6 — Le panneau du parcours est un singleton

**Contexte.** `vscode.window.createWebviewPanel` crée un panneau à chaque appel. Rien
n'empêche l'utilisateur de lancer « LearnPath: Ouvrir le parcours » plusieurs fois.

**Décision.** `ParcoursPanel` garde une référence statique au panneau courant. Un second
appel révèle le panneau existant au lieu d'en créer un autre. Cohérent avec le hors
périmètre « un seul parcours actif à la fois » de `ARCHITECTURE.md`.

**Conséquences.** Un seul point de rendu et un seul canal de messages à câbler au lot 5.
`retainContextWhenHidden` est activé pour ne pas perdre l'état de l'UI quand l'onglet
passe en arrière-plan ; c'est un coût mémoire assumé pour un panneau aussi petit.

---

## D7 — CSP avec nonce, aucune couleur en dur dans la webview

**Contexte.** Une webview qui affichera du markdown venant d'un fichier généré par un LLM
est une surface d'injection.

**Décision.** `default-src 'none'`, et `style-src` / `script-src` limités à un nonce
régénéré à chaque rendu. Aucune source externe n'est autorisée (cohérent avec la règle
« aucun appel réseau »). Toutes les couleurs viennent des variables CSS de VSCode
(`--vscode-foreground`, `--vscode-editor-background`, …).

**Conséquences.** Le CSS et le JS du panneau doivent rester inline avec le nonce, ou
passer par `asWebviewUri` + un ajout explicite au CSP au lot 5. Le thème suit celui de
l'éditeur gratuitement, clair comme sombre.

---

## D8 — Liste blanche stricte pour les commandes du runner

> **Mis à jour au lot 3 (D14).** `runner.command` n'existe plus dans le format : la
> commande de test est construite par l'extension. Ce module ne s'applique donc plus qu'à
> `runner.setup[]`. Le reste de la décision est inchangé, et reste indispensable : `setup`
> est toujours une commande arbitraire venue du JSON.

**Contexte.** `runner.command` et `runner.setup[]` viennent d'un JSON produit par un LLM
et fini par être exécutés sur la machine de l'utilisateur. Un parcours récupéré sur un
dépôt tiers, ou un modèle qui hallucine, suffit à transformer un import en exécution de
code arbitraire. Une liste noire de commandes dangereuses est illusoire : il y a toujours
un contournement.

**Décision.** `src/core/validate-commands.ts` applique une liste blanche, dans cet ordre :

1. Refus si la commande contient un métacaractère shell : `&`, `|`, `;`, `<`, `>`,
   `` ` ``, `$`, `(`, `)`, l'antislash, un saut de ligne, un retour chariot, un octet nul.
   L'antislash et l'octet nul ne sont pas dans l'énoncé habituel mais servent
   respectivement à continuer une ligne et à tronquer une chaîne côté système.
2. Le premier token doit être `npm`, `npx`, `pnpm` ou `yarn`. Rien d'autre, pas de chemin
   vers un binaire, pas de `bash`, pas de `node`.

Les arguments ne sont pas validés au-delà de ça : sans métacaractère et avec un binaire
connu, ils ne peuvent pas dériver vers une autre commande.

**Conséquences.**
- Un parcours ne peut pas lancer un script arbitraire, même si l'exécution passait un jour
  par un shell.
- Cela exclut des setups légitimes mais exotiques (`bun`, `deno`, un script maison). C'est
  assumé pour le v1 : la cible est JS/TS + Vitest. Élargir la liste est une décision
  explicite, pas un contournement à ajouter au cas par cas.
- Ce module ne fait que **valider**. La confirmation explicite de l'utilisateur avant
  exécution du `setup` est câblée depuis le lot 2 (D12).

---

## D9 — `ResolvedPath`, un type marqué que seul `safeResolve` produit

**Contexte.** Au lot 1, `loadParcours` validait les chemins du parcours contre une racine
fictive (`/learnpath`), faute d'avoir le dossier de l'utilisateur. Le lot 2 doit les
re-résoudre contre le vrai workspace. Deux chemins de validation qui peuvent diverger :
il suffit qu'une écriture future prenne le `string` déjà « validé » du parcours pour que
la deuxième vérification saute sans que rien ne le signale.

**Décision.** `safeResolve` retourne `ResolvedPath = string & { __brand: 'ResolvedPath' }`.
Aucun autre moyen d'en obtenir un. Toute fonction qui écrit sur disque
(`writeFileAtomic`, `writeState`) exige ce type. Le compilateur refuse alors une écriture
sur un chemin brut — vérifié en provoquant volontairement l'erreur :
`TS2345: Argument of type 'string' is not assignable to parameter of type 'ResolvedPath'`.

**Conséquences.**
- Le lot 2 re-résout chaque `tests.file` contre le workspace réel, ce n'est plus une
  discipline mais une contrainte de type.
- Le lot 5 (écriture d'un fichier de `expected.files` sur clic « Solution ») hérite de la
  même contrainte gratuitement.
- Le seul cast vers `ResolvedPath` du projet est à l'intérieur de `safeResolve`. Tout autre
  cast est un bug à refuser en revue.

---

## D10 — `safeResolve(…, { allowRoot: true })` remplace le cas particulier de `runner.cwd`

**Contexte.** `safeResolve` refuse la racine elle-même (« strictement sous root »).
`runner.cwd` vaut « . » dans la quasi-totalité des parcours. Le lot 1 traitait ce cas par
un `if (cwd !== '.')` avant l'appel, c'est-à-dire en **sautant** la validation.

**Décision.** L'option `allowRoot` déplace l'exception dans `safeResolve`. `cwd` repasse
donc par tous les refus lexicaux (absolu, `..`, antislash, octet nul), seule l'égalité à
la racine est tolérée. Testé : `..`, `src/../..` et `/etc/passwd` restent refusés avec
`allowRoot`.

---

## D11 — Config Vitest générée en `.mts`, jamais celle du projet

**Décision.** L'import écrit `.learn/vitest.config.mts` (pas `.ts`) : le `package.json` de
l'utilisateur n'est pas forcément `type: module` et Vite avertit alors sur une config
`.ts` qui utilise `import`. La config pose `root` sur le workspace via
`fileURLToPath(new URL('..', import.meta.url))` et `include` sur `.learn/tests/**`.

**Conséquences.**
- Les tests de `.learn/tests/` atteignent `src/` du projet par un chemin relatif normal
  (`../../src/panier.js`), sans alias à maintenir. Vérifié à la main : `src/panier.js`
  créé, `-t "step 1.1"` passe au vert, les 4 autres étapes restent skippées.
- `runner.command` de `SPEC-PARCOURS.md` et de `examples/exemple-panier.json` ont été
  alignés sur `.mts`. Un parcours généré avant ce changement pointera sur un fichier
  inexistant.
- Le fichier est réécrit à chaque import et porte un en-tête le disant.

---

## D12 — L'importer ne décide pas seul : conflit de slug, confirmation, rollback

**Contexte.** L'import écrit dans le projet de l'utilisateur et exécute des commandes
issues d'un JSON généré par un LLM.

**Décision.**
1. **Conflit de slug** : si `.learn/parcours/` contient déjà un parcours d'un autre slug,
   l'import échoue **sans rien écraser**. L'importer ne propose pas de réinitialisation,
   il remonte l'erreur ; c'est à l'appelant (`extension.ts`) de décider.
2. **Confirmation** : l'importer ne connaît pas `vscode`, il reçoit un hook
   `confirm(commands: string[]) => Promise<boolean>`. La boîte de dialogue affiche les
   commandes **exactes**, ligne par ligne, sans résumé ni reformulation. Test dédié.
3. **Rollback** : refus utilisateur, échec d'une commande de setup ou échec d'écriture
   annulent l'import. Si `.learn/` n'existait pas, il est supprimé ; s'il existait, seuls
   les fichiers créés par cet import le sont — un `.learn/notes.md` de l'utilisateur
   survit. Test dédié. *(Point 3 partiellement remplacé par D28 : le fichier de parcours
   est désormais conservé par tous les chemins de rollback.)*
4. **Écritures atomiques** : fichier temporaire puis `rename`. Un import interrompu ne
   laisse jamais un fichier de test à moitié écrit que Vitest tenterait de collecter.
5. **`spawn` sans shell**, argv découpé sur les espaces. Deuxième barrière après la liste
   blanche de D8, pas un remplacement.

**Conséquences.** `ImportHooks.exec` est injectable : les tests couvrent le setup sans
lancer un vrai `npm i`. La valeur par défaut est le `spawn` réel.

---

## D13 — Le `.gitignore` est créé s'il n'existe pas

**Contexte.** `IMPLEMENTATION_PLAN.md` disait « ajouter au `.gitignore` **s'il existe** ».
Un projet sans `.gitignore` verrait alors `state.json` et `.result.json` commités.

**Décision.** On crée le `.gitignore` s'il est absent, avec un en-tête `# LearnPath` et
les deux entrées. L'ajout est idempotent : comparaison ligne à ligne sur le contenu
trimmé, donc réimporter ne duplique rien, et une entrée déjà présente à la main n'est pas
réécrite.

**Conséquences.** C'est le seul fichier hors `.learn/` que l'import touche. C'est une
entorse assumée à « rien en dehors de `.learn/` » : sans elle, la règle 3 d'`AGENTS.md`
protège des fichiers que git, lui, ne protège pas.

---

## D14 — La commande de test n'est plus dans le parcours

**Contexte.** Le format v1 portait `runner.command` et `runner.filterFlag` : deux chaînes
fournies par le JSON, donc écrites par un LLM, et exécutées telles quelles. Deux problèmes
distincts. Le premier est de sécurité : même filtrée par la liste blanche de D8, une
commande arbitraire reste une commande arbitraire, et elle contenait déjà des chemins
(`--config .learn/vitest.config.mts`, `--outputFile=.learn/.result.json`) qui n'étaient
jamais validés comme des chemins. Le second est de maintenance : renommer notre config,
changer de reporter ou déplacer le fichier de sortie cassait tous les parcours déjà
générés, comme le passage de `.ts` à `.mts` au lot 2 l'a montré.

**Décision.** `runner` ne contient plus que :

- `kind`, seule valeur admise `"vitest"` ;
- `cwd`, optionnel, validé par `safeResolve(…, { allowRoot: true })` ;
- `setup`, optionnel, toujours soumis à D8 et à la confirmation de D12.

`src/runner/vitest.ts` construit l'argv lui-même à partir de `kind` :
`npx vitest run --config <config> --reporter=json --outputFile=<temporaire>`, plus le
filtre `-t`. Le schéma refuse désormais `command` et `filterFlag` : un parcours généré
avant ce changement est rejeté avec un message qui nomme le champ.

**Conséquences.**
- Le seul texte du parcours qui finit exécuté est `setup`. Le reste est une donnée.
- Notre commande peut évoluer sans invalider un seul parcours.
- Le rapport JSON n'est plus écrit dans `.learn/.result.json` mais dans un dossier
  temporaire propre à chaque run, supprimé ensuite : deux runs concurrents ne peuvent plus
  lire le rapport l'un de l'autre, et le projet de l'utilisateur ne reçoit rien.
- `.learn/.result.json` disparaît donc du `.gitignore` écrit par l'import (D13).
- Un runner autre que Vitest devient une valeur de `kind` et une fonction chez nous, pas
  une chaîne dans le JSON. C'est le comportement voulu.

---

## D15 — `classify` retourne un état **et** un message

**Contexte.** Le lot 3 demandait `classify(raw, step): 'pass' | 'missing-file' |
'parse-error' | 'assertion-failed'`. Mais il demandait aussi qu'une erreur de module
introuvable ne pointant pas vers un fichier de `expected.files` « remonte comme telle et
ne soit pas avalée en silence ». Avec une simple chaîne en retour, cette erreur est
indiscernable d'une erreur de syntaxe : l'UI afficherait « le fichier n'est pas encore
valide » sur un `Cannot find module 'lodash'`.

**Décision.** `classify` retourne `{ state, message?, failures }`. `state` est exactement
l'union des quatre valeurs demandées, c'est lui qui décide de l'affichage. `message` est
absent quand il n'y a rien à dire (`pass`, et `missing-file` qui est l'état normal de
début d'étape) et présent sur toute erreur, y compris celles qui ne sont pas de notre
fait. `failures` porte les assertions en échec de l'étape, pour l'affichage attendu / reçu.

**Conséquences.** Le tableau des trois états rouges de `UX.md` reste la référence pour le
rendu. La règle d'affichage du lot 5 est simple : `message` présent ⇒ on le montre.

---

## D16 — Une régression sur une étape précédente met la progression en pause

**Contexte.** L'étape courante passe, mais une étape déjà validée ne passe plus. Deux
lectures : avancer quand même en signalant la régression, ou rester sur place.

**Décision.** On n'avance pas. `runCurrentStep` ne bouge le state que si l'étape courante
passe **et** que toutes les précédentes passent encore.

La raison de fond est que les étapes suivantes ont été générées en supposant que les
précédentes tiennent : si 1.2 est cassée, les tests de 1.4 échoueront pour une raison
étrangère à ce que l'étudiant apprend, et il cherchera son erreur au mauvais endroit.
Avancer a en plus un défaut mécanique : la régression réapparaîtrait à chaque run, donc
l'avertissement s'afficherait en boucle sur toutes les étapes restantes, et un
avertissement permanent cesse d'être lu.

**Conséquences.**
- Le blocage ne doit surtout pas ressembler à un échec de l'étape courante. `Outcome`
  sépare `result` (l'étape courante, ici `pass`) de `regressions` (les étapes cassées),
  et `summary` dit : « Étape 1.3 validée. En attente : l'étape 1.2 ne passe plus depuis ta
  dernière modification. » Rendu détaillé dans `UX.md`.
- À revoir avec de vrais utilisateurs, pas maintenant : le cas où c'est le *parcours* qui
  est fautif (deux étapes aux attentes contradictoires, ça arrive avec du contenu généré)
  plutôt que l'étudiant ; et une commande d'échappement `learnpath.skipRegression` si
  l'usage montre que des gens restent coincés.

---

## D17 — Le déplacement des tests en fin de parcours, deuxième entorse à « rien hors .learn/ »

**Contexte.** En fin de parcours, les tests écrits dans `.learn/tests/` sont ce que
l'utilisateur a de plus utile à garder. Les laisser là revient à les perdre.

**Décision.** `src/core/finish.ts` propose de les déplacer, sous trois garde-fous :

- destination validée par `safeResolve` (jamais hors du projet) ;
- détection du dossier cible seulement s'il n'y a **qu'un** candidat conventionnel
  (`tests`, `test`, `__tests__`, `spec`, `src/__tests__`, …) ; zéro ou plusieurs, on
  demande à l'utilisateur, on ne devine pas ;
- `planTestsMove` n'écrit rien : il retourne la liste exacte, affichée avant confirmation,
  et **refuse** le déplacement si un fichier de destination existe déjà, en le nommant.

**Conséquences.** Avec le `.gitignore` (D13), c'est le deuxième et dernier endroit où
l'extension touche à un fichier hors `.learn/`. Il est explicitement confirmé, listé, et
jamais destructif.

---

## D18 — On ne passe plus par `npx`, et `npm` est lancé par le Node courant

**Contexte.** Sous Windows, `npm`, `npx`, `yarn` et `pnpm` sont des `.cmd`. Depuis Node 22
(suite à CVE-2024-27980), `spawn` **refuse** de lancer un `.cmd` sans shell : `EINVAL`.
L'import (`npm i -D vitest`) et le runner (`npx vitest`) étaient donc inutilisables sous
Windows — c'est ce qui a bloqué le critère de fin du lot 4 avant d'être corrigé.

**Décision.** On ne remet pas `shell: true`, qui rouvrirait la porte que D8 et D14 ont
fermée. `src/core/exec.ts` :

- `vitestCli(root)` renvoie `<root>/node_modules/vitest/vitest.mjs` et le runner le lance
  avec `process.execPath`. `npx` disparaît complètement du chemin de test : c'est aussi
  plus rapide, et le message « Vitest n'est pas installé dans ce projet » remplace un
  ENOENT opaque.
- `launcher(binary, args)` remplace, **sous Windows uniquement**, `npm`/`npx` par
  `process.execPath <node>/node_modules/npm/bin/npm-cli.js …`.

**Conséquences.**
- `shell: false` reste vrai partout, argv toujours découpé.
- `yarn` et `pnpm` en `runner.setup` restent inutilisables sous Windows. Ils sont dans la
  liste blanche de D8 mais aucun parcours ne les utilise ; à traiter au lot 6 si le besoin
  apparaît.
- Le runner suppose Vitest installé dans le projet, ce que `runner.setup` garantit.

---

## D19 — `markdown-it` en dépendance runtime pour rendre `explanation`

**Contexte.** `explanation` est du markdown produit par un LLM et affiché dans une webview.
C'est la seule chaîne du projet qui est à la fois non fiable et rendue en HTML. La règle 6
d'`AGENTS.md` impose de discuter toute nouvelle dépendance runtime : jusqu'ici il n'y avait
qu'`ajv`.

**Décision.** On ajoute `markdown-it` (~14.x). Les alternatives écartées :

- **Écrire le rendu à la main.** C'est le piège classique : un mini-parseur markdown fait
  quarante lignes, et la quarante-et-unième est une faille. On ne réécrit pas un parseur
  sur une entrée hostile.
- **`marked`.** Ne sait pas *ne pas* parser le HTML brut : il faut assainir la sortie
  après coup, donc faire confiance à un second outil pour rattraper le premier.
- **`markdown-it` avec `html: false`** ne parse pas le HTML du source, il l'échappe. La
  sortie ne peut pas contenir de balise que le rendu n'a pas produite lui-même. C'est la
  différence entre « désactivé » et « filtré après coup » : la deuxième forme se contourne,
  la première n'a rien à contourner.

Configuration, dans `src/webview/markdown.ts` :

- `html: false` — pas de HTML brut, `<script>` ressort en texte ;
- règle `image` désactivée — la CSP interdit déjà toute image, autant que `![x](data:…)`
  reste du texte lisible plutôt qu'une balise vide ;
- `validateLink` réduit à `http`, `https`, `mailto` — un lien `javascript:` ou `data:`
  retombe en texte simple.

Trois tests dans `src/webview/panel.test.ts` le vérifient sur une fixture volontairement
hostile (`src/webview/__fixtures__/explication-hostile.md`).

**Conséquences.**
- Le bundle passe de ~350 ko à ~590 ko. C'est la deuxième et dernière dépendance runtime.
- La CSP reste `default-src 'none'` : le rendu markdown n'est pas la seule barrière, il est
  la première de deux.
- `markdown-it` tourne côté extension (Node), pas dans la webview. La webview ne reçoit que
  du HTML déjà produit, elle n'embarque aucune bibliothèque.

---

## D20 — Le panneau ne rend qu'un view model, et il ne se réécrit jamais en entier

**Contexte.** Au lot 0 le panneau réécrivait `webview.html` à chaque mise à jour, et on
avait renoncé à écrire `panel.test.ts` : tout le rendu était dans une classe qui importe
`vscode`, donc intestable.

**Décision.** Trois couches.

1. `src/core/viewmodel.ts` — `buildViewModel(parcours, state, outcome?)` retourne une
   structure pure : étape, compteur, pourcentage, indices révélés, état du dernier run,
   régressions, récapitulatif de fin. Aucune décision d'affichage ne vit ailleurs.
2. `src/webview/render.ts`, `markdown.ts`, `shell.ts` — du view model au HTML, toujours
   sans `vscode`. C'est ce que teste `panel.test.ts` (26 tests).
3. `src/webview/panel.ts` — le branchement `vscode`, et rien d'autre.

Les mises à jour passent par `postMessage` de trois fragments (`header`, `main`, `status`),
pas par une réécriture de `webview.html`. Deux raisons :

- la zone d'état est une région `aria-live` ; remplacer l'élément lui-même au lieu de son
  contenu supprime l'annonce, et le passage automatique à l'étape suivante redeviendrait
  invisible pour qui ne regarde pas le panneau ;
- réécrire le document remet le scroll en haut à chaque sauvegarde.

**Conséquences.**
- Le panneau ne prend jamais le focus : `preserveFocus: true` à la création *et* au
  `reveal`, aucun `focus()` dans le script. Voler le curseur pendant que l'utilisateur tape
  est le défaut le plus rédhibitoire que cette extension puisse avoir.
- `retainContextWhenHidden: true` plus un `setState`/`getState` côté webview : l'onglet
  masqué puis réaffiché retrouve son contenu, et un `ready` non attendu fait repousser le
  modèle courant par l'extension.
- Le protocole (`src/webview/protocol.ts`) est validé dans les deux sens.
  `parseWebviewMessage` n'accepte que trois formes et ne recopie aucun champ hors
  protocole. Le `stepId` reçu est comparé à l'étape courante, jamais utilisé pour aller
  chercher une étape ou construire un chemin.
- L'écriture de la solution (`src/core/reveal.ts`) valide **avant** d'écrire quoi que ce
  soit : chaque fichier doit être déclaré dans `expected.files` de l'étape courante, et
  chaque chemin repasse par `safeResolve`. Un parcours relu depuis le disque n'est pas plus
  fiable qu'à l'import.

---

## D21 — `verifyAllGreen` : les solutions sont vérifiées cumulativement, dans une copie du workspace

**Contexte.** `verifyAllRed` (D5) ne regarde que l'état initial : chaque étape doit être
rouge. Il ne voit pas le défaut le plus fréquent du contenu généré par un LLM — une
`solution` qui ne contient que la nouveauté de l'étape et efface le travail des
précédentes. Le cas s'est produit en vrai, sur l'étape 1.4 d'`exemple-panier.json` : la
solution valait `// ... createPanier, addItem, total inchangés ...` suivi de `PROMOS`.
Cliquer sur « Solution » cassait trois étapes déjà acquises. Le bandeau de régression a
fait son travail, mais l'étudiant se retrouve avec un parcours à réparer.

**Décision.** À l'import, après `verifyAllRed` et avec le même rollback : copier le
workspace dans un temporaire système, y appliquer les solutions **étape par étape**, et
après l'étape N exiger que les étapes 1..N soient **toutes** vertes.

Deux fautes distinctes tombent dans le même filet, et sont nommées différemment — c'est
tout l'intérêt, l'auteur du parcours n'a pas la même correction à faire :

- « la solution de l'étape « 1.4 — … » ne passe pas ses propres tests » ;
- « la solution de l'étape « 1.4 — … » casse l'étape « 1.2 — … » ».

La copie exclut `node_modules` et `.git`, et relie `node_modules` par un lien (jonction
sous Windows) : copier des dizaines de milliers de fichiers pour lancer Vitest serait
absurde, et on ne fait que lire ce dossier. **Rien n'est jamais écrit dans le projet de
l'utilisateur** : les solutions n'atterrissent que dans le temporaire, qui est supprimé
dans un `finally`.

`planSolution` est extrait de `src/core/reveal.ts` et partagé : la vérification passe
exactement par les mêmes garde-fous que le bouton « Solution » (fichier déclaré dans
`expected.files`, chemin repassé par `safeResolve`).

**Conséquences.**
- L'import coûte un run de tests par étape, en plus du run de `verifyAllRed`. Mesuré sur
  `exemple-panier.json` (cinq étapes), hors installation des dépendances :
  `verifyAllRed` 0,8 s, `verifyAllGreen` 3,8 s — environ 0,8 s par étape. Un import complet
  sur projet vierge tient en 18,6 s avec npm et 7,2 s avec pnpm ; l'essentiel est
  l'installation de Vitest, pas la vérification.
- La vérification n'est **pas** optionnelle et n'a pas de réglage pour la couper. Elle est
  ce qui distingue un parcours jouable d'un parcours qui bloque l'étudiant à l'étape 4 ;
  la rendre optionnelle, c'est la voir désactivée dans les seuls cas où elle sert.
- Elle affiche sa progression : `ImportHooks.progress` remonte l'étape en cours, et
  `extension.ts` la branche sur `window.withProgress`. Sans ça la fenêtre a l'air figée.
- Deux fixtures dans `src/core/__fixtures__/` (`solution-regressive.json`,
  `solution-incomplete.json`, plus `solutions-coherentes.json` pour le cas nominal) sont
  jouées par de **vrais** runs Vitest dans `verify.test.ts` — une fausse sortie de Vitest
  ne prouverait que la mise en forme du message. Ça allonge `npm test` d'environ 8 s.
- `SPEC-PARCOURS.md` porte la contrainte correspondante côté générateur : la solution est
  le contenu complet et fonctionnel du fichier à ce stade, jamais un extrait.

---

## D22 — Les erreurs Vitest sont traduites, jamais remplacées

**Contexte.** `TypeError: (0 , __vite_ssr_import_1__.createPanier) is not a function` veut
dire « tu n'as pas encore exporté `createPanier` ». Tel quel, pour un débutant, c'est du
bruit intimidant.

**Décision.** `src/core/humanize.ts`, pur, six formes reconnues, et trois règles :

1. le message brut reste **toujours** visible, replié sous un `<details>` mais jamais
   supprimé ;
2. une forme non reconnue n'est ni masquée ni reformulée — `humanize` retourne `undefined`
   et le brut s'affiche seul ;
3. on ne devine jamais l'intention : ce qui n'est pas dans le message n'est pas dit.

Les formes sont tirées de `src/runner/__fixtures__/g-messages-frequents.json`, une vraie
sortie de Vitest 4 capturée pour l'occasion. Deux surprises, qui justifient à elles seules
d'avoir travaillé sur du réel plutôt que sur des messages écrits de mémoire :

- un **export manquant** ne produit pas « does not provide an export named » : la
  transformation SSR de Vite le fait ressortir en `is not a function`, exactement comme un
  export qui existe mais n'est pas une fonction. On ne peut donc **pas** distinguer les deux
  cas, et le message traduit ne le prétend pas — il nomme les deux causes possibles ;
- un **dépassement de délai** perd son texte dans le rapport JSON : il ne reste que
  `Error: STACK_TRACE_ERROR`, posé par le `withTimeout` de `@vitest/runner`.
  « Test timed out in 300ms » n'apparaît nulle part. La traduction dit qu'il y a eu
  dépassement et ne prétend pas connaître la durée.

**Conséquences.**
- `StatusView` et `RegressionView` portent `explained?` **en plus** de `detail`, jamais à
  la place. Le rendu met la traduction devant et replie le brut.
- Ajouter une forme, c'est ajouter une entrée dans `RULES` et un message réel dans la
  fixture. Une règle sans message réel derrière n'a pas sa place.

---

## D23 — `learnpath.reset` : deux choix, et le dialogue dit ce qu'il ne touche pas

**Contexte.** La commande existait depuis le lot 0 en « pas encore implémenté », et la
question — supprimer `.learn/` entier ou seulement `state.json` ? — traînait depuis.

**Décision.** Les deux, dans un seul dialogue modal :

- « Recommencer depuis l'étape 1 » — `state.json` est réécrit sur la première étape ; les
  tests, le parcours et les indices déjà lus restent en place ;
- « Supprimer le parcours » — `.learn/` est supprimé en entier.

Et surtout : **le texte du dialogue dit explicitement que le code de l'utilisateur n'est
jamais touché.** C'est la peur qu'on a le doigt sur le bouton ; elle se lève là, pas dans
une documentation que personne n'ouvre.

`restartParcours` relit le parcours **sans passer par le state** (`readImportedParcours`,
extrait de `loadSession`) : un `state.json` illisible est précisément le cas où l'utilisateur
lance la réinitialisation — le message d'erreur de `state.ts` le lui dit d'ailleurs depuis
le lot 2. Elle ne peut donc pas dépendre de sa lecture.

**Conséquences.**
- Tout ce que ces deux fonctions suppriment est sous `.learn/`, chemin obtenu par
  `safeResolve`. `src/core/reset.test.ts` vérifie sur chaque chemin qu'un fichier écrit par
  l'utilisateur est intact après coup.
- Après « Supprimer le parcours », le panneau est fermé plutôt que laissé sur un contenu
  qui ne correspond plus à rien.

---

## D24 — Gestionnaires de paquets : pnpm traité, Yarn PnP refusé explicitement

**Contexte.** D18 lance le CLI de Vitest par son chemin (`node_modules/vitest/vitest.mjs`)
avec le Node courant, pour ne pas passer par un `.cmd` — que `spawn` refuse sans shell
depuis Node 22. Restaient deux trous : `pnpm` et `yarn` en `runner.setup` étaient
inutilisables sous Windows pour la même raison, et un projet Yarn PnP n'a pas de
`node_modules` du tout.

**Décision.**

- `launcher` cherche, sous Windows et dans cet ordre : un `<binaire>.exe` sur le `PATH`,
  puis le JS du CLI — celui livré avec Node pour `npm`/`npx`, et
  `<dossier du PATH>/node_modules/<binaire>/bin/<binaire>.{cjs,js,mjs}` pour un `pnpm` ou un
  `yarn` installés globalement par npm. Sans rien trouver, la commande ressort telle quelle
  et échoue lisiblement. À aucun moment on ne repasse à `shell: true`.
- `vitestCli` retourne un `Result` : quand `node_modules/vitest` est absent **et** qu'un
  `.pnp.cjs` est présent à la racine, le message nomme Yarn Plug'n'Play et indique la
  sortie (`nodeLinker: node-modules`), au lieu de parler d'une installation ratée.

**Conséquences.**
- pnpm marche de bout en bout, vérifié sur un vrai projet : `pnpm add -D vitest` se lance,
  et `node_modules/vitest/vitest.mjs` se résout — c'est un lien vers le magasin, et
  `existsSync` le suit. Aucun code spécifique à pnpm n'a été nécessaire pour la résolution.
- Yarn PnP est refusé à l'import, avec rollback, vérifié sur un vrai projet Yarn Berry.
  Le supporter demanderait de lancer Vitest à travers `.pnp.loader.mjs` : c'est un autre
  sujet, et il attendra une demande réelle.

---

## D25 — Le bac à sable de vérification n'ouvre pas `node_modules` en écriture

**Contexte.** `verifyAllGreen` (D21) copie le workspace dans un temporaire et y relie
`node_modules` — copier des dizaines de milliers de fichiers pour lancer Vitest n'a pas de
sens. Le lien était posé sur le **dossier entier**, en supposant qu'un run de tests ne fait
que lire ses dépendances. C'est faux, et deux fois :

- Vite écrit son cache dans `<root>/node_modules/.vite/` — vérifié : le dépôt lui-même
  contient `node_modules/.vite/vitest/<hash>/results.json` ;
- Vite écrit la version transpilée du fichier de config dans `node_modules/.vite-temp/`,
  dans le **premier `node_modules` en remontant depuis le fichier de config**
  (`findNearestNodeModules`, `loadConfigFromBundledFile`). Ce chemin n'est pas configurable.

Le lien de jonction renvoyait donc ces écritures dans le `node_modules` du projet de
l'utilisateur, hors de `.learn/`. C'est la règle 3 d'`AGENTS.md` qui saute, à chaque import.

**Décision.** Deux verrous, l'un pour le cas normal, l'autre pour le bac à sable.

1. `.learn/vitest.config.mts` fixe `cacheDir` sur `.learn/.vite`. Ça vaut aussi pour les
   runs ordinaires, pendant que l'étudiant code : sans ça, jouer un parcours salissait
   `node_modules` en continu. `.learn/.vite/` est ajouté au `.gitignore`.
2. Le bac à sable relie `node_modules` **entrée par entrée** au lieu de relier le dossier.
   Tout ce que Vite crée à la racine de `node_modules` est alors créé dans le temporaire,
   qui est supprimé ensuite ; les paquets, eux, restent lus sur place et rien n'est copié.

Le second verrou rend la classe de problème impossible plutôt que de courir après chaque
chemin de cache que Vite pourrait inventer dans une version future.

**Conséquences.**
- Seule commande qui tourne dans le bac à sable : Vitest. `runner.setup` est joué **avant**,
  dans le vrai projet et après confirmation explicite de l'utilisateur ; il n'a jamais accès
  au bac à sable.
- Non-régression dans `verify.test.ts` : on injecte `execute`, on vérifie que
  `sandbox/node_modules` n'est pas un lien, et qu'un fichier écrit dedans n'apparaît pas
  dans le projet. Le test échoue bien si on remet le lien unique. Il n'a pas besoin d'un
  vrai run Vitest — et c'est heureux, parce que sous le harnais de test Vitest n'écrit pas
  son cache, ce qui rendrait une vérification « après un vrai import » silencieusement vide.
- Reste, en dehors du bac à sable, un `node_modules/.vite-temp/` créé puis vidé par Vite
  dans le projet de l'utilisateur au chargement de la config. Ce n'est pas de notre ressort
  (c'est le comportement de Vite pour n'importe quel projet), c'est éphémère, et il n'y a
  pas de réglage pour l'en empêcher.

---

## D26 — La copie du workspace suit `.gitignore`, pas une liste d'exclusion

**Contexte.** Les mesures du lot 6 venaient de projets vides. Sur un vrai dépôt, la copie
emporte tout ce que le projet a accumulé. Mesuré sur deux projets réels :

| Projet | Taille hors `node_modules`/`.git` | Ce qui pèse |
|---|---|---|
| A | 740 Mo | 733 Mo dans un `.jarvis/` maison |
| B | 484 Mo | 420 Mo dans `.venv/` |

Le dossier de 733 Mo du projet A ne figure dans aucune liste d'exclusion imaginable — mais
il est dans son `.gitignore`. Aucune liste codée en dur ne tient face à un vrai dépôt.

**Décision.** Quand le projet est un dépôt git, la liste des fichiers à copier vient de
`git ls-files -c -o --exclude-standard` : les fichiers suivis **et** les non suivis non
ignorés. C'est exactement la définition de « ce qui appartient au projet ». Sinon, on
retombe sur un parcours récursif avec une liste d'exclusion (`node_modules`, `.git`,
`dist`, `build`, `coverage`, `.next`, `.venv`, `target`, `.vite`, …), qui reste le filet.

`.learn/` est ajouté dans tous les cas : un projet qui l'ignorerait en bloc donnerait une
copie sans tests, donc un échec incompréhensible.

Au-delà de 100 Mo, un avertissement explicite part dans le journal d'import avant que la
copie commence, en disant quoi faire (ajouter les gros dossiers générés au `.gitignore`).
On n'abandonne pas : un projet volumineux peut être légitime.

**Ce que ça donne** (temps de la copie seule, mêmes projets) :

| Projet | Avec git | Sans git (liste d'exclusion) |
|---|---|---|
| A (740 Mo) | 179 fichiers, 0,67 s, pas d'avertissement | 859 fichiers, **726 Mo**, 2,7 s, avertissement |
| B (484 Mo) | 352 fichiers, 0,66 s | 352 fichiers, 0,78 s |
| learnpath | 93 fichiers, 0,28 s | 93 fichiers, 0,36 s |

**Conséquences.**
- Un fichier ignoré par git mais nécessaire aux tests (un `.env` local, par exemple) n'est
  pas dans la copie. C'est accepté : les tests d'un parcours portent sur le code que
  l'étudiant écrit, et l'alternative — copier 726 Mo — est pire pour tout le monde.
- `git` n'est pas une dépendance : absent, ou projet hors dépôt, on prend le parcours
  récursif. Aucun message n'est nécessaire.

---

## D27 — Le rapport JSON de Vitest perd le message des dépassements de délai

Recherche demandée au lot 7, à la suite du constat de D22.

**Cause exacte, pas une supposition.** Dans `@vitest/runner`, `makeTimeoutError` construit
la bonne erreur puis écrase sa pile :

```js
error.stack = stackTraceError.stack.replace(error.message, stackTraceError.message)
```

`stackTraceError.stack` commence par `Error: STACK_TRACE_ERROR` ; `error.message`
(« Test timed out in 300ms… ») ne s'y trouve pas, donc le `replace` ne fait rien et la pile
garde le texte du marqueur. Les arguments semblent inversés. Le reporter JSON, lui, émet
`e.stack || e.message` : `stack` est non vide, le message n'est jamais atteint.
`error.message` est correct, c'est **uniquement** `stack` qui est faux.

Rien de trouvé côté issues publiques sous ce nom ; le sujet voisin est la refonte du
reporter JSON, qui est un format de compatibilité Jest (`vitest-dev/vitest#7586`).

**Un autre reporter conserve-t-il le message ?** Oui, `junit`, vérifié sur un vrai
dépassement de délai :

```xml
<failure message="Test timed out in 300ms.&#10;If this is a long-running test, …" type="Error">
```

`tap` n'écrit pas de fichier avec `--outputFile`. Les deux reporters cohabitent :
`--reporter=json --outputFile.json=… --reporter=junit --outputFile.junit=…` produit bien
les deux fichiers en un seul run.

**Coût du changement.**

- *Migrer sur `junit`* : cher. `parse.ts`, `classify.ts` et sept fixtures sont construits
  sur le format Jest ; il faudrait un parseur XML (pas de dépendance runtime nouvelle
  autorisée sans discussion), le déséchappement des entités, et surtout revalider les
  quatre classifications — notamment `missing-file`, qui repose sur une erreur de collecte
  dont on ne sait pas comment junit la rend. Plusieurs heures, et un risque de régression
  sur le point le plus sensible du produit.
- *Ajouter `junit` à côté du JSON* : ~1 heure. Un fichier de sortie de plus, une quinzaine
  de lignes pour extraire `<failure message="…">` par nom de test, et n'y toucher que
  lorsque le message JSON vaut `Error: STACK_TRACE_ERROR`. Rien à changer dans `parse.ts`
  ni `classify.ts`.

**Décision.** Ni l'un ni l'autre pour l'instant : `humanize.ts` reste tel quel. Le message
actuel dit déjà ce qu'il faut faire (« une promesse n'est jamais résolue, ou un `await`
manque ») ; seule la durée manque, et un étudiant qui tombe là-dessus n'en a pas besoin. La
limite est notée dans le README, et la deuxième option est prête si le cas remonte pour de
vrai.

---

## D28 — Le rollback conserve le fichier de parcours

**Contexte.** Constaté au premier vrai usage : l'import échoue sur une commande de setup,
le rollback nettoie `.learn/`, et `.learn/parcours/<slug>.json` part avec. L'utilisateur a
perdu son parcours. Le prompt de génération demande justement à l'agent d'écrire là :
**le fichier source et la cible de l'import sont le même fichier**.

Le fichier de parcours est la seule chose non reproductible de tout le système. Les tests,
la config, le `state.json` sont réécrits à l'identique au prochain import ; un LLM, lui, ne
régénère jamais deux fois la même sortie. Le rollback détruisait exactement ce qu'il fallait
préserver — et pour les deux vérifications (`verifyAllRed`, `verifyAllGreen`) c'est pire
encore : le parcours est fautif, et son auteur en a besoin pour le corriger.

**Décision.** `rollbackAll` met le contenu du fichier de parcours de côté avant de nettoyer
et le repose ensuite. **Tous** les chemins de rollback, sans exception : échec d'écriture,
refus de la confirmation, échec d'une commande de setup, `verifyAllRed`, `verifyAllGreen`.
Le message d'échec dit où le fichier se trouve, en chemin relatif au workspace.

Une seule règle plutôt qu'un drapeau à trois cas : annuler un import ne doit pas plus
détruire le parcours qu'en rater un. Ça remplace le « rien n'est conservé » de D12.

**Conséquences.**
- Le message « Rien n'a été conservé. » devient « Le fichier de parcours est conservé, rien
  d'autre : `.learn/parcours/<slug>.json`. » Il ne reste que lui — tests, config et
  `state.json` sont bien supprimés, un `.learn/` préexistant est toujours respecté.
- Après un échec, `.learn/parcours/` contient un parcours : réimporter le **même** slug
  fonctionne, importer un **autre** slug tombe sur le refus de conflit de D12, qui dit quoi
  faire. C'est le prix, et il est explicite.
- Six tests de non-régression dans `importer.test.ts` : les trois échecs tardifs × (le
  parcours survit / un `.learn/` préexistant survit), plus la réimportation.

---

## D29 — Résolution des commandes de setup : plus jamais un `spawn npm ENOENT` nu

**Contexte.** Deuxième bug de lancement de processus du projet, après D18. Constaté :
`learnpath.import` échoue avec « spawn npm ENOENT » alors que `npm` marche dans le
terminal. Deux causes cumulées :

1. l'hôte d'extension n'a pas le PATH d'un terminal (nvm, fnm, volta réglent le PATH par
   session de shell), et son `process.execPath` est `Code.exe`, pas `node` ;
2. la résolution de D18 cherchait, à côté d'un `npm.cmd` trouvé dans le PATH, un
   `node_modules/npm/bin/npm.cjs|.js|.mjs`. **Ce fichier n'existe pas** : npm et volta
   nomment leur CLI `npm-cli.js`. La résolution rendait donc la commande telle quelle et
   `spawn` échouait. Reproduit avant correction avec un faux shim `pnpm.cmd` +
   `node_modules/pnpm/bin/pnpm-cli.js` et un PATH réduit à ce dossier : ancienne
   résolution `{"file":"pnpm"}` → `spawn pnpm ENOENT`.

**Décision.**
- Ordre de résolution, sur toutes les plateformes : le CLI livré avec le Node qui exécute
  l'hôte (depuis `process.execPath`, `node_modules/` et `../lib/node_modules/`), puis le
  PATH, puis — sous Windows — le `.cmd` du PATH traduit en son JS voisin, `<nom>-cli.js`
  inclus. Jamais `shell: true` : D8 tient.
- Le PATH du terminal intégré est la troisième source. `src/core` n'importe pas `vscode` :
  `extension.ts` fusionne `terminal.integrated.env.<plateforme>.PATH` **en queue** de
  `process.env.PATH` à l'activation, et la résolution le voit comme le reste.
- `launcher` retourne `resolved` et `tried`. Quand rien n'aboutit, on n'essaie même pas de
  lancer : `notFoundMessage` donne les chemins examinés, `process.execPath`, le PATH vu par
  l'hôte, et **la sortie de secours** — lancer la commande à la main, puis réimporter avec
  `"setup": []`. Le même message est rendu si le `spawn` échoue quand même en ENOENT/EINVAL.
- L'import affiche désormais la vue Sortie sur échec : la notification ne montre qu'une
  ligne, le diagnostic en fait dix.

**Conséquences.** Un utilisateur bloqué a de quoi savoir ce qui a été cherché, et une issue
sans nous. Vérifié en vrai sur `examples/demo-project` : import complet avec
`npm i -D vitest` (11,9 s) et avec `pnpm add -D vitest` (9,0 s), et diagnostic complet avec
`PATH` vidé.

---

## D30 — « La solution ne passe pas » et « le fichier de test ne se collecte pas » sont deux diagnostics

**Contexte.** `verifyAllGreen` a refusé un vrai parcours avec « la solution de l'étape 1.1
ne passe pas ses propres tests (Vitest failed to find the current suite) ». La vérification
avait raison de refuser, mais le diagnostic était faux : la solution était juste, c'est le
fichier de test qui était mal formé (un `it()` hors `describe()`, ou un `describe()`
asynchrone) et aucun test n'avait été collecté. Le message envoyait l'auteur corriger le
mauvais fichier.

**Décision.** `verifyAllGreen` sépare les trois classifications que `classify` produit
déjà : `assertion-failed` → la solution ne passe pas ses propres tests ; `parse-error` →
le fichier de test ne s'exécute pas, aucun test collecté, la solution n'est pas en cause ;
`missing-file` → la solution n'écrit pas le fichier attendu par ses tests. Le détail passe
par `humanize`, qui apprend la forme « failed to find the current suite ».

Côté amont, `SPEC-PARCOURS.md` gagne une section « Structure des tests » et le prompt
distingue explicitement « le test échoue » de « le test ne s'exécute pas » : ce qu'on
demande de vérifier avant de rendre le JSON, c'est d'abord que le fichier **se collecte**.

**Conséquences.** Fixture `test-mal-forme.json` (un `describe()` jamais refermé, solution
correcte) et un test qui exige que le message ne parle **pas** de la solution. La forme
brute « Vitest failed to find the current suite » vient de Vitest 1 et 2 (`assert()` dans
`@vitest/runner`) ; Vitest 3 et 4 l'ont remplacée par un message plus clair, mais les
projets réels sont encore sur les versions précédentes.

---

## D31 — La config Vitest générée hérite du `vite.config.*` du projet

**Contexte.** Premier parcours React réel, refusé à l'import : « le fichier de test de
l'étape 1.1 ne s'exécute pas ». La config écrite par l'importer était celle du lot 2, faite
pour du JS simple : pas de plugin, `environment: 'node'`. Reproduit sur deux vrais projets
Vite React — `vite@8 / plugin-react@6 / React 19 / TS` et `vite@5 / plugin-react@4 /
React 18` — avec un parcours qui monte un composant : les deux échouent sur
`ReferenceError: document is not defined`. Le parcours demandait pourtant bien `jsdom` et
`@testing-library/react` dans son `setup` ; la config générée n'en tenait aucun compte.

**Décision.** Quand le projet a un `vite.config.{ts,mts,cts,js,mjs,cjs}` à sa racine, la
config générée l'**importe** et fusionne avec `mergeConfig` :

```ts
import projet from '../vite.config.ts'
export default defineConfig(async (env) => {
  const resolu = typeof projet === 'function' ? await projet(env) : await projet
  const { test: _test, ...base } = resolu
  return mergeConfig(base, { root, cacheDir, test: { include, environment } })
})
```

Trois points la définissent :

1. **On hérite, on ne reconstruit pas.** Deviner « React → plugin-react, Vue → plugin-vue »
   serait faux au prochain écosystème, et raterait de toute façon les alias, `resolve`, les
   plugins maison. Le projet a déjà dit tout ça dans sa config Vite.
2. **Le bloc `test` du projet est écarté.** C'est sa configuration de test : D3 la déclare
   sacrée. La garder ajouterait ses `include` aux nôtres — `mergeConfig` concatène les
   tableaux — et la vérification à l'import lancerait les tests du projet.
3. **`vitest.config.*` n'est jamais lu**, pour la même raison. On ne lit que la config
   *Vite*.

L'environnement, lui, ne s'hérite pas : une config Vite ne contient pas de bloc `test`. Le
format gagne donc `runner.environment` (`node | jsdom | happy-dom | edge-runtime`,
optionnel). Absent, il est déduit de `runner.setup` : un parcours qui installe `jsdom` ou
`happy-dom` en a besoin. C'est ce qui fait marcher, sans être régénérés, les parcours écrits
avant cette décision — dont celui qui a remonté le bug.

**Conséquences.**
- Vérifié en vrai, import complet réussi : projet vanilla (`examples/demo-project`), Vite 8
  + React 19 + TypeScript, et Vite 5 + React 18 + `@vitejs/plugin-react@4` + Vitest 1. La
  même config générée tient sur des stacks séparées par trois majeures de Vite.
- Test de non-régression avec un **vrai run** : un alias déclaré dans le `vite.config.ts`
  du projet doit résoudre dans les tests du parcours, et le même parcours sans cette config
  doit échouer. Le contrôle négatif est là pour que le test prouve l'héritage, pas la
  présence d'une ligne dans un fichier.
- On n'écrit toujours que `.learn/vitest.config.mts`, et on ne touche à rien d'autre.
- Limite connue : un projet qui n'a **pas** de `vite.config.*` mais met ses plugins dans
  `vitest.config.ts` n'hérite de rien. À rouvrir si le cas remonte ; l'inverse casserait
  l'isolation des tests.

---

## D32 — `humanize` reçoit la phase : à la collecte, on ne traduit pas une erreur d'exécution

**Contexte.** Le même import a affiché : « une valeur vaut undefined là où un objet est
attendu ; c'est en lisant *config* que ça casse ». Vrai pour une erreur d'exécution dans le
code de l'étudiant. Faux ici : l'erreur venait de la collecte, donc de l'outillage. La
traduction envoyait chercher dans son fichier un problème qui était dans la config.

**Décision.** Une même forme brute ne veut pas dire la même chose selon la phase. `humanize`
prend un second argument, `'collect' | 'run'`, et chaque règle déclare les phases où elle
s'applique :

| Forme | Phases |
|---|---|
| `Cannot find module` | collecte et exécution |
| `Failed to parse source`, `failed to find the current suite` | collecte |
| `is not a function`, `Cannot read properties of undefined`, `AssertionError`, dépassement de délai | exécution |

La phase n'est pas devinée : elle se lit dans la classification, `phaseOf(state)` — seul
`assertion-failed` vient de l'exécution d'un test, tout le reste est de la collecte. Les
deux appelants (`verify.ts`, `viewmodel.ts`) manipulaient déjà une `Classification`, ils ne
passent donc aucune information nouvelle.

**Conséquences.** Dans le doute, on ne traduit pas : une traduction fausse est pire qu'un
message brut, elle envoie chercher au mauvais endroit. C'est la règle 4 de `humanize.ts`,
à côté des trois autres. Le brut reste visible dans tous les cas, comme avant.

---

## D33 — « Rouge » veut dire collecté et en échec ; on n'invente pas la cause d'une collecte ratée

**Contexte.** Un diagnostic externe a montré que trois garanties étaient fausses en même
temps, et qu'elles avaient fait accuser le générateur à tort pendant trois essais.

1. `verifyAllRed` ne cherchait que les étapes `pass`. Une étape dont **aucun test ne se
   collecte** n'est pas `pass` : elle passait donc pour rouge. La garantie « chaque étape
   échoue avant écriture » était vraie sur un parcours dont rien ne s'exécute — exactement
   le parcours bidon que ce module existe pour attraper.
2. `classify` rendait `parse-error` pour toute étape sans assertion collectée, et le
   message de `verifyAllGreen` en concluait que le fichier de test était mal formé. La
   spécification d'origine (D30) supposait que la collecte ne peut échouer que sur le code
   de l'étudiant. C'est faux : la config Vite, un plugin ou le runner la cassent tout aussi
   bien.
3. Le diagnostic était détruit : le message ne gardait que la première ligne, le rapport
   temporaire était supprimé, et la stderr du process était réduite à ses cinq dernières
   lignes — or la ligne qui nomme la cause est en **haut** d'une stack.

**Décision.**

*Rouge se prouve.* `verifyAllRed` n'accepte une étape que dans deux états : `assertion-failed`
(des tests ont été collectés et ils échouent) et `missing-file` (le fichier que l'étape
demande d'écrire n'existe pas encore, ce qui est l'état normal avant l'exercice). Tout le
reste est un échec de vérification **distinct**, avec son propre message : « aucun test de
l'étape X n'a été collecté ; rien ne s'est exécuté, donc rien ne prouve que l'étape échoue ».

*On ne nomme pas un coupable qu'on ne connaît pas.* `parse-error` devient `collect-error`,
qui ne dit que ce qu'on sait. Le nom précédent affirmait la cause. Vérifié sur deux vraies
sorties Vitest, le texte de l'erreur ne permet pas de trancher : un fichier de test mal formé
(`__fixtures__/test-mal-forme`) et un fichier *importé* mal formé (`b-syntaxe-invalide`)
produisent le **même** message, `Failed to parse source for import analysis…`, sans aucun
chemin. Lire ce texte pour désigner un fichier, c'est deviner.

La seule séparation honnête ne vient pas du texte mais du **run** : si une autre étape du
même run a reçu un verdict, l'outillage marche et la cause est locale à ce fichier de test
ou à ce qu'il importe ; si aucune étape n'a été évaluée, la cause est partagée — config,
plugin, runner, ou un import commun — et on ne désigne personne. C'est `cause()` dans
`verify.ts`, et c'est calculé là parce que c'est le seul endroit qui voit toutes les étapes.

*La stack survit.* `RawResult` porte désormais la stderr du process, entière (bornée à
32 ko **en queue**, pas en tête). En cas d'échec de vérification, tout part dans
`.learn/verify.log` — message complet de chaque étape fautive, puis la stderr — et le
message d'erreur donne ce chemin. Le rollback de l'import le préserve, pour la même raison
que le fichier de parcours (D28) : le message le nomme, il ne doit pas pointer un fichier
mort.

**Trois bugs trouvés en appliquant la décision**, tous du même genre — une seule formulation
connue là où le réel en a plusieurs :

- **`Failed to resolve import "<spec>" from "<fichier>"`** est ce que produit **Vite 8** pour
  un fichier pas encore écrit. `classify` ne connaissait que `Cannot find module`. Sur cette
  pile, chaque étape non commencée sortait donc en erreur de collecte au lieu de « pas encore
  commencée » — l'étudiant voyait « le fichier n'est pas encore valide » et un message brut de
  Vite dès l'ouverture d'une étape, ce que UX.md interdit. Fixture réelle :
  `h-import-non-resolu-vite8.json`.
- **`Cannot find package '<spec>'`** est ce que produit Vite quand un **alias** du projet
  pointe un fichier absent : la résolution retombe sur node, qui prend le spécificateur pour
  un paquet. Même cause, troisième formulation.
- Un spécificateur d'**alias** (`@lib/calc.js`) ne se compare pas à `expected.files` par
  résolution de chemin — on ne connaît pas la table d'alias. On compare les noms de fichier.
  C'est lâche, mais le pire cas est bénin (« étape pas commencée » au lieu d'une erreur), alors
  que ne rien faire refuse un parcours valide. En contrepartie, `missing-file` porte désormais
  le spécificateur non résolu dans un champ à part, `missing` — **hors** de `message`, qui
  reste vide parce que l'étudiant n'a rien à lire sur une étape pas commencée. `verifyAllGreen`
  s'en sert : une fois la solution écrite, « introuvable » ne veut plus dire « pas encore
  écrit » mais « ne se résout pas », et le nom de l'alias est alors tout le diagnostic.

**Conséquences.** Un message vague est meilleur qu'un message faux : le faux envoie chercher
au mauvais endroit, ce qui vient de coûter trois essais. Les messages de `verify.ts` ne
mettent plus la solution en cause quand rien ne prouve qu'elle l'est. D30 reste valide dans
son intention — séparer les diagnostics — mais sa mise en œuvre affirmait plus que ce que les
données permettent ; c'est ce que D33 corrige.

## D34 — La solution s'affiche dans le panneau, elle ne s'écrit plus sur disque

**Bug remonté en usage réel, avec perte de données silencieuse.** Le bouton « Solution »
écrivait le fichier de l'étape. Or l'utilisateur a presque toujours une tentative en cours
dans l'éditeur : VSCode ne recharge pas un buffer modifié. Il ne voyait donc pas la
solution, et sa sauvegarde suivante écrasait ce qu'on venait d'écrire. On lui faisait perdre
du contenu sans le prévenir — et la confirmation, en annonçant l'écriture, ne prévenait pas
de *ça*.

**Décision : la solution est affichée, l'utilisateur la recopie.** Un bloc par fichier quand
l'étape en touche plusieurs — chemin en en-tête, code coloré, un bouton « Copier » par
fichier. Recopier fait passer le code par les yeux et les doigts ; un fichier rempli tout
seul ne le fait pas. Le bug de perte de données est le motif, mais l'effet pédagogique est
le bon côté du compromis, pas une consolation.

**Ce qui disparaît avec l'écriture** : le risque d'écraser un fichier, la confirmation qui
annonçait cette écriture, et le `ResolvedPath` sur ce chemin. Le clic ne calcule plus aucun
chemin dans le projet de l'utilisateur — la clé du fichier ne sert qu'à lire
`step.solution`, jamais à construire un chemin. `applySolution` est remplacé par
`revealCurrentSolution`, qui n'écrit plus que `.learn/state.json`. La règle 3 d'`AGENTS.md`
n'a plus d'exception.

**`planSolution` reste**, et reste testé : `verifyAllGreen` l'utilise pour appliquer les
solutions dans sa copie temporaire du workspace (D21). C'est désormais le seul chemin qui
écrit une solution sur disque, et il ne vise jamais le projet réel.

L'étape reste marquée révélée dans le state, et le récapitulatif de fin est inchangé : pas
de pénalité, juste une information honnête.

**Coloration syntaxique sans dépendance.** Aucune nouvelle dépendance runtime (règle 6) :
un tokenizer d'une seule expression régulière dans `render.ts`, quatre catégories
(commentaire, chaîne, nombre, mot-clé), et les couleurs prises dans les variables du thème
(`--vscode-symbolIcon-*`), donc correct en thème clair, sombre et contrasté. Il couvre la
famille JS/TS, celle des parcours ; ailleurs le code sort échappé sans couleur, ce qui reste
lisible. Le compromis est marqué par un commentaire `ponytail:` à côté du tokenizer.

**La copie passe par l'extension**, pas par `navigator.clipboard` : `vscode.env.clipboard`
marche partout, y compris là où la webview n'a pas la permission, et ça évite d'accorder
quoi que ce soit de plus à la webview.

**Non-régression.** `reveal.test.ts` vérifie qu'après un clic sur « Solution », le fichier
de l'utilisateur est intact mot pour mot et que l'arborescence du projet ne contient rien
d'autre que `.learn/state.json` et ce qui existait déjà.

---

## D35 — Le panneau vit dans la barre d'activité, avec un état d'accueil

**Problème.** Friction remontée en usage réel : tout passait par la palette de commandes.
L'extension n'avait d'icône nulle part. Pour la découvrir, l'ouvrir, relancer les tests ou
réinitialiser, il fallait déjà connaître le nom d'une commande — y compris au tout premier
usage, celui où on ne sait justement rien.

**Décision : une vue de la barre d'activité (`WebviewViewProvider`) à la place de l'onglet
d'éditeur (`WebviewPanel`).** Un conteneur `learnpath` dans `viewsContainers.activitybar`,
une vue `learnpath.parcours` de type `webview`. L'icône est un SVG monochrome
(`media/activity-bar.svg`) teinté par le thème, comme toutes les icônes de cette barre.

Ce que ça change dans le code, et rien de plus :

- `ParcoursPanel` implémente `WebviewViewProvider` et s'enregistre une fois à l'activation.
  Le fournisseur vit toute la session, la webview va et vient : le dernier message rendu est
  gardé et repoussé sur `ready`, ce qui remplace exactement ce que faisait
  `retainContextWhenHidden` sur l'ancien panneau (l'option existe aussi ici, elle est
  gardée).
- **Non-vol du focus, inchangé.** `ParcoursPanel.show()` appelle `learnpath.parcours.focus`
  avec `{ preserveFocus: true }` — c'est la forme équivalente à l'ancien `preserveFocus` de
  `createWebviewPanel` / `reveal`. L'ouverture automatique à l'activation passe par là.
- **Un état d'accueil**, rendu par `renderWelcome()` dans `render.ts`, donc testé hors
  `vscode` comme le reste. Deux lignes sur ce que fait l'extension, un bouton « Importer un
  parcours » et un lien vers le prompt de génération du README. Le bouton envoie un message
  `import` : le panneau le traite lui-même en appelant la commande, parce qu'à ce
  moment-là il n'y a aucune session à qui l'adresser.
- **Relancer et Réinitialiser dans le titre de la vue**, via `menus.view/title` — pas de
  boutons en HTML : les actions de titre sont natives, gratuites, et déjà accessibles au
  clavier. Elles sont conditionnées par un contexte `learnpath.active`, posé dans
  `setActive()` au même endroit que l'ouverture de session.
- Supprimer le parcours ne ferme plus rien (une vue ne se ferme pas) : elle repasse à
  l'accueil. `ParcoursPanel.dispose()` disparaît, il n'avait plus de sens.

**Ce qu'on ne fait pas.** Pas de `viewsWelcome` : il ne s'applique qu'aux vues arborescentes,
pas aux vues webview. L'accueil est donc du HTML, ce qui n'ajoute rien — la coquille, la CSP
et le script sont déjà là et ne bougent pas.

**Les commandes de la palette restent, toutes les quatre.** `learnpath.open` ne renvoie plus
d'erreur quand il n'y a pas de parcours : elle révèle la vue, qui montre l'accueil, d'où on
importe. C'est le seul endroit où un message d'erreur disparaît, et il était devenu faux.


---

## D36 — Refaire une étape : git plutôt qu'un versionnement maison, et une écriture bornée

**Le besoin.** Refaire une étape déjà validée, avec le code tel qu'il était **avant** elle.
Sans ça, se tromper de chemin sur une étape est définitif : le seul recours était de
réinitialiser le parcours entier.

**Décision : on s'appuie sur git, on ne réimplémente pas un versionnement dans `.learn/`.**
Un dossier de sauvegardes maison aurait été une deuxième source de vérité à garder cohérente
avec le disque, sans reflog, sans `diff`, sans outillage. Le projet de l'utilisateur en a
déjà un.

### La forme des commits

Le point sensible n'est pas de commiter, c'est de commiter **sans emporter autre chose**.
L'utilisateur a presque toujours du travail en cours ailleurs — c'est le principe même de
l'extension, elle joue dans son vrai projet. Donc :

- **jamais `git add -A`**, jamais un commit qui ramasse l'index tel qu'il est ;
- un commit par étape validée, contenant **uniquement les `expected.files` de l'étape** ;
- il est fabriqué dans un `GIT_INDEX_FILE` temporaire (`read-tree` → `add -f` → `write-tree`
  → `commit-tree`), donc **`HEAD`, la branche, l'index et l'arbre de travail ne bougent
  pas**. `git status` et `git log` sont identiques avant et après ;
- il est rattaché au commit de l'étape précédente, et posé sur `refs/learnpath/<slug>/<id>`
  avec `--create-reflog`. Une référence par étape : ça n'entre ni dans `refs/heads`, ni dans
  `refs/tags`, donc ni dans `git log`, ni dans la liste des tags. La chaîne part de
  `refs/learnpath/<slug>/base`, qui est le `HEAD` du moment de l'import.

**L'historique n'est jamais réécrit.** Pas de `reset`, pas de `rebase`, pas de
`commit --amend`, aucun commit annulé. Refaire l'étape N, c'est
`git restore --source=<référence d'avant N> --worktree -- <expected.files de N>` — `restore`
et non `checkout`, parce que `checkout <tree-ish> -- <chemin>` écrit aussi dans l'index de
l'utilisateur, et on n'y touche pas.

### L'arbitrage assumé : une écriture hors de `.learn/`

D34 venait de supprimer la dernière écriture dans le code de l'utilisateur. Celle-ci la
réintroduit, en connaissance de cause. Elle est bornée par trois choses, dans cet ordre :

1. les chemins viennent des `expected.files` de l'étape visée, jamais de la webview — le
   `stepId` du message est comparé aux étapes validées du parcours, et rien d'autre n'en est
   tiré ;
2. chaque chemin repasse par `safeResolve` contre la racine réelle, comme partout ailleurs ;
3. le plan (`planRedo`) est calculé avant toute écriture, et c'est **lui** qui est affiché
   dans la confirmation.

La règle 3 d'`AGENTS.md` et la section correspondante du `README` sont mises à jour : « rien
hors de `.learn/` » devient « rien hors de `.learn/` sans un geste explicite, et jamais hors
de la liste montrée ». Un test de non-régression compare l'arborescence complète du projet
avant et après une reprise : seuls le fichier de l'étape et `.learn/state.json` diffèrent.

### Le buffer non sauvegardé — le bug de D34, traité avant l'écriture

VSCode ne recharge pas un éditeur modifié. Écrire un fichier ouvert et sale, c'est
exactement le bug de D34 : l'utilisateur ne voit pas la restauration, et sa sauvegarde
suivante l'écrase.

**Décision : on sauvegarde les éditeurs concernés d'abord, et on le dit dans la
confirmation.** L'ordre exact est : plan → confirmation (qui nomme les fichiers modifiés non
sauvegardés) → `document.save()` sur ceux-là → instantané de l'état actuel sous
`refs/learnpath-backup/<slug>/<id>-<horodatage>` → restauration → state.

Refuser tant que l'éditeur est sale aurait été plus simple et plus mauvais : l'utilisateur a
justement une tentative en cours, c'est la situation normale de qui veut refaire l'étape.
Sauvegarder **avant** l'instantané est ce qui rend vraie la phrase « git rattrape tout » :
sans ça, la dernière tentative n'existait nulle part et disparaissait pour de bon.

### La confirmation

Modale, avant toute écriture, et elle dit la vérité fichier par fichier : ceux qui sont
réécrits, et ceux qui sont **supprimés** — un fichier créé par l'étape n'existait pas avant
elle, l'annuler c'est le retirer. Elle nomme aussi les modifications non sauvegardées, dit
que la progression repart à cette étape, et où est le point de restauration. C'est
destructif du point de vue de l'utilisateur, même si git le rattrape.

### Quand ça ne peut pas marcher, on le dit avant le clic

Les conditions sont vérifiées **au début de l'import**, avant la moindre écriture — le
`.gitignore` est un fichier suivi et le setup va toucher le lock du gestionnaire de paquets,
donc c'est le seul instant où l'arbre décrit encore l'état de départ. Sans dépôt git, sans
commit initial, avec un arbre sale, ou avec des identifiants d'étape que git refuse comme
nom de référence, **la référence de base n'est pas posée**. Son absence est le seul marqueur
nécessaire : rien de plus n'est stocké dans `state.json`, et la vue de relecture affiche la
raison à la place du bouton. Personne ne clique sur quelque chose qui échouera.

### L'option, activée par défaut

`learnpath.gitCheckpoints`. Commiter dans le dépôt de quelqu'un est nouveau et sensible :
coupée, LearnPath ne crée aucun commit et « Refaire l'étape » est indisponible, avec la
raison affichée. Elle est relue à chaque geste, pas au chargement.

### Ce qui reste volontairement simple

Refaire l'étape N alors qu'on était rendu à M > N ne restaure **que** les fichiers de N. Les
étapes N+1…M restent écrites : dès que N repasse au vert, la progression réenchaîne
jusqu'à M. C'est le comportement littéral de « refaire l'étape N », et ça évite qu'une
confirmation annonce les fichiers de quatre étapes.

Une étape validée pendant que les points de restauration étaient indisponibles casse la
chaîne : on ne fabrique pas un commit qui ferait croire à un état d'avant qui n'a jamais
existé. La reprise de l'étape suivante se dit alors indisponible, avec cette raison-là.

### Un effet de bord corrigé au passage

Un run annulé écrivait quand même le state s'il avait avancé : `runCurrentStep` écrivait
avant que `runOnce` ne regarde le signal. Sans conséquence visible jusqu'ici (le run suivant
repartait du même endroit), mais une reprise d'étape pouvait se faire réécrire par un run
lancé avant elle. `runCurrentStep` n'écrit plus quand le signal est annulé, et le watcher
annule la boucle dès la confirmation acceptée.

### Navigation : relire et refaire sont deux choses

Voir `UX.md`. Relire est en lecture seule et ne touche à rien ; refaire restaure des
fichiers. Le bouton « Refaire » n'existe que dans l'écran de relecture, dans son propre
encadré, à l'écart de la navigation, avec un libellé qui se termine par des points de
suspension — un clic ouvre une boîte, il ne restaure rien.

### Tests

Dépôt git temporaire réel, jamais de faux `git` : un faux prouverait seulement que le faux
fait ce qu'on lui a dit. `src/core/redo.test.ts` vérifie le commit par étape et son
rattachement, le fait que le travail non commité ailleurs n'entre ni dans le commit ni dans
l'index, la restauration limitée aux bons fichiers, la suppression d'un fichier qui
n'existait pas, l'instantané de sauvegarde, l'historique inchangé (`HEAD`, `log`, branche,
reflog), le projet sans git, le dépôt sans commit, l'arbre sale à l'import, et l'option
coupée.

---

## D37 — Le prompt de génération est composé par l'extension, depuis une source unique

**Le problème, constaté.** Le prompt existait en **deux exemplaires divergents** — un dans
`SPEC-PARCOURS.md`, un dans le `README` — que l'utilisateur recopiait à la main dans son
agent. Un parcours a fini par être généré avec une version périmée. Ce n'est pas un
accident : deux copies d'un texte que personne ne diffe finissent toujours par diverger, et
la copie manuelle ne donne aucun moyen de savoir laquelle on a prise.

**Décision : une seule copie, `prompts/generer-parcours.md`, et c'est l'extension qui
compose.** Le fichier est livré dans le paquet (il n'est pas dans `.vscodeignore`) et lu à
l'exécution depuis `context.extensionUri`. La spec et le README n'en gardent **aucun
double** : ils y renvoient. Le code de la webview non plus.

Le gabarit porte trois marqueurs, `{{FONCTIONNALITE}}`, `{{NIVEAU}}` et `{{FICHIERS}}`.
`composePrompt` (`src/core/prompt.ts`, sans `vscode`, testé contre **le fichier livré**) les
substitue et **refuse un gabarit dont un marqueur reste** : un champ renommé se voit à la
composition, pas dans le presse-papiers de quelqu'un. La substitution passe par une fonction
de remplacement et jamais par une chaîne — un `$&` tapé dans le formulaire serait sinon
interprété par `String.replace`.

### Le prompt est affiché en entier et modifiable

Ce point n'est pas négociable, et il commande la forme de l'écran. Un formulaire qui compose
le prompt **sans le montrer** retire toute prise à l'utilisateur le jour où le résultat le
déçoit — précisément le moment où il en a besoin. Le prompt composé s'affiche donc dans une
zone de texte éditable, et le bouton « Copier » copie **le contenu de la zone**, retouches
comprises, par `vscode.env.clipboard` comme le bouton « Copier » de la solution.

### Un onglet à part, pas la vue du parcours

La vue du parcours est repeinte à chaque run de tests (`postMessage` → `innerHTML`). Un
formulaire posé dedans perdrait la saisie en cours à la première sauvegarde de
l'utilisateur. Le générateur est donc un `WebviewPanel` d'éditeur, indépendant, avec la même
CSP (`default-src 'none'`, style et script au nonce) — un seul à la fois, un second appel le
révèle au lieu d'en ouvrir un autre.

Corollaire assumé : c'est un **geste récurrent, pas d'onboarding**. On génère un parcours par
fonctionnalité, donc la commande reste disponible avec un parcours en cours — c'est la seule
entrée du titre de la vue qui n'est pas conditionnée à `learnpath.active`.

### Projet non reconnaissable : on le dit, on ne bloque pas

Sans `package.json`, un bandeau signale que LearnPath ne joue que des parcours Vitest, et le
formulaire fonctionne quand même. Un dossier peut recevoir son `package.json` à l'étape
suivante ; ce n'est pas à un formulaire de prompt d'en décider, et une porte fermée ici ne
protège de rien — l'import, lui, valide pour de bon.

**Ce qui n'est pas fait.** Aucun appel de modèle, évidemment (règle 1) : l'extension compose
du texte et le met dans le presse-papiers, l'agent reste celui de l'utilisateur. Pas
d'historique des prompts composés, pas de préremplissage depuis le parcours en cours : à
rouvrir si quelqu'un le demande.

---

## D38 — Supprimer une session conserve les parcours JSON générés

**Problème.** Le second choix de `learnpath.reset` supprimait `.learn/` en entier, y compris
le JSON produit en amont par l'agent. Progression, tests, config et caches sont
reproductibles à l'import ; le parcours ne l'est pas sans payer une nouvelle génération.

**Décision.** « Supprimer le parcours (garder le JSON généré) » supprime tout le contenu de
`.learn/` sauf les fichiers ordinaires `.learn/parcours/*.json`. Sans JSON à garder,
`.learn/` disparaît entièrement. Une erreur de lecture de `parcours/` arrête le nettoyage :
elle n'est jamais assimilée à un dossier vide, car la priorité est de ne pas perdre le
fichier coûteux.

Le `state.json` disparaît bien : aucun parcours conservé ne redevient actif tout seul. Le
message final donne son chemin et demande une réimportation explicite. Aucun autre fichier,
même placé dans `.learn/parcours/`, n'est conservé.

---

## D39 — Python : pytest comme deuxième runner, derrière le même `RawResult`

**Contexte.** « pytest, pour ouvrir à Python » était la première priorité après le v1
(`IMPLEMENTATION_PLAN.md`). Tout le produit repose sur une chaîne runner → `RawResult` →
`classify` → UI, et sur des garanties (D3, D5, D14, D21, D25, règle 3) écrites pour Vitest.
La question n'était pas « lancer pytest » mais « tenir les mêmes garanties en Python ».

**Décision.** `runner.kind` admet `"pytest"`. Un seul aiguillage, `src/runner/run-tests.ts`,
branché là où `run` de Vitest l'était (`verify.ts`, `progression.ts`). Tout ce qui est en
aval — `classify`, `humanize`, view model, panneau, git, reprise d'étape — reste commun.

### Le rapport : JUnit XML natif, lu sans dépendance

pytest n'a pas de reporter JSON intégré ; `pytest-json-report` serait un paquet de plus à
installer chez l'utilisateur, et un plugin maison dans `.learn/` dépendrait du chargement des
`conftest.py`, qui varie selon les versions. `--junitxml` existe depuis toujours et ne
demande rien. Le format étant produit par pytest (pas de CDATA, `<testcase>` à plat),
`src/runner/junit.ts` le lit par expressions régulières plutôt qu'avec un parseur XML en
dépendance runtime (règle 7). Il retourne le même `RawResult` que `parse.ts`.

### Le filtre : le fichier, pas le nom

Vitest filtre avec `-t "step <id>"` sur le nom du `describe`. pytest n'a pas de `describe`, et
`-k` ne tolère ni espace ni point. L'étape Python **est son fichier** : on passe les fichiers
des étapes jouées, et `runPytest` préfixe chaque test par `step <id> › ` d'après le fichier
dont il vient. `classify` n'a donc pas de cas Python pour rattacher un test à une étape.
`tests.grep` reste exigé (`step <id>`) : un seul format, un seul schéma.

Conséquence imposée : le fichier de test doit être un **nom de module Python** (`test_step_1_1.py`).
pytest l'importe comme module, et une erreur de collecte n'est rapportée que sous son nom
pointé (`.learn.tests.test_step_1_1`) — un point dans le nom rendrait la correspondance
ambiguë. `parcours.ts` refuse le reste en proposant le bon nom.

### L'isolement (D3, D25, règle 3)

- `-c .learn/pytest.ini` : pytest ne lit que ce fichier. Vérifié par un vrai run : un
  `pytest.ini` du projet avec un `addopts` invalide et un `conftest.py` qui lève à la racine
  n'empêchent ni l'import ni les runs — la recherche des conftest s'arrête au dossier de
  l'ini. `PYTEST_ADDOPTS` est retiré de l'environnement du processus.
- `pythonpath = ..` dans l'ini : **relatif au dossier de l'ini**, mesuré, pas au `rootdir`.
- `-p no:cacheprovider` et `PYTHONDONTWRITEBYTECODE=1` : sans eux, chaque run écrit
  `.pytest_cache/` et `__pycache__/` **à côté du code de l'utilisateur**. Plutôt que de les
  enfermer dans `.learn/` comme le cache de Vite, on ne les écrit pas du tout : rien à
  ignorer, rien à nettoyer.

### La collecte : le piège qui aurait tout rendu rouge

1. **pytest interrompt la session** à la première erreur de collecte. Or une étape pas
   commencée est une erreur de collecte : les étapes précédentes n'étaient plus exécutées et
   passaient pour des régressions. `--continue-on-collection-errors` est obligatoire.
2. **`from panier import ajouter_article` échoue à la collecte** dès que `panier.py` existe
   sans la fonction (`cannot import name`), là où JavaScript échoue à l'exécution
   (`is not a function`). Sans traitement, chaque étape après la première commençait par
   « le fichier n'est pas encore valide ». `classify` range donc `No module named '<m>'` et
   `cannot import name '<n>' from '<m>'` en `missing-file` **quand `<m>` correspond à un
   fichier de `expected.files` de l'étape** — même règle que pour les modules JS, même
   tolérance que pour les alias. Un import circulaire (« partially initialized module ») ou
   un paquet tiers absent reste une vraie erreur.

### L'interpréteur, et le setup

Ordre : `.venv/` puis `venv/` du projet, `VIRTUAL_ENV`, puis le Python du PATH (sans les alias
`WindowsApps` du Microsoft Store, qui existent sur le disque et ouvrent le Store). Dans le bac
à sable de `verifyAllGreen`, qui ne copie pas `.venv` (D26), l'interpréteur est cherché dans le
vrai projet (`projectRoot`).

Liste blanche du setup **par runner** (D8) : `pip`, `pip3`, `uv`, `poetry`, et `python` limité à
`-m venv <dossier>` (chemin validé par `safeResolve`) et `-m pip …` — `python` seul exécute
n'importe quoi. `pip` du parcours s'exécute en `<python du projet> -m pip` : le `pip` du PATH
installerait dans un autre Python que celui des tests, et un Python système récent refuse
(PEP 668). `python -m venv` part du Python système — recréer un venv avec son propre
interpréteur échoue sous Windows — et n'est pas rejoué si l'environnement existe.

**Vérifié.** Fixtures JUnit réelles (`src/runner/__fixtures__/pytest/`, pytest 9.1.1), et de
vrais runs dans `src/runner/pytest.test.ts` : import complet de l'exemple (rouge puis
solutions vertes), boucle de jeu jusqu'à l'étape 1.3 avec régression, config du projet
ignorée, paquet `app/panier.py`, solution régressive refusée, aucun cache écrit. Hors suite,
un import avec le vrai setup (`python -m venv .venv`, `pip install pytest`) puis un
réimport qui ne recrée pas le venv. La CI installe pytest et pose
`LEARNPATH_REQUIRE_PYTEST=1` pour que ces tests ne soient jamais sautés en silence.

**Ce qui n'est pas fait.**
- `humanize` ne découpe pas `assert a == b` en « obtenu / attendu » : rien n'y dit lequel est
  l'attendu (règle 3 de `humanize`).
- Pas de réglage `learnpath.pythonPath` : l'ordre ci-dessus couvre les cas mesurés. À ajouter
  sur un vrai cas (conda, pyenv sans venv…), en le passant de `extension.ts` au noyau.
- Les plugins pytest installés dans l'environnement restent chargés (autoload) : les couper
  casserait `pytest-asyncio` pour un parcours qui en a besoin. Un plugin qui exige sa config
  (pytest-django) cassera les runs ; à traiter s'il remonte.
- `runner.cwd` différent de `.` n'est pas plus essayé en vrai côté Python que côté Vitest.

---

## D40 — Chaque étape montre la syntaxe : les exemples résolus

**Le problème, constaté sur un vrai parcours.** Un parcours React de huit étapes
(`stock-movements-react`) a été joué par un étudiant qui découvrait React et TypeScript. Il
a dû afficher la solution **à chaque étape**. Les explications étaient justes, mais elles
ne disaient que le *pourquoi* (« un composant contrôlé, React est la source de vérité ») :
aucun code, parce que la spec et le prompt l'interdisaient (« Le POURQUOI, jamais le
code »). Entre l'explication et la solution complète, il n'y avait rien. On ne devine pas
une syntaxe qu'on n'a jamais vue. La règle venait d'une bonne intention — ne pas donner la
réponse — mais elle confondait la réponse et la syntaxe.

**Décision : un champ `steps[].examples`, obligatoire à l'import.** De un à trois exemples
par étape, chacun `{ title, code, explanation? }` : la syntaxe exacte dont l'étape a besoin,
écrite et fonctionnelle, **sur un autre sujet que l'étape**. L'étudiant voit
`const [n, setN] = useState(0)` sur un compteur, puis l'écrit lui-même pour son formulaire.
C'est la méthode de l'exemple résolu : voir, puis transposer.

Le panneau les affiche juste après l'explication, colorés (JS/TS, et désormais Python), avec
leurs notes en markdown sous le code.

### Un exemple ne doit pas être la réponse

Le risque inverse est réel : un générateur pressé met la solution dans l'exemple. L'import
le refuse (`copiesSolution`, `src/core/pedagogy.ts`) : quand plus de la moitié des lignes
« parlantes » d'un exemple (significatives, hors imports, 12 caractères au moins, trois au
minimum) se retrouvent telles quelles parmi les lignes que la solution de l'étape
**ajoute**. Heuristique assumée et marquée : un exemple qui ne fait que renommer les
variables passe entre les mailles. On la durcira si le cas remonte.

### Pourquoi à l'import, et pas dans `loadParcours`

`loadParcours` relit aussi le parcours déjà importé à chaque ouverture du projet. Rendre
`examples` obligatoire dans le schéma aurait rendu injouables, du jour au lendemain, les
parcours importés avant. Le schéma l'accepte donc facultatif ; c'est `checkPedagogy`, appelé
par la commande d'import avant la moindre écriture, qui l'exige. Un vieux parcours se joue,
un nouveau doit enseigner.

---

## D41 — L'échelle d'aide : indice, squelette, solution en diff, et la taille des étapes

**Le problème.** L'aide passait d'un indice d'une ligne au fichier complet (98 lignes à
l'étape 1.4 du parcours cité en D40). Trois défauts : pas de marche intermédiaire, rien pour
voir *ce que l'étape ajoute* dans le fichier, et, une fois la solution vue, plus rien à
chercher. En plus, la règle « environ 15 lignes par étape » n'était vérifiée par personne :
sur ce parcours, une seule étape la respectait, et l'étape 1.6 faisait écrire un formulaire
React complet (56 lignes) d'un coup.

**Décision, en quatre parties.**

1. **Le squelette** (`steps[].scaffold`, facultatif) : le contenu complet du fichier, le code
   des étapes précédentes compris, où la partie de l'étape est remplacée par sa structure et
   des `TODO`. Bouton « Squelette » entre « Indice » et « Solution », sans confirmation (il
   ne donne pas la réponse), noté dans `state.scaffoldsRevealed` et dans le récapitulatif.
   Même règles que la solution : clés dans `expected.files`, chemins passés à `safeResolve`,
   rien n'est écrit, copie par l'hôte — et `loadParcours` refuse un squelette identique à la
   solution. Un `state.json` antérieur sans le champ se relit comme vide.
2. **La solution et le squelette se montrent en diff** quand l'étape modifie un fichier qui
   existait avant elle (`contentBefore` : la dernière solution antérieure qui l'écrit).
   Lignes ajoutées surlignées, lignes retirées barrées, deux lignes de contexte autour et
   « ⋯ » pour le reste ; le fichier complet se déplie à la demande, et « Copier » copie
   toujours le fichier complet. Un fichier créé par l'étape s'affiche entier, un diff
   n'apprendrait rien de plus.
3. **La taille d'une étape est mesurée à l'import** : les lignes que la solution N ajoute ou
   modifie par rapport à la solution N-1, tous fichiers confondus, hors lignes vides et hors
   lignes qui ne font que fermer un bloc (`}`, `)}`, `</tr>`) — sans ça, un composant JSX
   pèse le double de ce qu'il demande. Au-delà de **20**, l'import est refusé et nomme
   l'étape. 20 et non 15 : la spec dit « environ », et les imports et les signatures comptent
   sans être le cœur de l'étape. Les deux parcours d'exemple livrés sont sous la limite.
4. **Le test de l'étape est visible**, replié sous « Ce que vérifie le test » dans le bloc
   « Attendu ». Des détails imposés par le test (`getAllByRole('row')[1]`, un texte exact)
   n'avaient pas à se deviner.

Le diff est un LCS ligne à ligne (`src/core/diff.ts`), sans dépendance : les fichiers
d'exercice font quelques centaines de lignes, O(n×m) y est invisible. Marqué `ponytail:`
pour le jour où ça ne suffirait plus.

**Et un signal honnête.** Quand la solution de l'étape courante **et** celle de l'étape
précédente ont été affichées, le panneau dit, sans juger, que les étapes sont peut-être trop
grosses pour le niveau choisi, et propose de régénérer en « je découvre la syntaxe ». Deux,
pas une : une étape difficile arrive à tout le monde.

---

## D42 — Le périmètre est annoncé, avant et dans le parcours

**Le problème, constaté.** Le même parcours devait couvrir « les trois tâches » d'un plan :
handlers MSW, couche API, hook de chargement, écrans, formulaire, historique. Il n'a couvert
que la logique pure et des composants pilotés par props — ce qui se teste en trois lignes —
et l'a fait **en silence** : l'intro et la dernière étape laissaient croire que tout était
couvert. L'étudiant l'a découvert quatre échanges plus tard. Trois causes : le prompt ne
disait rien du périmètre, le format n'avait nulle part où écrire ce qui était laissé de côté,
et la demande dépassait ce que dix étapes peuvent couvrir.

**Décision.**

- **Champ racine `scope: { covered: string[], notCovered: string[] }`**, exigé à l'import
  (`checkPedagogy`, même raisonnement que D40 sur `loadParcours`). `notCovered` peut être vide,
  mais il doit être là : l'absence d'une liste n'est plus une réponse.
- **Le panneau le montre** : un bloc « À propos de ce parcours » (l'intro, ce qui est couvert,
  ce qui ne l'est pas), ouvert à la première étape et replié ensuite ; et l'écran de fin
  rappelle « Reste à faire, hors de ce parcours » avec le renvoi vers « Générer le prompt ».
  L'intro n'était d'ailleurs affichée nulle part jusqu'ici.
- **Le prompt commence par une étape 0** : découper la demande, estimer le nombre d'étapes,
  et **si elle ne tient pas en dix, ne rien écrire** et proposer un découpage en plusieurs
  parcours, puis attendre. Il interdit de choisir ce qui est facile à tester et nomme les
  outils pour tester ce qui ne l'est pas (MSW, `vi.stubGlobal`, `renderHook`, `MemoryRouter`,
  `monkeypatch`). La réponse finale de l'agent tient en trois lignes : chemin, couvert, non
  couvert.

**Ce qui n'est pas fait.** L'extension ne peut pas vérifier que `scope` est *honnête* — elle
ne connaît pas la demande. Elle garantit qu'il est écrit et qu'il est vu ; l'honnêteté reste
du ressort du prompt.

---

## D43 — Deux niveaux au lieu d'un : la programmation, et le langage

**Le problème.** « débutant / intermédiaire » ne disait pas ce qui compte pour doser l'aide :
on peut être intermédiaire en programmation et découvrir React. C'est le niveau **dans le
langage ou le framework** qui décide s'il faut montrer la syntaxe.

**Décision.** Le formulaire du prompt demande :

- **le niveau en programmation** : débutant, intermédiaire, avancé (`{{NIVEAU}}`) ;
- **le niveau dans le langage ou le framework** : « je découvre la syntaxe », « je connais
  les bases », « à l'aise » (`{{NIVEAU_LANGAGE}}`), **« je découvre la syntaxe » par défaut**
  — le coût d'une aide en trop est une ligne à sauter, celui d'une aide manquante est la
  solution affichée à chaque étape ;
- **ce que l'utilisateur connaît déjà**, facultatif (`{{ACQUIS}}`, ligne effacée si vide,
  comme `{{FICHIERS}}`).

Le prompt traduit chaque niveau de langage en consignes : nombre d'exemples, squelette à
chaque étape ou seulement pour les grosses, taille visée (8 à 15 lignes pour « je découvre
la syntaxe »). `composePrompt` refuse une valeur hors liste dans l'un ou l'autre champ, et
les tests vérifient que chaque niveau proposé par le formulaire est bien expliqué dans le
gabarit livré.

---

## D44 — Le parcours actif est celui que désigne `state.json`, pas le seul fichier du dossier

**Le problème, constaté.** Une fonctionnalité trop grosse pour dix étapes a été découpée,
comme le demande désormais le prompt (D42), en trois parcours rangés dans
`.learn/parcours/` : `1-…-donnees`, `2-…-ecrans`, `3-…-creation`. L'import du premier a été
refusé : « Le dossier .learn/ contient déjà le parcours « 2-…, 3-… ». Réinitialise-le avant
d'importer ». Réinitialiser n'aurait rien changé.

Deux règles se contredisaient :

- le parcours actif était identifié comme **le** fichier JSON du dossier
  (`readImportedParcours` prenait `entries[0]`, dans l'ordre arbitraire de `readdir`), d'où
  un import qui refusait dès qu'un autre `.json` était présent, quel que soit son slug ;
- « Supprimer le parcours » **garde** exprès les JSON générés (D38).

Le cycle d'une série — finir le parcours 1, réinitialiser, importer le 2 — était donc
impossible sans déplacer des fichiers à la main, et le message indiquait une action qui ne
débloquait rien.

**Décision : `state.json` désigne le parcours en cours, par son `slug`, qu'il portait déjà.**

- `readImportedParcours` charge `.learn/parcours/<slug du state>.json`. Sans state lisible,
  ou si ce fichier a disparu, il retombe sur le premier fichier **par ordre alphabétique**
  (tri explicite, plus l'ordre de `readdir`) : c'est le cas de « Réinitialiser » sur un
  state cassé, qui doit continuer de marcher.
- L'import ne refuse plus que s'il existe un **parcours en cours** (state lisible) d'un
  **autre** slug, avec un message qui nomme ce parcours et le geste exact : « Réinitialiser
  le parcours », puis « Supprimer le parcours (garder le JSON généré) ». Réimporter le même
  slug reste permis.
- Les autres fichiers de `.learn/parcours/` sont des archives : ils ne bloquent rien et ne
  sont jamais touchés par l'import, ni par son rollback.

Aucun champ n'est ajouté au format de `state.json` : le slug y était depuis le lot 2. Un
state illisible ne désigne aucun parcours en cours — refuser l'import dans ce cas bloquerait
l'utilisateur derrière un fichier qu'il ne peut pas réparer, alors que la progression perdue
est, par construction, déjà illisible.

**Ce qui n'est pas fait.** Pas de sélecteur « importer un parcours déjà présent dans
`.learn/parcours/` » : le sélecteur de fichiers y mène en deux clics. À rouvrir si les séries
deviennent l'usage courant.

---

## D45 — Une étape sur un fichier existant du projet se mesure contre ce fichier

**Le problème, constaté.** Un parcours sur `Inventaire/frontend` modifiait trois handlers MSW
existants de 3 lignes chacun. L'import refusait : « la solution demande 90 lignes ».
`contentBefore` ne connaissait que les solutions des étapes précédentes et comptait contre
une chaîne vide tout fichier qu'aucune étape n'avait encore écrit — donc le fichier entier.
La règle 6 de la spec parle de ce que l'étape « ajoute ou modifie » ; apprendre sur du vrai
code, c'est justement modifier des fichiers qui existent. Le générateur a dû contourner en
sortant ce branchement du parcours.

**Décision : la base est le fichier tel qu'il est sur le disque au moment de l'import.**
Ordre : dernière solution antérieure, sinon le fichier du projet, sinon vide. L'hôte appelle
`readBaseline` (chemins repassés par `safeResolve`, lecture seule) et passe la table à
`checkPedagogy` ; le noyau n'importe toujours pas `vscode`.

**Écarté : le squelette comme base.** Il contient déjà la structure de l'étape ; mesurer
squelette → solution sous-compte ce qu'écrit un apprenant qui ne l'ouvre pas, et permet de
passer sous la limite en remplissant le squelette.

**La base est figée** dans `.learn/baseline/<slug>.json`, écrite par l'import avec le
parcours. Deux raisons :

- **Le panneau** (diff de D41.2) la relit à l'ouverture de session (`Session.baseline`) : à ce
  moment, le disque contient déjà le travail de l'apprenant, et la référence git de départ
  est optionnelle (D36). Sans base figée — parcours importé avant D45, fichier illisible —,
  elle se lit comme vide et la solution s'affiche entière, comme avant.
- **Un réimport du même slug** part de la base figée et ne complète par le disque que les
  fichiers qu'elle ne connaît pas : il mesure depuis le projet d'origine, pas depuis le
  travail déjà fait. Un réimport annulé ne l'efface pas (le rollback ne retire que ce que cet
  import a créé).

« Supprimer le parcours » vide `.learn/` hors `parcours/` : la base part avec la progression,
et l'import suivant repart du projet tel qu'il est — c'est bien le nouveau point de départ.
