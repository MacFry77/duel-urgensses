# Duel Urgensses

Prototype local d’un duel de dés médical, basé sur les règles simplifiées fournies.

## Lancer

Ouvrir `index.html` dans un navigateur, ou servir le dossier avec un serveur statique.

## Adaptations

- Minotaure marron → Urgentiste (mallette médicale)
- Griffon vert → Chirurgien (bloc opératoire et bistouri)
- Sirène bleue → Anesthésiste (masque et circuit d’anesthésie)

Chaque dé spécial possède 4 faces métier et 2 faces drapeau blanc, conformément au matériel d’origine.

Si les trois symboles métier apparaissent dans un même pli, l’Urgentiste remporte le pli.

L’organisateur choisit avant la partie entre 1 et 8 manches. La manche numéro N distribue N dés à chaque joueur.
- Aucun retrait de points en cas de pari incorrect
- Aucun point bonus lié aux dés spéciaux

Ce prototype fonctionne en duel local à tours masqués. Le moteur de règles est séparé de l’interface et pourra être relié à Supabase pour des salles privées en ligne.
