/** Bakes the grain meshes, the quartz distance grid and the skin light map off the main thread. */
import { bake } from './shape';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = (e: MessageEvent) => {
  const r = bake(e.data.sun, e.data.quality);
  const t: Transferable[] = [r.grid.buffer, r.map.buffer];
  for (const m of [r.quartz, r.feldspar, r.heavy]) t.push(m.pos.buffer, m.nrm.buffer, m.index.buffer);
  ctx.postMessage(r, t);
};
