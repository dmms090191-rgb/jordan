/* AIGUILLES — posées DANS la montre, pas sur l'image.
 * ---------------------------------------------------------------------------
 * Le cadran est un cercle vu en biais. Sous une longue focale, sa projection
 * est AFFINE : il existe une matrice 2×2 qui envoie le cercle unité sur
 * l'ellipse du cadran. On la mesure sur quatre index en croix, et on dessine
 * ensuite les aiguilles dans le repère du cadran — jamais dans le repère de
 * l'écran. Elles héritent donc automatiquement de la perspective, de
 * l'écrasement et du cisaillement de la montre.
 *
 * Le relevé donne, pour le master nuit (5120 × 2880) :
 *     12 h → 3839, 762     3 h → 4013, 1067
 *      6 h → 3625, 1304    9 h → 3451,  999
 * Les deux diagonales se croisent au même centre à un pixel près, ce qui
 * valide la mesure. L'angle entre les deux axes vaut 105° et non 90° : le
 * cadran est réellement cisaillé, et une simple ellipse tournée n'aurait pas
 * suffi.
 */

/** Construit le repère du cadran à partir des quatre index cardinaux. */
export function repere({ h12, h3, h6, h9 }) {
  const cx = (h3[0] + h9[0] + h12[0] + h6[0]) / 4;
  const cy = (h3[1] + h9[1] + h12[1] + h6[1]) / 4;
  /* m1 = direction du 3 h, m2 = direction du 6 h, en unités « rayon index ». */
  const m1 = [(h3[0] - h9[0]) / 2, (h3[1] - h9[1]) / 2];
  const m2 = [(h6[0] - h12[0]) / 2, (h6[1] - h12[1]) / 2];
  return { cx, cy, m1, m2 };
}

/** matrix() SVG : la colonne x est m1, la colonne y est m2, l'origine est le centre. */
export function matriceSVG(r) {
  return `matrix(${r.m1[0]} ${r.m1[1]} ${r.m2[0]} ${r.m2[1]} ${r.cx} ${r.cy})`;
}

/* ── dessin d'une aiguille, en unités de rayon-index ─────────────────
   Style dauphine : deux pans qui se rejoignent sur une arête centrale. On
   dessine donc DEUX demi-lames de valeurs différentes — c'est cette cassure
   de lumière, et non un dégradé, qui fait lire du métal plié. */
function lame(long, larg, queue) {
  const g = (x, y) => `${x.toFixed(4)},${y.toFixed(4)}`;
  return {
    gauche: `${g(0, queue)} ${g(-larg, queue * 0.35)} ${g(-larg * 0.42, -long * 0.78)} ${g(0, -long)}`,
    droite: `${g(0, queue)} ${g(larg, queue * 0.35)} ${g(larg * 0.42, -long * 0.78)} ${g(0, -long)}`,
  };
}

/**
 * Rend le SVG des trois aiguilles.
 * @param {object} r      repère du cadran
 * @param {object} t      { heure, min, sec } en unités horaires décimales
 * @param {object} [opt]  couleurs et proportions
 */
