/* scenes/parcours/t4-decision.js · TABLEAU 04 — « Vous restez libre de décider »
   ==========================================================================
   LE SILENCE.

   Après la France, l'écrin et la balance, cette étape doit RETIRER. Un seul
   objet : la proposition écrite, posée à quelques millimètres au-dessus d'un
   socle de pierre. Rien d'autre n'entre dans le cadre.

   Le geste unique est la SIGNATURE, qui s'écrit. Elle n'est pas décorative :
   elle est le seul endroit de toute la section où quelque chose se produit
   plutôt que se révèle, et elle arrive à la fin parce que c'est là que la
   décision se prend. Le tracé est celui de `scenes/decide.js` — la même main,
   au même endroit du parcours ; on ne réinvente pas une signature maison.

   Aucun bouton, aucune alternative accepter / refuser, aucun montant. La
   liberté se dit par le calme et par l'espace, pas par une interface.

   API : creerDecision(ctx) -> Promise<tableau> */

import * as THREE from 'three';
import {
  clamp, lerp, smooth, easeOut, boiteAdoucie, ombreContact, halo,
  geoTrait, jeuTrait, nuanceurTrait, libererArbre,
} from './atelier.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const OR = 0xffcf7a;

/* la signature de scenes/decide.js — repère 400 × 130 */
const SIG_D = 'M26 92 C30 70,44 30,62 26 C78 24,72 58,56 80 C46 94,30 92,40 80 C52 66,80 68,96 78 C108 86,100 100,90 94 C82 88,94 74,112 76 C130 78,136 90,150 84 C162 78,166 70,178 74 C190 78,186 92,200 88 C214 84,212 40,226 36 C240 32,236 62,226 82 C220 94,236 94,252 86 C268 78,278 70,296 74 C312 78,308 92,326 88 C346 84,358 72,378 74 C390 76,394 80,398 78';

/* On échantillonne le tracé par le navigateur lui-même : `getPointAtLength`
   donne la courbe exacte, courbes de Bézier comprises, sans qu'on ait à
   réimplémenter quoi que ce soit. */
function pointsSignature(n = 260) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', SIG_D);
  svg.appendChild(p);
  document.body.appendChild(svg);
  const L = p.getTotalLength();
  const out = [];
  for (let i = 0; i <= n; i++) {
    const q = p.getPointAtLength(L * i / n);
    /* repère 400 × 130 -> coordonnées de la feuille, centrées */
    out.push([(q.x / 400 - 0.5) * 0.62, (0.5 - q.y / 130) * 0.135]);
  }
  svg.remove();
  return out;
}

