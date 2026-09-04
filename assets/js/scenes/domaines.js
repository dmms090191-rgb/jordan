/* scenes/domaines.js · Section « Nos domaines d'expertise » (#domaines) — finition + Lecture / Pause
   Remplace le bloc 3 de accueil-sections.js. Liste de 12 categories + cadre media flottant.
   - Deux couches media A/B (img + video) : fondu-enchaine ~520 ms (la couche entrante passe au-dessus et fond, la sortante reste
     pleine jusqu'au bout : dissolve lineaire, aucun creux de luminosite), la nouvelle image arrive en scale 1.05 -> 1 + 6 px,
     Ken Burns ultra lent (1 -> 1.04, ~12 s, alterne) sur la couche active, parallaxe ±6 px du bloc media (inverse du tilt du cadre).
   - La video de la categorie (data-video) est mise en cache des la selection (et meme des le survol : prechauffage sur la couche
     libre) mais ne DEMARRE qu'au moment ou elle est revelee (aucune seconde perdue a jouer cachee), et seulement si la section est
     visible (et onglet actif). Un seul changement de sujet par selection : si sa 1re image est prete au depart du fondu-enchaine
     (grace de 300 ms si elle est en cours de chargement), c'est elle qui fond ; sinon l'image fixe fond, puis la video est revelee
     APRES le fondu-enchaine en un fondu court (.65 s, scale 1.012 -> 1).
   - Liste : etat actif (is-active, losange, odometre du numero) applique IMMEDIATEMENT, meme pendant un fondu ; seul le fondu media
     est mis en file. Legende : sort des la selection, le nouveau texte arrive avec le media (ou avec l'image en reseau lent).
   - Lecture / Pause (bouton + filet de progression crees par le module dans .dom__stage) : sequence 01 -> 12, chaque video jouee
     jusqu'a son evenement `ended` (repli minuteur 4,5 s ; duree reelle video.duration des qu'elle est connue), fondu-enchaine vers la
     suivante (prechauffee pendant la lecture), pause propre (video figee, reprise depuis la meme categorie), fin apres 12 -> manuel
     (nouveau clic : repart de 01), survol inactif pendant la lecture, clic item = saut puis la sequence continue, attente hors
     ecran / onglet cache / stop().
     ETAT EN MEMOIRE UNIQUEMENT (variables du module) : aucun localStorage, aucune base, chaque onglet demarre en manuel.
   - reduced : swap instantane, aucune video, aucun mouvement ; Lecture = minuteurs.
   - Vitesse de la sequence (x1/x2/x4/x8, boutons discrets crees par le module a cote de Lecture/Pause) : multiplie UNIQUEMENT le
     rythme d'avancement entre categories (delai avant `advance()`, minuteur ou garde apres la video) ; la video de la categorie
     joue au debit choisi (playbackRate suit la vitesse), et l'instant ou l'on bascule vers la suivante suit le meme facteur.
     x1 = comportement historique inchange au bit pres. Etat en memoire uniquement (module), jamais persiste.
   - Fusion liste/scene : le filet or sous le nom de la categorie active se prolonge legerement au-dela de la liste, vers le cadre
     (continuite graphique), et le cadre perd son relief de « lecteur video » (ombre/relief tres attenues, tilt reduit) pour mieux
     s'integrer a la page. Aucune donnee, aucun data-attribute, aucune source video/anim n'est modifiee par ces ajustements.
   API : initDomaines(section, { reduced, hoverSelect = true, hoverDelay = 160, pointer = true })
         -> { destroy(), start(), stop(), setPointer(x, y), setAmbiance(mode), show(i, instant), get index, ready (Promise),
              play(), pause(), get playing, get speed, setSpeed(n) } */

const FINE = matchMedia('(pointer: fine)');
const NARROW = matchMedia('(max-width: 820px)');     // meme seuil que accueil-sections.css (cadre a plat, pastilles)
const FADE = 520;          // fondu-enchaine des couches
const CAP_OUT = 250;       // sortie de la legende avant remplacement (nom 220 ms, ligne decalee de 50 ms)
const ODO = 420;           // roulement des chiffres
const DECODE_MAX = 1800;   // plafond d'attente du decodage de la nouvelle image avant le fondu (au-dela : la couche part, l'image fond a son arrivee)
const GRACE = 300;         // grace avant le fondu-enchaine si la video de la categorie est en cours de chargement (chemin direct ancien -> video)
const LATE_FADE = 480;     // reseau lent : fondu de l'image a son arrivee, puis extinction de la couche sortante
const LATE_MAX = 8000;     // garde-fou : on termine le fondu meme si l'image n'arrive jamais
const DUR_DEFAULT = 4500;  // lecture : duree nominale d'une categorie quand la video n'est pas lisible (erreur, reduced, play() refuse)
const DUR_BY_N = { '03': 5000 };   // Montres (video 5,04 s) ; la duree reelle video.duration prime des qu'elle est connue ; data-dur="5" accepte aussi
const GUARD = 2500;        // lecture : marge apres la fin theorique de la video (reseau) avant de passer quand meme
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = n => String(n).padStart(2, '0');
const abs = u => { try { return new URL(u, location.href).href; } catch (e) { return u; } };
const loaded = img => !!(img && img.complete && img.naturalWidth);
const now = () => performance.now();