export function svgAiguilles(r, t, opt = {}) {
  const {
    /* Une dauphine oppose un pan très clair à un pan franchement sombre.
       Trop proches, les deux se confondaient avec le cadran champagne et les
       aiguilles paraissaient collées sur l'image au lieu d'être posées. */
    or = '#e8c47a', orClair = '#fffaf0', orSombre = '#5c4212',
    bleu = '#26354f', ombre = 'rgba(52,38,12,.55)',
    longH = 0.60, longM = 0.90, longS = 0.98,
  } = opt;

  const ang = { h: t.heure * 30, m: t.min * 6, s: t.sec * 6 };
  const M = matriceSVG(r);

  /* Le décalage d'ombre est exprimé DANS le repère du cadran : l'ombre
     glisse donc sur le cadran comme une vraie ombre, au lieu de flotter. */
  const dOmbre = [0.035, 0.055];

  const aig = (a, L, W, queue, cA, cB) => {
    const l = lame(L, W, queue);
    return `<g transform="rotate(${a})">
      <polygon points="${l.gauche}" fill="${cA}"/>
      <polygon points="${l.droite}" fill="${cB}"/>
    </g>`;
  };
  const aigOmbre = (a, L, W, queue) => {
    const l = lame(L, W, queue);
    return `<g transform="translate(${dOmbre[0]} ${dOmbre[1]}) rotate(${a})">
      <polygon points="${l.gauche}" fill="${ombre}"/>
      <polygon points="${l.droite}" fill="${ombre}"/></g>`;
  };

  /* Bornage au bord du cadran. Le rayon des index n'est pas le rayon du
     cadran : sans masque, la trotteuse débordait sur la lunette et le
     bracelet, ce qui trahit immédiatement une surimpression. Le masque rend
     aussi la longueur des aiguilles tolérante d'un master à l'autre. */
  return `<g transform="${M}" clip-path="url(#bord-cadran)">
    <g filter="url(#flou-ombre)">
      ${aigOmbre(ang.h, longH, 0.058, 0.14)}
      ${aigOmbre(ang.m, longM, 0.044, 0.16)}
    </g>
    ${aig(ang.h, longH, 0.058, 0.14, orClair, orSombre)}
    ${aig(ang.m, longM, 0.044, 0.16, orClair, orSombre)}
    <g transform="rotate(${ang.s})">
      <rect x="-0.008" y="${-longS}" width="0.016" height="${longS + 0.22}" fill="${bleu}"/>
      <circle cx="0" cy="0.17" r="0.030" fill="${bleu}"/>
    </g>
    <circle r="0.055" fill="${or}"/>
    <circle r="0.055" fill="none" stroke="${orSombre}" stroke-width="0.008"/>
    <circle r="0.020" fill="${orSombre}"/>
  </g>`;
}

/** Les filtres à déclarer une fois dans le <defs> du SVG hôte. */
export const DEFS = `
  <!-- stdDeviation est exprimé dans les unités LOCALES : dans le repère du
       cadran, 1 vaut le rayon des index, soit ~280 px. Une valeur de 4 faisait
       donc plus de mille pixels de flou et l'ombre disparaissait entièrement. -->
  <filter id="flou-ombre" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="0.016"/>
  </filter>
  <!-- Exprimé dans les unités du cadran : le clipPath hérite du repère de
       l'élément qui le référence, donc de la matrice de perspective. -->
  <clipPath id="bord-cadran"><circle r="1.10"/></clipPath>`;

/* ── le saphir passe DEVANT ──────────────────────────────────────────
   Sans cela les aiguilles semblent posées sur la photo. Un voile très léger,
   dessiné APRÈS elles et dans le repère du cadran, suffit à les remettre
   sous le verre : c'est le reflet du diffusant sur la glace bombée. */
export function svgReflet(r, opt = {}) {
  const { force = 0.13 } = opt;
  return `<g transform="${matriceSVG(r)}">
    <defs>
      <linearGradient id="glace" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="${force}"/>
        <stop offset=".42" stop-color="#ffffff" stop-opacity="${force * 0.22}"/>
        <stop offset=".62" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g clip-path="url(#bord-cadran)">
      <ellipse cx="-0.30" cy="-0.42" rx="1.15" ry="0.62"
               transform="rotate(-24)" fill="url(#glace)"/>
    </g>
  </g>`;
}

/** Heure de Paris, en unités horaires décimales. */
export function heureParis(date = new Date()) {
  let h, m, s;
  try {
    const p = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date);
    for (const x of p) {
      if (x.type === 'hour') h = +x.value;
      else if (x.type === 'minute') m = +x.value;
      else if (x.type === 'second') s = +x.value;
    }
  } catch (e) { h = date.getHours(); m = date.getMinutes(); s = date.getSeconds(); }
  const ms = date.getMilliseconds();
  const sec = s + ms / 1000;
  return { sec, min: m + sec / 60, heure: (h % 12) + (m + sec / 60) / 60 };
}
