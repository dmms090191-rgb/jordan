/* scenes/france.js · Carte 1 « Trouvez une journée près de chez vous »
   Petite scène vivante DOM / SVG / CSS (aucun WebGL) : la France se révèle sur un plan incliné en perspective,
   les contours se tracent région par région (sud-ouest → nord-est), les terres s'installent, la tige monte depuis Lyon,
   le point s'allume puis pulse ; ensuite vie au niveau du murmure (flottement, balayage lumineux, parallaxe pointeur).
   Géométrie réelle : REGIONS / project() de france-geo.js. Tout le style suit les tokens d'ambiance (nuit / jour, à chaud).
   API : createFranceScene(host, { reduced, ambiance }) -> { start, stop, setPointer, setAmbiance, destroy }  (voir france.css) */
import { REGIONS, FRANCE_VIEWBOX, project } from '../france-geo.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

/* réseau : quelques villes réelles (lecture seule de window.COMPAGNIE_OR_VILLES, posé par villes-france.js — jamais modifié
   ni importé comme module ici), pour donner une sensation de proximité (« plusieurs villes près de vous », pas seulement
   le siège). Absent en dehors de la page réelle (ex. lab isolé) -> aucun point, aucune erreur. */
/* villes bien à l'intérieur des terres (jamais tout au bord — le tracé simplifié peut couper court près d'une côte ou
   d'une frontière) : bon étalement nord / ouest / sud-ouest / centre / est plutôt que l'exactitude cartographique */
const NETWORK_CITIES = ['Lille', 'Rennes', 'Nantes', 'Toulouse', 'Clermont-Ferrand', 'Dijon'];
function networkPoints(W, H) {
  const list = (typeof window !== 'undefined' && Array.isArray(window.COMPAGNIE_OR_VILLES)) ? window.COMPAGNIE_OR_VILLES : [];
  if (!list.length) return [];
  return NETWORK_CITIES.map(nom => list.find(v => v.nom === nom)).filter(Boolean)
    .map(v => { const [x, y] = project(v.lat, v.lon); return { x: x / W * 100, y: y / H * 100 }; });
}

/* Ordre de tracé : les 13 régions (un même nom = continent + îlots) classées du sud-ouest vers le nord-est,
   d'après le centre du plus grand polygone. Chaque groupe : polygone principal (tracé à la plume) + îlots fusionnés
   en un seul path (fondu direct) → 18 paths par couche au lieu de 26, ≤ ~60 éléments animés pendant l'entrée. */
function drawGroups() {
  const byName = new Map();
  REGIONS.forEach((r, i) => {
    const nums = r.d.match(/-?\d+(?:\.\d+)?/g) || [];
    let sx = 0, sy = 0, n = 0;
    for (let k = 0; k + 1 < nums.length; k += 2) { sx += +nums[k]; sy += +nums[k + 1]; n++; }
    const c = { i, d: r.d, cx: sx / (n || 1), cy: sy / (n || 1), n };
    const g = byName.get(r.nom);
    if (!g) byName.set(r.nom, { main: c, items: [c] });
    else { g.items.push(c); if (c.n > g.main.n) g.main = c; }
  });
  return [...byName.values()]
    .sort((a, b) => (a.main.cx - a.main.cy) - (b.main.cx - b.main.cy))
    .map((g, rank) => ({ rank, main: g.main.d, isles: g.items.filter(c => c !== g.main).map(c => c.d).join(' ') }));
}

