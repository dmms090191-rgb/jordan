/* =============================================================================
   SERVEUR D'APERÇU LOCAL — le site complet, API comprise
   =============================================================================

   Il sert les fichiers du site ET les routes /api/metaux/*, en appelant le
   MÊME module que la fonction serverless de production (lib/metaux.mjs). Ce
   n'est donc pas une imitation locale : c'est le même code, au même contrat,
   avec les mêmes données réelles — seul l'habillage HTTP change.

       node serveur-dev.mjs             (depuis le dossier compagnie-de-lor)
       node serveur-dev.mjs 3000        (autre port)

   Ce fichier est volontairement HORS du dossier api/ : tout module qui s'y
   trouve deviendrait une fonction Vercel, et celui-ci n'en est pas une.

   LA CLÉ : GOLD_API_KEY, via la variable d'environnement ou un .env local
   (voir lib/metaux.mjs). Elle ne sort jamais du serveur.
   ============================================================================= */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traiter, enTetes, lireCle } from './lib/metaux.mjs';

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.argv[2] || 8787;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/* Les vidéos du hero sont lues par intervalles : sans le support des plages
   (206), le navigateur retélécharge le fichier entier à chaque avance. */
function servirFichier(req, res, fichier) {
  let st;
  try { st = fs.statSync(fichier); }
  catch (e) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('introuvable : ' + req.url); }
  if (st.isDirectory()) return servirFichier(req, res, path.join(fichier, 'index.html'));

  const type = TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream';
  const tete = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  const plage = req.headers.range;
  if (plage) {
    const m = /bytes=(\d*)-(\d*)/.exec(plage);
    if (m) {
      const d = m[1] ? +m[1] : 0;
      const f = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (d <= f) {
        res.writeHead(206, { ...tete, 'content-range': `bytes ${d}-${f}/${st.size}`, 'content-length': f - d + 1 });
        return fs.createReadStream(fichier, { start: d, end: f }).pipe(res);
      }
    }
  }
  res.writeHead(200, { ...tete, 'content-length': st.size });
  fs.createReadStream(fichier).pipe(res);
}

const serveur = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); }
  catch (e) { res.writeHead(400); return res.end(); }
  const chemin = decodeURIComponent(u.pathname);

  /* --- l'API : mêmes URL qu'en production --- */
  const m = /^\/api\/metaux(?:\/([A-Za-z]+))?\/?$/.exec(chemin);
  if (m) {
    const { code, corps, ttl } = await traiter(m[1] || '', {
      symbole: u.searchParams.get('symbole'),
      symbol: u.searchParams.get('symbol'),
      tf: u.searchParams.get('tf'),
    });
    /* en local on ne veut pas de cache intermédiaire : on relit la source */
    res.writeHead(code, { ...enTetes(ttl), 'cache-control': 'no-store' });
    return res.end(JSON.stringify(corps));
  }

  /* --- les fichiers --- */
  const rel = chemin === '/' ? '/index.html' : chemin;
  /* resolve() puis vérification du préfixe : sans cela, un chemin contenant
     « .. » sortirait du dossier du site. */
  const cible = path.resolve(RACINE, '.' + rel);
  if (!cible.startsWith(RACINE)) { res.writeHead(403); return res.end('interdit'); }
  servirFichier(req, res, cible);
});

serveur.listen(PORT, () => {
  const cle = lireCle();
  console.log('');
  console.log("  La Compagnie de l'Or — aperçu local");
  console.log('  -----------------------------------');
  console.log('  site   http://localhost:' + PORT + '/');
  console.log('  api    http://localhost:' + PORT + '/api/metaux/sante');
  console.log('  clé    GOLD_API_KEY ' + (cle ? 'trouvée (' + cle.length + ' caractères)' : 'ABSENTE — les cours resteront indisponibles'));
  console.log('  amont  api.gold-api.com — données réelles, aucune simulation');
  console.log('');
});
