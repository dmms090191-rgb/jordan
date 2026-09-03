/* scenes/carte3d.js · Carte de France 3D — MOTEUR THREE.JS (lot « carte3d »)
   ==========================================================================
   Territoire francais en perspective : matiere sombre satinee, relief reel tres subtil revele par une
   lumiere rasante, socle epais, contour or fin qui se DESSINE, liseré lumineux, ombre douce portee,
   pins dores qui sortent du sol, exploration bornee, jour / nuit a chaud.

   PERIMETRE (contrat review/lab/CARTE-VILLES.md) — la carte ne fait plus que QUATRE choses :
   1. la France 3D ; 2. les 111 communes en pins ; 3. la liste des villes a droite (lot carteui) ;
   4. un clic = une vraie animation 3D vers le pin.
   Retires : fiche hotel, date, creneaux, disponibilite, bouton de rendez-vous dans la carte,
   panneau d informations, feuille du bas, legende de statuts, mini-fiche de survol, statistiques.

   VERITE DES DONNEES — aucune ville n est ecrite ici. Les 111 communes viennent de
   `window.COMPAGNIE_OR_VILLES` (coordonnees officielles geo.api.gouv.fr, code INSEE, centre officiel).
   Elles decrivent les territoires parcourus : NI date, NI lieu, NI journee. Si une journee reelle est
   un jour publiee dans `window.COMPAGNIE_OR_JOURNEES`, la commune correspondante voit seulement son
   pin se distinguer (or plus chaud) — aucun texte, aucune date, aucune promesse.

   CONSOMME (jamais modifie)
   - `../france-geo3d.js` (lot geo3d)   : projection, REGIONS, OUTLINE, BORDERS, RELIEF, sampleRelief…
   - `../villes-france.js`              : window.COMPAGNIE_OR_VILLES (111 communes, coord. officielles)
   - `./carte3d-ui.js`    (lot carteui) : coquille DOM, liste des villes, etiquette de la ville active.

   API
   ---
   createCarteScene(host, { reduced, ambiance, villes, mobile, ui, quality, idle, stage })
     -> { start(), stop(), open(), close(), focusCity(id, fromUI), resetView(), setHover(id),
          setAmbiance('nuit'|'jour'), setPointer(x, y), setStage(el), setVilles(list), destroy(),
          items, state, ready, stats(), _dbg }
   initCarte3D(host, opts) -> Promise<{ ui, scene, start, stop, setPointer, setAmbiance, destroy }>

   LES 111 PINS EN 5 APPELS DE DESSIN : ombre de contact, base lumineuse, tige, pierre taillee et
   halo sont cinq `InstancedMesh`. La matrice d instance ne porte QUE la position (posee sur le relief) ;
   croissance, elevation, pulsation et attenuation sont calculees dans le shader a partir de quatre
   attributs (`aIdx`, `aOrder`, `aPhase`, `aTone`) et de quelques uniformes — aucun televersement de
   tampon pendant les animations.
   MESURE (review/lab/carte3d-avant111.mjs, meme page, meme camera) : 564 appels de dessin avec un
   `Group` par commune, 14 avec les cinq `InstancedMesh`.

   RENDU A LA DEMANDE : la boucle rAF s arrete des que plus rien ne bouge — l etat ferme au repos ne
   consomme AUCUNE frame. En plein ecran, la pulsation des pins entretient la boucle a ~32 i/s
   (option `idle:'still'` pour la couper). Elle s arrete aussi hors ecran, onglet cache, et sous
   prefers-reduced-motion (etat final immediat, une seule image).                                     */

import * as THREE from 'three';
import * as G from '../france-geo3d.js';
import { createCarteUI } from './carte3d-ui.js';

/* ---------------------------------------------------------------- utilitaires */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };            /* ~ cubic-bezier(.22,.61,.36,1) */
const easeIO = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* COURBE DE LA CHARTE — cubic-bezier(.22,.61,.36,1), resolue par Newton (3 iterations suffisent a
   0,5 % pres). C est elle qui donne au mouvement de camera son depart franc et sa deceleration
   longue : un easeOutCubic seul freine trop tot, un easeInOut demarre mou.                        */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    x = clamp(x, 0, 1);
    let t = x;
    for (let i = 0; i < 4; i++) { const e = fx(t) - x, d = dfx(t); if (Math.abs(e) < 1e-5 || d < 1e-6) break; t -= e / d; }
    return ((ay * t + by) * t + cy) * t;
  };
}
const CINE = cubicBezier(0.22, 0.61, 0.36, 1);

/* CONSTRUCTION SANS GEL DU FIL PRINCIPAL
   --------------------------------------
   La carte se construit AU MOMENT DU SCROLL : chaque milliseconde passee dans une boucle est une
   image que la page ne peint pas. `yieldFrame()` rend la main jusqu APRES la prochaine image peinte
   (rAF puis tache) ; `breathe()` ne le fait que si la tranche courante a depasse son budget, ce qui
   evite d ajouter des dizaines d allers-retours inutiles sur une machine rapide.
   Filet : si rAF est gele (onglet cache), on retombe sur une simple tache.                          */
const yieldFrame = () => new Promise(r => {
  if (typeof requestAnimationFrame !== 'function' || (typeof document !== 'undefined' && document.hidden)) { setTimeout(r, 0); return; }
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(fin, 0));
  setTimeout(fin, 150);
});
const BUDGET = 6;                       /* ms : au-dela, on rend la main pour laisser peindre */
function makeBreathe() {
  let t0 = performance.now(), slices = 1, worst = 0, worstAt = '', tag = 'debut';
  const b = async (force, label) => {
    const dt = performance.now() - t0;
    if (dt > worst) { worst = dt; worstAt = tag; }
    tag = label || tag;
    if (!force && dt < BUDGET) return;
    await yieldFrame();
    slices++;
    t0 = performance.now();
  };
  b.stats = () => ({ tranches: slices, tranche_max_ms: Math.round(worst), tranche_max_etape: worstAt });
  return b;
}

/* cadrage du maillage : bbox monde du territoire, plus une marge d une cellule */
const GX0 = -1.012, GX1 = 1.012, GY0 = -0.945, GY1 = 0.945;
const SPANX = GX1 - GX0, SPANY = GY1 - GY0;

const THICK = 0.021;         /* epaisseur du socle (~12 km) : une plaque, jamais une feuille, jamais un bloc */
const RK = 0.72;             /* attenuation du relief : il se SENT en lumiere rasante, il ne se voit pas */
const SHADOW_Y = -THICK - 0.019, GLOW_Y = -THICK - 0.026;
const SUN = [-1.58, 0.79, -1.02];        /* direction de la key light (nord-ouest, rasante) */
/* bornes du balayage de revelation, le long de la diagonale nord-ouest -> sud-est (voir landShader) */
const WIPE0 = 1.06, WIPE1 = -1.06;
const RIBBON_W = 0.0165;                 /* largeur monde du ruban de halo (mise a l echelle par uW) */

/* PINS — CALIBRES POUR CENT ONZE, PAS POUR UN
   Un pin isole peut se permettre 15 px de tige et une tete de 9 px ; a 111 exemplaires la meme
   mesure transforme le territoire en champ d epingles et l or devient une nappe. On divise donc
   par ~1,6 : 8 px de tige, 5 px de diamant, une base lumineuse de 10 px. Le pin SELECTIONNE, lui,
   retrouve toute sa presence (x2,75 en hauteur) — c est le contraste qui le designe, pas sa taille
   au repos.                                                                                       */
const STEM = 0.0165;         /* hauteur de tige au repos (~7 px a la vue France entiere) : la pierre est POSEE sur le territoire, pas plantee dedans */
const HEAD_R = 0.0057;       /* rayon du diamant (rayon de la ceinture de la pierre taillee) */
const BASE_R = 0.0048;       /* rayon de la base lumineuse POSEE sur le territoire (ellipse au sol) */
const HALO_R = 0.0096;       /* rayon du halo face camera : large, tres faible, jamais une nappe */
/* OMBRE DE CONTACT — c est elle qui fabriquait la PUNAISE. Une tache grise presque aussi large que
   la tete transforme n importe quel marqueur en epingle plantee dans un panneau de liege ; de nuit
   elle percait en plus de petits trous noirs dans le territoire. On la resserre (0,0102 -> 0,0068,
   soit un tiers de moins que la tete) et on divise son opacite par deux (voir pinContactA).       */
const CONTACT_R = 0.0088;
const LIFT_K = 2.05;         /* elevation du pin actif, en multiples de la tige */
const PIN_SPREAD = 0.72;     /* etalement (s) de l allumage des pins pendant l intro */
/* triangles par pin : pierre 22 (table 4 + couronne 12 + pavillon 6) + tige 12 + 3 disques a 2 */
const PIN_TRI = 22 + 12 + 3 * 2;

/* ---------------------------------------------------------------- palettes jour / nuit
   Memes geometries, memes positions exactes ; deux ambiances interpolees en continu
   (k = 0 nuit -> 1 jour). Jamais de #000 ni de #fff purs.                                   */
const NUIT = {
  exposure: 1.04, env: 0.22, fog: '#0b0d14', fogNear: 0.80, fogFar: 1.95,
  land: '#28304a', skirt: '#1a2032',
  gold: '#c99a3f', goldHot: '#f4e0b4', outlineA: 0.92, borderA: 0.17, glowA: 0.34,
  halo: '#c99a3f', haloA: 0.15, shadowA: 0.44,
  hemiSky: '#8296c4', hemiGround: '#161c2c', hemi: 1.45,
  keyCol: '#ffe9c4', key: 2.60, fillCol: '#7086c2', fill: 0.92, rimCol: '#e8cd93', rim: 0.60,
  contact: '#04060b', contactA: 0.34, hiCol: '#463a24',
  /* NUIT : l or s allume. Coeur chaud pose au sol + halo tres faible ; la pierre est emissive. */
  pinHead: '#f0cd8f', pinEmis: '#c99a3f', pinEmisI: 0.44,
  pinBase: '#e5b45a', pinBaseA: 0.72, pinHalo: '#c99a3f', pinHaloA: 0.26,
  /* ombre de contact PROPRE au pin (le territoire garde la sienne, `contact`) : une pose, pas un trou */
  pinContact: '#0a0f1c', pinContactA: 0.26,
  /* liseré de la table de la pierre : c est LUI qui fait courir une lumiere sur le metal.
     CHAUD, jamais blanc : un liseré blanc transforme la pierre en tete de clou. */
  pinLedge: '#ffd9a0', pinLedgeI: 0.40,
  /* tache de lumiere doree au sol du pin actif — une seule, a chute exponentielle, jamais un anneau */
  pinPool: '#f2d49a', pinPoolA: 0.18
};
/* JOUR : le territoire ivoire et le fond ivoire ne se distinguaient que par le liseré (1,08:1).
   On assoit la plaque — matiere un demi-ton plus profonde, socle plus dense, ombre de contact
   plus presente — et on calme la key light qui blanchissait les cretes des Alpes.               */
const JOUR = {
  exposure: 1.04, env: 0.42, fog: '#efe8db', fogNear: 0.86, fogFar: 2.35,
  land: '#e2d7c1', skirt: '#c2b499',
  gold: '#8a6820', goldHot: '#a9822f', outlineA: 0.92, borderA: 0.26, glowA: 0.18,
  halo: '#c9a45a', haloA: 0.10, shadowA: 0.50,
  hemiSky: '#fff6e8', hemiGround: '#cfc4ae', hemi: 0.92,
  keyCol: '#fff3e4', key: 2.62, fillCol: '#d9cdb6', fill: 0.70, rimCol: '#f0dcb0', rim: 0.34,
  contact: '#4a3d26', contactA: 0.30, hiCol: '#7a6636',
  /* JOUR — ON NE CHERCHE PLUS UN OR SOMBRE.
     Un or assombri sur de l ivoire ne donne pas du metal, il donne de la SALISSURE : la tete virait
     au brun et l ombre grise large finissait le travail (punaise). Le pin s affirme desormais par sa
     propre MATIERE : or moyen sature (#a8791f) sur la ceinture et le pavillon, table et couronne
     eclairees par un vrai liseré chaud presque blanc, ombre de contact resserree et deux fois plus
     legere. Le pixel le plus clair de la boite d un pin appartient alors au PIN, plus a la terre.  */
  pinHead: '#a8791f', pinEmis: '#8a6820', pinEmisI: 0.16,
  pinBase: '#a8791f', pinBaseA: 0.30, pinHalo: '#8a6820', pinHaloA: 0.14,
  pinContact: '#6b5733', pinContactA: 0.34,
  pinLedge: '#ffd396', pinLedgeI: 0.92,
  pinPool: '#d9a83a', pinPoolA: 0.18
};

/* ---------------------------------------------------------------- canvas et textures */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* PROFIL DANS LES CANAUX DE COULEUR, PAS DANS L ALPHA — correction de fond.
   three lit une `alphaMap` sur son canal VERT (`texture2D(alphaMap, uv).g`), jamais sur son alpha.
   Ces degrades etaient ecrits dans le canal ALPHA : le vert restait a 255 partout ou l alpha
   n etait pas nul, et CHAQUE degrade sortait donc en DISQUE PLAT A BORD DUR. C est de la que
   venaient la « pastille creme quasi opaque », l « arc gris-bleu » du sol (deux cercles
   concentriques = ping sonar) et les ombres de contact en blob. Le profil est desormais dans le
   RVB, l alpha reste a 255 : la retombee est enfin celle qu on calcule.                          */
function radialCanvas(size, inner, pow) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data, r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - r) / r, dy = (y + 0.5 - r) / r;
    const t = clamp(1 - (Math.hypot(dx, dy) - inner) / Math.max(1e-4, 1 - inner), 0, 1);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(255 * Math.pow(t, pow || 1));
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
/* TACHE DE LUMIERE AU SOL — remplace l ancien ANNEAU.
   Un anneau a bord net, doublé d une pastille au centre, ne lit pas comme de la lumiere : il lit
   comme un reticule de visee ou un ping de sonar (deux cercles concentriques = radar). Ici, une
   seule tache a chute EXPONENTIELLE, sans aucun bord : `a = (e^-kl - e^-k) / (1 - e^-k)` vaut 1 au
   centre, tombe vite, et atteint exactement 0 au bord de la texture (donc pas de coupure carree).  */
function poolCanvas(size, k) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data, r = size / 2;
  const e1 = Math.exp(-k), inv = 1 / (1 - e1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - r) / r, dy = (y + 0.5 - r) / r, l = Math.hypot(dx, dy);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = l >= 1 ? 0 : Math.round(255 * clamp((Math.exp(-k * l) - e1) * inv, 0, 1));
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* LA PIERRE TAILLEE — geometrie du marqueur, dessinee POUR cette carte.
   L ancienne tete etait un OCTAEDRE : quatre sommets sur l equateur, donc une silhouette qui pivote
   avec l azimut (le pin actif semblait penche d un angle arbitraire par rapport a sa tige) et un
   remplissage quasi uniforme (au loupe : un quadrilatere de papier). On taille ici une vraie petite
   pierre a symetrie de revolution — invariante par rotation de la camera, donc toujours d aplomb
   sur sa tige — avec TROIS bandes de facettes de valeurs differentes :
     · la TABLE, plate, tournee vers le ciel : elle prend la lumiere et porte le liseré `pinLedge` ;
     · la COURONNE, six facettes fortement inclinees : la cassure du biseau ;
     · le PAVILLON, six facettes descendantes vers la pointe : la valeur sombre qui donne le volume.
   Geometrie NON INDEXEE : `computeVertexNormals()` produit alors une normale PAR FACETTE — c est
   cette normale (son `y`) que le nuanceur lit pour poser le liseré sur la seule arete haute.       */
