#!/usr/bin/env node
/**
 * Offline bake of the "human" landmark figure (Figure2) from the CC0 MakeHuman base mesh.
 *
 *   node tools/build-figure.mjs <makehuman-src-dir> [--dbg]
 *
 * <makehuman-src-dir> holds the raw files downloaded from github.com/makehumancommunity/makehuman
 * (see src/landmarks/human/figure2/CREDITS.md): base.obj, default.mhskel, default_weights.mhw and
 * targets/*.target (macro-detail targets). Nothing from that directory is executed; it is parsed as data.
 *
 * Pipeline: parse → macro targets (an ordinary young adult) → skeleton from joint vertex groups →
 * pose (FK + IK, dual-quaternion skinning) → clothing built from the posed body surface (drape
 * relaxation, hem flare, folds, opening thickness) + authored straw hat, sunglasses, short hair
 * shell (+ three fur layers on the high tier, and a per-vertex hairline distance so the shaders paint
 * a soft hairline onto the skin) → hidden-surface removal under clothes → Catmull–Clark (high tier) →
 * ray-traced per-vertex AO + thickness (relaxed over the mesh) → frame: anchor on the back of the right hand at the origin, +Y up, 1 unit = 1.7 m
 * → quantised binary + JSON manifest in public/assets/human/figure/.
 *
 * Pose: relaxed, weight on the left leg, left arm hanging, right hand resting flat on top of the
 * hat crown (holding it on in the breeze) so the back of the hand faces straight up (+Y).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2];
const DBG = process.argv.includes('--dbg');
if (!SRC) { console.error('usage: node tools/build-figure.mjs <makehuman-src-dir>'); process.exit(1); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/human/figure');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

// ============================================================== small vector / quaternion maths
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rad = (d) => (d * Math.PI) / 180;
const get3 = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
const set3 = (A, i, v) => { A[i * 3] = v[0]; A[i * 3 + 1] = v[1]; A[i * 3 + 2] = v[2]; };

const qId = () => [0, 0, 0, 1];
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qAA = (axis, ang) => { const a = norm(axis), s = Math.sin(ang / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; };
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / l); };
function qFromTo(a, b) {
  a = norm(a); b = norm(b);
  const d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); return qAA(ax, Math.PI); }
  const c = cross(a, b);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
/** Signed angle from a to b about axis (all roughly perpendicular to axis). */
function angleAbout(a, b, axis) {
  axis = norm(axis);
  const pa = norm(sub(a, mul(axis, dot(a, axis)))), pb = norm(sub(b, mul(axis, dot(b, axis))));
  return Math.atan2(dot(cross(pa, pb), axis), dot(pa, pb));
}

// ============================================================== parse MakeHuman data
function parseObj(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const V = []; const faces = []; const fgroup = []; const groups = []; let g = -1;
  for (const l of lines) {
    if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); V.push(+p[1], +p[2], +p[3]); }
    else if (l.startsWith('g ')) { groups.push(l.slice(2).trim()); g = groups.length - 1; }
    else if (l.startsWith('f ')) { faces.push(l.slice(2).trim().split(/\s+/).map((s) => parseInt(s, 10) - 1)); fgroup.push(g); }
  }
  return { V: Float64Array.from(V), faces, fgroup, groups };
}
function applyTarget(V, file, w) {
  if (!w) return;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const p = l.trim().split(/\s+/);
    if (p.length < 4) continue;
    const i = +p[0];
    V[i * 3] += w * +p[1]; V[i * 3 + 1] += w * +p[2]; V[i * 3 + 2] += w * +p[3];
  }
}

log('parse', SRC);
const obj = parseObj(path.join(SRC, 'base.obj'));
const NV = obj.V.length / 3;
const V0 = obj.V; // working rest positions (MakeHuman decimetres; +Y up, faces +Z, their right = −X)

// Macro: an ordinary young adult, leaning male (gender 0.62), mixed ancestry, weight slightly above
// average (MakeHuman weight 0.58), average muscle. Same weighting MakeHuman's macro modifier uses.
const GENDER = 0.85, WEIGHT = 0.66;
const RACE = { caucasian: 0.4, african: 0.25, asian: 0.35 };
for (const [r, rw] of Object.entries(RACE)) {
  applyTarget(V0, path.join(SRC, 'targets', `${r}-male-young.target`), rw * GENDER);
  applyTarget(V0, path.join(SRC, 'targets', `${r}-female-young.target`), rw * (1 - GENDER));
}
const wmax = (WEIGHT - 0.5) / 0.5;
applyTarget(V0, path.join(SRC, 'targets', 'universal-male-young-averagemuscle-maxweight.target'), wmax * GENDER);
applyTarget(V0, path.join(SRC, 'targets', 'universal-female-young-averagemuscle-maxweight.target'), wmax * (1 - GENDER));
// decimetres → metres
for (let i = 0; i < V0.length; i++) V0[i] *= 0.1;

// keep: body + eyeballs. Drop: joint cubes, tongue, teeth, eyelashes, genital/tights/skirt/hair helpers.
const KEEP = new Set(['body', 'helper-r-eye', 'helper-l-eye']);
const bodyFaces = [], eyeFaces = [];
obj.faces.forEach((f, i) => {
  const g = obj.groups[obj.fgroup[i]];
  if (g === 'body') bodyFaces.push(f);
  else if (KEEP.has(g)) eyeFaces.push(f);
});
log('faces body', bodyFaces.length, 'eyes', eyeFaces.length);

// ---------------------------------------------------------------- skeleton
const skel = JSON.parse(fs.readFileSync(path.join(SRC, 'default.mhskel'), 'utf8'));
const jointPos = {};
for (const [k, ids] of Object.entries(skel.joints)) {
  const p = [0, 0, 0];
  for (const i of ids) { p[0] += V0[i * 3]; p[1] += V0[i * 3 + 1]; p[2] += V0[i * 3 + 2]; }
  jointPos[k] = mul(p, 1 / ids.length);
}
const boneNames = Object.keys(skel.bones);
const B = {};
for (const n of boneNames) { const b = skel.bones[n]; B[n] = { name: n, parent: b.parent, h: jointPos[b.head], t: jointPos[b.tail], depth: 0 }; }
for (const n of boneNames) { let d = 0, p = B[n].parent; while (p) { d++; p = B[p].parent; } B[n].depth = d; }
const order = [...boneNames].sort((a, b) => B[a].depth - B[b].depth);
const boneIdx = Object.fromEntries(order.map((n, i) => [n, i]));

// weights → per vertex up to 4 influences
const mhw = JSON.parse(fs.readFileSync(path.join(SRC, 'default_weights.mhw'), 'utf8')).weights;
const infl = Array.from({ length: NV }, () => []);
for (const [bn, list] of Object.entries(mhw)) for (const [vi, w] of list) infl[vi].push([boneIdx[bn], w]);
for (const L of infl) { L.sort((a, b) => b[1] - a[1]); L.length = Math.min(L.length, 4); const s = L.reduce((a, x) => a + x[1], 0) || 1; for (const x of L) x[1] /= s; }
const wOf = (vi, names) => { let s = 0; for (const [b, w] of infl[vi]) if (names.has(order[b])) s += w; return s; };

// ============================================================== pose
const Q = {}; for (const n of order) Q[n] = qId(); // local rotation, about rest-frame axes at the bone head
let rootOffset = [0, 0, 0];
const W = {}; // world: x' = q (x − h) + H
function fk() {
  for (const n of order) {
    const b = B[n];
    let qp = qId(), Hp = [0, 0, 0], hp = [0, 0, 0];
    if (b.parent) { const P = W[b.parent]; qp = P.q; Hp = P.H; hp = B[b.parent].h; }
    const H = b.parent ? add(qRot(qp, sub(b.h, hp)), Hp) : add(b.h, rootOffset);
    W[n] = { q: qNorm(qMul(qp, Q[n])), H };
  }
}
const xf = (n, p) => add(qRot(W[n].q, sub(p, B[n].h)), W[n].H);
const head = (n) => W[n].H;
const tail = (n) => xf(n, B[n].t);
const dirOf = (n) => norm(sub(tail(n), head(n)));
/** Rotate bone n (and its subtree) in world space about an axis through its head. */
function rotWorld(n, axis, ang) {
  fk();
  const qp = B[n].parent ? W[B[n].parent].q : qId();
  Q[n] = qNorm(qMul(qMul(qConj(qp), qMul(qAA(axis, ang), qp)), Q[n]));
  fk();
}
function aim(n, target) {
  fk();
  const r = qFromTo(dirOf(n), target);
  const qp = B[n].parent ? W[B[n].parent].q : qId();
  Q[n] = qNorm(qMul(qMul(qConj(qp), qMul(r, qp)), Q[n]));
  fk();
}
/** Give bone n a world rotation (relative to rest). */
function setWorld(n, qw) {
  fk();
  const qp = B[n].parent ? W[B[n].parent].q : qId();
  Q[n] = qNorm(qMul(qConj(qp), qw));
  fk();
}
/** Two-bone IK: knee/elbow position for a chain from A with lengths l1, l2 to target T, bending toward pole. */
function ik2(A, T, l1, l2, pole) {
  let d = sub(T, A); let L = len(d);
  L = Math.min(L, (l1 + l2) * 0.9995);
  const dn = norm(d);
  const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const pp = norm(sub(pole, mul(dn, dot(pole, dn))));
  return add(add(A, mul(dn, a)), mul(pp, h));
}
fk();

// Rest reference measurements
const restTop = (() => { let m = -1e9; for (let i = 0; i < 13380; i++) m = Math.max(m, V0[i * 3 + 1]); return m; })();
const restSole = (() => { let m = 1e9; for (let i = 0; i < 13380; i++) m = Math.min(m, V0[i * 3 + 1]); return m; })();
log('rest height (m)', (restTop - restSole).toFixed(3));

/** Back-of-hand (dorsal) direction, found once in the rest pose from geometry: the hand's skin sits
 * mostly on the palm side of the metacarpal bones. Posed: carried by the wrist bone's rotation. */
const restDorsal = {};
for (const s of ['L', 'R']) {
  const wr = B[`wrist.${s}`].h, k2 = B[`finger2-1.${s}`].h, k5 = B[`finger5-1.${s}`].h, k3 = B[`finger3-1.${s}`].h;
  const fingers = norm(sub(lerp3(k2, k5, 0.4), wr));
  let dorsal = norm(cross(norm(sub(k2, k5)), fingers));
  const c = lerp3(wr, k3, 0.55);
  const mc = new Set([`metacarpal1.${s}`, `metacarpal2.${s}`, `metacarpal3.${s}`, `metacarpal4.${s}`]);
  let acc = 0;
  for (let i = 0; i < 13380; i++) if (wOf(i, mc) > 0.6) acc += dot(sub(get3(V0, i), c), dorsal);
  if (acc > 0) dorsal = mul(dorsal, -1);
  restDorsal[s] = dorsal;
}
function handFrame(s) {
  const wr = head(`wrist.${s}`);
  const k2 = head(`finger2-1.${s}`), k5 = head(`finger5-1.${s}`), k3 = head(`finger3-1.${s}`);
  const fingers = norm(sub(lerp3(k2, k5, 0.4), wr));
  const across = norm(sub(k2, k5)); // pinky → index
  let dorsal = qRot(W[`wrist.${s}`].q, restDorsal[s]);
  dorsal = norm(sub(dorsal, mul(fingers, dot(dorsal, fingers))));
  return { wr, fingers, across, dorsal, k3 };
}
let posedCache = null;

// --- whole-body: weight on the left leg (+X side)
const UP = [0, 1, 0], FWD = [0, 0, 1], LAT = [1, 0, 0];
rotWorld('root', FWD, rad(2.6)); // left hip up
rootOffset = [0.022, 0, 0];
rotWorld('spine04', FWD, rad(-1.6));
rotWorld('spine02', FWD, rad(-2.2));
rotWorld('spine02', LAT, rad(-1.5)); // chest a touch back: relaxed, not slumped

// --- legs (two-bone IK, feet flat)
const legLen = (s) => ({
  l1: len(sub(B[`lowerleg01.${s}`].h, B[`upperleg01.${s}`].h)),
  l2: len(sub(B[`foot.${s}`].h, B[`lowerleg01.${s}`].h)),
});
const ankleRest = { L: B['foot.L'].h, R: B['foot.R'].h };
const ankleTarget = {
  L: add(ankleRest.L, [-0.005, 0, -0.01]),
  R: add(ankleRest.R, [-0.035, 0, 0.085]), // relaxed leg a little forward and out
};
// lower the hips until the supporting leg is just short of straight
{
  const { l1, l2 } = legLen('L');
  let drop = 0;
  for (let it = 0; it < 60; it++) {
    rootOffset[1] = -drop; fk();
    if (len(sub(ankleTarget.L, head('upperleg01.L'))) < (l1 + l2) * 0.996) break;
    drop += 0.001;
  }
  log('hip drop (m)', drop.toFixed(3));
}
function poseLeg(s, toeOut, pole) {
  fk();
  const { l1, l2 } = legLen(s);
  const A = head(`upperleg01.${s}`);
  const K = ik2(A, ankleTarget[s], l1, l2, pole);
  aim(`upperleg01.${s}`, sub(K, A));
  aim(`upperleg02.${s}`, sub(K, head(`upperleg02.${s}`)));
  aim(`lowerleg01.${s}`, sub(ankleTarget[s], head(`lowerleg01.${s}`)));
  aim(`lowerleg02.${s}`, sub(ankleTarget[s], head(`lowerleg02.${s}`)));
  // the shin carries the knee's twist; the foot gets an absolute world rotation (flat, toes out)
  setWorld(`foot.${s}`, qAA(UP, toeOut));
}
poseLeg('L', rad(7), [0.05, 0, 1]);
poseLeg('R', rad(-13), [-0.15, 0, 1]);
// relaxed foot: the toes stay flat, the heel carries a little less weight (no lift; contact stays clean)