export async function createFranceScene(host, opts = {}) {
  const reduced = !!opts.reduced;
  const [, , W, H] = FRANCE_VIEWBOX;
  const uid = 'scf' + Math.random().toString(36).slice(2, 8);
  const [lx, ly] = project(45.7640, 4.8357);                         // Lyon, siège : coordonnées réelles projetées
  const allD = REGIONS.map(r => r.d).join(' ');
  const groups = drawGroups();
  const STROKE_T0 = 0.3, STROKE_STEP = 0.11, FILL_LAG = 0.45;       // chorégraphie (s) : contours 0.3→~2.6, terres 0.75→~3

  /* ---------- DOM ---------- */
  const root = el('div', 'scf');
  root.dataset.ambiance = opts.ambiance || document.documentElement.dataset.ambiance || 'nuit';
  if (reduced) root.classList.add('is-reduced');
  root.style.setProperty('--scf-px', (lx / W * 100).toFixed(3) + '%');
  root.style.setProperty('--scf-py', (ly / H * 100).toFixed(3) + '%');
  el('i', 'scf__glow', root);
  const view = el('div', 'scf__view', root);
  const cam = el('div', 'scf__cam', view);
  const flt = el('div', 'scf__float', cam);
  const stage = el('div', 'scf__stage', flt);
  const vb = `0 0 ${W} ${H}`;

  // ombre portée au sol (silhouette entière, floutée, sous le plan)
  const shadow = mk('svg', { viewBox: vb, class: 'scf__shadow', 'aria-hidden': 'true', focusable: 'false' }, stage);
  mk('path', { d: allD }, shadow);

  // terres : dégradé land-a / land-b (tokens, à chaud) + lumière de lampe fixe en haut à gauche
  const land = mk('svg', { viewBox: vb, class: 'scf__land', 'aria-hidden': 'true', focusable: 'false' }, stage);
  const defs = mk('defs', {}, land);
  const gradA = mk('linearGradient', { id: uid + 'a', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);      // terres : un seul dégradé, terres unies, les contours structurent
  mk('stop', { offset: '0', style: 'stop-color:var(--scf-land-a)' }, gradA); mk('stop', { offset: '1', style: 'stop-color:var(--scf-land-b)' }, gradA);
  const light = mk('linearGradient', { id: uid + 'l', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);   // lampe en haut à gauche, ombre vers le bas à droite
  mk('stop', { offset: '0', style: 'stop-color:var(--scf-hi)' }, light); mk('stop', { offset: '.5', style: 'stop-color:var(--scf-hi-0)' }, light);          // transparents de MÊME teinte : pas de bande grise à l'interpolation
  mk('stop', { offset: '.5', style: 'stop-color:var(--scf-sh-0)' }, light); mk('stop', { offset: '1', style: 'stop-color:var(--scf-sh)' }, light);
  const fills = mk('g', { class: 'scf__fills' }, land);
  groups.forEach(g => {
    const d = (STROKE_T0 + FILL_LAG + g.rank * STROKE_STEP).toFixed(2) + 's';
    mk('path', { d: g.main, class: 'scf__fill', fill: `url(#${uid}a)` }, fills).style.setProperty('--d', d);
    if (g.isles) mk('path', { d: g.isles, class: 'scf__fill scf__fill--isle', fill: `url(#${uid}a)` }, fills).style.setProperty('--d', d);
  });
  mk('path', { d: allD, class: 'scf__light', fill: `url(#${uid}l)` }, land);

  // contours : pathLength=1, tracé par dashoffset, du sud-ouest au nord-est ; îlots fusionnés par région, en fondu direct
  const lines = mk('svg', { viewBox: vb, class: 'scf__lines', 'aria-hidden': 'true', focusable: 'false' }, stage);
  const strokes = mk('g', { class: 'scf__strokes' }, lines);
  groups.forEach(g => {
    const d = (STROKE_T0 + g.rank * STROKE_STEP).toFixed(2) + 's';
    mk('path', { d: g.main, class: 'scf__stroke', pathLength: '1' }, strokes).style.setProperty('--d', d);
    if (g.isles) mk('path', { d: g.isles, class: 'scf__stroke scf__stroke--isle' }, strokes).style.setProperty('--d', d);
  });

  // balayage lumineux, masqué à la forme de la France (couche composée, transform seul)
  const sweep = el('div', 'scf__sweep', stage); el('i', '', sweep);
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path fill="#c99a3f" d="${allD}"/></svg>`;
  const maskUrl = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(maskSvg)}")`;
  sweep.style.maskImage = maskUrl; sweep.style.webkitMaskImage = maskUrl;

  // au sol : lueur or + ombre de la tête + anneaux ; tige + point en billboard
  const ground = el('div', 'scf__ground', stage);
  el('i', 'scf__lamp', ground); el('i', 'scf__foot', ground); el('i', 'scf__ring scf__ring--a', ground); el('i', 'scf__ring scf__ring--b', ground);
  const pin = el('div', 'scf__pin', stage);
  el('i', 'scf__stem', pin); el('i', 'scf__halo', pin); el('i', 'scf__dot', pin);

  // réseau de villes proches : quelques points discrets posés à plat sur le plan (jamais de tige), arrivent après le siège
  const network = networkPoints(W, H);
  if (network.length) {
    const vpins = el('div', 'scf__vpins', stage);
    network.forEach((p, i) => {
      const d = el('i', 'scf__vpin', vpins);
      d.style.left = p.x.toFixed(3) + '%'; d.style.top = p.y.toFixed(3) + '%';
      d.style.setProperty('--vd', (4.3 + i * 0.17).toFixed(2) + 's');
    });
  }
  el('i', 'scf__vignette', root);                                       // espace écran, au-dessus de la scène 3D

  host.appendChild(root);

  /* épaisseur des contours : ~0.75 px écran quelle que soit la taille de la carte (viewBox 1000 sur 57 % de la largeur) */
  const fit = () => {
    const w = root.clientWidth || host.clientWidth || 600;
    const scale = (w * 0.57) / W;
    root.style.setProperty('--scf-stroke-w', clamp(0.75 / scale, 1.1, 5).toFixed(2) + 'px');
  };
  fit();
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(root);
  void root.offsetWidth;                                               // style initial calculé : les transitions d'entrée partiront bien

  /* ---------- état / caméra (parallaxe pointeur, boucle rAF uniquement le temps de converger) ---------- */
  let started = false, running = false, raf = 0, px = 0, py = 0, sx = 0, sy = 0, settleT = 0;
  const SETTLE_MS = 4600;                                              // fin de la chorégraphie d'entrée (dernier contour posé ~4.2 s)
  const place = () => {
    cam.style.transform = `rotateY(${(sx * 7).toFixed(3)}deg) rotateX(${(-sy * 5).toFixed(3)}deg) translate3d(${(sx * 1.4).toFixed(3)}cqw,${(sy * 1).toFixed(3)}cqw,0)`;
  };
  const frame = () => {
    raf = 0;
    if (!running || document.hidden) return;
    sx += (px - sx) * 0.085; sy += (py - sy) * 0.085;
    if (Math.abs(px - sx) < 0.0006 && Math.abs(py - sy) < 0.0006) { sx = px; sy = py; place(); return; }
    place();
    raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (running && !raf && !reduced) raf = requestAnimationFrame(frame); };

  root.dataset.ready = '1';
  return {
    start() {
      running = true;
      root.classList.remove('is-paused');
      if (!started) {
        started = true; root.getBoundingClientRect(); root.classList.add('is-in');
        if (reduced) root.classList.add('is-settled');
        else settleT = setTimeout(() => { settleT = 0; root.classList.add('is-settled'); }, SETTLE_MS);
      }
      kick();
    },
    stop() {
      running = false;
      root.classList.add('is-paused');
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    setPointer(x, y) {
      if (reduced) return;
      px = clamp(+x || 0, -0.5, 0.5); py = clamp(+y || 0, -0.5, 0.5);
      kick();
    },
    setAmbiance(mode) { root.dataset.ambiance = mode === 'jour' ? 'jour' : 'nuit'; },
    destroy() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (settleT) { clearTimeout(settleT); settleT = 0; }
      if (ro) ro.disconnect();
      root.remove();
    }
  };
}
export default createFranceScene;
