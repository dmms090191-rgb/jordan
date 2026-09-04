/* =============================================================================
   L'API DES MÉTAUX — toute la logique, en un seul endroit
   =============================================================================

   POURQUOI CE FICHIER EXISTE
   --------------------------
   Le backend était api/metaux.php. Vercel n'exécute pas PHP : déployé tel
   quel, /api/metaux/prix n'aurait renvoyé aucune donnée — et le module des
   cours aurait affiché « La source de données a renvoyé une erreur » sur les
   quatre métaux, exactement comme en aperçu local.

   Ce module porte la même logique, en JavaScript, et il est appelé par DEUX
   entrées qui partagent donc rigoureusement le même comportement :

     · api/metaux/[route].mjs   fonction serverless Vercel  -> production
     · serveur-dev.mjs          serveur d'aperçu local      -> développement

   Une seule source de vérité : il n'existe pas de version « locale » qui
   pourrait diverger de la version déployée.

   LA CLÉ
   ------
   GOLD_API_KEY est lue côté serveur uniquement : variable d'environnement
   (Vercel), sinon un fichier .env pour le développement. Elle ne part que
   dans l'en-tête x-api-key vers api.gold-api.com, ne suit aucune
   redirection, et n'apparaît dans aucune réponse ni aucun journal.

   AUCUNE DONNÉE INVENTÉE
   ----------------------
   Quand la source ne répond pas, on le DIT — jamais un zéro, jamais une
   valeur reconstruite. Une bougie dont le haut/bas manque est rejetée, pas
   comblée. C'est le principe repris tel quel du PHP.
   ============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------------------------------------------------------- la clé */