// --- left arm hanging at the side, slight elbow bend, palm towards the thigh
function hangArm(s, sign) {
  const ua = norm([0.11 * sign, -1, -0.02]);
  aim(`upperarm01.${s}`, ua);
  aim(`upperarm02.${s}`, ua);
  // twist the upper arm so the elbow hinges forwards
  fk();
  const fa = dirOf(`lowerarm01.${s}`);
  const tw = angleAbout(fa, [0.15 * sign, 0, 1], ua);
  rotWorld(`upperarm01.${s}`, ua, tw);
  const fwd = norm(sub([0.18 * sign, 0, 1], mul(ua, dot([0.18 * sign, 0, 1], ua))));
  const fdir = norm(add(mul(ua, Math.cos(rad(17))), mul(fwd, Math.sin(rad(17)))));
  aim(`lowerarm01.${s}`, fdir);
  aim(`lowerarm02.${s}`, fdir);
  // pronation: back of the hand faces outwards and a little forwards
  const want = norm([1.0 * sign, 0, 0.32]);
  const hf = handFrame(s);
  const ang = angleAbout(hf.dorsal, want, fdir);
  rotWorld(`lowerarm01.${s}`, fdir, ang * 0.45);
  rotWorld(`lowerarm02.${s}`, fdir, ang * 0.55);
  // wrist: slight flexion towards the palm, slight ulnar drift
  const hf2 = handFrame(s);
  rotWorld(`wrist.${s}`, cross(hf2.fingers, mul(hf2.dorsal, -1)), rad(3));
}
hangArm('L', 1);

/** Curl the fingers of one hand. curl[i][j]: degrees for finger i (2..5) joint j (1..3). */
function curlFingers(s, curl, thumb) {
  for (let f = 2; f <= 5; f++) {
    for (let j = 1; j <= 3; j++) {
      const n = `finger${f}-${j}.${s}`;
      const hf = handFrame(s);
      const d = dirOf(n);
      const axis = cross(d, mul(hf.dorsal, -1));
      rotWorld(n, axis, rad(curl[f - 2][j - 1]));
    }
  }
  for (let j = 1; j <= 3; j++) {
    const n = `finger1-${j}.${s}`;
    const hf = handFrame(s);
    const d = dirOf(n);
    rotWorld(n, cross(d, mul(hf.dorsal, -1)), rad(thumb[j - 1]));
  }
}
curlFingers('L', [[8, 18, 10], [12, 22, 12], [16, 25, 14], [20, 28, 16]], [2, 8, 10]);

// --- neck and head: looking out to sea, turned a little to their right, eyes on the horizon
for (const [n, a] of [['neck01', -3], ['neck02', -3], ['neck03', -3], ['head', -5]]) rotWorld(n, UP, rad(a));
rotWorld('head', LAT, rad(2.5)); // slight chin down
rotWorld('head', FWD, rad(1.5));

// The right arm is posed after the hat exists (it rests on the crown): see poseRightArm().
fk();

// ============================================================== skinning (dual quaternion)
function skinAll() {
  const out = new Float64Array(NV * 3);
  const dq = order.map((n) => {
    const { q, H } = W[n];
    const T = sub(H, qRot(q, B[n].h)); // x' = q x + T
    const d = qMul([T[0], T[1], T[2], 0], q).map((v) => v * 0.5);
    return { q, d };
  });
  for (let i = 0; i < NV; i++) {
    const L = infl[i];
    if (!L.length) { out[i * 3] = V0[i * 3]; out[i * 3 + 1] = V0[i * 3 + 1]; out[i * 3 + 2] = V0[i * 3 + 2]; continue; }
    const r = [0, 0, 0, 0], du = [0, 0, 0, 0];
    const q0 = dq[L[0][0]].q;
    for (const [b, w] of L) {
      const { q, d } = dq[b];
      const s = (q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]) < 0 ? -w : w;
      for (let c = 0; c < 4; c++) { r[c] += q[c] * s; du[c] += d[c] * s; }
    }
    const l = Math.hypot(r[0], r[1], r[2], r[3]);
    for (let c = 0; c < 4; c++) { r[c] /= l; du[c] /= l; }
    const t = qMul(du, qConj(r)).map((v) => v * 2);
    const p = add(qRot(r, get3(V0, i)), [t[0], t[1], t[2]]);
    set3(out, i, p);
  }
  return out;
}

// ============================================================== mesh utilities
function vertexNormals(P, faces, nv) {
  const N = new Float64Array(nv * 3);
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], c = f[(k + f.length - 1) % f.length];
      const pa = get3(P, a);
      const n = cross(sub(get3(P, b), pa), sub(get3(P, c), pa));
      N[a * 3] += n[0]; N[a * 3 + 1] += n[1]; N[a * 3 + 2] += n[2];
    }
  }
  for (let i = 0; i < nv; i++) set3(N, i, norm(get3(N, i)));
  return N;
}
/** Vertex adjacency (neighbour lists) for faces over nv vertices. */
function adjacency(faces, nv) {
  const A = Array.from({ length: nv }, () => new Set());
  for (const f of faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; A[a].add(b); A[b].add(a); }
  return A.map((s) => [...s]);
}
function boundaryEdges(faces) {
  const m = new Map();
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length];
    const key = a < b ? a * 1e6 + b : b * 1e6 + a;
    const e = m.get(key); if (e) e.n++; else m.set(key, { a, b, n: 1 });
  }
  return [...m.values()].filter((e) => e.n === 1).map((e) => [e.a, e.b]);
}
/** Compact a face set: returns new positions + remapped faces + map old→new. */
function compact(P, faces) {
  const map = new Map(); const pos = [];
  const nf = faces.map((f) => f.map((v) => { let j = map.get(v); if (j === undefined) { j = pos.length / 3; map.set(v, j); pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } return j; }));
  return { P: Float64Array.from(pos), faces: nf, map };
}

/**
 * Catmull–Clark subdivision (one level) with boundaries. Faces carry an id that their children keep;
 * per-vertex scalar channels (Float64Array nv×k) are interpolated linearly.
 */
function catmullClark(P, faces, fids, chans = []) {
  const nv = P.length / 3;
  const edges = new Map(); // key → {a, b, faces: [], idx}
  const ekey = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], key = ekey(a, b);
      let e = edges.get(key); if (!e) { e = { a, b, faces: [] }; edges.set(key, e); }
      e.faces.push(fi);
    }
  });
  const nf = faces.length, ne = edges.size;
  const out = new Float64Array((nv + nf + ne) * 3);
  const fp = faces.map((f) => { const c = [0, 0, 0]; for (const v of f) { c[0] += P[v * 3]; c[1] += P[v * 3 + 1]; c[2] += P[v * 3 + 2]; } return mul(c, 1 / f.length); });
  fp.forEach((c, i) => set3(out, nv + i, c));
  let ei = 0;
  const vF = Array.from({ length: nv }, () => [0, 0, 0, 0]); // face point sum, count
  const vE = Array.from({ length: nv }, () => [0, 0, 0, 0]); // edge midpoint sum, count
  const vB = Array.from({ length: nv }, () => [0, 0, 0, 0]); // boundary neighbours sum, count
  for (const e of edges.values()) {
    e.idx = nv + nf + ei++;
    const pa = get3(P, e.a), pb = get3(P, e.b), mid = mul(add(pa, pb), 0.5);
    let ep;
    if (e.faces.length === 2) ep = mul(add(add(pa, pb), add(fp[e.faces[0]], fp[e.faces[1]])), 0.25);
    else { ep = mid; for (const [v, o] of [[e.a, pb], [e.b, pa]]) { const s = vB[v]; s[0] += o[0]; s[1] += o[1]; s[2] += o[2]; s[3]++; } }
    set3(out, e.idx, ep);
    for (const v of [e.a, e.b]) { const s = vE[v]; s[0] += mid[0]; s[1] += mid[1]; s[2] += mid[2]; s[3]++; }
  }
  faces.forEach((f, fi) => { for (const v of f) { const s = vF[v]; s[0] += fp[fi][0]; s[1] += fp[fi][1]; s[2] += fp[fi][2]; s[3]++; } });
  for (let v = 0; v < nv; v++) {
    const p = get3(P, v);
    if (vB[v][3] >= 2) { // boundary
      const nb = mul([vB[v][0], vB[v][1], vB[v][2]], 1 / vB[v][3]);
      set3(out, v, add(mul(p, 0.75), mul(nb, 0.25)));
    } else if (vF[v][3] === 0) set3(out, v, p);
    else {
      const n = vF[v][3];
      const F = mul([vF[v][0], vF[v][1], vF[v][2]], 1 / n), R = mul([vE[v][0], vE[v][1], vE[v][2]], 1 / vE[v][3]);
      set3(out, v, mul(add(add(F, mul(R, 2)), mul(p, n - 3)), 1 / n));
    }
  }
  const newFaces = [], newIds = [];
  faces.forEach((f, fi) => {
    const k = f.length;
    for (let i = 0; i < k; i++) {
      const v = f[i], en = edges.get(ekey(v, f[(i + 1) % k])).idx, ep = edges.get(ekey(f[(i + k - 1) % k], v)).idx;
      newFaces.push([v, en, nv + fi, ep]); newIds.push(fids[fi]);
    }
  });
  const newChans = chans.map((C) => {
    const k = C.length / nv; const R = new Float64Array((nv + nf + ne) * k);
    R.set(C);
    faces.forEach((f, fi) => { for (let c = 0; c < k; c++) { let s = 0; for (const v of f) s += C[v * k + c]; R[(nv + fi) * k + c] = s / f.length; } });
    for (const e of edges.values()) for (let c = 0; c < k; c++) R[e.idx * k + c] = 0.5 * (C[e.a * k + c] + C[e.b * k + c]);
    return R;
  });
  return { P: out, faces: newFaces, fids: newIds, chans: newChans };
}

/** Uniform-grid spatial hash over points for nearest queries. */
function pointGrid(P, cell) {
  const g = new Map();
  const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  for (let i = 0; i < P.length / 3; i++) {
    const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
    let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(i);
  }
  return {
    near(p, r) {
      const res = [];
      const x0 = Math.floor((p[0] - r) / cell), x1 = Math.floor((p[0] + r) / cell);
      const y0 = Math.floor((p[1] - r) / cell), y1 = Math.floor((p[1] + r) / cell);
      const z0 = Math.floor((p[2] - r) / cell), z1 = Math.floor((p[2] + r) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const a = g.get(key(x, y, z)); if (a) for (const i of a) res.push(i);
      }
      return res;
    },
    nearest(p, r) {
      let best = -1, bd = r * r;
      for (const i of this.near(p, r)) {
        const dx = P[i * 3] - p[0], dy = P[i * 3 + 1] - p[1], dz = P[i * 3 + 2] - p[2];
        const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}

// ============================================================== BVH ray caster (AO, thickness)
function buildBVH(P, tris) {
  const nt = tris.length / 3;
  const cen = new Float64Array(nt * 3), bmin = new Float64Array(nt * 3), bmax = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
    const a = P[tris[t * 3] * 3 + c], b = P[tris[t * 3 + 1] * 3 + c], d = P[tris[t * 3 + 2] * 3 + c];
    bmin[t * 3 + c] = Math.min(a, b, d); bmax[t * 3 + c] = Math.max(a, b, d); cen[t * 3 + c] = (a + b + d) / 3;
  }
  const idx = new Int32Array(nt); for (let i = 0; i < nt; i++) idx[i] = i;
  const nodes = []; // {min, max, left, right, start, count}
  function build(s, e) {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = s; i < e; i++) { const t = idx[i]; for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], bmin[t * 3 + c]); mx[c] = Math.max(mx[c], bmax[t * 3 + c]); } }
    const node = { mn, mx, l: -1, r: -1, s, n: e - s };
    const id = nodes.length; nodes.push(node);
    if (e - s <= 4) return id;
    const ext = sub(mx, mn); const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : (ext[1] > ext[2] ? 1 : 2);
    const sl = Array.from(idx.subarray(s, e)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]);
    idx.set(sl, s);
    const m = (s + e) >> 1;
    node.l = build(s, m); node.r = build(m, e); node.n = 0;
    return id;
  }
  build(0, nt);
  const N = nodes.length;
  const box = new Float64Array(N * 6), kid = new Int32Array(N * 2), rng = new Int32Array(N * 2);
  nodes.forEach((n, i) => { box.set([...n.mn, ...n.mx], i * 6); kid[i * 2] = n.l; kid[i * 2 + 1] = n.r; rng[i * 2] = n.s; rng[i * 2 + 1] = n.n; });
  const stack = new Int32Array(128);
  /** Closest hit distance along o + d t, t in (tmin, tmax); returns Infinity if none. */
  function cast(o, d, tmin, tmax) {
    const ix = 1 / d[0], iy = 1 / d[1], iz = 1 / d[2];
    let sp = 0; stack[sp++] = 0; let best = tmax;
    while (sp) {
      const ni = stack[--sp];
      const b = ni * 6;
      let t0 = (box[b] - o[0]) * ix, t1 = (box[b + 3] - o[0]) * ix; if (t0 > t1) [t0, t1] = [t1, t0];
      let u0 = (box[b + 1] - o[1]) * iy, u1 = (box[b + 4] - o[1]) * iy; if (u0 > u1) [u0, u1] = [u1, u0];
      let w0 = (box[b + 2] - o[2]) * iz, w1 = (box[b + 5] - o[2]) * iz; if (w0 > w1) [w0, w1] = [w1, w0];
      const tn = Math.max(t0, u0, w0, tmin), tf = Math.min(t1, u1, w1, best);
      if (tn > tf) continue;
      if (rng[ni * 2 + 1] > 0) {
        for (let k = rng[ni * 2], ke = k + rng[ni * 2 + 1]; k < ke; k++) {
          const t = idx[k];
          const a = tris[t * 3] * 3, bb = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
          const e1x = P[bb] - P[a], e1y = P[bb + 1] - P[a + 1], e1z = P[bb + 2] - P[a + 2];
          const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
          const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-14) continue;
          const inv = 1 / det;
          const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
          const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > tmin && tt < best) best = tt;
        }
      } else { stack[sp++] = kid[ni * 2]; stack[sp++] = kid[ni * 2 + 1]; }
    }
    return best;
  }
  return { cast };
}
function triangulate(P, faces) {
  const T = [];
  for (const f of faces) {
    if (f.length === 3) { T.push(f[0], f[1], f[2]); continue; }
    if (f.length === 4) {
      const d02 = len(sub(get3(P, f[0]), get3(P, f[2]))), d13 = len(sub(get3(P, f[1]), get3(P, f[3])));
      if (d02 <= d13) T.push(f[0], f[1], f[2], f[0], f[2], f[3]); else T.push(f[0], f[1], f[3], f[1], f[2], f[3]);
      continue;
    }
    for (let k = 1; k < f.length - 1; k++) T.push(f[0], f[k], f[k + 1]);
  }
  return T;
}


