/* scenes/expertise.js · Carte 3 « Expertise & proposition » — miniature de la scene d expertise
   Balance de bijoutier (socle sombre adouci, plateau inox brosse, afficheur ambre), bijou d or qui se pose
   reellement (contact, ressort amorti, reaction du plateau), loupe d or a lentille de verre bombee (transmission, reflet net,
   biseau, caustique + anneau d ombre sous la lentille), document de proposition.
   Vie : la key light orbite ±12° (le reflet voyage sur le metal), micro-respiration de la camera. Rien d autre.
   Three.js vendored · ombres douces (1 shadow map 1024, PCFShadowMap) · pixelRatio ≤ 1.5 · alpha:true · ≤ 40k triangles.
   API : createExpertiseScene(host, { reduced, ambiance, quality }) -> { start, stop, setPointer, setAmbiance, setQuality, destroy }
   - quality : 'auto' (defaut : garde-fou iGPU, mesure des 60 premieres frames) | 'high' | 'low'
   - le 1er start() arme la choregraphie : l horloge ne part que lorsque le host est reellement visible (IO interne, seuil 15 %). */
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t, p = 3) => 1 - Math.pow(1 - clamp(t, 0, 1), p);
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const TAU = Math.PI * 2;

/* ---------- chorégraphie (secondes depuis le 1er start visible) ---------- */
const T_DROP = 0.3, T_FALL = 1.0, T_CONTACT = T_DROP + T_FALL;     // bijou : descente puis contact a 1.3 s
const T_COUNT = T_CONTACT + 0.85, D_COUNT = 0.95;                  // afficheur : 0,00 -> 12,60 g une fois le plateau calme
const T_PAPER = 2.45, D_PAPER = 1.25;                              // document : glisse et se pose
const T_DOLLY = 4.2;                                               // camera : 3.4 -> 3.15 pendant la choregraphie
const T_FINAL = 12;                                                // etat final (reduced motion)
const WEIGHT = 12.6;                                               // grammes affiches (aucun montant)
const D_AMB = 0.8;                                                 // duree de la bascule nuit/jour a chaud (eased)

/* ---------- ambiances (interpolees a chaud, k = 0 nuit -> 1 jour) ---------- */
const AMB = {
  nuit: { exposure: 1.0, envInt: 0.62, floor: 0x17130e, floorRough: 0.5, floorEnv: 0.32, key: 17, keyCol: 0xffe1b8, rim: 5.5, rimCol: 0xe8cd93, hemi: 0.18, hemiSky: 0x3a3024, hemiGround: 0x0b0a08, fill: 1.2, fillCol: 0xc9a36a, ao: 0.62, screen: 1.25, paperTint: 0xf6efdf, glassEnv: 1.75, glassTint: 0xdfe5df, caustic: 0.4, shade: 0.26 },
  jour: { exposure: 1.08, envInt: 1.0, floor: 0xd9d0be, floorRough: 0.86, floorEnv: 0.55, key: 10, keyCol: 0xfff3e4, rim: 3.2, rimCol: 0xf0dcb0, hemi: 0.7, hemiSky: 0xfff6e8, hemiGround: 0xcfc4ae, fill: 2.2, fillCol: 0xfff1de, ao: 0.46, screen: 0.95, paperTint: 0xf3ebdc, glassEnv: 0.25, glassTint: 0xb6c0b9, caustic: 0.35, shade: 0.65 }
};

/* ---------- geometrie : boite aux aretes adoucies (equivalent RoundedBoxGeometry, sans addon) ---------- */
function roundedBox(w, h, d, radius, seg = 3) {
  const segments = seg * 2 + 1;
  radius = Math.min(w / 2, h / 2, d / 2, radius);
  const g = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments).toNonIndexed();
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const box = new THREE.Vector3(w, h, d).multiplyScalar(0.5).subScalar(radius);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), hs = 0.5 / segments;
  for (let i = 0; i < pos.length; i += 3) {
    p.fromArray(pos, i); n.copy(p);
    n.x -= Math.sign(n.x) * hs; n.y -= Math.sign(n.y) * hs; n.z -= Math.sign(n.z) * hs; n.normalize();
    pos[i] = box.x * Math.sign(p.x) + n.x * radius; pos[i + 1] = box.y * Math.sign(p.y) + n.y * radius; pos[i + 2] = box.z * Math.sign(p.z) + n.z * radius;
    nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  return g;
}

/* ---------- textures canvas ---------- */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

function radialAlpha(size, inner, outer) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, size / 2 * inner, size / 2, size / 2, size / 2 * outer);
  gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = '#000'; g.fillRect(0, 0, size, size); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
