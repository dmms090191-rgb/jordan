/* scenes/parcours3d.js · LE MOTEUR DU PARCOURS
   ==========================================================================
   UN SEUL RENDERER, UNE SEULE SCÈNE, QUATRE TABLEAUX, UNE CAMÉRA QUI DESCEND.

   L'ancienne section montait quatre modules indépendants, dont un seul en
   WebGL. Ici il n'y a qu'un contexte graphique pour toute la section : les
   quatre tableaux vivent dans le même espace, sous le même environnement de
   reflet, et la caméra les traverse. C'est ce qui donne la continuité — et
   c'est aussi ce qui tient la promesse de performance, puisqu'un contexte
   coûte cher et qu'un navigateur en refuse au-delà d'une quinzaine.

   ─────────────────────────────────────────────────────────────────────────
   LE POINT DE CONCEPTION LE PLUS IMPORTANT : C'EST LE TEXTE QUI COMMANDE.

   La caméra ne suit pas des valeurs écrites à la main. À chaque
   redimensionnement, le moteur MESURE où sont réellement les blocs de texte,
   en déduit la plus grande bande libre de la fenêtre, et y pose l'objet — à
   la taille que cette bande autorise. Trois conséquences :

     · aucun nombre magique en `vw` ne peut se désaccorder d'une largeur à
       l'autre — c'est précisément la faute qui a produit, ailleurs sur ce
       site, un numéro posé sur le texte du voisin ;
     · l'objet ne peut pas recouvrir le texte, puisqu'il est placé dans ce
       que le texte laisse ;
     · la composition se réorganise seule sur n'importe quelle largeur, y
       compris celles qu'on n'a pas testées.

   Et la mesure ne se fait JAMAIS dans la boucle d'image : lire une position
   à chaque image force une mise en page à chaque image. On mesure au
   redimensionnement, on met en cache, et la boucle ne lit plus que
   `scrollY`.
   ─────────────────────────────────────────────────────────────────────────

   L'ENCOMBREMENT DE CHAQUE TABLEAU EST MESURÉ, jamais déclaré : l'étendue
   projetée en X et en Y, puis recentrage dessus. Un nombre écrit à la main pour
   décrire une géométrie est toujours faux le jour où la géométrie change,
   et il l'était déjà : 1,35 annoncé pour une scène qui s'étend à 1,85.

   NETTETÉ. Aucune texture d'objet : toute la matière vient de la géométrie et
   d'un environnement calculé. Il n'y a donc rien qui puisse être flou, à
   aucune densité d'écran. Les traits fins passent par un ruban à largeur
   constante à l'écran, jamais par des lignes d'un pixel — voir atelier.js.

   RÉSOLUTION. On ne force pas un rapport de pixels : on part d'un plafond
   raisonnable, on mesure les images pendant la première seconde, et on
   redescend si la machine ne suit pas. Le plafond remonte si elle suit très
   largement. C'est mesuré, pas supposé.

   API : initParcours(section, { reduced, ambiance })
         -> { start, stop, setPointer, setAmbiance, destroy, stats } */

import * as THREE from 'three';
import { AMBIANCES, clamp, lerp, smooth, easeInOut, envTexture } from './parcours/atelier.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const FOV = 30;
const DIST = 8;                 /* distance de la caméra au plan des tableaux */
const ECART = 7;                /* distance entre deux tableaux, en unités monde */
const D_AMB = 0.85;             /* durée de la bascule jour / nuit, en secondes */

const TABLEAUX = [
  { cle: 'france',    module: './parcours/t1-france.js',    fabrique: 'creerFrance',    pret: true },
  { cle: 'rencontre', module: './parcours/t2-rencontre.js', fabrique: 'creerRencontre', pret: true  },
  { cle: 'expertise', module: './parcours/t3-expertise.js', fabrique: 'creerExpertise', pret: true  },
  { cle: 'decision',  module: './parcours/t4-decision.js',  fabrique: 'creerDecision',  pret: true  },
];