let CLE_MEMO = null;
export function lireCle() {
  if (CLE_MEMO !== null) return CLE_MEMO;
  if (process.env.GOLD_API_KEY && process.env.GOLD_API_KEY.trim()) return (CLE_MEMO = process.env.GOLD_API_KEY.trim());
  /* Repli fichier : uniquement utile en développement. Sur Vercel il n'y a
     pas de .env déployé — c'est la variable d'environnement qui répond. */
  try {
    const ici = path.dirname(fileURLToPath(import.meta.url));
    for (const f of [path.resolve(ici, '..', '.env'), path.resolve(ici, '..', '..', '.env')]) {
      try {
        const m = fs.readFileSync(f, 'utf8').match(/^[ \t]*GOLD_API_KEY[ \t]*=[ \t]*(.*)$/m);
        if (m) { const v = m[1].trim().replace(/^["']|["']$/g, ''); if (v) return (CLE_MEMO = v); }
      } catch (e) { /* fichier absent : on essaie le suivant */ }
    }
  } catch (e) { /* système de fichiers indisponible : on s'en passe */ }
  return (CLE_MEMO = '');
}

/* ------------------------------------------- constantes, reprises du PHP */
const BASE = (process.env.GOLD_API_BASE || 'https://api.gold-api.com').replace(/\/+$/, '');
const ONCE_TROY_G = 31.1034768;
const DEVISE_PRIX = 'EUR';
const TIMEOUT = 8000;

export const METAUX = [
  { symbole: 'XAU', nom: 'Or' }, { symbole: 'XAG', nom: 'Argent' },
  { symbole: 'XPT', nom: 'Platine' }, { symbole: 'XPD', nom: 'Palladium' },
];
const GRANULARITES = ['minute', 'hour', 'day', 'week', 'month', 'year'];
/* PLAGES DE SONDAGE — volontairement COURTES.
   Une sonde ne sert qu'à savoir si une granularité est autorisée : elle n'a
   aucun besoin de vingt ans de données. Les plages larges héritées du PHP
   coûtaient 8,6 s au démarrage à froid — or le frontend abandonne à 9 s
   (TIMEOUT_REQUETE dans cours-init.js, calibré pour l'ancien proxy PHP qui
   coupait à 5 s). On passait donc à quelques centaines de millisecondes du
   message « Données momentanément indisponibles » sur la première visite.
   Raccourcies, elles rendent le même verdict — mesuré : 6 granularités sur
   6 à chaque essai — en deux fois moins de temps. */
const PLAGES_SONDE = { minute: 1800, hour: 6 * 3600, day: 5 * 86400,
                       week: 60 * 86400, month: 200 * 86400, year: 5 * 365 * 86400 };
const TTL = { prix: 30, serieFine: 60, serieMoyen: 300, serieLarge: 900,
              capacites: 21600, capacitesRepli: 90 };
const TF = {
  '5min':  { libelle: '5 min',     plage: 12 * 3600,        variantes: [{ g: 'minute', b: { type: 'sec', n: 300 } }] },
  '15min': { libelle: '15 min',    plage: 2 * 86400,        variantes: [{ g: 'minute', b: { type: 'sec', n: 900 } }] },
  '1h':    { libelle: '1 h',       plage: 3 * 86400,        variantes: [{ g: 'minute', b: { type: 'sec', n: 3600 } }] },
  '1J':    { libelle: '1 jour',    plage: 86400,            variantes: [{ g: 'minute', b: { type: 'sec', n: 300 } }] },
  '1S':    { libelle: '1 semaine', plage: 7 * 86400,        variantes: [{ g: 'minute', b: { type: 'sec', n: 3600 } }, { g: 'hour', b: { type: 'sec', n: 14400 } }] },
  '1M':    { libelle: '1 mois',    plage: 30 * 86400,       variantes: [{ g: 'hour',   b: { type: 'jour' } }] },
  '3M':    { libelle: '3 mois',    plage: 90 * 86400,       variantes: [{ g: 'hour',   b: { type: 'jour' } }, { g: 'day', b: { type: 'semaine' } }] },
  '1A':    { libelle: '1 an',      plage: 365 * 86400,      variantes: [{ g: 'day',    b: { type: 'semaine' } }] },
  'MAX':   { libelle: 'Max',       plage: 10 * 365 * 86400, variantes: [{ g: 'week',   b: { type: 'mois' } }] },
};
const TF_ORDRE = ['5min', '15min', '1h', '1J', '1S', '1M', '3M', '1A', 'MAX'];
const MESSAGES = {
  cle: "Service de marché non configuré (clé absente ou refusée).",
  refus: "Cette granularité n'est pas incluse dans le forfait.",
  quota: "Quota de la source de marché atteint.",
  timeout: "La source de marché n'a pas répondu à temps.",
  reseau: "Source de marché injoignable.",
  api: "La source de marché a renvoyé une erreur.",
  forme: "Réponse inattendue de la source de marché.",
  timeframe: "Période indisponible avec cette source.",
  parametre: "Paramètre invalide.",
};

class Amont extends Error {
  constructor(raison, statut, detail) { super(detail || raison); this.raison = raison; this.statut = statut || 0; }
}

/* ------------------------------------------------------------ appel amont */
async function appel(chemin, params = {}, avecCle = false, timeout = TIMEOUT) {
  const u = new URL(BASE + chemin);
  for (const k in params) if (params[k] !== undefined && params[k] !== null) u.searchParams.set(k, String(params[k]));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    /* redirect:'error' — la clé ne doit suivre AUCUNE redirection, sinon
       elle partirait vers un hôte que nous n'avons pas choisi. */
    r = await fetch(u, { signal: ctrl.signal, redirect: 'error',
      headers: avecCle && lireCle() ? { 'x-api-key': lireCle() } : {} });
  } catch (e) {
    clearTimeout(t);
    throw new Amont(e && e.name === 'AbortError' ? 'timeout' : 'reseau', 0);
  }
  clearTimeout(t);
  const txt = await r.text();
  if (r.status === 401) throw new Amont('cle', 401);
  if (r.status === 403) throw new Amont('refus', 403);
  if (r.status === 429) throw new Amont('quota', 429);
  if (!r.ok) throw new Amont('api', r.status);
  try { return JSON.parse(txt); } catch (e) { throw new Amont('forme', r.status); }
}

/* ------------------------------------------------------------------ cache
   En mémoire, avec anti-avalanche : une seule requête sortante par clé, les
   appels concurrents attendent la même promesse. Sur Vercel il vit le temps
   d'une instance chaude — c'est l'en-tête s-maxage (voir enTetesCache) qui
   fait le vrai cache, au bord du réseau. */
const boite = new Map();
/* ttlDe : une durée de vie qui DÉPEND de la valeur obtenue. Une détection
   de capacités réussie mérite six heures de cache ; une détection ratée ne
   mérite que quatre-vingt-dix secondes, sinon une panne passagère se
   trouverait figée pour la journée. */
async function cache(cle, ttl, producteur, ttlDe = null) {
  const n = Date.now();
  const e = boite.get(cle);
  const duree = v => (ttlDe ? ttlDe(v) : ttl);
  if (e && e.promesse) { const v = await e.promesse; return { valeur: v, age: 0, ttl: duree(v) }; }
  if (e && e.v !== undefined && n - e.a < duree(e.v) * 1000)
    return { valeur: e.v, age: Math.round((n - e.a) / 1000), ttl: duree(e.v) };
  const p = (async () => { const v = await producteur(); boite.set(cle, { v, a: Date.now() }); return v; })();
  boite.set(cle, { ...(e || {}), promesse: p });
  try { const v = await p; return { valeur: v, age: 0, ttl: duree(v) }; }
  catch (err) {
    /* On garde la dernière valeur VRAIE, même périmée, plutôt que rien —
       et on l'estampille « degrade » pour que l'interface le dise. */
    if (e && e.v !== undefined) {
      boite.set(cle, { v: e.v, a: e.a });
      return { valeur: e.v, age: Math.round((n - e.a) / 1000), ttl, degrade: true, raison: err.raison };
    }
    boite.delete(cle);
    throw err;
  }
}

/* ------------------------------------------ normalisation de l'historique */
const nombre = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
/* LES DATES DE CETTE SOURCE N'ONT PAS DEUX FOIS LE MÊME FORMAT.
   Relevé sur les six granularités, et c'est ce qui cassait la moitié des
   périodes :

     minute   date_minute  « 2026-09-03 13:50 »     ← pas de secondes
     hour     date_hour    « 2026-09-01 01 »        ← pas de minutes
     day      day          « 2026-08-05 00:00:00 »
     week     week         « 2025-07-28 00:00:00 »
     month    year_month   « 2021-09 »              ← pas de jour
     year     year         « 2006 »                 ← une année nue

   Date.parse refuse « 2026-09-01T01Z », et « 2006 » traité comme un
   horodatage donnerait 1970. On complète donc la date tronquée avant de la
   lire, et on ancre en UTC : sans le Z, le fuseau de la machine décalerait
   toutes les bougies. */
const epoch = v => {
  if (typeof v === 'number') return v > 1e11 ? Math.round(v / 1000) : Math.round(v);
  let s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) {                       /* « 2006 » : une année */
    const a = +s;
    if (a < 1900 || a > 2100) return null;
    s = s + '-01-01';
  } else if (/^\d{9,}$/.test(s)) {               /* horodatage s ou ms */
    const n = +s;
    return n > 1e11 ? Math.round(n / 1000) : n;
  }
  s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}$/.test(s)) s += '-01';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  if (/T\d{2}$/.test(s)) s += ':00:00';
  if (/T\d{2}:\d{2}$/.test(s)) s += ':00';
  const d = Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
  return Number.isFinite(d) ? Math.round(d / 1000) : null;
};

