/** Builds the ant meshes off the main thread. */
import { buildAnt } from './build';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = () => {
  const d = buildAnt();
  const t: Transferable[] = [];
  for (const p of d.parts) t.push(p.pos.buffer, p.nrm.buffer, p.attr.buffer, p.index.buffer, p.hairs.buffer);
  ctx.postMessage(d, t);
};
