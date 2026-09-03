<?php
declare(strict_types=1);
/* =====================================================================
   La Compagnie de l'Or — PROXY GOLD-API (PHP, hebergement mutualise)
   ---------------------------------------------------------------------
   MEME CONTRAT, MEMES URL, MEMES REPONSES que server/metaux.mjs.
   Cible : Hostinger mutualise (PHP 7.4+, pas de composer, pas de daemon).

   URL servies (via .htaccess, ou en repli ?route=) :
     /api/metaux/prix        (cache 30 s, partage entre TOUS les visiteurs)
     /api/metaux/serie?symbole=XAU&tf=1J
     /api/metaux/ohlc?symbole=XAU&tf=1M
     /api/metaux/capacites   (detection reelle, cache 6 h)
     /api/metaux/sante
     /api/metaux/autotest    (verifie les fonctions pures, SANS reseau)

   ---------------------------------------------------------------------
   REGLE ABSOLUE : aucune donnee de marche inventee.
   Aucune bougie fabriquee, aucune valeur de remplissage, jamais de 0
   "par defaut". Une valeur absente est omise ou signalee indisponible.

   ---------------------------------------------------------------------
   D'OU VIENT CHAQUE CHIFFRE (§ 2.2 du contrat)
   ---------------------------------------------------------------------
   /ohlc ne renvoie qu'UN objet resumant toute la plage : il ne peut donc
   PAS produire de chandeliers. Il n'alimente que la bande de statistiques.

   Les chandeliers sont re-echantillonnes depuis de vraies donnees
   /history, demandees a une granularite S PLUS FINE que la bougie B.
   Trois appels, meme plage, meme groupBy = S :
     1) aggregation=avg & orderBy=asc -> serie reelle ordonnee
          open  = valeur du PREMIER sous-point du seau
          close = valeur du DERNIER sous-point du seau
     2) aggregation=max -> high = MAX des maxima des sous-seaux
     3) aggregation=min -> low  = MIN des minima des sous-seaux
     time = debut du seau (epoch s UTC), calcule depuis le champ de temps
            REELLEMENT renvoye par l'API (detecte a l'execution)
     n    = nombre de sous-points REELS ayant servi a la bougie

   Une bougie n'est emise QUE si le seau contient au moins 2 sous-points
   reels, que les series max ET min y ont un point, que les 4 valeurs sont
   finies et > 0, et que high >= max(O,C) et low <= min(O,C). Sinon elle
   est REJETEE (jamais corrigee). Aucun trou n'est comble.

   ---------------------------------------------------------------------
   SECURITE DE LA CLE (§ 3)
   ---------------------------------------------------------------------
   - GOLD_API_KEY lue via getenv(), puis $_SERVER/$_ENV, puis un fichier
     .env cherche UNIQUEMENT hors du dossier public (ou dans /api, ferme
     par api/.htaccess). Aucun candidat a la racine web : un .htaccess y
     est certes livre, mais un serveur qui ignore .htaccess (nginx) le
     servirait en clair.
   - Envoyee uniquement dans l'en-tete x-api-key vers api.gold-api.com.
   - AUCUNE redirection suivie automatiquement : CURLOPT_FOLLOWLOCATION
     est a false et follow_location a 0. curl, comme undici, ne retire que
     Authorization et Cookie quand une redirection change d'hote : un
     en-tete maison comme x-api-key serait RECOPIE vers la destination.
     Une 3xx est donc inspectee a la main et suivie SEULEMENT si l'hote
     d'arrivee est celui de l'amont configure (sans rebasculer en http).
   - Le corps d'erreur brut de Gold-API n'est JAMAIS relaye ni journalise.
   - Filet : toute reponse passe par mt_masquer() avant d'etre ecrite.
   ===================================================================== */

/* ------------------------------------------------------------------ */
/* 0. Reglages                                                         */
/* ------------------------------------------------------------------ */

define('MT_BASE_OFFICIELLE', 'https://api.gold-api.com');
define('MT_BASE', rtrim((string)(getenv('GOLD_API_BASE') ?: MT_BASE_OFFICIELLE), '/'));
define('MT_SIMULATION', MT_BASE !== MT_BASE_OFFICIELLE);
define('MT_UA', 'CompagnieDeLOr/1.0 (proxy metaux; cache 30s)');
define('MT_TIMEOUT', 5000);          // millisecondes, par appel amont
define('MT_TIMEOUT_SONDE', 2500);    // sondes de capacites : plus court
/** Budget GLOBAL de la detection de capacites, toutes sondes confondues.
 *  Sans lui, six sondes en serie font attendre le premier visiteur bien
 *  au-dela des "timeouts stricts" du contrat quand l'amont est muet. */
define('MT_BUDGET_CAPACITES', 8000);
define('MT_ONCE_TROY_G', 31.1034768);
define('MT_DEVISE_PRIX', 'EUR');
define('MT_MAX_BOUGIES', 2000);
/** Hote unique vers lequel la cle a le droit de partir (cf. redirections). */
define('MT_HOTE_AMONT', (string)parse_url(MT_BASE, PHP_URL_HOST));
define('MT_MAX_REDIRECTIONS', 2);

/** Durees de cache, en secondes. 30 s pour les prix = OBLIGATOIRE.
 *  capacites  : 6 h, mais SEULEMENT si la detection a reellement abouti.
 *  capacitesRepli : detection vide ou coupee par le budget -> on reessaie
 *  vite au lieu de figer une panne passagere pour six heures. */
$MT_TTL = array('prix' => 30, 'serieFine' => 60, 'serieMoyen' => 300, 'serieLarge' => 900,
                'capacites' => 21600, 'capacitesRepli' => 90);

/** Recul (backoff) apres un echec amont, en secondes. Une panne est
 *  exactement le moment ou l'API bloque les IP qui la martelent : apres un
 *  echec on re-arme le cache au lieu de laisser chaque visiteur suivant
 *  relancer une salve. Quota (429) et forfait (403) recultent plus long :
 *  ces refus ne se resolvent pas en reessayant tout de suite. */
$MT_RECUL = array('echec' => 20, 'quota' => 120, 'refus' => 300, 'cle' => 300, 'froid' => 10);

function mt_recul_pour(string $raison): int
{
    global $MT_RECUL;
    if (isset($MT_RECUL[$raison])) return (int)$MT_RECUL[$raison];
    return (int)$MT_RECUL['echec'];
}

/** Les 4 metaux du selecteur. */
$MT_METAUX = array(
    array('symbole' => 'XAU', 'nom' => 'Or'),
    array('symbole' => 'XAG', 'nom' => 'Argent'),
    array('symbole' => 'XPT', 'nom' => 'Platine'),
    array('symbole' => 'XPD', 'nom' => 'Palladium'),
);

$MT_GRANULARITES = array('minute', 'hour', 'day', 'week', 'month', 'year');

/* --------------------------------------------------------------------
   Tableau des timeframes REELLEMENT constructibles (§ 2.3)
   INVARIANT : la bougie B est TOUJOURS strictement plus large que la
   granularite S. Une bougie ou S = B n'aurait qu'UN point reel : elle
   serait plate, donc fabriquee. C'est pourquoi le contrat ecarte
   "3M avec S=day, B=1 jour", pourquoi il n'y a PAS de bouton "1 min",
   et pourquoi la semaine se construit en 1 h depuis S=minute (repli
   honnete en 4 h depuis S=hour si la minute n'est pas au forfait).
   -------------------------------------------------------------------- */
$MT_TF = array(
    '5min'  => array('libelle' => '5 min',     'plage' => 12 * 3600,        'variantes' => array(
        array('granularite' => 'minute', 'bougie' => array('type' => 'sec', 'n' => 300)))),
    '15min' => array('libelle' => '15 min',    'plage' => 2 * 86400,        'variantes' => array(
        array('granularite' => 'minute', 'bougie' => array('type' => 'sec', 'n' => 900)))),
    '1h'    => array('libelle' => '1 h',       'plage' => 3 * 86400,        'variantes' => array(
        array('granularite' => 'minute', 'bougie' => array('type' => 'sec', 'n' => 3600)))),
    '1J'    => array('libelle' => '1 jour',    'plage' => 86400,            'variantes' => array(
        array('granularite' => 'minute', 'bougie' => array('type' => 'sec', 'n' => 300)))),
    '1S'    => array('libelle' => '1 semaine', 'plage' => 7 * 86400,        'variantes' => array(
        array('granularite' => 'minute', 'bougie' => array('type' => 'sec', 'n' => 3600)),
        array('granularite' => 'hour',   'bougie' => array('type' => 'sec', 'n' => 14400)))),
    '1M'    => array('libelle' => '1 mois',    'plage' => 30 * 86400,       'variantes' => array(
        array('granularite' => 'hour',   'bougie' => array('type' => 'jour')))),
    '3M'    => array('libelle' => '3 mois',    'plage' => 90 * 86400,       'variantes' => array(
        array('granularite' => 'hour',   'bougie' => array('type' => 'jour')),
        array('granularite' => 'day',    'bougie' => array('type' => 'semaine')))),
    '1A'    => array('libelle' => '1 an',      'plage' => 365 * 86400,      'variantes' => array(
        array('granularite' => 'day',    'bougie' => array('type' => 'semaine')))),
    'MAX'   => array('libelle' => 'Max',       'plage' => 10 * 365 * 86400, 'variantes' => array(
        array('granularite' => 'week',   'bougie' => array('type' => 'mois')))),
);
$MT_TF_ORDRE = array('5min', '15min', '1h', '1J', '1S', '1M', '3M', '1A', 'MAX');

$MT_MESSAGES = array(
    'cle'       => "Service de marché non configuré (clé absente ou refusée).",
    'refus'     => "Cette granularité n'est pas incluse dans le forfait.",
    'quota'     => "Quota de la source de marché atteint.",
    'timeout'   => "La source de marché n'a pas répondu à temps.",
    'reseau'    => "Source de marché injoignable.",
    'api'       => "La source de marché a renvoyé une erreur.",
    'forme'     => "Réponse inattendue de la source de marché.",
    'redirection' => "La source de marché a renvoyé une redirection inattendue.",
    'timeframe' => "Cette période n'est pas constructible avec les granularités disponibles.",
    'parametre' => "Paramètre invalide.",
);

