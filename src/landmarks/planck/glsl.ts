/**
 * Shared GLSL for the Planck scene: hashes and the bubble life-cycle, used by both the foam
 * raymarch (bubbles are drawn) and the fabric lattice (lines are pushed around the same bubbles).
 *
 * The foam is a set of jittered lattices. Each lattice cell owns at most one bubble that always
 * fits inside its cell, so a ray can visit cells with a DDA walk and intersect bubbles exactly.
 * Two lattices of the same size, offset by half a cell, let bubbles overlap ("merge").
 * Each bubble is born small, swells, its film thins, and it pops (a brief flash) before a new
 * one forms in the same cell with a fresh seed.
 */
export const COMMON = /* glsl */ `
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }

  // Bubble owned by lattice cell 'cell' (integer coords) of a lattice with cell size S and world
  // offset 'off'. Outputs centre c (world), radius r, life alpha a, pop flash fl and a seed.
  void bubbleAt(vec3 cell, float S, vec3 off, float lat, float time, float jit,
                out vec3 c, out float r, out float a, out float fl, out float seed) {
    vec3 h0 = hash33(cell + lat * 17.31);
    float period = (2.6 + 3.8 * h0.z) * sqrt(S);          // smaller bubbles live faster
    float age = time / period + h0.x * 13.7;
    float gen = floor(age);
    float u = age - gen;
    vec3 h = hash33(cell * 1.37 + gen * 7.91 + lat * 3.1);  // new bubble each generation
    seed = h.z;
    float rMax = S * (0.12 + 0.24 * h.y * h.y);
    float grow = smoothstep(0.0, 0.75, u);
    r = rMax * (0.3 + 0.7 * grow) * (1.0 + 0.22 * smoothstep(0.88, 1.0, u));
    a = smoothstep(0.0, 0.18, u) * (1.0 - smoothstep(0.9, 1.0, u));
    fl = smoothstep(0.9, 0.95, u) * (1.0 - smoothstep(0.95, 0.995, u));
    a *= step(0.22, hash13(cell * 0.71 + gen * 3.3 + lat));  // some cells stay empty for a while
    // clusters and voids: a slow, smooth field decides where froth gathers
    vec3 q = (cell + 0.5) * S / max(S * 3.5, 0.35);
    float cl = sin(q.x * 1.7 + sin(q.y * 1.3 + time * 0.05)) * sin(q.y * 1.5 + sin(q.z * 1.1)) * sin(q.z * 1.6 + sin(q.x * 1.2 - time * 0.04));
    a *= smoothstep(-0.35, 0.25, cl + 0.15 * (h0.y - 0.5));
    float room = max(0.0, 0.47 * S - rMax * 1.22);
    vec3 j = (h - 0.5) * 2.0 * room * 0.8;
    // quantum jitter: the bubble never sits still (bounded so it stays inside its cell)
    j += room * 0.2 * clamp(jit, 0.0, 1.0) * sin(time * vec3(5.3, 6.1, 4.7) * (0.6 + h0) + h * 40.0);
    c = (cell + 0.5) * S + off + j;
  }
`;
