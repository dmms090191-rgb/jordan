/* ============================================================================
   logo-intro.js — ANIMATION D'INTRODUCTION « La Compagnie de l'Or »
   Lot « plume » du chantier logo. Le master n'est pas modifié : ce module
   consomme `assets/logo/logo-anime.svg`, qui est le master au cadrage bloc
   augmenté de ses MASQUES À LIGNE MÉDIANE.

   Le principe, en une phrase : les lettres ne sont pas dessinées par
   l'animation, elles sont RÉVÉLÉES par une bande qui suit exactement le
   squelette d'écriture — et la pointe de la plume est posée sur le front de
   cette bande. Le trait naît donc littéralement sous la pointe.

   · SVG + masque à ligne médiane (stroke-dashoffset) pour toutes les lettres.
   · Three.js UNIQUEMENT pour la plume (repli vectoriel si WebGL absent).
   · Vitesse variable : plus lente dans les courbes, plus rapide en vol,
     petite hésitation à chaque pose de plume. Profil calculé au chargement.
   · Rejouée au VRAI chargement seulement (sessionStorage).
   · prefers-reduced-motion : logo final, tout de suite, aucune boucle.
   · Aucun décalage de mise en page, aucun blocage, repli statique.

   API
     const intro = await createLogoIntro(hote, options);
     intro.play() / pause() / seek(t) / stop() / destroy()
     intro.duree · intro.etat()

   Options
     src        chemin du SVG animable         (défaut ./assets/logo/logo-anime.svg)
     duree      durée totale en secondes       (défaut 2.55)
     plume      plume 3D                       (défaut true)
     session    clé sessionStorage             (défaut 'lc-intro-vu', null = toujours rejouer)
     autoplay   lance dès que prêt             (défaut true)
     reduced    force le mode réduit           (défaut : media query)
     cadrage    'auto' | 'large' | 'serre'     (défaut 'auto' — serré sous 640 px)
     ambiance   'nuit' | 'jour'                (défaut : data-ambiance du document)
   ========================================================================== */

const DEFAUTS = {
  src: './assets/logo/logo-anime.svg',
  duree: 2.55,
  plume: true,
  session: 'lc-intro-vu',
  autoplay: true,
  reduced: null,
  cadrage: 'auto',
  ambiance: null,
  threeSrc: 'three',
};

/* ------------------------------------------------------------ chronologie */
// Bornes en fraction de la durée totale. Les chevauchements sont voulus :
// rien ne commence pile quand autre chose finit, tout se fond.
const PH = {
  entree: [0.000, 0.100],   // la plume entre dans le cadre et se pose
  ecriture: [0.100, 0.598],   // « La Compagnie » s'écrit
  delor: [0.552, 0.706],   // « DE L'OR » se révèle
  versCo: [0.598, 0.690],   // la plume revient vers le fil
  co: [0.690, 0.792],   // le « Co », un seul geste
  fil: [0.792, 0.902],   // le fil naît du geste et se prolonge
  tri: [0.862, 0.945],   // le tricolore, discret
  sortie: [0.902, 1.000],   // la plume quitte le cadre
};
// Les bornes qui se touchent (entrée/écriture, écriture/retour, retour/Co,
// Co/fil, fil/sortie) sont EXACTEMENT jointives : la pointe ne doit jamais être
// encore en vol pendant que l'encre coule, ni continuer à couler après son départ.

/* ------------------------------------------------------------- adoucisseurs */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
const phase = (t, [a, b]) => clamp((t - a) / (b - a));

/* ============================================================ point d'entrée */

