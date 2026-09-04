/* =====================================================================
   La Compagnie de l'Or — Section « Cours des metaux » : INTERFACE (lot coursui)
   ---------------------------------------------------------------------
   Ce module ne parle JAMAIS a Gold-API : il ne fait qu'afficher ce qu'on lui
   donne. Aucune valeur n'est calculee, devinee, interpolee ni remplacee par 0.
   Une donnee absente est affichee « — » avec sa raison.

   API :
     const ui = createCours(host, { reduced });
     ui.mount();                       // construit le DOM (idempotent) -> racine
     ui.onIntent(fn);                  // fn({type,...}) -> fonction de desabonnement
     ui.setCapacites(cap);             // pilote la barre de periodes (boutons reels seulement)
     ui.setPrix(payload);              // /api/metaux/prix
     ui.setSerie(payload);             // /api/metaux/serie  (transmis au moteur graphique)
     ui.setStats(payload);             // /api/metaux/ohlc
     ui.setEtat(nom, detail);          // 'chargement'|'pret'|'indisponible'|'perime'|'sans-cle'
     ui.setAmbiance('nuit'|'jour');
     ui.destroy();
   Complements (utiles a l'integrateur / au lot « moteur graphique ») :
     ui.zoneGraphique                  // element ou le moteur se monte
     ui.brancherGraphique(adaptateur)  // {setSerie(bougies,meta), setAmbiance(m), destroy()}
     ui.setCurseur(bougie|null)        // bandeau de lecture O/H/L/C sous le crosshair
     ui.etat / ui.symbole / ui.tf      // lecture seule

   Intentions emises (jamais de fetch ici) :
     {type:'pret'}                         apres mount()
     {type:'metal',   symbole, clavier?}   l'utilisateur a choisi un metal
     {type:'periode', tf, auto?}           l'utilisateur (ou les capacites) a choisi une periode
     {type:'reessayer', symbole, tf}       clic sur « Reessayer »
   ===================================================================== */

const NBSP = ' ';
const FINE = ' ';                                     // espace fine insecable (chiffres / symbole)

/* Libelles francais des metaux du lot. Le nom renvoye par l'API est en anglais :
   on n'affiche pas une donnee de marche ici, seulement une etiquette. */
const METAUX = [
  { symbole: 'XAU', nom: 'Or' },
  { symbole: 'XAG', nom: 'Argent' },
  { symbole: 'XPT', nom: 'Platine' },
  { symbole: 'XPD', nom: 'Palladium' }
];
const NOM_PAR_SYMBOLE = METAUX.reduce((o, m) => (o[m.symbole] = m.nom, o), {});

/* Catalogue des periodes : ordre d'affichage + libelles. La LISTE REELLE vient
   toujours du serveur (setCapacites) ; ce catalogue ne fait que nommer. */
const TF_CATALOGUE = {
  '5min': { court: '5 min',  long: 'Cinq minutes',  bougie: '5 min' },
  '15min':{ court: '15 min', long: 'Quinze minutes', bougie: '15 min' },
  '1h':   { court: '1 h',    long: 'Une heure',     bougie: '1 h' },
  '1J':  { court: '1 J',  long: 'Un jour',      bougie: '5 min' },
  '1S':  { court: '1 S',  long: 'Une semaine',  bougie: '1 h' },
  '1M':  { court: '1 M',  long: 'Un mois',      bougie: '1 jour' },
  '3M':  { court: '3 M',  long: 'Trois mois',   bougie: '1 jour' },
  '1A':  { court: '1 A',  long: 'Un an',        bougie: '1 semaine' },
  'MAX': { court: 'Max',  long: 'Historique complet', bougie: '1 mois' }
};
/* Ordre de lecture : de la bougie la plus fine a la plus large. Les trois
   periodes intrajournalieres en font partie : sans elles, elles se
   retrouvaient apres MAX dans le DOM (Home/End et lecteurs d'ecran
   suivaient cet ordre-la, seul l'ecran etait remis d'aplomb par la CSS). */
const TF_ORDRE = ['5min', '15min', '1h', '1J', '1S', '1M', '3M', '1A', 'MAX'];

const GRANULARITE = { minute: '1 min', hour: '1 h', day: '1 jour', week: '1 semaine', month: '1 mois', year: '1 an' };
/* Le proxy renvoie la taille de bougie soit deja lisible (« 5 min », « 4 h »),
   soit sous forme de type (« jour », « semaine », « mois »). On traduit ici
   pour que cours.js reste juste meme sans cours-init. */
const BOUGIE_LIB = { jour: '1 jour', semaine: '1 semaine', mois: '1 mois', annee: '1 an' };
function libBougie(b) {
  if (b === null || b === undefined || b === '') return null;
  const s = String(b);
  return BOUGIE_LIB[s] || s;
}
const SYMBOLE_DEVISE = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥' };

/* Raisons affichees quand une valeur n'est pas disponible : on nomme le manque,
   on ne le comble jamais. */
const RAISONS_FR = {
  timeout:     "La source n’a pas répondu dans le délai imparti.",
  api:         "La source de données a renvoyé une erreur.",
  reseau:      "La connexion à la source a échoué.",
  'sans-cle':  "Nécessite la clé serveur.",
  vide:        "Aucune bougie réelle n’est constructible sur cette période.",
  aucune:      "Donnée non fournie par la source.",
  invalide:    "Valeur reçue inexploitable."
};
const MESSAGES = {
  chargement:   { t: 'Lecture du marché…',           p: 'Connexion à la source de données.' },
  indisponible: { t: 'Données momentanément indisponibles', p: '' },
  'sans-cle':   { t: 'Historique non disponible',   p: "Le graphique et les statistiques de période demandent la clé de la source, qui vit uniquement sur le serveur. Les prix ci-dessus, eux, proviennent de l’accès public et restent à jour." },
  vide:         { t: 'Aucune bougie réelle sur cette période', p: "Rien n’est fabriqué pour combler : la période reste vide tant que la source ne fournit pas assez de points." },
  moteur:       { t: 'Graphique non chargé',   p: "Le moteur de rendu n’est pas présent sur cette page." }
};
const MENTION_24K = 'Valeur indicative du métal pur. Ne constitue pas une offre de rachat.';

