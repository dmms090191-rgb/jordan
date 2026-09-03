/* La Compagnie de l'Or · Du bijou au lingot · main.js (v2, one continuous journey)
   Plain ES module. No framework. Every scroll-driven write is delta-gated.
*/

/* ==================== Editable business constants ==================== */
// Le bijou du parcours : 42,80 g, or 750 ‰ → 32,10 g d'or pur.
const BIJOU = { poids: 42.80, titre: 750 };

// Agenda. Une entrée par étape (date ISO). Les prochaines dates sont ajoutées ici, jamais inventées.
const AGENDA_PROCHAINES = [
  // { date: '2026-09-14', ville: 'Colmar', cp: '68000', lieu: 'Hôtel …', adresse: '…', horaires: '9h30 à 18h30' },
];
const AGENDA_PASSEES = [
  { date: '2026-06-08', ville: 'Erstein', cp: '67150', lieu: 'Hôtel Restaurant Crystal', adresse: '41-43 avenue de la Gare', horaires: '9h30 à 18h30, non stop' },
  { date: '2026-06-09', ville: 'Obernai', cp: '67210', lieu: 'Hôtel La Diligence', adresse: '23 place du Marché', horaires: '9h30 à 18h30, non stop' },
  { date: '2026-06-10', ville: 'Gérardmer', cp: '88400', lieu: 'Le Manoir au Lac', adresse: '59 chemin de la Droite du Lac', horaires: '9h30 à 18h30, non stop' },
  { date: '2026-06-11', ville: 'Barr', cp: '67140', lieu: 'Hôtel Le Manoir', adresse: '11 rue Saint-Marc', horaires: '9h30 à 18h30, non stop' },
];
// Avis clients : laisser vide tant qu'il n'y a pas d'avis réels et vérifiés. La section reste cachée si vide.
const AVIS = [];

// Tablet categories (order locked in storyboard-v2.md §3). media: video (web derivative) or still.
const TABLET = [
  { n: '01', name: 'Bijoux en or', line: 'Anciens, modernes ou cassés.', video: 'assets/video/tab-01.mp4', img: 'assets/img/tab-01.jpg' },
  { n: '02', name: 'Bijoux en argent', line: 'Colliers, bracelets, bagues.', video: 'assets/video/tab-02.mp4', img: 'assets/img/tab-02.jpg' },
  { n: '03', name: 'Montres', line: 'Anciennes, modernes ou de collection.', video: 'assets/video/tab-03.mp4', img: 'assets/img/tab-03.jpg' },
  { n: '04', name: "Pièces d'or et d'argent", line: "De collection ou d'investissement.", video: 'assets/video/tab-04.mp4', img: 'assets/img/tab-04.jpg' },
  { n: '05', name: "Lingots d'or et d'argent", line: 'Tous formats.', video: 'assets/video/tab-05.mp4', img: 'assets/img/tab-05.jpg', hold: true },
  { n: '06', name: 'Bijoux signés', line: 'Créateurs et grandes maisons.', video: 'assets/video/tab-06.mp4', img: 'assets/img/tab-06.jpg' },
  { n: '07', name: 'Pierres précieuses', line: 'Diamants, rubis, saphirs.', video: 'assets/video/tab-07.mp4', img: 'assets/img/tab-07.jpg' },
  { n: '08', name: 'Argenterie', line: 'Ménagères, plateaux, orfèvrerie.', video: 'assets/video/tab-08.mp4', img: 'assets/img/tab-08.jpg' },
  { n: '09', name: 'Plaqué or', line: 'Même usé.', video: 'assets/video/tab-09.mp4', img: 'assets/img/tab-09.jpg' },
  { n: '10', name: 'Or dentaire', line: 'Présenté avec discrétion.', video: 'assets/video/tab-10.mp4', img: 'assets/img/tab-10.jpg' },
  { n: '11', name: 'Billets de collection', line: 'Anciens ou étrangers.', video: 'assets/video/tab-11.mp4', img: 'assets/img/tab-11.jpg' },
  { n: '12', name: 'Platine et étain', line: 'Et autres métaux acceptés.', video: 'assets/video/tab-12.mp4', img: 'assets/img/tab-12.jpg' },
];