/* attend que l'image soit decodee (resout true) ; resout false si elle n'est pas la au bout de `max` ms ou en erreur */
function waitDecode(img, max = DECODE_MAX) {
  return new Promise(res => {
    let done = false; const f = ok => () => { if (!done) { done = true; res(!!ok); } };
    if (loaded(img)) return f(true)();
    if (img.decode) img.decode().then(f(true), () => { if (loaded(img)) f(true)(); });
    img.addEventListener('load', f(true), { once: true }); img.addEventListener('error', f(false), { once: true });
    setTimeout(() => f(loaded(img))(), max);
  });
}

/* Couches media : accepte le nouveau markup (.dom__media > .dom__layer x2 > .dom__kb > img + video)
   et, a defaut, met a niveau l'ancien (img.dom__img + video.dom__video directement dans .dom__frame). */
function ensureLayers(frame) {
  let media = frame.querySelector('.dom__media');
  if (!media) {
    media = document.createElement('div'); media.className = 'dom__media'; media.setAttribute('aria-hidden', 'true');
    const oldImg = frame.querySelector('img'), oldVid = frame.querySelector('video');
    const mkLayer = (img, vid, on) => {
      const L = document.createElement('div'); L.className = 'dom__layer' + (on ? ' is-on' : ''); L.dataset.layer = on ? 'a' : 'b';
      const kb = document.createElement('div'); kb.className = 'dom__kb'; L.appendChild(kb);
      if (!img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.className = 'dom__img'; }
      if (!vid) { vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.preload = 'none'; vid.setAttribute('aria-hidden', 'true'); vid.tabIndex = -1; vid.className = 'dom__video'; }
      kb.appendChild(img); kb.appendChild(vid); return L;
    };
    media.appendChild(mkLayer(oldImg, oldVid, true)); media.appendChild(mkLayer(null, null, false));
    frame.insertBefore(media, frame.firstChild);
  }
  const layers = [...media.querySelectorAll('.dom__layer')].slice(0, 2);
  while (layers.length < 2) { const L = document.createElement('div'); L.className = 'dom__layer'; L.innerHTML = '<div class="dom__kb"><img alt="" decoding="async"><video muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video></div>'; media.appendChild(L); layers.push(L); }
  return { media, layers: layers.map(el => ({ el, kb: el.querySelector('.dom__kb') || el, img: el.querySelector('img'), video: el.querySelector('video'), vsrc: '', armed: false, idx: -1 })) };
}

const SPEEDS = [1, 2, 4, 8];   // vitesse REELLE de lecture : debit des videos ET rythme d'avancement, du meme facteur
/* Vitesse retenue au chargement. Elle sert a TROIS endroits qui doivent
   s'accorder : l'etat initial des boutons, la variable de lecture, et le
   debit pose sur chaque video par playV(). Une seule constante evite
   qu'un bouton annonce x1 pendant que les videos jouent a x4. */
const SPEED_DEFAUT = 4;

/* Bouton Lecture / Pause + vitesses x1/x2/x4/x8 + filet de progression (12 segments), crees par le module sous le cadre
   (aucun markup a inserer). Lecture/Pause et vitesses partagent une meme rangee discrete a droite (.dom__ctl). */
function createControls(host, frame, note, total) {
  const seq = document.createElement('div'); seq.className = 'dom__seq'; seq.setAttribute('aria-hidden', 'true');
  const segs = [], fills = [];
  for (let k = 0; k < total; k++) { const s = document.createElement('span'); s.className = 'dom__seq-s'; const f = document.createElement('i'); f.className = 'dom__seq-f'; s.appendChild(f); seq.appendChild(s); segs.push(s); fills.push(f); }
  const ctlWrap = document.createElement('div'); ctlWrap.className = 'dom__ctl';
  const speedEl = document.createElement('div'); speedEl.className = 'dom__speed'; speedEl.setAttribute('role', 'group'); speedEl.setAttribute('aria-label', 'Vitesse de la séquence');
  /* VITESSE PAR DEFAUT : x4. Le bouton doit donc paraitre actif des le
     premier rendu, avant meme que la sequence ne demarre — sinon l interface
     annoncerait x1 pendant que les videos jouent a x4. */
  const speedBtns = SPEEDS.map(v => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dom__speed-b' + (v === SPEED_DEFAUT ? ' is-on' : '');
    b.dataset.speed = String(v); b.setAttribute('aria-pressed', v === SPEED_DEFAUT ? 'true' : 'false'); b.textContent = '×' + v;
    speedEl.appendChild(b); return b;
  });
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dom__play'; btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<span class="dom__play-ico" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path class="p-tri" d="M2.6 1.3 11.2 6 2.6 10.7Z"/><rect class="p-bar p-bar--l" x="2" y="1.5" width="3" height="9" rx=".4"/><rect class="p-bar p-bar--r" x="7" y="1.5" width="3" height="9" rx=".4"/></svg></span><span class="dom__play-txt">Lecture</span>';
  ctlWrap.appendChild(speedEl); ctlWrap.appendChild(btn);
  frame.insertAdjacentElement('afterend', seq);
  if (note && note.parentElement === host) host.insertBefore(ctlWrap, note.nextSibling); else host.appendChild(ctlWrap);
  host.classList.add('is-ctl');
  return { seq, segs, fills, ctl: ctlWrap, speedEl, speedBtns, btn, txt: btn.querySelector('.dom__play-txt') };
}