function normaliser(brut) {
  const lignes = Array.isArray(brut) ? brut
    : (brut && Array.isArray(brut.data)) ? brut.data
    : (brut && Array.isArray(brut.results)) ? brut.results
    : (brut && Array.isArray(brut.history)) ? brut.history : null;
  if (!lignes) throw new Amont('forme', 200);
  if (!lignes.length) return [];
  /* Les noms de champs changent selon l'agrégation (avg_price, max_price,
     min_price) ET la granularité (date_minute, date_hour, day, week,
     year_month, year). On les DÉTECTE au lieu de les supposer.

     PIÈGE QUI A COÛTÉ LA MOITIÉ DES PÉRIODES : la colonne de prix était
     cherchée avec un motif contenant « min » et « max », pour attraper
     min_price et max_price. Or « date_minute » CONTIENT « min ». Sur les
     réponses max et min, où la date arrive en premier, c'est donc elle qui
     était prise pour la colonne de prix — et parseFloat("2026-09-03 13:50")
     vaut 2026. Chaque bougie se retrouvait avec un haut de 2026 pour une
     ouverture de 4459, donc incohérente, donc rejetée : zéro bougie, et
     l'interface annonçait « réponse inattendue de la source ».

     Deux règles suffisent à rendre la confusion impossible :
       1. la colonne de temps est choisie EN PREMIER, sur tous les champs ;
       2. la colonne de prix est cherchée parmi les AUTRES, et son motif ne
          contient plus que des mots qui ne peuvent pas nommer une date. */
  const ech = lignes.find(l => l && typeof l === 'object') || {};
  const champs = Object.keys(ech);
  let cT = null, cP = null;
  for (const k of champs) {
    if (/time|date|day|hour|minute|week|month|year|stamp/i.test(k) && epoch(ech[k]) !== null) { cT = k; break; }
  }
  for (const k of champs) {
    if (k === cT) continue;
    if (/price|prix|value|valeur|close/i.test(k) && nombre(ech[k]) !== null) { cP = k; break; }
  }
  /* dernier recours : la seule autre colonne numérique */
  if (cT && !cP) {
    const n = champs.filter(k => k !== cT && nombre(ech[k]) !== null);
    if (n.length === 1) cP = n[0];
  }
  if (!cT || !cP) throw new Amont('forme', 200);
  const pts = [];
  for (const l of lignes) {
    if (!l || typeof l !== 'object') continue;
    const t = epoch(l[cT]), v = nombre(l[cP]);
    if (t === null || v === null || v <= 0) continue;
    pts.push({ t, v });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

/* début du seau contenant t, pour un type de bougie donné (tout en UTC) */
function seau(t, b) {
  if (b.type === 'sec') return Math.floor(t / b.n) * b.n;
  const d = new Date(t * 1000);
  if (b.type === 'jour') return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  if (b.type === 'semaine') {
    const j = (d.getUTCDay() + 6) % 7;                     /* lundi = 0 */
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - j) / 1000);
  }
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);   /* mois */
}
function grouper(points, b) {
  const m = new Map();
  for (const p of points) { const k = seau(p.t, b); if (!m.has(k)) m.set(k, []); m.get(k).push(p.v); }
  return m;
}

