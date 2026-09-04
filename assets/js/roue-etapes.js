/* La Compagnie de l'Or · Accueil — LE PARCOURS EN QUATRE ÉTAPES
   Roue cylindrique de huit plaques de verre. Voir assets/css/roue-etapes.css
   pour la géométrie et le raisonnement.

   Module autonome : il ne touche à rien d'autre sur la page et ne s'exécute
   que si la section et sa liste source existent. Aucune dépendance, aucun
   contexte WebGL, aucune boucle d'animation — la rotation est une transition
   CSS, donc composée par le navigateur et gratuite au repos.

   LE PRINCIPE, EN UNE PHRASE : les huit plaques ont des angles FIXES écrits
   en CSS, et le script n'écrit qu'une seule chose au monde — l'angle du
   cylindre. C'est la seule façon d'avoir un espacement identique à chaque
   image : en animant les plaques une à une, leurs trajectoires se croisent
   et elles se rapprochent au passage.                                        */

const ETAPES = 4;         /* étapes réelles — ce que voit l'utilisateur */
const N      = 8;         /* plaques de la roue : deux tours de quatre.
                             Doit rester un multiple de 4 pour que la
                             correspondance plaque -> étape retombe juste. */
const PAS    = 360 / N;   /* 45 degrés */
const GARDE  = 240;       /* ms minimum entre deux crans */

