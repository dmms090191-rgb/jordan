/* La Compagnie de l'Or · Prochaines journées d'expertise
   ------------------------------------------------------------------
   Source de vérité des journées affichées sur la carte de France.
   Aucune journée n'est inventée : tant que ce tableau est vide, la carte
   affiche un état d'attente élégant. Pour publier une journée, ajouter un
   objet au tableau (les coordonnées lat/lon placent le point exactement,
   via la même projection que la carte).

   Champs :
     ville      : nom affiché
     departement: ex. "Bas-Rhin (67)"
     region     : ex. "Grand Est"
     lat, lon   : coordonnées GPS réelles de la ville (degrés décimaux)
     date       : "2026-11-14" (ISO) ou une plage "2026-11-14/2026-11-15"
     lieu       : nom de l'hôtel ou du lieu, si connu (sinon laisser vide)
     creneaux   : ex. "9h30 à 18h30, sans rendez-vous" (si connu)
     statut     : "ouverte"   -> point doré : réservation ouverte
                  "en-cours"  -> point bleu : journée en cours
                  "complet"   -> point gris : complet
   Exemple (à décommenter et adapter avec de vraies données) :
   { ville: "Strasbourg", departement: "Bas-Rhin (67)", region: "Grand Est",
     lat: 48.5734, lon: 7.7521, date: "2026-11-14", lieu: "", creneaux: "", statut: "ouverte" }
*/
window.COMPAGNIE_OR_JOURNEES = [];

/* Siège social (information vérifiée) : Société Or Expert SAS, 8 rue Etienne Richerand, 69003 Lyon */
window.COMPAGNIE_OR_SIEGE = { ville: 'Lyon', lat: 45.7545, lon: 4.8590, label: 'Siège · Société Or Expert SAS' };
