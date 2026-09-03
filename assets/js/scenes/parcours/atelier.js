/* scenes/parcours/atelier.js · L'ATELIER — outils communs aux quatre tableaux
   ==========================================================================
   Rien ici ne dessine quoi que ce soit. Ce fichier ne contient que ce dont
   les quatre tableaux ont besoin en commun : les matières, l'environnement de
   reflet, deux techniques de trait, et de quoi libérer proprement le GPU.

   POURQUOI CES TECHNIQUES-LÀ, ET PAS D'AUTRES

   · Le TRAIT. Un contour d'or tracé en `LineSegments` a toujours un pixel de
     large, quelle que soit la distance : il scintille dès que la caméra
     bouge, et il disparaît en haute densité. Un ruban à DEUX sommets par
     point — l'un opaque sur le tracé, l'autre transparent poussé vers
     l'extérieur d'une largeur qui suit la distance de caméra — garde une
     épaisseur constante à l'écran, ne scintille jamais, et ne demande aucun
     module de « lignes épaisses ». C'est la technique déjà éprouvée par la
     carte de France du site ; elle est reprise ici, pas réinventée.

   · LE TRACÉ QUI S'ÉCRIT. Chaque sommet porte son abscisse curviligne. Un
     seul uniforme promène une tête le long du trait : le fil d'or se dessine
     au défilement sans qu'aucune géométrie ne soit reconstruite.

   · L'OMBRE. Aucune carte d'ombre. Une carte d'ombre qui couvrirait quatre
     tableaux distants aurait un tronc énorme, donc une résolution ridicule,
     donc des bords baveux et du scintillement. À la place, une ombre de
     CONTACT peinte : un dégradé radial sur un plan, sous l'objet. C'est ce
     que font les pages produit haut de gamme, c'est net à toute densité, et
     ça ne coûte qu'un quadrilatère.

   · L'ENVIRONNEMENT. Aucun fichier HDRI à télécharger : un STUDIO construit
     en géométrie, rendu une fois par PMREM. La différence avec un dégradé
     peint n'est pas subtile : une boîte à lumière rectangulaire donne un
     reflet qui a des BORDS, et c'est ce bord net qui fait qu'un métal se
     lit comme du métal plutôt que comme une surface grise. Deux versions :
     la nuit, une chambre noire à une grande source chaude ; le jour, une
     galerie à verrière. Ni l'une ni l'autre n'est jamais vue. */

import * as THREE from 'three';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t, p = 3) => 1 - Math.pow(1 - clamp(t, 0, 1), p);
export const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* =====================================================================
   1. LES DEUX AMBIANCES
   ---------------------------------------------------------------------
   Le jour n'est pas la nuit éclaircie : c'est un autre éclairage. La nuit,
   une seule ouverture chaude à gauche et un liseré froid derrière — les
   objets SORTENT du noir. Le jour, une lumière haute et large, des ombres
   diffuses, un or plus profond pour tenir sur l'ivoire — les objets
   EXISTENT dans une galerie. Même géométrie, deux directions de lumière.
   ===================================================================== */
export const AMBIANCES = {
  nuit: {
    expo: 1.42, env: 1.05,
    fond: 0x0b0a08,
    /* LA COULEUR D'UN METAL EST SA REFLECTANCE, pas son apparence voulue.
       0x2a2723 avait l'air d'un graphite moyen sur un nuancier ; en lumiere
       lineaire il ne reflechit que 2,1 %, c'est-a-dire de la suie, et aucun
       eclairage ne rattrape cela. On pose donc des valeurs physiques —
       graphite 18 %, bronze poli 30 % — et c'est la CHAMBRE NOIRE qui fait
       l'obscurite : la plaque est sombre la ou elle ne voit pas la boite a
       lumiere, et vive la ou elle la voit. C'est exactement ainsi qu'un
       objet « sort du noir » au lieu d'y etre peint.
       Le bleu nuit demande arrive par le RETOUR FROID du studio, ou il est
       raffine, plutot que par la couleur de base, ou il jure avec le noir
       chaud de la page. */
    plaque: 0x6e6d6c, plaqueRough: 0.56, plaqueMetal: 0.90,
    tranche: 0x8d8a85, trancheRough: 0.22, trancheMetal: 0.97,
    or: 0xc99a3f, orVif: 0xe7c47e, orChaud: 0xd2a052,
    ivoire: 0xf3ecdc, pierre: 0x14130f, pierreRough: 0.62,
    key: 3.4, keyCol: 0xffe6c4,
    rim: 2.4, rimCol: 0xbcd0e8,
    fill: 0.7, fillCol: 0xc9a36a,
    hemi: 0.16, hemiCiel: 0x2c3448, hemiSol: 0x07070a,
    ombre: 0.62, halo: 1.0,
  },
  jour: {
    expo: 1.34, env: 1.20,
    fond: 0xf4efe6,
    /* Le jour, la galerie est claire : le metal reflete du clair partout et
       s'eclaircit tout seul. On DESCEND donc un peu la reflectance par
       rapport a la nuit — sinon la plaque se confond avec l'ivoire du fond
       et l'objet disparait. C'est l'inverse de l'intuition, et c'est bien
       pour cela qu'un mode jour ne se regle pas en eclaircissant la nuit. */
    plaque: 0x615f5b, plaqueRough: 0.54, plaqueMetal: 0.84,
    tranche: 0x7d786f, trancheRough: 0.26, trancheMetal: 0.94,
    or: 0x8a6820, orVif: 0xd8b26a, orChaud: 0xb08a3c,
    ivoire: 0xfaf6ec, pierre: 0xd8d0c2, pierreRough: 0.78,
    key: 2.6, keyCol: 0xfff4e6,
    rim: 1.4, rimCol: 0xe8eef6,
    fill: 2.0, fillCol: 0xfff1de,
    hemi: 0.72, hemiCiel: 0xfff8ee, hemiSol: 0xcabfa9,
    ombre: 0.34, halo: 0.42,
  },
};

