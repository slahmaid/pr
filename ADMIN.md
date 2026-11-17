# Publier le catalogue

La page d’administration est ici, une fois le site en ligne :

**https://prumysl.ma/admin**

Elle n’apparaît pas dans le menu, ni dans Google. Enregistrez-la dans les favoris du navigateur que vous utilisez pour le catalogue.

En local, après `node build.mjs`, la même page est servie par `node dev-server.mjs` à l’adresse `http://localhost:4173/admin.html`.

## 1. Créer le jeton GitHub

Le site n’a pas de serveur. Le navigateur écrit directement dans le dépôt `slahmaid/pr`, sur la branche `main`. Il lui faut un jeton personnel fin (fine-grained personal access token).

1. Ouvrez [Générer un jeton fin](https://github.com/settings/personal-access-tokens/new).
2. Nom : `Prumysl catalogue`. Expiration : 90 jours. Il faudra en créer un autre ensuite.
3. **Repository access** : *Only select repositories*, puis uniquement **slahmaid/pr**.
4. **Permissions** → Repository permissions :
   - **Contents** : Read and write (obligatoire, pour enregistrer les articles et les photos).
   - **Actions** : Read-only (pour afficher « en ligne » après la publication).
5. **Generate token**, puis copiez la valeur. Elle commence par `github_pat_` et GitHub ne la réaffichera pas.

Le compte GitHub qui crée le jeton doit avoir le droit de pousser sur `main`.

## 2. Se connecter

Collez le jeton sur la page d’administration, puis **Se connecter**. Il est gardé dans ce navigateur seulement (`localStorage`). **Déconnexion** l’efface. Ne le copiez pas dans un message et ne l’envoyez à personne : avec ce jeton, on peut modifier le dépôt.

## 3. Articles

Le catalogue (environ 6 800 articles, 9 familles) n’est pas écrit dans la page. L’administration le charge, puis n’affiche que **20 articles par page**.

- **Famille** : menu avec le nombre d’articles de chaque famille, dont Transformateurs & alimentation. **Rechercher** filtre par nom. Les deux se combinent. Changer la famille ou la recherche ramène à la page 1.
- La pagination est celle du site public : première page, précédente, numéros avec des ellipses, suivante, dernière, et la phrase « Page X sur Y · N produits ».
- **Nouvel article** : nom, famille (les 9, ou une famille ajoutée ensuite), description, position, photo facultative. L’identifiant (par exemple `cable-r2v`) est créé à partir du nom. Il reste fixe ensuite, pour ne pas casser les listes de devis déjà enregistrées sur les téléphones des visiteurs.
- **Modifier** et **Supprimer** agissent d’abord dans la liste affichée.
- **Monter**, **Descendre**, ou glisser la poignée `⋮⋮` change la place dans la famille, y compris d’une page à l’autre. Une recherche en cours verrouille ce réordonnancement.
- **Projecteur solaire** est protégé : il reste dans Éclairage extérieur et ne peut pas être supprimé. Les caméras et projecteurs de la gamme Prumysl Solaire ne sont pas dans ce catalogue. Ils restent sur la page `prumysl-solaire.html`, que cette administration ne modifie pas.
- Une photo est réduite dans le navigateur (côté le plus long ≈ 1200 px, fichier WebP) puis enregistrée dans `assets/img/produits/<identifiant>.webp`.

**Enregistrer** dans la fenêtre met la fiche à jour dans la liste. Le site public ne change pas encore.

## 4. Familles

Onglet **Familles** : ajouter, renommer, changer l’icône, réordonner. Renommer ne change pas l’identifiant, donc les articles restent rattachés. L’adresse publique `produits-<identifiant>.html` et le fichier `data/produits-<identifiant>.json` non plus.

Une nouvelle famille reçoit un identifiant tiré du nom (lettres minuscules, chiffres, tirets). Le formulaire montre la page et le fichier qui seront créés. Au prochain déploiement, la construction du site génère cette page et ce JSON à partir de `src/data/produits.json`. Une famille qui contient encore des articles ne peut pas être supprimée.

La phrase sur la page Produits (« Neuf familles, un seul fournisseur. » aujourd’hui) suit le nombre de familles au prochain déploiement.

## 5. Publier

Le bandeau **Modifications non publiées** rappelle que rien n’est encore sur le site. **Publier** envoie le catalogue et les photos dans **un seul commit**. Le site ne peut donc pas se construire avec un article sans sa photo, ou l’inverse.

Si quelqu’un a modifié le fichier entre-temps, la publication est refusée, la liste est rechargée depuis GitHub, et un message le dit. Il faut refaire le changement.

Le fichier dépasse 1 Mo. S’il est trop gros pour l’API « contents » de GitHub, la page le lit et l’écrit par l’API git (blobs), qui accepte le catalogue entier. La publication reste un seul commit : `src/data/produits.json` et les photos.

Le déploiement reconstruit le site : une page et un fichier JSON par famille, plus un index de recherche chargé seulement quand un visiteur tape dans le champ. Le fichier `produits.json` reste la source unique des articles.

Ensuite la page suit le workflow *Deploy to GitHub Pages*. Quand il est vert, le lien **Voir le catalogue en ligne** ouvre `https://prumysl.ma/produits`. Comptez en général une minute. Sans la permission Actions, le commit est quand même sur `main`, mais le statut ne s’affiche pas.

Un article sans photo garde le cadre blanc d’aujourd’hui. Un article avec photo l’affiche, avec un texte alternatif égal au nom.

## 6. Essai sans jeton

`admin.html?mock=1` ouvre le même écran. Le catalogue est lu dans `data/produits.json` (produit par `node build.mjs`), pas intégré dans la page. Collez un jeton factice qui commence par `github_pat_` : rien n’est envoyé à GitHub. Utile pour vérifier l’écran, pas pour publier.
