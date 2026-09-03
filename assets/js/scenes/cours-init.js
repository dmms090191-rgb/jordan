/* =====================================================================
   La Compagnie de l'Or — Section « Cours des metaux » : ORCHESTRATION
   (lot coursgraph)
   ---------------------------------------------------------------------
   Le seul module qui parle au proxy. Il relie :

       /api/metaux/*   ->   cours.js (interface)   ->   cours-chart.js (moteur)

   Usage (integrateur) :

       import { initCours } from './assets/js/scenes/cours-init.js';
       const cours = initCours(document.getElementById('cours-hote'));
       // ... plus tard : cours.destroy();

   ---------------------------------------------------------------------
   REGLE ABSOLUE — AUCUNE DONNEE INVENTEE
   ---------------------------------------------------------------------
   Ce module ne calcule aucun prix, aucune variation, aucune bougie. Il
   transmet a l'interface EXACTEMENT ce que le proxy a renvoye. Un champ
   absent de la reponse reste absent (l'interface affiche « — » et dit
   pourquoi) ; il n'est jamais remplace par 0 ni par une estimation.
   Les seules transformations autorisees ici sont des ETIQUETTES en
   francais (« semaine » -> « 1 semaine ») : jamais un chiffre.

   ---------------------------------------------------------------------
   ECONOMIE DE REQUETES (l'API bloque les IP qui la martelent)
   ---------------------------------------------------------------------
   - Rien ne part tant que la section n'est pas approchee de l'ecran
     (IntersectionObserver, marge 240 px). Le moteur graphique (163 Ko)
     n'est meme pas telecharge avant.
   - Prix : rafraichis toutes les 30 s, UNIQUEMENT quand la section est
     visible et l'onglet actif. Le proxy a lui-meme un cache 30 s partage
     par tous les visiteurs : une salve amont, pas une par visiteur.
   - Historique : recharge SEULEMENT a l'ouverture de la section, au
     changement de metal, au changement de periode, a l'expiration du
     cache client, ou sur « Reessayer ». Jamais en boucle.
   - Un aller-retour deja en vol est reutilise ; changer de metal annule
     le precedent (AbortController) et la reponse tardive est ignoree.
   ===================================================================== */

import { createCours } from './cours.js';

const BASE_DEFAUT = '/api/metaux';
const INTERVALLE_PRIX = 30000;     // 30 s — aligne sur le cache du proxy
const TIMEOUT_REQUETE = 9000;      // le proxy coupe a 5 s : on lui laisse de la marge
const TTL_CLIENT_MIN = 10;         // s — plancher du cache client d'historique
const TTL_CLIENT_DEFAUT = 60;      // s — si le proxy n'annonce pas de TTL
const TTL_ECHEC = 15;              // s — on ne s'acharne pas sur une panne
const GRACE_MOTEUR = 2200;         // ms — attente max du moteur avant la 1re serie
const MARGE_VUE = '240px 0px';

/* Etiquettes des periodes. La LISTE vient toujours du serveur
   (/capacites) : ce tableau ne fait que nommer ce qu'il annonce. */
const TF_LIB = {
  '5min':  { label: '5 min', long: 'Bougies de cinq minutes' },
  '15min': { label: '15 min', long: 'Bougies de quinze minutes' },
  '1h':    { label: '1 h', long: 'Bougies d’une heure' },
  '1J':    { label: '1 J', long: 'Un jour' },
  '1S':    { label: '1 S', long: 'Une semaine' },
  '1M':    { label: '1 M', long: 'Un mois' },
  '3M':    { label: '3 M', long: 'Trois mois' },
  '1A':    { label: '1 A', long: 'Un an' },
  'MAX':   { label: 'Max', long: 'Historique complet' }
};
/* Les periodes intrajournalieres portent deja la taille de bougie dans
   leur nom : on ne la repete pas dans l'etiquette vocale. */
const TF_INTRA = { '5min': 1, '15min': 1, '1h': 1 };
const BOUGIE_LIB = { jour: '1 jour', semaine: '1 semaine', mois: '1 mois', annee: '1 an' };

