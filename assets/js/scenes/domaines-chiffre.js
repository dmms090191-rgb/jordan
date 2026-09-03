/* Le chiffre fantome de la vitrine.
 * ---------------------------------------------------------------------------
 * La section a besoin de connaitre la famille regardee pour l'ecrire en grand
 * derriere le cadre. Or le script de la section vide et reconstruit .dom__capn
 * a chaque changement : on ne peut rien y accrocher.
 *
 * On observe donc l'attribut que ce script pose deja sur les onglets —
 * aria-selected — et on recopie simplement le numero sur l'element fantome.
 * Aucune logique n'est dupliquee : la verite reste dans domaines.js, on la
 * lit, on ne la recalcule pas.
 */
export function suivreChiffre(section) {
  if (!section) return { destroy() {} };
  const ghost = section.querySelector('.dom__ghost');
  const liste = section.querySelector('.dom__list');
  if (!ghost || !liste) return { destroy() {} };

  const ecrire = () => {
    const actif = liste.querySelector('.dom__item[aria-selected="true"]')
      || liste.querySelector('.dom__item.is-active')
      || liste.querySelector('.dom__item');
    if (actif) ghost.dataset.n = actif.dataset.n || '';
  };

  /* aria-selected et la classe is-active bougent tous deux : on ecoute les
     deux, l'ordre dans lequel le script les pose n'a pas a nous concerner. */
  const obs = new MutationObserver(ecrire);
  obs.observe(liste, {
    subtree: true, attributes: true,
    attributeFilter: ['aria-selected', 'class'],
  });
  ecrire();

  /* ==========================================================================
     LE CHIFFRE EST POSÉ DANS LA MARGE DE LA PAGE, PAS CONTRE LE CONTENEUR.
     --------------------------------------------------------------------------
     Il commençait au bord gauche de `.dom` — 180 px du bord de la fenêtre à
     1920 — alors que ces 180 px étaient entièrement libres. Résultat : un
     chiffre serré contre le média avec toute la marge de page inutilisée à sa
     gauche. Mathématiquement il n'y avait aucun chevauchement ; visuellement
     les deux objets se touchaient presque.

     POURQUOI EN JAVASCRIPT ET PAS EN CSS. La quantité à connaître est la
     distance entre le bord de la FENÊTRE et le bord du CONTENEUR — or ce
     conteneur est le résultat de trois contraintes imbriquées (min(1560px,
     94vw), lui-même borné par le remplissage de la section). Une formule en
     `vw` donnerait la bonne valeur sur certaines largeurs et une valeur fausse
     sur les autres : c'est exactement l'erreur qu'on vient de corriger sur la
     taille. On MESURE donc les deux boîtes, et on pose l'écart.

     Ce décalage ne peut que faire GRANDIR l'espace entre le chiffre et le
     média : on ne déplace le chiffre que vers la gauche, jamais vers lui. La
     garantie de non-recouvrement reste portée par le CSS, qui réserve la zone
     avant que le cadre ne prenne sa largeur. Ceci ne fait qu'améliorer.
     ========================================================================== */
  let placeT = 0;

  /* la marge de sécurité au bord de la fenêtre : jamais collé, jamais perdu */
  const marge = () => Math.round(Math.min(56, Math.max(20, innerWidth * 0.026)));

  const placer = () => {
    /* retiré à cette largeur (tablette, téléphone) : rien à faire */
    if (getComputedStyle(ghost).display === 'none') {
      ghost.style.removeProperty('--dom-ghost-x');
      return;
    }
    /* on repart de zéro pour mesurer la position NATURELLE, sinon on
       empilerait le décalage précédent à chaque redimensionnement. */
    ghost.style.setProperty('--dom-ghost-x', '0px');
    const b = ghost.getBoundingClientRect();
    const vise = marge();
    const decalage = Math.round(b.left - vise);       /* > 0 : on peut le pousser à gauche */
    if (decalage > 1) ghost.style.setProperty('--dom-ghost-x', (-decalage) + 'px');
  };

  const replacer = () => { clearTimeout(placeT); placeT = setTimeout(placer, 80); };

  /* on replace quand la fenêtre change, et quand le cadre lui-même change de
     taille — il commande la mise en page de la section. */
  const cadre = section.querySelector('.dom__frame');
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(replacer) : null;
  if (ro && cadre) ro.observe(cadre);
  addEventListener('resize', replacer, { passive: true });
  /* les polices arrivent après : la largeur du chiffre change avec elles */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placer).catch(() => {});
  placer();

  return {
    destroy() {
      obs.disconnect();
      clearTimeout(placeT);
      if (ro) ro.disconnect();
      removeEventListener('resize', replacer);
    },
  };
}

export default suivreChiffre;