/* --------------------------------------------------------------- outils */
function el(tag, attrs, parent) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}
/* Convertit en nombre SANS jamais transformer une absence en 0. */
function nombre(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
/* Un prix nul ou negatif n'est pas un prix : on le traite comme une valeur
   refusee (c'est exactement la forme que prendrait un remplissage par 0). */
function prixValide(v) { const n = nombre(v); return n !== null && n > 0 ? n : null; }

function nf(n, d) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function decimales(v) { const a = Math.abs(v); return a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : 4; }
function fmtPrix(v, devise) {
  const n = prixValide(v); if (n === null) return null;
  const s = SYMBOLE_DEVISE[devise] || devise || '';
  return nf(n, decimales(n)) + (s ? FINE + s : '');
}
function fmtPct(v) {
  const n = nombre(v); if (n === null) return null;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), 2) + FINE + '%';
}
function dateDe(t) {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function ilYA(ms) {
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 12) return "à l’instant";
  if (s < 90) return 'il y a ' + s + NBSP + 's';
  const m = Math.round(s / 60);
  if (m < 90) return 'il y a ' + m + NBSP + 'min';
  const h = Math.round(m / 60);
  if (h < 36) return 'il y a ' + h + NBSP + 'h';
  return 'il y a ' + Math.round(h / 24) + NBSP + 'j';
}
function dateCourte(d) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function litVariation(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return { pct: nombre(v), abs: null, depuis: null };
  const pct = nombre(v.pct !== undefined ? v.pct : v.pourcent !== undefined ? v.pourcent : v.percent !== undefined ? v.percent : v.changePercent);
  const abs = nombre(v.abs !== undefined ? v.abs : v.valeur !== undefined ? v.valeur : v.change);
  const depuis = v.depuis || v.base || v.periode || v.since || null;
  if (pct === null && abs === null) return null;
  return { pct, abs, depuis };
}

