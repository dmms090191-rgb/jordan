/* =====================================================================
   La Compagnie de l'Or — Section « Cours des metaux » : MOTEUR GRAPHIQUE
   (lot coursgraph)
   ---------------------------------------------------------------------
   Adaptateur TradingView Lightweight Charts v4.2.3 (vendoree, Apache 2.0)
   pour l'interface du lot « coursui » :

       import { createCoursChart } from './cours-chart.js';
       const moteur = await createCoursChart(ui.zoneGraphique, {
         ambiance : 'nuit',
         reduced  : false,
         onCurseur: b => ui.setCurseur(b)     // bandeau O/H/B/C
       });
       ui.brancherGraphique(moteur);          // { setSerie, setAmbiance, destroy }

   ---------------------------------------------------------------------
   REGLE ABSOLUE — AUCUNE DONNEE INVENTEE
   ---------------------------------------------------------------------
   Ce module ne CREE jamais une bougie. Il ne comble aucun trou, ne lisse
   rien, n'interpole rien, ne prolonge pas la derniere valeur, n'ajoute
   aucune valeur de remplissage (surtout pas 0). Il dessine EXACTEMENT le
   tableau que /api/metaux/serie a renvoye, et rien d'autre :

     - une bougie dont l'un des quatre prix manque est ECARTEE (comptee
       dans `rejets`, jamais reparee) ;
     - un horodatage illisible ecarte la bougie ;
     - deux bougies au meme instant : la seconde est ecartee (Lightweight
       Charts exige des temps strictement croissants) — on ne fusionne
       pas, on ne moyenne pas ;
     - une serie vide reste vide : le canevas est efface, l'interface
       affiche son etat « aucune bougie reelle ».

   Aucun appel reseau ici, sauf le chargement PARESSEUX de la
   bibliotheque vendoree (jamais dans le bundle initial) : un simple
   <script src> injecte a la demande, memoise, jamais un CDN.

   ---------------------------------------------------------------------
   THEME
   ---------------------------------------------------------------------
   Aucune couleur en dur : tout est lu a chaud sur les tokens CSS de la
   section (.cx) — --cx-up, --cx-down, --cx-line, --cx-grille, --text-2,
   --gold-ink, --body. Jour/Nuit s'applique donc a chaud, sans recreer
   le graphique.
   ===================================================================== */

/* Emplacement de la bibliotheque vendoree, relatif a CE module :
   assets/js/scenes/ -> assets/vendor/ */
const URL_VENDOR = new URL('../../vendor/lightweight-charts.standalone.production.js', import.meta.url).href;

/* Constantes de la bibliotheque (valeurs stables de l'API publique v4).
   On prefere toujours l'enum reellement exportee ; ces nombres ne sont
   qu'un filet si une version future renommait un export. */
const MODE_CROISILLON_LIBRE = 0;      // CrosshairMode.Normal
const TRAIT_POINTILLE = 1;            // LineStyle.Dotted
const TRAIT_TIRETS_LARGES = 3;        // LineStyle.LargeDashed

const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* --------------------------------------------------------------- outils */

/** Nombre fini, sans jamais transformer une absence en 0. */
function nombre(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Un prix de metal est strictement positif : 0 n'est pas un prix. */
function prix(v) { const n = nombre(v); return n !== null && n > 0 ? n : null; }

/** Horodatage -> epoch SECONDES (format UTCTimestamp de la bibliotheque).
 *  Renvoie null si ce n'est pas interpretable : la bougie est alors
 *  ecartee, jamais devinee. */
function tempsDe(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v >= 1e12) return Math.floor(v / 1000);          // millisecondes
    if (v > 0) return Math.floor(v);                      // secondes
    return null;
  }
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return tempsDe(n);
    const p = Date.parse(v);
    return Number.isFinite(p) ? Math.floor(p / 1000) : null;
  }
  return null;
}

/** Meme regle de precision que l'interface, pour que l'axe et le bandeau
 *  de lecture affichent le meme nombre de decimales. */
function decimales(v) { const a = Math.abs(v); return a >= 10 ? 2 : a >= 1 ? 3 : 4; }

/** Formate un nombre en francais, sans espace insecable etroite : le
 *  canevas n'a pas de repli de police, U+202F pourrait ne pas rendre. */
function fr(n, d) {
  /* Les decimales nulles ne sont pas ecrites : les graduations de l'axe
     tombent sur des valeurs rondes, « 4 300,00 » n'apporte rien et vole
     de la largeur au trace (surtout sur mobile). Rien n'est arrondi :
     seuls des zeros de fin disparaissent. */
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d })
    .format(n).replace(/[  ]/g, ' ');
}

