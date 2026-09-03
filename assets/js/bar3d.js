/* bar3d.js · « Le lingot » · the finale of the journey
   One pristine gold bar in a near-black studio. Scroll orbits the camera slowly, the pointer adds a
   gliding parallax, the environment map gives the gold its real reflections. Loop rests when idle.
   API: createBarScene(container, { reduced }) → { setProgress, setPointer, start, stop, resize, destroy }
*/
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function noiseCanvas(size, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  let s = seed >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  // brushed/cast micro-texture: horizontal streaks + fine grain, mid grey = base roughness
  const img = g.createImageData(size, size); const d = img.data;
  const rows = new Float32Array(size); for (let y = 0; y < size; y++) rows[y] = rnd();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const streak = 0.5 + 0.22 * (rows[y] - 0.5) + 0.12 * (rows[(y + 1) % size] - 0.5);
    const grain = (rnd() - 0.5) * 0.16;
    const v = clamp(streak + grain, 0, 1) * 255; const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

function hallmarkCanvas(size) {
  // a stamped poinçon: rounded-octagon frame with an eagle head silhouette, no letters
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, size, size); // neutral = no bump
  const s = size / 120; g.save(); g.scale(s, s); g.translate(0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = '#2a2a2a'; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(32, 8); g.lineTo(88, 8); g.lineTo(112, 32); g.lineTo(112, 88); g.lineTo(88, 112); g.lineTo(32, 112); g.lineTo(8, 88); g.lineTo(8, 32); g.closePath(); g.stroke();
  g.fillStyle = '#2a2a2a';
  g.beginPath(); g.moveTo(40, 76); g.bezierCurveTo(40, 58, 50, 42, 70, 38); g.bezierCurveTo(76, 37, 82, 38, 87, 41); g.lineTo(78, 45); g.bezierCurveTo(81, 47, 83, 50, 84, 54); g.lineTo(76, 53); g.bezierCurveTo(71, 60, 65, 63, 58, 64); g.bezierCurveTo(53, 65, 49, 68, 47, 73); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(38, 84); g.lineTo(82, 84); g.lineWidth = 4; g.stroke();
  g.restore();
  // soften the stamp so the bump reads as pressed metal
  const c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d'); g2.filter = 'blur(1.2px)'; g2.drawImage(c, 0, 0); return c2;
}

export async function createBarScene(container, opts = {}) {
  const reduced = !!opts.reduced;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { throw new Error('WebGL unavailable'); }
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement; canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; container.appendChild(canvas);

  const scene = new THREE.Scene(); scene.background = null;
  const pmrem = new THREE.PMREMGenerator(renderer); const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env; pmrem.dispose();

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0x030302, roughness: 0.94, metalness: 0, envMapIntensity: 0.02 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // the bar: minted rounded-rectangle bar with bevelled edges, 1.6x real size for presence
  const BW = 0.19, BD = 0.083, BH = 0.014, R = 0.006;
  const shape = new THREE.Shape();
  shape.moveTo(-BW / 2 + R, -BD / 2); shape.lineTo(BW / 2 - R, -BD / 2); shape.quadraticCurveTo(BW / 2, -BD / 2, BW / 2, -BD / 2 + R);
  shape.lineTo(BW / 2, BD / 2 - R); shape.quadraticCurveTo(BW / 2, BD / 2, BW / 2 - R, BD / 2); shape.lineTo(-BW / 2 + R, BD / 2);
  shape.quadraticCurveTo(-BW / 2, BD / 2, -BW / 2, BD / 2 - R); shape.lineTo(-BW / 2, -BD / 2 + R); shape.quadraticCurveTo(-BW / 2, -BD / 2, -BW / 2 + R, -BD / 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: BH, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 4, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2); geo.computeVertexNormals(); geo.computeBoundingBox();
  const by = -geo.boundingBox.min.y; geo.translate(0, by, 0); // rest on the floor
  const roughTex = new THREE.CanvasTexture(noiseCanvas(512, 7)); roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping; roughTex.repeat.set(6, 12); roughTex.colorSpace = THREE.NoColorSpace;
  const hmTex = new THREE.CanvasTexture(hallmarkCanvas(256)); hmTex.colorSpace = THREE.NoColorSpace; hmTex.wrapS = hmTex.wrapT = THREE.ClampToEdgeWrapping; hmTex.repeat.set(1 / 0.03, 1 / 0.03); hmTex.offset.set(-(-0.06 - 0.015) / 0.03, -(-0.015) / 0.03);
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffd27a, metalness: 1, roughness: 0.3, roughnessMap: roughTex, bumpMap: hmTex, bumpScale: 0.0006, envMapIntensity: 1.15, clearcoat: 0 });
  const bar = new THREE.Mesh(geo, gold); bar.castShadow = true; bar.receiveShadow = false;
  const BAR_X = 0.06; bar.position.set(BAR_X, 0, 0); bar.rotation.y = -0.61; scene.add(bar);
  const topY = geo.boundingBox.max.y + by;

  // lights
  const key = new THREE.SpotLight(0xffe6c0, 5, 4, 0.42, 0.9, 2); key.position.set(-0.35, 0.6, 0.3); key.target = bar; key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0003; key.shadow.radius = 4; key.shadow.camera.near = 0.1; key.shadow.camera.far = 3; scene.add(key);
  const rim = new THREE.SpotLight(0xe8cd93, 3.5, 4, 0.5, 0.9, 2); rim.position.set(0.45, 0.35, -0.45); rim.target = bar; scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x2a2418, 0x050403, 0.06));
  const glow = new THREE.PointLight(0xffc87a, 0.12, 0.5, 2); glow.position.set(BAR_X, 0.09, 0); scene.add(glow);

  // camera + orbit
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
  const target = new THREE.Vector3(BAR_X, -0.065, 0);
  let portrait = false, distMul = 1;
  let prog = 0, ptrX = 0, ptrY = 0, ptrSX = 0, ptrSY = 0;
  let running = false, raf = 0, dirty = true, lastRender = 0; const t0 = performance.now();
  function placeCamera(now) {
    const az = -0.45 + 0.9 * smooth(prog) + (reduced ? 0 : Math.sin((now - t0) / 1000 * 2 * Math.PI * 0.05) * 0.05);
    const r = 0.5 * distMul, el = 0.2 * (portrait ? 1.25 : 1);
    camera.position.set(target.x + Math.sin(az) * r + ptrSX * 0.06, el + (-ptrSY) * 0.03, target.z + Math.cos(az) * r);
    camera.lookAt(target);
  }
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; portrait = w / h < 0.9; distMul = portrait ? 1.3 : 1;
    bar.position.x = portrait ? 0 : BAR_X; target.x = bar.position.x; glow.position.x = bar.position.x; camera.updateProjectionMatrix(); dirty = true; kick();
  }
  const ro = new ResizeObserver(() => resize()); ro.observe(container);
  function frame(now) {
    raf = 0; if (!running) return;
    // pointer glide
    const dx = ptrX - ptrSX, dy = ptrY - ptrSY; const moving = Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005;
    if (moving) { ptrSX += dx * 0.06; ptrSY += dy * 0.06; }
    const idle = !reduced; // the whisper drift keeps the scene alive while started
    if (dirty || moving || idle) { placeCamera(now); renderer.render(scene, camera); lastRender = now; dirty = false; if (!container.dataset.ready) container.dataset.ready = '1'; }
    if (moving || idle) raf = requestAnimationFrame(frame);
  }
  function kick() { if (running && !raf) raf = requestAnimationFrame(frame); }
  resize(); placeCamera(performance.now()); renderer.render(scene, camera); container.dataset.ready = '1';
  return {
    setProgress(p) { p = clamp(p, 0, 1); if (p !== prog) { prog = p; dirty = true; kick(); } if (!running) { placeCamera(performance.now()); renderer.render(scene, camera); } },
    setPointer(nx, ny) { ptrX = clamp(nx || 0, -0.5, 0.5); ptrY = clamp(ny || 0, -0.5, 0.5); kick(); },
    start() { if (running) return; running = true; dirty = true; kick(); },
    stop() { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    resize,
    destroy() { this.stop(); ro.disconnect(); geo.dispose(); gold.dispose(); roughTex.dispose(); hmTex.dispose(); floor.geometry.dispose(); floor.material.dispose(); env.dispose(); renderer.dispose(); canvas.remove(); }
  };
}
