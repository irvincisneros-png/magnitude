/**
 * Landmark registry: lazy-loads the landmarks around the current scale and disposes far ones.
 * Policy: keep the active landmarks ±1 neighbour loaded; dispose anything beyond ±2.
 * No Three.js runtime import here so the window maths stays unit-testable.
 */
import type { DesertRow, ManifestRow } from '../landmarks/manifest';
import { clampS, smoothstep } from './scale';
import type { InitContext, Landmark, Quality } from './types';

export const FADE = 0.6;

/** Presence of manifest row `i` at `s`. The outermost landmarks do not fade at the ends of the universe. */
export function layerPresence(i: number, s: number, rows: readonly ManifestRow[]): number {
  const [lo, hi] = rows[i].range;
  const x = clampS(s);
  if (x < lo || x > hi) return 0;
  const fadeIn = i === 0 ? 1 : smoothstep(lo, lo + FADE, x);
  const fadeOut = i === rows.length - 1 ? 1 : 1 - smoothstep(hi - FADE, hi, x);
  return fadeIn * fadeOut;
}

/** Desert presence: complementary to the neighbours' fades (extends one fade width past each end). */
export function desertPresence(s: number, d: DesertRow): number {
  const [lo, hi] = d.range;
  return smoothstep(lo - FADE, lo, s) * (1 - smoothstep(hi, hi + FADE, s));
}

/**
 * Inclusive index span of rows whose range contains s. Inside a desert (no row contains s),
 * the span is the two rows either side of the gap.
 */
export function focusSpan(s: number, rows: readonly ManifestRow[]): [number, number] {
  const x = clampS(s);
  let a = -1;
  let b = -1;
  rows.forEach((r, i) => {
    if (x >= r.range[0] && x <= r.range[1]) {
      if (a < 0) a = i;
      b = i;
    }
  });
  if (a >= 0) return [a, b];
  const next = rows.findIndex((r) => r.range[0] > x);
  if (next < 0) return [rows.length - 1, rows.length - 1];
  if (next === 0) return [0, 0];
  return [next - 1, next];
}

/** Which indices to keep loaded (`keep`) and which may stay if already loaded (`retain`). */
export function windowFor(s: number, rows: readonly ManifestRow[]) {
  const [a, b] = focusSpan(s, rows);
  const n = rows.length;
  const span = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let i = Math.max(0, lo); i <= Math.min(n - 1, hi); i++) out.push(i);
    return out;
  };
  return { keep: span(a - 1, b + 1), retain: span(a - 2, b + 2) };
}

type State = 'idle' | 'loading' | 'ready' | 'error';
interface Entry { row: ManifestRow; state: State; instance?: Landmark; token: number }

export class Registry {
  private entries: Entry[];
  private quality: Quality;
  private pending = new Set<Promise<void>>();

  constructor(
    rows: readonly ManifestRow[],
    private makeContext: (row: ManifestRow, quality: Quality) => InitContext,
    quality: Quality,
  ) {
    this.entries = rows.map((row) => ({ row, state: 'idle', token: 0 }));
    this.quality = quality;
  }

  /** Call every frame. Starts loads inside the keep window, disposes outside the retain window. */
  sync(s: number) {
    const { keep, retain } = windowFor(s, this.entries.map((e) => e.row));
    for (const i of keep) if (this.entries[i].state === 'idle') this.load(i);
    this.entries.forEach((e, i) => {
      if (!retain.includes(i) && e.state !== 'idle' && e.state !== 'error') this.unload(e);
    });
  }

  /** Resolves when everything currently loading has settled. */
  async settle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  get(i: number): Landmark | undefined {
    const e = this.entries[i];
    return e?.state === 'ready' ? e.instance : undefined;
  }

  status(i: number): State { return this.entries[i].state; }

  setQuality(q: Quality) {
    this.quality = q;
    for (const e of this.entries) if (e.state === 'ready') safe(() => e.instance!.setQuality(q), e.row.id, 'setQuality');
  }

  private load(i: number) {
    const e = this.entries[i];
    const token = ++e.token;
    e.state = 'loading';
    const p = (async () => {
      try {
        const mod = await e.row.load();
        const lm = mod.default();
        if (import.meta.env?.DEV) checkMeta(e.row, lm);
        await lm.init(this.makeContext(e.row, this.quality));
        if (e.token !== token) { lm.dispose(); return; } // unloaded while loading
        lm.setQuality(this.quality);
        e.instance = lm;
        e.state = 'ready';
      } catch (err) {
        if (e.token === token) e.state = 'error';
        console.error(`[magnitude] landmark "${e.row.id}" failed to load`, err);
      }
    })();
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  private unload(e: Entry) {
    e.token++;
    if (e.instance) safe(() => e.instance!.dispose(), e.row.id, 'dispose');
    e.instance = undefined;
    e.state = 'idle';
  }
}

function safe(fn: () => void, id: string, what: string) {
  try { fn(); } catch (err) { console.error(`[magnitude] ${id}.${what}() threw`, err); }
}

function checkMeta(row: ManifestRow, lm: Landmark) {
  const m = lm.meta;
  if (m.id !== row.id || m.sizeMeters !== row.sizeMeters || m.range[0] !== row.range[0] || m.range[1] !== row.range[1]) {
    console.warn(`[magnitude] meta of "${row.id}" disagrees with the manifest table (id/sizeMeters/range).`, m);
  }
}