/* ==================== Utils ==================== */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (p, e0, e1) => { const t = clamp((p - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const fmtFR = (n, dec = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtEuro = n => Math.round(n).toLocaleString('fr-FR');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reduceMQ.matches;
const vh = () => window.innerHeight;
const fdate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* ==================== Text splitting (once at load) ==================== */
function splitText() {
  let seed = 7;
  document.querySelectorAll('[data-split]').forEach(el => {
    const mode = el.dataset.split;
    const fx = el.closest('[data-fx]')?.dataset.fx || 'rise';
    const r = rng(seed++ * 9973);
    const text = el.textContent;
    const sr = document.createElement('span');
    sr.textContent = text;
    sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    const build = () => {
      const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
      const words = [];
      [...el.childNodes].forEach(n => {
        const em = n.nodeType === 1 && n.tagName === 'EM';
        n.textContent.split(/(\s+)/).forEach(part => { if (!part) return; if (/^\s+$/.test(part)) words.push({ space: true }); else words.push({ w: part, em }); });
      });
      const solid = words.filter(w => !w.space); const nWords = solid.length;
      const total = solid.reduce((a, w) => a + w.w.length, 0);
      let ci = 0, wi = 0;
      words.forEach(item => {
        if (item.space) { vis.appendChild(document.createTextNode(' ')); return; }
        const ws = document.createElement('span'); ws.className = 'w' + (item.em ? ' em' : '');
        const wth = fx === 'punch' ? wi / Math.max(1, nWords) * 0.5 : wi / Math.max(1, nWords) * 0.45 + r() * 0.04;
        ws.style.setProperty('--th', wth.toFixed(3));
        if (fx === 'halves') ws.style.setProperty('--jx', ((wi < nWords / 2 ? 1 : -1) * (30 + r() * 30)).toFixed(1) + 'px');
        if (mode === 'chars') {
          [...item.w].forEach(ch => {
            const cs = document.createElement('span'); cs.className = 'c'; cs.textContent = ch;
            let th;
            if (fx === 'grid') th = ci / total * 0.55 + r() * 0.06;
            else if (fx === 'weave') th = ci / total * 0.5 + r() * 0.08;
            else th = r() * 0.55;
            cs.style.setProperty('--th', th.toFixed(3));
            if (fx === 'grid') { cs.style.setProperty('--jx', (-60 - r() * 80).toFixed(1) + 'px'); cs.style.setProperty('--jy', '0px'); cs.style.setProperty('--jr', '0deg'); }
            else if (fx === 'weave') { cs.style.setProperty('--jx', '0px'); cs.style.setProperty('--jy', ((ci % 2 ? 1 : -1) * (22 + r() * 26)).toFixed(1) + 'px'); cs.style.setProperty('--jr', '0deg'); }
            else { cs.style.setProperty('--jx', ((r() - .5) * 140).toFixed(1) + 'px'); cs.style.setProperty('--jy', ((r() - .5) * 90).toFixed(1) + 'px'); cs.style.setProperty('--jr', ((r() - .5) * 30).toFixed(1) + 'deg'); }
            ws.appendChild(cs); ci++;
          });
        } else ws.textContent = item.w;
        vis.appendChild(ws); wi++;
      });
      return vis;
    };
    el.textContent = '';
    el.appendChild(sr);
    if (fx === 'blur') {
      const soft = document.createElement('span'); soft.className = 'soft'; soft.setAttribute('aria-hidden', 'true'); soft.textContent = text;
      const sharp = document.createElement('span'); sharp.className = 'sharp'; sharp.setAttribute('aria-hidden', 'true'); sharp.textContent = text;
      el.appendChild(soft); el.appendChild(sharp);
    } else el.appendChild(build());
  });
}

/* ==================== Bands (paced in scroll distance) ==================== */
class BandSet {
  constructor(root) {
    this.bands = [...root.querySelectorAll('.band')].map(b => {
      const [a, c] = b.dataset.range.split(/\s+/).map(Number);
      return { el: b, a, b: c, first: b.hasAttribute('data-first'), last: b.hasAttribute('data-last'), stay: b.hasAttribute('data-stay'), ramp: b.dataset.ramp ? Number(b.dataset.ramp) : null, op: -1, k: -1, on: null };
    });
    this.loadK = 0;
  }
  update(p) {
    for (const bd of this.bands) {
      const { a, b } = bd; const f = Math.min(0.02, (b - a) / 3);
      let o = (bd.first ? 1 : smoothstep(p, a, a + f)) * (bd.last ? 1 : 1 - smoothstep(p, b - f, b));
      if (bd.first && p < a) o = 1;
      if (bd.last && p > b) o = 1;
      if (!bd.first && p < a) o = 0;
      if (!bd.last && p > b) o = 0;
      if (bd.dismissed) o = 0;                                          // texte lié à la séquence : parti après l'arrêt
      let k = clamp((p - a) / (bd.ramp || Math.min(0.025, (b - a) * 0.35)), 0, 1);
      if (bd.first) k = Math.max(k, this.loadK);
      if (Math.abs(o - bd.op) > 0.004 || (o === 0 && bd.op !== 0) || (o === 1 && bd.op !== 1)) { bd.op = o; bd.el.style.opacity = o.toFixed(3); }
      if (Math.abs(k - bd.k) > 0.008 || (k === 1 && bd.k !== 1) || (k === 0 && bd.k !== 0)) { bd.k = k; bd.el.style.setProperty('--k', k.toFixed(3)); }
      const on = o > 0.5;
      if (on !== bd.on) { bd.on = on; bd.el.classList.toggle('is-on', on); }
    }
  }
  /* Séquence terminée + caméra stabilisée → fondu doux des textes encore visibles */
  fadeOutVisible(ms = 700) {
    for (const bd of this.bands) {
      if (bd.stay || bd.dismissed || bd.op < 0.5) continue;             // data-stay : reste à l'arrêt (scène lobby)
      bd.dismissed = true;
      const from = bd.op, t0 = performance.now(), el = bd.el; bd.op = 0;
      const step = now => { if (!bd.dismissed) return; const k = Math.min(1, (now - t0) / ms); el.style.opacity = (from * (1 - (1 - Math.cos(Math.PI * k)) / 2)).toFixed(3); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }
  /* Nouvelle séquence : réarmer ce qui doit pouvoir (ré)apparaître */
  armForPlay(forward, p) { for (const bd of this.bands) { if (!bd.dismissed) continue; if (!forward || p < bd.a) { bd.dismissed = false; bd.op = -1; bd.k = -1; } } }
  clearDismissed() { for (const bd of this.bands) { if (bd.dismissed) { bd.dismissed = false; bd.op = -1; } } }
  pinFinal() { for (const bd of this.bands) { bd.el.style.setProperty('--k', '1'); bd.k = 1; } }
}

/* ==================== Chapter base ==================== */
class Chapter {
  constructor(section) {
    this.el = section; this.stage = section.querySelector('.stage');
    this.bands = new BandSet(section);
    this.p = -1; this.visible = false; this.near = false;
    /* LE POINT DE GREFFE DU FILM. Quand le moteur de sequences est actif, il
       impose le progres par le temps ; la geometrie de defilement ne commande
       plus rien. Un seul point de greffe : tous les types de chapitres — film,
       tablette, pesee, proposition, carte de France, lingot — suivent. */
    this.filmP = null;
  }
  progress() {
    if (this.filmP !== null) return this.filmP;
    const r = this.el.getBoundingClientRect(); const range = r.height - vh(); return range <= 0 ? 1 : clamp(-r.top / range, 0, 1);
  }
  tick(now) { const p = this.progress(); this.bands.update(p); if (p !== this.p) { this.p = p; this.onProgress(p, now); } }
  onProgress() {}
  setNear(v) { this.near = v; }
  setVisible(v) { this.visible = v; }
  pinFinal() { this.bands.pinFinal(); }
}

/* ==================== Film chapter (scrub) ==================== */
const GATES = [
  '(max-width: 720px)',
  '(orientation: portrait) and (max-width: 1024px)',
  '(orientation: portrait) and (pointer: coarse)',
  '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
  '(prefers-reduced-motion: reduce)'
];
const MQLS = GATES.map(q => matchMedia(q));
/* LE FILM TOURNE PARTOUT, telephone compris : la seule porte qui reste est
   prefers-reduced-motion, qui rend la page statique et epinglee. Les anciennes
   portes de largeur / pointeur ne decident plus que des reglages de geste. */
const staticMode = () => reduceMQ.matches;
const coarseMode = () => matchMedia('(pointer: coarse)').matches;

class FilmChapter extends Chapter {
  constructor(section) {
    super(section);
    this.video = section.querySelector('video'); this.ring = section.querySelector('.ring');
    this.pickAmbiance(); this.blobUrl = null;
    this.target = 0; this.shown = 0; this.rafId = null; this.lastTick = 0;
    this.seekBusy = false; this.pending = null; this.started = false; this.ready = false; this.failed = false;
    this.video.addEventListener('seeked', () => { this.seekBusy = false; if (this.pending !== null) { const t = this.pending; this.pending = null; this.requestSeek(t); } });
    this.video.addEventListener('error', () => { this.seekBusy = false; this.pending = null; if (!this.ready) this.fail(); });
    const dust = section.querySelector('.dust');
    if (dust) this.particles = new Dust(dust, dust.classList.contains('dust--embers') ? 'embers' : dust.classList.contains('dust--snow') ? 'snow' : 'dust');
    this.abImgs = [...section.querySelectorAll('.ab-variant')].map(el => ({ el, v: (el.dataset.vis || '-1 -0.5 2 2.5').split(/\s+/).map(Number), last: -1 })); this.veil = section.querySelector('.veil:not(.veil--left)'); this.veilLeft = section.querySelector('.veil--left'); this.sideveil = section.querySelector('.sideveil'); this.lastVeil = -1; this.lastVeilL = -1; this.lastSv = -1; this.veilLoadK = 0; this.svDismissed = false;
  }
  arm() { if (this.started || staticMode()) return; this.started = true; this.stage.classList.add('is-loading'); this.load().catch(() => this.fail()); }
  /* Parcours double ambiance : chaque chapitre film choisit sa video selon le mode Jour / Nuit */
  pickAmbiance() {
    const d = this.el.dataset, jour = document.documentElement.dataset.ambiance === 'jour' && d.videoJour;
    this.src = jour ? d.videoJour : d.video;
    this.bytes = Number(jour ? d.bytesJour || d.bytes : d.bytes) || 0;
    const poster = this.el.querySelector('.poster');
    if (poster) { const want = jour && d.posterJour ? d.posterJour : (poster.dataset.srcNuit || poster.getAttribute('src')); if (!poster.dataset.srcNuit) poster.dataset.srcNuit = poster.getAttribute('src'); if (poster.getAttribute('src') !== want) poster.setAttribute('src', want); }
  }
  swapAmbiance() {
    const prev = this.src; this.pickAmbiance();
    if (this.src === prev || !this.started) return;
    if (this.blobUrl) { try { URL.revokeObjectURL(this.blobUrl); } catch (e) {} this.blobUrl = null; }
    this.started = false; this.ready = false; this.failed = false;
    this.stage.classList.remove('video-ready', 'video-failed');
    if (this.near || this.visible) this.arm();                          // recharge en priorite ce qui est a l ecran
  }
  async load() {
    const ctrl = new AbortController(); let watchdog = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(this.src, { priority: 'low', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error('video ' + res.status);
    const total = Number(res.headers.get('Content-Length')) || this.bytes || 1;
    const reader = res.body.getReader(); const chunks = []; let got = 0, lastRing = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      clearTimeout(watchdog); watchdog = setTimeout(() => ctrl.abort(), 25000);
      chunks.push(value); got += value.length;
      const frac = Math.min(1, got / total); const now = performance.now();
      if (now - lastRing > 100 || frac === 1) { lastRing = now; this.ring.style.setProperty('--ld', Math.round(126 * (1 - frac))); }
    }
    clearTimeout(watchdog); this.ring.style.setProperty('--ld', 0);
    this.blobUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' })); this.video.src = this.blobUrl; this.video.load();
    await new Promise((ok, ko) => { this.video.addEventListener('canplay', ok, { once: true }); this.video.addEventListener('error', ko, { once: true }); });
    this.ready = true; this.stage.classList.remove('is-loading');
    this.target = this.shown = this.progress(); this.requestSeek(this.shown * this.video.duration);
    this.stage.classList.add('video-ready');
  }
  fail() {
    this.failed = true; this.stage.classList.remove('is-loading'); this.stage.classList.add('video-failed');
    if (this.ring && !this.ring.classList.contains('chevron')) {
      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('class', 'chevron'); chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="1.5"/>';
      this.ring.replaceWith(chev); this.ring = chev;
    }
  }
  requestSeek(t) { if (!this.video.duration) return; if (this.seekBusy) { this.pending = t; return; } this.seekBusy = true; this.video.currentTime = t; }
  onProgress(p) {
    this.target = p;
    if (this.ready && this.rafId === null && this.visible) this.rafId = requestAnimationFrame(ts => this.lerp(ts));
    if (this.veil) { const v = (1 - smoothstep(p, 0.0, 0.16)) * (1 - this.veilLoadK); if (Math.abs(v - this.lastVeil) > 0.005 || (v === 0 && this.lastVeil !== 0)) { this.lastVeil = v; this.veil.style.opacity = v.toFixed(3); } }
    if (this.veilLeft) { const v = 1 - smoothstep(p, 0.34, 0.52); if (Math.abs(v - this.lastVeilL) > 0.005 || (v === 0 && this.lastVeilL !== 0)) { this.lastVeilL = v; this.veilLeft.style.opacity = v.toFixed(3); } }
    for (const ab of this.abImgs) { const o = smoothstep(p, ab.v[0], ab.v[1]) * (1 - smoothstep(p, ab.v[2], ab.v[3])); if (Math.abs(o - ab.last) > 0.005 || (o === 0 && ab.last !== 0) || (o === 1 && ab.last !== 1)) { ab.last = o; ab.el.style.opacity = o.toFixed(3); } }
    if (this.sideveil) { let v = this.sideveil.classList.contains('sideveil--lobby') ? Math.max(1 - smoothstep(p, 0.30, 0.38), smoothstep(p, 0.822, 0.845) * (1 - smoothstep(p, 0.86, 0.885))) : this.sideveil.classList.contains('sideveil--intro') ? 1 : smoothstep(p, 0.0, 0.06); if (this.svDismissed) v = 0; if (Math.abs(v - this.lastSv) > 0.005 || (v === 1 && this.lastSv !== 1) || (v === 0 && this.lastSv !== 0)) { this.lastSv = v; this.sideveil.style.setProperty('--sv', v.toFixed(3)); } }
  }
  /* Le grand voile suit la même règle que les textes : présent pendant toute la séquence, fondu après l'arrêt */
  fadeOutSideveil(ms = 700) {
    if (!this.sideveil || this.sideveil.classList.contains('sideveil--stay') || this.svDismissed || this.lastSv < 0.05) return;
    this.svDismissed = true;
    const from = Math.max(0, this.lastSv), t0 = performance.now(); this.lastSv = 0;
    const step = now => { if (!this.svDismissed) return; const k = Math.min(1, (now - t0) / ms); this.sideveil.style.setProperty('--sv', (from * (1 - (1 - Math.cos(Math.PI * k)) / 2)).toFixed(3)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  armSvForPlay(forward) { if (!this.svDismissed) return; if (!forward || this.progress() <= 0.001) { this.svDismissed = false; this.lastSv = -1; } }
  lerp(now) {
    const dt = Math.min(100, now - (this.lastTick || now)); this.lastTick = now; const k = 0.24;
    this.shown += (this.target - this.shown) * (1 - Math.pow(1 - k, dt / 16.667));
    if (Math.abs(this.target - this.shown) < 0.0005) { this.shown = this.target; this.rafId = null; this.lastTick = 0; }
    else this.rafId = requestAnimationFrame(ts => this.lerp(ts));
    this.requestSeek(this.shown * this.video.duration);
  }
  setVisible(v) {
    super.setVisible(v);
    if (!v && this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; this.lastTick = 0; }
    if (v && this.ready) this.onProgress(this.progress());
    this.particles?.setRunning(v && !reduced());
  }
  disarmRuntime() { if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; } }
  pinFinal() { super.pinFinal(); if (this.veil) this.veil.style.opacity = '0'; if (this.veilLeft) this.veilLeft.style.opacity = '0'; }
}

/* ==================== Dust / snow / embers (whisper level) ==================== */
class Dust {
  constructor(canvas, kind) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.kind = kind; this.running = false; this.raf = null;
    const r = rng(kind === 'embers' ? 99 : kind === 'snow' ? 17 : 41);
    this.n = kind === 'snow' ? 140 : kind === 'embers' ? 34 : 28;
    this.pts = Array.from({ length: this.n }, () => ({ x: r(), y: r(), s: kind === 'snow' ? .6 + r() * 1.8 : .4 + r() * 1.4, v: kind === 'snow' ? .05 + r() * .09 : (.02 + r() * .05) * (kind === 'embers' ? -1 : .5), a: kind === 'snow' ? .25 + r() * .5 : .15 + r() * .45, ph: r() * 6.28, dx: (r() - .5) * .03, depth: r() }));
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas.parentElement); this.resize();
  }
  resize() { const p = this.c.parentElement.getBoundingClientRect(); const dpr = Math.min(1.5, devicePixelRatio || 1); this.c.width = Math.max(1, p.width * dpr); this.c.height = Math.max(1, p.height * dpr); this.dpr = dpr; }
  setRunning(v) { if (v === this.running) return; this.running = v; if (v) this.raf = requestAnimationFrame(t => this.frame(t)); else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } }
  frame(t) {
    if (!this.running) return;
    const { g, c } = this; const w = c.width, h = c.height; g.clearRect(0, 0, w, h); const tt = t / 1000;
    for (const p of this.pts) {
      if (this.kind === 'snow') { p.y += p.v * 0.0022 * (0.5 + p.depth); p.x += Math.sin(tt * .5 + p.ph) * 0.00035 + p.dx * 0.0006; }
      else { p.y += p.v * 0.0016 * (this.kind === 'embers' ? 1.6 : 1); p.x += Math.sin(tt * .3 + p.ph) * 0.00025 + p.dx * 0.001; }
      if (p.y > 1.05) p.y = -0.05; if (p.y < -0.05) p.y = 1.05; if (p.x > 1.05) p.x = -0.05; if (p.x < -0.05) p.x = 1.05;
      const tw = .5 + .5 * Math.sin(tt * 1.3 + p.ph * 3); const a = p.a * (0.45 + 0.55 * tw);
      g.beginPath(); g.arc(p.x * w, p.y * h, p.s * this.dpr * (this.kind === 'embers' ? 1.3 : 1), 0, 6.283);
      g.fillStyle = this.kind === 'embers' ? `rgba(255,${150 + (tw * 60) | 0},70,${a})` : this.kind === 'snow' ? `rgba(236,232,224,${a * (0.5 + p.depth * 0.5)})` : `rgba(232,205,147,${a})`;
      g.fill();
    }
    this.raf = requestAnimationFrame(ts => this.frame(ts));
  }
}

/* ==================== Depth still chapters ==================== */
class DepthChapter extends Chapter {
  constructor(s) { super(s); this.depth = s.querySelector('.depth'); this.lastT = ''; }
  onProgress(p) { const ty = (p - .5) * -6, sc = 1.04 + p * 0.06; const t = `translate3d(0,${ty.toFixed(2)}%,0) scale(${sc.toFixed(4)})`; if (t !== this.lastT && !reduced()) { this.lastT = t; this.depth.style.transform = t; } }
}

/* ==================== Tablet chapter (what we buy) ==================== */
class TabletChapter extends Chapter {
  constructor(s) {
    super(s);
    this.idx = -1; this.items = TABLET; this.n = this.items.length;
    // The photographed screen's four corners, in % of the 16:9 cover frame (TL, TR, BR, BL),
    // measured on tablette-bg. Inset slightly so the media never overshoots the bezel.
    this.quad = [[19.50, 30.55], [59.26, 31.42], [61.78, 81.42], [19.94, 82.72]];
    this.frame = s.querySelector('.cover-frame');
    this.screenEl = s.querySelector('.tablet__screen');
    this.imgs = [s.querySelector('#tapp-img-a'), s.querySelector('#tapp-img-b')];
    this.vids = [s.querySelector('#tapp-video-a'), s.querySelector('#tapp-video-b')];
    this.name = s.querySelector('#tapp-name'); this.line = s.querySelector('#tapp-line'); this.index = s.querySelector('#tapp-index');
    this.ticks = s.querySelector('#tapp-ticks'); this.ticks.innerHTML = this.items.map(() => '<li></li>').join(''); this.tickEls = [...this.ticks.children];
    this.screenOff = s.querySelector('.tapp__off'); this.tablet = s.querySelector('#tablet'); this.lastOn = -1; this.lastOff = -1;
    this.slot = 0; this.loaded = new Set();
    this.fit(); this.roFit = new ResizeObserver(() => this.fit()); this.roFit.observe(this.frame);
  }
  fit() {
    const t = this.tablet;
    if (staticMode()) { t.style.left = t.style.top = t.style.width = t.style.height = t.style.transform = t.style.transformOrigin = ''; this.screenEl.style.borderRadius = ''; return; }
    const W = this.frame.clientWidth, H = this.frame.clientHeight; if (!W || !H) return;
    const q = this.quad.map(([x, y]) => [x / 100 * W, y / 100 * H]);
    // internal box sized to the on-screen average, so typography keeps its designed size
    const BW = ((q[1][0] - q[0][0]) + (q[2][0] - q[3][0])) / 2;
    const BH = ((q[3][1] - q[0][1]) + (q[2][1] - q[1][1])) / 2;
    t.style.left = '0'; t.style.top = '0'; t.style.width = BW.toFixed(1) + 'px'; t.style.height = BH.toFixed(1) + 'px';
    t.style.transformOrigin = '0 0'; t.style.transform = matrix3dFor(BW, BH, q);
    this.screenEl.style.borderRadius = Math.max(8, W * 0.011).toFixed(1) + 'px';
  }
  setNear(v) { super.setNear(v); if (v) this.preload(0); }
  preload(i) { for (let k = i; k < Math.min(this.n, i + 3); k++) { const it = this.items[k]; if (!this.loaded.has(k)) { this.loaded.add(k); const im = new Image(); im.src = it.img; } } }
  onProgress(p) {
    // screen on ramp at the start, off ramp at the end
    const on = smoothstep(p, 0.0, 0.06); if (Math.abs(on - this.lastOn) > 0.01) { this.lastOn = on; this.tablet.style.setProperty('--on', on.toFixed(3)); }
    const off = smoothstep(p, 0.90, 0.98); if (Math.abs(off - this.lastOff) > 0.01) { this.lastOff = off; this.tablet.style.setProperty('--off', off.toFixed(3)); }
    const span = (0.90 - 0.06) / this.n; const idx = clamp(Math.floor((p - 0.06) / span), 0, this.n - 1);
    if (idx !== this.idx) this.show(idx);
  }
  show(idx) {
    const it = this.items[idx]; const prev = this.idx; this.idx = idx;
    this.slot = 1 - this.slot; const img = this.imgs[this.slot], vid = this.vids[this.slot];
    const oImg = this.imgs[1 - this.slot], oVid = this.vids[1 - this.slot];
    img.src = it.img; img.classList.add('is-on'); oImg.classList.remove('is-on');
    oVid.classList.remove('is-on'); oVid.pause();
    if (it.video && !staticMode()) {
      vid.src = it.video; vid.currentTime = 0; vid.classList.add('is-on');
      vid.play().catch(() => {});
    } else { vid.classList.remove('is-on'); vid.removeAttribute('src'); }
    this.name.textContent = it.name; this.line.textContent = it.line; this.index.textContent = `${it.n} / ${String(this.n).padStart(2, '0')}`;
    this.tickEls.forEach((t, i) => t.classList.toggle('is-on', i <= idx));
    this.el.querySelector('.tapp__caption').classList.remove('is-in'); void this.el.offsetWidth; this.el.querySelector('.tapp__caption').classList.add('is-in');
    this.tablet.classList.toggle('is-hold', !!it.hold);
    this.preload(idx + 1);
  }
  setVisible(v) { super.setVisible(v); if (!v) this.vids.forEach(x => x.pause()); }
  pinFinal() { super.pinFinal(); this.tablet.style.setProperty('--on', '1'); }
}

/* ==================== Weighing film (footage + controlled display) ==================== */
class WeighFilmChapter extends FilmChapter {
  constructor(s) {
    super(s);
    this.contact = Number(s.dataset.contact) || 0.345; this.release = Number(s.dataset.release) || 0.74; this.settle = Number(s.dataset.settle) || 0.82;
    this.num = s.querySelector('#readout-num'); this.state = s.querySelector('#readout-state'); this.lcd = s.querySelector('#lcd-num'); this.dot = s.querySelector('#lcd-dot');
    this.lastTxt = ''; this.lastState = ''; this.rngW = rng(5);
    // the natural climb: a scale's response, first-order with a small overshoot, sampled in progress space
    this.steps = [0, 0.13, 0.28, 0.41, 0.56, 0.66, 0.76, 0.86, 0.93, 0.97, 0.99, 1.0];
  }
  reading(p) {
    // Physical story: nothing touches → 0.00; from first contact the pan carries a growing share of the chain
    // while the hand still holds the rest; at release the full weight lands, overshoots a hair, then settles.
    const W = BIJOU.poids;
    if (p < this.contact) return { w: 0, settled: true };
    if (p >= this.settle) return { w: W, settled: true };
    if (p < this.release) {
      const t = (p - this.contact) / (this.release - this.contact);
      const share = 0.08 + 0.74 * (1 - Math.pow(1 - t, 1.8));      // 8% → 82% of the weight supported
      const jitter = Math.sin(t * 70) * 0.025 * (1 - t * 0.6);       // small live flicker
      return { w: Math.max(0, Math.min(W, W * share + jitter)), settled: false };
    }
    const t = (p - this.release) / (this.settle - this.release);
    const over = 1 + 0.012 * Math.sin(t * Math.PI) * (1 - t);        // a hair of overshoot that dies out
    const w = W * (0.82 + 0.18 * (1 - Math.pow(1 - t, 2.5))) * over;
    return { w: Math.max(0, Math.min(W * 1.01, w)), settled: false };
  }
  onProgress(p) {
    super.onProgress(p);
    const { w, settled } = this.reading(p);
    const txt = fmtFR(w, 2);
    if (txt !== this.lastTxt) { this.lastTxt = txt; this.num.textContent = txt; this.lcd.textContent = txt.replace(',', '.'); }
    const st = settled ? 'stable' : 'mesure';
    if (st !== this.lastState) { this.lastState = st; this.state.textContent = st; this.state.classList.toggle('is-live', !settled); this.dot.classList.toggle('is-on', settled); }
  }
  pinFinal() { super.pinFinal(); this.onProgress(1); }
}

/* ==================== V3 : readouts d'instrument et scenes code ====================
   Le cadran n'est jamais confie a la video : un readout DOM flottant porte les
   chiffres, cale sur les fenetres d'etats du master (bornes par ambiance). */
class V3PeseeChapter extends FilmChapter {
  constructor(s) {
    super(s);
    this.ro = s.querySelector('#ro-pesee'); this.n = s.querySelector('#ro-pesee-n'); this.st = s.querySelector('#ro-pesee-s');
    this.lastTxt = ''; this.lastSt = ''; this.lastOn = false;
  }
  bornes() { return document.documentElement.dataset.ambiance === 'jour'
    ? { tare: 0.16, contact: 0.50, stable: 0.80 } : { tare: 0.14, contact: 0.66, stable: 0.88 }; }
  onProgress(p) {
    super.onProgress(p);
    const b = this.bornes();
    const on = p >= b.tare;
    let txt = '0,00', st = 'tare';
    if (p >= b.contact) {
      const t = clamp((p - b.contact) / (b.stable - b.contact), 0, 1);
      const e = 1 - Math.pow(1 - t, 2.2);
      txt = fmtFR(Math.min(42.8, 42.8 * e), 2); st = t >= 1 ? 'stable' : 'mesure';
    }
    if (on !== this.lastOn) { this.lastOn = on; this.ro.classList.toggle('is-on', on); }
    if (txt !== this.lastTxt) { this.lastTxt = txt; this.n.textContent = txt; }
    if (st !== this.lastSt) { this.lastSt = st; this.st.textContent = st; this.ro.classList.toggle('is-stable', st === 'stable'); }
  }
  pinFinal() { super.pinFinal(); this.onProgress(1); }
}
class V3LingotChapter extends FilmChapter {
  constructor(s) { super(s); this.ro = s.querySelector('#ro-lingot'); this.n = s.querySelector('#ro-lingot-n');
    this.lastOn = false; this.lastTxt = ''; this.frappe = false; }
  onProgress(p) {
    super.onProgress(p);
    /* LE coup de poincon : la demi-seconde d'obscurite du montage (~p 0,49) */
    if (!this.frappe && p >= 0.49 && p < 0.7) { this.frappe = true; sound.frappe(); }
    if (p < 0.4) this.frappe = false;
    const on = p >= 0.76;
    if (on !== this.lastOn) { this.lastOn = on; this.ro.classList.toggle('is-on', on); }
    const t = clamp((p - 0.78) / 0.1, 0, 1);
    const txt = fmtFR(31.98 * (0.9 + 0.1 * t), 2);
    if (on && txt !== this.lastTxt) { this.lastTxt = txt; this.n.textContent = t >= 1 ? '31,98' : txt; }
  }
  pinFinal() { super.pinFinal(); this.onProgress(1); }
}
class V3RevealChapter extends Chapter {                 // scenes code : lignes revelees par seuils
  constructor(s) { super(s); this.items = [...s.querySelectorAll('[data-at]')].map(el => ({ el, at: Number(el.dataset.at), on: false })); }
  onProgress(p) { for (const it of this.items) { const on = p >= it.at; if (on !== it.on) { it.on = on; it.el.classList.toggle('is-on', on); } } }
  pinFinal() { super.pinFinal(); this.onProgress(1); }
}
class V3CalcChapter extends V3RevealChapter {}
class V3KitDocChapter extends V3RevealChapter {}

/* ==================== Homography helper: map a W×H box onto a 4-point quad (CSS matrix3d) ==================== */
function solveHomography(src, dst) { // src/dst: [[x,y]×4], returns 3x3 as array of 9 (row-major)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // gaussian elimination on 8x8
  const n = 8; const M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c] || 1e-9;
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const h = M.map(r => r[n]); return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function matrix3dFor(W, H, quadPx) { // quadPx: TL,TR,BR,BL in px of the element's offset parent
  const h = solveHomography([[0, 0], [W, 0], [W, H], [0, H]], quadPx);
  // CSS matrix3d is column-major 4x4; map x,y (z=0): [a,b,0,c ; d,e,0,f ; 0,0,1,0 ; g,h,0,i]
  const m = [h[0], h[3], 0, h[6],  h[1], h[4], 0, h[7],  0, 0, 1, 0,  h[2], h[5], 0, h[8]];
  return 'matrix3d(' + m.map(v => (Math.abs(v) < 1e-9 ? 0 : v).toPrecision(8)).join(',') + ')';
}
/* ==================== Card chapter (film + DOM card text) ==================== */
class CardChapter extends FilmChapter {
  constructor(s) { super(s); this.card = s.querySelector('#vcard'); this.lastVc = -1; this.on = false; this.frame = this.card.parentElement;
    // inner gold border of the photographed card, in % of the 16:9 frame (TL, TR, BR, BL)
    this.quad = [[22.9, 11.1], [88.5, 31.9], [79.4, 85.2], [8.6, 60.2]]; this.BW = 1000; this.BH = 540;
    this.card.style.cssText = 'left:0;top:0;width:' + this.BW + 'px;height:' + this.BH + 'px;transform-origin:0 0';
    this.fit(); this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.frame); }
  fit() { if (staticMode()) { this.card.style.transform = ''; this.card.style.width = ''; this.card.style.height = ''; return; } const W = this.frame.clientWidth, H = this.frame.clientHeight; if (!W || !H) return; this.card.style.width = this.BW + 'px'; this.card.style.height = this.BH + 'px'; this.card.style.transform = matrix3dFor(this.BW, this.BH, this.quad.map(([x, y]) => [x / 100 * W, y / 100 * H])); }
  onProgress(p) {
    super.onProgress(p);
    const vc = smoothstep(p, 0.58, 0.7); if (Math.abs(vc - this.lastVc) > 0.01) { this.lastVc = vc; this.card.style.setProperty('--vc', vc.toFixed(3)); }
    const on = p > 0.6; if (on !== this.on) { this.on = on; this.card.classList.toggle('is-on', on); }
  }
  pinFinal() { super.pinFinal(); this.card.style.setProperty('--vc', '1'); this.card.classList.add('is-on'); }
}
/* ==================== Collecte (gold veil + depth) ==================== */
class CollecteChapter extends DepthChapter {
  constructor(s) { super(s); this.veil = s.querySelector('.goldveil'); this.lastGv = -1; }
  onProgress(p) { super.onProgress(p); const gv = 1 - smoothstep(p, 0.0, 0.22); if (Math.abs(gv - this.lastGv) > 0.01 || (gv === 0 && this.lastGv !== 0)) { this.lastGv = gv; this.veil.style.setProperty('--gv', gv.toFixed(3)); } }
  pinFinal() { super.pinFinal(); this.veil.style.setProperty('--gv', '0'); }
}
/* ==================== Proposal + payment chapter ==================== */
class PayChapter extends Chapter {
  constructor(s) {
    super(s); this.doc = s.querySelector('.doc'); this.sig = s.querySelector('#sig-path');
    this.sig.style.setProperty('--len', Math.ceil(this.sig.getTotalLength() + 2));
    this.items = [...s.querySelectorAll('[data-at]')].map(el => ({ el, at: Number(el.dataset.at), on: false }));
    this.choice = null; this.lastSig = -1; this.lastDoc = -1; this.sigT0 = 0; this.raf = null;
    this.decline = s.querySelector('#doc-decline'); this.choiceBox = s.querySelector('#doc-choice'); this.signBox = s.querySelector('#doc-sign');
    this.medaillon = s.querySelector('#doc-medaillon');
    s.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => this.decide(b.dataset.choice)));
  }
  decide(c) {
    if (this.choice === c) return; this.choice = c;
    this.doc.classList.toggle('is-accepted', c === 'accept'); this.doc.classList.toggle('is-declined', c === 'decline');
    this.decline.hidden = c !== 'decline';
    if (this.medaillon) this.medaillon.hidden = c !== 'reflect';
    if (c === 'accept') { this.sigT0 = performance.now(); this.animateSig(); }
    else { this.sig.style.setProperty('--sig', '0'); this.lastSig = 0; }
  }
  animateSig() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const step = now => { const t = reduced() ? 1 : clamp((now - this.sigT0) / 1400, 0, 1); const e = t * t * (3 - 2 * t); this.sig.style.setProperty('--sig', e.toFixed(3)); this.lastSig = e; if (t < 1) this.raf = requestAnimationFrame(step); else this.raf = null; };
    this.raf = requestAnimationFrame(step);
  }
  onProgress(p) {
    const doc = smoothstep(p, 0.02, 0.12); if (Math.abs(doc - this.lastDoc) > 0.01) { this.lastDoc = doc; this.doc.style.setProperty('--doc', doc.toFixed(3)); }
    // the story's default path: if no choice was made, the proposal is accepted when the payment beat arrives
    if (this.choice === null && p >= 0.56) this.decide('accept');
    for (const it of this.items) { const on = p >= it.at && this.choice !== 'decline'; if (on !== it.on) { it.on = on; it.el.classList.toggle('is-on', on); } }
  }
  pinFinal() { super.pinFinal(); this.onProgress(1); }
}

/* ==================== France map chapter ==================== */
class FranceChapter extends Chapter {
  constructor(s) {
    super(s); this.canvas = s.querySelector('.france'); this.chip = s.querySelector('.france__chip'); this.map = null; this.loading = false;
    this.card = s.querySelector('#evcard'); this.tour = s.id === 's1' ? AGENDA_PASSEES.slice(-1) : AGENDA_PASSEES; this.cardIdx = -1;
    s.addEventListener('pointermove', e => { const r = this.canvas.getBoundingClientRect(); this.map?.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
    s.addEventListener('pointerleave', () => this.map?.setPointer(null));
  }
  async ensure() {
    if (this.map || this.loading) return; this.loading = true;
    try {
      const [{ createFranceMap }, data] = await Promise.all([import('./francemap.js'), franceData()]);
      this.map = createFranceMap(this.canvas, data, { chip: this.chip, reduced: reduced(), focusCity: 'Erstein', tour: this.tour.map(e => e.ville) });
      this.map.setProgress(this.progress()); if (this.visible) this.map.start();
    } catch (e) { console.warn('France map unavailable', e); }
  }
  setNear(v) { super.setNear(v); if (v) this.ensure(); }
  setVisible(v) { super.setVisible(v); if (this.map) { if (v) this.map.start(); else this.map.stop(); } }
  onProgress(p) {
    this.map?.setProgress(p);
    // event card: cycles through the last tour between p .52 and .86, on the focus city
    let idx = -1;
    if (p >= 0.52 && p < 0.88) idx = clamp(Math.floor((p - 0.52) / (0.36 / this.tour.length)), 0, this.tour.length - 1);
    if (idx !== this.cardIdx) {
      this.cardIdx = idx;
      if (idx < 0) { this.card.hidden = true; this.card.classList.remove('is-on'); }
      else {
        const e = this.tour[idx];
        this.card.querySelector('#evcard-city').textContent = `${e.ville} · ${e.cp}`; this.card.querySelector('#evcard-venue').textContent = e.lieu + ' · ' + e.adresse;
        this.card.querySelector('#evcard-date').textContent = fdate(e.date); this.card.querySelector('#evcard-hours').textContent = e.horaires;
        this.card.hidden = false; requestAnimationFrame(() => this.card.classList.add('is-on'));
        this.map?.setFocus?.(e.ville);
      }
    }
  }
  pinFinal() { super.pinFinal(); this.map?.setProgress(1); }
}
let franceDataP = null;
const franceData = () => franceDataP || (franceDataP = fetch('assets/js/france-outline.json').then(r => r.json()));

/* ==================== Gold bar chapter (3D) ==================== */
class BarChapter extends Chapter {
  constructor(s) { super(s); this.box = s.querySelector('#bar3d'); this.scene = null; this.loading = false; this.failed = false;
    s.addEventListener('pointermove', e => { const r = this.box.getBoundingClientRect(); this.scene?.setPointer((e.clientX - r.left) / r.width - .5, (e.clientY - r.top) / r.height - .5); });
    s.addEventListener('pointerleave', () => this.scene?.setPointer(0, 0));
  }
  async ensure() {
    if (this.scene || this.loading || this.failed || staticMode()) return; this.loading = true;
    try { const { createBarScene } = await import('./bar3d.js'); this.scene = await createBarScene(this.box, { reduced: reduced() }); this.scene.setProgress(this.progress()); if (this.visible) this.scene.start(); this.box.classList.add('is-3d'); }
    catch (e) { console.warn('3D bar unavailable, still fallback', e); this.failed = true; this.box.classList.add('is-fallback'); }
  }
  setNear(v) { super.setNear(v); if (v) this.ensure(); }
  setVisible(v) { super.setVisible(v); if (this.scene) { if (v) this.scene.start(); else this.scene.stop(); } }
  onProgress(p) { this.scene?.setProgress(p); }
}

/* ==================== Scroll orchestration ==================== */
const chapters = [];
function buildChapters() {
  document.querySelectorAll('.chapter').forEach(s => {
    let c;
    if (s.id === 's1') c = new FranceChapter(s);
    else if (s.id === 's8') c = new V3PeseeChapter(s);
    else if (s.id === 's14') c = new V3LingotChapter(s);
    else if (s.id === 's9') c = new V3CalcChapter(s);
    else if (s.id === 's10') c = new PayChapter(s);
    else if (s.id === 's18') c = new V3KitDocChapter(s);
    else if (s.classList.contains('film')) c = new FilmChapter(s);
    else if (s.querySelector('.depth')) c = new DepthChapter(s);
    else c = new Chapter(s);
    chapters.push(c);
  });
  const vis = new IntersectionObserver(es => { es.forEach(e => { const c = chapters.find(x => x.el === e.target); c?.setVisible(e.isIntersecting); }); onScroll(); }, { threshold: 0 });
  const near = new IntersectionObserver(es => es.forEach(e => { const c = chapters.find(x => x.el === e.target); if (!c) return; c.setNear(e.isIntersecting); if (e.isIntersecting && c instanceof FilmChapter && scrubOn) c.arm(); }), { rootMargin: '180% 0px 180% 0px' });
  chapters.forEach(c => { vis.observe(c.el); near.observe(c.el); });
}
let scrollRaf = null;
function onScroll() { if (scrollRaf === null) scrollRaf = requestAnimationFrame(frame); }
function frame(now) { scrollRaf = null; for (const c of chapters) if (c.visible) c.tick(now); updateRail(); updateNav(); sound.updateChapter(); cine.syncScroll(); }

/* Rail */
const rail = document.getElementById('rail'); const railDraw = rail?.querySelector('.rail__draw');
const stampTargets = rail ? [...rail.querySelectorAll('a[data-chapter]')].map(a => ({ a, el: document.getElementById(a.dataset.chapter), past: false, active: false })) : [];
let lastRailOff = -1;
function updateRail() {
  if (!rail || getComputedStyle(rail).display === 'none') return;
  const max = document.documentElement.scrollHeight - innerHeight; const pp = max > 0 ? scrollY / max : 0; const off = Math.round(1000 * (1 - pp));
  if (off !== lastRailOff) { lastRailOff = off; railDraw.style.setProperty('--rail-off', off); }
  let activeIdx = -1; const mid = innerHeight * 0.5;
  stampTargets.forEach((s, i) => { if (s.el && s.el.getBoundingClientRect().top <= mid) activeIdx = i; });
  stampTargets.forEach((s, i) => { const past = i < activeIdx, active = i === activeIdx; if (past !== s.past) { s.past = past; s.a.classList.toggle('is-past', past); } if (active !== s.active) { s.active = active; s.a.classList.toggle('is-active', active); } });
}
/* Nav */
const nav = document.getElementById('nav'); let navSolid = null;
const navLinks = [...document.querySelectorAll('.nav__links a')]; const navSections = navLinks.map(a => document.querySelector(a.getAttribute('href'))); let navActive = -1;
function updateNav() {
  const solid = scrollY > innerHeight * 0.6; if (solid !== navSolid) { navSolid = solid; nav.classList.toggle('is-solid', solid); }
  let idx = 0; navSections.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= innerHeight * 0.4) idx = i; });
  if (idx !== navActive) { navActive = idx; navLinks.forEach((a, i) => a.classList.toggle('is-active', i === idx)); }
}

/* ==================== Gates (live) ==================== */
let scrubOn = false;
function enableScrub() { if (scrubOn) return; scrubOn = true; chapters.forEach(c => { if (c instanceof FilmChapter) { if (c.near) c.arm(); c.bands.bands.forEach(b => { b.op = -1; b.k = -1; }); } }); unpinFinalStates(); onScroll(); }
function disableScrub() { if (!scrubOn) return; scrubOn = false; chapters.forEach(c => { if (c instanceof FilmChapter) c.disarmRuntime(); }); }
function applyHeroMode() { if (staticMode()) disableScrub(); else enableScrub(); }
MQLS.forEach(m => m.addEventListener('change', applyHeroMode));
function pinToFinalStates() { document.body.classList.add('pinned'); chapters.forEach(c => c.pinFinal()); document.querySelectorAll('.reveal').forEach(r => r.classList.add('in', 'done')); }
function unpinFinalStates() { document.body.classList.remove('pinned'); }
reduceMQ.addEventListener('change', e => { if (e.matches) { cine.arreter(); pinToFinalStates(); disableScrub(); } else { applyHeroMode(); cine.demarrer(); } });

/* ==================== Sound architecture (procedural WebAudio, muted by default) ==================== */
class SoundScape {
  constructor() {
    this.btn = document.getElementById('sound'); this.on = false; this.ctx = null; this.current = null; this.layers = {};
    // chapter id → ambience recipe
    this.map = { s1: 'air', s2: 'winter', s3: 'winter', s4: 'fire', s5: 'room', s6: 'room', s7: 'room', s8: 'room', s9: 'room', s10: 'room',
      s11: 'forge', s12: 'forge', s13: 'forge', s14: 'forge', s15: 'winter', s16: 'room', s17: 'room', s18: 'room', s19: 'winter' };
    this.btn.addEventListener('click', () => this.toggle());
    document.addEventListener('visibilitychange', () => { if (this.ctx) { if (document.hidden) this.ctx.suspend(); else if (this.on) this.ctx.resume(); } });
  }
  toggle() { this.on = !this.on; this.btn.setAttribute('aria-pressed', String(this.on)); this.btn.classList.toggle('is-on', this.on); if (this.on) { this.ensure(); this.updateChapter(true); this.ctx?.resume(); } else this.fadeAll(); }
  ensure() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    // one shared 4s noise buffer
    const len = 4 * ctx.sampleRate; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.layers = { winter: this.mkWinter(), fire: this.mkFire(), room: this.mkRoom(), air: this.mkAir(), forge: this.mkForge() };
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.85 + Math.random() * 0.3; s.start(); return s; }
  lfoTo(param, freq, depth, base) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = freq; g.gain.value = depth; o.connect(g); g.connect(param); param.value = base; o.start(); return o; }
  mkLayer(build, level) { const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master); build(g); return { g, level }; }
  mkWinter() { // soft wind: lowpassed noise with a slow wandering filter
    return this.mkLayer(out => { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.4; this.lfoTo(f.frequency, 0.07, 140, 320); const n = this.noiseSrc(); const t = this.ctx.createGain(); t.gain.value = 0.5; n.connect(f); f.connect(t); t.connect(out); }, 0.35);
  }
  mkFire() { // hearth: warm rumble + sparse crackles
    return this.mkLayer(out => {
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; const n = this.noiseSrc(); const t = this.ctx.createGain(); t.gain.value = 0.4; n.connect(f); f.connect(t); t.connect(out); this.lfoTo(t.gain, 0.5, 0.08, 0.4);
      const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 1.2; const n2 = this.noiseSrc(); const cg = this.ctx.createGain(); cg.gain.value = 0; n2.connect(hp); hp.connect(cg); cg.connect(out);
      const ctx = this.ctx; (function crackle() { const now = ctx.currentTime; cg.gain.cancelScheduledValues(now); cg.gain.setValueAtTime(0, now); const t1 = now + 0.01; cg.gain.linearRampToValueAtTime(0.10 + Math.random() * 0.14, t1); cg.gain.exponentialRampToValueAtTime(0.001, t1 + 0.05 + Math.random() * 0.08); setTimeout(crackle, 180 + Math.random() * 900); })();
    }, 0.5);
  }
  mkRoom() { // quiet interior: very low rumble, near silence
    return this.mkLayer(out => { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120; const n = this.noiseSrc(); const t = this.ctx.createGain(); t.gain.value = 0.35; n.connect(f); f.connect(t); t.connect(out); this.lfoTo(t.gain, 0.05, 0.06, 0.35); }, 0.16);
  }
  mkAir() { // high altitude / map: airy shimmer
    return this.mkLayer(out => { const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.3; this.lfoTo(f.frequency, 0.04, 260, 900); const n = this.noiseSrc(); const t = this.ctx.createGain(); t.gain.value = 0.3; n.connect(f); f.connect(t); t.connect(out); }, 0.2);
  }
  mkForge() { // furnace: deep rumble + hiss
    return this.mkLayer(out => { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90; const n = this.noiseSrc(); const t = this.ctx.createGain(); t.gain.value = 0.8; n.connect(f); f.connect(t); t.connect(out); this.lfoTo(t.gain, 0.18, 0.14, 0.8);
      const h = this.ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 5000; const n2 = this.noiseSrc(); const t2 = this.ctx.createGain(); t2.gain.value = 0.025; n2.connect(h); h.connect(t2); t2.connect(out); }, 0.5);
  }
  updateChapter(force) {
    if (!this.on || !this.ctx) return;
    const mid = innerHeight * .5; let id = null;
    for (const c of chapters) { const r = c.el.getBoundingClientRect(); if (r.top <= mid && r.bottom >= mid) { id = c.el.id; break; } }
    const key = id ? this.map[id] : null;
    if (key === this.current && !force) return; this.current = key;
    const now = this.ctx.currentTime;
    for (const [k, L] of Object.entries(this.layers)) { const target = k === key ? L.level : 0; L.g.gain.cancelScheduledValues(now); L.g.gain.setTargetAtTime(target, now, 1.4); }
  }
  fadeAll() { if (!this.ctx) return; const now = this.ctx.currentTime; for (const L of Object.values(this.layers)) L.g.gain.setTargetAtTime(0, now, 0.5); this.current = null; }
  frappe() { // LE coup de poincon — le seul accent du film : un choc mat, bref
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, now); o.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.34, now + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.26);
    const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.8;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.12, now); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    n.connect(f); f.connect(g2); g2.connect(this.master); setTimeout(() => { try { n.stop(); } catch (e) {} }, 120);
  }
  cue() { // le souffle du voile : une respiration basse, a peine audible, 2 s
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 0.5;
    const n = this.noiseSrc(); const g = ctx.createGain(); g.gain.value = 0;
    n.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.05, now + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 2.2);
    setTimeout(() => { try { n.stop(); } catch (e) {} g.disconnect(); }, 2600);
  }
}
const sound = new SoundScape();