export async function initParcours(section, opts = {}) {
  const reduced = !!opts.reduced;
  const toile = $('.parc__toile', section);
  const etapes = $$('.parc__etape', section);
  const tete = $('.parc__head', section);
  const liens = $$('.parc__index a', section);
  if (!toile || etapes.length !== 4) return null;

  /* ---------------------------------------------------------------- 1 · le renderer */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: toile, alpha: true, antialias: true,
      premultipliedAlpha: true, depth: true, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
  } catch (e) { renderer = null; }
  if (!renderer || !renderer.getContext()) {
    section.classList.add('is-repli');
    console.warn('parcours 3D : WebGL indisponible, repli typographique');
    return null;
  }

  const mobile = matchMedia('(max-width: 999px)').matches;
  const grossier = matchMedia('(pointer: coarse)').matches;
  const qualite = (mobile || grossier) ? 'bas' : 'haut';

  /* PLAFOND DE RÉSOLUTION. 2 sur un écran de bureau : au-delà, le gain est
     invisible et le coût est quadratique. 1,5 sur mobile, où la densité est
     déjà de 3 et la surface quatre fois moindre. Le plafond BOUGE ensuite,
     à la mesure. */
  const PLAFOND_MAX = qualite === 'bas' ? 1.5 : 2.0;
  let plafond = PLAFOND_MAX;

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, plafond));
  /* AgX plutôt qu'ACESFilmic : ACES vire au blanc rosé dans les hautes
     lumières, et l'or y perd sa couleur au moment précis où il brille. AgX
     désature en montant vers le blanc, l'or reste doré jusqu'au bout.
     La courbe est plus sombre : l'exposition remonte en conséquence. */
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;      /* aucune carte d'ombre — voir atelier.js */

  /* ---------------------------------------------------------------- 2 · la scène */
  const scene = new THREE.Scene();
  scene.environmentRotation = new THREE.Euler(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
  camera.position.set(0, 0, DIST);

  const envNuit = envTexture(renderer, 'nuit');
  const envJour = envTexture(renderer, 'jour');
  let k = (opts.ambiance === 'jour') ? 1 : 0;      /* 0 nuit … 1 jour */
  let kCible = k, kDepart = k, tAmb = D_AMB;
  scene.environment = (k > 0.5 ? envJour : envNuit).texture;

  const A = {};                                    /* l'ambiance interpolée, lue par les tableaux */
  const cA = new THREE.Color(), cB = new THREE.Color();
  function poserAmbiance(kk) {
    for (const cle in AMBIANCES.nuit) {
      const a = AMBIANCES.nuit[cle], b = AMBIANCES.jour[cle];
      if (cle === 'plaque' || cle === 'tranche' || cle === 'or' || cle === 'orVif' ||
          cle === 'orChaud' || cle === 'ivoire' || cle === 'pierre' || cle === 'fond' ||
          cle === 'keyCol' || cle === 'rimCol' || cle === 'fillCol' || cle === 'hemiCiel' || cle === 'hemiSol') {
        A[cle] = cA.setHex(a).lerp(cB.setHex(b), kk).getHex();
      } else A[cle] = lerp(a, b, kk);
    }
  }
  poserAmbiance(k);

  /* ---------------------------------------------------------------- 3 · lumières
     Trois sources, pas plus. La clé fait le modelé, le contre-jour détache la
     silhouette du fond, l'hémisphérique empêche les ombres de tomber dans le
     noir absolu. Une quatrième source n'ajouterait que du coût et du plat. */
  const key = new THREE.DirectionalLight(A.keyCol, A.key);
  /* la cle est RASANTE : la plaque est inclinee de -57 deg, sa normale pointe
     donc vers le haut-avant. Une cle haute l aplatirait ; une cle basse et
     laterale fait courir la lumiere sur le relief, qui existe alors. */
  key.position.set(-6.0, 1.6, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(A.rimCol, A.rim);
  rim.position.set(4.6, 1.6, -4.2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(A.fillCol, A.fill);
  fill.position.set(2.4, -2.8, 3.0);
  scene.add(fill);
  const hemi = new THREE.HemisphereLight(A.hemiCiel, A.hemiSol, A.hemi);
  scene.add(hemi);

  /* le fil est additif la nuit — il AJOUTE de la lumiere sur du noir. Le
     jour, sur de l'ivoire, un melange additif n'ajoute rien de visible : il
     repasse en melange normal et s’assombrit. */
  function majFil() {
    if (!matFil) return;
    matFil.color.setHex(A.or);
    const veut = (k > 0.5) ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (matFil.blending !== veut) { matFil.blending = veut; matFil.needsUpdate = true; }
    /* l'opacite de base est posee par tisserFil, qui connait la largeur */
    matFil.opacity = lerp(0.42, 0.55, k) * (vw < 1000 ? 0.55 : 1);
  }

  function appliquerLumieres() {
    renderer.toneMappingExposure = A.expo;
    scene.environmentIntensity = A.env;
    key.color.setHex(A.keyCol); key.intensity = A.key;
    rim.color.setHex(A.rimCol); rim.intensity = A.rim;
    fill.color.setHex(A.fillCol); fill.intensity = A.fill;
    hemi.color.setHex(A.hemiCiel); hemi.groundColor.setHex(A.hemiSol); hemi.intensity = A.hemi;
  }
  appliquerLumieres();

  /* ---------------------------------------------------------------- 4 · les tableaux */
  const tab = new Array(4).fill(null);
  const enCours = new Array(4).fill(false);
  const ctxCommun = { renderer, scene, camera, A, qualite, k, tables: AMBIANCES };

  async function charger(i) {
    if (tab[i] || enCours[i]) return;
    const def = TABLEAUX[i];
    if (!def || !def.pret) return;   /* tableau pas encore construit : on ne le reclame pas */
    enCours[i] = true;
    try {
      const mod = await import(def.module);
      const fn = mod[def.fabrique] || mod.default;
      if (typeof fn !== 'function') throw new Error('fabrique absente');
      ctxCommun.k = k;
      const t = await fn(ctxCommun);

      /* ENCOMBREMENT REEL, MESURE — et mesure de la bonne chose.
         Une sphere englobante surestime tout objet plat et incline : la
         plaque de France, large de 2 et epaisse de 0,06, donne une sphere de
         rayon 1,40 une fois basculee de 57 degres, et le moteur la reduisait
         donc de 30 % de trop. Ce qui compte n'est pas le rayon d'une sphere,
         c'est ce que l'objet OCCUPE A L'ECRAN — la camera regarde selon Z,
         c'est donc l'etendue en X et en Y, et elle seule. */
      const boite = new THREE.Box3().setFromObject(t.groupe);
      if (!boite.isEmpty()) {
        const centre = boite.getCenter(new THREE.Vector3());
        const taille = boite.getSize(new THREE.Vector3());
        const pivot = new THREE.Group();
        while (t.groupe.children.length) pivot.add(t.groupe.children[0]);
        pivot.position.copy(centre).negate();
        t.groupe.add(pivot);
        t.rayon = Math.max(taille.x, taille.y) / 2;
        t.rapport = taille.x / Math.max(0.001, taille.y);
      }
      t.groupe.position.y = -i * ECART;
      t.groupe.visible = false;
      scene.add(t.groupe);
      tab[i] = t;
      cadrer();
      if (t.ambiance) t.ambiance(k, A);
      pret();
    } catch (err) {
      console.warn('parcours 3D : tableau ' + (i + 1) + ' indisponible', err);
    }
    enCours[i] = false;
  }
  function pret() {
    if (tab.some(Boolean)) toile.dataset.pret = '1';
  }

  /* ---------------------------------------------------------------- 5 · LA MESURE
     Tout ce que la boucle a besoin de savoir, calculé UNE fois par
     redimensionnement : où chaque étape est centrée dans le document, et où
     son objet peut se poser sans rencontrer un mot. */
  let vw = 0, vh = 0, aspect = 1, demiMonde = 1;
  /* LE CHAMP DE POSE. Un objet peut déborder un peu du conteneur — c'est ce
     débord qui donne l'échelle cinématique. Il ne peut pas VIVRE dans la
     marge : une marge de page n'est pas un espace négatif de composition,
     c'est ce qui reste. On borne donc la recherche au conteneur élargi d'un
     débord mesuré, jamais à la fenêtre entière. */
  let champG = 0, champD = 0;
  const flux = $('.parc__flux', section);
  const cadre = etapes.map(() => ({ centreDoc: 0, x: 0, y: 0, taille: 1 }));

  /* la boîte réellement OCCUPÉE par le contenu d'un bloc — pas la boîte du
     bloc, qui contient tout l'espace de son pas. */
  function boiteContenu(el) {
    let a = Infinity, b = -Infinity, h = Infinity, bas = -Infinity;
    for (const c of el.children) {
      const r = c.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      a = Math.min(a, r.left); b = Math.max(b, r.right);
      h = Math.min(h, r.top); bas = Math.max(bas, r.bottom);
    }
    if (a === Infinity) { const r = el.getBoundingClientRect(); return { g: r.left, d: r.right, h: r.top, b: r.bottom }; }
    return { g: a, d: b, h, b: bas };
  }

  /* la plus large bande de fenêtre que n'occupe aucun des blocs donnés */
  function bandeLibre(blocs, marge) {
    const occ = blocs.map(b => [Math.max(champG, b.g - marge), Math.min(champD, b.d + marge)])
      .filter(t => t[1] > t[0]).sort((p, q) => p[0] - q[0]);
    const trous = [];
    let x = champG;
    for (const [a, b] of occ) { if (a > x) trous.push([x, a]); x = Math.max(x, b); }
    if (x < champD) trous.push([x, champD]);
    if (!trous.length) return [champG, champD];
    return trous.reduce((m, t) => (t[1] - t[0] > m[1] - m[0] ? t : m), trous[0]);
  }

  function cadrer() {
    vw = innerWidth; vh = innerHeight;
    aspect = vw / Math.max(1, vh);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(vw, vh, false);
    /* demi-hauteur du monde visible à la distance des tableaux */
    demiMonde = Math.tan(FOV * Math.PI / 360) * DIST;

    const etroit = matchMedia('(max-width: 999px)').matches;
    const marge = etroit ? 10 : Math.max(18, vw * 0.018);
    const sy = scrollY || pageYOffset;

    if (flux) {
      const fr = flux.getBoundingClientRect();
      const cs = getComputedStyle(flux);
      const cg = fr.left + (parseFloat(cs.paddingLeft) || 0);
      const cd = fr.right - (parseFloat(cs.paddingRight) || 0);
      const debord = Math.min(cg, vw - cd, vw * 0.055);
      champG = Math.max(0, cg - debord);
      champD = Math.min(vw, cd + debord);
    } else { champG = 0; champD = vw; }

    etapes.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const c = cadre[i];
      c.centreDoc = r.top + sy + r.height / 2;

      const contenu = boiteContenu(el);
      /* positions À L'INSTANT DE L'ALIGNEMENT : l'étape est alors centrée
         dans la fenêtre, donc tout se déduit de sa hauteur. */
      const hautAlign = vh / 2 - r.height / 2;
      const dy = hautAlign - r.top;

      if (etroit) {
        /* étroit : le texte est calé en bas du pas, l'objet prend le haut.
           On ne devine pas cette bande, on la mesure. */
        const hautBande = hautAlign;
        const basBande = contenu.h + dy;
        const cy = (hautBande + basBande) / 2;
        const hBande = Math.max(80, basBande - hautBande - marge);
        c.x = 0;
        c.y = (vh / 2 - cy) / vh * 2 * demiMonde;
        c.taille = Math.min(hBande * 0.94, vw * 0.88);
      } else {
        /* large : le texte est à droite ou à gauche, l'objet occupe la plus
           grande bande libre. La tête compte comme un bloc — sinon l'objet
           du premier tableau viendrait se poser sur le titre. */
        const [a, b] = bandeLibre([contenu], marge);
        /* on ramène un peu le centre vers l'axe de la page : une bande très
           large pousserait l'objet contre le bord opposé au texte, ce qui
           déséquilibre la composition sans rien apporter. */
        const cxb = (a + b) / 2;
        const cx = cxb + (vw / 2 - cxb) * 0.20;
        c.x = (cx - vw / 2) / vw * 2 * demiMonde * aspect;
        c.y = 0;
        c.taille = Math.min((b - a) * 0.90, vh * 0.68);
      }

      const t = tab[i];
      if (t) {
        /* taille écran voulue -> échelle monde. Le rayon est déclaré par le
           tableau : c'est lui qui sait ce qu'il occupe. */
        const monde = c.taille / vh * 2 * demiMonde;
        t.groupe.scale.setScalar(monde / (2 * (t.rayon || 1)));
        t.groupe.position.x = c.x;
        t.groupe.position.y = -i * ECART + c.y;
        if (t.largeurEcran) t.largeurEcran(demiMonde * 2 / vh * 1.35);
      }
    });

    tisserFil();
  }

  /* ---------------------------------------------------------------- 5 bis · LE FIL */
  let fil = null, geoFil = null;
  const uFil = { value: 0 };
  const matFil = new THREE.MeshBasicMaterial({
    color: AMBIANCES.nuit.or, transparent: true, opacity: 0.42,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  matFil.defines = { USE_UV: '' };          /* force la varying vUv sur un materiau sans texture */
  matFil.customProgramCacheKey = () => 'parc-fil';
  matFil.onBeforeCompile = s => {
    s.uniforms.uTete = uFil;
    s.fragmentShader = 'uniform float uTete;\n' + s.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' +
      '\tfloat ecrit = smoothstep(uTete, uTete - 0.035, vUv.x);\n' +
      '\tfloat bouts = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);\n' +
      '\tdiffuseColor.a *= ecrit * bouts;');
  };

  function tisserFil() {
    if (geoFil) { geoFil.dispose(); geoFil = null; }
    /* voir la note ci-dessus : tout ce qui suit suit la largeur. */
    const etroit = vw < 1000;
    const RAYON = etroit ? 0.0034 : 0.007;
    const BALAI = etroit ? 0.42 : 1.35;      /* deport lateral */
    const AVANT = etroit ? 0.75 : 1.35;      /* passage devant */
    const ARRIERE = etroit ? -1.1 : -1.55;   /* passage derriere */
    matFil.opacity = (k > 0.5 ? 0.55 : 0.42) * (etroit ? 0.55 : 1);
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const c = cadre[i];
      const y = -i * ECART + c.y;
      /* devant / derriere en alternance : c'est ce croisement qui donne la
         profondeur, et il est gratuit puisque le fil est dans la scene. */
      const z = (i % 2 === 0) ? AVANT : ARRIERE;
      /* deport lateral : sans lui le fil tombe a la verticale et se lit
         comme un cable. Il doit BALAYER la composition. */
      const dx = (i % 2 === 0) ? BALAI : -BALAI * 0.96;
      if (i > 0) pts.push(new THREE.Vector3(c.x - dx * 1.15, y + ECART * 0.42, z * 0.10));
      pts.push(new THREE.Vector3(c.x + dx, y + 0.35, z));
      pts.push(new THREE.Vector3(c.x - dx * 0.3, y - 0.45, z * 0.55));
    }
    const courbe = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    geoFil = new THREE.TubeGeometry(courbe, etroit ? 260 : 420, RAYON, 5, false);
    if (!fil) { fil = new THREE.Mesh(geoFil, matFil); fil.renderOrder = 1; scene.add(fil); }
    else fil.geometry = geoFil;
  }

  /* ---------------------------------------------------------------- 6 · le défilement
     `u` est un indice continu dans [0, 3] : la position du regard dans le
     parcours. La boucle ne lit que `scrollY` — aucune mise en page n'est
     déclenchée par le défilement. */
  let u = 0, uLisse = 0;
  /* LA ZONE MORTE. 0,30 a chaque bout : le tableau reste cadre pendant 60 %
     de sa piste, la camera passe au suivant sur les 40 % restants. Sans
     cela, la camera derive en continu et aucun plan n'est jamais pose —
     c'est ce qui distingue une sequence d'un defilement parallaxe. */
  const MORT = 0.30;
  function lireDefilement() {
    const V = (scrollY || pageYOffset) + vh / 2;
    const c = cadre;
    if (V <= c[0].centreDoc) { u = 0; return; }
    if (V >= c[3].centreDoc) { u = 3; return; }
    for (let i = 0; i < 3; i++) {
      if (V < c[i + 1].centreDoc) {
        const d = c[i + 1].centreDoc - c[i].centreDoc;
        const f = d > 0 ? (V - c[i].centreDoc) / d : 0;
        u = i + smooth(clamp((f - MORT) / (1 - 2 * MORT), 0, 1));
        return;
      }
    }
  }

  /* ---------------------------------------------------------------- 7 · états DOM */
  let actifCourant = -1;
  const vus = new Set();
  const ioVu = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-vu');
    vus.add(e.target);
    ioVu.unobserve(e.target);
  }), { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });
  etapes.forEach(el => reduced ? el.classList.add('is-vu') : ioVu.observe(el));

  function majEtats() {
    const a = Math.max(0, Math.min(3, Math.round(uLisse)));
    if (a === actifCourant) return;
    actifCourant = a;
    etapes.forEach((el, i) => el.classList.toggle('is-actif', i === a));
    liens.forEach((el, i) => el.classList.toggle('is-actif', i === a));
  }

  /* ---------------------------------------------------------------- 8 · pointeur */
  let poX = 0, poY = 0;
  function setPointer(x, y) { poX = clamp(x, -0.5, 0.5); poY = clamp(y, -0.5, 0.5); }

  /* ---------------------------------------------------------------- 9 · la boucle */
  let raf = 0, tourne = false, visible = false;
  /* THREE.Clock est déprécié, et THREE.Timer vit dans les modules
     complémentaires, qui ne sont pas embarqués ici. On n'a besoin de rien
     de plus que l'horloge du navigateur. */
  let tPrec = 0, tScene = 0;

  /* mesure de charge : on ne suppose pas que la machine suit, on regarde. */
  let images = 0, cumul = 0, mauvaises = 0, bonnes = 0;
  function jauger(dt) {
    images++; cumul += dt;
    if (images < 30) return;
    const moy = cumul / images * 1000;
    images = 0; cumul = 0;
    if (moy > 21 && plafond > 1) {
      if (++mauvaises >= 2) { mauvaises = 0; bonnes = 0; plafond = Math.max(1, plafond - 0.25); appliquerPlafond(); }
    } else if (moy < 12 && plafond < PLAFOND_MAX) {
      if (++bonnes >= 6) { bonnes = 0; mauvaises = 0; plafond = Math.min(PLAFOND_MAX, plafond + 0.25); appliquerPlafond(); }
    } else { mauvaises = 0; bonnes = 0; }
  }
  function appliquerPlafond() {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, plafond));
    renderer.setSize(vw, vh, false);
  }

  function image() {
    raf = requestAnimationFrame(image);
    const now = performance.now() / 1000;
    const dt = tPrec ? Math.min(0.1, now - tPrec) : 0.016;
    tPrec = now;
    tScene += dt;
    const t = tScene;

    /* bascule jour / nuit : tout s'interpole, sauf l'environnement qui se
       substitue au croisement — là où les deux se ressemblent le plus. */
    if (tAmb < D_AMB) {
      tAmb = Math.min(D_AMB, tAmb + dt);
      const kk = lerp(kDepart, kCible, easeInOut(tAmb / D_AMB));
      const avant = k; k = kk;
      poserAmbiance(k); appliquerLumieres();
      if ((avant - 0.5) * (k - 0.5) <= 0) scene.environment = (k > 0.5 ? envJour : envNuit).texture;
      for (const T of tab) if (T && T.ambiance) T.ambiance(k, A);
      majFil();
    }

    /* le balayage de vitrine : 0,055 rad/s, soit un tour en un peu moins de
       deux minutes. On ne le voit pas bouger ; on voit seulement que la
       lumière n'est jamais tout à fait la même. */
    if (!reduced) scene.environmentRotation.y = t * 0.055;

    lireDefilement();
    /* le fil s'ecrit un peu EN AVANCE sur la camera : il conduit le regard
       vers l'etape suivante au lieu de la suivre. */
    uFil.value = clamp((uLisse + 0.55) / 3.35, 0, 1);
    /* inertie : le défilement d'une molette est saccadé ; la caméra ne doit
       pas l'être. 0,14 par image à 60 Hz — assez pour lisser un cran de
       molette, assez peu pour ne jamais traîner derrière le doigt. */
    uLisse += (u - uLisse) * (reduced ? 1 : Math.min(1, dt * 9));
    majEtats();

    /* caméra : elle descend, et elle s'approche un peu quand un tableau est
       cadré — c'est ce léger va-et-vient qui fait qu'on regarde un objet au
       lieu de le croiser. */
    const frac = uLisse - Math.round(uLisse);
    const cloche = 1 - Math.min(1, Math.abs(frac) * 2);
    camera.position.y = -uLisse * ECART;
    camera.position.z = DIST - 0.42 * smooth(cloche) + (reduced ? 0 : poY * 0.10);
    camera.position.x = reduced ? 0 : poX * 0.30;
    camera.rotation.set(reduced ? 0 : -poY * 0.016, reduced ? 0 : poX * 0.020, 0);

    for (let i = 0; i < 4; i++) {
      const T = tab[i];
      if (!T) continue;
      const p = clamp(uLisse - i, -1.6, 1.6);
      const dedans = Math.abs(p) < 1.35;
      if (T.groupe.visible !== dedans) T.groupe.visible = dedans;
      if (!dedans) continue;
      if (T.entrer) T.entrer(p);
      if (!reduced) {
        if (T.battre) T.battre(t, dt);
        if (T.pointeur) T.pointeur(poX, poY);
      }
    }

    renderer.render(scene, camera);
    if (!reduced) jauger(dt);
  }

  /* ---------------------------------------------------------------- 10 · pilotage */
  function start() {
    if (tourne) return;
    tourne = true;
    tPrec = 0;                 /* le temps passé à l’arrêt ne compte pas */
    raf = requestAnimationFrame(image);
  }
  function stop() {
    if (!tourne) return;
    tourne = false;
    cancelAnimationFrame(raf); raf = 0;
  }
  function sync() { (visible && !document.hidden) ? start() : stop(); }

  const ioVisible = new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; sync(); }), { threshold: 0 });
  ioVisible.observe(section);
  const surCache = () => sync();
  document.addEventListener('visibilitychange', surCache);

  /* les tableaux se montent à l'approche, dans l'ordre : celui qu'on regarde
     d'abord n'attend pas ceux qu'on ne verra que plus tard. */
  const ioProche = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const i = etapes.indexOf(e.target);
    if (i >= 0) { charger(i); ioProche.unobserve(e.target); }
  }), { rootMargin: '900px 0px' });
  etapes.forEach(el => ioProche.observe(el));

  let rafCadre = 0;
  const surTaille = () => {
    if (rafCadre) return;
    rafCadre = requestAnimationFrame(() => { rafCadre = 0; cadrer(); });
  };
  addEventListener('resize', surTaille, { passive: true });
  addEventListener('orientationchange', surTaille, { passive: true });
  /* les polices changent la hauteur des blocs : re-mesurer quand elles arrivent */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(surTaille).catch(() => {});

  function setAmbiance(mode) {
    const cible = mode === 'jour' ? 1 : 0;
    if (cible === kCible) return;
    kDepart = k; kCible = cible; tAmb = 0;
    if (!tourne) {                       /* hors écran : on bascule sans transition */
      k = cible; poserAmbiance(k); appliquerLumieres();
      scene.environment = (k > 0.5 ? envJour : envNuit).texture;
      for (const T of tab) if (T && T.ambiance) T.ambiance(k, A);
      majFil();
      tAmb = D_AMB;
    }
  }

  function destroy() {
    stop();
    ioVisible.disconnect(); ioProche.disconnect(); ioVu.disconnect();
    removeEventListener('resize', surTaille);
    removeEventListener('orientationchange', surTaille);
    document.removeEventListener('visibilitychange', surCache);
    for (const T of tab) if (T && T.liberer) T.liberer();
    if (geoFil) geoFil.dispose();
    matFil.dispose();
    envNuit.dispose(); envJour.dispose();
    scene.clear();
    renderer.dispose();
    const gl = renderer.getContext();
    const perte = gl && gl.getExtension('WEBGL_lose_context');
    if (perte) perte.loseContext();
  }

  cadrer();
  lireDefilement();
  uLisse = u;
  await charger(0);
  cadrer();

  return {
    start, stop, setPointer, setAmbiance, destroy,
    stats: () => ({ plafond, dpr: renderer.getPixelRatio(), u: uLisse, montes: tab.filter(Boolean).length,
      info: renderer.info.render }),
    _dbg: { scene, camera, renderer, tab, cadre },
  };
}

export default initParcours;
