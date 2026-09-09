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

**Décision.** On écrit `.learn/vitest.config.ts` et on lance avec `--config`. On ne modifie
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
