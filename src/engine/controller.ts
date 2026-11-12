/**
 * Input → (s, yaw, pitch). Wheel / pinch / ↑↓ keys change s with inertia; drag orbits
 * (pitch clamped ±80°) with inertia; ←/→ jump to the previous / next landmark; flyTo() eases
 * in s. `#s=` deep link is read on load and written (throttled) while moving.
 * Reduced motion: no inertia, no idle drift, near-instant flights.
 */
import { MAX_PITCH, MIN_PITCH } from './compositor';
import { S_MAX, S_MIN, clampS } from './scale';

interface Flight { from: number; to: number; t: number; dur: number; yaw?: [number, number]; pitch?: [number, number]; done: () => void }

export interface ControllerOptions {
  /** Landmark "home" scales, ascending, for ←/→. */
  homes: number[];
  initialS: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Controller {
  s: number;
  yaw = 0.35;
  pitch = 0.18;
  readonly reducedMotion: boolean;
  /** Called on any direct user input (wheel, drag, pinch, keys). */
  onUserInput: () => void = () => {};

  private vS = 0;
  private vYaw = 0;
  private vPitch = 0;
  private keyZoom = 0;
  private flight: Flight | null = null;
  private glideTarget: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; s0: number } | null = null;
  private lastMove = 0;
  private idle = 0;
  private hashTimer = 0;
  private lastHash = '';