function gemGeometry(R, N) {
  /* TABLE PETITE : elle porte le liseré, elle ne doit pas etre la face dominante — sinon la pierre
     lit comme une tete de clou blanche. La couronne (les six facettes inclinees) fait le corps. */
  const rT = R * 0.34, yT = R * 0.80;           /* table    */
  const yG = R * 0.14;                          /* ceinture (rayon R) */
  const yB = -R * 1.50;                         /* pointe basse */
  const P = [];
  const ring = (rad, y) => { const a = []; for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2 + Math.PI / N; a.push([Math.cos(t) * rad, y, Math.sin(t) * rad]); } return a; };
  const T = ring(rT, yT), Gr = ring(R, yG), B = [0, yB, 0];
  const tri = (a, b, c) => { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  /* enroulement anti-horaire vu de l EXTERIEUR (three : FrontSide = CCW) */
  for (let i = 1; i < N - 1; i++) tri(T[0], T[i + 1], T[i]);                     /* table    : 4 tri */
  for (let i = 0; i < N; i++) {                                                  /* couronne : 12 tri */
    const j = (i + 1) % N;
    tri(T[i], Gr[j], Gr[i]); tri(T[i], T[j], Gr[j]);
  }
  for (let i = 0; i < N; i++) tri(Gr[i], Gr[(i + 1) % N], B);                     /* pavillon : 6 tri */
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}
function texOf(canvas, renderer, nearest) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else if (renderer) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/* Masque du territoire : blanc a terre, noir en mer, bord antialiase par le remplissage canvas.
   Sert d ALPHAMAP (three lit le canal VERT) — le littoral est donc EXACT quelle que soit la
   resolution du maillage — et de test « terre / mer » a la construction.                          */
function landCanvas(W) {
  const H = Math.round(W * SPANY / SPANX);
  const c = mkCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  const sx = W / SPANX;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.beginPath();
  for (const reg of G.REGIONS) for (const poly of reg.polygons) {
    const pts = poly.outer.pts;                  /* contours seuls : un etang ne perce pas la plaque */
    for (let i = 0; i < pts.length; i++) {
      const X = (pts[i][0] - GX0) * sx, Y = (GY1 - pts[i][1]) * sx;
      if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
    }
    g.closePath();
  }
  g.fill('nonzero');
  return { canvas: c, W, H, data: g.getImageData(0, 0, W, H).data };
}

/* RELIEF : de la ligne de crete au MASSIF.
   `sampleRelief` produit des cretes etroites et justes ; a l ecran, chaque ligne de crete lit alors
   comme un bourrelet isole, et les Alpes deviennent une serie de zebrures paralleles. On elargit la
   RETOMBEE de chaque crete — max entre l altitude d origine et une version floutee — : les sommets
   gardent leur hauteur, les cretes voisines fusionnent en une seule masse, les plaines ne bougent pas.
   Flou par sommes glissantes : O(n), deux passes, ~6 ms sur une grille 768.                          */
function boxBlur(src, dst, w, h, r, horizontal) {
  const inv = 1 / (2 * r + 1);
  if (horizontal) {
    for (let j = 0; j < h; j++) {
      const o = j * w;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[o + clamp(i, 0, w - 1)];
      for (let i = 0; i < w; i++) {
        dst[o + i] = sum * inv;
        sum += src[o + Math.min(i + r + 1, w - 1)] - src[o + Math.max(i - r, 0)];
      }
    }
  } else {
    for (let i = 0; i < w; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += src[clamp(j, 0, h - 1) * w + i];
      for (let j = 0; j < h; j++) {
        dst[j * w + i] = sum * inv;
        sum += src[Math.min(j + r + 1, h - 1) * w + i] - src[Math.max(j - r, 0) * w + i];
      }
    }
  }
}
function widenRelief(g, r) {
  const n = g.w * g.h, a = new Float32Array(n), b = new Float32Array(n);
  boxBlur(g.data, a, g.w, g.h, r, true);
  boxBlur(a, b, g.w, g.h, r, false);
  const d = g.data;
  for (let i = 0; i < n; i++) { const s = b[i] * 1.34; if (s > d[i]) d[i] = s; }
}

/* Halo dore : la SILHOUETTE du territoire, floutee deux fois (liseré serre + bloom large).
   Pose sous le socle, en melange additif, elle ne se voit que DEBORDANT du territoire :
   un glow qui epouse la France, jamais un projecteur circulaire.                                  */
const GLOW_PAD = 1.36;                 /* le halo deborde : son plan est plus grand que la bbox */
function glowCanvas(src, W, soft) {
  const H = Math.round(W * SPANY / SPANX);
  const c = mkCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const draw = (blur, scale, alpha) => {
    g.save();
    g.filter = 'blur(' + blur + 'px)';
    g.globalAlpha = alpha;
    const w = W / GLOW_PAD * scale, h = H / GLOW_PAD * scale;
    g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
    g.restore();
  };
  if (soft) {                                   /* ombre : silhouette pleine, bord tres doux */
    draw(Math.round(W * 0.016), 1.0, 0.85);
    draw(Math.round(W * 0.045), 1.01, 0.55);
  } else {
    draw(Math.round(W * 0.020), 1.012, 0.85);   /* liseré serre */
    draw(Math.round(W * 0.062), 1.035, 0.45);   /* bloom large, tres doux */
  }
  return c;
}

/* Index de region dans le canal ROUGE ((i + 1) * 16), lu au filtre NEAREST :
   eclaire UNE seule region au focus, sans une seule geometrie supplementaire.                     */
function regionCanvas(W) {
  const H = Math.round(W * SPANY / SPANX);
  const c = mkCanvas(W, H), g = c.getContext('2d');
  const sx = W / SPANX;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  G.REGIONS.forEach((reg, i) => {
    g.fillStyle = 'rgb(' + ((i + 1) * 16) + ',0,0)';
    g.beginPath();
    for (const poly of reg.polygons) {
      const pts = poly.outer.pts;
      for (let k = 0; k < pts.length; k++) {
        const X = (pts[k][0] - GX0) * sx, Y = (GY1 - pts[k][1]) * sx;
        if (k) g.lineTo(X, Y); else g.moveTo(X, Y);
      }
      g.closePath();
    }
    g.fill('nonzero');
  });
  return c;
}

/* Environnement : petit degrade equirectangulaire (256 x 128) passe au PMREM.
   C est lui qui donne au territoire son satine premium et aux diamants leur reflet metallique.    */
function envTexture(renderer) {
  const c = mkCanvas(256, 128), g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0.00, '#39445e');
  v.addColorStop(0.44, '#6b7183');
  v.addColorStop(0.56, '#8f8571');
  v.addColorStop(1.00, '#171a22');
  g.fillStyle = v; g.fillRect(0, 0, 256, 128);
  const k = g.createRadialGradient(56, 40, 2, 56, 40, 78);
  k.addColorStop(0, 'rgba(255,238,208,.95)'); k.addColorStop(1, 'rgba(255,238,208,0)');
  g.fillStyle = k; g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(t);
  pm.dispose(); t.dispose();
  return rt;
}

/* ---------------------------------------------------------------- lignes « qui se dessinent »
   Une seule technique pour le contour, les frontieres et le reseau : chaque sommet porte son
   abscisse curviligne normalisee `aT`. Un uniforme `uHead` promene une tete lumineuse le long du
   trace ; `uAhead` decide de ce qu il y a DEVANT elle (0 = trace vierge, > 0 = simple re-allumage). */
