/* ============================================================================
   LE FORMULAIRE DE DEMANDE DE RENDEZ-VOUS
   ----------------------------------------------------------------------------
   Ce fichier ne contient AUCUN secret. Il n'en a pas besoin : l'envoi passe par
   une adresse publique — celle d'un Web App Google Apps Script — qui écrit dans
   la feuille de calcul et prévient par courriel. La clé, les identifiants et
   l'adresse de destination restent du côté de Google, jamais dans la page.

   Trois principes tenus par ce fichier :

     · AUCUN FAUX ENVOI. Tant que l'adresse ci-dessous est vide, le formulaire
       n'affiche jamais « message envoyé » : il ouvre le logiciel de courrier du
       visiteur, avec le message déjà écrit. C'est un envoi réel, simplement
       fait par une autre voie.
     · AUCUNE ADRESSE PRIVÉE DANS LA PAGE. Seule contact@orexpert.fr apparaît.
     · AUCUN ENVOI EN DOUBLE. Le bouton se verrouille dès le premier clic, et
       la demande en cours est la seule qui existe.
   ========================================================================== */

/* ┌────────────────────────────────────────────────────────────────────────┐
   │  L'ADRESSE D'ENVOI — C'EST LA SEULE LIGNE À REMPLIR.                   │
   │                                                                        │
   │  Collez entre les guillemets l'URL du Web App Google Apps Script.      │
   │  Elle se termine par /exec, par exemple :                              │
   │      https://script.google.com/macros/s/AKfy…/exec                     │
   │                                                                        │
   │  Comment l'obtenir (une seule fois) :                                  │
   │    1. Ouvrir la feuille Google Sheets qui doit recevoir les demandes.  │
   │    2. Extensions ▸ Apps Script.                                        │
   │    3. Coller le code donné en bas de ce fichier, puis Enregistrer.     │
   │    4. Déployer ▸ Nouveau déploiement ▸ type « Application Web ».       │
   │       Exécuter en tant que : moi.                                      │
   │       Qui a accès : « Tout le monde ».                                 │
   │    5. Copier l'URL proposée et la coller ici.                          │
   │                                                                        │
   │  Tant que cette ligne reste vide, le formulaire fonctionne quand même  │
   │  — il passe par le logiciel de courrier du visiteur.                   │
   └────────────────────────────────────────────────────────────────────────┘ */
export const CONTACT_FORM_ENDPOINT = '';

/* l'adresse publique de la maison — celle qui est déjà affichée dans la page */
const DESTINATAIRE = 'contact@orexpert.fr';

/* PAS DE PIEGE TEMPOREL ICI, ET C'EST DELIBERE. Mesurer le temps de saisie pour
   deviner un robot se retourne contre les visiteurs qui remplissent le formulaire
   par saisie automatique : ils valident en deux secondes, on les prendrait pour
   des machines — et on leur afficherait « envoyé » sans rien envoyer. Ce serait
   exactement le faux envoi qu'on s'interdit. Seul reste le champ leurre, qu'aucune
   main humaine ne remplit jamais. */

const $ = (sel, racine) => (racine || document).querySelector(sel);

/* ---------- ce qu'on vérifie, et ce qu'on dit quand ça ne va pas ----------
   Un message d'erreur doit dire QUOI corriger, pas constater un échec. */
const REGLES = {
  prenom: {
    test: (v) => v.trim().length >= 2,
    dit: 'Indiquez votre prénom.',
  },
  nom: {
    test: (v) => v.trim().length >= 2,
    dit: 'Indiquez votre nom.',
  },
  email: {
    /* volontairement large : les adresses valides sont plus variées que ce que
       la plupart des expressions régulières acceptent. On écarte l'absurde,
       pas l'inhabituel. */
    test: (v) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v.trim()),
    dit: 'Cette adresse e-mail semble incomplète.',
  },
  telephone: {
    test: (v) => /^(?:\+33|0)[1-9]\d{8}$/.test(v.replace(/[\s.\-()]/g, '')),
    dit: 'Indiquez un numéro à dix chiffres, par exemple 06 12 34 56 78.',
  },
  message: { test: () => true, dit: '' },   /* facultatif */
};

