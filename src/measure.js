import * as THREE from 'three';
import { format } from './units.js';

// Ölçüm aracı: iki noktaya tıklayarak aradaki mesafeyi gösterir.
const COLOR = 0xffb340;
const CLICK_PX = 5;

export class MeasureTool {
  constructor({ viewport, container, onExit }) {
    Object.assign(this, { viewport, container, onExit });
    this.active = false;
    this.group = new THREE.Group();
    viewport.scene.add(this.group);
    this.measurements = [];
    this.first = null;
    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: COLOR, size: 10, sizeAttenuation: false, depthTest: false })
    );
    this.marker.visible = false;
    this.marker.renderOrder = 20;
    viewport.scene.add(this.marker);
    this.pending = this.create();
    this.hidePending();

    const dom = viewport.dom;
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => this.onUp(e));
    viewport.frameHooks.add(() => this.update());
  }

  start() {
    this.active = true;
    this.viewport.dom.style.cursor = 'crosshair';
  }

  stop() {
    this.active = false;
    this.first = null;
    this.marker.visible = false;
    this.hidePending();
    this.viewport.dom.style.cursor = '';
    for (const m of this.measurements) {
      this.group.remove(m.line);
      m.line.geometry.dispose();
      m.label.remove();
    }
    this.measurements = [];
  }

  hidePending() {
    this.pending.line.visible = false;
    this.pending.label.hidden = true;
  }

  handleKey(e) {
    if (!this.active || e.key !== 'Escape') return false;
    if (this.first) {
      this.first = null;
      this.hidePending();
    } else {
      this.onExit?.();
    }
    e.preventDefault();
    return true;
  }

  create() {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: COLOR, depthTest: false })
    );
    line.frustumCulled = false;
    line.renderOrder = 20;
    this.group.add(line);
    const label = document.createElement('div');
    label.className = 'measure-label';
    this.container.append(label);
    return { line, label, a: new THREE.Vector3(), b: new THREE.Vector3() };
  }

  set(m, a, b) {
    m.a.copy(a);
    m.b.copy(b);
    m.line.geometry.setFromPoints([a, b]);
    const d = new THREE.Vector3().subVectors(b, a);
    m.label.textContent = format(d.length());
    m.label.title = `ΔX ${format(Math.abs(d.x))} · ΔY ${format(Math.abs(d.y))} · ΔZ ${format(Math.abs(d.z))}`;
    m.line.visible = true;
    m.label.hidden = false;
  }

  onMove(e) {
    if (!this.active || !e.isPrimary) return;
    const hit = this.viewport.pickPoint(e.clientX, e.clientY);
    this.marker.visible = !!hit;
    if (!hit) return;
    this.marker.position.copy(hit.point);
    if (this.first) this.set(this.pending, this.first, hit.point);
  }

  onUp(e) {
    if (!this.active || e.button !== 0 || !this.downAt) return;
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > CLICK_PX) return;
    const hit = this.viewport.pickPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (!this.first) {
      this.first = hit.point.clone();
      return;
    }
    const m = this.create();
    this.set(m, this.first, hit.point);
    this.measurements.push(m);
    this.first = null;
    this.hidePending();
  }

  update() {
    const rect = this.viewport.dom.getBoundingClientRect();
    for (const m of [...this.measurements, this.pending]) {
      if (m.label.hidden) continue;
      const mid = m.a.clone().add(m.b).multiplyScalar(0.5).project(this.viewport.camera);
      m.label.style.display = mid.z > 1 ? 'none' : '';
      m.label.style.left = `${((mid.x + 1) / 2) * rect.width}px`;
      m.label.style.top = `${((1 - mid.y) / 2) * rect.height}px`;
    }
  }

  refresh() {
    for (const m of [...this.measurements, this.pending]) if (!m.label.hidden) this.set(m, m.a, m.b);
  }
}