function ringAlpha(size, r0, r1, r2, r3) {                            // anneau doux : 0 -> 1 entre r0 et r1, 1 -> 0 entre r2 et r3 (fractions du rayon)
  const c = mkCanvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, '#000'); gr.addColorStop(r0, '#000'); gr.addColorStop(r1, '#fff'); gr.addColorStop(r2, '#fff'); gr.addColorStop(r3, '#000'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
function brushedMaps() {
  // carte de couleur + carte rugosite/bump concentriques (plateau tourne / brosse), + direction d anisotropie radiale
  const S = 512, col = mkCanvas(S, S), rou = mkCanvas(S, S), gc = col.getContext('2d'), gr = rou.getContext('2d');
  gc.fillStyle = '#cfcdc7'; gc.fillRect(0, 0, S, S); gr.fillStyle = '#8c8c8c'; gr.fillRect(0, 0, S, S);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let r = 1.5; r < S * 0.74; r += 0.8 + rnd() * 1.6) {
    const a = rnd(), w = 0.5 + rnd() * 1.3;
    gc.beginPath(); gc.arc(S / 2, S / 2, r, 0, TAU); gc.lineWidth = w;
    gc.strokeStyle = a < 0.5 ? `rgba(255,255,255,${(rnd() * 0.11).toFixed(3)})` : `rgba(40,40,44,${(rnd() * 0.12).toFixed(3)})`; gc.stroke();
    gr.beginPath(); gr.arc(S / 2, S / 2, r, 0, TAU); gr.lineWidth = w;
    gr.strokeStyle = a < 0.5 ? `rgba(255,255,255,${(rnd() * 0.42).toFixed(3)})` : `rgba(0,0,0,${(rnd() * 0.42).toFixed(3)})`; gr.stroke();
  }
  // traces de brossage plus longues, rares
  for (let i = 0; i < 40; i++) {
    const r = 20 + rnd() * S * 0.5, a0 = rnd() * TAU, da = 0.3 + rnd() * 1.6;
    gc.beginPath(); gc.arc(S / 2, S / 2, r, a0, a0 + da); gc.lineWidth = 0.8; gc.strokeStyle = `rgba(255,255,255,${(0.06 + rnd() * 0.1).toFixed(3)})`; gc.stroke();
  }
  const A = 128, ani = mkCanvas(A, A), ga = ani.getContext('2d'), img = ga.createImageData(A, A), d = img.data;
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const dx = x + 0.5 - A / 2, dy = (A / 2) - (y + 0.5), l = Math.hypot(dx, dy) || 1, i = (y * A + x) * 4;
    d[i] = Math.round((dx / l * 0.5 + 0.5) * 255); d[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); d[i + 2] = 255; d[i + 3] = 255;
  }
  ga.putImageData(img, 0, 0);
  const tc = tex(col, true), tr = tex(rou, false), ta = tex(ani, false); ta.generateMipmaps = false; ta.minFilter = THREE.LinearFilter;
  return { map: tc, rough: tr, aniso: ta };
}
function noiseCanvas(S = 256) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < d.length; i += 4) { const v = 118 + rnd() * 20; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
}
function paperCanvas() {
  const W = 512, H = 724, c = mkCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f3ecdb'; g.fillRect(0, 0, W, H);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,96,60' : '255,255,255'},${(0.04 + rnd() * 0.09).toFixed(3)})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.6, 1); }
  // en-tete : titre en Cormorant italique + filet or fin (vocabulaire de la carte, aucun montant)
  g.fillStyle = 'rgba(118,86,28,.94)'; g.font = 'italic 400 34px "Cormorant Garamond", Georgia, serif'; g.fillText('Proposition de rachat', 52, 92);
  g.fillStyle = 'rgba(150,112,44,.8)'; g.fillRect(52, 108, 226, 1.5);
  g.fillStyle = 'rgba(150,112,44,.9)'; g.save(); g.translate(446, 84); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore();
  // corps : lignes de texte figurees (un peu plus denses pour rester lisibles en jour)
  const line = (y, w, h = 4, a = 0.3) => { g.fillStyle = `rgba(62,50,32,${a})`; g.fillRect(52, y, w, h); };
  line(156, 400); line(186, 372); line(216, 408); line(246, 300);
  // tableau : libelles courts a gauche, pointilles a droite (sans chiffres)
  for (let i = 0; i < 4; i++) { const y = 306 + i * 40; line(y, 120 + (i % 2) * 40, 4, 0.34); g.fillStyle = 'rgba(62,50,32,.2)'; g.fillRect(52, y + 22, 408, 1); g.fillStyle = 'rgba(62,50,32,.36)'; g.fillRect(404, y, 56, 4); }
  line(486, 360); line(516, 330); line(546, 400, 4, 0.24);
  // signature a l encre + cachet or
  g.strokeStyle = 'rgba(58,46,30,.88)'; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath();
  g.moveTo(70, 660); g.bezierCurveTo(100, 584, 150, 612, 166, 656); g.bezierCurveTo(182, 692, 150, 708, 142, 676); g.bezierCurveTo(134, 648, 214, 616, 268, 632); g.bezierCurveTo(310, 644, 290, 686, 332, 660); g.bezierCurveTo(350, 648, 372, 646, 392, 652); g.stroke();
  g.save(); g.translate(432, 636); g.rotate(Math.PI / 4); g.fillStyle = 'rgba(201,154,63,.9)'; g.fillRect(-18, -18, 36, 36); g.strokeStyle = 'rgba(255,246,220,.7)'; g.lineWidth = 1.5; g.strokeRect(-12, -12, 24, 24); g.restore();
  return c;
}

