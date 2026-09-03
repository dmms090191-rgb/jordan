/* ============================================================================
   LE CINÉMA V4 — « La Compagnie de l'Or », un seul film continu.
   ----------------------------------------------------------------------------
   Le spectateur ne voit JAMAIS la page : une scène fixe plein écran, deux
   couches vidéo (A/B) qui s'enchaînent par fondus courts — les raccords sont
   invisibles, la caméra ne s'arrête qu'aux fins de chapitres. Le scroll, le
   swipe, les flèches ne déplacent rien : ils LANCENT le chapitre. La vidéo
   JOUE réellement (playbackRate = vitesse choisie), elle n'est pas frottée.
   Fin de chapitre : l'image se stabilise, un voile-vignette naît de l'image
   (jamais un rectangle qui glisse), le titre et le texte se posent, puis le
   film reprend exactement où il s'était arrêté.
   Tous les chiffres et textes sensibles sont en DOM : la pesée (0,00 →
   40,00 g exactement), le devis, le virement, la carte de visite.
   ========================================================================== */
'use strict';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtFR = (v, d) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTemps = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- homographie : projeter un rectangle DOM sur un quadrilatere ----
   m3dQuad(w, h, [TL, TR, BR, BL]) -> chaine matrix3d qui envoie le rectangle
   (0,0,w,h) exactement sur les 4 coins cibles (en px). Sert a composer les
   ecrans (tablette, LCD, carte) DANS la surface physique du plan video. */
function m3dQuad(w, h, q) {
  const adj = m => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
  const mul = (a, b) => {
    const r = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  };
  const mulV = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
  const base = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
    const v = mulV(adj(m), [x4, y4, 1]);
    return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
  };
  const s = base(0, 0, w, 0, 0, h, w, h);
  const d = base(q[0].x, q[0].y, q[1].x, q[1].y, q[3].x, q[3].y, q[2].x, q[2].y);
  const t = mul(d, adj(s));
  for (let i = 0; i < 9; i++) t[i] /= t[8];
  return 'matrix3d(' + [
    t[0], t[3], 0, t[6],
    t[1], t[4], 0, t[7],
    0, 0, 1, 0,
    t[2], t[5], 0, t[8],
  ].map(x => x.toFixed(7)).join(',') + ')';
}

/* ---------- ambiance jour / nuit ---------- */
const CLE_AMB = 'compagnie-or-ambiance';
let ambiance = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';

/* ---------- LE FILM : chapitres, segments continus ------------------------
   Le nombre de chapitres n'est ecrit nulle part : il est LU de ce tableau, ici
   comme dans la barre de progression. En ajouter un ne demande donc que de
   renumeroter les `id` qui suivent, puisque le voile affiche « CHAPITRE <id> ».
   v: base du fichier (assets/video/<v>[-nuit|-jour].mp4) ; amb2: jumeau jour ;
   from/to: fenêtre en secondes ; code: segment DOM/canvas ; ov: incrustations. */
const FILM = [
  { id: 1, nom: 'L’ARRIVÉE',
    textes: ['« Chaque expertise commence par une rencontre. »',
      '« Nous choisissons une région, nous annonçons notre venue, et nous vous recevons près de chez vous. »'],
    segs: [
      { v: 'v3-s2-village', amb2: true },
      { v: 'v4-enseigne-hotel', amb2: true, t: 'cut' },              // meme axe, plus pres : coupe de cinema
      { v: 'v4-porte-traversee', amb2: true, t: 'cut' },              // LA traversee : la porte s'ouvre et on entre
      /* §3 : des l'entree, la receptionniste est DEJA a son comptoir — le hall vide est retire */
      { v: 'v4-receptionniste', amb2: true, t: 'cut', cadre: 'haut' }, // coupe dans l'axe du comptoir
      { v: 'v4-couloir-expert', amb2: true, t: 'cut', cadre: 'haut' }, // au bout du couloir : LE VRAI expert, identifiable, attend a la porte
    ] },
  { id: 2, nom: 'L’EXPERTISE',
    textes: ['« Notre expert vous reçoit directement à l’hôtel, dans un bureau privé, calme et chaleureux, entièrement consacré à votre rendez-vous. »',
      '« Vos objets sont examinés, identifiés et pesés devant vous, avant de vous présenter une proposition claire, que vous êtes libre d’accepter ou de refuser. »',
      '« En cas d’accord, votre règlement est effectué par virement bancaire. »'],
    segs: [
      /* le montant de porte a rempli le cadre : coupe -> on retrouve LE MEME expert (§E-F) */
      /* l'accueil, tourne dans le DECOR MAITRE : il salue debout, contourne le
         bureau, s'assoit — le plan finit exactement sur le cadrage de reference
         d'ou partent les trois allers-retours. */
      { v: 'v4-accueil-bureau', amb2: true, t: 'cut' },
      /* Le bureau se decouvre par ALLERS-RETOURS depuis une seule position de
         reference — le client assis, face a l'expert. Chaque mouvement part de
         ce cadrage maitre, va vers un objet, et y revient reellement : aucune
         coupe, aucun reverse. Les trois plans sont tournes dans le meme decor.
         MOUVEMENT 1 — la balance. Son ecran reste ETEINT : aucun chiffre n'est
         confie a la video (§chiffres). */
      { v: 'v4-m1-balance-noir', amb2: true, t: 'cut' },
      /* MOUVEMENT 2 — le plateau de velours et les bijoux du client */
      { v: 'v4-m2-bijoux', amb2: true, t: 'cut' },
      /* MOUVEMENT 3 — la television murale. Un seul geste continu, en trois
         temps : la camera quitte la position maitre face a l'expert et vient se
         placer exactement en face de la dalle ; l'ecran s'allume et « Ce que
         nous rachetons » s'y joue ; puis la camera refait le chemin en sens
         inverse et retrouve le cadrage maitre. Aucune coupe, aucun reverse : les
         deux plans sont verrouilles sur la meme image d'arrivee, a 3 px pres. */
      { v: 'v4-m3a-tv-aller', amb2: true, t: 'cut' },
      /* L'ecran porte les douze familles, PUIS « apres votre accord » : la
         television redevient noire et le texte s'y inscrit dans la meme
         grammaire que le titre — capitales espacees en or, filet fin, corps en
         serif ivoire sur le noir de la dalle. Le recapitulatif n'est plus montre
         sur un document du bureau : tout se dit sur l'ecran, puis la camera
         repart. */
      { code: 'tv', dur: 49.4 },
      { v: 'v4-m3b-tv-retour', amb2: true, t: 'cut' },
      /* le plan de loupe (poincon 750 agrandi) a ete retire : la scene du devis
         tient deja le cadrage maitre, et la pesee repart de ce meme cadrage —
         le raccord se fait donc tout seul, sans trou ni noir intercalaire. */
      /* la vraie pesee : la balance vide affiche 0,00 puis le poids monte et
         s'arrete EXACTEMENT a 40,00 g. Le plan couvre desormais les deux temps
         d'un seul tenant — la fenetre « balance vide » n'a plus a etre montee
         a part, puisque les allers-retours l'ont deja montree. */
      { v: 'v4-pesee-maitre', amb2: true, ov: 'pesee', t: 'cut' }, // il depose la chaine -> 40,00 g, dans le decor maitre
      /* la carte « proposition d'achat » a ete supprimee : tout ce qu'elle
         disait est desormais porte par l'ecran du televiseur. Son segment est
         retire du montage, donc sa duree l'est aussi — la suite du film remonte
         d'autant. */
    ] },
  /* LE CHAPITRE « LE KIT SÉCURISÉ » N'EXISTE PLUS.
     Son passage narratif entier est supprime : le titre, ses deux textes, le
     voile qui les portait, et surtout le TEMPS que ce voile occupait dans la
     carte du temps. Rien n'est simplement cache : un voile invisible aurait
     laisse une duree fantome, un arret du film sur rien.

     SES QUATRE PLANS RESTENT — ils n'ont jamais fait partie des animations du
     kit : sortie par la fenetre, envol, nuages, carte de France. Ils rejoignent
     tels quels la tete du chapitre suivant, dans le meme ordre et avec les
     memes raccords. Aucun autre voile ne bouge donc : celui de « L'EXPERTISE »
     tombe toujours apres la pesee, celui de la fonderie toujours apres la
     frappe du lingot. Seul l'arret du kit disparait, et tout ce qui le suivait
     remonte exactement d autant. */
  { id: 3, nom: 'UNE NOUVELLE VIE POUR L’OR',
    textes: ['« Une fois la vente conclue, l’or poursuit son histoire. »',
      '« Fondu puis transformé, il devient une nouvelle matière prête à traverser le temps. »'],
    segs: [
      { v: 'v4-fenetre-sortie', amb2: true },
      { v: 'v3-s19-envol', amb2: true, t: 'cut' },        // mouvement concordant : on continue de monter
      { v: 'v4-nuages-montee', amb2: true, t: 'cut' },                // l'ascension se voile : les nuages prennent tout
      /* §6 : plus de plan orbite (courbure/halo bleu interdits) — on TRAVERSE les
         nuages et on emerge dans un ESPACE NOIR PROFOND dessine en code, ou la
         France doree s'assemble. */
      { code: 'france', dur: 15 },
      { v: 'v4-fonderie-atelier' },                       // §I : l'atelier SANS balance — four, creuset, moule
      { v: 'v3-s12-fusion', t: 'cut' },                   // vers le coeur du creuset
      { v: 'v3-s13-coulee', to: 7.0, t: 'cut' },          // la coulee seule (des 7,2 s le master elargit sur la balance)
      /* LA FRAPPE DU LINGOT A ETE REMPLACEE par le coffre bancaire personnel :
         la porte se ferme sur les lingots, puis la poignee en croix fait son
         tour vers la droite et verrouille. Le plan remplace durait 2,0 s
         (fenetre 4,2 -> 6,2 du master) ; celui-ci en dure 12,0. Le montage
         s'allonge donc reellement de 10 s : rien n'est conserve en arriere-plan,
         l'ancien plan ne figure plus nulle part.

         L'incrustation `ov: 'lingot'` disparait avec lui. Elle affichait
         « Or fin 999,9 — 30,00 g », ce qui n'a plus de sens devant un coffre
         de cinq lingots : elle appartenait a la frappe, pas a cette scene. */
      { v: 'v4-coffre-verrouillage', t: 'noir' },
    ] },
  { id: 4, nom: 'DEUX PARCOURS, UNE MÊME EXIGENCE',
    textes: ['« Lors de nos journées d’expertise ou grâce à notre kit sécurisé, vous choisissez la solution qui vous convient. »',
      '« Deux parcours. Une même expertise. Une même transparence. »'],
    segs: [ { code: 'parcours', dur: 12 } ] },
  { id: 5, nom: 'CONCLUSION',
    textes: [],
    segs: [
      { v: 'v4-main-carte', amb2: true },
      { code: 'carte', dur: 16 },
    ] },
];

/* ============================ LE PROJECTEUR ============================== */
class Cinema {
  constructor() {
    this.stage = $('#cinema');
    /* le film occupe exactement l'espace sous le header */
    const nav = document.getElementById('nav');
    const caleNav = () => document.documentElement.style.setProperty('--v4-nav', ((nav && nav.offsetHeight) || 76) + 'px');
    caleNav(); addEventListener('resize', caleNav);
    this.vids = [$('#filmA'), $('#filmB')];
    this.actifV = 0;
    this.voile = $('#v4-voile');
    this.chIdx = 0;               // chapitre courant (0-based)
    this.segIdx = -1;
    this.etat = 'accueil';        // accueil | course | voile | fin
    /* VITESSE PAR DEFAUT : x4, jamais x1 et jamais la derniere utilisee.
       La valeur est posee ICI, avant tout demarrage, pour que le tout premier
       segment parte deja a la bonne cadence : un setVitesse() appele apres
       coup ne corrigerait que la couche video en cours, pas celle qui se
       precharge. Le bouton x4 est par ailleurs marque actif directement dans
       experience.html, sinon le x1 s'afficherait actif le temps que le script
       s'execute. Le spectateur reste libre de choisir x1, x2, x4 ou x8. */
    this.vitesse = 4;
    this.lecture = false;
    this.raf = null;
    this.timerVoile = 0;
    this.overlays = new OverlayRegie(this);
    this.codeScenes = new CodeScenes(this);
    this.son = new SonV4();
    this.tablettePause = false;
    this.initBar();
    /* on repasse par setVitesse pour que TOUT suive la cadence par defaut :
       les boutons, les scenes en code, et la variable --v4-vit dont dependent
       les animations CSS. Sans cela, seule la video serait a x4. */
    this.setVitesse(this.vitesse);
    this.initGestes();
    this.majProg();
    this.overlays.montre('accueil');
    /* la timeline globale : carte temporelle du film entier (a x1) */
    this.carte = null; this.offsetDepart = 0;
    this.construireCarte();
    this.initTimeline();
    this.initVeille();
  }

