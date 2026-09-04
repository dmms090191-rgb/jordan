/* HERO · SCÈNE HORLOGÈRE — assemblage.
 * ---------------------------------------------------------------------------
 * Rassemble quatre pièces déjà validées séparément : les deux boucles vidéo,
 * les aiguilles à l'heure de Paris, le tic-tac WebAudio et la poussière d'or.
 * Ce fichier ne fait que les poser correctement les unes sur les autres et
 * gérer ce qui les relie : le calage géométrique, la bascule Jour/Nuit,
 * l'introduction du premier chargement, et la mise en veille.
 *
 * Le point délicat est le CALAGE. La vidéo est recadrée en « cover » : le
 * rectangle qu'occupe réellement l'image ne coïncide donc pas avec l'élément.
 * Les aiguilles et la poussière sont posées sur CE rectangle, recalculé à
 * chaque changement de taille. Sans cela les aiguilles glissent hors du cadran
 * dès qu'on redimensionne la fenêtre.
 */
import { repere, svgAiguilles, svgReflet, DEFS, heureParis } from './aiguilles.js';
import { creerPoussiere } from './poussiere.js';
import { creerTicTac } from './tictac.js';

/* le plateau garde son identifiant historique — la parallaxe de l accueil le
   vise par ce nom — on le retrouve donc par sa classe */
const hm = document.querySelector('.hm');
if (hm) demarrerHero();

