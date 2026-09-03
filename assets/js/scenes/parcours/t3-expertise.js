/* scenes/parcours/t3-expertise.js · TABLEAU 03 — « Expertise & proposition »
   ==========================================================================
   LE TABLEAU LE PLUS TECHNIQUE, ET CELUI OÙ LA TECHNIQUE DOIT LE MOINS SE VOIR.

   Quatre objets, et surtout QUATRE PROFONDEURS — c'est la seule chose qui
   distingue une composition 3D d'une image de synthèse à plat :

       loupe        z = +0,95   premier plan, coupée par le bas du cadre
       bijou        z = +0,10   posé sur le plateau, il est le sujet
       balance      z =  0,00   le plan principal
       document     z = −0,70   en retrait, à gauche, dans l'ombre

   Quand la caméra descend, ces quatre plans se déplacent à quatre vitesses
   différentes. C'est de là que vient la profondeur — pas d'un flou, pas d'une
   ombre portée, pas d'un dégradé : de la perspective, qui est gratuite dès
   lors qu'on a vraiment mis les objets à des distances différentes.

   L'AFFICHEUR. C'est le seul endroit de toute la section où une texture est
   justifiée : des chiffres. Elle est dessinée à 512 × 160 pour un plan de
   quelques centimètres, donc largement au-dessus de toute densité d'écran.
   Aucun HUD, aucune interface : un afficheur de balance, ambre sur noir,
   comme celui qui est réellement posé sur la table.

   Le poids affiché est une valeur d'illustration (126,0 g) : ce tableau ne
   dit aucun prix, ne promet aucun montant et ne lit aucune donnée.

   API : creerExpertise(ctx) -> Promise<tableau> */

import * as THREE from 'three';
import { clamp, lerp, smooth, easeOut, easeInOut, boiteAdoucie, ombreContact, halo, libererArbre } from './atelier.js';

const OR = 0xffcf7a;
const OR_PALE = 0xf0dcb4;
const POIDS = 126.0;                 /* grammes affichés — illustration, aucun montant */

function afficheurTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  return { canvas: c, ctx: c.getContext('2d') };
}
function peindreAfficheur(t, valeur) {
  const g = t.ctx, W = 512, H = 160;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#07070a'; g.fillRect(0, 0, W, H);
  g.font = '600 92px "Jost", ui-monospace, monospace';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillStyle = '#ffab3d';
  g.shadowColor = '#ff9b22'; g.shadowBlur = 22;
  g.fillText(valeur.toFixed(1), 396, 84);
  g.shadowBlur = 0;
  g.font = '500 44px "Jost", ui-sans-serif, sans-serif';
  g.fillStyle = '#c9762a';
  g.fillText('g', 452, 92);
}

