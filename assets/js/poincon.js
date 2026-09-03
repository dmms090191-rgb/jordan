/* LA COMPAGNIE DE L'OR — A · LE POINÇON
 * Symbole en matière réelle (WebGL) + séquence de frappe.
 * Sans dépendance. Se dégrade proprement : sans WebGL, le SVG reste affiché.
 *
 *   Poincon.monter(element, { base: 'assets/logo/', frappe: true })
 *
 * Construit par source/web.mjs — ne pas éditer à la main.
 */
(function (racine) {
  'use strict';

  var FRAG = "precision highp float;\nuniform vec2  uRes;      // pixels du rendu\nuniform vec4  uZone;     // fenetre objet rendue : x0, y0, largeur, hauteur (unites 0..100)\nuniform float uPixel;    // unites objet par pixel  (pour le filtrage LOD)\nuniform float uFrappe;   // 0 = flan brut, 1 = piece finie\nuniform float uTemps;    // secondes, pour la derive lente de la lumiere\nuniform float uJour;     // 0 = nuit, 1 = jour\nuniform float uOutil;    // 0..1, ombre du poincon qui descend\nuniform float uVie;      // amplitude generale de l'animation d'ambiance\nuniform float uAffiche;  // unites objet par pixel AFFICHE (>= uPixel si surechantillonnage)\n\n/* cotes, injectees depuis geo.mjs */\nconst vec2  C     = vec2(50.0, 50.0);\nconst float HW    = 37.0;\nconst float HH    = 47.0;\nconst float FACET = 3.6;\nconst float HFAC  = 42.4270270270;      // HH * (1 - FACET/HW)\nconst float ARC_RA = 20.1;\nconst float ARC_RB = 3.9;\nconst vec2  ARC_SC = vec2(0.4226182617, -0.9063077870);   // sin/cos de 155 degres\n\n/* Distance signee EXACTE au losange du poincon.\n   La forme est symetrique en x et en y : on replie dans le quadrant, ou la\n   frontiere se reduit a deux segments — la facette et le pan coupe. */\nfloat sdLosange(vec2 p) {\n  vec2 q = abs(p - C);\n  float dA = length(q - vec2(clamp(q.x, 0.0, FACET), HFAC));   // facette\n  vec2 e = vec2(HW - FACET, -HFAC);\n  vec2 w = q - vec2(FACET, HFAC);\n  float dB = length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));  // pan\n  float cr = e.x * w.y - e.y * w.x;\n  float s = (q.y <= HFAC && cr < 0.0) ? -1.0 : 1.0;\n  return s * min(dA, dB);\n}\n\n/* Distance signee EXACTE au secteur annulaire — le C. Formulation de I. Quilez,\n   recentree sur l'ouest par une rotation propre. */\nfloat sdAnneau(vec2 p) {\n  vec2 v = p - C;\n  vec2 q = vec2(v.y, -v.x);                 // ouest -> +Y\n  q.x = abs(q.x);\n  float d = (ARC_SC.y * q.x > ARC_SC.x * q.y)\n          ? length(q - ARC_SC * ARC_RA)\n          : abs(length(q) - ARC_RA);\n  return d - ARC_RB;\n}\n\n/* profil de chanfrein\n   Un chanfrein d'orfevre n'est ni un biseau nu ni un bourrelet : c'est un\n   pan droit raccorde par deux petits conges. Ce profil est C1 — la normale\n   ne saute donc jamais, et le pan central reste parfaitement plan, ce qui\n   est exactement ce qui capte la lumiere en une ligne franche. */\n/* ── TAILLE OPTIQUE ───────────────────────────────────────────────────\n   Un detail plus fin que le pixel ne fait plus du relief : il fait du bruit.\n   Le chanfrein de gravure mesure 0,55 unite — a 64 px de symbole cela fait\n   0,35 pixel. Point-echantillonne, il ne rend ni une arete ni une ombre : il\n   rend une dentelure qui grouille. Mesure faite, le symbole portait ainsi\n   deux a quatre fois plus d energie haute frequence que la meme forme en\n   vecteur pur — et c est exactement ce qui le faisait paraitre sale a cote\n   du texte.\n\n   On elargit donc chaque detail au minimum lisible, et on eteint ce qui ne\n   peut plus etre montre. Le DESSIN ne bouge pas : memes silhouettes, memes\n   positions, meme or. Seules les epaisseurs de transition sont recalculees\n   pour la taille reellement affichee.\n   Ces deux fonctions se calent sur le pixel AFFICHE, pas sur le pixel de\n   rendu : surechantillonner ne rend pas un detail visible, cela ne fait que\n   mieux le moyenner. Indexee sur la resolution de rendu, la simplification\n   se desactivait des qu on montait le surechantillonnage — et le symbole\n   redevenait bruyant a 80 px alors qu il etait propre a 48. */\nfloat traitMini() { return 1.25 * uAffiche; }                    // >= 1,8 px affiche\nfloat finesse()  { return smoothstep(0.75, 0.10, uAffiche); }   // 1 grand, 0 petit\n\nconst float CONGE = 0.30;                      // part du chanfrein passee en conge\nfloat profil(float t) {\n  t = clamp(t, 0.0, 1.0);\n  float q = CONGE, y;\n  if (t < q)            y = t * t / (2.0 * q);\n  else if (t > 1.0 - q) y = 1.0 - (1.0 - t) * (1.0 - t) / (2.0 * q);\n  else                  y = t - q * 0.5;\n  return y / (1.0 - q * 0.5);\n}\n\n/* mise en relief\n   HAUT   extrusion du corps\n   CHANF  largeur du chanfrein peripherique\n   CREUX  profondeur de gravure de l'anneau\n   CHANG  largeur du chanfrein des flancs de gravure (plus serre : un burin\n          laisse une arete plus vive qu'une matrice) */\nconst float HAUT   = 7.0;\nconst float CHANF  = 1.55;\nconst float CREUX  = 2.60;\nconst float CHANG  = 0.55;\nconst float BOMBE  = 3.05;    // crown de la table\nconst float BOURR  = 0.078;    // bourrelet de fluage le long du contour\nconst float BOURG  = 0.070;    //           idem au bord de la gravure\nconst float RBOMBE = 30.0;\n\n/* Onde de choc : la matiere chassee par la frappe part en cercles amortis\n   depuis le point d'impact et se fige. Terme purement transitoire. */\nfloat choc(vec2 p, float k) {\n  if (k <= 0.0) return 0.0;\n  float r = length(p - C);\n  /* Le front part de l'ANNEAU de contact de la matrice, pas d'un point : une\n     onde issue du centre y laisse un teton. */\n  float onde = sin(r * 0.62 - k * 15.0) * exp(-r * 0.055) * exp(-k * 3.4);\n  return onde * 0.34 * smoothstep(0.0, 11.0, r);\n}\n\n/* Hauteur du solide, en unites objet. avance = 0 flan brut, 1 piece frappee. */\nfloat hauteur(vec2 p, float avance) {\n  float dL = -sdLosange(p);\n  float dG = -sdAnneau(p);\n\n  float chanf = max(mix(0.30, CHANF, avance), traitMini());\n  float h = HAUT * profil(dL / chanf);\n\n  /* Bombe : une piece frappee n'a jamais la table plate. Ce tres leger dome\n     fait balayer a la reflexion toute la boite a lumiere au lieu d'un point\n     unique — c'est lui qui fait la difference entre de l'or et du laiton.\n     Il est QUADRATIQUE en x,y : bati sur la distance signee, il se plissait\n     le long de l'axe median du losange et marquait une croix. */\n  vec2 u = (p - C) / vec2(46.0, 58.0);\n  h += BOMBE * max(0.0, 1.0 - dot(u, u)) * mix(0.55, 1.0, avance);\n\n  /* Bourrelet de fluage. Quand la matrice descend, la matiere qu'elle chasse\n     ne disparait pas : elle reflue et s'accumule en un tres leger bourrelet\n     le long de chaque arete. C'est la signature d'une piece REELLEMENT\n     frappee — et, accessoirement, ce qui fait courir un second filet de\n     lumiere tout le long du contour et tout autour du C. Sans lui, une table\n     plane ne renvoie qu'une seule tache douce et le metal parait imprime. */\n  float b1 = exp(-pow((dL - CHANF - 1.35) / 1.75, 2.0));\n  float b2 = exp(-pow((-dG - CHANG - 0.62) / 0.95, 2.0));\n  /* le bourrelet mesure moins d une unite : en petit il ne montre rien et\n     ajoute du grain. On l eteint plutot que de le laisser grouiller. */\n  h += (BOURR * b1 + BOURG * b2 * step(dG, 0.0)) * smoothstep(0.22, 0.70, avance) * finesse();\n\n  float creux = CREUX * smoothstep(0.0, 0.62, avance);\n  h -= creux * profil(dG / max(CHANG, traitMini()));\n\n  h += choc(p, clamp((avance - 0.30) / 0.34, 0.0, 1.0)) * (1.0 - smoothstep(0.55, 1.0, avance));\n  return h;\n}\n\n/* micro-texture d'orfevrerie\n   Une surface frappee puis avivee n'est jamais lisse : elle porte le sens\n   du brunissage, un piquetage tres fin, et dans la gravure les stries de\n   l'outil qui suivent l'arc.\n\n   Chaque octave est ETEINTE des qu'elle approche la limite de Nyquist du\n   rendu, et son energie est rendue a la rugosite. C'est le filtrage LOD\n   correct : la piece ne scintille pas en petit et ne se lisse pas en grand. */\nfloat hash21(vec2 p) {\n  p = fract(p * vec2(127.1, 311.7));\n  p += dot(p, p + 34.56);\n  return fract(p.x * p.y);\n}\nfloat bruit(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash21(i),                  hash21(i + vec2(1.0, 0.0)), f.x),\n             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);\n}\n\n/* Gradient d'une octave etiree dans la direction sens (stries). */\nvec2 gradStries(vec2 p, vec2 sens, float freq, float etire) {\n  vec2 t = vec2(-sens.y, sens.x);\n  vec2 u = vec2(dot(p, sens) / etire, dot(p, t)) * freq;\n  float e = 0.5;\n  float dx = bruit(u + vec2(e, 0.0)) - bruit(u - vec2(e, 0.0));\n  float dy = bruit(u + vec2(0.0, e)) - bruit(u - vec2(0.0, e));\n  return (sens * (dx / etire) + t * dy) * freq;\n}\n\n/* Renvoie la perturbation de normale et l'energie perdue (rendue a la rugosite). */\nvoid orfevrerie(vec2 p, vec2 sens, float dureteStries, out vec2 pert, out float perdu) {\n  pert = vec2(0.0); perdu = 0.0;\n    float freqs[3];  freqs[0]  = 5.5;    freqs[1] = 15.0;   freqs[2] = 41.0;\n  float amps[3];   amps[0]   = 0.0022; amps[1] = 0.0016;  amps[2] = 0.0011;\n  float etires[3]; etires[0] = 4.0;    etires[1] = 2.8;   etires[2] = 1.35;\n  for (int k = 0; k < 3; k++) {\n    float cyclesParPixel = freqs[k] * uPixel;\n    float vivant = smoothstep(0.42, 0.16, cyclesParPixel);   // > ~2,4 px par cycle\n    float a = amps[k] * mix(1.0, dureteStries, 0.65);\n    vec2 decale = p + vec2(float(k) * 37.13, float(k) * 91.71);\n    if (vivant > 0.001) pert += gradStries(decale, sens, freqs[k], etires[k]) * a * vivant;\n    perdu += a * a * (1.0 - vivant) * 26.0;                  // energie -> rugosite\n  }\n}\n\n/* boite a lumiere de joaillier\n   Aucune image d'environnement : tout est analytique, donc net a n'importe\n   quelle definition et animable sans cout.\n\n   Un bijoutier n'eclaire pas avec des points : il pose une grande boite\n   diffusante au-dessus, un long reflecteur a l'horizon — c'est lui qui\n   dessine le RUBAN de lumiere qui fait chanter l'or — et un fond sombre\n   pour que le metal ait quelque chose de noir a refleter. Sans ce noir,\n   l'or parait peint. */\n/* Reglette : une bande diffusante longue et etroite. Sur la sphere des\n   directions elle occupe un GRAND CERCLE d'epaisseur w, dont l'inclinaison est\n   donnee par sa normale m. C'est l'outil de base du photographe de joaillerie :\n   c'est cette bande, et elle seule, qui pose sur l'or le ruban clair qu'aucun\n   degrade ne sait imiter. L'incliner fait courir le ruban EN DIAGONALE sur la\n   piece — a l'horizontale il coupe le logo en deux. */\nfloat reglette(vec3 d, float incl, float pos, float w) {\n  vec3 m = vec3(cos(incl), sin(incl), 0.0);\n  float x = dot(d, m) - pos;\n  return exp(-pow(abs(x) / w, 1.8));\n}\n\n/* Boite a lumiere de joaillier — fond NOIR, trois reglettes.\n   Le reflexe du debutant est d'entourer la piece de blanc : le metal devient\n   alors uniforme et parait peint. Un or credible reflete surtout du noir, et\n   quelques bandes tres lumineuses. Tout le modele vient de ce contraste. */\nvec3 env(vec3 d, float rough, float az) {\n  float up = -d.y;\n  float k = (az - 0.92) * 0.85;                     // la lumiere tourne, pas la piece\n\n  vec3 c = mix(vec3(0.013, 0.011, 0.009), vec3(0.088, 0.085, 0.080),\n               smoothstep(-0.80, 0.95, up));\n  c = mix(c, c + vec3(0.052, 0.050, 0.047), uJour);\n\n  /* une surface mate elargit la source ; en petit on l elargit encore, car\n     une bande etroite ne produit plus qu un pixel brulant qui scintille. */\n  float fl = mix(1.0, 2.6, rough) * mix(1.38, 1.0, finesse());\n\n  /* Le dome ne fait balayer a la reflexion qu'environ +/- 0,17 : des reglettes\n     larges noieraient toute la table dans un aplat. Elles sont donc FINES et\n     plusieurs, comme un vrai plafond de reglettes au-dessus de l'etabli. */\n  c += vec3(1.00, 0.940, 0.845)\n     * reglette(d, -0.58 + k,  0.020, 0.042 * fl) * mix(1.30, 1.10, uJour);\n  c += vec3(1.00, 0.960, 0.890)\n     * reglette(d, -0.52 + k, -0.115, 0.026 * fl) * 0.92;\n  c += vec3(0.96, 0.975, 1.000)\n     * reglette(d, -0.64 + k,  0.148, 0.020 * fl) * 0.80;\n\n  // reglette d'arete : calee sur l'inclinaison du chanfrein\n  c += vec3(1.00, 0.985, 0.955)\n     * reglette(d, -0.30 + k, 0.470, 0.055 * fl) * 1.62;\n\n  // contre froide : detache l'arete opposee, empeche l'or de virer orange\n  c += vec3(0.46, 0.60, 0.92)\n     * reglette(d, 1.14 + k, -0.330, 0.080 * fl) * 0.78;\n\n  /* Grande diffusante haute, tres large et discrete. Les reglettes sont des\n     grands cercles centres sur l axe de vue : des qu on tourne autour de la\n     piece, la face peut tomber entre deux bandes et devenir terne. Cette\n     nappe large donne au metal de quoi vivre sous tous les angles sans\n     effacer le contraste qui fait la couleur de l or. */\n  c += vec3(1.0, 0.975, 0.935) * smoothstep(-0.15, 0.95, up) * mix(0.26, 0.34, uJour);\n\n  // rebond chaud du support\n  c += vec3(0.80, 0.55, 0.27) * smoothstep(-0.25, -0.95, up) * 0.30;\n\n  return c;\n}\n\n/* Finition ADOUCIE (brossee). Une table d'orfevrerie n'est jamais polie\n   miroir : elle est adoucie a la brosse. Les micro-sillons se comportent comme\n   autant de petits cylindres — la reflexion s'etire alors en un ruban PARALLELE\n   au sens du brossage. C'est ce chatoiement, et non un degrade, qui fait vivre\n   une surface plane. On echantillonne donc l'environnement sur un arc autour\n   de l'axe des sillons. */\nvec3 envBrosse(vec3 R, vec3 T, float rough, float az, float aniso) {\n  if (aniso < 0.004) return env(R, rough, az);\n  vec3 c = vec3(0.0);\n  float somme = 0.0;\n  for (int i = -2; i <= 2; i++) {\n    float t = float(i) * 0.5;\n    float dl = t * aniso;\n    float poids = exp(-t * t * 1.15);\n    float cs = cos(dl), sn = sin(dl);\n    vec3 Rr = R * cs + cross(T, R) * sn + T * dot(T, R) * (1.0 - cs);\n    c += env(Rr, rough, az) * poids;\n    somme += poids;\n  }\n  return c / somme;\n}\n\nfloat D_GGX(float NoH, float a) {\n  float a2 = a * a;\n  float d = NoH * NoH * (a2 - 1.0) + 1.0;\n  return a2 / max(3.14159265 * d * d, 1e-7);\n}\nfloat V_Smith(float NoV, float NoL, float a) {\n  float a2 = a * a;\n  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);\n  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);\n  return 0.5 / max(gv + gl, 1e-7);\n}\nvec3 F_Schlick(vec3 f0, float u) {\n  float f = pow(1.0 - u, 5.0);\n  return f0 + (vec3(1.0) - f0) * f;\n}\n/* Approximation analytique de l'integrale BRDF d'environnement (Karis). */\nvec2 envBRDF(float NoV, float rough) {\n  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);\n  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);\n  vec4 r = rough * c0 + c1;\n  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;\n  return vec2(-1.04, 1.04) * a004 + r.zw;\n}\n\n/* Lumiere ponctuelle nette : c'est elle qui pose la ligne franche sur le\n   pan du chanfrein. Sans elle, le metal reste mou. */\nvec3 ponctuelle(vec3 N, vec3 V, vec3 L, vec3 f0, float rough, vec3 teinte, float force) {\n  vec3 H = normalize(V + L);\n  float NoL = max(dot(N, L), 0.0);\n  float NoV = max(dot(N, V), 1e-4);\n  float NoH = max(dot(N, H), 0.0);\n  float VoH = max(dot(V, H), 0.0);\n  float a = max(rough * rough, 0.0016);\n  vec3 F = F_Schlick(f0, VoH);\n  return F * (D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * NoL) * teinte * force;\n}\n\nconst vec3 OR_F0    = vec3(1.000, 0.7820, 0.3620);\nconst vec3 OR_CREUX = vec3(0.960, 0.7250, 0.3180);   // fond de gravure, tres legerement oxyde\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / uRes;\n  vec2 p  = uZone.xy + vec2(uv.x, 1.0 - uv.y) * uZone.zw;\n\n  float dL = -sdLosange(p);\n  float aa = max(uPixel * 0.62, 1e-4);\n  float couv = clamp(dL / aa + 0.5, 0.0, 1.0);          // couverture antialiasee\n  if (couv <= 0.0) { gl_FragColor = vec4(0.0); return; }\n\n  float av = uFrappe;\n\n  /* normale analytique — pas d'echantillonnage de texture, pas d'escalier */\n  float eps = clamp(uPixel * 0.72, 0.021, CHANF * 0.32);\n  float hx = hauteur(p + vec2(eps, 0.0), av) - hauteur(p - vec2(eps, 0.0), av);\n  float hy = hauteur(p + vec2(0.0, eps), av) - hauteur(p - vec2(0.0, eps), av);\n  vec3 N = normalize(vec3(-hx / (2.0 * eps), -hy / (2.0 * eps), 1.0));\n\n  /* zones : pan chanfreine / table / flanc de gravure / fond de gravure */\n  float dG = -sdAnneau(p);\n  /* Mêmes largeurs effectives que dans hauteur() : si la matière et le relief\n     ne parlaient pas de la même arête, la couleur se décalerait du volume. */\n  float chanf = max(mix(0.30, CHANF, av), traitMini());\n  float changE = max(CHANG, traitMini());\n  float zPan  = 1.0 - smoothstep(0.0, chanf, dL);\n  /* La gravure n'existe pas avant la frappe. Sans cette bride, les zones de\n     creux modulaient deja la rugosite et l'occlusion du FLAN : le C se\n     devinait sur une piece encore vierge, ce qui vide la sequence de son\n     sujet. Une seule variable les eteint toutes a la fois. */\n  float grav = smoothstep(0.0, 0.62, av);\n  float zFond = smoothstep(0.0, changE, dG) * grav;\n  float zFlanc = ((dG > -changE * 0.9 && dG < changE) ? 1.0 - abs(dG) / changE : 0.0) * grav;\n\n  /* sens du brunissage : le long de l'arete sur les pans, suivant l'arc dans\n     la gravure, franchement diagonal sur la table. */\n  vec2 gL = normalize(vec2(hx, hy) + vec2(1e-5));\n  vec2 versArc = normalize(p - C + vec2(1e-5));\n  vec2 sens = normalize(mix(mix(vec2(0.9239, 0.3827), vec2(-gL.y, gL.x), zPan),\n                            vec2(-versArc.y, versArc.x), max(zFond, zFlanc)) + vec2(1e-5));\n\n  vec2 pert; float perdu;\n  orfevrerie(p, sens, mix(0.55, 1.35, max(zPan, zFlanc)), pert, perdu);\n  float poli = smoothstep(0.18, 0.72, av);              // la matrice polit ce qu'elle touche\n  N = normalize(N + vec3(pert * mix(2.1, 1.0, poli), 0.0));\n\n  /* rugosite : flan brut mat -> piece avivee. La gravure reste plus mate. */\n  float rough = mix(0.56, 0.205, poli);\n  rough += (0.175 * zFond + 0.045 * zFlanc - 0.045 * zPan) * mix(0.72, 1.0, finesse());\n  rough = clamp(rough + perdu, 0.055, 0.92);\n\n  vec3 f0 = mix(OR_F0, OR_CREUX, zFond * 0.85);\n\n  /* occlusion : le fond de gravure ne voit qu'une fente de ciel, et la table\n     s'assombrit au bord du creux. Terme geometrique, pas un fond peint. */\n  /* En petit, le flanc de gravure a ete elargi pour ne plus creneler : le\n     coeur a pleine profondeur retrecit d autant et le C perd du contraste.\n     On rend cette profondeur par l occlusion, qui elle ne crenele pas. */\n  float ao = 1.0 - (0.74 + 0.13 * (1.0 - finesse())) * zFond - 0.36 * zFlanc;\n  ao -= 0.26 * (1.0 - smoothstep(0.0, CREUX * 1.5, -dG)) * (1.0 - zFond) * step(dG, 0.0) * grav;\n  ao = clamp(ao, 0.10, 1.0);\n\n  vec3 V = vec3(0.0, 0.0, 1.0);\n  vec3 R = reflect(-V, N);\n  float NoV = max(dot(N, V), 1e-4);\n\n  /* derive lente de la lumiere : la piece est vivante mais ne bouge pas.\n     Periodes harmoniques -> boucle sans couture. */\n  float T = 12.0;\n  float w = 6.2831853 / T;\n  float az = 0.92 + 0.30 * sin(w * uTemps) * uVie + 0.11 * sin(2.0 * w * uTemps + 1.3) * uVie;\n\n  /* balayage de revelation : une vraie lumiere qui traverse, pas un halo. */\n  float bal = clamp((av - 0.46) / 0.34, 0.0, 1.0);\n  az += sin(bal * 3.14159) * 1.15 * (1.0 - smoothstep(0.86, 1.0, av));\n\n  /* axe des sillons, projete sur la surface */\n  vec3 T3 = vec3(sens, 0.0);\n  T3 = normalize(T3 - N * dot(N, T3) + vec3(1e-6));\n  float ANISO = 0.050;\n  float aniso = ANISO * mix(1.0, 0.30, max(zPan, zFlanc)) * mix(0.45, 1.0, poli);\n  vec3 pre = envBrosse(R, T3, rough, az, aniso);\n  vec2 ab = envBRDF(NoV, rough);\n  vec3 col = pre * (f0 * ab.x + ab.y) * ao;\n\n  /* deux sources nettes : la cle pose la ligne du chanfrein, la contre detache */\n  /* plancher de rugosite pour les sources nettes : en petit, un lobe plus\n     etroit que le pixel ne fait pas un reflet, il fait un point qui grésille. */\n  float roughS = max(rough, mix(0.26, 0.0, finesse()));\n  vec3 Lk = normalize(vec3(cos(az) * 0.62, -0.66, 0.42));\n  vec3 Lr = normalize(vec3(-cos(az) * 0.78, 0.30, 0.36));\n  col += ponctuelle(N, V, Lk, f0, roughS, vec3(1.0, 0.975, 0.935), mix(2.35, 1.75, uJour)) * ao;\n  col += ponctuelle(N, V, Lr, f0, roughS, vec3(0.62, 0.70, 0.86), 0.85) * ao;\n\n  /* ombre du poincon qui descend : on ne voit jamais l'outil, on voit la\n     lumiere qu'il mange. C'est ce qu'on verrait reellement en macro. */\n  if (uOutil > 0.001) {\n    float front = mix(-0.35, 1.22, uOutil) * 100.0;\n    float ombre = smoothstep(front + 26.0, front - 6.0, p.y);\n    col *= mix(1.0, mix(1.0, 0.20, uOutil), ombre);\n  }\n\n  /* etincelle de frappe : un eclat speculaire tres bref sur les aretes neuves,\n     issu de la rugosite qui s'effondre — pas une paillette ajoutee. */\n  float ec = exp(-pow((av - 0.335) / 0.052, 2.0));\n  col += vec3(1.0, 0.94, 0.82) * ec * pow(max(zPan, zFlanc), 1.4) * 1.55;\n\n  /* Tonemap : on compresse la LUMINANCE, pas les canaux. Canal par canal, le\n     rouge sature le premier et l'or vire creme des qu'il est vif — c'est le\n     defaut qui trahit tout de suite un metal calcule. */\n  vec3 tm = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);\n  float l  = dot(col, vec3(0.2126, 0.7152, 0.0722));\n  float lt = (l * (2.51 * l + 0.03)) / (l * (2.43 * l + 0.59) + 0.14);\n  col = mix(col * (lt / max(l, 1e-4)), tm, 0.30);\n  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));\n\n  gl_FragColor = vec4(col, couv);                       // alpha DROIT (non premultiplie)\n}\n";
  var VERT = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  var BOITES = {"ratio":2.34035,"sym":{"l":38.5527,"t":1.6074,"w":22.8945,"h":53.5813},"nom":{"l":0.6868,"t":73.1834,"w":98.6263,"h":9.1528},"sig":{"l":46.8978,"t":93.6962,"w":6.2044,"h":4.6963}};
  var SEUIL = 220;
  var SIG = ["M3.114 0.426L3.786 0.426L6.900 4.382L3.786 8.338L3.114 8.338L-0 4.382Z","M13.214 0.426L13.886 0.426L17 4.382L13.886 8.338L13.214 8.338L10.100 4.382Z","M23.314 0.426L23.986 0.426L27.100 4.382L23.986 8.338L23.314 8.338L20.200 4.382Z"];

  /* ── séquence de frappe ────────────────────────────────────────────
     3,6 s. Chaque instant a une raison physique : rien n'apparaît « en fondu ».

       0 → 260    LE FLAN      un losange brut, mat, arête encore vive
     260 → 620    LA DESCENTE  l'ombre du poinçon mange la lumière
     620 → 680    LA FRAPPE    60 ms : la gravure s'enfonce, les chanfreins
                               se forment, un éclat court sur les arêtes neuves
     680 → 1150   LE FLUAGE    l'onde de choc s'amortit, la matière reflue,
                               la rugosité s'effondre (mat → avivé)
    1150 → 2100   LA LUMIÈRE   une réglette traverse et révèle le relief
    1500 → 2300   LE NOM       LA COMPAGNIE DE L'OR se pose
    2100 → 2700   LA SIGNATURE bleu, ivoire, rouge, à 110 ms d'écart
    2700 → ∞      LE REPOS     la dérive lente prend le relais, sans couture  */
  var DUREE = 3600;
  function sequence(t) {
    var av, outil, s;
    if (t < 620) av = 0;
    else if (t < 680) { s = (t - 620) / 60; av = 0.42 * (1 - (1 - s) * (1 - s)); }
    else { s = Math.min(1, (t - 680) / 2020); av = 0.42 + 0.58 * (1 - Math.pow(1 - s, 2.4)); }

    if (t < 260) outil = 0;
    else if (t < 600) { s = (t - 260) / 340; outil = s * s * (3 - 2 * s); }
    else if (t < 645) outil = 1;
    else outil = Math.max(0, 1 - (t - 645) / 70);

    return { av: av, outil: outil };
  }

  function contexte(cv) {
    var o = { alpha: true, premultipliedAlpha: false, antialias: false,
              depth: false, stencil: false, powerPreference: 'low-power' };
    return cv.getContext('webgl', o) || cv.getContext('experimental-webgl', o);
  }

  function compiler(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
    return sh;
  }

  function Moteur(cv) {
    var gl = contexte(cv);
    if (!gl) return null;
    var vs = compiler(gl, gl.VERTEX_SHADER, VERT);
    var fs = compiler(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var bf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(pr, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['uRes', 'uZone', 'uPixel', 'uFrappe', 'uTemps', 'uJour', 'uOutil', 'uVie', 'uAffiche']
      .forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    return {
      gl: gl,
      dessiner: function (w, h, e) {
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.uRes, w, h);
        gl.uniform4f(U.uZone, 0, 0, 100, 100);
        gl.uniform1f(U.uPixel, 100 / w);
        gl.uniform1f(U.uAffiche, 100 / Math.max(e.affiche || w, 1));
        gl.uniform1f(U.uFrappe, e.av);
        gl.uniform1f(U.uTemps, e.temps);
        gl.uniform1f(U.uJour, e.jour);
        gl.uniform1f(U.uOutil, e.outil);
        gl.uniform1f(U.uVie, e.vie);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      perdre: function () {
        var x = gl.getExtension('WEBGL_lose_context');
        if (x) x.loseContext();
      }
    };
  }

  function monter(el, opts) {
    opts = opts || {};
    var base = opts.base || el.getAttribute('data-base') || '';
    var avecFrappe = opts.frappe !== false;

    /* ── structure ─────────────────────────────────────────────────── */
    el.classList.add('pcn');
    /* pas de --pcn-ratio en style inline : il l'emporterait sur la regle
       .pcn--court et le bloc court garderait la hauteur du bloc long. */
    el.innerHTML =
      '<span class="pcn__sym">' +
        '<img class="pcn__svg" src="' + base + 'poincon-symbole.svg" alt="" aria-hidden="true">' +
        '<canvas class="pcn__gl" aria-hidden="true"></canvas>' +
      '</span>' +
      /* Les deux versions du nom vivent DANS un conteneur : la séquence anime le
         conteneur, la bascule jour/nuit joue à l'intérieur. Sur un seul élément,
         passer en mode jour après la frappe relançait le délai de 1,5 s de
         l'animation et le nom disparaissait. */
      '<span class="pcn__nom">' +
        '<img class="pcn__nom-img pcn__nom-img--nuit" src="' + base + 'poincon-nom-nuit.svg" alt="" aria-hidden="true">' +
        '<img class="pcn__nom-img pcn__nom-img--jour" src="' + base + 'poincon-nom-jour.svg" alt="" aria-hidden="true">' +
      '</span>' +
      '<span class="pcn__sig">' +
        '<svg viewBox="0 0 27.100 8.765" aria-hidden="true">' +
          '<path class="sig0" fill="#27385f" d="' + SIG[0] + '"/>' +
          '<path class="sig1" fill="#e8e0ce" d="' + SIG[1] + '"/>' +
          '<path class="sig2" fill="#8c3036" d="' + SIG[2] + '"/>' +
        '</svg>' +
      '</span>';
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', "La Compagnie de l'Or");
    el.setAttribute('role', 'img');

    var sym = el.querySelector('.pcn__sym');
    var svg = el.querySelector('.pcn__svg');
    var cv = el.querySelector('.pcn__gl');

    var doux = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var moteur = Moteur(cv);
    if (!moteur) { cv.remove(); el.classList.add('pcn--plat'); return null; }

    /* ── boucle ────────────────────────────────────────────────────── */
    /* relu a chaque taille() : le zoom du navigateur change le devicePixelRatio,
       et le calage doit suivre la grille REELLE — plafonner a 2 desalignait
       les ecrans a DPR 3. Le cout est borne par le cote maximal du tampon. */
    var dpr = window.devicePixelRatio || 1;
    var affiche = 1;   // largeur en pixels ecran reels, hors surechantillonnage
    var w = 0, h = 0, brut = null, visible = true, actif = true, dernier = 0;
    var t0 = 0, jour = 0;

    function taille() {
      /* La disposition se demande depuis le CSS — `--pcn-mode: rang` dans une
         media query — parce que c'est la mise en page qui sait de quoi elle
         dispose. Le reste est appliqué par le composant lui-même : sous le
         seuil, la signature ne serait plus qu'une tache, on la retire et le
         bloc se resserre. Personne n'a à y penser en intégrant. */
      var mode = (getComputedStyle(el).getPropertyValue('--pcn-mode') || '').trim();
      var rang = mode === 'rang', marque = mode === 'marque';
      el.classList.toggle('pcn--rang', rang);
      el.classList.toggle('pcn--marque', marque);
      el.classList.toggle('pcn--court',
        !rang && !marque && el.getBoundingClientRect().width < SEUIL);
      /* SURÉCHANTILLONNAGE. Le symbole s'affiche entre 45 et 80 px : à cette
         taille, le chanfrein de gravure fait un tiers de pixel. Échantillonné
         une seule fois par pixel, il ne rend ni arête ni ombre — il rend une
         dentelure. On rend donc dans un tampon plus grand et on laisse le
         compositeur le réduire : chaque pixel livré est alors une MOYENNE,
         comme sur le rendu 8K. C'est ce qui met le symbole au niveau de
         netteté du texte, qui bénéficie du même traitement par le moteur.
         Coût : quelques dizaines de milliers de pixels, invisible au budget. */
      var r = sym.getBoundingClientRect();
      /* ── CALAGE AU PIXEL DE L'ECRAN ──────────────────────────────
         La boite du symbole est definie en POURCENTAGES : sa taille et
         sa position tombent donc toujours entre deux pixels (mesure :
         73,94 px poses a x = 763,02). Le compositeur re-echantillonne
         alors le tampon sur une grille desalignee et chaque bord
         emprunte a ses voisins — 3 a 4 px de transition la ou le SVG
         natif en fait 2. On cale donc le CANEVAS, et lui seul, sur la
         grille reelle de l'ecran : taille ET position arrondies au
         pixel d'appareil. Le decalage vaut au plus un demi-pixel —
         invisible en geometrie, decisif en nettete. */
      dpr = window.devicePixelRatio || 1;
      var D = Math.max(1, Math.round(r.width * dpr));
      var hD = Math.max(1, Math.round(r.height * dpr));
      var dl = Math.round(r.left * dpr) / dpr - r.left;
      var dt = Math.round(r.top * dpr) / dpr - r.top;
      cv.style.width = (D / dpr) + 'px'; cv.style.height = (hD / dpr) + 'px';
      cv.style.left = dl + 'px'; cv.style.top = dt + 'px';
      cv.style.maxWidth = 'none'; cv.style.maxHeight = 'none';
      cv.style.right = 'auto'; cv.style.bottom = 'auto';
      affiche = D;
      /* ── PETITES TAILLES : LE VECTEUR REPREND ────────────────────
         Sous 40 px, la matiere n'a plus la place d'exister : meme
         parfait, le rendu ne peut montrer ni chanfrein ni brossage.
         Le symbole repasse en SVG pur — net comme une icone native.
         C'est la variante optique de petite taille, pas un repli. */
      el.classList.toggle('pcn--mini', r.width < 40);
      /* ── SURECHANTILLONNAGE x2, EXACTEMENT ───────────────────────
         Le rapport est desormais ENTIER, et le facteur est 2 : a 2:1
         aligne, le retrecissement bilineaire du compositeur moyenne
         exactement les quatre pixels de chaque bloc — un vrai filtre
         boite. L'ancien x4 reposait sur une idee fausse : a 4:1 le
         bilineaire ne prend que 2x2 des 16 pixels — il saute la
         moitie des echantillons. Le lissage du detail INTERIEUR est
         porte par le LOD du nuanceur (uAffiche), pas par le tampon. */
      var ss = racine.__PCN_SS || 2;
      var nw = Math.min(D * ss, 1024);
      var nh = Math.max(1, Math.round(nw * hD / D));
      if (nw !== w || nh !== h) { w = nw; h = nh; cv.width = w; cv.height = h; return true; }
      return false;
    }

    function ambiance() {
      var a = (el.closest('[data-ambiance]') || document.documentElement)
              .getAttribute('data-ambiance');
      jour = a === 'jour' ? 1 : 0;
      el.classList.toggle('pcn--jour', jour === 1);
    }

    /* 60 im/s pendant la frappe, 30 ensuite : la dérive de lumière a une
       période de 12 s — la moitié des images suffit et divise le coût GPU. */
    function image(ms) {
      brut = null;
      if (!actif || !visible) return;
      if (t0 && ms - t0 >= DUREE && ms - dernier < 32) { brut = requestAnimationFrame(image); return; }
      dernier = ms;
      var t = t0 ? ms - t0 : 0;
      var e = avecFrappe && !doux ? sequence(Math.min(t, DUREE)) : { av: 1, outil: 0 };
      e.temps = ms / 1000;
      e.affiche = affiche;
      e.jour = jour;
      e.vie = doux ? 0 : 1;
      taille();
      moteur.dessiner(w, h, e);
      if (!svg.dataset.efface) { svg.dataset.efface = '1'; el.classList.add('pcn--gl'); }
      if (doux) return;                                   // une seule image, puis repos
      brut = requestAnimationFrame(image);
    }

    function demarrer() {
      if (brut) return;
      t0 = t0 || performance.now();
      brut = requestAnimationFrame(image);
    }
    function stopper() { if (brut) { cancelAnimationFrame(brut); brut = null; } }

    taille();
    ambiance();
    var obsAmb = new MutationObserver(ambiance);
    var cible = el.closest('[data-ambiance]') || document.documentElement;
    obsAmb.observe(cible, { attributes: true, attributeFilter: ['data-ambiance'] });

    var obsVue = null;
    if ('IntersectionObserver' in window) {
      obsVue = new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) demarrer(); else stopper();
      }, { rootMargin: '120px' });
      obsVue.observe(el);
    } else demarrer();

    function onVis() { if (document.hidden) stopper(); else if (visible) demarrer(); }
    document.addEventListener('visibilitychange', onVis);
    addEventListener('resize', taille, { passive: true });
    if (window.matchMedia) addEventListener('orientationchange', taille, { passive: true });
    var obsBoite = null;
    if (window.ResizeObserver) { obsBoite = new ResizeObserver(function () { taille(); }); obsBoite.observe(sym); obsBoite.observe(el); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { taille(); });

    if (avecFrappe && !doux) el.classList.add('pcn--anime');
    demarrer();

    return {
      pause: function () { actif = false; stopper(); },
      reprendre: function () { actif = true; demarrer(); },
      rejouer: function () { t0 = performance.now(); el.classList.remove('pcn--anime');
                             void el.offsetWidth; el.classList.add('pcn--anime'); demarrer(); },
      detruire: function () {
        stopper(); obsAmb.disconnect(); if (obsVue) obsVue.disconnect(); if (obsBoite) obsBoite.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        removeEventListener('resize', taille);
        moteur.perdre(); el.innerHTML = '';
      }
    };
  }

  racine.Poincon = { monter: monter, sequence: sequence, DUREE: DUREE,
                     BOITES: BOITES, SEUIL: SEUIL };
})(typeof window !== 'undefined' ? window : this);