// ============================================================== head measurements (rest frame)
const HEAD_BONES = new Set(['head', 'jaw', ...order.filter((n) => /^(special|oris|levator|oculi|orbicularis|risorius|temporalis|eye|tongue)/.test(n))]);
const isHeadV = new Uint8Array(NV);
for (let i = 0; i < 13380; i++) if (wOf(i, HEAD_BONES) > 0.5) isHeadV[i] = 1;
const eyeR = B['eye.R'].h, eyeL = B['eye.L'].h;
const headTopRest = (() => { let m = -1e9, at = 0; for (let i = 0; i < 13380; i++) if (isHeadV[i] && V0[i * 3 + 1] > m) { m = V0[i * 3 + 1]; at = i; } return get3(V0, at); })();
log('eyes', eyeR.map((v) => v.toFixed(3)), eyeL.map((v) => v.toFixed(3)), 'head top', headTopRest.map((v) => v.toFixed(3)));
const headC = [0, eyeR[1] + 0.01, eyeR[2] - 0.085]; // rough centre of the skull (rest)
// ears: lateral extremes at eye height, behind the eyes
const earC = {};
for (const [s, sg] of [['R', -1], ['L', 1]]) {
  let best = -1, bx = -1e9;
  for (let i = 0; i < 13380; i++) {
    if (!isHeadV[i]) continue;
    const y = V0[i * 3 + 1], z = V0[i * 3 + 2], x = V0[i * 3] * sg;
    if (y < eyeR[1] - 0.045 || y > eyeR[1] + 0.02 || z > eyeR[2] - 0.05) continue;
    if (x > bx) { bx = x; best = i; }
  }
  // ear centre: the ear's tip region is the extreme; the centre of the ear is a bit inwards/down
  earC[s] = add(get3(V0, best), [-0.012 * sg, -0.008, 0]);
}
log('ears', earC.R.map((v) => v.toFixed(3)), earC.L.map((v) => v.toFixed(3)));

// ============================================================== short hair shell (rest frame)
const NECK = new Set(['neck01', 'neck02', 'neck03']);
const hairV = new Uint8Array(NV);
for (let i = 0; i < 13380; i++) {
  const p = get3(V0, i);
  const headish = isHeadV[i] || (wOf(i, NECK) > 0.4 && p[2] < headC[2] + 0.02);
  if (!headish) continue;
  const back = smooth(eyeR[2] - 0.055, eyeR[2] - 0.165, p[2]);
  const side = smooth(0.035, 0.065, Math.abs(p[0]));
  const yLine = eyeR[1] + 0.062 - back * 0.185 - side * (1 - back) * 0.05 + 0.008 * Math.cos(p[0] * 40); // forehead hairline → nape
  if (p[1] < yLine) continue;
  if (len(sub(p, earC.R)) < 0.021 || len(sub(p, earC.L)) < 0.021) continue;
  // sideburns stop at the top of the ear in front
  if (Math.abs(p[0]) > 0.055 && p[2] > earC.R[2] + 0.018 && p[1] < earC.R[1] + 0.012) continue;
  hairV[i] = 1;
}
const hairFaceIdx = [];
bodyFaces.forEach((f, fi) => { if (f.filter((v) => hairV[v]).length >= 3) hairFaceIdx.push(fi); });
const hairFaceSet = new Set(hairFaceIdx);
log('hair faces', hairFaceIdx.length);
if (DBG) { let n = 0, y0 = 1e9, y1 = -1e9, z0 = 1e9; for (let i = 0; i < NV; i++) if (hairV[i]) { n++; y0 = Math.min(y0, V0[i * 3 + 1]); y1 = Math.max(y1, V0[i * 3 + 1]); z0 = Math.min(z0, V0[i*3+2]); } log('hair verts', n, 'y', y0.toFixed(3), y1.toFixed(3), 'zmin', z0.toFixed(3), 'eyeY', eyeR[1].toFixed(3), 'headC', headC.map(v=>v.toFixed(3))); let nh=0; for (let i=0;i<13380;i++) if (isHeadV[i] && V0[i*3+2] < headC[2] - 0.05) nh++; log('back-of-head head verts', nh);
  const rows = {}; for (let i = 0; i < 13380; i++) { const p = get3(V0, i); if (p[2] > 0.045 || p[1] < eyeR[1] - 0.1 || p[1] > eyeR[1] + 0.04) continue; if (!(isHeadV[i] || wOf(i, NECK) > 0.4)) continue; const k = Math.round((p[1] - eyeR[1]) / 0.01); const a = Math.round(Math.atan2(p[0], -p[2] + headC[2]) * 180 / Math.PI / 15); (rows[k] ||= {})[a] = (rows[k][a] || '') + (hairV[i] ? 'H' : '.'); }
  for (const k of Object.keys(rows).sort((a, b) => b - a)) log(k, Object.keys(rows[k]).sort((a, b) => a - b).map((a) => a + ':' + rows[k][a]).join(' ')); }

/** Geodesic distance (along mesh edges) from the boundary of a face set, for its vertices. */
function distFromBoundary(P, faces) {
  const be = boundaryEdges(faces);
  const D = new Map();
  const adj = new Map();
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length];
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  let front = [];
  for (const [a, b] of be) for (const v of [a, b]) if (!D.has(v)) { D.set(v, 0); front.push(v); }
  // Bellman-Ford-ish relaxation (small sets; fine)
  for (let it = 0; it < 200 && front.length; it++) {
    const nf = new Set();
    for (const v of front) for (const u of adj.get(v)) {
      const d = D.get(v) + len(sub(get3(P, u), get3(P, v)));
      if (!D.has(u) || d < D.get(u) - 1e-9) { D.set(u, d); nf.add(u); }
    }
    front = [...nf];
  }
  return D;
}

// ============================================================== skin pass 1 (everything but the right arm posed)
fk();
let Pp = skinAll();
ctx_setPosed(Pp);
function ctx_setPosed(P) { posedCache = P; }

// the hair shell and hat are built in the rest frame of the head bone, then moved with it
const restToHead = (p) => xf('head', p);
const hairRestN = vertexNormals(V0, bodyFaces, NV);
const hairShell = (() => {
  const faces = hairFaceIdx.map((fi) => bodyFaces[fi]);
  const D = distFromBoundary(V0, faces);
  const c = compact(V0, faces);
  const P = new Float64Array(c.P.length);
  const prof = new Float64Array(c.P.length / 3);
  for (const [ov, nv] of c.map) {
    const d = D.get(ov) ?? 0.03;
    const back = smooth(eyeR[2] - 0.05, eyeR[2] - 0.17, V0[ov * 3 + 2]);
    const off = (0.004 + 0.004 * back) * smooth(0, 0.014, d);
    set3(P, nv, add(get3(V0, ov), mul(get3(hairRestN, ov), off)));
    prof[nv] = smooth(0, 0.009, d);
  }
  return { P, faces: c.faces, prof, map: c.map };
})();

// ============================================================== straw sun hat (rest head frame)
const HAT_TILT = rad(-3.5); // tipped back a little
const hatAxis = qRot(qAA(LAT, HAT_TILT), UP);
const hatX = LAT, hatZ = norm(cross(hatX, hatAxis));
const bandC = [0, eyeR[1] + 0.052, headC[2]];
// all points the crown must clear: skull + hair shell
const clearPts = [];
for (let i = 0; i < 13380; i++) if (isHeadV[i] || hairV[i]) clearPts.push(get3(V0, i));
for (let i = 0; i < hairShell.P.length / 3; i++) clearPts.push(get3(hairShell.P, i));
const toHat = (p) => { const d = sub(p, bandC); return [dot(d, hatX), dot(d, hatAxis), dot(d, hatZ)]; };
const fromHat = (x, a, z) => add(add(add(bandC, mul(hatX, x)), mul(hatAxis, a)), mul(hatZ, z));
const NB = 96;
const rb = new Float64Array(NB);
// centre the crown on the skull section
let cx = 0, cz = 0, cn = 0;
for (const p of clearPts) { const h = toHat(p); if (h[1] > -0.005 && h[1] < 0.02) { cx += h[0]; cz += h[2]; cn++; } }
cx /= cn; cz /= cn;
const hatOff = [cx, cz];
for (const p of clearPts) {
  const h = toHat(p);
  if (h[1] < -0.015 || h[1] > 0.03) continue;
  const x = h[0] - cx, z = h[2] - cz, r = Math.hypot(x, z), th = Math.atan2(z, x);
  for (let k = -2; k <= 2; k++) {
    const bi = ((Math.round((th / (2 * Math.PI)) * NB) + k) % NB + NB) % NB;
    rb[bi] = Math.max(rb[bi], r);
  }
}
for (let it = 0; it < 6; it++) { const c = rb.slice(); for (let i = 0; i < NB; i++) rb[i] = Math.max(c[i], (c[(i + NB - 1) % NB] + 2 * c[i] + c[(i + 1) % NB]) / 4); }
for (let i = 0; i < NB; i++) rb[i] += 0.008;
let crownH = 0;
for (const p of clearPts) crownH = Math.max(crownH, toHat(p)[1]);
crownH += 0.024;
const CROWN_P = 3.0;
const rbAt = (th) => { const f = ((th / (2 * Math.PI)) * NB % NB + NB) % NB; const i = Math.floor(f), t = f - i; return rb[i] * (1 - t) + rb[(i + 1) % NB] * t; };
/** Crown outer surface: ring parameter phi (0 base … π/2 top) → (rho, a). */
const crownAt = (th, phi) => {
  const c = Math.max(Math.cos(phi), 0), s = Math.max(Math.sin(phi), 0);
  const y = Math.pow(s, 2 / CROWN_P);
  const rho = rbAt(th) * Math.pow(c, 2 / CROWN_P) * (1 - 0.07 * y);
  return [rho, crownH * y];
};
// grow until everything is inside with 4 mm clearance
for (let it = 0; it < 30; it++) {
  let bad = 0;
  for (const p of clearPts) {
    const h = toHat(p); if (h[1] < 0.0) continue;
    const x = h[0] - cx, z = h[2] - cz, th = Math.atan2(z, x), r = Math.hypot(x, z);
    const y = clamp(h[1] / crownH, 0, 0.999);
    const phi = Math.asin(Math.pow(y, CROWN_P / 2));
    const [rho] = crownAt(th, phi);
    if (r > rho - 0.004 || h[1] > crownH - 0.006) bad++;
  }
  if (!bad) break;
  for (let i = 0; i < NB; i++) rb[i] *= 1.01; crownH *= 1.01;
}
const BRIM_R = 0.205, BRIM_T = 0.0038, BRIM_DROOP = 0.034;
const brimA = (th, u) => -0.003 * u - BRIM_DROOP * Math.pow(u, 1.7) + 0.009 * u * u * Math.sin(2 * th + 0.9) + 0.004 * u * u * Math.sin(5 * th + 2.1);
log('hat: crown base r', Math.min(...rb).toFixed(3), Math.max(...rb).toFixed(3), 'crown h', crownH.toFixed(3));

/**
 * Hat as one surface of revolution (per-angle profile) from the inner crown top, down the lining,
 * out under the brim, round the rim, back over the brim and up the crown to the top.
 * Returns rest-head-frame mesh with per-vertex material + hat params (radial s along brim, band).
 */