/* ==================== LE FILM : moteur de sequences ====================
   La page n'est plus une distance : c'est un FILM de sequences. Chaque
   sequence possede son chemin (un ou plusieurs chapitres, chacun de p0 a p1,
   avec un poids), sa duree a x1, et SON texte — un seul, qui apparait au
   fin de sequence seulement, sur le grand voile plein cadre (#cine-voile).

   Le defilement est une COMMANDE : un geste franc = une sequence. Pendant
   qu'une sequence court, un geste dans le meme sens accelere la camera
   (1 -> 1,8 -> 4,5), un geste oppose la calme. Lecture enchaine tout ;
   Pause gele exactement ou l'on est ; les vitesses x1 x2 x4 x6 x8 multiplient
   le temps du film entier et ne retombent JAMAIS d'elles-memes.

   Les checkpoints : C0 = l'ouverture (sequence 1 affichee, rien n'a couru) ;
   Ck = la fin de la sequence k. Avancer joue k+1 en avant ; reculer rejoue k
   a rebours, plus vite (x1,45), comme on remonte une bobine. */
/* LE DECOUPAGE V3 — « LA CEREMONIE DE LA PREUVE » (production 100 % neuve).
   19 sequences, 3 actes + anneau. UN master monte par sequence (le montage —
   cuts, fondus d'etats — est cuit dans le fichier ; GOP 8 pour le scrub).
   Textes : 8 grands voiles de fin de chapitre + 11 lignes de chapitre posees
   sur la fin de l'action (aucun arret de Lecture). */