/* afficheur : chiffres fins a 7 segments, creme-ambre, sur fond sombre */
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function makeDisplay() {
  const W = 384, H = 128, c = mkCanvas(W, H), g = c.getContext('2d');
  const ON = '#f3d9a6', OFF = 'rgba(243,217,166,.055)', GLOW = 'rgba(243,205,140,.6)';
  const dw = 30, dh = 60, th = 4.6, gap = 17, y0 = 34, xUnit = W - 36;
  function seg(x, y, lit) {
    const s = { a: [x + th, y, x + dw - th, y], b: [x + dw, y + th, x + dw, y + dh / 2 - th * 0.6], c: [x + dw, y + dh / 2 + th * 0.6, x + dw, y + dh - th], d: [x + th, y + dh, x + dw - th, y + dh], e: [x, y + dh / 2 + th * 0.6, x, y + dh - th], f: [x, y + th, x, y + dh / 2 - th * 0.6], g: [x + th, y + dh / 2, x + dw - th, y + dh / 2] };
    for (const k of 'abcdefg') { const on = lit.includes(k); g.strokeStyle = on ? ON : OFF; g.shadowBlur = on ? 7 : 0; g.shadowColor = GLOW; g.beginPath(); g.moveTo(s[k][0], s[k][1]); g.lineTo(s[k][2], s[k][3]); g.stroke(); }
  }
  function draw(value) {
    const n = Math.max(0, Math.round(value * 100));
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#1b1713'); grd.addColorStop(1, '#120f0c');
    g.shadowBlur = 0; g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W * 0.62, H * 0.4, 4, W * 0.62, H * 0.4, W * 0.6); rg.addColorStop(0, 'rgba(255,225,170,.07)'); rg.addColorStop(1, 'rgba(255,225,170,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineWidth = th; g.save(); g.transform(1, 0, -0.09, 1, 0, 0);
    const digits = [Math.floor(n / 1000) % 10, Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
    let x = xUnit - 42 - 4 * dw - 3 * gap - 10;
    digits.forEach((dg, i) => {
      seg(x, y0, (i === 0 && n < 1000) ? '' : SEG[dg]); x += dw + gap;
      if (i === 1) {                                                  // virgule (point + queue fine), pas un point
        const cx = x - gap / 2 - 2, cy = y0 + dh - 1; g.shadowBlur = 7; g.fillStyle = ON; g.beginPath(); g.ellipse(cx, cy, 2.7, 2.7, 0, 0, TAU); g.fill();
        g.strokeStyle = ON; g.lineWidth = 2.4; g.beginPath(); g.moveTo(cx + 1.2, cy + 1.5); g.lineTo(cx - 1.6, cy + 8); g.stroke(); g.lineWidth = th; x += 10;
      }
    });
    g.restore(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(243,217,166,.9)'; g.font = '300 30px Jost, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText('g', xUnit + 6, y0 + dh + 1); g.textAlign = 'left';
  }
  draw(0);
  const t = tex(c, true); t.anisotropy = 8;
  return { texture: t, draw, value: 0 };
}

/* ---------- environnement studio noir/or (PMREM) : UNE scene temporaire, 2 presets cuits, tout est libere ---------- */
function studioEnvs(renderer) {
  const s = new THREE.Scene(), geo = new THREE.BoxGeometry(), mats = [];
  const roomMat = new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 1 }); mats.push(roomMat);
  const room = new THREE.Mesh(geo, roomMat); room.position.y = 9; room.scale.set(30, 20, 30); s.add(room);
  const pl = new THREE.PointLight(0xffffff, 170, 60, 2); pl.position.set(0, 15, 0); s.add(pl);
  const panels = [];
  const panel = (color, pos, scale) => { const m = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: color }); mats.push(m); panels.push(m); const mesh = new THREE.Mesh(geo, m); mesh.position.set(...pos); mesh.scale.set(...scale); s.add(mesh); };
  panel(0xfff0dc, [0, 18, 0], [7, 0.1, 5]);            // softbox zenithal
  panel(0xffe6c2, [-14, 8, 4], [0.1, 6, 9]);            // fenetre chaude a gauche (cote key)
  panel(0xe8cd93, [13, 6, -5], [0.1, 7, 3]);            // bande doree a droite (rim)
  panel(0x9fb3d6, [2, 4, -14], [9, 2, 0.1]);            // contre-jour froid discret
  panel(0xffdcb0, [0, 3, 14], [9, 3, 0.1]);             // fill bas cote camera
  panel(0xfff3e2, [-10.9, 7.7, -9], [4.2, 6, 0.1]);     // fenetre arriere-gauche : c est elle qui se reflete, courbe, dans la lentille de la loupe
  const PRESET = { nuit: { room: 0x27221c, light: 170, panels: [16, 13, 11, 3, 2.5, 9] }, jour: { room: 0xb8b0a2, light: 600, panels: [26, 18, 10, 5, 6, 17] } };   // jour : fenetre arriere-gauche moins crue (reflet dans la lentille lisible, pas brule)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const bake = p => { roomMat.color.setHex(p.room); pl.intensity = p.light; panels.forEach((m, i) => { m.emissiveIntensity = p.panels[i]; }); return pmrem.fromScene(s, 0.04); };
  const nuit = bake(PRESET.nuit), jour = bake(PRESET.jour);
  pmrem.dispose(); geo.dispose(); mats.forEach(m => m.dispose());
  return { nuit, jour };                                  // render targets (dispose() libere texture + framebuffer)
}