export async function createLogoIntro(hote, options = {}) {
  const O = { ...DEFAUTS, ...options };
  const doc = hote.ownerDocument || document;
  const win = doc.defaultView || window;

  const reduit = O.reduced != null ? O.reduced
    : !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let dejaVu = false;
  try { dejaVu = !!(O.session && win.sessionStorage.getItem(O.session)); } catch (e) { /* stockage refusé */ }

  /* ---------------------------------------------------- 1. le SVG animable */
  hote.classList.add('lc-intro');
  const scene = doc.createElement('div');
  scene.className = 'lc-intro__scene';
  hote.appendChild(scene);

  let svgTexte = options.svg || null;
  if (!svgTexte) {
    const r = await fetch(O.src, { cache: 'force-cache' });
    if (!r.ok) throw new Error('logo-intro : ' + O.src + ' introuvable (' + r.status + ')');
    svgTexte = await r.text();
  }
  scene.innerHTML = svgTexte;
  const svg = scene.querySelector('svg');
  if (!svg) throw new Error('logo-intro : SVG illisible');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.removeAttribute('width'); svg.removeAttribute('height');

  const brut = svg.querySelector('#lc-anime-data');
  const D = JSON.parse(brut.textContent);
  brut.remove();

  /* cadrage : sur mobile on resserre, mais la plume reste dans le champ */
  const vbLarge = D.viewBox.slice();
  const serrer = () => {
    if (O.cadrage === 'large') return false;
    if (O.cadrage === 'serre') return true;
    return (hote.clientWidth || win.innerWidth) < 640;
  };
  const appliqueCadrage = () => {
    const k = serrer() ? 0.42 : 1;                 // on rogne 58 % de la marge
    const mx = vbLarge[2] * 0.033 * (1 - k), my = vbLarge[3] * 0.062 * (1 - k);
    VB[0] = vbLarge[0] + mx; VB[1] = vbLarge[1] + my;
    VB[2] = vbLarge[2] - 2 * mx; VB[3] = vbLarge[3] - 2 * my;
    svg.setAttribute('viewBox', VB.join(' '));
    if (plume && plume.cadre) plume.cadre(VB);
  };
  const VB = vbLarge.slice();

  /* ------------------------------------------- 2. masques : état de départ */
  const lots = {
    script: lotEclats(svg, '#lcShScript', D.script.shards),
    co: lotEclats(svg, '#lcShCo', D.co.shards),
    filR: lotEclats(svg, '#lcShFilR', D.filR.shards),
    filL: lotEclats(svg, '#lcShFilL', D.filL.shards),
  };
  const frais = svg.querySelector('#lcFraisPath');
  if (frais) { frais.setAttribute('pathLength', '1'); frais.setAttribute('stroke-dasharray', '0 1 0 4'); }
  const gFrais = svg.querySelector('#lc-frais');

  const revelables = [...D.del, ...D.or, ...D.tri]
    .map(id => svg.querySelector('#' + CSS.escape(id))).filter(Boolean);
  const boites = new Map();
  for (const el of revelables) { try { boites.set(el, el.getBBox()); } catch (e) { /* ignoré */ } }

  /* ------------------------------------------------- 3. tables de parcours */
  const dGeo = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  const mesure = d => { dGeo.setAttribute('d', d); return dGeo; };
  const routes = {
    script: route(mesure(D.script.d), 900, D.script.ups, { courbure: 8.5, vol: 2.5, hesite: 0.66 }),
    co: route(mesure(D.co.d), 280, D.co.ups, { courbure: 6.0, vol: 2.2, hesite: 0.72 }),
    filR: route(mesure(D.filR.d), 140, [], { courbure: 0, vol: 1, hesite: 1 }),
  };
  const coDep = routes.co.pos(0), coFin = routes.co.pos(1);
  const scrFin = routes.script.pos(1), scrDep = routes.script.pos(0);
  const filFin = routes.filR.pos(1);

  /* trajets de vol de la plume : entrée, retour vers le Co, sortie */
  const horsChamp = (dx, dy) => [VB[0] + VB[2] * dx, VB[1] + VB[3] * dy];
  const vols = {
    entree: null, versCo: null, sortie: null,
  };
  const majVols = () => {
    vols.entree = bezier(horsChamp(1.20, 0.42), horsChamp(0.86, 0.28), [scrDep[0] + 215, scrDep[1] - 34], scrDep);
    vols.versCo = bezier(scrFin, [scrFin[0] - 30, scrFin[1] - 130], [coDep[0] + 190, coDep[1] - 150], coDep);
    vols.sortie = bezier(filFin, [filFin[0] + 120, filFin[1] - 70], horsChamp(1.04, 0.30), horsChamp(1.34, 0.02));
  };
  majVols();

  /* ------------------------------------------------------------- 4. plume */
  let plume = null;
  if (O.plume && !reduit) {
    try { plume = await creerPlume3D(scene, VB, O.threeSrc, doc); } catch (e) { plume = null; }
    if (!plume) { try { plume = creerPlume2D(svg, VB); } catch (e) { plume = null; } }
  }
  appliqueCadrage();

  /* ------------------------------------------------------- 5. rendu d'état */
  const etatFinal = () => {
    for (const k in lots) { lots[k].vus.fill(1); for (const e of lots[k].els) montre(e); }
    if (frais) frais.setAttribute('stroke-dasharray', '0 1 0 1');
    if (gFrais) gFrais.style.opacity = '0';
    for (const el of revelables) { el.style.opacity = '1'; el.removeAttribute('transform'); }
    if (plume) plume.montre(0);
    demasque();
  };
  const etatVide = () => {
    for (const k in lots) { lots[k].vus.fill(-1); for (const e of lots[k].els) cache(e); }
    if (gFrais) gFrais.style.opacity = '1';
    for (const el of revelables) el.style.opacity = '0';
    if (plume) plume.montre(0);
  };
  // une fois le tracé fini, on retire les masques : le logo redevient une image
  // fixe, sans aucune recomposition par image. « Ensuite le logo ne bouge plus. »
  const masques = [['#lc-script-w', 'lcMaskScript'], ['#lc-co-w', 'lcMaskCo'], ['#lc-fil-w', 'lcMaskFil']];
  let demasqueFait = false;
  function demasque() {
    if (demasqueFait) return;
    demasqueFait = true;
    for (const [sel] of masques) { const g = svg.querySelector(sel); if (g) g.removeAttribute('mask'); }
    if (gFrais) gFrais.remove();
  }
  function remasque() {
    demasqueFait = false;
    for (const [sel, id] of masques) { const g = svg.querySelector(sel); if (g) g.setAttribute('mask', 'url(#' + id + ')'); }
  }

  /* ------------------------------------------------------------ 6. horloge */
  let raf = 0, t0 = 0, tCourant = 0, enCours = false, fini = false;
  const images = [];               // horodatage des images, pour la mesure de fps

  function rendu(t) {
    tCourant = t;
    const u = clamp(t / O.duree);

    /* --- lettres : la bande de révélation avance avec la pointe --- */
    const pE = phase(u, PH.ecriture);
    const uE = routes.script.temps(pE);
    avance(lots.script, uE);
    if (frais && gFrais) {
      // lucarne d'encre fraîche : « 0 a w 4 » = rien, puis un vide de a, puis une
      // fenêtre de w juste derrière la pointe, puis plus rien. Le trait est un
      // instant plus chaud, puis refroidit en ivoire mat.
      const fenetre = 0.028;
      const a = Math.max(0, uE - fenetre), w = Math.min(fenetre, uE);
      frais.setAttribute('stroke-dasharray', '0 ' + a.toFixed(4) + ' ' + w.toFixed(4) + ' 4');
      gFrais.style.opacity = (pE > 0.001 && pE < 0.999) ? '1' : '0';
    }

    /* --- « DE L'OR » : montée douce, échelonnée --- */
    const pD = phase(u, PH.delor);
    for (let i = 0; i < revelables.length; i++) {
      const el = revelables[i];
      const tri = i >= D.del.length + D.or.length;
      let p;
      if (tri) p = easeOut(phase(u, PH.tri));
      else {
        const n = D.del.length + D.or.length;
        const d = (i / Math.max(1, n - 1)) * 0.42;                 // échelonnement
        p = easeOutQuint(clamp((pD - d) / (1 - d)));
      }
      el.style.opacity = p.toFixed(3);
      if (p >= 1) el.removeAttribute('transform');
      else if (tri) {
        const b = boites.get(el);
        if (b) {
          const cx = b.x + b.width / 2, s = 0.15 + 0.85 * p;
          el.setAttribute('transform', `translate(${cx.toFixed(2)} 0) scale(${s.toFixed(3)} 1) translate(${(-cx).toFixed(2)} 0)`);
        }
      } else {
        el.setAttribute('transform', `translate(0 ${((1 - p) * 7).toFixed(2)})`);
      }
    }

    /* --- le « Co », un seul geste, puis le fil qui en naît --- */
    const pC = phase(u, PH.co);
    const uC = routes.co.temps(pC);
    avance(lots.co, uC);
    const pF = easeInOut(phase(u, PH.fil));
    avance(lots.filR, pF);
    avance(lots.filL, easeInOut(clamp((phase(u, PH.fil) - 0.06) / 0.94)));

    /* --- la plume --- */
    majPlume(u, pE, pC, pF);

    /* --- fin : on fige --- */
    if (u >= 1 && !demasqueFait) demasque();
    if (plume) plume.rendu();
  }

  let pointe = [0, 0], pointeLevee = 1;
  function majPlume(u, pE, pC, pF) {
    let p = null, tan = null, leve = 1, opac = 1;
    if (u < PH.entree[1]) {
      const q = easeOut(phase(u, PH.entree));
      p = vols.entree.pos(q); tan = vols.entree.tan(q);
      leve = 1 - q * q; opac = clamp((q - 0.04) * 2.4);
    } else if (u < PH.ecriture[1]) {
      const uu = routes.script.temps(pE);
      p = routes.script.pos(uu); tan = routes.script.tan(uu);
      leve = routes.script.vol(uu);
    } else if (u < PH.co[0]) {
      // Retour vers le fil : la plume repasse fatalement au-dessus de la
      // calligraphie qu'elle vient d'écrire. On l'efface un peu au plus vite de
      // son mouvement — le geste se lit, sans jamais masquer le texte.
      const q = easeInOut(phase(u, PH.versCo));
      p = vols.versCo.pos(q); tan = vols.versCo.tan(q);
      leve = Math.sin(Math.PI * q) * 0.92;
      opac = 1 - 0.20 * Math.pow(Math.sin(Math.PI * q), 0.7);
    } else if (u < PH.fil[0]) {
      const uu = routes.co.temps(pC);
      p = routes.co.pos(uu); tan = routes.co.tan(uu);
      leve = routes.co.vol(uu);
    } else if (u < PH.sortie[0]) {
      p = routes.filR.pos(pF); tan = routes.filR.tan(pF); leve = 0;
    } else {
      const q = easeInOut(phase(u, PH.sortie));
      p = vols.sortie.pos(q); tan = vols.sortie.tan(q);
      leve = q; opac = 1 - clamp((q - 0.55) / 0.45);
    }
    pointe = p; pointeLevee = leve;
    if (plume) { plume.pose(p, tan, leve); plume.montre(opac); }
  }

  /* --------------------------------------------------------- 7. commandes */
  function boucle(ts) {
    if (!enCours) return;
    if (!t0) t0 = ts;
    images.push(ts);
    const t = (ts - t0) / 1000;
    rendu(Math.min(t, O.duree));
    if (t >= O.duree) { enCours = false; fini = true; raf = 0; marque(); return; }
    raf = win.requestAnimationFrame(boucle);
  }
  function marque() { try { if (O.session) win.sessionStorage.setItem(O.session, '1'); } catch (e) { } }

  const api = {
    duree: O.duree,
    svg, data: D, phases: PH,
    play() {
      if (fini || enCours) return api;
      remasque(); etatVide();
      images.length = 0; t0 = 0; enCours = true;
      raf = win.requestAnimationFrame(boucle);
      return api;
    },
    pause() { enCours = false; if (raf) win.cancelAnimationFrame(raf); raf = 0; return api; },
    stop() { api.pause(); return api; },
    /** Positionne l'animation à l'instant t (secondes) — pilotage image par image. */
    seek(t) {
      api.pause();
      if (t < O.duree) { remasque(); }
      rendu(clamp(t, 0, O.duree));
      tCourant = t;
      return api;
    },
    fin() { api.pause(); etatFinal(); fini = true; marque(); return api; },
    /** Position actuelle de la POINTE, en unités de viewBox (contrôle). */
    pointe() { return [pointe[0], pointe[1]]; },
    /** 0 = sur le papier, 1 = plume levée. */
    levee() { return pointeLevee; },
    etat() {
      const dt = [];
      for (let i = 1; i < images.length; i++) dt.push(images[i] - images[i - 1]);
      dt.sort((a, b) => a - b);
      return {
        t: +tCourant.toFixed(3), duree: O.duree, enCours, fini, reduit, dejaVu,
        images: images.length,
        fpsMoyen: images.length > 1 ? +(1000 * (images.length - 1) / (images[images.length - 1] - images[0])).toFixed(1) : 0,
        imageMedianeMs: dt.length ? +dt[dt.length >> 1].toFixed(2) : 0,
        imagePireMs: dt.length ? +dt[dt.length - 1].toFixed(2) : 0,
        plume: plume ? plume.genre : 'aucune',
        eclats: { script: lots.script.els.length, co: lots.co.els.length, fil: lots.filR.els.length + lots.filL.els.length },
      };
    },
    destroy() {
      api.pause();
      if (plume) plume.destroy();
      scene.remove();
      hote.classList.remove('lc-intro');
    },
    redimensionne: appliqueCadrage,
  };

  /* -------------------------------------------------------- 8. démarrage */
  if (reduit || dejaVu) { etatFinal(); fini = true; }
  else { etatVide(); if (O.autoplay) api.play(); }

  const surResize = () => { appliqueCadrage(); majVols(); if (plume) plume.taille(); };
  win.addEventListener('resize', surResize, { passive: true });
  const detruire = api.destroy;
  api.destroy = () => { win.removeEventListener('resize', surResize); detruire(); };

  return api;
}
export default createLogoIntro;