export async function creerDecision(ctx) {
  const { A } = ctx;
  const groupe = new THREE.Group();
  const plan = new THREE.Group();
  groupe.add(plan);

  const matOr = new THREE.MeshStandardMaterial({ color: OR, metalness: 1.0, roughness: 0.20, envMapIntensity: 1.7 });
  const matPapier = new THREE.MeshStandardMaterial({ color: 0xdcd2ba, metalness: 0.0, roughness: 0.93, envMapIntensity: 0.42 });
  const matEncre = new THREE.MeshBasicMaterial({ color: 0x3a332a, transparent: true, opacity: 0.44 });
  /* la pierre : mate, presque sans reflet. C'est elle qui fait le silence —
     un socle brillant renverrait la lumière et relancerait la scène. */
  const matPierre = new THREE.MeshStandardMaterial({ color: 0x141313, metalness: 0.0, roughness: 0.92, envMapIntensity: 0.42 });

  /* ---------- le socle de pierre ---------- */
  const socle = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.08, 0.15, 128), matPierre);
  socle.position.y = -0.44;
  plan.add(socle);
  const filetSocle = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.0055, 8, 160), matOr);
  filetSocle.rotation.x = Math.PI / 2;
  filetSocle.position.y = -0.366;
  plan.add(filetSocle);

  /* ---------- la proposition, qui flotte ---------- */
  const doc = new THREE.Group();
  doc.position.set(0, 0.30, 0.05);
  doc.rotation.set(-0.94, 0.14, 0.05);
  plan.add(doc);

  const feuille = new THREE.Mesh(boiteAdoucie(0.90, 1.20, 0.0055, 0.0035, 1), matPapier);
  doc.add(feuille);

  /* le cartouche de titre : deux barres et un filet d'or. Aucune lettre —
     une fausse typographie se remarque, une composition de barres non. */
  const titre = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.030), matEncre);
  titre.position.set(-0.16, 0.47, 0.0035);
  doc.add(titre);
  const sousTitre = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.017), matEncre);
  sousTitre.position.set(-0.24, 0.425, 0.0035);
  doc.add(sousTitre);
  const filetTitre = new THREE.Mesh(new THREE.PlaneGeometry(0.70, 0.0035), matOr);
  filetTitre.position.set(0, 0.385, 0.0035);
  doc.add(filetTitre);

  for (let i = 0; i < 11; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.62 - (i % 4) * 0.10, 0.0125), matEncre);
    l.position.set(-0.02 + (i % 4) * 0.02, 0.30 - i * 0.055, 0.0035);
    doc.add(l);
  }

  /* ---------- LA SIGNATURE, qui s'écrit ---------- */
  const U = jeuTrait();
  U.avant.value = 0; U.tete.value = 0; U.flou.value = 0.03;
  const sig = pointsSignature();
  const matSig = nuanceurTrait(new THREE.LineBasicMaterial({
    color: 0x2c2418, transparent: true, depthWrite: false,
  }), U, false);
  const trait = new THREE.LineSegments(geoTrait([sig], () => 0, 0.0042), matSig);
  trait.position.set(0.04, -0.30, 0);
  doc.add(trait);
  const filetSig = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.0025), matOr);
  filetSig.position.set(0.04, -0.40, 0.0035);
  doc.add(filetSig);

  /* le sceau, pressé une fois la signature terminée */
  const sceau = new THREE.Group();
  sceau.position.set(0.28, -0.50, 0.004);
  doc.add(sceau);
  const disque = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.009, 40), matOr);
  disque.rotation.x = Math.PI / 2;
  sceau.add(disque);
  const losange = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), matOr);
  losange.position.z = 0.008;
  losange.scale.set(1, 1, 0.42);
  sceau.add(losange);

  /* ---------- la lumière qui descend ----------
     Un halo large au-dessus du socle, et un second très serré sur le
     document : deux couches, parce qu'une seule donne soit une tache, soit
     rien. Le mélange est additif : sur fond noir il ajoute, sur fond ivoire
     il disparaît — ce qui est exactement le comportement voulu. */
  const nappe = halo(1.55, 0xffe8c8, 0);
  nappe.rotation.x = -Math.PI / 2;
  nappe.position.set(0, -0.36, 0);
  plan.add(nappe);
  const faisceau = halo(0.70, 0xfff0d8, 0);
  faisceau.position.set(0, 0.10, -0.30);
  plan.add(faisceau);

  const ombre = ombreContact(1.35, 1.55, 0.78 * A.ombre);
  ombre.rotation.x = -Math.PI / 2;
  ombre.position.set(0, -0.362, 0.06);
  plan.add(ombre);

  /* +16 degres : le tableau du calme se regarde presque de face */
  plan.rotation.x = 0.28;

  /* ================= vie ================= */
  let entree = 0, poX = 0, poY = 0, px = 0, py = 0;
  const etat = {
    groupe,
    rayon: 1.15,   /* valeur de secours : le moteur la remplace par la mesure */
    entrer(p) {
      const dedans = 1 - Math.min(1, Math.abs(p));
      entree = Math.max(entree, smooth(clamp(dedans * 1.3, 0, 1)));
      const e = easeOut(entree, 2.2);

      /* LA SIGNATURE. Elle démarre tard — le document doit d'abord être là et
         lu. 0,38 -> 0,88 de l'entrée : une demi-course, ce qui donne à la
         main le temps d'écrire au lieu de tracer. */
      const s = clamp((entree - 0.38) / 0.50, 0, 1);
      U.tete.value = s; U.voile.value = smooth(clamp(s * 3, 0, 1));
      U.eclat.value = (s > 0.02 && s < 0.98) ? 0.45 : 0;

      /* le sceau se presse une fois la signature finie */
      const sc = smooth(clamp((entree - 0.86) / 0.14, 0, 1));
      sceau.scale.setScalar(0.35 + sc * 0.65);
      sceau.visible = sc > 0.01;
      disque.material.opacity = 1;

      /* LE DOCUMENT RECULE DOUCEMENT : la scène s'éloigne au lieu de
         s'imposer, et c'est ce retrait qui dit « à vous de voir ». */
      doc.position.z = 0.05 - 0.10 * e;
      doc.rotation.x = -0.94 + 0.05 * e;

      nappe.material.opacity = e * 0.15 * A.halo;
      faisceau.material.opacity = smooth(clamp((entree - 0.2) / 0.6, 0, 1)) * 0.10 * A.halo;
      ombre.material.opacity = e * 0.78 * A.ombre;

      plan.rotation.x = 0.28 + p * 0.06;
    },
    battre(t, dt) {
      px += (poX - px) * Math.min(1, dt * 2.2);
      py += (poY - py) * Math.min(1, dt * 2.2);
      plan.rotation.y = px * 0.12;
      /* le document flotte de trois millimètres. C'est peu, et c'est
         justement ce qui doit rester : plus, et il vole. */
      doc.position.y = 0.30 + Math.sin(t * 0.34) * 0.010;
      doc.rotation.z = 0.05 + Math.sin(t * 0.27) * 0.010 + px * 0.03;
    },
    pointeur(x, y) { poX = x; poY = y; },
    ambiance(k) {
      matPierre.color.setHex(k > 0.5 ? 0xcdc6b8 : 0x141313);
      matPierre.roughness = lerp(0.92, 0.86, k);
      matPapier.color.setHex(k > 0.5 ? 0xfdf9f0 : 0xf4ecd9);
      matEncre.opacity = lerp(0.44, 0.58, k);
      matSig.color.setHex(k > 0.5 ? 0x241d12 : 0x2c2418);
    },
    largeurEcran() {},
    liberer() { libererArbre(groupe); },
  };
  etat.ambiance(ctx.k);
  etat.entrer(1);
  return etat;
}