function sweepShader(mat, U, ribbon) {
  mat.customProgramCacheKey = () => (ribbon ? 'c3d-sweep-w' : 'c3d-sweep');
  mat.onBeforeCompile = s => {
    s.uniforms.uHead = U.head; s.uniforms.uAhead = U.ahead; s.uniforms.uFade = U.fade;
    s.uniforms.uSpark = U.spark; s.uniforms.uSoft = U.soft;
    s.vertexShader = 'attribute float aT;\nvarying float vT;\n' + s.vertexShader
      .replace('void main() {', 'void main() {\n\tvT = aT;');
    if (ribbon) {
      /* le ruban garde une epaisseur constante a l ecran : uW suit la distance de camera */
      s.uniforms.uW = U.w;
      s.vertexShader = 'attribute vec3 aOff;\nuniform float uW;\n' + s.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += aOff * uW;');
    }
    s.fragmentShader = 'uniform float uHead;\nuniform float uAhead;\nuniform float uFade;\nuniform float uSpark;\nuniform float uSoft;\nvarying float vT;\n' + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
	float dSweep = uHead - vT;
	float lit = mix(uAhead, 1.0, smoothstep(-uSoft, 0.0, dSweep));
	float hot = uSpark * exp(-abs(dSweep) / max(uSoft, 1e-4) * 1.5);
	diffuseColor.a *= clamp(lit + hot, 0.0, 1.0) * uFade;
	diffuseColor.rgb *= 1.0 + 2.2 * hot;`);
  };
  return mat;
}
function sweepSet() {
  return { head: { value: 1 }, ahead: { value: 1 }, fade: { value: 1 }, spark: { value: 0 }, soft: { value: 0.014 }, w: { value: 1 } };
}

/* Le trace commence au POINT LE PLUS AU NORD de chaque boucle : le contour se dessine depuis la
   Manche et descend, au lieu de demarrer au milieu d une frontiere. */
function fromNorth(loop) {
  let k = 0;
  for (let i = 1; i < loop.length; i++) if (loop[i][1] > loop[k][1]) k = i;
  return k ? loop.slice(k).concat(loop.slice(0, k)) : loop;
}

/* polylignes -> LineSegments avec abscisse curviligne continue sur tout le jeu */
function lineGeometry(lines, heightFn, lift) {
  let total = 0;
  const lens = lines.map(pts => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    total += L; return L;
  });
  total = total || 1;
  const pos = [], at = [];
  let run = 0;
  lines.forEach((pts, li) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const t0 = (run + acc) / total;
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      pos.push(a[0], heightFn(a) + lift, -a[1], b[0], heightFn(b) + lift, -b[1]);
      at.push(t0, (run + acc) / total);
    }
    run += lens[li];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  return g;
}

/* Ruban de halo pose sur le contour : deux sommets par point (interieur opaque, exterieur
   transparent), melange additif — c est le « liseré lumineux » du contrat, sans post-traitement. */
function ribbonGeometry(loops, heightFn, width, lift) {
  const area = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
  let total = 0;
  const lens = loops.map(pts => {
    let L = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    total += L; return L;
  });
  total = total || 1;
  const pos = [], off = [], at = [], col = [], idx = [];
  let run = 0, base = 0;
  loops.forEach((pts, li) => {
    const n = pts.length;
    if (n < 3) { run += lens[li]; return; }
    const sgn = area(pts) > 0 ? 1 : -1;              /* le halo sort TOUJOURS du territoire */
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = pts[k], a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n];
      let nx = sgn * (b[1] - a[1]), ny = -sgn * (b[0] - a[0]);
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      if (i > 0) { const q = pts[(i - 1) % n]; acc += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      const t = (run + acc) / total, h = heightFn(p) + lift;
      pos.push(p[0], h, -p[1], p[0], h, -p[1]);
      off.push(0, 0, 0, nx * width, 0, -ny * width);
      at.push(t, t);
      col.push(1, 1, 1, 0, 0, 0);
    }
    for (let i = 0; i < n; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    base += (n + 1) * 2;
    run += lens[li];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/* =========================================================================================
   DONNEES — un seul point de lecture pour le moteur, la liste ET le repli sans WebGL
   -----------------------------------------------------------------------------------------
   Les 111 communes, dans l ORDRE DU FICHIER (deja geographique : Hauts-de-France, Grand Est,
   Normandie, Bretagne, Pays de la Loire, Centre-Val de Loire, Ile-de-France, Bourgogne-Franche-
   Comte, Nouvelle-Aquitaine, Auvergne-Rhone-Alpes, Occitanie, Provence-Alpes-Cote d Azur, Corse).
   Aucun champ n est invente : `nom`, `dep`, `departement` et `region` viennent du fichier genere.
   `journee` n est vrai que si une journee REELLE est publiee pour cette commune — dans ce cas le
   pin se distingue, et rien d autre (ni date, ni lieu, ni disponibilite dans la carte).
   ========================================================================================= */
/* CLE DE RAPPROCHEMENT DES NOMS DE COMMUNE — meme normalisation des deux cotes.
   `journees-data.js` est saisi a la main : « EPINAL », « epinal » ou « Epinal » doivent tous
   retrouver « Épinal », et « L Isle-sur-la-Sorgue » retrouver « L'Isle-sur-la-Sorgue ».
   NFD + suppression des diacritiques + repli de la ponctuation, exactement comme le fait deja
   `review/build-villes.mjs` a la generation du fichier de donnees.                               */
const villeKey = s => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function readVilles(options) {
  const opts = options || {};
  const src = opts.villes != null ? opts.villes : (typeof window !== 'undefined' ? window.COMPAGNIE_OR_VILLES : null);
  const list = Array.isArray(src) ? src : [];
  /* journees reelles : on ne s en sert QUE pour distinguer un pin (aucun texte affiche) */
  const jsrc = opts.journees != null ? opts.journees : (typeof window !== 'undefined' ? window.COMPAGNIE_OR_JOURNEES : null);
  const withJournee = new Set();
  if (Array.isArray(jsrc)) for (const j of jsrc) if (j && j.ville) withJournee.add(villeKey(j.ville));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (!v || !isFinite(v.lat) || !isFinite(v.lon)) continue;
    out.push({
      id: v.code ? 'v' + v.code : 'v' + i,
      nom: v.nom, dep: v.dep, departement: v.departement, region: v.region,
      lat: v.lat, lon: v.lon,
      journee: withJournee.has(villeKey(v.nom))
    });
  }
  return out;
}
/* projection vers le format de la coquille (la liste n a besoin d aucune position ecran) */
export function uiCitiesOf(list) {
  return list.map(it => ({ id: it.id, nom: it.nom, dep: it.dep, departement: it.departement, region: it.region, journee: it.journee }));
}

/* =========================================================================================
   MOTEUR
   ========================================================================================= */
export async function createCarteScene(host, options) {
  const opts = options || {};
  if (!host) throw new Error('carte3d : host manquant');

  const reduced = opts.reduced != null ? !!opts.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = opts.mobile != null ? !!opts.mobile
    : (matchMedia('(max-width: 820px)').matches || matchMedia('(hover: none), (pointer: coarse)').matches);
  const idleMode = opts.idle === 'still' ? 'still' : 'pulse';
  let mode = (opts.ambiance || document.documentElement.dataset.ambiance) === 'jour' ? 'jour' : 'nuit';

  /* ---------- contexte WebGL (le repli est gere par l appelant / initCarte3D) ----------
     ON CREE LE CONTEXTE SOI-MEME, puis on le PASSE au renderer : c est le SEUL et MEME contexte
     (aucun second contexte gaspille, la limite de ~16 par onglet est respectee), et l absence de
     WebGL se lit sur un `getContext()` qui renvoie null — silencieusement. Laisser
     `new THREE.WebGLRenderer()` echouer seul ecrivait
     « THREE.WebGLRenderer: Error creating WebGL context. » dans la console AVANT de lever, ce qui
     violait la regle « 0 erreur console dans tous les etats » sur les machines sans WebGL.        */
  const breathe = makeBreathe();
  const GL_ATTR = { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  let renderer = null, glCanvas = null, gl = null;
  try {
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', GL_ATTR) || glCanvas.getContext('webgl', GL_ATTR);
    if (!gl) throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer(Object.assign({ canvas: glCanvas, context: gl }, GL_ATTR));
    if (!renderer.getContext()) throw new Error('WebGL unavailable');
  } catch (e) {
    if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e2) { /* deja perdu */ } }
    else if (gl) { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) { try { lose.loseContext(); } catch (e3) { /* deja perdu */ } } }
    throw new Error('WebGL unavailable');
  }

  const DPR = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(mobile ? 1.25 : 1.5, DPR));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = false;                /* ombre CUITE : aucune passe supplementaire */
  renderer.setClearColor(0x000000, 0);

  const canvas = renderer.domElement;
  canvas.className = 'c3d-gl';
  canvas.setAttribute('aria-hidden', 'true');

  /* ---------- scene, camera, lumieres ---------- */
  const scene = new THREE.Scene();
  const FOV = mobile ? 34 : 29;                      /* longue focale : perspective noble, sans distorsion */
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 14);
  const envRT = envTexture(renderer);
  scene.environment = envRT.texture;
  scene.fog = new THREE.Fog(0x0b0d14, 1.3, 5.4);

  const hemi = new THREE.HemisphereLight(0x7f92be, 0x141a29, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe9c4, 2.55);
  key.position.set(SUN[0], SUN[1], SUN[2]).multiplyScalar(1.9);   /* rasante (22 deg), venue du nord-ouest */
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x7086c2, 0.66);
  fill.position.set(1.5, 1.05, 1.3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe8cd93, 0.55);
  rim.position.set(0.9, 0.30, -1.6);
  scene.add(rim);

  const world = new THREE.Group();                   /* tout le territoire (scale.y anime la revelation) */
  scene.add(world);

  await breathe(true, "renderer+lumieres");

  /* =====================================================================
     1. MASQUES ET MAILLAGE DU TERRITOIRE
     ===================================================================== */
  const mask = landCanvas(mobile ? 768 : 1100);
  const landTex = texOf(mask.canvas, renderer);
  await breathe(true, "masque terre/mer");
  const regTex = texOf(regionCanvas(560), renderer, true);
  const landAt = (x, y) => {
    const i = Math.round((x - GX0) * mask.W / SPANX), j = Math.round((GY1 - y) * mask.W / SPANX);
    if (i < 0 || j < 0 || i >= mask.W || j >= mask.H) return false;
    return mask.data[(j * mask.W + i) * 4 + 1] > 120;
  };

  await breathe(true, "index des regions");

  /* carte d altitude, cuite par tranches : jamais plus de quelques millisecondes d affilee */
  let grid = null;
  for (const g of G.buildReliefGridSlices(mobile ? 512 : 768, undefined, 20)) { grid = g; await breathe(); }
  widenRelief(grid, mobile ? 6 : 9);
  await breathe(true, "grille de relief");

  const reliefAt = (x, y) => Math.max(0, G.sampleReliefGrid(grid, x, y));

  const RES = (opts.quality === 'low' || mobile) ? 196 : 312;
  const NY = Math.round(RES * SPANY / SPANX);
  const dx = SPANX / RES, dy = SPANY / NY;
  const nV = (RES + 1) * (NY + 1);
  const vPos = new Float32Array(nV * 3);
  const vUv = new Float32Array(nV * 2);
  const vCol = new Uint8Array(nV * 3);
  const isLand = new Uint8Array(nV);
  const tri = [];
  const RMAX = G.RELIEF.max;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0, v = j * (RES + 1); i <= RES; i++, v++) {
      const x = GX0 + i * dx, y = GY0 + j * dy;
      const t = landAt(x, y);
      isLand[v] = t ? 1 : 0;
      const h0 = t ? reliefAt(x, y) : 0, h = h0 * RK;
      vPos[v * 3] = x; vPos[v * 3 + 1] = h; vPos[v * 3 + 2] = -y;
      vUv[v * 2] = (x - GX0) / SPANX; vUv[v * 2 + 1] = (y - GY0) / SPANY;
      /* variation de matiere : les cretes accrochent un PEU plus la lumiere. Volontairement discret :
         a 0,10 les Alpes viraient au blanc en ambiance jour et le relief lisait en zebrures. */
      const u = Math.pow(clamp(h0 / RMAX, 0, 1), 0.62);
      const n = 0.5 + 0.5 * Math.sin(x * 23.7 + y * 17.3) * Math.sin(x * 9.1 - y * 12.9);
      const c = clamp(0.845 + 0.042 * u + 0.026 * (n - 0.5), 0, 1);
      vCol[v * 3] = vCol[v * 3 + 1] = vCol[v * 3 + 2] = Math.round(c * 255);
    }
    if ((j & 31) === 31) await breathe();
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < RES; i++) {
    const k = j * (RES + 1) + i, k1 = (j + 1) * (RES + 1) + i;
    if (!(isLand[k] | isLand[k + 1] | isLand[k1] | isLand[k1 + 1])) continue;
    tri.push(k, k + 1, k1, k + 1, k1 + 1, k1);
  }
  await breathe();
  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
  surfGeo.setAttribute('uv', new THREE.BufferAttribute(vUv, 2));
  surfGeo.setAttribute('color', new THREE.BufferAttribute(vCol, 3, true));
  surfGeo.setIndex(tri);
  surfGeo.computeVertexNormals();
  const triSurf = tri.length / 3;

  await breathe(true, "maillage du territoire");

  /* ---------- socle : muraille verticale posee sur le contour EXACT ----------
     Contour, socle, pins et surface lisent TOUS la meme grille elargie : aucun decrochement. */
  const hAt = p => reliefAt(p[0], p[1]) * RK;
  const wPos = [], wCol = [], wIdx = [];
  for (const loop of G.OUTLINE) {
    const n = loop.length;
    if (n < 3) continue;
    const base = wPos.length / 3;
    for (let i = 0; i <= n; i++) {
      const p = loop[i % n], h = hAt(p);
      wPos.push(p[0], h, -p[1], p[0], -THICK, -p[1]);
      wCol.push(1, 1, 1, 0.52, 0.52, 0.52);
    }
    for (let i = 0; i < n; i++) { const k = base + i * 2; wIdx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  skirtGeo.setIndex(wIdx);
  skirtGeo.computeVertexNormals();
  const triSkirt = wIdx.length / 3;

  await breathe(true, "socle");

  /* =====================================================================
     2. MATIERES DU TERRITOIRE
     (une injection commune : revelation d intro + region eclairee au focus)
     ===================================================================== */
  const U = {
    wipe: { value: -9 }, wipeAmt: { value: 0 }, wipeDeep: { value: 0 },
    wipeCol: { value: new THREE.Color(NUIT.goldHot) },
    voidCol: { value: new THREE.Color(NUIT.fog) },
    hiIdx: { value: -1 }, hiAmt: { value: 0 },
    hiCol: { value: new THREE.Color(NUIT.hiCol) },
    reg: { value: regTex }
  };
  const GEOUV = `vec2 gUv = vec2((position.x - ${GX0.toFixed(4)}) / ${SPANX.toFixed(4)}, (-position.z - ${GY0.toFixed(4)}) / ${SPANY.toFixed(4)});`;
  function landShader(mat) {
    mat.customProgramCacheKey = () => 'c3d-land';
    mat.onBeforeCompile = s => {
      for (const k in U) s.uniforms[k] = U[k];
      s.vertexShader = 'varying vec2 vGeoUv;\n' + s.vertexShader
        .replace('void main() {', 'void main() {\n\t' + GEOUV + '\n\tvGeoUv = gUv;');
      s.fragmentShader = `uniform sampler2D reg;
uniform float wipe; uniform float wipeAmt; uniform float wipeDeep; uniform vec3 wipeCol; uniform vec3 voidCol;
uniform float hiIdx; uniform float hiAmt; uniform vec3 hiCol;
varying vec2 vGeoUv;
` + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	if (hiAmt > 0.001) {
		float ri = floor(texture2D(reg, vGeoUv).r * 15.9375 + 0.5) - 1.0;
		diffuseColor.rgb += hiCol * hiAmt * step(abs(ri - hiIdx), 0.4);
	}
	if (wipeAmt > 0.001) {
		/* la revelation suit la DIRECTION DE LA LUMIERE (nord-ouest -> sud-est), pas l axe de
		   l ecran : la bande epouse la perspective au lieu de la barrer horizontalement. */
		float axis = (vGeoUv.y - vGeoUv.x) * 0.7071;
		float w = clamp((axis - wipe) / 0.34, 0.0, 1.0);
		float k = mix(wipeDeep, 1.0, w);
		float edge = exp(-pow((axis - wipe) / 0.115, 2.0));
		diffuseColor.rgb = mix(voidCol, diffuseColor.rgb, mix(1.0, k, wipeAmt));
		diffuseColor.rgb += wipeCol * edge * wipeAmt * 0.30;
		diffuseColor.a *= mix(1.0, k, wipeAmt);
	}`);
    };
    return mat;
  }

  const surfMat = landShader(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(NUIT.land),
    roughness: 0.82, metalness: 0.04,
    clearcoat: mobile ? 0 : 0.09, clearcoatRoughness: 0.62,
    vertexColors: true, alphaMap: landTex, transparent: true,
    envMapIntensity: NUIT.env, side: THREE.FrontSide
  }));
  const skirtMat = landShader(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(NUIT.skirt),
    roughness: 0.5, metalness: 0.2,
    clearcoat: mobile ? 0 : 0.34, clearcoatRoughness: 0.3,
    vertexColors: true, transparent: true,
    envMapIntensity: NUIT.env * 0.9, side: THREE.DoubleSide
  }));

  const surf = new THREE.Mesh(surfGeo, surfMat);
  surf.renderOrder = 1;
  world.add(surf);
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.renderOrder = 0;
  world.add(skirt);

  /* ---------- ombre douce portee (cuite) et halo dore ---------- */
  const shadowTex = texOf(glowCanvas(mask.canvas, 512, true), renderer);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.contact), alphaMap: shadowTex, transparent: true, opacity: 0,
    depthWrite: false, fog: false
  });
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(SPANX * GLOW_PAD, SPANY * GLOW_PAD), shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = SHADOW_Y;
  /* la silhouette glisse dans la direction de la lumiere : la plaque flotte au-dessus de son ombre */
  {
    const t = (0 - SHADOW_Y) / SUN[1];
    shadowPlane.position.x = -SUN[0] * t;
    shadowPlane.position.z = -SUN[2] * t;
  }
  shadowPlane.renderOrder = -3;
  scene.add(shadowPlane);

  const haloTex = texOf(glowCanvas(mask.canvas, 512), renderer);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.halo), alphaMap: haloTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(SPANX * GLOW_PAD, SPANY * GLOW_PAD), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = GLOW_Y;
  halo.renderOrder = -4;
  scene.add(halo);

  await breathe(true, "ombre + halo");

  /* =====================================================================
     3. CONTOUR OR, FRONTIERES, RESEAU
     ===================================================================== */
  const UO = sweepSet(), UB = sweepSet(), UN = sweepSet();

  const LOOPS = G.OUTLINE.map(fromNorth);
  const outlineGeo = lineGeometry(LOOPS.map(l => l.concat([l[0]])), hAt, 0.0016);
  const outlineMat = sweepShader(new THREE.LineBasicMaterial({
    color: new THREE.Color(NUIT.goldHot), transparent: true, opacity: NUIT.outlineA, depthWrite: false
  }), UO);
  const outline = new THREE.LineSegments(outlineGeo, outlineMat);
  outline.renderOrder = 4;
  world.add(outline);

  const glowGeo = ribbonGeometry(LOOPS, hAt, 0.0165, 0.0011);
  const glowMat = sweepShader(new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.gold), vertexColors: true, transparent: true, opacity: NUIT.glowA,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
  }), UO, true);
  const glowLine = new THREE.Mesh(glowGeo, glowMat);
  glowLine.renderOrder = 3;
  world.add(glowLine);

  const borderGeo = lineGeometry(G.BORDERS, hAt, 0.0014);
  const borderMat = sweepShader(new THREE.LineBasicMaterial({
    color: new THREE.Color(NUIT.gold), transparent: true, opacity: NUIT.borderA, depthWrite: false
  }), UB);
  const borders = new THREE.LineSegments(borderGeo, borderMat);
  borders.renderOrder = 2;
  world.add(borders);

  const triLines = outlineGeo.attributes.position.count / 2 + glowGeo.index.count / 3 + borderGeo.attributes.position.count / 2;

  /* reseau national : arcs fins, purement TRANSITOIRES. A 111 communes, relier tous les points
     produirait un gribouillis : on ne relie qu UN point par region (13 arcs), le temps de l intro. */
  let netMesh = null;
  const netMat = sweepShader(new THREE.LineBasicMaterial({
    color: new THREE.Color(NUIT.gold), transparent: true, opacity: 0, depthWrite: false, fog: false
  }), UN);
  function buildNetwork(pts) {
    if (netMesh) { world.remove(netMesh); netMesh.geometry.dispose(); netMesh = null; }
    if (pts.length < 2) return;
    const left = pts.slice();
    let curP = left.shift();
    const lines = [];
    while (left.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < left.length; i++) {
        const d = (left[i].x - curP.x) * (left[i].x - curP.x) + (left[i].y - curP.y) * (left[i].y - curP.y);
        if (d < bd) { bd = d; bi = i; }
      }
      const nx = left.splice(bi, 1)[0];
      const seg = [], N = 16, rise = 0.024 + Math.min(0.055, Math.sqrt(bd) * 0.12);
      for (let s = 0; s <= N; s++) {
        const t = s / N;
        seg.push([lerp(curP.x, nx.x, t), lerp(curP.y, nx.y, t), lerp(curP.h, nx.h, t) + Math.sin(t * Math.PI) * rise]);
      }
      lines.push(seg);
      curP = nx;
    }
    let total = 0;
    const lens = lines.map(sg => { let L = 0; for (let i = 1; i < sg.length; i++) L += Math.hypot(sg[i][0] - sg[i - 1][0], sg[i][1] - sg[i - 1][1]); total += L; return L; });
    total = total || 1;
    const p = [], at = [];
    let run = 0;
    lines.forEach((sg, li) => {
      let acc = 0;
      for (let i = 1; i < sg.length; i++) {
        const a = sg[i - 1], b = sg[i];
        const t0 = (run + acc) / total;
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        p.push(a[0], a[2], -a[1], b[0], b[2], -b[1]);
        at.push(t0, (run + acc) / total);
      }
      run += lens[li];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
    netMesh = new THREE.LineSegments(g, netMat);
    netMesh.renderOrder = 5;
    netMesh.visible = false;
    world.add(netMesh);
  }

  await breathe(true, "contour/frontieres");

  /* =====================================================================
     4. PINS — 111 MARQUEURS, CINQ APPELS DE DESSIN
     -------------------------------------------------------------------
     Chaque commune est UNE instance dans cinq InstancedMesh qui partagent exactement les memes
     matrices (une simple translation : longitude, altitude du relief, latitude). Tout le reste —
     croissance a l intro, elevation du pin actif, retombee de l ancien, pulsation, attenuation des
     autres — est calcule DANS LE SHADER a partir de quatre attributs par instance et de dix
     uniformes. Consequence : pendant l animation, pas un seul octet n est televerse au GPU, et le
     cout CPU d une image ne depend plus du nombre de pins.
     ===================================================================== */
  /* MOBILE — un pin calibre pour 470 px par unite monde devient un grain de 3 px quand la France
     tient dans 375 px de large. On ne change ni le dessin ni la densite : seulement l echelle. */
  const PS = mobile ? 1.45 : 1;
  const stemGeo = new THREE.CylinderGeometry(0.00068 * PS, 0.00165 * PS, 1, 6, 1, true).translate(0, 0.5, 0);   /* 12 triangles */
  const gemGeo = gemGeometry(HEAD_R * PS, 6);                               /* 22 triangles : table + couronne + pavillon */
  const discGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);      /* 2 triangles, pose a plat, rayon 1 */
  const spriteTex = texOf(radialCanvas(128, 0, 3.3), renderer);   /* coeur serre : aucun bloom laiteux */
  await breathe();
  /* ombre de contact : retombee RAPIDE (puissance 2,6) — une pose au sol, pas un blob de feutre */
  const contactTex = texOf(radialCanvas(128, 0, 2.6), renderer);
  const baseTex = texOf(radialCanvas(128, 0, 2.2), renderer);      /* coeur franc : le pin a un POINT lumineux */
  const haloTex2 = texOf(radialCanvas(128, 0, 3.6), renderer);     /* retombee tres douce : le halo ne fait pas de nappe */
  const poolTex = texOf(poolCanvas(192, 2.0), renderer);           /* tache de lumiere du pin actif */
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  await breathe();

  /* uniformes partages par les cinq matieres de pin */
  const PU = {
    uTime: { value: 0 },
    uGrow: { value: 9 },        /* secondes ecoulees depuis le debut de l allumage des pins */
    uSel: { value: -1 }, uSelAmt: { value: 0 },
    uPrev: { value: -1 }, uPrevAmt: { value: 0 },
    uHov: { value: -1 }, uHovAmt: { value: 0 },
    uFocus: { value: 0 },       /* 1 = une ville est active : les autres s estompent */
    uPulse: { value: 1 },       /* 0 sous prefers-reduced-motion */
    /* liseré de la pierre : couleur DEJA multipliee par son intensite (voir applyAmb) */
    uLedge: { value: new THREE.Color(NUIT.pinLedge).multiplyScalar(NUIT.pinLedgeI) }
  };
  const PIN_HEAD = `attribute float aIdx;
attribute float aOrder;
attribute float aPhase;
attribute float aTone;
uniform float uTime; uniform float uGrow;
uniform float uSel; uniform float uSelAmt; uniform float uPrev; uniform float uPrevAmt;
uniform float uHov; uniform float uHovAmt; uniform float uFocus; uniform float uPulse;
varying float vA;
float c3dBack(float t){ float u = t - 1.0; return 1.0 + 1.62 * u * u * u + 0.62 * u * u; }
`;
  /* tronc commun : croissance, elevation, attenuation, pulsation */
  const PIN_CORE = `
	float g = clamp((uGrow - aOrder * ${PIN_SPREAD.toFixed(3)}) / 0.55, 0.0, 1.0);
	float gb = c3dBack(g);
	float sel = step(abs(aIdx - uSel), 0.4);
	float prv = step(abs(aIdx - uPrev), 0.4);
	float hov = step(abs(aIdx - uHov), 0.4);
	float lift = min(sel * uSelAmt + prv * uPrevAmt + hov * uHovAmt * 0.42, 1.0);
	float dim = 1.0 - uFocus * (1.0 - lift) * 0.60;
	float puls = 0.5 + 0.5 * sin(uTime * 1.45 + aPhase);
	float len = ${(STEM * PS).toFixed(5)} * (0.06 + 0.94 * gb) * (1.0 + lift * ${LIFT_K.toFixed(2)});
`;
  const PIN_BODY = {
    stem: PIN_CORE + `
	transformed.y *= len;
	transformed.xz *= mix(0.45, 1.0, g) * (1.0 + lift * 0.30);
	vA = dim;`,
    /* LA PIERRE — c est ELLE qui doit designer la ville active, pas la pastille au sol.
       Au repos la tete active mesurait 155 de luminance contre 152 pour un pin ordinaire : rien.
       On porte donc l etat actif sur le metal lui-meme : +50 % sur la reflexion (vA), +130 % sur
       l emissive et +155 % sur le liseré (voir le fragment) — soit ~ +40 % de luminance mesuree. */
    head: PIN_CORE + `
	transformed *= (0.30 + 0.70 * gb) * (1.0 + lift * 0.72) * (1.0 + aTone * 0.12) * (1.0 + 0.040 * puls * uPulse);
	transformed.y += len;
	vNy = objectNormal.y;
	vLift = lift;
	vE = (1.0 - uFocus * (1.0 - lift) * 0.26) * (1.0 + aTone * 0.30);
	vA = dim * (1.0 + aTone * 0.34) * (1.0 + lift * 0.80);`,
    base: PIN_CORE + `
	transformed.xz *= ${(BASE_R * PS).toFixed(5)} * (0.26 + 0.74 * gb) * (1.0 + lift * 0.60) * (1.0 + aTone * 0.20);
	transformed.y += 0.0018;
	vA = g * dim * (0.74 + 0.26 * puls * uPulse) * (1.0 + lift * 0.55) * (1.0 + aTone * 0.45);`,
    contact: PIN_CORE + `
	transformed.xz *= ${(CONTACT_R * PS).toFixed(5)} * (0.30 + 0.70 * g) * (1.0 + lift * 0.62);
	transformed.y += 0.0007;
	vA = g * (1.0 - lift * 0.34);`,
    /* HALO FACE CAMERA — le seul element du pin qui ne soit pas dans le plan de la carte.
       Pose au sol, un halo est ecrase par la perspective (une ellipse deux fois plus large que
       haute) et cesse de lire comme une lumiere. Ici le quad est deplie dans le plan de l ecran,
       centre sur le diamant : on retrouve le rayonnement d un point lumineux, sans une seule
       geometrie supplementaire et sans sprite (donc toujours UN seul appel de dessin).           */
    halo: PIN_CORE + `
	float hs = ${(HALO_R * PS).toFixed(5)} * (0.20 + 0.80 * gb) * (1.0 + lift * 1.28) * (1.0 + aTone * 0.18);
	vA = g * dim * (0.70 + 0.30 * puls * uPulse) * (1.0 + lift * 1.55);`
  };
  const PIN_BILLBOARD = `
	vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
	mvPosition.xyz += (modelViewMatrix * vec4(0.0, len, 0.0, 0.0)).xyz;
	mvPosition.xy += transformed.xz * hs;
	gl_Position = projectionMatrix * mvPosition;`;
  function pinShader(mat, kind) {
    /* les tailles sont CUITES dans le shader (aucun uniforme de plus) : la cle de cache doit donc
       distinguer la variante mobile, sinon three reutiliserait le programme du desktop. */
    mat.customProgramCacheKey = () => 'c3d-pin-' + kind + (mobile ? '-m' : '');
    mat.onBeforeCompile = s => {
      for (const k in PU) s.uniforms[k] = PU[k];
      const gem = kind === 'head';
      const GV = 'varying float vNy;\nvarying float vLift;\nvarying float vE;\n';
      s.vertexShader = PIN_HEAD + (gem ? GV : '') + s.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + PIN_BODY[kind]);
      if (kind === 'halo') s.vertexShader = s.vertexShader.replace('#include <project_vertex>', PIN_BILLBOARD);
      const mul = (kind === 'stem' || gem) ? 'diffuseColor.rgb *= vA;' : 'diffuseColor.a *= vA;';
      s.fragmentShader = 'varying float vA;\n' + (gem ? GV + 'uniform vec3 uLedge;\n' : '') + s.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n\t' + mul);
      /* LE LISERÉ DE LA TABLE — « un mince liseré `goldHot` sur l arete superieure, pour qu une
         lumiere coure dessus quand la camera tourne ».
         `vNy` est la normale d OBJET de la facette (geometrie non indexee : une normale par
         facette). La table vaut 1, les facettes de couronne ~0,55, le pavillon est negatif : le
         `smoothstep` allume donc la table a plein, effleure la couronne, laisse le pavillon sombre.
         C est ce qui donne, sur l ivoire du jour, un point plus CLAIR que la terre — un vrai
         reflet metallique et non une tache brune.                                               */
      if (gem) s.fragmentShader = s.fragmentShader.replace(
        'vec3 totalEmissiveRadiance = emissive;',
        'float c3dLedge = smoothstep(0.55, 0.99, vNy);\n\tvec3 totalEmissiveRadiance = emissive * vE * (1.0 + vLift * 1.05) + uLedge * vE * (0.07 + 0.93 * c3dLedge) * (1.0 + vLift * 1.05);');
    };
    return mat;
  }

  const contactMat = pinShader(new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.pinContact), alphaMap: contactTex, transparent: true, opacity: NUIT.pinContactA,
    depthWrite: false, fog: false
  }), 'contact');
  const baseMat = pinShader(new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.pinBase), alphaMap: baseTex, transparent: true, opacity: NUIT.pinBaseA,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }), 'base');
  const haloPinMat = pinShader(new THREE.MeshBasicMaterial({
    color: new THREE.Color(NUIT.pinHalo), alphaMap: haloTex2, transparent: true, opacity: NUIT.pinHaloA,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }), 'halo');
  const stemMat = pinShader(new THREE.MeshStandardMaterial({
    color: new THREE.Color(NUIT.pinHead), metalness: 0.82, roughness: 0.34, envMapIntensity: 1.3
  }), 'stem');
  const headMat = pinShader(new THREE.MeshStandardMaterial({
    color: new THREE.Color(NUIT.pinHead), metalness: 0.94, roughness: 0.22,
    emissive: new THREE.Color(NUIT.pinEmis), emissiveIntensity: NUIT.pinEmisI,
    envMapIntensity: 1.5, flatShading: true            /* facettes taillees, speculaire chaud */
  }), 'head');

  /* TACHE DE LUMIERE AU SOL + halo du pin actif : deux objets, visibles uniquement au focus.
     UNE SEULE tache, doree dans les deux ambiances, a chute exponentielle et sans bord net —
     l ancien empilement « pastille creme + anneau gris-bleu » lisait comme un ping de sonar. */
  /* `depthTest: false` — la tache est LARGE (une trentaine de kilometres a l echelle du monde) et
     posee a plat sur une seule altitude : des que la commune est au pied d un relief (Lyon, Greno-
     ble, Pau), le tampon de profondeur en tranchait la moitie et il en restait un CROISSANT a bord
     dur. Sans test de profondeur, elle se depose entierement sur le territoire ; `renderOrder: 4`
     la place avant les pins, qui gardent, eux, leur profondeur. */
  const focusRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NUIT.pinPool), alphaMap: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
  const focusRing = new THREE.Mesh(quad, focusRingMat);
  focusRing.scale.setScalar(0.215 * PS);
  focusRing.renderOrder = 4;
  focusRing.visible = false;
  world.add(focusRing);

  const selHaloMat = new THREE.SpriteMaterial({ color: new THREE.Color(NUIT.pinHalo), map: spriteTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const selHalo = new THREE.Sprite(selHaloMat);
  selHalo.scale.setScalar(0.052 * PS);
  selHalo.renderOrder = 8;
  selHalo.visible = false;
  world.add(selHalo);

  const pinRoot = new THREE.Group();
  world.add(pinRoot);
  let mContact = null, mBase = null, mHalo = null, mStem = null, mHead = null;
  let pins = [];                     /* miroir CPU : position monde, position ecran, visibilite */

  function disposePins() {
    for (const m of [mContact, mBase, mHalo, mStem, mHead]) {
      if (!m) continue;
      pinRoot.remove(m);
      m.dispose();
      /* la geometrie est PARTAGEE (stemGeo / gemGeo / discGeo) : on ne libere que les attributs
         d instance, poses sur des copies dediees. */
      if (m.geometry && m.geometry.userData.c3dClone) m.geometry.dispose();
    }
    mContact = mBase = mHalo = mStem = mHead = null;
    pins = [];
  }

  /* une copie de geometrie par maillage : les attributs d instance vivent sur la geometrie */
  function instGeo(src, attrs) {
    const g = src.clone();
    g.userData.c3dClone = true;
    for (const k in attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k], 1));
    return g;
  }

  function buildPins(list) {
    disposePins();
    const n = list.length;
    if (!n) return;
    const aIdx = new Float32Array(n), aOrder = new Float32Array(n), aPhase = new Float32Array(n), aTone = new Float32Array(n);
    const mats = new Float32Array(n * 16);
    const M = new THREE.Matrix4();
    /* ordre d allumage : la meme diagonale nord-ouest -> sud-est que la revelation du territoire */
    const rank = list.map((it, i) => ({ i, k: it.wy - it.wx }));
    rank.sort((a, b) => b.k - a.k);
    rank.forEach((r, k) => { aOrder[r.i] = n > 1 ? k / (n - 1) : 0; });
    for (let i = 0; i < n; i++) {
      const it = list[i];
      aIdx[i] = i;
      aPhase[i] = (i * 2.399963) % 6.2832;        /* angle d or : deux voisins ne pulsent jamais ensemble */
      aTone[i] = it.journee ? 1 : 0;              /* une journee REELLE publiee : le pin se distingue */
      M.makeTranslation(it.wx, it.h, -it.wy);
      M.toArray(mats, i * 16);
    }
    const attrs = { aIdx, aOrder, aPhase, aTone };
    const mk = (geo, mat, ro) => {
      const m = new THREE.InstancedMesh(instGeo(geo, attrs), mat, n);
      m.instanceMatrix = new THREE.InstancedBufferAttribute(mats, 16);
      m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      m.frustumCulled = false;                    /* la sphere englobante d une InstancedMesh ignore les instances */
      m.renderOrder = ro;
      pinRoot.add(m);
      return m;
    };
    mContact = mk(discGeo, contactMat, 5);
    mBase = mk(discGeo, baseMat, 5);
    mStem = mk(stemGeo, stemMat, 6);
    mHead = mk(gemGeo, headMat, 6);
    mHalo = mk(discGeo, haloPinMat, 7);      /* apres le diamant : le halo l enveloppe, il ne le mange pas */
    pins = list.map(it => ({ it, sx: 0, sy: 0, dcam: 1, onScreen: false }));
  }

  /* =====================================================================
     5. DONNEES : les 111 communes, coordonnees officielles
     ===================================================================== */
  let uiCities = [];
  let itemsRaw = [];

  const readData = () => readVilles(opts);
  function applyData() {
    const netPts = [];
    const seenReg = new Set();
    for (const it of itemsRaw) {
      const w = G.projectWorld(it.lat, it.lon);
      it.wx = w[0]; it.wy = w[1];
      it.h = reliefAt(w[0], w[1]) * RK;
      if (!seenReg.has(it.region)) { seenReg.add(it.region); netPts.push({ x: it.wx, y: it.wy, h: it.h }); }
    }
    buildPins(itemsRaw);
    uiCities = uiCitiesOf(itemsRaw);
    netPts.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y));
    buildNetwork(netPts);
    if (ui) ui.setCities(uiCities);
  }

  const ui = opts.ui || null;

  /* =====================================================================
     6. CAMERA : rig spherique borne + recadrage ecran
     ===================================================================== */
  /* CADRAGE — les marges sont DISSYMETRIQUES sur les quatre cotes : `padT` reserve la bande du
     titre, `padB` la bande basse (invitation dans la page, liste des villes en mobile), `padR` la
     colonne de la liste en plein ecran desktop. Le territoire est alors centre DANS la bande
     libre, pas dans l ecran : la carte ne passe jamais sous la liste, et il ne reste jamais une
     bande vide de l autre cote.                                                                  */
  let listBandPx = 0;
  /* DANS LA PAGE — la liste est une colonne VOISINE, pas un panneau flottant : la scene occupe
     toute sa colonne et n a rien a lui ceder. Il ne reste a reserver que la bande du bouton
     « Agrandir », posee sur le coin haut-droit. L inclinaison y est un peu plus franche que
     l ancien etat ferme (0,30) : la carte n est plus une vignette a cliquer, c est la scene. */
  const TOOLS_PX = 46;
  const PAGE = {
    polar: mobile ? 0.40 : 0.44, padL: 0.035, padR: 0.035, padB: 0.04,
    get padT() { return H > 2 ? clamp(TOOLS_PX / H, 0.045, 0.16) : 0.075; }
  };
  /* LE FOCUS EST PLUS SOBRE DANS LA PAGE. En plein ecran, un rapprochement de 0,70 fait deborder
     le territoire du cadre : c est le bord de l ECRAN, personne ne le lit comme une coupure. Dans
     la page, le meme rapprochement guillotine la carte contre un bord bien visible et laisse une
     grande plage vide du cote de la mer. On rapproche donc moins (0,80) et on incline un peu moins :
     le mouvement reste tres lisible — il est porte par la TRANSLATION, pas par le zoom.           */
  const FOCUS = {
    get polar() { return place === 'full' ? (mobile ? 0.58 : 0.62) : (mobile ? 0.54 : 0.58); },
    /* en mobile la carte n a qu une petite bande de la page : sans un rapprochement plus net, le
       geste ne se voit pas. Le fondu des bords absorbe le debordement.                          */
    get k() { return place === 'full' ? (mobile ? 0.72 : 0.70) : (mobile ? 0.72 : 0.80); }
  };
  const LIM = { polar: [0.16, 1.04], azim: [-0.44, 0.44], k: [0.34, 1.22] };

  const CX = G.BOUNDS.centroid[0], CZ = -G.BOUNDS.centroid[1];
  const cur = { tx: CX, tz: CZ, polar: PAGE.polar, azim: 0, k: 1, wx: 0.5, wy: 0.5, dist: 3, selAmt: 0, prevAmt: 0, focusAmt: 0, hovAmt: 0 };
  const dst = Object.assign({}, cur);
  const tweens = [];
  let W = 1, H = 1;

  function tw(kk, to, dur, delay, fn) {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].k === kk) tweens.splice(i, 1);
    tweens.push({ k: kk, from: cur[kk], to, d: Math.max(0.001, dur), w: delay || 0, t: 0, f: fn || easeIO });
    dst[kk] = to;
  }
  const twClear = () => { tweens.length = 0; };
  const dropTween = kk => { for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].k === kk) tweens.splice(i, 1); };

  const _u = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(), _p = new THREE.Vector3();
  /* SILHOUETTE PLUTOT QUE BOITE — cadrer sur la bbox du territoire, c est cadrer sur beaucoup de
     mer : les quatre coins de la boite (nord-ouest de la Bretagne, sud-est de la Corse…) sont tous
     au large, et le territoire perd plusieurs pour cent de taille a l ecran, surtout en portrait ou
     chaque pixel compte. On cadre donc sur l ENVELOPPE CONVEXE du littoral, calculee une fois :
     une quarantaine de sommets, deux altitudes (dessus du relief, dessous du socle).                */
  const HULL = (() => {
    const pts = [];
    for (const loop of G.OUTLINE) for (const p of loop) pts.push(p);
    pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = src => {
      const h = [];
      for (const p of src) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
      h.pop(); return h;
    };
    return half(pts).concat(half(pts.slice().reverse()));
  })();
  const HULL_TOP = G.RELIEF.max * RK + 0.0018, HULL_BOT = -THICK;
  /* LA CORSE — la seule masse DETACHEE du territoire, et donc la seule qui puisse se retrouver a
     moitie sous le panneau de la liste (une ile coupee en deux par un bord de carte : sale).
     Quatre coins de sa boite suffisent a savoir de quel cote elle tombe (voir focusAnchor).      */
  const CORSE = (() => {
    const reg = G.REGIONS.find(r => /corse/i.test(r.nom || ''));
    if (!reg) return null;
    const b = reg.bbox;
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  })();

  /* distance qui cadre tout le territoire pour l orientation demandee, marges d interface comprises */
  function fitDist(polar, azim, tx, tz, padX, padY) {
    _u.set(Math.sin(polar) * Math.sin(azim), Math.cos(polar), Math.sin(polar) * Math.cos(azim));
    _r.set(Math.cos(azim), 0, -Math.sin(azim));
    _up.crossVectors(_u, _r).normalize();
    const ty = Math.tan(FOV * Math.PI / 360) * (1 - padY);
    const tx2 = Math.tan(FOV * Math.PI / 360) * (W / H) * (1 - padX);
    let d = 0;
    for (let i = 0; i < HULL.length; i++) {
      const q = HULL[i];
      for (let k = 0; k < 2; k++) {
        _p.set(q[0] - tx, k ? HULL_TOP : HULL_BOT, -q[1] - tz);
        const cz = _p.dot(_u), cx = _p.dot(_r), cy = _p.dot(_up);
        d = Math.max(d, cz + Math.abs(cx) / tx2, cz + Math.abs(cy) / ty);
      }
    }
    return Math.max(0.6, d);
  }
  /* CADRAGE EXACT — la boite ecran REELLE du territoire, pas une majoration symetrique.
     `fitDist` mesure chaque point depuis le CENTRE de l ecran : une silhouette qui n y est pas
     centree (la France ne l est pas — la Corse tire au sud-est, la Bretagne a l ouest) se
     retrouve alors cadree plus loin qu il ne faut, jusqu a 12 % de taille perdue, avec une bande
     de vide d un cote. Ici on projette l enveloppe, on lit sa boite a l ecran, on rapproche ou on
     recule, on recentre : quatre passes suffisent. `padY = null` = LA LARGEUR COMMANDE (portrait :
     un territoire quasi carre ne remplira jamais un ecran deux fois plus haut que large ; tout le
     reste est rendu a l interface au lieu de rester en bandes noires).                            */
  function frameFit(polar, padX, padY) {
    _u.set(0, Math.cos(polar), Math.sin(polar));
    _r.set(1, 0, 0);
    _up.crossVectors(_u, _r).normalize();
    const t0 = Math.tan(FOV * Math.PI / 360), ar = W / H;
    const P = [];
    for (let i = 0; i < HULL.length; i++) {
      const q = HULL[i];
      for (let k = 0; k < 2; k++) {
        _p.set(q[0] - CX, k ? HULL_TOP : HULL_BOT, -q[1] - CZ);
        P.push(_p.dot(_u), _p.dot(_r), _p.dot(_up));
      }
    }
    let d = fitDist(polar, 0, CX, CZ, padX, padY == null ? 0 : padY);   /* depart : jamais trop pres */
    let cx = 0, cy = 0, useX = 1, useY = 1;
    for (let it = 0; it < 5; it++) {
      let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
      for (let i = 0; i < P.length; i += 3) {
        const den = Math.max(1e-4, d - P[i]) * t0;
        const x = P[i + 1] / (den * ar), y = P[i + 2] / den;
        if (x < xa) xa = x; if (x > xb) xb = x;
        if (y < ya) ya = y; if (y > yb) yb = y;
      }
      useX = (xb - xa) / 2; useY = (yb - ya) / 2;
      cx = (xb + xa) / 2; cy = (yb + ya) / 2;
      const s = padY == null ? useX / (1 - padX) : Math.max(useX / (1 - padX), useY / (1 - padY));
      if (Math.abs(s - 1) < 0.0015) break;
      d = Math.max(0.6, d * s);
    }
    return { dist: d, ctrX: cx, ctrY: cy, useX, useY };
  }
  /* PLEIN ECRAN — les marges dependent de la FORME de l ecran et de la LARGEUR REELLE de la liste,
     mesurees a chaque cadrage. La coquille recoit les bandes en pixels (`setSafeArea`) pour y
     ancrer exactement la liste des villes.                                                        */
  const BAR_PX = 92;                          /* hauteur reservee a la barre de titre + boutons */
  function fullPads() {
    if (!mobile) {
      /* desktop : la liste occupe la colonne de droite, mesuree sur la coquille */
      const padR = W > 2 && listBandPx > 0 ? clamp(listBandPx / W, 0.06, 0.44) : 0.26;
      return { polar: 0.52, padL: 0.05, padR, padT: clamp(BAR_PX / H, 0.06, 0.18), padB: 0.06 };
    }
    if (H > W * 1.15) {                                                              /* portrait */
      const polar = 0.46, padL = 0.02, padR = 0.02;
      const f = frameFit(polar, padL + padR, null);             /* la largeur commande */
      const free = clamp(1 - f.useY, 0, 0.74);
      /* la liste est ancree en bas et occupe TOUTE la bande basse : la carte monte sous le titre */
      const padT = clamp(BAR_PX / H, 0.055, free * 0.42);
      return { polar, padL, padR, padT, padB: Math.max(0.04, free - padT), fit: f };
    }
    return { polar: 0.42, padL: 0.05, padR: 0.30, padT: 0.13, padB: 0.11 };          /* paysage    */
  }
  /* les marges de la vue « France entiere » dependent de l endroit ou vit la scene */
  const idlePads = () => (place === 'full' ? fullPads() : PAGE);
  const IDLE = { get polar() { return idlePads().polar; } };
  /* distance ET recadrage : la SILHOUETTE — pas le centre du monde — est posee au centre de la
     bande libre, laterale comme verticale. */
  function frameOf(p) {
    const f = p.fit || frameFit(p.polar, p.padL + p.padR, p.padT + p.padB);
    return {
      dist: f.dist,
      wx: clamp(0.5 - f.ctrX / 2 + (p.padL - p.padR) / 2, 0.10, 0.90),
      wy: clamp(0.5 + (p.padT - p.padB) / 2 + f.ctrY / 2, 0.10, 0.90),
      padT: p.padT, padB: p.padB, padL: p.padL, padR: p.padR
    };
  }
  let frameMemo = { key: '' };
  function frames() {
    const key = W + 'x' + H + '|' + place + '|' + listBandPx + '|' + itemsRaw.length;
    if (frameMemo.key !== key) frameMemo = { key, idle: frameOf(idlePads()) };
    return frameMemo;
  }
  /* la largeur reelle du panneau flottant du plein ecran (desktop) : elle depend de la police et
     de la taille d ecran. Dans la page, la liste ne recouvre rien : la coquille renvoie 0.        */
  function readListBand() {
    if (!ui || typeof ui.listBand !== 'function' || mobile) return;
    const v = ui.listBand();
    if (Math.abs(v - listBandPx) > 3) { listBandPx = v; frameMemo.key = ''; }
  }
  /* la coquille ancre son interface EXACTEMENT sur les bandes reservees par le cadrage */
  let bandT = -1, bandB = -1;
  function pushBands() {
    if (!ui || typeof ui.setSafeArea !== 'function' || H < 2) return;
    const f = frames().idle;
    const t = Math.round(f.padT * H), b = Math.round(f.padB * H);
    if (t === bandT && b === bandB) return;
    bandT = t; bandB = b;
    ui.setSafeArea({ top: t, bottom: b });
  }
  const fitIdle = () => frames().idle.dist;
  const idleWy = () => frames().idle.wy;
  const idleWx = () => frames().idle.wx;

  function placeCamera() {
    const d = cur.dist * cur.k;
    /* brume de profondeur relative a la distance : la meme legerete a tous les zooms */
    scene.fog.near = d * mix(NUIT.fogNear, JOUR.fogNear);
    scene.fog.far = d * mix(NUIT.fogFar, JOUR.fogFar);
    /* liseré du contour : ~4 px a l ecran quel que soit le zoom (jamais un cordon d or) */
    const px = clamp(H / 210, 2.6, 4.4);          /* un liseré plus fin sur une petite vignette */
    UO.w.value = clamp(px * 2 * Math.tan(FOV * Math.PI / 360) * d / (H * RIBBON_W), 0.18, 1.9);
    _u.set(Math.sin(cur.polar) * Math.sin(cur.azim), Math.cos(cur.polar), Math.sin(cur.polar) * Math.cos(cur.azim));
    camera.position.set(cur.tx + _u.x * d, _u.y * d, cur.tz + _u.z * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(cur.tx, 0, cur.tz);
    camera.updateMatrixWorld();
    /* recadrage : la ville visee ne se pose pas forcement au centre (place laissee a la liste) */
    if (Math.abs(cur.wx - 0.5) > 1e-4 || Math.abs(cur.wy - 0.5) > 1e-4) {
      const hh = 2 * Math.tan(FOV * Math.PI / 360) * d, hw = hh * (W / H);
      _r.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(_r, (0.5 - cur.wx) * hw);
      camera.position.addScaledVector(_up, (cur.wy - 0.5) * hh);
      camera.updateMatrixWorld();
    }
  }

  /* =====================================================================
     7. ETAT INTERNE
     ===================================================================== */
  /* DEUX AXES INDEPENDANTS, et non un seul etat a quatre valeurs :
     · `place` = OU vit la scene    — 'page' (dans la section) | 'full' (plein ecran) ;
     · `state` = CE QUE regarde la camera — 'idle' (France entiere) | 'focus' (une ville).
     L experience (liste + focus cinematique) est donc la MEME dans les deux endroits ; passer en
     grand ne fait que changer le cadre, jamais ce que l on peut faire.                            */
  let place = 'page';
  let state = 'idle';
  let stageEl = null;
  let running = false, destroyed = false, started = false, ready = false;
  let raf = 0, needs = true, lastNow = 0, idleUntil = 0, pulseAcc = 0;
  let intro = -1, introPlan = null;
  let selId = null, selIdx = -1, hotId = null, hotIdx = -1, hiTarget = 0;
  let ptrSX = 0, ptrSY = 0;
  let ambK = mode === 'jour' ? 1 : 0, ambFrom = ambK, ambTo = ambK, ambT = 1;
  let revealShadow = 1, pulse = 0, io = null, promote = 0;
  let drag = null, pinchD = 0, elan = 0;
  const ptrs = new Map();
  /* sensibilite du glisse — nommee parce que l inertie doit prolonger le geste a la MEME
     vitesse : deux valeurs ecrites en dur a deux endroits auraient fini par diverger. */
  const SENS_AZ = 0.0026, SENS_PO = 0.0021;

  const mix = (a, b) => lerp(a, b, ambK);
  const invalidate = tail => { needs = true; if (tail) idleUntil = Math.max(idleUntil, performance.now() + tail); kick(); };
  const kick = () => { if (!raf && running && !destroyed && !reduced && !document.hidden) { lastNow = 0; raf = requestAnimationFrame(frame); } };

  if (reduced) PU.uPulse.value = 0;

  /* =====================================================================
     8. AMBIANCE
     ===================================================================== */
  const CC = {};
  const mkC = (k) => ({ a: new THREE.Color(NUIT[k]), b: new THREE.Color(JOUR[k]), o: new THREE.Color() });
  for (const k of ['land', 'skirt', 'gold', 'goldHot', 'halo', 'fog', 'hemiSky', 'hemiGround', 'keyCol', 'fillCol',
    'rimCol', 'contact', 'hiCol', 'pinHead', 'pinEmis', 'pinBase', 'pinHalo', 'pinContact', 'pinLedge', 'pinPool']) CC[k] = mkC(k);
  const col = k => CC[k].o.lerpColors(CC[k].a, CC[k].b, ambK);

  function syncShadow() {
    shadowMat.opacity = mix(NUIT.shadowA, JOUR.shadowA) * revealShadow * (place === 'page' ? 0.92 : 1);
  }
  function applyAmb() {
    renderer.toneMappingExposure = mix(NUIT.exposure, JOUR.exposure);
    surfMat.color.copy(col('land'));
    surfMat.envMapIntensity = mix(NUIT.env, JOUR.env);
    skirtMat.color.copy(col('skirt'));
    skirtMat.envMapIntensity = mix(NUIT.env, JOUR.env) * 3.2;
    scene.fog.color.copy(col('fog'));
    U.voidCol.value.copy(col('fog'));
    U.wipeCol.value.copy(col('goldHot'));
    U.hiCol.value.copy(col('hiCol'));
    hemi.color.copy(col('hemiSky')); hemi.groundColor.copy(col('hemiGround'));
    hemi.intensity = mix(NUIT.hemi, JOUR.hemi);
    key.color.copy(col('keyCol')); key.intensity = mix(NUIT.key, JOUR.key);
    fill.color.copy(col('fillCol')); fill.intensity = mix(NUIT.fill, JOUR.fill);
    rim.color.copy(col('rimCol')); rim.intensity = mix(NUIT.rim, JOUR.rim);
    outlineMat.color.copy(col('goldHot')); outlineMat.opacity = mix(NUIT.outlineA, JOUR.outlineA);
    glowMat.color.copy(col('gold')); glowMat.opacity = mix(NUIT.glowA, JOUR.glowA);
    borderMat.color.copy(col('gold')); borderMat.opacity = mix(NUIT.borderA, JOUR.borderA);
    netMat.color.copy(col('gold'));
    haloMat.color.copy(col('halo'));
    shadowMat.color.copy(col('contact'));
    focusRingMat.color.copy(col('pinPool'));
    /* L OR RESTE DE L OR EN AMBIANCE JOUR : un metal pur sans environnement chaud vire au gris.
       On interpole donc la couleur, l emissive ET le liseré des pins, et on remonte l environnement. */
    contactMat.color.copy(col('pinContact')); contactMat.opacity = mix(NUIT.pinContactA, JOUR.pinContactA);
    baseMat.color.copy(col('pinBase')); baseMat.opacity = mix(NUIT.pinBaseA, JOUR.pinBaseA);
    haloPinMat.color.copy(col('pinHalo')); haloPinMat.opacity = mix(NUIT.pinHaloA, JOUR.pinHaloA);
    stemMat.color.copy(col('pinHead')); stemMat.metalness = mix(0.82, 0.74); stemMat.roughness = mix(0.34, 0.30);
    headMat.color.copy(col('pinHead'));
    headMat.emissive.copy(col('pinEmis'));
    headMat.emissiveIntensity = mix(NUIT.pinEmisI, JOUR.pinEmisI);
    headMat.envMapIntensity = mix(1.5, 2.15);
    headMat.metalness = mix(0.94, 0.80);      /* jour : un peu de diffus, sinon le metal vire au brun */
    PU.uLedge.value.copy(col('pinLedge')).multiplyScalar(mix(NUIT.pinLedgeI, JOUR.pinLedgeI));
    selHaloMat.color.copy(col('pinPool'));
    syncShadow();
  }

  /* =====================================================================
     9. CHOREGRAPHIE D INTRO
     1. le contour se dessine · 2. la surface apparait en profondeur ·
     3. les pins s allument du nord-ouest au sud-est · 4. le reseau passe · 5. tout se pose
     ===================================================================== */
  function planIntro(kind) {
    return kind === 'open'
      ? { draw: [0.00, 0.95], ahead: 0.30, wipe: [0.10, 1.05], deep: 0.52, y0: 0.66, pin0: 0.50, bord: [0.85, 0.80], net: 1.25, netOut: 2.25, total: 3.20 }
      : { draw: [0.00, 1.15], ahead: 0.00, wipe: [0.22, 1.15], deep: 0.00, y0: 0.34, pin0: 0.95, bord: [0.90, 0.85], net: -1, netOut: -1, total: 2.60 };
  }
  function runIntro(kind) {
    introPlan = planIntro(kind);
    intro = 0;
    UO.ahead.value = introPlan.ahead; UO.head.value = 0; UO.spark.value = 1; UO.fade.value = 1;
    UB.head.value = 0; UB.ahead.value = 0; UB.fade.value = 0; UB.spark.value = 0.8;
    UN.head.value = 0; UN.ahead.value = 0; UN.fade.value = 1; UN.spark.value = 0.55;
    U.wipe.value = WIPE0; U.wipeAmt.value = 1; U.wipeDeep.value = introPlan.deep;
    world.scale.y = introPlan.y0;
    haloMat.opacity = mix(NUIT.haloA, JOUR.haloA) * introPlan.deep;
    revealShadow = introPlan.deep; syncShadow();
    PU.uGrow.value = 0;
    if (netMesh) { netMesh.visible = false; netMat.opacity = 0; }
    invalidate();
  }
  function finishIntro() {
    intro = -1; introPlan = null;
    UO.head.value = 1; UO.ahead.value = 1; UO.spark.value = 0; UO.fade.value = 1;
    UB.head.value = 1; UB.ahead.value = 1; UB.spark.value = 0; UB.fade.value = 1;
    U.wipe.value = -9; U.wipeAmt.value = 0; U.wipeDeep.value = 0;
    world.scale.y = 1;
    PU.uGrow.value = 9;
    if (netMesh) { netMesh.visible = false; netMat.opacity = 0; }
    revealShadow = 1; syncShadow();
    haloMat.opacity = mix(NUIT.haloA, JOUR.haloA);
  }
  function stepIntro(t) {
    const P = introPlan;
    if (!P) return false;
    const d = clamp((t - P.draw[0]) / P.draw[1], 0, 1);
    UO.head.value = easeIO(d) * 1.03;
    UO.spark.value = d < 1 ? 1 : 0;
    if (d >= 1) UO.ahead.value = 1;

    const w = clamp((t - P.wipe[0]) / P.wipe[1], 0, 1);
    U.wipe.value = lerp(WIPE0, WIPE1, easeIO(w));
    U.wipeAmt.value = w >= 1 ? 0 : 1;
    world.scale.y = lerp(P.y0, 1, ease(w));
    revealShadow = lerp(P.deep, 1, smooth(w)); syncShadow();
    haloMat.opacity = mix(NUIT.haloA, JOUR.haloA) * lerp(P.deep, 1, smooth(w));

    PU.uGrow.value = Math.max(0, t - P.pin0);

    const b = clamp((t - P.bord[0]) / P.bord[1], 0, 1);
    UB.head.value = easeIO(b) * 1.03; UB.fade.value = smooth(b); UB.spark.value = b < 1 ? 0.8 : 0;
    if (b >= 1) UB.ahead.value = 1;

    if (netMesh && P.net > 0) {
      const n = clamp((t - P.net) / 0.9, 0, 1);
      const o = clamp((t - P.netOut) / 0.7, 0, 1);
      netMesh.visible = n > 0 && o < 1;
      UN.head.value = easeIO(n) * 1.03;
      UN.spark.value = n < 1 ? 0.55 : 0;
      netMat.opacity = 0.3 * smooth(n) * (1 - smooth(o));
    }
    if (t > P.total) { finishIntro(); return false; }
    return true;
  }

  /* =====================================================================
     10. PLACE (page / plein ecran) · FOCUS · RETOUR A LA FRANCE ENTIERE
     ===================================================================== */
  /* CHANGER DE PLACE NE CHANGE QUE LE CADRE. La liste, la ville active, le pin leve, l etiquette :
     tout survit au passage en grand et au retour dans la page. `setStage` a deja raccorde la taille
     apparente (meme image, au meme endroit de l ecran) ; il ne reste qu a viser les nouvelles
     marges — celles du panneau flottant en grand, celles de la colonne dans la page.              */
  function setPlace(p) {
    const next = p === 'full' ? 'full' : 'page';
    if (next === place || destroyed) return;
    place = next;
    frameMemo.key = '';
    hotId = null; hotIdx = -1; PU.uHov.value = -1; dst.hovAmt = 0;
    readListBand();
    pushBands();
    syncShadow();
    aim(reduced ? 0 : 0.8);
  }
  /* VISER — recalcule le point d arrivee de la camera pour l etat courant (France entiere ou ville
     active) dans les marges courantes. Un seul chemin de code : le focus dans la page et le focus
     en plein ecran sont litteralement le meme mouvement, a marges pres.                           */
  function aim(sp) {
    twClear();
    if (state === 'focus' && selIdx >= 0) { aimCity(itemsRaw[selIdx], sp, 1); return; }
    const target = fitIdle();
    if (!sp) {
      Object.assign(cur, { polar: IDLE.polar, azim: 0, k: 1, wx: idleWx(), wy: idleWy(), tx: CX, tz: CZ, dist: target });
      Object.assign(dst, cur);
      renderOnce();
      return;
    }
    const d = 1.05 * sp;
    tw('polar', IDLE.polar, d, 0, CINE);
    tw('azim', 0, d, 0, CINE);
    tw('dist', target, d, 0, CINE);
    tw('k', 1, d, 0, CINE);
    tw('wx', idleWx(), d * 0.95, 0, CINE);
    tw('wy', idleWy(), d * 0.95, 0, CINE);
    tw('tx', CX, d, 0, CINE);
    tw('tz', CZ, d, 0, CINE);
    invalidate(d * 1000 + 900);
  }

  function clearSelection() {
    state = 'idle';
    selId = null; selIdx = -1; hiTarget = 0;
    cur.selAmt = dst.selAmt = 0; cur.prevAmt = dst.prevAmt = 0;
    cur.focusAmt = dst.focusAmt = 0;
    PU.uSel.value = -1; PU.uPrev.value = -1; PU.uSelAmt.value = 0; PU.uPrevAmt.value = 0; PU.uFocus.value = 0;
    focusRing.visible = false; focusRingMat.opacity = 0;
    selHalo.visible = false; selHaloMat.opacity = 0;
    if (ui) { ui.setActive(null); ui.setActiveLabel(null); }
  }

  /* CADRAGE DU FOCUS — la ville visee vient dans la bande libre, MAIS le territoire doit continuer
     a couvrir l ecran. Une camera qui suit betement une commune de bord (Lille, Brest, Perpignan,
     Bastia) laisse un demi-ecran de vide noir a cote de la carte : le mouvement est alors juste,
     et l image est fausse. On calcule donc la boite ECRAN de la silhouette pour la camera de focus,
     puis on choisit l ancrage (wx, wy) le plus proche de la position voulue QUI GARDE la couverture.
     Si les deux exigences s excluent (commune de bord, zoom serre), c est la ville qui gagne : elle
     ne peut jamais sortir de la bande libre. Le mouvement reste continu — seul son point d arrivee
     change. */
  /* JEU LAISSE A LA MER, DANS LA PAGE UNIQUEMENT.
     Exiger que le territoire couvre le cadre JUSQU AU BORD colle les communes de la peripherie
     (Colmar, Nice, Brest) exactement la ou elles se trouvaient deja : la camera translate, et
     l image ne bouge presque pas — le clic parait sans effet. En plein ecran, le panneau de la
     liste recouvrait ce bord et donnait le jeu necessaire ; dans la page il n y a plus de panneau,
     c est le FONDU DES BORDS (.c3d__map::after) qui le donne. On accepte donc jusqu a un dixieme
     de cadre de mer d un cote : la ville vient reellement se poser dans la zone de lecture, et le
     bord de la carte se dissout au lieu de laisser une arete vide.                               */
  function focusAnchor(it, polar, azim, k, wantX, wantY) {
    /* en mobile la carte n a qu une bande de 200 px : il faut lui laisser plus de jeu encore,
       sans quoi une commune de la peripherie ne se deplace pratiquement pas a l ecran. */
    const SLACK = place === 'full' ? 0 : (mobile ? 0.20 : 0.10);
    const p = idlePads();
    const cxMin = 0.09, cxMax = Math.max(0.13, 1 - p.padR - 0.07);
    const cyMin = p.padT + 0.08, cyMax = 1 - p.padB - 0.09;
    let wx = clamp(wantX, cxMin, cxMax), wy = clamp(wantY, cyMin, cyMax);
    const d = Math.max(0.2, dst.dist * k);
    const t0 = Math.tan(FOV * Math.PI / 360), ar = W / H;
    _u.set(Math.sin(polar) * Math.sin(azim), Math.cos(polar), Math.sin(polar) * Math.cos(azim));
    _r.set(Math.cos(azim), 0, -Math.sin(azim));
    _up.crossVectors(_u, _r).normalize();
    let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
    for (let i = 0; i < HULL.length; i++) {
      const q = HULL[i];
      for (let s = 0; s < 2; s++) {
        _p.set(q[0] - it.wx, s ? HULL_TOP : HULL_BOT, -q[1] + it.wy);
        const den = Math.max(1e-4, d - _p.dot(_u)) * t0;
        const nx = _p.dot(_r) / (den * ar), ny = _p.dot(_up) / den;
        if (nx < xa) xa = nx; if (nx > xb) xb = nx;
        if (ny < ya) ya = ny; if (ny > yb) yb = ny;
      }
    }
    /* position ecran d un point : sx = wx + ndcX / 2, sy = wy - ndcY / 2 (voir placeCamera).
       [lo, hi] = les ancrages qui COUVRENT la bande a remplir ; [a, b] = ceux qui gardent la ville
       DANS la bande libre. On prend la position voulue, ramenee d abord dans la couverture, puis
       dans la bande libre : la ville prime toujours (elle ne peut pas sortir de l ecran), mais
       elle se pose au bord le plus proche de la couverture. Lille se retrouve ainsi en haut du
       cadre avec toute la France en dessous, au lieu d un demi-ecran de vide noir.
       Si la silhouette est trop petite pour couvrir (zoom sobre, ecran large), il n existe aucun
       ancrage valable : l intervalle s inverse, et on la CENTRE dans la bande — c est exactement
       le milieu de [lo, hi].                                                                    */
    const fit = (lo, hi, a, b, v) => {
      if (lo > hi) { const m = (lo + hi) / 2; lo = m; hi = m; }
      return clamp(clamp(v, lo, hi), a, b);
    };
    /* en plein ecran la liste RECOUVRE un bord (droit en desktop, bas en mobile) : la couverture
       doit aller jusque sous elle. Dans la page, la scene s arrete au bord de sa colonne.        */
    const covX = 1 - (place === 'full' && !mobile ? p.padR : 0) - SLACK;
    const covY = 1 - (place === 'full' && mobile ? p.padB : 0) - SLACK;
    wx = fit(covX - xb / 2, SLACK - xa / 2, cxMin, cxMax, wx);
    wy = fit(covY + ya / 2, yb / 2 + SLACK, cyMin, cyMax, wy);
    return { wx, wy };
  }

  /* LA CORSE NE DOIT PAS ETRE COUPEE EN DEUX PAR LE PANNEAU DE LA LISTE.
     Sur certains focus (Bordeaux, Toulouse), sa cote ouest depassait de quelques dizaines de
     pixels a gauche du panneau pendant que le reste de l ile disparaissait dessous : un bout d ile
     tronque, lisible mais sale a ce niveau de prix.
     La verification se fait APRES le mouvement, sur la camera REELLE (huit projections) et non sur
     la projection analytique de `focusAnchor`, dont la distance est celle d avant l interpolation.
     Si l ile chevauche le bord, on la sort du minimum necessaire — visible de preference, cachee
     sinon — par un dernier glissement de 0,55 s sur la meme courbe : le mouvement reste continu,
     il n y a ni saut ni recadrage brutal. Et si aucune des deux positions n est atteignable sans
     sortir la ville de sa bande libre, on ne bouge pas : la ville prime toujours.                 */
  let corseGuard = false;              /* vrai tant que le controle de la Corse reste a faire */
  function checkCorse() {
    corseGuard = false;
    if (mobile || !CORSE || place !== 'full' || state !== 'focus' || W < 2) return;
    const p = fullPads();
    const edge = (1 - p.padR) * W;
    let L = 1e9, R = -1e9;
    for (const q of CORSE) for (const h of [HULL_BOT, HULL_TOP]) {
      _pv.set(q[0], h * world.scale.y, -q[1]).project(camera);
      const sx = (_pv.x * 0.5 + 0.5) * W;
      if (sx < L) L = sx; if (sx > R) R = sx;
    }
    const large = R - L, dehors = edge - L;      /* largeur de l ile · part visible a gauche du panneau */
    if (large < 4 || dehors <= 3 || dehors >= large - 3) return;   /* entierement cachee ou entierement visible */
    /* moins de la moitie depasse : on la cache tout a fait ; plus de la moitie : on la degage. */
    const marge = 6;
    const dHide = (edge + marge - L) / W, dShow = (edge - marge - R) / W;
    const cxMin = 0.09, cxMax = Math.max(0.13, 1 - p.padR - 0.07);
    const cand = dehors < large * 0.5 ? [dHide, dShow] : [dShow, dHide];
    for (const dd of cand) {
      const to = cur.wx + dd;
      if (to < cxMin || to > cxMax) continue;
      if (Math.abs(to - cur.wx) < 0.004) return;
      if (reduced) { cur.wx = to; dst.wx = to; renderOnce(); return; }
      tw('wx', to, 0.55, 0, CINE);
      invalidate(900);
      return;
    }
  }

  /* LA FONCTIONNALITE CENTRALE — le clic sur une ville.
     Un seul geste continu, jamais une teleportation :
       · la carte s incline (polar) et pivote legerement (azim), ce qui donne la profondeur ;
       · la camera se TRANSLATE vers la commune (tx / tz) — le rapprochement (k) reste sobre ;
       · le pin monte, s eclaire, recoit son halo et son cercle au sol ;
       · l ancien pin redescend PENDANT que le nouveau monte (uPrevAmt / uSelAmt) ;
       · les autres pins s estompent legerement (uFocus).
     Duree : ~1,40 s, courbe cubic-bezier(.22,.61,.36,1) de la charte, deceleration longue.        */
  function doFocus(id, fromUI) {
    const i = itemsRaw.findIndex(o => o.id === id);
    if (i < 0) return;
    const it = itemsRaw[i];
    const wasIdx = selIdx, wasAmt = cur.selAmt;
    selId = id; selIdx = i;
    state = 'focus';

    focusRing.position.set(it.wx, it.h + 0.0018, -it.wy);
    focusRing.visible = true;
    U.hiIdx.value = regionIndexAt(it.wx, it.wy);
    hiTarget = 0.15;

    /* passage de relais : l ancien pin redescend depuis SA hauteur courante */
    PU.uSel.value = i;
    if (wasIdx >= 0 && wasIdx !== i) { PU.uPrev.value = wasIdx; cur.prevAmt = wasAmt; }
    else if (wasIdx !== i) { PU.uPrev.value = -1; cur.prevAmt = 0; }
    cur.selAmt = wasIdx === i ? cur.selAmt : 0;

    twClear();
    aimCity(it, fromUI ? 0.94 : 1, 0);
    if (ui) ui.setActive(id);
  }
  /* LE MOUVEMENT DE FOCUS — identique dans la page et en plein ecran.
     `pose` = 0 : on arrive sur la ville (le pin monte) ; `pose` = 1 : on la garde et on ne fait que
     recadrer (changement de place, rotation d ecran) — le pin reste leve.                        */
  function aimCity(it, sp, pose) {
    const az = clamp(it.wx > 0 ? -0.13 : 0.13, LIM.azim[0], LIM.azim[1]);
    const A = focusAnchor(it, FOCUS.polar, az, FOCUS.k, mobile ? 0.5 : idleWx(), mobile ? 0.38 : 0.50);
    const wantX = A.wx, wantY = A.wy;
    if (reduced || sp <= 0) {
      Object.assign(cur, { polar: FOCUS.polar, azim: az, k: FOCUS.k, wx: wantX, wy: wantY, tx: it.wx, tz: -it.wy, dist: fitIdle(), selAmt: 1, prevAmt: 0, focusAmt: 1 });
      Object.assign(dst, cur);
      U.hiAmt.value = hiTarget;
      PU.uSelAmt.value = 1; PU.uPrevAmt.value = 0; PU.uFocus.value = 1;
      renderOnce();
      checkCorse();                    /* etat final immediat : la correction aussi */
      return;
    }
    tw('polar', FOCUS.polar, 1.25 * sp, 0.00, CINE);                      /* 1. la carte s incline   */
    tw('azim', az, 1.40 * sp, 0.00, CINE);
    tw('dist', fitIdle(), 1.35 * sp, 0.00, CINE);
    tw('tx', it.wx, 1.35 * sp, 0.05 * sp, CINE);                          /* 2. la camera se translate */
    tw('tz', -it.wy, 1.35 * sp, 0.05 * sp, CINE);
    tw('k', FOCUS.k, 1.30 * sp, 0.10 * sp, CINE);                         /* 3. un rapprochement sobre */
    tw('wx', wantX, 1.30 * sp, 0.08 * sp, CINE);
    tw('wy', wantY, 1.30 * sp, 0.08 * sp, CINE);
    if (!pose) {
      tw('selAmt', 1, 0.78, 0.26, ease);                                  /* 4. le pin s eleve        */
      tw('prevAmt', 0, 0.88, 0.00, easeIO); /* l ancien redescend DOUCEMENT pendant que le nouveau monte */
      tw('focusAmt', 1, 0.60, 0.10, smooth);
    }
    corseGuard = true;                                                    /* 5. controle du bord de l ile */
    invalidate(2600);
  }
  function doReset() {
    if (state !== 'focus') return;
    state = 'idle';
    twClear();
    const wasIdx = selIdx, wasAmt = cur.selAmt;
    selId = null; selIdx = -1; hiTarget = 0;
    if (wasIdx >= 0) { PU.uPrev.value = wasIdx; cur.prevAmt = wasAmt; }
    PU.uSel.value = -1; cur.selAmt = 0; dst.selAmt = 0;
    if (ui) { ui.setActive(null); ui.setActiveLabel(null); }
    const target = fitIdle();
    if (reduced) {
      Object.assign(cur, { polar: IDLE.polar, azim: 0, k: 1, wx: idleWx(), wy: idleWy(), tx: CX, tz: CZ, dist: target, prevAmt: 0, focusAmt: 0 });
      Object.assign(dst, cur);
      U.hiAmt.value = 0;
      PU.uSelAmt.value = 0; PU.uPrevAmt.value = 0; PU.uFocus.value = 0;
      focusRing.visible = false; selHalo.visible = false;
      renderOnce();
      return;
    }
    tw('polar', IDLE.polar, 1.05, 0, CINE);
    tw('azim', 0, 1.05, 0, CINE);
    tw('dist', target, 1.05, 0, CINE);
    tw('k', 1, 1.05, 0, CINE);
    tw('wx', idleWx(), 1.00, 0, CINE);
    tw('wy', idleWy(), 1.00, 0, CINE);
    tw('tx', CX, 1.05, 0, CINE);
    tw('tz', CZ, 1.05, 0, CINE);
    tw('prevAmt', 0, 0.80, 0, easeIO);
    tw('focusAmt', 0, 0.50, 0, smooth);
    invalidate(2400);
  }
  /* REGION D UNE COMMUNE — avec repli sur la region la PLUS PROCHE.
     Le centre officiel de certaines communes du littoral tombe legerement en mer par rapport au
     contour SIMPLIFIE du lot geo3d (Cannes : ~170 m au large). `regionAt` renvoyait alors null et
     le focus sur ces communes n allumait aucune region — comportement non uniforme sur les 111.
     On cherche donc, a defaut, le contour dont un sommet passe a moins de RFALL du point.         */
  const RFALL = 0.006;                     /* ~3 km en unites monde : le littoral simplifie, jamais une autre region */
  function regionIndexAt(x, y) {
    const r = G.regionAt(x, y);
    if (r) return G.REGIONS.indexOf(r);
    let best = -1, bd = RFALL * RFALL;
    for (let i = 0; i < G.REGIONS.length; i++) {
      const reg = G.REGIONS[i], b = reg.bbox;
      if (x < b[0] - RFALL || x > b[2] + RFALL || y < b[1] - RFALL || y > b[3] + RFALL) continue;
      for (const poly of reg.polygons) {
        const pts = poly.outer.pts;
        for (let k = 0; k < pts.length; k++) {
          const dx = pts[k][0] - x, dy = pts[k][1] - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  }

  /* =====================================================================
     11. TAILLE, PROJECTION DE L ETIQUETTE ACTIVE
     ===================================================================== */
  function resize() {
    const el = stageEl || host;
    const r = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === W && h === H) return;
    W = w; H = h;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    readListBand();
    if (!tweens.length && !drag && state !== 'focus') {
      const t = fitIdle();
      cur.dist = t; dst.dist = t;
      /* la forme de la colonne a change (rotation du telephone) : la bande libre aussi */
      const y = idleWy(), x = idleWx();
      cur.wy = y; dst.wy = y; cur.wx = x; dst.wx = x;
    }
    pushBands();
    invalidate();
  }

  const _pv = new THREE.Vector3();
  /* Positions ecran des pins : sert au pointage (survol / tap) et a l etiquette de la ville active.
     111 projections coutent ~25 us — moins qu une seule lecture de layout DOM.                     */
  function updateScreen() {
    const liftNow = PU.uSelAmt.value;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      const lift = i === selIdx ? liftNow : (i === hotIdx ? PU.uHovAmt.value * 0.42 : 0);
      _pv.set(p.it.wx, (p.it.h + STEM * PS * (1 + lift * LIFT_K)) * world.scale.y, -p.it.wy);
      p.dcam = camera.position.distanceTo(_pv);
      _pv.project(camera);
      p.onScreen = _pv.z < 1 && _pv.x > -1.15 && _pv.x < 1.15 && _pv.y > -1.15 && _pv.y < 1.15 && PU.uGrow.value > 0.35;
      p.sx = (_pv.x * 0.5 + 0.5) * W;
      p.sy = (-_pv.y * 0.5 + 0.5) * H;
    }
    if (!ui) return;
    if (selIdx >= 0 && pins[selIdx]) {
      const p = pins[selIdx];
      ui.setActiveLabel(uiCities[selIdx], { x: p.sx, y: p.sy, on: p.onScreen, amt: PU.uSelAmt.value });
    }
  }

  /* =====================================================================
     12. EXPLORATION (bornee : jamais un SIG)
     ===================================================================== */
  const localPt = ev => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  function pick(x, y) {
    /* a 111 pins la zone de capture doit rester serree, sinon deux communes voisines se disputent
       le pointeur (Cannes / Antibes, Roubaix / Lille). */
    let best = null, bd = (mobile ? 22 : 15) * (mobile ? 22 : 15);
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (!p.onScreen) continue;
      const d = (p.sx - x) * (p.sx - x) + (p.sy - y) * (p.sy - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function setHot(i) {
    const id = i == null ? null : pins[i].it.id;
    if (id === hotId) return;
    hotId = id; hotIdx = i == null ? -1 : i;
    canvas.classList.toggle('is-pin', id != null);
    /* on ne coupe pas l index a la sortie : le pin redescend en douceur (hovAmt -> 0) et
       l index n est repris qu au survol suivant. */
    if (hotIdx >= 0) PU.uHov.value = hotIdx;
    dst.hovAmt = id != null ? 1 : 0;
    if (ui) ui.setHover(id);
    invalidate(600);
  }
  /* GLISSE LIBRE APRES LE RELACHEMENT.
     La vitesse est relevee sur les derniers deplacements, convertie en vitesse ANGULAIRE avec
     les memes constantes que le glisse, puis eteinte exponentiellement. Elle s arrete d elle-
     meme des qu elle ne fait plus bouger la camera — contre une borne de LIM, par exemple. */
  function arreterElan() { if (elan) { cancelAnimationFrame(elan); elan = 0; } }
  function lancerElan(v) {
    arreterElan();
    if (reduced || !v) return;
    let ax = -v.vx * SENS_AZ, ay = -v.vy * SENS_PO;      /* radians par milliseconde */
    if (Math.hypot(ax, ay) < 4e-5) return;               /* un geste lent ne lance rien */
    /* on plafonne : un coup de souris tres rapide ne doit pas traverser toute la course */
    const vmax = 9e-4, sp = Math.hypot(ax, ay);
    if (sp > vmax) { ax *= vmax / sp; ay *= vmax / sp; }
    let last = performance.now();
    const pas = () => {
      if (destroyed || drag) { elan = 0; return; }
      const now = performance.now();
      const dt = Math.min(48, now - last); last = now;
      const az = clamp(dst.azim + ax * dt, LIM.azim[0], LIM.azim[1]);
      const po = clamp(dst.polar + ay * dt, LIM.polar[0], LIM.polar[1]);
      const bouge = az !== dst.azim || po !== dst.polar;
      dst.azim = az; dst.polar = po;
      const k = Math.exp(-dt / 170);                     /* la glisse s eteint en ~0,6 s */
      ax *= k; ay *= k;
      invalidate();
      if (bouge && Math.hypot(ax, ay) > 1.2e-5) elan = requestAnimationFrame(pas);
      else { elan = 0; invalidate(400); }
    };
    elan = requestAnimationFrame(pas);
  }

  function onDown(ev) {
    if (destroyed) return;
    arreterElan();                                       /* la main reprend la carte en vol */
    ptrs.set(ev.pointerId, localPt(ev));
    if (ptrs.size === 2) {
      const v = Array.from(ptrs.values());
      pinchD = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
      drag = null;
      return;
    }
    const p = localPt(ev);
    drag = { id: ev.pointerId, x0: p.x, y0: p.y, polar: dst.polar, azim: dst.azim, moved: false, t: performance.now() };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* deja capture */ }
  }
  function onMove(ev) {
    if (destroyed) return;
    const p = localPt(ev);
    if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, p);
    if (ptrs.size === 2) {
      const v = Array.from(ptrs.values());
      const d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
      if (pinchD > 4 && d > 4) { dropTween('k'); dst.k = clamp(dst.k * (pinchD / d), LIM.k[0], LIM.k[1]); invalidate(); }
      pinchD = d;
      return;
    }
    if (drag && ev.pointerId === drag.id) {
      const dxp = p.x - drag.x0, dyp = p.y - drag.y0;
      if (!drag.moved && Math.hypot(dxp, dyp) > 5) { drag.moved = true; canvas.classList.add('is-grab'); twClear(); }
      if (drag.moved) {
        dst.azim = clamp(drag.azim - dxp * SENS_AZ, LIM.azim[0], LIM.azim[1]);
        dst.polar = clamp(drag.polar - dyp * SENS_PO, LIM.polar[0], LIM.polar[1]);
        /* vitesse instantanee, lissee : une seule image suffirait a donner un chiffre
           aberrant si le systeme a saute une frame. */
        const now = performance.now();
        const dt = Math.max(8, now - (drag.tLast || drag.t));
        const vx = (p.x - (drag.xLast == null ? drag.x0 : drag.xLast)) / dt;
        const vy = (p.y - (drag.yLast == null ? drag.y0 : drag.yLast)) / dt;
        drag.vx = drag.vx == null ? vx : drag.vx * 0.4 + vx * 0.6;
        drag.vy = drag.vy == null ? vy : drag.vy * 0.4 + vy * 0.6;
        drag.xLast = p.x; drag.yLast = p.y; drag.tLast = now;
        invalidate();
      }
      return;
    }
    if (!mobile) setHot(pick(p.x, p.y));
  }
  function onUp(ev) {
    ptrs.delete(ev.pointerId);
    if (ptrs.size < 2) pinchD = 0;
    if (!drag || ev.pointerId !== drag.id) return;
    const p = localPt(ev);
    const quick = !drag.moved && performance.now() - drag.t < 500;
    /* on releve la vitesse AVANT de perdre le glisse, et seulement si le doigt bougeait
       encore : un doigt immobile depuis 120 ms a repose la carte, il ne la lance pas. */
    const elanV = drag.moved && drag.vx != null && performance.now() - (drag.tLast || 0) < 120
      ? { vx: drag.vx, vy: drag.vy } : null;
    drag = null;
    canvas.classList.remove('is-grab');
    if (elanV) lancerElan(elanV);
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* deja relache */ }
    if (!quick) { invalidate(400); return; }
    const i = pick(p.x, p.y);
    if (i != null) { if (mobile) setHot(null); doFocus(pins[i].it.id, false); }
  }
  function onLeave() { if (!drag) setHot(null); }
  /* LA MOLETTE NE ZOOME QU EN PLEIN ECRAN. Dans la page, `preventDefault()` sur `wheel` volerait le
     DEFILEMENT DE LA PAGE des que le curseur passe sur la carte : la section deviendrait un piege.
     On laisse donc l evenement filer, sans jamais l annuler.                                      */
  function onWheel(ev) {
    if (place !== 'full' || destroyed) return;
    ev.preventDefault();
    dropTween('k');
    dst.k = clamp(dst.k * (ev.deltaY > 0 ? 1.09 : 0.92), LIM.k[0], LIM.k[1]);
    invalidate();
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /* =====================================================================
     13. BOUCLE
     ===================================================================== */
  function renderOnce() { placeCamera(); updateScreen(); renderer.render(scene, camera); needs = false; }

  /* Une image : tout l etat avance de `dt` secondes. Renvoie true tant que quelque chose bouge. */
  const SMOOTH_KEYS = ['polar', 'azim', 'k', 'dist', 'tx', 'tz', 'wx', 'wy', 'hovAmt'];
  function tick(dt) {
    let busy = false;

    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i];
      t.t += dt;
      const u = (t.t - t.w) / t.d;
      if (u <= 0) { busy = true; continue; }
      cur[t.k] = lerp(t.from, t.to, t.f(u));
      if (u >= 1) { cur[t.k] = t.to; tweens.splice(i, 1); } else busy = true;
    }
    const kf = 1 - Math.exp(-dt * 7.5);
    for (const f of SMOOTH_KEYS) {
      if (tweens.some(t => t.k === f)) continue;
      const d = dst[f] - cur[f];
      if (Math.abs(d) > 1e-5) { cur[f] += d * kf; busy = true; } else cur[f] = dst[f];
    }
    if (ambT < 1) { ambT = Math.min(1, ambT + dt / 0.8); ambK = lerp(ambFrom, ambTo, easeIO(ambT)); applyAmb(); busy = true; }
    if (intro >= 0) { intro += dt; if (stepIntro(intro)) busy = true; }

    /* le mouvement de focus est pose : on verifie une seule fois le bord de la Corse */
    if (corseGuard && !tweens.some(t => t.k === 'wx' || t.k === 'k' || t.k === 'dist')) { checkCorse(); busy = true; }

    const hd = hiTarget - U.hiAmt.value;
    if (Math.abs(hd) > 0.002) { U.hiAmt.value += hd * (1 - Math.exp(-dt * 6)); busy = true; }
    else U.hiAmt.value = hiTarget;

    /* les pins : quatre scalaires poussés au GPU, aucun tampon reconstruit */
    pulse += dt;
    /* RENDU A LA DEMANDE PRESERVE — la pulsation des pins n entretient la boucle QU EN PLEIN ECRAN.
       Dans la page, des que le mouvement est pose, plus une seule image n est demandee : la section
       au repos coute zero frame, exactement comme l ancien etat ferme.                            */
    const live = place === 'full' && idleMode === 'pulse' && !reduced && pins.length > 0;
    PU.uTime.value = pulse;
    PU.uSelAmt.value = cur.selAmt;
    PU.uPrevAmt.value = cur.prevAmt;
    PU.uHovAmt.value = cur.hovAmt;
    PU.uFocus.value = cur.focusAmt;

    /* halo et cercle au sol du pin actif */
    if (selIdx >= 0) {
      const it = itemsRaw[selIdx], a = cur.selAmt;
      const ph = live ? 0.5 + 0.5 * Math.sin(pulse * 1.45) : 0.5;
      selHalo.visible = a > 0.01;
      selHalo.position.set(it.wx, it.h + STEM * PS * (1 + a * LIFT_K), -it.wy);
      selHalo.scale.setScalar((0.020 + 0.024 * a * (1 + 0.10 * ph)) * PS);
      selHaloMat.opacity = clamp(0.62 * a * (0.82 + 0.18 * ph), 0, 0.72);
      focusRing.visible = a > 0.01;
      /* opacite MAXIMALE 0,18 (contrat) : une lueur, jamais une pastille */
      focusRingMat.opacity = clamp(mix(NUIT.pinPoolA, JOUR.pinPoolA) * (0.80 + 0.20 * ph) * a, 0, 0.18);
      focusRing.scale.setScalar(0.215 * PS * (0.72 + 0.28 * a) * (1 + 0.035 * ph));
    } else if (cur.prevAmt > 0.01) {
      selHaloMat.opacity *= 0.86;
      focusRingMat.opacity *= 0.86;
    } else if (selHalo.visible || focusRing.visible) {
      selHalo.visible = false; focusRing.visible = false;
      selHaloMat.opacity = 0; focusRingMat.opacity = 0;
    }

    placeCamera();
    updateScreen();

    if (busy) needs = true;
    else if (live) { pulseAcc += dt; if (pulseAcc >= 0.031) { pulseAcc = 0; needs = true; } }
    return busy;
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    /* La choregraphie suit l HORLOGE MURALE : sur une machine lente le film garde sa duree
       (il perd des images, il ne passe pas au ralenti). Le lissage exponentiel est stable a tout dt. */
    const dt = clamp(lastNow ? (now - lastNow) / 1000 : 0.016, 0, 0.34);
    lastNow = now;
    const busy = tick(dt);
    /* RENDU A LA DEMANDE PRESERVE — la pulsation des pins n entretient la boucle QU EN PLEIN ECRAN.
       Dans la page, des que le mouvement est pose, plus une seule image n est demandee : la section
       au repos coute zero frame, exactement comme l ancien etat ferme.                            */
    const live = place === 'full' && idleMode === 'pulse' && !reduced && pins.length > 0;
    if (needs) { renderer.render(scene, camera); needs = false; }
    if (busy || live || performance.now() < idleUntil) raf = requestAnimationFrame(frame);
  }

  /* parallaxe souris : le murmure de la charte. Dans la page, vue France entiere, et seulement
     quand rien d autre ne commande la camera (pas de ville visee, pas de glissement, pas de survol
     de pin) — sinon deux mains tireraient le meme rig.                                            */
  function applyPointer() {
    if (mobile || reduced || destroyed) return;
    if (place !== 'page' || state !== 'idle' || tweens.length || drag || hotIdx >= 0) return;
    dst.azim = clamp(ptrSX * 0.11, LIM.azim[0], LIM.azim[1]);
    dst.polar = clamp(PAGE.polar - ptrSY * 0.07, LIM.polar[0], LIM.polar[1]);
    invalidate(700);
  }

  /* =====================================================================
     14. OBSERVATEURS
     ===================================================================== */
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!destroyed) resize(); }) : null;
  const onWinResize = () => { if (!destroyed) resize(); };
  window.addEventListener('resize', onWinResize, { passive: true });
  const onVis = () => {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    else if (running) invalidate(400);
  };
  document.addEventListener('visibilitychange', onVis);
  const ambMO = new MutationObserver(() => {
    const m = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit';
    if (m === mode) return;
    /* la construction rend la main plusieurs fois : la bascule peut tomber AVANT que `api` existe.
       Dans ce cas on pose l ambiance a froid, la premiere image sortira deja dans la bonne. */
    if (!ready) { mode = m; ambK = ambFrom = ambTo = m === 'jour' ? 1 : 0; ambT = 1; applyAmb(); }
    else api.setAmbiance(m);
  });
  ambMO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });
  const onCtxLost = e => { e.preventDefault(); if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const onCtxRestored = () => { invalidate(500); };
  canvas.addEventListener('webglcontextlost', onCtxLost);
  canvas.addEventListener('webglcontextrestored', onCtxRestored);

  /* =====================================================================
     15. MISE EN PLACE
     ===================================================================== */
  function setStage(el) {
    if (!el || destroyed) return;
    const prev = stageEl;
    const prevRect = prev ? prev.getBoundingClientRect() : null;
    const prevCam = { dist: cur.dist, wx: cur.wx, wy: cur.wy };
    stageEl = el;
    if (canvas.parentNode !== el) el.appendChild(canvas);
    if (ro) { if (prev) ro.unobserve(prev); ro.observe(el); }
    resize();
    /* raccord invisible : meme taille apparente, au meme endroit de l ecran, avant / apres la bascule */
    if (prev && prev !== el && prevRect && prevRect.width > 4 && prevRect.height > 4 && !reduced) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) {
        cur.dist = prevCam.dist * (r.height / prevRect.height);
        cur.wx = clamp((prevRect.left + prevCam.wx * prevRect.width - r.left) / r.width, -2, 3);
        cur.wy = clamp((prevRect.top + prevCam.wy * prevRect.height - r.top) / r.height, -2, 3);
        dst.dist = cur.dist; dst.wx = cur.wx; dst.wy = cur.wy;
      }
    }
    placeCamera();
    invalidate();
  }

  itemsRaw = readData();
  applyData();
  await breathe(true, "111 communes + pins");
  setStage(opts.stage || host);
  readListBand();
  cur.polar = PAGE.polar; dst.polar = cur.polar;
  cur.dist = fitIdle(); dst.dist = cur.dist;
  cur.wy = idleWy(); dst.wy = cur.wy;
  cur.wx = idleWx(); dst.wx = cur.wx;
  pushBands();
  applyAmb();
  finishIntro();
  if (!reduced) {
    /* etat d attente avant la premiere entree : contour eteint, surface effacee, pins rentres */
    UO.head.value = 0; UO.ahead.value = 0; UO.spark.value = 1;
    UB.fade.value = 0;
    U.wipe.value = WIPE0; U.wipeAmt.value = 1; U.wipeDeep.value = 0;
    world.scale.y = 0.34;
    haloMat.opacity = 0;
    revealShadow = 0; syncShadow();
    PU.uGrow.value = 0;
  }
  placeCamera();
  /* COMPILATION DES PROGRAMMES — le poste le plus cher de toute la construction (materiaux
     MeshPhysical derives). On rend la main JUSTE AVANT : la page peint une image, puis on compile,
     puis on dessine la premiere image sur une scene deja compilee — le scroll n est plus fige au
     milieu d un geste. `compileAsync` n est utilise QUE si le pilote annonce KHR_parallel_shader_
     compile : sans l extension, three retombe sur une compilation synchrone ET ecrit un
     avertissement en console (le contrat en exige zero). On appelle alors `compile()` directement. */
  await breathe(true, "mise en place");
  let parallel = false;
  try { parallel = !!renderer.getContext().getExtension('KHR_parallel_shader_compile'); } catch (e) { parallel = false; }
  try {
    if (parallel && typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* on dessinera : three compilera au premier rendu */ }
  await breathe(true, "compilation des programmes");
  /* AMORCAGE — sans KHR_parallel_shader_compile, le pilote repousse l edition de liens et le
     televersement des programmes a la PREMIERE IMAGE reellement dessinee. On la lui offre sur un
     tampon de 8 x 8 (cout de remplissage nul), on rend la main pour que la page peigne, puis on
     dessine la vraie image sur des programmes deja chauds.                                       */
  if (!parallel) {
    const w0 = W, h0 = H;
    try {
      renderer.setSize(8, 8, false);
      renderer.render(scene, camera);
      renderer.setSize(w0, h0, false);
    } catch (e) { renderer.setSize(w0, h0, false); }
    await breathe(true, "amorcage");
  }
  const _tDraw = performance.now();
  renderer.render(scene, camera);
  const firstDraw = Math.round(performance.now() - _tDraw);
  ready = true;
  canvas.classList.add('is-ready');
  host.dataset.ready = '1';
  const buildStats = Object.assign(breathe.stats(), { premier_dessin_ms: firstDraw, compilation_parallele: parallel });

  /* =====================================================================
     16. API
     ===================================================================== */
  function launch() {
    if (started || destroyed) return;
    started = true;
    if (io) { io.disconnect(); io = null; }
    if (reduced) { finishIntro(); renderOnce(); return; }
    /* LA CHOREGRAPHIE COMPLETE SE JOUE DANS LA PAGE — c est desormais la scene principale :
       le contour se dessine, la surface se revele, les 111 pins s allument du nord-ouest au
       sud-est, le reseau passe puis disparait. Le plein ecran ne la rejoue pas : il agrandit
       la meme vue, deja posee.                                                                 */
    runIntro('open');
    kick();
  }
  const api = {
    /* `start()` est aussi un REARMEMENT : meme deja « running », la boucle a pu etre annulee
       (onglet cache, pas a pas du banc d essai). On repasse donc toujours par `invalidate()`. */
    start() {
      if (destroyed) return;
      running = true;
      if (reduced) { if (!started) { started = true; finishIntro(); } renderOnce(); running = false; return; }
      if (!started) {
        if (typeof IntersectionObserver !== 'function') { launch(); return; }
        if (!io) { io = new IntersectionObserver(e => { if (e.some(x => x.isIntersecting)) launch(); }, { threshold: 0.12 }); io.observe(host); }
        return;
      }
      invalidate(600);
    },
    /* `stop()` sert au cablage « hors ecran » de l integrateur, qui observe le HOST — or en plein
       ecran le canvas n est plus dans le host. Un stop() a ce moment gelerait la carte agrandie.
       Tant qu on n est pas revenu dans la page, on l ignore (force: usage interne de destroy()). */
    stop(force) {
      if (!force && place === 'full') return;
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    setPlace(p) { setPlace(p); },
    open() { setPlace('full'); },
    close() { setPlace('page'); },
    focusCity(id, fromUI) { doFocus(id, !!fromUI); },
    resetView() { doReset(); },
    setHover(id) { const i = pins.findIndex(p => p.it.id === id); setHot(i < 0 ? null : i); },
    setStage,
    setPointer(x, y) {
      if (reduced || mobile) return;
      ptrSX = clamp(+x || 0, -0.5, 0.5); ptrSY = clamp(+y || 0, -0.5, 0.5);
      applyPointer();
    },
    setAmbiance(m) {
      const next = m === 'jour' ? 'jour' : 'nuit';
      if (next === mode) return;
      mode = next;
      ambTo = next === 'jour' ? 1 : 0;
      if (reduced || !raf) { ambK = ambTo; ambFrom = ambTo; ambT = 1; applyAmb(); renderOnce(); }
      else { ambFrom = ambK; ambT = 0; invalidate(); }
    },
    /* rechargement a chaud des communes (le fichier genere peut etre remplace sans toucher au code) */
    setVilles(list) {
      opts.villes = list;
      clearSelection();
      itemsRaw = readData();
      applyData();
      applyAmb();
      readListBand();
      frameMemo.key = '';
      if (!tweens.length && !drag) {
        cur.dist = dst.dist = fitIdle();
        cur.wy = dst.wy = idleWy(); cur.wx = dst.wx = idleWx();
      }
      pushBands();
      PU.uGrow.value = started && intro < 0 ? 9 : 0;
      invalidate(600);
    },
    get items() { return uiCities; },
    get state() { return state; },
    get place() { return place; },
    get ready() { return ready; },
    stats() {
      const n = pins.length;
      return {
        triangles_rendus: renderer.info.render.triangles,
        triangles_scene: Math.round(triSurf + triSkirt + triLines + n * PIN_TRI),
        surface: triSurf, socle: triSkirt, lignes: Math.round(triLines), pins_triangles: n * PIN_TRI,
        appels: renderer.info.render.calls,
        programmes: renderer.info.programs ? renderer.info.programs.length : 0,
        pixelRatio: renderer.getPixelRatio(),
        resolution: RES, pins: n, etat: place + ' · ' + state, place, vue: state, ambiance: mode, ville_active: selId,
        boucle: !!raf, reduced, mobile, construction: buildStats
      };
    },
    destroy() {
      if (destroyed) return;
      arreterElan();
      api.stop(true);
      destroyed = true;
      clearTimeout(promote);
      if (io) { io.disconnect(); io = null; }
      window.removeEventListener('resize', onWinResize);
      document.removeEventListener('visibilitychange', onVis);
      ambMO.disconnect();
      if (ro) ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onCtxLost);
      canvas.removeEventListener('webglcontextrestored', onCtxRestored);
      disposePins();
      if (netMesh) netMesh.geometry.dispose();
      [stemGeo, gemGeo, discGeo, quad, surfGeo, skirtGeo, outlineGeo, glowGeo, borderGeo,
        shadowPlane.geometry, halo.geometry].forEach(g => g && g.dispose());
      [surfMat, skirtMat, outlineMat, glowMat, borderMat, netMat, haloMat, shadowMat,
        focusRingMat, selHaloMat, contactMat, baseMat, haloPinMat, stemMat, headMat].forEach(m => m.dispose());
      [landTex, regTex, haloTex, shadowTex, spriteTex, contactTex, baseTex, haloTex2, poolTex].forEach(t => t.dispose());
      envRT.dispose();
      /* `dispose()` libere les objets three ; seul `forceContextLoss()` rend le CONTEXTE au
         navigateur (textures et framebuffers internes compris). Sans lui, chaque cycle
         create/destroy laissait un contexte vivant — la limite par onglet est ~16.            */
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* deja perdu */ }
      canvas.remove();
      delete host.dataset.ready;
    },
    _dbg: {
      THREE, scene, camera, renderer, world, surf, skirt, outline, glowLine, borders, focusRing, selHalo,
      get net() { return netMesh; }, pins, U, UO, UB, UN, PU, cur, dst, tweens,
      applyAmb, placeCamera, updateScreen, runIntro, finishIntro, fitDist, syncShadow,
      idlePads, fullPads, fitIdle, idleWy, idleWx, frameFit, hull: HULL, corse: CORSE, focusAnchor, checkCorse, regionIndexAt,
      get grid() { return grid; },
      get items() { return itemsRaw; }, get sel() { return selIdx; },
      /* banc d essai : avance la choregraphie d un pas EXACT, hors rAF (captures deterministes) */
      step(dt, draw) { if (raf) { cancelAnimationFrame(raf); raf = 0; } tick(dt == null ? 1 / 60 : dt); if (draw !== false) { renderer.render(scene, camera); needs = false; } },
      get ambK() { return ambK; }, get intro() { return intro; },
      render: () => renderer.render(scene, camera)
    }
  };
  return api;
}