/* ASSEMBLAGE STRICT — jamais de bougie fabriquée.
   Une bougie n'existe que si l'on a au moins deux points moyens (sinon elle
   serait plate par construction), un haut ET un bas, et si l'ensemble est
   cohérent. Tout le reste est rejeté, pas comblé. */
function assembler(avg, max, min, b) {
  const gA = grouper(avg, b), gM = grouper(max, b), gm = grouper(min, b);
  const out = [];
  for (const t of [...gA.keys()].sort((x, y) => x - y)) {
    const v = gA.get(t);
    if (v.length < 2) continue;
    const hh = gM.get(t), ll = gm.get(t);
    if (!hh || !hh.length || !ll || !ll.length) continue;
    const open = v[0], close = v[v.length - 1];
    const high = Math.max(...hh), low = Math.min(...ll);
    if (![open, close, high, low].every(x => Number.isFinite(x) && x > 0)) continue;
    const tol = high * 1e-9;
    if (high < Math.max(open, close) - tol || low > Math.min(open, close) + tol) continue;
    out.push({ time: t, open, high, low, close, n: v.length });
  }
  return out;
}

/* -------------------------------------------------------------- capacités */
async function detecterCapacites() {
  const cle = lireCle() !== '';
  const base = { cle, groupBy: {}, devise: null, deviseHistorique: null, devisePrix: DEVISE_PRIX,
                 deviseParametrable: false, tf: [], tfDetail: [], sondeeA: new Date().toISOString() };
  for (const g of GRANULARITES) base.groupBy[g] = false;
  if (!cle) return base;

  const fin = Math.floor(Date.now() / 1000);
  /* SIX SONDES, EN PARALLÈLE.
     J'avais d'abord cru à une limitation de débit : lancées ensemble, trois
     granularités revenaient marquées absentes, et je les avais donc passées
     en série. Mesuré ensuite, c'était faux — ce n'était pas la rafale, mais
     les dates qui ne se lisaient pas (voir epoch plus haut). Une fois ce
     défaut corrigé, le parallèle rend 6 granularités sur 6 à chaque essai,
     comme la série, et divise le temps par deux.

     Coût final : environ 4,5 s, UNE SEULE FOIS. Le résultat vaut six heures
     de cache, et stale-while-revalidate sert ensuite la valeur connue
     pendant qu'une nouvelle détection se fait en arrière-plan : seul le tout
     premier visiteur après une expiration attend. */
  let transitoire = false;
  const sondes = await Promise.all(GRANULARITES.map(async g => {
    try {
      const pts = normaliser(await appel('/history', { symbol: 'XAU',
        startTimestamp: fin - PLAGES_SONDE[g], endTimestamp: fin,
        groupBy: g, aggregation: 'avg', orderBy: 'asc' }, true, 7000));
      return { g, ok: pts.length > 0, dernier: pts.length ? pts[pts.length - 1].v : null };
    } catch (e) {
      /* Un quota, un délai ou une coupure réseau ne disent RIEN sur le
         forfait : les traiter comme un refus figerait une panne passagère
         pour six heures. On note l'échec et on redemandera dans 90 s. */
      if (e.raison !== 'refus') transitoire = true;
      return { g, ok: false, dernier: null, raison: e.raison };
    }
  }));
  for (const s of sondes) base.groupBy[s.g] = s.ok;

  /* POURQUOI LES SONDES ONT ÉCHOUÉ, quand elles ont TOUTES échoué.
     Sans cette information, une clé refusée se présentait à l'écran comme
     « Période indisponible avec cette source » — un message qui envoie
     chercher le défaut du mauvais côté. On remonte la raison dominante. */
  if (!sondes.some(s => s.ok)) {
    const compte = {};
    for (const s of sondes) if (s.raison) compte[s.raison] = (compte[s.raison] || 0) + 1;
    base.raisonSonde = Object.keys(compte).sort((a, b) => compte[b] - compte[a])[0] || 'api';
  }

  /* DANS QUELLE DEVISE L'HISTORIQUE RÉPOND-IL ?
     On ne le suppose pas, on le CONFRONTE. Mesuré sur cette source :
     currency=EUR est ignoré et l'historique revient en dollars. L'annoncer
     en euros afficherait un graphique faux de 16 % sous une étiquette
     rassurante — ce serait pire que de ne rien annoncer. */
  const ech = (sondes.find(s => s.dernier !== null) || {}).dernier;
  if (ech !== null && ech !== undefined) {
    try {
      const [e, u] = await Promise.all([appel('/price/XAU/EUR'), appel('/price/XAU/USD')]);
      const pe = nombre(e.price), pu = nombre(u.price);
      if (pe && pu) {
        base.deviseHistorique = Math.abs(ech - pe) <= Math.abs(ech - pu) ? 'EUR' : 'USD';
        base.deviseConfiance = 'moyenne';         /* déduite, pas déclarée par la source */
      }
    } catch (err) { /* sans référence, on n'annonce aucune devise */ }
  }
  base.devise = base.deviseHistorique;

  for (const id of TF_ORDRE) {
    const v = TF[id].variantes.find(x => base.groupBy[x.g]) || null;
    if (v) base.tf.push(id);
    base.tfDetail.push({ id, libelle: TF[id].libelle, disponible: !!v,
      granularite: v ? v.g : null,
      bougie: v ? (v.b.type === 'sec' ? v.b.n + ' s' : v.b.type) : null,
      raison: v ? null : 'granularites requises absentes du forfait' });
  }
  /* Une détection n'est « utile » — donc digne du cache de six heures — que
     si elle a vraiment appris quelque chose ET qu'aucune sonde n'a échoué
     pour une raison passagère. Sinon on repose la question dans 90 s. */
  base.detectionUtile = base.tf.length > 0 && !transitoire;
  if (transitoire) base.note = 'Une ou plusieurs sondes ont échoué passagèrement : nouvelle détection dans '
    + TTL.capacitesRepli + ' s.';
  return base;
}
const capacites = () => cache('capacites', TTL.capacites, detecterCapacites,
  v => (v && v.detectionUtile ? TTL.capacites : TTL.capacitesRepli));