/* ------------------------------------------------------------------ */
/* 1. Erreur normalisee                                                */
/* ------------------------------------------------------------------ */
class MtErreur extends RuntimeException
{
    /** @var string 'cle'|'refus'|'quota'|'timeout'|'reseau'|'api'|'forme' */
    public $raison;
    public $statut;
    public function __construct(string $raison, int $statut = 0, string $message = '')
    {
        parent::__construct($message !== '' ? $message : $raison);
        $this->raison = $raison;
        $this->statut = $statut;
    }
}

/* ------------------------------------------------------------------ */
/* 2. Cle : lecture et masquage                                        */
/* ------------------------------------------------------------------ */

function mt_lire_cle(): string
{
    static $memo = null;
    if ($memo !== null) return $memo;

    $cle = '';
    $v = getenv('GOLD_API_KEY');
    if (is_string($v) && trim($v) !== '') $cle = trim($v);
    if ($cle === '' && isset($_SERVER['GOLD_API_KEY']) && trim((string)$_SERVER['GOLD_API_KEY']) !== '') $cle = trim((string)$_SERVER['GOLD_API_KEY']);
    if ($cle === '' && isset($_ENV['GOLD_API_KEY']) && trim((string)$_ENV['GOLD_API_KEY']) !== '') $cle = trim((string)$_ENV['GOLD_API_KEY']);

    if ($cle === '') {
        // Fichiers .env, du plus sur au moins sur. AUCUN candidat a la
        // racine du site : elle est publique, et un .htaccess n'est lu ni
        // par nginx ni par un Apache sans AllowOverride. Le dossier /api,
        // lui, est ferme par api/.htaccess ET sert de dernier recours.
        $candidats = array();
        $perso = getenv('METAUX_ENV_FICHIER');
        if (is_string($perso) && $perso !== '') $candidats[] = $perso;
        $candidats[] = dirname(__DIR__, 2) . '/.env';   // ~/.env  (hors public_html)
        $candidats[] = __DIR__ . '/.env';               // dernier recours, ferme par api/.htaccess
        foreach ($candidats as $f) {
            if (!is_string($f) || $f === '' || !@is_readable($f)) continue;
            $brut = @file_get_contents($f);
            if ($brut === false) continue;
            if (preg_match('/^[ \t]*GOLD_API_KEY[ \t]*=[ \t]*(.*)$/m', $brut, $m)) {
                $val = trim($m[1]);
                $val = trim($val, "\"'");
                if ($val !== '') { $cle = $val; break; }
            }
        }
    }
    $memo = $cle;
    return $memo;
}

/** Filet de securite : retire toute occurrence de la cle d'une chaine. */
function mt_masquer(string $txt): string
{
    $cle = mt_lire_cle();
    if ($cle === '' || strlen($cle) < 8) return $txt;
    return str_replace($cle, '***', $txt);
}

/* ------------------------------------------------------------------ */
/* 3. Cache fichier partage, avec verrou (anti-avalanche)              */
/* ------------------------------------------------------------------ */

function mt_dossier_cache(): string
{
    static $memo = null;
    if ($memo !== null) return $memo;

    // 1) hors du dossier public si possible, 2) tmp systeme, 3) ./cache protege
    $candidats = array(
        dirname(__DIR__, 2) . '/storage/metaux-cache',
        rtrim(sys_get_temp_dir(), '/\\') . '/cdlor-metaux',
        __DIR__ . '/cache',
    );
    foreach ($candidats as $d) {
        if (!is_dir($d) && !@mkdir($d, 0770, true) && !is_dir($d)) continue;
        if (!is_writable($d)) continue;
        // Si le dossier est sous la racine web, on le ferme a double tour.
        if (strpos($d, __DIR__) === 0 && !is_file($d . '/.htaccess')) {
            @file_put_contents($d . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        }
        if (!is_file($d . '/index.html')) @file_put_contents($d . '/index.html', '');
        $memo = $d;
        return $memo;
    }
    throw new MtErreur('api', 0, 'aucun dossier de cache inscriptible');
}

function mt_chemin_cache(string $cle): string
{
    return mt_dossier_cache() . '/' . preg_replace('/[^A-Za-z0-9_.-]/', '_', $cle) . '.json';
}

/**
 * @return array|null  ['t'=>epoch de la donnee, 'v'=>valeur,
 *                      'exp'=>epoch d'expiration (optionnel, pose par le
 *                      recul apres echec), 'ec'=>raison d'echec en cours]
 */
function mt_cache_lire(string $f, int $ttlMax)
{
    if (!is_file($f)) return null;
    $brut = @file_get_contents($f);
    if ($brut === false || $brut === '') return null;
    $d = json_decode($brut, true);
    if (!is_array($d) || !array_key_exists('t', $d) || !array_key_exists('v', $d)) return null;
    if ($ttlMax === PHP_INT_MAX) return $d;
    // Une expiration explicite (recul apres echec) prime sur le TTL nominal.
    if (isset($d['exp'])) return time() < (int)$d['exp'] ? $d : null;
    if ((time() - (int)$d['t']) >= $ttlMax) return null;
    return $d;
}

/**
 * @param int|null $expire  epoch d'expiration explicite (recul), ou null
 * @param string|null $echec raison de l'echec en cours, ou null
 * @param int|null $tDonnee  epoch de la donnee (pour ne pas rajeunir une
 *                           valeur perimee que l'on ne fait que re-armer)
 */
function mt_cache_ecrire(string $f, $valeur, ?int $expire = null, ?string $echec = null, ?int $tDonnee = null): void
{
    $enr = array('t' => $tDonnee !== null ? $tDonnee : time(), 'v' => $valeur);
    if ($expire !== null) $enr['exp'] = $expire;
    if ($echec !== null)  $enr['ec'] = $echec;
    $tmp = $f . '.' . getmypid() . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($enr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION));
    if ($ok === false) { @unlink($tmp); return; }
    if (!@rename($tmp, $f)) { @unlink($tmp); }   // rename = publication atomique
}

function mt_servir(array $enr, int $ttl, bool $degrade, ?string $raison): array
{
    // Une entree re-armee apres echec reste marquee degrade : re-armer ne
    // doit jamais faire passer une donnee perimee pour fraiche.
    if (!$degrade && isset($enr['ec']) && is_string($enr['ec']) && $enr['ec'] !== '') {
        $degrade = true;
        $raison = $enr['ec'];
    }
    $r = array('valeur' => $enr['v'], 'age' => max(0, time() - (int)$enr['t']), 'ttl' => $ttl, 'degrade' => $degrade);
    if ($degrade) {
        $r['raison'] = $raison ?: 'api';
        if (isset($enr['exp'])) {
            $reste = (int)$enr['exp'] - time();
            if ($reste > 0) $r['recul'] = $reste;
        }
    }
    return $r;
}

/**
 * Cache partage + anti-avalanche : UNE seule requete sortante par cle.
 * Les processus concurrents attendent le resultat du premier au lieu de
 * lancer leur propre appel (l'API bloque les IP qui la martelent).
 *
 * RECUL APRES ECHEC : le verrou ne protege que les requetes SIMULTANEES.
 * Sans recul, vingt visiteurs successifs pendant une panne relancent vingt
 * salves — pile au moment ou l'API bloque les IP. Apres un echec on ecrit
 * donc une expiration explicite (courte, ou longue sur 429/403) et l'on
 * continue de servir la derniere valeur VRAIE, marquee degrade.
 *
 * @param callable|null $ttlDe  fonction(valeur) -> TTL variable
 */
function mt_cache_obtenir(string $cle, int $ttl, callable $producteur, ?callable $ttlDe = null): array
{
    $f = mt_chemin_cache($cle);

    $frais = mt_cache_lire($f, $ttl);
    if ($frais !== null) return mt_servir($frais, $ttl, false, null);

    // Echec recent SANS aucune valeur a montrer : on ne relance pas une
    // salve a chaque visiteur (fichier de recul distinct, car il n'y a
    // justement pas d'entree de cache a re-armer).
    $fFroid = $f . '.froid';
    if (is_file($fFroid)) {
        $fr = json_decode((string)@file_get_contents($fFroid), true);
        if (is_array($fr) && isset($fr['exp']) && time() < (int)$fr['exp']) {
            throw new MtErreur(isset($fr['r']) ? (string)$fr['r'] : 'api', 0, 'recul apres echec amont');
        }
    }

    $verrou = @fopen($f . '.lock', 'c');
    // Si le verrou est impossible a creer (droits), on produit quand meme :
    // mieux vaut perdre l'anti-avalanche que de ne rien servir du tout.
    $jeProduis = ($verrou === false) || @flock($verrou, LOCK_EX | LOCK_NB);

    if ($jeProduis) {
        // Ce processus est le seul a appeler l'amont.
        try {
            // Quelqu'un a pu remplir le cache pendant qu'on prenait le verrou.
            $entre = mt_cache_lire($f, $ttl);
            if ($entre !== null) return mt_servir($entre, $ttl, false, null);

            $v = $producteur();
            $ttlReel = $ttlDe !== null ? (int)$ttlDe($v) : $ttl;
            mt_cache_ecrire($f, $v, time() + max(1, $ttlReel));
            @unlink($fFroid);
            return array('valeur' => $v, 'age' => 0, 'ttl' => $ttlReel, 'degrade' => false);
        } catch (MtErreur $e) {
            $recul = mt_recul_pour($e->raison);
            $vieux = mt_cache_lire($f, PHP_INT_MAX);
            if ($vieux !== null) {
                // derniere valeur VRAIE + re-armement : plus une seule salve
                // amont tant que le recul court, mais la reponse reste
                // marquee degrade avec son age reel.
                mt_cache_ecrire($f, $vieux['v'], time() + $recul, $e->raison, (int)$vieux['t']);
                $vieux['exp'] = time() + $recul;
                return mt_servir($vieux, $ttl, true, $e->raison);
            }
            $froid = in_array($e->raison, array('quota', 'refus', 'cle'), true) ? $recul : mt_recul_pour('froid');
            @file_put_contents($fFroid, json_encode(array('exp' => time() + $froid, 'r' => $e->raison)));
            throw $e;                                                               // rien de vrai a montrer
        } finally {
            if ($verrou !== false) { @flock($verrou, LOCK_UN); @fclose($verrou); }
        }
    }

    // Un autre processus travaille : on attend SON resultat.
    if ($verrou !== false) @fclose($verrou);
    $limite = microtime(true) + (MT_TIMEOUT / 1000.0) + 1.5;
    while (microtime(true) < $limite) {
        usleep(90000);
        $apres = mt_cache_lire($f, $ttl);
        if ($apres !== null) return mt_servir($apres, $ttl, false, null);
    }
    $vieux = mt_cache_lire($f, PHP_INT_MAX);
    if ($vieux !== null) return mt_servir($vieux, $ttl, true, 'timeout');
    throw new MtErreur('timeout', 0, 'attente du verrou depassee');
}