  /* ---- LA VEILLE : le film ne doit JAMAIS pouvoir rester en plan ----------
     Le blocage a 45 s venait d'un enchainement de chapitre qui ne partait
     pas : le film restait en « attente », fige sur la derniere image, et rien
     ne venait le relancer. La cause a ete corrigee, mais un film de cinq
     minutes qui s'arrete sans raison visible est un defaut trop couteux pour
     ne reposer que sur l'absence de bug.

     « attente » est un etat de PASSAGE : il dure 650 ms entre la fin d'un
     voile et le demarrage du chapitre suivant. S'il dure plus longtemps que
     cela, personne ne va plus le quitter. On relance alors le chapitre.

     Le seuil est genereux (2 s) pour ne jamais couper la parole au passage
     normal, et la veille ne touche a aucun autre etat : accueil, course,
     pause, voile, voile-pause et fin sont tous des etats ou l'on reste
     legitimement, parfois tres longtemps. */
  initVeille() {
    this.veille = setInterval(() => {
      if (this.etat !== 'attente') { this.attenteDepuis = 0; return; }
      this.attenteDepuis = (this.attenteDepuis || 0) + 0.5;
      if (this.attenteDepuis < 2) return;
      this.attenteDepuis = 0;
      console.warn('veille : le film etait arrete en attente, on relance le chapitre', this.chIdx + 1);
      this.lancerChapitre();
    }, 500);
  }