/** Applique une opacite a une couleur de token (#rgb, #rrggbb, rgb(),
 *  rgba()). Si la forme est inconnue, la couleur est renvoyee telle
 *  quelle : mieux vaut la bonne teinte opaque qu'une couleur fausse. */
/** Fusion d'options sur UN niveau d'imbrication. Object.assign seul
 *  ecraserait `timeScale` en entier et ferait disparaitre le format des
 *  graduations : c'est exactement le piege a eviter. */
function fusion(a, b) {
  const out = Object.assign({}, a);
  for (const k in b) {
    const v = b[k];
    const est = x => x && typeof x === 'object' && !Array.isArray(x);
    out[k] = (est(v) && est(out[k])) ? Object.assign({}, out[k], v) : v;
  }
  return out;
}

function avecAlpha(couleur, a) {
  const c = String(couleur || '').trim();
  if (!c) return c;
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16), v = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a0 = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return 'rgba(' + r + ',' + v + ',' + b + ',' + (a0 * a).toFixed(3) + ')';
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length >= 3) {
      const a0 = p.length >= 4 ? (parseFloat(p[3]) || 0) : 1;
      return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + (a0 * a).toFixed(3) + ')';
    }
  }
  return c;
}

/* ------------------------------------------------------- chargement lazy */

let promesseVendor = null;

/**
 * Charge la bibliotheque vendoree A LA DEMANDE (jamais dans le bundle
 * initial, jamais depuis un CDN). Memoise : un seul <script> pour toute
 * la page, quelle que soit le nombre de graphiques.
 * @param {string} [url] chemin alternatif (banc d'essai)
 * @returns {Promise<object>} l'objet global LightweightCharts
 */
export function chargerMoteur(url) {
  if (typeof window === 'undefined') return Promise.reject(new Error('pas de navigateur'));
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (promesseVendor) return promesseVendor;

  const src = url || URL_VENDOR;
  promesseVendor = new Promise((ok, ko) => {
    const dejaLa = document.querySelector('script[data-moteur="lightweight-charts"]');
    const s = dejaLa || document.createElement('script');
    const fini = () => {
      if (window.LightweightCharts) ok(window.LightweightCharts);
      else ko(new Error('bibliotheque de graphique chargee mais absente'));
    };
    s.addEventListener('load', fini, { once: true });
    s.addEventListener('error', () => ko(new Error('bibliotheque de graphique introuvable')), { once: true });
    if (!dejaLa) {
      s.src = src;
      s.async = true;
      s.dataset.moteur = 'lightweight-charts';
      document.head.appendChild(s);
    }
  });
  /* un echec ne doit pas condamner la page pour toujours */
  promesseVendor.catch(() => { promesseVendor = null; });
  return promesseVendor;
}

/* ------------------------------------------------------------- le moteur */

/**
 * Cree l'adaptateur graphique dans `hote` (typiquement ui.zoneGraphique).
 *
 * @param {HTMLElement} hote
 * @param {object} [opts]
 * @param {'nuit'|'jour'} [opts.ambiance]
 * @param {boolean} [opts.reduced]      mouvement reduit : aucune inertie
 * @param {(b:object|null)=>void} [opts.onCurseur]  bandeau de lecture O/H/B/C
 * @param {string} [opts.vendor]        chemin alternatif de la bibliotheque
 * @returns {Promise<{setSerie:Function,setAmbiance:Function,destroy:Function}>}
 */
