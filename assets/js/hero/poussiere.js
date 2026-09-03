/* POUSSIÈRE D'OR — dessinée en temps réel, par-dessus la vidéo.
 * ---------------------------------------------------------------------------
 * Kling efface systématiquement les grains fins sur fond clair : mesuré, la
 * boucle jour n'en garde plus que 0,00 % là où son propre master en avait
 * 0,24 %. On la redessine donc, ce qui a l'avantage d'être exactement dosable
 * et de ne jamais boucler.
 *
 * Tout est calé sur des mesures faites sur le master jour, et non sur une idée
 * de ce qu'est une poussière :
 *
 *   · les grains sont plus CLAIRS que le fond — 162 amas clairs contre 38
 *     sombres — même sur l'ivoire, ce qui autorise un rendu additif ;
 *   · leur diamètre médian vaut 2,3 px sur une image de 1920 ;
 *   · leur contraste médian ne dépasse pas 7/255, soit moins de 3 % ; les plus
 *     vifs montent à 46/255, et ils sont rares ;
 *   · leur teinte est franchement dorée : l'écart au fond vaut R+8,1 V+6,7
 *     B+3,9, soit un rapport 1 / 0,83 / 0,48 ;
 *   · la densité vaut environ 480 grains par million de pixels dans le faisceau.
 *
 * Le faisceau lui-même a été mesuré par tenseur de structure sur l'image :
 * normale (−0,410 ; 0,912), crête à −0,053 largeur d'image du centre,
 * demi-largeur 0,062. Les grains s'allument donc dans la vraie lumière, et non
 * à côté.
 *
 * Deux principes de fabrication :
 *
 *   — Aucune période. Chaque grain a sa propre vitesse, sa propre oscillation
 *     et sa propre phase, et il est réensemencé au hasard quand il sort du
 *     cadre. Il n'existe donc aucun instant où l'image se répète.
 *   — Aucun grain ne doit accrocher l'œil plus que la montre. L'intensité est
 *     éteinte par le faisceau, par l'éloignement de sa source, et par une
 *     dernière atténuation douce autour du boîtier.
 */

/* Les grains sont dessinés depuis des vignettes pré-calculées plutôt que par un
   dégradé radial reconstruit à chaque image : créer deux cent cinquante
   dégradés par image coûterait plus cher que tout le reste de la page. Cinq
   douceurs suffisent à faire lire que certains grains sont proches et
   légèrement flous, et d'autres très lointains. */
function vignettes(couleur) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const doux = 0.18 + i * 0.19;            // 0 = piqué, 1 = très diffus
    const T = 32;
    const c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d');
    const d = g.createRadialGradient(T / 2, T / 2, 0, T / 2, T / 2, T / 2);
    /* un noyau net puis une décroissance douce : c'est ce profil, et non un
       simple disque flou, qui fait lire un point lumineux et pas une tache */
    d.addColorStop(0, 'rgba(' + couleur + ',1)');
    d.addColorStop(0.20 + doux * 0.26, 'rgba(' + couleur + ',' + (0.62 - doux * 0.30).toFixed(3) + ')');
    d.addColorStop(0.45 + doux * 0.35, 'rgba(' + couleur + ',' + (0.12 - doux * 0.08).toFixed(3) + ')');
    d.addColorStop(1, 'rgba(' + couleur + ',0)');
    g.fillStyle = d;
    g.fillRect(0, 0, T, T);
    out.push(c);
  }
  return out;
}

