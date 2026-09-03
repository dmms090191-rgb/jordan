/* La Compagnie de l'Or · francemap.js
   « Poussière d'or » — the "Partout en France" chapter: a scroll-driven gold-dust map.

   Plain ES module, 2D canvas only, zero dependencies.

   createFranceMap(canvas, data, opts)
     → { setProgress, setPointer, setFocus, getFocus, start, stop, resize, destroy }

   opts
   · chip       element that receives the hover label (class 'is-on', left/top in css px)
   · reduced    prefers-reduced-motion → no loop, no shimmer, instant focus changes
   · focusCity  city whose pulse rings / bloom are drawn (key or display name; null → none; default 'Lyon')
   · tour       array of city names in tour order → larger dots, warm halos, travelling dashed route
   · mini       small framed box: square layout (6 % padding), no flight, no bloom/veil, on-demand renders
   · cityInfo   { cityName: 'chip text' } → hover chip shows this instead of the bare name

   Design notes
   · Everything visible is a pure function of the scroll progress p (0..1) plus a whisper-level
     time shimmer, so scrubbing the page back and forth is perfectly reversible. The only other
     time input is the focus crossfade (≈600 ms, pure function of wall time, no integration state).
   · ~2600 particles are built ONCE (seeded PRNG → deterministic), then drawn as pre-rendered
     sprites (drawImage), never as per-particle arc()+fill().
   · The rAF loop only draws when something changed (p, hover, focus) or for the 30 fps idle shimmer;
     with reduced motion there is no loop at all — exactly one render per setProgress/resize.
     In mini mode there is no idle loop either: one render per setProgress / resize / pointer.
   · All sizes are in canvas pixels (css px × dpr, dpr capped at 2).
*/

/* ------------------------------------------------------------------------------------------ */
/* Tunables                                                                                    */
/* ------------------------------------------------------------------------------------------ */
const DPR_CAP       = 2;
const SEED          = 0x1a2b3c4d;   // particle field seed (deterministic build)
const N_PERIMETER   = 1500;         // particles along the ring polylines (split by length)
const N_INTERIOR    = 1100;         // particles inside mainland France
const N_CORSICA     = 40;           // particles inside Corsica
const T0_MAX        = 0.28;         // latest personal start threshold (p units)
const FLY_SPAN      = 0.25;         // one particle's flight length (p units) → last landing ≈ 0.53
const ARC_MAG       = 0.12;         // perpendicular arc amplitude, fraction of the map side
const DRIFT_PX      = 5;            // idle dust drift amplitude (css px) before arrival
const IDLE_FPS      = 30;           // idle shimmer redraw cap
const HOVER_PX      = 22;           // hover hit radius (css px)
const CITY_T_START  = 0.72;         // first city starts appearing
const CITY_T_SPREAD = 0.10;         // stagger across city index
const CITY_T_LEN    = 0.05;         // one city's fade-in length (→ last city done at 0.62)
const RIPPLE_RINGS  = 3;
const RIPPLE_MAX_PX = 70;           // ripple radius (css px)
const RIPPLE_P_RATE = 6;            // ripple loops per unit of p (scroll animates it)
const RIPPLE_T_RATE = 0.25;         // slow idle breathing of the ripples (loops per second)
const WIDE_MIN_PX   = 820;          // wide-stage layout threshold (css px)
const FOCUS_MS      = 600;          // focus crossfade (old city → new city)
const TOUR_DOT_PX   = 0.8;          // extra dot radius for tour cities (css px)
const ROUTE_DASH_PX = 6;            // route dash / gap length (css px)
const ROUTE_SPEED   = 9;            // dash travel speed (css px / s) — a slow light between cities
const ROUTE_T0      = 0.76;         // route fades in with the city dots …
const ROUTE_T1      = 0.88;         // … and is fully there with the last one
const MINI_PAD      = 0.06;         // mini layout padding (fraction of the short side)

const ACCENTS = {
  Gerardmer: 'Gérardmer', Orleans: 'Orléans', Besancon: 'Besançon',
  LeMans: 'Le Mans', LaRochelle: 'La Rochelle', Clermont: 'Clermont-Ferrand',
};

