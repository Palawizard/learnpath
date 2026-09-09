# Antériorité et contraintes plateforme

Notes de recherche préalables. Elles justifient plusieurs décisions de `DECISIONS.md`,
d'où leur présence dans le dépôt.

## Antériorité : CodeRoad

CodeRoad est une extension VSCode permettant de créer et jouer des tutoriels de code
interactifs dans l'éditeur (JavaScript, Python, Bash, SQL). Le fonctionnement valide notre
mécanique centrale : l'utilisateur sauvegarde un fichier, les tests se lancent
automatiquement, la progression est enregistrée en commit git, et la solution vient de
l'utilisateur et non du tutoriel. freeCodeCamp l'utilise pour son cursus bases de données
relationnelles. CodeRoad filtre les tests par étape via un motif passé au runner.

**Ce qu'on en retient** : la boucle save → test → étape suivante est éprouvée, et le filtre
de tests par étape est la bonne approche.

**Ce qui nous différencie** : les tutoriels CodeRoad sont écrits à la main sous forme de
commits git, un travail considérable qui explique la faible quantité de contenu disponible.
Chez nous le parcours est généré par un agent, à partir de la fonctionnalité que
l'utilisateur veut réellement construire, dans son propre dépôt.

**Ce qu'on ne reprend pas** : le stockage du parcours en commits git. Trop rigide pour du
contenu généré et pour un projet existant qui a déjà son historique.

## Contrainte : accès aux modèles depuis une extension

L'API `vscode.lm` permet à une extension d'utiliser les modèles fournis par les extensions
GitHub Copilot si l'utilisateur a un abonnement. C'est ce que font Cline et Roo Code. Les
modèles Copilot exigent un consentement utilisateur via une boîte de dialogue
d'authentification, donc la sélection du modèle doit partir d'une action initiée par
l'utilisateur.

Limites constatées : aucun contrôle sur les modèles disponibles ni sur les coûts, rate
limits imposés par GitHub, et des bannissements ont été signalés par le passé sur des usages
de proxy intensifs avant l'introduction de ces limites.

Par ailleurs les abonnements Claude ou ChatGPT ne sont pas accessibles par cette voie.

## Contrainte : VSCodium

Le marketplace de Microsoft empêche certaines extensions de tourner sur des builds
non-Microsoft, et Copilot en fait partie ; n'étant pas open source, il n'est distribué que
sur le marketplace Microsoft. VSCodium utilise Open VSX par défaut. Des contournements
existent mais imposent de faire correspondre manuellement les versions de VSIX à celle de
VSCodium, et cassent à chaque mise à jour.

**Conclusion** : toute dépendance à Copilot rendrait la cible VSCodium intenable. D'où D1.
