/* =============================================================================
   FONCTION SERVERLESS VERCEL — /api/metaux/<route>
   =============================================================================

   Le segment dynamique [route] couvre d'un seul fichier les quatre routes que
   le frontend appelle :

       /api/metaux/prix        les prix comptants des quatre métaux
       /api/metaux/capacites   granularités disponibles, devise réelle
       /api/metaux/serie       les bougies du graphique   (?symbole=&tf=)
       /api/metaux/ohlc        les statistiques de période (?symbole=&tf=)
       /api/metaux/sante       état du service

   Ce sont EXACTEMENT les URL que le frontend utilisait avec l'ancien backend
   PHP (assets/js/accueil-sections.js : base '/api/metaux'). Aucune ligne du
   frontend n'a eu à changer, et il ne dépend plus de PHP.

   TOUTE LA LOGIQUE EST DANS ../../lib/metaux.mjs — le serveur d'aperçu local
   (serveur-dev.mjs) appelle le même module. Il n'existe donc pas de version
   « locale » qui pourrait diverger de la version déployée.

   LA CLÉ ne quitte jamais le serveur : elle vient de la variable
   d'environnement GOLD_API_KEY, à déclarer dans Vercel (Project Settings →
   Environment Variables). Elle n'est ni exposée au navigateur, ni écrite
   dans une réponse, ni journalisée.
   ============================================================================= */

import { traiter, enTetes } from '../../lib/metaux.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ erreur: 'methode' }));
  }

  const q = req.query || {};
  const route = String(q.route || '');
  const { code, corps, ttl } = await traiter(route, { symbole: q.symbole, symbol: q.symbol, tf: q.tf });

  res.writeHead(code, enTetes(ttl));
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(corps));
}
