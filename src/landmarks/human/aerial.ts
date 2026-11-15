/**
 * The real aerial photograph of Woonona Beach and the northern Illawarra coast (NSW Spatial Services,
 * NSW Imagery, CC BY: see CREDITS.md), baked onto the scene's map-metre grid by
 * tools/build-woonona-imagery.py as three nested levels (a clipmap):
 *   fine    2048 m square at 0.5 m/px (4096², or 2048² on medium) — the beach, Collins Point, the rock pool
 *   mid     8192 m square at 4 m/px  (2048², or 1024² on low)     — Woonona, Bellambi, Bulli
 *   coarse  25.6 km square at 12.5 m/px (2048²)                    — the coast out to the escarpment
 * Image row 0 is north; uv = (q − centre) · (1 / 2·half) + 0.5 with q in map metres.
 * The GLSL (AERIAL) returns the photo as linear colour plus a coverage weight; materials turn it into
 * an albedo with the calibration gain in uAerGain.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { fetchPNG } from './siteData';

interface Level { centre: [number, number]; half: number; files: Record<string, string> }
export interface AerialMeta {
  levels: Record<'fine' | 'mid' | 'coarse', Level>;
  sandLinear: [number, number, number];
  keep: { bld: number; trees: number };
}

type Name = 'fine' | 'mid' | 'coarse';
const SIZES: Record<Quality, Record<Name, number>> = {
  low: { fine: 0, mid: 1024, coarse: 2048 },
  medium: { fine: 2048, mid: 2048, coarse: 2048 },
  high: { fine: 4096, mid: 2048, coarse: 2048 },
};
/** The procedural dry-sand albedo (terrain.ts) the photo's dry sand is calibrated to. */
const SAND_ALB = new THREE.Vector3(0.47, 0.39, 0.255);

export const AERIAL = /* glsl */ `
uniform sampler2D tAerF; uniform sampler2D tAerM; uniform sampler2D tAerC;
uniform vec4 uAerF; uniform vec4 uAerM; uniform vec4 uAerC; // centre x, z (map m), 1 / (2·half), on
uniform vec3 uAerGain;
float aerEdge(vec2 uv) { vec2 d = abs(uv - 0.5); return smoothstep(0.5, 0.47, max(d.x, d.y)); }
/** The photo at map point q: rgb linear (not yet calibrated), a = coverage 0..1. Finest level first. */
vec4 aerialPhoto(vec2 q) {
  vec4 acc = vec4(0.0);
  if (uAerF.w > 0.5) {
    vec2 uv = (q - uAerF.xy) * uAerF.z + 0.5;
    float w = aerEdge(uv);
    if (w > 0.0) { acc = vec4(texture2D(tAerF, uv).rgb * w, w); if (w >= 1.0) return acc; }
  }
  if (uAerM.w > 0.5) {
    vec2 uv = (q - uAerM.xy) * uAerM.z + 0.5;
    float w = aerEdge(uv) * (1.0 - acc.a);
    if (w > 0.0) { acc += vec4(texture2D(tAerM, uv).rgb * w, w); if (acc.a >= 0.999) return acc; }
  }
  if (uAerC.w > 0.5) {
    vec2 uv = (q - uAerC.xy) * uAerC.z + 0.5;
    float w = aerEdge(uv) * (1.0 - acc.a);
    if (w > 0.0) acc += vec4(texture2D(tAerC, uv).rgb * w, w);
  }
  return acc;
}
`;

/** Fragment-only (uses a mip bias). */
export const AERIAL_SOFT = /* glsl */ `
/** Blurred photo (a few metres) for tinting close-range procedural detail: a coarse mip of the finest level. */
vec4 aerialPhotoSoft(vec2 q) {
  if (uAerF.w > 0.5) {
    vec2 uv = (q - uAerF.xy) * uAerF.z + 0.5;
    float w = aerEdge(uv);
    if (w >= 1.0) return vec4(texture2D(tAerF, uv, 1.5).rgb, 1.0);
  }
  return aerialPhoto(q);
}
`;

export type AerialUniforms = Record<'tAerF' | 'tAerM' | 'tAerC', { value: THREE.Texture | null }> &
  Record<'uAerF' | 'uAerM' | 'uAerC', { value: THREE.Vector4 }> & { uAerGain: { value: THREE.Vector3 } };

