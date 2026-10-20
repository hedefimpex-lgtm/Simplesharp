import * as THREE from 'three';
import { format, fromDisplay, unitLabel } from './units.js';

// Çizim aracı: zemin (XY) ya da bir yüzey üzerinde dikdörtgen, daire veya
// çokgen çizer. Çizim sırasında sayı yazılarak ölçü girilebilir:
//   dikdörtgen "40x20", daire "30" (çap), çokgen "25" (sonraki kenar boyu).

const CLOSE_PX = 12;
const DRAG_PX = 6;
const ACCENT = 0x2f80ff;

// Normal vektörüne dik, sağ elli bir taban (xDir, yDir = normal × xDir).
function basisFromNormal(n) {
  const u = Math.abs(n.z) > 0.99
    ? new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize()
    : new THREE.Vector3(0, 0, 1).cross(n).normalize();
  return { u, v: new THREE.Vector3().crossVectors(n, u).normalize() };
}

const GROUND = () => ({
  origin: new THREE.Vector3(),
  n: new THREE.Vector3(0, 0, 1),
  u: new THREE.Vector3(1, 0, 0),
  v: new THREE.Vector3(0, 1, 0),
  body: null,
});

export class SketchTool {
  constructor({ viewport, hud, snapStep, onComplete, onCancel }) {
    Object.assign(this, { viewport, hud, snapStep, onComplete, onCancel });
    this.kind = null;
    const scene = viewport.scene;
    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: ACCENT, size: 10, sizeAttenuation: false, depthTest: false })
    );
    this.preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }));
    this.planeGrid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.25, depthTest: false }));
    for (const o of [this.marker, this.preview, this.planeGrid]) {
      o.renderOrder = 20;
      o.frustumCulled = false;
      o.visible = false;
      scene.add(o);
    }
    const dom = viewport.dom;
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    dom.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('dblclick', () => this.kind === 'poly' && this.finishPoly());
    this.reset();
  }

  get active() { return this.kind !== null; }

  start(kind) {
    this.kind = kind;
    this.reset();
    this.viewport.dom.style.cursor = 'crosshair';
    this.showHint();
  }

  stop() {
    this.kind = null;
    this.reset();
    this.viewport.dom.style.cursor = '';
  }

  reset() {
    this.plane = null;
    this.points = [];
    this.cursor = null;
    this.downScreen = null;
    this.typed = '';
    this.marker.visible = this.preview.visible = this.planeGrid.visible = false;
    this.hud.hidden = true;
  }

  handleKey(e) {
    if (!this.active) return false;
    if (e.key === 'Escape') {
      if (this.typed) this.typed = '';
      else if (this.points.length) this.reset();
      else this.onCancel?.();
    } else if (e.key === 'Enter') {
      if (this.typed) this.applyTyped();
      else if (this.kind === 'poly') this.finishPoly();
    } else if (e.key === 'Backspace') {
      if (this.typed) this.typed = this.typed.slice(0, -1);
      else {
        this.points.pop();
        if (!this.points.length) this.plane = null;
      }
    } else if (/^[\d.,x*]$/i.test(e.key) && this.points.length) {
      this.typed += e.key === ',' ? '.' : e.key;
    } else {
      return false;
    }
    e.preventDefault();
    this.updatePreview();
    return true;
  }

  // Yazılan ölçüyü uygular.
  applyTyped() {
    const values = this.typed.split(/[x*]/i).map((v) => fromDisplay(parseFloat(v)));
    this.typed = '';
    if (!values.length || values.some((v) => !(v > 0))) return;
    const a = this.points.at(-1);
    const c = this.cursor || [a[0] + 1, a[1] + 1];
    if (this.kind === 'rect') {
      const w = values[0];
      const h = values[1] ?? values[0];
      this.complete(this.rectProfile(a, [a[0] + Math.sign(c[0] - a[0] || 1) * w, a[1] + Math.sign(c[1] - a[1] || 1) * h]));
    } else if (this.kind === 'circle') {
      this.complete({ kind: 'circle', cx: a[0], cy: a[1], r: values[0] / 2 });
    } else if (this.kind === 'poly') {
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      this.points.push([a[0] + (dx / len) * values[0], a[1] + (dy / len) * values[0]]);
    }
  }

  // ---------------------------------------------------------------------------

  screenOf(e) {
    const rect = this.viewport.dom.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  pickPlane(e) {
    const hit = this.viewport.pick(e.clientX, e.clientY, 'face');
    if (hit?.normal) {
      const n = hit.normal.clone().normalize();
      return { origin: hit.point.clone(), n, ...basisFromNormal(n), body: hit.body };
    }
    return GROUND();
  }

  projectToPlane(e, plane) {
    const ray = this.viewport.setRay(e.clientX, e.clientY);
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(plane.n, plane.origin), new THREE.Vector3());
    if (!hit) return null;
    hit.sub(plane.origin);
    let x = hit.dot(plane.u);
    let y = hit.dot(plane.v);
    const step = this.snapStep();
    if (step > 0) {
      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;
    }
    return [x, y];
  }

  toWorld([x, y], plane = this.plane) {
    return plane.origin.clone().addScaledVector(plane.u, x).addScaledVector(plane.v, y).addScaledVector(plane.n, 0.05);
  }

  toScreen(local) {
    const p = this.toWorld(local).project(this.viewport.camera);
    const rect = this.viewport.dom.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height };
  }

  // ---------------------------------------------------------------------------

  onMove(e) {
    if (!this.active || !e.isPrimary) return;
    this.screen = this.screenOf(e);
    const plane = this.plane || this.pickPlane(e);
    this.hoverPlane = plane;
    this.cursor = this.projectToPlane(e, plane);
    this.updatePreview(plane);
  }

  onDown(e) {
    if (!this.active || e.button !== 0 || !e.isPrimary) return;
    this.screen = this.screenOf(e);
    if (!this.plane) this.plane = this.hoverPlane || this.pickPlane(e);
    const p = this.projectToPlane(e, this.plane);
    if (!p) return;
    this.cursor = p;
    this.downScreen = { ...this.screen };
    if (this.kind === 'poly') {
      if (this.points.length >= 3) {
        const first = this.toScreen(this.points[0]);
        if (Math.hypot(first.x - this.screen.x, first.y - this.screen.y) < CLOSE_PX) return this.finishPoly();
      }
      const last = this.points.at(-1);
      if (!last || last[0] !== p[0] || last[1] !== p[1]) this.points.push(p);
    } else if (!this.points.length) {
      this.points.push(p);
    } else {
      return this.finishTwoPoint(p);
    }
    this.updatePreview();
  }

  // Sürükleyerek çizim: ilk noktadan sürükleyip bırakınca şekil tamamlanır.
  onUp(e) {
    if (!this.active || e.button !== 0 || !e.isPrimary || this.kind === 'poly') return;
    if (this.points.length !== 1 || !this.downScreen) return;
    const s = this.screenOf(e);
    if (Math.hypot(this.downScreen.x - s.x, this.downScreen.y - s.y) < DRAG_PX) return;
    const p = this.projectToPlane(e, this.plane);
    if (p) this.finishTwoPoint(p);
  }

  // ---------------------------------------------------------------------------

  rectProfile(a, c) {
    return { kind: 'rect', cx: (a[0] + c[0]) / 2, cy: (a[1] + c[1]) / 2, w: Math.abs(c[0] - a[0]), h: Math.abs(c[1] - a[1]) };
  }

  outline(cursor) {
    const [a] = this.points;
    if (this.kind === 'rect') return [[a[0], a[1]], [cursor[0], a[1]], cursor, [a[0], cursor[1]], [a[0], a[1]]];
    if (this.kind === 'circle') {
      const r = Math.hypot(cursor[0] - a[0], cursor[1] - a[1]);
      return Array.from({ length: 65 }, (_, i) => [a[0] + Math.cos((i / 64) * Math.PI * 2) * r, a[1] + Math.sin((i / 64) * Math.PI * 2) * r]);
    }
    return [...this.points, cursor];
  }

  showHint() {
    this.hud.textContent = {
      rect: 'Zemine ya da bir yüze tıklayıp ilk köşeyi seçin',
      circle: 'Merkezi seçin',
      poly: 'Noktaları tıklayın · Enter ya da ilk noktaya tıklayarak kapatın',
    }[this.kind];
    this.hud.hidden = false;
    this.hud.style.left = '50%';
    this.hud.style.top = '12px';
    this.hud.classList.add('center');
  }

  updatePlaneGrid(plane) {
    // Seçilen düzlemi belirginleştiren küçük bir ızgara.
    const size = 60;
    const step = 10;
    const pts = [];
    for (let i = -size; i <= size; i += step) {
      pts.push(this.toWorld([i, -size], plane), this.toWorld([i, size], plane), this.toWorld([-size, i], plane), this.toWorld([size, i], plane));
    }
    this.planeGrid.geometry.dispose();
    this.planeGrid.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.planeGrid.visible = true;
  }

  updatePreview(plane = this.plane || this.hoverPlane) {
    if (!plane || !this.cursor) return;
    this.marker.position.copy(this.toWorld(this.cursor, plane));
    this.marker.visible = true;
    if (plane.body && plane !== this.lastGridPlane) this.updatePlaneGrid(plane);
    this.planeGrid.visible = !!plane.body;
    this.lastGridPlane = plane;

    let label = '';
    if (this.points.length) {
      const loop = this.outline(this.cursor);
      this.preview.geometry.dispose();
      this.preview.geometry = new THREE.BufferGeometry().setFromPoints(loop.map((p) => this.toWorld(p, plane)));
      this.preview.visible = true;
      const a = this.points.at(-1);
      if (this.kind === 'rect') label = `${format(Math.abs(this.cursor[0] - a[0]))} × ${format(Math.abs(this.cursor[1] - a[1]))}`;
      else if (this.kind === 'circle') label = `Ø ${format(2 * Math.hypot(this.cursor[0] - a[0], this.cursor[1] - a[1]))}`;
      else label = format(Math.hypot(this.cursor[0] - a[0], this.cursor[1] - a[1]));
      if (this.typed) label = `${this.typed} ${unitLabel()} ⏎`;
    } else {
      this.preview.visible = false;
    }

    if (!label) return this.showHint();
    this.hud.classList.remove('center');
    this.hud.textContent = label;
    this.hud.hidden = false;
    if (this.screen) {
      this.hud.style.left = `${this.screen.x + 18}px`;
      this.hud.style.top = `${this.screen.y + 18}px`;
    }
  }

  finishTwoPoint(cursor) {
    const [a] = this.points;
    if (this.kind === 'rect') this.complete(this.rectProfile(a, cursor));
    else this.complete({ kind: 'circle', cx: a[0], cy: a[1], r: Math.hypot(cursor[0] - a[0], cursor[1] - a[1]) });
  }

  finishPoly() {
    if (this.points.length < 3) return;
    this.complete({ kind: 'poly', points: [...this.points] });
  }

  complete(profile) {
    const plane = this.plane;
    const kind = this.kind;
    this.reset();
    this.showHint();
    const tooSmall = profile.kind === 'rect' ? profile.w < 0.01 || profile.h < 0.01
      : profile.kind === 'circle' ? profile.r < 0.01
        : Math.abs(THREE.ShapeUtils.area(profile.points.map(([x, y]) => new THREE.Vector2(x, y)))) < 0.01;
    if (tooSmall) return;
    this.onComplete({
      kind,
      profile,
      body: plane.body,
      plane: { origin: plane.origin.toArray(), xDir: plane.u.toArray(), normal: plane.n.toArray() },
    });
  }
}