const VOILE0 = {
  sur: 'La Compagnie de l\u2019Or', titre: 'La C\u00e9r\u00e9monie de la Preuve.',
  lede: 'Avancez \u00e0 la molette ou aux fl\u00e8ches \u2014 ou laissez la Lecture d\u00e9rouler le film \u00e0 votre rythme.',
};
const SEQS = [
  { film: 'parcours', titre: 'La carte', segs: [{ id: 's1', p0: 0, p1: 1, w: 1 }], dur: 6,
    voile: { sur: 'La Compagnie de l\u2019Or', titre: 'Une journ\u00e9e pr\u00e8s de chez vous.',
      lede: 'Nos experts vous re\u00e7oivent sur rendez-vous, dans un h\u00f4tel de votre r\u00e9gion.' } },
  { film: 'parcours', titre: 'Le village', segs: [{ id: 's2', p0: 0, p1: 1, w: 1 }], dur: 6,
    ligne: 'Votre rendez-vous vous attend.' },
  { film: 'parcours', titre: 'Le seuil', segs: [{ id: 's3', p0: 0, p1: 1, w: 1 }], dur: 6,
    ligne: 'La porte est ouverte.' },
  { film: 'parcours', titre: 'L accueil', segs: [{ id: 's4', p0: 0, p1: 1, w: 1 }], dur: 5,
    voile: { sur: 'L\u2019accueil', titre: 'Entrez, vous \u00eates attendu.',
      lede: 'Un feu, une cl\u00e9, une personne pour vous conduire. L\u2019expertise commence par l\u2019hospitalit\u00e9.' } },
  { film: 'parcours', titre: 'Le couloir', segs: [{ id: 's5', p0: 0, p1: 1, w: 1 }], dur: 5,
    ligne: 'Votre expert vous re\u00e7oit \u00e0 huis clos.' },
  { film: 'parcours', titre: 'Vos biens', segs: [{ id: 's6', p0: 0, p1: 1, w: 1 }], dur: 9,
    ligne: 'Pos\u00e9s, jamais jug\u00e9s.' },
  { film: 'parcours', titre: 'Le poincon', segs: [{ id: 's7', p0: 0, p1: 1, w: 1 }], dur: 5,
    ligne: 'Le poin\u00e7on ne ment pas.' },
  { film: 'parcours', titre: 'La pesee', segs: [{ id: 's8', p0: 0, p1: 1, w: 1 }], dur: 14,
    voile: { sur: 'La pes\u00e9e', titre: 'Le poids ne s\u2019affiche qu\u2019au contact.',
      lede: 'Balance tar\u00e9e devant vous. Chaque objet, un \u00e0 un. 42,80 grammes \u2014 ni avant la pose, ni un dixi\u00e8me de plus.' } },
  { film: 'parcours', titre: 'Le cours', segs: [{ id: 's9', p0: 0, p1: 1, w: 1 }], dur: 6,
    ligne: 'Un cours public, un calcul visible.' },
  { film: 'parcours', titre: 'La proposition', segs: [{ id: 's10', p0: 0, p1: 1, w: 1 }], dur: 8,
    voile: { sur: 'Votre d\u00e9cision', titre: 'Accepter, r\u00e9fl\u00e9chir, refuser.',
      lede: 'La proposition est \u00e9crite et sign\u00e9e. Elle ne vous engage \u00e0 rien \u2014 elle n\u2019engage que nous.' } },
  { film: 'parcours', titre: 'L atelier', segs: [{ id: 's11', p0: 0, p1: 1, w: 1 }], dur: 5,
    ligne: 'Vous avez dit oui. Votre or entre au feu.' },
  { film: 'parcours', titre: 'La fusion', segs: [{ id: 's12', p0: 0, p1: 1, w: 1 }], dur: 10,
    ligne: 'Plus de 900 degr\u00e9s. Le feu ne triche pas.' },
  { film: 'parcours', titre: 'La coulee', segs: [{ id: 's13', p0: 0, p1: 1, w: 1 }], dur: 10,
    ligne: 'Coul\u00e9 sous contr\u00f4le, sans raccourci.' },
  { film: 'parcours', titre: 'Le lingot', segs: [{ id: 's14', p0: 0, p1: 1, w: 1 }], dur: 12,
    voile: { sur: 'Le lingot', titre: 'Le calcul, confront\u00e9 \u00e0 la mati\u00e8re.',
      lede: 'Affin\u00e9 \u00e0 999,9 : 31,98 grammes pour 32,10 th\u00e9oriques. La part du feu est pour nous \u2014 votre r\u00e8glement \u00e9tait fond\u00e9 sur la pes\u00e9e.' } },
  { film: 'kit', titre: 'Le kit chez vous', segs: [{ id: 's15', p0: 0, p1: 1, w: 1 }], dur: 10,
    ligne: 'Vous ne pouvez pas vous d\u00e9placer ? Le kit s\u00e9curis\u00e9 vient \u00e0 vous.' },
  { film: 'kit', titre: 'Scelle, confie', segs: [{ id: 's16', p0: 0, p1: 1, w: 1 }], dur: 6,
    ligne: 'Assur\u00e9, suivi, d\u00e9j\u00e0 affranchi.' },
  { film: 'kit', titre: 'L atelier recoit', segs: [{ id: 's17', p0: 0, p1: 1, w: 1 }], dur: 12,
    voile: { sur: 'La preuve', titre: 'Ouvert sous contr\u00f4le, pes\u00e9, film\u00e9.',
      lede: 'Sceau v\u00e9rifi\u00e9, contenu inventori\u00e9 \u2014 et la vid\u00e9o de la pes\u00e9e vous est envoy\u00e9e.' } },
  { film: 'kit', titre: 'Deux chemins', segs: [{ id: 's18', p0: 0, p1: 1, w: 1 }], dur: 7,
    voile: { sur: 'Votre choix', titre: 'R\u00e9gl\u00e9 sous 48 heures \u2014 ou tout revient.',
      lede: 'Vous acceptez : le virement part. Vous refusez : vos objets rentrent, rescell\u00e9s, assur\u00e9s. Sans frais.' } },
  { film: 'kit', titre: 'L anneau', segs: [{ id: 's19', p0: 0, p1: 1, w: 1 }], dur: 8,
    voile: { sur: 'La Compagnie de l\u2019Or', titre: 'La preuve, \u00e0 chaque \u00e9tape.',
      lede: 'Prenez rendez-vous lors de notre prochaine journ\u00e9e. Nous vous attendons.',
      cta: [{ t: 'Voir les dates', href: 'index.html#journees' }, { t: 'Recevoir le kit', href: 'index.html#rendezvous' }] } },
];

