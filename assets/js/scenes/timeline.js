/* timeline.js · Section « Comment se deroule une expertise ? » (#expertise)
   Une bille d'or tient la « ligne de lecture » (62 % de la fenetre) pendant que la section defile : y = clamp(focusY - hautDeLigne, 0, yEnd),
   lissee (tau 150 ms), puis s'arrete 44 px sous le dernier losange. La ligne d'or se trace derriere elle, chaque etape s'eclaire quand la bille
   atteint son losange (transitions CSS ~600 ms). Un trail « encre fraiche » suit la bille selon sa vitesse (plein vers 500 px/s).
   Regles : transform/opacity (+ variables CSS) ; une seule lecture de layout par frame, faite dans le rAF AVANT toute ecriture (le scroll ne fait
   que marquer « dirty ») ; IO (scroll ecoute seulement si la section est visible) ; onglet cache = boucle stoppee ; reduced motion = tout allume,
   bille en bas, aucune animation. Ambiance Jour/Nuit par tokens CSS (setAmbiance = no-op). Survol : CSS pur (pointer:fine).
   API : initTimeline(section, { reduced, firstSide:'right'|'left' }) -> { destroy(), refresh(), start(), stop(), setPointer(), setAmbiance(), getProgress(), scrollToProgress(p) }
   Remplace le bloc « 2. TIMELINE » de accueil-sections.js. */