export function initFormulaire(racine) {
  const form = racine || $('#rdv-form');
  if (!form) return { destroy() {} };

  const bouton = $('.rdvf__envoi', form);
  const etat = $('.rdvf__etat', form);
  const piege = $('.rdvf__piege', form);          /* le champ que seuls les robots remplissent */
  if (!bouton || !etat) return { destroy() {} };

  const champs = [...form.querySelectorAll('.rdvf__in')];
  let envoiEnCours = false;

  /* ---------- dire l'état, une seule voix ---------- */
  function dire(type, texte) {
    form.dataset.etat = type;                      /* '', 'envoi', 'ok', 'erreur' */
    etat.textContent = texte || '';
    /* « poli » pour un succès attendu, « assertif » pour une erreur qui bloque */
    etat.setAttribute('aria-live', type === 'erreur' ? 'assertive' : 'polite');
  }

  /* ---------- valider un champ ---------- */
  function verifier(input, montrer) {
    const regle = REGLES[input.name];
    if (!regle) return true;
    const ok = regle.test(input.value || '');
    const ligne = input.closest('.rdvf__champ');
    if (ligne) {
      ligne.dataset.faux = ok || !montrer ? '' : '1';
      const dit = $('.rdvf__dit', ligne);
      if (dit) dit.textContent = ok || !montrer ? '' : regle.dit;
    }
    input.setAttribute('aria-invalid', ok || !montrer ? 'false' : 'true');
    return ok;
  }

  champs.forEach((c) => {
    /* on ne corrige pas quelqu'un pendant qu'il écrit : on attend qu'il quitte
       le champ. En revanche, dès qu'il revient corriger, l'erreur s'efface. */
    c.addEventListener('blur', () => verifier(c, true));
    c.addEventListener('input', () => {
      const ligne = c.closest('.rdvf__champ');
      if (ligne && ligne.dataset.faux) verifier(c, true);
    });
  });

  /* ---------- ce qu'on envoie ---------- */
  function recolte() {
    const v = {};
    for (const c of champs) v[c.name] = (c.value || '').trim();
    return v;
  }

  /* Le message tel qu'il arrivera — même texte par les deux voies, pour que la
     personne qui le reçoit ne voie aucune différence. */
  function corps(v) {
    return [
      'Demande de rendez-vous depuis le site.',
      '',
      'Prénom    : ' + v.prenom,
      'Nom       : ' + v.nom,
      'E-mail    : ' + v.email,
      'Téléphone : ' + v.telephone,
      '',
      'Message :',
      v.message || '(aucun)',
    ].join('\n');
  }

  /* ---------- la voie de secours : le logiciel de courrier du visiteur ----------
     Ce n'est PAS un faux envoi : le message part vraiment, simplement depuis le
     compte du visiteur. On le lui dit franchement. */
  function parCourrier(v) {
    const url = 'mailto:' + DESTINATAIRE
      + '?subject=' + encodeURIComponent('Demande de rendez-vous — ' + v.prenom + ' ' + v.nom)
      + '&body=' + encodeURIComponent(corps(v));
    dire('ok', 'Votre logiciel de courrier s’ouvre avec votre demande : il ne reste qu’à l’envoyer.');
    location.href = url;
  }

  /* ---------- la voie normale : le Web App Google Apps Script ----------
     `text/plain` est délibéré : c'est ce qui fait de la requête une requête
     « simple » au sens du navigateur, donc SANS appel préalable OPTIONS — que
     les Web Apps Apps Script ne savent pas traiter. Le script lit le corps
     avec JSON.parse(e.postData.contents). */
  async function parEndpoint(v) {
    const reponse = await fetch(CONTACT_FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...v, source: location.href, envoyeLe: new Date().toISOString() }),
      redirect: 'follow',
    });
    if (!reponse.ok) throw new Error('reponse ' + reponse.status);
    return reponse;
  }

  async function envoyer(ev) {
    ev.preventDefault();
    if (envoiEnCours) return;                       /* le double-clic ne passe pas */

    /* le leurre : silencieux, et on ne dit jamais au robot qu'il a été reconnu
       — sinon il apprend. Un humain ne voit pas ce champ et ne peut pas l'atteindre. */
    const robot = !!(piege && piege.value);

    let premierFaux = null;
    for (const c of champs) if (!verifier(c, true) && !premierFaux) premierFaux = c;
    if (premierFaux) {
      dire('erreur', 'Quelques informations manquent avant l’envoi.');
      premierFaux.focus();
      return;
    }

    if (robot) { dire('ok', 'Votre demande est bien enregistrée. Nous vous rappelons rapidement.'); return; }

    const v = recolte();
    envoiEnCours = true;
    bouton.disabled = true;
    dire('envoi', 'Envoi en cours…');

    if (!CONTACT_FORM_ENDPOINT) {
      envoiEnCours = false;
      bouton.disabled = false;
      parCourrier(v);
      return;
    }

    try {
      await parEndpoint(v);
      form.reset();
      dire('ok', 'Votre demande est partie. Nous vous rappelons sous 24 heures ouvrées.');
    } catch (e) {
      dire('erreur', 'L’envoi n’a pas abouti. Réessayez, ou joignez-nous directement au 09 81 22 25 66.');
    } finally {
      /* Le bouton reprend vie DANS TOUS LES CAS. Le laisser éteint après un
         succès semblait prudent — c'était en réalité une commande morte : le
         formulaire venait d'être vidé, et quelqu'un qui voulait écrire une
         seconde fois n'avait plus rien pour le faire. Le double envoi est déjà
         empêché pendant l'envoi lui-même, par le verrou et par `envoiEnCours` ;
         après, un clic sur un formulaire vide se heurte à la validation. */
      envoiEnCours = false;
      bouton.disabled = false;
    }
  }

  form.addEventListener('submit', envoyer);
  return { destroy() { form.removeEventListener('submit', envoyer); } };
}