/* ========================================================================= */
/*  Éclats de masque                                                          */
/* ========================================================================= */
// Un masque à trait unique impose une épaisseur unique. La médiane est donc
// découpée en éclats, chacun à l'épaisseur de l'encre qu'il couvre. `pathLength=1`
// rend chaque éclat pilotable en fraction, sans jamais mesurer sa longueur.
function lotEclats(svg, sel, plages) {
  const g = svg.querySelector(sel);
  const els = g ? [...g.children] : [];
  for (const e of els) {
    // `pathLength=1` : chaque éclat se pilote en FRACTION, sans jamais mesurer sa
    // longueur réelle. L'avancée se joue sur le TIRET, pas sur le décalage — un
    // décalage tombe fatalement sur une frontière de motif et le moteur y laisse
    // échapper des miettes d'encre en avance sur la pointe.
    e.setAttribute('pathLength', '1');
    e.setAttribute('stroke-dashoffset', '0');
    cache(e);
  }
  return { els, plages, vus: new Float32Array(els.length).fill(-1) };
}
// Trois états francs, jamais d'intervalle de tiret NUL : un tiret de longueur
// zéro est un cas dégénéré que les moteurs de rendu traitent chacun à leur
// façon — c'est lui qui semait des pointillés de cuivre le long du fil.
function cache(e) { e.style.strokeDasharray = 'none'; e.style.visibility = 'hidden'; }
function montre(e) { e.style.strokeDasharray = 'none'; e.style.visibility = 'visible'; }
function partiel(e, v) { e.style.visibility = 'visible'; e.style.strokeDasharray = v.toFixed(4) + ' 4'; }

