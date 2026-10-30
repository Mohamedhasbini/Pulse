// MXAi core: a still 3D render of a rugged glass device with the board visible inside
// (MXAi processor, memory chips, capacitors, connector, cooling fins). Rendered once, again only on resize.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.querySelector('.feature-art');
const canvas = document.getElementById('chipGL');
if (host && canvas) try { start(); } catch (e) { console.warn('chip', e); }

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.9;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100); camera.position.set(0, 0, 20);
  const dev = new THREE.Group(); scene.add(dev);
  const LIME = new THREE.Color('#c6f432');

  // board: dark PCB with fine traces and pads
  const pcbMap = tex(1024, 1280, (g, w, h) => {
    g.fillStyle = '#1c2125'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,170,180,.18)'; g.lineWidth = 2;
    for (let i = 0; i < 140; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 3; k++) { Math.random() < .5 ? x += (Math.random() - .5) * 260 : y += (Math.random() - .5) * 260; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(200,205,210,.35)'; for (let i = 0; i < 260; i++) g.fillRect(Math.random() * w, Math.random() * h, 5, 5);
    g.strokeStyle = 'rgba(198,244,50,.35)'; g.lineWidth = 3; g.strokeRect(14, 14, w - 28, h - 28);
  });
  const pcb = new THREE.Mesh(new RoundedBoxGeometry(4.3, 5.4, .12, 4, .25), new THREE.MeshStandardMaterial({ map: pcbMap, roughness: .55, metalness: .35 }));
  dev.add(pcb);

  // components
  const darkChip = new THREE.MeshPhysicalMaterial({ color: '#16191c', roughness: .42, metalness: .55, clearcoat: .6 });
  const metal = new THREE.MeshPhysicalMaterial({ color: '#c9ced3', roughness: .22, metalness: 1 });
  const box = (w, h, d, x, y, mat = darkChip, r = .04) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat); m.position.set(x, y, .06 + d / 2); dev.add(m); return m; };
  // main processor: silver heat spreader engraved MXAi
  const lid = tex(512, 512, (g, w) => {
    const gr = g.createLinearGradient(0, 0, w, w); gr.addColorStop(0, '#8c939a'); gr.addColorStop(.5, '#5d646b'); gr.addColorStop(1, '#3b4045'); g.fillStyle = gr; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .06})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
    g.fillStyle = 'rgba(15,17,19,.85)'; g.font = '800 132px "Plus Jakarta Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MXAi', w / 2, w / 2 - 10);
    g.font = '600 30px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(15,17,19,.6)'; g.fillText('AI CORE · CMD-01', w / 2, w / 2 + 92);
    g.fillStyle = '#c6f432'; g.beginPath(); g.arc(40, 40, 10, 0, 7); g.fill();
  });
  box(2.15, 2.15, .18, -.05, .55, darkChip, .06);
  const core = box(1.95, 1.95, .1, -.05, .55, new THREE.MeshPhysicalMaterial({ map: lid, roughness: .32, metalness: .85, clearcoat: .4 }), .05); core.position.z = .32;
  // memory and controller chips
  [[-1.45, -1.55, .85, .6], [-.35, -1.55, .85, .6], [1.25, -1.6, .9, .9], [1.45, .7, .7, 1.4], [-1.55, 2.0, .7, .5], [.3, 2.05, 1.2, .45]].forEach(([x, y, w, h]) => box(w, h, .14, x, y));
  // small parts and capacitors
  const capMat = new THREE.MeshPhysicalMaterial({ color: '#2a2e33', roughness: .3, metalness: .8 });
  [[-1.55, 1.3], [-1.2, 1.3], [1.6, 2.15], [1.25, 2.15], [.95, -.6]].forEach(([x, y]) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .32, 24), capMat); c.rotation.x = Math.PI / 2; c.position.set(x, y, .22); dev.add(c); const t = new THREE.Mesh(new THREE.CircleGeometry(.12, 24), metal); t.position.set(x, y, .385); dev.add(t); });
  for (let i = 0; i < 26; i++) box(.16, .08, .06, -1.9 + Math.random() * 3.8, -2.4 + Math.random() * 4.8, metal, .02);
  // connector strip on the right edge
  box(.28, 2.2, .2, 1.85, -.2, darkChip, .04);
  for (let i = 0; i < 14; i++) box(.18, .06, .04, 1.85, -1.18 + i * .15, metal, .01).position.z = .29;
  // bottom QR-ish tag
  box(.55, .55, .02, -1.0, -.55, new THREE.MeshStandardMaterial({ map: tex(128, 128, (g) => { g.fillStyle = '#e7eaec'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#111'; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.random() < .5) g.fillRect(x * 8, y * 8, 8, 8); }), roughness: .6 }), .01);

  // rugged glass case with corner bumpers
  const glass = new THREE.MeshPhysicalMaterial({ color: '#eef6dc', transmission: 1, thickness: 1.2, roughness: .08, ior: 1.42, clearcoat: 1, clearcoatRoughness: .05, attenuationColor: new THREE.Color('#d8f58a'), attenuationDistance: 9, specularIntensity: 1 });
  const shell = new THREE.Mesh(new RoundedBoxGeometry(5.1, 6.2, 1.15, 8, .5), glass); shell.position.z = .25; dev.add(shell);
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => { const b = new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.25, 1.35, 6, .42), glass); b.position.set(sx * 2.25, sy * 2.8, .25); dev.add(b); });
  // dark back plate and cooling fins on the right side
  const back = new THREE.Mesh(new RoundedBoxGeometry(4.9, 6.0, .35, 6, .4), new THREE.MeshPhysicalMaterial({ color: '#0f1113', roughness: .5, metalness: .7 })); back.position.z = -.38; dev.add(back);
  for (let i = 0; i < 16; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(.32, .07, .9), new THREE.MeshPhysicalMaterial({ color: '#1b1e21', metalness: .9, roughness: .35 })); f.position.set(2.62, -1.7 + i * .22, -.05); dev.add(f); }

  // light: soft key, lime rim from behind, cool fill
  const key = new THREE.DirectionalLight('#ffffff', 4); key.position.set(-4, 6, 8); scene.add(key);
  const rim = new THREE.PointLight(LIME, 320, 30); rim.position.set(3, 1, -4); scene.add(rim);
  const rim2 = new THREE.PointLight(LIME, 60, 20); rim2.position.set(-4, -4, 2); scene.add(rim2);
  scene.add(new THREE.AmbientLight('#ffffff', 1.1));

  dev.rotation.set(-.32, .55, -.12);
  const draw = () => renderer.render(scene, camera);
  const size = () => { const r = host.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height;
    camera.position.x = r.width > 700 ? -3.6 : 0; camera.position.y = r.width > 700 ? -.2 : -1.2; camera.updateProjectionMatrix(); draw(); };
  new ResizeObserver(size).observe(host); size();
  document.fonts?.ready.then(() => { lid.needsUpdate = true; draw(); });
  host.classList.add('gl-on');
}