function hatMesh(nTh, dens) {
  const prof = []; // [kind, param]
  const nCrown = Math.round(22 * dens), nBrim = Math.round(16 * dens), nLine = Math.round(8 * dens);
  for (let j = nLine; j >= 0; j--) prof.push(['lin', j / nLine]);
  for (let j = 1; j <= nBrim; j++) prof.push(['bot', j / nBrim]);
  for (let j = 1; j <= 4; j++) prof.push(['rim', j / 5]);
  for (let j = nBrim; j >= 0; j--) prof.push(['top', j / nBrim]);
  for (let j = 1; j <= nCrown; j++) prof.push(['crown', j / nCrown]);
  const P = [], mat = [], prm = [];
  for (let i = 0; i < nTh; i++) {
    const th = (i / nTh) * 2 * Math.PI;
    const dx = Math.cos(th), dz = Math.sin(th);
    for (const [k, t] of prof) {
      let rho, a, m = 6, band = 0, s = 0;
      if (k === 'lin') { const [r0, a0] = crownAt(th, (1 - t) * Math.PI * 0.5 * 0.0 + t * Math.PI * 0.5 * 0.92); rho = Math.max(r0 - 0.003, 0.002); a = a0 - 0.003 - (t > 0.99 ? 0.004 : 0); m = 8; s = -1; }
      else if (k === 'bot') { const r0 = rbAt(th) - 0.003; rho = r0 + (BRIM_R - r0) * t; a = brimA(th, t) - BRIM_T * (1 - 0.3 * t); s = t; }
      else if (k === 'rim') { const ang = Math.PI * (t - 0.5); rho = BRIM_R + Math.cos(ang) * BRIM_T * 0.45; a = brimA(th, 1) - BRIM_T * 0.7 * 0.5 + Math.sin(ang) * BRIM_T * 0.6; s = 1; }
      else if (k === 'top') { const r0 = rbAt(th); rho = r0 + (BRIM_R - r0) * t; a = brimA(th, t); s = t; }
      else {
        const [r0, a0] = crownAt(th, t * Math.PI * 0.5);
        rho = r0; a = a0;
        const bh = a0 - 0.0;
        band = smooth(0.003, 0.0045, bh) * (1 - smooth(0.026, 0.0275, bh));
        if (band > 0) rho += 0.0016 * band;
        m = band > 0.5 ? 7 : 6; s = -0.5;
      }
      P.push(fromHat(cx + dx * rho, a, cz + dz * rho));
      mat.push(m); prm.push(s, band);
    }
  }
  const np = prof.length;
  const faces = [], fids = [];
  for (let i = 0; i < nTh; i++) {
    const i2 = (i + 1) % nTh;
    for (let j = 0; j < np - 1; j++) {
      // outward winding: profile runs inner-top → … → outer-top
      faces.push([i * np + j, i * np + j + 1, i2 * np + j + 1, i2 * np + j]);
      fids.push(Math.max(mat[i * np + j], mat[i * np + j + 1]) === 8 ? 8 : mat[i * np + j + 1]);
    }
  }
  // polar caps: inner top and outer top
  const flat = new Float64Array(P.length * 3); P.forEach((p, i) => set3(flat, i, p));
  const nv = P.length;
  const capIn = fromHat(cx, crownH - 0.003 - 0.002, cz), capOut = fromHat(cx, crownH, cz);
  const PP = new Float64Array((nv + 2) * 3); PP.set(flat); set3(PP, nv, capIn); set3(PP, nv + 1, capOut);
  for (let i = 0; i < nTh; i++) {
    const i2 = (i + 1) % nTh;
    faces.push([nv, i * np, i2 * np]); fids.push(8);
    faces.push([i * np + np - 1, nv + 1, i2 * np + np - 1]); fids.push(6);
  }
  mat.push(8, 6); prm.push(-1, 0, -0.5, 0);
  return { P: PP, faces, fids, mat, prm: Float64Array.from(prm) };
}

// ============================================================== sunglasses (rest head frame)
function sweep(path, upHint, w, h, closed, r = 0.35) {
  // rounded-rectangle section (8 points)
  const sec = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI + Math.PI / 8; const c = Math.cos(a), s = Math.sin(a); const m = Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, -0.25); sec.push([c * m * (1 - r) + c * r, s * m * (1 - r) + s * r]); }
  const P = [], faces = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i + n - 1) % n : Math.max(i - 1, 0)], b = path[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
    const t = norm(sub(b, a));
    const u = norm(sub(upHint(i), mul(t, dot(upHint(i), t))));
    const v = cross(t, u);
    for (const [sx, sy] of sec) P.push(add(path[i], add(mul(v, sx * w * 0.5), mul(u, sy * h * 0.5))));
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % n;
    for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; faces.push([i * 8 + k, i * 8 + k2, i2 * 8 + k2, i2 * 8 + k]); }
  }
  if (!closed) { faces.push([7, 6, 5, 4, 3, 2, 1, 0]); const L = (n - 1) * 8; faces.push([L, L + 1, L + 2, L + 3, L + 4, L + 5, L + 6, L + 7]); }
  return { P, faces };
}
function glassesMesh(nOut, nRad) {
  const parts = []; // {P: [[x,y,z]], faces, mat}
  const face = [];
  for (let i = 0; i < 13380; i++) if (isHeadV[i]) face.push(get3(V0, i));
  const LW = 0.0245, LH = 0.0178, EXP = 2.4;
  const lensCentre = {};
  for (const [s, e, sg] of [['R', eyeR, -1], ['L', eyeL, 1]]) {
    const c = add(e, [0.0015 * sg, 0.0035, 0]);
    // the lens sits in front of everything inside its footprint (brow, nose bridge, cheek) + clearance
    let zmax = -1e9;
    for (const p of face) if (Math.abs(p[0] - c[0]) < LW + 0.004 && Math.abs(p[1] - c[1]) < LH + 0.004) zmax = Math.max(zmax, p[2] + 0.12 * Math.max(0, (p[0] - c[0]) * sg) + 2.5 * ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2));
    lensCentre[s] = [c[0], c[1], zmax + 0.007];
  }
  const lensZ = Math.max(lensCentre.R[2], lensCentre.L[2]);
  for (const s of ['R', 'L']) lensCentre[s][2] = lensZ;
  const lensPt = (s, sg, u, v) => {
    const c = lensCentre[s];
    const dx = u * LW, dy = v * LH;
    return [c[0] + dx, c[1] + dy, c[2] - 2.5 * (dx * dx + dy * dy) - 0.12 * Math.max(0, dx * sg)];
  };
  const outline = (s, sg, k, n, scale = 1) => {
    const a = (k / n) * 2 * Math.PI;
    const c = Math.cos(a), sn = Math.sin(a);
    const m = Math.pow(Math.abs(c) ** EXP + Math.abs(sn) ** EXP, -1 / EXP);
    // a touch wider at the top outer corner (classic shape)
    const top = sn > 0 ? 1 + 0.06 * Math.max(0, c * sg) : 0.97;
    return lensPt(s, sg, c * m * scale * (sn > 0 ? 1 : 0.96), sn * m * scale * top);
  };
  const hinge = {};
  for (const [s, sg] of [['R', -1], ['L', 1]]) {
    // lens: polar grid
    const P = [], faces = [];
    P.push(lensPt(s, sg, 0, 0));
    for (let r = 1; r <= nRad; r++) for (let k = 0; k < nOut; k++) P.push(outline(s, sg, k, nOut, r / nRad));
    for (let k = 0; k < nOut; k++) faces.push([0, 1 + k, 1 + ((k + 1) % nOut)]);
    for (let r = 1; r < nRad; r++) for (let k = 0; k < nOut; k++) {
      const a = 1 + (r - 1) * nOut + k, b = 1 + (r - 1) * nOut + ((k + 1) % nOut);
      faces.push([a, a + nOut, b + nOut, b]);
    }
    // winding: lens front faces +Z
    const fz = cross(sub(P[faces[0][1]], P[0]), sub(P[faces[0][2]], P[0]))[2];
    if (fz < 0) for (const f of faces) f.reverse();
    parts.push({ P, faces, mat: 10 });
    // frame rim
    const path = []; for (let k = 0; k < nOut; k++) path.push(add(outline(s, sg, k, nOut, 1.03), [0, 0, 0.0005]));
    parts.push({ ...sweep(path, () => [0, 0, 1], 0.0022, 0.0034, true), mat: 9 });
    hinge[s] = add(outline(s, sg, sg > 0 ? Math.round(nOut * 0.06) : Math.round(nOut * 0.44), nOut, 1.08), [0, 0, -0.002]);
  }
  // bridge
  const bA = outline('R', -1, Math.round(nOut * 0.12), nOut, 1.03), bB = outline('L', 1, Math.round(nOut * 0.38), nOut, 1.03);
  const bridge = []; for (let k = 0; k <= 8; k++) { const t = k / 8; const p = lerp3(bA, bB, t); p[1] += 0.003 * Math.sin(Math.PI * t); p[2] += 0.002 * Math.sin(Math.PI * t); bridge.push(p); }
  parts.push({ ...sweep(bridge, () => [0, 0, 1], 0.0022, 0.0028, false), mat: 9 });
  // temples back to the ears, just clear of the head, then down behind the ear
  for (const [s, sg] of [['R', -1], ['L', 1]]) {
    const e = earC[s];
    const path = [];
    const y0 = hinge[s][1];
    const zEnd = e[2] - 0.012;
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const z = hinge[s][2] + (zEnd - hinge[s][2]) * t;
      const y = y0 + (e[1] + 0.024 - y0) * smooth(0, 1, t);
      let xm = 0;
      for (const p of face) if (Math.abs(p[1] - y) < 0.008 && Math.abs(p[2] - z) < 0.008 && !(len(sub(p, e)) < 0.03)) xm = Math.max(xm, p[0] * sg);
      const x = Math.max(xm + 0.0028, Math.abs(hinge[s][0]) * (1 - t) + (Math.abs(e[0]) - 0.01) * t) * sg;
      path.push([k === 0 ? hinge[s][0] : x, y, z]);
    }
    // hook down behind the ear
    const last = path[path.length - 1];
    for (let k = 1; k <= 5; k++) { const a = (k / 5) * Math.PI * 0.45; path.push([last[0] - 0.003 * sg * k / 5, last[1] - Math.sin(a) * 0.022, last[2] - (1 - Math.cos(a)) * 0.012 - k * 0.002]); }
    parts.push({ ...sweep(path, () => [0, 1, 0], 0.0019, 0.0036, false), mat: 9 });
  }
  return parts;
}

// ============================================================== right hand resting on the hat crown
const hatHi = hatMesh(100, 1);
const hatWorld = (h) => { const P = new Float64Array(h.P.length); for (let i = 0; i < h.P.length / 3; i++) set3(P, i, restToHead(get3(h.P, i))); return P; };
let hatHiW = hatWorld(hatHi);
const crownTopW = restToHead(fromHat(cx, crownH, cz));
const crownN = vertexNormals(hatHiW, hatHi.faces, hatHiW.length / 3);
// collider for the crown + brim top (outer surfaces only)
const crownColl = (() => {
  const ids = []; hatHi.mat.forEach((m, i) => { if (m !== 8) ids.push(i); });
  const P = new Float64Array(ids.length * 3), N = new Float64Array(ids.length * 3);
  ids.forEach((v, j) => { set3(P, j, get3(hatHiW, v)); set3(N, j, get3(crownN, v)); });
  return { P, N, grid: pointGrid(P, 0.01) };
})();
function crownSD(p) {
  const i = crownColl.grid.nearest(p, 0.08);
  if (i < 0) return { d: 0.08, n: UP };
  const c = get3(crownColl.P, i), n = get3(crownColl.N, i);
  return { d: dot(sub(p, c), n), n };
}
log('crown top (world, m)', crownTopW.map((v) => v.toFixed(3)));

