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
   survit. Test dédié.
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
