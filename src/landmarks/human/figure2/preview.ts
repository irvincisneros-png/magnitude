/**
 * Standalone preview of Figure2 (dev only: http://localhost:8520/figure-preview.html, not in the build).
 * URL params: yaw, pitch (deg, camera orbit; yaw 0 = camera on +Z), dist (units), ty (target y),
 * tx, tz, fov (deg), q=high|low, fyaw (figure yaw, deg; default 90 = facing +X, out to sea), t (fixed time s), gpu=1.
 */
import * as THREE from 'three';
import { Figure2 } from './index';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);
const deg = Math.PI / 180;
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 35), W / H, 0.002, 200);
const yaw = num('yaw', -45) * deg, pitch = num('pitch', 8) * deg, dist = num('dist', 3.2);
const target = new THREE.Vector3(num('tx', 0), num('ty', -0.5), num('tz', 0));
camera.position.set(target.x + dist * Math.sin(yaw) * Math.cos(pitch), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(yaw) * Math.cos(pitch));
camera.lookAt(target);

const SUN = new THREE.Vector3(0.882, 0.375, -0.287).normalize();
const SUNCOL = new THREE.Vector3(1.0, 0.84, 0.66).multiplyScalar(2.6);
const TONE = 'col = linearToOutputTexel(vec4(toneMapping(col), 1.0)).rgb;';

const fig = new Figure2({ fragmentOutro: TONE });
fig.setTier(qs.get('q') === 'low' ? 'low' : 'high');
fig.setYaw(num('fyaw', 90) * deg);
fig.setSun(SUN, SUNCOL);
scene.add(fig.group);

// sky dome: simple gradient + sun
const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { uSun: { value: SUN } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 uSun; varying vec3 vD;
  void main(){ vec3 d = normalize(vD); float y = max(d.y, 0.0);
    vec3 col = mix(vec3(0.55,0.6,0.66), vec3(0.09,0.2,0.45), pow(y, 0.55));
    float mu = max(dot(d, uSun), 0.0);
    col += vec3(1.0,0.7,0.4) * (pow(mu, 8.0) * 0.25 + pow(mu, 600.0) * 30.0);
    if (d.y < 0.0) col = vec3(0.35,0.33,0.3);
    ${TONE} gl_FragColor = vec4(col,1.0); }`,
}));
scene.add(sky);

let groundMat: THREE.ShaderMaterial | null = null;
const gpuOn = qs.get('gpu') === '1';
const hud = document.getElementById('hud')!;
(window as unknown as { __fig2: unknown }).__fig2 = { ready: false };

fig.load((p) => `./assets/${p}`).then((info) => {
  // sand ground at the feet, receiving the figure's shadow
  const sh = fig.shadow;
  groundMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN }, uSunCol: { value: SUNCOL }, uShadow: { value: sh.texture }, uShadowMat: { value: sh.matrix }, uInv: { value: new THREE.Matrix4() }, uOn: sh.on },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uSun; uniform vec3 uSunCol; uniform sampler2D uShadow; uniform mat4 uShadowMat; uniform mat4 uInv; uniform float uOn; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
    void main(){
      vec3 o = (uInv * vec4(vW, 1.0)).xyz;
      float s = 1.0;
      if (uOn > 0.5) {
        vec4 sc = uShadowMat * vec4(o, 1.0); vec3 q = sc.xyz / sc.w * 0.5 + 0.5;
        if (all(greaterThan(q.xy, vec2(0.0))) && all(lessThan(q.xy, vec2(1.0))) && q.z < 1.0) {
          s = 0.0;
          for (int i = 0; i < 9; i++) { vec2 off = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * 1.6 / 1024.0; s += step(q.z - 0.002, texture2D(uShadow, q.xy + off).r); }
          s /= 9.0;
        }
      }
      vec2 m = vW.xz * 1.7;
      vec3 alb = vec3(0.52, 0.42, 0.29) * (0.85 + 0.25 * n2(m * 40.0) + 0.1 * n2(m * 3.0));
      float ripple = sin(m.x * 9.0 + n2(m * 2.0) * 4.0) * 0.5 + 0.5;
      alb *= 0.93 + 0.1 * ripple;
      vec3 col = alb * (uSunCol * uSun.y * s + vec3(0.22,0.3,0.42) * 0.9);
      float fog = 1.0 - exp(-length(vW.xz) * 0.04);
      col = mix(col, vec3(0.5,0.55,0.62), fog);
      ${TONE} gl_FragColor = vec4(col,1.0); }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = info.groundY;
  scene.add(ground);
  (window as unknown as { __fig2: unknown }).__fig2 = { ready: true, info };
  hud.textContent = `ground ${info.groundY.toFixed(3)}  feet ${info.feet.map((v) => v.toFixed(3)).join(' ')}`;
});

const gl = renderer.getContext() as WebGL2RenderingContext;
const tq = gpuOn ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
let gpuMs: number[] = [];
const fixedT = qs.has('t') ? num('t', 0) : null;
const t0 = performance.now();
function frame() {
  const time = fixedT ?? (performance.now() - t0) / 1000;
  fig.update(time, renderer);
  if (groundMat) (groundMat.uniforms.uInv.value as THREE.Matrix4).copy(fig.group.matrixWorld).invert();
  if (tq) {
    // figure alone, depth cleared each time: per-draw cost = (T(11 renders) − T(1 render)) / 10
    renderer.render(scene, camera);
    sky.visible = false; const g = scene.children.find((c) => c.type === 'Mesh' && c !== sky); if (g) g.visible = false;
    renderer.autoClear = false;
    const time = (k: number) => {
      const q = gl.createQuery()!;
      gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < k; i++) { renderer.clearDepth(); renderer.render(scene, camera); }
      gl.endQuery(tq.TIME_ELAPSED_EXT);
      return q;
    };
    const q1 = time(1), q11 = time(11);
    renderer.autoClear = true; sky.visible = true; if (g) g.visible = true;
    const poll = () => {
      if (gl.getQueryParameter(q11, gl.QUERY_RESULT_AVAILABLE) && gl.getQueryParameter(q1, gl.QUERY_RESULT_AVAILABLE)) {
        gpuMs.push((gl.getQueryParameter(q11, gl.QUERY_RESULT) - gl.getQueryParameter(q1, gl.QUERY_RESULT)) / 10 / 1e6);
        if (gpuMs.length > 60) gpuMs.shift(); gl.deleteQuery(q1); gl.deleteQuery(q11);
      } else setTimeout(poll, 5);
    };
    poll();
    const s = [...gpuMs].sort((a, b) => a - b);
    hud.textContent = `figure GPU median ${(s[s.length >> 1] ?? 0).toFixed(3)} ms (n=${s.length})`;
    (window as unknown as { __gpu: number }).__gpu = s[s.length >> 1] ?? -1;
  } else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
