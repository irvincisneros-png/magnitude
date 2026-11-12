/**
 * Carbon 1s² 2s² 2p² electron density, as hydrogen-like orbitals with Clementi–Raimondi
 * effective nuclear charges (Z_eff felt by each shell after screening by the others).
 *
 * Local units: 1 unit = 150 pm (the atom's characteristic size), so the Bohr radius
 * a0 = 52.918 pm = 0.35279 units.
 *
 * Radial probability r²|R(r)|² is sampled EXACTLY (no rejection grid):
 *   1s: r²R² ∝ ρ² e^(−2ρ)              → r ~ Gamma(3) · a0 / (2Z)
 *   2s: r²R² ∝ ρ²(2−ρ)² e^(−ρ)         → mixture of Gamma(3,4,5) with exact rejection
 *   2p: r²R² ∝ ρ⁴ e^(−ρ)               → r ~ Gamma(5) · a0 / Z
 * Angular part for 2p along an axis: |Y|² ∝ cos²θ → cosθ = ±U^(1/3).
 */

export const A0 = 52.918 / 150; // Bohr radius in local units
export const Z_1S = 5.6727;
export const Z_2S = 3.2166;
export const Z_2P = 3.1358;

/** Orbital index stored per sample. */
export const ORB_1S = 0;
export const ORB_2S = 1;
export const ORB_2PX = 2;
export const ORB_2PY = 3;

/** Deterministic PRNG so the cloud is identical on every load (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CloudSamples {
  count: number;
  /** xyz per sample, local units, orbital frame (px along x, py along y). */
  pos: Float32Array;
  /** orbital index, sign(ψ)·(relative |ψ|², 0..1], twinkle phase 0..1, random 0..1. */
  data: Float32Array;
}

/**
 * Draw `count` electron-position samples. Electrons are shared 2:2:1:1 between
 * 1s, 2s, 2px and 2py (Hund's rule puts the two 2p electrons in different p orbitals),
 * interleaved randomly so any prefix of the buffer is itself a fair sample.
 */
export function sampleCarbon(count: number, seed = 12): CloudSamples {
  const R = rng(seed);
  const pos = new Float32Array(count * 3);
  const data = new Float32Array(count * 4);
  const gammaInt = (k: number) => {
    let s = 0;
    for (let i = 0; i < k; i++) s -= Math.log(1 - R());
    return s;
  };
  const dir = (out: number[]) => {
    const u = R() * 2 - 1;
    const t = R() * Math.PI * 2;
    const k = Math.sqrt(1 - u * u);
    out[0] = k * Math.cos(t); out[1] = k * Math.sin(t); out[2] = u;
  };
  const d = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    const pick = R() * 6;
    let orb: number;
    let r: number;
    let sign = 1;
    let w = 1; // |ψ|² here relative to the orbital's brightest region (0..1)
    let x: number, y: number, z: number;
    if (pick < 2) {
      orb = ORB_1S;
      r = (gammaInt(3) * A0) / (2 * Z_1S);
      w = Math.exp((-2 * Z_1S * r) / A0);
      dir(d); x = d[0] * r; y = d[1] * r; z = d[2] * r;
    } else if (pick < 4) {
      orb = ORB_2S;
      // proposal (2+ρ)²ρ² e^-ρ = (4ρ² + 4ρ³ + ρ⁴) e^-ρ; component masses 8 : 24 : 24.
      let rho = 0;
      for (;;) {
        const m = R() * 56;
        rho = m < 8 ? gammaInt(3) : m < 32 ? gammaInt(4) : gammaInt(5);
        const acc = (2 - rho) / (2 + rho);
        if (R() < acc * acc) break;
      }
      r = (rho * A0) / Z_2S;
      sign = rho < 2 ? 1 : -1; // radial node at ρ = 2
      w = Math.min(1, ((2 - rho) ** 2 * Math.exp(-rho)) / 0.0546); // outer-shell peak at ρ = 3+√5
      dir(d); x = d[0] * r; y = d[1] * r; z = d[2] * r;
    } else {
      orb = pick < 5 ? ORB_2PX : ORB_2PY;
      const rho = gammaInt(5);
      r = (rho * A0) / Z_2P;
      const c = Math.cbrt(R()) * (R() < 0.5 ? -1 : 1); // cosθ about the lobe axis
      const sn = Math.sqrt(1 - c * c);
      const ph = R() * Math.PI * 2;
      sign = c >= 0 ? 1 : -1;
      w = (c * c * rho * rho * Math.exp(-rho)) / (4 * Math.exp(-2)); // peak at ρ = 2 on the axis
      const a = c * r, b = sn * Math.cos(ph) * r, e = sn * Math.sin(ph) * r;
      if (orb === ORB_2PX) { x = a; y = b; z = e; } else { x = b; y = a; z = e; }
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    data[i * 4] = orb; data[i * 4 + 1] = sign * Math.max(w, 1e-4); data[i * 4 + 2] = R(); data[i * 4 + 3] = R();
  }
  return { count, pos, data };
}
