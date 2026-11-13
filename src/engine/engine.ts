/**
 * Engine: owns the renderer, quality tier, registry, desert and compositor, and turns
 * (s, yaw, pitch, time) into a rendered frame. Knows nothing about the DOM UI.
 */
import * as THREE from 'three';
import { DESERTS, MANIFEST } from '../landmarks/manifest';
import { Compositor, placeCamera, type CompositeLayer } from './compositor';
import { Desert } from './desert';
import { MAX_DPR, QualityManager, type QualityMode } from './quality';
import { Registry, desertPresence, layerPresence } from './registry';
import type { FrameState, LandmarkMeta, Quality } from './types';

export interface ActiveInfo {
  id: string;
  presence: number;
  opacity: number;
  /** Resolution scale the layer was drawn at this frame (1 full, 0.5 half, 0 skipped). */
  scale?: number;
  ready: boolean;
  zoom: number;
  meta?: LandmarkMeta;
  camera?: THREE.PerspectiveCamera;
}

/** Sort key that places the desert between its neighbours. */
const desertSortSize = (lo: number, hi: number) => 10 ** ((lo + hi) / 2);

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualityManager;
  readonly registry: Registry;
  private compositor: Compositor;
  private deserts: Desert[];
  private cameras = new Map<string, THREE.PerspectiveCamera>();
  private size = new THREE.Vector2();
  private cssW = 1;
  private cssH = 1;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NoToneMapping; // Post does ACES itself
    this.renderer.info.autoReset = false;
    this.quality = new QualityManager(this.renderer);
    const base = import.meta.env.BASE_URL;
    this.registry = new Registry(
      MANIFEST,
      (row, quality) => ({ renderer: this.renderer, quality, assetUrl: (p) => `${base}assets/${row.id}/${p.replace(/^\/+/, '')}` }),
      this.quality.tier,
    );
    this.compositor = new Compositor(this.renderer);
    this.deserts = DESERTS.map((d) => new Desert(d, overlay));
    this.applyTier(this.quality.tier);
    this.quality.onChange((q) => this.applyTier(q));
  }

  get tier(): Quality { return this.quality.tier; }
  setQuality(mode: QualityMode) { this.quality.set(mode); }

  private applyTier(q: Quality) {
    this.compositor.setTier(q);
    this.registry.setQuality(q);
    this.deserts.forEach((d) => d.setQuality(q));
    this.resize(this.cssW, this.cssH);
  }

  resize(w: number, h: number) {
    this.cssW = Math.max(1, w);
    this.cssH = Math.max(1, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR[this.quality.tier]));
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.renderer.getDrawingBufferSize(this.size);
    this.compositor.setSize(this.size.x, this.size.y);
  }

  /** Load whatever `s` needs and wait for it (used before the first frame / deep links). */
  async warm(s: number) {
    this.registry.sync(s);
    await this.registry.settle();
  }

  frame(s: number, yaw: number, pitch: number, time: number, dt: number): ActiveInfo[] {
    this.quality.sample(dt);
    this.registry.sync(s);
    this.renderer.info.reset();
    const aspect = this.cssW / this.cssH;
    const layers: CompositeLayer[] = [];
    const infos: ActiveInfo[] = [];

    MANIFEST.forEach((row, i) => {
      const p = layerPresence(i, s, MANIFEST);
      if (p <= 0) return;
      const lm = this.registry.get(i);
      const zoom = s - Math.log10(row.sizeMeters);
      const info: ActiveInfo = { id: row.id, presence: p, opacity: 0, ready: !!lm, zoom, meta: lm?.meta };
      infos.push(info);
      if (!lm) return;
      let cam = this.cameras.get(row.id);
      if (!cam) { cam = new THREE.PerspectiveCamera(); this.cameras.set(row.id, cam); }
      placeCamera(cam, s, row.sizeMeters, yaw, pitch, aspect);
      info.camera = cam;
      const fs: FrameState = { s, zoom, presence: p, time, dt, camera: cam, quality: this.quality.tier };
      try { lm.update(fs); } catch (err) { console.error(`[magnitude] ${row.id}.update() threw`, err); return; }
      layers.push({ key: row.id, sortSize: row.sizeMeters, presence: p, scene: lm.scene, camera: cam, post: lm.meta.post });
    });

    DESERTS.forEach((d, k) => {
      const p = desertPresence(s, d);
      const desert = this.deserts[k];
      desert.update(s, p, time, aspect, this.size.y, yaw, pitch);
      if (p <= 0) return;
      infos.push({ id: d.id, presence: p, opacity: 0, ready: true, zoom: 0 });
      layers.push({ key: d.id, sortSize: desertSortSize(d.range[0], d.range[1]), presence: p, scene: desert.scene, camera: desert.camera, post: { bloom: 0.35 } });
    });

    const ops = this.compositor.render(layers, time);
    for (const info of infos) { info.opacity = ops.get(info.id) ?? 0; info.scale = this.compositor.scales.get(info.id); }
    return infos;
  }
}
