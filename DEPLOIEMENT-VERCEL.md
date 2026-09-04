# Déploiement sur Vercel — l'API des métaux

## Ce qui a changé, et pourquoi

Le backend des cours était `api/metaux.php`. **Vercel n'exécute pas PHP** :
déployé tel quel, `/api/metaux/prix` n'aurait rien renvoyé, et le module des
cours aurait affiché « La source de données a renvoyé une erreur » sur les
quatre métaux.

Le backend est désormais une **fonction serverless Node**, aux mêmes URL. Le
frontend n'a pas changé d'une ligne : il appelait déjà `/api/metaux/*`.

```
lib/metaux.mjs             toute la logique — une seule source de vérité
api/metaux/[route].mjs     la fonction Vercel  → production
serveur-dev.mjs            l'aperçu local      → développement
vercel.json                budget de la fonction, en-têtes
.vercelignore              ce qui ne part pas en production
```

Les deux entrées appellent le **même** module : il n'existe pas de version
locale qui pourrait diverger de la version déployée.

## Les trois réglages à faire dans Vercel

**1 · Root Directory** — `compagnie-de-lor`

Le dépôt contient le site dans un sous-dossier. Sans ce réglage, Vercel ne
trouverait ni `api/`, ni `index.html`.

**2 · Variable d'environnement** — `GOLD_API_KEY`

Project Settings → Environment Variables → `GOLD_API_KEY`, pour les trois
environnements (Production, Preview, Development). La valeur est celle du
fichier `.env` à la racine du dépôt.

La clé **ne doit jamais** être préfixée `NEXT_PUBLIC_` ni recopiée dans le
frontend : elle ne part que du serveur vers `api.gold-api.com`, dans
l'en-tête `x-api-key`, et n'apparaît dans aucune réponse ni aucun journal.

**3 · Framework Preset** — `Other`

Le site est statique ; il n'y a rien à construire. Vercel sert les fichiers
et transforme `api/metaux/[route].mjs` en fonction.

## Les routes

| URL | rôle |
|---|---|
| `/api/metaux/prix` | prix comptants des quatre métaux, en euros |
| `/api/metaux/capacites` | granularités disponibles, devise réelle de l'historique |
| `/api/metaux/serie?symbole=XAU&tf=1M` | les bougies du graphique |
| `/api/metaux/ohlc?symbole=XAU&tf=1M` | ouverture / haut / bas / clôture de la période |
| `/api/metaux/sante` | état du service, sans aucun secret |

Symboles : `XAU` (or), `XAG` (argent), `XPT` (platine), `XPD` (palladium).
Périodes : `5min 15min 1h 1J 1S 1M 3M 1A MAX`.

## Le cache

Les réponses portent un `s-maxage` : c'est le réseau de diffusion de Vercel
qui absorbe le trafic, pas la fonction, et la source amont n'est appelée
qu'une fois par durée de vie.

| route | s-maxage |
|---|---|
| prix | 30 s |
| série / ohlc | 60 à 900 s selon la période |
| capacités | 6 h |

`stale-while-revalidate` sert ensuite la valeur connue pendant qu'une
nouvelle est cherchée en arrière-plan : après la toute première visite,
personne n'attend jamais.

## En local

```bash
node serveur-dev.mjs        # http://localhost:8787
```

Il sert le site ET l'API, avec les mêmes données réelles. La clé est lue dans
`GOLD_API_KEY` ou, à défaut, dans un `.env` (racine du dépôt ou du site).

## Ce qui reste sur le disque mais ne part plus

`api/metaux.php` et `api/.htaccess` sont conservés comme référence
historique, et exclus du déploiement par `.vercelignore` — sur un
hébergement sans PHP, `metaux.php` serait servi en TEXTE, c'est-à-dire son
code source publié.

## Aucune donnée inventée

Quand la source ne répond pas, le module le DIT — jamais un zéro, jamais une
valeur reconstruite. Une bougie dont le haut ou le bas manque est rejetée,
pas comblée. Et la devise de l'historique n'est pas supposée : elle est
confrontée aux prix comptants, parce que cette source ignore le paramètre
`currency` et répond en dollars. C'est pourquoi le graphique porte
l'étiquette « cours mondial en USD (estimation) » alors que les prix
comptants sont en euros.