function avance(lot, u) {
  const { els, plages, vus } = lot;
  for (let i = 0; i < els.length; i++) {
    const [a, b] = plages[i];
    let v = b > a ? (u - a) / (b - a) : (u >= b ? 1 : 0);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (Math.abs(v - vus[i]) < 0.0008) continue;     // rien n'a bougé : on ne touche pas au DOM
    vus[i] = v;
    if (v <= 0.0008) cache(els[i]);
    else if (v >= 0.9992) montre(els[i]);
    else partiel(els[i], v);
  }
}

/* ========================================================================= */
/*  Parcours : position, tangente, et LOI DE VITESSE                          */
/* ========================================================================= */
// La main ralentit dans les courbes, accélère dans les déliés, hésite un instant
// quand la plume se pose. On échantillonne la médiane, on mesure sa courbure, on
// en déduit une vitesse locale, et on intègre : t -> abscisse curviligne.
function route(pathEl, N, levees = [], { courbure = 5, vol = 2.4, hesite = 0.65 } = {}) {
  const L = pathEl.getTotalLength() || 1;
  const X = new Float32Array(N + 1), Y = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { const p = pathEl.getPointAtLength(L * i / N); X[i] = p.x; Y[i] = p.y; }

  // Courbure discrète : angle de virage par unité de longueur parcourue.
  // La vitesse est BORNÉE : une vraie main ralentit dans les courbes, elle ne
  // s'arrête pas. Sans borne, les rebroussements du squelette (là où le parcours
  // repasse sur lui-même) mangeaient à eux seuls la moitié du temps d'écriture.
  const pas = L / N;
  const v = new Float32Array(N + 1);
  const VMIN = 0.40;
  for (let i = 0; i <= N; i++) {
    const a = Math.max(0, i - 2), b = Math.min(N, i + 2);
    const d1x = X[i] - X[a], d1y = Y[i] - Y[a], d2x = X[b] - X[i], d2y = Y[b] - Y[i];
    const n1 = Math.hypot(d1x, d1y) || 1e-6, n2 = Math.hypot(d2x, d2y) || 1e-6;
    let c = (d1x * d2x + d1y * d2y) / (n1 * n2); c = c > 1 ? 1 : c < -1 ? -1 : c;
    const k = Math.acos(c) / Math.max(1e-6, n1 + n2);              // rad / unité
    v[i] = Math.max(VMIN, 1 / (1 + courbure * k));
  }
  // lissage du profil : la main change de vitesse progressivement
  for (let p = 0; p < 3; p++) {
    const w = Float32Array.from(v);
    for (let i = 1; i < N; i++) v[i] = 0.25 * w[i - 1] + 0.5 * w[i] + 0.25 * w[i + 1];
  }
  // en vol la plume file ; à la pose elle hésite un instant
  // (les levées sont données en FRACTION de l'abscisse totale)
  const dansVol = new Uint8Array(N + 1);
  for (const [a, b] of levees) {
    const i0 = Math.max(0, Math.floor(a * N)), i1 = Math.min(N, Math.ceil(b * N));
    for (let i = i0; i <= i1; i++) dansVol[i] = 1;
  }
  for (let i = 0; i <= N; i++) if (dansVol[i]) v[i] *= vol;
  for (const [, b] of levees) {                                     // reprise après la pose
    const i0 = Math.min(N, Math.floor(b * N));
    for (let i = i0; i < Math.min(N, i0 + Math.ceil(N * 0.014)); i++) v[i] *= hesite;
  }
  // léger appui au départ et relâche à la fin
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    v[i] *= 0.42 + 0.58 * Math.min(1, u / 0.035);
    v[i] *= 0.40 + 0.60 * Math.min(1, (1 - u) / 0.045);
  }

  // intégration : coût temporel cumulé
  const T = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) T[i] = T[i - 1] + pas / Math.max(1e-4, v[i]);
  const Ttot = T[N] || 1;
  // inversion : LUT temps normalisé -> abscisse normalisée
  const M = 512, LUT = new Float32Array(M + 1);
  let j = 0;
  for (let m = 0; m <= M; m++) {
    const cible = Ttot * m / M;
    while (j < N && T[j + 1] < cible) j++;
    const seg = Math.max(1e-9, T[j + 1] - T[j]);
    LUT[m] = (j + Math.min(1, Math.max(0, (cible - T[j]) / seg))) / N;
  }

  const pos = u => {
    const f = clamp(u) * N, i = Math.min(N - 1, Math.floor(f)), r = f - i;
    return [lerp(X[i], X[i + 1], r), lerp(Y[i], Y[i + 1], r)];
  };
  const tan = u => {
    const f = clamp(u) * N, i = Math.min(N - 2, Math.max(0, Math.floor(f) - 1));
    const dx = X[i + 2] - X[i], dy = Y[i + 2] - Y[i], n = Math.hypot(dx, dy) || 1;
    return [dx / n, dy / n];
  };
  return {
    L, pos, tan,
    /** temps normalisé -> abscisse normalisée (la loi de vitesse) */
    temps: p => { const f = clamp(p) * M, i = Math.min(M - 1, Math.floor(f)); return lerp(LUT[i], LUT[i + 1], f - i); },
    /** 1 pendant une levée de plume, 0 sur le papier (transition adoucie) */
    vol: u => {
      const s = clamp(u);
      for (const [a, b] of levees) {
        if (s >= a && s <= b) return Math.pow(Math.sin(Math.PI * (s - a) / Math.max(1e-9, b - a)), 0.6);
      }
      return 0;
    },
  };
}