const TAU = 150;            // ms : constante de temps du lissage de la bille (≈ 300 ms pour rejoindre 87 % de la cible)
const FOCUS = 0.62;         // « ligne de lecture » : fraction de la hauteur de fenetre ou la bille se tient (desktop)
const FOCUS_MOBILE = 0.56;
const LEAD = 4;             // px : l'etape s'eclaire juste avant que la bille ne touche le losange
const RUN_OUT = 44;         // px : course de la bille apres le dernier losange
const TRAIL_FULL = 0.5;     // px/ms (≈ 500 px/s) : vitesse a laquelle le trail est plein
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function initTimeline(section, opts = {}) {
  const tl = section && (section.matches && section.matches('.tl') ? section : section.querySelector('.tl'));
  const noop = () => {};
  if (!tl) return { destroy: noop, refresh: noop, start: noop, stop: noop, setPointer: noop, setAmbiance: noop, getProgress: () => 0, scrollToProgress: noop };
  const reduced = !!opts.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const line = tl.querySelector('.tl__line');
  const anchor = line || tl;                                                      // repere du haut de ligne (la ligne est absolue, top:0 de .tl)
  const items = [...tl.querySelectorAll('.tl__item')];
  let bead = tl.querySelector('.tl__bead'), beadOwned = false;
  if (!bead) { bead = document.createElement('i'); bead.className = 'tl__bead'; bead.setAttribute('aria-hidden', 'true'); tl.appendChild(bead); beadOwned = true; }

  // parite : etape 1 a DROITE de la ligne par defaut ; { firstSide:'left' } ou la classe .tl--start-left sur .tl pour l'inverser
  const startLeft = opts.firstSide === 'left' || tl.classList.contains('tl--start-left');
  tl.classList.add('tl--js', reduced ? 'tl--reduced' : 'tl--anim');
  items.forEach((it, i) => { it.classList.add((i % 2 === 0) !== startLeft ? 'tl__item--r' : 'tl__item--l'); it.classList.remove('is-on'); });

  let marks = [], lineH = 1, yEnd = 1;
  let y = 0, target = 0, trail = 0, dir = 1, lastT = 0, raf = 0, activeIdx = -2, lastDraw = -1;
  let dirty = true, listening = false, visible = false, manualStop = false, destroyed = false, entered = false;

  /* --- mesure (resize / polices / ResizeObserver) : reperes = centre de la 1re ligne du titre, dans le referentiel de la ligne ---
     toutes les LECTURES d'abord (rects, styles), puis les ECRITURES (top des losanges) : aucun layout force en boucle */
  const measure = () => {
    if (!line) return;
    const lr = line.getBoundingClientRect(), tr = tl.getBoundingClientRect();
    lineH = lr.height || 1;
    const lineTop = lr.top - tr.top;
    const writes = [];
    marks = items.map(it => {
      const r = it.getBoundingClientRect();
      const h3 = it.querySelector('h3'), dot = it.querySelector('.tl__dot');
      let cy = 40;
      if (h3) {
        const hr = h3.getBoundingClientRect(), cs = getComputedStyle(h3);
        let lh = parseFloat(cs.lineHeight);
        if (!(lh > 4)) lh = parseFloat(cs.fontSize) * 1.12 || hr.height;
        cy = hr.top - r.top + Math.min(lh, hr.height) / 2;
        if (dot) writes.push([dot, cy.toFixed(1) + 'px']);
      } else if (dot) cy = dot.offsetTop + dot.offsetHeight / 2;
      return r.top - tr.top + cy - lineTop;
    });
    writes.forEach(([dot, top]) => { if (dot.style.top !== top) dot.style.top = top; });
    yEnd = clamp((marks.length ? marks[marks.length - 1] : lineH) + RUN_OUT, 1, lineH);
  };

  const focusY = () => (innerWidth <= 820 ? FOCUS_MOBILE : FOCUS) * innerHeight;
  const atBottom = () => (document.documentElement.scrollHeight - innerHeight) - (scrollY || pageYOffset) < 2;   // bas de page : on termine la course
  /* cible de la bille (lecture de layout unique) : elle tient la ligne de lecture, puis s'arrete RUN_OUT px sous le dernier losange */
  const targetY = () => atBottom() ? yEnd : clamp(focusY() - anchor.getBoundingClientRect().top, 0, yEnd);
  const progress = () => clamp(targetY() / yEnd, 0, 1);

  /* --- application (ecritures seules : transforms, variables, classes) --- */
  const apply = () => {
    bead.style.setProperty('--tl-y', y.toFixed(2));
    bead.style.setProperty('--tl-trail', trail.toFixed(3));
    bead.style.setProperty('--tl-dir', dir);
    const draw = clamp(y / lineH, 0, 1);
    if (line && Math.abs(draw - lastDraw) > 0.0006) { line.style.setProperty('--tl-draw', draw.toFixed(4)); lastDraw = draw; }
    let a = -1;
    for (let i = 0; i < marks.length; i++) if (y + LEAD >= marks[i]) a = i;
    if (a !== activeIdx) {
      items.forEach((it, i) => { it.classList.toggle('is-past', i < a); it.classList.toggle('is-active', i === a); });
      activeIdx = a;
    }
  };

  const frame = t => {
    raf = 0;
    if (document.hidden || manualStop) { lastT = 0; return; }
    if (dirty) { target = targetY(); dirty = false; }                             // lecture de layout, avant toute ecriture de la frame
    const dt = lastT ? Math.min(64, t - lastT) : 16.7; lastT = t;
    const prev = y;
    y += (target - y) * (1 - Math.exp(-dt / TAU));
    if (Math.abs(target - y) < 0.05) y = target;
    const v = (y - prev) / dt;                                                     // px / ms
    if (Math.abs(v) > 0.02) dir = v > 0 ? 1 : -1;
    const want = clamp(Math.abs(v) / TRAIL_FULL, 0, 1);
    trail += (want - trail) * (want > trail ? 0.35 : 0.07);                        // montee rapide, extinction douce
    if (trail < 0.004) trail = 0;
    apply();
    if (Math.abs(target - y) > 0.05 || trail > 0) raf = requestAnimationFrame(frame); else lastT = 0;
  };
  const kick = () => { if (!raf && !document.hidden && !manualStop && !destroyed) raf = requestAnimationFrame(frame); };
  const onScroll = () => { dirty = true; kick(); };                              // aucune lecture ici : juste un marqueur
  const onResize = () => { measure(); if (reduced) { y = target = yEnd; apply(); } else onScroll(); };

  /* --- vie seulement a l'ecran --- */
  const wake = () => {
    if (manualStop || destroyed) return;
    if (!entered) { entered = true; tl.classList.add('tl--in'); }                // entree en scene : piste + bille fondues (.9 s, CSS)
    tl.classList.add('is-live');
    if (!listening) { addEventListener('scroll', onScroll, { passive: true }); listening = true; }
    onScroll();
  };
  const sleep = () => {
    tl.classList.remove('is-live');
    if (listening) { removeEventListener('scroll', onScroll); listening = false; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; } lastT = 0;
  };
  const onVis = () => { if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } lastT = 0; } else if (visible) wake(); };

  let io = null, ro = null;
  measure();
  if (reduced) {
    y = target = yEnd; trail = 0; apply();
    addEventListener('resize', onResize);
  } else {
    addEventListener('resize', onResize);
    io = new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; visible ? wake() : sleep(); }), { rootMargin: '14% 0px' });
    io.observe(tl);
    document.addEventListener('visibilitychange', onVis);
    // etat initial coherent sans attendre le premier scroll (la bille part du haut et rejoint sa cible en douceur)
    target = targetY(); dirty = false; apply();
  }
  if ('ResizeObserver' in window) { ro = new ResizeObserver(() => onResize()); ro.observe(tl); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) onResize(); });

  /* p ∈ [0,1] = position de la bille sur sa course (0 = haut de ligne, 1 = 44 px sous le dernier losange) */
  const scrollToProgress = (p, behavior = 'instant') => {
    const top = anchor.getBoundingClientRect().top + (scrollY || pageYOffset) + clamp(p, 0, 1) * yEnd - focusY();
    scrollTo({ top, behavior });
  };

  return {
    destroy() {
      destroyed = true; sleep();
      removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      tl.classList.remove('tl--js', 'tl--anim', 'tl--reduced', 'tl--in', 'is-live');
      if (line) line.style.removeProperty('--tl-draw');
      items.forEach(it => { it.classList.remove('tl__item--r', 'tl__item--l', 'is-active', 'is-past'); const d = it.querySelector('.tl__dot'); if (d) d.style.removeProperty('top'); });
      if (beadOwned) bead.remove(); else { bead.style.removeProperty('--tl-y'); bead.style.removeProperty('--tl-trail'); bead.style.removeProperty('--tl-dir'); }
    },
    refresh() { onResize(); },
    start() { manualStop = false; if (visible) wake(); },
    stop() { manualStop = true; sleep(); },
    setPointer() {},                 // la section est typographique : pas de parallaxe souris (volontaire) ; le survol des etapes est en CSS (pointer:fine)
    setAmbiance() {},                // tokens CSS : rien a faire
    getProgress: progress,
    scrollToProgress
  };
}
export default initTimeline;