// Desired hand orientation: back of the hand straight up, fingers towards the left side and forwards.
const HAND_FINGERS = norm([0.86, 0, 0.5]);
const R_ARM = { l1: len(sub(B['lowerarm01.R'].h, B['upperarm01.R'].h)), l2: len(sub(B['wrist.R'].h, B['lowerarm01.R'].h)) };
const restHand = (() => {
  const s = 'R';
  const wr = B[`wrist.${s}`].h, k2 = B[`finger2-1.${s}`].h, k5 = B[`finger5-1.${s}`].h;
  const fingers = norm(sub(lerp3(k2, k5, 0.4), wr));
  const d = norm(sub(restDorsal.R, mul(fingers, dot(restDorsal.R, fingers))));
  return { fingers, dorsal: d };
})();
// rotation taking the rest (fingers, dorsal) frame to the wanted (fingers, up) frame
function frameRot(f0, d0, f1, d1) {
  const q1 = qFromTo(f0, f1);
  const d0r = qRot(q1, d0);
  const ang = angleAbout(d0r, d1, f1);
  return qNorm(qMul(qAA(f1, ang), q1));
}
let qHand = frameRot(restHand.fingers, restHand.dorsal, HAND_FINGERS, UP);
// palm-centre offset from the wrist joint in the rest frame (centre of the metacarpal pad)
const palmRest = (() => {
  const mc = new Set(['metacarpal1.R', 'metacarpal2.R', 'metacarpal3.R', 'metacarpal4.R']);
  const c = [0, 0, 0]; let n = 0;
  for (let i = 0; i < 13380; i++) if (wOf(i, mc) > 0.6) { c[0] += V0[i * 3]; c[1] += V0[i * 3 + 1]; c[2] += V0[i * 3 + 2]; n++; }
  return mul(c, 1 / n);
})();
let wristTarget;
function poseRightArm(handLift) {
  // shoulder girdle comes up with the raised arm
  Q['clavicle.R'] = qId(); Q['shoulder01.R'] = qId();
  for (const n of ['upperarm01.R', 'upperarm02.R', 'lowerarm01.R', 'lowerarm02.R', 'wrist.R']) Q[n] = qId();
  fk();
  rotWorld('clavicle.R', FWD, rad(-16));
  rotWorld('clavicle.R', UP, rad(6)); // a little forwards
  // where the wrist must be so the palm centre sits over the crown top
  const palmOff = qRot(qHand, sub(palmRest, B['wrist.R'].h));
  const contact = add(crownTopW, mul(HAND_FINGERS, 0.004));
  wristTarget = add(sub(contact, palmOff), [0, handLift, 0]);
  const A = head('upperarm01.R');
  const elbowPole = norm([-1, -0.35, -0.25]);
  const E = ik2(A, wristTarget, R_ARM.l1, R_ARM.l2, elbowPole);
  aim('upperarm01.R', sub(E, A));
  aim('upperarm02.R', sub(E, head('upperarm02.R')));
  // shoulder01 shares a little of the elevation (spreads the deformation over the deltoid)
  aim('lowerarm01.R', sub(wristTarget, head('lowerarm01.R')));
  aim('lowerarm02.R', sub(wristTarget, head('lowerarm02.R')));
  // forearm pronation shares the hand's twist (forearm bones twist, wrist bends)
  const fa = dirOf('lowerarm02.R');
  const curD = qRot(W['wrist.R'].q, restDorsal.R);
  const wantD = qRot(qHand, restDorsal.R);
  const tw = angleAbout(curD, wantD, fa);
  rotWorld('lowerarm01.R', fa, tw * 0.35);
  rotWorld('lowerarm02.R', fa, tw * 0.5);
  setWorld('wrist.R', qHand);
}
const curlR = [[10, 16, 10], [12, 18, 12], [14, 20, 12], [16, 22, 14]];
function poseRightHandFingers() {
  for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) Q[`finger${f}-${j}.R`] = qId();
  for (let f = 1; f <= 4; f++) Q[`metacarpal${f}.R`] = qId();
  fk();
  curlFingers('R', curlR, [-6, 8, 10]);
}
/** Normal of the back of the right hand around its centre: area-weighted over a 12 mm disc. */
function anchorOf(P, faces, nrm) {
  const wr = head('wrist.R'), k3 = head('finger3-1.R'), k4 = head('finger4-1.R');
  const c = lerp3(wr, lerp3(k3, k4, 0.35), 0.52);
  // highest skin point above c (the dorsal surface)
  let best = -1, by = -1e9;
  for (let i = 0; i < 13380; i++) {
    const p = get3(P, i);
    if (Math.hypot(p[0] - c[0], p[2] - c[2]) > 0.004) continue;
    if (Math.abs(p[1] - c[1]) > 0.04) continue;
    if (p[1] > by) { by = p[1]; best = i; }
  }
  const pt = get3(P, best);
  const n = [0, 0, 0];
  for (const f of faces) {
    const a = get3(P, f[0]);
    if (len(sub(a, pt)) > 0.012) continue;
    const t = triangulate(P, [f]);
    for (let k = 0; k < t.length; k += 3) {
      const p0 = get3(P, t[k]), p1 = get3(P, t[k + 1]), p2 = get3(P, t[k + 2]);
      const cn = cross(sub(p1, p0), sub(p2, p0));
      const w = 1 - len(sub(p0, pt)) / 0.012;
      n[0] += cn[0] * w; n[1] += cn[1] * w; n[2] += cn[2] * w;
    }
  }
  return { p: pt, n: norm(n), c };
}
/** The same, measured on a once-subdivided patch (what the high tier will actually show). */
function anchorOfHi(P) {
  const a = anchorOf(P, bodyFaces);
  const near = bodyFaces.filter((f) => f.some((v) => len(sub(get3(P, v), a.p)) < 0.06));
  const c = compact(P, near);
  const r = catmullClark(c.P, c.faces, c.faces.map(() => 0));
  const r2 = r;
  const N = vertexNormals(r2.P, r2.faces, r2.P.length / 3);
  // top point above a.p, then the weighted normal over a 12 mm disc
  let best = -1, by = -1e9;
  for (let i = 0; i < r2.P.length / 3; i++) { const q = get3(r2.P, i); if (Math.hypot(q[0] - a.p[0], q[2] - a.p[2]) < 0.002 && q[1] > by) { by = q[1]; best = i; } }
  const pt = get3(r2.P, best);
  let n = [0, 0, 0];
  for (let i = 0; i < r2.P.length / 3; i++) { const d = len(sub(get3(r2.P, i), pt)); if (d < 0.012) n = add(n, mul(get3(N, i), 1 - d / 0.012)); }
  return { p: pt, n: norm(n) };
}
// Solve: lift so the palm just rests on the crown, and tilt the hand so the anchor normal is +Y.
let lift = 0.0;
poseRightHandFingers();
for (let it = 0; it < 8; it++) {
  poseRightArm(lift);
  poseRightHandFingers();
  Pp = skinAll();
  // palm contact: deepest penetration of palm/finger skin into the crown
  const handB = new Set(['wrist.R', 'metacarpal1.R', 'metacarpal2.R', 'metacarpal3.R', 'metacarpal4.R']);
  let minD = 1, worst = -1;
  for (let i = 0; i < 13380; i++) if (wOf(i, handB) > 0.5) { const d = crownSD(get3(Pp, i)).d; if (d < minD) { minD = d; worst = i; } }
  if (DBG) log('worst', worst, get3(Pp, worst).map((v) => v.toFixed(3)), order[infl[worst][0][0]], 'rest', get3(V0, worst).map((v) => v.toFixed(3)));
  const an = anchorOfHi(Pp);
  const err = Math.acos(clamp(an.n[1], -1, 1));
  if (DBG) log('anchor', an.p.map((v) => v.toFixed(3)), an.n.map((v) => v.toFixed(3)), 'wrist', head('wrist.R').map((v) => v.toFixed(3)), 'elbow', head('lowerarm01.R').map((v) => v.toFixed(3)), 'target', wristTarget.map((v) => v.toFixed(3)));
  log(`hand solve ${it}: palm clearance ${(minD * 1000).toFixed(1)} mm, anchor normal err ${(err * 180 / Math.PI).toFixed(2)}°`);
  lift += 0.001 - minD; // aim for 1 mm of clearance at the palm (fingers drape onto the crown)
  // tilt correction
  if (err > 1e-4) { const ax = norm(cross(an.n, UP)); qHand = qNorm(qMul(qAA(ax, err), qHand)); }
  if (Math.abs(0.001 - minD) < 0.0005 && err < rad(0.15)) break;
}

// ============================================================== final skinning + contact clean-up
fk();
Pp = skinAll();
posedCache = Pp;
// fingers and thumb resting on the crown: press skin that would sink into the straw back onto it
{
  const handB = new Set(order.filter((n) => /(finger|metacarpal|wrist)\S*\.R$/.test(n)));
  let moved = 0;
  for (let i = 0; i < 13380; i++) {
    if (wOf(i, handB) < 0.05) continue;
    const p = get3(Pp, i);
    const { d, n } = crownSD(p);
    if (d < 0.0012) { set3(Pp, i, add(p, mul(n, 0.0012 - d))); moved++; }
  }
  log('hand skin pressed onto crown:', moved, 'verts');
}
const anchor0 = anchorOf(Pp, bodyFaces);
log('anchor (posed, m)', anchor0.p.map((v) => v.toFixed(4)), 'normal', anchor0.n.map((v) => v.toFixed(4)));

// ============================================================== hairline signed distance (rest frame)
/**
 * Smooth signed distance (metres, + inside the hair) to the hairline: the same analytic line, ear
 * clearances and sideburn cut that pick the hair-shell faces, but evaluated per vertex so the shaders
 * can draw a soft, irregular hairline across the skin instead of the shell's stair-stepped polygon edge.
 * Does not change any geometry (the hat and the hand pose depend on the shell built above).
 */
const hairSD = new Float64Array(NV).fill(-0.02);
for (let i = 0; i < 13380; i++) {
  const p = get3(V0, i);
  const headish = isHeadV[i] || (wOf(i, NECK) > 0.2 && p[2] < headC[2] + 0.04);
  if (!headish) continue;
  const back = smooth(eyeR[2] - 0.055, eyeR[2] - 0.165, p[2]);
  const side = smooth(0.035, 0.065, Math.abs(p[0]));
  const yLine = eyeR[1] + 0.062 - back * 0.185 - side * (1 - back) * 0.05 + 0.008 * Math.cos(p[0] * 40);
  let sd = p[1] - yLine;
  sd = Math.min(sd, len(sub(p, earC.R)) - 0.021, len(sub(p, earC.L)) - 0.021);
  sd = Math.min(sd, Math.max(0.055 - Math.abs(p[0]), earC.R[2] + 0.018 - p[2], p[1] - (earC.R[1] + 0.012)));
  // the nape: square the shell's V off a little (the painted hairline reaches lower either side)
  sd += 0.012 * back * smooth(0.012, 0.04, Math.abs(p[0])) * (1 - smooth(0.055, 0.07, Math.abs(p[0])));
  hairSD[i] = clamp(sd, -0.02, 0.02);
}
/** 8-bit friendly encoding of the hairline distance: ±2 cm → 0..1. */
const encSD = (sd) => clamp(0.5 + sd / 0.04, 0, 1);

// ============================================================== body masks (per base vertex)
// brow and lips never meet, so they share one channel (0.5 + brow/2 − lips/2); the 4th is skin oiliness
const bodyAux = new Float64Array(NV * 4); // brow|lips, redness, nail, oil (T-zone)
{
  const ORIS = new Set(order.filter((n) => /^oris/.test(n)));
  const jointsRed = [];
  for (const s of ['L', 'R']) {
    for (let f = 2; f <= 5; f++) for (let j = 1; j <= 3; j++) jointsRed.push([B[`finger${f}-${j}.${s}`].h, 0.011, 0.8]);
    jointsRed.push([B[`finger1-2.${s}`].h, 0.011, 0.6], [B[`finger1-3.${s}`].h, 0.01, 0.6]);
    jointsRed.push([B[`lowerarm01.${s}`].h, 0.045, 0.55], [B[`lowerleg01.${s}`].h, 0.06, 0.5]);
    jointsRed.push([earC[s], 0.035, 0.8]);
    const e = s === 'R' ? eyeR : eyeL;
    jointsRed.push([add(e, [(s === 'R' ? -1 : 1) * 0.012, -0.035, 0.0]), 0.03, 0.6]); // cheeks
    for (let t = 1; t <= 5; t++) jointsRed.push([B[`toe${t}-1.${s}`].h, 0.015, 0.4]);
  }
  // nose tip: the most forward face vertex
  let nose = null, nz = -1e9; for (let i = 0; i < 13380; i++) if (isHeadV[i] && V0[i * 3 + 2] > nz) { nz = V0[i * 3 + 2]; nose = get3(V0, i); }
  jointsRed.push([nose, 0.018, 0.5]);
  const tips = [];
  for (const s of ['L', 'R']) for (let f = 1; f <= 5; f++) tips.push({ t: B[`finger${f}-3.${s}`].t, h: B[`finger${f}-3.${s}`].h, s });
  for (const s of ['L', 'R']) for (let t = 1; t <= 5; t++) { const n = t === 1 ? `toe1-2.${s}` : `toe${t}-3.${s}`; tips.push({ t: B[n].t, h: B[n].h, s, toe: true }); }
  const restN = hairRestN;
  for (let i = 0; i < 13380; i++) {
    const p = get3(V0, i);
    // brows: a soft band above each eye
    let brow = 0;
    for (const e of [eyeR, eyeL]) {
      const dx = (p[0] - e[0]) * Math.sign(e[0]);
      const yb = e[1] + 0.019 + 0.006 * Math.cos(clamp(dx / 0.03, -1.5, 1.5)) - 0.006 * smooth(0.0, 0.03, dx);
      const w = (1 - smooth(0.018, 0.026, Math.abs(dx - 0.002))) * (1 - smooth(0.0025, 0.0055, Math.abs(p[1] - yb)));
      if (p[2] > e[2]) brow = Math.max(brow, w * (1 - smooth(0.015, 0.03, dx) * 0.4));
    }
    let red = 0;
    for (const [c, r, a] of jointsRed) { const d = len(sub(p, c)); if (d < r) red = Math.max(red, a * (1 - smooth(0, r, d))); }
    // nails: dorsal side of the last phalanx, near the tip
    let nail = 0;
    for (const tp of tips) {
      const ax = norm(sub(tp.t, tp.h)), L = len(sub(tp.t, tp.h));
      const u = dot(sub(p, tp.h), ax) / L;
      if (u < 0.15 || u > 1.25) continue;
      const rr = len(sub(sub(p, tp.h), mul(ax, u * L)));
      const nrm = get3(restN, i);
      const dorsal = tp.toe ? [0, 1, 0] : restDorsal[tp.s];
      const up = dot(nrm, dorsal);
      if (rr < 0.012 && up > 0.35) nail = Math.max(nail, smooth(0.35, 0.6, up) * smooth(0.25, 0.5, u) * (1 - smooth(1.05, 1.22, u)));
    }
    const lips = wOf(i, ORIS) > 0.45 ? smooth(0.45, 0.75, wOf(i, ORIS)) : 0;
    // T-zone: forehead centre, the line of the nose, the chin point (a little oilier, glossier)
    let oil = 0;
    if (isHeadV[i] && p[2] > eyeR[2] - 0.02) {
      const ec = lerp3(eyeR, eyeL, 0.5);
      const fore = (1 - smooth(0.02, 0.045, Math.abs(p[0]))) * smooth(ec[1] + 0.02, ec[1] + 0.035, p[1]) * (1 - smooth(ec[1] + 0.06, ec[1] + 0.08, p[1]));
      const br = add(ec, [0, 0.004, 0.012]);
      const ax = sub(nose, br), L = len(ax), t = clamp(dot(sub(p, br), ax) / (L * L), 0, 1.15);
      const noseL = 1 - smooth(0.006, 0.016, len(sub(p, add(br, mul(ax, t)))));
      const chin = (1 - smooth(0.008, 0.02, Math.abs(p[0]))) * (1 - smooth(0.01, 0.025, Math.abs(p[1] - (ec[1] - 0.105))));
      oil = Math.max(fore * 0.75, noseL, chin * 0.45);
    }
    bodyAux.set([0.5 + 0.5 * brow - 0.5 * lips, red, nail, oil], i * 4);
  }
}

// ============================================================== clothing regions (rest frame)
const armSet = (s) => new Set(order.filter((n) => new RegExp(`^(upperarm|lowerarm|wrist|finger|metacarpal)\\S*\\.${s}$`).test(n)));
const legSet = (s) => new Set(order.filter((n) => new RegExp(`^(upperleg|lowerleg|foot|toe)\\S*\\.${s}$`).test(n)));
const ARM = { L: armSet('L'), R: armSet('R') }, LEG = { L: legSet('L'), R: legSet('R') };
const hipY = B['upperleg01.L'].h[1];
const HEM_Y = hipY + 0.045, WAIST_Y = hipY + 0.13;
const neckBase = B['neck01'].h;
const inShirt = new Uint8Array(NV), inShorts = new Uint8Array(NV);
const tArmOf = new Float64Array(NV), tLegOf = new Float64Array(NV);
for (let i = 0; i < 13380; i++) {
  const p = get3(V0, i);
  if (isHeadV[i] || hairV[i]) continue;
  let arm = null, leg = null;
  for (const s of ['L', 'R']) { if (wOf(i, ARM[s]) > 0.5) arm = s; if (wOf(i, LEG[s]) > 0.5) leg = s; }
  if (arm) {
    const a = B[`upperarm01.${arm}`].h, e = B[`lowerarm01.${arm}`].h;
    const t = dot(sub(p, a), norm(sub(e, a))) / len(sub(e, a));
    tArmOf[i] = t;
    if (t < 0.43) inShirt[i] = 1;
    continue;
  }
  if (leg) {
    const h = B[`upperleg01.${leg}`].h, k = B[`lowerleg01.${leg}`].h;
    const t = dot(sub(p, h), norm(sub(k, h))) / len(sub(k, h));
    tLegOf[i] = t;
    if (t < 0.83) inShorts[i] = 1;
    continue;
  }
  if (wOf(i, NECK) > 0.55) continue;
  // crew neckline: sits low in front (just above the sternal notch), higher at the back
  const front = clamp((p[2] - neckBase[2]) / 0.06, 0, 1);
  const yN = neckBase[1] + 0.004 - 0.034 * Math.pow(front, 1.4);
  if (Math.abs(p[0]) < 0.085 && p[1] > yN - 0.012 * Math.abs(p[0]) / 0.085) continue;
  if (p[1] > HEM_Y) inShirt[i] = 1;
  if (p[1] < WAIST_Y) inShorts[i] = 1;
}
const shirtFaceIdx = [], shortsFaceIdx = [];
bodyFaces.forEach((f, fi) => { if (f.every((v) => inShirt[v])) shirtFaceIdx.push(fi); if (f.every((v) => inShorts[v])) shortsFaceIdx.push(fi); });
log('shirt faces', shirtFaceIdx.length, 'shorts faces', shortsFaceIdx.length);