export async function creerExpertise(ctx) {
  const { A } = ctx;
  const groupe = new THREE.Group();
  const plan = new THREE.Group();
  groupe.add(plan);

  const matOr = new THREE.MeshStandardMaterial({ color: OR, metalness: 1.0, roughness: 0.20, envMapIntensity: 1.75 });
  const matOrMat = new THREE.MeshStandardMaterial({ color: OR_PALE, metalness: 1.0, roughness: 0.44, envMapIntensity: 1.25 });
  /* inox brossé : la rugosité anisotrope n'existe pas ici sans anisotropy,
     mais 0,34 suffit à distinguer l'acier de l'or au premier coup d'œil. */
  const matInox = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.98, roughness: 0.34, envMapIntensity: 1.5 });
  const matCorps = new THREE.MeshPhysicalMaterial({
    color: 0x1a1b1f, metalness: 0.35, roughness: 0.42,
    clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 1.0,
  });
  const matPapier = new THREE.MeshStandardMaterial({ color: 0xcfc4ab, metalness: 0.0, roughness: 0.94, envMapIntensity: 0.38 });
  const matEncre = new THREE.MeshBasicMaterial({ color: 0x3a332a, transparent: true, opacity: 0.5 });
  const matVerre = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8e4, metalness: 0.0, roughness: 0.02, transparent: true, opacity: 0.07,
    envMapIntensity: 3.4, depthWrite: false, side: THREE.DoubleSide,
  });

  /* ---------- LA BALANCE (plan principal, z = 0) ---------- */
  const balance = new THREE.Group();
  balance.position.set(0.05, -0.30, 0);
  plan.add(balance);

  const corps = new THREE.Mesh(boiteAdoucie(1.30, 0.30, 0.94, 0.035, 3), matCorps);
  corps.position.y = 0.15;
  balance.add(corps);
  /* les quatre pieds : sans eux, la balance a l'air posée à même le vide */
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pied = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.032, 20), matCorps);
    pied.position.set(sx * 0.55, 0.014, sz * 0.38);
    balance.add(pied);
  }
  const plateau = new THREE.Mesh(boiteAdoucie(1.14, 0.030, 0.80, 0.010, 2), matInox);
  plateau.position.y = 0.316;
  balance.add(plateau);
  const rebord = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.008, 10, 96), matOrMat);
  rebord.rotation.x = Math.PI / 2;
  rebord.position.y = 0.333;
  rebord.scale.set(1.12, 0.80, 1);
  balance.add(rebord);

  /* l'afficheur, incliné vers le lecteur */
  const tex = afficheurTexture();
  peindreAfficheur(tex, 0);
  const texture = new THREE.CanvasTexture(tex.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const matEcran = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.125), matEcran);
  ecran.position.set(0.34, 0.155, 0.474);
  ecran.rotation.x = -0.12;
  balance.add(ecran);
  const cadreEcran = new THREE.Mesh(boiteAdoucie(0.44, 0.165, 0.014, 0.006, 2), matCorps);
  cadreEcran.position.set(0.34, 0.155, 0.468);
  balance.add(cadreEcran);

  /* ---------- LE BIJOU (z = +0,10, posé sur le plateau) ----------
     Un bracelet à maillons plutôt qu'une forme abstraite : c'est ce qu'on
     apporte réellement à une journée d'expertise. Onze maillons suffisent —
     au-delà on ne compte plus, on voit seulement de l'or. */
  const bijou = new THREE.Group();
  bijou.position.set(-0.10, 0.34, 0.10);
  balance.add(bijou);
  /* fins, et rapproches : a 0,016 de section les maillons lisaient comme des
     macaronis. Une chaine se reconnait a la FINESSE du fil, pas au nombre. */
  const geoMaillon = new THREE.TorusGeometry(0.048, 0.0105, 10, 26);
  for (let i = 0; i < 11; i++) {
    const a = i / 10;
    const m = new THREE.Mesh(geoMaillon, matOr);
    /* une courbe ouverte, comme une chaîne qu'on vient de déposer */
    m.position.set(-0.26 + a * 0.52, 0.016 + Math.sin(a * Math.PI) * 0.014, Math.sin(a * Math.PI * 1.15) * 0.13 - 0.04);
    m.rotation.set(Math.PI / 2, (i % 2) * Math.PI / 2, a * 0.5 - 0.25);
    bijou.add(m);
  }
  const bagueB = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.018, 14, 48), matOr);
  bagueB.position.set(0.30, 0.020, 0.12);
  bagueB.rotation.x = Math.PI / 2 - 0.10;
  bijou.add(bagueB);

  /* ---------- LE DOCUMENT (z = −0,70, en retrait, à gauche) ---------- */
  const doc = new THREE.Group();
  doc.position.set(-1.02, -0.285, -0.52);
  /* couche a plat, face imprimee vers le haut : +PI/2, pas -PI/2 — sinon on
     lit le dos de la feuille. */
  doc.rotation.set(-Math.PI / 2 + 0.05, 0, 0.30);
  plan.add(doc);
  const feuille = new THREE.Mesh(boiteAdoucie(0.86, 1.14, 0.006, 0.004, 1), matPapier);
  doc.add(feuille);
  /* les lignes de texte : des barres, jamais des lettres. Une fausse
     typographie illisible se remarque immédiatement ; des lignes non. */
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.52 - (i % 3) * 0.11, 0.016), matEncre);
    l.position.set(-0.10 + (i % 3) * 0.02, 0.30 - i * 0.075, 0.0035);
    doc.add(l);
  }
  const titreDoc = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.028), matEncre);
  titreDoc.position.set(-0.18, 0.44, 0.0035);
  doc.add(titreDoc);
  const sceau = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.010, 32), matOr);
  sceau.rotation.x = Math.PI / 2;
  sceau.position.set(0.24, -0.42, 0.008);
  doc.add(sceau);

  /* ---------- LA LOUPE (z = +0,95, premier plan) ---------- */
  const loupe = new THREE.Group();
  loupe.position.set(1.00, -0.26, 0.95);
  loupe.rotation.set(-0.30, -0.30, -0.42);
  plan.add(loupe);
  loupe.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.023, 18, 96), matOr));
  const lent = new THREE.Mesh(new THREE.SphereGeometry(0.34, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.28), matVerre);
  lent.rotation.x = -Math.PI / 2; lent.scale.set(1, 0.38, 1);
  loupe.add(lent);
  const lent2 = lent.clone(); lent2.rotation.x = Math.PI / 2;
  loupe.add(lent2);
  const manche = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.026, 0.60, 20), matOr);
  manche.position.y = -0.62;
  loupe.add(manche);

  /* ---------- ombres de contact ---------- */
  const ombres = [];
  for (const [x, z, l, p, o] of [[0.05, 0, 2.10, 1.60, 0.80], [-1.02, -0.52, 1.20, 1.45, 0.50]]) {
    const om = ombreContact(l, p, o * A.ombre);
    om.rotation.x = -Math.PI / 2;
    om.position.set(x, -0.302, z);
    plan.add(om);
    ombres.push([om, o]);
  }
  const nappe = halo(1.7, 0xffe6c4, 0);
  nappe.rotation.x = -Math.PI / 2;
  nappe.position.set(0, -0.30, 0.05);
  plan.add(nappe);

  /* LE SIGNE DE LA BASCULE. Une rotation autour de X envoie (0,1,0) sur
     (0, cos, sin) : pour qu'une face superieure regarde la camera, qui est
     en +Z, il faut sin > 0, donc un angle POSITIF. Ce tableau est construit
     Y-en-haut ; il basculait a l'envers et on voyait la face avant de la
     balance au lieu de son plateau. (Le tableau 01, lui, est construit a
     plat dans XY, sa normale est deja +Z : il demande bien un angle
     negatif. Deux conventions, deux signes.) */
  plan.rotation.x = 0.46;

  /* ================= vie ================= */
  let entree = 0, poX = 0, poY = 0, px = 0, py = 0, affiche = -1;
  const etat = {
    groupe,
    rayon: 1.65,   /* valeur de secours : le moteur la remplace par la mesure */
    entrer(p) {
      const dedans = 1 - Math.min(1, Math.abs(p));
      entree = Math.max(entree, smooth(clamp(dedans * 1.3, 0, 1)));
      const e = easeOut(entree, 2.2);

      /* LE BIJOU SE POSE. Il descend de 6 cm et s'immobilise : la balance ne
         « réagit » pas par un rebond — une balance de précision est amortie,
         c'est justement ce qui en fait un instrument. */
      const pose = easeOut(clamp((entree - 0.05) / 0.5, 0, 1), 2.6);
      bijou.position.y = 0.34 + (1 - pose) * 0.075;

      /* L'AFFICHEUR compte, une fois le plateau calme. Arrondi au dixième :
         on ne redessine la texture que lorsque le chiffre CHANGE. */
      const compte = easeInOut(clamp((entree - 0.42) / 0.42, 0, 1));
      const v = Math.round(POIDS * compte * 10) / 10;
      if (v !== affiche) { affiche = v; peindreAfficheur(tex, v); texture.needsUpdate = true; }

      /* LA LOUPE GLISSE de quelques centimètres — pas plus. */
      loupe.position.x = 1.02 - 0.10 * e;
      doc.position.x = -1.02 + 0.05 * e;

      nappe.material.opacity = e * 0.14 * A.halo;
      for (const [om, o] of ombres) om.material.opacity = e * o * A.ombre;

      /* LA CAMÉRA DESCEND un peu quand on traverse le tableau : on passe du
         regard debout au regard penché sur l'objet. */
      plan.rotation.x = 0.46 + p * 0.095;
    },
    battre(t, dt) {
      px += (poX - px) * Math.min(1, dt * 2.4);
      py += (poY - py) * Math.min(1, dt * 2.4);
      plan.rotation.y = px * 0.15;
      /* les quatre plans ne respirent pas à la même vitesse : c'est la
         différence de vitesse, et elle seule, qui fait la profondeur. */
      loupe.position.y = -0.26 + Math.sin(t * 0.47) * 0.020 + py * 0.05;
      loupe.rotation.z = -0.42 + Math.sin(t * 0.31) * 0.020;
      doc.position.y = -0.285 + Math.sin(t * 0.39 + 2.0) * 0.006;
      bijou.rotation.y = Math.sin(t * 0.23) * 0.030;
    },
    pointeur(x, y) { poX = x; poY = y; },
    ambiance(k) {
      matCorps.color.setHex(k > 0.5 ? 0x35363c : 0x1a1b1f);
      matCorps.clearcoatRoughness = lerp(0.22, 0.30, k);
      matPapier.color.setHex(k > 0.5 ? 0xfbf6ea : 0xefe6d2);
      matEncre.opacity = lerp(0.5, 0.62, k);
      matVerre.opacity = lerp(0.18, 0.28, k);
      matInox.roughness = lerp(0.34, 0.40, k);
      /* l'afficheur ne suit pas le ton de la page : un afficheur ambre reste
         ambre en plein jour, c'est une DEL, pas une encre. */
    },
    largeurEcran() {},
    liberer() { texture.dispose(); libererArbre(groupe); },
  };
  etat.ambiance(ctx.k);
  etat.entrer(1);
  return etat;
}
