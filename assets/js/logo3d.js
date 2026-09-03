/* logo3d.js — logo B — SCEAU en matiere PBR, ANIME EN AUTONOMIE.
 *
 * Principe : la geometrie du logo ne bouge JAMAIS. Aucune translation, aucune
 * rotation, aucun decalage d UV, aucun transform sur le canvas. Ce qui vit, c est
 * l ECLAIRAGE et la MATIERE : une lumiere de galerie tourne tres lentement autour
 * de l objet, et le fil d or possede des micro-facettes qui derivent le long de sa
 * course — comme un vrai fil metallique qui tournerait imperceptiblement sur son axe.
 *
 * Le relief vient d une normal map cuite depuis la geometrie vectorielle (champ de
 * hauteur = distance au bord, profil de section propre a chaque matiere).
 *
 * Boucle parfaitement raccordee : tous les termes temporels sont des sinusoides dont
 * la periode divise exactement T. Aucun saut au bouclage.
 *
 * API : creerLogo3D(hote, options) -> { pause, reprendre, detruire } | null
 */

const VERT = `attribute vec2 p;varying vec2 vUv;void main(){vUv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;

const FRAG = `precision highp float;
varying vec2 vUv;
uniform sampler2D uSurf;     // rgb = normale, a = couverture
uniform sampler2D uMat;      // rgb = albedo/F0, a = identifiant de matiere
uniform vec3 uL;             // direction de la lumiere principale
uniform vec2 uEnvDec;        // glissement de la bande lumineuse d environnement
uniform float uPhase;        // phase de boucle, 0..2PI
uniform float uVie;          // 0 = pose figee, 1 = animation complete
uniform float uIntensite;
uniform vec4 uZone;          // fenetre UV : xy = origine, zw = etendue

const float PI = 6.28318530718 * .5;
const float TAU = 6.28318530718;

// Environnement de galerie : plafond chaud, horizon neutre, sol sombre.
// Aucune source ponctuelle : pas d eclat, pas de flare.
vec3 env(vec3 r){
  float t = clamp(r.y * .5 + .5 + uEnvDec.y * .10, 0., 1.);
  vec3 sol = vec3(.050,.046,.042), horiz = vec3(.28,.255,.225), ciel = vec3(.93,.885,.80);
  vec3 c = t < .5 ? mix(sol, horiz, t*2.) : mix(horiz, ciel, (t-.5)*2.);
  // bande large et douce : c est elle qui glisse lentement sur le metal
  float bande = exp(-pow((r.x - uEnvDec.x*.60)*1.45, 2.)) * smoothstep(-.1,.7,r.y);
  return c + vec3(.30,.275,.235) * bande;
}
float D_GGX(float NoH, float a){ float a2=a*a; float d=NoH*NoH*(a2-1.)+1.; return a2/(PI*d*d); }
float V_Smith(float NoV,float NoL,float a){ float a2=a*a;
  float gv=NoL*sqrt(NoV*NoV*(1.-a2)+a2), gl=NoV*sqrt(NoL*NoL*(1.-a2)+a2);
  return .5/max(gv+gl,1e-5); }
