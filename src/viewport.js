import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MATERIALS } from './design.js';

// 3B görünüm: gövdelerin çizimi, yüz/kenar seçimi, görünüm küpü, mesafe tutamacı.
// Model koordinatları milimetre ve Z-yukarıdır.

const HOVER = 0x7fb6ff;
const SELECT = 0x2f80ff;
const EDGE = 0x1b1f26;
const PICK_PX = 6;
const CUBE_PX = 104;

const VIEW_DIRS = {
  front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0],
  top: [0, -1e-4, 1], bottom: [0, -1e-4, -1], iso: [1, -1.15, 0.85],
};

function cubeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9edf3';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#9aa4b2';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = '#2b3240';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}

// Bir aralığı (start, count) içeren grubu ikili aramayla bulur.
function findRange(ranges, value) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, count] = ranges[mid];
    if (value < start) hi = mid - 1;
    else if (value >= start + count) lo = mid + 1;
    else return ranges[mid];
  }
  return null;
}

export class Viewport {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.autoClear = false;
    container.prepend(r.domElement);
    this.dom = r.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a2f37');
    this.scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.perspective = new THREE.PerspectiveCamera(40, 1, 0.5, 200000);
    this.perspective.up.set(0, 0, 1);
    this.perspective.position.set(260, -320, 220);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.ortho.up.set(0, 0, 1);
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.camera, this.dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 20);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.7));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(300, -400, 600);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.grid = new THREE.Group();
    const minor = new THREE.GridHelper(1000, 100, 0x39404b, 0x343a44);
    const major = new THREE.GridHelper(1000, 10, 0x4d5664, 0x4d5664);
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2;
      g.material.transparent = true;
      g.material.opacity = g === minor ? 0.6 : 0.9;
      this.grid.add(g);
    }
    const axes = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(80, 0, 0), new THREE.Vector3(), new THREE.Vector3(0, 80, 0)]),
      new THREE.LineBasicMaterial({ vertexColors: true })
    );
    axes.geometry.setAttribute('color', new THREE.Float32BufferAttribute([0.9, 0.3, 0.3, 0.9, 0.3, 0.3, 0.4, 0.8, 0.4, 0.4, 0.8, 0.4], 3));
    axes.position.z = 0.05;
    this.grid.add(axes);
    this.scene.add(this.grid);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.ground.position.z = -0.05;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.bodiesGroup = new THREE.Group();
    this.overlay = new THREE.Group();
    this.helpers = new THREE.Group();
    this.scene.add(this.bodiesGroup, this.overlay, this.helpers);
    this.bodies = new Map();
    this.edgesVisible = true;

    this.transform = new TransformControls(this.camera, this.dom);
    this.transform.setSize(0.9);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (e) => { this.controls.enabled = !e.value; });

    this.raycaster = new THREE.Raycaster();
    this.buildViewCube();
    this.handle = null;

    this.dom.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.frameHooks = new Set();
    r.setAnimationLoop(() => this.render());
  }

  // ---------------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.updateOrtho();
  }

  updateOrtho() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const d = this.camera.position.distanceTo(this.controls.target);
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    if (this.camera !== this.ortho) {
      Object.assign(this.ortho, { top: halfH, bottom: -halfH, left: -halfH * (w / h || 1), right: halfH * (w / h || 1), zoom: 1 });
    } else {
      const aspect = w / h || 1;
      this.ortho.left = this.ortho.bottom * aspect;
      this.ortho.right = this.ortho.top * aspect;
    }
    this.ortho.updateProjectionMatrix();
  }

  setOrthographic(on) {
    const next = on ? this.ortho : this.perspective;
    if (next === this.camera) return;
    const position = this.camera.position.clone();
    if (on) {
      this.updateOrtho();
    } else {
      // Ortografik yakınlaştırmayı perspektif mesafeye çevir.
      const halfH = this.ortho.top / this.ortho.zoom;
      const d = halfH / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      const dir = position.clone().sub(this.controls.target).normalize();
      position.copy(this.controls.target).addScaledVector(dir, d);
    }
    next.position.copy(position);
    next.quaternion.copy(this.camera.quaternion);
    this.camera = next;
    this.controls.object = next;
    this.transform.camera = next;
    this.controls.update();
  }

  get isOrthographic() { return this.camera === this.ortho; }

  setView(name, animate = true) {
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.animateCamera(this.controls.target.clone(), this.controls.target.clone().addScaledVector(dir, distance), animate);
  }

  animateCamera(target, position, animate = true) {
    const fromT = this.controls.target.clone();
    const fromP = this.camera.position.clone();
    const start = performance.now();
    const duration = animate ? 280 : 0;
    this.cameraAnim = (now) => {
      const t = duration ? Math.min((now - start) / duration, 1) : 1;
      const k = t * t * (3 - 2 * t);
      this.controls.target.lerpVectors(fromT, target, k);
      // Yönü küresel olarak, mesafeyi doğrusal olarak geçir.
      const a = fromP.clone().sub(fromT);
      const b = position.clone().sub(target);
      const dir = a.clone().normalize().lerp(b.clone().normalize(), k).normalize();
      const len = THREE.MathUtils.lerp(a.length(), b.length(), k);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, len);
      if (t >= 1) this.cameraAnim = null;
    };
  }

  fit(bounds, animate = true) {
    if (!bounds) bounds = this.modelBounds();
    if (!bounds) {
      this.animateCamera(new THREE.Vector3(0, 0, 20), new THREE.Vector3(260, -320, 220), animate);
      return;
    }
    const box = new THREE.Box3(new THREE.Vector3(...bounds[0]), new THREE.Vector3(...bounds[1]));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 5);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2)) * 1.15;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (this.isOrthographic) {
      this.ortho.zoom = this.ortho.top / (radius * 1.2);
      this.ortho.updateProjectionMatrix();
    }
    this.animateCamera(sphere.center, sphere.center.clone().addScaledVector(dir, distance), animate);
  }

  modelBounds(ids) {
    const box = new THREE.Box3();
    for (const [id, b] of this.bodies) {
      if ((ids && !ids.includes(id)) || !b.mesh.visible) continue;
      box.union(new THREE.Box3(new THREE.Vector3(...b.data.bounds[0]), new THREE.Vector3(...b.data.bounds[1])));
    }
    return box.isEmpty() ? null : [box.min.toArray(), box.max.toArray()];
  }

  // Ekrandaki 1 pikselin verilen noktadaki dünya karşılığı (mm).
  worldPerPixel(point) {
    const h = this.container.clientHeight || 1;
    if (this.isOrthographic) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = point ? point.distanceTo(this.camera.position) : this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2))) / h;
  }

  // ---------------------------------------------------------------------------
  // Gövdeler
  // ---------------------------------------------------------------------------

  setBodies(list, metaOf) {
    for (const b of this.bodies.values()) {
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      b.edges.geometry.dispose();
    }
    this.bodiesGroup.clear();
    this.bodies.clear();
    for (const data of list) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.bodyId = data.id;
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.lines, 3));
      const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: EDGE }));
      edges.userData.bodyId = data.id;
      const group = new THREE.Group();
      group.add(mesh, edges);
      this.bodiesGroup.add(group);
      this.bodies.set(data.id, { data, mesh, edges, group });
    }
    this.updateAppearance(metaOf);
    this.updateShadowBounds();
  }

  // Önizleme sırasında seçim, işlem öncesi geometri üzerinden yapılır; çünkü
  // yüz/kenar indeksleri işlemin uygulandığı (önceki) topolojiye aittir.
  setPickBodies(list) {
    this.pickSet = null;
    if (!list) return;
    this.pickSet = new Map();
    for (const data of list) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry);
      mesh.userData.bodyId = data.id;
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.lines, 3));
      const edges = new THREE.LineSegments(edgeGeometry);
      edges.userData.bodyId = data.id;
      const group = new THREE.Group();
      group.add(mesh, edges);
      group.visible = this.metaOf?.(data.id).visible !== false;
      group.updateMatrixWorld(true);
      this.pickSet.set(data.id, { data, mesh, edges, group });
    }
  }

  get pickable() { return this.pickSet || this.bodies; }

  updateAppearance(metaOf) {
    this.metaOf = metaOf;
    for (const [id, b] of this.bodies) {
      const meta = metaOf(id);
      const preset = MATERIALS[meta.material] || MATERIALS.plastic;
      const m = b.mesh.material;
      m.color.set(preset.color && meta.material !== 'plastic' && meta.material !== 'gloss' && meta.material !== 'rubber' ? preset.color : meta.color);
      m.roughness = preset.roughness;
      m.metalness = preset.metalness;
      m.opacity = preset.opacity ?? 1;
      m.transparent = m.opacity < 1;
      m.depthWrite = !m.transparent;
      m.needsUpdate = true;
      b.group.visible = meta.visible !== false;
      b.edges.visible = this.edgesVisible;
    }
  }

  setEdgesVisible(on) {
    this.edgesVisible = on;
    for (const b of this.bodies.values()) b.edges.visible = on;
  }

  setBodyMatrix(id, matrix) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.group.matrixAutoUpdate = false;
    b.group.matrix.copy(matrix || new THREE.Matrix4());
    b.group.matrixWorldNeedsUpdate = true;
  }

  updateShadowBounds() {
    const bounds = this.modelBounds();
    const c = bounds ? new THREE.Vector3(...bounds[0]).add(new THREE.Vector3(...bounds[1])).multiplyScalar(0.5) : new THREE.Vector3();
    const size = bounds ? new THREE.Vector3(...bounds[1]).sub(new THREE.Vector3(...bounds[0])).length() : 200;
    const s = Math.max(size, 100);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 6 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).add(new THREE.Vector3(0.5, -0.65, 1).normalize().multiplyScalar(s * 3));
  }

  // ---------------------------------------------------------------------------
  // Seçim
  // ---------------------------------------------------------------------------

  setRay(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // İmlecin altındaki yüz, kenar ya da gövdeyi döndürür.
  pick(clientX, clientY, filter = 'auto') {
    this.setRay(clientX, clientY);
    const meshes = [...this.pickable.values()].filter((b) => b.group.visible).map((b) => b.mesh);
    const faceHit = this.raycaster.intersectObjects(meshes, false)[0];
    const at = faceHit ? faceHit.point : null;
    const tolerance = this.worldPerPixel(at) * PICK_PX;

    let edgeHit = null;
    if ((filter === 'auto' || filter === 'edge') && this.edgesVisible) {
      this.raycaster.params.Line.threshold = tolerance;
      const lines = [...this.pickable.values()].filter((b) => b.group.visible).map((b) => b.edges);
      edgeHit = this.raycaster.intersectObjects(lines, false)[0] || null;
      if (edgeHit && faceHit && edgeHit.distance > faceHit.distance + tolerance * 2) edgeHit = null; // arkada kalan kenar
    }

    if (edgeHit && filter !== 'face' && filter !== 'body') {
      const b = this.pickable.get(edgeHit.object.userData.bodyId);
      const range = findRange(b.data.edges, edgeHit.index);
      if (range && range[2] >= 0) return { kind: 'edge', body: b.data.id, index: range[2], point: edgeHit.point };
    }
    if (!faceHit) return null;
    const b = this.pickable.get(faceHit.object.userData.bodyId);
    if (filter === 'body') return { kind: 'body', body: b.data.id, point: faceHit.point };
    const range = findRange(b.data.faces, faceHit.faceIndex * 3);
    const normal = faceHit.face.normal.clone();
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();
    if (!range || range[2] < 0) return { kind: 'body', body: b.data.id, point: faceHit.point };
    return { kind: 'face', body: b.data.id, index: range[2], point: faceHit.point, normal };
  }

  // Yüzeylerde ya da zeminde (Z=0) bir nokta.
  pickPoint(clientX, clientY) {
    const hit = this.pick(clientX, clientY, 'face');
    if (hit) return hit;
    const ray = this.setRay(clientX, clientY);
    const point = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    return point ? { kind: 'ground', point, normal: new THREE.Vector3(0, 0, 1) } : null;
  }

  faceInfo(bodyId, faceIdx) {
    const b = this.pickable.get(bodyId);
    const range = b?.data.faces.find((f) => f[2] === faceIdx);
    if (!range) return null;
    const pos = b.data.vertices;
    const tri = b.data.triangles;
    const center = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const a = new THREE.Vector3();
    const bb = new THREE.Vector3();
    const c = new THREE.Vector3();
    let area = 0;
    for (let i = range[0]; i < range[0] + range[1]; i += 3) {
      a.fromArray(pos, tri[i] * 3);
      bb.fromArray(pos, tri[i + 1] * 3);
      c.fromArray(pos, tri[i + 2] * 3);
      const n = new THREE.Vector3().crossVectors(bb.clone().sub(a), c.clone().sub(a));
      const triArea = n.length() / 2;
      normal.add(n);
      center.addScaledVector(a.clone().add(bb).add(c).divideScalar(3), triArea);
      area += triArea;
    }
    if (area > 0) center.divideScalar(area);
    return { center, normal: normal.normalize(), area };
  }

  setHighlights(selection, hover) {
    for (const child of this.overlay.children) child.geometry.dispose();
    this.overlay.clear();
    const add = (item, color, isHover) => {
      const b = this.pickable.get(item.body);
      if (!b || !b.group.visible) return;
      if (item.kind === 'face') {
        const range = b.data.faces.find((f) => f[2] === item.index);
        if (!range) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', b.mesh.geometry.attributes.position);
        g.setIndex(new THREE.BufferAttribute(b.data.triangles.slice(range[0], range[0] + range[1]), 1));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: isHover ? 0.3 : 0.5, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }));
        m.matrixAutoUpdate = false;
        m.matrix.copy(b.group.matrix);
        this.overlay.add(m);
      } else if (item.kind === 'edge') {
        for (const range of b.data.edges.filter((e) => e[2] === item.index)) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(b.data.lines.slice(range[0] * 3, (range[0] + range[1]) * 3), 3));
          const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
          l.renderOrder = 5;
          this.overlay.add(l);
        }
      } else if (item.kind === 'body') {
        const g = b.edges.geometry;
        const l = new THREE.LineSegments(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: isHover ? 0.6 : 1 }));
        l.renderOrder = 5;
        this.overlay.add(l);
        const m = new THREE.Mesh(b.mesh.geometry.clone(), new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: isHover ? 0.12 : 0.22, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }));
        this.overlay.add(m);
      }
    };
    for (const item of selection) add(item, SELECT, false);
    if (hover && !selection.some((s) => s.kind === hover.kind && s.body === hover.body && s.index === hover.index)) add(hover, HOVER, true);
  }

  // ---------------------------------------------------------------------------
  // Mesafe tutamacı: bir doğru boyunca sürüklenen ok (uzatma işlemleri için).
  // ---------------------------------------------------------------------------

  showHandle(origin, direction, value, onDrag) {
    this.hideHandle();
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x2f80ff, depthTest: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), material);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 20), material);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    group.add(shaft, tip, knob);
    group.renderOrder = 10;
    group.traverse((o) => { o.renderOrder = 10; });
    this.helpers.add(group);
    this.handle = { group, shaft, tip, knob, origin: origin.clone(), direction: direction.clone().normalize(), value, onDrag, dragging: false };
    this.updateHandle(value);
  }

  updateHandle(value) {
    const h = this.handle;
    if (!h) return;
    h.value = value;
    const scale = this.worldPerPixel(h.origin) * 3; // ekranda sabit boyut
    const len = Math.abs(value);
    const sign = value < 0 ? -1 : 1;
    const dir = h.direction.clone().multiplyScalar(sign);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    h.shaft.quaternion.copy(q);
    h.shaft.scale.set(scale, Math.max(len, 1e-3), scale);
    h.shaft.position.copy(h.origin).addScaledVector(dir, len / 2);
    h.tip.quaternion.copy(q);
    h.tip.scale.setScalar(scale);
    h.tip.position.copy(h.origin).addScaledVector(dir, len + 2 * scale);
    h.knob.scale.setScalar(scale);
    h.knob.position.copy(h.origin).addScaledVector(dir, len + 5 * scale);
  }

  hideHandle() {
    if (!this.handle) return;
    this.handle.group.traverse((o) => o.geometry?.dispose());
    this.helpers.remove(this.handle.group);
    this.handle = null;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    // Görünüm küpü
    const rect = this.dom.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x > rect.width - CUBE_PX - 8 && y < CUBE_PX + 8) {
      const ndc = new THREE.Vector2(((x - (rect.width - CUBE_PX - 8)) / CUBE_PX) * 2 - 1, -((y - 8) / CUBE_PX) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.cubeCamera);
      const hit = this.raycaster.intersectObject(this.cube, false)[0];
      if (hit) {
        e.stopImmediatePropagation();
        this.setView(['right', 'left', 'back', 'front', 'top', 'bottom'][hit.face.materialIndex]);
        return;
      }
    }
    // Mesafe tutamacı
    const h = this.handle;
    if (!h) return;
    this.setRay(e.clientX, e.clientY);
    if (!this.raycaster.intersectObjects([h.knob, h.tip, h.shaft], false).length) return;
    e.stopImmediatePropagation();
    this.controls.enabled = false;
    h.dragging = true;
    h.startValue = h.value;
    h.startT = this.lineParam(e);
    this.dom.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const t = this.lineParam(ev);
      if (t !== null && h.startT !== null) h.onDrag(h.startValue + (t - h.startT), ev);
    };
    const up = () => {
      h.dragging = false;
      this.controls.enabled = true;
      this.dom.removeEventListener('pointermove', move);
      this.dom.removeEventListener('pointerup', up);
      this.dom.removeEventListener('pointercancel', up);
      this.handleJustDragged = true;
      setTimeout(() => { this.handleJustDragged = false; }, 0);
    };
    this.dom.addEventListener('pointermove', move);
    this.dom.addEventListener('pointerup', up);
    this.dom.addEventListener('pointercancel', up);
  }

  // İmleç ışınının tutamaç doğrusuna en yakın noktasının parametresi.
  lineParam(e) {
    const h = this.handle;
    const ray = this.setRay(e.clientX, e.clientY);
    const w0 = h.origin.clone().sub(ray.origin);
    const a = h.direction.dot(h.direction);
    const b = h.direction.dot(ray.direction);
    const c = ray.direction.dot(ray.direction);
    const d = h.direction.dot(w0);
    const e2 = ray.direction.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-8) return null;
    return (b * e2 - c * d) / denom;
  }

  // ---------------------------------------------------------------------------
  // Görünüm küpü
  // ---------------------------------------------------------------------------

  buildViewCube() {
    this.cubeScene = new THREE.Scene();
    this.cubeCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
    const labels = ['SAĞ', 'SOL', 'ARKA', 'ÖN', 'ÜST', 'ALT'].map(cubeLabel);
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), labels);
    // Yazılar okunur olsun: ÜST/ALT yüzlerini döndür.
    this.cubeScene.add(this.cube);
    const axes = new THREE.AxesHelper(1.5);
    axes.position.set(-1.02, -1.02, -1.02);
    this.cubeScene.add(axes);
  }

  // ---------------------------------------------------------------------------
  // Çizim döngüsü
  // ---------------------------------------------------------------------------

  render() {
    if (this.cameraAnim) this.cameraAnim(performance.now());
    this.controls.update();
    if (this.handle) this.updateHandle(this.handle.value);
    for (const hook of this.frameHooks) hook();
    const r = this.renderer;
    const { width, height } = r.domElement;
    const pr = r.getPixelRatio();
    r.setScissorTest(false);
    r.setViewport(0, 0, width / pr, height / pr);
    r.clear();
    r.render(this.scene, this.camera);

    if (this.cubeVisible !== false) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.cubeCamera.position.copy(dir.multiplyScalar(6));
      this.cubeCamera.up.copy(this.camera.up);
      this.cubeCamera.lookAt(0, 0, 0);
      const x = width / pr - CUBE_PX - 8;
      const y = height / pr - CUBE_PX - 8;
      r.setScissorTest(true);
      r.setScissor(x, y, CUBE_PX, CUBE_PX);
      r.setViewport(x, y, CUBE_PX, CUBE_PX);
      r.clearDepth();
      r.render(this.cubeScene, this.cubeCamera);
      r.setScissorTest(false);
    }
  }

  // Yardımcıları gizleyerek görüntü alır (küçük resim ve PNG dışa aktarma için).
  capture(width, height, { transparent = false, hideGrid = true } = {}) {
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const hidden = [this.overlay, this.helpers, this.transform.getHelper(), ...(hideGrid ? [this.grid] : [])];
    const states = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    const background = this.scene.background;
    if (transparent) this.scene.background = null;
    const camera = this.camera.clone();
    if (camera.isPerspectiveCamera) camera.aspect = width / height;
    else {
      const h = (camera.top - camera.bottom) / 2;
      camera.left = -h * width / height;
      camera.right = h * width / height;
    }
    camera.updateProjectionMatrix();
    const r = this.renderer;
    r.setRenderTarget(target);
    r.setViewport(0, 0, width, height);
    r.setClearColor(0x000000, transparent ? 0 : 1);
    r.clear();
    r.render(this.scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    r.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    target.dispose();
    this.scene.background = background;
    hidden.forEach((o, i) => { o.visible = states[i]; });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      image.data.set(pixels.subarray((height - row - 1) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
}
