/* scenes/carte3d-ui.js · Carte de France 3D — COQUILLE DOM / CSS ET LISTE DES VILLES (lot « carteui »)
   ----------------------------------------------------------------------------------------------------
   Independant du moteur 3D : ce module ne fait AUCUN rendu. Le moteur lui fournit la liste des communes
   une fois, puis, a chaque frame, la position ecran du pin actif ; ce module gere tout le DOM.

   L EXPERIENCE VIT DANS LA PAGE (§ 12 de la demande du client, disposition affinee au lot « carte-layout »)
   ---------------------------------------------------------------------------------------------------------
   « Quand j arrive sur la section, je vois la France avec les pins ET, a droite, la liste des villes ;
   je clique sur Colmar et la carte fait son animation. » La liste et le focus ne sont donc plus
   reserves au plein ecran : la section affiche, des l arrivee, une grille 35 / 65 — a GAUCHE (~35%)
   une colonne editoriale (kicker, titre, chapo, PUIS la liste des villes, dans le prolongement du
   texte plutot qu en sidebar separee), a DROITE (~65%) la grande carte. Le plein ecran n est plus
   qu une MISE EN GRAND de cette meme vue, proposee par un bouton « Agrandir » integre au coin de la
   carte (jamais flottant entre les blocs).

   UNE SEULE LISTE, DEPLACEE — JAMAIS DUPLIQUEE
   --------------------------------------------
   Le meme noeud `.c3d-list` (memes lignes, meme etat actif, meme position de defilement, meme
   tabulation roulante) est REPARENTE selon l endroit ou vit l experience — colonne de droite dans la
   page, panneau flottant en plein ecran, colonne du repli sans WebGL — exactement comme le moteur
   deplace son canvas d une scene a l autre. Il n existe donc pas deux listes a tenir synchronisees.
   L etiquette de la ville active (`.c3d-labels`) suit le meme chemin que le canvas.

   VERITE DES DONNEES : aucune ville n est ecrite ici. Tout vient de `cities` (issu de
   `window.COMPAGNIE_OR_VILLES`, coordonnees officielles). Un champ absent n est pas affiche.

   API
   ---
   createCarteUI(host, { reduced, mobile, fallback, inertPage }) -> {
     mount(),
     setCities(list),                    // [{ id, nom, dep, departement, region, journee }]
     setActive(id|null),                 // ville active : ligne de liste marquee, mise en avant
     setActiveLabel(item|null, pos),     // pos = { x, y, on, amt } en pixels dans le repere de la scene
     setHover(id|null),
     setPlace('page'|'full'),            // ou vit l experience
     setAmbiance('nuit'|'jour'), setSafeArea({ top, bottom }),
     listBand(),
     onIntent(cb) -> off(), setFallback(on), destroy(),
     stage, place, cities, stats()
   }

   INTENTS emis vers le moteur (ui.onIntent(cb)) :
     { type:'stage', el }        -> le moteur doit deplacer son canvas dans `el`
     { type:'place', place }     -> 'page' (dans la section) ou 'full' (plein ecran)
     { type:'reset' }            -> retour a la vue France entiere
     { type:'focus', id, item }  -> une ville a ete choisie dans la liste
     { type:'hover', id, item }  -> survol d une ligne de liste (id null au relachement)

   ORDRE D INTEGRATION : createCarteUI(...) -> ui.onIntent(handler) -> ui.mount().
   mount() emet immediatement { type:'stage', el } : si l abonnement arrive apres, le moteur
   ne saura pas ou deposer son canvas dans la page (carte invisible).                              */

const NS = 'c3d';

/* ---------- petits utilitaires ---------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = v => typeof v === 'number' && isFinite(v);
function el(tag, cls, parent, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  if (parent) parent.appendChild(n);
  return n;
}
function svgIcon(path, vb) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', vb || '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.3'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p); return s;
}
/* DEPLACEMENT D UN NOEUD SANS PERTE — retirer un element du document remet son `scrollTop` a zero.
   La liste garde donc sa position de defilement a la main : sans cela, passer en plein ecran alors
   qu on lisait « Provence-Alpes-Cote d Azur » renvoyait brutalement en tete de liste.            */
function reparent(node, parent) {
  if (!node || !parent || node.parentNode === parent) return;
  const boxes = node.querySelectorAll ? node.querySelectorAll('[data-keep-scroll]') : [];
  const saved = [];
  for (let i = 0; i < boxes.length; i++) saved.push(boxes[i].scrollTop);
  parent.appendChild(node);
  for (let i = 0; i < boxes.length; i++) boxes[i].scrollTop = saved[i];
}

/* ---------- libelles d interface (aucune donnee, aucun texte marketing) ---------- */
const KICKER = 'Territoires parcourus';
/* « Nos villes en France » POSSEDAIT les villes plus qu il ne les decrivait — et le mot « etapes »
   est deja pris par le chapeau de la section dans index.html. On dit donc ce que la carte montre
   vraiment : les communes ou La Compagnie de l Or se deplace. */
const TITLE = 'Les villes où nous nous déplaçons';
const LIST_T = 'Villes';
/* ---------- filtres (lot « carte-filtres ») : la liste des 111 communes ne se deroule plus d un
   bloc. On la reduit a DEUX commandes — une recherche et un choix de region — et la liste devient
   le RESULTAT de ces commandes. Aucune donnee nouvelle : tout vient de villes-france.js. ------- */
const FIND_PH = 'Rechercher une ville…';
const FIND_LB = 'Rechercher une ville';
const REG_LB = 'Filtrer par région';
const REG_ALL = 'Toutes les régions';
const REG_TOUTES = 'Toutes';        /* le rail est deja intitule : « les régions » y serait redondant */
/* comparaison INSENSIBLE AUX ACCENTS : « seles » doit trouver « Sélestat », sinon la recherche
   punit celui qui ne sait pas ou tombent les accents. */
const sansAccent = (v) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* ---------- entete EDITORIAL de la colonne de gauche, DANS LA PAGE (lot « carte-layout ») ----------
   Copie STRICTEMENT identique a l ancien entete statique de #journees dans index.html (kicker,
   titre, chapo) : elle ne fait que demenager pour vivre dans la meme colonne que la liste des
   villes (POLISH.md § 4 — grille 35 / 65 autour de la carte). Aucun mot invente, aucune donnee. */