/* ------------------------------------------------------------------- prix */
async function chargerPrix() {
  /* Les quatre métaux en parallèle : un métal en panne n'empêche pas les
     trois autres de s'afficher, et le tout tient dans un seul aller-retour. */
  const lignes = await Promise.all(METAUX.map(async m => {
    try {
      const d = await appel('/price/' + m.symbole + '/' + DEVISE_PRIX);
      const prix = nombre(d.price);
      if (prix === null || prix <= 0) return { symbole: m.symbole, nom: m.nom, indisponible: true, raison: 'forme' };
      const l = { symbole: m.symbole, nom: m.nom, prix,
                  devise: typeof d.currency === 'string' ? d.currency : DEVISE_PRIX,
                  majAt: typeof d.updatedAt === 'string' ? d.updatedAt : null };
      if (typeof d.name === 'string') l.nomApi = d.name;
      if (typeof d.currencySymbol === 'string') l.symboleDevise = d.currencySymbol;
      const tx = nombre(d.exchangeRate);
      if (tx !== null && tx > 0) l.tauxSourceEurParUsd = tx;
      if (typeof d.updatedAtReadable === 'string') l.majReadable = d.updatedAtReadable;
      if (l.majAt) { const ts = Date.parse(l.majAt); if (Number.isFinite(ts)) l.majIlYaSec = Math.max(0, Math.round((Date.now() - ts) / 1000)); }
      return l;
    } catch (e) {
      /* valeur absente : on le DIT, on n'invente pas — surtout pas un zéro */
      return { symbole: m.symbole, nom: m.nom, indisponible: true, raison: e.raison };
    }
  }));
  const bonnes = lignes.filter(l => !l.indisponible);
  if (!bonnes.length) throw new Amont((lignes[0] && lignes[0].raison) || 'api', 0);

  const sortie = { devise: DEVISE_PRIX, metaux: lignes };
  const or = (lignes.find(l => l.symbole === 'XAU') || {}).prix;
  if (or) sortie.or24k = { prixGramme: or / ONCE_TROY_G, devise: DEVISE_PRIX,
    base: { symbole: 'XAU', prixOnce: or, onceTroyG: ONCE_TROY_G },
    mention: 'Valeur indicative du métal pur. Ne constitue pas une offre de rachat.' };

  const c = boite.get('capacites');
  if (c && c.v && c.v.deviseHistorique === DEVISE_PRIX) sortie.variationPossible = true;
  return sortie;
}

