/* scenes/parcours/t1-france.js · TABLEAU 01 — « Trouvez une journée près de chez vous »
   ==========================================================================
   LA FRANCE COMME PIÈCE, PAS COMME CARTE.

   Ce n'est ni une image, ni un plan : c'est un objet massif, une plaque de
   métal sombre fraisée à la forme du territoire, avec une vraie épaisseur,
   une tranche polie, un liseré d'or sur l'arête haute, et un relief que l'on
   ne voit pas — que l'on SENT quand la lumière passe en rasant.

   TOUT Y EST VRAI, ET C'EST LE POINT.
   La géométrie ne vient pas d'un dessin : elle vient de `france-geo3d.js`,
   qui porte le tracé IGN des 13 régions (5 232 points), le contour extérieur
   du territoire (1 786 points), les frontières internes (1 734 points) et un
   champ de relief bâti sur 42 massifs réels — arc alpin, crête pyrénéenne,
   Jura, Vosges, Massif central, Corse. Les plaines n'en portent aucun. On ne
   fabrique donc pas une France plausible : on usine la vraie, et c'est ce
   qui fait la différence entre un objet et une illustration.

   COMMENT ELLE EST FAITE, ET POURQUOI AINSI

   · LE PLATEAU. Une grille régulière, découpée au masque du territoire, dont
     chaque sommet est élevé par `sampleRelief`. Une extrusion simple aurait
     donné un dessus PLAT : le relief a besoin de sommets pour exister, et la
     triangulation d'un polygone n'en fournit pas à l'intérieur.
   · LA TRANCHE. Une muraille verticale posée sur le contour EXACT, du relief
     jusqu'au dessous. Elle est polie plus que le plateau : c'est elle qui
     porte le reflet et qui dit l'épaisseur quand la caméra bouge.
   · LE DESSOUS. Plat, donc triangulé directement depuis les polygones — la
     grille n'y servirait à rien et coûterait le double.
   · LE LISERÉ. Un ruban à largeur constante à l'écran, qui S'ÉCRIT du nord
     vers le sud quand le tableau entre. Voir atelier.js pour la technique.
   · LES VILLES. Les 111 communes réelles de `window.COMPAGNIE_OR_VILLES`,
     posées à leur vraie latitude. Quelques-unes respirent. Une seule
     s'allume vraiment.

   API : creerFrance(ctx) -> Promise<tableau> */

import * as THREE from 'three';
import * as G from '../../france-geo3d.js';
import {
  clamp, lerp, smooth, easeOut,
  geoRuban, geoTrait, jeuTrait, nuanceurTrait, depuisLeNord,
  halo, libererArbre,
} from './atelier.js';

const TAU = Math.PI * 2;
const souffler = () => new Promise(r => (window.requestIdleCallback || requestAnimationFrame)(r));

/* la ville qui s'allume : le siège. Repli sur la plus proche du centre si la
   liste des communes n'est pas là (page isolée, laboratoire). */
const VILLE_ACTIVE = 'Lyon';
/* celles qui respirent : bien étalées, pour que le territoire ait un réseau
   et pas un point unique. */
const VILLES_VIVES = ['Lille', 'Rennes', 'Nantes', 'Bordeaux', 'Toulouse', 'Marseille', 'Strasbourg', 'Clermont-Ferrand'];