// ============================================================== drape: offset shell relaxed against the posed body
const bodyNposed = vertexNormals(Pp, bodyFaces, NV);
const bodyPts = new Float64Array(13380 * 3); for (let i = 0; i < 13380; i++) set3(bodyPts, i, get3(Pp, i));
const bodyGrid = pointGrid(bodyPts, 0.02);
/** Signed distance to the posed body, from the nearest few vertices' tangent planes. */
function bodySD(p, r = 0.05) {
  const ids = bodyGrid.near(p, r);
  let best = null, bd = Infinity;
  for (const i of ids) { const d2 = (bodyPts[i * 3] - p[0]) ** 2 + (bodyPts[i * 3 + 1] - p[1]) ** 2 + (bodyPts[i * 3 + 2] - p[2]) ** 2; if (d2 < bd) { bd = d2; best = i; } }
  if (best === null) return { d: r, n: UP };
  const n = get3(bodyNposed, best);
  return { d: dot(sub(p, get3(bodyPts, best)), n), n, i: best };
}
function drape(faceIdx, opt) {
  const faces0 = faceIdx.map((fi) => bodyFaces[fi]);
  const c = compact(Pp, faces0);
  const n = c.P.length / 3;
  const src = new Int32Array(n); for (const [o, j] of c.map) src[j] = o;
  const P = new Float64Array(c.P.length);
  for (let j = 0; j < n; j++) set3(P, j, add(get3(Pp, src[j]), mul(get3(bodyNposed, src[j]), opt.gap0(src[j]))));
  const adj = adjacency(c.faces, n);
  const be = boundaryEdges(c.faces);
  const isB = new Uint8Array(n); const badj = Array.from({ length: n }, () => []);
  for (const [a, b] of be) { isB[a] = 1; isB[b] = 1; badj[a].push(b); badj[b].push(a); }
  const edges = []; for (let a = 0; a < n; a++) for (const b of adj[a]) if (a < b) edges.push([a, b, len(sub(get3(P, a), get3(P, b)))]);
  const tmp = new Float64Array(P.length);
  for (let it = 0; it < opt.iters; it++) {
    // smoothing (bending stiffness stand-in: the cloth bridges hollows instead of following them)
    tmp.set(P);
    for (let a = 0; a < n; a++) {
      const nb = isB[a] ? badj[a] : adj[a];
      if (!nb.length) continue;
      const m = [0, 0, 0]; for (const b of nb) { m[0] += tmp[b * 3]; m[1] += tmp[b * 3 + 1]; m[2] += tmp[b * 3 + 2]; }
      const lam = (isB[a] ? opt.lamB : opt.lam) * opt.stiff(src[a]);
      for (let k = 0; k < 3; k++) P[a * 3 + k] += lam * (m[k] / nb.length - tmp[a * 3 + k]);
      P[a * 3 + 1] -= opt.grav * opt.hang(src[a]);
    }
    // inextensibility (cloth may bunch, not stretch)
    for (let r = 0; r < 2; r++) for (const [a, b, L0] of edges) {
      const pa = get3(P, a), pb = get3(P, b), d = sub(pb, pa), L = len(d), Lm = L0 * opt.stretch;
      if (L > Lm) { const k = (L - Lm) / L * 0.5; set3(P, a, add(pa, mul(d, k))); set3(P, b, sub(pb, mul(d, k))); }
    }
    if (opt.curtain && it >= 15 && it % 6 === 0) opt.curtain(P, src);
    // collision with the body
    for (let a = 0; a < n; a++) {
      const p = get3(P, a);
      const { d, n: nn } = bodySD(p);
      const g = opt.gapMin(src[a]);
      if (d < g) set3(P, a, add(p, mul(nn, g - d)));
    }
  }
  return { P, faces: c.faces, src, isB, be };
}
const shirtStiff = (i) => 1;
/** A loose T-shirt hangs from the chest and shoulder blades: below the armpits it may only taper inwards slowly. */
function curtainFn(P, src) {
  const NBIN = 56, K = 0.3;
  const yTop = head('spine01')[1] - 0.06;
  const c0 = head('spine05'), c1 = head('spine01');
  const centre = (y) => { const t = clamp((y - c0[1]) / (c1[1] - c0[1]), 0, 1); return lerp3(c0, c1, t); };
  const bins = Array.from({ length: NBIN }, () => []);
  for (let a = 0; a < P.length / 3; a++) {
    const o = src[a];
    if (tArmOf[o] !== 0) continue; // sleeves
    const p = get3(P, a);
    if (p[1] > yTop) continue;
    const c = centre(p[1]);
    const th = Math.atan2(p[2] - c[2], p[0] - c[0]);
    bins[((Math.floor(((th + Math.PI) / (2 * Math.PI)) * NBIN) % NBIN) + NBIN) % NBIN].push(a);
  }
  for (const b of bins) {
    b.sort((x, y) => P[y * 3 + 1] - P[x * 3 + 1]);
    let best = -1, py = 0;
    for (const a of b) {
      const p = get3(P, a), c = centre(p[1]);
      const d = [p[0] - c[0], 0, p[2] - c[2]], r = len(d);
      if (best > 0) best -= K * (py - p[1]);
      py = p[1];
      // under the raised right arm the armpit sits high and wide: hanging the cloth straight down from
      // there made a sack-like bulge over the ribs, so on that side the drop may only stand a little off the body
      let want = best;
      if (p[0] < c[0] - 0.02) { const bi = bodySD(p).i; if (bi !== undefined) { const q = get3(bodyPts, bi); want = Math.min(want, Math.hypot(q[0] - c[0], q[2] - c[2]) + 0.016); } }
      if (r < want) { const nd = mul(d, want / r); set3(P, a, [c[0] + nd[0], p[1], c[2] + nd[2]]); }
      best = Math.max(best, Math.max(r, best));
    }
  }
}
const shirt = drape(shirtFaceIdx, {
  gap0: (i) => 0.006 + 0.006 * smooth(0.45, 0.2, (V0[i * 3 + 1] - hipY) / 0.5),
  gapMin: (i) => (V0[i * 3 + 1] < WAIST_Y + 0.03 ? 0.013 : 0.0035), iters: 80, lam: 0.34, lamB: 0.25, grav: 0.00025, stretch: 1.08,
  curtain: curtainFn,
  stiff: shirtStiff, hang: (i) => smooth(0.38, 0.12, V0[i * 3 + 1] - hipY),
});
const ARMPIT_R = add(head('upperarm01.R'), [0.01, -0.035, 0]);
/** Weight of the raised-arm armpit smoothing region (0 near the cloth openings). */
const armpitW = (p, dOpen) => (1 - smooth(0.07, 0.15, len(sub(p, ARMPIT_R)))) * smooth(0.006, 0.03, dOpen);
{
  // Raised right arm: the skinned body bunches into lumps round the armpit and the cloth followed them
  // (a knot at the front fold, a bulge over the lat). Real jersey bridges that: Taubin-smooth the shirt
  // there (no shrinkage) and let it sink a few mm into the body where the body is hidden under it, away
  // from the openings. The hand, hat and everything the anchor depends on are untouched.
  const A = ARMPIT_R;
  const n = shirt.P.length / 3, P = shirt.P;
  const adj = adjacency(shirt.faces, n);
  const dOpen = seededDist(P, shirt.faces, [...new Set(shirt.be.flat())]);
  const Wt = new Float64Array(n);
  for (let j = 0; j < n; j++) Wt[j] = armpitW(get3(P, j), dOpen[j]);
  for (let it = 0; it < 40; it++) for (const lam of [0.55, -0.58]) {
    const t = P.slice();
    for (let j = 0; j < n; j++) {
      if (Wt[j] <= 0) continue;
      const m = [0, 0, 0]; for (const k of adj[j]) { m[0] += t[k * 3]; m[1] += t[k * 3 + 1]; m[2] += t[k * 3 + 2]; }
      const w = lam * Wt[j] / adj[j].length;
      for (let c = 0; c < 3; c++) P[j * 3 + c] += w * (m[c] - adj[j].length * t[j * 3 + c]);
    }
  }
  for (let j = 0; j < n; j++) {
    if (Wt[j] <= 0) continue;
    const p = get3(P, j); const { d, n: nn } = bodySD(p);
    const g = mix1(0.0035, -0.006, smooth(0.035, 0.07, dOpen[j]));
    if (d < g) set3(P, j, add(p, mul(nn, g - d)));
  }
}
function mix1(a, b, t) { return a + (b - a) * t; }
const shorts = drape(shortsFaceIdx, {
  gap0: (i) => 0.007, gapMin: (i) => 0.0035 + 0.003 * smooth(0.3, 0.8, tLegOf[i]), iters: 70, lam: 0.34, lamB: 0.25, grav: 0.0003, stretch: 1.07,
  stiff: () => 1, hang: (i) => smooth(0.15, 0.6, tLegOf[i]),
});
log('draped');
if (DBG) {
  const sh = head('upperarm01.R'), hist = {};
  for (let j = 0; j < shirt.P.length / 3; j++) {
    const p = get3(shirt.P, j); const dd = len(sub(p, sh)); if (dd > 0.16) continue;
    const g = bodySD(p).d; const k = (Math.round(g * 200) / 200).toFixed(3); hist[k] = (hist[k] || 0) + 1;
  }
  log('shirt gap near R shoulder (m → count)', JSON.stringify(hist));
}

// body faces hidden under the clothes (keep a few rings inside each opening, and the hair shell replaces the scalp)
const covered = new Uint8Array(NV);
for (let i = 0; i < NV; i++) covered[i] = inShirt[i] || inShorts[i] ? 1 : 0;
{
  // ring distance from the edge of the covered region
  const adjB = adjacency(bodyFaces, NV);
  const ring = new Int32Array(NV).fill(99);
  let front = [];
  for (let i = 0; i < 13380; i++) if (covered[i] && adjB[i].some((j) => !covered[j])) { ring[i] = 0; front.push(i); }
  for (let r = 1; r <= 4; r++) { const nf = []; for (const v of front) for (const u of adjB[v]) if (covered[u] && ring[u] > r) { ring[u] = r; nf.push(u); } front = nf; }
  for (let i = 0; i < NV; i++) if (ring[i] < 3) covered[i] = 0;
}
const visBodyFaces = bodyFaces.filter((f, fi) => !hairFaceSet.has(fi) && !f.every((v) => covered[v]));
log('visible body faces', visBodyFaces.length, 'of', bodyFaces.length);

// ============================================================== assemble parts (posed metres)
// material ids: 0 skin, 3 eye, 4 hair, 5 shirt, 6 straw, 7 hat band, 8 hat lining, 9 glasses frame, 10 lens, 11 shorts
function loops(faces) {
  const be = boundaryEdges(faces);
  // orient boundary edges as they appear in faces (face on the left)
  const dir = new Map();
  for (const f of faces) for (let k = 0; k < f.length; k++) dir.set(f[k] * 1e6 + f[(k + 1) % f.length], 1);
  const next = new Map();
  for (const [a, b] of be) { if (dir.has(a * 1e6 + b)) next.set(a, b); else next.set(b, a); }
  const seen = new Set(), out = [];
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const L = []; let v = s;
    while (v !== undefined && !seen.has(v)) { seen.add(v); L.push(v); v = next.get(v); }
    out.push(L);
  }
  return out;
}
function seededDist(P, faces, seeds) {
  const adj = adjacency(faces, P.length / 3);
  const D = new Float64Array(P.length / 3).fill(1e9);
  let front = [...seeds]; for (const v of front) D[v] = 0;
  for (let it = 0; it < 400 && front.length; it++) {
    const nf = new Set();
    for (const v of front) for (const u of adj[v]) { const d = D[v] + len(sub(get3(P, u), get3(P, v))); if (d < D[u] - 1e-9) { D[u] = d; nf.add(u); } }
    front = [...nf];
  }
  return D;
}
const loopInfo = (P, L) => { const c = [0, 0, 0]; let per = 0; L.forEach((v, k) => { const p = get3(P, v); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; per += len(sub(p, get3(P, L[(k + 1) % L.length]))); }); return { c: mul(c, 1 / L.length), per, L }; };

