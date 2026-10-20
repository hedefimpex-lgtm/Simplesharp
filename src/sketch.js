import * as THREE from 'three';
import { format } from './units.js';

// Çizim aracı: bir düzlem (zemin ya da tıklanan yüzey) üzerinde dikdörtgen,
// daire veya çokgen çizer ve bitince kapalı profili onComplete'e verir.
// Profil, düzlemin yerel XY koordinatlarında [[x, y], ...] dizisidir.

const CIRCLE_SEGMENTS = 64;
const SNAP_STEP = 0.1; // 10 mm
const CLOSE_DISTANCE_PX = 10;
const DRAG_DISTANCE_PX = 6;

const ACCENT = 0x4f9cff;

// Kapalı bir profilden derinlik kadar katı oluşturur (yerel +Z yönünde).
// Negatif derinlik profilin arkasına doğru katılaştırır.
export function buildExtrudeGeometry(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const d = Math.max(Math.abs(depth), 1e-3);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  if (depth < 0) geometry.translate(0, 0, -d);
  return geometry;
}

export function circlePoints(cx, cy, r, segments = CIRCLE_SEGMENTS) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return points;
}

// Normal vektörüne dik, sağ elli bir (u, v, n) tabanı kurar.
function basisFromNormal(n) {
  const ref = Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  // Duvarlarda u yatay, v yukarı olsun; yatay yüzeylerde u dünya X'i olsun.
  const u = Math.abs(n.y) > 0.99
    ? ref.clone().addScaledVector(n, -ref.dot(n)).normalize()
    : new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

const GROUND = () => ({
  origin: new THREE.Vector3(0, 0, 0),
  n: new THREE.Vector3(0, 1, 0),
  u: new THREE.Vector3(1, 0, 0),
  v: new THREE.Vector3(0, 0, -1),
});

export class SketchTool {
  constructor({ camera, dom, scene, world, hud, isSnapping, onComplete, onCancel }) {
    Object.assign(this, { camera, dom, scene, world, hud, isSnapping, onComplete, onCancel });
    this.kind = null;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: ACCENT, size: 9, sizeAttenuation: false, depthTest: false })
    );
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false })
    );
    this.preview.renderOrder = 998;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    scene.add(this.marker, this.preview);

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
    this.dom.style.cursor = 'crosshair';
  }

  cancel() {
    if (!this.active) return;
    this.kind = null;
    this.reset();
    this.dom.style.cursor = '';
    this.onCancel?.();
  }

  reset() {
    this.plane = null;
    this.points = [];
    this.cursor = null;
    this.downScreen = null;
    this.marker.visible = false;
    this.preview.visible = false;
    this.hud.hidden = true;
  }

  // Klavye: Enter bitirir, Esc iptal eder, Backspace son noktayı siler.
  handleKey(e) {
    if (!this.active) return false;
    if (e.key === 'Escape') {
      if (this.points.length) this.reset();
      else this.cancel();
    } else if (e.key === 'Enter') {
      if (this.kind === 'poly') this.finishPoly();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      this.points.pop();
      if (!this.points.length) this.plane = null;
      this.updatePreview();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  // ---------------------------------------------------------------------------

  setNdc(e) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // İmlecin altındaki çizim düzlemini bulur: önce nesne yüzeyleri, sonra zemin.
  pickPlane() {
    const hit = this.raycaster
      .intersectObjects(this.world.children, true)
      .find((h) => h.face && h.object.isMesh && isVisible(h.object));
    if (hit) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      if (n.dot(this.raycaster.ray.direction) > 0) n.negate();
      return { origin: hit.point.clone(), n, ...basisFromNormal(n) };
    }
    return GROUND();
  }

  // Işının düzlemle kesiştiği noktayı yerel 2B koordinat olarak döndürür.
  projectToPlane(plane) {
    const p = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.n, plane.origin);
    const hit = this.raycaster.ray.intersectPlane(p, new THREE.Vector3());
    if (!hit) return null;
    hit.sub(plane.origin);
    let x = hit.dot(plane.u);
    let y = hit.dot(plane.v);
    if (this.isSnapping()) {
      x = Math.round(x / SNAP_STEP) * SNAP_STEP;
      y = Math.round(y / SNAP_STEP) * SNAP_STEP;
    }
    return [x, y];
  }

  toWorld([x, y], plane = this.plane) {
    return plane.origin.clone().addScaledVector(plane.u, x).addScaledVector(plane.v, y);
  }

  toScreen(local) {
    const p = this.toWorld(local).project(this.camera);
    const rect = this.dom.getBoundingClientRect();
    return { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height };
  }

  // ---------------------------------------------------------------------------

  onMove(e) {
    if (!this.active || !e.isPrimary) return;
    this.setNdc(e);
    const plane = this.plane || this.pickPlane();
    this.hoverPlane = plane;
    this.cursor = this.projectToPlane(plane);
    this.updatePreview(plane);
  }

  onDown(e) {
    if (!this.active || e.button !== 0 || !e.isPrimary) return;
    this.setNdc(e);
    if (!this.plane) this.plane = this.hoverPlane || this.pickPlane();
    const p = this.projectToPlane(this.plane);
    if (!p) return;
    this.cursor = p;
    this.downScreen = { ...this.screen };

    if (this.kind === 'poly') {
      if (this.points.length >= 3) {
        const first = this.toScreen(this.points[0]);
        if (Math.hypot(first.x - this.screen.x, first.y - this.screen.y) < CLOSE_DISTANCE_PX) return this.finishPoly();
      }
      const last = this.points.at(-1);
      if (!last || last[0] !== p[0] || last[1] !== p[1]) this.points.push(p);
    } else if (!this.points.length) {
      this.points.push(p);
    } else {
      this.finishTwoPoint(p);
      return;
    }
    this.updatePreview();
  }

  // Sürükleyerek çizim: ilk noktadan sürükleyip bırakınca şekil tamamlanır.
  onUp(e) {
    if (!this.active || e.button !== 0 || !e.isPrimary || this.kind === 'poly') return;
    if (this.points.length !== 1 || !this.downScreen) return;
    this.setNdc(e);
    if (Math.hypot(this.downScreen.x - this.screen.x, this.downScreen.y - this.screen.y) < DRAG_DISTANCE_PX) return;
    const p = this.projectToPlane(this.plane);
    if (p) this.finishTwoPoint(p);
  }

  // ---------------------------------------------------------------------------

  shapeFor(cursor) {
    const [a] = this.points;
    if (!a || !cursor) return null;
    if (this.kind === 'rect') {
      return [[a[0], a[1]], [cursor[0], a[1]], [cursor[0], cursor[1]], [a[0], cursor[1]]];
    }
    if (this.kind === 'circle') {
      const r = Math.hypot(cursor[0] - a[0], cursor[1] - a[1]);
      return circlePoints(a[0], a[1], r);
    }
    return null;
  }

  updatePreview(plane = this.plane || this.hoverPlane) {
    if (!plane || !this.cursor) {
      this.marker.visible = this.preview.visible = false;
      this.hud.hidden = true;
      return;
    }
    const lift = plane.n.clone().multiplyScalar(0.002);
    this.marker.position.copy(this.toWorld(this.cursor, plane)).add(lift);
    this.marker.visible = true;

    let loop = null;
    let label = '';
    if (this.kind === 'poly' && this.points.length) {
      loop = [...this.points, this.cursor];
      const last = this.points.at(-1);
      label = format(Math.hypot(this.cursor[0] - last[0], this.cursor[1] - last[1]));
    } else if (this.points.length) {
      const shape = this.shapeFor(this.cursor);
      loop = [...shape, shape[0]];
      const [a] = this.points;
      label = this.kind === 'rect'
        ? `${format(Math.abs(this.cursor[0] - a[0]))} × ${format(Math.abs(this.cursor[1] - a[1]))}`
        : `Ø ${format(2 * Math.hypot(this.cursor[0] - a[0], this.cursor[1] - a[1]))}`;
    }

    if (loop) {
      this.preview.geometry.dispose();
      this.preview.geometry = new THREE.BufferGeometry().setFromPoints(loop.map((p) => this.toWorld(p, plane).add(lift)));
      this.preview.visible = true;
    } else {
      this.preview.visible = false;
    }

    const hint = {
      rect: 'İlk köşeyi seçin',
      circle: 'Merkezi seçin',
      poly: 'Noktaları tıklayın · Enter ya da ilk noktaya tıklayarak kapatın',
    }[this.kind];
    this.hud.textContent = label || hint;
    this.hud.hidden = false;
    if (this.screen) {
      this.hud.style.left = `${this.screen.x + 16}px`;
      this.hud.style.top = `${this.screen.y + 16}px`;
    }
  }

  finishTwoPoint(cursor) {
    this.complete(this.shapeFor(cursor));
  }

  finishPoly() {
    if (this.points.length < 3) return;
    this.complete([...this.points]);
  }

  complete(points) {
    const plane = this.plane;
    this.reset();
    if (!points || Math.abs(THREE.ShapeUtils.area(points.map(([x, y]) => new THREE.Vector2(x, y)))) < 1e-4) return;

    // Profili sınır kutusunun merkezine taşı; nesnenin pivotu şeklin ortasında olsun.
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const centered = points.map(([x, y]) => [x - cx, y - cy]);
    const origin = this.toWorld([cx, cy], plane);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(plane.u, plane.v, plane.n));

    this.onComplete({ kind: this.kind, points: centered, origin, quaternion });
  }
}

export function isVisible(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