class Cine {
  constructor() {
    this.actif = false; this.seqs = []; this.cps = [];
    this.idx = 0;                       // checkpoint atteint : 0 = ouverture, k = fin de la sequence k
    this.etat = 'repos';                // 'repos' | 'course'
    this.course = null;                 // { seq, cible, dir, t, gel, boost, boostCible, niveau, suivantAuto, last, yDepart }
    this.lecture = false; this.vitesse = 1; this.boucle = false; this.sorti = false;
    this.acc = 0; this.tWheel = 0; this.calmeAvant = 0; this.suppress = false;
    this.voileK = -3; this.voileT = 0; this.enchainT = 0; this.syncT = 0; this.lectureAvantCache = null;
    this.rafId = null;
  }

  build() {
    const by = id => chapters.find(c => c.el.id === id);
    this.seqs = SEQS.map(sq => {
      const segs = sq.segs.map(g => ({ ...g, ch: by(g.id) }));
      if (segs.some(g => !g.ch)) return null;
      const somme = segs.reduce((a, g) => a + g.w, 0);
      segs.forEach(g => { g.w /= somme; });
      return { ...sq, segs };
    }).filter(Boolean);
    /* l'etat de chaque checkpoint : la position p de chaque chapitre */
    let cur = new Map(chapters.map(c => [c, 0]));
    this.cps = [new Map(cur)];
    for (const sq of this.seqs) { for (const g of sq.segs) cur.set(g.ch, g.p1); this.cps.push(new Map(cur)); }
    /* les commandes */
    this.elVoile = document.getElementById('cine-voile');
    this.elLigne = document.getElementById('cine-ligne'); this.ligneTxt = null;
    this.elBar = document.getElementById('cine-bar');
    this.elLect = document.getElementById('cine-lect');
    this.elProgN = document.getElementById('cine-prog-n');
    this.elProgT = document.getElementById('cine-prog-t');
    this.elProgFilm = document.getElementById('cine-prog-film');
    this.elBoucle = document.getElementById('cine-boucle');
  }

