/**
 * The helix axis: a long, loosely curving path that leaves the origin exactly along local +X
 * (matching the cell's chromatin fibre) and wanders gently in both directions. Arc-length
 * parameterised, with parallel-transport frames (N, B, T).
 */
import * as THREE from 'three';

export class Curve {
  readonly half: number;
  readonly ds: number;
  readonly n: number;
  readonly P: Float64Array;
  readonly T: Float64Array;
  readonly N: Float64Array;

  constructor(half: number, ds = 0.05) {
    this.half = half;
    this.ds = ds;
    const n = Math.round((2 * half) / ds) + 1;
    this.n = n;
    this.P = new Float64Array(n * 3);
    this.T = new Float64Array(n * 3);
    this.N = new Float64Array(n * 3);

    // dense parametric samples; displacement terms (1 - cos) have zero value and slope at the origin
    const f = (sg: number, o: number[]) => {
      const w = (lam: number, a: number, ph: number) => a * (1 - Math.cos((2 * Math.PI * sg) / lam + ph));
      const y = w(420, 24, 0) + w(150, 5, 0.0) + w(58, 0.7, 0.0) - 0.0;
      const z = w(330, 20, 0) + w(115, 4, 0) + w(47, 0.6, 0);
      o[0] = sg; o[1] = y * 0.9 + 0.35 * z; o[2] = z * 0.9 - 0.35 * y;
    };
    const dsg = 0.02;
    const m = Math.ceil((half * 1.15) / dsg);
    const pts = new Float64Array((2 * m + 1) * 3);
    const tmp = [0, 0, 0];
    for (let i = -m; i <= m; i++) { f(i * dsg, tmp); pts.set(tmp, (i + m) * 3); }
    const arc = new Float64Array(2 * m + 1);
    for (let i = m + 1; i <= 2 * m; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    for (let i = m - 1; i >= 0; i--) arc[i] = arc[i + 1] - Math.hypot(pts[i * 3] - pts[i * 3 + 3], pts[i * 3 + 1] - pts[i * 3 + 4], pts[i * 3 + 2] - pts[i * 3 + 5]);
    // resample uniformly in arc length
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = -half + k * ds;
      while (j < 2 * m - 1 && arc[j + 1] < s) j++;
      const t = (s - arc[j]) / (arc[j + 1] - arc[j] || 1);
      for (let c = 0; c < 3; c++) this.P[k * 3 + c] = pts[j * 3 + c] * (1 - t) + pts[(j + 1) * 3 + c] * t;
    }
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      const t = new THREE.Vector3(this.P[b * 3] - this.P[a * 3], this.P[b * 3 + 1] - this.P[a * 3 + 1], this.P[b * 3 + 2] - this.P[a * 3 + 2]).normalize();
      this.T.set([t.x, t.y, t.z], k * 3);
    }
    // parallel transport outwards from the origin sample
    const mid = Math.round(half / ds);
    const t0 = new THREE.Vector3(this.T[mid * 3], this.T[mid * 3 + 1], this.T[mid * 3 + 2]);
    const n0 = new THREE.Vector3(0, 1, 0).addScaledVector(t0, -t0.y).normalize();
    this.N.set([n0.x, n0.y, n0.z], mid * 3);
    const q = new THREE.Quaternion();
    const tp = new THREE.Vector3(), tc = new THREE.Vector3(), nv = new THREE.Vector3();
    const step = (from: number, to: number) => {
      tp.fromArray(this.T, from * 3); tc.fromArray(this.T, to * 3);
      nv.fromArray(this.N, from * 3);
      q.setFromUnitVectors(tp, tc);
      nv.applyQuaternion(q).addScaledVector(tc, -nv.dot(tc)).normalize();
      this.N.set([nv.x, nv.y, nv.z], to * 3);
    };
    for (let k = mid + 1; k < n; k++) step(k - 1, k);
    for (let k = mid - 1; k >= 0; k--) step(k + 1, k);
  }

  /** Translate the whole path (so a chosen atom lands on the origin). */
  shift(x: number, y: number, z: number) {
    for (let k = 0; k < this.n; k++) { this.P[k * 3] += x; this.P[k * 3 + 1] += y; this.P[k * 3 + 2] += z; }
  }

  /** Centre point and frame at arc length s (clamped). */
  at(s: number, P: THREE.Vector3, T: THREE.Vector3, N: THREE.Vector3, B: THREE.Vector3) {
    const f = Math.min(this.n - 1.001, Math.max(0, (s + this.half) / this.ds));
    const i = Math.floor(f), t = f - i;
    const lerp = (a: Float64Array, o: THREE.Vector3) => o.set(
      a[i * 3] * (1 - t) + a[i * 3 + 3] * t, a[i * 3 + 1] * (1 - t) + a[i * 3 + 4] * t, a[i * 3 + 2] * (1 - t) + a[i * 3 + 5] * t);
    lerp(this.P, P); lerp(this.T, T).normalize(); lerp(this.N, N);
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
  }
}