/** Valeur deja connue (meme perimee) sans declencher le moindre appel. */
function mt_coup_doeil(string $cle)
{
    try { $f = mt_chemin_cache($cle); } catch (MtErreur $e) { return null; }
    $d = mt_cache_lire($f, PHP_INT_MAX);
    return $d === null ? null : $d['v'];
}

/* ------------------------------------------------------------------ */
/* 4. Appel amont : timeout strict, erreurs normalisees                */
/* ------------------------------------------------------------------ */

/**
 * Une redirection n'est suivie QUE si elle reste sur l'hote de l'amont et
 * ne rebascule pas de https vers http. C'est la seule barriere : ni curl
 * ni les flux PHP ne retirent un en-tete maison comme x-api-key quand la
 * redirection change d'origine.
 * @return string|null URL autorisee, ou null (redirection refusee)
 */
function mt_cible_autorisee(?string $emplacement, string $depuis): ?string
{
    if (!is_string($emplacement) || trim($emplacement) === '') return null;
    $emplacement = trim($emplacement);
    // Resolution des chemins relatifs contre l'URL de depart.
    if (!preg_match('#^https?://#i', $emplacement)) {
        $b = parse_url($depuis);
        if (!is_array($b) || empty($b['host'])) return null;
        $racine = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if (substr($emplacement, 0, 1) === '/') $emplacement = $racine . $emplacement;
        else {
            $dir = isset($b['path']) ? preg_replace('#/[^/]*$#', '/', $b['path']) : '/';
            $emplacement = $racine . $dir . $emplacement;
        }
    }
    $u = parse_url($emplacement);
    $d = parse_url($depuis);
    if (!is_array($u) || empty($u['host']) || !is_array($d)) return null;

    $hoteCible = $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $hoteAmont = (string)$d['host'] . (isset($d['port']) ? ':' . $d['port'] : '');
    if (strcasecmp($hoteCible, $hoteAmont) !== 0) return null;

    $schemaCible = strtolower((string)$u['scheme']);
    $schemaDepart = strtolower((string)$d['scheme']);
    if ($schemaDepart === 'https' && $schemaCible !== 'https') return null;   // pas de retrogradation
    if ($schemaCible !== 'https' && $schemaCible !== $schemaDepart) return null;
    return $emplacement;
}

function mt_appel(string $chemin, array $params = array(), bool $avecCle = false, int $timeout = MT_TIMEOUT)
{
    $qs = array();
    foreach ($params as $k => $v) {
        if ($v === null || $v === '') continue;
        $qs[$k] = is_bool($v) ? ($v ? '1' : '0') : (string)$v;
    }
    $url = MT_BASE . $chemin . ($qs ? '?' . http_build_query($qs) : '');

    $entetes = array('Accept: application/json', 'User-Agent: ' . MT_UA);
    if ($avecCle) {
        $cle = mt_lire_cle();
        if ($cle === '') throw new MtErreur('cle', 0, 'GOLD_API_KEY absente cote serveur');
        $entetes[] = 'x-api-key: ' . $cle;      // <- seul endroit ou la cle circule
    }

    $corps = false;
    $statut = 0;
    $sauts = 0;
    $debutMs = microtime(true) * 1000;

    // Boucle de redirection MANUELLE : jamais FOLLOWLOCATION / follow_location.
    while (true) {
        $reste = (int)max(300, $timeout - (int)(microtime(true) * 1000 - $debutMs));
        $emplacement = null;

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, array(
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER     => $entetes,
                CURLOPT_TIMEOUT_MS     => $reste,
                CURLOPT_CONNECTTIMEOUT_MS => min(3000, $reste),
                CURLOPT_FOLLOWLOCATION => false,   // <- la cle ne suit AUCUNE redirection
                CURLOPT_MAXREDIRS      => 0,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_ENCODING       => '',
            ));
            $corps  = curl_exec($ch);
            $statut = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $emplacement = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            $errno  = curl_errno($ch);
            curl_close($ch);
            if ($corps === false) {
                throw new MtErreur(in_array($errno, array(28), true) ? 'timeout' : 'reseau', 0, 'appel amont interrompu');
            }
        } else {
            $ctx = stream_context_create(array(
                'http' => array(
                    'method'        => 'GET',
                    'header'        => implode("\r\n", $entetes),
                    'timeout'       => $reste / 1000.0,
                    'ignore_errors' => true,
                    'follow_location' => 0,        // <- idem cote flux PHP
                    'max_redirects' => 0,
                ),
                'ssl'  => array('verify_peer' => true, 'verify_peer_name' => true),
            ));
            $corps = @file_get_contents($url, false, $ctx);
            $statut = 0;
            if (isset($http_response_header) && is_array($http_response_header)) {
                foreach ($http_response_header as $h) {
                    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $statut = (int)$m[1]; $emplacement = null; }
                    elseif (preg_match('#^Location:\s*(.+)$#i', $h, $m)) $emplacement = trim($m[1]);
                }
            }
            if ($corps === false && $statut === 0) throw new MtErreur('reseau', 0, 'appel amont interrompu');
        }

        if (!in_array($statut, array(301, 302, 303, 307, 308), true)) break;

        $suivant = mt_cible_autorisee(is_string($emplacement) ? $emplacement : null, $url);
        if ($suivant === null || $sauts >= MT_MAX_REDIRECTIONS) {
            // Ni l'URL de destination ni l'en-tete ne sont journalises :
            // seul le fait compte. La cle n'est pas partie chez cet hote.
            throw new MtErreur('redirection', $statut, 'redirection hors du domaine de la source');
        }
        $url = $suivant;
        $sauts++;
    }

    if ($statut < 200 || $statut >= 300) {
        // Le corps brut n'est ni relaye ni journalise : il pourrait
        // contenir la cle. Seul le code de statut est conserve.
        if ($statut === 401)                       throw new MtErreur('cle', $statut, 'reponse amont 401');
        if ($statut === 402 || $statut === 403)    throw new MtErreur('refus', $statut, 'reponse amont ' . $statut);
        if ($statut === 429)                       throw new MtErreur('quota', $statut, 'reponse amont 429');
        throw new MtErreur('api', $statut, 'reponse amont ' . $statut);
    }

    $donnees = json_decode($corps, true);
    if ($donnees === null && strtolower(trim((string)$corps)) !== 'null') throw new MtErreur('forme', $statut, 'reponse amont illisible');
    return $donnees;
}

/* ------------------------------------------------------------------ */
/* 5. Lecture defensive des reponses /history                          */
/* ------------------------------------------------------------------ */
/*  La documentation ne garantit AUCUN nom de champ precis : on les
 *  detecte sur la reponse reelle plutot que de les supposer.           */

/** Convertit une valeur numerique (nombre OU chaine numerique) en float,
 *  ou null. Evite toute arithmetique sur une chaine non numerique, qui
 *  leve une TypeError en PHP 8. */
function mt_num($v)
{
    if (is_int($v) || is_float($v)) { $f = (float)$v; return is_finite($f) ? $f : null; }
    if (is_string($v) && is_numeric(trim($v))) { $f = (float)trim($v); return is_finite($f) ? $f : null; }
    return null;
}

/** Un prix de metal est strictement positif. 0, null, negatif ou NaN ne
 *  sont PAS des prix : la valeur est absente, point. */
function mt_est_prix_brut($v): bool
{
    /* Gold-API renvoie les prix d'historique en CHAÎNES (« 4611.100100 »). */
    if (is_string($v)) { $v = trim($v); if ($v === '' || !is_numeric($v)) { return false; } $v = (float)$v; }
    return mt_est_prix($v);
}

function mt_est_prix($v): bool
{
    $f = mt_num($v);
    return $f !== null && $f > 0;
}

/** Convertit une valeur de champ "temps" en epoch secondes UTC, ou null. */
function mt_vers_epoch($v)
{
    /* « 2026-08-20 23 » (groupBy=hour) : strtotime ne le lit pas seul. */
    if (is_string($v) && preg_match('/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{1,2})$/', trim($v), $m)) {
        return gmmktime((int)$m[4], 0, 0, (int)$m[2], (int)$m[3], (int)$m[1]);
    }
    if ($v === null) return null;
    if (is_int($v) || is_float($v)) {
        $n = (float)$v;
        if (!is_finite($n)) return null;
        if ($n >= 1e12) return (int)floor($n / 1000);
        if ($n >= 1e9)  return (int)floor($n);
        if ($n >= 1800 && $n <= 2200) return (int)gmmktime(0, 0, 0, 1, 1, (int)$n);
        return null;
    }
    if (!is_string($v)) return null;
    $s = trim($v);
    if ($s === '') return null;
    if (preg_match('/^\d{4}$/', $s))              return (int)gmmktime(0, 0, 0, 1, 1, (int)$s);
    if (preg_match('/^(\d{4})-(\d{2})$/', $s, $m)) return (int)gmmktime(0, 0, 0, (int)$m[2], 1, (int)$m[1]);
    if (preg_match('/^(\d{4})-W(\d{1,2})$/i', $s, $m)) {
        $jan4 = (int)gmmktime(0, 0, 0, 1, 4, (int)$m[1]);
        $jour = (int)gmdate('N', $jan4) - 1;
        return $jan4 - $jour * 86400 + ((int)$m[2] - 1) * 604800;
    }
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m)) return (int)gmmktime(0, 0, 0, (int)$m[2], (int)$m[3], (int)$m[1]);
    if (preg_match('/^\d{10}$/', $s)) return (int)$s;
    if (preg_match('/^\d{13}$/', $s)) return (int)floor(((float)$s) / 1000);
    $prep = preg_match('/Z|[+-]\d{2}:?\d{2}$/', $s) ? $s : (str_replace(' ', 'T', $s) . 'Z');
    $p = strtotime($prep);
    return $p === false ? null : (int)$p;
}

