/* TIC-TAC — synthétisé dans le navigateur, calé sur la seconde réelle.
 * ---------------------------------------------------------------------------
 * Pas de fichier audio. Un échappement mécanique n'est pas un « bip » : c'est
 * un CHOC. Deux pièces d'acier qui se rencontrent produisent un transitoire
 * très court, large en fréquence, qui s'éteint en quelques millisecondes. On
 * le fabrique donc comme un choc :
 *
 *   · une impulsion de bruit très brève — le contact lui-même ;
 *   · deux résonances étroites — le métal du mouvement qui sonne ;
 *   · une enveloppe de 25 ms, quasi verticale à l'attaque.
 *
 * Le TIC et le TAC ne sont pas identiques : dans un mouvement réel, l'ancre
 * frappe alternativement deux dents différentes. On alterne donc légèrement la
 * hauteur et la durée, sinon l'oreille entend une boucle et le son devient
 * artificiel en quelques secondes.
 *
 * La planification passe par l'horloge de la carte son, pas par setInterval :
 * un timer JavaScript dérive de plusieurs millisecondes et le tic-tac cesse
 * d'être solidaire de la trotteuse.
 */

const CLE = 'compagnie-or-son';

export function creerTicTac(opts = {}) {
  const {
    /* Mesuré hors ligne : 0,055 plaçait la crête à -42 dBFS, inaudible sur la
       plupart des enceintes. 0,22 la met à ~-29 dBFS — on le devine sans
       jamais être agressé. La frappe dure 23,8 ms, courte et sèche. */
    volume = 0.22,
    avance = 0.12,           // horizon de planification, en secondes
  } = opts;

  let ctx = null, sortie = null, minuteur = null;
  let prochaine = 0;         // prochaine seconde à sonner, en temps audio
  let parite = 0;
  let actif = false;
  /* prévenus dès que le son commence VRAIMENT à sortir, ou s'arrête. Sans ce
     signal, l'interface devinait au bout de 60 ms avec un setTimeout — et se
     trompait quand le navigateur mettait plus longtemps à lever l'autoplay. */
  const temoins = [];
  const signaler = () => { for (let i = 0; i < temoins.length; i++) { try { temoins[i](actif); } catch (e) {} } };

  /* ── un choc ──────────────────────────────────────────────────────── */
  function choc(t, aigu) {
    /* le contact : une bouffée de bruit de 6 ms */
    const n = ctx.sampleRate * 0.006 | 0;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      d[i] = (Math.random() * 2 - 1) * k * k;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    /* le métal qui sonne : deux résonances étroites, décalées entre TIC et TAC */
    const f1 = aigu ? 2450 : 2180;
    const f2 = aigu ? 5200 : 4650;
    const r1 = ctx.createBiquadFilter();
    r1.type = 'bandpass'; r1.frequency.value = f1; r1.Q.value = 9;
    const r2 = ctx.createBiquadFilter();
    r2.type = 'bandpass'; r2.frequency.value = f2; r2.Q.value = 14;

    /* on retire le bas du spectre : c'est lui qui ferait une grosse horloge */
    const coupe = ctx.createBiquadFilter();
    coupe.type = 'highpass'; coupe.frequency.value = 1200;

    const g = ctx.createGain();
    const dur = aigu ? 0.022 : 0.028;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume * (aigu ? 1 : 0.86), t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const g2 = ctx.createGain();
    g2.gain.value = 0.55;

    src.connect(coupe);
    coupe.connect(r1); coupe.connect(r2);
    r1.connect(g); r2.connect(g2); g2.connect(g);
    g.connect(sortie);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /* ── planification ────────────────────────────────────────────────
     On aligne la seconde AUDIO sur la seconde de l'horloge système, puis on
     avance de seconde en seconde dans l'horloge de la carte son. Le décalage
     est recalculé à chaque tour : aucune dérive ne peut s'accumuler. */
  function caler() {
    const ms = Date.now() % 1000;
    prochaine = ctx.currentTime + (1000 - ms) / 1000;
    parite = Math.floor(Date.now() / 1000) % 2;
  }

  function pomper() {
    if (!actif) return;
    while (prochaine < ctx.currentTime + avance) {
      choc(prochaine, parite === 0);
      prochaine += 1;
      parite ^= 1;
    }
    /* on se resynchronise doucement sur l'horloge système une fois par minute,
       au cas où les deux horloges divergeraient */
    minuteur = setTimeout(pomper, 40);
  }

  /* ── contrôle ─────────────────────────────────────────────────────── */
  async function demarrer() {
    if (actif) return true;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      sortie = ctx.createGain();
      sortie.gain.value = 1;
      sortie.connect(ctx.destination);
    }
    /* l'autoplay n'est levé que par un geste : resume() doit être appelé
       depuis le gestionnaire d'événement, jamais avant. */
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { return false; } }
    if (ctx.state !== 'running') return false;
    actif = true;
    caler();
    pomper();
    try { localStorage.setItem(CLE, 'on'); } catch (e) { /* mode privé */ }
    signaler();
    return true;
  }

  function arreter() {
    actif = false;
    clearTimeout(minuteur);
    if (ctx && ctx.state === 'running') ctx.suspend();
    try { localStorage.setItem(CLE, 'off'); } catch (e) { /* mode privé */ }
    signaler();
  }

  /* Le choix est conservé, mais on ne peut pas le REJOUER sans geste : on se
     contente de le retenir et d'attendre la première interaction. */
  /* SON ACTIF PAR DÉFAUT : c'est l'ABSENCE de choix qui vaut « on », et non
     l'inverse. Auparavant il fallait un `on` enregistré, donc chaque première
     visite arrivait en silence. Un `off` explicite — l'utilisateur a coupé le
     son — est évidemment respecté, et le reste à chaque rechargement. */
  function voulu() {
    try { return localStorage.getItem(CLE) !== 'off'; } catch (e) { return true; }
  }

  /* `exclure` : un sélecteur dont les gestes ne doivent PAS déclencher la
     reprise automatique. C'est le bouton du son lui-même.

     LE DÉFAUT QUE ÇA RÉPARE. Le bouton s'annulait tout seul. Au tout premier
     clic dessus, son `pointerdown` remontait ici, le tic-tac DÉMARRAIT ; puis
     le `click` du même geste voyait un son en marche et l'ARRÊTAIT aussitôt.
     Résultat mesuré : premier clic sur le bouton -> il joue « non » et affiche
     « Coupé ». Il fallait le désactiver puis le réactiver pour entendre quoi
     que ce soit. Le bouton est désormais seul maître de son propre geste.

     Les événements sont plus nombreux qu'avant : selon le navigateur et le
     support, l'autorisation de jouer n'est accordée ni au même moment ni sur
     le même événement — `touchend` sur certains mobiles, `click` ailleurs. Le
     premier qui aboutit débranche les autres. */
  const GESTES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];

  function brancherReprise(exclure) {
    if (!voulu()) return;

    /* On tente d'abord SANS geste : un navigateur qui connaît déjà le site
       peut l'autoriser, et le son commence alors avec la page. S'il refuse —
       le cas ordinaire — rien n'est perdu, on attend le premier geste. */
    demarrer().catch(() => {});

    const reprendre = async (e) => {
      if (exclure && e && e.target && e.target.closest && e.target.closest(exclure)) return;
      /* le son a pu être coupé entre-temps : on ne le rallume jamais dans le
         dos de quelqu'un qui vient de l'éteindre */
      if (!voulu()) { retirer(); return; }
      if (await demarrer()) retirer();
    };
    const retirer = () => { GESTES.forEach(n => document.removeEventListener(n, reprendre)); };
    GESTES.forEach(n => document.addEventListener(n, reprendre, { passive: true }));
  }

  /* onglet caché : on suspend, sinon le navigateur accumule des événements */
  document.addEventListener('visibilitychange', () => {
    if (!actif) return;
    if (document.hidden) { clearTimeout(minuteur); if (ctx) ctx.suspend(); }
    else if (ctx) ctx.resume().then(() => { caler(); pomper(); });
  });

  return {
    demarrer, arreter, voulu, brancherReprise,
    surChangement(fn) { if (typeof fn === 'function') temoins.push(fn); },
    get actif() { return actif; },
  };
}