  /* ---- LA CARTE DU TEMPS : chaque segment, chaque scene code, chaque voile,
     cumules a x1 — la position affichee est toujours la position DANS LE FILM,
     jamais le temps reel ecoule (les vitesses n'y changent rien) ---- */
  async construireCarte() {
    const gen = (this.genCarte = (this.genCarte || 0) + 1);
    const dureeVideo = src => new Promise(res => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.src = src;
      v.addEventListener('loadedmetadata', () => res(v.duration || 8), { once: true });
      v.addEventListener('error', () => res(8), { once: true });
    });
    let t = 0; const chapitres = [];
    for (let ci = 0; ci < FILM.length; ci++) {
      const ch = FILM[ci];
      const c = { debut: t, segs: [], voile: null };
      for (const seg of ch.segs) {
        let d;
        if (seg.code) d = seg.dur || 8;
        else {
          const dv = await dureeVideo(this.srcDe(seg));
          d = Math.max(0.2, (seg.to || dv - 0.12) - (seg.from || 0));
        }
        c.segs.push({ debut: t, duree: d });
        t += d;
      }
      /* Un voile ferme chaque chapitre SAUF le dernier. La condition etait
         ecrite « ch.id < 8 », un seuil en dur herite d'un montage a 8
         chapitres : des qu'un chapitre porte l'id 8, son voile disparait de la
         carte du temps alors que le film le joue quand meme, et la position
         affichee derive. On lit donc le rang reel, comme le font deja
         allerVoile() et finChapitre(). */
      if (ci < FILM.length - 1 && ch.textes.length) {
        const mots = ch.textes.join(' ').split(/\s+/).length;
        const dv = (Math.max(1400, 2200 + mots * 165) + 1400) / 1000;
        c.voile = { debut: t, duree: dv };
        t += dv;
      }
      chapitres.push(c);
    }
    if (gen !== this.genCarte) return; /* une bascule d'ambiance a relance le calcul */
    this.carte = { chapitres, total: t };
    const tot = $('#cine-t-tot'); if (tot) tot.textContent = fmtTemps(t);
    const acc = $('#v4-duree-totale'); if (acc) acc.textContent = fmtTemps(t);
  }

  posGlobale() {
    if (!this.carte) return 0;
    if (this.etat === 'fin') return this.carte.total;
    const c = this.carte.chapitres[this.chIdx];
    if (!c) return 0;
    if (this.etat === 'voile' || this.etat === 'voile-pause') {
      const v = c.voile; if (!v) return c.debut;
      const reel = this.voileDureeReelle || 1;
      const ecoule = this.etat === 'voile-pause'
        ? reel - (this.voileRestant || 0)
        : clamp(performance.now() - (this.voileDepart || 0), 0, reel);
      return v.debut + (ecoule / reel) * v.duree;
    }
    const sg = c.segs[Math.max(0, this.segIdx)];
    const seg = (FILM[this.chIdx].segs || [])[this.segIdx];
    if (!sg || !seg) return c.debut;
    if (seg.code) return sg.debut + clamp(this.codeScenes.posScene(), 0, sg.duree);
    const v = this.vids[this.actifV];
    /* SAUT CORRIGE — entre l'entree dans un plan et son demarrage effectif (le
       temps que la video charge), la couche active tient encore le plan
       PRECEDENT, souvent gare sur sa derniere image. On lisait alors sa position
       comme si elle appartenait au nouveau segment : la barre bondissait de la
       duree du plan precedent, puis revenait. Mesure au passage ecran ->
       retour : +5,9 s puis retour en arriere. Tant que la couche active ne
       porte pas la source du segment, la position est celle de son debut. */
    if (v.dataset.src !== this.srcDe(seg)) return sg.debut;
    return sg.debut + clamp((v.currentTime || 0) - (seg.from || 0), 0, sg.duree);
  }

  allerTemps(T) {
    if (!this.carte) return;
    T = clamp(T, 0, this.carte.total - 0.05);
    for (let ci = 0; ci < this.carte.chapitres.length; ci++) {
      const c = this.carte.chapitres[ci];
      for (let si = 0; si < c.segs.length; si++) {
        const s = c.segs[si];
        if (T < s.debut + s.duree) {
          /* seek exact — y compris DANS une scene de code : sans cela, un saut
             au milieu de « Ce que nous rachetons » relancait l'ecran depuis son
             debut et l'image affichee ne correspondait pas au temps demande. */
          this.offsetDepart = T - s.debut;
          this.allerSegment(ci, si);
          return;
        }
      }
      if (c.voile && T < c.voile.debut + c.voile.duree) {
        /* SAUT CORRIGE — un relachement dans un voile de chapitre bondissait au
           debut du chapitre suivant, soit jusqu'a quatorze secondes plus loin
           que le point demande. Le voile est desormais atteignable : on
           l'affiche, positionne a l'instant voulu, et il finit de s'ecouler. */
        this.allerVoile(ci, (T - c.voile.debut) / c.voile.duree);
        return;
      }
    }
  }

  /* ---- LA BARRE DE TEMPS -----------------------------------------------
     Une seule valeur fait foi : la position dans le film, posGlobale(). Le
     curseur et le compteur en sont tous deux calcules, a chaque image.

     Le rafraichissement se faisait auparavant par un minuteur a 200 ms — cinq
     pas par seconde, d'ou l'avance saccadee. Il se fait maintenant en
     requestAnimationFrame.

     Le glissement, lui, ne reconstruit plus le film a chaque mouvement de
     souris : il ne deplacait pas seulement le curseur, il rejouait tout le
     chapitre des dizaines de fois par seconde. Pendant le glissement le curseur
     suit le doigt et le compteur affiche la position visee ; le film se
     reconstruit une seule fois, au relachement. Un clic simple, lui, saute
     immediatement. ---- */
  initTimeline() {
    const rail = $('#cine-timeline'), fill = $('#cine-timeline-fill'), cur = $('#cine-t-cur');
    if (!rail) return;
    const tempsDe = e => {
      const r = rail.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1) * this.carte.total;
    };
    let drag = false, bouge = false, vise = 0;

    rail.addEventListener('pointerdown', e => {
      if (!this.carte) return;
      drag = true; bouge = false; vise = tempsDe(e);
      this.tlVise = vise;                    /* le curseur suit la visee, pas le film */
      rail.setPointerCapture(e.pointerId);
    });
    rail.addEventListener('pointermove', e => {
      if (!drag || !this.carte) return;
      bouge = true; vise = tempsDe(e); this.tlVise = vise;
    });
    const relacher = () => {
      if (!drag) return;
      drag = false;
      /* le film se reconstruit une seule fois, exactement au temps relache */
      if (this.carte) this.allerTemps(vise);
      /* le curseur rejoint la position reelle en douceur, sans retarder le film */
      this.tlLisse = vise;
      this.tlVise = null;
      void bouge;
    };
    rail.addEventListener('pointerup', relacher);
    rail.addEventListener('pointercancel', relacher);

    const dessine = () => {
      requestAnimationFrame(dessine);
      if (!this.carte) return;
      const reel = this.tlVise != null ? this.tlVise : this.posGlobale();
      /* petit lissage du RENDU seulement : le film, lui, est deja exact */
      if (this.tlLisse == null) this.tlLisse = reel;
      const d = reel - this.tlLisse;
      /* un ecart franc (saut, changement de chapitre) est repris tout de suite ;
         seule la derive d'une image a l'autre est adoucie */
      this.tlLisse = Math.abs(d) > 1.2 ? reel : this.tlLisse + d * 0.35;
      const p = this.tlLisse;
      if (cur) { const s = fmtTemps(p); if (cur.textContent !== s) cur.textContent = s; }
      if (fill) fill.style.width = (p / this.carte.total * 100).toFixed(3) + '%';
      const pc = Math.round(p / this.carte.total * 100);
      if (rail.getAttribute('aria-valuenow') !== String(pc)) rail.setAttribute('aria-valuenow', String(pc));
      this.majChapitreActif(reel);
    };
    requestAnimationFrame(dessine);
  }

  /* ---- LE CHAPITRE ACTIF, LU DE LA POSITION GLOBALE ----------------------
     La barre de droite ne tient pas son propre compte du temps : elle lit la
     meme valeur que le curseur et le compteur, posGlobale(). Un deuxieme
     systeme de position finirait par diverger du film — c'est exactement ce
     qui vient d'arriver au drapeau de lecture.
     On n'ecrit dans le DOM que lorsque le chapitre CHANGE : cette fonction
     tourne a chaque image. */
  majChapitreActif(T) {
    if (!this.carte) return;
    let ci = 0;
    for (let k = 0; k < this.carte.chapitres.length; k++) {
      if (T >= this.carte.chapitres[k].debut) ci = k; else break;
    }
    if (ci === this.chActif) return;
    this.chActif = ci;
    document.querySelectorAll('#rail a').forEach((a, i) => {
      a.classList.toggle('is-active', i === ci);
      a.classList.toggle('is-passe', i < ci);
      if (i === ci) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }

  srcDe(seg) {
    const amb = seg.amb2 ? '-' + ambiance : '';
    return 'assets/video/' + seg.v + amb + '.mp4';
  }

  /* precharge le segment donne dans la couche libre */
  precharge(seg) {
    if (!seg || seg.code) return;
    const v = this.vids[1 - this.actifV];
    const src = this.srcDe(seg);
    if (v.dataset.src !== src) { v.dataset.src = src; v.src = src; v.load(); }
    v.currentTime = seg.from || 0;
  }

  /* ---- lancer le chapitre courant (un geste = tout le chapitre) ----
     `lecture` doit etre pose ICI, et pas seulement par le bouton. C'est le
     drapeau que armerVoile() interroge pour savoir s'il enchaine sur le
     chapitre suivant : un film mis en marche autrement — au defilement, a la
     fleche, depuis le menu des chapitres — jouait avec le drapeau a faux et
     mourait donc au premier voile, a 45 s, alors que le bouton affichait
     « en lecture ». Toute mise en mouvement doit poser le drapeau, sinon il
     devient une seconde verite qui contredit `etat`. */
  lancerChapitre() {
    if (this.etat === 'course') return;
    clearTimeout(this.timerVoile);
    this.cacherVoile();
    this.overlays.cache();
    this.gen = (this.gen || 0) + 1;
    this.offsetDepart = 0;
    this.lecture = true;
    this.etat = 'course';
    $('#cine-lect').setAttribute('aria-pressed', 'true');
    this.segIdx = -1;
    this.suivantSegment();
    this.majProg();
  }

  /* ---- navigation reelle par etape : on restaure l'etat en rejouant le segment vise
     depuis son debut (video, incrustations et scenes code se reconstruisent) ---- */
  allerSegment(ch, seg) {
    clearTimeout(this.timerVoile);
    this.cacherVoile();
    cancelAnimationFrame(this.raf);
    this.codeScenes.stop();
    this.overlays.cache();
    document.documentElement.classList.remove('film-fini');
    this.gen = (this.gen || 0) + 1;
    this.chIdx = clamp(ch, 0, FILM.length - 1);
    this.segIdx = clamp(seg, 0, FILM[this.chIdx].segs.length - 1) - 1;
    this.lecture = true;   /* meme raison que dans lancerChapitre() */
    this.etat = 'course';
    $('#cine-lect').setAttribute('aria-pressed', 'true');
    this.majProg();
    this.suivantSegment();
  }

  suivantSegment() {
    const gen = this.gen || 0; /* une navigation ulterieure invalide tout ce qui est en vol */
    const ch = FILM[this.chIdx];
    this.segIdx++;
    if (this.segIdx >= ch.segs.length) { this.finChapitre(); return; }
    const seg = ch.segs[this.segIdx];
    this.overlays.entreSegment(ch, seg);
    this.son.pose(seg.code || seg.v || '');
    this.gestesFaits = {};
    if (seg.v === 'v4-porte-traversee') setTimeout(() => this.son.geste('gonds'), 5200 / this.vitesse);
    if (seg.v === 'v4-colis-expert') setTimeout(() => this.son.geste('velours'), 1600 / this.vitesse);
    if (seg.v === 'v4-mains-depose') setTimeout(() => this.son.geste('velours'), 2400 / this.vitesse);
    if (seg.v === 'v4-mains-ouvre') setTimeout(() => this.son.geste('velours'), 2000 / this.vitesse);
    if (seg.v === 'v3-s16-scelle') setTimeout(() => this.son.geste('cachet'), 1400 / this.vitesse);
    if (seg.code === 'france') this.son.geste('cloche');
    if (seg.code === 'accord') setTimeout(() => this.son.geste('plume'), 2200 / this.vitesse);
    if (seg.v === 'v3-s6-biens') setTimeout(() => this.son.geste('velours'), 900 / this.vitesse);
    if (seg.code) {
      const decalage = clamp(this.offsetDepart || 0, 0, Math.max(0, (seg.dur || 8) - 0.4));
      this.offsetDepart = 0;
      /* Une scene de code se joue SUR la derniere image du plan qui la precede.
         En lecture normale cette image est deja la. Apres un saut, la couche
         video tient encore un plan sans rapport : l'ecran de la television
         s'affichait alors en grand au milieu du bureau. On replace donc le fond
         avant de jouer la scene. */
      this.poserFondCode(ch, this.segIdx, gen, () => {
        if ((this.gen || 0) !== gen) return;
        this.codeScenes.jouer(seg, () => this.suivantSegment(), decalage);
      });
      return;
    }
    const suivant = ch.segs[this.segIdx + 1] || (FILM[this.chIdx + 1] || { segs: [] }).segs[0];
    const v = this.vids[1 - this.actifV];
    const src = this.srcDe(seg);
    if (v.dataset.src !== src) { v.dataset.src = src; v.src = src; v.load(); }
    const demarre = () => {
      if ((this.gen || 0) !== gen) return; /* navigation entre-temps : ce chargement est perime */
      /* la couche est reutilisee : sa mise en pause differee ne doit plus tomber */
      clearTimeout(v._pauseDiff);
      /* cadrage par plan : les personnages debout gardent la tete dans le cadre,
         et un recadrage leger peut sortir du cadre un objet interdit (§I) */
      v.style.objectPosition = seg.cadre === 'haut' ? '50% 16%' : '';
      v.style.transform = seg.zoom ? 'scale(' + seg.zoom + ')' : '';
      v.style.transformOrigin = seg.zoomOrigine || 'center';
      v.currentTime = (seg.from || 0) + (this.offsetDepart || 0); /* seek exact depuis la timeline */
      this.offsetDepart = 0;
      v.playbackRate = clamp(this.vitesse, 0.25, 8);
      const fin = seg.to || 0;
      const ancienne = this.vids[this.actifV];
      const bascule = () => {
        v.play().catch(() => {});
        ancienne.classList.remove('is-on');
        v.classList.add('is-on');
        ancienne._pauseDiff = setTimeout(() => { try { ancienne.pause(); } catch (e) {} }, 480);
      };
      /* le raccord appartient a l'action : coupe franche dans l'axe, respiration
         par le noir, ou fondu seulement la ou la lumiere le cache */
      const typeR = seg.t || 'fondu';
      if (typeR === 'cut') { this.vids.forEach(x => x.classList.add('coupe')); bascule(); setTimeout(() => this.vids.forEach(x => x.classList.remove('coupe')), 220); }
      else if (typeR === 'noir') { document.documentElement.classList.add('noir-bref'); setTimeout(() => { bascule(); document.documentElement.classList.remove('noir-bref'); }, 240); }
      else bascule();
      this.actifV = 1 - this.actifV;
      this.precharge(suivant && !suivant.code ? suivant : null);
      const tick = () => {
        if (this.etat !== 'course') return;
        const t = v.currentTime;
        this.overlays.tick(seg, t);
        const borne = fin || (v.duration ? v.duration - 0.12 : 1e9);
        if (t >= borne || v.ended) { this.suivantSegment(); return; }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    };
    if (v.readyState >= 1) demarre();
    else {
      v.addEventListener('loadedmetadata', demarre, { once: true });
      /* un segment introuvable ne bloque jamais le film : on le saute */
      v.addEventListener('error', () => { if ((this.gen || 0) !== gen) return; console.warn('segment indisponible', src); this.suivantSegment(); }, { once: true });
    }
  }

  /* Replace, sous une scene de code, la derniere image du plan qui la precede.
     Sans cela un saut direct dans une scene de code l'affiche par-dessus
     n'importe quelle image restee dans la couche video. */
  poserFondCode(ch, si, gen, apres) {
    let j = si - 1;
    while (j >= 0 && ch.segs[j].code) j--;
    if (j < 0) { apres(); return; }
    const precedent = ch.segs[j];
    const src = this.srcDe(precedent);
    const actif = this.vids[this.actifV];
    /* deja en place (lecture normale) : on se contente de figer l'image */
    if (actif.dataset.src === src && actif.classList.contains('is-on')) {
      try { actif.pause(); } catch (e) {}
      apres(); return;
    }
    const v = this.vids[1 - this.actifV];
    if (v.dataset.src !== src) { v.dataset.src = src; v.src = src; v.load(); }
    const poser = () => {
      if ((this.gen || 0) !== gen) return;
      clearTimeout(v._pauseDiff);
      v.style.objectPosition = precedent.cadre === 'haut' ? '50% 16%' : '';
      v.style.transform = precedent.zoom ? 'scale(' + precedent.zoom + ')' : '';
      v.style.transformOrigin = precedent.zoomOrigine || 'center';
      const fin = precedent.to || Math.max(0, (v.duration || 8) - 0.08);
      try { v.currentTime = fin; } catch (e) {}
      try { v.pause(); } catch (e) {}
      const ancienne = this.vids[this.actifV];
      ancienne.classList.remove('is-on');
      v.classList.add('is-on');
      this.actifV = 1 - this.actifV;
      try { ancienne.pause(); } catch (e) {}
      apres();
    };
    if (v.readyState >= 1) poser();
    else {
      v.addEventListener('loadedmetadata', poser, { once: true });
      v.addEventListener('error', () => { if ((this.gen || 0) === gen) apres(); }, { once: true });
    }
  }

  finChapitre() {
    cancelAnimationFrame(this.raf);
    const v = this.vids[this.actifV];
    try { v.pause(); } catch (e) {}
    const ch = FILM[this.chIdx];
    this.etat = 'voile';
    if (this.chIdx >= FILM.length - 1) { this.etat = 'fin'; document.documentElement.classList.add('film-fini'); this.majProg(); return; } // le dernier chapitre : la scene code conclut
    /* PAS DE TEXTE, PAS D'ARRET. Un chapitre sans textes affichait quand meme
       un panneau vide pendant 3,6 s — un voile invisible, et une duree que la
       carte du temps, elle, ne comptait pas : les deux se contredisaient, et
       le compteur derivait d'autant. On enchaine directement sur le chapitre
       suivant, ce que la carte du temps decrit deja. */
    if (!ch.textes.length) {
      this.cacherVoile();
      this.chIdx++;
      this.segIdx = -1;
      this.etat = 'attente';
      this.majProg();
      setTimeout(() => this.lancerChapitre(), 120 / this.vitesse);
      return;
    }
    this.montrerVoile(ch);
    const mots = ch.textes.join(' ').split(/\s+/).length;
    const attente = Math.max(1400, (2200 + mots * 165) / this.vitesse);
    this.armerVoile(attente + 1400);
  }
  /* Afficher le voile d'un chapitre a une fraction donnee de sa duree, pour
     qu'un saut tombant dedans montre ce qu'il doit montrer au lieu de sauter
     au chapitre suivant. */
  allerVoile(ci, fraction) {
    const ch = FILM[ci];
    if (!ch || ci >= FILM.length - 1 || !ch.textes || !ch.textes.length) {
      if (ci + 1 < FILM.length) this.allerSegment(ci + 1, 0);
      return;
    }
    cancelAnimationFrame(this.raf);
    this.codeScenes.stop();
    this.overlays.cache();
    this.gen = (this.gen || 0) + 1;
    try { this.vids[this.actifV].pause(); } catch (e) {}
    this.chIdx = ci;
    this.segIdx = ch.segs.length - 1;
    this.etat = 'voile';
    this.majProg();
    this.montrerVoile(ch);
    const mots = ch.textes.join(' ').split(/\s+/).length;
    const pleine = Math.max(1400, (2200 + mots * 165) / this.vitesse) + 1400;
    const restant = Math.max(220, pleine * (1 - clamp(fraction, 0, 0.98)));
    /* la position affichee doit refleter le point atteint, pas le debut */
    this.armerVoile(restant);
    this.voileDureeReelle = pleine;
    this.voileDepart = performance.now() - pleine * clamp(fraction, 0, 0.98);
  }

  armerVoile(delai) {
    clearTimeout(this.timerVoile);
    this.voileDepart = performance.now();
    this.voileDureeReelle = delai;
    this.voileEcheance = performance.now() + delai;
    this.timerVoile = setTimeout(() => {
      this.cacherVoile();
      this.chIdx++;
      /* On QUITTE l'etat « voile » avant de lire quoi que ce soit : entre ce
         point et lancerChapitre(), 650 ms plus tard, chIdx designe deja le
         chapitre suivant. Rester en « voile » faisait alors lire par
         posGlobale() le voile du chapitre SUIVANT, et le compteur sautait de
         0:45 a 2:37 pour revenir aussitot. segIdx repart a -1 pour la meme
         raison : sinon la position lue tombe au milieu du nouveau chapitre. */
      this.segIdx = -1;
      this.etat = 'attente';
      this.majProg();
      /* ON ENCHAINE TOUJOURS. Cette ligne testait `this.lecture`, un drapeau
         qui pouvait valoir faux alors que le film jouait : le chapitre suivant
         ne partait pas et le film restait fige sur la derniere image du
         precedent, sans voile, indefiniment. Or ce minuteur n'existe QUE
         pendant un voile en cours de lecture — une pause le supprime
         (figer()), une reprise le rearme (reprendreExact()). S'il arrive au
         bout, c'est donc que le film tournait : il n'y a aucun cas ou il
         faille s'arreter ici. On ne fait plus dependre l'enchainement d'une
         seconde verite qui peut contredire l'etat. */
      setTimeout(() => this.lancerChapitre(), 650 / this.vitesse);
    }, delai);
  }

  /* Le numero et le titre etaient une seule ligne, « CHAPITRE 1 — L'ARRIVÉE ».
     Le panneau de gauche les separe : un petit numero en or pale au-dessus,
     le titre en dessous. Le contenu des textes n'est pas touche. */
  montrerVoile(ch) {
    const bo = this.voile;
    bo.querySelector('.v4-chapitre__num').textContent = 'Chapitre ' + String(ch.id).padStart(2, '0');
    bo.querySelector('.v4-chapitre__titre').textContent = ch.nom;
    bo.querySelector('.v4-voile__textes').innerHTML = ch.textes.map(t => '<p>' + t + '</p>').join('');
    bo.classList.add('is-on');
  }
  cacherVoile() { this.voile.classList.remove('is-on'); }

  /* ---- commandes ---- */
  setLecture(on) {
    this.lecture = on;
    $('#cine-lect').setAttribute('aria-pressed', on ? 'true' : 'false');
    const v = this.vids[this.actifV];
    if (on) {
      if (this.etat === 'course') { try { v.play(); } catch (e) {} this.raf = requestAnimationFrame(() => this.reprendreTick()); }
      else if (this.etat === 'pause' || this.etat === 'voile-pause') { this.reprendreExact(); }
      else if (this.etat === 'fin') { document.documentElement.classList.remove('film-fini'); this.chIdx = 0; this.etat = 'attente'; this.lancerChapitre(); }
      else this.lancerChapitre();
    } else if (this.etat === 'course') { this.figer(); }
  }
  /* PAUSE reelle : tout se fige a l'instant t — video, scenes code, voile */
  figer() {
    const v = this.vids[this.actifV];
    try { v.pause(); } catch (e) {}
    cancelAnimationFrame(this.raf);
    if (this.etat === 'voile') {
      this.voileRestant = Math.max(400, (this.voileEcheance || 0) - performance.now());
      clearTimeout(this.timerVoile);
      this.etat = 'voile-pause';
    } else {
      this.codeScenes.geler();
      this.etat = 'pause';
    }
    $('#cine-lect').setAttribute('aria-pressed', 'false');
  }
  /* REPRISE exacte : on repart de l'instant fige, jamais du debut */
  reprendreExact() {
    $('#cine-lect').setAttribute('aria-pressed', 'true');
    this.lecture = true;   /* reprendre, c'est demander que le film continue */
    if (this.etat === 'voile-pause') { this.etat = 'voile'; this.armerVoile(this.voileRestant || 1400); return; }
    this.etat = 'course';
    const seg = (FILM[this.chIdx].segs || [])[this.segIdx];
    if (seg && seg.code) { this.codeScenes.degeler(); return; }
    const v = this.vids[this.actifV];
    try { v.play(); } catch (e) {}
    this.reprendreTick();
  }
  reprendreTick() {
    /* apres une pause : on repart sur le segment en cours */
    if (this.etat !== 'course') return;
    const ch = FILM[this.chIdx]; const seg = ch.segs[this.segIdx];
    if (!seg || seg.code) return;
    const v = this.vids[this.actifV];
    const tick = () => {
      if (this.etat !== 'course') return;
      const t = v.currentTime;
      this.overlays.tick(seg, t);
      const borne = seg.to || (v.duration ? v.duration - 0.12 : 1e9);
      if (t >= borne || v.ended) { this.suivantSegment(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  pauseReprise() {
    if (this.etat === 'course' || this.etat === 'voile') { this.figer(); return; }
    if (this.etat === 'pause' || this.etat === 'voile-pause') { this.reprendreExact(); return; }
    this.lecture = true; this.setLecture(true); /* accueil, attente, fin : PLAY lance */
  }
  setVitesse(x) {
    this.vitesse = x;
    document.querySelectorAll('#cine-vitesses button').forEach(b => {
      const on = Number(b.dataset.v) === x;
      b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const v = this.vids[this.actifV];
    if (this.etat === 'course') v.playbackRate = clamp(x, 0.25, 8);
    this.codeScenes.setVitesse(x);
    document.documentElement.style.setProperty('--v4-vit', String(x)); /* les animations code suivent le rythme */
  }
  suivant() {
    /* avancer REELLEMENT d'une etape : segment suivant, puis voile, puis chapitre suivant */
    if (this.etat === 'voile' || this.etat === 'voile-pause') {
      const c = this.chIdx + 1;
      if (c >= FILM.length) return;
      this.allerSegment(c, 0); return;
    }
    if (this.etat === 'course' || this.etat === 'pause') {
      if (this.segIdx + 1 >= FILM[this.chIdx].segs.length) { cancelAnimationFrame(this.raf); this.codeScenes.stop(); this.finChapitre(); return; }
      this.allerSegment(this.chIdx, this.segIdx + 1); return;
    }
    if (this.etat === 'fin') return;
    this.lancerChapitre(); /* accueil / attente */
  }
  precedent() {
    /* reculer REELLEMENT d'une etape, en restaurant l'etat du segment vise */
    if (this.etat === 'accueil') return;
    if (this.etat === 'voile' || this.etat === 'voile-pause') { this.allerSegment(this.chIdx, FILM[this.chIdx].segs.length - 1); return; }
    if (this.etat === 'fin') { this.allerSegment(FILM.length - 1, 0); return; }
    if (this.etat === 'course' || this.etat === 'pause') {
      if (this.segIdx > 0) { this.allerSegment(this.chIdx, this.segIdx - 1); return; }
      if (this.chIdx > 0) { this.allerSegment(this.chIdx - 1, FILM[this.chIdx - 1].segs.length - 1); return; }
      this.allerSegment(0, 0); return;
    }
    /* attente entre deux chapitres : chIdx pointe deja le suivant */
    const c = Math.max(0, this.chIdx - 1);
    this.allerSegment(c, FILM[c].segs.length - 1);
  }
  majProg() {
    /* le nombre de chapitres est LU du montage, jamais ecrit en dur : sinon il
       ment des qu'on ajoute ou retire un chapitre */
    $('#cine-prog-n').textContent = String(Math.min(this.chIdx + 1, FILM.length)).padStart(2, '0');
    $('#cine-prog-t').textContent = String(FILM.length).padStart(2, '0');
    $('#cine-prec').disabled = this.chIdx <= 0 && this.etat !== 'course';
    /* La barre des chapitres n'est PLUS marquee ici. Elle se lit desormais de
       la position globale, dans la boucle de rendu de la timeline : une seule
       source de verite pour le curseur, le compteur et le chapitre actif.
       Deux ecrivains pour le meme etat finissent toujours par se contredire. */
  }

  /* ---- gestes : le scroll est un moteur invisible, jamais un deplacement ---- */
  initGestes() {
    addEventListener('wheel', e => {
      if (document.documentElement.classList.contains('page-libre')) return;
      if (this.etat === 'fin') return; /* apres la conclusion, le defilement redevient normal : le bloc societe attend en bas */
      e.preventDefault();
      const now = performance.now();
      if (now - (this.tW || 0) < 420) return; this.tW = now;
      if (e.deltaY > 0) this.suivant(); else this.precedent();
    }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select, button, a')) { if (e.key !== ' ') return; }
      if (this.etat === 'fin' && e.key !== ' ') return; /* fleches et pages libres apres la conclusion */
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); this.suivant(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.precedent(); }
      else if (e.key === ' ') { e.preventDefault(); this.pauseReprise(); }
    });
    let ty = 0, tt = 0;
    addEventListener('touchstart', e => { ty = e.touches[0].clientY; tt = performance.now(); }, { passive: true });
    addEventListener('touchmove', e => { if (this.etat === 'fin') return; if (!e.target.closest('.cine-bar, .menu, a, button, .v4-tablette')) e.preventDefault(); }, { passive: false });
    addEventListener('touchend', e => {
      const dy = ty - e.changedTouches[0].clientY;
      if (performance.now() - tt > 700 || Math.abs(dy) < 52) return;
      if (dy > 0) this.suivant(); else this.precedent();
    }, { passive: true });
    /* Onglet en arriere-plan : on met le film en PAUSE, ce qui est le but —
       mais sans toucher au drapeau `lecture`. L'ancienne version appelait
       setLecture(false), qui mettait le drapeau a faux definitivement : elle
       rangeait la valeur precedente dans `lectureAvant`, que personne ne
       relisait jamais. Au retour, la reprise jouait donc avec le drapeau a
       faux et le film mourait au voile suivant. figer() fait exactement le
       travail attendu, et gere aussi le cas ou l'onglet part pendant un voile. */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.etat === 'course' || this.etat === 'voile')) this.figer();
    });
  }
  initBar() {
    $('#cine-prec').addEventListener('click', () => this.precedent());
    $('#cine-suiv').addEventListener('click', () => this.suivant());
    $('#cine-lect').addEventListener('click', () => this.pauseReprise());
    document.querySelectorAll('#cine-vitesses button').forEach(b => b.addEventListener('click', () => this.setVitesse(Number(b.dataset.v))));
  }
}

/* =================== LES INCRUSTATIONS (tout chiffre est DOM) ============ */
class OverlayRegie {
  constructor(cin) {
    this.cin = cin;
    this.roPesee = $('#ro-pesee'); this.roN = $('#ro-pesee-n'); this.roS = $('#ro-pesee-s');
    this.roLingot = $('#ro-lingot');
    this.roBalance = $('#ro-balance'); this.roBalanceN = $('#ro-balance-n');
    this.roTab = $('#ro-tablette'); this.tabFait = false; this.tabIdx = -1;
    this.roTv = $('#ro-tv'); this.roTvV = $('#ro-tv-v');
    this.roPage = $('#ro-page');
    this.accueil = $('#v4-accueil');
    this.lastTxt = '';
    addEventListener('resize', () => {
      if (this.roBalance && this.roBalance.classList.contains('is-on')) this.poserEcranBalance(this.tEcran || 0);
      if (this.roTv && this.roTv.classList.contains('is-on')) this.poserEcranTv();
      if (this.roPage && this.roPage.classList.contains('is-on')) this.poserPage();
    });
  }
  montre(quoi) { if (quoi === 'accueil') this.accueil.classList.add('is-on'); }
  /* REMISE A ZERO EXHAUSTIVE — appelee a chaque saut dans la barre de temps.
     Chaque incrustation temporaire est eteinte sans exception, et les medias
     qu'elles portent sont arretes. La regle est simple : rien ne survit a un
     changement de temps ; c'est ensuite au segment atteint de rallumer ce qui
     lui appartient. Toute nouvelle incrustation DOIT etre ajoutee ici, sinon
     elle restera figee au milieu du film apres un retour en arriere. */
  cache() {
    this.accueil.classList.remove('is-on');
    this.roPesee.classList.remove('is-on');
    this.roLingot.classList.remove('is-on');
    if (this.roBalance) { this.roBalance.classList.remove('is-on'); this.roBalance.classList.remove('a-segments'); }
    if (this.roTab) this.roTab.classList.remove('is-on');
    if (this.roTv) {
      this.roTv.classList.remove('is-on');
      if (this.roTvV) { try { this.roTvV.pause(); this.roTvV.currentTime = 0; } catch (e) {} }
    }
    if (this.roPage) this.roPage.classList.remove('is-on');
    this.surPeseeMaitre = false;
    this.quadBalFixe = null;
    this.tabIdx = -1;
    this.lastTxt = '';
    const fr = $('#v4-france'); if (fr) fr.classList.remove('is-on');
    const et = $('#v4-etoiles'); if (et) et.classList.remove('is-on');
  }
  /* §PAGE : les 4 coins de la page redressee, releves sur la derniere image du
     plan d'ouverture (fraction du cadre 1728x964). Le document est immobile
     pendant la tenue : un seul quadrilatere suffit. */
  poserPage() {
    if (!this.roPage) return;
    const q = [
      { x: 0.4249, y: 0.4896 }, { x: 0.5920, y: 0.4844 },
      { x: 0.6047, y: 0.8724 }, { x: 0.4120, y: 0.8745 },
    ];
    const st = this.cin.stage;
    const sw = st.clientWidth, sh = st.clientHeight;
    const s = Math.max(sw / 1728, sh / 964);
    const W = 1728 * s, H = 964 * s, ox = (sw - W) / 2, oy = (sh - H) / 2;
    const qPx = q.map(p => ({ x: ox + p.x * W, y: oy + p.y * H }));
    const DW = 620, DH = 860;   /* rectangle de composition de la maquette */
    const el = this.roPage;
    el.style.width = DW + 'px'; el.style.height = DH + 'px';
    el.style.transform = m3dQuad(DW, DH, qPx);
  }
  /* §TV : les 4 coins de la dalle du televiseur, mesures sur la derniere image
     du plan d'approche (fraction du cadre video 1728x964). La camera y est
     immobile : un seul quadrilatere suffit, et le calage a ete verifie a
     0,06 px pres. */
  poserEcranTv() {
    if (!this.roTv) return;
    const q = [
      { x: 0.1719, y: 0.1511 }, { x: 0.7783, y: 0.1568 },
      { x: 0.7783, y: 0.7774 }, { x: 0.1719, y: 0.7821 },
    ];
    const st = this.cin.stage;
    const sw = st.clientWidth, sh = st.clientHeight;
    const s = Math.max(sw / 1728, sh / 964);
    const W = 1728 * s, H = 964 * s, ox = (sw - W) / 2, oy = (sh - H) / 2;
    const qPx = q.map(p => ({ x: ox + p.x * W, y: oy + p.y * H }));
    /* rectangle de composition au rapport reel de la dalle : la video de
       l'ecran est encodee en 1048x598, on projette exactement ce rectangle */
    const DW = 1048, DH = 598;
    const el = this.roTv;
    el.style.width = DW + 'px'; el.style.height = DH + 'px';
    el.style.transform = m3dQuad(DW, DH, qPx);
  }
  /* §5 : les chiffres vivent AUSSI sur l'ecran physique de la balance — un
     panneau DOM cale en perspective sur l'ecran LCD du plan video (il recouvre
     entierement les faux chiffres cuits par la generation). Coordonnees en
     fraction du cadre video 1728x964, mesurees sur les photogrammes. */
  /* ---- AFFICHAGE A SEGMENTS -------------------------------------------------
     Une balance n'affiche pas du texte : elle allume des segments. On les
     dessine donc, plutot que d'ecrire des chiffres avec une police. Sept
     segments par chiffre, en polygones biseautes, plus une virgule et un petit
     « g » trace a la main — aucune fonte n'intervient. Les segments eteints
     restent faiblement visibles, comme sur une vraie dalle. */
  construireLcd() {
    if (this.lcdFait) return;
    const svg = $('#ro-balance-lcd');
    if (!svg) return;
    this.lcdFait = true;
    const NS = 'http://www.w3.org/2000/svg';
    /* Geometrie mesuree sur la dalle : 300 x 104 d'espace utile. Les chiffres
       n'occupent que 64 de haut, centres, et le groupe garde une marge de part
       et d'autre — une balance n'ecrit pas bord a bord. Segments fins (5). */
    const E = 5;
    const LG = 34, HT = 32, Y0 = 20;   /* largeur de segment, demi-hauteur, haut du chiffre */
    const hor = (x, y, L) => [[x + E / 2, y - E / 2], [x + L - E / 2, y - E / 2], [x + L, y],
      [x + L - E / 2, y + E / 2], [x + E / 2, y + E / 2], [x, y]];
    const ver = (x, y, L) => [[x - E / 2, y + E / 2], [x, y], [x + E / 2, y + E / 2],
      [x + E / 2, y + L - E / 2], [x, y + L], [x - E / 2, y + L - E / 2]];
    /* a haut, b haut-droit, c bas-droit, d bas, e bas-gauche, f haut-gauche, g milieu */
    const formes = ox => ({
      a: hor(ox, Y0, LG), g: hor(ox, Y0 + HT, LG), d: hor(ox, Y0 + 2 * HT, LG),
      f: ver(ox, Y0, HT), b: ver(ox + LG, Y0, HT),
      e: ver(ox, Y0 + HT, HT), c: ver(ox + LG, Y0 + HT, HT),
    });
    const CHIFFRES = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
      5: 'afgcd', 6: 'afgecd', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
    this.lcdChiffres = [];
    const X = [40, 88, 148, 196];    /* deux chiffres, virgule, deux chiffres */
    svg.innerHTML = '<defs><linearGradient id="lcdVerre" x1="0" y1="0" x2="0.35" y2="1">' +
      '<stop offset="0" stop-color="rgba(255,255,255,.10)"/>' +
      '<stop offset="0.42" stop-color="rgba(255,255,255,.02)"/>' +
      '<stop offset="0.55" stop-color="rgba(0,0,0,0)"/></linearGradient></defs>';
    for (const ox of X) {
      const g = document.createElementNS(NS, 'g');
      const f = formes(ox), cellule = {};
      for (const k of 'abcdefg') {
        const pol = document.createElementNS(NS, 'polygon');
        pol.setAttribute('points', f[k].map(p => p.join(',')).join(' '));
        pol.setAttribute('class', 'seg-off');
        g.appendChild(pol); cellule[k] = pol;
      }
      svg.appendChild(g); this.lcdChiffres.push(cellule);
    }
    /* la virgule : un petit coin sous la ligne de base du deuxieme chiffre */
    const vg = document.createElementNS(NS, 'polygon');
    vg.setAttribute('points', '132,79 139,79 136,92 130,92');
    vg.setAttribute('class', 'seg-on');
    svg.appendChild(vg);
    /* le « g » de l'unite : une panse et une descendante, tracees au trait.
       Plus petit et plus sourd que les chiffres, comme sur une dalle reelle. */
    const gGroupe = document.createElementNS(NS, 'g');
    gGroupe.setAttribute('fill', 'none');
    gGroupe.setAttribute('stroke', '#ffc258');
    gGroupe.setAttribute('stroke-width', '4');
    gGroupe.setAttribute('stroke-linecap', 'round');
    gGroupe.setAttribute('opacity', '.7');
    const panse = document.createElementNS(NS, 'circle');
    panse.setAttribute('cx', '250'); panse.setAttribute('cy', '58');
    panse.setAttribute('r', '8.5');
    gGroupe.appendChild(panse);
    const queue = document.createElementNS(NS, 'path');
    queue.setAttribute('d', 'M258.5 49.5 V74 a8 8 0 0 1 -13 6');
    gGroupe.appendChild(queue);
    svg.appendChild(gGroupe);
    const verre = document.createElementNS(NS, 'rect');
    verre.setAttribute('x', '0'); verre.setAttribute('y', '0');
    verre.setAttribute('width', '300'); verre.setAttribute('height', '104');
    verre.setAttribute('class', 'lcd-verre');
    svg.appendChild(verre);
    this.lcdSegments = CHIFFRES;
  }
  majLcd(txt) {
    if (!this.lcdChiffres) return;
    /* « 40,00 » -> les quatre chiffres ; le zero de tete reste eteint, comme
       sur une balance qui n'affiche pas 04,50 mais 4,50 */
    const n = txt.replace(',', '');
    const d = n.padStart(4, ' ').slice(-4).split('');
    this.lcdChiffres.forEach((cel, i) => {
      const c = d[i];
      const actifs = (c === ' ' ? '' : (this.lcdSegments[c] || ''));
      for (const k of 'abcdefg') cel[k].setAttribute('class', actifs.includes(k) ? 'seg-on' : 'seg-off');
    });
  }
  /* Le plan de pesee du decor maitre avance vers la balance : la fenetre
     d'affichage grandit et se deplace beaucoup. Une table a deux points ne
     suffit plus — on suit une PISTE mesuree image par image (les 4 coins de la
     dalle noire, relevee a 12 i/s) et on la projette par homographie, comme la
     dalle du televiseur. */
  chargerPisteBalance() {
    if (this.pisteBal !== undefined) return;
    this.pisteBal = null;
    fetch('assets/js/track-pesee-maitre-' + ambiance + '.json')
      .then(r => r.ok ? r.json() : null)
      .then(j => { this.pisteBal = j && j.piste ? j.piste : null; })
      .catch(() => { this.pisteBal = null; });
  }
  poserEcranBalanceSuivi(t) {
    const p = this.pisteBal;
    if (!p || !p.length) return false;
    /* La camera decelere puis s'arrete : mesuree image par image, elle ne bouge
       plus a partir de 8,67 s (releve a 24 i/s, la cadence du plan). Au-dela,
       le masque est VERROUILLE sur un
       quadrilatere fixe — la mediane des releves de la fenetre immobile — pour
       qu'aucun tremblement de detection ne se voie. Avant, il suit la piste :
       un masque fige des le depot deborderait de 120 px, la dalle passant de
       477 a 597 px de large pendant que la camera avance encore. */
    const T_FIXE = 8.67;
    let q;
    if (t >= T_FIXE) {
      if (!this.quadBalFixe) {
        const st = p.filter(s => s.t >= T_FIXE);
        const med = (k, a) => { const v = st.map(s => s.q[k][a]).sort((x, y) => x - y); return v[v.length >> 1]; };
        this.quadBalFixe = [0, 1, 2, 3].map(k => ({ x: med(k, 'x'), y: med(k, 'y') }));
      }
      q = this.quadBalFixe;
    } else {
      let i = 0;
      while (i < p.length - 1 && p[i + 1].t <= t) i++;
      const a = p[i], b = p[Math.min(p.length - 1, i + 1)];
      const f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
      q = a.q.map((pt, k) => ({ x: pt.x + (b.q[k].x - pt.x) * f, y: pt.y + (b.q[k].y - pt.y) * f }));
    }
    const st = this.cin.stage;
    const sw = st.clientWidth, sh = st.clientHeight;
    const s = Math.max(sw / 1728, sh / 964);
    const W = 1728 * s, H = 964 * s, ox = (sw - W) / 2, oy = (sh - H) / 2;
    const qPx = q.map(pt => ({ x: ox + pt.x * W, y: oy + pt.y * H }));
    /* rectangle de composition : sa hauteur donne le corps des chiffres */
    const DW = 300, DH = 104;
    const el = this.roBalance;
    el.style.left = '0'; el.style.top = '0';
    el.style.width = DW + 'px'; el.style.height = DH + 'px';
    el.style.fontSize = (DH * 0.6) + 'px';
    el.style.transformOrigin = '0 0';
    el.style.transform = m3dQuad(DW, DH, qPx);
    this.tEcran = t;
    return true;
  }
  poserEcranBalance(t) {
    if (!this.roBalance) return;
    if (this.surPeseeMaitre && this.poserEcranBalanceSuivi(t || 0)) return;
    /* la fenetre LCD du plan v4-pesee-expert : le plan derive doucement au fil du
       temps, l'ancrage est une table temporelle interpolee (calibree sur captures
       aux deux bouts du plan, par ambiance) */
    const T = ambiance === 'nuit'
      ? [{ t: 0, cx: .506, cy: .789, w: .144, h: .066 }, { t: 7.0, cx: .500, cy: .828, w: .146, h: .070 }]
      : [{ t: 0, cx: .546, cy: .602, w: .152, h: .072 }, { t: 7.0, cx: .514, cy: .661, w: .156, h: .076 }];
    const px = clamp(((t || 0) - T[0].t) / (T[1].t - T[0].t), 0, 1.15);
    const L = (a, b) => a + (b - a) * px;
    const co = { cx: L(T[0].cx, T[1].cx), cy: L(T[0].cy, T[1].cy), w: L(T[0].w, T[1].w), h: L(T[0].h, T[1].h), rx: 12, rz: -0.6 };
    this.tEcran = t || 0;
    const st = this.cin.stage;
    const sw = st.clientWidth, sh = st.clientHeight;
    const s = Math.max(sw / 1728, sh / 964);
    const W = 1728 * s, H = 964 * s, ox = (sw - W) / 2, oy = (sh - H) / 2;
    const el = this.roBalance;
    el.style.left = (ox + (co.cx - co.w / 2) * W) + 'px';
    el.style.top = (oy + (co.cy - co.h / 2) * H) + 'px';
    el.style.width = (co.w * W) + 'px';
    el.style.height = (co.h * H) + 'px';
    el.style.transform = 'perspective(900px) rotateX(' + co.rx + 'deg) rotate(' + co.rz + 'deg)';
    el.style.fontSize = (co.h * H * 0.52) + 'px';
  }
  /* ---- la tablette du bureau (§tablette) : le catalogue vit DANS l'ecran de
     la tablette du PLAN VIDEO — un calque compose, cale par table temporelle,
     qui suit l'approche de la camera puis reste pendant la scene tenue ---- */
  construireTablette() {
    if (this.tabFait || !this.roTab) return;
    this.tabFait = true;
    const cats = [
      ['Bijoux en or', 'Chaînes, bagues, bracelets, colliers', 'cat-bijoux-or.jpg'],
      ['Montres', 'Montres en or, montres de collection', 'cat-montres-luxe.jpg'],
      ['Pièces d’or', 'Napoléons, souverains, pièces d’investissement', 'cat-pieces.jpg'],
      ['Lingots et lingotins', 'Or d’investissement, tous formats', 'cat-lingots.jpg'],
      ['Débris d’or', 'Bijoux cassés, or dentaire, chutes', 'cat-casses.jpg'],
      ['Argent et métaux précieux', 'Argenterie, argent d’investissement', 'cat-argente-etain.jpg'],
    ];
    this.roTab.innerHTML = '<p class="ro-tab__k">Ce que nous rachetons</p>' +
      cats.map((c, i) => '<figure class="ro-tab__fiche' + (i === 0 ? ' is-active' : '') + '">' +
        '<img src="assets/img/' + c[2] + '" alt=""><figcaption><b>' + c[0] + '</b><span>' + c[1] + '</span></figcaption></figure>').join('') +
      '<div class="ro-tab__rail">' + cats.map((c, i) => '<i' + (i === 0 ? ' class="is-active"' : '') + '></i>').join('') + '</div>';
  }
  majTablette(i) {
    if (!this.roTab) return;
    this.tabIdx = i;
    this.roTab.querySelectorAll('.ro-tab__fiche').forEach((f, j) => f.classList.toggle('is-active', j === i));
    this.roTab.querySelectorAll('.ro-tab__rail i').forEach((p, j) => p.classList.toggle('is-active', j === i));
  }
  poserEcranTablette(t) {
    if (!this.roTab) return;
    /* §6 : le catalogue est projete EXACTEMENT sur les 4 coins de l'ecran
       physique (homographie), quads interpoles pendant l'approche */
    const rect = (cx, cy, w, h) => [
      { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
    ];
    const Q = ambiance === 'nuit'
      ? { t0: 0, t1: 7.9, a: rect(.730, .778, .098, .122),
          b: [{ x: .561, y: .368 }, { x: .893, y: .338 }, { x: .884, y: .864 }, { x: .472, y: .786 }] }
      : { t0: 6.4, t1: 7.9, a: rect(.705, .747, .310, .285),
          b: [{ x: .645, y: .570 }, { x: .865, y: .530 }, { x: .845, y: .960 }, { x: .530, y: .920 }] };
    const px = clamp(((t || 0) - Q.t0) / (Q.t1 - Q.t0), 0, 1.02);
    const q = Q.a.map((p, i) => ({ x: p.x + (Q.b[i].x - p.x) * px, y: p.y + (Q.b[i].y - p.y) * px }));
    const st = this.cin.stage;
    const sw = st.clientWidth, sh = st.clientHeight;
    const s = Math.max(sw / 1728, sh / 964);
    const W = 1728 * s, H = 964 * s, ox = (sw - W) / 2, oy = (sh - H) / 2;
    const qPx = q.map(p => ({ x: ox + p.x * W, y: oy + p.y * H }));
    const el = this.roTab;
    const DW = 640, DH = 460; /* rectangle de composition, projete sur le quad */
    el.style.left = '0'; el.style.top = '0';
    el.style.width = DW + 'px'; el.style.height = DH + 'px';
    el.style.fontSize = '52px';
    el.style.transformOrigin = '0 0';
    el.style.transform = m3dQuad(DW, DH, qPx);
    this.tTab = t || 0;
  }
  entreSegment(ch, seg) {
    this.accueil.classList.remove('is-on');
    if (this.roTab) {
      const surTab = seg.ov === 'tablette' || seg.code === 'tablette';
      this.roTab.classList.toggle('is-on', surTab);
      if (seg.ov === 'tablette') { this.construireTablette(); this.tabIdx = -1; this.poserEcranTablette(seg.from || 0); }
    }
    this.roPesee.classList.toggle('is-on', seg.ov === 'pesee0' || seg.ov === 'pesee' || seg.ov === 'peseekit');
    this.roLingot.classList.remove('is-on');
    /* l'ecran de la balance n'existe que sur les plans balance du bureau */
    const surBalance = seg.ov === 'pesee0' || seg.ov === 'pesee';
    /* le plan du decor maitre a sa propre piste de suivi */
    this.surPeseeMaitre = seg.v === 'v4-pesee-maitre';
    if (this.surPeseeMaitre) { this.chargerPisteBalance(); this.construireLcd(); this.quadBalFixe = null; }
    if (this.roBalance) {
      this.roBalance.classList.toggle('is-on', surBalance);
      /* les segments dessines ne servent que sur le plan du decor maitre */
      this.roBalance.classList.toggle('a-segments', this.surPeseeMaitre);
      if (surBalance) {
        this.poserEcranBalance(seg.from || 0);
        this.roBalanceN.textContent = '0,00';
        if (this.surPeseeMaitre) this.majLcd('0,00');
      }
    }
    if (seg.ov === 'pesee0') { this.roN.textContent = '0,00'; this.roS.textContent = 'tare'; this.roPesee.classList.remove('is-stable'); }
    if (seg.ov === 'peseekit') { this.roN.textContent = '0,00'; this.roS.textContent = 'tare'; this.roPesee.classList.remove('is-stable'); }
  }
  tick(seg, t) {
    /* L'incrustation de la balance suit le plan. Sur l'ancien plan, presque fixe,
       un rafraichissement tous les 0,12 s suffisait. Sur le plan du decor maitre
       la camera avance d'une dizaine de pixels dans ce meme intervalle : le
       masque decrochait par a-coups et l'affichage semblait glisser dans la
       dalle. On repositionne donc a CHAQUE image tant que la camera bouge. */
    if (seg.ov === 'pesee' || seg.ov === 'pesee0') {
      const seuil = this.surPeseeMaitre ? 0 : 0.12;
      if (Math.abs(t - (this.tEcran || 0)) > seuil) this.poserEcranBalance(t);
    }
    /* l'ecran de la tablette suit l'approche, les 3 premieres categories defilent
       (le jour, la tablette se dresse vers 4 s : l'ecran compose n'apparait qu'alors) */
    if (seg.ov === 'tablette') {
      /* jour : la tablette se dresse vers 6,2 s — l'ecran compose n'existe qu'apres */
      const debut = ambiance === 'nuit' ? 0.3 : 6.4;
      const nCats = ambiance === 'nuit' ? 3 : 1;
      this.roTab.classList.toggle('is-on', t >= debut);
      if (Math.abs(t - (this.tTab || 0)) > 0.05) this.poserEcranTablette(t);
      const i = Math.max(0, Math.min(nCats - 1, Math.floor((t - debut) / ((7.9 - debut) / nCats))));
      if (t >= debut && i !== this.tabIdx) this.majTablette(i);
    }
    if (seg.ov === 'lingot' && !this.cin.gestesFaits.marteau && t >= 5.3 && t < 6.2) { this.cin.gestesFaits.marteau = 1; this.cin.son.geste('marteau'); }
    if (seg.ov === 'pesee') {
      /* la vraie pesee. Sur le plan du decor maitre, les instants ont ete releves
         image par image : la chaine touche le plateau a 6,1 s, tout est stabilise
         a 7,9 s. L'ancien plan gardait ses propres reperes. */
      const nuit = ambiance === 'nuit';
      const maitre = this.surPeseeMaitre;
      const contact = maitre ? 6.1 : (nuit ? 3.9 : 5.8);
      const stable = maitre ? 7.9 : (nuit ? 5.8 : 7.3);
      let txt = '0,00', st = 'tare';
      if (t >= contact) {
        const x = clamp((t - contact) / (stable - contact), 0, 1);
        const e = 1 - Math.pow(1 - x, 2.1);
        txt = fmtFR(Math.min(40, 40 * e), 2); st = x >= 1 ? 'stable' : 'mesure';
      }
      if (txt !== this.lastTxt) {
        this.lastTxt = txt; this.roN.textContent = txt;
        if (this.roBalanceN) this.roBalanceN.textContent = txt;
        if (this.surPeseeMaitre) this.majLcd(txt);
      }
      if (st === 'mesure' && !this.cin.gestesFaits.bip) { this.cin.gestesFaits.bip = 1; this.cin.son.geste('bip'); }
      if (st === 'stable' && !this.cin.gestesFaits.bip2) { this.cin.gestesFaits.bip2 = 1; this.cin.son.geste('bip2'); }
      this.roS.textContent = st; this.roPesee.classList.toggle('is-stable', st === 'stable');
    }
    if (seg.ov === 'peseekit') {
      const contact = 3.6, stable = 6.0;                          // la pesee a distance, pendant l'examen a la loupe (v4-inventaire)
      let txt = '0,00', st = 'tare';
      if (t >= contact) { const x = clamp((t - contact) / (stable - contact), 0, 1); const e = 1 - Math.pow(1 - x, 2.1); txt = fmtFR(Math.min(12.47, 12.47 * e), 2); st = x >= 1 ? 'stable' : 'mesure'; }
      if (txt !== this.lastTxt) { this.lastTxt = txt; this.roN.textContent = txt; }
      this.roS.textContent = st; this.roPesee.classList.toggle('is-stable', st === 'stable');
    }
    if (seg.ov === 'lingot') this.roLingot.classList.toggle('is-on', t > 4.9); /* la fenetre de la frappe : 4.2 -> 6.2 */
  }
}

/* ================= LES SEGMENTS DE CODE (DOM / canvas) =================== */
class CodeScenes {
  constructor(cin) {
    this.cin = cin; this.calque = $('#v4-code'); this.timer = 0; this.enCours = null;
    this.vitesse = 1; this.franceMod = null;
    /* gel (vraie pause) : chaque minuterie passe par armer()/armerAux() pour
       pouvoir etre suspendue avec son temps restant, puis reprise exactement */
    this.timerFn = null; this.timerEcheance = 0; this.timerRestant = 0;
    this.aux = []; this.gel = false;
    this.franceT0 = 0; this.francePauseA = 0;
    this.etoiles = null;
  }
  setVitesse(x) {
    this.vitesse = x;
    /* la dalle du televiseur suit le rythme du lecteur comme les plans */
    if (this.enCours === 'tv') { const v = this.cin.overlays.roTvV; if (v) v.playbackRate = clamp(x, 0.25, 8); }
  }
  posScene() {
    if (!this.enCours || !this.sceneT0) return 0;
    const now = this.gel && this.francePauseA ? this.francePauseA : performance.now();
    return Math.min(this.sceneDurX1 || 0, (now - this.sceneT0) / 1000 * this.vitesse);
  }
  armer(ms, fn) {
    clearTimeout(this.timer);
    this.timerFn = fn; this.timerEcheance = performance.now() + ms;
    this.timer = setTimeout(fn, ms);
  }
  armerAux(ms, fn) {
    const a = { fn, echeance: performance.now() + ms, restant: 0 };
    a.id = setTimeout(fn, ms);
    this.aux.push(a);
  }
  geler() {
    if (!this.enCours || this.gel) return;
    this.gel = true;
    clearTimeout(this.timer);
    this.timerRestant = Math.max(120, this.timerEcheance - performance.now());
    for (const a of this.aux) { clearTimeout(a.id); a.restant = Math.max(0, a.echeance - performance.now()); }
    this.francePauseA = performance.now();
    this.calque.classList.add('est-gele');
    /* la dalle du televiseur est une vraie video : elle doit se figer aussi */
    if (this.enCours === 'tv') { const v = this.cin.overlays.roTvV; if (v) try { v.pause(); } catch (e) {} }
  }
  degeler() {
    if (!this.enCours || !this.gel) return;
    this.gel = false;
    this.calque.classList.remove('est-gele');
    if (this.francePauseA) {
      const gele = performance.now() - this.francePauseA;
      if (this.franceT0) this.franceT0 += gele;
      if (this.sceneT0) this.sceneT0 += gele; /* la position globale reste figee pendant la pause */
    }
    this.francePauseA = 0;
    if (this.timerFn) this.armer(this.timerRestant, this.timerFn);
    for (const a of this.aux) { if (a.restant > 0) { a.echeance = performance.now() + a.restant; a.id = setTimeout(a.fn, a.restant); } }
    if (this.enCours === 'tv') {
      const v = this.cin.overlays.roTvV;
      if (v) { v.playbackRate = clamp(this.vitesse, 0.25, 8); v.play().catch(() => {}); }
    }
  }
  stop() {
    /* Toute scene de code peut avoir laisse des callbacks en vol : minuteurs,
       ecouteurs de media, boucles d'image. On change de GENERATION pour les
       rendre inertes, et on defait explicitement ce qui a ete pose. Sans cela un
       saut dans la barre de temps laissait remonter un ancien etat par-dessus le
       plan en cours. */
    this.gen = (this.gen || 0) + 1;
    for (const f of (this.aNettoyer || [])) { try { f(); } catch (e) {} }
    this.aNettoyer = [];
    clearTimeout(this.timer); this.timerFn = null;
    for (const a of this.aux) clearTimeout(a.id);
    this.aux = []; this.gel = false; this.franceT0 = 0; this.francePauseA = 0;
    this.calque.className = 'v4-code'; this.calque.innerHTML = '';
    this.enCours = null;
    const c = $('#v4-france'); if (c) c.classList.remove('is-on');
    if (this.etoiles) this.etoiles.classList.remove('is-on');
    const rt = $('#ro-tablette'); if (rt && !(this.cin && this.cin.etat === 'course')) rt.classList.remove('is-on');
    const tv = $('#ro-tv');
    if (tv) { tv.classList.remove('is-on'); const tvv = $('#ro-tv-v'); if (tvv) { try { tvv.pause(); } catch (e) {} } }
  }
  jouer(seg, fini, decalage) {
    this.aNettoyer = this.aNettoyer || [];
    this.enCours = seg.code; this.calque.className = 'v4-code is-on v4-code--' + seg.code;
    /* `decalage` : on entre dans la scene a cet instant-la, pas a son debut. La
       position globale doit donc partir deja avancee, et il ne reste a jouer que
       ce qui suit. */
    this.decalage = decalage || 0;
    this.sceneDurX1 = seg.dur || 8;                       /* pour la timeline globale */
    this.sceneT0 = performance.now() - this.decalage * 1000 / this.vitesse;
    const dur = Math.max(400, ((seg.dur || 8) - this.decalage) * 1000 / this.vitesse);
    const rendu = this['scene_' + seg.code];
    if (rendu) rendu.call(this, seg, fini, dur);
    else this.finir(fini, dur);
  }
  finir(fini, dur) { this.armer(dur, () => { this.stop(); fini(); }); }

  /* ---- le ciel etoile (§6) : espace noir profond, etoiles a plusieurs
     profondeurs, quelques poussieres dorees — dessine en code, aucun credit ---- */
  montrerEtoiles() {
    if (!this.etoiles) {
      const c = document.createElement('canvas');
      c.id = 'v4-etoiles'; c.setAttribute('aria-hidden', 'true');
      const fr = $('#v4-france');
      fr.parentElement.insertBefore(c, fr);
      this.etoiles = c;
      this.etoilesData = null;
    }
    const c = this.etoiles;
    const w = this.cin.stage.clientWidth, h = this.cin.stage.clientHeight;
    if (c.width !== w || c.height !== h || !this.etoilesData) {
      c.width = w; c.height = h;
      /* champ deterministe : 3 profondeurs d'etoiles + poussieres d'or */
      let s = 421; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const etoiles = [];
      for (let i = 0; i < 420; i++) {
        const prof = rnd();
        etoiles.push({ x: rnd() * w, y: rnd() * h, r: 0.4 + prof * 1.5, a: 0.12 + prof * 0.55, ph: rnd() * 6.28, vs: 0.3 + rnd() * 1.2, teinte: rnd() });
      }
      const ors = [];
      for (let i = 0; i < 30; i++) ors.push({ x: rnd() * w, y: rnd() * h, r: 0.5 + rnd() * 1.1, a: 0.05 + rnd() * 0.14, ph: rnd() * 6.28 });
      this.etoilesData = { etoiles, ors };
    }
    c.classList.add('is-on');
    const ctx = c.getContext('2d');
    const dessine = (t) => {
      if (this.enCours !== 'france' && this.enCours !== 'parcours') return;
      if (!this.gel) {
        ctx.clearRect(0, 0, c.width, c.height);
        for (const e of this.etoilesData.etoiles) {
          const tw = reduced ? 1 : (0.75 + 0.25 * Math.sin(t / 900 * e.vs + e.ph));
          ctx.globalAlpha = e.a * tw;
          ctx.fillStyle = e.teinte > 0.86 ? '#e8cd93' : (e.teinte > 0.5 ? '#dfe6f2' : '#ffffff');
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.283); ctx.fill();
        }
        for (const o of this.etoilesData.ors) {
          ctx.globalAlpha = o.a * (reduced ? 1 : (0.6 + 0.4 * Math.sin(t / 1600 + o.ph)));
          ctx.fillStyle = '#c99a3f';
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!reduced) requestAnimationFrame(dessine);
    };
    requestAnimationFrame(dessine);
  }

  scene_tablette(seg, fini, dur) {
    /* la camera est arretee devant la tablette du PLAN VIDEO (derniere frame
       tenue) : les dernieres categories defilent DANS son ecran, puis le film
       repart — aucun calque plein cadre, aucun decor reconstruit */
    const ov = this.cin.overlays;
    ov.construireTablette();
    ov.roTab.classList.add('is-on');
    ov.poserEcranTablette(7.9); /* la position finale de l approche */
    let i = Math.min(5, (ov.tabIdx | 0) + 1); /* on reprend ou l'approche s'est arretee */
    ov.majTablette(i);
    const pas = Math.max(900, dur / (6 - i + 0.4));
    const cycle = () => {
      if (!this.enCours) return;
      i++;
      if (i > 5) { ov.roTab.classList.remove('is-on'); this.stop(); fini(); return; }
      ov.majTablette(i);
      this.armer(pas, cycle);
    };
    this.armer(pas, cycle);
  }

  /* §PAGE : le document s'est redresse (derniere image du plan d'ouverture,
     tenue). Le recapitulatif apparait d'un bloc sur la page — aucune animation
     d'ecriture, aucun stylo — puis le film repart et le document se referme. */
  scene_page(seg, fini, dur) {
    const ov = this.cin.overlays;
    if (!ov.roPage) { this.finir(fini, dur); return; }
    ov.poserPage();
    /* un souffle avant l'apparition : la page finit de se stabiliser */
    this.armerAux(420, () => { if (this.enCours === 'page') ov.roPage.classList.add('is-on'); });
    this.armer(dur, () => { ov.roPage.classList.remove('is-on'); this.stop(); fini(); });
  }

  /* §TV : la camera s'est arretee face au televiseur (derniere image du plan
     d'approche, tenue). La dalle s'allume et « Ce que nous rachetons » s'y
     joue : titre, puis les douze familles, chacune coupee au noir avant la
     suivante. Aucun calque plein cadre — seule la surface de l'ecran vit. */
  scene_tv(seg, fini, dur) {
    const ov = this.cin.overlays;
    if (!ov.roTv || !ov.roTvV) { this.finir(fini, dur); return; }
    const v = ov.roTvV;
    const gen = this.gen;   /* toute reprise ou tout saut invalide cette scene */
    const src = 'assets/video/v4-tv-ecran-' + ambiance + '.mp4';
    if (v.dataset.src !== src) { v.dataset.src = src; v.src = src; v.load(); }
    ov.poserEcranTv();
    /* on entre l'ecran a l'instant demande par la barre de temps, pas a zero */
    const debut = clamp(this.decalage || 0, 0, Math.max(0, (seg.dur || 8) - 0.3));
    const caler = () => { try { v.currentTime = debut; } catch (e) {} };
    if (v.readyState >= 1) caler();
    else { v.addEventListener('loadedmetadata', caler, { once: true }); }
    v.playbackRate = clamp(this.vitesse, 0.25, 8);
    /* BUG CORRIGE — sans ce garde, un saut dans la barre de temps pendant le
       chargement laissait vivre l'ecouteur : « canplay » arrivait apres coup et
       rallumait la television par-dessus le plan en cours, ou elle restait
       affichee. Toute callback differee verifie desormais qu'elle appartient
       encore a la scene courante. */
    const vivante = () => this.gen === gen && this.enCours === 'tv';
    /* La dalle s'allume TOUT DE SUITE : faire dependre sa visibilite d'un
       evenement de chargement la laissait eteinte deux fois sur sept apres un
       saut, « canplay » ne se redeclenchant pas toujours apres un
       repositionnement. La lecture, elle, est simplement retentee. */
    ov.roTv.classList.add('is-on');
    const lance = () => { if (!vivante()) return; v.play().catch(() => {}); };
    lance();
    for (const ev of ['canplay', 'seeked', 'loadeddata']) {
      v.addEventListener(ev, lance);
      this.aNettoyer.push(() => v.removeEventListener(ev, lance));
    }
    /* le film reprend a la fin de l'ecran ; le minuteur reste le garde-fou si
       la video ne rend pas la main (fichier absent, decodage refuse) */
    const finir = () => { if (!vivante()) return; ov.roTv.classList.remove('is-on'); try { v.pause(); } catch (e) {} this.stop(); fini(); };
    v.addEventListener('ended', finir);
    this.aNettoyer.push(() => v.removeEventListener('ended', finir));
    this.armer(dur + 900, finir);
  }

  /* Les scenes « devis » et « accord » ont ete supprimees : la carte blanche
     qu'elles dessinaient est remplacee par le texte porte par l'ecran du
     televiseur. Leur code est retire, pas seulement leur appel — sinon il
     resterait du mort dans le moteur. */

  async scene_france(seg, fini, dur) {
    /* §6 : on emerge des nuages dans l'ESPACE NOIR PROFOND — etoiles fines a
       plusieurs profondeurs, poussieres d'or — puis les particules dorees
       dessinent LA grande France. Aucune planete, aucune courbure, aucun halo. */
    this.calque.innerHTML = '<p class="v4-code__k v4-france__k">Nos journées d’expertise, partout en France</p>';
    this.montrerEtoiles();
    const c = $('#v4-france'); c.classList.add('is-on');
    try {
      if (!this.franceMod) {
        const [{ createFranceMap }, data] = await Promise.all([
          import('./francemap.js'),
          fetch('assets/js/france-outline.json').then(r => r.json()),
        ]);
        this.franceMod = createFranceMap(c, data, { reduced, focusCity: 'Erstein', tour: [] });
      }
      this.franceMod.start(); this.franceMod.setProgress(0);
      const espace = Math.min(3200 / this.vitesse, dur * 0.24); /* le temps d'habiter le noir etoile */
      this.franceT0 = performance.now();
      const anime = () => {
        if (this.enCours !== 'france') { this.franceMod.stop(); return; }
        if (this.gel) { requestAnimationFrame(anime); return; }
        const t = performance.now() - this.franceT0;
        const p = clamp((t - espace) / (dur - espace), 0, 1);
        this.franceMod.setProgress(p);
        if (p < 1) requestAnimationFrame(anime);
        else { this.franceMod.stop(); c.classList.remove('is-on'); this.stop(); fini(); }
      };
      requestAnimationFrame(anime);
    } catch (e) { console.warn('France indisponible', e); this.finir(fini, Math.min(dur, 1500)); }
  }

  async scene_parcours(seg, fini, dur) {
    this.calque.innerHTML = '<div class="v4-parcours"><p class="v4-code__k">Deux parcours, une même exigence</p>' +
      '<div class="v4-parcours__voies">' +
      '<div class="v4-parcours__voie" style="--i:1"><b>Rendez-vous physique</b><span>lors de nos journées d’expertise</span></div>' +
      '<div class="v4-parcours__voie" style="--i:2"><b>Kit sécurisé</b><span>sans vous déplacer</span></div>' +
      '</div></div>';
    this.montrerEtoiles();
    const c = $('#v4-france'); c.classList.add('is-on');
    try {
      if (this.franceMod) { this.franceMod.start(); this.franceMod.setProgress(1); }
    } catch (e) {}
    this.armer(dur, () => { try { this.franceMod && this.franceMod.stop(); } catch (e) {} c.classList.remove('is-on'); this.stop(); fini(); });
  }

  scene_choix(seg, fini, dur) {
    /* §Y : la proposition arrive chez le client, sur son SMARTPHONE */
    this.calque.innerHTML = '<div class="v4-tel"><div class="v4-tel__corps">' +
      '<p class="v4-tel__marque">La Compagnie de l’Or</p>' +
      '<p class="v4-tel__titre">Proposition</p>' +
      '<p class="v4-tel__ligne" style="--i:0">Dossier n° 26-0911 · pesée filmée — <b>12,47 g</b></p>' +
      '<p class="v4-tel__ligne" style="--i:1">Montant établi au cours du jour</p>' +
      '<div class="v4-tel__choix" style="--i:2">' +
      '<button type="button" class="v4-tel__btn v4-tel__btn--oui">Accepter</button>' +
      '<button type="button" class="v4-tel__btn">Refuser</button></div>' +
      '<p class="v4-tel__note v4-tel__note--oui" style="--i:3">En cas d’accord — <b>virement bancaire</b></p>' +
      '<p class="v4-tel__note" style="--i:4">En cas de refus — retour sécurisé de vos objets</p>' +
      '</div></div>';
    /* la séquence : la proposition se lit, ACCEPTER s’illumine, la confirmation tombe */
    this.armerAux(dur * 0.55, () => {
      if (this.enCours !== 'choix') return;
      const b = this.calque.querySelector('.v4-tel__btn--oui'); if (b) b.classList.add('is-choisi');
      const n = this.calque.querySelector('.v4-tel__note--oui'); if (n) n.classList.add('is-on');
    });
    this.finir(fini, dur);
  }


  scene_carte(seg, fini, dur) {
    /* §9 : AUCUN rectangle — les coordonnees s'impriment SUR la carte physique
       tenue dans la main (frame pausee) : encre brune en mode multiply, calee
       sur l'angle de la carte, dans sa zone visible (le pouce couvre la droite) */
    this.calque.innerHTML = '<div class="v4-carte">' +
      '<div class="v4-carte__carte"><p class="v4-carte__nom">LA COMPAGNIE DE L’OR</p>' +
      '<p class="v4-carte__soc">Société Or Expert SAS</p>' +
      '<p class="v4-carte__l">8 rue Etienne Richerand · 69003 Lyon</p>' +
      '<p class="v4-carte__l"><a href="tel:+33981222566">09 81 22 25 66</a> · <a href="mailto:contact@orexpert.fr">contact@orexpert.fr</a></p>' +
      '<p class="v4-carte__l v4-carte__l--fin">SIREN 893 848 846 · SIRET 893 848 846 00018</p></div>' +
      '<p class="v4-carte__slogan">L’EXPERTISE, OÙ QUE VOUS SOYEZ.</p>' +
      /* UN SEUL bouton, a la place des deux precedents (« Voir les prochaines
         dates » et « Recevoir mon kit »). Il pointe sur le formulaire de
         contact DEJA EXISTANT, la section #rendezvous de l'accueil : aucun
         nouveau formulaire n'est cree. Le conteneur est deja centre, donc un
         bouton unique se place de lui-meme. La marque `data-sortie-film` est
         lue plus bas pour rendre la page au defilement et arreter les couches
         video avant de laisser le lien naviguer. */
      '<div class="v4-carte__cta"><a class="btn btn--gold" data-sortie-film href="index.html#rendezvous">Nous contacter</a></div></div>';
    /* le texte est projete DANS LE PLAN DE LA CARTE : le quad de la carte est
       mesure sur la frame, la zone d'impression en est un sous-quad bilineaire
       (memes lignes de fuite), et le POUCE occlut le texte via un masque
       clip-path defini dans le repere imprime (il suit la projection). */
    const sousQuad = (q, u0, v0, u1, v1) => {
      const p = (u, v) => ({
        x: (1 - v) * ((1 - u) * q[0].x + u * q[1].x) + v * ((1 - u) * q[3].x + u * q[2].x),
        y: (1 - v) * ((1 - u) * q[0].y + u * q[1].y) + v * ((1 - u) * q[3].y + u * q[2].y),
      });
      return [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)];
    };
    const Q = ambiance === 'nuit'
      ? { carte: [{ x: .235, y: .265 }, { x: .5175, y: .465 }, { x: .4275, y: .730 }, { x: .145, y: .530 }],
          zone: [.10, .20, .92, .84],
          clip: 'polygon(0% 0%, 100% 0%, 100% 4%, 72% 10%, 61% 24%, 57% 42%, 60% 58%, 68% 68%, 84% 74%, 100% 78%, 100% 100%, 0% 100%)' }
      : { carte: [{ x: .305, y: .095 }, { x: .630, y: .270 }, { x: .550, y: .720 }, { x: .225, y: .545 }],
          zone: [.10, .18, .92, .82],
          clip: 'polygon(0% 0%, 100% 0%, 100% 12%, 88% 20%, 81% 34%, 79% 52%, 83% 66%, 90% 74%, 100% 78%, 100% 100%, 0% 100%)' };
    const st = this.cin.stage;
    const s = Math.max(st.clientWidth / 1728, st.clientHeight / 964);
    const W = 1728 * s, H = 964 * s, ox = (st.clientWidth - W) / 2, oy = (st.clientHeight - H) / 2;
    const zq = sousQuad(Q.carte, Q.zone[0], Q.zone[1], Q.zone[2], Q.zone[3]);
    const qPx = zq.map(p => ({ x: ox + p.x * W, y: oy + p.y * H }));
    const carte = this.calque.querySelector('.v4-carte__carte');
    const DW = 520, DH = 320;
    carte.style.left = '0'; carte.style.top = '0';
    carte.style.width = DW + 'px'; carte.style.height = DH + 'px';
    carte.style.fontSize = '27px';
    carte.style.transformOrigin = '0 0';
    carte.style.transform = m3dQuad(DW, DH, qPx);
    carte.style.clipPath = Q.clip;
    carte.style.display = 'grid'; carte.style.alignContent = 'center';
    /* la fin du film : la lumiere diminue, la carte reste, le moteur conclut */
    this.armer(dur, () => {
      this.calque.classList.add('v4-code--fin');
      this.cin.etat = 'fin'; document.documentElement.classList.add('film-fini'); this.cin.lecture = false;
      const b = document.getElementById('cine-lect'); if (b) b.setAttribute('aria-pressed', 'false');
    });
  }
}

/* ==================== LE SON V4 (WebAudio, 0 credit) =====================
   Une couche d'ambiance par lieu (vent d'hiver, feu, interieur+tic-tac,
   forge) fondue a l'entree de chaque segment, et des gestes ponctuels :
   gonds, pas, bips de balance, plume, cachet, cloche, LE coup de poincon. */
class SonV4 {
  constructor() {
    this.btn = document.getElementById('sound');
    /* SON ACTIVE PAR DEFAUT. L'interface part sur « active » et ne s'en
       departira jamais toute seule.

       Les navigateurs refusent de jouer du son avant un geste de
       l'utilisateur — c'est leur regle, pas un choix du site. La tentation
       serait alors de basculer le bouton sur « coupe » : ce serait mentir sur
       ce que l'utilisateur a demande. On garde donc l'etat affiche, on
       construit tout de suite le moteur audio pour qu'il soit pret, et on
       attend le premier geste autorise pour reprendre le contexte. */
    this.on = true; this.ctx = null; this.layers = {}; this.cur = null;
    this.refleteBouton();
    if (this.btn) {
      this.btn.addEventListener('click', () => this.toggle());
    }
    this.ensure();
    if (this.ctx) { try { this.ctx.resume(); } catch (e) {} }
    this.debloquerAuPremierGeste();
    document.addEventListener('visibilitychange', () => { if (this.ctx) { if (document.hidden) this.ctx.suspend(); else if (this.on) this.ctx.resume(); } });
  }
  refleteBouton() {
    if (!this.btn) return;
    this.btn.setAttribute('aria-pressed', String(this.on));
    this.btn.classList.toggle('is-on', this.on);
  }
  /* Premier geste autorise : on reprend le contexte audio et on repose
     l'ambiance du plan en cours. On se retire des qu'il tourne vraiment ; tant
     qu'il reste suspendu, on reessaie au geste suivant. */
  debloquerAuPremierGeste() {
    const GESTES = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    const reprendre = () => {
      if (!this.on) return;
      this.ensure();
      if (!this.ctx) return;
      this.ctx.resume().then(() => {
        if (this.ctx.state !== 'running') return;
        if (this.cur) this.pose(this.cur);
        GESTES.forEach(g => document.removeEventListener(g, reprendre));
      }).catch(() => {});
    };
    GESTES.forEach(g => document.addEventListener(g, reprendre, { passive: true }));
  }
  toggle() {
    this.on = !this.on;
    this.refleteBouton();
    if (this.on) { this.ensure(); this.ctx && this.ctx.resume(); if (this.cur) this.pose(this.cur); }
    else if (this.ctx) { const now = this.ctx.currentTime; for (const L of Object.values(this.layers)) L.g.gain.setTargetAtTime(0, now, 0.4); }
  }
  ensure() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.42; this.master.connect(ctx.destination);
    const len = 4 * ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.layers = { hiver: this.mkHiver(), feu: this.mkFeu(), salon: this.mkSalon(), forge: this.mkForge() };
  }
  src() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.85 + Math.random() * 0.3; s.start(); return s; }
  lfo(p, f, depth, base) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = f; g.gain.value = depth; o.connect(g); g.connect(p); p.value = base; o.start(); }
  couche(build, niveau) { const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master); build(g); return { g, niveau }; }
  mkHiver() { return this.couche(out => { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; this.lfo(f.frequency, 0.06, 130, 300); const n = this.src(); const t = this.ctx.createGain(); t.gain.value = 0.5; n.connect(f); f.connect(t); t.connect(out); }, 0.3); }
  mkFeu() {
    return this.couche(out => {
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 170; const n = this.src(); const t = this.ctx.createGain(); t.gain.value = 0.4; n.connect(f); f.connect(t); t.connect(out); this.lfo(t.gain, 0.5, 0.08, 0.4);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 1.2; const n2 = this.src(); const cg = this.ctx.createGain(); cg.gain.value = 0; n2.connect(bp); bp.connect(cg); cg.connect(out);
      const ctx = this.ctx; (function crepite() { const now = ctx.currentTime; cg.gain.cancelScheduledValues(now); cg.gain.setValueAtTime(0, now); cg.gain.linearRampToValueAtTime(0.08 + Math.random() * 0.1, now + 0.012); cg.gain.exponentialRampToValueAtTime(0.001, now + 0.06 + Math.random() * 0.09); setTimeout(crepite, 220 + Math.random() * 900); })();
    }, 0.42);
  }
  mkSalon() {
    return this.couche(out => {
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120; const n = this.src(); const t = this.ctx.createGain(); t.gain.value = 0.32; n.connect(f); f.connect(t); t.connect(out);
      /* la grande horloge : un tic feutre par seconde */
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 6; const n2 = this.src(); const tg = this.ctx.createGain(); tg.gain.value = 0; n2.connect(bp); bp.connect(tg); tg.connect(out);
      const ctx = this.ctx; (function tic() { const now = ctx.currentTime; tg.gain.cancelScheduledValues(now); tg.gain.setValueAtTime(0.05, now); tg.gain.exponentialRampToValueAtTime(0.0008, now + 0.05); setTimeout(tic, 1000); })();
    }, 0.15);
  }
  mkForge() { return this.couche(out => { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90; const n = this.src(); const t = this.ctx.createGain(); t.gain.value = 0.8; n.connect(f); f.connect(t); t.connect(out); this.lfo(t.gain, 0.18, 0.14, 0.8); const h = this.ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 5200; const n2 = this.src(); const t2 = this.ctx.createGain(); t2.gain.value = 0.02; n2.connect(h); h.connect(t2); t2.connect(out); }, 0.4); }
  /* quel lieu pour quel segment */
  lieuDe(cle) {
    if (/village|enseigne|seuil|porte-traversee|fenetre|envol|s19|nuages|orbite|plongee|colis-voyage|s15-kit|mains-depose/.test(cle)) return 'hiver';
    if (/s4-hall|receptionniste|carte$/.test(cle)) return 'feu';
    if (/s11|s12|s13|s14|fonderie/.test(cle)) return 'forge';
    return 'salon';
  }
  pose(cle) {
    this.cur = cle;
    if (!this.on || !this.ctx) return;
    const lieu = this.lieuDe(cle); const now = this.ctx.currentTime;
    for (const [k, L] of Object.entries(this.layers)) L.g.gain.setTargetAtTime(k === lieu ? L.niveau : 0, now, 1.3);
  }
  geste(nom) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const tonal = (f0, f1, dur, g0) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, now); if (f1) o.frequency.exponentialRampToValueAtTime(f1, now + dur * 0.6); const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(g0, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + dur); o.connect(g); g.connect(this.master); o.start(now); o.stop(now + dur + 0.05); };
    const souffle = (freq, q, dur, g0) => { const n = this.src(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.setValueAtTime(g0, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur); n.connect(f); f.connect(g); g.connect(this.master); setTimeout(() => { try { n.stop(); } catch (e) {} }, dur * 1000 + 80); };
    if (nom === 'gonds') tonal(90, 55, 0.7, 0.06);
    else if (nom === 'bip') tonal(880, 0, 0.07, 0.05);
    else if (nom === 'bip2') { tonal(880, 0, 0.06, 0.05); setTimeout(() => { const n2 = ctx.currentTime; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1174; const g = ctx.createGain(); g.gain.setValueAtTime(0.05, n2); g.gain.exponentialRampToValueAtTime(0.0001, n2 + 0.09); o.connect(g); g.connect(this.master); o.start(n2); o.stop(n2 + 0.12); }, 110); }
    else if (nom === 'plume') souffle(2600, 0.7, 0.5, 0.05);
    else if (nom === 'cachet') tonal(120, 60, 0.22, 0.16);
    else if (nom === 'cloche') tonal(660, 655, 1.6, 0.045);
    else if (nom === 'marteau') { tonal(160, 52, 0.24, 0.3); souffle(3200, 0.8, 0.06, 0.1); }
    else if (nom === 'velours') souffle(900, 0.5, 0.3, 0.035);
  }
}