/* ===================================================================== */
export function createCours(host, opts) {
  const options = opts || {};
  const reduced = !!options.reduced ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const st = {
    monte: false,
    etat: 'chargement',          // etat global demande par l'integrateur
    occupe: false,               // une requete est en vol : legere baisse d'opacite
    cle: null,                   // null = inconnu, false = pas de cle serveur
    symbole: 'XAU',
    tf: null,
    tfListe: [],
    capacitesRecues: false,      // false = le serveur n'a pas encore parle
    prix: null,                  // dernier payload /prix accepte
    parMetal: new Map(),         // symbole -> {prix,devise,majAt,variation,nom}
    or24k: null,
    devise: 'EUR',
    serie: null,
    stats: null,
    perime: false,
    raison: null,
    majDate: null,
    ambiance: (document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit'),
    adaptateur: null,
    curseur: null
  };

  const ecouteurs = [];
  const noeuds = {};
  let racine = null, minuteur = 0, tClavier = 0, dernierAnnonce = '';

  /* ---------------------------------------------------------- intentions */
  function emettre(intent) {
    for (const fn of ecouteurs.slice()) { try { fn(intent); } catch (e) { /* un ecouteur casse ne casse pas l'UI */ } }
  }
  function onIntent(fn) {
    if (typeof fn !== 'function') return () => {};
    ecouteurs.push(fn);
    return () => { const i = ecouteurs.indexOf(fn); if (i >= 0) ecouteurs.splice(i, 1); };
  }

  /* --------------------------------------------------------------- DOM */
  function construire() {
    racine = el('div', { class: 'cx', 'data-etat': 'chargement', 'data-ambiance': st.ambiance });
    if (reduced) racine.setAttribute('data-reduced', '1');

    /* indicateur de rafraichissement (2 px, transform uniquement) */
    noeuds.indicateur = el('div', { class: 'cx-indic', 'aria-hidden': 'true' }, racine);
    el('i', {}, noeuds.indicateur);

    /* 1 — selecteur de metal ------------------------------------------- */
    const barre = el('div', { class: 'cx-metaux__wrap' }, racine);
    noeuds.metaux = el('div', { class: 'cx-metaux', role: 'tablist', 'aria-label': 'Choix du métal' }, barre);
    noeuds.onglets = METAUX.map((m, i) => {
      const b = el('button', {
        class: 'cx-metal', type: 'button', role: 'tab',
        id: 'cx-onglet-' + m.symbole, 'aria-controls': 'cx-panneau',
        'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1',
        'data-symbole': m.symbole
      }, noeuds.metaux);
      el('span', { class: 'cx-metal__nom', text: m.nom }, b);
      el('span', { class: 'cx-metal__sym', text: m.symbole }, b);
      el('span', { class: 'cx-metal__prix', text: '—' }, b);
      el('i', { class: 'cx-metal__trait', 'aria-hidden': 'true' }, b);
      return b;
    });

    /* 2 — panneau ------------------------------------------------------- */
    const panneau = el('div', {
      class: 'cx-panneau', id: 'cx-panneau', role: 'tabpanel', 'aria-labelledby': 'cx-onglet-XAU'
    }, racine);
    noeuds.panneau = panneau;

    /* bandeau de prix + or 24K */
    const tete = el('div', { class: 'cx-tete' }, panneau);
    const prix = el('div', { class: 'cx-prix' }, tete);
    const ident = el('p', { class: 'cx-prix__id' }, prix);
    noeuds.prixNom = el('span', { class: 'cx-prix__nom', text: 'Or' }, ident);
    noeuds.prixSym = el('span', { class: 'cx-prix__sym', text: 'XAU' }, ident);
    const ligne = el('p', { class: 'cx-prix__ligne' }, prix);
    noeuds.prixVal = el('span', { class: 'cx-prix__val', text: '—' }, ligne);
    noeuds.prixUnite = el('span', { class: 'cx-prix__unite', text: "l’once" }, ligne);
    noeuds.prixVar = el('span', { class: 'cx-prix__var', hidden: 'hidden' }, ligne);
    const bas = el('p', { class: 'cx-prix__bas' }, prix);
    noeuds.prixPastille = el('i', { class: 'cx-pastille', 'aria-hidden': 'true' }, bas);
    noeuds.prixMaj = el('span', { class: 'cx-prix__maj', text: 'En attente de la première lecture' }, bas);
    noeuds.prixAlerte = el('span', { class: 'cx-prix__alerte', hidden: 'hidden' }, bas);
    noeuds.prixRaison = el('span', { class: 'cx-prix__raison' }, bas);

    const or = el('aside', { class: 'cx-24k' }, tete);
    /* data-court : le libelle abrege que le telephone affiche a la place du
       long, via ::after (voir cours.css, bloc mobile). Le texte complet reste
       dans le document — un lecteur d ecran continue donc de l entendre en
       entier, seul l affichage se resserre. */
    el('p', { class: 'cx-24k__titre', 'data-court': 'Or 24K · au gramme', text: 'Or 24 carats · au gramme' }, or);
    const l24 = el('p', { class: 'cx-24k__ligne' }, or);
    noeuds.or24 = el('span', { class: 'cx-24k__val', text: '—' }, l24);
    el('span', { class: 'cx-24k__unite', text: '/ g' }, l24);
    noeuds.or24Raison = el('p', { class: 'cx-24k__raison' }, or);
    el('p', { class: 'cx-24k__mention', text: MENTION_24K }, or);

    /* Clé de lecture des devises (§ lisibilité) : deux repères, aucun calcul.
       Le texte est posé par rendreCleDevises() à partir de l'état réel. */
    noeuds.cle = el('p', { class: 'cx-cle' }, tete);
    noeuds.cleVif = el('span', { class: 'cx-cle__item cx-cle__item--vif' }, noeuds.cle);
    noeuds.cleHist = el('span', { class: 'cx-cle__item cx-cle__item--hist' }, noeuds.cle);

    /* 3 — graphique ----------------------------------------------------- */
    const graph = el('section', { class: 'cx-graph', 'aria-label': 'Graphique du cours' }, panneau);
    const gtete = el('div', { class: 'cx-graph__tete' }, graph);
    noeuds.periodes = el('div', { class: 'cx-periodes', role: 'radiogroup', 'aria-label': 'Période affichée' }, gtete);
    noeuds.legende = el('p', { class: 'cx-legende' }, gtete);

    noeuds.chart = el('div', { class: 'cx-chart' }, graph);
    el('div', { class: 'cx-chart__grille', 'aria-hidden': 'true' }, noeuds.chart);
    noeuds.slot = el('div', { class: 'cx-chart__slot', 'data-role': 'graphique' }, noeuds.chart);
    noeuds.lecture = el('div', { class: 'cx-lecture', hidden: 'hidden' }, noeuds.chart);
    noeuds.voile = el('div', { class: 'cx-voile' }, noeuds.chart);
    const boite = el('div', { class: 'cx-voile__boite' }, noeuds.voile);
    noeuds.voileTitre = el('p', { class: 'cx-voile__titre' }, boite);
    noeuds.voileTxt = el('p', { class: 'cx-voile__txt' }, boite);
    noeuds.retry = el('button', { class: 'cx-btn', type: 'button', text: 'Réessayer', hidden: 'hidden' }, boite);

    /* 4 — statistiques -------------------------------------------------- */
    /* Les quatre chiffres de période viennent de l'historique : leur devise
       peut différer de celle des prix vifs. Un intitulé de groupe le dit une
       fois, au lieu de le répéter sur chaque tuile. */
    noeuds.statsTitre = el('p', { class: 'cx-stats__titre', hidden: 'hidden' }, panneau);
    noeuds.stats = el('dl', { class: 'cx-stats' }, panneau);
    const TUILES = [
      ['actuel',    'Cours actuel'],
      ['ouverture', 'Ouverture'],
      ['haut',      'Plus haut'],
      ['bas',       'Plus bas'],
      ['cloture',   'Dernier · clôture'],
      ['variation', 'Variation'],
      ['maj',       'Dernière mise à jour']
    ];
    noeuds.tuiles = {};
    for (const [cle, libelle] of TUILES) {
      const groupe = (cle === 'actuel' || cle === 'maj') ? 'vif' : 'periode';
      const t = el('div', { class: 'cx-stat', 'data-cle': cle, 'data-groupe': groupe, 'data-absent': '1' }, noeuds.stats);
      el('dt', { class: 'cx-stat__l', text: libelle }, t);
      const d = el('dd', { class: 'cx-stat__d' }, t);
      const v = el('span', { class: 'cx-stat__v', text: '—' }, d);
      const p = el('span', { class: 'cx-stat__p' }, d);
      noeuds.tuiles[cle] = { boite: t, val: v, pq: p };
    }

    /* 5 — note + region vocale ------------------------------------------ */
    noeuds.note = el('p', { class: 'cx-note' }, panneau);
    noeuds.live = el('p', { class: 'cx-sr', role: 'status', 'aria-live': 'polite' }, racine);

    /* evenements */
    noeuds.metaux.addEventListener('click', surClicMetal);
    noeuds.metaux.addEventListener('keydown', surClavierMetal);
    noeuds.periodes.addEventListener('click', surClicPeriode);
    noeuds.periodes.addEventListener('keydown', surClavierPeriode);
    noeuds.retry.addEventListener('click', () => emettre({ type: 'reessayer', symbole: st.symbole, tf: st.tf }));
    document.addEventListener('visibilitychange', surVisibilite);

    host.appendChild(racine);
    return racine;
  }

  /* -------------------------------------------------------- interactions */
  function surClicMetal(ev) {
    const b = ev.target.closest('.cx-metal'); if (!b || !noeuds.metaux.contains(b)) return;
    choisirMetal(b.dataset.symbole, { emettre: true, retard: false });
  }
  function surClavierMetal(ev) {
    const idx = noeuds.onglets.findIndex(b => b === document.activeElement);
    if (idx < 0) return;
    let n = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') n = (idx + 1) % noeuds.onglets.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') n = (idx - 1 + noeuds.onglets.length) % noeuds.onglets.length;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = noeuds.onglets.length - 1;
    else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault(); choisirMetal(noeuds.onglets[idx].dataset.symbole, { emettre: true, retard: false }); return;
    } else return;
    ev.preventDefault();
    const b = noeuds.onglets[n]; b.focus();
    choisirMetal(b.dataset.symbole, { emettre: true, retard: true, clavier: true });
  }
  function surClicPeriode(ev) {
    const b = ev.target.closest('.cx-periode'); if (!b || !noeuds.periodes.contains(b)) return;
    choisirPeriode(b.dataset.tf, { emettre: true, retard: false });
  }
  function surClavierPeriode(ev) {
    const bs = Array.from(noeuds.periodes.querySelectorAll('.cx-periode'));
    const idx = bs.findIndex(b => b === document.activeElement);
    if (idx < 0 || !bs.length) return;
    let n = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') n = (idx + 1) % bs.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') n = (idx - 1 + bs.length) % bs.length;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = bs.length - 1;
    else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault(); choisirPeriode(bs[idx].dataset.tf, { emettre: true, retard: false }); return;
    } else return;
    ev.preventDefault();
    bs[n].focus();
    choisirPeriode(bs[n].dataset.tf, { emettre: true, retard: true, clavier: true });
  }
  function surVisibilite() { if (document.hidden) arreterMinuteur(); else demarrerMinuteur(); }

  /* Regle de probite : des qu'une serie cesse d'etre valable (autre metal, autre
     periode, panne, absence de cle), le moteur est VIDE. Jamais de bougies d'hier
     ou d'un autre metal qui trainent sous une etiquette qui ne leur correspond plus. */
  function viderMoteur() {
    if (st.adaptateur && typeof st.adaptateur.setSerie === 'function') {
      try { st.adaptateur.setSerie([], { vide: true, symbole: st.symbole, tf: st.tf }); } catch (e) {}
    }
  }

  function choisirMetal(symbole, o) {
    o = o || {};
    if (!symbole || !NOM_PAR_SYMBOLE[symbole]) return;
    const change = symbole !== st.symbole;
    st.symbole = symbole;
    noeuds.onglets.forEach(b => {
      const on = b.dataset.symbole === symbole;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    noeuds.panneau.setAttribute('aria-labelledby', 'cx-onglet-' + symbole);
    if (change) { st.serie = null; st.stats = null; st.curseur = null; viderMoteur(); api.setCurseur(null); }
    rendrePrix(); rendreStats(); rendreLegende(); rendreEtat();
    if (o.emettre && change) planifier(() => emettre({ type: 'metal', symbole, clavier: !!o.clavier }), o.retard);
  }
  function choisirPeriode(tf, o) {
    o = o || {};
    if (!tf) return;
    const change = tf !== st.tf;
    st.tf = tf;
    Array.from(noeuds.periodes.querySelectorAll('.cx-periode')).forEach(b => {
      const on = b.dataset.tf === tf;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    if (change) { st.serie = null; st.stats = null; st.curseur = null; viderMoteur(); api.setCurseur(null); }
    rendreStats(); rendreLegende(); rendreEtat();
    if (o.emettre && change) planifier(() => emettre({ type: 'periode', tf, auto: !!o.auto, clavier: !!o.clavier }), o.retard);
  }
  /* Au clavier on laisse la fleche courir : l'intention part quand le choix
     s'est stabilise (260 ms), pour ne pas declencher quatre requetes. */
  function planifier(fn, retard) {
    clearTimeout(tClavier);
    if (!retard) { fn(); return; }
    tClavier = setTimeout(fn, 260);
  }

  /* ------------------------------------------------------------- rendus */
  function rendreMetaux() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    noeuds.onglets.forEach(b => {
      const d = st.parMetal.get(b.dataset.symbole);
      const p = d ? fmtPrix(d.prix, d.devise || st.devise) : null;
      b.querySelector('.cx-metal__prix').textContent = p || '—';
      b.toggleAttribute('data-absent', !p);
    });
  }

  function rendrePrix() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const d = st.parMetal.get(st.symbole);
    noeuds.prixNom.textContent = NOM_PAR_SYMBOLE[st.symbole] || (d && d.nom) || st.symbole;
    noeuds.prixSym.textContent = st.symbole;

    const p = d ? fmtPrix(d.prix, d.devise || st.devise) : null;
    noeuds.prixVal.textContent = p || '—';
    noeuds.prixVal.toggleAttribute('data-absent', !p);
    noeuds.prixUnite.hidden = !p;
    if (d && d.unite) noeuds.prixUnite.textContent = d.unite;

    /* variation : uniquement si la source en fournit une vraie */
    const v = d ? litVariation(d.variation) : null;
    if (v && (v.pct !== null || v.abs !== null)) {
      const bouts = [];
      if (v.abs !== null) bouts.push((v.abs > 0 ? '+' : v.abs < 0 ? '−' : '') + nf(Math.abs(v.abs), decimales(v.abs)) + FINE + (SYMBOLE_DEVISE[d.devise || st.devise] || ''));
      if (v.pct !== null) bouts.push(fmtPct(v.pct));
      noeuds.prixVar.textContent = bouts.join(NBSP + '·' + NBSP) + (v.depuis ? NBSP + '·' + NBSP + v.depuis : '');
      noeuds.prixVar.hidden = false;
      const s = v.pct !== null ? v.pct : v.abs;
      noeuds.prixVar.setAttribute('data-sens', s > 0 ? 'hausse' : s < 0 ? 'baisse' : 'plat');
    } else {
      noeuds.prixVar.hidden = true;
      noeuds.prixVar.textContent = '';
      noeuds.prixVar.removeAttribute('data-sens');
    }

    /* --- fraicheur ---------------------------------------------------
       Deux choses differentes, longtemps confondues :
         · la donnee est VIEILLE (age > seuil) -> « Dernière donnée
           disponible · il y a N min », le libelle du contrat ;
         · la SOURCE ne repond plus alors que la lecture est recente ->
           dire que la source est muette, sans pretendre que le chiffre
           date : « à l'instant » sous un titre de peremption est un
           message contradictoire.
       Dans les deux cas, la pastille seule etait trop faible : un
       marqueur lisible accompagne desormais l'etat. */
    const date = d ? dateDe(d.majAt) : null;
    st.majDate = date;
    const seuilPerime = nombre(options.seuilPerime) || 300;
    const ageSec = date ? (Date.now() - date.getTime()) / 1000 : null;
    const vraimentVieux = ageSec !== null && ageSec > seuilPerime;
    if (date) {
      const rel = ilYA(Date.now() - date.getTime());
      noeuds.prixMaj.textContent = (st.perime && vraimentVieux)
        ? 'Dernière donnée disponible · ' + rel
        : 'Mis à jour ' + rel;
      noeuds.prixMaj.title = date.toLocaleString('fr-FR');
    } else if (st.prix && st.prix.indisponible) {
      noeuds.prixMaj.textContent = 'Aucune lecture disponible';
      noeuds.prixMaj.removeAttribute('title');
    } else {
      noeuds.prixMaj.textContent = st.etat === 'chargement' ? 'Lecture en cours…' : 'En attente de la première lecture';
      noeuds.prixMaj.removeAttribute('title');
    }
    if (noeuds.prixAlerte) {
      const marque = !st.perime ? ''
        : vraimentVieux ? 'donnée périmée'
        : 'source injoignable';
      noeuds.prixAlerte.textContent = marque;
      noeuds.prixAlerte.hidden = !marque;
      noeuds.prixAlerte.title = marque
        ? (vraimentVieux
            ? 'La dernière lecture réelle date de plus de ' + Math.round(seuilPerime / 60) + ' min. Aucune valeur n’a été rafraîchie ni estimée.'
            : 'La source ne répond plus. Le chiffre affiché est la dernière lecture réelle, il n’a pas été recalculé.')
        : '';
    }
    racine.toggleAttribute('data-vieux', !!(st.perime && vraimentVieux));
    noeuds.prixRaison.textContent = (!p && st.raison) ? RAISONS_FR[st.raison] || '' : '';
    rendre24k();
  }

  /* Pourquoi un prix vif manque. Tant que la premiere lecture n'est pas
     revenue, la source n'a RIEN refuse : dire « Donnee non fournie par la
     source » serait deja une affirmation fausse. */
  function raisonAbsencePrix() {
    if (st.raison) return RAISONS_FR[st.raison] || RAISONS_FR.aucune;
    if (!st.prix) return st.etat === 'chargement' ? 'Lecture en cours…' : 'En attente de la première lecture.';
    return RAISONS_FR.aucune;
  }

  function rendre24k() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const g = st.or24k ? prixValide(st.or24k.prixGramme) : null;
    if (g !== null) {
      noeuds.or24.textContent = fmtPrix(g, st.or24k.devise || st.devise);
      noeuds.or24.removeAttribute('data-absent');
      noeuds.or24Raison.textContent = '';
    } else {
      noeuds.or24.textContent = '—';
      noeuds.or24.setAttribute('data-absent', '1');
      noeuds.or24Raison.textContent = raisonAbsencePrix();
    }
  }

  function rendrePeriodes() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const liste = st.tfListe;
    noeuds.periodes.textContent = '';
    /* Sans cle serveur, aucune periode n'est constructible : pas de bouton mort. */
    const montrer = liste.length > 0 && st.cle !== false;
    noeuds.periodes.hidden = !montrer;
    if (!montrer) { rendreNote(); return; }
    liste.forEach((tf, i) => {
      const cat = TF_CATALOGUE[tf.id] || {};
      const b = el('button', {
        class: 'cx-periode', type: 'button', role: 'radio',
        'aria-checked': tf.id === st.tf ? 'true' : 'false',
        tabindex: tf.id === st.tf ? '0' : '-1',
        'data-tf': tf.id,
        'aria-label': (tf.long || cat.long || tf.label || tf.id) + (tf.bougie || cat.bougie ? ', bougies de ' + (tf.bougie || cat.bougie) : '')
      }, noeuds.periodes);
      el('span', { text: tf.label || cat.court || tf.id }, b);
    });
    if (st.tf && !liste.some(t => t.id === st.tf)) {
      /* la periode courante n'existe plus : on retombe sur la premiere reelle */
      choisirPeriode(liste[0].id, { emettre: true, retard: false, auto: true });
    }
    rendreNote();
  }

  /* Ecart entre le resume de periode (/ohlc) et les bougies (/history) :
     ce sont DEUX lectures distinctes de la source. Un ecart franc n'est pas
     une erreur d'affichage, mais le visiteur le lira comme telle : on le
     nomme plutot que de le laisser passer pour une incoherence de notre
     part. Aucune valeur n'est corrigee. */
  const ECART_TOLERE = 0.02;
  function ecartStatsBougies() {
    const s = st.serie, st2 = st.stats;
    if (!s || s.indisponible || !Array.isArray(s.bougies) || !s.bougies.length) return null;
    if (!st2 || st2.indisponible) return null;
    /* devises differentes (ou inconnues) : les nombres ne sont pas comparables */
    if ((s.devise || null) !== (st2.devise || null)) return null;
    const haut = prixValide(st2.high), bas = prixValide(st2.low);
    if (haut === null && bas === null) return null;
    let hb = -Infinity, bb = Infinity;
    for (const b of s.bougies) {
      const h = prixValide(b.high), l = prixValide(b.low);
      if (h !== null && h > hb) hb = h;
      if (l !== null && l < bb) bb = l;
    }
    if (!Number.isFinite(hb) || !Number.isFinite(bb)) return null;
    const dHaut = haut !== null ? (haut - hb) / hb : 0;
    const dBas = bas !== null ? (bb - bas) / bb : 0;
    const pire = Math.max(dHaut, dBas);
    return pire > ECART_TOLERE ? pire : null;
  }

  function rendreLegende() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const s = st.serie;
    noeuds.legende.textContent = '';
    /* rien a legender tant qu'il n'y a pas au moins une bougie reelle */
    if (!s || s.indisponible || !Array.isArray(s.bougies) || !s.bougies.length) { noeuds.legende.hidden = true; return; }
    noeuds.legende.hidden = false;
    /* Nombre de bougies REELLEMENT tracees quand le moteur sait le dire :
       la legende ne doit pas annoncer trois bougies quand deux sont a
       l'ecran. Sinon, celles que l'interface a retenues. */
    const tracees = st.adaptateur && Number.isFinite(st.adaptateur.bougies) ? st.adaptateur.bougies : null;
    const retenues = s.bougies.length;
    const bougies = tracees !== null ? tracees : retenues;
    const cat = TF_CATALOGUE[s.tf || st.tf] || {};
    const taille = libBougie(s.bougie) || cat.bougie || null;
    const gran = s.granularite ? (GRANULARITE[s.granularite] || s.granularite) : null;
    const bouts = [];
    if (taille) bouts.push('Bougies de ' + taille);
    if (bougies !== null) bouts.push(bougies + ' bougie' + (bougies > 1 ? 's' : ''));
    if (gran) bouts.push('échantillon source ' + gran);
    const amp = st.stats && !st.stats.indisponible ? nombre(st.stats.highLowChangePercent) : null;
    if (amp !== null) bouts.push('amplitude ' + nf(Math.abs(amp), 2) + FINE + '%');
    if (bouts.length) el('span', { text: bouts.join(NBSP + '·' + NBSP) }, noeuds.legende);

    /* --- devise de la serie : dite, nuancee, ou declaree inconnue ------ */
    const faible = s.deviseConfiance && s.deviseConfiance !== 'haute';
    if (!s.devise) {
      /* Ne pas confondre deux choses : « je ne sais pas » se dit en or
         pointille (comme « estimation »), tandis que le bordeaux — qui
         est aussi la couleur de la BAISSE dans cette section — reste
         reserve a une vraie anomalie de la source. */
      el('span', {
        class: 'cx-puce ' + (s.deviseConfiance === 'contredite' ? 'cx-puce--alerte' : 'cx-puce--doute'),
        text: 'devise de la source non déterminée',
        title: s.deviseConfiance === 'contredite'
          ? "La devise annoncée est contredite par les prix vifs : rien n’est étiqueté plutôt que d’afficher une unité fausse."
          : "Le serveur n’a pas pu établir dans quelle devise la source renvoie l’historique. Les valeurs sont donc affichées sans symbole."
      }, noeuds.legende);
    } else if (st.devise && s.devise !== st.devise) {
      el('span', {
        class: 'cx-puce' + (faible ? ' cx-puce--doute' : ''),
        text: 'cours mondial en ' + s.devise + (faible ? ' (estimation)' : ''),
        title: faible ? 'Devise déduite par comparaison d’ordres de grandeur, sans confirmation de la source.' : null
      }, noeuds.legende);
    } else if (faible) {
      el('span', {
        class: 'cx-puce cx-puce--doute', text: 'devise estimée',
        title: 'Devise déduite par comparaison d’ordres de grandeur, sans confirmation de la source.'
      }, noeuds.legende);
    }

    if (tracees !== null && tracees < retenues) {
      const n = retenues - tracees;
      el('span', {
        class: 'cx-puce cx-puce--alerte',
        text: n + (n > 1 ? ' bougies écartées' : ' bougie écartée'),
        title: 'Le moteur a écarté des bougies inexploitables (horodatage manquant ou doublon). Rien n’a été fabriqué pour les remplacer.'
      }, noeuds.legende);
    }
    const ecart = ecartStatsBougies();
    if (ecart !== null) {
      el('span', {
        class: 'cx-puce cx-puce--alerte', text: 'résumé et bougies divergents',
        title: 'Le résumé de période et les bougies proviennent de deux lectures distinctes de la source ; elles diffèrent ici de '
             + nf(ecart * 100, 1) + FINE + '%. Les deux sont affichées telles que reçues, aucune n’a été ajustée.'
      }, noeuds.legende);
    }
    if (s.tronque) el('span', { class: 'cx-puce cx-puce--alerte', text: 'série tronquée par la source' }, noeuds.legende);
  }

  function poserTuile(cle, texte, raison, sens) {
    if (!racine) return;
    const t = noeuds.tuiles[cle]; if (!t) return;
    if (texte) {
      t.val.textContent = texte;
      t.boite.removeAttribute('data-absent');
      t.pq.textContent = raison || '';
    } else {
      t.val.textContent = '—';
      t.boite.setAttribute('data-absent', '1');
      t.pq.textContent = raison || RAISONS_FR.aucune;
    }
    if (sens) t.boite.setAttribute('data-sens', sens); else t.boite.removeAttribute('data-sens');
  }

  function rendreStats() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const d = st.parMetal.get(st.symbole);
    const s = st.stats && !st.stats.indisponible ? st.stats : null;
    const devS = s && s.devise ? s.devise : null;
    /* raison affichee case par case : elle nomme le manque, elle ne le comble pas */
    const manque = st.cle === false ? 'sans-cle'
      : (st.stats && st.stats.indisponible) ? (st.stats.raison || 'api')
      /* rien n'est encore revenu du serveur : la source n'a rien refuse */
      : (!st.stats && (st.etat === 'chargement' || !st.capacitesRecues)) ? null
      : 'aucune';
    const raisonManque = manque ? (RAISONS_FR[manque] || RAISONS_FR.aucune) : 'Lecture en cours…';

    poserTuile('actuel', d ? fmtPrix(d.prix, d.devise || st.devise) : null,
      d && prixValide(d.prix) !== null ? '' : raisonAbsencePrix());

    /* La raison ne s'ecrit QUE sous une valeur absente. Une valeur presente
       surmontee de « Donnee non fournie par la source. » ferait passer un
       chiffre juste pour un chiffre faux — exactement l'inverse de ce que
       cette section promet. */
    const tuileValeur = (cle, texte) => poserTuile(cle, texte, texte ? '' : raisonManque);
    tuileValeur('ouverture', s ? fmtPrix(s.open, devS) : null);
    tuileValeur('haut',      s ? fmtPrix(s.high, devS) : null);
    tuileValeur('bas',       s ? fmtPrix(s.low, devS) : null);
    tuileValeur('cloture',   s ? fmtPrix(s.close, devS) : null);

    const varPct = s ? nombre(s.openCloseChangePercent) : null;
    poserTuile('variation', varPct !== null ? fmtPct(varPct) : null,
      varPct !== null ? (st.tf ? 'sur ' + (TF_CATALOGUE[st.tf] ? TF_CATALOGUE[st.tf].long.toLowerCase() : st.tf) : '') : raisonManque,
      varPct === null ? null : varPct > 0 ? 'hausse' : varPct < 0 ? 'baisse' : 'plat');

    const date = st.majDate;
    poserTuile('maj', date ? ilYA(Date.now() - date.getTime()) : null,
      date ? date.toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
           : raisonAbsencePrix());

    /* Unite des quatre chiffres de periode :
       - devise connue et differente des prix vifs -> « en USD »
       - devise inconnue -> on le DIT, plutot que de laisser un nombre nu
       - devise identique aux prix vifs -> rien a ajouter (le symbole suffit) */
    const t = noeuds.tuiles;
    const mixte = !!(devS && st.devise && devS !== st.devise);
    const inconnue = !!(s && !devS);
    ['ouverture', 'haut', 'bas', 'cloture'].forEach(k => {
      if (t[k].boite.getAttribute('data-absent') !== null) return;   /* valeur absente : sa raison prime */
      /* Devise mixte : elle est portee UNE fois par l'intitule de groupe et par le
         symbole de chaque montant — la repeter sur les quatre tuiles alourdissait. */
      if (inconnue) t[k].pq.textContent = 'devise non déterminée';
    });
    rendreEnteteStats(devS, mixte, inconnue);
    rendreCleDevises(devS);
    rendreLegende();
  }

  /* Intitulé de groupe des quatre chiffres de période. Aucun calcul : il
     reprend la devise que le serveur a réellement annoncée pour la série. */
  function rendreEnteteStats(devS, mixte, inconnue) {
    if (!racine || !noeuds.statsTitre) return;
    let txt = '';
    if (mixte) txt = 'Sur la période · marché mondial en ' + devS;
    else if (inconnue) txt = 'Sur la période · devise non déterminée';
    else if (devS) txt = 'Sur la période · ' + devS;
    noeuds.statsTitre.textContent = txt;
    noeuds.statsTitre.hidden = !txt;
    if (noeuds.stats) noeuds.stats.dataset.mixte = mixte ? '1' : '0';
  }

  /* Clé de lecture : ce qui est en euros, ce qui est en devise de marché.
     Strictement descriptif — les deux devises viennent de l'état, jamais d'une
     valeur codee en dur, et l'historique reste dans SA devise (aucune conversion). */
  function rendreCleDevises(devS) {
    if (!racine || !noeuds.cleVif) return;
    const dv = st.devise || null;
    noeuds.cleVif.textContent = dv ? 'Prix actuels · ' + dv : 'Prix actuels';
    let hist;
    if (devS) hist = 'Historique du marché · ' + devS;
    else if (st.cle === false) hist = 'Historique du marché · indisponible';
    else hist = 'Historique du marché · devise non déterminée';
    noeuds.cleHist.textContent = hist;
    noeuds.cle.dataset.mixte = (devS && dv && devS !== dv) ? '1' : '0';
  }

  function rendreNote() {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const bouts = [];
    /* Trois cas, jamais deux : tant que le serveur n'a pas repondu, on ne
       peut pas dire qu'aucune periode n'est constructible — ce serait une
       fausse alarme au chargement a froid. */
    if (!st.capacitesRecues) bouts.push("Périodes : en attente des capacités réelles du serveur.");
    else if (st.cle === false) bouts.push("Prix vifs : accès public de la source. Historique : indisponible sans la clé serveur.");
    else if (!st.tfListe.length) bouts.push("Aucune période n’est constructible avec les capacités annoncées par le serveur.");
    else bouts.push("Périodes proposées : uniquement celles que le serveur peut construire à partir de données réelles.");
    bouts.push("Aucune valeur n’est estimée ni complétée : une donnée absente reste « — ».");
    noeuds.note.textContent = bouts.join(' ');
  }

  function rendreEtat() {
    if (!racine) return;
    const aDesPrix = st.parMetal.size > 0;
    let vue = 'pret';
    if (st.cle === false) vue = 'sans-cle';
    else if (st.etat === 'indisponible' || (st.serie && st.serie.indisponible)) vue = 'indisponible';
    else if (!st.serie) vue = 'chargement';                     /* rien a montrer : on le dit */
    else if (Array.isArray(st.serie.bougies) && st.serie.bougies.length === 0) vue = 'vide';
    else if (!st.adaptateur) vue = 'moteur';

    racine.setAttribute('data-etat', st.etat);
    racine.setAttribute('data-vue', vue);
    racine.toggleAttribute('data-occupe', !!st.occupe);
    racine.toggleAttribute('data-perime', !!st.perime);
    racine.toggleAttribute('data-sans-cle', st.cle === false);
    racine.toggleAttribute('data-prix', aDesPrix);

    const voile = (vue === 'chargement' || vue === 'indisponible' || vue === 'sans-cle' || vue === 'vide' || vue === 'moteur');
    noeuds.voile.toggleAttribute('data-on', voile);
    if (voile) {
      const m = MESSAGES[vue] || { t: '', p: '' };
      if (vue === 'indisponible') {
        const r = st.raison || (st.serie && st.serie.raison) || 'api';
        noeuds.voileTitre.textContent = MESSAGES.indisponible.t;
        noeuds.voileTxt.textContent = (RAISONS_FR[r] || RAISONS_FR.api) + ' Rien n’est affiché à la place.';
        noeuds.retry.hidden = false;
      } else {
        noeuds.voileTitre.textContent = m.t;
        noeuds.voileTxt.textContent = m.p;
        noeuds.retry.hidden = vue !== 'vide';
      }
    } else {
      noeuds.retry.hidden = true;
    }
    annoncer(vue);
  }

  function annoncer(vue) {
    if (!racine) return;                       /* utilisable avant mount() : on stocke, on n'affiche pas */
    const d = st.parMetal.get(st.symbole);
    const p = d ? fmtPrix(d.prix, d.devise || st.devise) : null;
    let txt;
    if (vue === 'indisponible') txt = 'Données indisponibles pour ' + (NOM_PAR_SYMBOLE[st.symbole] || st.symbole) + '.';
    else if (vue === 'chargement') txt = 'Lecture du marché en cours.';
    else txt = (NOM_PAR_SYMBOLE[st.symbole] || st.symbole) + (p ? ' : ' + p : ' : valeur indisponible') + (st.perime ? ', donnée périmée' : '');
    if (txt !== dernierAnnonce) { dernierAnnonce = txt; noeuds.live.textContent = txt; }
  }

  /* --------------------------------------------------- horloge fraicheur */
  function demarrerMinuteur() {
    arreterMinuteur();
    minuteur = setInterval(() => {
      if (document.hidden) return;
      /* rien de neuf n'est invente : on recalcule seulement l'age affiche */
      rendrePrix(); rendreStats();
    }, 20000);
  }
  function arreterMinuteur() { if (minuteur) { clearInterval(minuteur); minuteur = 0; } }

  /* ============================== API PUBLIQUE ======================== */
  const api = {
    get racine() { return racine; },
    get zoneGraphique() { return noeuds.slot || null; },
    get etat() { return st.etat; },
    get symbole() { return st.symbole; },
    get tf() { return st.tf; },

    mount() {
      if (st.monte) return racine;
      if (!host) throw new Error('createCours : host manquant');
      st.monte = true;
      construire();
      rendreMetaux(); rendrePrix(); rendrePeriodes(); rendreStats(); rendreLegende(); rendreEtat();
      demarrerMinuteur();
      emettre({ type: 'pret' });
      return racine;
    },

    onIntent,

    /* --- capacites reelles du serveur : elles PILOTENT les boutons ------ */
    setCapacites(cap) {
      cap = cap || {};
      st.capacitesRecues = true;
      st.cle = cap.cle === undefined ? null : !!cap.cle;
      if (st.cle === false) { st.serie = null; st.stats = null; viderMoteur(); api.setCurseur(null); }
      if (cap.devise) st.deviseSerie = cap.devise;
      const brut = Array.isArray(cap.tf) ? cap.tf : [];
      const vus = new Set();
      const liste = [];
      for (const t of brut) {
        const id = typeof t === 'string' ? t : (t && (t.id || t.tf));
        if (!id || vus.has(id)) continue;
        vus.add(id);
        liste.push({
          id,
          label: (t && t.label) || (TF_CATALOGUE[id] && TF_CATALOGUE[id].court) || id,
          long: (t && (t.long || t.titre)) || (TF_CATALOGUE[id] && TF_CATALOGUE[id].long) || id,
          /* le serveur peut annoncer « jour » / « semaine » : on traduit */
          bougie: (t && libBougie(t.bougie)) || (TF_CATALOGUE[id] && TF_CATALOGUE[id].bougie) || null
        });
      }
      liste.sort((a, b) => {
        const ia = TF_ORDRE.indexOf(a.id), ib = TF_ORDRE.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      st.tfListe = liste;
      if (!liste.length) st.tf = null;
      else if (!st.tf || !liste.some(t => t.id === st.tf)) {
        const prefere = liste.some(t => t.id === '1M') ? '1M' : liste[0].id;
        st.tf = prefere;
        rendrePeriodes();
        emettre({ type: 'periode', tf: prefere, auto: true });
      }
      rendrePeriodes(); rendreStats(); rendreEtat();
      return api;
    },

    /* --- prix vifs ------------------------------------------------------ */
    setPrix(payload) {
      payload = payload || {};
      if (payload.indisponible) {
        st.raison = payload.raison || 'api';
        /* on ne vide rien : les valeurs deja lues restent, marquees perimees */
        if (st.parMetal.size) st.perime = true;
        st.prix = payload;
        rendreMetaux(); rendrePrix(); rendreStats(); rendreEtat();
        return api;
      }
      st.prix = payload;
      st.raison = null;
      if (payload.devise) st.devise = payload.devise;
      const metaux = Array.isArray(payload.metaux) ? payload.metaux : [];
      for (const m of metaux) {
        if (!m || !m.symbole) continue;
        const p = prixValide(m.prix);
        if (p === null) { st.parMetal.delete(m.symbole); continue; }   /* jamais de 0 de remplissage */
        st.parMetal.set(m.symbole, {
          nom: m.nom || NOM_PAR_SYMBOLE[m.symbole] || m.symbole,
          prix: p,
          devise: m.devise || payload.devise || st.devise,
          majAt: m.majAt || m.updatedAt || payload.majAt || null,
          majReadable: m.majReadable || null,
          unite: m.unite || null,
          variation: m.variation !== undefined ? m.variation : null
        });
      }
      st.or24k = payload.or24k && prixValide(payload.or24k.prixGramme) !== null ? payload.or24k : null;

      /* fraicheur : degrade explicite, ou age reel superieur au seuil */
      const seuil = nombre(options.seuilPerime) || 300;
      const d = st.parMetal.get(st.symbole);
      const date = d ? dateDe(d.majAt) : null;
      const ageCache = payload.cache ? nombre(payload.cache.age) : null;
      const age = date ? (Date.now() - date.getTime()) / 1000 : ageCache;
      st.perime = !!payload.degrade || (age !== null && age > seuil);

      rendreMetaux(); rendrePrix(); rendreStats(); rendreEtat();
      return api;
    },

    /* --- serie de bougies (transmise telle quelle au moteur) ------------ */
    setSerie(payload) {
      payload = payload || {};
      if (payload.indisponible) {
        st.serie = { indisponible: true, raison: payload.raison || 'api' };
        st.raison = payload.raison || st.raison;
        viderMoteur(); api.setCurseur(null);
        rendreLegende(); rendreEtat();
        return api;
      }
      const bougies = Array.isArray(payload.bougies) ? payload.bougies.filter(estBougie) : [];
      st.serie = {
        symbole: payload.symbole || st.symbole,
        tf: payload.tf || st.tf,
        devise: payload.devise || null,
        /* « haute » | « moyenne » | « contredite » | « indeterminee ».
           Une devise devinee ne doit pas s'afficher avec le meme aplomb
           qu'une devise confirmee. */
        deviseConfiance: payload.deviseConfiance || null,
        bougies,
        source: payload.source || null,
        granularite: payload.granularite || null,
        bougie: payload.bougie || null,
        points: nombre(payload.points),
        tronque: !!payload.tronque
      };
      st.occupe = false;
      if (st.adaptateur && typeof st.adaptateur.setSerie === 'function') {
        try { st.adaptateur.setSerie(bougies, Object.assign({}, st.serie)); }
        catch (e) { /* un moteur qui tombe ne doit pas emporter l'interface */ }
      }
      rendreLegende(); rendreEtat();
      return api;
    },

    /* --- statistiques de periode (/ohlc) -------------------------------- */
    setStats(payload) {
      payload = payload || {};
      st.stats = payload.indisponible
        ? { indisponible: true, raison: payload.raison || 'api' }
        : {
            devise: payload.devise || null,
            open: payload.open, high: payload.high, low: payload.low, close: payload.close,
            highLowChangePercent: payload.highLowChangePercent,
            openCloseChangePercent: payload.openCloseChangePercent,
            debut: payload.debut || null, fin: payload.fin || null
          };
      rendreStats(); rendreEtat();
      return api;
    },

    /* --- etat global ---------------------------------------------------- */
    setEtat(nom, detail) {
      detail = detail || {};
      const connus = ['chargement', 'pret', 'indisponible', 'perime', 'sans-cle'];
      if (connus.indexOf(nom) < 0) return api;
      if (nom === 'sans-cle' || nom === 'indisponible') { st.serie = st.serie && !st.serie.indisponible ? null : st.serie; viderMoteur(); api.setCurseur(null); }
      if (nom === 'sans-cle') { st.cle = false; st.etat = 'pret'; }
      else if (nom === 'perime') { st.perime = true; st.etat = 'pret'; }
      else { st.etat = nom; if (nom !== 'indisponible') st.perime = detail.perime === true ? true : st.perime; }
      st.occupe = nom === 'chargement';
      if (nom === 'indisponible') st.raison = detail.raison || st.raison || 'api';
      if (nom === 'pret') st.raison = null;
      if (nom === 'pret' && detail.perime === false) st.perime = false;
      if (detail.ageSec !== undefined && nombre(detail.ageSec) !== null && !st.majDate && noeuds.prixMaj) {
        /* age fourni sans horodatage : on l'affiche tel quel, sans le convertir en date */
        noeuds.prixMaj.textContent = 'Dernière donnée disponible · ' + ilYA(nombre(detail.ageSec) * 1000);
      }
      if (st.cle === false) rendrePeriodes();
      rendrePrix(); rendreStats(); rendreEtat();
      return api;
    },

    /* --- ambiance jour / nuit ------------------------------------------- */
    setAmbiance(mode) {
      st.ambiance = mode === 'jour' ? 'jour' : 'nuit';
      if (racine) racine.setAttribute('data-ambiance', st.ambiance);
      if (st.adaptateur && typeof st.adaptateur.setAmbiance === 'function') {
        try { st.adaptateur.setAmbiance(st.ambiance); } catch (e) {}
      }
      return api;
    },

    /* --- moteur graphique (lot suivant) --------------------------------- */
    brancherGraphique(adaptateur) {
      st.adaptateur = adaptateur || null;
      if (st.adaptateur && st.serie && !st.serie.indisponible && typeof st.adaptateur.setSerie === 'function') {
        try { st.adaptateur.setSerie(st.serie.bougies, Object.assign({}, st.serie)); } catch (e) {}
      }
      if (st.adaptateur && typeof st.adaptateur.setAmbiance === 'function') {
        try { st.adaptateur.setAmbiance(st.ambiance); } catch (e) {}
      }
      /* le moteur peut desormais dire combien de bougies il trace */
      rendreLegende(); rendreEtat();
      return api;
    },

    /* --- bandeau de lecture sous le crosshair ---------------------------- */
    setCurseur(b) {
      if (!noeuds.lecture) return api;
      if (!b || !estBougie(b)) { noeuds.lecture.hidden = true; noeuds.lecture.textContent = ''; st.curseur = null; return api; }
      st.curseur = b;
      /* Devise de la SERIE uniquement. Si le serveur ne l'a pas
         determinee (devise:null), on n'emprunte PAS celle des prix vifs :
         ce serait la seule valeur de la livraison portant une unite que la
         source n'a pas confirmee. fmtPrix omet alors le symbole, comme les
         tuiles de statistiques. */
      const dev = st.serie ? st.serie.devise : null;
      noeuds.lecture.textContent = '';
      const d = dateDe(b.time);
      if (d) el('span', { class: 'cx-lecture__t', text: dateCourte(d) }, noeuds.lecture);
      const sens = nombre(b.close) > nombre(b.open) ? 'hausse' : nombre(b.close) < nombre(b.open) ? 'baisse' : 'plat';
      /* O/H/B/C est la convention des marches, illisible pour un client qui
         n'en est pas. Le mot entier apparait des que la place le permet ;
         partout ailleurs, l'initiale porte son intitule en infobulle et en
         etiquette accessible. */
      const CHAMPS = [
        ['O', 'ouv.', 'ouverture', b.open],
        ['H', 'haut', 'plus haut', b.high],
        ['B', 'bas', 'plus bas', b.low],
        ['C', 'clôt.', 'clôture', b.close]
      ];
      CHAMPS.forEach(([court, moyen, long, v]) => {
        const texte = fmtPrix(v, dev) || '—';
        const s = el('span', { class: 'cx-lecture__v', title: long, 'aria-label': long + ' ' + texte }, noeuds.lecture);
        const i = el('i', { 'aria-hidden': 'true' }, s);
        el('b', { class: 'cx-lecture__c', text: court }, i);
        el('u', { class: 'cx-lecture__m', text: moyen }, i);
        s.appendChild(document.createTextNode(texte));
      });
      if (st.serie && !st.serie.devise) noeuds.lecture.title = 'Devise de la source non déterminée : les valeurs sont affichées sans unité.';
      else noeuds.lecture.removeAttribute('title');
      noeuds.lecture.setAttribute('data-sens', sens);
      noeuds.lecture.hidden = false;
      return api;
    },

    destroy() {
      arreterMinuteur();
      clearTimeout(tClavier);
      document.removeEventListener('visibilitychange', surVisibilite);
      if (st.adaptateur && typeof st.adaptateur.destroy === 'function') { try { st.adaptateur.destroy(); } catch (e) {} }
      st.adaptateur = null;
      if (racine && racine.parentNode) racine.parentNode.removeChild(racine);
      racine = null;
      ecouteurs.length = 0;
      st.monte = false;
      for (const k in noeuds) delete noeuds[k];
    }
  };

  return api;
}

/* Une bougie n'est acceptee que si les quatre valeurs existent vraiment. */
function estBougie(b) {
  if (!b || typeof b !== 'object') return false;
  const o = nombre(b.open), h = nombre(b.high), l = nombre(b.low), c = nombre(b.close);
  return o !== null && h !== null && l !== null && c !== null && b.time !== undefined && b.time !== null;
}

export default createCours;