export default initFormulaire;

/* ============================================================================
   LE CODE À COLLER DANS GOOGLE APPS SCRIPT
   ----------------------------------------------------------------------------
   Extensions ▸ Apps Script, tout remplacer par ceci, puis déployer en
   « Application Web » (exécuter en tant que : moi · qui a accès : tout le monde).

   Il écrit une ligne dans la feuille et envoie un courriel d'alerte. L'adresse
   d'alerte vit ICI, chez Google : elle n'apparaît jamais dans la page.

     const ALERTE = 'mettre.ici@votre-adresse.fr';

     function doPost(e) {
       const d = JSON.parse(e.postData.contents);
       const f = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
       if (f.getLastRow() === 0) {
         f.appendRow(['Reçu le', 'Prénom', 'Nom', 'E-mail', 'Téléphone', 'Message', 'Page']);
       }
       f.appendRow([new Date(), d.prenom, d.nom, d.email, d.telephone, d.message, d.source]);
       if (ALERTE) {
         MailApp.sendEmail({
           to: ALERTE,
           subject: 'Demande de rendez-vous — ' + d.prenom + ' ' + d.nom,
           replyTo: d.email,
           body: 'Prénom : ' + d.prenom + '\nNom : ' + d.nom
               + '\nE-mail : ' + d.email + '\nTéléphone : ' + d.telephone
               + '\n\nMessage :\n' + (d.message || '(aucun)'),
         });
       }
       return ContentService
         .createTextOutput(JSON.stringify({ ok: true }))
         .setMimeType(ContentService.MimeType.JSON);
     }

   Après un changement du code, il faut REDÉPLOYER (Déployer ▸ Gérer les
   déploiements ▸ crayon ▸ Version : nouvelle), sinon l'ancienne version reste
   servie à la même adresse.
   ========================================================================== */