export function initRoueEtapes(section) {
  const src = section.querySelector('.roue-src');
  const cyl = section.querySelector('.roue-cyl');
  const pivot = section.querySelector('.roue-pivot');
  const scene = section.querySelector('.roue-scene');
  const nom = section.querySelector('.roue-legende__nom');
  const prog = section.querySelector('.roue-legende__prog b');
  const points = section.querySelector('.roue-points');
  if (!src || !cyl || !pivot || !scene || !nom || !prog || !points) return null;

  const source = [...src.querySelectorAll(':scope > li')];
  if (source.length !== ETAPES) return null;
  const NOMS = source.map(li => li.querySelector('h3').textContent.trim());

  /* ---- L'ANGLE DE CHAQUE PLAQUE ----
     Écrit une fois, en CSS, jamais retouché. C'est ce qui rend la roue
     rigide : la position d'une plaque ne dépend d'aucune valeur que le
     script remet à jour. */
  const regles = document.createElement('style');
  regles.textContent = Array.from({ length: N }, (_, k) =>
    '#etapes .roue-plaque[data-i="' + k + '"]{transform:translate(0,-50%) rotateY(' +
    (k * PAS) + 'deg) translateZ(var(--r))}').join('\n');
  document.head.append(regles);

  /* ---- FABRICATION DE LA ROUE ----
     Les quatre <li> de la liste source deviennent huit plaques. Le contenu
     n'est écrit qu'une fois dans le document ; les copies n'existent que
     dans le DOM, à l'exécution, et la roue entière est aria-hidden — un
     lecteur d'écran ne rencontre donc jamais huit étapes. */
  const frag = document.createDocumentFragment();
  for (let k = 0; k < N; k++) {
    const p = document.createElement('div');
    p.className = 'roue-plaque';
    p.dataset.i = k;
    p.dataset.etape = k % ETAPES;
    const art = document.createElement('article');
    art.className = 'roue-verre';
    art.innerHTML = source[k % ETAPES].innerHTML;
    p.append(art);
    frag.append(p);
  }
  cyl.append(frag);
  const plaques = [...cyl.children];

  /* ---- LA POSITION ----
     Un entier LIBRE, jamais ramené modulo. C'est ce qui rend le passage
     04 → 01 identique à 01 → 02 : la roue avance toujours d'un cran de
     45 degrés dans le même sens, elle ne revient jamais en arrière de trois
     quarts de tour. Un index borné produirait exactement le retour brutal
     qu'on veut éviter. L'angle croît donc indéfiniment. */
  let pos = 0, dernier = -1e9;
  const etape = () => ((pos % ETAPES) + ETAPES) % ETAPES;

  /* les points de navigation — QUATRE, jamais huit */
  NOMS.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'roue-pt'; b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', 'Étape ' + String(i + 1).padStart(2, '0') + ' — ' + n);
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => versEtape(i));
    points.append(b);
  });

  function rendre() {
    /* LA SEULE CHOSE QUE LE SCRIPT ÉCRIT : un angle. Le recul du rayon est
       en CSS, les angles des plaques sont en CSS. Il ne peut donc pas y
       avoir de déplacement individuel de plaque. */
    cyl.style.transform = 'rotateY(' + (-pos * PAS) + 'deg)';

    const i = ((pos % N) + N) % N;      /* la plaque qui vient de face */
    plaques.forEach((p, k) => {
      let d = ((k - i) % N + N) % N;
      if (d > N / 2) d -= N;            /* rang angulaire signé */
      const a = Math.abs(d);
      p.className = 'roue-plaque'
        + (a <= 4 ? ' r' + a : '')
        + (d === -1 ? ' avant' : '') + (d === 1 ? ' apres' : '');
      /* le contenu des plaques de côté sort du parcours de tabulation :
         sinon le clavier emmène dans une plaque qu'on ne voit pas */
      p.querySelectorAll('a,button').forEach(e => { e.tabIndex = d === 0 ? 0 : -1; });
    });

    const e = etape();
    nom.textContent = NOMS[e];
    prog.textContent = String(e + 1).padStart(2, '0');
    [...points.children].forEach((b, k) => b.setAttribute('aria-current', String(k === e)));
  }

  /* ---- AVANCER D'UN CRAN ----
     Pas de verrou long : on autorise un nouveau cran toutes les 240 ms, et
     la transition CSS repart de la valeur interpolée courante. Cliquer trois
     fois de suite fait donc tourner la roue en continu, comme une vraie roue
     lancée — au lieu d'ignorer les deux derniers clics. */
  function cran(sens) {
    const t = performance.now();
    if (t - dernier < GARDE) return;
    dernier = t; pos += sens; rendre();
  }
  /* aller à une étape par le plus court chemin : de 04 à 01 on AVANCE d'un
     cran, on ne remonte pas trois crans */
  function versEtape(cible) {
    let d = (cible - etape() + ETAPES) % ETAPES;
    if (d > ETAPES / 2) d -= ETAPES;
    if (!d) return;
    const t = performance.now();
    if (t - dernier < GARDE) return;
    dernier = t; pos += d; rendre();
  }

  section.querySelector('.roue-fl--prec').addEventListener('click', () => cran(-1));
  section.querySelector('.roue-fl--suiv').addEventListener('click', () => cran(1));
  scene.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); cran(1); }
    if (ev.key === 'ArrowLeft')  { ev.preventDefault(); cran(-1); }
  });

  const mobile = () => matchMedia('(max-width:760px)').matches;

  /* ---- LA MOLETTE ----
     La roue tourne quand on passe devant, mais elle ne confisque JAMAIS le
     défilement : l'écouteur est passif et n'appelle pas preventDefault. Sur
     le prototype il le faisait — acceptable sur une page d'essai qui ne
     contient que ça, pas sur une page d'accueil où l'on doit pouvoir
     traverser la section sans être retenu. */
  let cumul = 0, dernierD = 0;
  scene.addEventListener('wheel', ev => {
    if (mobile()) return;
    const t = performance.now();
    if (t - dernierD > 260) cumul = 0;
    dernierD = t; cumul += ev.deltaY;
    if (Math.abs(cumul) > 90) { cran(cumul > 0 ? 1 : -1); cumul = 0; }
  }, { passive: true });

  /* ---- LE GLISSÉ ----
     Un seul chemin pour la souris, le doigt et le stylet : les événements
     Pointer couvrent les trois. La version précédente écoutait à la fois
     pointerup ET touchend — sur un écran tactile les deux se déclenchent, et
     la roue avançait de deux crans pour un seul geste.

     La roue suit le doigt EN DIRECT, puis se cale sur le cran le plus
     proche. Ce n'est toujours que le cylindre qui tourne : on écrit un
     angle, jamais une position de plaque — la rigidité tient pendant le
     glissé comme pendant un cran.

     VERROU D'AXE : tant que le geste n'a pas montré sa direction, on ne
     décide rien. Passé 10 px, s'il est plus vertical qu'horizontal on
     l'abandonne — c'est la page qui défile, la roue ne doit pas broncher.
     C'est ce verrou, avec touch-action:pan-y sur la scène, qui empêche un
     petit mouvement vertical de faire tourner la roue par accident. */
  const GAIN = 1.9;               /* un demi-écran de glissé ≈ un cran */
  let idPt = null, gx = 0, gy = 0, axe = null, base = 0, glisse = false;
  const largeurScene = () => scene.getBoundingClientRect().width || 1;

  scene.addEventListener('pointerdown', ev => {
    if (idPt !== null || ev.button > 0) return;
    idPt = ev.pointerId; gx = ev.clientX; gy = ev.clientY;
    axe = null; base = pos; glisse = false;
  });
  scene.addEventListener('pointermove', ev => {
    if (ev.pointerId !== idPt) return;
    const dx = ev.clientX - gx, dy = ev.clientY - gy;
    if (axe === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      axe = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (axe !== 'h') return;
      glisse = true;
      try { scene.setPointerCapture(idPt); } catch (e) {}
      cyl.style.transition = 'none';
    }
    if (axe !== 'h') return;
    cyl.style.transform =
      'rotateY(' + (-(base * PAS) + (dx / largeurScene()) * PAS * GAIN) + 'deg)';
  });
  /* fin du geste : on rend la main à la courbe de la feuille, puis on cale */
  const rendreLaMain = () => {
    cyl.style.transition = '';
    void cyl.offsetWidth;   /* la transition doit être ACTIVE avant l'écriture
                               du nouvel angle, sinon le calage serait sec */
  };
  scene.addEventListener('pointerup', ev => {
    if (ev.pointerId !== idPt) return;
    const dx = ev.clientX - gx;
    idPt = null;
    if (axe !== 'h') { axe = null; return; }
    axe = null; glisse = false;
    rendreLaMain();
    const frac = -(dx / largeurScene()) * GAIN;   /* en crans, positif = avancer */
    let d = Math.round(frac);
    /* un geste court mais franc vaut un cran : sans cela il faudrait
       traverser un quart d'écran pour changer d'étape */
    if (!d && Math.abs(frac) > .16) d = frac > 0 ? 1 : -1;
    pos = base + Math.max(-2, Math.min(2, d));    /* jamais plus de deux crans */
    dernier = performance.now();
    rendre();
    /* le glissé n'emprunte pas cran() : il faut réarmer le minuteur ici aussi,
       sinon une carte amenée au doigt repartirait dans la foulée */
    armer();
  });
  /* Le navigateur annule le pointeur dès qu'il décide que le geste est un
     défilement de page. On revient alors sagement au cran courant. */
  scene.addEventListener('pointercancel', () => {
    if (idPt === null) return;
    idPt = null; axe = null; glisse = false;
    rendreLaMain(); rendre();
  });

  /* ---- PARALLAXE : trois degrés, sur un élément SÉPARÉ ----
     Elle vit sur .roue-pivot, pas sur la roue. Sur le même élément, les deux
     transformations se voleraient leur transition : bouger la souris pendant
     un cran remplacerait la courbe de 900 ms par celle de la parallaxe, et
     la rotation se mettrait à saccader. Séparées, elles se composent. */
  if (matchMedia('(pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
    let brut = 0, prevu = false;
    scene.addEventListener('pointermove', ev => {
      if (glisse) return;      /* pendant un glissé, la roue appartient au doigt */
      const r = scene.getBoundingClientRect();
      brut = ((ev.clientX - r.left) / r.width - .5) * 6;
      if (prevu) return;
      prevu = true;
      requestAnimationFrame(() => {
        prevu = false;
        pivot.style.transform = 'rotateY(' + brut + 'deg)';
      });
    }, { passive: true });
    scene.addEventListener('pointerleave', () => { pivot.style.transform = 'rotateY(0deg)'; });
  }

  /* ---- LA HAUTEUR DE LA SCÈNE ----
     Les plaques sont en position absolue : la scène doit donc porter une
     hauteur, et cette hauteur ne peut PAS être un clamp() en vw. Le piège
     est contre-intuitif : quand la fenêtre rétrécit, la plaque rétrécit
     aussi, son texte se replie sur plus de lignes, et la plaque GRANDIT en
     hauteur — exactement quand un clamp() en vw, lui, diminuerait. La
     plaque finirait coupée sur les écrans étroits.

     On mesure donc la plus haute des huit plaques et on ajoute une marge.
     offsetHeight, pas getBoundingClientRect : le premier rend la hauteur de
     mise en page, le second la boîte PROJETÉE, réduite par la perspective —
     mesurer la seconde donnerait une scène trop courte.

     Aucun risque de boucle : la largeur des plaques vient d'un clamp() en
     vw, changer la hauteur de la scène ne la touche pas. */
  /* La même marge partout — 90 px. Elle n'a pas besoin de varier : sur
     téléphone la plaque est plus étroite, donc son texte se replie et elle
     GRANDIT, si bien que ces 90 px y sont proportionnellement plus discrets
     qu'en desktop. La règle vaut aussi sur mobile depuis que la roue y est
     en 3D : c'est la scène qui doit porter la hauteur des plaques, elles y
     sont en position absolue. */
  const AIR = 90;
  const caler = () => {
    const h = Math.max(...plaques.map(p => p.firstElementChild.offsetHeight));
    if (h > 0) scene.style.height = (h + AIR) + 'px';
  };
  caler();
  if (window.ResizeObserver) {
    let prevu2 = false;
    new ResizeObserver(() => {
      if (prevu2) return;
      prevu2 = true;
      requestAnimationFrame(() => { prevu2 = false; caler(); });
    }).observe(plaques[0].firstElementChild);
  } else {
    addEventListener('resize', caler);
  }

  /* ---- LE DÉFILEMENT AUTOMATIQUE ----
     Une carte toutes les trois secondes, lecture active au chargement — et
     donc à chaque actualisation, puisque rien n'est retenu d'une visite à
     l'autre : l'état vit en mémoire, pas en stockage.

     Il ne tourne QUE lorsque la section est à l'écran. Une roue qui avance
     trois écrans plus bas ne serait vue de personne et ferait tourner une
     transition pour rien. Il repart tout seul quand on y revient.

     Toute navigation manuelle — flèche, point, glissé, molette, clavier —
     réarme le minuteur : on ne veut pas qu'une carte choisie à la main soit
     emportée un dixième de seconde plus tard. */
  const PAS_AUTO = 3000;
  let minuteur = 0, joue = true, aLEcran = false;
  const btnLect = section.querySelector('.roue-lect');

  const armer = () => {
    clearInterval(minuteur);
    if (joue && aLEcran) minuteur = setInterval(() => cran(1), PAS_AUTO);
  };
  const marquerLect = () => {
    if (!btnLect) return;
    btnLect.classList.toggle('is-on', joue);
    btnLect.setAttribute('aria-pressed', String(joue));
    btnLect.setAttribute('aria-label', joue ? 'Mettre en pause le défilement' : 'Reprendre le défilement');
    const t = btnLect.querySelector('.roue-lect__txt');
    if (t) t.textContent = joue ? 'Pause' : 'Lecture';
  };
  if (btnLect) btnLect.addEventListener('click', () => { joue = !joue; marquerLect(); armer(); });
  marquerLect();

  /* le minuteur se réarme après CHAQUE geste, d'où qu'il vienne : cran() est
     le seul chemin par lequel la roue avance. */
  const cranNu = cran;
  cran = (sens) => { cranNu(sens); armer(); };
  const versEtapeNu = versEtape;
  versEtape = (i) => { versEtapeNu(i); armer(); };

  /* onglet caché : rien ne doit tourner en arrière-plan */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(minuteur); else armer();
  });

  /* will-change seulement quand la section est à l'écran — et c'est le même
     signal qui autorise le défilement automatique. */
  new IntersectionObserver(es => es.forEach(e => {
    section.classList.toggle('roue-visible', e.isIntersecting);
    aLEcran = e.isIntersecting;
    armer();
  }), { rootMargin: '200px 0px' }).observe(section);

  section.dataset.roue = 'on';    /* masque la liste source, montre la scène */
  rendre();
  return { aller: versEtape, cran };
}

const sec = document.getElementById('etapes');
if (sec) {
  try {
    const api = initRoueEtapes(sec);
    if (api) window.__roueEtapes = api;
  } catch (err) {
    /* la liste source reste affichée : la section est lisible sans la roue */
    console.warn('roue des étapes indisponible', err);
  }
}
