/**
 * Earth — Wollongong, NSW at the origin (local up = +Y, north = −Z), Earth's centre at (0, −0.5, 0).
 *
 * One full-screen ray-traced pass draws the globe, a drifting cloud layer with shadows, city
 * lights and a single-scattering atmosphere (blue limb, warm terminator, aerial perspective).
 * NASA Blue Marble / Black Marble imagery covers the globe; a 500 m Blue Marble tile covers
 * the NSW coast; scale-adaptive procedural detail (coastline, land cover, surf, waves, cloud
 * wisps) takes over where the imagery runs out. A star backdrop fades out as the Sun scene
 * takes over. See CREDITS.md for data sources.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { anchorBasis, geoToLocalPoint, localSkyDir, polarAxisLocal } from './geo';
import { planetFrag, planetVert, starFrag, starVert, UNIT_M } from './shaders';

const meta: LandmarkMeta = {
  id: 'earth',
  name: 'Earth',
  sizeMeters: 1.27e7,
  range: [2.9, 9.4],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Earth is about 12,700 km across, and you are standing on it near Wollongong, NSW. The air that keeps us alive is a thin blue skin, only about 1% as thick as Earth is wide.',
  howWeKnow: {
    instrument: 'Satellites and GPS',
    text:
      'The pictures here are real NASA satellite photos stitched together. Satellites tracked by lasers and GPS measure Earth’s size and shape to within centimetres. Over 2,200 years ago, Eratosthenes estimated it using shadows and a little geometry.',
  },
  lightTime: 'About 42 milliseconds to cross Earth’s diameter',
  timescale: 'One spin: 24 hours. One trip around the Sun: 365¼ days',
  post: { bloom: 0.35, exposure: 1.0 },
  labels: [
    { text: 'Wollongong, NSW', position: [0, 0, 0], zoomRange: [-3.4, -1.0] },
    { text: 'Tasman Sea', position: geoToLocalPoint(-37.5, 157.0), zoomRange: [-2.0, -0.6] },
    { text: 'Australia', position: geoToLocalPoint(-25.5, 134.0), zoomRange: [-1.3, 0.3] },
    { text: 'Earth', position: [0, 0.1, 0], zoomRange: [-0.3, 1.6] },
  ],
};

// Region tile (Blue Marble 500 m tile D2, cropped around Wollongong) — must match the asset crop.
const REGION = { lon0: 146.625, lat0: -30.1542, span: 2048 / 240 };
// Sun: a summer morning in Wollongong, low over the Tasman Sea to the east-north-east.
const SUN_AZ = 72, SUN_EL = 22;
const CLOUD_H = 2500 / UNIT_M;

interface TexSet { day: THREE.Texture; night: THREE.Texture; surf: THREE.Texture; regDay: THREE.Texture; regSurf: THREE.Texture; globalW: number; regionW: number }
const tierFiles = (q: Quality) => (q === 'high' ? { g: 4096, r: 2048 } : q === 'medium' ? { g: 2048, r: 2048 } : { g: 2048, r: 1024 });
const steps = (q: Quality) => (q === "high" ? 14 : q === "medium" ? 11 : 7);
const octaves = (q: Quality) => (q === "high" ? 8 : q === "medium" ? 7 : 5);
const starCount = (q: Quality) => (q === 'high' ? 14000 : q === 'medium' ? 9000 : 4500);

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const loader = new THREE.TextureLoader();
  let renderer: THREE.WebGLRenderer | null = null;
  let assetUrl: (p: string) => string = (p) => p;
  let tier: Quality = 'medium';
  let texSet: TexSet | null = null;
  let clouds: THREE.Texture | null = null;
  let loadToken = 0;
  let disposed = false;
  let cloudRot = 0.35;
  const bufSize = new THREE.Vector2();

  const { east, up, north } = anchorBasis();
  const pole = polarAxisLocal();
  const sunBase = localSkyDir(SUN_AZ, SUN_EL);
  const sun = sunBase.clone();
  const q = new THREE.Quaternion();

  const uniforms = {
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSun: { value: sun },
    uSunE: { value: 5.5 },
    uEast: { value: east }, uUp: { value: up }, uNorth: { value: north },
    uPole: { value: pole },
    uPixAng: { value: 0.001 },
    uTime: { value: 0 },
    uCloudRot: { value: 0 },
    uCloudFade: { value: 1 },
    uDetail: { value: 1 },
    uRegion: { value: new THREE.Vector4(REGION.lon0, REGION.lat0, REGION.span, 1) },
    uGlobalTexel: { value: Math.PI / 4096 },
    tDay: { value: null as THREE.Texture | null },
    tNight: { value: null as THREE.Texture | null },
    tClouds: { value: null as THREE.Texture | null },
    tSurf: { value: null as THREE.Texture | null },
    tRegDay: { value: null as THREE.Texture | null },
    tRegSurf: { value: null as THREE.Texture | null },
  };

  const planetMat = new THREE.ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: planetFrag,
    uniforms,
    defines: { ATM_STEPS: 14, DETAIL_OCT: 9 },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const planet = new THREE.Mesh(quadGeo, planetMat);
  planet.frustumCulled = false;
  planet.renderOrder = 2;
  scene.add(planet);

  // ---------------------------------------------------------------- stars
  const starMat = new THREE.ShaderMaterial({
    vertexShader: starVert,
    fragmentShader: starFrag,
    uniforms: { uDist: { value: 1 }, uScale: { value: 1 }, uOpacity: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  let stars: THREE.Points | null = null;
  const buildStars = (qt: Quality) => {
    if (stars) { scene.remove(stars); stars.geometry.dispose(); }
    const n = starCount(qt);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    // Galactic plane, roughly placed (tilted ~60° to the equator) so the Milky Way band reads.
    const gN = new THREE.Vector3(-0.87, 0.46, -0.2).normalize();
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      // ~45% of stars concentrated towards the galactic plane
      for (let k = 0; k < 8; k++) {
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(t), u, s * Math.sin(t));
        if (i % 20 < 11 || Math.abs(v.dot(gN)) < 0.25 * rnd() + 0.05) break;
      }
      pos.set([v.x, v.y, v.z], i * 3);
      // magnitude-like distribution: many faint, few bright
      const b = Math.pow(rnd(), 5.5);
      const temp = rnd();
      const c = temp < 0.12 ? [0.7, 0.8, 1.0] : temp < 0.55 ? [1.0, 0.97, 0.92] : temp < 0.85 ? [1.0, 0.86, 0.68] : [1.0, 0.72, 0.5];
      const lum = 0.08 + b * 2.4;
      col.set([c[0] * lum, c[1] * lum, c[2] * lum], i * 3);
      size[i] = 1.6 + b * 4.0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    stars = new THREE.Points(g, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 1;
    scene.add(stars);
  };

  // ---------------------------------------------------------------- textures
  const load = async (file: string, srgb: boolean, repeat: boolean) => {
    const t = await loader.loadAsync(assetUrl(file));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const loadSet = async (qt: Quality): Promise<TexSet> => {
    const { g, r } = tierFiles(qt);
    const [day, night, surf, regDay, regSurf] = await Promise.all([
      load(`day_${g}.jpg`, true, true),
      load(`night_${g}.jpg`, false, true),
      load(`surf_${g}.jpg`, false, true),
      load(`region_day_${r}.jpg`, true, false),
      load(`region_surf_${r}.jpg`, false, false),
    ]);
    return { day, night, surf, regDay, regSurf, globalW: g, regionW: r };
  };
  const disposeSet = (s: TexSet | null) => {
    if (!s) return;
    s.day.dispose(); s.night.dispose(); s.surf.dispose(); s.regDay.dispose(); s.regSurf.dispose();
  };
  const applySet = (s: TexSet) => {
    uniforms.tDay.value = s.day;
    uniforms.tNight.value = s.night;
    uniforms.tSurf.value = s.surf;
    uniforms.tRegDay.value = s.regDay;
    uniforms.tRegSurf.value = s.regSurf;
    uniforms.uGlobalTexel.value = Math.PI / s.globalW;
    uniforms.uRegion.value.w = ((REGION.span / s.regionW) * Math.PI / 180) * 0.5;
  };
  const applyTierShader = (qt: Quality) => {
    planetMat.defines.ATM_STEPS = steps(qt);
    planetMat.defines.DETAIL_OCT = octaves(qt);
    planetMat.needsUpdate = true;
  };

  const landmark: Landmark = {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      assetUrl = ctx.assetUrl;
      tier = ctx.quality;
      applyTierShader(tier);
      buildStars(tier);
      const [set, cl] = await Promise.all([loadSet(tier), load('clouds_2048.jpg', false, true)]);
      if (disposed) { disposeSet(set); cl.dispose(); return; }
      texSet = set; clouds = cl;
      uniforms.tClouds.value = cl;
      applySet(set);
    },

    update(frame: FrameState) {
      const cam = frame.camera;
      cam.updateMatrixWorld();
      uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      uniforms.uCamWorld.value.copy(cam.matrixWorld);
      uniforms.uCamPos.value.copy(cam.position);
      uniforms.uTime.value = frame.time;
      if (renderer) renderer.getDrawingBufferSize(bufSize);
      uniforms.uPixAng.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(bufSize.y, 1);

      // Clouds drift at a real-ish wind speed close in, faster (but still gentle) from afar.
      const rate = Math.max(2.4e-6, 0.0012 * 10 ** Math.min(frame.zoom, 0));
      cloudRot = (cloudRot + rate * Math.min(frame.dt, 0.1)) % (Math.PI * 2);
      uniforms.uCloudRot.value = cloudRot;

      // The Sun's direction wanders a few degrees (very slowly) around a summer morning.
      q.setFromAxisAngle(pole, 0.035 * Math.sin(frame.time * 0.012));
      sun.copy(sunBase).applyQuaternion(q);

      // Camera altitude (precise near the origin): fade the cloud layer while passing through it.
      const p = cam.position;
      const alt = (p.dot(p) + p.y) / (Math.hypot(p.x, p.y + 0.5, p.z) + 0.5);
      const gap = Math.abs(alt - CLOUD_H) / CLOUD_H;
      uniforms.uCloudFade.value = 0.15 + 0.85 * THREE.MathUtils.smoothstep(gap, 0.0, 0.6);

      if (stars) {
        const z = frame.zoom;
        starMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(z, -2.4, -1.5) * (1 - THREE.MathUtils.smoothstep(z, 0.6, 1.5));
        stars.visible = starMat.uniforms.uOpacity.value > 0.002;
        starMat.uniforms.uDist.value = cam.position.length() * 20 + 1;
        starMat.uniforms.uScale.value = renderer ? renderer.getPixelRatio() : 1;
      }
      planet.visible = !!texSet;
    },

    setQuality(qt: Quality) {
      if (qt === tier) return;
      const old = tierFiles(tier), next = tierFiles(qt);
      tier = qt;
      applyTierShader(qt);
      buildStars(qt);
      if (old.g === next.g && old.r === next.r) return;
      const token = ++loadToken;
      void loadSet(qt).then((s) => {
        if (disposed || token !== loadToken) { disposeSet(s); return; }
        const prev = texSet;
        texSet = s;
        applySet(s);
        disposeSet(prev);
      }).catch((err) => console.warn('[earth] texture swap failed', err));
    },

    dispose() {
      disposed = true;
      disposeSet(texSet); texSet = null;
      clouds?.dispose(); clouds = null;
      quadGeo.dispose(); planetMat.dispose();
      if (stars) stars.geometry.dispose();
      starMat.dispose();
    },
  };
  return landmark;
};

export default factory;
