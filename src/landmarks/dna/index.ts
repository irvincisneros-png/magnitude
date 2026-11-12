/**
 * Landmark "dna": the B-DNA double helix, 2 nm wide (1 local unit = 2 nm).
 *
 * Real atom coordinates from PDB 1BNA are tiled along a long, gently curving axis that leaves the
 * origin along +X. A backbone carbon (C4' of residue A6) sits exactly on the origin, where the carbon
 * atom landmark appears. Atoms are space-filling impostor spheres with a waxy subsurface look and
 * baked ambient occlusion. Zoomed in, they relax into soft translucent glows; zoomed out, the helix
 * becomes a thin striped fibre (tube LOD) that continues, fading, in both directions.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Curve } from './curve';
import {
  atomVert, backFrag, backVert, ghostFrag, moteFrag, moteVert, solidFrag, tubeFrag, tubeVert,
} from './shaders';
import { A_PER_UNIT, BLOCK_BP, BLOCK_RISE_A, BLOCK_TWIST, bakeOcclusion, buildUnit, parsePdb, type UAtom } from './structure';

const PITCH = 1.7; // units per full turn (3.4 nm)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const meta: LandmarkMeta = {
  id: 'dna',
  name: 'DNA double helix',
  sizeMeters: 2e-9,
  range: [-9.6, -6.5],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'DNA is two long chains twisted into a spiral staircase just 2 nanometres wide. Each chain has a backbone of sugar and phosphate, and the steps are pairs of bases (A with T, G with C) whose order is the code that builds you.',
  howWeKnow: {
    instrument: 'X-ray crystallography',
    text:
      "In 1952 Rosalind Franklin's Photo 51 shot X-rays through DNA fibres and left a cross-shaped pattern that showed a helix. Later, DNA was crystallised and its X-ray pattern solved atom by atom. This scene uses the real coordinates of one such crystal (PDB entry 1BNA, 12 base pairs), repeated end to end. Thermal wobble and the surrounding water are drawn for effect.",
  },
  lightTime: 'About 7 × 10⁻¹⁸ seconds to cross the helix',
  timescale: 'Atoms vibrate in about 10⁻¹³ to 10⁻¹² s; one turn of the helix can twist and flex in nanoseconds',
  post: { bloom: 0.45, exposure: 1.1 },
  labels: [
    { text: 'Sugar–phosphate backbone', position: [0, 0, 0], zoomRange: [-0.85, 1.0] },
    { text: 'Base pair (A–T, G–C)', position: [0, 0, 0], zoomRange: [-0.3, 1.2] },
    { text: 'Major groove', position: [0, 0, 0], zoomRange: [-0.2, 1.2] },
    { text: 'Minor groove', position: [0, 0, 0], zoomRange: [-0.2, 1.2] },
    { text: '2 nanometres wide', position: [0, 0, 0], zoomRange: [0.2, 1.6] },
    { text: 'One turn = 10.5 base pairs', position: [0, 0, 0], zoomRange: [0.3, 1.7] },
  ],
};

const BLOCKS: Record<Quality, number> = { low: 24, medium: 48, high: 80 };
const MOTES: Record<Quality, number> = { low: 2500, medium: 6000, high: 10000 };
const MAX_BLOCKS = BLOCKS.high;
const BLOCK_UNITS = BLOCK_RISE_A / A_PER_UNIT;
const FIBRE_HALF = 1100;
const HAZE = new THREE.Color(0.02, 0.01, 0.036);

const hsv = (c: THREE.Color, f: [number, number, number]) => c.clone().multiply(new THREE.Color(f[0], f[1], f[2]));
const BASE_COL: Record<string, THREE.Color> = {
  A: new THREE.Color(0.12, 0.72, 0.74), // teal
  T: new THREE.Color(0.26, 0.46, 0.96), // blue
  G: new THREE.Color(0.58, 0.34, 0.96), // violet
  C: new THREE.Color(0.93, 0.42, 0.78), // orchid
};
function atomColour(a: UAtom): THREE.Color {
  if (a.bb) {
    if (a.el === 'P') return new THREE.Color(1.0, 0.7, 0.14);
    if (a.phos) return new THREE.Color(0.96, 0.46, 0.16);
    return a.el === 'O' ? new THREE.Color(0.96, 0.32, 0.26) : new THREE.Color(0.86, 0.46, 0.24);
  }
  const b = BASE_COL[a.res];
  if (a.el === 'N') return hsv(b, [0.82, 0.9, 1.15]);
  if (a.el === 'O') return hsv(b, [1.25, 0.85, 0.85]);
  return b.clone().lerp(new THREE.Color(1, 1, 1), 0.1);
}

const additive = {
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
} as const;

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  let renderer: THREE.WebGLRenderer | null = null;
  let quality: Quality = 'high';
  const buf = new THREE.Vector2(1, 1);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T) => { disposables.push(o); return o; };

  const uTime = { value: 0 };
  const uD = { value: 1 };
  const uHaze = { value: HAZE };
  const uArcEnd = { value: 10 };

  // ---- atoms
  const quad = track(new THREE.PlaneGeometry(2, 2));
  const atomGeo = track(new THREE.InstancedBufferGeometry());
  atomGeo.index = quad.index;
  atomGeo.setAttribute('position', quad.getAttribute('position'));
  atomGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const atomUniforms = {
    uTime, uD, uHaze, uArcEnd,
    uTwist: { value: 0.045 }, uWave: { value: 0.03 }, uJig: { value: 0.006 },
    uRad: { value: 1 }, uOrigin: { value: 1 }, uGhost: { value: 0 }, uSolidA: { value: 1 },
  };
  const solidMat = track(new THREE.ShaderMaterial({
    vertexShader: atomVert, fragmentShader: solidFrag,
    uniforms: { ...atomUniforms, uGhostK: { value: 1 } },
    transparent: true, depthWrite: true, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const ghostMat = track(new THREE.ShaderMaterial({
    vertexShader: atomVert, fragmentShader: ghostFrag,
    uniforms: { ...atomUniforms, uGhostK: { value: 2.6 }, uInten: { value: 0.16 } },
    ...additive,
  }));
  const solid = new THREE.Mesh(atomGeo, solidMat);
  const ghost = new THREE.Mesh(atomGeo, ghostMat);
  for (const m of [solid, ghost]) m.frustumCulled = false;
  solid.renderOrder = 1; ghost.renderOrder = 5;
  group.add(solid, ghost);

  // ---- fibre LOD
  const tubeUniforms = {
    uD, uHaze, uPxScale: { value: 800 }, uAlpha: { value: 0 }, uHalf: { value: FIBRE_HALF },
    uPhA: { value: 0 }, uPhB: { value: 2.4 }, uBright: { value: 1.2 },
  };
  const tubeMat = track(new THREE.ShaderMaterial({
    vertexShader: tubeVert, fragmentShader: tubeFrag, uniforms: tubeUniforms,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const tubeGeo = track(new THREE.BufferGeometry());
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.frustumCulled = false; tube.renderOrder = 3;
  group.add(tube);

  // ---- motes
  const moteGeo = track(new THREE.BufferGeometry());
  const seeds = new Float32Array(MOTES.high * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES.high * 3), 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const moteUniforms = { uTime, uBox: { value: 2 }, uDpr: { value: 1 }, uInten: { value: 0.5 } };
  const moteMat = track(new THREE.ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, uniforms: moteUniforms, ...additive }));
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false; motes.renderOrder = 6;
  group.add(motes);

  // ---- backdrop
  const backMat = track(new THREE.ShaderMaterial({
    vertexShader: backVert, fragmentShader: backFrag,
    uniforms: { uViewport: { value: buf }, uAlpha: { value: 1 }, uTime },
    transparent: false, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const back = new THREE.Mesh(quad, backMat);
  back.frustumCulled = false; back.renderOrder = -10;
  group.add(back);

  let instances = 0;
  let unitCount = 0;

  const applyQuality = (q: Quality) => {
    quality = q;
    atomGeo.instanceCount = BLOCKS[q] * unitCount;
    moteGeo.setDrawRange(0, MOTES[q]);
    uArcEnd.value = Math.max(6, (BLOCKS[q] / 2) * BLOCK_UNITS * 0.97);
    instances = atomGeo.instanceCount;
  };

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      const text = await (await fetch(ctx.assetUrl('1BNA.pdb'))).text();
      const unit = buildUnit(parsePdb(text));
      const { ao, dir } = bakeOcclusion(unit);
      const A = unit.atoms;
      unitCount = A.length;
      const total = MAX_BLOCKS * unitCount;

      // arc-length coordinate of an atom of block k
      const zOrigin = A[unit.origin].z / A_PER_UNIT;
      const sOf = (a: UAtom, k: number) => (a.z + k * BLOCK_RISE_A) / A_PER_UNIT - zOrigin;
      const curve = new Curve(Math.max(FIBRE_HALF, 1) + 5);
      // put the origin atom exactly on the origin
      const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
      curve.at(0, P, T, N, B);
      const o = A[unit.origin];
      const so = new THREE.Vector3().copy(P).addScaledVector(N, o.x / A_PER_UNIT).addScaledVector(B, o.y / A_PER_UNIT);
      curve.shift(-so.x, -so.y, -so.z);

      // block order: 0, -1, 1, -2, 2 ... so lower tiers simply draw a prefix
      const order: number[] = [];
      for (let i = 0; i < MAX_BLOCKS; i++) order.push(i === 0 ? 0 : i % 2 === 1 ? -(i + 1) / 2 : i / 2);
      const aC = new Float32Array(total * 3), aN = new Float32Array(total * 3), aB = new Float32Array(total * 3);
      const aLoc = new Float32Array(total * 3), aInfo = new Float32Array(total * 4);
      const aCol = new Float32Array(total * 3), aOcc = new Float32Array(total * 3);
      const cols = A.map(atomColour);
      let w = 0;
      const phA: number[] = [], phB: number[] = [];
      let nearP: { d: number; pos: THREE.Vector3; s: number } = { d: 1e9, pos: new THREE.Vector3(), s: 0 };
      const worldAt = (a: UAtom, k: number, out: THREE.Vector3) => {
        const s = sOf(a, k);
        curve.at(s, P, T, N, B);
        const c = Math.cos(k * BLOCK_TWIST), sn = Math.sin(k * BLOCK_TWIST);
        const x = (c * a.x - sn * a.y) / A_PER_UNIT, y = (sn * a.x + c * a.y) / A_PER_UNIT;
        return out.copy(P).addScaledVector(N, x).addScaledVector(B, y);
      };
      const tmp = new THREE.Vector3();
      for (const k of order) {
        const c = Math.cos(k * BLOCK_TWIST), sn = Math.sin(k * BLOCK_TWIST);
        for (let i = 0; i < A.length; i++) {
          const a = A[i];
          const s = sOf(a, k);
          curve.at(s, P, T, N, B);
          const x = (c * a.x - sn * a.y) / A_PER_UNIT, y = (sn * a.x + c * a.y) / A_PER_UNIT;
          aC.set([P.x, P.y, P.z], w * 3); aN.set([N.x, N.y, N.z], w * 3); aB.set([B.x, B.y, B.z], w * 3);
          aLoc.set([x, y, s], w * 3);
          aInfo.set([a.r / A_PER_UNIT, ao[i], Math.random(), i === unit.origin && k === 0 ? 1 : 0], w * 4);
          aCol.set([cols[i].r, cols[i].g, cols[i].b], w * 3);
          const ox = dir[i * 3] * c - dir[i * 3 + 1] * sn, oy = dir[i * 3] * sn + dir[i * 3 + 1] * c;
          aOcc.set([ox, oy, dir[i * 3 + 2]], w * 3);
          w++;
          if (a.name === 'P' && a.res !== '-' && Math.abs(s) < 14) {
            const th = Math.atan2(y, x) - (2 * Math.PI * s) / PITCH;
            (a.chain === 'A' ? phA : phB).push(th);
            if (a.chain === 'A') {
              worldAt(a, k, tmp);
              if (tmp.length() < nearP.d) nearP = { d: tmp.length(), pos: tmp.clone(), s };
            }
          }
        }
      }
      const circ = (v: number[]) => Math.atan2(v.reduce((s, t) => s + Math.sin(t), 0), v.reduce((s, t) => s + Math.cos(t), 0));
      const phiA = circ(phA), phiB = circ(phB);
      tubeUniforms.uPhA.value = phiA; tubeUniforms.uPhB.value = phiB;

      const iab = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n);
      atomGeo.setAttribute('aC', iab(aC, 3)); atomGeo.setAttribute('aN', iab(aN, 3)); atomGeo.setAttribute('aB', iab(aB, 3));
      atomGeo.setAttribute('aLoc', iab(aLoc, 3)); atomGeo.setAttribute('aInfo', iab(aInfo, 4));
      atomGeo.setAttribute('aCol', iab(aCol, 3)); atomGeo.setAttribute('aOcc', iab(aOcc, 3));

      // ---- fibre tube from the same curve
      const SEG = 12;
      const STEP = 0.4;
      const rings = Math.floor((FIBRE_HALF * 2) / STEP);
      const pos = new Float32Array((rings + 1) * (SEG + 1) * 3), tp = new Float32Array((rings + 1) * (SEG + 1) * 3);
      const tn = new Float32Array(pos.length), tb = new Float32Array(pos.length), tut = new Float32Array((rings + 1) * (SEG + 1) * 2);
      const idx: number[] = [];
      let v = 0;
      for (let r = 0; r <= rings; r++) {
        const s = -FIBRE_HALF + r * STEP;
        curve.at(s, P, T, N, B);
        for (let j = 0; j <= SEG; j++, v++) {
          tp.set([P.x, P.y, P.z], v * 3); tn.set([N.x, N.y, N.z], v * 3); tb.set([B.x, B.y, B.z], v * 3);
          tut.set([s, (j / SEG) * Math.PI * 2], v * 2);
          if (r < rings && j < SEG) {
            const a = r * (SEG + 1) + j, b = a + SEG + 1;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
      }
      tubeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      tubeGeo.setAttribute('aP', new THREE.BufferAttribute(tp, 3));
      tubeGeo.setAttribute('aN', new THREE.BufferAttribute(tn, 3));
      tubeGeo.setAttribute('aB', new THREE.BufferAttribute(tb, 3));
      tubeGeo.setAttribute('aUT', new THREE.BufferAttribute(tut, 2));
      tubeGeo.setIndex(idx);
      tubeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

      // ---- labels, anchored on the helix near the origin
      const L = meta.labels!;
      const at = (s: number, ang: number, rad: number): [number, number, number] => {
        curve.at(s, P, T, N, B);
        const v3 = P.clone().addScaledVector(N, Math.cos(ang) * rad).addScaledVector(B, Math.sin(ang) * rad);
        return [v3.x, v3.y, v3.z];
      };
      const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
      const thA = (s: number) => phiA + (2 * Math.PI * s) / PITCH;
      const delta = wrap(phiB - phiA);
      const minorOff = Math.abs(delta) < Math.PI ? delta / 2 : delta / 2 + Math.PI;
      const majorOff = minorOff + Math.PI;
      const sBack = nearP.s;
      L[0].position = [nearP.pos.x * 1.0, nearP.pos.y * 1.0, nearP.pos.z * 1.0];
      L[1].position = at(0.45, 0, 0);
      L[2].position = at(-0.75, thA(-0.75) + majorOff, 0.52);
      L[3].position = at(0.95, thA(0.95) + minorOff, 0.52);
      curve.at(-2.3, P, T, N, B);
      L[4].position = at(-2.3, thA(-2.3) + minorOff + Math.PI * 0.5, 0.55);
      L[5].position = at(2.4, thA(2.4) + majorOff, 0.55);
      void sBack;

      applyQuality(ctx.quality);
      ctx.renderer.compile(scene, new THREE.PerspectiveCamera());
    },
    update(frame: FrameState) {
      const { zoom, camera } = frame;
      uTime.value = frame.time;
      const d = camera.position.length();
      uD.value = d;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (frame.quality !== quality) applyQuality(frame.quality);
      tubeUniforms.uPxScale.value = (buf.y || 800) / (2 * Math.tan((camera.fov * Math.PI) / 360));

      // zoom-in: solid atoms relax into soft glows; the origin atom hands over to the atom scene
      const ghostAmt = 1 - smooth(-0.55, -0.12, zoom);
      atomUniforms.uGhost.value = ghostAmt;
      ghost.visible = ghostAmt > 0.003;
      solid.visible = ghostAmt < 0.997;
      atomUniforms.uOrigin.value = smooth(-0.1, 0.9, zoom);
      ghostMat.uniforms.uInten.value = 0.11 * (0.05 + 0.95 * smooth(-0.9, -0.25, zoom));

      // zoom-out: atoms (sub-pixel) give way to the striped fibre
      atomUniforms.uSolidA.value = 1 - smooth(1.5, 2.15, zoom);
      if (atomUniforms.uSolidA.value < 0.003) solid.visible = false;
      tubeUniforms.uAlpha.value = smooth(1.35, 2.0, zoom);
      tube.visible = tubeUniforms.uAlpha.value > 0.003;
      tubeUniforms.uBright.value = 0.8 + 0.9 * smooth(1.6, 2.4, zoom);

      // water and ion motes, scaled to the view
      moteUniforms.uBox.value = Math.max(0.9, Math.min(60, 2.6 * d));
      moteUniforms.uDpr.value = dpr;
      moteUniforms.uInten.value = 0.55 * (1 - smooth(1.0, 2.0, zoom));
      motes.visible = moteUniforms.uInten.value > 0.004;

      // the nucleoplasm backdrop yields to the cell behind us as we zoom out
      backMat.uniforms.uAlpha.value = 1 - smooth(1.3, 2.2, zoom);
      back.visible = backMat.uniforms.uAlpha.value > 0.003;
    },
    setQuality(q: Quality) { applyQuality(q); },
    dispose() {
      for (const o of disposables) o.dispose();
      renderer = null;
      void instances;
    },
  };
};

export default factory;
void BLOCK_BP;