function libBougie(b) {
  if (!b) return null;
  return BOUGIE_LIB[String(b)] || String(b);
}
function nombre(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function delai(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Lecture d'une route du proxy. Ne leve jamais : renvoie
 * { donnees } | { erreur:'timeout'|'reseau'|'api' } | { annule:true }.
 */
async function lire(url, signalExterne) {
  const ctrl = new AbortController();
  let cause = null;
  const minuteur = setTimeout(() => { cause = 'timeout'; ctrl.abort(); }, TIMEOUT_REQUETE);
  const relais = () => ctrl.abort();
  if (signalExterne) {
    if (signalExterne.aborted) { clearTimeout(minuteur); return { annule: true }; }
    signalExterne.addEventListener('abort', relais, { once: true });
  }
  try {
    const rep = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    if (!rep.ok) return { erreur: 'api', statut: rep.status };
    const donnees = await rep.json();
    return { donnees };
  } catch (e) {
    if (signalExterne && signalExterne.aborted) return { annule: true };
    return { erreur: cause === 'timeout' ? 'timeout' : 'reseau' };
  } finally {
    clearTimeout(minuteur);
    if (signalExterne) signalExterne.removeEventListener('abort', relais);
  }
}

/* ===================================================================== */
/**
 * Monte la section et branche les vraies donnees.
 * @param {HTMLElement} hote conteneur vide
 * @param {object} [options]
 *   base            prefixe des routes du proxy (defaut '/api/metaux')
 *   section         element observe pour le declenchement (defaut : la <section> parente)
 *   auto            false = ne rien declencher, l'appelant fera .demarrer()
 *   moteur          false = aucun graphique (interface seule)
 *   reduced         mouvement reduit force
 *   seuilPerime     secondes au-dela desquelles un prix est dit perime (defaut 300)
 *   intervallePrix  ms entre deux lectures de prix (defaut 30000)
 *   vendor          chemin alternatif de la bibliotheque de graphique
 *   onSimulation    appele si le proxy estampille simulation:true
 *   onJournal       appele a chaque etape (banc d'essai)
 */
export function initCours(hote, options) {
  const o = options || {};
  if (!hote) throw new Error('initCours : hote manquant');

  /* Deux formes d'adressage, selon l'hebergement :
       - reecriture disponible : '/api/metaux'           -> /api/metaux/prix
       - repli sans reecriture : '/api/metaux.php?route=' -> /api/metaux.php?route=prix
     (c'est exactement le repli prevu par le .htaccess du lot serveur). */
  const baseBrut = String(o.base || BASE_DEFAUT);
  const parRequete = baseBrut.indexOf('?') >= 0;
  const base = parRequete ? baseBrut : baseBrut.replace(/\/+$/, '');
  function url(nom, requete) {
    if (parRequete) {
      const joint = /[?&=]$/.test(base) ? '' : '&';
      return base + joint + nom + (requete ? '&' + requete : '');
    }
    return base + '/' + nom + (requete ? '?' + requete : '');
  }
  const intervallePrix = nombre(o.intervallePrix) || INTERVALLE_PRIX;
  const reduced = !!o.reduced ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------ etats */
  let detruit = false, demarre = false, visible = false;
  let capacites = null;
  let moteur = null, promesseMoteur = null, erreurMoteur = null;
  let premiereSerie = true;
  let horloge = 0, tIntention = 0;
  let vueObs = null, ambianceObs = null;
  let ctrlHistorique = null, cleEnVol = null;
  let generation = 0, enVol = 0;
  let dernierPrixA = 0, prixEnVol = false;
  let simulationVue = false;

  const cacheSerie = new Map();           // 'XAU|1M' -> { serie, stats, expireA, degrade }
  const prix = { indispo: false, raison: null, degrade: false, age: null, connus: 0 };
  const serieEtat = { degrade: false };

  let ambiance = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';

  function journal(quoi, detail) {
    if (typeof o.onJournal === 'function') { try { o.onJournal(quoi, detail); } catch (e) {} }
  }
  function signalerSimulation() {
    if (simulationVue) return;
    simulationVue = true;
    try {
      console.warn('[cours] Le proxy annonce simulation:true — ces chiffres proviennent du simulateur de laboratoire, ce ne sont PAS des cours reels.');
    } catch (e) {}
    if (typeof o.onSimulation === 'function') { try { o.onSimulation(true); } catch (e) {} }
  }

  /* ------------------------------------------------------- interface */
  const ui = createCours(hote, { reduced, seuilPerime: o.seuilPerime });
  const desabonner = ui.onIntent(surIntention);
  ui.mount();
  ui.setAmbiance(ambiance);

  /* Sur mobile la barre des periodes defile : la periode active doit
     etre VISIBLE, pas cachee hors du cadre. On ne touche a rien d'autre
     que la position de defilement (aucun scroll de page). */
  function centrerPeriode() {
    requestAnimationFrame(() => {
      try {
        const racine = ui.racine;
        const barre = racine && racine.querySelector('.cx-periodes');
        if (!barre || barre.scrollWidth <= barre.clientWidth + 2) return;
        const actif = barre.querySelector('.cx-periode[aria-checked="true"]');
        if (!actif) return;
        barre.scrollLeft = Math.max(0, actif.offsetLeft - (barre.clientWidth - actif.offsetWidth) / 2);
      } catch (e) {}
    });
  }

  /* ---------------------------------------------------------- etat UI */
  function appliquerEtat() {
    if (detruit) return;
    if (capacites && capacites.cle === false) { ui.setEtat('sans-cle'); return; }
    if (enVol > 0) { ui.setEtat('chargement'); return; }
    if (prix.indispo && prix.connus === 0) { ui.setEtat('indisponible', { raison: prix.raison || 'api' }); return; }
    if (prix.degrade || serieEtat.degrade || prix.indispo) { ui.setEtat('perime', { ageSec: prix.age }); return; }
    ui.setEtat('pret', { perime: false });
  }

  /* ============================== moteur ============================= */
  function preparerMoteur() {
    if (o.moteur === false || promesseMoteur) return promesseMoteur;
    promesseMoteur = (async () => {
      const mod = await import('./cours-chart.js');
      if (detruit) return null;
      const adaptateur = await mod.createCoursChart(ui.zoneGraphique, {
        ambiance,
        reduced,
        vendor: o.vendor,
        onCurseur: b => { if (!detruit) ui.setCurseur(b); }
      });
      if (detruit) { try { adaptateur.destroy(); } catch (e) {} return null; }
      moteur = adaptateur;
      ui.brancherGraphique(adaptateur);
      journal('moteur', { pret: true });
      return adaptateur;
    })();
    /* Un moteur qui tombe ne doit pas emporter la page : l'interface
       affichera « Graphique non charge » et gardera prix et statistiques. */
    promesseMoteur.catch(err => {
      erreurMoteur = err;
      journal('moteur', { pret: false, erreur: String(err && err.message || err) });
    });
    return promesseMoteur;
  }

  /* On n'attend le moteur qu'UNE fois, et jamais plus de GRACE_MOTEUR :
     mieux vaut des chiffres sans dessin qu'une page qui attend. */
  async function attendreMoteurUneFois() {
    if (!premiereSerie) return;
    premiereSerie = false;
    if (!promesseMoteur) return;
    await Promise.race([promesseMoteur.catch(() => null), delai(GRACE_MOTEUR)]);
  }

  /* ============================ capacites ============================ */
  async function chargerCapacites() {
    const r = await lire(url('capacites'));
    if (detruit || r.annule) return;

    if (r.erreur) {
      /* Sans capacites on ne pretend rien : aucun bouton de periode,
         et on le dit. */
      capacites = { cle: null, tf: [] };
      ui.setCapacites({ tf: [] });
      ui.setSerie({ indisponible: true, raison: r.erreur });
      ui.setStats({ indisponible: true, raison: r.erreur });
      appliquerEtat();
      journal('capacites', { erreur: r.erreur });
      return;
    }

    const d = r.donnees || {};
    if (d.simulation) signalerSimulation();
    capacites = d;
    journal('capacites', d);

    if (d.cle === false) {
      ui.setCapacites({ cle: false, groupBy: d.groupBy || {}, devise: d.devise || null, tf: [] });
      ui.setStats({ indisponible: true, raison: 'sans-cle' });
      ui.setEtat('sans-cle');
      return;
    }
    if (d.indisponible) {
      ui.setCapacites({ tf: [] });
      ui.setSerie({ indisponible: true, raison: d.raison || 'api' });
      ui.setStats({ indisponible: true, raison: d.raison || 'api' });
      appliquerEtat();
      return;
    }

    /* setCapacites emet lui-meme {type:'periode', auto:true} : c'est ce
       qui declenche le premier chargement d'historique. */
    ui.setCapacites({
      cle: true,
      groupBy: d.groupBy || {},
      devise: d.devise || null,
      tf: listeTf(d)
    });
    centrerPeriode();
    appliquerEtat();
  }

  function listeTf(d) {
    const detail = Array.isArray(d.tfDetail) ? d.tfDetail.filter(t => t && t.disponible !== false) : null;
    const brut = detail && detail.length ? detail : (Array.isArray(d.tf) ? d.tf.map(id => ({ id })) : []);
    const out = [];
    for (const t of brut) {
      const id = typeof t === 'string' ? t : (t && t.id);
      if (!id) continue;
      const lib = TF_LIB[id] || {};
      out.push({
        id,
        label: lib.label || (t && t.libelle) || id,
        long: lib.long || (t && t.libelle) || id,
        /* la taille de bougie annoncee par le serveur, mise en francais */
        bougie: TF_INTRA[id] ? null : libBougie(t && t.bougie)
      });
    }
    return out;
  }

  /* ============================== prix =============================== */
  async function rafraichirPrix(forcer) {
    if (detruit || (prixEnVol && !forcer)) return;
    prixEnVol = true;
    const premier = !dernierPrixA;
    if (premier) { enVol++; appliquerEtat(); }

    const r = await lire(url('prix'));

    prixEnVol = false;
    if (premier) enVol = Math.max(0, enVol - 1);
    if (detruit || r.annule) return;

    if (r.erreur) {
      prix.indispo = true; prix.raison = r.erreur;
      ui.setPrix({ indisponible: true, raison: r.erreur });
      appliquerEtat();
      journal('prix', { erreur: r.erreur });
      return;
    }
    const d = r.donnees || {};
    if (d.simulation) signalerSimulation();
    if (d.indisponible) {
      prix.indispo = true; prix.raison = d.raison || 'api';
      ui.setPrix({ indisponible: true, raison: prix.raison });
      appliquerEtat();
      journal('prix', { indisponible: prix.raison });
      return;
    }

    dernierPrixA = Date.now();
    prix.indispo = false;
    prix.raison = null;
    prix.degrade = !!d.degrade;
    prix.age = nombre(d.age);
    prix.connus = Array.isArray(d.metaux) ? d.metaux.filter(m => m && nombre(m.prix) > 0).length : 0;

    /* Transmission telle quelle : le contrat du proxy produit deja la
       forme attendue par l'interface. Rien n'est complete ici. */
    ui.setPrix(d);
    appliquerEtat();
    journal('prix', { metaux: prix.connus, degrade: prix.degrade, age: prix.age });
  }

  /* ============================ historique =========================== */
  function ttlClient(donnees) {
    const c = donnees && donnees.cache;
    const ttl = c ? nombre(c.ttl) : null;
    const age = c ? nombre(c.age) : null;
    if (ttl === null) return TTL_CLIENT_DEFAUT;
    return Math.max(TTL_CLIENT_MIN, ttl - (age || 0));
  }

  function paquetSerie(r, symbole, tf) {
    if (!r || r.annule) return null;
    if (r.erreur) return { indisponible: true, raison: r.erreur };
    const d = r.donnees || {};
    if (d.simulation) signalerSimulation();
    if (d.indisponible) return { indisponible: true, raison: d.raison || 'api' };
    return {
      symbole: d.symbole || symbole,
      tf: d.tf || tf,
      /* devise REELLE de la serie ; null si le serveur ne l'a pas
         determinee — on n'en invente pas une. */
      devise: d.devise || null,
      /* niveau de certitude de cette devise (« haute » | « moyenne » |
         « contredite » | « indeterminee »). Sans lui, une devise DEDUITE
         par comparaison d'ordres de grandeur s'afficherait avec le meme
         aplomb qu'une devise confirmee par la source. */
      deviseConfiance: d.deviseConfiance || null,
      bougies: Array.isArray(d.bougies) ? d.bougies : [],
      source: d.source || null,
      granularite: d.granularite || null,
      bougie: libBougie(d.bougie),
      points: nombre(d.points),
      tronque: !!d.tronque,
      degrade: !!d.degrade
    };
  }

  function paquetStats(r) {
    if (!r || r.annule) return null;
    if (r.erreur) return { indisponible: true, raison: r.erreur };
    const d = r.donnees || {};
    if (d.indisponible) return { indisponible: true, raison: d.raison || 'api' };
    /* Chaque champ n'est repris QUE s'il est present : un champ absent
       reste absent (l'interface affichera « — »). */
    const s = { devise: d.devise || null, debut: d.debut || null, fin: d.fin || null };
    for (const k of ['open', 'high', 'low', 'close', 'highLowChangePercent', 'openCloseChangePercent']) {
      if (d[k] !== undefined && d[k] !== null) s[k] = d[k];
    }
    return s;
  }

  async function chargerHistorique(symbole, tf, forcer) {
    if (detruit || !symbole || !tf) return;
    if (capacites && capacites.cle === false) return;

    const cle = symbole + '|' + tf;
    if (cleEnVol === cle && !forcer) return;               /* deja en route */

    const e = cacheSerie.get(cle);
    if (!forcer && e && Date.now() < e.expireA) {
      appliquerEntree(e);
      appliquerEtat();
      journal('historique', { cle, cache: true });
      return;
    }

    if (ctrlHistorique) ctrlHistorique.abort();
    const ctrl = ctrlHistorique = new AbortController();
    const gen = ++generation;
    cleEnVol = cle;
    enVol++;
    appliquerEtat();

    const q = 'symbole=' + encodeURIComponent(symbole) + '&tf=' + encodeURIComponent(tf);
    const [rs, ro] = await Promise.all([
      lire(url('serie', q), ctrl.signal),
      lire(url('ohlc', q), ctrl.signal)
    ]);

    enVol = Math.max(0, enVol - 1);
    if (cleEnVol === cle) cleEnVol = null;
    /* Reponse tardive d'un metal ou d'une periode qu'on a quittes :
       elle ne doit JAMAIS s'afficher sous une autre etiquette. */
    if (detruit || gen !== generation) return;

    const serie = paquetSerie(rs, symbole, tf);
    const stats = paquetStats(ro);
    if (!serie && !stats) return;                          /* tout a ete annule */

    const echec = !serie || serie.indisponible;
    const entree = {
      serie, stats,
      degrade: !!(serie && serie.degrade),
      expireA: Date.now() + (echec ? TTL_ECHEC : ttlClient(rs.donnees)) * 1000
    };
    cacheSerie.set(cle, entree);

    await attendreMoteurUneFois();
    if (detruit || gen !== generation) return;

    appliquerEntree(entree);
    appliquerEtat();
    journal('historique', {
      cle, cache: false,
      bougies: serie && Array.isArray(serie.bougies) ? serie.bougies.length : 0,
      raison: serie && serie.raison,
      devise: serie && serie.devise,
      granularite: serie && serie.granularite
    });
  }

  function appliquerEntree(e) {
    serieEtat.degrade = !!e.degrade;
    if (e.serie) ui.setSerie(e.serie);
    if (e.stats) ui.setStats(e.stats);
  }

  /* ============================ intentions =========================== */
  function surIntention(i) {
    if (detruit || !i) return;
    if (i.type === 'periode') centrerPeriode();
    if (i.type === 'metal' || i.type === 'periode') planifier(false);
    else if (i.type === 'reessayer') { planifier(true); rafraichirPrix(true); }
  }
  /* Un petit delai coalesce metal + periode changes coup sur coup
     (fleches du clavier) en un seul aller-retour. */
  function planifier(forcer) {
    clearTimeout(tIntention);
    tIntention = setTimeout(() => {
      if (!detruit) chargerHistorique(ui.symbole, ui.tf, forcer);
    }, 40);
  }

  /* ============================== horloge ============================ */
  function tic() {
    if (detruit || document.hidden || !visible) return;
    rafraichirPrix();
    /* Expiration du cache d'historique : c'est le SEUL rechargement
       periodique de la serie, et il n'a lieu que si elle a vraiment
       expire. */
    const cle = ui.symbole + '|' + ui.tf;
    const e = cacheSerie.get(cle);
    if (ui.tf && (!e || Date.now() >= e.expireA)) chargerHistorique(ui.symbole, ui.tf, false);
  }
  function demarrerHorloge() {
    arreterHorloge();
    if (detruit || document.hidden || !visible) return;
    horloge = setInterval(tic, intervallePrix);
  }
  function arreterHorloge() { if (horloge) { clearInterval(horloge); horloge = 0; } }

  function reprendre() {
    if (detruit || !demarre) return;
    if (dernierPrixA && Date.now() - dernierPrixA >= intervallePrix) rafraichirPrix();
    const cle = ui.symbole + '|' + ui.tf;
    const e = cacheSerie.get(cle);
    if (ui.tf && (!e || Date.now() >= e.expireA)) chargerHistorique(ui.symbole, ui.tf, false);
  }

  function surVisibiliteOnglet() {
    if (document.hidden) arreterHorloge();
    else if (demarre && visible) { demarrerHorloge(); reprendre(); }
  }
  document.addEventListener('visibilitychange', surVisibiliteOnglet);

  /* ============================== demarrage ========================== */
  function demarrer() {
    if (demarre || detruit) return;
    demarre = true;
    journal('demarrage', { base });
    preparerMoteur();                 /* en parallele du reseau : pas d'attente inutile */
    rafraichirPrix();
    chargerCapacites();
    demarrerHorloge();
  }

  const cible = o.section || (hote.closest ? hote.closest('section') : null) || hote;
  if (o.auto === false) {
    /* l'appelant declenchera lui-meme */
  } else if (typeof IntersectionObserver === 'function') {
    vueObs = new IntersectionObserver(entrees => {
      const vu = entrees.some(x => x.isIntersecting);
      if (vu === visible) return;
      visible = vu;
      if (vu) { const premier = !demarre; demarrer(); demarrerHorloge(); if (!premier) reprendre(); }
      else arreterHorloge();
    }, { rootMargin: MARGE_VUE, threshold: 0 });
    vueObs.observe(cible);
  } else {
    visible = true;
    demarrer();
  }

  /* Jour / Nuit a chaud : l'interface ET le moteur suivent. */
  if (typeof MutationObserver === 'function') {
    ambianceObs = new MutationObserver(() => {
      const m = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';
      if (m === ambiance) return;
      ambiance = m;
      ui.setAmbiance(m);
    });
    ambianceObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });
  }

  /* ============================ API publique ========================= */
  return {
    ui,
    get moteur() { return moteur; },
    get capacites() { return capacites; },
    get simulation() { return simulationVue; },
    get erreurMoteur() { return erreurMoteur; },
    get visible() { return visible; },
    get pretMoteur() { return promesseMoteur; },
    demarrer,
    rafraichirPrix: () => rafraichirPrix(true),
    rafraichirHistorique: (forcer) => chargerHistorique(ui.symbole, ui.tf, forcer !== false),
    viderCache() { cacheSerie.clear(); },
    setAmbiance(m) { ambiance = m === 'jour' ? 'jour' : 'nuit'; ui.setAmbiance(ambiance); },
    destroy() {
      if (detruit) return;
      detruit = true;
      arreterHorloge();
      clearTimeout(tIntention);
      if (ctrlHistorique) { try { ctrlHistorique.abort(); } catch (e) {} }
      document.removeEventListener('visibilitychange', surVisibiliteOnglet);
      if (vueObs) { vueObs.disconnect(); vueObs = null; }
      if (ambianceObs) { ambianceObs.disconnect(); ambianceObs = null; }
      if (typeof desabonner === 'function') desabonner();
      cacheSerie.clear();
      ui.destroy();                   /* detruit aussi l'adaptateur graphique */
      moteur = null;
    }
  };
}

export default initCours;