export async function createExpertiseScene(host, opts = {}) {
  const reduced = !!opts.reduced;
  let mode = opts.ambiance || document.documentElement.dataset.ambiance || 'nuit';
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', premultipliedAlpha: true }); } catch (e) { throw new Error('WebGL unavailable'); }
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  const DPR = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(1.5, DPR));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;   // PCF (radius 4) : aucun avertissement de depreciation sous r185
  renderer.transmissionResolutionScale = 0.5;
  renderer.setClearColor(0x000000, 0);
  const root = document.createElement('div'); root.className = 'sce-root'; root.setAttribute('aria-hidden', 'true');
  const canvas = renderer.domElement; canvas.className = 'sce-canvas'; root.appendChild(canvas); host.appendChild(root);
  try { if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load('300 30px Jost'), document.fonts.load('italic 400 34px "Cormorant Garamond"')]), new Promise(r => setTimeout(r, 1200))]); } catch (e) { /* polices : fallback */ }

  const scene = new THREE.Scene();
  const envs = studioEnvs(renderer), envNuit = envs.nuit.texture, envJour = envs.jour.texture;
  scene.environment = mode === 'jour' ? envJour : envNuit;

  /* ---- sol : disque qui se fond dans la carte. Reste dans la liste OPAQUE (donc visible a travers le verre de la loupe,
     passe de transmission) tout en gardant son alpha : blending custom ONE/ZERO (evite le define OPAQUE qui force a=1)
     + premultipliedAlpha pour un compositing correct sur la carte. ---- */
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x17130e, roughness: 0.5, metalness: 0, alphaMap: tex(radialAlpha(256, 0.5, 1)), premultipliedAlpha: true, envMapIntensity: 0.3, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor, blendEquation: THREE.AddEquation });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.7, 56), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const aoTex = tex(radialAlpha(128, 0.18, 1));
  const aoMat = new THREE.MeshBasicMaterial({ color: 0x050403, alphaMap: aoTex, transparent: true, opacity: 0.6, depthWrite: false });
  const mkAO = (w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), aoMat); m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m; };

  /* ---- materiaux ---- */
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xf2c468, metalness: 1, roughness: 0.26, clearcoat: 0.2, clearcoatRoughness: 0.28, envMapIntensity: 1.25 });
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xd5d3ce, metalness: 1, roughness: 0.3, envMapIntensity: 1.0 });
  const brushed = brushedMaps();
  const panTop = new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, map: brushed.map, metalness: 1, roughness: 0.62, roughnessMap: brushed.rough, bumpMap: brushed.rough, bumpScale: 0.0012, anisotropy: 0.55, anisotropyMap: brushed.aniso, envMapIntensity: 1.05 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x2c2825, metalness: 0.12, roughness: 0.46, clearcoat: 0.35, clearcoatRoughness: 0.32, envMapIntensity: 0.7 });
  const darker = new THREE.MeshPhysicalMaterial({ color: 0x1c1916, metalness: 0.1, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.9, metalness: 0 });

  /* ---- balance ---- */
  const balance = new THREE.Group(); balance.position.set(-0.06, 0, 0.02); balance.rotation.y = 0.26; scene.add(balance);
  const SOCLE_W = 1.34, SOCLE_H = 0.19, SOCLE_D = 0.98, FEET = 0.012;
  const socle = new THREE.Mesh(roundedBox(SOCLE_W, SOCLE_H, SOCLE_D, 0.05, 4), dark); socle.position.y = FEET + SOCLE_H / 2; socle.castShadow = true; socle.receiveShadow = true; balance.add(socle);
  const footGeo = new THREE.CylinderGeometry(0.04, 0.036, FEET + 0.004, 16);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const f = new THREE.Mesh(footGeo, rubber); f.position.set(sx * (SOCLE_W / 2 - 0.11), (FEET + 0.004) / 2, sz * (SOCLE_D / 2 - 0.11)); balance.add(f); });
  const socleAO = mkAO(SOCLE_W * 1.22, SOCLE_D * 1.3); socleAO.position.y = 0.0015; balance.add(socleAO);
  const TOP = FEET + SOCLE_H, COL_Z = -0.17;
  const plateRing = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.008, 40), steel); plateRing.position.set(0, TOP + 0.004, COL_Z); plateRing.receiveShadow = true; balance.add(plateRing);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 28), steel); column.position.set(0, TOP + 0.008 + 0.05, COL_Z); column.castShadow = true; balance.add(column);
  const pan = new THREE.Group(); pan.position.set(0, 0, COL_Z); balance.add(pan);
  const PAN_R = 0.42, PAN_T = 0.034, PAN_Y = TOP + 0.008 + 0.1 + PAN_T / 2;
  const panMesh = new THREE.Mesh(new THREE.CylinderGeometry(PAN_R, PAN_R - 0.012, PAN_T, 72), [steel, panTop, steel]); panMesh.castShadow = true; panMesh.receiveShadow = true; pan.add(panMesh);
  const panRim = new THREE.Mesh(new THREE.TorusGeometry(PAN_R - 0.004, 0.009, 10, 84), steel); panRim.rotation.x = Math.PI / 2; panRim.position.y = PAN_T / 2 - 0.004; pan.add(panRim);
  const PAN_TOP = PAN_T / 2 + 0.005;                                 // hauteur locale (dans pan) de la surface du plateau
  // afficheur : module incline sur la face avant du socle + ecran canvas
  const disp = makeDisplay();
  const bezel = new THREE.Group(); bezel.position.set(0.02, TOP + 0.055, SOCLE_D / 2 - 0.085); bezel.rotation.x = -0.5; balance.add(bezel);
  const bezelMesh = new THREE.Mesh(roundedBox(0.56, 0.2, 0.05, 0.016, 2), darker); bezelMesh.castShadow = true; bezel.add(bezelMesh);
  const screenMat = new THREE.MeshPhysicalMaterial({ map: disp.texture, emissive: 0xffffff, emissiveMap: disp.texture, emissiveIntensity: 1.2, roughness: 0.22, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.5 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.16), screenMat); screen.position.set(0, 0, 0.0255); bezel.add(screen);
  const btnGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 18);
  [0.42, 0.52].forEach(x => { const b = new THREE.Mesh(btnGeo, darker); b.position.set(x, TOP + 0.006, SOCLE_D / 2 - 0.16); balance.add(b); });

  /* ---- bijou : noeud d or (maille), orientation de repos cuite dans la geometrie, origine = plan de contact ---- */
  const jewelGeo = new THREE.TorusKnotGeometry(0.155, 0.038, 180, 16, 2, 5);
  jewelGeo.rotateX(Math.PI / 2 + 0.05); jewelGeo.rotateZ(0.07); jewelGeo.computeBoundingBox();
  { const bb = jewelGeo.boundingBox; jewelGeo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); }
  const jewel = new THREE.Mesh(jewelGeo, gold); jewel.castShadow = true; jewel.receiveShadow = true; pan.add(jewel);
  const JEWEL_R = 0.25;                                              // rayon d emprise (compensation de l inclinaison)
  const jewelAO = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), aoMat.clone()); jewelAO.rotation.x = -Math.PI / 2; jewelAO.position.y = PAN_TOP + 0.0015; jewelAO.renderOrder = 1; pan.add(jewelAO);

  /* ---- loupe d or posee devant-gauche : lentille de verre BOMBEE (calotte spherique -> reflets courbes, lecture « verre »
     a 600 comme a 320 px), jonc + lisere interieur qui sertit la lentille, collier, manche qui s evase, bout en bulbe.
     Posee physiquement : elle repose sur le bord lointain du jonc et sur le bulbe du manche (plus epais que le jonc),
     d ou une legere inclinaison (~1.5°) qui fait traverser une bande de reflet nette sur le verre. ---- */
  const LR = 0.165, LT = 0.015, HR0 = 0.02, HR1 = 0.034, HCOL = 0.023, HLEN = 0.34;
  const X_COL = LR + 0.035, X_HANDLE = LR + 0.06 + HLEN / 2, X_CAP = LR + 0.06 + HLEN;
  const LOUPE_TILT = Math.atan((HR1 - LT) / (X_CAP + LR));
  const loupeBase = new THREE.Group(); loupeBase.position.set(-0.72, 0, 0.74); loupeBase.rotation.y = -1.95; scene.add(loupeBase);   // repere au sol (manche vers la camera-gauche)
  const loupe = new THREE.Group(); loupe.position.y = LT + LR * Math.sin(LOUPE_TILT) + 0.0008; loupe.rotation.z = LOUPE_TILT; loupeBase.add(loupe);   // corps incline
  const lring = new THREE.Mesh(new THREE.TorusGeometry(LR, LT, 12, 64), gold); lring.rotation.x = Math.PI / 2; lring.castShadow = true; loupe.add(lring);
  const llip = new THREE.Mesh(new THREE.TorusGeometry(LR - 0.017, 0.004, 8, 64), gold); llip.rotation.x = Math.PI / 2; llip.position.y = 0.006; loupe.add(llip);   // lisere qui sertit la lentille
  const GLASS_R = LR - 0.003, RC = 0.5, THETA = Math.asin(GLASS_R / RC), GLASS_T = 0.97;
  const glassGeo = new THREE.SphereGeometry(RC, 64, 14, 0, TAU, 0, THETA); glassGeo.translate(0, -RC * Math.cos(THETA), 0);   // calotte : bord a y=0, sommet a +0.027
  // verre (atelier review/lab/expertise-glasslab.mjs) : transmission 0.97 (aucun voile laiteux, le sol se voit a travers), rugosite 0.02
  // (la fenetre du studio se reflete NETTE et courbe dans la calotte), ior 1.5, epaisseur 0.07 (le jonc et le bord du socle se refractent
  // au bas de la lentille : lecture « lentille epaisse »), teinte interpolee (quasi neutre en nuit, gris-vert discret en jour pour que la
  // lentille se distingue du sol clair), env 1.75 nuit (lentille brillante, pas un miroir brun) / 0.3 jour (pas de disque blanc depoli)
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe5df, metalness: 0, roughness: 0.02, transmission: GLASS_T, thickness: 0.07, ior: 1.5, envMapIntensity: 1.75, specularIntensity: 1 });
  const glass = new THREE.Mesh(glassGeo, glassMat); glass.position.y = -0.004; glass.renderOrder = 2; loupe.add(glass);
  // biseau de la lentille : fin anneau pale et satine juste sous le lisere, qui attrape la lumiere (fresnel du bord du verre) — lisible a 320 px
  const bevelMat = new THREE.MeshPhysicalMaterial({ color: 0xe6ece4, metalness: 0, roughness: 0.28, transparent: true, opacity: 0.75, depthWrite: false, envMapIntensity: 1.1 });
  const lbevel = new THREE.Mesh(new THREE.TorusGeometry(GLASS_R - 0.02, 0.0026, 8, 72), bevelMat); lbevel.rotation.x = Math.PI / 2; lbevel.position.y = 0.0035; lbevel.renderOrder = 3; loupe.add(lbevel);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(HCOL, HCOL, 0.05, 18), gold); collar.rotation.z = Math.PI / 2; collar.position.set(X_COL, 0, 0); collar.castShadow = true; loupe.add(collar);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(HR0, HR1, HLEN, 18), gold); handle.rotation.z = Math.PI / 2; handle.position.set(X_HANDLE, 0, 0); handle.castShadow = true; loupe.add(handle);
  const hcap = new THREE.Mesh(new THREE.SphereGeometry(HR1, 18, 12), gold); hcap.position.set(X_CAP, 0, 0); loupe.add(hcap);
  const loupeAO = mkAO(0.6, 0.22); loupeAO.position.set(0.36, 0.0012, 0); loupeBase.add(loupeAO);   // occlusion sous le manche seulement (sous la lentille, le sol reste clair : la passe de transmission ignore les transparents)
  // caustique : une lentille bombee posee sur une table concentre la lumiere en une tache claire et douce juste sous elle — c est LE signe
  // « verre » en jour comme en nuit. Dessinee dans la passe opaque (blending additif custom, alpha radial premultiplie, sans ecrire l alpha
  // de la carte) pour rester visible A TRAVERS la lentille (passe de transmission) ; elle derive legerement avec l orbite de la key light.
  const LENS_X = loupeBase.position.x, LENS_Z = loupeBase.position.z;
  const causticMat = new THREE.MeshBasicMaterial({ color: 0xffe9c6, alphaMap: tex(radialAlpha(128, 0.15, 0.62)), premultipliedAlpha: true, transparent: false, depthWrite: false, opacity: 0.4, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, blendEquation: THREE.AddEquation });
  const caustic = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), causticMat); caustic.rotation.x = -Math.PI / 2; caustic.position.set(LENS_X, 0.0022, LENS_Z); caustic.renderOrder = 1; scene.add(caustic);
  // ... et l anneau plus sombre qui l entoure (la lumiere concentree au centre manque a la peripherie) : assombrissement multiplicatif
  // dst * (1 - a), meme passe opaque, alpha de la carte preserve. Ensemble ils donnent la lecture « lentille posee » sans post-processing.
  const shadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex(ringAlpha(128, 0.34, 0.6, 0.84, 1)), premultipliedAlpha: true, transparent: false, depthWrite: false, opacity: 0.26, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, blendEquation: THREE.AddEquation });
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.31), shadeMat); shade.rotation.x = -Math.PI / 2; shade.position.set(LENS_X, 0.002, LENS_Z); shade.renderOrder = 1; scene.add(shade);

  /* ---- document de proposition : papier ivoire, leger galbe d un coin, glisse puis se pose ---- */
  const PW = 0.62, PH = 0.877;
  const paperGeo = new THREE.PlaneGeometry(PW, PH, 18, 24);
  { const p = paperGeo.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / PW + 0.5, v = p.getY(i) / PH + 0.5; const cu = Math.max(0, (u - 0.5) / 0.5), cv = Math.max(0, (v - 0.55) / 0.45); p.setZ(i, 0.028 * cu * cu * cv * cv + 0.004 * Math.max(0, (0.3 - u) / 0.3) ** 2 * Math.max(0, (0.25 - v) / 0.25) ** 2); } paperGeo.computeVertexNormals(); }
  const paperTex = tex(paperCanvas(), true);
  const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, bumpMap: tex(noiseCanvas(), false), bumpScale: 0.0006, roughness: 0.94, metalness: 0, color: 0xf6efdf });
  const paper = new THREE.Mesh(paperGeo, paperMat); paper.castShadow = true; paper.receiveShadow = true;
  const paperPivot = new THREE.Group(); paperPivot.add(paper); paper.rotation.x = -Math.PI / 2; scene.add(paperPivot);
  const PAPER_X = 0.68, PAPER_Z = 0.28, PAPER_ROT = -0.34, PAPER_Y = 0.004;   // la proposition ecrite entre franchement dans le champ : a 0.93 son coin ne formait plus qu un triangle pale illisible au bord droit.
  const paperAO = mkAO(PW * 1.12, PH * 1.1); paperAO.material = aoMat.clone();
  const paperAOPivot = new THREE.Group(); paperAOPivot.rotation.y = PAPER_ROT; paperAOPivot.position.set(PAPER_X, 0, PAPER_Z); paperAO.position.set(0.03, 0.0012, 0.02); paperAOPivot.add(paperAO); scene.add(paperAOPivot);

  /* ---- lumieres : key chaude orbitale (1 seule ombre), rim dore, fill tres doux, hemisphere ---- */
  const key = new THREE.SpotLight(0xffe1b8, 17, 0, 0.62, 0.8, 2); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.00035; key.shadow.normalBias = 0.018; key.shadow.radius = 4; key.shadow.camera.near = 0.8; key.shadow.camera.far = 8;
  key.target.position.set(0, 0.25, 0); scene.add(key, key.target);
  const rim = new THREE.SpotLight(0xe8cd93, 5.5, 0, 0.7, 0.9, 2); rim.position.set(2.0, 1.9, -1.5); rim.target.position.set(0, 0.3, 0); scene.add(rim, rim.target);
  const fill = new THREE.PointLight(0xc9a36a, 1.2, 0, 2); fill.position.set(1.6, 1.2, 2.2); scene.add(fill);
  const hemi = new THREE.HemisphereLight(0x3a3024, 0x0b0a08, 0.18); scene.add(hemi);
  const KEY_R = 2.4, KEY_H = 2.95, KEY_PHI = 2.15;

  /* ---- camera : plongee 3/4 legere, dolly tres lent, respiration, orbite ±6° au pointeur
     — FOV resserre (32 -> 29) + distance compensee (meme couverture de cadre, rien n est coupe) pour aplatir legerement
     la perspective : lecture plus « objectif macro », les matieres (or brosse, verre de la loupe, grain du papier)
     gagnent en compression cinematique sans rien changer au cadrage d ensemble. ---- */
  const camera = new THREE.PerspectiveCamera(29, 1.6, 0.1, 20);
  const target = new THREE.Vector3(0.1, 0.2, 0.14);
  const AZ0 = 0.52, EL0 = 0.45;
  let ptrX = 0, ptrY = 0, sx = 0, sy = 0;
  function placeCamera(t) {
    const dolly = lerp(3.77, 3.49, easeInOut(t / T_DOLLY));
    const breathe = reduced ? 0 : 1;
    const D = dolly + breathe * Math.sin(t * TAU / 8.5) * 0.012;
    const az = AZ0 + sx * 0.21 + breathe * Math.sin(t * TAU / 11) * 0.006;
    const el = EL0 - sy * 0.09 + breathe * Math.sin(t * TAU / 13 + 1) * 0.004;
    camera.position.set(target.x + D * Math.sin(az) * Math.cos(el), target.y + D * Math.sin(el), target.z + D * Math.cos(az) * Math.cos(el));
    camera.lookAt(target.x, target.y + breathe * Math.sin(t * TAU / 9.5) * 0.004, target.z);
  }

  /* ---- qualite : 'high' = verre en transmission ; 'low' (iGPU) = verre transparent simple + pixelRatio 1.25 ---- */
  let quality = 'high', glassEnvMul = 1;
  function setQuality(q) {
    q = q === 'low' ? 'low' : 'high'; if (q === quality) return; quality = q;
    if (q === 'low') { glassMat.transmission = 0; glassMat.transparent = true; glassMat.opacity = 0.3; glassMat.depthWrite = false; glassEnvMul = 1.5; renderer.transmissionResolutionScale = 0.35; renderer.setPixelRatio(Math.min(1.25, DPR)); }
    else { glassMat.transmission = GLASS_T; glassMat.transparent = false; glassMat.opacity = 1; glassMat.depthWrite = true; glassEnvMul = 1; renderer.transmissionResolutionScale = 0.5; renderer.setPixelRatio(Math.min(1.5, DPR)); }
    glassMat.needsUpdate = true; ambApplied = -1; applyAmb(ambK); resize(); if (!raf) render();
  }

  /* ---- ambiance interpolee ---- */
  const cA = new THREE.Color(), cB = new THREE.Color();
  const mixCol = (a, b, k) => { cA.setHex(a); cB.setHex(b); return cA.lerp(cB, k); };
  let ambK = mode === 'jour' ? 1 : 0, ambTarget = ambK, ambFrom = ambK, ambT = 1, ambApplied = -1, ambFloorApplied = -1, aoBase = AMB.nuit.ao;
  // kFloor : le sol rejoint la cible en ~40 % du tween (les tokens CSS de la carte basculent d un coup : le disque de sol ne doit pas
  // rester visible, sombre sur carte claire ou l inverse, pendant toute la transition) ; les objets/lumieres suivent k (0,8 s, eased)
  function applyAmb(k, kFloor = k) {
    if (Math.abs(k - ambApplied) < 0.0005 && Math.abs(kFloor - ambFloorApplied) < 0.0005) return; ambApplied = k; ambFloorApplied = kFloor;
    const N = AMB.nuit, J = AMB.jour;
    renderer.toneMappingExposure = lerp(N.exposure, J.exposure, k);
    // le swap d env map (k = 0.5) est masque par un creux d intensite centre sur la bascule (pas de pop des reflets)
    const dip = 1 - 0.7 * Math.exp(-Math.pow((k - 0.5) / 0.12, 2));
    scene.environment = k < 0.5 ? envNuit : envJour; scene.environmentIntensity = lerp(N.envInt, J.envInt, k) * dip;
    floorMat.color.copy(mixCol(N.floor, J.floor, kFloor)); floorMat.roughness = lerp(N.floorRough, J.floorRough, kFloor); floorMat.envMapIntensity = lerp(N.floorEnv, J.floorEnv, kFloor);
    key.intensity = lerp(N.key, J.key, k); key.color.copy(mixCol(N.keyCol, J.keyCol, k));
    rim.intensity = lerp(N.rim, J.rim, k); rim.color.copy(mixCol(N.rimCol, J.rimCol, k));
    fill.intensity = lerp(N.fill, J.fill, k); fill.color.copy(mixCol(N.fillCol, J.fillCol, k));
    hemi.intensity = lerp(N.hemi, J.hemi, k); hemi.color.copy(mixCol(N.hemiSky, J.hemiSky, k)); hemi.groundColor.copy(mixCol(N.hemiGround, J.hemiGround, k));
    aoBase = lerp(N.ao, J.ao, k); aoMat.opacity = aoBase;
    screenMat.emissiveIntensity = lerp(N.screen, J.screen, k);
    paperMat.color.copy(mixCol(N.paperTint, J.paperTint, k));
    glassMat.envMapIntensity = lerp(N.glassEnv, J.glassEnv, k) * glassEnvMul; glassMat.color.copy(mixCol(N.glassTint, J.glassTint, k));
    causticMat.opacity = lerp(N.caustic, J.caustic, k); shadeMat.opacity = lerp(N.shade, J.shade, k);
  }
  applyAmb(ambK);

  function resize() { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(() => { resize(); if (!raf) render(); }); ro.observe(host);

  /* ---- choregraphie : tout est analytique (independant du framerate, reprise sans saut) ---- */
  let shownWeight = -1, lastTick = -1;
  function animate(t) {
    // bijou : descente naturelle (vitesse residuelle au contact), micro-rebond amorti, inclinaison qui se stabilise
    const s = clamp((t - T_DROP) / T_FALL, 0, 1), u = 1 - s;
    const fallH = 1.25 * (0.82 * u * u + 0.18 * u);
    const tau = Math.max(0, t - T_CONTACT);
    const bounce = tau > 0 ? 0.055 * Math.exp(-7 * tau) * Math.abs(Math.sin(13 * tau)) : 0;
    const tilt = tau > 0 ? 0.045 * Math.exp(-3.6 * tau) * Math.cos(8 * tau) : 0.045;
    // plateau : reponse indicielle d un ressort amorti (enfoncement ~2.5-3.5 mm, oscillation qui s eteint)
    let press = 0;
    if (tau > 0) { const z = 0.26, w = TAU * 2.3, wd = w * Math.sqrt(1 - z * z); press = -0.026 * (1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + z / Math.sqrt(1 - z * z) * Math.sin(wd * tau))); }
    pan.position.y = PAN_Y + press;
    jewel.position.y = PAN_TOP + fallH + bounce + JEWEL_R * Math.abs(Math.sin(tilt));
    jewel.rotation.set(tilt * 0.6, 0.9 * u * u, tilt);
    const gap = fallH + bounce; jewelAO.material.opacity = aoBase * 0.75 * clamp(1 - gap / 0.35, 0, 1); jewelAO.scale.setScalar(1 + gap * 1.2);
    // afficheur : compte de 0,00 a 12,60 g quand le plateau est calme (mise a jour par pas, comme un vrai afficheur)
    const p = clamp((t - T_COUNT) / D_COUNT, 0, 1);
    const w = t < T_COUNT ? 0 : (p >= 1 ? WEIGHT : WEIGHT * easeOut(p, 4));
    const tick = p >= 1 ? 1e9 : Math.floor(t / 0.07);
    if (w !== shownWeight && (tick !== lastTick || p >= 1 || w === 0)) { shownWeight = w; lastTick = tick; disp.draw(w); disp.texture.needsUpdate = true; }
    // document : glisse depuis la droite et se pose
    const d = easeOut((t - T_PAPER) / D_PAPER, 4);
    paperPivot.position.set(PAPER_X + (1 - d) * 1.15, PAPER_Y + (1 - d) * 0.05, PAPER_Z + (1 - d) * 0.08);
    paperPivot.rotation.y = PAPER_ROT - (1 - d) * 0.16;
    paperAO.material.opacity = aoBase * d * d;
    // vie : la key light orbite de ±12° sur 10 s (le reflet speculaire voyage sur le metal)
    const phi = KEY_PHI + (reduced ? 0 : 0.21 * Math.sin(t * TAU / 10));
    key.position.set(Math.cos(phi) * KEY_R, KEY_H, Math.sin(phi) * KEY_R);
    // la caustique de la lentille derive a l oppose de la key light (quelques mm)
    const cdx = LENS_X - key.position.x, cdz = LENS_Z - key.position.z, cl = Math.hypot(cdx, cdz) || 1;
    caustic.position.set(LENS_X + cdx / cl * 0.045, 0.0022, LENS_Z + cdz / cl * 0.045);
    shade.position.set(LENS_X + cdx / cl * 0.018, 0.002, LENS_Z + cdz / cl * 0.018);
  }

  let running = false, started = false, io = null, raf = 0, elapsed = 0, t0 = 0, lastNow = 0, rebase = true, destroyed = false;   // elapsed = horloge rAF moins les pauses (stop/start)
  let qMode = opts.quality === 'low' ? 'low' : opts.quality === 'high' ? 'high' : 'auto', qFrames = 0; const qSamples = [];
  function render() { renderer.render(scene, camera); }
  function frame(now) {
    raf = 0; if (!running || destroyed) return;
    if (rebase) { rebase = false; t0 = now - elapsed * 1000; lastNow = now; }       // reprise sans saut, sur la seule horloge rAF
    const dtRaw = (now - lastNow) / 1000, dt = clamp(dtRaw, 0, 0.05); lastNow = now; elapsed = Math.max(0, (now - t0) / 1000);
    if (qMode === 'auto') {                                                          // garde-fou iGPU : p95 du dt des 60 premieres frames (apres 15 de chauffe) > 20 ms -> 'low'
      qFrames++; if (qFrames > 15 && dtRaw < 0.2) { qSamples.push(dtRaw); if (qSamples.length >= 60) { qSamples.sort((a, b) => a - b); const p95 = qSamples[Math.floor(0.95 * (qSamples.length - 1))]; qMode = p95 > 0.02 ? 'low' : 'high'; if (qMode === 'low') setQuality('low'); } }
    }
    const k = 1 - Math.exp(-dt * 5);
    sx += (ptrX - sx) * k; sy += (ptrY - sy) * k;
    if (ambK !== ambTarget) { ambT = Math.min(1, ambT + dt / D_AMB); ambK = ambT >= 1 ? ambTarget : lerp(ambFrom, ambTarget, easeInOut(ambT)); applyAmb(ambK, lerp(ambFrom, ambTarget, smooth(ambT * 2.5))); }
    animate(elapsed); placeCamera(elapsed); render();
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (running && started && !reduced && !raf && !destroyed) { rebase = true; raf = requestAnimationFrame(frame); } };
  // armement : l horloge de la choregraphie ne part que lorsque le host est reellement visible (ne pas jouer la chute hors ecran)
  function launch() { if (started || destroyed) return; started = true; if (io) { io.disconnect(); io = null; } kick(); }
  function arm() {
    if (started || io || destroyed) return;
    if (typeof IntersectionObserver !== 'function') { launch(); return; }
    io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) launch(); }, { threshold: 0.15 });
    io.observe(host);
  }
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (raf) { cancelAnimationFrame(raf); raf = 0; } }, false);
  canvas.addEventListener('webglcontextrestored', () => { if (running && started && !reduced) kick(); else render(); }, false);

  resize();
  if (opts.quality === 'low') setQuality('low');
  if (reduced) { elapsed = T_FINAL; started = true; animate(T_FINAL); placeCamera(T_FINAL); render(); }
  else { animate(0); placeCamera(0); render(); }                                   // etat d attente : bijou hors champ en haut, 0,00 g, document hors champ
  host.dataset.ready = '1';

  const api = {
    start() {
      if (destroyed || running) return; running = true; root.classList.remove('is-paused');
      if (reduced) { render(); running = false; return; }                 // etat final, aucune boucle
      if (!started) { arm(); render(); return; }                          // 1er start : attend la visibilite reelle du host
      kick();
    },
    stop() { running = false; root.classList.add('is-paused'); if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    setPointer(x, y) { if (reduced) return; ptrX = clamp(+x || 0, -0.5, 0.5); ptrY = clamp(+y || 0, -0.5, 0.5); },
    setAmbiance(m) {
      mode = m === 'jour' ? 'jour' : 'nuit'; ambTarget = mode === 'jour' ? 1 : 0;
      if (ambTarget === ambK) return;
      if (!raf || reduced) { ambK = ambTarget; applyAmb(ambK); render(); }   // pas de boucle active : bascule immediate
      else { ambFrom = ambK; ambT = 0; }                                     // boucle active : tween ease-in-out de 0,8 s
    },
    setQuality(q) { qMode = q === 'low' ? 'low' : 'high'; setQuality(qMode); },
    destroy() {
      api.stop(); destroyed = true; ro.disconnect(); ambMO.disconnect(); if (io) { io.disconnect(); io = null; }
      scene.traverse(o => { if (o.isMesh) { o.geometry && o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!m) return; for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); }); } });
      envs.nuit.dispose(); envs.jour.dispose(); renderer.dispose(); root.remove();
    }
  };
  // suit aussi html[data-ambiance] toute seule (bascule a chaud sans cablage) ; setAmbiance() reste disponible
  const ambMO = new MutationObserver(() => { const m = document.documentElement.dataset.ambiance === 'jour' ? 'jour' : 'nuit'; if (m !== mode) api.setAmbiance(m); });
  ambMO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ambiance'] });
  if (opts.debug) api._dbg = { THREE, scene, renderer, camera, floorMat, floor, key, rim, fill, hemi, gold, steel, panTop, glassMat, glass, bevelMat, lbevel, causticMat, caustic, shadeMat, shade, loupe, loupeBase, paperMat, aoMat, envNuit, envJour, render, get quality() { return quality; }, get started() { return started; }, get ambK() { return ambK; }, set ambK(v) { ambK = ambTarget = ambFrom = v; ambT = 1; applyAmb(v); }, get elapsed() { return elapsed; }, set elapsed(v) { elapsed = v; rebase = true; } };
  return api;
}
export default createExpertiseScene;