/** @return array|null array('temps'=>string,'prix'=>string) */
function mt_detecter_champs(array $lignes)
{
    /* Noms RELEVES sur l'API le 2026-08-24 (cle Premium) : date_minute, date_hour, day, week, year_month, year. */
    $champsTemps = array('date_minute', 'date_hour', 'day', 'week', 'year_month', 'year', 'minute', 'hour', 'month', 'time', 'timestamp', 'date', 'datetime', 'period', 'periode', 'startTimestamp');
    $ech = null;
    foreach ($lignes as $l) { if (is_array($l)) { $ech = $l; break; } }
    if ($ech === null) return null;
    $cles = array_keys($ech);

    $temps = null;
    foreach ($cles as $k) { if (in_array($k, $champsTemps, true) && mt_vers_epoch($ech[$k]) !== null) { $temps = $k; break; } }
    if ($temps === null) foreach ($cles as $k) { if (!mt_est_prix_brut($ech[$k]) && mt_vers_epoch($ech[$k]) !== null) { $temps = $k; break; } }
    if ($temps === null) foreach ($cles as $k) { if (preg_match('/time|date|period|jour|heure/i', $k) && mt_vers_epoch($ech[$k]) !== null) { $temps = $k; break; } }

    $prix = null;
    foreach ($cles as $k) { if (preg_match('/price|prix|value|valeur/i', $k) && mt_est_prix_brut($ech[$k])) { $prix = $k; break; } }
    if ($prix === null) foreach ($cles as $k) { if ($k !== $temps && mt_est_prix_brut($ech[$k])) { $prix = $k; break; } }

    if ($temps === null || $prix === null) return null;
    return array('temps' => $temps, 'prix' => $prix);
}

/** Normalise /history en points array('t'=>int,'v'=>float) tries croissants. */
function mt_normaliser_historique($brut): array
{
    $lignes = null;
    if (is_array($brut)) {
        if (array_key_exists(0, $brut) || $brut === array()) $lignes = $brut;
        elseif (isset($brut['data']) && is_array($brut['data'])) $lignes = $brut['data'];
        elseif (isset($brut['results']) && is_array($brut['results'])) $lignes = $brut['results'];
        elseif (isset($brut['history']) && is_array($brut['history'])) $lignes = $brut['history'];
    }
    if ($lignes === null) throw new MtErreur('forme', 200, 'reponse /history inattendue');
    if ($lignes === array()) return array('points' => array(), 'ignores' => 0, 'temps' => null, 'prix' => null);

    $champs = mt_detecter_champs($lignes);
    if ($champs === null) throw new MtErreur('forme', 200, 'champs /history non reconnus');

    $points = array();
    $ignores = 0;
    foreach ($lignes as $l) {
        if (!is_array($l)) { $ignores++; continue; }
        $t = array_key_exists($champs['temps'], $l) ? mt_vers_epoch($l[$champs['temps']]) : null;
        $v = array_key_exists($champs['prix'], $l) ? mt_num($l[$champs['prix']]) : null;
        if ($t === null || $v === null || $v <= 0) { $ignores++; continue; }
        $points[] = array('t' => $t, 'v' => $v);
    }
    usort($points, function ($a, $b) { return $a['t'] <=> $b['t']; });
    return array('points' => $points, 'ignores' => $ignores, 'temps' => $champs['temps'], 'prix' => $champs['prix']);
}

/* ------------------------------------------------------------------ */
/* 6. Assemblage des bougies (§ 2.2)                                   */
/* ------------------------------------------------------------------ */

function mt_debut_seau(int $t, array $b): int
{
    if ($b['type'] === 'sec') return intdiv($t, (int)$b['n']) * (int)$b['n'];
    $y = (int)gmdate('Y', $t); $m = (int)gmdate('n', $t); $d = (int)gmdate('j', $t);
    if ($b['type'] === 'jour')    return (int)gmmktime(0, 0, 0, $m, $d, $y);
    if ($b['type'] === 'semaine') return (int)gmmktime(0, 0, 0, $m, $d, $y) - ((int)gmdate('N', $t) - 1) * 86400;
    if ($b['type'] === 'mois')    return (int)gmmktime(0, 0, 0, $m, 1, $y);
    throw new MtErreur('api', 0, 'type de bougie inconnu');
}

function mt_grouper(array $points, array $bougie): array
{
    $m = array();
    foreach ($points as $p) {
        $b = mt_debut_seau((int)$p['t'], $bougie);
        if (!isset($m[$b])) $m[$b] = array();
        $m[$b][] = (float)$p['v'];      // points deja tries : ordre chronologique
    }
    return $m;
}

function mt_assembler(array $avg, array $max, array $min, array $bougie): array
{
    $gAvg = mt_grouper($avg, $bougie);
    $gMax = mt_grouper($max, $bougie);
    $gMin = mt_grouper($min, $bougie);

    $bougies = array();
    $rejets = array('sousPoints' => 0, 'hautBasManquant' => 0, 'incoherentes' => 0, 'valeurInvalide' => 0);

    $cles = array_keys($gAvg);
    sort($cles, SORT_NUMERIC);

    foreach ($cles as $t) {
        $vals = $gAvg[$t];
        if (count($vals) < 2) { $rejets['sousPoints']++; continue; }           // jamais de bougie plate fabriquee
        if (empty($gMax[$t]) || empty($gMin[$t])) { $rejets['hautBasManquant']++; continue; }

        $open  = $vals[0];
        $close = $vals[count($vals) - 1];
        $high  = max($gMax[$t]);
        $low   = min($gMin[$t]);

        if (!mt_est_prix($open) || !mt_est_prix($close) || !mt_est_prix($high) || !mt_est_prix($low)) { $rejets['valeurInvalide']++; continue; }

        $tol = $high * 1e-9;
        if ($high < max($open, $close) - $tol || $low > min($open, $close) + $tol) { $rejets['incoherentes']++; continue; }

        $bougies[] = array('time' => (int)$t, 'open' => $open, 'high' => $high, 'low' => $low, 'close' => $close, 'n' => count($vals));
    }
    return array('bougies' => $bougies, 'rejets' => $rejets);
}

/* ------------------------------------------------------------------ */
/* 7. Timeframes                                                       */
/* ------------------------------------------------------------------ */

function mt_resoudre_tf(string $id, $groupBy)
{
    global $MT_TF;
    if (!isset($MT_TF[$id])) return null;
    if (!is_array($groupBy)) return $MT_TF[$id]['variantes'][0];
    foreach ($MT_TF[$id]['variantes'] as $v) {
        if (isset($groupBy[$v['granularite']]) && $groupBy[$v['granularite']] === true) return $v;
    }
    return null;
}

function mt_etiquette_bougie(array $b): string
{
    if ($b['type'] === 'sec') return ((int)$b['n'] % 3600 === 0) ? ((int)$b['n'] / 3600) . ' h' : ((int)$b['n'] / 60) . ' min';
    return $b['type'];
}

/** TTL choisi d'apres la TAILLE DE BOUGIE (60 s intraday -> 15 min longues). */
function mt_ttl_serie(array $bougie): int
{
    global $MT_TTL;
    if ($bougie['type'] === 'sec') {
        if ((int)$bougie['n'] <= 300) return $MT_TTL['serieFine'];
        if ((int)$bougie['n'] <= 900) return min($MT_TTL['serieMoyen'], $MT_TTL['serieFine'] * 2);
        return $MT_TTL['serieMoyen'];
    }
    if ($bougie['type'] === 'jour') return min($MT_TTL['serieLarge'], $MT_TTL['serieMoyen'] * 2);
    return $MT_TTL['serieLarge'];
}

function mt_variante_connue(string $id): array
{
    global $MT_TF;
    $caps = mt_coup_doeil('capacites');
    $gb = (is_array($caps) && !empty($caps['cle']) && isset($caps['groupBy'])) ? $caps['groupBy'] : null;
    $v = mt_resoudre_tf($id, $gb);
    return $v === null ? $MT_TF[$id]['variantes'][0] : $v;
}

/* ------------------------------------------------------------------ */
/* 8. Capacites : detection REELLE, cache long                         */
/* ------------------------------------------------------------------ */

function mt_sonder_granularite(string $g, int $timeout = MT_TIMEOUT_SONDE): array
{
    $plages = array('minute' => 3 * 3600, 'hour' => 4 * 86400, 'day' => 60 * 86400, 'week' => 400 * 86400, 'month' => 5 * 365 * 86400, 'year' => 20 * 365 * 86400);
    $fin = time();
    $debut = $fin - (isset($plages[$g]) ? $plages[$g] : 86400);
    try {
        $brut = mt_appel('/history', array(
            'symbol' => 'XAU', 'startTimestamp' => $debut, 'endTimestamp' => $fin,
            'groupBy' => $g, 'aggregation' => 'avg', 'orderBy' => 'asc',
        ), true, $timeout);
        $n = mt_normaliser_historique($brut);
        return array('ok' => count($n['points']) > 0, 'points' => $n['points'], 'temps' => $n['temps'], 'prix' => $n['prix']);
    } catch (MtErreur $e) {
        return array('ok' => false, 'raison' => $e->raison);
    }
}