  demarrer() {
    if (this.actif || staticMode() || !this.seqs.length) return;
    this.actif = true;
    document.documentElement.classList.add('film-actif');
    this.appliquerCp(this.idx);
    this.poserVoile(this.idx);
    this.majUI();
  }
  arreter() {
    this.actif = false;
    document.documentElement.classList.remove('film-actif', 'film-sorti');
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    for (const c of chapters) c.filmP = null;
  }

  /* ---------- geometrie ---------- */
  yDe(ch) { return Math.round(ch.el.getBoundingClientRect().top + scrollY); }
  yCp(k) { if (k <= 0) return 0; const segs = this.seqs[k - 1].segs; return this.yDe(segs[segs.length - 1].ch); }
  finFilm() { const segs = this.seqs[this.seqs.length - 1].segs; return this.yDe(segs[segs.length - 1].ch); }

  poser(ch, p) { if (ch.filmP !== p) { ch.filmP = p; if (ch.visible || ch.near) ch.tick(performance.now()); } }
  appliquerCp(k) {
    for (const [ch, p] of this.cps[k]) this.poser(ch, p);
    this.defiler(this.yCp(k));
  }
  defiler(y) { this.suppress = true; window.scrollTo({ top: Math.round(y), behavior: 'instant' }); this.suppress = false; }

  /* ---------- la course d'une sequence ---------- */
  avancer() { if (this.etat === 'repos' && this.idx < this.seqs.length) this.jouer(this.idx + 1, 1); }
  reculer() { if (this.etat === 'repos' && this.idx > 0) this.jouer(this.idx - 1, -1); }

  jouer(cible, dir, boost = 1) {
    clearTimeout(this.enchainT);
    const seq = this.seqs[dir > 0 ? cible - 1 : cible];   // en arriere : on rejoue la sequence qu'on quitte
    if (!seq) return;
    this.etat = 'course';
    this.course = {
      seq, cible, dir,
      t: dir > 0 ? 0 : 1,
      dur: Math.max(0.8, seq.dur) * (dir > 0 ? 1 : 0.69),  // le retour remonte la bobine, un peu plus vite
      gel: false, boost, boostCible: boost, niveau: boost > 1 ? 2 : 1, suivantAuto: false,
      last: performance.now(),
      yDepart: this.yCp(dir > 0 ? cible - 1 : cible + 0) - 0,
    };
    /* en arriere, le depart de la course est le checkpoint courant */
    if (dir < 0) this.course.yDepart = this.yCp(cible);
    /* LA SCENE JOUE NUE : voile et ligne quittent l'ecran des le premier
       geste ; le texte suivant n'apparaitra qu'en fin d'action. */
    this.poserVoile(null);
    this.cacherLigne();
    this.idx = cible;
    this.majUI();
    if (!this.rafId) this.rafId = requestAnimationFrame(ts => this.tourner(ts));
  }

  tourner(now) {
    this.rafId = null;
    const a = this.course;
    if (!a) return;
    if (a.gel) { a.last = now; this.rafId = requestAnimationFrame(ts => this.tourner(ts)); return; }
    const dt = Math.min(0.1, (now - a.last) / 1000); a.last = now;
    a.boost += (a.boostCible - a.boost) * Math.min(1, dt * (a.boostCible > a.boost ? 5 : 3));
    a.t += a.dir * (dt * this.vitesse * a.boost) / a.dur;
    a.t = clamp(a.t, 0, 1);
    const tau = (1 - Math.cos(Math.PI * a.t)) / 2;         // douceur au depart, pose exacte a l'arrivee
    this.conduire(a, tau);
    if ((a.dir > 0 && a.t >= 1) || (a.dir < 0 && a.t <= 0)) { this.terminer(a); return; }
    this.rafId = requestAnimationFrame(ts => this.tourner(ts));
  }

  conduire(a, tau) {
    /* les chapitres du chemin : chacun recoit son p ; la camera (le defilement)
       glisse vers la section de chaque segment sur ses premiers 12 % */
    let cum = 0, y = a.yDepart;
    for (const g of a.seq.segs) {
      const t = clamp((tau - cum) / g.w, 0, 1);
      this.poser(g.ch, g.p0 + (g.p1 - g.p0) * t);
      y = y + (this.yDe(g.ch) - y) * smoothstep(tau, cum, Math.min(1, cum + 0.12));
      cum += g.w;
    }
    this.defiler(y);
    /* la ligne de chapitre se pose sur la fin de l'action, sans arret */
    if (a.seq.ligne && a.dir > 0 && tau > 0.78) this.montrerLigne(a.seq.ligne);
  }