/* cubique de Bézier : les vols de la plume hors du texte */
function bezier(p0, p1, p2, p3) {
  const at = t => {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  };
  return {
    pos: at,
    tan: t => {
      const a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01));
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
      return [dx / n, dy / n];
    },
  };
}

/* ========================================================================= */
/*  LA PLUME — Three.js, et seulement elle                                    */
/* ========================================================================= */
// Caméra ORTHOGRAPHIQUE calée exactement sur la viewBox du SVG : un point du
// dessin et un point du monde 3D sont le même point, au pixel près. C'est ce qui
// permet à la pointe d'être VRAIMENT sur le front du tracé, à toute taille.
async function creerPlume3D(scene, VB, threeSrc, doc) {
  const THREE = await import(/* @vite-ignore */ threeSrc);
  if (!THREE || !THREE.WebGLRenderer) return null;

  const cnv = doc.createElement('canvas');
  cnv.className = 'lc-intro__plume';
  cnv.setAttribute('aria-hidden', 'true');
  scene.appendChild(cnv);

  let rendeur;
  try {
    rendeur = new THREE.WebGLRenderer({ canvas: cnv, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (e) { cnv.remove(); return null; }
  rendeur.setClearAlpha(0);

  const sc = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
  sc.add(cam);

  // Lumières : une clé chaude venue d'en haut à gauche (comme une lampe de
  // bureau), un contre-jour froid qui détache le manche du fond charbon, et un
  // rappel or très faible par en dessous. Aucune ombre portée : rien à calculer.
  sc.add(new THREE.AmbientLight(0xfff2dc, 0.42));
  const cle = new THREE.DirectionalLight(0xfff3de, 2.6); cle.position.set(-0.5, 1.0, 1.15); sc.add(cle);
  const contre = new THREE.DirectionalLight(0xa8bede, 1.15); contre.position.set(0.9, 0.15, -0.75); sc.add(contre);
  const bas = new THREE.DirectionalLight(0xc9a227, 0.42); bas.position.set(0.25, -1, 0.4); sc.add(bas);
  const face = new THREE.DirectionalLight(0xffeccd, 1.05); face.position.set(-0.1, 0.25, 1); sc.add(face);

  const pivot = new THREE.Group();      // sa position EST la pointe
  sc.add(pivot);
  const corps = new THREE.Group();      // la plume, pointe à l'origine locale
  pivot.add(corps);

  const K = 1;                          // unités de viewBox
  const matOr = new THREE.MeshStandardMaterial({ color: 0xc9a44a, metalness: 0.95, roughness: 0.30 });
  const matOrSombre = new THREE.MeshStandardMaterial({ color: 0x8d6c2a, metalness: 0.92, roughness: 0.48 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x35302b, metalness: 0.72, roughness: 0.40 });
  const matSombre = new THREE.MeshStandardMaterial({ color: 0x211e1b, metalness: 0.55, roughness: 0.52 });

  /* ----------------------------------------------------------------- LE BEC */
  // Silhouette de plume à écrire classique : épaules marquées, fuseau long,
  // fente centrale et évent. C'est la fente qui fait qu'on lit « plume » et non
  // « flèche » — elle est donc franche, et la lame reste presque plate.
  const LB = 98 * K, WB = 14 * K;
  const forme = new THREE.Shape();
  forme.moveTo(0, 0);
  forme.bezierCurveTo(0.10 * LB, 0.22 * WB, 0.26 * LB, 0.62 * WB, 0.46 * LB, 0.86 * WB);
  forme.bezierCurveTo(0.62 * LB, 1.04 * WB, 0.74 * LB, 1.10 * WB, 0.84 * LB, 1.10 * WB);
  forme.bezierCurveTo(0.92 * LB, 1.10 * WB, 0.97 * LB, 1.05 * WB, LB, 0.94 * WB);
  forme.lineTo(LB, -0.94 * WB);
  forme.bezierCurveTo(0.97 * LB, -1.05 * WB, 0.92 * LB, -1.10 * WB, 0.84 * LB, -1.10 * WB);
  forme.bezierCurveTo(0.74 * LB, -1.10 * WB, 0.62 * LB, -1.04 * WB, 0.46 * LB, -0.86 * WB);
  forme.bezierCurveTo(0.26 * LB, -0.62 * WB, 0.10 * LB, -0.22 * WB, 0, 0);
  // La fente et son évent : les deux détails qui font lire « plume » plutôt que
  // « pointe de flèche ». Sur fond charbon, le vide de la fente est un trait
  // sombre net — il doit donc rester franc même à 200 px de large.
  const fente = new THREE.Path();
  const fx0 = 0.055 * LB, fx1 = 0.46 * LB, fw = 0.10 * WB;
  fente.moveTo(fx0, -fw); fente.lineTo(fx1, -fw);
  fente.absarc(fx1, 0, 0.23 * WB, -Math.PI / 2, Math.PI / 2, false);
  fente.lineTo(fx0, fw); fente.lineTo(fx0, -fw);
  forme.holes.push(fente);

  const geoBec = new THREE.ExtrudeGeometry(forme, {
    depth: 1.5 * K, bevelEnabled: true, bevelThickness: 0.55 * K, bevelSize: 0.55 * K, bevelSegments: 2, curveSegments: 22,
  });
  geoBec.translate(0, 0, -0.75 * K);
  // Une lame de plume est une feuille à peine gouttière — trop la rouler et
  // elle se lit comme un cône, c'est-à-dire comme une pointe de flèche.
  {
    const p = geoBec.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = clamp(x / LB);
      p.setZ(i, z - (0.008 + 0.012 * t) * y * y);          // gouttière très douce
      p.setY(i, y * (0.70 + 0.30 * Math.pow(t, 0.7)));     // la pointe se referme
    }
    geoBec.computeVertexNormals();
  }
  corps.add(new THREE.Mesh(geoBec, matOr));

  /* --------------------------------------------------------------- LE MANCHE */
  // La caméra est orthographique : sans perspective, un manche cylindrique se lit
  // comme une brochette. On BAQUE donc la fuite dans la géométrie — le manche
  // s'amincit franchement en s'éloignant, et se termine en biseau.
  const X0 = LB - 5 * K;                          // le manche coiffe la base du bec
  const LM = 178 * K;
  const rayon = t => (11.6 - 8.0 * Math.pow(t, 0.92) + 1.5 * Math.sin(Math.PI * Math.pow(t, 0.7))) * K;

  const virole = new THREE.Mesh(new THREE.CylinderGeometry(11.0 * K, 9.2 * K, 15 * K, 30, 1), matOrSombre);
  virole.rotation.z = Math.PI / 2; virole.position.set(X0 + 7 * K, 0, 0);
  corps.add(virole);

  const profil = [];
  for (let i = 0; i <= 26; i++) { const t = i / 26; profil.push(new THREE.Vector2(Math.max(0.8 * K, rayon(t)), X0 + 14 * K + t * LM)); }
  profil.push(new THREE.Vector2(0.05 * K, X0 + 14 * K + LM + 5 * K));
  const manche = new THREE.Mesh(new THREE.LatheGeometry(profil, 34), matMetal);
  manche.rotation.z = -Math.PI / 2;
  corps.add(manche);

  // deux filets d'or mat : les seuls ornements, très espacés
  for (const [t, ep] of [[0.12, 3.0], [0.20, 1.6]]) {
    const r = rayon(t) + 0.35 * K;
    const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ep * K, 30, 1), matOrSombre);
    f.rotation.z = Math.PI / 2; f.position.set(X0 + 14 * K + t * LM, 0, 0);
    corps.add(f);
  }
  // bouton d'extrémité, sombre : le manche ne se termine pas en aiguille
  const bout = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.0 * K, rayon(1) + 0.5 * K), 18, 12), matSombre);
  bout.position.set(X0 + 14 * K + LM, 0, 0);
  corps.add(bout);

  // Orientation d'écriture d'un droitier : le manche part en HAUT À DROITE de
  // la pointe, à 46° du papier, légèrement tourné vers nous pour montrer la fente.
  const ANGLE = 0.80;
  corps.rotation.set(0.34, -0.17, ANGLE);

  const genre = 'three';
  let opac = 0;
  const tousMat = [matOr, matOrSombre, matMetal, matSombre];
  for (const m of tousMat) { m.transparent = true; m.opacity = 0; }

  const obj = {
    genre,
    cadre(vb) {
      cam.left = vb[0]; cam.right = vb[0] + vb[2];
      cam.top = -vb[1]; cam.bottom = -(vb[1] + vb[3]);
      cam.position.set(0, 0, 900); cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      obj.taille();
    },
    taille() {
      const r = scene.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      rendeur.setPixelRatio(Math.min(1.5, (doc.defaultView || window).devicePixelRatio || 1));
      rendeur.setSize(w, h, false);
    },
    pose(p, tan, leve) {
      const l = leve || 0;
      // en vol, la plume se soulève vers le haut-droite : c'est la main qui
      // se dégage du papier, pas un simple décalage.
      pivot.position.set(p[0] + l * 9, -(p[1] - l * 20), 0);
      // elle s'incline très légèrement avec le sens du trait : elle vit,
      // sans jamais tourner sur elle-même.
      const ang = Math.atan2(-tan[1], tan[0]);
      corps.rotation.z = ANGLE + Math.max(-0.13, Math.min(0.13, Math.sin(ang) * 0.17)) + l * 0.10;
      corps.rotation.x = 0.34 + l * 0.13;
      const s = 1 + l * 0.04;
      corps.scale.set(s, s, s);
    },
    montre(o) { opac = o; for (const m of tousMat) m.opacity = o; },
    rendu() { if (opac > 0.002) rendeur.render(sc, cam); else rendeur.clear(); },
    destroy() {
      try { rendeur.dispose(); } catch (e) { }
      geoBec.dispose(); cnv.remove();
    },
  };
  obj.cadre(VB);
  return obj;
}