/* ------------------------------------------------------------------ série */
async function construireSerie(symbole, id) {
  const caps = (await capacites()).valeur;
  const tf = TF[id];
  const v = tf.variantes.find(x => caps.groupBy[x.g]);
  if (!v) throw new Amont('timeframe', 0);
  const fin = Math.floor(Date.now() / 1000), debut = fin - tf.plage;
  const commun = { symbol: symbole, startTimestamp: debut, endTimestamp: fin, groupBy: v.g, orderBy: 'asc' };
  /* trois agrégations, en parallèle : moyenne pour l'ouverture et la
     clôture, max pour le haut, min pour le bas */
  const [avg, max, min] = await Promise.all(['avg', 'max', 'min'].map(a =>
    appel('/history', { ...commun, aggregation: a }, true).then(normaliser)));
  const bougies = assembler(avg, max, min, v.b);
  if (!bougies.length) throw new Amont('forme', 0);
  return {
    symbole, tf: id, libelle: tf.libelle,
    devise: caps.deviseHistorique,
    deviseConfiance: caps.deviseHistorique ? (caps.deviseConfiance || 'moyenne') : 'indeterminee',
    debut, fin, source: 'history', granularite: v.g,
    bougie: v.b.type === 'sec' ? v.b.n + ' s' : v.b.type,
    points: avg.length, bougies,
  };
}

/* ------------------------------------------------------------------- ohlc */
async function construireOhlc(symbole, id) {
  const caps = (await capacites()).valeur;
  const tf = TF[id];
  const fin = Math.floor(Date.now() / 1000), debut = fin - tf.plage;
  const brut = await appel('/ohlc/' + symbole, { startTimestamp: debut, endTimestamp: fin }, true);
  const o = (brut && brut.data && typeof brut.data === 'object') ? brut.data : brut;
  if (!o || typeof o !== 'object') throw new Amont('forme', 200);
  const s = { symbole, tf: id, devise: caps.deviseHistorique,
              debut: nombre(o.startTimestamp) ?? debut, fin: nombre(o.endTimestamp) ?? fin };
  /* chaque champ n'est repris QUE s'il existe : un champ absent reste
     absent, l'interface affichera « — » plutôt qu'un chiffre inventé */
  for (const k of ['open', 'high', 'low', 'close', 'highLowChangePercent', 'openCloseChangePercent']) {
    const n = nombre(o[k]); if (n !== null) s[k] = n;
  }
  return s;
}

/* -------------------------------------------------------------- enveloppe */
const enveloppe = r => ({
  ...(r.valeur || {}),
  cache: { age: r.age | 0, ttl: r.ttl | 0 },
  ...(r.degrade ? { degrade: true, raisonDegradation: r.raison || 'api', age: r.age | 0 } : {}),
});
const ttlSerie = id => (['5min', '15min', '1h', '1J'].includes(id) ? TTL.serieFine
  : ['1S', '1M'].includes(id) ? TTL.serieMoyen : TTL.serieLarge);
