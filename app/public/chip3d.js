// MXAi chip: a live 3D AI processor for the How it works panel (glass lid, graphite substrate, silver pins,
// glowing lime core with the MXAi mark, pulsing circuit traces, orbiting data particles, tilts toward the pointer)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.querySelector('.feature-art');
const canvas = document.getElementById('chipGL');
if (host && canvas) try { start(); } catch (e) { console.warn('chip', e); }

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.6;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100); camera.position.set(0, 0, 11);

  const LIME = new THREE.Color('#c6f432');
  const chip = new THREE.Group(); scene.add(chip);

  // circuit traces drawn once into a texture; a moving glow mask makes data flow along them
  const tc = document.createElement('canvas'); tc.width = tc.height = 1024; const g = tc.getContext('2d');
  g.fillStyle = '#15181b'; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(198,244,50,.9)'; g.lineWidth = 3; g.lineCap = 'round';
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 46; i++) { // traces leave the core and run to the edges with right angles
    const side = i % 4, t = rnd(330, 694); let x = 512 + (side === 0 ? -170 : side === 1 ? 170 : 0), y = 512 + (side === 2 ? -170 : side === 3 ? 170 : 0);
    if (side < 2) y = t; else x = t;
    g.beginPath(); g.moveTo(x, y);
    const mid = rnd(60, 160), ex = side === 0 ? 40 : side === 1 ? 984 : x + rnd(-120, 120), ey = side === 2 ? 40 : side === 3 ? 984 : y + rnd(-120, 120);
    if (side < 2) { g.lineTo(x + (side ? mid : -mid), y); g.lineTo(x + (side ? mid : -mid), ey); g.lineTo(ex, ey); } else { g.lineTo(x, y + (side === 3 ? mid : -mid)); g.lineTo(ex, y + (side === 3 ? mid : -mid)); g.lineTo(ex, ey); }
    g.stroke(); g.fillStyle = 'rgba(198,244,50,1)'; g.beginPath(); g.arc(ex, ey, 6, 0, 7); g.fill();
  }
  const traces = new THREE.CanvasTexture(tc); traces.colorSpace = THREE.SRGBColorSpace;

  // substrate
  const sub = new THREE.Mesh(new RoundedBoxGeometry(4.2, 4.2, .32, 6, .36), new THREE.MeshPhysicalMaterial({ color: '#1b1e21', metalness: .55, roughness: .38, clearcoat: 1, clearcoatRoughness: .2 }));
  chip.add(sub);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 3.9), new THREE.MeshStandardMaterial({ map: traces, emissive: LIME, emissiveMap: traces, emissiveIntensity: .55, metalness: .3, roughness: .6, transparent: true }));
  board.position.z = .162; chip.add(board);

  // silver pins on every edge
  const pinMat = new THREE.MeshPhysicalMaterial({ color: '#d7dbe0', metalness: 1, roughness: .18 });
  const pinGeo = new RoundedBoxGeometry(.13, .34, .07, 2, .03);
  for (let s = 0; s < 4; s++) for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(pinGeo, pinMat), o = -1.65 + i * .3;
    if (s === 0) p.position.set(o, 2.25, 0); if (s === 1) p.position.set(o, -2.25, 0);
    if (s === 2) { p.position.set(2.25, o, 0); p.rotation.z = Math.PI / 2; } if (s === 3) { p.position.set(-2.25, o, 0); p.rotation.z = Math.PI / 2; }
    chip.add(p);
  }

  // die: dark metal block with the glowing MXAi core
  const die = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.9, .34, 4, .12), new THREE.MeshPhysicalMaterial({ color: '#0e1012', metalness: .9, roughness: .25, clearcoat: 1 }));
  die.position.z = .33; chip.add(die);
  const lc = document.createElement('canvas'); lc.width = lc.height = 512; const l = lc.getContext('2d');
  l.fillStyle = '#c6f432'; l.fillRect(0, 0, 512, 512);
  l.strokeStyle = '#111'; l.lineWidth = 34; l.lineCap = l.lineJoin = 'round';
  l.beginPath(); l.moveTo(140, 330); l.lineTo(140, 160); l.lineTo(256, 276); l.lineTo(372, 160); l.lineTo(372, 330); l.stroke();
  l.fillStyle = '#111'; l.font = '700 54px "Plus Jakarta Sans", system-ui, sans-serif'; l.textAlign = 'center'; l.fillText('MXAi', 256, 430);
  const logo = new THREE.CanvasTexture(lc); logo.colorSpace = THREE.SRGBColorSpace;
  const coreMat = new THREE.MeshStandardMaterial({ map: logo, emissive: LIME, emissiveMap: logo, emissiveIntensity: .9, roughness: .35, metalness: .1 });
  const core = new THREE.Mesh(new RoundedBoxGeometry(1.15, 1.15, .1, 4, .08), coreMat); core.position.z = .54; chip.add(core);

  // glass lid over everything
  const lid = new THREE.Mesh(new RoundedBoxGeometry(3.7, 3.7, .5, 8, .32), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: .8, roughness: .06, ior: 1.45, metalness: 0, clearcoat: 1, attenuationColor: new THREE.Color('#e9ffb0'), attenuationDistance: 4, transparent: true, opacity: 1 }));
  lid.position.z = .55; chip.add(lid);

  // orbiting data particles
  const N = 160, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push([rnd(2.6, 4.2), rnd(0, 6.28), rnd(-.9, .9), rnd(.15, .45)]);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: LIME, size: .06, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts);

  // light: lime glow from behind and below, cool rim from the top
  const glow = new THREE.PointLight(LIME, 60, 20); glow.position.set(-2, -2.5, 3); scene.add(glow);
  const back = new THREE.PointLight(LIME, 120, 30); back.position.set(0, 0, -4); scene.add(back);
  const rim = new THREE.DirectionalLight('#e8ecf0', 2.2); rim.position.set(4, 5, 6); scene.add(rim);
  scene.add(new THREE.AmbientLight("#ffffff", .6));

  chip.rotation.set(-.45, .5, -.18);
  let tx = 0, ty = 0, cx = 0, cy = 0;
  host.addEventListener('pointermove', e => { const r = host.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - .5; ty = (e.clientY - r.top) / r.height - .5; });
  host.addEventListener('pointerleave', () => { tx = ty = 0; });

  const size = () => { const r = host.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.position.x = r.width > 700 ? -2.2 : 0; camera.updateProjectionMatrix(); };
  new ResizeObserver(size).observe(host); size();
  host.classList.add('gl-on');

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true; new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);
  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop); if (!visible) return;
    const t = still ? 0 : clock.getElapsedTime();
    cx += (tx - cx) * .05; cy += (ty - cy) * .05;
    chip.rotation.x = -.45 + Math.sin(t * .6) * .06 + cy * .5;
    chip.rotation.y = .5 + Math.sin(t * .4) * .12 + cx * .7;
    chip.position.y = Math.sin(t * .9) * .12;
    coreMat.emissiveIntensity = .75 + Math.sin(t * 2.4) * .35;
    board.material.emissiveIntensity = .35 + (Math.sin(t * 1.7) * .5 + .5) * .5;
    back.intensity = 90 + Math.sin(t * 2.4) * 40;
    for (let i = 0; i < N; i++) { const [r, a, z, sp] = seeds[i], an = a + t * sp; pos[i * 3] = Math.cos(an) * r; pos[i * 3 + 1] = Math.sin(an) * r * .55 + chip.position.y; pos[i * 3 + 2] = z + Math.sin(an * 2) * .3; }
    pg.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
  })();
}
