/* La Compagnie de l'Or · Accueil : sections enrichies
   Reveals choreographies, cartes 3D du rendez-vous, timeline, domaines, carte de France geolocalisee,
   cours de l'or (architecture API + mode demonstration etiquete), FAQ.
   Regles : animations en transform/opacity, IO pour tout, pause hors ecran et onglet cache, reduced motion honore. */
import { REGIONS, FRANCE_VIEWBOX, project } from './france-geo.js';
import { initTimeline } from './scenes/timeline.js';
import { initDomaines } from './scenes/domaines.js';
import { suivreChiffre } from './scenes/domaines-chiffre.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const FINE = matchMedia('(pointer: fine)');
const SVGNS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, parent) => { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; };

/* ---------- Pause globale des animations sur onglet cache ---------- */
document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

/* ---------- Reveals : entree sequencee, une seule fois, puis classe .in ---------- */
const revealIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } }), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
$$('[data-reveal]').forEach(el => { if (REDUCED.matches) el.classList.add('in'); else revealIO.observe(el); });

/* ---------- Animations "vivantes" actives seulement a l ecran ---------- */
const liveIO = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('is-live', e.isIntersecting)), { threshold: 0.05 });
$$('[data-live]').forEach(el => liveIO.observe(el));

/* =====================================================================
   1. LE PARCOURS : UNE SEULE SCENE 3D, TRAVERSEE AU DEFILEMENT
   ---------------------------------------------------------------------
   Remplace les quatre cartes et leurs quatre modules independants. Un seul
   contexte WebGL pour toute la section ; le module mesure lui-meme la mise
   en page et se cadre dessus. Ici on ne fait que : charger a l approche,
   transmettre le pointeur, relayer la bascule jour / nuit.
   Les anciens modules (scenes/france.js, hotelcss.js, expertise.js,
   decide.js) ne sont plus montes sur l accueil ; ils restent sur disque et
   servent encore aux pages d essai de _lab.
   ===================================================================== */
const parcSection = $('#etapes');
if (parcSection && $('.parc__toile', parcSection)) {
  let parc = null, chargement = false;
  const parcIO = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting) || parc || chargement) return;
    chargement = true; parcIO.disconnect();
    try {
      const mod = await import('./scenes/parcours3d.js');
      parc = await mod.initParcours(parcSection, {
        reduced: REDUCED.matches,
        ambiance: document.documentElement.dataset.ambiance || 'nuit',
      });
      window.__parcours = parc;
    } catch (err) { parcSection.classList.add('is-repli'); console.warn('parcours 3D indisponible', err); }
    chargement = false;
  }, { rootMargin: '700px 0px' });
  parcIO.observe(parcSection);

  /* le canevas est collant et occupe la fenetre : le pointeur se lit donc en
     coordonnees de FENETRE, pas de section. */
  if (FINE.matches && !REDUCED.matches) {
    addEventListener('pointermove', e => {
      if (parc) parc.setPointer(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
    }, { passive: true });
  }
  new MutationObserver(() => {
    if (parc) parc.setAmbiance(document.documentElement.dataset.ambiance || 'nuit');
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });
}

/* =====================================================================
   2. TIMELINE DE L EXPERTISE : module ./scenes/timeline.js (ligne d or, bille active, états)
   ===================================================================== */
const tlSection = $('#expertise');
if (tlSection) window.__timeline = initTimeline(tlSection, { reduced: REDUCED.matches });

/* =====================================================================
   3. DOMAINES D EXPERTISE : module ./scenes/domaines.js (fondu A/B, odomètre, parallaxe, lecture)
   ===================================================================== */
const domSection = $('#domaines');
if (domSection) window.__domaines = initDomaines(domSection, { reduced: REDUCED.matches });
  /* le chiffre fantome recopie simplement la famille active */
  suivreChiffre(domSection);

/* =====================================================================
   4. CARTE DE FRANCE 3D : moteur Three.js lazy-load (scenes/carte3d.js + carte3d-ui.js)
      Source de verite : window.COMPAGNIE_OR_JOURNEES / window.COMPAGNIE_OR_SIEGE.
      Repli automatique (carte SVG) si WebGL est indisponible.
   ===================================================================== */
const carteHost = $('#carte-france');
if (carteHost) {
  let carte = null, loading = false;
  const nearIO = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting) || carte || loading) return;
    loading = true; nearIO.disconnect();
    try {
      const mod = await import('./scenes/carte3d.js');
      carte = await mod.initCarte3D(carteHost, { reduced: REDUCED.matches });
      window.__carte3d = carte;
    } catch (err) { carteHost.classList.add('is-fallback'); console.warn('carte 3D indisponible', err); }
    loading = false;
  }, { rootMargin: '600px 0px' });
  nearIO.observe(carteHost);
  const visIO = new IntersectionObserver(es => es.forEach(e => { if (carte) (e.isIntersecting ? carte.start() : carte.stop()); }), { threshold: 0.02 });
  visIO.observe(carteHost);
  if (FINE.matches && !REDUCED.matches) {
    carteHost.addEventListener('pointermove', ev => { if (!carte || !carte.setPointer) return; const r = carteHost.getBoundingClientRect(); carte.setPointer((ev.clientX - r.left) / r.width - 0.5, (ev.clientY - r.top) / r.height - 0.5); });
    carteHost.addEventListener('pointerleave', () => carte && carte.setPointer && carte.setPointer(0, 0));
  }
}

/* =====================================================================
   5. COURS DES METAUX : donnees reelles Gold-API via notre proxy serveur.
      La cle de la source vit uniquement cote serveur ; le navigateur ne parle qu'a /api/metaux.
      Chargement paresseux : aucune requete ni moteur graphique tant que la section n'est pas a l'ecran.
   ===================================================================== */
const coursHote = $('#cours-hote');
if (coursHote) {
  let cours = null, chargement = false;
  const nearIO = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting) || cours || chargement) return;
    chargement = true; nearIO.disconnect();
    try {
      const mod = await import('./scenes/cours-init.js');
      cours = mod.initCours(coursHote, { base: '/api/metaux', reduced: REDUCED.matches });
      window.__cours = cours;
      if (cours.demarrer) cours.demarrer();
    } catch (err) { coursHote.classList.add('is-fallback'); console.warn('cours des metaux indisponible', err); }
    chargement = false;
  }, { rootMargin: '400px 0px' });
  nearIO.observe(coursHote);
  const visIO = new IntersectionObserver(es => es.forEach(e => {
    if (!cours) return;
    if (e.isIntersecting) { cours.demarrer && cours.demarrer(); } else { cours.arreter && cours.arreter(); }
  }), { threshold: 0.02 });
  visIO.observe(coursHote);
}

/* =====================================================================
   6. FAQ : questions repliables, ouverture fluide (grid-rows), une a la fois
   ===================================================================== */
const faq = $('#faq');
if (faq) {
  const items = $$('.faq__item', faq);
  items.forEach(it => {
    const q = $('.faq__q', it);
    q.addEventListener('click', () => {
      const open = it.classList.contains('is-open');
      items.forEach(o => { o.classList.remove('is-open'); $('.faq__q', o).setAttribute('aria-expanded', 'false'); });
      if (!open) { it.classList.add('is-open'); q.setAttribute('aria-expanded', 'true'); }
    });
  });
}
