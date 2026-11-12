/**
 * Generative ambient score (WebAudio, no audio files). A few detuned oscillators and a filtered noise bed run
 * through a feedback-delay "room"; root pitch, brightness and texture follow `s` (see audioParamsFor): tiny scales
 * airy and glassy, human scale warm, cosmic scales deep and vast. Off by default; the AudioContext is only created
 * after a user gesture (the sound button) and is suspended while the tab is hidden.
 */
import { ICONS } from './feature-kit';
import { audioParamsFor, lsGet, lsSet } from './feature-logic';
import { addToolbarButton, api, on } from './shell';

export { audioParamsFor } from './feature-logic';

const KEY_VOL = 'magnitude.volume';

type Ctor = typeof AudioContext;
const AudioCtor: Ctor | undefined = typeof window !== 'undefined'
  ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext)
  : undefined;

export class Ambient {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private padFilter!: BiquadFilterNode;
  private noiseBand!: BiquadFilterNode;
  private noiseGain!: GainNode;
  private fbA!: GainNode;
  private fbB!: GainNode;
  private wet!: GainNode;
  private send!: GainNode;
  private voices: { osc: OscillatorNode; ratio: number }[] = [];
  private on = false;
  private volume: number;
  private lastS = 0;
  readonly supported = !!AudioCtor;
  /** Test/debug hook. */
  get state() { return this.ctx?.state ?? 'none'; }
  get enabled() { return this.on; }

  constructor() {
    const v = Number(lsGet(KEY_VOL));
    this.volume = Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.on) void this.ctx.resume();
    });
  }

  getVolume() { return this.volume; }
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    lsSet(KEY_VOL, String(this.volume));
    if (this.ctx && this.on) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.08);
  }
  private level() { return this.volume * this.volume * 0.5; }

  /** Must be called from a user gesture (click / key). */
  async enable() {
    if (!AudioCtor) return;
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    await ctx.resume().catch(() => undefined);
    this.on = true;
    this.apply(this.lastS || api().getS(), true);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.level(), ctx.currentTime, 0.6);
  }

  disable() {
    this.on = false;
    const ctx = this.ctx;
    if (!ctx) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    window.setTimeout(() => { if (!this.on && this.ctx) void this.ctx.suspend(); }, 900);
  }

  /** Follow the scale: glide every parameter. */
  setScale(s: number) {
    this.lastS = s;
    if (this.ctx && this.on) this.apply(s, false);
  }

  /** Soft glassy tick when crossing a landmark. */
  tick() {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const p = audioParamsFor(this.lastS);
    const f = Math.min(2400, Math.max(520, p.rootHz * 4));
    for (const [mult, delay, gain] of [[1, 0, 0.5], [1.5, 0.07, 0.28]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, now + delay);
      g.gain.exponentialRampToValueAtTime(0.09 * gain, now + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.42);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.send);
      o.start(now + delay);
      o.stop(now + delay + 0.5);
    }
  }

  private apply(s: number, immediate: boolean) {
    const ctx = this.ctx!;
    const p = audioParamsFor(s);
    const t = ctx.currentTime;
    const tc = immediate ? 0.02 : 0.45;
    for (const v of this.voices) v.osc.frequency.setTargetAtTime(p.rootHz * v.ratio, t, tc);
    this.padFilter.frequency.setTargetAtTime(p.cutoffHz, t, tc);
    this.noiseBand.frequency.setTargetAtTime(p.noiseHz, t, tc);
    this.noiseGain.gain.setTargetAtTime(p.noiseGain, t, tc);
    this.fbA.gain.setTargetAtTime(p.feedback, t, tc);
    this.fbB.gain.setTargetAtTime(p.feedback * 0.94, t, tc);
    this.wet.gain.setTargetAtTime(p.wet, t, tc);
  }

  private build() {
    const ctx = new AudioCtor!();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    // pad: detuned partials into a low-pass, gently breathing
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.Q.value = 0.6;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.55;
    this.padFilter.connect(padGain);
    const breathe = ctx.createGain();
    breathe.gain.value = 0.18;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    lfo.connect(breathe);
    breathe.connect(padGain.gain);
    lfo.start();

    const partials: { r: number; g: number; type: OscillatorType; cents: number }[] = [
      { r: 0.5, g: 0.3, type: 'sine', cents: 0 },
      { r: 1, g: 0.42, type: 'sine', cents: -4 },
      { r: 1, g: 0.26, type: 'triangle', cents: 7 },
      { r: 1.5, g: 0.2, type: 'sine', cents: -6 },
      { r: 2, g: 0.16, type: 'triangle', cents: 9 },
      { r: 3, g: 0.07, type: 'sine', cents: -9 },
    ];
    for (const p of partials) {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.detune.value = p.cents;
      o.frequency.value = 110 * p.r;
      const g = ctx.createGain();
      g.gain.value = p.g;
      o.connect(g);
      g.connect(this.padFilter);
      o.start();
      this.voices.push({ osc: o, ratio: p.r });
    }

    // noise bed (pink-ish) → band-pass: glassy sparkle when tiny, rumble when vast
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    this.noiseBand = ctx.createBiquadFilter();
    this.noiseBand.type = 'bandpass'; this.noiseBand.Q.value = 1.1;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.02;
    noise.connect(this.noiseBand); this.noiseBand.connect(this.noiseGain);
    noise.start();

    // reverb-ish: two damped feedback delays
    this.send = ctx.createGain();
    this.send.gain.value = 0.7;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.3;
    const mkDelay = (time: number) => {
      const dl = ctx.createDelay(2);
      dl.delayTime.value = time;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass'; damp.frequency.value = 2600;
      const fb = ctx.createGain();
      fb.gain.value = 0.5;
      this.send.connect(dl);
      dl.connect(damp); damp.connect(fb); fb.connect(dl);
      damp.connect(this.wet);
      return fb;
    };
    this.fbA = mkDelay(0.31);
    this.fbB = mkDelay(0.47);
    this.wet.connect(this.master);

    padGain.connect(this.master); padGain.connect(this.send);
    this.noiseGain.connect(this.master); this.noiseGain.connect(this.send);
  }
}

// ------------------------------------------------------------------ toolbar wiring

export const ambient = new Ambient();
export interface SoundControl { toggle(): Promise<void>; set(on: boolean): Promise<void>; onChange(f: (on: boolean) => void): void }

export function mountAudio(): SoundControl {
  const listeners: ((on: boolean) => void)[] = [];
  const btn = addToolbarButton({ id: 'sound', label: 'Sound: off', icon: ICONS.soundOff, onClick: () => void toggle() });
  btn.setAttribute('aria-pressed', 'false');
  if (!ambient.supported) {
    btn.setAttribute('disabled', '');
    btn.title = 'Sound is not supported in this browser';
  }

  async function set(v: boolean) {
    if (v) await ambient.enable(); else ambient.disable();
    const on_ = ambient.enabled;
    btn.innerHTML = on_ ? ICONS.soundOn : ICONS.soundOff;
    btn.classList.toggle('active', on_);
    btn.setAttribute('aria-pressed', String(on_));
    btn.setAttribute('aria-label', `Sound: ${on_ ? 'on' : 'off'}`);
    btn.title = `Sound: ${on_ ? 'on' : 'off'}`;
    listeners.forEach((f) => f(on_));
  }
  const toggle = () => set(!ambient.enabled);

  on('scale', (s) => ambient.setScale(s));
  on('landmark', () => ambient.tick());
  return { toggle, set, onChange: (f) => { listeners.push(f); } };
}