const indispo = (raison, extra = {}) =>
  ({ indisponible: true, raison, message: MESSAGES[raison] || MESSAGES.api, ...extra });

/* =============================================================================
   LE POINT D'ENTRÉE UNIQUE
   Rend { code, corps, ttl } — à charge de l'appelant (Vercel ou serveur de
   développement) d'écrire la réponse HTTP et les en-têtes de cache.

   Le code est 200 même pour une indisponibilité : c'est un état PRÉVU de
   l'interface, pas une panne du site, et le navigateur ne doit pas cracher
   une erreur réseau dans la console.
   ============================================================================= */
export async function traiter(route, params = {}) {
  const q = k => (params[k] === undefined || params[k] === null ? '' : String(params[k]));

  try {
    if (route === 'prix') {
      try { const r = await cache('prix', TTL.prix, chargerPrix); return { code: 200, corps: enveloppe(r), ttl: TTL.prix }; }
      catch (e) { return { code: 200, corps: indispo(e.raison || 'api'), ttl: 10 }; }
    }

    if (route === 'capacites') {
      try {
        const r = await capacites();
        return { code: 200, corps: enveloppe(r), ttl: r.ttl };
      } catch (e) {
        const gb = {}; for (const g of GRANULARITES) gb[g] = false;
        return { code: 200, ttl: TTL.capacitesRepli,
          corps: { cle: lireCle() !== '', groupBy: gb, devise: null, tf: [], ...indispo(e.raison || 'api') } };
      }
    }

    if (route === 'serie' || route === 'ohlc') {
      const sym = q('symbole').toUpperCase() || q('symbol').toUpperCase();
      const id = q('tf');
      if (!METAUX.some(x => x.symbole === sym))
        return { code: 400, ttl: 0, corps: { erreur: 'parametre', champ: 'symbole', message: MESSAGES.parametre, attendu: METAUX.map(x => x.symbole) } };
      if (!TF[id])
        return { code: 400, ttl: 0, corps: { erreur: 'parametre', champ: 'tf', message: MESSAGES.parametre, attendu: TF_ORDRE } };
      try {
        const caps = (await capacites()).valeur;
        if (!caps.cle) return { code: 200, ttl: 10, corps: indispo('cle', { symbole: sym, tf: id }) };
        if (!TF[id].variantes.some(v => caps.groupBy[v.g])) {
          /* aucune granularité disponible : est-ce le forfait, ou la source
             qui refusait de répondre au moment de la détection ? */
          const r = caps.raisonSonde && caps.raisonSonde !== 'forme' ? caps.raisonSonde : 'timeframe';
          return { code: 200, ttl: TTL.capacitesRepli, corps: indispo(r, { symbole: sym, tf: id, tfDisponibles: caps.tf }) };
        }
        const t = ttlSerie(id);
        const r = route === 'serie'
          ? await cache('serie:' + sym + ':' + id, t, () => construireSerie(sym, id))
          : await cache('ohlc:' + sym + ':' + id, t, () => construireOhlc(sym, id));
        return { code: 200, corps: enveloppe(r), ttl: t };
      } catch (e) { return { code: 200, ttl: 10, corps: indispo(e.raison || 'api', { symbole: sym, tf: id }) }; }
    }

    if (route === 'sante') {
      return { code: 200, ttl: 0, corps: { ok: true, moteur: 'lib/metaux.mjs', runtime: 'node ' + process.version,
        cle: lireCle() !== '', simulation: false, amont: BASE, ttl: TTL, tf: TF_ORDRE,
        metaux: METAUX.map(m => m.symbole) } };
    }

    return { code: 404, ttl: 0, corps: { erreur: 'route inconnue', routes: ['prix', 'serie', 'ohlc', 'capacites', 'sante'] } };
  } catch (e) {
    /* Aucun détail interne ne sort : ni chemin, ni trace, ni corps amont,
       ni — évidemment — la clé. */
    return { code: 200, ttl: 10, corps: indispo('api') };
  }
}

/* En-têtes communs aux deux entrées. s-maxage fait le vrai cache : sur
   Vercel c'est le réseau de diffusion qui absorbe le trafic, pas la
   fonction — et la source amont n'est appelée qu'une fois par TTL. */
export function enTetes(ttl) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': ttl > 0
      ? `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`
      : 'no-store',
  };
}