export interface AerialData {
  meta: AerialMeta;
  /** one byte per building / plant in features.bin: 0 = the photo contradicts it (a generated house on lawn, a plant on sand) */
  keepBld: Uint8Array; keepTrees: Uint8Array;
  /** photo vegetation 0..255 on the land-cover grid (siteData G.cover), row 0 north */
  veg: Uint8Array; vegN: number;
}

/** Loads the metadata, the keep-mask and the photo-vegetation grid (small; the photo levels stream in later). */
export async function loadAerialMeta(assetUrl: (p: string) => string): Promise<AerialData | null> {
  try {
    const [meta, keep, veg] = await Promise.all([
      fetch(assetUrl('aerial.json')).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<AerialMeta>; }),
      fetch(assetUrl('aerial_keep.bin')).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }),
      fetchPNG(assetUrl('aerial_veg.png')),
    ]);
    if (veg.w !== veg.h) throw new Error('aerial_veg.png is not square');
    const v = new Uint8Array(veg.w * veg.h);
    for (let k = 0; k < v.length; k++) v[k] = veg.data[k * veg.bpp];
    const k = new Uint8Array(keep);
    return { meta, keepBld: k.subarray(0, meta.keep.bld), keepTrees: k.subarray(meta.keep.bld, meta.keep.bld + meta.keep.trees), veg: v, vegN: veg.w };
  } catch (err) {
    console.warn('[human] aerial imagery unavailable; the ground stays procedural', err);
    return null;
  }
}

export class Aerial {
  readonly uniforms: AerialUniforms;
  private tex: Partial<Record<Name, { size: number; t: THREE.Texture }>> = {};
  private loading: Partial<Record<Name, number>> = {};
  private loader = new THREE.TextureLoader();
  private disposed = false;
  private tier: Quality = 'high';

  constructor(private meta: AerialMeta | null, private assetUrl: (p: string) => string, private renderer: THREE.WebGLRenderer | null) {
    const g = new THREE.Vector3(1, 1, 1);
    if (meta) {
      // per-channel gain: the photo's dry beach sand → the procedural sand albedo. This sets the exposure
      // and also warms the hazy, slightly cool aerial survey to the scene's morning light
      const s = meta.sandLinear;
      g.set(SAND_ALB.x / Math.max(s[0], 1e-3), SAND_ALB.y / Math.max(s[1], 1e-3), SAND_ALB.z / Math.max(s[2], 1e-3));
    }
    const lv = (n: Name) => {
      const L = meta?.levels[n];
      return { value: L ? new THREE.Vector4(L.centre[0], L.centre[1], 1 / (2 * L.half), 0) : new THREE.Vector4(0, 0, 1, 0) };
    };
    this.uniforms = { tAerF: { value: null }, tAerM: { value: null }, tAerC: { value: null }, uAerF: lv('fine'), uAerM: lv('mid'), uAerC: lv('coarse'), uAerGain: { value: g } };
  }

  /** Load (or swap to) the levels this tier uses; old textures stay bound until their replacements are ready. */
  setTier(q: Quality) {
    this.tier = q;
    if (!this.meta) return;
    for (const n of ['coarse', 'mid', 'fine'] as Name[]) {
      const want = SIZES[q][n];
      const have = this.tex[n];
      if (!want) { if (have) { this.bind(n, null); have.t.dispose(); delete this.tex[n]; } continue; }
      if (have?.size === want || this.loading[n] === want) continue;
      const file = this.meta.levels[n].files[String(want)];
      if (!file) continue;
      this.loading[n] = want;
      this.loader.loadAsync(this.assetUrl(file)).then((t) => {
        if (this.loading[n] === want) delete this.loading[n];
        if (this.disposed || SIZES[this.tier][n] !== want) { t.dispose(); return; }
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false; // row 0 = north = v 0
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 1;
        t.needsUpdate = true;
        const old = this.tex[n];
        this.tex[n] = { size: want, t };
        this.bind(n, t);
        old?.t.dispose();
      }).catch((err) => { if (this.loading[n] === want) delete this.loading[n]; console.warn('[human] aerial level failed to load', n, err); });
    }
  }

  private bind(n: Name, t: THREE.Texture | null) {
    const key = n === 'fine' ? 'F' : n === 'mid' ? 'M' : 'C';
    this.uniforms[`tAer${key}` as 'tAerF'].value = t;
    this.uniforms[`uAer${key}` as 'uAerF'].value.w = t ? 1 : 0;
  }

  dispose() {
    this.disposed = true;
    for (const n of Object.keys(this.tex) as Name[]) { this.tex[n]!.t.dispose(); this.bind(n, null); }
    this.tex = {};
  }
}
