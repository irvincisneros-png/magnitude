/**
 * Earth — Woonona Beach, NSW (northern Wollongong) at the origin (local up = +Y, north = −Z), Earth's centre at (0, −0.5, 0).
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
import { anchorBasis, geoToLocalPoint, localSkyDir, polarAxisLocal, WOLLONGONG } from './geo';
import { fetchPNG } from '../human/siteData';
import { planetFrag, planetVert, starFrag, starVert, UNIT_M } from './shaders';

const meta: LandmarkMeta = {
  id: 'earth',
  name: 'Earth',
  sizeMeters: 1.27e7,
  range: [2.9, 9.4],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Earth is about 12,700 km across, and you are standing on it at Woonona Beach, NSW. The air that keeps us alive is a thin blue skin, only about 1% as thick as Earth is wide.',
  howWeKnow: {
    instrument: 'Satellites and GPS',
    text:
      'The pictures here are real NASA satellite photos stitched together. Satellites tracked by lasers and GPS measure Earth’s size and shape to within centimetres. Over 2,200 years ago, Eratosthenes estimated it using shadows and a little geometry. Close to Woonona Beach, the ground is an aerial photograph: © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW), CC BY 4.0, extracted 15 November 2026.',
  },
  lightTime: 'About 42 milliseconds to cross Earth’s diameter',
  timescale: 'One spin: 24 hours. One trip around the Sun: 365¼ days',
  post: { bloom: 0.35, exposure: 1.0 },
  labels: [
    { text: 'Woonona Beach, NSW', position: [0, 0, 0], zoomRange: [-3.4, -1.3] },
    { text: 'Wollongong', position: geoToLocalPoint(WOLLONGONG.lat, WOLLONGONG.lon), zoomRange: [-2.7, -1.5] },
    { text: 'Tasman Sea', position: geoToLocalPoint(-37.5, 157.0), zoomRange: [-2.0, -0.6] },
    { text: 'Australia', position: geoToLocalPoint(-25.5, 134.0), zoomRange: [-1.3, 0.3] },
    { text: 'Earth', position: [0, 0.1, 0], zoomRange: [-0.3, 1.6] },
  ],
};

// Region tile (Blue Marble 500 m tile D2, cropped around Wollongong; absolute lon/lat, so independent of the anchor) — must match the asset crop.
const REGION = { lon0: 146.625, lat0: -30.1542, span: 2048 / 240 };
// Sun: a summer morning at Woonona Beach, low over the Tasman Sea to the east-north-east.
const SUN_AZ = 72, SUN_EL = 22;
const CLOUD_H = 2500 / UNIT_M;
// OSM coastline signed-distance square (coast_sdf.png, 1024², ±14 km). It was baked around an earlier
// anchor 19 m west and 8 m south of the current one (tools/build-earth-coast.py), hence the offset.
const COAST_HALF_M = 14000;
const COAST_OFF_M: [number, number] = [-18.95, 7.99];

// Near field: the human scene's NSW aerial photograph (public/assets/human/aerial*.webp, extents in
// aerial.json, map metres about the same anchor), draped while zoomed in so the hand-over keeps the
// same ground. Fetched lazily (only below ZOOM_PHOTO), coarse level on every tier, mid level on medium/high.
const ZOOM_PHOTO = -1.3;
/** The human scene's dry-sand albedo its photo is calibrated to (src/landmarks/human/aerial.ts SAND_ALB). */
const SAND_ALB = [0.47, 0.39, 0.255];
/** The human scene's coarse height grid, centred on the anchor (features.json grids.coarse). */
const HGT = { file: 'height_coarse.png', cell: 40 };
const reliefSteps = (q: Quality) => (q === 'low' ? 0 : 8);
const midFile = (q: Quality) => (q === 'high' ? 2048 : q === 'medium' ? 1024 : 0);
interface AerialLevel { centre: [number, number]; half: number; files: Record<string, string> }
interface AerialJson { levels: { mid: AerialLevel; coarse: AerialLevel }; sandLinear: [number, number, number] }

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
  let coast: THREE.Texture | null = null;
  let loadToken = 0;
  let disposed = false;
  let cloudRot = 0.35;
  const bufSize = new THREE.Vector2();
  const camC = new THREE.Vector3();
  const baseLabels = (meta.labels ?? []).map((l) => [...l.position] as [number, number, number]);

  const { east, up, north } = anchorBasis();
  const pole = polarAxisLocal();
  const sunBase = localSkyDir(SUN_AZ, SUN_EL);
  const sun = sunBase.clone();
  const q = new THREE.Quaternion();

  const uniforms = {
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uOffset: { value: new THREE.Vector3() },
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
    tCoast: { value: null as THREE.Texture | null },
    uCoastHalf: { value: COAST_HALF_M / UNIT_M },
    uCoastOff: { value: new THREE.Vector2(COAST_OFF_M[0] / UNIT_M, COAST_OFF_M[1] / UNIT_M) },
    tAerC: { value: null as THREE.Texture | null },
    tAerM: { value: null as THREE.Texture | null },
    uAerC: { value: new THREE.Vector4(0, 0, 1, 0) },
    uAerM: { value: new THREE.Vector4(0, 0, 1, 0) },
    uAerGain: { value: new THREE.Vector3(1, 1, 1) },
    uLook: { value: 1 },
    uPatch: { value: 1 },
    uSoftM: { value: 0 },
    tHgt: { value: null as THREE.Texture | null },
    uHgt: { value: new THREE.Vector4(0, 0, 1, 0) },
    uRelief: { value: 1 },
    uSlope: { value: 1 },
    uCloudHole: { value: 1 },
  };

  // ---------------------------------------------------------------- near-field photograph (lazy)
  let aerJson: AerialJson | null | undefined; // undefined: not fetched yet; null: unavailable
  let aerC: THREE.Texture | null = null;
  let aerM: { size: number; t: THREE.Texture } | null = null;
  let aerBusy = false;
  let hgt: THREE.DataTexture | null = null;
  /** The human scene's coarse heights (height_coarse.png: (R·256 + G) / 50 − 100 m, 512² × 40 m, row 0 north) as a half-float texture. */
  const loadHeights = async () => {
    const p = await fetchPNG(assetUrl(`../human/${HGT.file}`));
    const n = p.w;
    const data = new Uint16Array(n * n);
    for (let k = 0; k < n * n; k++) data[k] = THREE.DataUtils.toHalfFloat((p.data[k * p.bpp] * 256 + p.data[k * p.bpp + 1]) / 50 - 100);
    const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return { t, half: (n * HGT.cell) / 2 };
  };
  const aerLoad = async (file: string) => {
    const t = await loader.loadAsync(assetUrl(`../human/${file}`));
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // row 0 = north
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    t.needsUpdate = true;
    return t;
  };
  const setLevel = (u: THREE.Vector4, L: AerialLevel, on: boolean) => u.set(L.centre[0], L.centre[1], 1 / (2 * L.half), on ? 1 : 0);
  /** Fetches whatever the near field still lacks for the current tier (one request chain at a time). */
  const ensurePhoto = async () => {
    if (aerBusy || disposed) return;
    aerBusy = true;
    try {
      if (aerJson === undefined) {
        try {
          const r = await fetch(assetUrl('../human/aerial.json'));
          if (!r.ok) throw new Error(String(r.status));
          aerJson = (await r.json()) as AerialJson;
          const sl = aerJson.sandLinear;
          uniforms.uAerGain.value.set(SAND_ALB[0] / Math.max(sl[0], 1e-3), SAND_ALB[1] / Math.max(sl[1], 1e-3), SAND_ALB[2] / Math.max(sl[2], 1e-3));
        } catch (err) { aerJson = null; console.warn('[earth] near-field photo unavailable', err); }
      }
      const J = aerJson;
      if (!J || disposed) return;
      if (!aerC) {
        const t = await aerLoad(J.levels.coarse.files['2048']);
        if (disposed) { t.dispose(); return; }
        aerC = t; uniforms.tAerC.value = t; setLevel(uniforms.uAerC.value, J.levels.coarse, true);
      }
      if (!hgt) {
        try {
          const h = await loadHeights();
          if (disposed) { h.t.dispose(); return; }
          hgt = h.t; uniforms.tHgt.value = h.t; uniforms.uHgt.value.set(0, 0, 1 / (2 * h.half), 1);
        } catch (err) { console.warn('[earth] near-field heights unavailable', err); }
      }
      const want = midFile(tier);
      if (want !== (aerM?.size ?? 0)) {
        if (!want) { aerM?.t.dispose(); aerM = null; uniforms.tAerM.value = null; uniforms.uAerM.value.w = 0; return; }
        const t = await aerLoad(J.levels.mid.files[String(want)]);
        if (disposed || midFile(tier) !== want) { t.dispose(); return; }
        aerM?.t.dispose();
        aerM = { size: want, t }; uniforms.tAerM.value = t; setLevel(uniforms.uAerM.value, J.levels.mid, true);
      }
    } catch (err) {
      console.warn('[earth] near-field photo failed to load', err);
    } finally {
      aerBusy = false;
    }
  };
  let aerTries = 0;

  const planetMat = new THREE.ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: planetFrag,
    uniforms,
    defines: { ATM_STEPS: 14, DETAIL_OCT: 9, RELIEF_STEPS: 8 },
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
    planetMat.defines.RELIEF_STEPS = reliefSteps(qt);
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
      const [set, cl, co] = await Promise.all([loadSet(tier), load('clouds_2048.jpg', false, true), load('coast_sdf.png', false, false)]);
      if (disposed) co.dispose(); else { coast = co; uniforms.tCoast.value = co; }
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
      // Zoomed in, Woonona Beach sits at the origin; zoomed out, the globe glides up so its centre is.
      // The camera orbits the origin at distance d, so the shift is capped to keep a level (pitch ≥ 0)
      // camera above the globe by at least 12% of d — otherwise mid-glide views would sit inside Earth.
      const d = cam.position.length();
      const target = 0.5 * THREE.MathUtils.smoothstep(frame.zoom, -1.6, -0.3);
      const bound = 0.5 - Math.sqrt(Math.max(0, (0.5 + 0.12 * d) ** 2 - d * d));
      const shift = Math.max(0, Math.min(target, bound));
      uniforms.uOffset.value.set(0, shift, 0);
      meta.labels?.forEach((l, i) => { l.position[1] = baseLabels[i][1] + shift; });
      const p = camC.copy(cam.position).sub(uniforms.uOffset.value);
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
      // the near field: the human scene's look (light, sea, haze) hands over to this scene's own by s ≈ 5.2;
      // its photograph (blurred towards Blue Marble's resolution from s ≈ 3.95) is draped until s ≈ 4.65;
      // the terrain relief is ray-marched until s ≈ 4.3 and slope-lit until s ≈ 4.95; the clouds over the anchor return over s ≈ 4.2–4.95 (colour-matched to Blue Marble at its edges and from afar)
      const z = frame.zoom;
      uniforms.uLook.value = 1 - THREE.MathUtils.smoothstep(z, -3.35, -1.9);
      uniforms.uPatch.value = 1 - THREE.MathUtils.smoothstep(z, -2.9, -2.45);
      uniforms.uSoftM.value = 700 * THREE.MathUtils.smoothstep(z, -3.15, -2.5);
      uniforms.uRelief.value = 1 - THREE.MathUtils.smoothstep(z, -3.1, -2.8);
      uniforms.uSlope.value = 1 - THREE.MathUtils.smoothstep(z, -2.7, -2.15);
      uniforms.uCloudHole.value = 1 - THREE.MathUtils.smoothstep(z, -2.9, -2.15);
      if (z < ZOOM_PHOTO && aerJson !== null && !aerBusy && aerTries < 3 && (!aerC || midFile(tier) !== (aerM?.size ?? 0))) {
        aerTries++;
        void ensurePhoto().then(() => { if (aerC && midFile(tier) === (aerM?.size ?? 0)) aerTries = 0; });
      }
      planet.visible = !!texSet;
    },

    setQuality(qt: Quality) {
      if (qt === tier) return;
      const old = tierFiles(tier), next = tierFiles(qt);
      tier = qt;
      applyTierShader(qt);
      buildStars(qt);
      aerTries = 0; // the near field's mid level follows the tier (picked up in update while zoomed in)
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
      coast?.dispose(); coast = null;
      aerC?.dispose(); aerC = null; aerM?.t.dispose(); aerM = null;
      uniforms.tAerC.value = null; uniforms.tAerM.value = null;
      hgt?.dispose(); hgt = null; uniforms.tHgt.value = null;
      quadGeo.dispose(); planetMat.dispose();
      if (stars) stars.geometry.dispose();
      starMat.dispose();
    },
  };
  return landmark;
};

export default factory;
