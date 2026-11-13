/**
 * Pure screen-space label declutter (no DOM): greedy placement in priority order against
 * already-placed boxes and keep-out rectangles, with hysteresis so labels do not flicker.
 */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface DeclutterItem {
  /** Box of the label on screen (px). */
  box: Rect;
  /** Was this label shown (target) last frame? Used for hysteresis. */
  wasShown: boolean;
  /** Output: whether the label should be shown this frame. */
  show: boolean;
}

const overlaps = (a: Rect, b: Rect, pad: number) =>
  a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

/**
 * Items must already be sorted by priority (earlier wins). A label that was already shown
 * needs `hold` px less clearance than a hidden one needs to appear (hysteresis).
 * `maxVisible` caps how many labels may be shown (Infinity for no cap).
 */
export function declutter(
  items: DeclutterItem[], keepOut: readonly Rect[], vw: number, vh: number,
  opts: { gap?: number; hold?: number; maxVisible?: number } = {},
): void {
  const gap = opts.gap ?? 6;
  const hold = opts.hold ?? 4;
  const max = opts.maxVisible ?? Infinity;
  let placed = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it.show = false;
    if (placed >= max) continue;
    const b = it.box;
    const m = it.wasShown ? 0 : 4; // inside-viewport margin, stricter to appear
    if (b.x0 < m || b.y0 < m || b.x1 > vw - m || b.y1 > vh - m) continue;
    const pad = it.wasShown ? Math.max(0, gap - hold) : gap;
    let ok = true;
    for (let k = 0; k < keepOut.length && ok; k++) if (overlaps(b, keepOut[k], it.wasShown ? 0 : 4)) ok = false;
    for (let k = 0; k < i && ok; k++) if (items[k].show && overlaps(b, items[k].box, pad)) ok = false;
    if (ok) { it.show = true; placed++; }
  }
}
