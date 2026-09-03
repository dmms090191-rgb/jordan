/* scenes/parcours/t2-rencontre.js · TABLEAU 02 — « Rencontrez votre expert »
   ==========================================================================
   CE QU'ON NE MONTRE PAS.

   Il n'y a ni bureau, ni hôtel, ni personne assise. La rencontre est dite par
   ce qu'un expert vient de POSER : un écrin qu'on a ouvert, une bague qu'on y
   a laissée debout, une loupe reposée à côté. Trois objets, pas quinze — le
   luxe tient à ce qu'on retire.

   La présence humaine passe entièrement par la mise en place : un écrin ne
   s'ouvre pas tout seul, une loupe ne se pose pas à plat sur sa lentille.
   C'est le seul récit dont cette étape a besoin.

   AU DÉFILEMENT : le couvercle achève de s'ouvrir, la bague pivote de
   quelques degrés et son poinçon passe dans la lumière. Rien d'autre ne
   bouge — une seule chose change à la fois, sinon on ne regarde plus rien.

   API : creerRencontre(ctx) -> Promise<tableau> */

import * as THREE from 'three';
import { clamp, lerp, smooth, easeOut, boiteAdoucie, ombreContact, halo, libererArbre } from './atelier.js';

/* L'OR N'EST PAS UNE COULEUR DE CHARTE, C'EST UNE RÉFLECTANCE.
   L'or métallique réfléchit (1,00 · 0,77 · 0,34) en lumière linéaire — c'est
   une constante physique, elle ne change pas entre le jour et la nuit. Seul
   l'éclairage change. On ne l'interpole donc pas d'une ambiance à l'autre :
   un or qui change de couleur avec le thème cesse d'être de l'or. */
const OR = 0xffcf7a;
const OR_PALE = 0xf0dcb4;