/* interpolation d'ambiance : k = 0 nuit, k = 1 jour. On interpole TOUT sauf
   l'environnement, qui se substitue au croisement — voir moteur. */
export const mixNb = (k, a, b) => lerp(a, b, k);
export function mixCol(out, k, a, b) { return out.setHex(a).lerp(TMP.setHex(b), k); }
const TMP = new THREE.Color();

/* =====================================================================
   2. ENVIRONNEMENT
   ===================================================================== */
/* LE STUDIO. Trois sources, une chambre, et rien d'autre — exactement le
   plan d'eclairage d'une prise de vue de joaillerie :

     · LA BOITE A LUMIERE, grande, chaude, en haut a gauche. C'est elle qui
       fait la matiere. Sa forme RECTANGULAIRE se lit dans le reflet, et
       c'est ce bord net qui distingue un metal d'une surface grise.
     · LE RETOUR FROID, une bande etroite derriere a droite : il pose un
       liseré sur l'arete opposee et detache la silhouette du fond.
     · LA CARTE DE RETOUR, basse et faible : elle empeche le dessous de
       tomber au noir absolu.

   Les couleurs depassent 1 : la cible du PMREM est en demi-flottant, elle
   garde donc la dynamique. C'est ce qui donne des hautes lumieres qui
   BRULENT au lieu de plafonner en gris clair. */
function studio(mode) {
  const s = new THREE.Scene();
  const jour = mode === 'jour';
  const bas = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace) });

  /* la chambre */
  const chambre = new THREE.Mesh(new THREE.BoxGeometry(24, 16, 24),
    jour ? bas(0.58, 0.55, 0.50) : bas(0.017, 0.018, 0.022));
  chambre.material.side = THREE.BackSide;
  s.add(chambre);

  const plan = (w, h, mat, pos, vise) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(vise[0], vise[1], vise[2]);
    s.add(m);
    return m;
  };

  if (jour) {
    /* une verriere : tres large, haute, presque neutre */
    plan(20, 12, bas(3.4, 3.3, 3.1), [-3.0, 7.4, 2.2], [0, 0, 0]);
    /* le mur clair d'en face, qui remplit les ombres */
    plan(16, 10, bas(0.82, 0.79, 0.73), [4.5, 0.5, -6.5], [0, 0, 0]);
    /* le sol mineral */
    plan(20, 20, bas(0.30, 0.285, 0.26), [0, -7.2, 0], [0, 1, 0]);
  } else {
    /* la boite a lumiere : le reflet principal, chaud et FORME */
    plan(9.5, 5.2, bas(2.95, 2.74, 2.42), [-5.4, 5.6, 4.2], [0, 0, 0]);
    /* un second panneau, tres faible : il evite le reflet unique sans
       remplir les ombres — c'est le creux qui fait le volume. */
    plan(4.2, 4.2, bas(0.20, 0.185, 0.155), [-1.2, 3.0, 6.4], [0, 0, 0]);
    /* LE RETOUR FROID. C'est lui, et lui seul, qui porte le bleu nuit de la
       palette : pose sur l'arete opposee a la boite a lumiere, il detache la
       silhouette du noir sans refroidir la piece entiere. Une teinte bleue
       mise dans le METAL aurait refroidi jusqu'aux hautes lumieres. */
    plan(1.3, 9.0, bas(0.50, 0.78, 1.35), [7.4, 1.2, -3.2], [0, 0, 0]);
    /* la carte de retour : juste assez pour que la tranche ne soit pas un
       trait noir, jamais assez pour eclairer le dessus. */
    plan(11, 6, bas(0.145, 0.118, 0.086), [0, -5.4, 3.0], [0, 0, 0]);
  }
  return s;
}