  terminer(a) {
    this.course = null;
    this.etat = 'repos';
    this.acc = 0;
    this.calmeAvant = performance.now() + 450;             // absorbe la fin d'inertie de la molette
    const k = a.dir > 0 ? a.cible : a.cible;
    this.appliquerCp(k);
    this.poserVoile(k);                                    // la ponctuation du chapitre
    this.majUI();
    /* LECTURE : le voile monte, TIENT LE TEMPS DE LIRE, puis la suivante.
       Le temps de lecture suit le nombre de mots du voile ; la vitesse du
       film le raccourcit, avec un plancher pour qu'un regard reste possible. */
    if (this.lecture && a.dir > 0) {
      const finParcours = this.seqs[k - 1] && this.seqs[k - 1].film === 'parcours' && (!this.seqs[k] || this.seqs[k].film !== 'parcours');
      const finKit = k >= this.seqs.length;
      if (finKit || (finParcours && !this.boucle)) {
        if (finParcours && !finKit) { this.setLecture(false); return; }  // fin du parcours : le film s'arrete, le kit attend un geste
        this.setLecture(false); return;
      }
      if (finParcours && this.boucle) { this.enchainT = setTimeout(() => this.rembobiner(0), 900 / this.vitesse); return; }
      const attente = Math.max(800, this.tempsLecture(k) / this.vitesse);
      this.enchainT = setTimeout(() => { if (this.lecture && this.etat === 'repos') this.avancer(); }, attente);
    }
  }

  /* la boucle : un fondu bref, jamais un saut a l'image — et la vitesse reste */
  rembobiner(cp) {
    const voile = document.createElement('div');
    voile.style.cssText = 'position:fixed;inset:0;z-index:80;background:#080705;opacity:0;transition:opacity .55s ease;pointer-events:none';
    document.body.appendChild(voile);
    requestAnimationFrame(() => { voile.style.opacity = '1'; });
    setTimeout(() => {
      this.idx = cp;
      this.appliquerCp(cp);
      /* en boucle de lecture, pas de voile d'ouverture : le film repart */
      this.poserVoile(this.lecture ? null : cp);
      this.majUI();
      voile.style.opacity = '0';
      setTimeout(() => voile.remove(), 650);
      if (this.lecture) this.enchainT = setTimeout(() => { if (this.lecture && this.etat === 'repos') this.avancer(); }, 500 / this.vitesse);
    }, 600);
  }

  /* ---------- commandes ---------- */
  setLecture(on) {
    this.lecture = on;
    this.elLect.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.elLect.setAttribute('aria-label', on ? 'Pause' : 'Lecture');
    if (on) {
      if (this.course) this.course.gel = false;
      else if (this.etat === 'repos') {
        if (this.idx >= this.seqs.length) { this.rembobiner(0); }        // relancer depuis l'ouverture
        else this.avancer();
      }
    } else {
      clearTimeout(this.enchainT);
      if (this.course) this.course.gel = true;             // PAUSE : gel exact, reprise au meme point
    }
  }
  setVitesse(v) {
    this.vitesse = v;
    document.querySelectorAll('#cine-vitesses button').forEach(b => {
      const on = Number(b.dataset.v) === v;
      b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  suivant() {
    if (this.sorti) return;
    if (this.course) { this.course.boostCible = 8; this.course.niveau = 3; return; }  // finir vite, proprement
    if (this.idx >= this.seqs.length) { this.relacher(); return; }
    this.avancer();
  }
  precedent() {
    if (this.sorti) { this.recapturer(); return; }
    if (this.course) {                                     // on repart du checkpoint de depart de la course
      const a = this.course; this.course = null; this.etat = 'repos';
      const k = a.dir > 0 ? a.cible - 1 : a.cible + 1;
      this.idx = clamp(k, 0, this.seqs.length);
      this.appliquerCp(this.idx);
      this.poserVoile(this.idx);
      this.majUI();
      if (this.lecture) this.enchainT = setTimeout(() => { if (this.lecture && this.etat === 'repos') this.avancer(); }, 600 / this.vitesse);
      return;
    }
    this.reculer();
  }

  /* ---------- le grand voile : la ponctuation d'un chapitre ----------
     Au repos sur le checkpoint k, le voile de la sequence ACCOMPLIE tient
     l'ecran (k=0 : le voile d'ouverture). En course, la scene joue nue :
     poserVoile(null). Une seule regle, six points d'appel. */
  voileDe(k) { return k === 0 ? VOILE0 : (this.seqs[k - 1] || {}).voile || null; }
  montrerLigne(txt) {
    if (this.ligneTxt === txt) return; this.ligneTxt = txt;
    this.elLigne.textContent = txt;
    requestAnimationFrame(() => this.elLigne.classList.add('is-on'));
  }
  cacherLigne() { if (this.ligneTxt === null) return; this.ligneTxt = null; this.elLigne.classList.remove('is-on'); }
  tempsLecture(k) {
    const v = this.voileDe(k); if (!v) return 500;
    /* V3 : le voile est une ponctuation resserree (~3 s), pas une station */
    const mots = (v.sur + ' ' + v.titre + ' ' + v.lede).trim().split(/\s+/).length;
    return clamp(1100 + mots * 110, 2200, 3400);
  }
  poserVoile(k) {
    if (this.voileK === k) return;
    this.voileK = k;
    const boite = this.elVoile;
    boite.classList.remove('is-on');
    clearTimeout(this.voileT);
    if (k === null) return;
    const v = this.voileDe(k);
    const sq = k > 0 ? this.seqs[k - 1] : null;
    if (!v) { if (sq && sq.ligne) this.montrerLigne(sq.ligne); return; }
    this.voileT = setTimeout(() => {
      if (this.voileK !== k) return;
      const esc = s => { const d = document.createElement('i'); d.textContent = s; return d.innerHTML; };
      let html = '<div class="cine-voile__cadre"><p class="cine-voile__sur">' + esc(v.sur) + '</p>'
        + '<h2 class="cine-voile__titre">' + esc(v.titre) + '</h2>'
        + '<p class="cine-voile__lede">' + esc(v.lede) + '</p>';
      if (v.cta) html += '<p class="cine-voile__cta">' + v.cta.map(c => '<a class="btn" href="' + c.href + '">' + esc(c.t) + '</a>').join('') + '</p>';
      boite.innerHTML = html + '</div>';
      sound.cue();
      requestAnimationFrame(() => requestAnimationFrame(() => boite.classList.add('is-on')));
    }, 320);
  }

  majUI() {
    const k = clamp(this.idx, 0, this.seqs.length);
    const sq = this.seqs[Math.max(0, k - 1)];
    const enKit = k > 0 ? sq.film === 'kit' : false;
    const duMeme = this.seqs.filter(x => x.film === (enKit ? 'kit' : 'parcours'));
    const debutFilm = this.seqs.findIndex(x => x.film === (enKit ? 'kit' : 'parcours'));
    const n = k === 0 ? 1 : clamp(k - debutFilm, 1, duMeme.length);
    this.elProgN.textContent = String(n).padStart(2, '0');
    this.elProgT.textContent = String(duMeme.length).padStart(2, '0');
    this.elProgFilm.hidden = !enKit;
    document.getElementById('cine-prec').disabled = this.idx <= 0 && !this.sorti;
  }

  /* ---------- gestes ---------- */
  /* deltaMode 1 = lignes (souris Firefox), 2 = pages ; tout revient en pixels */
  deltaPx(e) {
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    return clamp(e.deltaY * k, -200, 200);
  }
  onWheel(e) {
    if (!this.actif || staticMode()) return;
    const menu = document.getElementById('menu'); if (menu && !menu.hidden) return;
    if (this.sorti) {
      if (e.deltaY < 0 && scrollY <= this.finFilm() + vh() * 0.6) { e.preventDefault(); this.recapturer(); }
      return;
    }
    e.preventDefault();
    const now = performance.now();
    const dPx = this.deltaPx(e);
    const ecartEvt = now - (this.tEvt || 0); this.tEvt = now;
    const abs = Math.abs(dPx), absPrec = this.dPrecAbs || 0;
    const crante = abs >= 80 && abs === absPrec;
    const montant = ecartEvt > 200 || crante || abs > absPrec + 1;
    this.dPrecAbs = abs;
    if (this.etat === 'course') {
      const ecart = now - this.tWheel; this.tWheel = now;
      const geste = (ecart > 250 && montant) || (Math.abs(dPx) >= 90 && ecart > 40 && montant);
      if (!geste) return;
      const a = this.course;
      if (Math.sign(e.deltaY) === a.dir) {
        if (a.niveau < 2) { a.niveau = 2; a.boostCible = 1.8; }
        else if (a.niveau < 3) { a.niveau = 3; a.boostCible = 4.5; a.suivantAuto = this.lecture; }
        else a.boostCible = Math.min(8, a.boostCible + 1.2);
      } else {
        if (a.niveau >= 3) { a.niveau = 2; a.boostCible = 1.8; }
        else { a.niveau = 1; a.boostCible = 1; }
      }
      return;
    }
    if (now < this.calmeAvant) { this.acc = 0; return; }
    if (now - this.tWheel > 450) this.acc = 0;
    this.tWheel = now;
    /* l'inertie qui suit un geste n'alimente jamais l'accumulateur */
    if (!montant) return;
    this.acc += dPx;
    if (Math.abs(this.acc) < 60) return;
    const dir = this.acc > 0 ? 1 : -1; this.acc = 0;
    if (dir > 0 && this.idx >= this.seqs.length) { this.relacher(); return; }
    if (dir < 0 && this.idx <= 0) return;
    dir > 0 ? this.avancer() : this.reculer();
  }

  onKey(e) {
    if (!this.actif || staticMode() || this.sorti) return;
    if (e.target.closest('input, textarea, select')) return;
    const menu = document.getElementById('menu'); if (menu && !menu.hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); this.suivant(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.precedent(); }
    else if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); this.setLecture(!this.lecture); }
  }

  onTouchStart(e) { const t = e.touches[0]; this.tx = t.clientX; this.ty = t.clientY; this.tt = performance.now(); }
  onTouchMove(e) {
    if (!this.actif || staticMode() || this.sorti) return;
    if (e.target.closest('.cine-bar, .menu, a, button')) return;
    e.preventDefault();                                     // le doigt commande le film, pas la page
  }
  onTouchEnd(e) {
    if (!this.actif || staticMode() || this.sorti || this.tx === undefined) return;
    const t = e.changedTouches[0];
    const dx = this.tx - t.clientX, dy = this.ty - t.clientY, dt = performance.now() - this.tt;
    this.tx = undefined;
    if (dt > 700) return;
    const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;       // vertical prioritaire, horizontal accepte
    if (Math.abs(d) < 58) return;
    if (this.etat === 'course') { const a = this.course; if (Math.sign(d) === a.dir && a.niveau < 3) { a.niveau++; a.boostCible = a.niveau === 2 ? 1.8 : 4.5; } return; }
    if (performance.now() < this.calmeAvant) return;
    if (d > 0) { if (this.idx >= this.seqs.length) this.relacher(); else this.avancer(); }
    else this.reculer();
  }

  /* ---------- au-dela du film : le pied de page ---------- */
  relacher() {
    if (this.sorti) return;
    this.sorti = true;
    document.documentElement.classList.add('film-sorti');
    const yFin = document.getElementById('societe').getBoundingClientRect().top + scrollY;
    try { window.scrollTo({ top: yFin - vh() * 0.06, behavior: 'smooth' }); } catch (err) { window.scrollTo(0, yFin); }
    this.majUI();
  }
  recapturer() {
    this.sorti = false;
    document.documentElement.classList.remove('film-sorti');
    this.appliquerCp(this.idx);
    this.majUI();
  }

  /* barre de defilement, ancres du menu : la page a bouge sans nous */
  syncScroll() {
    if (!this.actif || this.etat !== 'repos' || this.suppress || staticMode()) return;
    if (this.sorti) { if (scrollY < this.finFilm() - vh() * 0.4) this.recapturer(); return; }
    const attendu = this.yCp(this.idx);
    if (Math.abs(scrollY - attendu) < vh() * 0.55) return;
    clearTimeout(this.syncT);
    this.syncT = setTimeout(() => {
      if (this.etat !== 'repos' || this.suppress) return;
      if (scrollY > this.finFilm() + vh() * 0.5) { this.sorti = true; document.documentElement.classList.add('film-sorti'); this.majUI(); return; }
      let best = 0, bd = Infinity;
      for (let k = 0; k <= this.seqs.length; k++) { const d = Math.abs(this.yCp(k) - scrollY); if (d < bd) { bd = d; best = k; } }
      this.idx = best;
      this.appliquerCp(best);
      this.poserVoile(best);
      this.majUI();
    }, 140);
  }

  /* une ancre de chapitre (menu, rail) -> son checkpoint */
  versChapitre(id) {
    if (id === 'societe') { this.relacher(); return true; }
    for (let k = 1; k <= this.seqs.length; k++) {
      if (this.seqs[k - 1].segs.some(g => g.ch.el.id === id)) {
        clearTimeout(this.enchainT); this.course = null; this.etat = 'repos';
        if (this.sorti) this.recapturer();
        this.idx = k; this.appliquerCp(k); this.poserVoile(k); this.majUI();
        return true;
      }
    }
    return false;
  }

  initCommandes() {
    document.getElementById('cine-prec').addEventListener('click', () => this.precedent());
    document.getElementById('cine-suiv').addEventListener('click', () => this.suivant());
    this.elLect.addEventListener('click', () => this.setLecture(!this.lecture));
    this.elBoucle.addEventListener('click', () => {
      this.boucle = !this.boucle;
      this.elBoucle.setAttribute('aria-pressed', this.boucle ? 'true' : 'false');
    });
    document.querySelectorAll('#cine-vitesses button').forEach(b =>
      b.addEventListener('click', () => this.setVitesse(Number(b.dataset.v))));
    /* un clic au POINTEUR rend le focus a la scene : sans cela, la barre
       d'espace re-cliquerait le dernier bouton touche a la souris au lieu de
       commander lecture / pause. Le focus clavier (Tab) n'est pas touche. */
    this.elBar.addEventListener('pointerup', () => setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest && a.closest('.cine-bar') && a.matches(':not(:focus-visible)')) a.blur();
    }, 0));
    addEventListener('keydown', e => this.onKey(e));
    addEventListener('touchstart', e => this.onTouchStart(e), { passive: true });
    addEventListener('touchmove', e => this.onTouchMove(e), { passive: false });
    addEventListener('touchend', e => this.onTouchEnd(e), { passive: true });
    /* les ancres internes deviennent des sauts de checkpoint */
    document.addEventListener('click', e => {
      if (!this.actif || staticMode()) return;
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      if (this.versChapitre(id)) e.preventDefault();
    });
    /* onglet cache : la lecture marque une pause, et reprend au retour */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.lectureAvantCache = this.lecture; if (this.lecture) this.setLecture(false); }
      else if (this.lectureAvantCache) { this.lectureAvantCache = null; this.setLecture(true); }
    });
  }
}
const cine = new Cine();
window.__cine = cine; // point d'appui des controles automatiques (inoffensif en production)

