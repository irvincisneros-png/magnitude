/** Builds the figure meshes off the main thread. */
import { buildFigure } from './figureSdf';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = () => {
  const f = buildFigure();
  const t: Transferable[] = [f.hairs.buffer, f.capsules.buffer, f.feet.buffer];
  for (const m of Object.values(f.meshes)) t.push(m.pos.buffer, m.nrm.buffer, m.attr.buffer, m.mat.buffer, m.index.buffer);
  ctx.postMessage(f, t);
};