/* ---------- ambiance : bascule sans flash (fondu par le noir) ------------ */
function basculerAmbiance(vers) {
  if (vers === ambiance) return;
  const nuitVersJour = vers === 'jour';
  document.documentElement.classList.add('bascule-amb');
  setTimeout(() => {
    ambiance = vers;
    document.documentElement.dataset.ambiance = vers;
    try { localStorage.setItem(CLE_AMB, vers); } catch (e) {}
    if (window.__cinema) window.__cinema.construireCarte(); /* les jumeaux different de quelques frames */
    /* recharge la couche active sur le jumeau, au meme temps */
    const cin = window.__cinema;
    const v = cin.vids[cin.actifV];
    const ch = FILM[cin.chIdx]; const seg = ch && ch.segs[cin.segIdx];
    if (seg && seg.v && seg.amb2) {
      const t = v.currentTime; const enCourse = cin.etat === 'course';
      v.dataset.src = cin.srcDe(seg); v.src = v.dataset.src; v.load();
      v.addEventListener('loadedmetadata', () => { v.currentTime = t; if (enCourse) { v.playbackRate = cin.vitesse; v.play().catch(() => {}); cin.reprendreTick(); } }, { once: true });
    }
    setTimeout(() => document.documentElement.classList.remove('bascule-amb'), 480);
  }, 420);
}