/* ==================== Reveals ==================== */
function initReveals() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); setTimeout(() => e.target.classList.add('done'), 1600); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

/* ==================== Agenda + mini map ==================== */
function initAgenda() {
  const next = document.getElementById('agenda-next'); const past = document.getElementById('agenda-past');
  /* La page peut ne pas porter d'agenda — c'est le cas de l'experience, qui est
     un film et renvoie vers l'accueil pour les informations pratiques. On sort
     avant toute ecriture : une seule TypeError ici arreterait le module entier,
     donc le parcours lui-meme. */
  if (!next || !past) return;
  const row = (e, cls) => `<li class="ev ${cls}"><span class="ev__date">${fdate(e.date)}</span><span class="ev__city">${e.ville} <span class="mono ev__cp">${e.cp}</span></span><span class="ev__venue">${e.lieu} · ${e.adresse}</span></li>`;
  if (AGENDA_PROCHAINES.length) next.innerHTML = `<h3>Prochaines étapes</h3><ol class="agenda__list">${AGENDA_PROCHAINES.map(e => row(e, '')).join('')}</ol><p class="agenda__hours">9h30 à 18h30, non stop · sans rendez-vous</p>`;
  else next.innerHTML = `<h3>Prochaines étapes</h3><p>Les prochaines étapes sont en préparation. Laissez-nous votre ville : vous serez prévenu en premier.</p><a class="btn btn--gold" href="#contact">Être informé du prochain passage</a>`;
  past.innerHTML = `<h3>Dernière tournée · Juin 2026</h3><ol class="agenda__list">${AGENDA_PASSEES.map(e => row(e, 'ev--past')).join('')}</ol><p class="agenda__hours">9h30 à 18h30, non stop</p>`;
  if (AGENDA_PROCHAINES.length) { const st = document.getElementById('france-state'); if (st) st.textContent = `Prochaine étape : ${AGENDA_PROCHAINES[0].ville}, ${fdate(AGENDA_PROCHAINES[0].date)}.`; }
  // mini map (static, hover chips)
  const mini = document.getElementById('france-mini'); const chip = document.getElementById('france-mini-chip');
  if (mini) {
    const io = new IntersectionObserver(async es => { if (!es[0].isIntersecting) return; io.disconnect();
      try { const [{ createFranceMap }, data] = await Promise.all([import('./francemap.js'), franceData()]);
        const tour = AGENDA_PASSEES.concat(AGENDA_PROCHAINES);
        const m = createFranceMap(mini, data, { chip, reduced: true, focusCity: null, tour: tour.map(e => e.ville), mini: true, cityInfo: Object.fromEntries(tour.map(e => [e.ville, `${e.ville} · ${e.lieu} · ${fdate(e.date)}`])) });
        m.setProgress(0.62);
        mini.addEventListener('pointermove', e => { const r = mini.getBoundingClientRect(); m.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
        mini.addEventListener('pointerleave', () => m.setPointer(null));
      } catch (e) { console.warn('mini map unavailable', e); }
    }, { rootMargin: '200px' }); io.observe(mini);
  }
}

/* ==================== Forms (mailto on a static site) ==================== */
function initForms() {
  const f = document.getElementById('contact-form'); const err = document.getElementById('form-error'); const ok = document.getElementById('form-success');
  if (f) f.addEventListener('submit', e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f).entries());
    if (['prenom', 'telephone', 'ville', 'cp'].some(k => !String(v[k] || '').trim())) { err.hidden = false; ok.hidden = true; return; }
    err.hidden = true; ok.hidden = false;
    location.href = `mailto:contact@orexpert.fr?subject=${encodeURIComponent(`Prochain passage · ${v.ville} (${v.cp})`)}&body=${encodeURIComponent(`Bonjour,\n\nJe souhaite être informé(e) du prochain passage de La Compagnie de l'Or près de chez moi.\n\nPrénom : ${v.prenom}\nTéléphone : ${v.telephone}\nVille : ${v.ville}\nCode postal : ${v.cp}\n\nMerci.`)}`;
  });
  const r = document.getElementById('rappel-form'); const rok = document.getElementById('rappel-success');
  if (r) r.addEventListener('submit', e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(r).entries());
    if (!String(v.prenom || '').trim() || !String(v.telephone || '').trim()) { r.querySelector('input:invalid, input[name=prenom]')?.focus(); return; }
    rok.hidden = false;
    location.href = `mailto:contact@orexpert.fr?subject=${encodeURIComponent('Demande de rappel')}&body=${encodeURIComponent(`Bonjour,\n\nMerci de me rappeler.\n\nPrénom : ${v.prenom}\nTéléphone : ${v.telephone}\nCréneau souhaité : ${v.creneau}\n\nMerci.`)}`;
  });
}

/* ==================== Guide menu ==================== */
function initMenu() {
  const b = document.querySelector('.nav__guide'); const m = document.getElementById('menu');
  const close = () => { b.setAttribute('aria-expanded', 'false'); m.classList.remove('is-open'); setTimeout(() => { m.hidden = true; }, 400); document.body.style.overflow = ''; };
  const open = () => { m.hidden = false; requestAnimationFrame(() => m.classList.add('is-open')); b.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; };
  b.addEventListener('click', () => (b.getAttribute('aria-expanded') === 'true' ? close() : open()));
  m.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) close(); });
}

/* ==================== Avis (only real ones) ==================== */
function initAvis() { if (!AVIS.length) return; const s = document.getElementById('avis'); if (!s) return; s.hidden = false; s.querySelector('#avis-list').innerHTML = AVIS.map(a => `<blockquote class="avis__item"><p>${a.text}</p><footer>${a.name} · ${a.city}</footer></blockquote>`).join(''); }

/* ==================== Boot ==================== */
/* Ambiance Jour / Nuit : permanente, choix individuel par navigateur (localStorage) */
const abToggle = document.getElementById('ab-toggle');
function setAmbiance(mode, save) {
  document.documentElement.dataset.ambiance = mode;
  if (save) { try { localStorage.setItem('compagnie-or-ambiance', mode); } catch (e) {} }
  if (abToggle) abToggle.querySelectorAll('button').forEach(x => { const on = x.dataset.ab === mode; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on); });
  const films = chapters.filter(c => c.swapAmbiance);
  films.filter(c => c.visible).forEach(c => c.swapAmbiance());
  films.filter(c => !c.visible).forEach(c => c.swapAmbiance());
}
setAmbiance(document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit', false);
if (abToggle) abToggle.addEventListener('click', e => { const b = e.target.closest('button[data-ab]'); if (b) setAmbiance(b.dataset.ab, true); });

splitText(); buildChapters(); cine.build(); cine.initCommandes(); initReveals(); initAgenda(); initForms(); initMenu(); initAvis();
const elDate = document.getElementById('doc-date');
if (elDate) elDate.textContent = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
addEventListener('wheel', e => cine.onWheel(e), { passive: false });
document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));
applyHeroMode(); if (reduced()) pinToFinalStates(); else cine.demarrer();
(function loadRamp() { // band one's one-time load ramp (time-based, hands over to scroll)
  const first = chapters[0]; const t0 = performance.now(); const dur = 2200;
  const step = now => { const t = clamp((now - t0 - 600) / dur, 0, 1); const k = reduced() ? 1 : t * t * (3 - 2 * t); first.bands.loadK = k; if (first.veil) { first.veilLoadK = k; first.lastVeil = -1; first.onProgress(first.progress()); } first.bands.update(first.progress()); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
})();
onScroll();
