# Duel Urgensses

Jeu de dés multijoueur en ligne pour 2 à 6 participants. Chaque joueur utilise son propre navigateur, crée ou rejoint une salle privée, choisit un personnage et joue à tour de rôle. Le nom du personnage sert automatiquement d’identité dans la partie et dans le chat.

## Lancer localement

```bash
npm install
npm start
```

Ouvrir ensuite `http://localhost:3000`. Pour simuler plusieurs joueurs, utiliser plusieurs profils de navigateur ou une fenêtre privée.

## Fonctionnement multijoueur

- serveur Node.js et WebSocket autoritaire ;
- salles privées avec code à cinq caractères ;
- reconnexion grâce à une session enregistrée dans le navigateur ;
- dés adverses masqués ;
- validation serveur des paris, couleurs et tours ;
- 2 à 6 joueurs, dans la limite des 36 dés physiques ;
- interface adaptative pour ordinateur et smartphone.
- application web installable (PWA) sur ordinateur, iPhone et Android ;
- notifications Web Push facultatives pour les nouveaux défis, même lorsque le jeu est fermé ;
- mode organisateur/spectateur : création et lancement sans occuper un siège ni voir les dés cachés ;
- chat commun avec pseudonyme, disponible avant et pendant la partie.

Pour respecter le matériel, `nombre de joueurs × nombre maximal de manches` ne peut pas dépasser 36. Exemples : 4 joueurs peuvent jouer 8 manches, 5 joueurs jusqu’à 7 manches et 6 joueurs jusqu’à 6 manches.

## Règles adaptées

- Minotaure marron → Urgentiste ;
- Griffon vert → Chirurgien ;
- Sirène bleue → Anesthésiste ;
- chaque dé spécial possède 4 faces métier et 2 drapeaux blancs ;
- si les trois symboles apparaissent dans un même pli, l’Urgentiste gagne ;
- entre dés numériques, la plus grande valeur gagne toutes couleurs confondues ; la couleur demandée contraint seulement le choix du dé ;
- aucun retrait de points en cas de pari incorrect et aucun bonus.

## Déploiement Render

Le fichier `render.yaml` configure un service Node.js gratuit dans la région de Francfort. Dans Render, le dépôt peut être déployé comme **Blueprint** ou comme **Web Service** avec :

- Build Command : `npm install`
- Start Command : `npm start`
- Health Check Path : `/`

Le serveur utilise automatiquement la variable `PORT` fournie par Render.

## Notifications Web Push

1. Exécuter `supabase-schema.sql` dans l’éditeur SQL Supabase afin de créer `duel_push_subscriptions`.
2. Générer une paire de clés avec `npm run generate-vapid`.
3. Ajouter dans Render les variables secrètes `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` affichées par la commande.
4. Ajouter `VAPID_SUBJECT=https://duel-urgensses.onrender.com/`, puis redéployer.

Chaque appareil s’abonne volontairement avec le bouton **Activer les alertes**. Sur iPhone/iPad (iOS 16.4 ou ultérieur), le jeu doit d’abord être ajouté à l’écran d’accueil. Les abonnements invalides sont automatiquement supprimés lorsque leur service Push répond `404` ou `410`.