/* =========================================================================================
   INTEGRATION CLES EN MAIN : coquille + moteur + repli sans WebGL
   ========================================================================================= */
export async function initCarte3D(host, options) {
  const opts = options || {};
  if (!host) throw new Error('carte3d : host manquant');
  const reduced = opts.reduced != null ? !!opts.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ui = opts.ui || createCarteUI(host, { reduced, mobile: opts.mobile, inertPage: opts.inertPage });
  let scene = null, destroyed = false;

  /* ORDRE OBLIGATOIRE : creer -> s abonner -> mount() */
  const off = ui.onIntent(i => {
    if (!scene) return;
    if (i.type === 'stage') scene.setStage(i.el);
    else if (i.type === 'place') scene.setPlace(i.place);
    else if (i.type === 'reset') scene.resetView();
    else if (i.type === 'focus') scene.focusCity(i.id, true);
    else if (i.type === 'hover') scene.setHover(i.id);
  });
  ui.mount();

  try {
    if (opts.forceFallback) throw new Error('WebGL desactive (banc d essai)');
    scene = await createCarteScene(host, Object.assign({}, opts, { ui, reduced, stage: ui.stage }));
    scene.setStage(ui.stage);
    scene.start();
  } catch (e) {
    /* SANS WEBGL, LA COQUILLE DOIT ETRE ALIMENTEE ICI : `createCarteScene` a leve, donc
       `setCities` n a pas tourne. Le repli lit les MEMES communes, par le meme `readVilles`. */
    scene = null;
    ui.setFallback(true);
    ui.setCities(uiCitiesOf(readVilles(opts)));
    buildFallbackMap(host, { villes: opts.villes });
  }

  return {
    ui,
    get scene() { return scene; },
    start() { if (scene) scene.start(); },
    stop() { if (scene) scene.stop(); },
    setPointer(x, y) { if (scene) scene.setPointer(x, y); },
    setAmbiance(m) { ui.setAmbiance(m); if (scene) scene.setAmbiance(m); },
    setVilles(list) {
      opts.villes = list;
      if (scene) { scene.setVilles(list); return; }
      ui.setCities(uiCitiesOf(readVilles(opts)));
      const slot = host.querySelector('.c3d__fallback-visual');
      if (slot) { slot.textContent = ''; buildFallbackMap(host, { villes: list }); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      off();
      if (scene) scene.destroy();
      if (!opts.ui) ui.destroy();
    }
  };
}

/* Repli : la carte du site en SVG plat (memes communes, meme projection), jamais une zone vide. */
export function buildFallbackMap(host, opts) {
  const o = opts || {};
  const slot = host.querySelector('.c3d__fallback-visual');
  if (!slot || slot.childNodes.length) return null;
  const NSU = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NSU, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 930');
  svg.setAttribute('class', 'c3d__fallback-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const reg of G.REGIONS) {
    const path = document.createElementNS(NSU, 'path');
    let d = '';
    for (const poly of reg.polygons) for (const ring of [poly.outer].concat(poly.holes)) {
      ring.pts.forEach((p, i) => { const s = G.toSvg(p); d += (i ? 'L' : 'M') + s[0].toFixed(1) + ',' + s[1].toFixed(1); });
      d += 'Z';
    }
    path.setAttribute('d', d);
    path.setAttribute('class', 'c3d__fallback-r');
    svg.appendChild(path);
  }
  /* memes communes, meme lecture : le repli montre les 111 points, en plus petit */
  for (const it of readVilles(o)) {
    const p = G.project(it.lat, it.lon);
    const n = document.createElementNS(NSU, 'circle');
    n.setAttribute('cx', p[0].toFixed(1)); n.setAttribute('cy', p[1].toFixed(1)); n.setAttribute('r', '5');
    n.setAttribute('class', 'c3d__fallback-pin' + (it.journee ? ' is-journee' : ''));
    /* meme identifiant que la ligne de liste : sans WebGL, choisir une ville allume son point */
    n.dataset.city = it.id;
    svg.appendChild(n);
  }
  slot.appendChild(svg);
  return svg;
}

export default createCarteScene;
