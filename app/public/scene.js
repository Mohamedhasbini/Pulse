// The living scene behind the glass (Three.js): three soft colour glows drifting slowly on the page ground.
// The CSS glows in pulse.css stay underneath, so without WebGL, with reduced motion, or before this loads, nothing changes.
// It renders at low resolution (it is blurred anyway), at most ~30 frames a second, and stops while the tab is hidden.
import * as THREE from '/vendor/three.module.min.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
// the Stone (light) look has no scene: it only runs in the dark theme
if (!reduce.matches && document.documentElement.dataset.theme !== 'light') start();

function start() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' }); } catch { return; }
  const canvas = renderer.domElement;
  canvas.className = 'scene3d'; canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  renderer.setPixelRatio(0.5);

  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uni = { t: { value: 0 }, dark: { value: 0 }, aspect: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true,
    vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `
      varying vec2 v; uniform float t, dark, aspect;
      float glow(vec2 p, vec2 c, float r){ vec2 d = p - c; d.x *= aspect; return exp(-dot(d, d) / (r * r)); }
      void main(){
        vec2 a = vec2(.14 + .06 * sin(t * .11), .80 + .05 * cos(t * .09));
        vec2 b = vec2(.86 + .05 * cos(t * .07), .88 + .04 * sin(t * .13));
        vec2 c = vec2(.70 + .08 * sin(t * .05), .10 + .06 * cos(t * .08));
        float s = mix(1.0, 1.35, dark);
        vec3 col = vec3(.29, .71, .47) * glow(v, a, .42) * .24 * s + vec3(.43, .55, 1.0) * glow(v, b, .40) * .20 * s + vec3(.78, .70, .55) * glow(v, c, .46) * .12 * s;
        gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)) * 2.2, 0.0, 1.0));
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  const size = () => { renderer.setSize(innerWidth, innerHeight, false); uni.aspect.value = innerWidth / innerHeight; };
  const theme = () => { uni.dark.value = document.documentElement.dataset.theme === 'light' ? 0 : 1; };
  size(); theme();
  addEventListener('resize', size);
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let last = 0, raf = 0;
  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; last = now;
    uni.t.value = now / 1000; renderer.render(scene, camera);
  };
  const run = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduce.matches) raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', run);
  reduce.addEventListener?.('change', () => { if (reduce.matches) { cancelAnimationFrame(raf); canvas.remove(); } });
  run();
}