export function envTexture(renderer, mode) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = studio(mode);
  /* 0,035 de flou : assez pour lisser les aretes de la geometrie du studio,
     assez peu pour que la boite a lumiere garde ses bords. */
  const rt = pm.fromScene(sc, 0.035);
  pm.dispose();
  sc.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt;
}

/* =====================================================================
   3. LE TRAIT QUI S'ÉCRIT
   ---------------------------------------------------------------------
   `aT` = abscisse curviligne normalisée sur TOUT le jeu de polylignes, de
   sorte qu'un seul uniforme dessine l'ensemble dans l'ordre. `uTete` est la
   position de la tête, `uAvant` ce qu'il y a devant elle (0 = vierge),
   `uEclat` une surbrillance locale à la pointe.
   ===================================================================== */
export function jeuTrait() {
  return {
    tete: { value: 1 }, avant: { value: 1 }, voile: { value: 1 },
    eclat: { value: 0 }, flou: { value: 0.02 }, larg: { value: 1 },
  };
}

export function nuanceurTrait(mat, U, ruban) {
  mat.customProgramCacheKey = () => (ruban ? 'parc-trait-r' : 'parc-trait');
  mat.onBeforeCompile = s => {
    s.uniforms.uTete = U.tete; s.uniforms.uAvant = U.avant; s.uniforms.uVoile = U.voile;
    s.uniforms.uEclat = U.eclat; s.uniforms.uFlou = U.flou;
    s.vertexShader = 'attribute float aT;\nvarying float vT;\n' + s.vertexShader
      .replace('void main() {', 'void main() {\n\tvT = aT;');
    if (ruban) {
      s.uniforms.uLarg = U.larg;
      s.vertexShader = 'attribute vec3 aOff;\nuniform float uLarg;\n' + s.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += aOff * uLarg;');
    }
    s.fragmentShader = 'uniform float uTete;\nuniform float uAvant;\nuniform float uVoile;\nuniform float uEclat;\nuniform float uFlou;\nvarying float vT;\n' + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
\tfloat d = uTete - vT;
\tfloat allume = mix(uAvant, 1.0, smoothstep(-uFlou, 0.0, d));
\tfloat pointe = uEclat * exp(-abs(d) / max(uFlou, 1e-4) * 1.5);
\tdiffuseColor.a *= clamp(allume + pointe, 0.0, 1.0) * uVoile;
\tdiffuseColor.rgb *= 1.0 + 2.0 * pointe;`);
  };
  return mat;
}

/* polylignes plates [[x, y], …] -> LineSegments, abscisse continue.
   `haut(p)` donne la troisième coordonnée ; `pose` place le résultat. */
export function geoTrait(lignes, haut, lift = 0) {
  let total = 0;
  const longs = lignes.map(pts => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    total += L; return L;
  });
  total = total || 1;
  const pos = [], at = [];
  let cumul = 0;
  lignes.forEach((pts, li) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const t0 = (cumul + acc) / total;
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      pos.push(a[0], a[1], haut(a) + lift, b[0], b[1], haut(b) + lift);
      at.push(t0, (cumul + acc) / total);
    }
    cumul += longs[li];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  return g;
}

/* Ruban de halo posé sur des boucles fermées : deux sommets par point,
   l'extérieur poussé par `aOff` d'une largeur qui suit la distance. */
export function geoRuban(boucles, haut, largeur, lift = 0) {
  const aire = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
  let total = 0;
  const longs = boucles.map(pts => {
    let L = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    total += L; return L;
  });
  total = total || 1;
  const pos = [], off = [], at = [], col = [], idx = [];
  let cumul = 0, base = 0;
  boucles.forEach((pts, li) => {
    const n = pts.length;
    if (n < 3) { cumul += longs[li]; return; }
    const sgn = aire(pts) > 0 ? 1 : -1;          /* le halo sort TOUJOURS de la forme */
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = pts[k], a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n];
      let nx = sgn * (b[1] - a[1]), ny = -sgn * (b[0] - a[0]);
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      if (i > 0) { const q = pts[(i - 1) % n]; acc += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      const t = (cumul + acc) / total, h = haut(p) + lift;
      pos.push(p[0], p[1], h, p[0], p[1], h);
      off.push(0, 0, 0, nx * largeur, ny * largeur, 0);
      at.push(t, t);
      col.push(1, 1, 1, 0, 0, 0);
    }
    for (let i = 0; i < n; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    base += (n + 1) * 2;
    cumul += longs[li];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/* le tracé part du point le plus au nord : le contour se dessine depuis la
   Manche et descend, au lieu de démarrer au milieu d'une frontière. */
export function depuisLeNord(boucle) {
  let k = 0;
  for (let i = 1; i < boucle.length; i++) if (boucle[i][1] > boucle[k][1]) k = i;
  return k ? boucle.slice(k).concat(boucle.slice(0, k)) : boucle;
}

/* =====================================================================
   4. L'OMBRE DE CONTACT
   ===================================================================== */
let texOmbre = null;
export function textureOmbre() {
  if (texOmbre) return texOmbre;
  const S = 256, c = mkCanvas(S, S), g = c.getContext('2d');
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  /* la courbe compte plus que la couleur : une ombre réelle est très dense au
     contact et s'éteint vite, pas linéairement. */
  r.addColorStop(0.00, 'rgba(0,0,0,1)');
  r.addColorStop(0.18, 'rgba(0,0,0,.82)');
  r.addColorStop(0.42, 'rgba(0,0,0,.36)');
  r.addColorStop(0.70, 'rgba(0,0,0,.09)');
  r.addColorStop(1.00, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  texOmbre = new THREE.CanvasTexture(c);
  texOmbre.colorSpace = THREE.SRGBColorSpace;
  return texOmbre;
}

export function ombreContact(largeur, profondeur, opacite = 0.6) {
  const m = new THREE.MeshBasicMaterial({
    map: textureOmbre(), transparent: true, opacity: opacite,
    depthWrite: false, blending: THREE.NormalBlending, color: 0x000000,
  });
  const o = new THREE.Mesh(new THREE.PlaneGeometry(largeur, profondeur), m);
  o.renderOrder = -1;
  return o;
}

/* halo doux SOUS un objet qui flotte sans rien pour recevoir son ombre :
   ce n'est plus une ombre, c'est la lueur que l'objet renvoie au vide. */
export function halo(rayon, couleur, opacite) {
  const S = 128, c = mkCanvas(S, S), g = c.getContext('2d');
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0.00, 'rgba(255,255,255,1)');
  r.addColorStop(0.34, 'rgba(255,255,255,.30)');
  r.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({
    map: t, color: couleur, transparent: true, opacity: opacite,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const o = new THREE.Mesh(new THREE.PlaneGeometry(rayon * 2, rayon * 2), m);
  o.renderOrder = -2;
  return o;
}

/* =====================================================================
   5. BOÎTE AUX ARÊTES ADOUCIES
   ---------------------------------------------------------------------
   Une arête vive n'existe pas dans un objet fabriqué : c'est le premier
   signe qui trahit un rendu de synthèse. Un chanfrein d'un demi-millimètre
   suffit — il accroche la lumière, et l'objet devient un objet.
   ===================================================================== */
export function boiteAdoucie(w, h, d, rayon, seg = 3) {
  const segments = seg * 2 + 1;
  rayon = Math.min(w / 2, h / 2, d / 2, rayon);
  const g = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments).toNonIndexed();
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const boite = new THREE.Vector3(w, h, d).multiplyScalar(0.5).subScalar(rayon);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), hs = 0.5 / segments;
  for (let i = 0; i < pos.length; i += 3) {
    p.fromArray(pos, i); n.copy(p);
    n.x -= Math.sign(n.x) * hs; n.y -= Math.sign(n.y) * hs; n.z -= Math.sign(n.z) * hs; n.normalize();
    pos[i] = boite.x * Math.sign(p.x) + n.x * rayon;
    pos[i + 1] = boite.y * Math.sign(p.y) + n.y * rayon;
    pos[i + 2] = boite.z * Math.sign(p.z) + n.z * rayon;
    nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  return g;
}

/* =====================================================================
   6. LIBÉRATION
   ---------------------------------------------------------------------
   Ce qui fuit quand on l'oublie : les géométries, les matières, et les
   textures que les matières portent. Un `scene.clear()` ne libère RIEN —
   il ne fait que détacher. On descend donc l'arbre.
   ===================================================================== */
export function libererArbre(racine) {
  const vues = new Set();
  racine.traverse(o => {
    if (o.geometry && !vues.has(o.geometry)) { vues.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || vues.has(m)) continue;
      vues.add(m);
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && !vues.has(v)) { vues.add(v); v.dispose(); }
      }
      m.dispose();
    }
  });
  if (racine.parent) racine.parent.remove(racine);
}