function demarrerHero() {
  const vNuit = document.getElementById('hmNuit');
  const vJour = document.getElementById('hmJour');
  const toile = document.getElementById('hmPous');
  const svg = document.getElementById('hmAig');
  const voile = document.getElementById('hmVoile');
  const rai = document.getElementById('hmRai');
  const bouton = document.getElementById('hmSon');
  const racine = document.documentElement;
  /* le voile est FRERE du plateau, pas son fils : il doit rester sous le
     degrade de lisibilite. La classe et les variables de l introduction vont
     donc sur leur conteneur commun, sinon elles ne l atteignent pas. */
  const scene = hm.parentElement;

  const DUREE = 25 / 6;                       // 100 images à 24 i/s, soit 4,1667 s
  const MASTER = 5120, LARG = 1920, HAUT = 1080;
  const doux = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── le repère du cadran ─────────────────────────────────────────────
     Relevé sur le master nuit, en pixels de l'image 5120 × 2880. La boucle
     jour a été recalée de 3 pixels sur la nuit : elle partage donc exactement
     ce repère, et une seule calibration suffit pour les deux ambiances. */
  const k = LARG / MASTER;
  const mise = (p) => [p[0] * k, p[1] * k];
  const REP = repere({
    h12: mise([3839, 762]), h3: mise([4013, 1067]),
    h6: mise([3625, 1304]), h9: mise([3451, 999]),
  });
  const STYLE = {
    nuit: {},
    /* le jour est clair : une ombre et un or pensés pour le fond noir y
       deviendraient sales. On change les couleurs, jamais la géométrie. */
    jour: { orClair: '#fffdf6', orSombre: '#6b4d17', ombre: 'rgba(70,52,18,.42)' },
  };

  let amb = racine.dataset.ambiance === 'jour' ? 'jour' : 'nuit';

  /* ── sources : la définition suit la taille réellement affichée ──────
     Un téléphone n'a pas besoin de 1080p, et son décodeur chauffe pour rien
     s'il l'obtient : la boucle tourne en permanence. */
  function choisirDefinition() {
    const l = hm.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2);
    return l > 1320 ? '1080' : '720';
  }
  const DEF = choisirDefinition();
  const source = (a) => `assets/video/hero-${a}-${DEF}.mp4`;
  function assurerSource(v) {
    if (v.dataset.chargee) return;
    v.dataset.chargee = '1';
    v.src = source(v === vJour ? 'jour' : 'nuit');
    v.load();
  }

  /* ── calage : le rectangle réellement occupé par l'image ─────────── */
  function poser() {
    const v = amb === 'jour' ? vJour : vNuit;
    /* On part de la boîte de la VIDÉO, et non de celle du plateau : en format
       large, la feuille de style la positionne explicitement pour dégager le
       sommet de la montre de l'en-tête, et elle n'occupe donc plus tout le
       plateau.
       On lit offsetLeft/offsetWidth plutôt que getBoundingClientRect : la
       parallaxe applique une transformation au plateau, que le canevas et le
       SVG subissent DÉJÀ puisqu'ils sont dedans. La compter ici la
       appliquerait deux fois. */
    const bw = v.offsetWidth, bh = v.offsetHeight;
    if (!bw || !bh) return;
    const op = getComputedStyle(v).objectPosition.split(' ');
    const px = (parseFloat(op[0]) || 50) / 100;
    const py = (parseFloat(op[1]) || 50) / 100;
    const s = Math.max(bw / LARG, bh / HAUT);
    const l = LARG * s, h = HAUT * s;
    const x = v.offsetLeft + (bw - l) * px;
    const y = v.offsetTop + (bh - h) * py;
    for (const el of [toile, svg]) {
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.width = l + 'px'; el.style.height = h + 'px';
    }
    /* Le bord gauche du plan, mesuré et non deviné : le dégradé de lisibilité
       doit être franchement opaque jusque-là, sinon la limite de l'image se
       voit comme une couture verticale. */
    scene.style.setProperty('--hm-bord', Math.max(0, Math.round(x)) + 'px');
    if (pous) pous.dimensionner();
  }

  /* ── aiguilles ───────────────────────────────────────────────────────
     Redessinées une fois par seconde, sur la seconde pleine. La trotteuse
     avance donc par sauts d'une seconde : c'est ce que fait le tic-tac, qui
     frappe lui aussi une fois par seconde. Une trotteuse qui balaierait
     pendant qu'on entend un battement sonnerait faux. */
  let minuteur = 0;
  function dessiner() {
    const t = heureParis();
    svg.innerHTML = `<defs>${DEFS}</defs>`
      + svgAiguilles(REP, { heure: t.heure, min: t.min, sec: Math.floor(t.sec) }, STYLE[amb])
      + svgReflet(REP);
  }
  function battre() {
    dessiner();
    /* on se recale sur l'horloge système à chaque tour : aucun décalage ne
       peut s'accumuler, contrairement à un intervalle fixe */
    minuteur = setTimeout(battre, 1000 - (Date.now() % 1000) + 4);
  }

  /* ── poussière ───────────────────────────────────────────────────────
     La nuit a la sienne, filmée. Seul le jour, dont le modèle a effacé les
     grains, a besoin de la couche. */
  const pous = creerPoussiere(toile);
  function reglerPoussiere() {
    if (amb === 'jour' && !document.hidden) { pous.demarrer(); toile.classList.add('is-on'); }
    else { pous.arreter(); toile.classList.remove('is-on'); }
  }

  /* ── tic-tac ─────────────────────────────────────────────────────── */
  const tictac = creerTicTac();
  function marquerBouton() {
    if (!bouton) return;
    bouton.classList.toggle('is-on', tictac.actif);
    bouton.setAttribute('aria-pressed', String(tictac.actif));
    const t = bouton.querySelector('.hm__son-txt');
    if (t) t.textContent = tictac.actif ? 'Son actif' : 'Son';
  }
  if (bouton) {
    bouton.addEventListener('click', async () => {
      if (tictac.actif) tictac.arreter(); else await tictac.demarrer();
      marquerBouton();
    });
    /* le choix est conservé, mais le navigateur n'autorise le son qu'après un
       geste : on le rejoue à la première interaction, quelle qu'elle soit */
    tictac.brancherReprise();
    marquerBouton();
    document.addEventListener('pointerdown', () => setTimeout(marquerBouton, 60), { passive: true });
  }

  /* ── bascule Jour / Nuit ─────────────────────────────────────────────
     On n'ajoute aucun bouton et on ne modifie pas le script d'ambiance
     existant : on observe simplement l'attribut qu'il pose sur <html>. Le
     réglage de l'utilisateur, sa persistance et le bouton restent donc
     exactement ce qu'ils étaient. */
  /* LA DURÉE N'EST ÉCRITE QU'UNE FOIS, dans hero-montre.css (--hf-duree),
     et le script la lit. Deux constantes jumelles à tenir d'accord auraient
     fini par diverger — et le jour où elles divergent, le plan de dessus
     s'éteint alors que celui de dessous n'est pas encore là. */
  const dureeFondu = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--hf-duree').trim();
    const n = parseFloat(v);
    if (!isFinite(n)) return 400;
    return v.endsWith('ms') ? n : n * 1000;
  };
  let minuteurFondu = 0;

  /* ── LA BASCULE : UN SEUL PLAN BOUGE ────────────────────────────────────
     TROIS DÉFAUTS MESURÉS, ET TROIS CORRECTIONS.

     1. LE FONDU CROISÉ LAISSAIT VOIR LE FOND. Les deux plans se fondaient
        en même temps : l'un montait de 0 à 1 pendant que l'autre descendait
        de 1 à 0. Deux couches simultanément translucides laissent passer
        (1−a)(1−b) de ce qu'il y a derrière — jusqu'à 24,9 % au milieu. Or
        derrière, c'est le fond de page, qui vaut l'ivoire du mode jour à
        239 de luminance alors que le plan de jour n'est qu'à 160. Le milieu
        du fondu était donc PLUS LUMINEUX que le jour final : +8,6 points.

        Correction : le plan de NUIT est le FOND, et il reste à opacité 1 en
        permanence. Seul le plan de JOUR, qui est au-dessus dans le
        document, monte et descend. Le rendu vaut à chaque instant
        a·jour + (1−a)·nuit — une combinaison convexe, qui ne peut pas
        dépasser le plus lumineux des deux. Ce n'est plus réglé, c'est
        impossible.

     2. LE FONDU NE PARTAIT PAS TOUT DE SUITE. On attendait que la vidéo
        entrante soit décodée : mesuré, plus de 800 ms pendant lesquelles le
        cadre de la page était en plein jour autour d'une scène de nuit. Le
        fondu part désormais immédiatement ; la lecture suit.

     3. UN Z-INDEX EN LIGNE CHANGEAIT LA LUMINANCE. Une première correction
        faisait passer le plan entrant au-dessus par un z-index posé en
        ligne. Mesuré : cela promeut la vidéo dans sa propre couche de
        composition, et le navigateur la rend alors plus claire de onze
        points — 60,3 au lieu de 49,5 sur le plan de nuit. Effacer le
        z-index rendait la valeur d'origine. On n'en pose donc aucun :
        l'ordre du document suffit, puisque seul le plan du dessus bouge. */
  async function versAmbiance(nouvelle) {
    if (nouvelle === amb) return;
    const versJour = nouvelle === 'jour';
    amb = nouvelle;
    assurerSource(vJour);

    /* le plan de dessous doit être au bon endroit de la boucle AVANT d'être
       découvert : les deux plans sont calés au pixel et durent exactement
       pareil, donc rien ne bouge pendant le fondu. */
    const dessus = vJour, dessous = vNuit;
    const src = versJour ? dessous : dessus;
    const cible = versJour ? dessus : dessous;
    try { if (isFinite(src.currentTime)) cible.currentTime = src.currentTime % DUREE; } catch (e) { /* pas encore prête */ }

    /* LE FOND NE S'ÉTEINT JAMAIS. C'est ce qui garantit qu'aucun pixel de
       page ne peut apparaître entre les deux plans. */
    vNuit.classList.add('is-on');
    vJour.classList.toggle('is-on', versJour);
    poser(); dessiner(); reglerPoussiere();

    /* on relance celui qui va être vu, et on ne coupe l'autre qu'une fois le
       fondu terminé — sa mise en pause est alors invisible, puisqu'il est
       soit couvert, soit transparent. */
    cible.play().catch(() => {});
    clearTimeout(minuteurFondu);
    minuteurFondu = setTimeout(() => {
      if ((amb === 'jour') !== versJour) return;
      (versJour ? dessous : dessus).pause();
    }, dureeFondu() + 60);

    try { await pretePourAffichage(cible); await cible.play(); } catch (e) { /* le poster reste */ }
  }

  function pretePourAffichage(v) {
    if (v.readyState >= 2) return Promise.resolve();
    return new Promise((r) => {
      const fin = () => { v.removeEventListener('loadeddata', fin); clearTimeout(t); r(); };
      const t = setTimeout(fin, 1200);              // on n'attend jamais indéfiniment
      v.addEventListener('loadeddata', fin);
    });
  }
  new MutationObserver(() => {
    versAmbiance(racine.dataset.ambiance === 'jour' ? 'jour' : 'nuit');
  }).observe(racine, { attributes: true, attributeFilter: ['data-ambiance'] });

  /* ── introduction, au premier chargement de la session seulement ──────
     Pas d'animation de la montre, pas de mouvement de caméra : seulement la
     lumière qui s'établit, par paliers d'une seconde, comme des battements.
     Si le son est actif, les paliers tombent sur les tic-tac, puisque les uns
     et les autres sont calés sur la seconde système. */
  const CLE_INTRO = 'compagnie-or-hero-intro';
  function dejaVue() { try { return sessionStorage.getItem(CLE_INTRO) === '1'; } catch (e) { return false; } }
  function marquerVue() { try { sessionStorage.setItem(CLE_INTRO, '1'); } catch (e) { /* mode privé */ } }

  const ETAPES = [
    /* palier            voile  expo  saturation  contraste */
    { t: 0,    v: 0.96, e: 0.10, s: 0.50, c: 1.20 },
    { t: 1000, v: 0.88, e: 0.20, s: 0.55, c: 1.16 },   // TIC — le contour paraît
    { t: 2000, v: 0.70, e: 0.36, s: 0.66, c: 1.12, rai: true },  // TAC — le faisceau monte
    { t: 3000, v: 0.44, e: 0.58, s: 0.80, c: 1.07 },   // cadran, verre, boîtier
    { t: 4000, v: 0.18, e: 0.80, s: 0.92, c: 1.03, pous: true }, // lingots, poussière
    { t: 5000, v: 0.00, e: 1.00, s: 1.00, c: 1.00, aig: true },  // la scène est établie
  ];
  const minuteurs = [];
  /* L introduction peut etre coupee court — par prefers-reduced-motion, par
     un saut volontaire, ou parce qu elle a deja ete vue. Un verrou evite
     qu elle ne redemarre ensuite lorsque le voile du logo s efface. */
  let introFinie = false;
  /* La scène est plongée dans le noir TOUT DE SUITE, avant même de savoir
     quand l'introduction pourra se dérouler. Si on attendait, le hero
     s'afficherait en pleine lumière derrière le voile du logo puis
     s'assombrirait d'un coup au moment de commencer : un flash, exactement ce
     qu'il faut éviter. */
  function preparerIntro() {
    hm.classList.add('is-intro');
    scene.classList.add('is-intro');
    appliquer(ETAPES[0]);
  }
  function introduire() {
    if (introFinie) return;
    /* on démarre sur la seconde pleine : si le son est actif, le premier
       palier tombe exactement sur un battement */
    const attente = 1000 - (Date.now() % 1000) + 30;
    minuteurs.push(setTimeout(() => {
      for (const e of ETAPES) minuteurs.push(setTimeout(() => appliquer(e), e.t));
      minuteurs.push(setTimeout(() => {
        rai && rai.classList.remove('is-on');
      }, 6200));
      minuteurs.push(setTimeout(terminerIntro, 7400));
    }, attente));
  }
  function appliquer(e) {
    scene.style.setProperty('--hm-voile', e.v);
    scene.style.setProperty('--hm-expo', e.e);
    scene.style.setProperty('--hm-sat', e.s);
    scene.style.setProperty('--hm-con', e.c);
    if (e.rai && rai) rai.classList.add('is-on');
    if (e.pous) reglerPoussiere();
    if (e.aig) svg.classList.add('is-on');
  }
  function terminerIntro() {
    introFinie = true;
    hm.classList.remove('is-intro');
    scene.classList.remove('is-intro');
    for (const p of ['--hm-voile','--hm-expo','--hm-sat','--hm-con']) scene.style.removeProperty(p);
    if (rai) rai.classList.remove('is-on');
    svg.classList.add('is-on');
    reglerPoussiere();
    marquerVue();
  }
  function sansIntro() {
    introFinie = true;
    svg.classList.add('is-on');
    reglerPoussiere();
    marquerVue();
  }

  /* ── veille : rien ne doit tourner dans un onglet caché ────────────── */
  document.addEventListener('visibilitychange', () => {
    const v = amb === 'jour' ? vJour : vNuit;
    if (document.hidden) {
      clearTimeout(minuteur);
      vNuit.pause(); vJour.pause();
      pous.arreter();
    } else {
      v.play().catch(() => {});
      battre();
      reglerPoussiere();
    }
  });
  /* retour par l'historique : la page revient du cache, tout doit repartir
     sans rejouer l'introduction */
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const v = amb === 'jour' ? vJour : vNuit;
    v.play().catch(() => {});
    clearTimeout(minuteur); battre();
    reglerPoussiere();
  });

  /* ── mise en route ──────────────────────────────────────────────── */

  /* LES AIGUILLES D'ABORD, AVANT TOUT LE RESTE.
     poser() ne lit que la boîte de mise en page de la vidéo (offsetLeft,
     offsetWidth) : elle ne dépend ni de la source, ni du chargement, ni de
     l'opacité. On peut donc caler le repère et tracer les aiguilles à
     l'heure de Paris AVANT de révéler le plan — ce qui garantit qu'aucune
     image affichée ne montre jamais la montre sans ses aiguilles. Ces deux
     appels étaient plus bas, après la révélation des vidéos ; ils y
     tombaient dans la même tâche, mais le fondu de 600 ms des aiguilles
     partait alors derrière celui de 400 ms du plan. */
  poser(); battre();

  const actif = amb === 'jour' ? vJour : vNuit;
  const autre = amb === 'jour' ? vNuit : vJour;
  assurerSource(actif);
  /* MÊME INVARIANT DÈS LE DÉPART : le plan de nuit est le fond et porte
     toujours .is-on ; le plan de jour est la couche qui se révèle. En
     ambiance jour, la nuit est donc présente sous un jour opaque — elle ne
     coûte rien puisqu'elle sera mise en pause, et elle sert de repli si le
     plan de jour ne se charge pas. */
  vNuit.classList.add('is-on');
  if (amb === 'jour') vJour.classList.add('is-on');
  actif.play().catch(() => {});
  /* la seconde ambiance se charge une fois la première prête et le navigateur
     au repos : elle ne doit jamais disputer la bande passante à celle qu'on
     regarde, mais elle doit être là avant que l'utilisateur bascule */
  const chargerAutre = () => {
    if (window.requestIdleCallback) requestIdleCallback(() => assurerSource(autre), { timeout: 4000 });
    else setTimeout(() => assurerSource(autre), 1800);
  };
  if (actif.readyState >= 3) chargerAutre();
  else actif.addEventListener('canplaythrough', chargerAutre, { once: true });
  /* 2,5 s et non 6 : mesuré, une bascule faite à 4,8 s trouvait encore la
     seconde source non chargée, et le fondu ne partait qu'après. */
  setTimeout(chargerAutre, 2500);               // filet de sécurité

  /* poser() et battre() ont déjà eu lieu plus haut : les aiguilles sont
     tracées avant que le plan ne se révèle. */
  if ('ResizeObserver' in window) new ResizeObserver(poser).observe(hm);
  else addEventListener('resize', poser);
  addEventListener('orientationchange', () => setTimeout(poser, 250));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(poser);

  /* L'accueil possede deja une introduction : le voile du logo, plein ecran,
     joue au premier chargement de la session. Lancer la notre en meme temps
     reviendrait a la jouer DERRIERE lui, et elle serait finie avant qu'on la
     voie. On attend donc son retrait. Les videos, elles, se chargent pendant
     ce temps : quand le voile s'efface, la scene est prete. */
  function quandLeVoileDuLogoEstParti(suite) {
    const splash = document.getElementById('lc-splash');
    if (!splash || !splash.isConnected) return suite();
    const obs = new MutationObserver(() => {
      if (splash.isConnected) return;
      obs.disconnect(); clearTimeout(secours); suite();
    });
    obs.observe(document.body, { childList: true });
    /* filet : si le voile ne partait jamais, la scene ne doit pas rester figee */
    const secours = setTimeout(() => { obs.disconnect(); suite(); }, 12000);
  }

  if (doux || dejaVue()) {
    sansIntro();
  } else {
    preparerIntro();
    quandLeVoileDuLogoEstParti(introduire);
  }

  /* poignées pour les contrôles automatisés */
  window.__hero = {
    get amb() { return amb; },
    get grains() { return pous.nombre; },
    get son() { return tictac.actif; },
    poser, dessiner,
    prete: () => (amb === 'jour' ? vJour : vNuit).readyState >= 3,
    rect: () => ({ l: svg.style.left, t: svg.style.top, w: svg.style.width, h: svg.style.height }),
    sauterIntro: () => { minuteurs.forEach(clearTimeout); terminerIntro(); },
  };
}