/** Cloth finishing at a resolution: folds, flare, aux channels, flutter. kind: 'shirt' | 'shorts'. */
function finishCloth(P, faces, kind) {
  const n = P.length / 3;
  const N0 = vertexNormals(P, faces, n);
  const Ls = loops(faces).map((L) => loopInfo(P, L)).sort((a, b) => b.per - a.per);
  const aux = new Float64Array(n * 4), flut = new Float64Array(n);
  const disp = new Float64Array(n * 3);
  const openD = seededDist(P, faces, [...new Set(boundaryEdges(faces).flat())]);
  if (kind === 'shirt') {
    const hem = Ls[0];
    const rest = Ls.slice(1).sort((a, b) => Math.abs(b.c[0]) - Math.abs(a.c[0]));
    const sleeves = rest.slice(0, 2), neck = rest[2];
    const dH = seededDist(P, faces, hem.L), dN = neck ? seededDist(P, faces, neck.L) : new Float64Array(n).fill(1);
    const dS = sleeves.map((s) => seededDist(P, faces, s.L));
    const sleeveAxis = sleeves.map((s) => { const sd = s.c[0] < 0 ? 'R' : 'L'; return { sd, a: norm(sub(head(`lowerarm01.${sd}`), head(`upperarm01.${sd}`))), o: head(`upperarm01.${sd}`) }; });
    const tc = hem.c;
    for (let i = 0; i < n; i++) {
      const p = get3(P, i), nn = get3(N0, i);
      let d = [0, 0, 0];
      const dh = dH[i];
      // torso: vertical folds hanging towards the hem, the hem flaring a little
      const th = Math.atan2(p[2] - tc[2], p[0] - tc[0]);
      const ft = 1 - smooth(0.0, 0.3, dh);
      const fold = Math.sin(th * 9 + 1.6 * Math.sin(th * 3 + 0.4) + 0.5) * 0.7 + 0.3 * Math.sin(th * 17 + 2.0);
      d = add(d, mul(nn, 0.0042 * ft * fold));
      const rad2 = norm([p[0] - tc[0], 0, p[2] - tc[2]]);
      d = add(d, mul(rad2, 0.007 * (1 - smooth(0, 0.06, dh))));
      let sl = 0, foldS = 0;
      dS.forEach((D, k) => {
        const ds = D[i]; if (ds > 0.1) return;
        const ax = sleeveAxis[k];
        const q = sub(p, ax.o), r = sub(q, mul(ax.a, dot(q, ax.a)));
        const ref = norm(cross(ax.a, FWD)), ref2 = cross(ax.a, ref);
        const a = Math.atan2(dot(r, ref2), dot(r, ref));
        const f = 1 - smooth(0, 0.075, ds);
        const fs = Math.sin(a * 5 + 1.2 * Math.sin(a * 2)) * f;
        d = add(d, add(mul(nn, 0.003 * fs), mul(norm(r), 0.006 * (1 - smooth(0, 0.045, ds)))));
        sl = Math.max(sl, f); foldS += fs;
      });
      for (let c = 0; c < 3; c++) disp[i * 3 + c] = d[c];
      const minD = Math.min(dh, dN[i], ...dS.map((D) => D[i]));
      const chest = smooth(0.42, 0.25, p[1] - hipY) * (1 - smooth(0.6, 0.66, p[1] - hipY));
      aux.set([chest * (1 - smooth(0.1, 0.13, Math.abs(p[0] - tc[0]))) , 0, 1 - smooth(0.0, 0.022, minD), clamp(0.5 + 0.5 * (fold * ft * 0.8 + foldS * 0.5), 0, 1)], i * 4);
      flut[i] = Math.max(1 - smooth(0.0, 0.14, dh), sl * 0.8);
    }
  } else {
    const waist = Ls[0];
    const legs = Ls.slice(1, 3);
    const dW = seededDist(P, faces, waist.L);
    const dL = legs.map((l) => seededDist(P, faces, l.L));
    const legAx = legs.map((l) => { const sd = l.c[0] < 0 ? 'R' : 'L'; return { sd, a: norm(sub(head(`lowerleg01.${sd}`), head(`upperleg01.${sd}`))), o: head(`upperleg01.${sd}`) }; });
    for (let i = 0; i < n; i++) {
      const p = get3(P, i), nn = get3(N0, i);
      let d = [0, 0, 0], fl = 0, panel = 0, fold = 0;
      const sd = p[0] < rootOffset[0] ? 'R' : 'L';
      dL.forEach((D, k) => {
        const dl = D[i]; const ax = legAx[k];
        const q = sub(p, ax.o), r = sub(q, mul(ax.a, dot(q, ax.a)));
        if (ax.sd === sd) {
          const ref = norm(cross(ax.a, FWD)), ref2 = cross(ax.a, ref);
          const a = Math.atan2(dot(r, ref2), dot(r, ref));
          const f = 1 - smooth(0, 0.16, dl);
          const fs = Math.sin(a * 6 + 1.3 * Math.sin(a * 2 + 1)) * 0.75 + 0.25 * Math.sin(a * 13);
          d = add(d, add(mul(nn, 0.004 * fs * f), mul(norm([r[0], 0, r[2]]), 0.011 * (1 - smooth(0, 0.08, dl)))));
          fl = Math.max(fl, 1 - smooth(0, 0.12, dl)); fold = fs * f;
          const lat = sd === 'R' ? -1 : 1;
          panel = smooth(0.84, 0.9, dot(norm([r[0], 0, r[2]]), [lat, 0, 0]));
        }
      });
      for (let c = 0; c < 3; c++) disp[i * 3 + c] = d[c];
      const minD = Math.min(dW[i], ...dL.map((D) => D[i]));
      aux.set([0, panel, 1 - smooth(0.0, 0.03, minD), clamp(0.5 + 0.5 * fold, 0, 1)], i * 4);
      flut[i] = fl * 0.7;
    }
  }
  for (let i = 0; i < n * 3; i++) P[i] += disp[i];
  // make sure the folds did not push cloth into the body
  for (let i = 0; i < n; i++) {
    const p = get3(P, i); const { d, n: nn } = bodySD(p);
    // (the smoothed raised-arm armpit may sit a little inside the hidden body: keep it there)
    const g = kind === 'shirt' ? mix1(0.0025, -0.006, armpitW(p, openD[i]) * smooth(0.035, 0.07, openD[i])) : 0.0025;
    if (d < g) set3(P, i, add(p, mul(nn, g - d)));
  }
  return { aux, flut };
}

/** Thickness band round every opening of a cloth shell (duplicated rim + inner ring). */
function addLips(part, th) {
  const { P } = part;
  const n = P.length / 3;
  const N = vertexNormals(P, part.faces, n);
  const Ls = loops(part.faces);
  const extraP = [], extraAux = [], extraFl = [], extraF = [];
  let base = n;
  for (const L of Ls) {
    const m = L.length;
    const idxOuter = [], idxInner = [];
    for (const v of L) {
      const p = get3(P, v), nn = get3(N, v);
      idxOuter.push(base++); extraP.push(...p);
      idxInner.push(base++); extraP.push(...sub(p, mul(nn, th)));
      for (let r = 0; r < 2; r++) { extraAux.push(part.aux[v * 4], part.aux[v * 4 + 1], 1, part.aux[v * 4 + 3]); extraFl.push(part.flut[v]); }
    }
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      // boundary runs with the cloth on its left: (a, b, b', a') faces away from the cloth
      extraF.push([idxOuter[k2], idxOuter[k], idxInner[k], idxInner[k2]]);
    }
  }
  const P2 = new Float64Array(base * 3); P2.set(P); P2.set(extraP, n * 3);
  const A2 = new Float64Array(base * 4); A2.set(part.aux); A2.set(extraAux, n * 4);
  const F2 = new Float64Array(base); F2.set(part.flut); F2.set(extraFl, n);
  return { ...part, P: P2, aux: A2, flut: F2, faces: [...part.faces, ...extraF], fids: [...part.fids, ...extraF.map(() => part.fids[0])] };
}

function buildTier(hi) {
  const parts = [];
  let fur = null; // appended last so the other parts keep the same index in both tiers
  // --- body + eyes
  {
    const faces = [...visBodyFaces, ...eyeFaces];
    const fids = [...visBodyFaces.map(() => 0), ...eyeFaces.map(() => 3)];
    const c = compact(Pp, faces);
    const n = c.P.length / 3;
    const aux = new Float64Array(n * 4);
    for (const [o, j] of c.map) for (let k = 0; k < 4; k++) aux[j * 4 + k] = bodyAux[o * 4 + k];
    // skin never flutters: its flutter channel carries the hairline distance (painted short hair)
    const sdc = new Float64Array(n);
    for (const [o, j] of c.map) sdc[j] = o < NV ? encSD(hairSD[o]) : 0;
    let P = c.P, F = c.faces, I = fids, A = aux, S = sdc;
    if (hi) { const r = catmullClark(P, F, I, [A, S]); P = r.P; F = r.faces; I = r.fids; A = r.chans[0]; S = r.chans[1]; }
    parts.push({ name: 'body', P, faces: F, fids: I, aux: A, flut: S, side: 'front' });
  }
  // --- hair shell (offset in posed space so its edge meets the scalp exactly)
  {
    const faces = hairFaceIdx.map((fi) => bodyFaces[fi]);
    const c = compact(Pp, faces);
    const n = c.P.length / 3;
    const aux = new Float64Array(n * 4);
    for (const [o, j] of c.map) {
      const jj = hairShell.map.get(o);
      const off = len(sub(get3(hairShell.P, jj), get3(V0, o)));
      set3(c.P, j, add(get3(Pp, o), mul(get3(bodyNposed, o), off)));
      // aux: x = shell height above the scalp (m, /0.01), y = hairline distance, z = fur layer (0 = base shell)
      aux[j * 4] = clamp(off / 0.01, 0, 1);
      aux[j * 4 + 1] = encSD(hairSD[o]);
    }
    let P = c.P, F = c.faces, I = c.faces.map(() => 4), A = aux;
    if (hi) { const r = catmullClark(P, F, I, [A]); P = r.P; F = r.faces; I = r.fids; A = r.chans[0]; }
    parts.push({ name: 'hair', P, faces: F, fids: I, aux: A, flut: new Float64Array(P.length / 3), side: 'front' });
    if (hi) {
      // fur shells (high tier only): three more layers above the hair shell, alpha-tested in the shader
      // into strand clumps, so the silhouette and the hairline break up instead of reading as a painted cap.
      // They taper to nothing at the hairline. Kept out of the AO/thickness ray caster (see allHi).
      const n2 = P.length / 3;
      const N = vertexNormals(P, F, n2);
      const NL = 3;
      const FP = new Float64Array(n2 * 3 * NL), FA = new Float64Array(n2 * 4 * NL), FF = [];
      for (let k = 1; k <= NL; k++) {
        const b = (k - 1) * n2;
        for (let i = 0; i < n2; i++) {
          const sd = (A[i * 4 + 1] - 0.5) * 0.04;
          const ramp = smooth(0.0, 0.012, sd);
          set3(FP, b + i, add(get3(P, i), mul(get3(N, i), 0.0014 * k * (0.35 + 0.65 * ramp))));
          FA.set([A[i * 4], A[i * 4 + 1], k / NL, 0], (b + i) * 4);
        }
        for (const f of F) FF.push(f.map((v) => v + b));
      }
      fur = ({ name: 'hairfur', P: FP, faces: FF, fids: FF.map(() => 4), aux: FA, flut: new Float64Array(n2 * NL), side: 'front', noOcclude: true });
    }
  }
  // --- clothes
  for (const [name, cl, mat] of [['shirt', shirt, 5], ['shorts', shorts, 11]]) {
    let P = cl.P.slice(), F = cl.faces, I = cl.faces.map(() => mat);
    if (hi) { const r = catmullClark(P, F, I); P = r.P; F = r.faces; I = r.fids; }
    const { aux, flut } = finishCloth(P, F, name);
    parts.push(addLips({ name, P, faces: F, fids: I, aux, flut, side: 'double' }, name === 'shirt' ? 0.0024 : 0.003));
  }
  // --- hat
  {
    const h = hi ? hatHi : hatMesh(56, 0.5);
    const P = hatWorld(h);
    const n = P.length / 3;
    const aux = new Float64Array(n * 4), flut = new Float64Array(n);
    for (let i = 0; i < n; i++) { const s = h.prm[i * 2]; aux.set([0, Math.max(s, 0), h.prm[i * 2 + 1], s < -0.75 ? 1 : 0], i * 4); flut[i] = s > 0 ? s * s : 0; }
    parts.push({ name: 'hat', P, faces: h.faces, fids: h.fids, aux, flut, vmat: h.mat, side: 'front' });
  }
  // --- sunglasses
  for (const g of glassesMesh(hi ? 40 : 20, hi ? 4 : 2)) {
    const P = new Float64Array(g.P.length * 3); g.P.forEach((p, i) => set3(P, i, restToHead(p)));
    parts.push({ name: g.mat === 10 ? 'lens' : 'frame', P, faces: g.faces, fids: g.faces.map(() => g.mat), aux: new Float64Array(g.P.length * 4), flut: new Float64Array(g.P.length), side: g.mat === 10 ? 'double' : 'front' });
  }
  if (fur) parts.push(fur);
  return parts;
}
log('building tiers');
const tiers = { high: buildTier(true), low: buildTier(false) };
// low tier body and hair: put each cage vertex on its Catmull–Clark vertex point (it then lies on the
// high-tier surface, so both tiers agree at the anchor; the cage itself floats a little outside)
for (const k of [0, 1]) tiers.low[k].P.set(tiers.high[k].P.subarray(0, tiers.low[k].P.length));
for (const [k, parts] of Object.entries(tiers)) log(k, parts.map((p) => `${p.name}:${p.P.length / 3}v/${p.faces.length}f`).join(' '));

// ============================================================== frame: anchor at the origin, units of 1.7 m
const UNIT = 1.7;
const solePosed = (() => { let m = 1e9; for (let i = 0; i < 13380; i++) m = Math.min(m, Pp[i * 3 + 1]); return m; })();
const topPosed = (() => { let m = -1e9; for (let i = 0; i < 13380; i++) if (isHeadV[i] || hairV[i]) m = Math.max(m, Pp[i * 3 + 1]); return m; })();
const SCALE = 1.7 / (topPosed - solePosed); // person (sole → crown of the head) is exactly 1.7 m
log('posed height', (topPosed - solePosed).toFixed(4), 'scale', SCALE.toFixed(4));