  constructor(private el: HTMLElement, private opts: ControllerOptions) {
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.s = clampS(readHashS() ?? opts.initialS);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { this.keyZoom = 0; });
    window.addEventListener('hashchange', () => {
      const s = readHashS();
      if (s !== null && Math.abs(s - this.s) > 0.01 && location.hash !== this.lastHash) void this.flyTo(s);
    });
  }

  // ------------------------------------------------------------------ API

  setS(s: number) { this.cancel(); this.s = clampS(s); }

  /** Eased flight in s. Default duration scales with distance. Optional orbit target (radians). */
  flyTo(s: number, seconds?: number, orbit?: { yaw?: number; pitch?: number }): Promise<void> {
    const to = clampS(s);
    const dist = Math.abs(to - this.s);
    let dur = seconds ?? Math.min(7, 1.1 + Math.sqrt(dist) * 0.9);
    if (this.reducedMotion) dur = Math.min(dur, 0.3);
    this.cancel();
    return new Promise((done) => {
      const f: Flight = { from: this.s, to, t: 0, dur: Math.max(0.001, dur), done };
      if (orbit?.yaw !== undefined) f.yaw = [this.yaw, this.yaw + wrapAngle(orbit.yaw - this.yaw)];
      if (orbit?.pitch !== undefined) f.pitch = [this.pitch, clampPitch(orbit.pitch)];
      this.flight = f;
    });
  }

  /** Follow a target smoothly (ruler dragging). */
  glideTo(s: number) { this.flight?.done(); this.flight = null; this.vS = 0; this.glideTarget = clampS(s); }

  get flying() { return !!this.flight; }

  update(dt: number) {
    const rm = this.reducedMotion;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = easeInOut(f.t);
      this.s = f.from + (f.to - f.from) * k;
      if (f.yaw) this.yaw = f.yaw[0] + (f.yaw[1] - f.yaw[0]) * k;
      if (f.pitch) this.pitch = f.pitch[0] + (f.pitch[1] - f.pitch[0]) * k;
      if (f.t >= 1) { this.flight = null; f.done(); }
    } else if (this.glideTarget !== null) {
      const a = rm ? 1 : 1 - Math.exp(-dt * 14);
      this.s += (this.glideTarget - this.s) * a;
      if (Math.abs(this.glideTarget - this.s) < 1e-4) { this.s = this.glideTarget; this.glideTarget = null; }
    }

    if (this.keyZoom) {
      const speed = 1.6; // decades per second
      if (rm) this.s += this.keyZoom * speed * dt;
      else this.vS += this.keyZoom * speed * 6 * dt;
    }
    if (!rm) {
      this.s += this.vS * dt;
      this.yaw += this.vYaw * dt;
      this.pitch += this.vPitch * dt;
      const damp = Math.exp(-dt * 6);
      this.vS *= damp;
      if (!this.pointers.size) { this.vYaw *= Math.exp(-dt * 3.5); this.vPitch *= Math.exp(-dt * 3.5); }
      if (Math.abs(this.vS) < 1e-4) this.vS = 0;
      // idle drift: a slow cinematic orbit after a few seconds of no input
      this.idle += dt;
      if (this.idle > 6 && !this.flight) this.yaw += dt * 0.025 * Math.min(1, (this.idle - 6) / 3);
    }
    this.s = clampS(this.s);
    if ((this.s <= S_MIN && this.vS < 0) || (this.s >= S_MAX && this.vS > 0)) this.vS = 0;
    this.pitch = clampPitch(this.pitch);
    this.yaw = wrapAngle(this.yaw);
    this.writeHash(dt);
  }

  // ------------------------------------------------------------------ input

  private cancel() {
    if (this.flight) { const f = this.flight; this.flight = null; f.done(); }
    this.glideTarget = null;
    this.vS = 0;
  }

  private touched() { this.idle = 0; this.onUserInput(); }

  private impulse(ds: number) {
    if (this.flight || this.glideTarget !== null) this.cancel();
    if (this.reducedMotion) this.s = clampS(this.s + ds);
    else this.vS += ds * 6;
    this.touched();
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    let dy = e.deltaY * unit;
    dy = Math.sign(dy) * Math.min(Math.abs(dy), 240);
    const k = e.ctrlKey ? 0.01 : 0.0022; // ctrl+wheel = trackpad pinch
    this.impulse(dy * k);
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastMove = performance.now();
    if (this.pointers.size === 2) {
      this.pinch = { d0: this.pinchDist(), s0: this.s };
      this.cancel();
    }
    this.vYaw = 0;
    this.vPitch = 0;
    this.touched();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMove) / 1000;
    this.lastMove = now;
    if (this.pinch && this.pointers.size >= 2) {
      const d = this.pinchDist();
      const prev = this.s;
      this.s = clampS(this.pinch.s0 - Math.log10(Math.max(1, d) / Math.max(1, this.pinch.d0)) * 1.6);
      if (!this.reducedMotion) this.vS = 0.6 * this.vS + 0.4 * ((this.s - prev) / dt) * 0.5;
    } else if (this.pointers.size === 1) {
      const k = 0.0055;
      this.yaw -= dx * k;
      this.pitch = clampPitch(this.pitch + dy * k);
      if (!this.reducedMotion) {
        this.vYaw = 0.5 * this.vYaw + 0.5 * ((-dx * k) / dt);
        this.vPitch = 0.5 * this.vPitch + 0.5 * ((dy * k) / dt);
      }
    }
    this.touched();
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinch = null;
    if (performance.now() - this.lastMove > 80) { this.vYaw = 0; this.vPitch = 0; } // held still before release
    if (this.pinch === null && this.pointers.size === 1) {
      // continuing with one finger after a pinch: reset its anchor
      this.vS = 0;
    }
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp': case '+': case '=': this.keyZoom = -1; break;
      case 'ArrowDown': case '-': case '_': this.keyZoom = 1; break;
      case 'ArrowLeft': this.step(-1); break;
      case 'ArrowRight': this.step(1); break;
      default: return;
    }
    e.preventDefault();
    if (this.flight && this.keyZoom) this.cancel();
    this.touched();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(e.key)) this.keyZoom = 0;
  };

  /** ← smaller landmark, → bigger landmark (relative to where you are, or where you are flying to). */
  private step(dir: -1 | 1) {
    const from = this.flight ? this.flight.to : this.s;
    const homes = this.opts.homes;
    const target = dir > 0 ? homes.find((h) => h > from + 0.05) : [...homes].reverse().find((h) => h < from - 0.05);
    if (target !== undefined) void this.flyTo(target);
  }

  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private writeHash(dt: number) {
    this.hashTimer -= dt;
    if (this.hashTimer > 0) return;
    this.hashTimer = 0.4;
    const params = new URLSearchParams(location.hash.slice(1));
    const v = this.s.toFixed(2);
    if (params.get('s') === v) return;
    params.set('s', v);
    const hash = `#${params.toString()}`;
    this.lastHash = hash;
    try { history.replaceState(null, '', hash); } catch { /* sandboxed */ }
  }
}

function clampPitch(p: number) { return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p)); }

function readHashS(): number | null {
  const v = new URLSearchParams(location.hash.slice(1)).get('s');
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? clampS(n) : null;
}