function mt_detecter_capacites(): array
{
    global $MT_GRANULARITES, $MT_TF, $MT_TF_ORDRE, $MT_TTL;
    // Le budget global suffit desormais a borner la detection ; ce garde-fou
    // ne sert qu'aux hebergements ou max_execution_time est tres bas.
    @set_time_limit(30);

    $cle = mt_lire_cle() !== '';
    $base = array(
        'cle' => $cle,
        'simulation' => MT_SIMULATION,
        'groupBy' => array(),
        'devise' => null,
        'deviseHistorique' => null,
        'deviseConfiance' => 'indeterminee',
        'deviseParametrable' => false,
        'devisePrix' => MT_DEVISE_PRIX,
        'tf' => array(),
        'tfDetail' => array(),
        'champs' => null,
        'detectionUtile' => false,
        'sondeeA' => gmdate('c'),
    );
    foreach ($MT_GRANULARITES as $g) $base['groupBy'][$g] = false;

    if (!$cle) {
        $base['note'] = 'GOLD_API_KEY absente : /history et /ohlc sont inaccessibles.';
        foreach ($MT_TF_ORDRE as $id) {
            $base['tfDetail'][] = array('id' => $id, 'libelle' => $MT_TF[$id]['libelle'], 'disponible' => false,
                'granularite' => null, 'bougie' => null, 'raison' => 'cle absente');
        }
        return $base;   // TTL court : une cle posee plus tard prend effet vite
    }

    // BUDGET GLOBAL : toute la detection tient dans MT_BUDGET_CAPACITES.
    $t0 = microtime(true) * 1000;
    $reste = function () use ($t0) { return (int)(MT_BUDGET_CAPACITES - (microtime(true) * 1000 - $t0)); };
    $budgetEpuise = false;

    // 8.1 — une sonde par granularite, en serie (on ne martele pas l'API)
    $echantillons = array();
    foreach ($MT_GRANULARITES as $g) {
        $dispo = min(MT_TIMEOUT_SONDE, $reste());
        if ($dispo < 400) { $budgetEpuise = true; break; }
        $r = mt_sonder_granularite($g, (int)$dispo);
        $base['groupBy'][$g] = (bool)$r['ok'];
        if ($r['ok']) {
            $echantillons[$g] = $r['points'];
            if ($base['champs'] === null) $base['champs'] = array('temps' => $r['temps'], 'prix' => $r['prix']);
        }
    }
    if ($budgetEpuise) $base['budgetEpuise'] = true;

    // 8.2 — devise reellement renvoyee : comparaison d'ordres de grandeur
    //       avec /price. AUCUNE conversion n'est faite ici.
    $gFine = null;
    foreach (array('hour', 'day', 'week', 'month', 'year', 'minute') as $g) {
        if (!empty($echantillons[$g])) { $gFine = $g; break; }
    }
    if ($gFine !== null && $reste() > 900) {
        $pts = $echantillons[$gFine];
        $dernier = (float)$pts[count($pts) - 1]['v'];
        $pUsd = null; $pEur = null;
        try { $r = mt_appel('/price/XAU', array(), false, (int)min(MT_TIMEOUT_SONDE, max(600, $reste())));     if (is_array($r) && isset($r['price'])) $pUsd = mt_num($r['price']); } catch (MtErreur $e) { }
        try { $r = mt_appel('/price/XAU/EUR', array(), false, (int)min(MT_TIMEOUT_SONDE, max(600, $reste()))); if (is_array($r) && isset($r['price'])) $pEur = mt_num($r['price']); } catch (MtErreur $e) { }
        if ($pUsd !== null && $pUsd <= 0) $pUsd = null;
        if ($pEur !== null && $pEur <= 0) $pEur = null;
        if ($pUsd !== null && $pEur !== null) {
            $eUsd = abs($dernier / $pUsd - 1);
            $eEur = abs($dernier / $pEur - 1);
            $tolerance = in_array($gFine, array('minute', 'hour'), true) ? 0.08 : (in_array($gFine, array('day', 'week'), true) ? 0.2 : 0.45);
            if (min($eUsd, $eEur) <= $tolerance) {
                $base['deviseHistorique'] = $eUsd <= $eEur ? 'USD' : 'EUR';
                $base['deviseConfiance'] = abs($eUsd - $eEur) > 0.05 ? 'haute' : 'moyenne';
            }
        }
        // 8.3 — le parametre currency est-il pris en compte par l'amont ?
        if ($pEur !== null && $reste() > 900) {
            try {
                $fin = time();
                $brut = mt_appel('/history', array(
                    'symbol' => 'XAU', 'startTimestamp' => $fin - 4 * 86400, 'endTimestamp' => $fin,
                    'groupBy' => $gFine, 'aggregation' => 'avg', 'orderBy' => 'asc', 'currency' => 'EUR',
                ), true, (int)min(MT_TIMEOUT_SONDE, $reste()));
                $n = mt_normaliser_historique($brut);
                if (count($n['points']) > 0) {
                    $v = (float)$n['points'][count($n['points']) - 1]['v'];
                    if (abs($v / $dernier - 1) > 0.02 && abs($v / $pEur - 1) <= 0.08) {
                        $base['deviseParametrable'] = true;   // c'est l'API qui convertit, pas nous
                        $base['deviseHistorique'] = 'EUR';
                        $base['deviseConfiance'] = 'haute';
                    }
                }
            } catch (MtErreur $e) { /* parametre ignore ou refuse */ }
        }
    }
    $base['devise'] = $base['deviseHistorique'];

    // 8.4 — timeframes reellement constructibles
    foreach ($MT_TF_ORDRE as $id) {
        $v = mt_resoudre_tf($id, $base['groupBy']);
        if ($v !== null) $base['tf'][] = $id;
        $base['tfDetail'][] = array(
            'id' => $id, 'libelle' => $MT_TF[$id]['libelle'], 'disponible' => $v !== null,
            'granularite' => $v !== null ? $v['granularite'] : null,
            'bougie' => $v !== null ? mt_etiquette_bougie($v['bougie']) : null,
            'raison' => $v !== null ? null : 'granularites requises absentes du forfait',
        );
    }

    // 8.5 — la detection a-t-elle reellement appris quelque chose ? Elle
    // seule merite le cache long. Une detection vide ou coupee par le
    // budget serait une PANNE figee six heures.
    $utile = !$budgetEpuise;
    if ($utile) {
        $utile = false;
        foreach ($MT_GRANULARITES as $g) { if ($base['groupBy'][$g] === true) { $utile = true; break; } }
    }
    if ($utile) {
        $base['detectionUtile'] = true;
        // Derniere detection REUSSIE : conservee a part, jamais ecrasee
        // par un resultat de panne (le PHP ne garde rien entre requetes).
        try { mt_cache_ecrire(mt_chemin_cache('capacites-reussies'), $base); } catch (MtErreur $e) { }
        return $base;
    }

    $bonne = mt_coup_doeil('capacites-reussies');
    if (is_array($bonne) && !empty($bonne['groupBy'])) {
        $bonne['detectionUtile'] = false;
        $bonne['conserve'] = true;
        $bonne['revalidationA'] = $base['sondeeA'];
        $bonne['revalidationEchouee'] = true;
        $bonne['note'] = 'Capacites issues de la derniere detection reussie (' . (string)$bonne['sondeeA'] . ') : '
            . 'la revalidation vient d\'echouer. Nouvelle tentative dans ' . (int)$MT_TTL['capacitesRepli'] . ' s.';
        return $bonne;
    }
    $base['note'] = $budgetEpuise
        ? 'Detection interrompue par le budget de ' . MT_BUDGET_CAPACITES . ' ms : nouvelle tentative dans ' . (int)$MT_TTL['capacitesRepli'] . ' s.'
        : 'Aucune granularite confirmee par la source : nouvelle tentative dans ' . (int)$MT_TTL['capacitesRepli'] . ' s.';
    return $base;
}

function mt_capacites(): array
{
    global $MT_TTL;
    // TTL long UNIQUEMENT sur une detection reussie ; sinon on reessaie vite.
    return mt_cache_obtenir('capacites', $MT_TTL['capacites'], 'mt_detecter_capacites', function ($v) use ($MT_TTL) {
        return (is_array($v) && !empty($v['detectionUtile'])) ? (int)$MT_TTL['capacites'] : (int)$MT_TTL['capacitesRepli'];
    });
}

/* ------------------------------------------------------------------ */
/* 9. Prix vifs — cache 30 s partage par tous les visiteurs            */
/* ------------------------------------------------------------------ */

function mt_charger_prix(): array
{
    global $MT_METAUX;
    $lignes = array();
    $or = null;
    $auMoinsUn = false;
    $derniereRaison = 'api';

    foreach ($MT_METAUX as $meta) {
        try {
            $d = mt_appel('/price/' . $meta['symbole'] . '/' . MT_DEVISE_PRIX);
        } catch (MtErreur $e) {
            $derniereRaison = $e->raison;
            // Valeur absente : on le DIT, on n'invente pas (surtout pas 0).
            $lignes[] = array('symbole' => $meta['symbole'], 'nom' => $meta['nom'], 'indisponible' => true, 'raison' => $e->raison);
            continue;
        }
        $prix = (is_array($d) && isset($d['price'])) ? mt_num($d['price']) : null;
        if ($prix === null || $prix <= 0) {
            $lignes[] = array('symbole' => $meta['symbole'], 'nom' => $meta['nom'], 'indisponible' => true, 'raison' => 'forme');
            continue;
        }
        $auMoinsUn = true;
        $majAt = isset($d['updatedAt']) && is_string($d['updatedAt']) ? $d['updatedAt'] : null;
        $ligne = array(
            'symbole' => $meta['symbole'],
            'nom'     => $meta['nom'],
            'prix'    => $prix,
            'devise'  => isset($d['currency']) && is_string($d['currency']) ? $d['currency'] : MT_DEVISE_PRIX,
            'majAt'   => $majAt,
        );
        if (isset($d['name']) && is_string($d['name'])) $ligne['nomApi'] = $d['name'];
        if (isset($d['currencySymbol']) && is_string($d['currencySymbol'])) $ligne['symboleDevise'] = $d['currencySymbol'];
        // Taux REELLEMENT renvoye par la source (EUR par USD). Il ne sert a
        // aucune conversion : uniquement a verifier a posteriori dans quelle
        // devise /history et /ohlc ont repondu (mt_devise_confrontee).
        if (isset($d['exchangeRate'])) { $tx = mt_num($d['exchangeRate']); if ($tx !== null && $tx > 0) $ligne['tauxSourceEurParUsd'] = $tx; }
        if (isset($d['updatedAtReadable']) && is_string($d['updatedAtReadable'])) $ligne['majReadable'] = $d['updatedAtReadable'];
        if ($majAt !== null) {
            $ts = strtotime($majAt);
            if ($ts !== false && (time() - $ts) >= 0) $ligne['majIlYaSec'] = time() - $ts;
        }
        $lignes[] = $ligne;
        if ($meta['symbole'] === 'XAU') $or = $prix;
    }

    if (!$auMoinsUn) throw new MtErreur($derniereRaison, 0, 'aucun prix obtenu');

    $sortie = array('devise' => MT_DEVISE_PRIX, 'metaux' => array_values($lignes));

    // Or 24 carats : simple division par l'once troy, rien d'ajoute.
    if ($or !== null && mt_est_prix($or)) {
        $sortie['or24k'] = array(
            'prixGramme' => $or / MT_ONCE_TROY_G,
            'devise'     => MT_DEVISE_PRIX,
            'base'       => array('symbole' => 'XAU', 'prixOnce' => $or, 'onceTroyG' => MT_ONCE_TROY_G),
            'mention'    => 'Valeur indicative du métal pur. Ne constitue pas une offre de rachat.',
        );
    }

    $caps = mt_coup_doeil('capacites');
    if (is_array($caps) && !empty($caps['cle']) && isset($caps['deviseHistorique']) && $caps['deviseHistorique'] === MT_DEVISE_PRIX) {
        $sortie['variationPossible'] = true;
    }
    return $sortie;
}