// exact anchor on the high-resolution surface: straight down onto the back of the hand
const hiBody = tiers.high[0];
const hiTris = triangulate(hiBody.P, hiBody.faces);
const bvhBody = buildBVH(hiBody.P, hiTris);
const a0 = anchor0.p;
const tHit = bvhBody.cast([a0[0], a0[1] + 0.05, a0[2]], [0, -1, 0], 0, 0.2);
const anchorP = [a0[0], a0[1] + 0.05 - tHit, a0[2]];
// smoothed normal of the high surface over a 12 mm disc around it
const hiN = vertexNormals(hiBody.P, hiBody.faces, hiBody.P.length / 3);
let anN = [0, 0, 0];
for (let i = 0; i < hiBody.P.length / 3; i++) { const d = len(sub(get3(hiBody.P, i), anchorP)); if (d < 0.012) anN = add(anN, mul(get3(hiN, i), 1 - d / 0.012)); }
anN = norm(anN);
const qFix = qFromTo(anN, UP); // residual (< 1°) tilt so the anchor normal is exactly +Y
log('anchor hi', anchorP.map((v) => v.toFixed(4)), 'normal', anN.map((v) => v.toFixed(4)), 'residual tilt', (Math.acos(clamp(anN[1], -1, 1)) * 180 / Math.PI).toFixed(3), 'deg');
const toUnits = (p) => mul(qRot(qFix, sub(p, anchorP)), SCALE / UNIT);
const dirToU = (d) => qRot(qFix, d);

// ============================================================== AO + thickness (ray traced on the high tier)
function hemiDirs(n) {
  const out = []; const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const z = 1 - (i + 0.5) / n; const r = Math.sqrt(1 - z); const ph = i * ga; out.push([Math.cos(ph) * r, Math.sin(ph) * r, Math.sqrt(z)]); } // cosine-ish
  return out;
}
const allHi = (() => {
  let nv = 0; const T = []; const Ps = [];
  for (const p of tiers.high) { if (p.noOcclude) continue; const t = triangulate(p.P, p.faces); for (const v of t) T.push(v + nv); nv += p.P.length / 3; Ps.push(p.P); }
  const P = new Float64Array(nv * 3); let o = 0; for (const a of Ps) { P.set(a, o); o += a.length; }
  return { P, T };
})();
const bvhAll = buildBVH(allHi.P, allHi.T);
const GROUND = solePosed;
function bakeAO(part, nrm, rays, isLow) {
  const n = part.P.length / 3;
  const ao = new Float64Array(n), thick = new Float64Array(n);
  const dirs = hemiDirs(rays);
  const R = 0.32;
  for (let i = 0; i < n; i++) {
    const p = get3(part.P, i), nn = get3(nrm, i);
    const t1 = norm(Math.abs(nn[1]) < 0.9 ? cross(nn, UP) : cross(nn, LAT)), t2 = cross(nn, t1);
    const rot = (i * 0.618034) % 1 * 2 * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    const o = add(p, mul(nn, isLow ? 0.004 : 0.0012));
    let occ = 0;
    for (const d0 of dirs) {
      const x = d0[0] * cr - d0[1] * sr, y = d0[0] * sr + d0[1] * cr;
      const d = add(add(mul(t1, x), mul(t2, y)), mul(nn, d0[2]));
      let t = bvhAll.cast(o, d, 0.0004, R);
      if (d[1] < -1e-4) { const tg = (GROUND - o[1]) / d[1]; if (tg > 0 && tg < t) t = tg; }
      if (t < R) occ += Math.pow(1 - t / R, 1.5);
    }
    ao[i] = 1 - occ / rays;
    if (part.name === 'body') {
      const tt = bvhBody.cast(sub(p, mul(nn, isLow ? 0.0 : 0.0006)), mul(nn, -1), 0.0003, 0.08);
      thick[i] = Math.min(tt, 0.08);
    } else thick[i] = part.name === 'hat' ? 0.004 : part.name.startsWith('hair') ? 0.01 : 0.002;
  }
  if (part.name === 'body') {
    // single rays through thin folds (the ear's helix, between fingers) are noisy vertex to vertex,
    // which showed as speckle in the translucency: relax the thickness over the mesh (min-biased so
    // thin edges stay thin)
    const adj = adjacency(part.faces, n);
    for (let it = 0; it < 4; it++) {
      const c = thick.slice();
      for (let i = 0; i < n; i++) { let s = c[i] * 2, w = 2; for (const j of adj[i]) { s += c[j]; w++; } thick[i] = Math.min(s / w, c[i] * 1.6); }
    }
  }
  return { ao, thick };
}

// ============================================================== write
fs.mkdirSync(OUT, { recursive: true });
const manifest = { version: 1, unitMeters: UNIT, source: 'MakeHuman hm08 base mesh + default skeleton/weights (CC0)', tiers: {} };
function octEnc(n) {
  const l1 = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  let x = n[0] / l1, y = n[1] / l1;
  if (n[2] < 0) { const ox = x, oy = y; x = (1 - Math.abs(oy)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(oy || 1); }
  return [x, y];
}
let bounds = null;
const hiBakes = [];
for (const [tier, parts] of Object.entries(tiers)) {
  const hi = tier === 'high';
  const geos = {};
  for (const sideK of ['front', 'double']) {
    const ps = parts.filter((p) => p.side === sideK);
    const P = [], N = [], AT = [], AX = [], IDX = [];
    let base = 0;
    for (const part of ps) {
      const n = part.P.length / 3;
      const nrm = vertexNormals(part.P, part.faces, n);
      const pi = parts.indexOf(part);
      let ao, thick;
      if (hi) { ({ ao, thick } = bakeAO(part, nrm, 40, false)); hiBakes[pi] = { P: part.P, ao, thick, grid: pointGrid(part.P, 0.01) }; }
      else {
        // the low cage sits off the true surface: take AO and thickness from the nearest high-tier vertex
        const hb = hiBakes[pi];
        ao = new Float64Array(n); thick = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          let j = hb.grid.nearest(get3(part.P, i), 0.02); if (j < 0) j = hb.grid.nearest(get3(part.P, i), 0.08);
          ao[i] = j >= 0 ? hb.ao[j] : 1; thick[i] = j >= 0 ? hb.thick[j] : 0.05;
        }
      }
      const vm = new Float64Array(n);
      if (part.vmat) part.vmat.forEach((m, i) => (vm[i] = m));
      else part.faces.forEach((f, fi) => { for (const v of f) vm[v] = part.fids[fi]; });
      for (let i = 0; i < n; i++) {
        P.push(toUnits(get3(part.P, i)));
        N.push(dirToU(get3(nrm, i)));
        AT.push([ao[i], clamp(thick[i] / 0.06, 0, 1), clamp(part.flut[i], 0, 1), vm[i]]);
        AX.push([part.aux[i * 4], part.aux[i * 4 + 1], part.aux[i * 4 + 2], part.aux[i * 4 + 3]]);
      }
      for (const v of triangulate(part.P, part.faces)) IDX.push(v + base);
      base += n;
      log(tier, sideK, part.name, n, 'verts');
    }
    geos[sideK] = { P, N, AT, AX, IDX };
  }
  // quantisation box over both geometries
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const g of Object.values(geos)) for (const p of g.P) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], p[c]); mx[c] = Math.max(mx[c], p[c]); }
  if (!bounds) bounds = { min: mn, max: mx };
  const ctr = mul(add(mn, mx), 0.5), half = mul(sub(mx, mn), 0.5 * 1.0001);
  const chunks = []; let off = 0;
  const desc = { quant: { offset: ctr, scale: half }, geometries: {} };
  const push = (arr) => { const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (buf.length % 4)) % 4; chunks.push(buf); if (pad) chunks.push(Buffer.alloc(pad)); const o = off; off += buf.length + pad; return o; };
  for (const [k, g] of Object.entries(geos)) {
    const n = g.P.length;
    const pos = new Int16Array(n * 3), nr = new Int16Array(n * 2), at = new Uint8Array(n * 4), ax = new Uint8Array(n * 4);
    g.P.forEach((p, i) => { for (let c = 0; c < 3; c++) pos[i * 3 + c] = Math.round(clamp((p[c] - ctr[c]) / half[c], -1, 1) * 32767); });
    g.N.forEach((v, i) => { const [x, y] = octEnc(norm(v)); nr[i * 2] = Math.round(x * 32767); nr[i * 2 + 1] = Math.round(y * 32767); });
    g.AT.forEach((v, i) => { at[i * 4] = Math.round(clamp(v[0], 0, 1) * 255); at[i * 4 + 1] = Math.round(v[1] * 255); at[i * 4 + 2] = Math.round(v[2] * 255); at[i * 4 + 3] = v[3]; });
    g.AX.forEach((v, i) => { for (let c = 0; c < 4; c++) ax[i * 4 + c] = Math.round(clamp(v[c], 0, 1) * 255); });
    const big = n > 65535;
    const idx = big ? Uint32Array.from(g.IDX) : Uint16Array.from(g.IDX);
    desc.geometries[k] = {
      vertexCount: n, indexCount: idx.length, indexType: big ? 'uint32' : 'uint16',
      position: push(pos), normal: push(nr), attr: push(at), aux: push(ax), index: push(idx),
    };
  }
  const file = `figure_${tier}.bin`;
  fs.writeFileSync(path.join(OUT, file), Buffer.concat(chunks));
  manifest.tiers[tier] = { file, bytes: off, ...desc };
  log('wrote', file, (off / 1024).toFixed(0), 'KiB');
}

// ---------------------------------------------------------------- manifest data (all in units, anchor frame)
const U = (p) => toUnits(p).map((v) => +v.toFixed(5));
const Ud = (d) => norm(dirToU(d)).map((v) => +v.toFixed(5));
const groundU = toUnits([0, GROUND, 0])[1];
const feet = [];
for (const s of ['L', 'R']) {
  const ank = head(`foot.${s}`), toe = head(`toe3-1.${s}`);
  const fd = norm([toe[0] - ank[0], 0, toe[2] - ank[2]]);
  const c = add(ank, mul(fd, 0.07));
  const cu = toUnits([c[0], GROUND, c[2]]), du = Ud(fd);
  feet.push(+cu[0].toFixed(5), +cu[2].toFixed(5), du[0], du[2]);
}
// local quadric fit around the anchor for the skin close-up: z = a x² + b x y + c y²
const T_f = norm(sub(HAND_FINGERS, mul(UP, dot(HAND_FINGERS, UP))));
const T_a = cross(UP, T_f); // across the knuckles
{
  let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (let i = 0; i < hiBody.P.length / 3; i++) {
    const q = qRot(qFix, sub(get3(hiBody.P, i), anchorP));
    const x = dot(q, T_f), y = dot(q, T_a), z = q[1];
    if (Math.hypot(x, y) > 0.02 || Math.abs(z) > 0.01) continue;
    if (dot(qRot(qFix, get3(hiN, i)), UP) < 0.7) continue;
    const f = [x * x, x * y, y * y];
    for (let a = 0; a < 3; a++) { r[a] += f[a] * z; for (let b = 0; b < 3; b++) S[a][b] += f[a] * f[b]; }
  }
  // solve 3×3
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(S); const sol = [0, 1, 2].map((k) => det(S.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D);
  manifest.anchorQuadric = { a_xx: sol[0], b_xy: sol[1], c_yy: sol[2], note: 'height above the tangent plane (metres) z = a x² + b x y + c y², x along fingers, y across knuckles (metres)' };
  manifest.anchorRadii = { alongFingersM: sol[0] !== 0 ? -1 / (2 * sol[0]) : null, acrossKnucklesM: sol[2] !== 0 ? -1 / (2 * sol[2]) : null };
}
Object.assign(manifest, {
  heightUnits: +(1.7 / UNIT).toFixed(5),
  heightMeters: 1.7,
  groundY: +groundU.toFixed(5),
  feet, feetFormat: 'per foot [centreX, centreZ, dirX, dirZ] on the ground plane (units, anchor frame); order L, R',
  anchor: { position: [0, 0, 0], normal: [0, 1, 0], tangentFingers: Ud(T_f), tangentAcross: Ud(T_a), acrossPointsTo: 'thumb/index side (left of the fingers direction seen from above)' },
  facing: [0, 0, 1], gaze: Ud(qRot(W['head'].q, [0, 0, 1])),
  yawNote: 'The figure faces +Z. Rotate the group about +Y (through the origin = anchor) by yaw to face direction (sin yaw, 0, cos yaw); e.g. yaw = +90° faces +X.',
  headCentre: U(xf('head', headC)), headTop: U(add(crownTopW, [0, 0, 0])),
  hat: { centre: U(restToHead(fromHat(cx, 0, cz))), axis: Ud(qRot(W['head'].q, hatAxis)), brimRadius: +(BRIM_R * SCALE / UNIT).toFixed(5), crownHeight: +(crownH * SCALE / UNIT).toFixed(5) },
  torso: { chest: U(head('spine02')), pelvis: U(head('spine05')) },
  bounds: { min: bounds.min.map((v) => +v.toFixed(5)), max: bounds.max.map((v) => +v.toFixed(5)) },
  metresToObjectScale: +(SCALE / UNIT).toFixed(6),
  materials: { 0: 'skin', 3: 'eye', 4: 'hair', 5: 'shirt', 6: 'straw', 7: 'hat band', 8: 'hat lining', 9: 'glasses frame', 10: 'lens', 11: 'boardshorts' },
});
{
  // where the low tier's hand surface is at the anchor (it should be ~0)
  const lb = tiers.low[0];
  const bl = buildBVH(lb.P, triangulate(lb.P, lb.faces));
  const t = bl.cast([anchorP[0], anchorP[1] + 0.05, anchorP[2]], [0, -1, 0], 0, 0.2);
  manifest.anchorLowTierOffsetMeters = +(0.05 - t).toFixed(5);
  log('low tier surface at anchor: ', ((0.05 - t) * 1000).toFixed(2), 'mm above the high surface');
}
fs.writeFileSync(path.join(OUT, 'figure.json'), JSON.stringify(manifest, null, 1));
log('feet', feet, 'ground', groundU.toFixed(4), 'radii', manifest.anchorRadii);
log('done');