export async function createCoursChart(hote, opts) {
  const o = opts || {};
  if (!hote) throw new Error('createCoursChart : hote manquant');

  const reduced = !!o.reduced ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const onCurseur = typeof o.onCurseur === 'function' ? o.onCurseur : null;

  const LWC = await chargerMoteur(o.vendor);

  /* Enums de la bibliotheque, avec repli numerique. */
  const ModeCroisillon = (LWC.CrosshairMode && LWC.CrosshairMode.Normal !== undefined)
    ? LWC.CrosshairMode.Normal : MODE_CROISILLON_LIBRE;
  const Pointille = (LWC.LineStyle && LWC.LineStyle.Dotted !== undefined) ? LWC.LineStyle.Dotted : TRAIT_POINTILLE;
  const TiretsLarges = (LWC.LineStyle && LWC.LineStyle.LargeDashed !== undefined) ? LWC.LineStyle.LargeDashed : TRAIT_TIRETS_LARGES;
  const TypeCouleur = (LWC.ColorType && LWC.ColorType.Solid) ? LWC.ColorType.Solid : 'solid';
  const TypeGraduation = LWC.TickMarkType || { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };

  /* --- conteneur propre : tout ce que l'on cree part avec destroy() --- */
  const cadre = document.createElement('div');
  cadre.className = 'cxg';
  cadre.setAttribute('aria-hidden', 'true');   /* les chiffres lisibles sont dans le DOM de l'interface */
  hote.appendChild(cadre);

  /* La grille decorative en CSS ferait doublon avec celle du moteur :
     l'interface a prevu l'interrupteur, on s'en sert. */
  const section = hote.closest ? hote.closest('.cx') : null;
  const grilleAvant = section ? section.getAttribute('data-grille') : null;
  if (section) section.setAttribute('data-grille', 'off');

  /* ---------------------------------------------------------- le theme */
  const source = section || hote;
  function jeton(nom, repli) {
    try {
      const v = getComputedStyle(source).getPropertyValue(nom).trim();
      return v || repli;
    } catch (e) { return repli; }
  }
  function police() {
    let f = jeton('--body', '');
    if (!f) { try { f = getComputedStyle(source).fontFamily; } catch (e) { f = ''; } }
    return f || 'Jost, system-ui, sans-serif';
  }

  function palette() {
    const up = jeton('--cx-up', '#8fae86');
    const down = jeton('--cx-down', '#bf7f6f');
    const trait = jeton('--cx-line', 'rgba(201,154,63,.22)');
    const grille = jeton('--cx-grille', 'rgba(243,236,220,.055)');
    /* Libelles d'axes : ce sont des CHIFFRES a lire, a 10-11 px, dans un
       canevas ou aucun reglage systeme ne viendra les aider. --text-3
       tombait a 3,65:1 en ambiance jour ; --text-2 les remonte au-dessus
       du seuil AA sans sortir de la charte. */
    const texte = jeton('--text-2', 'rgba(243,236,220,.74)');
    const or = jeton('--gold-ink', '#c99a3f');
    return { up, down, trait, grille, texte, or, police: police() };
  }

  /* Sur mobile l'echelle de droite mange une part importante de la
     largeur : un point de moins suffit a rendre la place au trace. */
  const mqEtroit = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  const tailleTexte = () => (mqEtroit && mqEtroit.matches ? 10 : 11);

  function optionsTheme(p) {
    return {
      layout: {
        background: { type: TypeCouleur, color: 'rgba(0,0,0,0)' },   /* le cadre de l'interface reste visible */
        textColor: p.texte,
        fontFamily: p.police,
        fontSize: tailleTexte(),
        attributionLogo: false
      },
      grid: {
        horzLines: { color: p.grille, style: Pointille, visible: true },
        vertLines: { color: avecAlpha(p.grille, 0.62), style: Pointille, visible: true }
      },
      crosshair: {
        mode: ModeCroisillon,
        vertLine: { color: avecAlpha(p.or, 0.55), width: 1, style: TiretsLarges, labelBackgroundColor: p.or },
        horzLine: { color: avecAlpha(p.or, 0.55), width: 1, style: TiretsLarges, labelBackgroundColor: p.or }
      },
      rightPriceScale: { borderColor: p.trait, borderVisible: true },
      timeScale: { borderColor: p.trait, borderVisible: true }
    };
  }

  function optionsBougies(p) {
    /* Teintes raffinees, jamais fluo : corps translucide, contour et
       meche pleins. La hausse est plus legere que la baisse — le regard
       s'arrete sur ce qui recule. */
    return {
      upColor: avecAlpha(p.up, 0.50),
      downColor: avecAlpha(p.down, 0.62),
      borderUpColor: p.up,
      borderDownColor: p.down,
      wickUpColor: avecAlpha(p.up, 0.9),
      wickDownColor: avecAlpha(p.down, 0.9),
      borderVisible: true,
      wickVisible: true
    };
  }

  /* --------------------------------------------------- format des axes */
  let deviseCourante = null;
  let precision = 2;

  function formatPrix(v) {
    const n = nombre(v);
    if (n === null) return '';
    return fr(n, precision);
  }
  function dateLocale(t) { return new Date(t * 1000); }

  /** Graduation de l'axe du temps, en francais, heure locale du visiteur.
   *  (Les seaux sont horodates en UTC par le serveur ; l'interface, elle,
   *  parle au visiteur — le bandeau de lecture affiche la meme heure.) */
  function graduation(temps, type) {
    const t = tempsDe(temps);
    if (t === null) return '';
    const d = dateLocale(t);
    if (type === TypeGraduation.Year) return String(d.getFullYear());
    /* « août » seul : « août 26 » se lirait « 26 août » en francais.
       L'annee est portee par la graduation de type Annee (janvier). */
    if (type === TypeGraduation.Month) return MOIS_COURT[d.getMonth()];
    if (type === TypeGraduation.DayOfMonth) return d.getDate() + ' ' + MOIS_COURT[d.getMonth()];
    if (type === TypeGraduation.TimeWithSeconds) {
      return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()) + ':' + deuxChiffres(d.getSeconds());
    }
    return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes());
  }
  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }

  /** Etiquette du croisillon sur l'axe du temps : date ET heure. */
  function formatHorodatage(temps) {
    const t = tempsDe(temps);
    if (t === null) return '';
    const d = dateLocale(t);
    const jour = d.getDate() + ' ' + MOIS_COURT[d.getMonth()];
    const heure = deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes());
    return heure === '00:00' ? jour : jour + ' ' + heure;
  }

  /* ------------------------------------------------------- le graphique */
  let p = palette();

  const graphique = LWC.createChart(cadre, fusion({
    autoSize: true,
    localization: { locale: 'fr-FR', priceFormatter: formatPrix, timeFormatter: formatHorodatage },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false          /* le doigt vertical fait defiler la PAGE, pas le graphique */
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: false },
      axisDoubleClickReset: { time: true, price: true }
    },
    kineticScroll: { touch: !reduced, mouse: false },
    rightPriceScale: {
      visible: true,
      entireTextOnly: true,
      ticksVisible: false,
      scaleMargins: { top: 0.14, bottom: 0.12 }
    },
    leftPriceScale: { visible: false },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 2,
      minBarSpacing: 0.4,
      lockVisibleTimeRangeOnResize: true,
      ticksVisible: false,
      tickMarkFormatter: graduation
    }
  }, optionsTheme(p)));

  const serie = graphique.addCandlestickSeries(fusion({
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: 'custom', formatter: formatPrix, minMove: 0.01 }
  }, optionsBougies(p)));

  /* ------------------------------------------- croisillon -> interface */
  let trameCurseur = 0;
  let dernierCurseur = 'vide';

  function surCroisillon(param) {
    if (!onCurseur) return;
    let b = null;
    if (param && param.point && param.time !== undefined && param.seriesData) {
      const d = param.seriesData.get(serie);
      if (d) {
        const ouv = prix(d.open), haut = prix(d.high), bas = prix(d.low), clo = prix(d.close);
        /* On ne remonte une bougie que si les QUATRE prix existent. */
        if (ouv !== null && haut !== null && bas !== null && clo !== null) {
          b = { time: param.time, open: ouv, high: haut, low: bas, close: clo };
        }
      }
    }
    const signature = b ? b.time + '|' + b.close : 'vide';
    if (signature === dernierCurseur) return;
    dernierCurseur = signature;
    if (trameCurseur) cancelAnimationFrame(trameCurseur);
    trameCurseur = requestAnimationFrame(() => { trameCurseur = 0; try { onCurseur(b); } catch (e) {} });
  }
  graphique.subscribeCrosshairMove(surCroisillon);

  /* Passage bureau <-> mobile (rotation, redimensionnement) */
  function surLargeur() {
    if (detruit) return;
    try { graphique.applyOptions({ layout: { fontSize: tailleTexte() } }); } catch (e) {}
  }
  if (mqEtroit) {
    if (mqEtroit.addEventListener) mqEtroit.addEventListener('change', surLargeur);
    else if (mqEtroit.addListener) mqEtroit.addListener(surLargeur);
  }

  /* La SOURIS quitte la zone : on efface le bandeau.
     Au doigt on ne l'efface pas : sur mobile on tape pour lire une
     bougie, et la lecture doit rester affichee apres avoir leve le
     doigt (la bibliotheque garde son croisillon jusqu'a la tape
     suivante ; le bandeau doit suivre la meme regle). */
  function surSortie(ev) {
    if (ev && ev.pointerType && ev.pointerType !== 'mouse') return;
    if (onCurseur) { dernierCurseur = 'vide'; try { onCurseur(null); } catch (e) {} }
  }
  cadre.addEventListener('pointerleave', surSortie);

  /* ------------------------------------------------------- etat interne */
  let detruit = false;
  let nbBougies = 0;
  let dernierRejets = { horodatage: 0, prixManquant: 0, doublon: 0 };

  /**
   * Affiche EXACTEMENT les bougies recues. Aucune n'est creee, aucune
   * n'est reparee : une bougie douteuse est ecartee et comptee.
   * @param {Array} bougies  [{time,open,high,low,close}]
   * @param {object} [meta]  {devise, symbole, tf, bougie, vide}
   */
  function setSerie(bougies, meta) {
    if (detruit) return;
    const m = meta || {};
    const liste = Array.isArray(bougies) ? bougies : [];
    const donnees = [];
    const rejets = { horodatage: 0, prixManquant: 0, doublon: 0 };
    let dernierTemps = -Infinity;
    let mini = Infinity, maxi = -Infinity;

    for (let i = 0; i < liste.length; i++) {
      const b = liste[i];
      if (!b || typeof b !== 'object') { rejets.prixManquant++; continue; }
      const t = tempsDe(b.time);
      if (t === null) { rejets.horodatage++; continue; }
      const ouv = prix(b.open), haut = prix(b.high), bas = prix(b.low), clo = prix(b.close);
      if (ouv === null || haut === null || bas === null || clo === null) { rejets.prixManquant++; continue; }
      /* Lightweight Charts exige des temps strictement croissants. On
         ecarte le doublon, on n'en fabrique pas la fusion. */
      if (t <= dernierTemps) { rejets.doublon++; continue; }
      dernierTemps = t;
      donnees.push({ time: t, open: ouv, high: haut, low: bas, close: clo });
      if (bas < mini) mini = bas;
      if (haut > maxi) maxi = haut;
    }

    dernierRejets = rejets;
    nbBougies = donnees.length;
    deviseCourante = m.devise || null;

    /* Precision alignee sur l'ordre de grandeur reellement affiche. */
    if (donnees.length) {
      precision = decimales((mini + maxi) / 2);
      serie.applyOptions({ priceFormat: { type: 'custom', formatter: formatPrix, minMove: Math.pow(10, -precision) } });
    }

    try { serie.setData(donnees); }
    catch (e) {
      /* Une donnee refusee par la bibliotheque n'est pas « reparee » :
         on vide plutot que d'afficher un dessin faux. */
      try { serie.setData([]); } catch (e2) {}
      nbBougies = 0;
      return;
    }

    if (donnees.length) {
      /* Toute la periode demandee est visible d'emblee ; le visiteur
         zoome ensuite librement. */
      try { graphique.timeScale().fitContent(); } catch (e) {}
    }
    if (onCurseur) { dernierCurseur = 'vide'; try { onCurseur(null); } catch (e) {} }
  }

  /** Jour / Nuit a chaud : on relit les tokens, on ne recree rien. */
  function setAmbiance(mode) {
    if (detruit) return;
    void mode;                                  /* la verite est dans les tokens CSS */
    p = palette();
    try {
      graphique.applyOptions(optionsTheme(p));
      serie.applyOptions(optionsBougies(p));
    } catch (e) {}
  }

  function destroy() {
    if (detruit) return;
    detruit = true;
    if (trameCurseur) cancelAnimationFrame(trameCurseur);
    cadre.removeEventListener('pointerleave', surSortie);
    if (mqEtroit) {
      if (mqEtroit.removeEventListener) mqEtroit.removeEventListener('change', surLargeur);
      else if (mqEtroit.removeListener) mqEtroit.removeListener(surLargeur);
    }
    try { graphique.unsubscribeCrosshairMove(surCroisillon); } catch (e) {}
    try { graphique.remove(); } catch (e) {}
    if (section) {
      if (grilleAvant === null) section.removeAttribute('data-grille');
      else section.setAttribute('data-grille', grilleAvant);
    }
    if (cadre.parentNode) cadre.parentNode.removeChild(cadre);
  }

  /* ambiance initiale : les tokens sont deja poses par l'interface */
  setAmbiance(o.ambiance);

  return {
    setSerie,
    setAmbiance,
    destroy,
    /* --- diagnostics, utiles au banc d'essai et a l'integrateur --- */
    get bougies() { return nbBougies; },
    get rejets() { return Object.assign({}, dernierRejets); },
    get devise() { return deviseCourante; },
    get chart() { return graphique; },
    get series() { return serie; },
    ajuster() { try { graphique.timeScale().fitContent(); } catch (e) {} }
  };
}

export default createCoursChart;