function mt_prix(): array
{
    global $MT_TTL;
    return mt_cache_obtenir('prix', $MT_TTL['prix'], 'mt_charger_prix');
}

/* ------------------------------------------------------------------ */
/* 9bis. Confrontation de devise (aucun appel supplementaire)          */
/* ------------------------------------------------------------------ */
/*  /history et /ohlc ne documentent aucun parametre de devise. Le proxy
 *  peut donc croire l'historique en EUR (parametre `currency` accepte sur
 *  /history) alors que /ohlc l'aura ignore : la bande de statistiques
 *  serait etiquetee « EUR » sur des dollars — un nombre portant une unite
 *  que la source n'a pas confirmee.
 *  On confronte donc la valeur la plus recente du bloc recu aux prix vifs
 *  REELS deja en cache. Aucun appel de plus, AUCUNE conversion : seule
 *  l'ETIQUETTE peut etre retiree, jamais une valeur modifiee.            */

define('MT_TOLERANCE_DEVISE', 0.12);
define('MT_SEPARATION_DEVISE', 0.04);

function mt_devise_confrontee(string $symbole, $reference, ?string $deviseAnnoncee): array
{
    $sortie = array('devise' => $deviseAnnoncee, 'confiance' => null);
    $ref = mt_num($reference);
    if ($ref === null || $ref <= 0) return $sortie;

    $prix = mt_coup_doeil('prix');
    if (!is_array($prix) || empty($prix['metaux']) || !is_array($prix['metaux'])) return $sortie;
    $ligne = null;
    foreach ($prix['metaux'] as $m) {
        if (is_array($m) && isset($m['symbole']) && $m['symbole'] === $symbole && mt_est_prix(isset($m['prix']) ? $m['prix'] : null)) { $ligne = $m; break; }
    }
    if ($ligne === null) return $sortie;

    $pEur = mt_num($ligne['prix']);
    $taux = isset($ligne['tauxSourceEurParUsd']) ? mt_num($ligne['tauxSourceEurParUsd']) : null;
    if ($pEur === null || $pEur <= 0 || $taux === null || $taux <= 0) return $sortie;
    $pUsd = $pEur / $taux;

    $eEur = abs($ref / $pEur - 1);
    $eUsd = abs($ref / $pUsd - 1);
    if (min($eEur, $eUsd) > MT_TOLERANCE_DEVISE) return $sortie;      // trop loin des deux
    if (abs($eEur - $eUsd) < MT_SEPARATION_DEVISE) return $sortie;    // indiscernables

    $mesuree = $eEur <= $eUsd ? 'EUR' : 'USD';
    if ($deviseAnnoncee !== null && $deviseAnnoncee !== '' && $mesuree !== $deviseAnnoncee) {
        return array('devise' => null, 'confiance' => 'contredite', 'deviseAnnoncee' => $deviseAnnoncee, 'deviseMesuree' => $mesuree);
    }
    return array('devise' => ($deviseAnnoncee !== null && $deviseAnnoncee !== '') ? $deviseAnnoncee : $mesuree, 'confiance' => 'haute');
}

/* ------------------------------------------------------------------ */
/* 10. Serie de chandeliers                                            */
/* ------------------------------------------------------------------ */

/** Les trois appels /history d'une variante, puis l'assemblage (§ 2.2). */
function mt_tenter_variante(string $symbole, array $variante, $caps, int $debut, int $fin, int $timeout = MT_TIMEOUT): array
{
    $commun = array(
        'symbol' => $symbole, 'startTimestamp' => $debut, 'endTimestamp' => $fin,
        'groupBy' => $variante['granularite'], 'orderBy' => 'asc',
    );
    if (is_array($caps) && !empty($caps['deviseParametrable'])) $commun['currency'] = 'EUR';

    $nAvg = mt_normaliser_historique(mt_appel('/history', array_merge($commun, array('aggregation' => 'avg')), true, $timeout));
    $nMax = mt_normaliser_historique(mt_appel('/history', array_merge($commun, array('aggregation' => 'max')), true, $timeout));
    $nMin = mt_normaliser_historique(mt_appel('/history', array_merge($commun, array('aggregation' => 'min')), true, $timeout));

    $a = mt_assembler($nAvg['points'], $nMax['points'], $nMin['points'], $variante['bougie']);
    if (count($a['bougies']) === 0) throw new MtErreur('forme', 0, 'aucune bougie constructible a cette granularite');

    return array('avg' => $nAvg, 'max' => $nMax, 'min' => $nMin, 'bougies' => $a['bougies'], 'rejets' => $a['rejets']);
}

function mt_charger_serie(string $symbole, string $id): array
{
    global $MT_TF;
    $tf = $MT_TF[$id];
    $fin = time();
    $debut = $fin - (int)$tf['plage'];

    $caps = null;
    try { $r = mt_capacites(); $caps = $r['valeur']; } catch (MtErreur $e) { $caps = null; }
    $gb = (is_array($caps) && !empty($caps['cle'])) ? $caps['groupBy'] : null;

    // Variantes encore plausibles, de la plus fine a la plus grossiere.
    $variantes = array();
    foreach ($tf['variantes'] as $v) {
        if ($gb === null || (isset($gb[$v['granularite']]) && $gb[$v['granularite']] === true)) $variantes[] = $v;
    }
    if (count($variantes) === 0) throw new MtErreur('refus', 0, 'timeframe non constructible');

    // Repli a l'execution : la variante la plus fine est aussi la plus
    // lourde (1S = 7 jours de points a la minute, x3 appels). Si l'amont
    // la refuse ou n'a pas le temps de repondre, on retombe sur une
    // variante plus grossiere — toujours 100 % de vraies donnees, jamais
    // une bougie fabriquee. La granularite utilisee est annoncee.
    //
    // BUDGET STRICT : toutes les tentatives tiennent dans MT_TIMEOUT.
    // Un repli n'a lieu que si l'echec a ete RAPIDE (un 403 « hors
    // forfait » revient en quelques millisecondes) ; si la premiere
    // tentative a consomme le budget, on repond « indisponible » plutot
    // que de faire attendre le visiteur deux fois 5 s.
    $debutRequete = microtime(true);
    $derniere = null;
    $n = count($variantes);
    for ($i = 0; $i < $n; $i++) {
        $variante = $variantes[$i];
        $reste = (int)round(MT_TIMEOUT - (microtime(true) - $debutRequete) * 1000);
        if ($i > 0 && $reste < 1200) throw $derniere;
        try {
            $r = mt_tenter_variante($symbole, $variante, $caps, $debut, $fin, $i === 0 ? MT_TIMEOUT : $reste);
        } catch (MtErreur $e) {
            $derniere = $e;
            // Une cle refusee ne se rattrape pas en changeant de granularite.
            if ($e->raison === 'cle' || $i === $n - 1) throw $e;
            continue;
        }

        $liste = $r['bougies'];
        $tronque = false;
        if (count($liste) > MT_MAX_BOUGIES) { $liste = array_slice($liste, -MT_MAX_BOUGIES); $tronque = true; }

        // La devise annoncee par la detection est confrontee a la derniere
        // cloture reelle : si elle est contredite, on n'etiquette rien.
        $deviseCaps = is_array($caps) && isset($caps['deviseHistorique']) ? $caps['deviseHistorique'] : null;
        $confiCaps = is_array($caps) && isset($caps['deviseConfiance']) ? $caps['deviseConfiance'] : 'indeterminee';
        $derniereCloture = count($liste) ? $liste[count($liste) - 1]['close'] : null;
        $conf = mt_devise_confrontee($symbole, $derniereCloture, $deviseCaps);

        $sortie = array(
            'symbole' => $symbole,
            'tf' => $id,
            'libelle' => $tf['libelle'],
            'devise' => $conf['devise'],
            'deviseConfiance' => ($conf['confiance'] === 'contredite' || $conf['confiance'] === 'haute') ? $conf['confiance'] : $confiCaps,
            'source' => 'history',
            'granularite' => $variante['granularite'],
            'bougie' => mt_etiquette_bougie($variante['bougie']),
            'debut' => $debut, 'fin' => $fin,
            'bougies' => array_values($liste),
            'points' => count($r['avg']['points']),
            'sousPointsMin' => 2,
            'bougiesRejetees' => $r['rejets'],
            'pointsIgnores' => $r['avg']['ignores'] + $r['max']['ignores'] + $r['min']['ignores'],
            'champs' => array('temps' => $r['avg']['temps'], 'prix' => $r['avg']['prix']),
        );
        if ($i > 0) $sortie['repli'] = array('rang' => $i, 'raison' => $derniere !== null ? $derniere->raison : 'amont');
        if ($tronque) $sortie['tronque'] = true;
        return $sortie;
    }
    throw $derniere !== null ? $derniere : new MtErreur('api', 0, 'serie indisponible');
}

function mt_serie(string $symbole, string $id): array
{
    return mt_cache_obtenir('serie_' . $symbole . '_' . $id, mt_ttl_serie(mt_variante_connue($id)['bougie']),
        function () use ($symbole, $id) { return mt_charger_serie($symbole, $id); });
}

/* ------------------------------------------------------------------ */
/* 11. Resume OHLC de la plage (bande de statistiques uniquement)      */
/* ------------------------------------------------------------------ */