/* ------------------------------------------------------------------------------------------ */
/* Small helpers                                                                               */
/* ------------------------------------------------------------------------------------------ */
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (p, e0, e1) => { const t = clamp01((p - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const fract = v => v - Math.floor(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const EMPTY_DASH = [];

/** Mulberry32 — tiny, fast, deterministic PRNG (0..1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** City key → display name (accents table first, then underscores / camel-case). */
function displayName(key) {
  if (ACCENTS[key]) return ACCENTS[key];
  return String(key).replace(/_/g, ' ').replace(/([a-zà-ÿ])([A-Z])/g, '$1 $2').trim();
}

/** Lookup form of a city name: accent-less, lower-case, letters+digits only
    ('Gérardmer' → 'gerardmer', 'Le Mans' → 'lemans', 'Clermont-Ferrand' → 'clermontferrand'). */
const canNormalize = typeof ''.normalize === 'function';
function normName(s) {
  let v = String(s);
  if (canNormalize) v = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const isPt = p => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);

function segLength(ring, i) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
function polyLength(ring) {
  let L = 0;
  for (let i = 0; i < ring.length; i++) L += segLength(ring, i);
  return L;
}
/** Even-odd ray casting. */
function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------------------------------ */
/* Particle field (built once, map-normalised coordinates)                                     */
/* ------------------------------------------------------------------------------------------ */

/** `count` points spaced evenly along a closed polyline, with a little tangential/normal jitter. */
function samplePerimeter(ring, L, count, rand, out) {
  const n = ring.length, step = L / count, off = rand() * step;
  let seg = 0, cum = 0, segLen = segLength(ring, 0);
  for (let k = 0; k < count; k++) {
    let d = off + k * step + (rand() - 0.5) * step * 0.6;
    if (d < 0) d += L; else if (d >= L) d -= L;
    if (d < cum) { seg = 0; cum = 0; segLen = segLength(ring, 0); }          // jitter went backwards
    while (seg < n - 1 && cum + segLen < d) { cum += segLen; seg++; segLen = segLength(ring, seg); }
    const a = ring[seg], b = ring[(seg + 1) % n];
    const u = segLen > 0 ? clamp01((d - cum) / segLen) : 0;
    const nx = segLen > 0 ? -(b[1] - a[1]) / segLen : 0;
    const ny = segLen > 0 ? (b[0] - a[0]) / segLen : 0;
    const j = (rand() - 0.5) * 0.003;                                         // ≈ ±2 px at 1200 px side
    out.push(a[0] + (b[0] - a[0]) * u + nx * j, a[1] + (b[1] - a[1]) * u + ny * j);
  }
}

/** `count` points uniformly inside a polygon (rejection sampling in its bbox). */
function sampleInside(ring, count, rand, out) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const bw = x1 - x0, bh = y1 - y0;
  if (!(bw > 0 && bh > 0)) return;
  let got = 0, tries = 0;
  const maxTries = count * 400;                                                // never spin forever
  while (got < count && tries++ < maxTries) {
    const x = x0 + rand() * bw, y = y0 + rand() * bh;
    if (pointInPolygon(x, y, ring)) { out.push(x, y); got++; }
  }
}

function buildParticles(rings, rand) {
  const per = [], inn = [];
  const lens = rings.map(polyLength);
  const total = lens.reduce((a, b) => a + b, 0);
  if (total > 0) rings.forEach((ring, ri) => {
    const L = lens[ri];
    if (L > 0) samplePerimeter(ring, L, Math.max(6, Math.round((N_PERIMETER * L) / total)), rand, per);
  });
  if (rings[0]) sampleInside(rings[0], N_INTERIOR, rand, inn);
  if (rings[1]) sampleInside(rings[1], N_CORSICA, rand, inn);

  const nPer = per.length >> 1, n = nPer + (inn.length >> 1);
  const F = () => new Float32Array(n);
  const P = { n, nPer, tx: F(), ty: F(), sx: F(), sy: F(), t0: F(), ph: F(), ba: F(), sz: F(), da: F(), am: F() };
  for (let i = 0; i < n; i++) {
    const isPer = i < nPer;
    const src = isPer ? per : inn, j = isPer ? i * 2 : (i - nPer) * 2;
    P.tx[i] = src[j]; P.ty[i] = src[j + 1];          // target (map space 0..1)
    P.sx[i] = rand();  P.sy[i] = rand();             // start (canvas space 0..1)
    P.t0[i] = rand() * T0_MAX;                       // personal arrival threshold
    P.ph[i] = rand() * Math.PI * 2;                  // shimmer / drift phase
    P.am[i] = (rand() * 2 - 1) * ARC_MAG;            // signed arc amplitude (fraction of side)
    if (isPer) { P.ba[i] = 0.55 + 0.30 * rand(); P.sz[i] = 0.85 + 0.35 * rand(); P.da[i] = 0.06 + 0.06 * rand(); }
    else       { P.ba[i] = 0.16 + 0.19 * rand(); P.sz[i] = 0.80 + 0.45 * rand(); P.da[i] = 0.04 + 0.08 * rand(); }
  }
  return P;
}

/* ------------------------------------------------------------------------------------------ */
/* Sprites (rendered once per dpr, drawn with drawImage)                                       */
/* ------------------------------------------------------------------------------------------ */
function buildSprites(dpr) {
  const SS = 2;                                       // supersample so tiny sprites stay smooth
  const mk = (r, stops) => {
    const dw = Math.max(2, r * 2);                    // on-screen diameter (canvas px)
    const size = Math.max(4, Math.ceil(dw * SS));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return { img: c, dw, half: dw / 2 };
  };
  return {
    // perimeter dust: bright core ≈ 1.1 px·dpr with a soft gold skirt
    per: mk(1.1 * dpr * 2.6, [
      [0, 'rgba(250,236,196,1)'], [0.32, 'rgba(240,218,162,0.95)'], [0.5, 'rgba(232,205,147,0.42)'],
      [0.78, 'rgba(201,154,63,0.10)'], [1, 'rgba(201,154,63,0)'],
    ]),
    // interior dust: smaller, warmer, softer
    inn: mk(0.8 * dpr * 2.6, [
      [0, 'rgba(236,212,158,1)'], [0.36, 'rgba(214,170,84,0.8)'], [0.62, 'rgba(201,154,63,0.26)'],
      [1, 'rgba(201,154,63,0)'],
    ]),
    // city halo: 14 px·dpr radius, .28 at the centre (drawn additively)
    halo: mk(14 * dpr, [
      [0, 'rgba(232,205,147,0.28)'], [0.3, 'rgba(232,205,147,0.14)'], [0.65, 'rgba(201,154,63,0.045)'],
      [1, 'rgba(201,154,63,0)'],
    ]),
    // tour-city halo: a touch wider, warmer and brighter (the company's own stops)
    tourHalo: mk(15 * dpr, [
      [0, 'rgba(242,214,150,0.42)'], [0.28, 'rgba(236,196,118,0.22)'], [0.6, 'rgba(201,154,63,0.075)'],
      [1, 'rgba(201,154,63,0)'],
    ]),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Factory                                                                                     */
/* ------------------------------------------------------------------------------------------ */
export function createFranceMap(canvas, data, opts = {}) {
  const noop = () => {};
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) {
    return { setProgress: noop, setPointer: noop, setFocus: noop, getFocus: () => null,
             start: noop, stop: noop, resize: noop, destroy: noop };
  }

  const chip = opts.chip || null;
  const reduced = !!opts.reduced;
  const mini = !!opts.mini;
  const live = !reduced && !mini;            // time shimmer + continuous idle loop

  /* ---- data sanitising ---- */
  const rings = (data && Array.isArray(data.rings) ? data.rings : [])
    .filter(r => Array.isArray(r) && r.length >= 3 && r.every(isPt));
  const cityEntries = Object.entries((data && data.cities) || {}).filter(([, xy]) => isPt(xy));
  const nCities = cityEntries.length;
  const cityNames = cityEntries.map(([k]) => displayName(k));
  const cityNorm = new Float32Array(nCities * 2);
  const cityStart = new Float32Array(nCities);                     // appear threshold per city
  cityEntries.forEach(([, xy], i) => {
    cityNorm[i * 2] = xy[0]; cityNorm[i * 2 + 1] = xy[1];
    cityStart[i] = CITY_T_START + (nCities > 1 ? (CITY_T_SPREAD * i) / (nCities - 1) : 0);
  });

  /* ---- name resolution (key or display name, case/accent-insensitive) ---- */
  const nameIdx = new Map();
  cityEntries.forEach(([k], i) => {
    const a = normName(k), b = normName(cityNames[i]);
    if (a && !nameIdx.has(a)) nameIdx.set(a, i);
    if (b && !nameIdx.has(b)) nameIdx.set(b, i);
  });
  function resolveCity(name) {
    if (typeof name !== 'string' || !name) return -1;
    const i = nameIdx.get(normName(name));
    return i === undefined ? -1 : i;
  }

  /* ---- focus city (crossfaded weights, pure function of wall time) ---- */
  let focusIdx = -1;
  if (opts.focusCity !== null) {                                   // explicit null → no focus at all
    focusIdx = resolveCity(opts.focusCity || 'Lyon');
    if (focusIdx < 0 && nCities) focusIdx = 0;
  }
  const fwFrom = new Float32Array(nCities), fwTo = new Float32Array(nCities), fwDur = new Float32Array(nCities);
  const FW = new Float32Array(nCities);                            // weights evaluated once per render
  let focusT0 = 0, focusEnd = 0;
  if (focusIdx >= 0) { fwFrom[focusIdx] = 1; fwTo[focusIdx] = 1; }

  /* ---- tour cities + route ---- */
  const isTour = new Uint8Array(nCities);
  const tourIdx = [];
  if (Array.isArray(opts.tour)) for (const nm of opts.tour) {
    const i = resolveCity(nm);
    if (i < 0) continue;
    isTour[i] = 1;
    if (tourIdx[tourIdx.length - 1] !== i) tourIdx.push(i);        // drop consecutive repeats
  }
  const hasRoute = tourIdx.length > 1;

  /* ---- chip texts ---- */
  const cityInfo = new Array(nCities).fill(null);
  if (opts.cityInfo && typeof opts.cityInfo === 'object') {
    for (const nm of Object.keys(opts.cityInfo)) {
      const i = resolveCity(nm), txt = opts.cityInfo[nm];
      if (i >= 0 && txt != null && txt !== '') cityInfo[i] = String(txt);
    }
  }

  /* ---- particle field (once) ---- */
  const P = buildParticles(rings, mulberry32(SEED));
  const N = P.n;
  const SX = new Float32Array(N), SY = new Float32Array(N);         // start, canvas px
  const TX = new Float32Array(N), TY = new Float32Array(N);         // target, canvas px
  const AX = new Float32Array(N), AY = new Float32Array(N);         // arc offset, canvas px
  const CX = new Float32Array(nCities), CY = new Float32Array(nCities);

  /* ---- state ---- */
  let W = 0, H = 0, dpr = 0;                 // canvas pixel size / device ratio
  let sprites = null;
  let outline = null;                        // Path2D in canvas px (null → traced manually)
  let route = null;                          // Path2D of the tour polyline (null → traced manually)
  let routeDash = EMPTY_DASH;                // [dash, gap] in canvas px
  const box = { x: 0, y: 0, s: 0 };          // map square in canvas px
  let prog = 0;
  let running = false, rafId = 0, dirty = true, lastDraw = -1e9, fxTail = false;
  let ptrX = NaN, ptrY = NaN, hoverIdx = -1;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const tStart = now();
  const hasPath2D = typeof Path2D === 'function';

  /* ---------------------------------------------------------------------------------------- */
  /* Layout                                                                                    */
  /* ---------------------------------------------------------------------------------------- */
  function relayout() {
    const cssW = W / dpr, cssH = H / dpr;
    let side, cx, cy;
    if (mini)                     { side = (1 - 2 * MINI_PAD) * Math.min(cssW, cssH); cx = 0.5 * cssW; cy = 0.5 * cssH; }
    else if (cssW >= WIDE_MIN_PX) { side = Math.min(0.78 * cssH, 0.5 * cssW); cx = 0.64 * cssW; cy = 0.52 * cssH; }
    else                          { side = Math.min(0.9 * cssW, 0.55 * cssH);  cx = 0.5 * cssW;  cy = 0.58 * cssH; }
    box.s = side * dpr; box.x = (cx - side / 2) * dpr; box.y = (cy - side / 2) * dpr;

    // particles: pixel start / target / perpendicular arc
    const { tx, ty, sx, sy, am } = P;
    for (let i = 0; i < N; i++) {
      const txp = box.x + tx[i] * box.s, typ = box.y + ty[i] * box.s;
      const sxp = sx[i] * W, syp = sy[i] * H;
      TX[i] = txp; TY[i] = typ; SX[i] = sxp; SY[i] = syp;
      const dx = txp - sxp, dy = typ - syp, len = Math.hypot(dx, dy);
      if (len > 1e-3) { AX[i] = (-dy / len) * am[i] * box.s; AY[i] = (dx / len) * am[i] * box.s; }
      else { AX[i] = 0; AY[i] = 0; }
    }
    // cities
    for (let i = 0; i < nCities; i++) { CX[i] = box.x + cityNorm[i * 2] * box.s; CY[i] = box.y + cityNorm[i * 2 + 1] * box.s; }
    // outline path
    outline = hasPath2D ? new Path2D() : null;
    if (outline) traceRings(outline);
    // tour route
    route = hasPath2D && hasRoute ? new Path2D() : null;
    if (route) traceRoute(route);
    routeDash = hasRoute ? [ROUTE_DASH_PX * dpr, ROUTE_DASH_PX * dpr] : EMPTY_DASH;
  }

  function traceRings(target) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const x = box.x + ring[i][0] * box.s, y = box.y + ring[i][1] * box.s;
        if (i === 0) target.moveTo(x, y); else target.lineTo(x, y);
      }
      target.closePath();
    }
  }
  function traceRoute(target) {
    for (let k = 0; k < tourIdx.length; k++) {
      const i = tourIdx[k];
      if (k === 0) target.moveTo(CX[i], CY[i]); else target.lineTo(CX[i], CY[i]);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Focus crossfade                                                                           */
  /* ---------------------------------------------------------------------------------------- */
  /** Focus weight of city i at time ts: from → to over its own duration (eased), 0..1. */
  function focusWeightAt(i, ts) {
    const d = fwDur[i];
    if (d <= 0) return fwTo[i];
    const u = (ts - focusT0) / d;
    if (u >= 1) return fwTo[i];
    if (u <= 0) return fwFrom[i];
    const e = u * u * (3 - 2 * u);
    return fwFrom[i] + (fwTo[i] - fwFrom[i]) * e;
  }
  /** Evaluate all weights for this render; returns their sum. */
  function evalFocus(ts) {
    let sum = 0;
    for (let i = 0; i < nCities; i++) { const w = focusWeightAt(i, ts); FW[i] = w; sum += w; }
    return sum;
  }
  /** Retarget the crossfade: every city eases from its current weight to its new target
      (duration ∝ distance, so a half-way city keeps the same speed). Reduced → snap. */
  function retarget(idx) {
    const tNow = now();
    let maxD = 0;
    for (let i = 0; i < nCities; i++) {
      const to = i === idx ? 1 : 0;
      const cur = reduced ? to : focusWeightAt(i, tNow);           // reads the *previous* transition
      const d = reduced ? 0 : FOCUS_MS * Math.abs(to - cur);
      fwFrom[i] = cur; fwTo[i] = to; fwDur[i] = d;
      if (d > maxD) maxD = d;
    }
    focusT0 = tNow; focusEnd = tNow + maxD;
    focusIdx = idx;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Rendering                                                                                 */
  /* ---------------------------------------------------------------------------------------- */
  const cityAppear = (i, p) => { const t = clamp01((p - cityStart[i]) / CITY_T_LEN); return t * t * (3 - 2 * t); };

  function render(ts) {
    if (!W || !H || !sprites) return;
    const p = prog;
    const t = live ? (ts - tStart) / 1000 : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    const fadeT = mini ? 0 : sstep(p, 0.92, 1);   // the chapter hands off over .9→1 (never in mini)
    const late = 1 - 0.7 * fadeT;                // outline + cities sink under the veil
    const wSum = nCities ? evalFocus(ts) : 0;

    drawParticles(p, t, 1 - fadeT);
    if (mini) {
      const rise = sstep(p, 0.45, 0.6);
      if (rise > 0.002) drawOutline(rise * late);
    } else {
      const draw0 = sstep(p, 0.30, 0.68);          // the gold pen follows the mainland contour
      const draw1 = sstep(p, 0.66, 0.76);          // then Corsica appears
      if (draw0 > 0.002) drawOutlinePen(draw0, draw1, late);
    }
    if (hasRoute) drawRoute(p, t, late);
    if (nCities) drawCities(p, t, late, wSum);
    if (!mini && p > 0.90 && (focusIdx >= 0 || wSum > 0.002)) drawBloom(p, wSum);

    const k = fadeT * 0.85;                  // warm-dark veil on top
    if (k > 0.002) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(11,10,8,${k.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawParticles(p, t, fadeMul) {
    if (fadeMul <= 0.002 || !N) return;
    const shimmer = live;
    const landed = mini;                                             // mini: no assembly flight
    const drift = shimmer ? DRIFT_PX * dpr : 0;
    const { nPer, t0: T0, ph: PH, ba: BA, sz: SZ, da: DA } = P;
    const inv = 1 / FLY_SPAN;
    let spr = sprites.per, img = spr.img, dw = spr.dw, half = spr.half;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < N; i++) {
      if (i === nPer) { spr = sprites.inn; img = spr.img; dw = spr.dw; half = spr.half; }
      // arrival 0..1 (smoothstep), staggered by the personal threshold
      let a = landed ? 1 : (p - T0[i]) * inv;
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      const ph = PH[i];
      // dust alpha before arrival → particle alpha once landed
      let alpha = (DA[i] + (BA[i] - DA[i]) * a) * fadeMul;
      if (shimmer) alpha *= 0.82 + 0.18 * Math.sin(t * 0.7 + ph);
      if (alpha < 0.004) continue;
      const ia = 1 - a, e = 1 - ia * ia * ia;                        // easeOutCubic
      let x = SX[i] + (TX[i] - SX[i]) * e, y = SY[i] + (TY[i] - SY[i]) * e;
      if (a > 0 && a < 1) { const arc = Math.sin(Math.PI * a); x += AX[i] * arc; y += AY[i] * arc; }
      if (drift > 0 && ia > 0) { const d = drift * ia; x += Math.sin(t * 0.23 + ph) * d; y += Math.cos(t * 0.19 + ph * 1.7) * d; }
      const s = SZ[i];
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      ctx.drawImage(img, x - half * s, y - half * s, dw * s, dw * s);
    }
  }

  function drawOutline(k) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // soft glow (additive)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 * k;
    ctx.lineWidth = 7 * dpr;
    ctx.strokeStyle = 'rgb(201,154,63)';
    strokeOutline();
    // thin set line
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55 * k;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgb(232,205,147)';
    strokeOutline();
  }
  let ringLens = null;                             // cumulative segment lengths per ring (normalized units)
  function ringLengths() {
    if (ringLens) return ringLens;
    ringLens = rings.map(ring => {
      const cum = [0];
      for (let i = 1; i <= ring.length; i++) {
        const a = ring[i - 1], b = ring[i % ring.length];
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      return cum;
    });
    return ringLens;
  }
  function tracePartial(target, ringIdx, frac) {
    const ring = rings[ringIdx]; if (!ring) return null;
    const cum = ringLengths()[ringIdx]; const total = cum[cum.length - 1]; const goal = total * Math.min(1, frac);
    let tip = null;
    const P = i => [box.x + ring[i % ring.length][0] * box.s, box.y + ring[i % ring.length][1] * box.s];
    let [x0, y0] = P(0); target.moveTo(x0, y0);
    for (let i = 1; i <= ring.length; i++) {
      if (cum[i] <= goal) { const [x, y] = P(i); target.lineTo(x, y); tip = [x, y]; if (cum[i] === goal) break; }
      else {
        const seg = cum[i] - cum[i - 1]; const t = seg > 0 ? (goal - cum[i - 1]) / seg : 0;
        const [ax, ay] = P(i - 1), [bx, by] = P(i);
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        target.lineTo(x, y); tip = [x, y]; break;
      }
    }
    if (frac >= 1) target.closePath();
    return tip;
  }
  function drawOutlinePen(f0, f1, late) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const alpha = Math.min(1, f0 * 5) * late;
    const stroke = pass => {
      ctx.beginPath();
      const tip0 = tracePartial(ctx, 0, f0);
      let tip1 = null;
      if (f1 > 0.002 && rings[1]) { tip1 = tracePartial(ctx, 1, f1); }
      ctx.stroke();
      return pass ? (f1 > 0.002 && f1 < 1 ? tip1 : (f0 < 1 ? tip0 : null)) : null;
    };
    // soft glow (additive)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 * alpha;
    ctx.lineWidth = 7 * dpr;
    ctx.strokeStyle = 'rgb(201,154,63)';
    stroke(false);
    // crisp set line + pen tip
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55 * alpha;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgb(232,205,147)';
    const tip = stroke(true);
    if (tip) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * late;
      ctx.fillStyle = 'rgb(246,228,174)';
      ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.2 * dpr, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.25 * late;
      ctx.beginPath(); ctx.arc(tip[0], tip[1], 7 * dpr, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  function strokeOutline() {
    if (outline) { ctx.stroke(outline); return; }
    ctx.beginPath(); traceRings(ctx); ctx.stroke();
  }

  /** Tour route: a faint set glow plus a 1 px dashed line whose dashes travel slowly along it. */
  function drawRoute(p, t, late) {
    const k = sstep(p, ROUTE_T0, ROUTE_T1) * late;
    if (k <= 0.002) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // soft glow (additive, solid)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.10 * k;
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgb(201,154,63)';
    strokeRoute();
    // travelling dashes (crisp)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.62 * k;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgb(232,205,147)';
    ctx.setLineDash(routeDash);
    const period = 2 * ROUTE_DASH_PX * dpr;                          // dash + gap, canvas px
    ctx.lineDashOffset = live ? -fract((t * ROUTE_SPEED * dpr) / period) * period : 0;
    strokeRoute();
    ctx.setLineDash(EMPTY_DASH);
    ctx.lineDashOffset = 0;
  }
  function strokeRoute() {
    if (route) { ctx.stroke(route); return; }
    ctx.beginPath(); traceRoute(ctx); ctx.stroke();
  }

  function drawCities(p, t, late, wSum) {
    const shimmer = live;
    let f = sstep(p, 0.58, 0.64);              // focus emphasis
    if (focusIdx < 0 && wSum <= 0.002) f = 0;  // no focus at all → nobody pulses, nobody dims
    const breathe = shimmer ? 0.06 * Math.sin(t * 1.4) : 0;
    const halo = sprites.halo, tourHalo = sprites.tourHalo;

    // halos (additive)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < nCities; i++) {
      const ap = cityAppear(i, p);
      if (ap <= 0.002) continue;
      const tour = isTour[i] === 1, w = FW[i], fw = f * w;
      const spr = tour ? tourHalo : halo;
      let s = 1, al = ap * late;
      if (fw > 0) { s *= (1 + 0.9 * fw) * (1 + breathe * w); al *= 1 + 0.8 * fw; }
      al *= 1 - (tour ? 0.12 : 0.3) * f * (1 - w);                 // others dim while the focus pulses
      if (i === hoverIdx) { s *= 1.3; al *= 1.6; }
      if (shimmer) al *= 0.92 + 0.08 * Math.sin(t * 1.1 + i * 2.3);
      ctx.globalAlpha = al > 1 ? 1 : al;
      ctx.drawImage(spr.img, CX[i] - spr.half * s, CY[i] - spr.half * s, spr.dw * s, spr.dw * s);
    }

    // focus ripples (additive): 3 rings per weighted city, phase driven by p (and a slow idle breath)
    if (f > 0.002 && wSum > 0.002) {
      const base = p * RIPPLE_P_RATE + (shimmer ? t * RIPPLE_T_RATE : 0);
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = 'rgb(232,205,147)';
      for (let i = 0; i < nCities; i++) {
        const w = FW[i];
        if (w <= 0.002) continue;
        const apF = cityAppear(i, p);
        if (apF <= 0.002) continue;
        const gain = 0.6 * f * late * apF * w;
        for (let k = 0; k < RIPPLE_RINGS; k++) {
          const u = fract(base + k / RIPPLE_RINGS);
          const r = u * RIPPLE_MAX_PX * dpr;
          const al = (1 - u) * (1 - u * 0.5) * gain;
          if (r < 0.5 || al < 0.004) continue;
          ctx.globalAlpha = al;
          ctx.beginPath();
          ctx.arc(CX[i], CY[i], r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // dots (crisp, source-over)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f6e4ae';
    for (let i = 0; i < nCities; i++) {
      const ap = cityAppear(i, p);
      if (ap <= 0.002) continue;
      const tour = isTour[i] === 1, w = FW[i], fw = f * w;
      let r = (tour ? 2.2 + TOUR_DOT_PX : 2.2) * dpr, al = ap * late;
      r += (4 - 2.2) * dpr * fw;
      al *= 1 - (tour ? 0.12 : 0.3) * f * (1 - w);
      if (i === hoverIdx) r += 1 * dpr;
      if (shimmer) al *= 0.94 + 0.06 * Math.sin(t * 1.1 + i * 2.3);
      ctx.globalAlpha = al > 1 ? 1 : al;
      ctx.beginPath();
      ctx.arc(CX[i], CY[i], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBloom(p, wSum) {
    const bt = sstep(p, 0.86, 1);
    if (bt <= 0.002) return;
    // bloom centre: weight-averaged focus position (slides during a crossfade)
    let cx = 0, cy = 0;
    if (wSum > 1e-3) {
      for (let i = 0; i < nCities; i++) { const w = FW[i]; if (w > 0) { cx += CX[i] * w; cy += CY[i] * w; } }
      cx /= wSum; cy /= wSum;
    } else { cx = CX[focusIdx]; cy = CY[focusIdx]; }
    const R = Math.max(1, bt * 1.4 * Math.hypot(W, H));
    const a = 0.9 * bt;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(232,205,147,${a.toFixed(3)})`);
    g.addColorStop(0.28, `rgba(232,205,147,${(a * 0.5).toFixed(3)})`);
    g.addColorStop(0.62, `rgba(201,154,63,${(a * 0.16).toFixed(3)})`);
    g.addColorStop(1, 'rgba(11,10,8,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    // only touch the bloom's bounding square (it covers the whole canvas by p = 1)
    const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
    const x1 = Math.min(W, cx + R), y1 = Math.min(H, cy + R);
    if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Loop                                                                                      */
  /* ---------------------------------------------------------------------------------------- */
  function frame(ts) {
    rafId = 0;
    if (!running && !mini) return;                                 // mini renders on demand, always
    const idle = running && live;                                  // shimmer → continuous 30 fps
    const fxNow = !reduced && ts < focusEnd;                       // focus crossfade → every frame
    if (dirty || fxNow || fxTail || (idle && ts - lastDraw >= 1000 / IDLE_FPS - 2)) {
      dirty = false; lastDraw = ts;
      render(ts);
    }
    fxTail = fxNow;                                                // one settle frame after the crossfade
    if (idle || fxNow || fxTail) rafId = requestAnimationFrame(frame);   // otherwise sleep until dirty
  }
  function schedule() {
    if (!rafId && (running || mini)) rafId = requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Hover                                                                                     */
  /* ---------------------------------------------------------------------------------------- */
  function updateHover() {
    let best = -1;
    if (!Number.isNaN(ptrX) && nCities && W && H) {
      let bd = (HOVER_PX * dpr) * (HOVER_PX * dpr);
      for (let i = 0; i < nCities; i++) {
        if (cityAppear(i, prog) < 0.35) continue;                  // only cities that are visible
        const dx = CX[i] - ptrX, dy = CY[i] - ptrY, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    if (best === hoverIdx) return;                                 // delta-gated
    hoverIdx = best;
    applyChip();
    dirty = true; schedule();
  }
  function applyChip() {
    if (!chip) return;
    if (hoverIdx < 0) { chip.classList.remove('is-on'); return; }
    chip.textContent = cityInfo[hoverIdx] || cityNames[hoverIdx];
    chip.style.left = (CX[hoverIdx] / dpr).toFixed(1) + 'px';
    chip.style.top = (CY[hoverIdx] / dpr).toFixed(1) + 'px';
    chip.classList.add('is-on');
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Public API                                                                                */
  /* ---------------------------------------------------------------------------------------- */
  function setProgress(p) {
    if (!isNum(p)) return;
    p = clamp01(p);
    if (p === prog) return;
    prog = p;
    dirty = true;
    if (!Number.isNaN(ptrX) || hoverIdx >= 0) updateHover();      // visibility thresholds moved
    schedule();
  }

  function setPointer(nx, ny) {
    if (nx == null || ny == null || !isNum(nx) || !isNum(ny)) { ptrX = NaN; ptrY = NaN; }
    else { ptrX = nx * W; ptrY = ny * H; }
    updateHover();
  }

  /** Move the pulse rings / bloom to another city (key or display name, case/accent-insensitive).
      Unknown names are ignored; null clears the focus. Eases over ≈600 ms (instant when reduced). */
  function setFocus(name) {
    let idx;
    if (name == null) idx = -1;
    else { idx = resolveCity(name); if (idx < 0) return; }
    if (idx === focusIdx) return;
    retarget(idx);
    dirty = true; schedule();
  }
  function getFocus() { return focusIdx >= 0 ? cityNames[focusIdx] : null; }

  function resize() {
    const parent = canvas.parentElement;
    const cssW = canvas.clientWidth || (parent ? parent.clientWidth : 0) || 0;
    const cssH = canvas.clientHeight || (parent ? parent.clientHeight : 0) || 0;
    const ndpr = Math.min(DPR_CAP, Math.max(0.5, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const nW = Math.max(0, Math.round(cssW * ndpr)), nH = Math.max(0, Math.round(cssH * ndpr));
    if (nW === W && nH === H && ndpr === dpr) return;            // nothing changed
    const dprChanged = ndpr !== dpr;
    W = nW; H = nH; dpr = ndpr;
    if (!W || !H) return;                                          // collapsed stage: draw nothing, never throw
    if (canvas.width !== W) canvas.width = W;                      // (resets the context state)
    if (canvas.height !== H) canvas.height = H;
    if (dprChanged || !sprites) sprites = buildSprites(dpr);
    relayout();
    if (!Number.isNaN(ptrX)) updateHover();                        // pointer px are stale after a resize
    else if (hoverIdx >= 0) applyChip();
    dirty = true; schedule();
  }

  function start() {
    if (running) return;
    running = true; dirty = true;
    schedule();
  }
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }
  function destroy() {
    stop();
    if (ro) ro.disconnect();
    if (chip) chip.classList.remove('is-on');
    if (W && H) ctx.clearRect(0, 0, W, H);
    hoverIdx = -1; ptrX = NaN; ptrY = NaN;
    outline = null; route = null; sprites = null;
  }

  /* ---- observe the stage ---- */
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement || canvas);
  }
  resize();

  return { setProgress, setPointer, setFocus, getFocus, start, stop, resize, destroy };
}