/* --------------------------- repli vectoriel (pas de WebGL) -------------- */
// Même silhouette, même point de contact : sur un appareil sans WebGL la plume
// reste — c'est une exigence du cahier des charges, pas une option.
function creerPlume2D(svg, VB) {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('id', 'lc-plume2d');
  g.setAttribute('aria-hidden', 'true');
  g.innerHTML =
    '<g transform="rotate(-35)">'
    + '<path d="M0 0C6 3 20 12 32 19C44 26 58 30 74 30L74 -30C58 -30 44 -26 32 -19C20 -12 6 -3 0 0Z" fill="#b98f37"/>'
    + '<path d="M8 0L40 0" stroke="#141210" stroke-width="2.4" stroke-linecap="round"/>'
    + '<circle cx="40" cy="0" r="3.1" fill="#141210"/>'
    + '<rect x="74" y="-9" width="12" height="18" rx="3" fill="#8a6a28"/>'
    + '<path d="M86 -8L330 -4L330 4L86 8Z" fill="#26231f"/>'
    + '<rect x="210" y="-6.6" width="5" height="13" fill="#8a6a28"/>'
    + '</g>';
  g.style.opacity = '0';
  svg.appendChild(g);
  return {
    genre: 'svg',
    cadre() { },
    taille() { },
    pose(p, tan, leve) {
      const l = leve || 0;
      const inc = Math.max(-8, Math.min(8, Math.atan2(-tan[1], tan[0]) * 6));
      g.setAttribute('transform', `translate(${(p[0] + l * 7).toFixed(2)} ${(p[1] - l * 17).toFixed(2)}) rotate(${inc.toFixed(2)}) scale(${(1 + l * 0.035).toFixed(3)})`);
    },
    montre(o) { g.style.opacity = String(o); },
    rendu() { },
    destroy() { g.remove(); },
  };
}