export async function creerRencontre(ctx) {
  const { A } = ctx;
  const groupe = new THREE.Group();
  const table = new THREE.Group();
  groupe.add(table);

  const matOr = new THREE.MeshStandardMaterial({ color: OR, metalness: 1.0, roughness: 0.21, envMapIntensity: 1.7 });
  const matOrMat = new THREE.MeshStandardMaterial({ color: OR_PALE, metalness: 1.0, roughness: 0.42, envMapIntensity: 1.3 });
  /* laque noire de piano : la couleur ne fait rien, c'est le VERNIS qui
     redessine la silhouette sur fond noir. Sans clearcoat, l'écrin
     disparaîtrait purement et simplement dans la page. */
  const matLaque = new THREE.MeshPhysicalMaterial({
    color: 0x14131a, metalness: 0.0, roughness: 0.22,
    clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
  });
  const matVelours = new THREE.MeshStandardMaterial({ color: 0x1c130e, metalness: 0.0, roughness: 0.98, envMapIntensity: 0.18 });
  const matVerre = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8e4, metalness: 0.0, roughness: 0.02,
    transparent: true, opacity: 0.08, envMapIntensity: 3.4,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const matSocle = new THREE.MeshStandardMaterial({ color: 0x100f0e, metalness: 0.0, roughness: 0.94, envMapIntensity: 0.28 });

  /* ---------- le socle, presque invisible ----------
     Un disque très sombre et très mat : il ne se voit pas, mais il reçoit les
     ombres de contact et il donne aux objets un SOL. Sans lui, trois objets
     alignés dans le vide flottent sans raison. */
  const socle = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.19, 0.048, 96), matSocle);
  socle.position.y = -0.34;
  table.add(socle);
  const bordSocle = new THREE.Mesh(new THREE.TorusGeometry(1.14, 0.005, 8, 128), matOrMat);
  bordSocle.rotation.x = Math.PI / 2;
  bordSocle.position.y = -0.313;
  table.add(bordSocle);

  /* ---------- l'écrin ---------- */
  const ecrin = new THREE.Group();
  ecrin.position.set(-0.36, -0.30, 0.12);
  table.add(ecrin);

  const LB = 0.86, PB = 0.62, HB = 0.24;
  const cuve = new THREE.Mesh(boiteAdoucie(LB, HB, PB, 0.028, 3), matLaque);
  cuve.position.y = HB / 2;
  ecrin.add(cuve);
  /* le velours : légèrement en creux, pour que l'intérieur ne soit pas un
     couvercle plat de couleur différente. */
  const velours = new THREE.Mesh(new THREE.BoxGeometry(LB - 0.075, 0.012, PB - 0.075), matVelours);
  velours.position.y = HB - 0.03;
  ecrin.add(velours);
  /* le filet d'or au bord de la cuve — c'est lui qui dit « pièce montée » */
  const filetCuve = new THREE.Mesh(new THREE.BoxGeometry(LB - 0.04, 0.004, PB - 0.04), matOr);
  filetCuve.position.y = HB - 0.006;
  ecrin.add(filetCuve);

  const couvercle = new THREE.Group();
  couvercle.position.set(0, HB, -PB / 2);
  ecrin.add(couvercle);
  const capot = new THREE.Mesh(boiteAdoucie(LB, 0.055, PB, 0.022, 2), matLaque);
  capot.position.set(0, 0.028, PB / 2);
  couvercle.add(capot);
  const doublure = new THREE.Mesh(new THREE.BoxGeometry(LB - 0.075, 0.008, PB - 0.075), matVelours);
  doublure.position.set(0, -0.004, PB / 2);
  couvercle.add(doublure);
  /* la charnière : deux cylindres d'or, visibles seulement quand le couvercle
     s'ouvre. C'est le détail qui fait qu'on croit à l'objet. */
  for (const s of [-1, 1]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.10, 16), matOr);
    ch.rotation.z = Math.PI / 2;
    ch.position.set(s * (LB / 2 - 0.09), 0, 0);
    couvercle.add(ch);
  }

  /* ---------- la bague, debout dans son logement ---------- */
  const bague = new THREE.Group();
  bague.position.set(-0.17, HB - 0.028, 0.03);
  ecrin.add(bague);
  const anneau = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.021, 20, 96), matOr);
  anneau.position.y = 0.115;
  bague.add(anneau);
  /* le chaton, et le POINÇON dessus : une facette minuscule, plus mate, qui
     ne se lit que lorsqu'elle passe dans l'axe de la lumière. */
  const chaton = new THREE.Mesh(boiteAdoucie(0.075, 0.052, 0.030, 0.008, 2), matOr);
  chaton.position.y = 0.115 + 0.115;
  bague.add(chaton);
  const poincon = new THREE.Mesh(new THREE.CircleGeometry(0.016, 6), matOrMat);
  poincon.position.set(0, 0.115 + 0.115, 0.0152);
  bague.add(poincon);

  /* ---------- la loupe, reposée sur sa monture ---------- */
  const loupe = new THREE.Group();
  loupe.position.set(0.66, -0.06, 0.62);
  /* redressee : couchee, une loupe ne montre ni sa lentille ni son manche,
     et se lit comme un dome de verre pose la sans raison. */
  loupe.rotation.set(-1.16, 0.30, 0.34);
  table.add(loupe);
  const monture = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.020, 18, 96), matOr);
  loupe.add(monture);
  const lentille = new THREE.Mesh(new THREE.SphereGeometry(0.30, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.30), matVerre);
  lentille.rotation.x = -Math.PI / 2;
  lentille.scale.set(1, 0.42, 1);
  loupe.add(lentille);
  const lentille2 = lentille.clone();
  lentille2.rotation.x = Math.PI / 2;
  loupe.add(lentille2);
  const manche = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.024, 0.52, 20), matOr);
  manche.position.set(0, -0.55, 0);
  loupe.add(manche);
  const embout = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 14), matOr);
  embout.position.set(0, -0.81, 0);
  loupe.add(embout);

  /* ---------- les ombres de contact ---------- */
  const ombres = [];
  for (const [x, z, l, p, o] of [[-0.36, 0.12, 1.30, 0.98, 0.72], [0.66, 0.62, 0.70, 0.70, 0.44]]) {
    const om = ombreContact(l, p, o * A.ombre);
    om.rotation.x = -Math.PI / 2;
    om.position.set(x, -0.303, z);
    table.add(om);
    ombres.push([om, o]);
  }

  /* la lumière qui tombe : un halo très large au-dessus de la scène, pour que
     la table ait une source visible plutôt qu'un éclairage venu de nulle part */
  const nappe = halo(1.5, 0xffe6c4, 0.0);
  nappe.rotation.x = -Math.PI / 2;
  nappe.position.set(-0.1, -0.30, 0.05);
  table.add(nappe);

  /* +24 degres : voir la note sur le signe dans t3-expertise.js */
  table.rotation.x = 0.42;

  /* ================= vie ================= */
  let entree = 0, poX = 0, poY = 0, px = 0, py = 0;
  const etat = {
    groupe,
    rayon: 1.35,   /* valeur de secours : le moteur la remplace par la mesure */
    entrer(p) {
      const dedans = 1 - Math.min(1, Math.abs(p));
      entree = Math.max(entree, smooth(clamp(dedans * 1.3, 0, 1)));
      const e = easeOut(entree, 2.4);

      /* LE COUVERCLE. Il part déjà entrouvert : un écrin fermé qui s'ouvre au
         défilement serait une animation ; un écrin qu'on achève d'ouvrir est
         un geste. 58° -> 74°, seize degrés en tout. */
      couvercle.rotation.x = -(0.58 + 0.16 * e) * Math.PI;

      /* LA BAGUE pivote de neuf degrés et son poinçon entre dans l'axe. */
      bague.rotation.y = -0.30 + 0.46 * e;
      poincon.material.roughness = lerp(0.42, 0.26, e);

      nappe.material.opacity = e * 0.13 * A.halo;
      for (const [om, o] of ombres) om.material.opacity = e * o * A.ombre;

      /* la caméra du tableau bascule très peu : c'est la scène qui s'ouvre */
      table.rotation.x = 0.42 + p * 0.075;
    },
    battre(t, dt) {
      px += (poX - px) * Math.min(1, dt * 2.4);
      py += (poY - py) * Math.min(1, dt * 2.4);
      table.rotation.y = px * 0.16;
      /* la loupe respire un peu plus que le reste : elle est au premier plan,
         c'est elle qui porte la parallaxe. */
      loupe.position.y = -0.276 + Math.sin(t * 0.51) * 0.012;
      loupe.rotation.z = 0.18 + Math.sin(t * 0.37) * 0.022 + px * 0.05;
      bague.position.y = (0.24 - 0.012) + Math.sin(t * 0.43 + 1.1) * 0.005;
    },
    pointeur(x, y) { poX = x; poY = y; },
    ambiance(k) {
      /* l'or ne bouge pas. La laque, si : sur fond ivoire, un noir de piano
         devient un trou. On la remonte au graphite. */
      matLaque.color.setHex(k > 0.5 ? 0x2b2a30 : 0x14131a);
      matLaque.clearcoatRoughness = lerp(0.06, 0.10, k);
      matVelours.color.setHex(k > 0.5 ? 0x4a3a2c : 0x2a1f18);
      matSocle.color.setHex(k > 0.5 ? 0xc9c2b4 : 0x191817);
      matSocle.roughness = lerp(0.88, 0.80, k);
      matVerre.opacity = lerp(0.20, 0.30, k);
    },
    largeurEcran() {},
    liberer() { libererArbre(groupe); },
  };
  etat.ambiance(ctx.k);
  etat.entrer(1);
  return etat;
}
