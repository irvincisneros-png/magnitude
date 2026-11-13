/**
 * Small CPU noise helpers shared by the place's geometry builders (pure maths, no Three.js).
 * The ground itself now comes from real elevation and map data: see siteData.ts.
 */

function ih(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise2(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = ih(ix, iy), b = ih(ix + 1, iy), c = ih(ix, iy + 1), d = ih(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm2(x: number, y: number, oct: number) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise2(x, y); n += a;
    const nx = 1.6 * x + 1.2 * y + 7.3, ny = -1.2 * x + 1.6 * y + 7.3;
    x = nx; y = ny; a *= 0.5;
  }
  return v / n;
}
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