const PAGE_KICKER = 'Partout en France';
const PAGE_TITLE = 'Les villes où nous nous déplaçons.';
const PAGE_LEDE = "La Compagnie de l'Or parcourt la France pour organiser ses journées d'expertise au plus près de ses clients. Explorez les territoires que nous couvrons, des grandes villes aux petites communes.";

const EDGE = 14;              /* marge de l etiquette par rapport aux bords de la scene */

export function createCarteUI(host, options) {
  const opts = options || {};
  if (!host) throw new Error('carte3d-ui : host manquant');

  const mqMobile = matchMedia('(max-width: 820px)');
  const mqCoarse = matchMedia('(hover: none), (pointer: coarse)');
  const mqReduced = matchMedia('(prefers-reduced-motion: reduce)');

  let reduced = opts.reduced != null ? !!opts.reduced : mqReduced.matches;
  let mobile = opts.mobile != null ? !!opts.mobile : (mqMobile.matches || mqCoarse.matches);
  let touch = opts.mobile != null ? !!opts.mobile : mqCoarse.matches;
  let ambiance = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';
  let fallback = !!opts.fallback;
  const inertPage = opts.inertPage !== false;

  let place = 'page';                 /* 'page' (dans la section) | 'full' (plein ecran) */
  let destroyed = false;
  let mounted = false;

  const listeners = [];
  const emit = (o) => { for (let i = 0; i < listeners.length; i++) { try { listeners[i](o); } catch (e) { /* un abonne ne casse pas les autres */ } } };

  /* =====================================================================
     DOM DE LA PAGE — grille 35 / 65 : colonne editoriale (tete + liste) a gauche, carte a droite
     ===================================================================== */
  const root = el('div', NS);                                   // calque pose DANS le host
  root.dataset.place = 'page';
  root.dataset.mobile = mobile ? '1' : '0';
  if (reduced) root.dataset.reduced = '1';

  const grid = el('div', NS + '__grid', root);

  /* COLONNE EDITORIALE (~35%) : kicker, titre, chapo — PUIS la liste (montee plus bas). Cree en
     PREMIER dans le DOM pour que l ordre de lecture / tabulation reste « tete, carte, liste »
     y compris en mobile, ou la disposition visuelle empile ces trois blocs dans cet ordre
     exact (POLISH.md § 4 et § 6). */
  const headCol = el('div', NS + '__head', grid);
  const headKicker = el('p', NS + '__kicker rv', headCol, PAGE_KICKER);
  headKicker.style.setProperty('--i', '0');
  const headTitle = el('h2', NS + '__title rv', headCol, PAGE_TITLE);
  headTitle.style.setProperty('--i', '1');
  const headLede = el('p', NS + '__lede rv', headCol, PAGE_LEDE);
  headLede.style.setProperty('--i', '2');

  const mapCol = el('div', NS + '__map', grid);
  const inlineStage = el('div', NS + '__stage', mapCol);        // le moteur y depose son canvas
  const sideCol = el('div', NS + '__side', grid);               // la liste y vient vivre, sous la tete

  /* outils discrets, poses sur le coin haut-droit de la carte — DANS la zone carte, jamais flottants */
  const tools = el('div', NS + '__tools', mapCol);

  /* LE BOUTON QUI OUVRE LA LISTE. Les cent onze communes ne sont plus deroulees
     sous la carte : la page ne porte plus que la carte et ce bouton, et la
     liste vit dans un dialogue qu on ouvre quand on la cherche. Son libelle
     reste ecrit meme en petit ecran, contrairement aux deux autres outils :
     c est la porte d entree, une icone seule ne la nommerait pas. */
  const btnVilles = el('button', NS + '-btn ' + NS + '-btn--villes', tools);
  btnVilles.type = 'button';
  btnVilles.appendChild(svgIcon('M8 1.9c-2.2 0-4 1.8-4 4 0 3 4 8.2 4 8.2s4-5.2 4-8.2c0-2.2-1.8-4-4-4Zm0 5.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z'));
  el('span', NS + '-btn__label ' + NS + '-btn__label--fort', btnVilles, 'Villes');
  btnVilles.setAttribute('aria-label', 'Choisir une ville');
  btnVilles.setAttribute('aria-haspopup', 'dialog');
  btnVilles.setAttribute('aria-expanded', 'false');

  const btnReset = el('button', NS + '-btn ' + NS + '-btn--reset', tools);
  btnReset.type = 'button';
  btnReset.appendChild(svgIcon('M13.4 8a5.4 5.4 0 1 1-1.7-3.9M13.3 2.4v2.6h-2.6'));
  el('span', NS + '-btn__label', btnReset, 'Vue France entière');
  btnReset.setAttribute('aria-label', 'Revenir à la vue France entière');
  btnReset.disabled = true;

  const btnFull = el('button', NS + '-btn ' + NS + '-btn--full', tools);
  btnFull.type = 'button';
  btnFull.appendChild(svgIcon('M6 2.6H2.6v3.4M10 2.6h3.4v3.4M10 13.4h3.4V10M6 13.4H2.6V10'));
  el('span', NS + '-btn__label', btnFull, 'Agrandir');
  btnFull.setAttribute('aria-label', 'Agrandir la carte');
  btnFull.setAttribute('aria-haspopup', 'dialog');
  btnFull.setAttribute('aria-expanded', 'false');

  /* ---------- indice de premiere visite (lot « carte-indice ») ----------
     Il ne s affiche qu une fois par visiteur, seulement quand la carte est REELLEMENT a
     l ecran, et il s efface au premier geste. Le souvenir tient dans localStorage : en
     navigation privee l ecriture echoue, on n en fait pas une erreur — l indice
     reapparaitra, ce qui est le comportement le moins genant. */
  const pageHint = el('p', NS + '-hint ' + NS + '-hint--page', mapCol,
    touch ? 'Faites glisser la carte pour la faire tourner' : 'Cliquez-glissez pour faire tourner la carte');
  pageHint.setAttribute('aria-hidden', 'true');

  let indiceIO = null, indiceT = 0;
  function eteindreIndice() {
    if (!root.dataset.indice) return;
    delete root.dataset.indice;
    clearTimeout(indiceT);
    mapCol.removeEventListener('pointerdown', eteindreIndice, true);
    try { localStorage.setItem('lc-carte-indice', '1'); } catch (e) { /* navigation privee */ }
  }
  function armerIndice() {
    let vu = false;
    try { vu = localStorage.getItem('lc-carte-indice') === '1'; } catch (e) { vu = false; }
    if (vu || reduced || fallback || typeof IntersectionObserver !== 'function') return;
    indiceIO = new IntersectionObserver((es) => {
      for (let i = 0; i < es.length; i++) {
        if (!es[i].isIntersecting) continue;
        indiceIO.disconnect(); indiceIO = null;
        root.dataset.indice = '1';
        mapCol.addEventListener('pointerdown', eteindreIndice, true);
        indiceT = setTimeout(eteindreIndice, 7000);
        return;
      }
    }, { threshold: 0.35 });
    indiceIO.observe(mapCol);
  }

  const fb = el('div', NS + '__fallback', root);
  const fbInner = el('div', NS + '__fallback-in', fb);
  const fbVisual = el('div', NS + '__fallback-visual', fbInner);   // la carte SVG de repli s y injecte
  const fbCol = el('div', NS + '__fallback-col', fbInner);
  el('p', NS + '__fallback-k', fbCol, KICKER);
  el('p', NS + '__fallback-t', fbCol, TITLE);

  /* =====================================================================
     PLEIN ECRAN (porte dans <body>) — la MEME vue, en grand
     ===================================================================== */
  const fs = el('div', NS + '-fs');
  fs.setAttribute('role', 'dialog');
  fs.setAttribute('aria-modal', 'true');
  fs.setAttribute('tabindex', '-1');
  fs.dataset.mobile = mobile ? '1' : '0';
  fs.dataset.touch = touch ? '1' : '0';
  if (reduced) fs.dataset.reduced = '1';

  el('div', NS + '-fs__scrim', fs);
  const fsStage = el('div', NS + '-fs__stage', fs);

  /* etiquette de la ville active : une seule, donc aucun anti-chevauchement a resoudre.
     Ce calque suit le canvas — dans la page comme en plein ecran, il recouvre EXACTEMENT la scene. */
  const labelsLayer = el('div', NS + '-labels');
  const label = el('div', NS + '-label', labelsLayer);
  el('i', NS + '-label__tie', label);
  const labelBox = el('span', NS + '-label__box', label);
  el('i', NS + '-label__dot', labelBox);
  const labelName = el('span', NS + '-label__name', labelBox);
  const labelDep = el('span', NS + '-label__dep', labelBox);

  const bar = el('div', NS + '-fs__bar', fs);
  const titleWrap = el('div', NS + '-fs__title', bar);
  const titleId = NS + '-title-' + Math.random().toString(36).slice(2, 8);
  el('span', NS + '-fs__kicker', titleWrap, KICKER);
  const hTitle = el('span', NS + '-fs__h', titleWrap, TITLE);
  hTitle.id = titleId;
  fs.setAttribute('aria-labelledby', titleId);

  const fsTools = el('div', NS + '-fs__tools', bar);
  const btnResetFs = el('button', NS + '-btn ' + NS + '-btn--reset', fsTools);
  btnResetFs.type = 'button';
  btnResetFs.appendChild(svgIcon('M13.4 8a5.4 5.4 0 1 1-1.7-3.9M13.3 2.4v2.6h-2.6'));
  el('span', NS + '-btn__label', btnResetFs, 'Vue France entière');
  btnResetFs.setAttribute('aria-label', 'Revenir à la vue France entière');
  btnResetFs.disabled = true;

  const btnClose = el('button', NS + '-btn ' + NS + '-btn--icon ' + NS + '-btn--close', fsTools);
  btnClose.type = 'button';
  btnClose.appendChild(svgIcon('M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4'));
  btnClose.setAttribute('aria-label', 'Réduire la carte');

  const hint = el('p', NS + '-hint', fs);

  /* =====================================================================
     LA MODALE DES VILLES — le troisieme contenant de la liste
     ---------------------------------------------------------------------
     La liste des cent onze communes n est plus deroulee sous la carte : la
     page ne montre que la carte et le bouton « Villes ». Le dialogue reprend
     EXACTEMENT le meme noeud de liste que le plein ecran et le repli — meme
     recherche, meme filtrage en direct, meme clavier, meme selection. Il n y
     a donc pas une deuxieme liste a tenir d accord avec la premiere : il y a
     un seul composant, et un contenant de plus.

     Il vit dans <body>, comme le plein ecran : pose dans la section, un
     `overflow` ou un `filter` d ancetre le decouperait ou le clouerait.
     ===================================================================== */
  const modale = el('div', NS + '-mod');
  modale.setAttribute('role', 'dialog');
  modale.setAttribute('aria-modal', 'true');
  modale.setAttribute('aria-label', 'Les villes où nous nous déplaçons');
  modale.tabIndex = -1;
  const modVoile = el('div', NS + '-mod__voile', modale);
  const modBoite = el('div', NS + '-mod__boite', modale);
  const modFermer = el('button', NS + '-btn ' + NS + '-btn--icon ' + NS + '-mod__x', modBoite);
  modFermer.type = 'button';
  modFermer.appendChild(svgIcon('M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4'));
  modFermer.setAttribute('aria-label', 'Fermer la liste des villes');
  const modCorps = el('div', NS + '-mod__corps', modBoite);

  /* =====================================================================
     LA LISTE — un seul exemplaire, deplace d un contenant a l autre
     ===================================================================== */
  const listUI = buildList();

  function buildList() {
    /* <section aria-label> = une REGION reperable par les lecteurs d ecran, valable aussi bien dans
       la page qu a l interieur du dialogue plein ecran. */
    const wrap = el('section', NS + '-list');
    wrap.setAttribute('aria-label', TITLE);
    const head = el('div', NS + '-list__head', wrap);
    el('p', NS + '-list__t', head, LIST_T);
    const compte = el('p', NS + '-list__compte', head, '');

    /* les deux commandes qui remplacent la liste deroulante de 111 lignes */
    const filtres = el('div', NS + '-filtres', wrap);
    const find = document.createElement('input');
    find.type = 'search';
    find.className = NS + '-find';
    find.placeholder = FIND_PH;
    find.setAttribute('aria-label', FIND_LB);
    find.autocomplete = 'off';
    filtres.appendChild(find);
    const reg = document.createElement('select');
    reg.className = NS + '-reg';
    reg.setAttribute('aria-label', REG_LB);
    filtres.appendChild(reg);

    /* Le rail : les treize regions ecrites, sur une ou deux lignes. Il porte
       le meme etat que le menu — l un est montre, l autre cache, selon la
       largeur, et jamais les deux a la fois. */
    const rail = el('div', NS + '-rail', wrap);
    rail.setAttribute('role', 'group');
    rail.setAttribute('aria-label', REG_LB);

    const scroll = el('div', NS + '-list__scroll', wrap);
    const vide = el('p', NS + '-list__vide', wrap, '');
    scroll.dataset.keepScroll = '1';
    scroll.id = NS + '-list-' + Math.random().toString(36).slice(2, 8);
    return { wrap, head, scroll, compte, filtres, find, reg, rail, vide, rows: new Map(), seq: [] };
  }

  /* =====================================================================
     LISTE DES VILLES — groupee par region, dans l ORDRE DU FICHIER
     ===================================================================== */
  let cities = [];
  let selId = null, hoverId = null;
  let query = '', regionSel = '';

  /* les regions VIENNENT DES DONNEES, dans l ordre du fichier : on n en ecrit aucune a la main. */
  function fillRegions() {
    const vues = [];
    for (let i = 0; i < cities.length; i++) {
      const r = cities[i].region;
      if (r && vues.indexOf(r) < 0) vues.push(r);
    }
    if (regionSel && vues.indexOf(regionSel) < 0) regionSel = '';
    listUI.reg.textContent = '';
    const tout = document.createElement('option');
    tout.value = ''; tout.textContent = REG_ALL;
    listUI.reg.appendChild(tout);
    for (let i = 0; i < vues.length; i++) {
      const o = document.createElement('option');
      o.value = vues[i]; o.textContent = vues[i];
      listUI.reg.appendChild(o);
    }
    listUI.reg.value = regionSel;

    /* le rail : « Toutes » puis les regions, dans l ordre du fichier */
    listUI.rail.textContent = '';
    const poser = (valeur, libelle) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = NS + '-rail__b';
      b.dataset.region = valeur;
      b.textContent = libelle;
      const on = valeur === regionSel;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', () => {
        /* on ecrit dans le menu, puis on passe par le MEME chemin que lui :
           deux commandes, une seule logique de filtrage. */
        listUI.reg.value = valeur;
        onFiltre();
      });
      listUI.rail.appendChild(b);
    };
    poser('', REG_TOUTES);
    for (let i = 0; i < vues.length; i++) poser(vues[i], vues[i]);
  }

  /* le rail suit l etat, d ou qu il vienne — clic sur le rail, choix dans le
     menu, ou ville choisie sur la carte qui recale la region. */
  function majRail() {
    if (!listUI.rail) return;
    for (const b of listUI.rail.querySelectorAll('.' + NS + '-rail__b')) {
      const on = (b.dataset.region || '') === regionSel;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* LA LISTE COMPLETE, TOUJOURS, PAR ORDRE ALPHABETIQUE.
     Elle ne montrait RIEN tant qu'une region n'etait pas choisie : il fallait
     donc savoir dans quelle region se trouve sa ville AVANT de pouvoir la
     chercher — l'inverse de ce qu'on demande a une liste de villes. Les
     regions ne filtrent plus rien ici ; les donnees, elles, sont intactes,
     chaque commune garde sa region et son departement. */
  function villesFiltrees() {
    const q = sansAccent(query).trim();
    const out = [];
    for (let i = 0; i < cities.length; i++) {
      const it = cities[i];
      if (q) {
        const nom = sansAccent(it.nom), dept = sansAccent(it.departement), dep = (it.dep || '') + '';
        if (nom.indexOf(q) < 0 && dept.indexOf(q) < 0 && dep.indexOf(q) !== 0) continue;
      }
      out.push(it);
    }
    return out;
  }

  function fillList() {
    listUI.scroll.textContent = '';
    listUI.rows.clear();
    listUI.seq.length = 0;
    const vues = villesFiltrees();
    /* UNE SEULE LISTE, SANS EN-TÊTES DE RÉGION. Elle était découpée en
       sections collantes par région ; avec la liste complète affichée en
       permanence, ces bandeaux couperaient l'ordre alphabétique en treize
       morceaux et l'on ne saurait plus où chercher un nom. */
    const group = el('ul', NS + '-grp__ul', listUI.scroll);
    for (let i = 0; i < vues.length; i++) {
      const it = vues[i];
      const li = el('li', null, group);
      const b = el('button', NS + '-city', li);
      /* une journee d expertise REELLE est publiee pour cette commune : la ligne se distingue.
         Rien d autre n est affiche — ni date, ni lieu, ni disponibilite (voir CARTE-VILLES.md). */
      if (it.journee) b.classList.add('is-journee');
      b.type = 'button'; b.tabIndex = -1;
      el('span', NS + '-city__n', b, it.nom || '');
      if (it.dep) el('span', NS + '-city__d', b, it.dep);
      b.setAttribute('aria-label', [it.nom, it.departement].filter(Boolean).join(', '));
      b.addEventListener('click', () => chooseCity(it));
      if (!touch) {
        b.addEventListener('pointerenter', () => { markHover(it.id); emit({ type: 'hover', id: it.id, item: it }); });
        b.addEventListener('pointerleave', () => { markHover(null); emit({ type: 'hover', id: null, item: null }); });
      }
      b.addEventListener('focus', () => { setRoving(listUI.seq.indexOf(b)); });
      listUI.seq.push(b);
      listUI.rows.set(it.id, b);
    }
    if (listUI.seq.length) listUI.seq[0].tabIndex = 0;
    roving = 0;

    /* Ce que dit le panneau quand il ne montre aucune ligne. Les nombres sont COMPTES sur les
       donnees reelles, jamais ecrits en dur : si le fichier des communes change, ils suivent. */
    const q = query.trim();
    const rien = vues.length === 0;
    listUI.vide.hidden = !rien;
    /* La liste n'est plus jamais vide « par défaut » : elle l'est seulement
       quand une recherche ne trouve rien. Le message d'invitation à choisir
       une région n'a donc plus lieu d'être. */
    if (rien) {
      listUI.vide.textContent = q
        ? 'Aucune commune ne correspond à « ' + q + ' ».'
        : 'Aucune commune à afficher.';
    }
    listUI.compte.textContent = vues.length ? vues.length + (vues.length > 1 ? ' communes' : ' commune') : '';
    listUI.wrap.dataset.vide = rien ? '1' : '0';
  }

  /* les deux commandes refont la liste — et rien d autre : la carte n est pas touchee, on ne veut
     pas qu une frappe au clavier deplace la camera. */
  function onFiltre() {
    query = listUI.find.value || '';
    /* le selecteur de region ne filtre plus : il est retire de l'interface
       (voir da-carte.css). On le laisse a vide pour que rien, ailleurs, ne
       croie qu'une region est active. */
    regionSel = '';
    fillList();
    majRail();
    markSelected();
    listUI.scroll.scrollTop = 0;
  }
  /* tabulation ROULANTE : une seule ligne dans le parcours de tabulation, les fleches font le reste.
     Sans cela, 111 arrets de tabulation separeraient la liste du reste de la page.               */
  let roving = 0;
  function setRoving(i) {
    if (i < 0 || !listUI.seq.length) return;
    roving = clamp(i, 0, listUI.seq.length - 1);
    for (let k = 0; k < listUI.seq.length; k++) listUI.seq[k].tabIndex = k === roving ? 0 : -1;
  }
  function moveRoving(delta, abs) {
    if (!listUI.seq.length) return;
    const i = abs != null ? abs : roving + delta;
    setRoving(i);
    const b = listUI.seq[roving];
    if (b) { b.focus({ preventScroll: true }); scrollRowIntoView(b); }
  }
  /* AMENER LA LIGNE DANS LA FENETRE — et la CENTRER quand la fenetre est courte.
     Dans la page en mobile, la liste ne montre que quatre ou cinq lignes : un simple calage sur le
     bord posait la ville choisie juste sous le fondu du bas, ou elle etait a moitie effacee.
     Sous huit lignes de haut, on la ramene donc au milieu ; au-dessus, le calage suffit et evite
     de faire sauter la liste a chaque fleche du clavier.                                          */
  function scrollRowIntoView(b, centre) {
    const box = listUI.scroll;
    const r = b.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (!br.height || !r.height) return;
    /* la ville CHOISIE se pose au milieu : on la lit avec ses voisines autour, et elle ne finit
       jamais sous le fondu du bas. La navigation au clavier, elle, se contente de rentrer la
       ligne dans le cadre — sinon la liste sauterait a chaque fleche.                          */
    if (centre || br.height < r.height * 8) {
      box.scrollTop += (r.top + r.height / 2) - (br.top + br.height / 2);
      return;
    }
    if (r.top < br.top + 10) box.scrollTop -= (br.top + 10 - r.top);
    else if (r.bottom > br.bottom - 26) box.scrollTop += (r.bottom - br.bottom + 26);   /* 20 px de fondu + marge */
  }
  function setCities(next) {
    if (destroyed) return;
    cities = Array.isArray(next) ? next.slice() : [];
    /* ordre alphabetique francais : « Élancourt » se range entre « Egletons »
       et « Epinal », et « Saint-Étienne » ne part pas a la fin. localeCompare
       s'en charge, un tri brut sur les codes de caracteres non. */
    cities.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { sensitivity: 'base' }));
    fillRegions();
    fillList();
    if (selId != null && !cities.some(c => c.id === selId)) selId = null;
    markSelected();
  }
  function markSelected() {
    for (const [id, b] of listUI.rows) {
      const on = id === selId;
      b.classList.toggle('is-sel', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    /* repli sans WebGL : le point de la carte SVG suit la ligne choisie (meme `id`) */
    const dots = fbVisual.querySelectorAll('[data-city]');
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('is-sel', dots[i].dataset.city === selId);
    root.dataset.sel = selId ? '1' : '0';
    fs.dataset.sel = selId ? '1' : '0';
    /* PAS DE BOUTON FANTOME : « Vue France entiere » n a aucun sens tant qu aucune ville n est
       choisie. Un bouton grise reste annonce par les lecteurs d ecran et encombre le coin de la
       carte — on le retire du document, il revient avec la selection.                            */
    btnReset.hidden = !selId; btnReset.disabled = !selId;
    btnResetFs.hidden = !selId; btnResetFs.disabled = !selId;
  }
  function markHover(id) {
    if (hoverId === id) return;
    if (hoverId != null) { const b = listUI.rows.get(hoverId); if (b) b.classList.remove('is-hot'); }
    hoverId = id;
    if (id != null) { const b = listUI.rows.get(id); if (b) b.classList.add('is-hot'); }
  }
  function setActive(id) {
    if (destroyed) return;
    selId = id == null ? null : id;
    /* La ville vient peut-etre d un pin de la carte, hors du filtre courant : le panneau se cale
       alors sur SA region plutot que de rester muet. La carte commande, la liste suit. */
    if (selId != null && !listUI.rows.has(selId)) {
      const it = cities.find(c => c.id === selId);
      if (it && it.region) {
        query = ''; listUI.find.value = '';
        regionSel = it.region; listUI.reg.value = it.region;
        fillList();
        majRail();
      }
    }
    markSelected();
    if (selId != null) {
      const b = listUI.rows.get(selId);
      if (b) { const i = listUI.seq.indexOf(b); if (i >= 0) setRoving(i); scrollRowIntoView(b, true); }
    } else setLabel(null);
  }

  /* =====================================================================
     ETIQUETTE DE LA VILLE ACTIVE
     Une seule etiquette : elle suit le pin et se pose du cote ou il y a de la place.
     ===================================================================== */
  let labelOn = false, labelId = null;
  /* AUCUNE LECTURE DE MISE EN PAGE PAR IMAGE — le moteur appelle `setActiveLabel` a CHAQUE frame.
     Mesurer la scene, la liste et le cadre de l etiquette a chaque appel forcerait un recalcul de
     mise en page 60 fois par seconde (interdit par la charte 10K). Ces quatre nombres ne changent
     qu au redimensionnement, au changement de place et au changement de ville : on les cache, et la
     frame ne fait plus que poser un `transform`.                                                  */
  const LM = { w: 120, h: 26, limT: EDGE, limR: 1e9, limB: 1e9, dirty: true };
  function measureLabel() {
    LM.dirty = false;
    const r = labelsLayer.getBoundingClientRect();
    LM.w = labelBox.offsetWidth || 120;
    LM.h = labelBox.offsetHeight || 26;
    LM.limR = r.width - EDGE;
    LM.limB = r.height - EDGE;
    /* LES OUTILS SONT UNE ZONE INTERDITE. Dans la page ils sont poses sur le coin haut-droit de la
       carte ; une etiquette placee « au-dessus du pin » venait s ecrire dessous des que la commune
       etait au nord (Lille, Colmar, Dunkerque). On releve donc le plafond de l etiquette au bas des
       boutons : elle bascule alors SOUS son pin plutot que de passer derriere eux.               */
    LM.limT = EDGE;
    if (place === 'page') {
      const tb = tools.getBoundingClientRect();
      if (tb.height && r.height) LM.limT = Math.max(EDGE, tb.bottom - r.top + 8);
    }
    /* EN PLEIN ECRAN, LA LISTE EST UNE ZONE INTERDITE : elle flotte AU-DESSUS de la scene et une
       etiquette posee « a droite du pin » disparaissait dessous des que la ville etait a l est
       (Marseille, Nice, Strasbourg). Dans la PAGE, la liste est une colonne VOISINE : la scene
       s arrete a son bord, il n y a plus rien a retrancher.                                      */
    if (place === 'full') {
      const lb = listUI.wrap.getBoundingClientRect();
      if (!mobile && lb.width) LM.limR = Math.min(LM.limR, lb.left - r.left - 10);
      if (mobile && lb.height) LM.limB = Math.min(LM.limB, lb.top - r.top - 10);
    }
  }
  function setLabel(item, pos) {
    if (destroyed) return;
    if (!item || !pos || pos.on === false || !isNum(pos.x) || !isNum(pos.y)) {
      if (labelOn) { labelOn = false; label.classList.remove('is-on'); }
      labelId = null;
      return;
    }
    if (item.id !== labelId) {
      labelId = item.id;
      labelName.textContent = item.nom || '';
      labelDep.textContent = item.dep || '';
      labelDep.hidden = !item.dep;
      label.classList.toggle('is-journee', !!item.journee);
      LM.dirty = true;                     /* le nom a change : le cadre aussi */
    }
    if (LM.dirty) measureLabel();
    const w = LM.w, h = LM.h;
    const gap = mobile ? 13 : 17;
    /* a droite du pin par defaut ; a gauche si la place manque */
    let bx = gap, by = -h - gap * 0.7;
    if (pos.x + gap + w > LM.limR) bx = -gap - w;
    if (pos.y - h - gap < LM.limT) by = gap * 0.7;
    if (pos.y + by + h > LM.limB) by = -h - gap * 0.7;
    const ax = clamp(0, bx, bx + w), ay = clamp(0, by, by + h);
    const len = Math.hypot(ax, ay);
    const st = label.style;
    st.transform = 'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0)';
    st.setProperty('--bx', bx.toFixed(1) + 'px');
    st.setProperty('--by', by.toFixed(1) + 'px');
    st.setProperty('--ta', (len > 0.5 ? Math.atan2(ay, ax) : 0).toFixed(4) + 'rad');
    st.setProperty('--tie', Math.max(0, len - 5).toFixed(1) + 'px');
    st.setProperty('--amt', clamp(isNum(pos.amt) ? pos.amt : 1, 0, 1).toFixed(3));
    if (!labelOn) { labelOn = true; label.classList.add('is-on'); }
  }

  /* =====================================================================
     INTENTIONS
     ===================================================================== */
  function chooseCity(it) {
    if (!it) return;
    setActive(it.id);
    /* LA MODALE S EFFACE AVANT LE MOUVEMENT. Choisir une ville, c est demander
       a VOIR la carte : la garder ouverte pendant que la camera remonte a la
       France entiere puis redescend, ce serait cacher exactement ce qu on
       vient de demander. On la ferme d abord, le voyage se joue ensuite. */
    if (modOuverte) fermerModale(true);
    emit({ type: 'focus', id: it.id, item: it });      /* meme animation dans la page qu en grand */
  }
  function requestReset() {
    if (!selId) return;
    setActive(null);
    emit({ type: 'reset' });
  }
  listUI.find.addEventListener('input', onFiltre);
  listUI.reg.addEventListener('change', onFiltre);
  /* Entree sur le champ : on ouvre la premiere ville trouvee — le geste attendu d une recherche. */
  listUI.find.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const b = listUI.seq[0];
    if (b) b.click();
  });

  btnReset.addEventListener('click', requestReset);
  btnResetFs.addEventListener('click', requestReset);
  btnFull.addEventListener('click', () => applyPlace('full'));
  btnClose.addEventListener('click', () => applyPlace('page'));

  /* =====================================================================
     PLACE, VERROU DE DEFILEMENT, PIEGE DE FOCUS, CLAVIER
     ===================================================================== */
  let scrollY = 0, locked = false, savedBody = null, savedScrollBehavior = '', opener = null;
  const inerted = [];

  function lockScroll() {
    if (locked) return; locked = true;
    scrollY = window.scrollY || window.pageYOffset || 0;
    const b = document.body, de = document.documentElement;
    const sbw = window.innerWidth - de.clientWidth;
    savedScrollBehavior = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    savedBody = { position: b.style.position, top: b.style.top, left: b.style.left, right: b.style.right, width: b.style.width, overflow: b.style.overflow, paddingRight: b.style.paddingRight };
    const padNow = parseFloat(getComputedStyle(b).paddingRight) || 0;
    b.style.position = 'fixed';
    b.style.top = (-scrollY) + 'px';
    b.style.left = '0'; b.style.right = '0'; b.style.width = '100%';
    b.style.overflow = 'hidden';
    if (sbw > 0) b.style.paddingRight = (padNow + sbw) + 'px';   // aucune secousse de mise en page
  }
  function unlockScroll() {
    if (!locked) return; locked = false;
    const b = document.body, de = document.documentElement;
    if (savedBody) { for (const k in savedBody) b.style[k] = savedBody[k]; savedBody = null; }
    window.scrollTo(0, scrollY);                                  // restauration EXACTE
    de.style.scrollBehavior = savedScrollBehavior;
  }
  function setInert(on) {
    if (!inertPage || !('inert' in HTMLElement.prototype)) return;
    if (on) {
      const kids = document.body.children;
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        /* le plein ecran ET la modale des villes restent joignables : ce sont
           les deux seuls calques qui peuvent etre au-dessus de la page */
        if (n === fs || n.contains(fs) || n === modale || n.contains(modale)) continue;
        if (!n.inert) { n.inert = true; inerted.push(n); }
      }
    } else { while (inerted.length) inerted.pop().inert = false; }
  }
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables() {
    return Array.prototype.filter.call(fs.querySelectorAll(FOCUSABLE), n => {
      if (n.hidden || n.closest('[hidden]') || n.closest('[inert]')) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  /* clavier DE LA LISTE — actif partout ou elle vit (page comme plein ecran) */
  function onListKey(ev) {
    if (destroyed) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveRoving(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); moveRoving(-1); return; }
    if (ev.key === 'Home') { ev.preventDefault(); moveRoving(0, 0); return; }
    if (ev.key === 'End') { ev.preventDefault(); moveRoving(0, listUI.seq.length - 1); return; }
    if (ev.key === 'PageDown') { ev.preventDefault(); moveRoving(10); return; }
    if (ev.key === 'PageUp') { ev.preventDefault(); moveRoving(-10); return; }
    if (ev.key === 'Escape' && place === 'page' && selId) { ev.preventDefault(); requestReset(); }
  }
  listUI.wrap.addEventListener('keydown', onListKey);
  /* clavier DU PLEIN ECRAN — Echap et piege de focus, uniquement quand il est ouvert */
  function onKey(ev) {
    if (place !== 'full' || destroyed) return;
    if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      if (selId) { requestReset(); btnClose.focus(); return; }
      applyPlace('page'); return;
    }
    if (ev.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { ev.preventDefault(); fs.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    const act = document.activeElement;
    if (ev.shiftKey && (act === first || !fs.contains(act))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (act === last || !fs.contains(act))) { ev.preventDefault(); first.focus(); }
  }

  /* =====================================================================
     OUVRIR ET FERMER LA MODALE DES VILLES
     ---------------------------------------------------------------------
     Meme discipline que le plein ecran : la page passe `inert`, le
     defilement est verrouille sans secousse, le focus entre dans le champ de
     recherche — on peut donc taper le nom d une ville sans rien viser — et
     revient au bouton a la fermeture. Echap, le voile et la croix ferment.
     ===================================================================== */
  let modOuverte = false, modOpener = null;

  function focusablesMod() {
    return Array.prototype.filter.call(modale.querySelectorAll(FOCUSABLE), n => {
      if (n.hidden || n.closest('[hidden]') || n.closest('[inert]')) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function onModKey(ev) {
    if (!modOuverte || destroyed) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fermerModale(true); return; }
    if (ev.key !== 'Tab') return;
    const list = focusablesMod();
    if (!list.length) { ev.preventDefault(); modale.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    const act = document.activeElement;
    if (ev.shiftKey && (act === first || !modale.contains(act))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (act === last || !modale.contains(act))) { ev.preventDefault(); first.focus(); }
  }
  function ouvrirModale() {
    if (modOuverte || destroyed || fallback || place === 'full') return;
    modOuverte = true;
    const act = document.activeElement;
    modOpener = act && act !== document.body && typeof act.focus === 'function' ? act : btnVilles;
    lockScroll();
    modale.classList.add('is-live');
    setInert(true);
    btnVilles.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onModKey, true);
    /* ON OUVRE TOUJOURS SUR LA LISTE COMPLETE. La recherche precedente restait
       ecrite dans le champ : apres avoir choisi Brest, rouvrir la modale ne
       montrait plus qu une seule commune, et il fallait effacer soi-meme pour
       revoir les cent onze. Le dialogue s ouvre donc net. */
    if (listUI.find.value) { listUI.find.value = ''; onFiltre(); }
    /* la recherche prend le focus : on ouvre et on tape, sans viser le champ */
    requestAnimationFrame(() => {
      if (!modOuverte) return;
      listUI.find.focus({ preventScroll: true });
      /* et la ville deja choisie, s il y en a une, est amenee sous les yeux */
      const b = selId != null ? listUI.rows.get(selId) : null;
      if (b) scrollRowIntoView(b, true);
    });
  }
  function fermerModale(rendreFocus) {
    if (!modOuverte) return;
    modOuverte = false;
    modale.classList.remove('is-live');
    setInert(false);
    unlockScroll();
    btnVilles.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onModKey, true);
    if (rendreFocus) {
      const back = modOpener && document.contains(modOpener) ? modOpener : btnVilles;
      if (back && back.focus) back.focus({ preventScroll: true });
    }
    modOpener = null;
  }
  btnVilles.addEventListener('click', () => { modOuverte ? fermerModale(true) : ouvrirModale(); });
  modFermer.addEventListener('click', () => fermerModale(true));
  modVoile.addEventListener('click', () => fermerModale(true));

  let hintTimer = 0, introTimer = 0;
  /* LA LISTE ET L ETIQUETTE SUIVENT LA SCENE — un seul exemplaire de chaque, reparente.
     Dans la page, son foyer est desormais le corps de la modale : la colonne
     `sideCol` de la grille reste vide, et la page ne montre plus de liste. */
  function homeList() { return fallback ? fbCol : (place === 'full' ? fs : modCorps); }
  function homeLabels() { return place === 'full' ? fs : mapCol; }

  function applyPlace(next) {
    const p = next === 'full' ? 'full' : 'page';
    if (p === place || destroyed) return;
    if (p === 'full' && fallback) return;                 /* sans WebGL, rien a agrandir */
    const was = place;
    place = p;
    root.dataset.place = p;
    fs.dataset.place = p;
    LM.dirty = true;
    btnFull.setAttribute('aria-expanded', p === 'full' ? 'true' : 'false');

    if (p === 'full') {
      /* un seul calque a la fois : la liste ne peut pas etre dans deux
         contenants, et deux verrous de defilement se marcheraient dessus */
      if (modOuverte) fermerModale(false);
      /* a qui rendre le focus a la reduction : l element reellement actif, jamais <body> */
      const act = document.activeElement;
      opener = act && act !== document.body && typeof act.focus === 'function' ? act : btnFull;
      lockScroll();
      fs.classList.add('is-live');
      setInert(true);
      reparent(listUI.wrap, fs);
      reparent(labelsLayer, fs);
      emit({ type: 'stage', el: fsStage });
      emit({ type: 'place', place: 'full' });
      document.addEventListener('keydown', onKey, true);
      requestAnimationFrame(() => { if (place === 'full') fs.focus({ preventScroll: true }); });
      clearTimeout(hintTimer);
      hint.classList.remove('is-gone');
      hint.textContent = touch ? 'Touchez une ville de la liste' : 'Choisissez une ville · glissez pour explorer';
      if (!reduced) hintTimer = setTimeout(() => hint.classList.add('is-gone'), 6200);
    } else if (was === 'full') {
      fs.classList.remove('is-live');
      markHover(null);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keydown', onModKey, true);
      setInert(false);
      clearTimeout(hintTimer); clearTimeout(introTimer);
      nettoyerIndice();
      reparent(listUI.wrap, homeList());
      reparent(labelsLayer, mapCol);
      emit({ type: 'stage', el: inlineStage });
      emit({ type: 'place', place: 'page' });
      unlockScroll();
      const back = opener && document.contains(opener) ? opener : btnFull;
      if (back && back.focus) back.focus({ preventScroll: true });
      opener = null;
    }
    markSelected();
  }

  /* =====================================================================
     MESURES POUR LE CADRAGE DU MOTEUR
     ===================================================================== */
  /* BANDE DE LA LISTE — largeur reellement recouverte par le panneau flottant du PLEIN ECRAN.
     Dans la page, la liste est une colonne voisine : elle ne recouvre rien, la bande vaut 0 et la
     France se cadre dans toute la largeur de sa propre colonne.                                  */
  function listBand() {
    if (destroyed || mobile || fallback || place !== 'full') return 0;
    const r = fs.getBoundingClientRect();
    const b = listUI.wrap.getBoundingClientRect();
    if (!r.width || !b.width) return 0;
    return clamp(Math.round(r.right - b.left + 14), 0, Math.round(r.width * 0.46));
  }
  /* BANDES RESERVEES PAR LE CADRAGE — le moteur sait combien de pixels il laisse libres au-dessus
     et au-dessous du territoire ; la liste ancree du plein ecran mobile s y pose AU PIXEL.        */
  function setSafeArea(band) {
    if (destroyed || !band) return;
    const t = Math.max(0, Math.round(+band.top || 0)), b = Math.max(0, Math.round(+band.bottom || 0));
    fs.style.setProperty('--c3d-band-t', t + 'px');
    fs.style.setProperty('--c3d-band-b', b + 'px');
  }

  /* =====================================================================
     AMBIANCE / RESPONSIVE / REPLI
     ===================================================================== */
  function setAmbiance(m) {
    ambiance = m === 'jour' ? 'jour' : 'nuit';
    root.dataset.ambiance = ambiance; fs.dataset.ambiance = ambiance;
  }
  const ambMO = new MutationObserver(() => {
    const m = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';
    if (m !== ambiance) setAmbiance(m);
  });

  function applyForm() {
    root.dataset.mobile = mobile ? '1' : '0';
    fs.dataset.mobile = mobile ? '1' : '0';
    fs.dataset.touch = touch ? '1' : '0';
  }
  function onForm() {
    if (opts.mobile != null) return;
    const m = mqMobile.matches || mqCoarse.matches;
    if (m === mobile) return;
    mobile = m; touch = mqCoarse.matches;
    LM.dirty = true;
    applyForm();
  }
  const onResize = () => { LM.dirty = true; };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;

  function nettoyerIndice() {
    if (indiceIO) { indiceIO.disconnect(); indiceIO = null; }
    clearTimeout(indiceT);
    mapCol.removeEventListener('pointerdown', eteindreIndice, true);
  }

  function setFallback(on) {
    const next = !!on;
    if (next === fallback && mounted) return;
    fallback = next;
    root.dataset.fallback = fallback ? '1' : '0';
    if (fallback && place === 'full') applyPlace('page');
    if (mounted) reparent(listUI.wrap, homeList());
  }

  /* =====================================================================
     CYCLE DE VIE
     ===================================================================== */
  function mount() {
    armerIndice();
    if (mounted || destroyed) return api;
    mounted = true;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(root);
    document.body.appendChild(fs);        // presente des le montage (invisible) : mesurable
    document.body.appendChild(modale);    // idem : dans <body>, hors de tout `overflow` d ancetre
    reparent(listUI.wrap, homeList());
    reparent(labelsLayer, mapCol);
    setAmbiance(ambiance);
    root.dataset.fallback = fallback ? '1' : '0';
    applyForm();
    ambMO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });
    if (ro) { ro.observe(host); ro.observe(fs); }
    window.addEventListener('resize', onResize, { passive: true });
    if (mqMobile.addEventListener) { mqMobile.addEventListener('change', onForm); mqCoarse.addEventListener('change', onForm); }
    emit({ type: 'stage', el: inlineStage });
    return api;
  }

  const api = {
    mount,
    setCities,
    setActive,
    setActiveLabel: setLabel,
    setHover(id) { markHover(id); },
    setPlace: applyPlace,
    setSafeArea,
    listBand,
    setAmbiance,
    onIntent(cb) { if (typeof cb === 'function') { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; } return () => { }; },
    setFallback,
    get stage() { return place === 'full' ? fsStage : inlineStage; },
    get place() { return place; },
    get cities() { return cities; },
    stats() {
      return {
        villes: cities.length,
        regions: new Set(cities.map(c => c.region)).size,
        lignes: listUI.rows.size,
        liste_dans: listUI.wrap.parentNode === modCorps ? 'modale' : (listUI.wrap.parentNode === fs ? 'plein-ecran' : (listUI.wrap.parentNode === sideCol ? 'page' : 'repli')),
        modale_ouverte: modOuverte,
        etiquette: labelOn ? labelId : null,
        active: selId, place, mobile, ambiance, fallback
      };
    },
    destroy() {
      if (destroyed) return;
      if (place === 'full') applyPlace('page');
      fermerModale(false);
      destroyed = true;
      clearTimeout(hintTimer); clearTimeout(introTimer);
      nettoyerIndice();
      document.removeEventListener('keydown', onKey, true);
      listUI.wrap.removeEventListener('keydown', onListKey);
      if (mqMobile.removeEventListener) { mqMobile.removeEventListener('change', onForm); mqCoarse.removeEventListener('change', onForm); }
      window.removeEventListener('resize', onResize);
      ambMO.disconnect(); if (ro) ro.disconnect();
      setInert(false); unlockScroll();
      listeners.length = 0;
      listUI.wrap.remove(); labelsLayer.remove();
      root.remove(); fs.remove(); modale.remove();
    },
    _dbg: { root, fs, modale, modCorps, grid, headCol, mapCol, sideCol, labelsLayer, label, listUI, fbVisual, btnFull, btnReset, btnVilles, get seq() { return listUI.seq; }, get modOuverte() { return modOuverte; } }
  };

  return api;
}

export default createCarteUI;
