import * as THREE from 'three';
import { format } from './units.js';
import { isVisible } from './sketch.js';

// Ölçüm aracı: iki noktaya tıklayarak aradaki mesafeyi gösterir.
// Noktalar nesne yüzeylerinden ya da zeminden alınır.

const COLOR = 0xffb340;
const CLICK_DISTANCE_PX = 5;

export class MeasureTool {
  constructor({ camera, dom, scene, world, container }) {
    Object.assign(this, { camera, dom, scene, world, container });
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.group = new THREE.Group();
    this.group.renderOrder = 999;
    scene.add(this.group);
    this.measurements = [];
    this.start_ = null;
    this.downAt = null;

    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: COLOR, size: 9, sizeAttenuation: false, depthTest: false })
    );
    this.marker.visible = false;
    this.marker.renderOrder = 999;
    scene.add(this.marker);
    this.pending = this.createMeasurement();
    this.pending.line.visible = false;
    this.pending.label.hidden = true;

    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => this.onUp(e));
  }

  start() {
    this.active = true;
    this.dom.style.cursor = 'crosshair';
  }

  stop() {
    this.active = false;
    this.start_ = null;
    this.marker.visible = false;
    this.pending.line.visible = false;
    this.pending.label.hidden = true;
    this.dom.style.cursor = '';
    this.clear();
  }

  clear() {
    for (const m of this.measurements) {
      this.group.remove(m.line);
      m.line.geometry.dispose();
      m.label.remove();
    }
    this.measurements = [];
  }

  handleKey(e) {
    if (!this.active || e.key !== 'Escape') return false;
    if (this.start_) {
      this.start_ = null;
      this.pending.line.visible = false;
      this.pending.label.hidden = true;
    } else {
      this.onExit?.();
    }
    e.preventDefault();
    return true;
  }

  createMeasurement() {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: COLOR, depthTest: false })
    );
    line.frustumCulled = false;
    line.renderOrder = 999;
    this.group.add(line);
    const label = document.createElement('div');
    label.className = 'measure-label';
    this.container.append(label);
    return { line, label, a: new THREE.Vector3(), b: new THREE.Vector3() };
  }

  setMeasurement(m, a, b) {
    m.a.copy(a);
    m.b.copy(b);
    m.line.geometry.setFromPoints([a, b]);
    const d = new THREE.Vector3().subVectors(b, a);
    m.label.textContent = format(d.length());
    m.label.title = `ΔX ${format(Math.abs(d.x))} · ΔY ${format(Math.abs(d.y))} · ΔZ ${format(Math.abs(d.z))}`;
    m.line.visible = true;
    m.label.hidden = false;
  }

  pick(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.children, true).find((h) => h.object.isMesh && isVisible(h.object));
    if (hit) return hit.point.clone();
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  onMove(e) {
    if (!this.active || !e.isPrimary) return;
    const p = this.pick(e);
    this.marker.visible = !!p;
    if (!p) return;
    this.marker.position.copy(p);
    if (this.start_) this.setMeasurement(this.pending, this.start_, p);
  }

  onUp(e) {
    if (!this.active || e.button !== 0 || !e.isPrimary || !this.downAt) return;
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > CLICK_DISTANCE_PX) return;
    const p = this.pick(e);
    if (!p) return;
    if (!this.start_) {
      this.start_ = p;
      return;
    }
    const m = this.createMeasurement();
    this.setMeasurement(m, this.start_, p);
    this.measurements.push(m);
    this.start_ = null;
    this.pending.line.visible = false;
    this.pending.label.hidden = true;
  }

  // Her karede etiketleri ekrandaki yerlerine taşır.
  update() {
    const rect = this.dom.getBoundingClientRect();
    for (const m of [...this.measurements, this.pending]) {
      if (m.label.hidden) continue;
      const mid = m.a.clone().add(m.b).multiplyScalar(0.5).project(this.camera);
      const behind = mid.z > 1;
      m.label.style.display = behind ? 'none' : '';
      m.label.style.left = `${(mid.x + 1) / 2 * rect.width}px`;
      m.label.style.top = `${(1 - mid.y) / 2 * rect.height}px`;
    }
  }

  // Birim değişince etiketleri yeniden yazar.
  refresh() {
    for (const m of [...this.measurements, this.pending]) if (!m.label.hidden) this.setMeasurement(m, m.a, m.b);
  }
}