/* ---------- masque du territoire : blanc à terre, noir en mer ---------- */
function masqueTerre(RES, NY, X0, Y0, SPANX, SPANY) {
  const c = document.createElement('canvas');
  c.width = RES + 1; c.height = NY + 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const px = (x, y) => [(x - X0) / SPANX * RES, (1 - (y - Y0) / SPANY) * NY];
  const trace = (pts) => {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) { const [X, Y] = px(pts[i][0], pts[i][1]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.closePath();
  };
  g.fillStyle = '#fff';
  for (const r of G.REGIONS) for (const poly of r.polygons) { trace(poly.outer.pts); g.fill(); }
  g.fillStyle = '#000';
  for (const r of G.REGIONS) for (const poly of r.polygons) for (const h of poly.holes) { trace(h.pts); g.fill(); }
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const terre = new Uint8Array((RES + 1) * (NY + 1));
  for (let i = 0; i < terre.length; i++) terre[i] = d[i * 4] > 127 ? 1 : 0;
  return terre;
}

export async function creerFrance(ctx) {
  const { renderer, A, qualite } = ctx;
  const groupe = new THREE.Group();
  const piece = new THREE.Group();          /* la plaque elle-même : c'est elle qui tourne */
  groupe.add(piece);

  /* ---------- cadre ---------- */
  const W = G.BOUNDS.world;
  const X0 = W.x[0], Y0 = W.y[0], SPANX = W.width, SPANY = W.height;
  const RES = qualite === 'bas' ? 132 : 224;
  const NY = Math.max(8, Math.round(RES * SPANY / SPANX));
  const EPAIS = 0.058;                      /* l'épaisseur de la plaque, en unités monde */

  /* uniformes partages : declares AVANT toute fermeture qui les capture */
  const U_TEMPS = { value: 0 };
  const U_VILLES = { value: 0 };

  const terre = masqueTerre(RES, NY, X0, Y0, SPANX, SPANY);
  const aTerre = (i, j) => terre[j * (RES + 1) + i];

  /* ---------- relief : on échantillonne, puis on normalise sur le maximum
       RÉELLEMENT rencontré. Une amplitude fixée à l'avance donnerait un
       résultat qui dépend du champ ; normalisée, elle dépend de l'objet. ---- */
  const NV = (RES + 1) * (NY + 1);
  const brut = new Float32Array(NV);
  let hMax = 0;
  for (let j = 0; j <= NY; j++) {
    const y = Y0 + SPANY * (1 - j / NY);
    for (let i = 0; i <= RES; i++) {
      const k = j * (RES + 1) + i;
      if (!terre[k]) continue;
      const h = G.sampleRelief(X0 + SPANX * i / RES, y);
      brut[k] = h;
      if (h > hMax) hMax = h;
    }
    if ((j & 15) === 15) await souffler();
  }
  hMax = hMax || 1;
  /* 38 % de l'épaisseur : assez pour que la lumière rasante l'accroche,
     jamais assez pour que le Mont Blanc devienne un pic. */
  const AMPL = EPAIS * 0.34;
  const hauteurEn = (i, j) => brut[j * (RES + 1) + i] / hMax * AMPL;

  /* échantillonnage continu du relief déjà normalisé : le contour, la
     tranche et les villes lisent la MÊME hauteur que le plateau, donc rien
     ne décroche. */
  const relief = (x, y) => {
    const fi = clamp((x - X0) / SPANX, 0, 1) * RES;
    const fj = clamp(1 - (y - Y0) / SPANY, 0, 1) * NY;
    const i = Math.min(RES - 1, Math.floor(fi)), j = Math.min(NY - 1, Math.floor(fj));
    const u = fi - i, v = fj - j;
    const a = hauteurEn(i, j), b = hauteurEn(i + 1, j), c2 = hauteurEn(i, j + 1), d = hauteurEn(i + 1, j + 1);
    return lerp(lerp(a, b, u), lerp(c2, d, u), v);
  };

  /* ---------- le plateau ---------- */
  const pos = new Float32Array(NV * 3);
  const col = new Uint8Array(NV * 3);
  const tri = [];
  for (let j = 0; j <= NY; j++) {
    const y = Y0 + SPANY * (1 - j / NY);
    for (let i = 0; i <= RES; i++) {
      const k = j * (RES + 1) + i, x = X0 + SPANX * i / RES;
      const h = hauteurEn(i, j);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = h;
      /* la matière varie très peu : les crêtes accrochent un rien plus la
         lumière. Au-delà de 5 % on lit des zébrures, pas du métal. */
      const u = Math.pow(clamp(h / AMPL, 0, 1), 0.62);
      const n = 0.5 + 0.5 * Math.sin(x * 21.7 + y * 16.3) * Math.sin(x * 8.9 - y * 12.1);
      const c = clamp(0.86 + 0.045 * u + 0.024 * (n - 0.5), 0, 1) * 255;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = c;
    }
    if ((j & 31) === 31) await souffler();
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < RES; i++) {
    const k = j * (RES + 1) + i, k1 = (j + 1) * (RES + 1) + i;
    if (!(aTerre(i, j) | aTerre(i + 1, j) | aTerre(i, j + 1) | aTerre(i + 1, j + 1))) continue;
    /* enroulement : dans le plan XY avec la hauteur en Z, la normale doit
       sortir vers +Z. Le sens issu du plan XZ la faisait pointer vers le
       BAS, et toute la face superieure etait eliminee. */
    tri.push(k, k1, k + 1, k + 1, k1, k1 + 1);
  }
  await souffler();

  const geoPlateau = new THREE.BufferGeometry();
  geoPlateau.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geoPlateau.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  geoPlateau.setIndex(tri);
  geoPlateau.computeVertexNormals();

  /* ---------- la tranche : muraille verticale sur le contour exact ---------- */
  const wPos = [], wCol = [], wNor = [], wIdx = [];
  const aireDe = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
  for (const boucle of G.OUTLINE) {
    const n = boucle.length;
    if (n < 3) continue;
    const base = wPos.length / 3;
    const sgn = aireDe(boucle) > 0 ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const kk = i % n;
      const p = boucle[kk], a = boucle[(kk - 1 + n) % n], b = boucle[(kk + 1) % n];
      const h = relief(p[0], p[1]);
      /* perpendiculaire horizontale a la direction moyenne : elle ne depend
         ni du relief ni de l'angle des facettes, donc elle ne zigzague pas. */
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const nx = sgn * dy, ny = -sgn * dx;
      wPos.push(p[0], p[1], h, p[0], p[1], -EPAIS);
      wNor.push(nx, ny, 0, nx, ny, 0);
      /* la tranche s'assombrit vers le bas : c'est l'occlusion d'un objet
         épais, et c'est elle qui fait lire le volume. */
      wCol.push(1, 1, 1, 0.72, 0.72, 0.72);
    }
    /* enroulement : dans le plan XY avec la hauteur en Z, il est INVERSE
       par rapport au plan XZ dont vient cette technique. */
    for (let i = 0; i < n; i++) { const k = base + i * 2; wIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geoTranche = new THREE.BufferGeometry();
  geoTranche.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  geoTranche.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  geoTranche.setAttribute('normal', new THREE.Float32BufferAttribute(wNor, 3));
  geoTranche.setIndex(wIdx);
  /* surtout PAS de computeVertexNormals ici : il ecraserait les normales
     analytiques par la moyenne des facettes, qui est justement le defaut. */
  await souffler();

  /* ---------- le dessous : plat, donc triangulé depuis les polygones ---------- */
  const bPos = [], bIdx = [];
  for (const r of G.REGIONS) for (const poly of r.polygons) {
    const contour = poly.outer.pts.map(p => new THREE.Vector2(p[0], p[1]));
    const trous = poly.holes.map(h => h.pts.map(p => new THREE.Vector2(p[0], p[1])));
    let faces;
    try { faces = THREE.ShapeUtils.triangulateShape(contour, trous); } catch (e) { continue; }
    const tous = contour.concat(...trous);
    const base = bPos.length / 3;
    for (const v of tous) bPos.push(v.x, v.y, -EPAIS);
    /* enroulement inversé : le dessous regarde vers -Z */
    for (const f of faces) bIdx.push(base + f[0], base + f[2], base + f[1]);
  }
  const geoDessous = new THREE.BufferGeometry();
  geoDessous.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  geoDessous.setIndex(bIdx);
  geoDessous.computeVertexNormals();
  await souffler();

  /* ---------- matières ---------- */
  const matPlateau = new THREE.MeshPhysicalMaterial({
    color: A.plaque, metalness: A.plaqueMetal, roughness: A.plaqueRough,
    vertexColors: true, envMapIntensity: 1.30,
    clearcoat: 0.30, clearcoatRoughness: 0.38,
  });
  const matTranche = new THREE.MeshPhysicalMaterial({
    color: A.tranche, metalness: A.trancheMetal, roughness: A.trancheRough,
    vertexColors: true, envMapIntensity: 1.55,
    /* bilaterale : voir la note ci-dessus. C'est une garantie de
       construction, pas un reglage — le sens des boucles ne peut plus
       produire de trou, quelle que soit la source geometrique. */
    side: THREE.DoubleSide,
  });
  const matDessous = new THREE.MeshStandardMaterial({
    color: A.tranche, metalness: 0.55, roughness: 0.80, envMapIntensity: 0.22,
  });

  piece.add(new THREE.Mesh(geoPlateau, matPlateau));
  piece.add(new THREE.Mesh(geoTranche, matTranche));
  piece.add(new THREE.Mesh(geoDessous, matDessous));

  /* ---------- le liseré d'or, qui s'écrit ---------- */
  const U = jeuTrait();
  U.avant.value = 0; U.tete.value = 0; U.flou.value = 0.035;
  const boucles = G.OUTLINE.map(depuisLeNord);
  const matLisere = nuanceurTrait(new THREE.MeshBasicMaterial({
    color: A.orVif, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, vertexColors: true, side: THREE.DoubleSide,
  }), U, true);
  const lisere = new THREE.Mesh(geoRuban(boucles, p => relief(p[0], p[1]), 0.011, 0.0016), matLisere);
  lisere.renderOrder = 3;
  piece.add(lisere);

  /* le fil d'or franc posé SUR l'arête : le ruban fait le halo, celui-ci
     fait la ligne. Deux objets, parce qu'un seul ne peut pas être à la fois
     net et diffus. */
  const Uf = jeuTrait();
  Uf.avant.value = 0; Uf.tete.value = 0; Uf.flou.value = 0.035;
  const matFil = nuanceurTrait(new THREE.LineBasicMaterial({
    color: A.orVif, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), Uf, false);
  const fil = new THREE.LineSegments(
    geoTrait(boucles.map(b => b.concat([b[0]])), p => relief(p[0], p[1]), 0.0022), matFil);
  fil.renderOrder = 4;
  piece.add(fil);

  /* ---------- les frontières internes : gravées, presque rien ---------- */
  const Ub = jeuTrait();
  Ub.avant.value = 0; Ub.tete.value = 0; Ub.flou.value = 0.06; Ub.voile.value = 0.30;
  const matBord = nuanceurTrait(new THREE.LineBasicMaterial({
    color: A.orChaud, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), Ub, false);
  const bords = new THREE.LineSegments(geoTrait(G.BORDERS, p => relief(p[0], p[1]), 0.0012), matBord);
  bords.renderOrder = 2;
  piece.add(bords);

  /* ---------- les villes ---------- */
  const liste = (typeof window !== 'undefined' && Array.isArray(window.COMPAGNIE_OR_VILLES)) ? window.COMPAGNIE_OR_VILLES : [];
  const pts = [], vif = [], phase = [];
  let active = null;
  for (const v of liste) {
    if (typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
    const [x, y] = G.projectWorld(v.lat, v.lon);
    if (!G.contains(x, y)) continue;
    const estActive = v.nom === VILLE_ACTIVE;
    if (estActive) active = [x, y, relief(x, y)];
    pts.push(x, y, relief(x, y) + 0.004);
    vif.push(VILLES_VIVES.includes(v.nom) ? 1 : 0);
    phase.push(Math.random() * TAU);
  }
  let villes = null, matVilles = null;
  if (pts.length) {
    const gv = new THREE.BufferGeometry();
    gv.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gv.setAttribute('aVif', new THREE.Float32BufferAttribute(vif, 1));
    gv.setAttribute('aPh', new THREE.Float32BufferAttribute(phase, 1));
    matVilles = new THREE.PointsMaterial({
      color: A.orVif, size: 0.034, sizeAttenuation: true,
      /* opacite 1, et NON 0 : l'uniforme uVoile MULTIPLIE diffuseColor.a, qui
         part de material.opacity. A zero, tout le nuanceur etait multiplie par
         zero et les 110 points ne produisaient pas un pixel. C'est le voile
         qui fait l'apparition, pas l'opacite du materiau. */
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1,
    });
    /* un point rond, et qui respire : la taille et l'opacité se calculent au
       sommet, pas dans une boucle JavaScript sur 111 objets. */
    matVilles.customProgramCacheKey = () => 'parc-villes';
    matVilles.onBeforeCompile = s => {
      s.uniforms.uT = U_TEMPS;
      s.uniforms.uVoile = U_VILLES;
      s.vertexShader = 'attribute float aVif;\nattribute float aPh;\nuniform float uT;\nvarying float vA;\n' + s.vertexShader
        .replace('void main() {', 'void main() {')
        .replace('gl_PointSize = size;', 'float souffle = 0.5 + 0.5 * sin(uT * 0.9 + aPh);\n\tvA = mix(0.62, mix(0.78, 1.0, souffle), aVif);\n\tgl_PointSize = size * mix(0.72, mix(0.92, 1.28, souffle), aVif);');
      s.fragmentShader = 'varying float vA;\nuniform float uVoile;\n' + s.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
\tvec2 pc = gl_PointCoord - 0.5;
\tfloat r = length(pc);
\tfloat noyau = smoothstep(0.5, 0.06, r);
\tdiffuseColor.a *= noyau * vA * uVoile;`);
    };
    villes = new THREE.Points(gv, matVilles);
    villes.renderOrder = 5;
    piece.add(villes);
  }

  /* ---------- la ville qui s'allume ---------- */
  let pierre = null, anneau = null, noyau = null;
  if (active) {
    /* deux couches : un halo court qui pose la lumiere sur le metal, et un
       noyau tres petit qui donne la durete d'une pierre. Un seul degrade
       large produit une tache, jamais un eclat. */
    pierre = halo(0.052, A.orVif, 0);
    pierre.position.set(active[0], active[1], active[2] + 0.006);
    pierre.renderOrder = 6;
    piece.add(pierre);
    noyau = halo(0.014, 0xfff4e0, 0);
    noyau.position.set(active[0], active[1], active[2] + 0.008);
    noyau.renderOrder = 7;
    piece.add(noyau);
    /* un seul anneau, très fin, et il ne se répète pas : il s'ouvre une fois
       quand le tableau prend la main. Une onde qui boucle serait un gadget. */
    const ga = new THREE.RingGeometry(0.036, 0.0385, 96);
    const ma = new THREE.MeshBasicMaterial({
      color: A.orVif, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    anneau = new THREE.Mesh(ga, ma);
    anneau.position.copy(pierre.position);
    anneau.renderOrder = 6;
    piece.add(anneau);
  }

  /* ---------- la lueur du dessous : l'objet flotte, rien ne reçoit son
       ombre — mais il renvoie de la lumière au vide sous lui. ---------- */
  const lueur = halo(1.15, A.orChaud, 0);
  lueur.position.set(0, 0, -EPAIS - 0.34);
  piece.add(lueur);

  /* ---------- pose ---------- */
  /* vue de dessus, inclinée : on voit le plateau ET la tranche du bas.
     Au-delà de 62° la France se couche et redevient une carte ; en deçà de
     48° on ne voit plus l'épaisseur, donc plus l'objet. */
  const INCLIN = -Math.PI * 0.315;            /* ≈ -56,7° */
  piece.rotation.x = INCLIN;
  piece.position.y = 0.02;

  /* ================= vie ================= */
  let tLocal = 0, entree = 0, pointeurX = 0, pointeurY = 0, px = 0, py = 0, baseX = INCLIN;
  const etat = {
    groupe,
    rayon: 1.1,   /* valeur de secours : le moteur la remplace par la mesure */
    /* p ∈ [-1, 1] : 0 = le tableau est cadré. */
    entrer(p) {
      const dedans = 1 - Math.min(1, Math.abs(p));
      entree = Math.max(entree, smooth(clamp(dedans * 1.35, 0, 1)));
      /* LE TRACÉ. Il s'écrit une fois, à l'entrée, et ne se rejoue pas :
         un contour qui se redessine à chaque passage devient une animation
         de chargement. */
      const t = easeOut(entree, 2.2);
      U.tete.value = t; Uf.tete.value = t; Ub.tete.value = t;
      U.voile.value = t; Uf.voile.value = t;
      Ub.voile.value = t * 0.30;
      U.eclat.value = Uf.eclat.value = (t > 0.02 && t < 0.99) ? 0.55 : 0;
      U_VILLES.value = smooth(clamp((entree - 0.45) / 0.5, 0, 1));
      const vEclat = smooth(clamp((entree - 0.6) / 0.4, 0, 1));
      if (pierre) pierre.material.opacity = vEclat * 0.55 * A.halo;
      if (noyau) noyau.material.opacity = vEclat * 0.95;
      if (anneau) {
        const a = smooth(clamp((entree - 0.68) / 0.32, 0, 1));
        anneau.material.opacity = a * (1 - a) * 2.4 * A.halo;
        anneau.scale.setScalar(0.35 + a * 1.5);
      }
      lueur.material.opacity = entree * 0.10 * A.halo;

      /* LA ROTATION AU DÉFILEMENT. Quelques degrés, bornés — c'est ce qui
         fait percevoir l'épaisseur sans transformer la pièce en globe. */
      baseX = INCLIN + p * 0.085;
      piece.rotation.x = baseX + py * 0.055;
      piece.rotation.z = -p * 0.055;
    },
    battre(t, dt) {
      tLocal = t;
      U_TEMPS.value = t;
      /* flottement : lent, faible, jamais synchronisé avec la rotation —
         deux périodes premières entre elles, sinon l'œil lit une boucle. */
      piece.position.z = Math.sin(t * 0.37) * 0.020 + Math.sin(t * 0.23) * 0.012;
      px += (pointeurX - px) * Math.min(1, dt * 2.6);
      py += (pointeurY - py) * Math.min(1, dt * 2.6);
      piece.rotation.y = px * 0.11;
      piece.rotation.x = baseX + py * 0.055;
    },
    pointeur(x, y) { pointeurX = x; pointeurY = y; },
    ambiance(k, AA) {
      matPlateau.color.setHex(AMB(k, 'plaque'));
      matPlateau.roughness = NUM(k, 'plaqueRough');
      matPlateau.metalness = NUM(k, 'plaqueMetal');
      matTranche.color.setHex(AMB(k, 'tranche'));
      matTranche.roughness = NUM(k, 'trancheRough');
      matTranche.metalness = NUM(k, 'trancheMetal');
      matDessous.color.setHex(AMB(k, 'tranche'));
      const orV = AMB(k, 'orVif'), orC = AMB(k, 'orChaud');
      matLisere.color.setHex(orV); matFil.color.setHex(orV); matBord.color.setHex(orC);
      if (matVilles) {
        matVilles.color.setHex(k > 0.5 ? 0x6b4f16 : orV);
        const veutV = k > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (matVilles.blending !== veutV) { matVilles.blending = veutV; matVilles.needsUpdate = true; }
      }
      if (pierre) pierre.material.color.setHex(orV);
      if (anneau) anneau.material.color.setHex(orV);
      if (noyau) noyau.material.color.setHex(k > 0.5 ? 0xb08a3c : 0xfff4e0);
      lueur.material.color.setHex(orC);
      /* le liseré est en mélange additif : sur fond ivoire il n'ajoute rien
         de visible. Le jour, il repasse en mélange normal et s'assombrit —
         sans quoi le contour disparaît purement et simplement. */
      const jour = k > 0.5;
      for (const m of [matLisere, matFil, matBord]) {
        const veut = jour ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (m.blending !== veut) { m.blending = veut; m.needsUpdate = true; }
      }
    },
    largeurEcran(uL) { U.larg.value = uL; },
    liberer() { libererArbre(groupe); },
  };

  /* interpolation d'ambiance : lecture directe des deux tables */
  const cA = new THREE.Color(), cB = new THREE.Color();
  function AMB(k, cle) {
    cA.setHex(ctx.tables.nuit[cle]); cB.setHex(ctx.tables.jour[cle]);
    return cA.lerp(cB, k).getHex();
  }
  function NUM(k, cle) { return lerp(ctx.tables.nuit[cle], ctx.tables.jour[cle], k); }

  etat.ambiance(ctx.k, A);
  etat.entrer(1);   /* état de départ : hors champ, rien n'est encore écrit */
  return etat;
}