function mt_charger_ohlc(string $symbole, string $id): array
{
    global $MT_TF;
    $tf = $MT_TF[$id];
    $fin = time();
    $debut = $fin - (int)$tf['plage'];

    // Si /history honore `currency`, on demande la MEME chose a /ohlc :
    // sans cela la bande de statistiques et les bougies parleraient deux
    // devises differentes sous la meme etiquette. Que la source l'honore ou
    // l'ignore est ensuite VERIFIE par mt_devise_confrontee().
    $capsAvant = mt_coup_doeil('capacites');
    $params = array('startTimestamp' => $debut, 'endTimestamp' => $fin);
    if (is_array($capsAvant) && !empty($capsAvant['deviseParametrable'])) $params['currency'] = 'EUR';

    $brut = mt_appel('/ohlc/' . $symbole, $params, true);
    $o = null;
    if (is_array($brut)) {
        if (isset($brut['data']) && is_array($brut['data'])) $o = $brut['data'];
        elseif (isset($brut[0]) && is_array($brut[0])) $o = $brut[0];
        else $o = $brut;
    }
    if (!is_array($o)) throw new MtErreur('forme', 200, 'reponse /ohlc inattendue');

    $caps = mt_coup_doeil('capacites');
    $sortie = array(
        'symbole' => $symbole, 'tf' => $id, 'libelle' => $tf['libelle'],
        'devise' => is_array($caps) && isset($caps['deviseHistorique']) ? $caps['deviseHistorique'] : null,
        'debut' => $debut, 'fin' => $fin, 'source' => 'ohlc',
    );
    // Chaque champ n'est repris QUE s'il est reellement present et valide.
    foreach (array('open', 'high', 'low', 'close') as $k) {
        $v = null;
        if (isset($o[$k])) $v = mt_num($o[$k]);
        elseif (isset($o[strtoupper($k)])) $v = mt_num($o[strtoupper($k)]);
        if ($v !== null && $v > 0) $sortie[$k] = $v;      // 0 ou negatif = valeur absente
    }
    foreach (array('highLowChangePercent', 'openCloseChangePercent') as $k) {
        if (isset($o[$k])) { $p = mt_num($o[$k]); if ($p !== null) $sortie[$k] = $p; }   // un pourcentage peut valoir 0
    }
    $sortie['champsRecus'] = array_values(array_map('strval', array_keys($o)));
    if (!isset($sortie['open']) && !isset($sortie['close'])) throw new MtErreur('forme', 200, 'aucune valeur OHLC exploitable');

    // Etiquette de devise : confirmee, ou retiree. Jamais supposee.
    $ref = isset($sortie['close']) ? $sortie['close'] : (isset($sortie['open']) ? $sortie['open'] : null);
    $conf = mt_devise_confrontee($symbole, $ref, $sortie['devise']);
    $sortie['devise'] = $conf['devise'];
    if ($conf['confiance'] !== null) $sortie['deviseConfiance'] = $conf['confiance'];
    if ($conf['confiance'] === 'contredite') $sortie['deviseAnnoncee'] = $conf['deviseAnnoncee'];
    return $sortie;
}

function mt_ohlc(string $symbole, string $id): array
{
    return mt_cache_obtenir('ohlc_' . $symbole . '_' . $id, mt_ttl_serie(mt_variante_connue($id)['bougie']),
        function () use ($symbole, $id) { return mt_charger_ohlc($symbole, $id); });
}

/* ------------------------------------------------------------------ */
/* 12. Couche HTTP                                                     */
/* ------------------------------------------------------------------ */