/* ------------------------------- boot ------------------------------------ */
addEventListener('DOMContentLoaded', () => {
  const cin = new Cinema();
  window.__cinema = cin;
  /* le decoupage est expose pour les controles : sans lui, un banc doit coder
     en dur l'index d'un plan et tombe en echec des qu'on insere un segment —
     ce qui fait passer une modification saine pour une regression. */
  window.__film = FILM;
  /* le rail et le menu suivent le montage : on retire les entrees qui ne
     correspondent plus a aucun chapitre, et on reprend les titres reels */
  document.querySelectorAll('#rail a').forEach((a, i) => {
    if (i >= FILM.length) { a.remove(); return; }
    a.setAttribute('href', '#ch' + (i + 1));
    a.setAttribute('title', FILM[i].nom);
    a.textContent = '';
    const nom = document.createElement('span'); nom.className = 'rail__nom'; nom.textContent = FILM[i].nom;
    const num = document.createElement('b'); num.className = 'rail__n'; num.textContent = String(i + 1).padStart(2, '0');
    const trait = document.createElement('i'); trait.className = 'rail__trait'; trait.setAttribute('aria-hidden', 'true');
    a.append(nom, num, trait);
  });

  /* ---- LE REPLI DE LA BARRE ----------------------------------------------
     Repliee, la barre ne disparait jamais : le nom s'efface, la colonne des
     numeros et leurs reperes restent, et le chevron reste la pour rouvrir.
     L'etat est garde d'une visite a l'autre, dans le navigateur seulement.
     Chaque lecture et chaque ecriture est protegee : en navigation privee ou
     avec les donnees de site bloquees, l'acces lui-meme peut lever une
     exception, et une barre de navigation ne doit pas tomber pour si peu. */
  const nav = $('#v4-nav'), pli = $('#v4-nav-pli');
  if (nav && pli) {
    const CLE = 'compagnie-or-nav-repliee';
    let replie = false;
    try { replie = localStorage.getItem(CLE) === '1'; } catch (e) {}
    const applique = () => {
      nav.classList.toggle('is-replie', replie);
      pli.setAttribute('aria-expanded', replie ? 'false' : 'true');
      pli.setAttribute('aria-label', replie ? 'Afficher le nom des chapitres' : 'Réduire la navigation des chapitres');
    };
    applique();
    pli.addEventListener('click', () => {
      replie = !replie;
      applique();
      try { localStorage.setItem(CLE, replie ? '1' : '0'); } catch (e) {}
    });
  }
  const joli = s => s.charAt(0) + s.slice(1).toLocaleLowerCase('fr');
  document.querySelectorAll('#menu a[href^="#ch"]').forEach((a, i) => {
    if (i >= FILM.length) { const li = a.closest('li'); (li || a).remove(); return; }
    a.setAttribute('href', '#ch' + (i + 1));
    a.innerHTML = '<span class="menu__n">' + String(i + 1).padStart(2, '0') + '</span>' + joli(FILM[i].nom);
  });
  document.querySelectorAll('#ab-toggle button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#ab-toggle button').forEach(x => x.classList.toggle('is-active', x === b));
    basculerAmbiance(b.dataset.ab);
  }));
  /* liens internes : chapitres ou liberation de la page (societe) */
  /* SORTIE PROPRE DU FILM vers le formulaire de contact. Le lien quitte la
     page ; sans ce geste on la quitterait avec le film encore en lecture et le
     defilement toujours confisque — et si la navigation est annulee (retour
     arriere, ouverture dans un onglet), on reste bloque dans un film muet.
     On rend donc la page au defilement et on arrete les deux couches AVANT de
     laisser le lien faire son travail : on ne previent pas l'evenement. */
  document.addEventListener('click', e => {
    if (!e.target.closest('a[data-sortie-film]')) return;
    document.documentElement.classList.add('page-libre');
    try { cin.setLecture(false); } catch (err) {}
    cin.vids.forEach(v => { try { v.pause(); } catch (err) {} });
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (id === 'societe') { document.documentElement.classList.add('page-libre'); return; }
    const m = /^ch(\d+)$/.exec(id);
    /* UN SEUL SYSTEME DE DEPLACEMENT. Ce lien fabriquait sa propre navigation
       — poser chIdx a la main, puis relancer le chapitre — en parallele de la
       barre de temps. Deux chemins pour aller au meme endroit finissent par ne
       plus dire la meme chose. On passe donc par allerTemps(), le seek global,
       vise sur le debut exact du chapitre lu dans la carte du temps.
       (La borne haute etait par ailleurs ecrite « 7 », heritee d'un montage a
       8 chapitres : un lien vers un chapitre inexistant sortait du tableau.) */
    if (m) {
      e.preventDefault();
      const ci = clamp(Number(m[1]) - 1, 0, FILM.length - 1);
      if (cin.carte) cin.allerTemps(cin.carte.chapitres[ci].debut);
      else { cin.chIdx = ci; cin.etat = 'attente'; cin.majProg(); cin.lancerChapitre(); }
      const menu = $('#menu'); if (menu) menu.hidden = true;
    }
  });
  /* premiere image : le village, pret a partir */
  cin.precharge(FILM[0].segs[0]);
  const v = cin.vids[1]; // precharge remplit la couche libre (1)
  v.classList.add('is-on'); cin.actifV = 1;
});
