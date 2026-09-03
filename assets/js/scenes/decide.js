/* decide.js · Carte 4 « Vous restez libre de decider »
   Scene CSS/SVG 3D (sans WebGL) : la proposition ecrite se pose sur la table, les details se dessinent,
   la signature se trace sous une plume d or, le sceau se presse, un balayage de lumiere traverse le papier,
   puis les mentions « Cheque · Virement ». Couches (ombre / papier / encre / sceau / plume) a translateZ
   differents dans un groupe camera ; parallaxe au pointeur ; vie = reflet lent + respiration (CSS).
   Choregraphie : classes d etat posees par une horloge de scene pausable ; la signature + la plume sont
   pilotees en rAF (stroke-dashoffset + getPointAtLength) pendant ~2,4 s seulement, puis plus aucune boucle.
   API : createDecideScene(host, { reduced, ambiance }) -> { start, stop, setPointer, setAmbiance, destroy } */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = t => { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
const easeIn = t => { t = clamp(t, 0, 1); return t * t * t; };
const sineInOut = t => { t = clamp(t, 0, 1); return (1 - Math.cos(Math.PI * t)) / 2; };

/* signature (viewBox 400 x 130) : une initiale bouclee puis une course cursive qui s apaise */
const SIG_D = 'M26 92 C30 70,44 30,62 26 C78 24,72 58,56 80 C46 94,30 92,40 80 C52 66,80 68,96 78 C108 86,100 100,90 94 C82 88,94 74,112 76 C130 78,136 90,150 84 C162 78,166 70,178 74 C190 78,186 92,200 88 C214 84,212 40,226 36 C240 32,236 62,226 82 C220 94,236 94,252 86 C268 78,278 70,296 74 C312 78,308 92,326 88 C346 84,358 72,378 74 C390 76,394 80,398 78';
const FILET_D = 'M30 114 L318 114';

/* horloge de scene (secondes) : moments de la choregraphie */
const STEPS = [
  [0.0, 'is-in'],        // le document arrive, l ombre se resserre
  [0.95, 'is-writing'],  // cartouche, filet de titre, lignes de texte en cascade
  [3.95, 'is-signed'],   // filet or sous la signature
  [4.45, 'is-sealed'],   // le sceau se presse (+ halo, micro-enfoncement du papier)
  [5.1, 'is-swept'],     // balayage de lumiere, une fois (+ glint sur le sceau)
  [5.45, 'is-pay'],      // mentions Cheque · Virement
  [6.9, 'is-done']
];
const SIGN_T0 = 2.3, SIGN_DUR = 1.6, PEN_IN = 0.32, PEN_OUT = 0.5, END_T = 7.0;
const PEN_SCALE = 1.3;   // presence de la plume (corps 60 unites x 1.3) ; la pointe (0,0) reste exactement sur l encre

/* plume : pointe (0,0) ; corps laque sombre, bague de capuchon et section or, fente + evant sur la pointe */
const ICON_PEN = `<g class="scd__pen" transform="translate(-100 -100) rotate(38) scale(${PEN_SCALE})">
  <rect class="scd__pen-cap" x="-3.6" y="-84" width="7.2" height="14" rx="3.4"/>
  <rect class="scd__pen-body" x="-3.5" y="-72" width="7" height="50" rx="2.6"/>
  <rect class="scd__pen-ring" x="-3.6" y="-71.4" width="7.2" height="2.4"/>
  <line class="scd__pen-hl" x1="-1.3" y1="-80" x2="-1.3" y2="-26"/>
  <rect class="scd__pen-ring" x="-3.2" y="-23" width="6.4" height="5.4" rx=".9"/>
  <path class="scd__pen-nib" d="M0 0 L-4.3 -13.8 Q0 -18 4.3 -13.8 Z"/>
  <line class="scd__pen-slit" x1="0" y1="-2.6" x2="0" y2="-11.5"/>
  <circle class="scd__pen-hole" cx="0" cy="-12.2" r=".9"/>
</g>`;

/* ombre au sol : nappe ambiante, un seul rect tres flouté (feGaussianBlur statique, raster une fois) ; viewBox = proportions
   du document. La couche est a Z -34 derriere un papier incline (rotateX 18°) : elle apparait ~3-5 unites plus bas a l ecran,
   d ou un rect decale vers le bas-droite (lumiere haut-gauche) dont le bord haut reste sous le papier (aucune lisiere visible
   au-dessus ni a gauche), et qui deborde en bas / a droite en degrade continu — jamais de « second feuillet ».
   L ombre de contact (fine, qui epouse les bords) est portee par le box-shadow du papier lui-meme (meme plan). */
const SHADOW_SVG = `<svg class="scd__shadow" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true">
  <defs><filter id="scdBlur" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9 8"/></filter></defs>
  <rect class="scd__shadow-core" x="6" y="9" width="100" height="128" rx="18" filter="url(#scdBlur)"/>
</svg>`;

function buildMarkup() {
  const lines = [100, 93, 97, 68, 0, 100, 86, 52].map((w, i) => w ? `<i class="scd__line" style="--w:${w}%;--i:${i > 4 ? i - 1 : i}"></i>` : '<i class="scd__line scd__line--gap"></i>').join('');
  return `<div class="scd__cam"><div class="scd__breath">
  <div class="scd__table"><i class="scd__rake"></i></div>
  <div class="scd__press">
  <div class="scd__doc">
    <div class="scd__l scd__l--shadow"><div class="scd__shadowmv">${SHADOW_SVG}</div></div>
    <div class="scd__l scd__l--sheet"><div class="scd__sheet">
      <div class="scd__sheen"></div>
      <span class="scd__cart">Proposition écrite</span>
      <i class="scd__rule"></i>
      <div class="scd__lines">${lines}</div>
      <div class="scd__sweep"></div>
    </div></div>
    <div class="scd__l scd__l--ink"><svg class="scd__svg" viewBox="0 0 400 130" aria-hidden="true">
      <defs>
        <linearGradient id="scdGold" gradientUnits="userSpaceOnUse" x1="30" y1="0" x2="318" y2="0"><stop offset="0" stop-color="#c99a3f"/><stop offset=".55" stop-color="#e8cd93"/><stop offset="1" stop-color="#c99a3f"/></linearGradient>
        <radialGradient id="scdSh" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(40,28,8,.9)"/><stop offset="1" stop-color="rgba(40,28,8,0)"/></radialGradient>
      </defs>
      <ellipse class="scd__pensh" cx="0" cy="0" rx="13" ry="2.4" fill="url(#scdSh)"/>
      <path class="scd__filet" d="${FILET_D}" pathLength="1"/>
      <path class="scd__sig" d="${SIG_D}"/>
    </svg></div>
    <div class="scd__l scd__l--seal"><div class="scd__halo"></div><div class="scd__seal"><i class="scd__glint"></i></div></div>
    <div class="scd__l scd__l--pen"><svg class="scd__svg" viewBox="0 0 400 130" aria-hidden="true">
      <defs><linearGradient id="scdNib" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0dcaa"/><stop offset=".6" stop-color="#c99a3f"/><stop offset="1" stop-color="#a67d2b"/></linearGradient></defs>
      ${ICON_PEN}
    </svg></div>
  </div>
  <div class="scd__pay"><span>Chèque</span><i></i><span>Virement</span></div>
  </div></div></div>`;
}

export async function createDecideScene(host, opts = {}) {
  const reduced = !!opts.reduced;
  const root = document.createElement('div');
  root.className = 'scd';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = buildMarkup();
  host.appendChild(root);

  const sig = root.querySelector('.scd__sig');
  const pen = root.querySelector('.scd__pen');
  const pensh = root.querySelector('.scd__pensh');
  const L = sig.getTotalLength();
  const P0 = sig.getPointAtLength(0), P1 = sig.getPointAtLength(L);
  sig.style.strokeDasharray = String(L);
  sig.style.strokeDashoffset = String(L);

  /* ambiance : classe explicite + suivi a chaud de html[data-ambiance] */
  const setAmbiance = mode => { const jour = mode === 'jour'; root.classList.toggle('is-jour', jour); root.classList.toggle('is-nuit', !jour); };
  setAmbiance(opts.ambiance || document.documentElement.dataset.ambiance || 'nuit');
  const mo = new MutationObserver(() => setAmbiance(document.documentElement.dataset.ambiance));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });

  /* unite de taille : 1 % de la largeur du host (--u en px pour les tailles, --un sans unite pour les em) */
  const setUnit = w => { const u = Math.max(1, w) / 100; root.style.setProperty('--u', u.toFixed(3) + 'px'); root.style.setProperty('--un', u.toFixed(3)); };
  setUnit(host.clientWidth || 600);
  const ro = new ResizeObserver(es => { for (const e of es) setUnit(e.contentRect.width); });
  ro.observe(host);

  /* signature + plume (uniquement pendant la fenetre d ecriture) ;
     l ombre de la plume est une trainee fine le long de l axe du corps (lumiere haut-gauche : elle tombe en bas a droite du
     corps), qui se detache et s allonge quand la plume se leve */
  let penVisible = false;
  const AX = Math.sin(38 * Math.PI / 180), AY = -Math.cos(38 * Math.PI / 180);   // direction pointe -> capuchon
  function placePen(x, y, lift, op) {
    pen.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(38) scale(${PEN_SCALE})`);
    pen.style.opacity = op.toFixed(3);
    const cx = x + AX * 13 + 3.2 + lift * 10, cy = y + AY * 13 + 2.6 + lift * 9;
    pensh.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(-52) scale(${(1 + lift * .45).toFixed(3)} ${(1 + lift * .9).toFixed(3)})`);
    pensh.style.opacity = (0.3 * op * (1 - lift * 0.65)).toFixed(3);
    penVisible = op > 0;
  }
  function updateSign(t) {
    if (t < SIGN_T0 - PEN_IN) { if (penVisible) placePen(P0.x, P0.y, 1, 0); return; }
    const a = (t - SIGN_T0) / SIGN_DUR;
    if (a < 0) {                                                         // la plume approche depuis le haut-droite
      const k = easeOut((t - (SIGN_T0 - PEN_IN)) / PEN_IN);
      placePen(P0.x + (1 - k) * 30, P0.y - (1 - k) * 54, 1 - k, k);
      sig.style.strokeDashoffset = String(L);
    } else if (a <= 1) {                                                 // le trace s ecrit, la pointe suit
      const e = sineInOut(a);
      const p = sig.getPointAtLength(e * L);
      sig.style.strokeDashoffset = String(L * (1 - e));
      placePen(p.x, p.y, 0, 1);
    } else {                                                             // la plume se retire et s efface
      const k = clamp((t - SIGN_T0 - SIGN_DUR) / PEN_OUT, 0, 1);
      sig.style.strokeDashoffset = '0';
      placePen(P1.x + easeIn(k) * 26, P1.y - easeOut(k) * 50, k, 1 - easeIn(k));
    }
  }

  /* horloge pausable + classes d etat */
  let running = false, raf = 0, t0 = 0, acc = 0, done = false, next = 0;
  function apply(t) {
    while (next < STEPS.length && t >= STEPS[next][0]) { root.classList.add(STEPS[next][1]); next++; }
    updateSign(t);
  }
  function frame(now) {
    raf = 0; if (!running) return;
    const t = acc + (now - t0) / 1000;
    apply(t);
    if (t >= END_T) { done = true; running = false; acc = END_T; return; }   // fin de la choregraphie : la vie est 100 % CSS
    raf = requestAnimationFrame(frame);
  }

  /* pointeur : variables CSS (le CSS fait la transition) */
  let px = 0, py = 0, prRaf = 0;
  const applyPointer = () => { prRaf = 0; root.style.setProperty('--px', px.toFixed(3)); root.style.setProperty('--py', py.toFixed(3)); };

  if (reduced) {
    root.classList.add('is-reduced', ...STEPS.map(s => s[1]));
    sig.style.strokeDashoffset = '0';
    done = true;
  }

  const api = {
    start() {
      root.classList.remove('is-paused');
      if (reduced || done || running) return;
      running = true; t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      if (running) { acc += (performance.now() - t0) / 1000; running = false; }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      root.classList.add('is-paused');
    },
    setPointer(x, y) {
      if (reduced) return;
      px = clamp(+x || 0, -0.5, 0.5); py = clamp(+y || 0, -0.5, 0.5);
      if (!prRaf) prRaf = requestAnimationFrame(applyPointer);
    },
    setAmbiance,
    destroy() {
      api.stop(); if (prRaf) cancelAnimationFrame(prRaf);
      ro.disconnect(); mo.disconnect(); root.remove();
    }
  };
  return api;
}
export default createDecideScene;
