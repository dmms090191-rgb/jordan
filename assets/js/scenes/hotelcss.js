/* hotelcss.js · Carte 2 « Rencontrez votre expert » — scène CSS 3D PURE (aucun WebGL) — tour 3
   Auberge alsacienne d'hiver en vrai volume, posée comme un objet sur le panel de la carte (disque de ciel vignetté, sol qui
   s'évanouit avant le cadre) : façade à colombages sobres (3 panneaux opaques + SVG), murs latéraux, toit à 2 pans, enseigne
   de ferronnerie, porte à double battant qui s'ouvre sur un hall éclairé (tapis, comptoir, lustre) dont la lumière déborde
   sur le parvis ; ombres de contact / portée, village lointain en 2 rangs de maisons, neige discrète.
   Chorégraphie d'entrée : fenêtres en cascade (0.4 → 2.8 s) → porte (2.7 s) + nappe (2.9 s) → dolly (2.6 → 8.8 s) → respiration.
   Caméra : rotation très lente + parallaxe pointeur. Ambiance : fondu .75 s (tokens @property) ou bascule + dip (repli).
   Le module construit le DOM dans `host` et pilote uniquement des classes / variables CSS ; toute la géométrie
   et les looks vivent dans assets/css/scenes/hotelcss.css (namespace .schc-).
   API : createHotelcssScene(host, { reduced, ambiance }) -> { start, stop, setPointer, setAmbiance, destroy } */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, cls, parent, vars) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (vars) for (const k in vars) e.style.setProperty(k, vars[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function svg(cls, viewBox, paths, parent) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', viewBox); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  for (const [d, k] of paths) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); if (k) p.setAttribute('class', k); s.appendChild(p); }
  if (parent) parent.appendChild(s);
  return s;
}
/* générateur pseudo-aléatoire déterministe (flocons reproductibles d'une capture à l'autre) */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* Colombages de la façade (viewBox 400×250 : 1 u = 10 unités) — sobres : poteaux, lisses, 4 écharpes ; chants + porte en .8 */
const FACE_LINES = [
  ['M.5 .5H399.5V249.5H.5Z', 'edge'],
  ['M0 125H400', 'thick'],
  ['M16 0V125M130 0V125M270 0V125M384 0V125'],
  ['M16 30H384M16 86H384'],
  ['M16 125L50 86M130 125L96 86M270 125L304 86M384 125L350 86'],
  ['M150 250V132H250V250', 'edge'],
  ['M157.5 250V140.5H242.5V250', 'edge'],
  ['M0 172H40M104 172H157M243 172H296M360 172H400M0 214H40M104 214H157M243 214H296M360 214H400', 'soft']
];
/* Pignon droit (viewBox 280×415 ; faîte en haut, sablière à y=165, plancher à y=290) : chants en .8 (rampants, arête arrière, base), ossature en .3 */
const SIDE_LINES = [
  ['M1.5 165.6L140 1.5L278.5 165.6V413.5M1.5 413.5H278.5', 'edge'],
  ['M140 0V165M0 165H280', 'soft'],
  ['M58 96H222M70 165L140 96M210 165L140 96', 'soft'],
  ['M0 290H280M28 165V290M252 165V290M140 165V290', 'soft'],
  ['M28 290L50 250M252 290L230 250', 'soft'],
  ['M0 372H105M175 372H280', 'soft']
];
/* Village lointain : maisons [x0, x1, égout %, faîte %] en % de la rangée (corps visible ≥ 40 %, pignons raides, largeurs 5.5–9 %) */
const FAR_A = [[.5, 7.5, 52, 8], [9, 14.5, 58, 20], [16.5, 25, 48, 2], [27, 33, 60, 24], [40, 47, 54, 12], [56, 62.5, 55, 14], [64.5, 73, 46, 0], [75, 80.5, 60, 22], [83, 91, 50, 6], [93, 99.5, 56, 16]];
const FAR_B = [[3, 9.5, 54, 12], [12, 20, 48, 2], [22.5, 28, 60, 22], [63, 70.5, 50, 6], [73, 79, 56, 16], [82, 90, 47, 1], [92.5, 98.5, 58, 20]];
function village(houses) {
  let poly = '0 100%'; const dots = [];
  for (const [x0, x1, e, p] of houses) {
    const xm = (x0 + x1) / 2, w = x1 - x0, ya = e + (100 - e) * .34, yb = e + (100 - e) * .66;
    poly += `,${x0}% 100%,${x0}% ${e}%,${xm}% ${p}%,${x1}% ${e}%,${x1}% 100%`;
    if (w >= 6.5) dots.push([x0 + w * .3, ya], [x0 + w * .7, ya], [xm, yb]); else dots.push([x0 + w * .32, ya], [x0 + w * .68, ya]);
  }
  return {
    clip: `polygon(${poly},100% 100%)`,
    wins: dots.map(([x, y]) => `radial-gradient(calc(var(--u)*.75) calc(var(--u)*.75) at ${x.toFixed(1)}% ${y.toFixed(1)}%,var(--schc-far-win),transparent 70%)`).join(',')
  };
}

export async function createHotelcssScene(host, opts = {}) {
  const reduced = !!opts.reduced;
  const ambiance = opts.ambiance || document.documentElement.dataset.ambiance || 'nuit';

  const root = el('div', 'schc' + (reduced ? ' schc--reduced' : '') + (ambiance === 'jour' ? ' schc--jour' : ''));
  root.setAttribute('aria-hidden', 'true');
  el('div', 'schc-sky', root);
  el('div', 'schc-stars', root);
  const cam = el('div', 'schc-cam', root);
  const par = el('div', 'schc-par', cam);
  const dolly = el('div', 'schc-dolly', par);
  const breath = el('div', 'schc-breath', dolly);
  const world = el('div', 'schc-world', breath);

  // sol (plan masqué, contenu statique) : dallage (joints près du parvis), ombres de contact (façade + pied du pignon droit), ombre portée
  const ground = el('div', 'schc-ground', world);
  el('div', 'schc-ground__pave', ground);
  el('div', 'schc-ground__ao', ground);
  el('div', 'schc-ground__ao schc-ground__ao--r', ground);
  el('div', 'schc-ground__cast', ground);
  // nappe de lumière du hall : plan frère du sol (non masqué, animé) posé 0.12 u au-dessus — la surface masquée du sol reste figée
  const spill = el('div', 'schc-ground__spill', world);
  el('div', 'schc-spill__core', spill);
  // lointain : brume de fond, colline, village (2 rangs de maisons, fenêtres-points qui s'allument avec la cascade), brume avant qui dérive
  el('div', 'schc-haze', world);
  el('div', 'schc-hill', world);
  for (const [cls, houses, wd] of [['schc-far', FAR_A, '2.2s'], ['schc-far schc-far--2', FAR_B, '2.45s']]) {
    const v = village(houses);
    const row = el('div', cls, world); row.style.clipPath = v.clip;
    const w = el('i', 'schc-far__win', row, { '--wd': wd }); w.style.backgroundImage = v.wins;
  }
  el('div', 'schc-haze schc-haze--2', world);

  // bâtiment
  const bld = el('div', 'schc-bld', world);
  const face = el('div', 'schc-face', bld);
  const pl = el('div', 'schc-face__p schc-face__p--l', face);
  el('div', 'schc-face__p schc-face__p--c', face);
  const pr = el('div', 'schc-face__p schc-face__p--r', face);
  el('i', 'schc-glow schc-glow--l', pl, { '--wd': '.4s' });
  el('i', 'schc-glow schc-glow--r', pr, { '--wd': '.4s' });
  svg('schc-svg', '0 0 400 250', FACE_LINES, face);
  const WIN = [ // [classe, --lo (niveau), --gd (période s), --gdl (déphasage s), --wd (délai d'allumage s)]
    ['transom', 1, 9, -3, .5], ['g1', 1, 10, -1, .85], ['g2', .85, 12.5, -6, 1.1],
    ['u2', .38, 13, -7, 1.45], ['u1', 1, 11, -2, 1.75], ['u3', .9, 12, -4, 2]
  ];
  const win = (k, lo, gd, gdl, wd, parent) => {
    const w = el('div', 'schc-win schc-win--' + k, parent, { '--lo': lo, '--gd': gd + 's', '--gdl': gdl + 's', '--wd': wd + 's' });
    el('div', 'schc-win__lit', el('div', 'schc-win__on', w));
  };
  for (const [k, lo, gd, gdl, wd] of WIN) win(k, lo, gd, gdl, wd, face);
  el('i', 'schc-lamp schc-lamp--l', face, { '--wd': '.4s' });
  el('i', 'schc-lamp schc-lamp--r', face, { '--wd': '.4s' });
  el('i', 'schc-mark', face);

  const sideR = el('div', 'schc-side schc-side--r', bld);
  svg('schc-svg', '0 0 280 415', SIDE_LINES, sideR);
  for (const [k, lo, gd, gdl, wd] of [['s3', .95, 11, -2, 2.3], ['s1', .8, 12, -5, 2.55], ['s2', .3, 14, -9, 2.8]]) win(k, lo, gd, gdl, wd, sideR);
  el('div', 'schc-side schc-side--l', bld);
  const roofF = el('div', 'schc-roof schc-roof--f', bld);
  el('i', 'schc-roof__sheen', roofF);
  el('div', 'schc-roof schc-roof--b', bld);
  el('div', 'schc-chim', bld);
  el('div', 'schc-chim schc-chim--s', bld);
  // enseigne en potence (pignon droit, devant, entre les deux niveaux)
  const sign = el('div', 'schc-sign', bld);
  el('i', 'schc-sign__bar', sign);
  el('i', 'schc-sign__strut', sign);
  el('i', 'schc-sign__plate', sign);

  // hall (derrière la façade) puis porte
  const hall = el('div', 'schc-hall', bld);
  el('div', 'schc-hall__back', hall);
  el('div', 'schc-hall__floor', hall);
  el('div', 'schc-hall__wall schc-hall__wall--l', hall);
  el('div', 'schc-hall__wall schc-hall__wall--r', hall);
  el('div', 'schc-hall__counter', hall);
  el('div', 'schc-hall__counter-top', hall);
  el('div', 'schc-hall__bloom', hall);
  el('i', 'schc-hall__lustre', hall);
  const door = el('div', 'schc-door', bld);
  el('div', 'schc-leaf schc-leaf--l', door);
  el('div', 'schc-leaf schc-leaf--r', door);

  // neige : 16 flocons fins (0.25–0.5 u, z ≤ +10 u) + 4 flocons plus proches (0.6–0.8 u, z +12 → +20 u, hors façade), positions déterministes
  const snow = el('div', 'schc-snow', world);
  const rand = rng(20260822);
  const flake = (fx, fz, fs, fo) => el('i', 'schc-flake', snow, {
    '--fx': fx.toFixed(1), '--fz': fz.toFixed(1), '--fs': fs.toFixed(2), '--fo': fo.toFixed(2),
    '--fd': (10 + rand() * 7).toFixed(1) + 's', '--fdl': (-rand() * 17).toFixed(1) + 's',
    '--fdx': (rand() * 10 - 5).toFixed(1), '--fy0': (6 + rand() * 56).toFixed(1)
  });
  for (let i = 0; i < 16; i++) flake(rand() * 110 - 55, rand() * 40 - 30, 0.25 + rand() * 0.25, 0.25 + rand() * 0.25);
  for (let i = 0; i < 4; i++) { const side = i % 2 ? 1 : -1; flake(side * (28 + rand() * 22), 12 + rand() * 8, 0.6 + rand() * 0.2, 0.4 + rand() * 0.1); }

  host.appendChild(root);

  // unité : 1 % de la largeur de l'hôte (suivie en continu)
  const measure = () => { const w = host.clientWidth || 600; root.style.setProperty('--u', (w / 100).toFixed(3) + 'px'); };
  measure();
  const ro = new ResizeObserver(measure); ro.observe(host);

  // ambiance : suit html[data-ambiance] à chaud, en plus de setAmbiance() ; fondu .75 s via @property, sinon bascule + dip d'opacité
  const canTween = typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function';
  let dipT = 0;
  const setAmbiance = mode => {
    const jour = mode === 'jour';
    if (root.classList.contains('schc--jour') === jour) return;
    if (!canTween) { root.classList.add('schc--dip'); clearTimeout(dipT); dipT = setTimeout(() => root.classList.remove('schc--dip'), 380); }
    root.classList.toggle('schc--jour', jour);
  };
  const mo = new MutationObserver(() => setAmbiance(document.documentElement.dataset.ambiance));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });

  // parallaxe pointeur : lissage rAF uniquement tant que la cible n'est pas atteinte
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0, running = false, started = false;
  function tick() {
    raf = 0; if (!running || document.hidden) return;
    const dx = tx - px, dy = ty - py;
    if (Math.abs(dx) < 0.0006 && Math.abs(dy) < 0.0006) { px = tx; py = ty; } else { px += dx * 0.07; py += dy * 0.07; }
    par.style.setProperty('--px', px.toFixed(4)); par.style.setProperty('--py', py.toFixed(4));
    if (px !== tx || py !== ty) raf = requestAnimationFrame(tick);
  }
  const start = () => {
    running = true; root.classList.remove('schc--paused');
    if (!started) { started = true; requestAnimationFrame(() => root.classList.add('schc--in')); }
    if (!raf && (px !== tx || py !== ty)) raf = requestAnimationFrame(tick);
  };
  const stop = () => { running = false; root.classList.add('schc--paused'); if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const setPointer = (x, y) => { if (reduced) return; tx = clamp(+x || 0, -0.5, 0.5); ty = clamp(+y || 0, -0.5, 0.5); if (running && !raf) raf = requestAnimationFrame(tick); };
  const destroy = () => { stop(); clearTimeout(dipT); ro.disconnect(); mo.disconnect(); root.remove(); delete host.dataset.ready; };

  host.dataset.ready = '1';
  return { start, stop, setPointer, setAmbiance, destroy };
}
export default createHotelcssScene;