vec3 F_Schlick(vec3 f0,float u){ return f0+(1.-f0)*pow(1.-u,5.); }
float grain(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

/* Micro-facettes du fil : somme de sinusoides dont les frequences TEMPORELLES sont
   des harmoniques entieres de la boucle -> la derive est reelle ET le raccord est
   exact. Les frequences SPATIALES sont volontairement incommensurables pour que le
   motif ne se lise jamais comme une regularite. */
float facettes(float u, float ph){
  float g  = .55 * sin( 18.0*u + 0.0 - 1.0*ph);
  g       += .32 * sin( 42.0*u + 1.7 - 2.0*ph);
  g       += .21 * sin( 73.0*u + 3.9 - 3.0*ph);
  g       += .13 * sin(131.0*u + 5.2 - 2.0*ph);
  return g / 1.21;
}

void main(){
  vec2 uv = uZone.xy + vUv * uZone.zw;
  vec4 s = texture2D(uSurf, uv);
  if (s.a < .004) discard;
  vec4 m = texture2D(uMat, uv);
  float id = floor(m.a * 255. / 40. + .5);

  float rug, met;
  if (id < 1.5)      { rug = .19; met = 1.; }   // fil d or : lobe serre -> vrais eclats
  else if (id < 2.5) { rug = .29; met = 1.; }   // Co cuivre champagne
  else if (id < 3.5) { rug = .25; met = 1.; }   // OR massif
  else if (id < 4.5) { rug = .50; met = 0.; }   // ivoire
  else               { rug = .78; met = 0.; }   // tricolore, mat

  // micro-rayures satinees, FIXES : elles cassent le reflet parfait et evitent
  // l aspect plastique, sans jamais scintiller (elles ne dependent pas du temps).
  if (met > .5) rug += (grain(floor(uv*vec2(1800.,110.)))-.5) * .05;

  vec3 N = normalize(s.rgb * 2. - 1.);

  /* --- scintillement du fil et, tres attenue, du Co ---
     On ne dessine AUCUN point lumineux : on incline legerement la normale dans la
     direction transverse au trait, ce qui revient a faire tourner le cylindre autour
     de son axe. Les eclats naissent alors du speculaire lui-meme, quand une facette
     satisfait la condition miroir. C est physique, jamais decoratif. */
  if (id < 2.5) {
    float g = facettes(uv.x, uPhase);
    vec2 travers = normalize(N.xy + vec2(1e-5));
    float amp = (id < 1.5 ? .30 : .085) * uVie;
    N = normalize(N + vec3(travers * g * amp, 0.));
    rug = clamp(rug * (1. - .22 * g * uVie), .06, .95);
  }

  vec3 V = vec3(0.,0.,1.);
  vec3 L = normalize(uL);
  vec3 H = normalize(L + V);
  float NoV = max(dot(N,V), 1e-4), NoL = max(dot(N,L), 0.);
  float NoH = max(dot(N,H), 0.), VoH = max(dot(V,H), 0.);

  vec3 alb = m.rgb;
  vec3 F0 = mix(vec3(.04), alb, met);
  vec3 F = F_Schlick(F0, VoH);
  // plafond sur le lobe speculaire : un eclat reste un eclat, jamais un pixel brule
  float spec = min(D_GGX(NoH, rug) * V_Smith(NoV, NoL, rug) * NoL, 12.);
  vec3 diff = (1.-met) * alb * NoL * .92;

  vec3 R = reflect(-V, N);
  vec3 Renv = normalize(mix(R, N, rug * .55));
  vec3 refl = env(Renv) * F_Schlick(F0, NoV);

  vec3 lum = vec3(1.,.965,.905) * 1.18;
  vec3 col = (diff + F * spec) * lum + refl * mix(.55, 1., met);
  col += alb * (1.-met) * vec3(.20,.181,.152);   // ambiante chaude : l ivoire reste ivoire

  col = col * uIntensite;
  col = col / (col + .9);                          // compression douce
  col = pow(col, vec3(1./2.2));
  gl_FragColor = vec4(col, s.a);
}`;

function compiler(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn('logo3d', gl.getShaderInfoLog(sh)); return null; }
  return sh;
}

/* Decodage SANS premultiplication ni conversion colorimetrique : nos deux textures
   transportent des DONNEES (normale, identifiant de matiere), pas des images. */
function charger(src) {
  if (window.createImageBitmap) {
    return fetch(src).then(r => r.blob())
      .then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
  }
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}

export async function creerLogo3D(hote, o = {}) {
  const base = o.base || 'assets/logo/';
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anime = !reduit && !o.figer;

  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  // AUCUN transform : le canvas est colle au SVG, pixel pour pixel, en permanence.
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .7s ease;pointer-events:none';
  const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;

  let surf, mat;
  try {
    [surf, mat] = await Promise.all([
      charger(base + 'logo-v2b-surface.png'),
      charger(base + (o.matiere || 'logo-v2b-matiere.png')),
    ]);
  } catch (e) { return null; }

  const vs = compiler(gl, gl.VERTEX_SHADER, VERT), fs = compiler(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('logo3d', gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = (img, unite) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unite);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return t;
  };
  tex(surf, 0); tex(mat, 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'uSurf'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uMat'), 1);
  const uL = gl.getUniformLocation(prog, 'uL');
  const uEnv = gl.getUniformLocation(prog, 'uEnvDec');
  const uPhase = gl.getUniformLocation(prog, 'uPhase');
  const uVie = gl.getUniformLocation(prog, 'uVie');
  const uZone = gl.getUniformLocation(prog, 'uZone');
  const vb = o.viewBox || [184, 259, 1193, 482.5];
  const z = o.zone || vb;
  gl.uniform4f(uZone, (z[0] - vb[0]) / vb[2], (z[1] - vb[1]) / vb[3], z[2] / vb[2], z[3] / vb[3]);
  gl.uniform1f(gl.getUniformLocation(prog, 'uIntensite'), o.intensite ?? 1);
  gl.uniform1f(uVie, anime ? 1 : 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  hote.appendChild(cv);

  /* --- boucle : 9 s, raccord exact --- */
  const T = o.periode || 9000;
  const AZ = 238 * Math.PI / 180, EL = 56 * Math.PI / 180;
  const A_AZ = 9 * Math.PI / 180;        // +/- 9 deg : visible, jamais spectaculaire
  const A_EL = 4 * Math.PI / 180;
  let t0 = 0, anim = 0, enPause = false;

  function dessiner(ms) {
    const l = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(hote.clientWidth * l));
    const h = Math.max(1, Math.round(hote.clientHeight * l));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }

    // phaseFixe : entree de VERIFICATION. Elle permet de rendre une phase precise et
    // de comparer les silhouettes entre elles au pixel pres.
    const ph = (o.phaseFixe != null) ? o.phaseFixe : (anime ? ((ms - t0) % T) / T * Math.PI * 2 : 0);
    // orbite de la lumiere : fondamentale + une harmonique -> trajectoire non circulaire,
    // donc un balayage qui ne se laisse pas anticiper, et pourtant exactement periodique.
    const az = AZ + A_AZ * (Math.sin(ph) + 0.35 * Math.sin(2 * ph + 1.1)) / 1.35;
    const el = EL + A_EL * Math.sin(ph + 0.7);
    gl.uniform3f(uL, Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el));
    gl.uniform2f(uEnv, Math.sin(ph + 0.4), 0.45 * Math.sin(2 * ph));
    gl.uniform1f(uPhase, ph);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function boucle(ms) {
    if (!t0) t0 = ms;
    dessiner(ms);
    anim = anime && !enPause ? requestAnimationFrame(boucle) : 0;
  }

  // le SVG statique a fait son office : on l efface une fois le metal en place,
  // sinon deux rendus se superposent et les bords se doublent.
  const replis = [...hote.querySelectorAll('img')];
  const posesRepli = replis.map(i => i.style.opacity);

  requestAnimationFrame(ms => {
    dessiner(ms);
    cv.style.opacity = '1';
    replis.forEach(i => { i.style.transition = 'opacity .7s ease'; i.style.opacity = '0'; });
    if (anime) { t0 = 0; anim = requestAnimationFrame(boucle); }
  });

  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => { if (!anim) requestAnimationFrame(dessiner); });
    ro.observe(hote);
  }

  return {
    canvas: cv,
    pause() { enPause = true; if (anim) { cancelAnimationFrame(anim); anim = 0; } },
    reprendre() { if (anime && !anim) { enPause = false; t0 = 0; anim = requestAnimationFrame(boucle); } },
    detruire() {
      enPause = true;
      if (anim) cancelAnimationFrame(anim);
      if (ro) ro.disconnect();
      replis.forEach((i, k) => { i.style.opacity = posesRepli[k] || ''; });
      cv.remove();
    },
  };
}