function mt_json(int $statut, array $objet): void
{
    $corps = json_encode($objet, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    if ($corps === false) { $corps = '{"indisponible":true,"raison":"forme"}'; $statut = 200; }
    $corps = mt_masquer($corps);                 // la cle ne peut pas sortir, meme par accident
    if (!headers_sent()) {
        http_response_code($statut);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        if (MT_SIMULATION) header('X-Metaux-Simulation: oui');
        $origine = isset($_SERVER['HTTP_ORIGIN']) ? (string)$_SERVER['HTTP_ORIGIN'] : '';
        if ($origine !== '' && preg_match('#^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$#i', $origine)) {
            header('Access-Control-Allow-Origin: ' . $origine);
            header('Vary: Origin');
        }
        header('Content-Length: ' . strlen($corps));
    }
    echo $corps;
}

function mt_enveloppe(array $r, array $extra = array()): array
{
    $o = is_array($r['valeur']) ? $r['valeur'] : array();
    $o = array_merge($o, array('cache' => array('age' => (int)$r['age'], 'ttl' => (int)$r['ttl'])), $extra);
    if (!empty($r['degrade'])) {
        $o['degrade'] = true;
        $o['raisonDegradation'] = isset($r['raison']) ? $r['raison'] : 'api';
        $o['age'] = (int)$r['age'];              // age de la derniere valeur VRAIE
    }
    if (MT_SIMULATION) $o['simulation'] = true;
    return $o;
}

function mt_indisponible(string $raison, array $extra = array()): void
{
    global $MT_MESSAGES;
    // 200 volontaire : c'est un etat prevu de l'interface, pas une panne du
    // site. Le navigateur ne doit pas cracher d'erreur reseau en console.
    $o = array_merge(array(
        'indisponible' => true, 'raison' => $raison,
        'message' => isset($MT_MESSAGES[$raison]) ? $MT_MESSAGES[$raison] : $MT_MESSAGES['api'],
    ), $extra);
    if (MT_SIMULATION) $o['simulation'] = true;
    mt_json(200, $o);
}

/* --- routage : /api/metaux/<route>, PATH_INFO, ou ?route=<route> ---- */
function mt_route(): string
{
    if (isset($_GET['route']) && is_string($_GET['route'])) return strtolower(trim($_GET['route'], '/ '));
    if (!empty($_SERVER['PATH_INFO'])) return strtolower(trim((string)$_SERVER['PATH_INFO'], '/ '));
    $uri = isset($_SERVER['REQUEST_URI']) ? (string)parse_url((string)$_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
    if ($uri !== '' && preg_match('#/api/metaux/([A-Za-z]+)#', $uri, $m)) return strtolower($m[1]);
    return '';
}

/* ------------------------------------------------------------------ */
/* 13. Auto-test HORS LIGNE des fonctions pures (aucun appel reseau)   */
/* ------------------------------------------------------------------ */
function mt_autotest(): array
{
    $t = array();
    $ajouter = function ($nom, $ok, $detail) use (&$t) { $t[] = array('nom' => $nom, 'ok' => (bool)$ok, 'detail' => (string)$detail); };

    // epoch
    $ajouter('versEpoch ISO', mt_vers_epoch('2026-08-23T21:00:00Z') === 1787518800, (string)mt_vers_epoch('2026-08-23T21:00:00Z'));
    $ajouter('versEpoch jour', mt_vers_epoch('2026-08-23') === (int)gmmktime(0, 0, 0, 8, 23, 2026), (string)mt_vers_epoch('2026-08-23'));
    $ajouter('versEpoch annee', mt_vers_epoch(2026) === (int)gmmktime(0, 0, 0, 1, 1, 2026), (string)mt_vers_epoch(2026));
    $ajouter('versEpoch illisible = null', mt_vers_epoch('pas une date') === null, 'null attendu');

    // prix
    $ajouter('estPrix refuse 0', mt_est_prix(0) === false && mt_est_prix(0.0) === false, 'aucun 0 accepte comme prix');
    $ajouter('estPrix refuse negatif/texte', mt_est_prix(-3) === false && mt_est_prix('12') === false, 'strict');

    // detection de champs, deux formes documentees
    $std = array(array('day' => '2026-08-20T00:00:00Z', 'avg_price' => 4600.5), array('day' => '2026-08-21T00:00:00Z', 'avg_price' => 4610.5));
    $var = array(array('timestamp' => 1787443200, 'price' => 4600.5), array('timestamp' => 1787529600, 'price' => 4610.5));
    $c1 = mt_detecter_champs($std); $c2 = mt_detecter_champs($var);
    $ajouter('champs forme documentee', $c1 === array('temps' => 'day', 'prix' => 'avg_price'), json_encode($c1));
    $ajouter('champs forme alternative', $c2 === array('temps' => 'timestamp', 'prix' => 'price'), json_encode($c2));

    // seaux
    $bJour = array('type' => 'jour');
    $ajouter('seau jour aligne minuit UTC', mt_debut_seau(1787518800, $bJour) === (int)gmmktime(0, 0, 0, 8, 23, 2026), (string)mt_debut_seau(1787518800, $bJour));
    $ajouter('seau 5 min aligne', mt_debut_seau(1787518799, array('type' => 'sec', 'n' => 300)) % 300 === 0, 'multiple de 300');
    $ajouter('seau semaine = lundi UTC', (int)gmdate('N', mt_debut_seau(1787518800, array('type' => 'semaine'))) === 1, gmdate('D', mt_debut_seau(1787518800, array('type' => 'semaine'))));

    // assemblage : 2 seaux de 5 min, l'un a 3 points, l'autre a 1 seul
    $b = array('type' => 'sec', 'n' => 300);
    $t0 = 1787518800;
    $avg = array(array('t' => $t0, 'v' => 100.0), array('t' => $t0 + 60, 'v' => 102.0), array('t' => $t0 + 120, 'v' => 101.0), array('t' => $t0 + 300, 'v' => 105.0));
    $max = array(array('t' => $t0, 'v' => 100.5), array('t' => $t0 + 60, 'v' => 103.0), array('t' => $t0 + 120, 'v' => 101.5), array('t' => $t0 + 300, 'v' => 105.5));
    $min = array(array('t' => $t0, 'v' => 99.5), array('t' => $t0 + 60, 'v' => 101.0), array('t' => $t0 + 120, 'v' => 100.5), array('t' => $t0 + 300, 'v' => 104.5));
    $r = mt_assembler($avg, $max, $min, $b);
    $ok1 = count($r['bougies']) === 1;
    $bg = $ok1 ? $r['bougies'][0] : array();
    $ajouter('assemblage : 1 seule bougie retenue', $ok1, count($r['bougies']) . ' bougie(s), rejets ' . json_encode($r['rejets']));
    $ajouter('assemblage : seau a 1 sous-point rejete', ($r['rejets']['sousPoints'] === 1), 'sousPoints = ' . $r['rejets']['sousPoints']);
    $ajouter('assemblage : open = 1er avg, close = dernier avg', $ok1 && $bg['open'] === 100.0 && $bg['close'] === 101.0, $ok1 ? ('O ' . $bg['open'] . ' C ' . $bg['close']) : '—');
    $ajouter('assemblage : high = max des max, low = min des min', $ok1 && $bg['high'] === 103.0 && $bg['low'] === 99.5, $ok1 ? ('H ' . $bg['high'] . ' L ' . $bg['low']) : '—');
    $ajouter('assemblage : n = nombre de sous-points reels', $ok1 && $bg['n'] === 3, $ok1 ? ('n = ' . $bg['n']) : '—');

    // incoherence amont : la bougie est rejetee, jamais corrigee
    $maxKo = array(array('t' => $t0, 'v' => 100.5), array('t' => $t0 + 60, 'v' => 100.6), array('t' => $t0 + 120, 'v' => 100.7));
    $rKo = mt_assembler(array_slice($avg, 0, 3), $maxKo, array_slice($min, 0, 3), $b);
    $ajouter('assemblage : incoherence high < close -> rejet', count($rKo['bougies']) === 0 && $rKo['rejets']['incoherentes'] === 1, json_encode($rKo['rejets']));

    // timeframes
    global $MT_TF, $MT_TF_ORDRE;
    $tailleG = array('minute' => 60, 'hour' => 3600, 'day' => 86400, 'week' => 604800, 'month' => 2592000, 'year' => 31536000);
    $tailleB = array('jour' => 86400, 'semaine' => 604800, 'mois' => 2592000);
    $invariant = true; $detail = array();
    foreach ($MT_TF_ORDRE as $id) {
        foreach ($MT_TF[$id]['variantes'] as $v) {
            $tb = $v['bougie']['type'] === 'sec' ? (int)$v['bougie']['n'] : $tailleB[$v['bougie']['type']];
            if ($tb < 2 * $tailleG[$v['granularite']]) { $invariant = false; $detail[] = $id; }
        }
    }
    $ajouter('invariant : bougie >= 2 x granularite amont', $invariant, $invariant ? 'les 9 timeframes respectent §2.2' : implode(',', $detail));
    $gbLimite = array('minute' => false, 'hour' => false, 'day' => true, 'week' => true, 'month' => true, 'year' => true);
    $restants = array();
    foreach ($MT_TF_ORDRE as $id) if (mt_resoudre_tf($id, $gbLimite) !== null) $restants[] = $id;
    $ajouter('forfait limite : timeframes restants', $restants === array('3M', '1A', 'MAX'), implode(' ', $restants));

    // cle
    $ajouter('cle : masquage actif', mt_lire_cle() === '' || strpos(mt_masquer('x' . mt_lire_cle() . 'y'), mt_lire_cle()) === false, mt_lire_cle() === '' ? 'aucune cle configuree' : 'cle remplacee par ***');

    // redirections : la cle ne doit JAMAIS suivre un saut hors du domaine
    $dep = 'https://api.gold-api.com/history?symbol=XAU';
    $ajouter('redirection : autre hote refuse',
        mt_cible_autorisee('https://evil.example/collect', $dep) === null, 'null attendu');
    $ajouter('redirection : autre port refuse',
        mt_cible_autorisee('https://api.gold-api.com:8443/history', $dep) === null, 'null attendu');
    $ajouter('redirection : retrogradation https -> http refusee',
        mt_cible_autorisee('http://api.gold-api.com/history', $dep) === null, 'null attendu');
    $ajouter('redirection : chemin relatif sur le meme hote accepte',
        mt_cible_autorisee('/v2/history', $dep) === 'https://api.gold-api.com/v2/history', (string)mt_cible_autorisee('/v2/history', $dep));
    $ajouter('redirection : Location vide refusee',
        mt_cible_autorisee('', $dep) === null && mt_cible_autorisee(null, $dep) === null, 'null attendu');

    // recul apres echec : long sur un refus de quota ou de forfait
    $ajouter('recul : 429 et 403 reculent plus longtemps qu\'une panne',
        mt_recul_pour('quota') > mt_recul_pour('api') && mt_recul_pour('refus') > mt_recul_pour('api'),
        'api ' . mt_recul_pour('api') . ' s · quota ' . mt_recul_pour('quota') . ' s · refus ' . mt_recul_pour('refus') . ' s');
    $ajouter('recul : une panne re-arme le cache 15-30 s',
        mt_recul_pour('api') >= 15 && mt_recul_pour('api') <= 30, mt_recul_pour('api') . ' s');

    // capacites : jamais figees six heures sur une detection vide
    global $MT_TTL;
    $ajouter('capacites : TTL de repli court quand rien n\'est detecte',
        $MT_TTL['capacitesRepli'] >= 60 && $MT_TTL['capacitesRepli'] <= 120 && $MT_TTL['capacitesRepli'] < $MT_TTL['capacites'],
        'repli ' . $MT_TTL['capacitesRepli'] . ' s contre ' . $MT_TTL['capacites'] . ' s si la detection aboutit');
    $ajouter('capacites : budget global borne',
        MT_BUDGET_CAPACITES <= 8000 && MT_TIMEOUT_SONDE <= MT_TIMEOUT,
        'budget ' . MT_BUDGET_CAPACITES . ' ms, sonde ' . MT_TIMEOUT_SONDE . ' ms');

    // devise : une reference inexploitable ne modifie JAMAIS l'etiquette
    $ajouter('devise : reference absente -> etiquette inchangee',
        mt_devise_confrontee('XAU', 0, 'USD')['devise'] === 'USD' && mt_devise_confrontee('XAU', null, null)['devise'] === null,
        'aucune deduction sur une valeur absente');

    $echecs = 0;
    foreach ($t as $x) if (!$x['ok']) $echecs++;
    return array('autotest' => true, 'reseau' => false, 'total' => count($t), 'echecs' => $echecs, 'resultats' => $t);
}

/* ------------------------------------------------------------------ */
/* 14. Point d'entree                                                  */
/* ------------------------------------------------------------------ */

$MT_METHODE = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
if ($MT_METHODE === 'OPTIONS') {
    if (!headers_sent()) {
        http_response_code(204);
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: content-type');
    }
    exit;
}
if ($MT_METHODE !== 'GET' && $MT_METHODE !== 'HEAD') { mt_json(405, array('erreur' => 'methode')); exit; }

$route = mt_route();

try {
    if ($route === 'prix') {
        try { mt_json(200, mt_enveloppe(mt_prix())); }
        catch (MtErreur $e) { mt_indisponible($e->raison); }

    } elseif ($route === 'capacites') {
        try { mt_json(200, mt_enveloppe(mt_capacites())); }
        catch (MtErreur $e) {
            $gb = array();
            foreach ($MT_GRANULARITES as $g) $gb[$g] = false;
            mt_json(200, array('cle' => mt_lire_cle() !== '', 'groupBy' => $gb, 'devise' => null, 'tf' => array(),
                'indisponible' => true, 'raison' => $e->raison, 'message' => $MT_MESSAGES[$e->raison] ?? $MT_MESSAGES['api']));
        }

    } elseif ($route === 'serie' || $route === 'ohlc') {
        $symboles = array();
        foreach ($MT_METAUX as $m) $symboles[] = $m['symbole'];
        $symbole = strtoupper((string)($_GET['symbole'] ?? $_GET['symbol'] ?? ''));
        $id = (string)($_GET['tf'] ?? '');

        if (!in_array($symbole, $symboles, true)) {
            mt_json(400, array('erreur' => 'parametre', 'champ' => 'symbole', 'message' => $MT_MESSAGES['parametre'], 'attendu' => $symboles));
        } elseif (!isset($MT_TF[$id])) {
            mt_json(400, array('erreur' => 'parametre', 'champ' => 'tf', 'message' => $MT_MESSAGES['parametre'], 'attendu' => $MT_TF_ORDRE));
        } else {
            $caps = null;
            try { $rc = mt_capacites(); $caps = $rc['valeur']; } catch (MtErreur $e) { $caps = null; }

            if (is_array($caps) && empty($caps['cle'])) {
                mt_indisponible('cle', array('symbole' => $symbole, 'tf' => $id));
            } elseif (is_array($caps) && !empty($caps['cle']) && mt_resoudre_tf($id, $caps['groupBy']) === null) {
                $req = array();
                foreach ($MT_TF[$id]['variantes'] as $v) $req[] = $v['granularite'];
                mt_indisponible('timeframe', array('symbole' => $symbole, 'tf' => $id,
                    'granularitesRequises' => $req, 'tfDisponibles' => $caps['tf']));
            } else {
                try {
                    mt_json(200, mt_enveloppe($route === 'serie' ? mt_serie($symbole, $id) : mt_ohlc($symbole, $id)));
                } catch (MtErreur $e) {
                    mt_indisponible($e->raison, array('symbole' => $symbole, 'tf' => $id));
                }
            }
        }

    } elseif ($route === 'sante') {
        mt_json(200, array('ok' => true, 'php' => PHP_VERSION, 'curl' => function_exists('curl_init'),
            'simulation' => MT_SIMULATION, 'cle' => mt_lire_cle() !== '', 'ttl' => $MT_TTL, 'timeout' => MT_TIMEOUT,
            'timeoutSonde' => MT_TIMEOUT_SONDE, 'budgetCapacites' => MT_BUDGET_CAPACITES, 'recul' => $MT_RECUL,
            'redirections' => 'manuelles (hote ' . MT_HOTE_AMONT . ' uniquement)',
            'tf' => $MT_TF_ORDRE, 'cacheDansPublic' => strpos(mt_dossier_cache(), __DIR__) === 0));

    } elseif ($route === 'autotest') {
        mt_json(200, mt_autotest());

    } else {
        mt_json(404, array('erreur' => 'route inconnue', 'routes' => array('prix', 'serie', 'ohlc', 'capacites', 'sante', 'autotest')));
    }
} catch (MtErreur $e) {
    mt_indisponible($e->raison);
} catch (Throwable $e) {
    // Aucun detail interne ne sort : ni chemin, ni trace, ni corps amont.
    mt_indisponible('api');
}