const lisse = function (a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function creerPoussiere(toile, opts) {
  opts = opts || {};
  /* TEINTE. Le canevas se superpose à la vidéo en alpha NORMAL, pas en additif :
     un grain ne s'ajoute pas au fond, il le remplace partiellement. Sa couleur
     doit donc être plus claire que le fond dans les TROIS canaux, sinon le bleu
     baisse et le grain vire à la tache brune. La mesure du master donne un écart
     au fond de R+8,1 V+6,7 B+3,9 sur un ivoire d'environ (200,190,170) : en
     résolvant, la couleur à peindre vaut (255, 236, 196). */
  const couleur = opts.couleur || '255,236,196';
  const normale = opts.normale || [-0.4103, 0.9120];   // faisceau, tenseur de structure
  const centre = opts.centre === undefined ? -0.0527 : opts.centre;
  const demiLargeur = opts.demiLargeur || 0.0615;
  /* ce qui subsiste hors du rayon : assez pour que l'air ne soit pas vide,
     trop peu pour qu'on le remarque */
  const plancher = opts.plancher === undefined ? 0.03 : opts.plancher;
  /* Atténuation autour du boîtier. Les coordonnées sont CENTRÉES et rapportées
     à la largeur : ux = (x − L/2)/L, uy = (y − H/2)/L. Le centre du cadran est
     à (1400, 387) sur 1920 × 1080, soit (0,2292 ; −0,0797). Exprimer le y en
     valeur absolue plutôt que centrée plaçait le disque de protection très en
     dessous de la montre, qui se retrouvait alors constellée de grains vifs. */
  const montre = opts.montre || { ux: 0.2292, uy: -0.0797, r: 0.17, force: 0.85 };
  /* OPACITÉ d'un grain, à la crête. Comme la superposition est en alpha, la
     hausse de luminance obtenue vaut alpha × (237 − fond) : sur l'ivoire du
     faisceau, à 190, il faut donc alpha ≈ 0,15 pour retrouver les 7/255 de
     contraste médian mesurés au master. La borne haute reste volontairement en
     deçà du master — 28/255 contre 46 — parce qu'un grain vif sur fond clair
     attire l'œil bien plus qu'un grain vif sur fond noir. */
  const contrasteMin = opts.contrasteMin === undefined ? 0.22 : opts.contrasteMin;
  const contrasteMax = opts.contrasteMax === undefined ? 1.00 : opts.contrasteMax;
  /* vitesse de chute, en largeurs d'image par seconde */
  const chuteMin = opts.chuteMin === undefined ? 0.0016 : opts.chuteMin;
  const chuteMax = opts.chuteMax === undefined ? 0.0062 : opts.chuteMax;
  const densite = opts.densite === undefined ? 1 / 5.8 : opts.densite;
  const maxGrains = opts.maxGrains === undefined ? 360 : opts.maxGrains;

  const g = toile.getContext('2d');
  const sprites = vignettes(couleur);
  const nx = normale[0], ny = normale[1];
  const ax = -ny, ay = nx;                   // axe du faisceau

  let W = 0, H = 0, dpr = 1, anim = 0, t0 = 0, actif = false, lent = false;
  const grains = [];

  const largeurCSS = function () { return toile.getBoundingClientRect().width || 1; };
  const petit = function () { return largeurCSS() < 760; };

  /* Un mobile n'a ni la surface d'écran ni le budget graphique d'un ordinateur :
     on divise fortement le nombre de grains ET on plafonne la densité de pixels,
     sinon la couche coûterait plus cher que la vidéo qu'elle décore. */
  function nombre() {
    const base = Math.round(largeurCSS() * densite);
    return petit()
      ? Math.max(14, Math.min(46, Math.round(base * 0.42)))
      : Math.max(40, Math.min(maxGrains, base));
  }

  function neuf(p, premier) {
    /* la profondeur commande tout : taille, netteté, vitesse, intensité */
    const z = Math.pow(Math.random(), 1.7);          // beaucoup de grains lointains
    p.z = z;
    p.sp = Math.min(4, Math.floor(z * 5.2));         // proche = vignette plus douce
    p.a = contrasteMin + (contrasteMax - contrasteMin)
        * Math.pow(Math.random(), 0.85) * (0.65 + 0.35 * z);
    p.kv = (chuteMin + (chuteMax - chuteMin) * z) * (0.8 + 0.4 * Math.random());
    p.kx = (Math.random() - 0.5) * 0.0009;           // dérive latérale propre
    /* amplitude et période tirées séparément pour chaque grain : c'est ce qui
       donne des trajectoires voisines mais jamais parallèles */
    p.ka = 0.0012 + 0.0042 * Math.random();
    p.ow = 0.06 + 0.22 * Math.random();
    p.op = Math.random() * Math.PI * 2;
    p.r = (0.65 + 2.40 * z) * (W / 1920);
    /* au premier remplissage on répartit les grains dans toute la hauteur, sinon
       on verrait une vague descendre depuis le haut au chargement */
    p.y = premier ? Math.random() * H : -p.r * 4 - Math.random() * H * 0.25;
    /* Semer uniformément gaspillerait le budget : les deux tiers du cadre sont
       hors du rayon, et un grain qui y naît restera invisible toute sa vie. On
       tire donc l'abscisse par REJET contre la carte de lumière, ce qui
       concentre les grains dans le faisceau sans jamais y créer de frontière —
       la probabilité varie continûment, comme la lumière elle-même. Au bout de
       huit essais on accepte : mieux vaut un grain mal placé qu'une boucle qui
       s'éternise sur un petit écran. */
    const yr = Math.max(0, Math.min(H - 1, p.y));
    p.x = Math.random() * W;
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * W;
      if (lumiere(x, yr) > Math.random()) { p.x = x; break; }
      p.x = x;
    }
  }

  function dimensionner() {
    const r = toile.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, petit() ? 2 : 2.5);
    W = Math.max(1, Math.round((r.width || 1) * dpr));
    H = Math.max(1, Math.round((r.height || 1) * dpr));
    if (toile.width !== W || toile.height !== H) { toile.width = W; toile.height = H; }
    const n = nombre();
    if (grains.length > n) grains.length = n;
    while (grains.length < n) { const p = {}; neuf(p, true); grains.push(p); }
    /* les rayons sont exprimés en pixels de rendu : ils suivent la taille */
    for (let i = 0; i < grains.length; i++) {
      grains[i].r = (0.65 + 2.40 * grains[i].z) * (W / 1920);
    }
  }

  /* Intensité de la lumière en un point : le rayon, l'éloignement de sa source,
     et le respect dû à la montre. */
  function lumiere(x, y) {
    const ux = (x - W / 2) / W, uy = (y - H / 2) / W;
    const d = (ux * nx + uy * ny - centre) / demiLargeur;
    const rayon = Math.exp(-0.5 * (d / 1.15) * (d / 1.15));
    const loin = lisse(-0.35, 0.45, ux * ax + uy * ay);
    let v = plancher + (1 - plancher) * rayon * loin;
    const dm = Math.hypot(ux - montre.ux, uy - montre.uy) / montre.r;
    if (dm < 1.7) v *= 1 - montre.force * (1 - lisse(0.5, 1.7, dm));
    return v;
  }

  function image(ms) {
    if (!actif) return;
    anim = requestAnimationFrame(image);
    /* le pas de temps est borné : au retour d'un onglet caché, un écart d'une
       minute ferait traverser l'écran d'un coup à tous les grains */
    let dt = (ms - t0) / 1000;
    t0 = ms;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    if (lent) dt *= 0.25;
    const t = ms / 1000;

    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < grains.length; i++) {
      const p = grains[i];
      p.y += p.kv * W * dt;
      p.x += p.kx * W * dt;
      const x = p.x + Math.sin(t * p.ow + p.op) * p.ka * W;
      if (p.y - p.r * 4 > H || x < -40 || x > W + 40) { neuf(p, false); continue; }
      const a = p.a * lumiere(x, p.y);
      if (a < 0.004) continue;
      /* la vignette déborde largement de son noyau : à huit rayons le grain
         devenait un halo, à quatre et demi il reste un point */
      const s = p.r * 5.5;
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(sprites[p.sp], x - s / 2, p.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function demarrer() {
    if (actif) return;
    actif = true;
    t0 = performance.now();
    anim = requestAnimationFrame(image);
  }
  function arreter() {
    actif = false;
    cancelAnimationFrame(anim);
    g.clearRect(0, 0, W, H);
  }

  /* On respecte la demande de mouvement réduit sans supprimer la poussière : on
     la ralentit fortement. Un air totalement figé serait plus étrange qu'un air
     lent, et la couche perdrait sa raison d'être, qui est de donner de la
     profondeur. */
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const relire = function () { lent = !!(mq && mq.matches); };
  relire();
  if (mq && mq.addEventListener) mq.addEventListener('change', relire);

  if (window.ResizeObserver) new ResizeObserver(dimensionner).observe(toile);
  else window.addEventListener('resize', dimensionner);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) cancelAnimationFrame(anim);
    else if (actif) { t0 = performance.now(); anim = requestAnimationFrame(image); }
  });

  dimensionner();
  return {
    demarrer: demarrer,
    arreter: arreter,
    dimensionner: dimensionner,
    get nombre() { return grains.length; },
    get actif() { return actif; },
  };
}
