# Projet démo Python

Projet vide servant de bac à sable pour tester l'extension sur un parcours pytest (D39).

Pour tester : ouvrir ce dossier, lancer la commande « LearnPath: Importer un parcours... »
et choisir `../exemple-panier-python.json`. L'import propose `python -m venv .venv` puis
`pip install pytest` (réseau requis pour pip, pas pour l'extension), crée `.learn/` ici et
propose l'étape 1 : écrire `panier.py` à la racine.

Ne pas commiter le `.learn/` ni le `.venv/` générés.