export function initDomaines(section, opts = {}) {
  const reduced = !!opts.reduced;
  const hoverSelect = opts.hoverSelect !== false, hoverDelay = opts.hoverDelay ?? 160, wantPointer = opts.pointer !== false;
  const noop = { destroy() {}, start() {}, stop() {}, setPointer() {}, setAmbiance() {}, show() {}, play() {}, pause() {}, get playing() { return false; }, get index() { return -1; }, ready: Promise.resolve() };
  if (!section) return noop;
  const dom = section.querySelector('.dom') || section;
  const items = [...section.querySelectorAll('.dom__item')];
  const list = section.querySelector('.dom__list');
  const frame = section.querySelector('.dom__frame'), stage = section.querySelector('.dom__stage') || frame;
  const cap = section.querySelector('.dom__caption');
  if (!items.length || !frame || !cap) return noop;
  const total = items.length;
  const ac = new AbortController(), sig = ac.signal;
  const on = (el, ev, fn, o) => el.addEventListener(ev, fn, Object.assign({ signal: sig }, o || {}));
  const noT = (el, fn) => { el.classList.add('no-t'); fn(); void el.offsetWidth; el.classList.remove('no-t'); };

  dom.classList.toggle('is-reduced', reduced);
  const { media, layers } = ensureLayers(frame);
  const note = section.querySelector('.dom__note');
  const ctlHost = stage === frame ? (frame.parentElement || frame) : stage;
  const ctl = createControls(ctlHost, frame, note, total);

  /* legende + odometre */
  const capname = cap.querySelector('.dom__capname'), capline = cap.querySelector('.dom__capline'), capn = cap.querySelector('.dom__capn');
  let captext = cap.querySelector('.dom__captext');
  if (!captext && capname && capname.parentElement !== cap) { captext = capname.parentElement; captext.classList.add('dom__captext'); }
  const cells = [];
  if (capn) {
    capn.textContent = '';
    const odo = document.createElement('span'); odo.className = 'dom__odo';
    for (let k = 0; k < 2; k++) { const d = document.createElement('span'); d.className = 'dom__odo-d'; const c = document.createElement('i'); c.className = 'dom__odo-c'; c.textContent = '0'; d.appendChild(c); odo.appendChild(d); cells.push({ el: d, cur: c, nxt: null, t: 0 }); }
    const sep = document.createElement('span'); sep.className = 'dom__odo-sep'; sep.textContent = '\u00a0/\u00a0' + pad2(total);   // insecables (U+00A0) : l'espace de tete ne doit pas etre avale par le flex
    capn.appendChild(odo); capn.appendChild(sep);
  }
  const settleCell = cell => { clearTimeout(cell.t); if (cell.nxt) { cell.cur.textContent = cell.nxt.textContent; cell.nxt.remove(); cell.nxt = null; } noT(cell.el, () => cell.el.classList.remove('is-go')); };
  const rollCell = (cell, digit, d, instant) => {
    if (cell.nxt) settleCell(cell);
    if (cell.cur.textContent === digit) return;
    if (instant) { cell.cur.textContent = digit; return; }
    cell.el.style.setProperty('--odir', d > 0 ? '1' : '-1');
    const n = document.createElement('i'); n.className = 'dom__odo-n'; n.textContent = digit; cell.el.appendChild(n); cell.nxt = n;
    void n.offsetWidth; cell.el.classList.add('is-go');
    cell.t = setTimeout(() => settleCell(cell), ODO + 30);
  };
  const setOdo = (nStr, d, instant) => { const ds = pad2(nStr).slice(-2).split(''); cells.forEach((c, k) => rollCell(c, ds[k], d, instant)); };

  /* numero des items : enveloppe .n__v (cellule courante) ; au roulement, un double .n__n entre pendant que .n__v sort */
  items.forEach(b => { const n = b.querySelector('.n'); if (n && !n.querySelector('.n__v')) { const v = document.createElement('span'); v.className = 'n__v'; v.textContent = n.textContent; n.textContent = ''; n.appendChild(v); } });
  const rollTs = new Map();
  const settleNum = n => { clearTimeout(rollTs.get(n)); rollTs.delete(n); n.classList.remove('is-roll'); n.querySelectorAll('.n__n').forEach(x => x.remove()); };
  const rollNum = (it, d) => {
    const n = it.querySelector('.n'), v = n && n.querySelector('.n__v'); if (!v) return;
    settleNum(n); void n.offsetWidth;
    n.style.setProperty('--odir', d > 0 ? '1' : '-1');
    const c = document.createElement('span'); c.className = 'n__n'; c.setAttribute('aria-hidden', 'true'); c.textContent = v.textContent; n.appendChild(c);
    n.classList.add('is-roll');
    rollTs.set(n, setTimeout(() => settleNum(n), ODO + 40));
  };

  /* etat */
  let active = -1, shown = -1, pending = -1, phase = 'idle', seq = 0, cur = 0, kbAlt = false, dir = 1, prep = null;
  let running = false, visible = false, hidden = document.hidden;
  let fadeT = 0, capT = 0, capOutAt = 0, hoverT = 0, raf = 0, px = 0, py = 0, ptrOn = false;
  /* lecture (memoire uniquement) */
  let auto = false, hold = false, frozen = false, finished = false, stepMode = 'timer', stepT = 0, stepAt = 0, stepUsed = 0, seqRaf = 0, lastP = -1, speed = SPEED_DEFAUT;
  const cache = new Map();
  const preload = i => { const it = items[i]; if (!it) return; const u = it.dataset.img; if (!u || cache.has(u)) return; const im = new Image(); im.decoding = 'async'; im.src = u; cache.set(u, im); };
  const preloadAround = i => { preload(i + 1); preload(i - 1); preload(i + 2); };

  const live = () => running && visible && !hidden;          // section a l'ecran, onglet actif, start() (la sequence attend sinon)
  const playing = () => live() && !reduced;                  // videos + Ken Burns autorises
  /* video de la categorie i (la couche qui la porte), null si aucune n'est chargee */
  const vidOf = i => { const L = layers[cur]; if (L.idx === i && L.vsrc) return L.video; const O = layers[1 - cur]; return O.idx === i && O.vsrc ? O.video : null; };
  const isOn = L => !!(L.video && L.video.classList.contains('is-on'));
  /* lance la video de la couche L (jamais pendant la pause utilisateur) ; play() refuse (politique d'autoplay, economie d'energie) :
     l'image fixe reste (is-on retire) et, en lecture, le minuteur prend le relais ; AbortError (pause()/load() de notre fait) : ignore */
  const playV = L => {
    const v = L.video; if (!v || !L.vsrc) return;
    if (frozen && L.idx === active && L === layers[cur]) return;   // pause utilisateur : la video reste figee sur son image
    /* Le debit suit la vitesse choisie : sans cela la video jouait a 1× et se
       faisait simplement couper plus tot — ce qui se voit, et se voit mal.
       On regle DEFAULTplaybackRate autant que playbackRate : charger une source
       (load(), changement de src) remet playbackRate a defaultPlaybackRate, si
       bien qu'a chaque nouveau domaine la lecture repartait a 1×. Mesure a
       l'appui : ×2 et ×4 retombaient a 1 des le premier basculement. */
    try { v.defaultPlaybackRate = speed; v.playbackRate = speed; } catch (e) { /* debit refuse : le minuteur fera foi */ }
    /* une boucle posee par un arret precedent empecherait `ended` de survenir :
       en lecture continue, chaque clip doit se terminer pour ceder la place. */
    v.loop = false;
    v.play().catch(err => {
      if (err && err.name === 'AbortError') return;
      v.classList.remove('is-on');
      if (auto && !hold && L.idx === active && stepMode !== 'video') armFallback();
    });
  };
  const releaseVideo = L => { const v = L.video; if (!v) return; v.classList.remove('is-on'); L.armed = false; if (L.vsrc) { v.pause(); L.vsrc = ''; v.removeAttribute('src'); v.load(); } };
  /* revelation (fondu .65 s sur l'image fixe) : la video demarre a cet instant precis, de sa 1re image */
  const revealVideo = L => { L.armed = false; if (!L.video || !L.vsrc || !playing() || L !== layers[cur]) return; L.video.classList.add('is-on'); playV(L); };
  /* la couche courante porte une video : revelee des que sa 1re image est disponible (pendant un fondu-enchaine : a la fin de celui-ci) ;
     deja revelee : relancee si besoin (reprise apres hors ecran / onglet cache) */
  const checkReveal = L => {
    const v = L.video; if (!v || !L.vsrc || L !== layers[cur] || !playing()) return;
    if (isOn(L)) { if (v.paused && !v.ended) playV(L); return; }
    if (v.readyState < 2) return;
    if (phase === 'fading') { L.armed = true; return; }
    if (frozen && L.idx === active) { L.armed = true; return; }            // pause utilisateur : l'image fixe reste, la video sera revelee a la reprise
    revealVideo(L);
  };
  /* met en cache la video de la categorie i sur la couche L (sans la lancer) ; la revelation est decidee par go() / checkReveal() */
  const loadVideo = (L, i) => {
    const v = L.video, it = items[i]; if (!v || !it) return;
    const src = it.dataset.video;
    if (!src || !playing()) { releaseVideo(L); return; }
    const a = abs(src);
    if (L.vsrc !== a) { v.classList.remove('is-on'); L.armed = false; L.vsrc = a; v.preload = 'auto'; v.src = src; v.load(); }
    L.idx = i; v.loop = !auto;
    checkReveal(L);
  };
  /* prechauffage : la video de la categorie i est mise en cache sur la couche libre (sans lecture) pour que le fondu-enchaine
     aille directement de l'ancienne video a la nouvelle (survol desktop avant l'intention ; categorie suivante en lecture).
     Jamais pendant qu'un fondu se prepare ou se joue (prep / phase) : la couche libre est alors la couche entrante. */
  const warm = i => {
    if (reduced || !playing() || phase !== 'idle' || prep || i === active || i < 0 || i >= total) return;
    const L = layers[1 - cur], it = items[i], src = it && it.dataset.video; if (!src || !L.video) return;
    const a = abs(src); if (L.vsrc === a) { L.idx = i; return; }
    const v = L.video; v.classList.remove('is-on'); L.armed = false; L.vsrc = a; L.idx = i; v.preload = 'auto'; v.src = src; v.load();
  };
  layers.forEach(L => {
    if (!L.video) return;
    const v = L.video; v.muted = true; v.loop = true; v.playsInline = true;
    on(v, 'loadeddata', () => checkReveal(L));                                              // 1re image disponible : revelation (hors fondu)
    on(v, 'playing', () => { if (auto && !hold && L.idx === active && L.vsrc && L === layers[cur]) { v.loop = false; armGuard(v); } });   // lecture : on attend la fin reelle de la video
    on(v, 'ended', () => { if (auto && !hold && L.idx === active && L === layers[cur]) advance(); });
    on(v, 'error', () => { if (auto && !hold && L.idx === active && stepMode !== 'video') armFallback(); });
  });
  /* DEMARRAGE AUTOMATIQUE, UNE SEULE FOIS.
     La sequence attendait un clic sur Lecture. Elle part maintenant d'elle-meme
     des que la section entre a l'ecran — pas au chargement du document : une
     galerie qui tourne trois ecrans plus bas ne ferait que consommer du reseau
     et de la batterie.
     prefers-reduced-motion est respecte : on ne lance rien de ce que
     l'utilisateur a demande de ne pas voir bouger. L'utilisateur garde la main
     apres coup — un seul demarrage, jamais de relance imposee. */
  let demarreUneFois = false;
  const sync = () => {
    if (!demarreUneFois && !reduced && live()) { demarreUneFois = true; play(); }
    const p = playing();
    dom.classList.toggle('is-paused', !p && !reduced);
    if (p) { if (layers[cur].idx >= 0) loadVideo(layers[cur], layers[cur].idx); } else layers.forEach(L => L.video && L.video.pause());
    if (auto) { if (live()) { if (hold) resumeStep(); } else holdStep(); }
  };

  /* legende : sort des la selection (capOut), le texte arrive avec le media (setCaption) apres au moins CAP_OUT ms de sortie */
  const capOut = () => { if (!captext) return; clearTimeout(capT); if (!captext.classList.contains('is-out')) { captext.classList.add('is-out'); capOutAt = now(); } };
  const setCaption = (it, instant) => {
    const apply = () => { if (capname) capname.textContent = it.dataset.name || ''; if (capline) capline.textContent = it.dataset.line || ''; setOdo(it.dataset.n || '', dir, instant); };
    clearTimeout(capT);
    if (instant || !captext) { if (captext) noT(captext, () => captext.classList.remove('is-out', 'is-prep')); apply(); return; }
    if (!captext.classList.contains('is-out')) { captext.classList.add('is-out'); capOutAt = now(); }
    capT = setTimeout(() => { apply(); captext.classList.add('is-prep'); captext.classList.remove('is-out'); void captext.offsetWidth; captext.classList.remove('is-prep'); }, Math.max(0, CAP_OUT - (now() - capOutAt)));
  };

  /* mobile : la pastille active est amenee dans la vue (rail defilant), sans toucher au defilement de la page */
  const scrollPill = it => {
    if (!list || !NARROW.matches) return;
    const lw = list.clientWidth; if (list.scrollWidth <= lw + 1) return;
    const lr = list.getBoundingClientRect(), r = it.getBoundingClientRect();
    const target = Math.max(0, list.scrollLeft + (r.left - lr.left) - (lw - r.width) / 2);
    if (Math.abs(target - list.scrollLeft) < 2) return;
    list.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' });
  };

  /* fondu media du cadre vers la categorie i (la liste et la legende sont deja passees par show) */
  function fade(i, snap) {
    const it = items[i], prev = shown;
    const url = it.dataset.img || '', a = url ? abs(url) : '';
    // au demarrage, si la couche courante affiche deja l'image de la categorie : on l'adopte, sans fondu
    const adopt = prev < 0 && !!layers[cur].img && layers[cur].img.src === a;
    const inL = adopt ? layers[cur] : layers[1 - cur], outL = adopt ? null : layers[cur];
    const my = ++seq;
    const img = inL.img;
    prep = inL;                                                            // couche en preparation : warm() ne doit plus y toucher
    const go = () => {
      if (my !== seq) return;
      shown = i;
      phase = snap ? 'idle' : 'fading'; if (!adopt) cur = 1 - cur;
      const e = inL.el, v = inL.video;
      // video deja prete (premiere image disponible) : c'est elle qui fond, pas l'image fixe (un seul changement de sujet) ; elle demarre maintenant
      const vReady = !!(v && inL.vsrc && playing() && v.readyState >= 2);
      const late = !snap && !!(img && url) && !loaded(img);          // reseau lent : l'image n'est pas encore la
      // couche entrante : etat de repos sans transition, direction d'arrivee, passe au-dessus, puis .is-on (+ Ken Burns)
      noT(e, () => {
        e.classList.remove('is-on', 'is-kb', 'kb-b'); e.style.setProperty('--dy', (dir > 0 ? 6 : -6) + 'px'); e.classList.add('is-top');
        if (outL) outL.el.classList.remove('is-top');
        if (v) { v.classList.toggle('is-on', vReady); inL.armed = false; }
        if (img) img.classList.toggle('is-wait', late);
      });
      if (vReady) playV(inL);
      const turnOn = () => { e.classList.add('is-on'); if (!reduced) { kbAlt = !kbAlt; e.classList.toggle('kb-b', kbAlt); e.classList.add('is-kb'); } };
      if (snap) noT(e, turnOn); else turnOn();
      if (outL && outL.video && !late) outL.video.pause();                 // image figee sous le fondu (reseau lent : figee a l'arrivee de la nouvelle image)
      const finish = () => {
        if (my !== seq) return;
        clearTimeout(fadeT); fadeT = 0;
        if (outL) { noT(outL.el, () => outL.el.classList.remove('is-on', 'is-kb', 'kb-b')); releaseVideo(outL); }
        if (img) img.classList.remove('is-wait');
        phase = 'idle'; prep = null;
        if (pending >= 0) { const p = pending; pending = -1; if (p !== shown) { fade(p, false); return; } setCaption(items[p], false); }
        checkReveal(inL);                                                   // video arrivee pendant le fondu : revelee maintenant, en fondu court sur l'image fixe
        if (auto) warm(active + 1);                                         // lecture : la suivante se met en cache pendant la lecture
      };
      if (!late) setCaption(it, snap);                                      // reseau lent : la legende arrive avec l'image (arrive)
      clearTimeout(fadeT);
      if (snap) finish();
      else if (late) {
        // la couche entrante fond (vide) au-dessus de la sortante qui reste ; a l'arrivee de l'image : court fondu puis extinction
        const arrive = ok => { if (my !== seq || phase !== 'fading') return; requestAnimationFrame(() => { if (my !== seq) return; img.classList.remove('is-wait'); if (outL && outL.video) outL.video.pause(); setCaption(it, false); clearTimeout(fadeT); fadeT = setTimeout(finish, ok ? LATE_FADE + 40 : 0); }); };
        img.addEventListener('load', () => arrive(true), { once: true, signal: sig });
        img.addEventListener('error', () => arrive(false), { once: true, signal: sig });
        fadeT = setTimeout(finish, LATE_MAX);
      } else fadeT = setTimeout(finish, FADE + 40);
      preloadAround(i);
    };
    if (img && url) {
      if (img.src !== a) { img.classList.remove('is-wait'); img.removeAttribute('loading'); img.decoding = 'async'; img.src = url; }
    }
    inL.idx = i; loadVideo(inL, i);                                        // la video se met en cache des la selection (revelee par go/finish)
    // grace : l'image est prete mais la video arrive (readyState < 2) -> on lui laisse jusqu'a GRACE ms pour fondre directement
    const graceThenGo = () => {
      const v = inL.video;
      if (snap || !v || !inL.vsrc || !playing() || v.readyState >= 2) return go();
      let done = false; const f = () => { if (!done) { done = true; go(); } };
      on(v, 'loadeddata', f, { once: true }); on(v, 'error', f, { once: true });
      setTimeout(f, GRACE);
    };
    if (img && url && !loaded(img)) { phase = 'decoding'; waitDecode(img).then(ok => ok ? graceThenGo() : go()); } else graceThenGo();
  }

  function show(i, instant, d) {
    i = clamp(i | 0, 0, total - 1);
    if (i === active && !instant) return;
    const prev = active; active = i;
    dir = d || (prev < 0 ? 1 : (i > prev ? 1 : -1));
    const it = items[i];
    // liste : immediat (meme pendant un fondu)
    items.forEach((b, k) => { const onIt = k === i; b.classList.toggle('is-active', onIt); b.setAttribute('aria-selected', onIt ? 'true' : 'false'); b.tabIndex = onIt ? 0 : -1; });
    if (!instant && !reduced) rollNum(it, dir);
    scrollPill(it);
    const snap = instant || reduced;
    if (!snap) capOut();                                                  // la legende commence a sortir ; le texte arrive avec le media
    if (frozen) { frozen = false; stepUsed = 0; }                         // selection manuelle : la pause sur l'ancienne categorie est levee
    finished = false;
    // media : en file si un fondu est en cours (seul le cadre attend)
    if (phase === 'fading' && !instant) pending = i; else fade(i, snap);
    if (auto) beginStep(); else seqApply();
  }

  /* ---------- Lecture / Pause ---------- */
  const nominal = i => { const v = vidOf(i); if (v && isFinite(v.duration) && v.duration > 0) return v.duration * 1000; const it = items[i]; if (it && it.dataset.dur) return (+it.dataset.dur || 0) * 1000 || DUR_DEFAULT; return (it && DUR_BY_N[it.dataset.n]) || DUR_DEFAULT; };
  const clearStep = () => { clearTimeout(stepT); stepT = 0; };
  /* vitesse : elle agit sur DEUX choses, du meme facteur, pour qu'elles restent d'accord —
     le debit de lecture de la video (playbackRate, pose dans playV et applySpeed) et le delai
     avant advance(). La video se termine donc juste au moment ou l'on bascule, au lieu d'etre
     coupee en plein mouvement. Les durees de fondu et de Ken Burns, elles, ne bougent pas :
     ce sont des transitions, pas du contenu. speed === 1 : comportement historique inchange. */
  const armFallback = () => { clearStep(); if (!auto || hold) return; stepMode = 'timer'; stepAt = now(); stepT = setTimeout(advance, Math.max(250, (nominal(active) - stepUsed) / speed)); };
  const armGuard = v => { clearStep(); if (!auto || hold) return; stepMode = 'video'; const left = (isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - v.currentTime) * 1000 : DUR_DEFAULT) + GUARD; stepT = setTimeout(advance, left / speed); };
  /* progression du filet : meme formule qu'avant, mise a l'echelle par `speed` pour atteindre 1 au moment ou advance() se declenche
     (speed === 1 : ×1, resultat identique au bit pres). */
  const progress = () => {
    const v = vidOf(active);
    if (stepMode === 'video' && v && isFinite(v.duration) && v.duration > 0) {
      /* La video joue desormais a \`speed\` : currentTime / duration parcourt
         DEJA tout le segment dans le temps reel imparti. Remultiplier par
         \`speed\` — ce que faisait l ancienne formule, et qui etait juste tant
         que la video restait a 1× — remplirait le filet huit fois trop tot. */
      return clamp(v.currentTime / v.duration, 0, 1);
    }
    /* mode minuteur (image fixe, Ken Burns) : le temps ecoule est reel, la
       duree nominale ne l est pas — la mise a l echelle reste necessaire. */
    return clamp(((stepUsed + (hold || !auto ? 0 : now() - stepAt)) / nominal(active)) * speed, 0, 1);
  };
  const setFill = (p, reset) => { const f = ctl.fills[active]; if (!f || reduced) return; p = clamp(p, 0, 1); if (reset) lastP = -1; if (p < lastP) p = lastP; if (Math.abs(p - lastP) < 0.002) return; lastP = p; f.style.transform = `scaleX(${p.toFixed(4)})`; };
  const tick = () => { seqRaf = 0; if (!auto || hold) return; setFill(progress()); seqRaf = requestAnimationFrame(tick); };
  const startTick = () => { if (seqRaf || reduced || !auto || hold) return; seqRaf = requestAnimationFrame(tick); };
  const stopTick = () => { if (seqRaf) cancelAnimationFrame(seqRaf); seqRaf = 0; };
  /* filet : segments < actif = passes (or sourd) ; actif = en cours (remplissage or) en lecture / pause, passe en manuel ; > actif = vides */
  const seqApply = () => {
    ctl.segs.forEach((s, k) => {
      const curSeg = (auto || frozen) && k === active;
      s.classList.toggle('is-done', k < active || (k === active && !curSeg));
      s.classList.toggle('is-cur', curSeg);
    });
    if ((auto || frozen) && !reduced) setFill(progress(), true);
  };
  const setBtn = on => { ctl.btn.setAttribute('aria-pressed', on ? 'true' : 'false'); ctl.btn.classList.toggle('is-on', on); ctl.txt.textContent = on ? 'Pause' : 'Lecture'; dom.classList.toggle('is-auto', on); };
  const beginStep = () => {
    clearStep(); stepUsed = 0; lastP = -1; stepMode = 'timer'; stepAt = now();
    hold = !live(); seqApply();
    if (hold) { stopTick(); return; }
    const v = vidOf(active);
    if (v && playing()) { v.loop = false; if (!v.paused && v.readyState >= 3) armGuard(v); else armFallback(); } else armFallback();
    startTick();
    warm(active + 1);                                                     // (ignore si un fondu se prepare : finish() s'en charge)
  };
  const holdStep = () => { if (hold) return; hold = true; if (stepMode === 'timer') stepUsed += now() - stepAt; clearStep(); stopTick(); };
  const resumeStep = () => {
    hold = !live(); if (hold) return;
    const v = vidOf(active);
    if (stepMode === 'video' && v) armGuard(v); else armFallback();        // video : sync() la relance, 'playing' re-arme aussi la garde
    startTick();
  };
  /* LA SEQUENCE BOUCLE — 01 -> 12 -> 01 -> 02, sans fin.
     Elle s'arretait apres la douzieme et il fallait recliquer pour repartir de
     la premiere. Une galerie qu'on lance est une galerie qu'on laisse tourner.

     LA VITESSE NE FAIT PAS PARTIE DE CE QUI SE REINITIALISE au passage
     12 -> 01 : `speed` est une variable du module, le retour a l'index 0 ne la
     touche pas, et playV la repose sur la video suivante — playbackRate ET
     defaultPlaybackRate, ce dernier parce que charger une source remet le
     debit a sa valeur par defaut. Le filet de progression se remet a zero de
     lui-meme : seqApply() marque `is-done` pour k < active, et a l'index 0 il
     n'y a plus rien avant. */
  const advance = () => {
    clearStep();
    if (!auto) return;
    if (active >= total - 1) { show(0, false, 1); return; }
    show(active + 1, false, 1);
  };
  /* Fin explicite de la lecture. La boucle ci-dessus ne l'atteint plus : elle
     ne subsiste que comme arret net, si l'on veut un jour en proposer un. */
  const endAuto = () => {
    auto = false; frozen = false; finished = true; hold = false; clearStep(); stopTick(); setBtn(false);
    const v = vidOf(active); if (v && playing()) { v.loop = true; v.play().catch(() => {}); }   // la 12 reste affichee, sa video reprend sa boucle
    seqApply();
  };
  const play = () => {
    if (auto) return;
    clearTimeout(hoverT);
    const start = finished ? 0 : Math.max(0, active); finished = false;
    auto = true; setBtn(true);
    if (start !== active) { frozen = false; stepUsed = 0; show(start, false, 1); return; }   // show() lance l'etape
    if (frozen) {                                                          // reprise depuis la categorie ou l'on s'etait arrete
      frozen = false; const L = layers[cur];
      if (L.idx === active && L.vsrc && playing()) { L.video.loop = false; if (isOn(L)) playV(L); else checkReveal(L); }
      seqApply(); resumeStep(); return;
    }
    beginStep();
  };
  const pause = () => {
    if (!auto) return;
    if (!hold && stepMode === 'timer') stepUsed += now() - stepAt;
    auto = false; frozen = true; hold = false; clearStep(); stopTick();
    const v = vidOf(active); if (v && !v.paused) v.pause();                // arret propre : image figee (Ken Burns continue), reprise au meme endroit
    setBtn(false); seqApply();
  };
  on(ctl.btn, 'click', () => (auto ? pause() : play()));

  /* vitesse x1/x2/x4/x8 : reflete l'etat courant sur les boutons, puis (si une categorie est en cours) banque le temps deja
     ecoule et rearme le pas courant au nouveau facteur — la categorie et sa progression ne sautent pas, seul le rythme change. */
  const setSpeedUI = () => { ctl.speedBtns.forEach(b => { const isOn = +b.dataset.speed === speed; b.classList.toggle('is-on', isOn); b.setAttribute('aria-pressed', isOn ? 'true' : 'false'); }); };
  const applySpeed = val => {
    if (!SPEEDS.includes(val) || val === speed) return;
    if (auto && !hold && stepMode === 'timer') stepUsed += now() - stepAt;
    speed = val; setSpeedUI();
    /* Le debit change immediatement, et sur LES DEUX COUCHES. La galerie
       enchaine par fondu croise : la couche cachee est deja en train de jouer
       le domaine suivant. Ne regler que la couche active laissait donc, une
       fois sur deux, une video qui reprenait a 1× au moment du fondu. */
    for (const L of layers) { const vv = L && L.video; if (vv) { try { vv.defaultPlaybackRate = speed; vv.playbackRate = speed; } catch (e) { /* debit refuse */ } } }
    if (auto && !hold) { const v = vidOf(active); if (stepMode === 'video' && v) armGuard(v); else armFallback(); }
  };
  ctl.speedBtns.forEach(b => on(b, 'click', () => applySpeed(+b.dataset.speed)));

  /* interactions liste */
  items.forEach((b, i) => {
    on(b, 'click', () => { clearTimeout(hoverT); show(i); });
    on(b, 'focus', () => show(i));
    if (FINE.matches) {
      on(b, 'pointerenter', () => { preload(i); clearTimeout(hoverT); if (auto) return; warm(i); if (hoverSelect) hoverT = setTimeout(() => show(i), reduced ? 0 : hoverDelay); });   // lecture : survol inactif (la suivante reste prechauffee)
      on(b, 'pointerleave', () => clearTimeout(hoverT));
    }
    on(b, 'keydown', e => {
      const k = e.key; let n = -1;
      if (k === 'ArrowDown' || k === 'ArrowRight') n = (i + 1) % total; else if (k === 'ArrowUp' || k === 'ArrowLeft') n = (i - 1 + total) % total;
      else if (k === 'Home') n = 0; else if (k === 'End') n = total - 1;
      if (n < 0) return; e.preventDefault(); items[n].focus(); show(n);
    });
  });

  /* pointeur : tilt du cadre (conserve) + parallaxe inverse du bloc media */
  const applyPointer = () => {
    raf = 0; if (reduced) return;
    if (!ptrOn || NARROW.matches) { frame.style.transform = ''; media.style.transform = ''; return; }   // mobile : cadre a plat (CSS), pas de tilt
    // tilt tres attenue (etait ±8°/±6° : effet « lecteur video posé » ; le cadre doit se sentir integre a la page)
    const ry = -3 + px * 3.5, rx = 1.2 + (-py) * 2.4;
    frame.style.transform = `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`;
    media.style.transform = `translate3d(${(-px * 8).toFixed(1)}px,${(-py * 8).toFixed(1)}px,0)`;
  };
  const setPointer = (x, y) => {
    if (!FINE.matches || reduced) return;
    px = clamp(+x || 0, -0.5, 0.5); py = clamp(+y || 0, -0.5, 0.5); ptrOn = !(px === 0 && py === 0);
    if (!raf) raf = requestAnimationFrame(applyPointer);
  };
  if (wantPointer && FINE.matches && !reduced) {
    on(stage, 'pointermove', e => { const r = stage.getBoundingClientRect(); if (!r.width) return; setPointer((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5); });
    on(stage, 'pointerleave', () => setPointer(0, 0));
  }

  /* visibilite : lecture video + Ken Burns (et sequence) seulement a l'ecran et onglet actif */
  const io = new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; sync(); }), { threshold: 0.15 });
  io.observe(frame);
  on(document, 'visibilitychange', () => { hidden = document.hidden; sync(); });

  /* etat initial */
  show(0, true);
  running = true; sync();
  const first = layers[cur].img;
  const ready = (first ? waitDecode(first, 4000) : Promise.resolve()).then(() => { section.dataset.ready = '1'; });

  return {
    ready,
    get index() { return active; },
    get playing() { return auto; },
    get speed() { return speed; },
    setSpeed(v) { applySpeed(+v); },
    show(i, instant) { show(i, !!instant); },
    play, pause,
    start() { running = true; sync(); },
    stop() { running = false; sync(); },
    setPointer,
    setAmbiance() { /* tout est pilote par les tokens CSS (html[data-ambiance]) */ },
    destroy() {
      ac.abort(); io.disconnect(); clearTimeout(fadeT); clearTimeout(capT); clearTimeout(hoverT); cells.forEach(c => clearTimeout(c.t));
      clearStep(); stopTick(); auto = false;
      [...rollTs.keys()].forEach(settleNum);
      if (raf) cancelAnimationFrame(raf);
      layers.forEach(L => { releaseVideo(L); L.el.classList.remove('is-kb', 'kb-b', 'is-top'); });
      ctl.seq.remove(); ctl.ctl.remove(); ctlHost.classList.remove('is-ctl');
      frame.style.transform = ''; media.style.transform = ''; dom.classList.remove('is-paused', 'is-reduced', 'is-auto');
    }
  };
}
export default initDomaines;
