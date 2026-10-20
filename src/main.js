import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { History } from './history.js';
import { loadFile, exportModel, download, serializeProject, parseProject } from './io.js';
import { SketchTool, buildExtrudeGeometry, isVisible } from './sketch.js';
import { MeasureTool } from './measure.js';
import { booleanOperation } from './csg.js';
import * as units from './units.js';
import { toast } from './ui.js';

const STORAGE_KEY = 'sharp3d.scene';
const DEFAULT_DEPTH = 0.5; // 50 mm
const EDGE_TRIANGLE_LIMIT = 200_000;
const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------------------
// Hata yakalama: beklenmeyen hatalar uygulamayı durdurmaz, kullanıcıya gösterilir.
// ---------------------------------------------------------------------------

let lastError = '';
function reportError(err) {
  const message = err?.message || String(err);
  console.error(err);
  if (message === lastError) return;
  lastError = message;
  setTimeout(() => { lastError = ''; }, 3000);
  toast(`Hata: ${message}`, 'error', 6000);
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

function fatal(message) {
  const el = $('#fatal');
  el.textContent = message;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Sahne kurulumu
// ---------------------------------------------------------------------------

const viewport = $('#viewport');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
} catch (err) {
  fatal('Bu tarayıcı WebGL desteklemiyor ya da grafik hızlandırma kapalı. Sharp3D için güncel bir Chrome, Edge, Firefox veya Safari kullanın.');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  fatal('Grafik bağlamı kayboldu, geri yükleniyor…');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  $('#fatal').hidden = true;
  toast('Grafik bağlamı geri yüklendi');
});

const scene = new THREE.Scene();
scene.background = new THREE.Color($('#bg').value);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
camera.position.set(6, 5, 8);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 50 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// 1 hücre = 1 birim = 100 mm.
const grid = new THREE.GridHelper(40, 40, 0x556070, 0x30363f);
scene.add(grid);

// Gölge alan görünmez zemin.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.3 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002; // ızgarayla aynı derinlikte çakışmasın
ground.receiveShadow = true;
scene.add(ground);

// Kullanıcının düzenlediği tüm nesneler bu grubun altında durur.
const world = new THREE.Group();
world.name = 'Dünya';
scene.add(world);

// Kenar çizgileri ayrı tutulur; kaydedilmez ve boolean işlemlerine girmez.
const edgesGroup = new THREE.Group();
scene.add(edgesGroup);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0.5, 0);

const transform = new TransformControls(camera, renderer.domElement);
scene.add(transform.getHelper());
transform.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });

const selectionBoxes = [];

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

let selection = [];
const primary = () => selection.at(-1) ?? null;

const history = new History(100, () => {
  $('#undo').disabled = !history.canUndo;
  $('#redo').disabled = !history.canRedo;
  scheduleSave();
});

// ---------------------------------------------------------------------------
// Nesne oluşturma
// ---------------------------------------------------------------------------

const PRIMITIVES = {
  box: { name: 'Küp', geometry: () => new THREE.BoxGeometry(1, 1, 1), y: 0.5 },
  sphere: { name: 'Küre', geometry: () => new THREE.SphereGeometry(0.5, 48, 32), y: 0.5 },
  cylinder: { name: 'Silindir', geometry: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48), y: 0.5 },
  cone: { name: 'Koni', geometry: () => new THREE.ConeGeometry(0.5, 1, 48), y: 0.5 },
  torus: { name: 'Simit', geometry: () => new THREE.TorusGeometry(0.4, 0.15, 24, 64), y: 0.55 },
  plane: { name: 'Düzlem', geometry: () => new THREE.PlaneGeometry(2, 2), y: 0.01, rx: -Math.PI / 2 },
};

// "Küp 3" gibi, sahnede kullanılmamış bir sonraki adı verir.
function nextName(base) {
  let max = 0;
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const o of world.children) {
    const m = pattern.exec(o.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`;
}

function newMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.5, 0.62),
    roughness: 0.45,
    metalness: 0.1,
    ...options,
  });
}

function createPrimitive(type) {
  const def = PRIMITIVES[type];
  const mesh = new THREE.Mesh(def.geometry(), newMaterial({ side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide }));
  mesh.name = nextName(def.name);
  mesh.position.set(Math.round((Math.random() - 0.5) * 8) / 2, def.y, Math.round((Math.random() - 0.5) * 8) / 2);
  if (def.rx) mesh.rotation.x = def.rx;
  return mesh;
}

const SKETCH_NAMES = { rect: 'Dikdörtgen gövde', circle: 'Silindirik gövde', poly: 'Çokgen gövde' };

function createExtrusion({ kind, points, origin, quaternion }) {
  const mesh = new THREE.Mesh(buildExtrudeGeometry(points, DEFAULT_DEPTH), newMaterial());
  mesh.name = nextName(SKETCH_NAMES[kind] || 'Gövde');
  mesh.position.copy(origin);
  mesh.quaternion.copy(quaternion);
  mesh.userData.sketch = { kind, points, depth: DEFAULT_DEPTH };
  return mesh;
}

function prepare(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      setWireframe(child, $('#wireframe').checked);
    }
  });
  return object;
}

// ---------------------------------------------------------------------------
// Komutlar (geri alınabilir işlemler)
// ---------------------------------------------------------------------------

function insertAt(object, index) {
  world.add(object);
  const children = world.children;
  children.splice(children.indexOf(object), 1);
  children.splice(Math.min(Math.max(index, 0), children.length), 0, object);
}

// Nesneleri sahneden çıkarıp yerlerine yenilerini koyar (ekleme, silme, boolean, proje açma).
function replaceObjects(removed, added) {
  removed = removed.filter((o) => o.parent === world);
  if (!removed.length && !added.length) return;
  added.forEach(prepare);
  const slots = removed.map((o) => [o, world.children.indexOf(o)]).sort((a, b) => a[1] - b[1]);
  history.execute({
    redo: () => {
      removed.forEach((o) => world.remove(o));
      added.forEach((o) => world.add(o));
      setSelection(added.length === 1 ? added : []);
    },
    undo: () => {
      added.forEach((o) => world.remove(o));
      slots.forEach(([o, i]) => insertAt(o, i));
      setSelection(removed.length <= 1 ? removed : []);
    },
  });
}

const addObjects = (objects) => replaceObjects([], objects);
const removeObjects = (objects) => replaceObjects(objects, []);

function cloneObject(object) {
  const copy = object.clone();
  copy.traverse((child) => {
    if (child.isMesh) {
      child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
    }
  });
  return copy;
}

function duplicateSelection() {
  if (!selection.length) return;
  const copies = selection.map((object) => {
    const copy = cloneObject(object);
    copy.name = `${object.name} kopya`;
    copy.position.x += 1;
    return copy;
  });
  replaceObjects([], copies);
  setSelection(copies);
}

// Bir değeri değiştiren genel komut.
function setValue(apply, before, after) {
  if (before === after) return;
  history.execute({ redo: () => apply(after), undo: () => apply(before) });
}

function snapshotTransform(object) {
  return { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() };
}

function applyTransform(object, state) {
  object.position.copy(state.position);
  object.quaternion.copy(state.quaternion);
  object.scale.copy(state.scale);
  refreshInspectorValues();
}

function pushTransform(object, before) {
  const after = snapshotTransform(object);
  if (before.position.equals(after.position) && before.quaternion.equals(after.quaternion) && before.scale.equals(after.scale)) return;
  history.push({ redo: () => applyTransform(object, after), undo: () => applyTransform(object, before) });
}

// Çizimden gelen gövdenin yüksekliğini değiştirir (geometri yeniden üretilir).
function setExtrudeDepth(object, depth) {
  const sketch = object.userData.sketch;
  if (!sketch || !Number.isFinite(depth) || Math.abs(depth) < 1e-3 || depth === sketch.depth) return refreshInspectorValues();
  const before = { geometry: object.geometry, depth: sketch.depth };
  const after = { geometry: buildExtrudeGeometry(sketch.points, depth), depth };
  const apply = (state) => {
    object.geometry = state.geometry;
    object.userData.sketch.depth = state.depth;
    if (object === primary()) buildInspector(); // boyutlar değişti
    updateStats();
  };
  history.execute({ redo: () => apply(after), undo: () => apply(before) });
}

let gizmoPressed = false;
let dragStart = null;
transform.addEventListener('mouseDown', () => {
  gizmoPressed = true;
  dragStart = snapshotTransform(transform.object);
});
transform.addEventListener('mouseUp', () => {
  const object = transform.object;
  if (object && dragStart) pushTransform(object, dragStart);
  dragStart = null;
});
transform.addEventListener('objectChange', refreshInspectorValues);

// ---------------------------------------------------------------------------
// Boolean işlemleri
// ---------------------------------------------------------------------------

const BOOL_NAMES = { union: 'Birleşim', subtract: 'Fark', intersect: 'Kesişim' };

function runBoolean(op) {
  if (selection.length < 2) {
    toast('Boolean için en az iki katı seçin (Shift + tık). İlk seçilen ana gövdedir.', 'warn');
    return;
  }
  const [base, ...tools] = selection;
  const baseMaterial = firstMaterial(base);
  const material = baseMaterial ? baseMaterial.clone() : newMaterial();
  material.side = THREE.FrontSide;
  try {
    const mesh = booleanOperation(op, base, tools, material);
    mesh.name = nextName(BOOL_NAMES[op]);
    replaceObjects(selection, [mesh]);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// Seçim
// ---------------------------------------------------------------------------

function setSelection(objects) {
  selection = objects.filter((o) => o && o.parent === world);
  attachGizmo();
  refreshTree();
  buildInspector();
  updateBooleanButtons();
}

function toggleSelection(object) {
  if (selection.includes(object)) setSelection(selection.filter((o) => o !== object));
  else setSelection([...selection, object]);
}

function attachGizmo() {
  const object = primary();
  if (object && !activeTool && object.visible) transform.attach(object);
  else transform.detach();
}

function updateSelectionBoxes() {
  while (selectionBoxes.length < selection.length) {
    const box = new THREE.BoxHelper(undefined, 0x4f9cff);
    scene.add(box);
    selectionBoxes.push(box);
  }
  selectionBoxes.forEach((box, i) => {
    const object = selection[i];
    box.visible = !!object && isVisible(object);
    if (box.visible) {
      box.material.color.set(object === primary() ? 0x4f9cff : 0x8fb8ff);
      box.setFromObject(object);
    }
  });
}

function updateBooleanButtons() {
  document.querySelectorAll('[data-bool]').forEach((b) => { b.disabled = selection.length < 2; });
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const downAt = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (e) => downAt.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  const fromGizmo = gizmoPressed;
  gizmoPressed = false;
  if (e.button !== 0 || !e.isPrimary || activeTool || fromGizmo || transform.dragging) return;
  if (downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return; // kamera sürüklemesi
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(world.children, true).find((h) => h.object.isMesh && isVisible(h.object));
  const object = hit ? topLevel(hit.object) : null;
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    if (object) toggleSelection(object);
  } else {
    setSelection(object ? [object] : []);
  }
});

function topLevel(object) {
  while (object.parent && object.parent !== world) object = object.parent;
  return object;
}

function sceneBounds(objects) {
  const box = new THREE.Box3();
  objects.forEach((o) => box.expandByObject(o));
  return box;
}

function focusSelection() {
  const objects = selection.length ? selection : world.children.filter((o) => o.visible);
  if (!objects.length) return;
  const sphere = sceneBounds(objects).getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.5);
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, radius * 2.8);
}

const VIEWS = {
  iso: new THREE.Vector3(1, 0.8, 1.3),
  top: new THREE.Vector3(0, 1, 0.0001),
  front: new THREE.Vector3(0, 0, 1),
  right: new THREE.Vector3(1, 0, 0),
};

function setView(name) {
  const distance = camera.position.distanceTo(orbit.target);
  camera.position.copy(orbit.target).addScaledVector(VIEWS[name].clone().normalize(), distance);
  camera.lookAt(orbit.target);
}

// ---------------------------------------------------------------------------
// Araçlar: çizim ve ölçüm
// ---------------------------------------------------------------------------

let activeTool = null;
const hud = $('#hud');

const sketch = new SketchTool({
  camera,
  dom: renderer.domElement,
  scene,
  world,
  hud,
  isSnapping: () => snapping,
  onComplete: (profile) => {
    const mesh = createExtrusion(profile);
    setTool(null);
    addObjects([mesh]);
    toast('Gövde oluşturuldu. Yüksekliği Özellikler panelinden değiştirebilirsiniz.');
  },
  onCancel: () => { if (activeTool !== 'measure') setTool(null); },
});

const measure = new MeasureTool({ camera, dom: renderer.domElement, scene, world, container: viewport });
measure.onExit = () => setTool(null);

function setTool(tool) {
  if (tool === activeTool) tool = null;
  const previous = activeTool;
  activeTool = tool;
  if (previous === 'measure') measure.stop();
  else if (previous && sketch.active) { sketch.kind = null; sketch.reset(); renderer.domElement.style.cursor = ''; }

  if (tool === 'measure') measure.start();
  else if (tool) sketch.start(tool);

  // Çizerken sol tık kamerayı döndürmesin; sağ tık/iki parmak hâlâ çalışır.
  const drawing = tool && tool !== 'measure';
  orbit.mouseButtons.LEFT = drawing ? null : THREE.MOUSE.ROTATE;
  orbit.touches.ONE = drawing ? null : THREE.TOUCH.ROTATE;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  attachGizmo();
}

// ---------------------------------------------------------------------------
// Sahne ağacı
// ---------------------------------------------------------------------------

function refreshTree() {
  const tree = $('#tree');
  tree.replaceChildren();
  for (const object of world.children) {
    const li = document.createElement('li');
    li.textContent = object.name || '(adsız)';
    li.classList.toggle('selected', object === primary());
    li.classList.toggle('multi', selection.includes(object) && object !== primary());
    li.classList.toggle('hidden-obj', !object.visible);
    li.addEventListener('click', (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelection(object);
      else setSelection([object]);
    });
    li.addEventListener('dblclick', () => { setSelection([object]); focusSelection(); });
    tree.appendChild(li);
  }
  updateStats();
}

function triangleCount(g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

function updateStats() {
  let meshes = 0;
  let triangles = 0;
  world.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    triangles += triangleCount(o.geometry);
  });
  $('#stats').textContent = `${world.children.length} nesne · ${meshes} mesh · ${Math.round(triangles).toLocaleString('tr-TR')} üçgen · ${units.unitLabel()}`;
}

// ---------------------------------------------------------------------------
// Kenar çizgileri
// ---------------------------------------------------------------------------

const edgeLines = new Map(); // mesh -> LineSegments
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55 });

function updateEdges() {
  const show = $('#edges').checked && !$('#wireframe').checked;
  edgesGroup.visible = show;
  if (!show) return;
  const seen = new Set();
  world.traverse((mesh) => {
    if (!mesh.isMesh) return;
    seen.add(mesh);
    let lines = edgeLines.get(mesh);
    if (!lines || lines.userData.geometry !== mesh.geometry) {
      if (lines) { edgesGroup.remove(lines); lines.geometry.dispose(); }
      lines = new THREE.LineSegments(
        triangleCount(mesh.geometry) > EDGE_TRIANGLE_LIMIT ? new THREE.BufferGeometry() : new THREE.EdgesGeometry(mesh.geometry, 25),
        edgeMaterial
      );
      lines.matrixAutoUpdate = false;
      lines.userData.geometry = mesh.geometry;
      edgeLines.set(mesh, lines);
      edgesGroup.add(lines);
    }
    lines.matrix.copy(mesh.matrixWorld);
    lines.visible = isVisible(mesh);
  });
  for (const [mesh, lines] of edgeLines) {
    if (seen.has(mesh)) continue;
    edgesGroup.remove(lines);
    lines.geometry.dispose();
    edgeLines.delete(mesh);
  }
}

// ---------------------------------------------------------------------------
// Özellik paneli
// ---------------------------------------------------------------------------

const RAD = THREE.MathUtils.RAD2DEG;
let inspectorInputs = [];

function firstMaterial(object) {
  let material = null;
  object.traverse((o) => {
    if (!material && o.isMesh && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial) material = o.material;
  });
  return material;
}

// Nesnenin kendi eksenlerindeki ölçeklenmemiş boyutu.
function localSize(object) {
  object.updateWorldMatrix(true, true);
  const inverse = object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  object.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    const relative = inverse.clone().multiply(child.matrixWorld);
    box.union(child.geometry.boundingBox.clone().applyMatrix4(relative));
  });
  return box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
}

function buildInspector() {
  const props = $('#props');
  props.replaceChildren();
  inspectorInputs = [];
  const object = primary();
  if (!object) {
    props.className = 'empty';
    props.textContent = 'Bir nesne seçin';
    return;
  }
  props.className = '';

  if (selection.length > 1) {
    const info = document.createElement('p');
    info.className = 'hint';
    info.textContent = `${selection.length} nesne seçili. Boolean işlemlerinde ilk seçilen "${selection[0].name}" ana gövdedir. Aşağıda son seçilen gösteriliyor.`;
    props.append(info);
  }

  const nameInput = Object.assign(document.createElement('input'), { type: 'text', value: object.name });
  nameInput.addEventListener('change', () =>
    setValue((v) => { object.name = v; nameInput.value = v; refreshTree(); }, object.name, nameInput.value)
  );
  props.append(labeled('Ad', nameInput));

  const visible = Object.assign(document.createElement('input'), { type: 'checkbox', checked: object.visible });
  visible.addEventListener('change', () =>
    setValue((v) => { object.visible = v; visible.checked = v; attachGizmo(); refreshTree(); }, object.visible, visible.checked)
  );
  props.append(labeled('Görünür', visible));

  const unit = units.unitLabel();
  const step = units.displayStep() * 10;
  vectorRow(props, `Konum (${unit})`, object, {
    get: (axis) => units.round(units.toDisplay(object.position[axis])),
    set: (axis, v) => { object.position[axis] = units.fromDisplay(v); },
    step,
  });
  vectorRow(props, 'Dönüş (°)', object, {
    get: (axis) => +(object.rotation[axis] * RAD).toFixed(2),
    set: (axis, v) => { object.rotation[axis] = v / RAD; },
    step: 15,
  });
  const base = localSize(object);
  vectorRow(props, `Boyut (${unit})`, object, {
    get: (axis) => units.round(units.toDisplay(base[axis] * Math.abs(object.scale[axis]))),
    set: (axis, v) => {
      if (base[axis] < 1e-9 || v <= 0) return;
      object.scale[axis] = Math.sign(object.scale[axis] || 1) * units.fromDisplay(v) / base[axis];
    },
    step,
    min: 0,
  });
  vectorRow(props, 'Ölçek', object, {
    get: (axis) => +object.scale[axis].toFixed(4),
    set: (axis, v) => { if (v !== 0) object.scale[axis] = v; },
    step: 0.1,
  });

  if (object.userData.sketch) {
    const depth = Object.assign(document.createElement('input'), { type: 'number', step });
    depth.addEventListener('change', () => setExtrudeDepth(object, units.fromDisplay(parseFloat(depth.value))));
    inspectorInputs.push({ input: depth, get: () => units.round(units.toDisplay(object.userData.sketch.depth)) });
    props.append(labeled(`Yükseklik (${unit})`, depth));
  }

  if (object.isMesh && object.geometry.type !== 'PlaneGeometry') {
    const volume = document.createElement('output');
    inspectorInputs.push({
      input: volume,
      get: () => {
        if (triangleCount(object.geometry) > EDGE_TRIANGLE_LIMIT) return '—';
        object.updateWorldMatrix(true, false);
        const v = Math.abs(computeMeshVolume(object)) * units.toDisplay(1) ** 3;
        return `${units.round(v).toLocaleString('tr-TR')} ${unit}³`;
      },
      text: true,
    });
    props.append(labeled('Hacim', volume));
  }

  refreshInspectorValues();

  const material = firstMaterial(object);
  if (!material) return;

  const h2 = document.createElement('h2');
  h2.textContent = 'Malzeme';
  props.append(h2);

  const color = Object.assign(document.createElement('input'), { type: 'color', value: `#${material.color.getHexString()}` });
  let colorBefore = color.value;
  color.addEventListener('input', () => material.color.set(color.value));
  color.addEventListener('change', () => {
    const before = colorBefore;
    colorBefore = color.value;
    setValue((v) => { material.color.set(v); color.value = v; }, before, color.value);
  });
  props.append(labeled('Renk', color));

  for (const [key, label] of [['roughness', 'Pürüzlülük'], ['metalness', 'Metaliklik'], ['opacity', 'Opaklık']]) {
    const range = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.01, value: material[key] });
    let before = material[key];
    const apply = (v) => {
      material[key] = v;
      if (key === 'opacity') {
        material.transparent = v < 1;
        material.needsUpdate = true;
      }
      range.value = v;
    };
    range.addEventListener('input', () => apply(parseFloat(range.value)));
    range.addEventListener('change', () => {
      const prev = before;
      before = parseFloat(range.value);
      setValue(apply, prev, before);
    });
    props.append(labeled(label, range));
  }
}

function labeled(text, input) {
  const label = document.createElement('label');
  label.className = 'row';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, input);
  return label;
}

function vectorRow(parent, label, object, { get, set, step, min }) {
  const row = document.createElement('div');
  row.className = 'vec';
  const span = document.createElement('span');
  span.textContent = label;
  row.append(span);
  for (const axis of ['x', 'y', 'z']) {
    const input = Object.assign(document.createElement('input'), { type: 'number', step, title: axis.toUpperCase() });
    if (min !== undefined) input.min = min;
    input.addEventListener('change', () => {
      const value = parseFloat(input.value);
      if (!Number.isFinite(value)) return refreshInspectorValues();
      const before = snapshotTransform(object);
      set(axis, value);
      pushTransform(object, before);
      refreshInspectorValues();
    });
    inspectorInputs.push({ input, get: () => get(axis) });
    row.append(input);
  }
  parent.append(row);
}

function refreshInspectorValues() {
  for (const { input, get, text } of inspectorInputs) {
    if (document.activeElement === input) continue;
    if (text) input.textContent = get();
    else input.value = get();
  }
}

// ---------------------------------------------------------------------------
// Ortam ayarları
// ---------------------------------------------------------------------------

let snapping = false;

function setWireframe(mesh, on) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((m) => { if (m && 'wireframe' in m) m.wireframe = on; });
}

function getSettings() {
  return {
    unit: units.getUnit(),
    background: $('#bg').value,
    grid: $('#grid').checked,
    shadows: $('#shadows').checked,
    edges: $('#edges').checked,
  };
}

function applySettings(settings = {}) {
  if (settings.unit && units.UNITS[settings.unit]) $('#unit').value = settings.unit;
  if (/^#[0-9a-f]{6}$/i.test(settings.background || '')) $('#bg').value = settings.background;
  for (const key of ['grid', 'shadows', 'edges']) if (typeof settings[key] === 'boolean') $(`#${key}`).checked = settings[key];
  ['#unit', '#bg', '#grid', '#shadows', '#edges'].forEach((id) => $(id).dispatchEvent(new Event(id === '#bg' ? 'input' : 'change')));
}

$('#unit').addEventListener('change', (e) => {
  units.setUnit(e.target.value);
  buildInspector();
  measure.refresh();
  updateStats();
  scheduleSave();
});
$('#bg').addEventListener('input', (e) => { scene.background.set(e.target.value); scheduleSave(); });
$('#grid').addEventListener('change', (e) => { grid.visible = e.target.checked; scheduleSave(); });
$('#shadows').addEventListener('change', (e) => {
  sun.castShadow = e.target.checked;
  ground.visible = e.target.checked;
  scheduleSave();
});
$('#edges').addEventListener('change', scheduleSave);
$('#wireframe').addEventListener('change', (e) => {
  world.traverse((o) => { if (o.isMesh) setWireframe(o, e.target.checked); });
});

// ---------------------------------------------------------------------------
// Araç çubuğu ve kısayollar
// ---------------------------------------------------------------------------

document.querySelectorAll('[data-add]').forEach((button) =>
  button.addEventListener('click', () => { setTool(null); addObjects([createPrimitive(button.dataset.add)]); })
);
document.querySelectorAll('[data-tool]').forEach((button) =>
  button.addEventListener('click', () => setTool(button.dataset.tool))
);
document.querySelectorAll('[data-bool]').forEach((button) =>
  button.addEventListener('click', () => runBoolean(button.dataset.bool))
);
document.querySelectorAll('[data-view]').forEach((button) =>
  button.addEventListener('click', () => setView(button.dataset.view))
);

function setMode(mode) {
  transform.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
document.querySelectorAll('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => setMode(button.dataset.mode))
);

function toggleSnap() {
  snapping = !snapping;
  $('#snap').classList.toggle('active', snapping);
  transform.setTranslationSnap(snapping ? 0.1 : null);
  transform.setRotationSnap(snapping ? THREE.MathUtils.degToRad(15) : null);
  transform.setScaleSnap(snapping ? 0.1 : null);
}

function clearScene() {
  if (world.children.length && confirm('Sahnedeki tüm nesneler silinsin mi?')) removeObjects([...world.children]);
}

async function exportSelection() {
  const source = selection.length ? selection : world.children;
  const objects = source.filter((o) => o.visible);
  if (!objects.length) return toast('Dışa aktarılacak görünür nesne yok.', 'warn');
  try {
    await exportModel(objects, $('#export-format').value);
    toast(`${objects.length} nesne dışa aktarıldı${selection.length ? ' (yalnızca seçim)' : ''}.`);
  } catch (err) {
    reportError(new Error(`Dışa aktarma başarısız: ${err.message}`));
  }
}

function saveProject() {
  const data = serializeProject(world.children, getSettings());
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  download(blob, 'sharp3d-proje.sharp3d.json');
}

async function openProject(file) {
  try {
    const { objects, settings, failed } = await parseProject(JSON.parse(await file.text()));
    replaceObjects([...world.children], objects);
    applySettings(settings);
    setSelection([]);
    focusSelection();
    toast(`${file.name} açıldı${failed ? ` (${failed} nesne okunamadı)` : ''}.`, failed ? 'warn' : 'info');
  } catch (err) {
    reportError(new Error(`${file.name} açılamadı: ${err.message}`));
  }
}

function screenshot() {
  const helpers = [grid, transform.getHelper(), ...selectionBoxes];
  const states = helpers.map((h) => h.visible);
  helpers.forEach((h) => { h.visible = false; });
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => blob && download(blob, 'sharp3d.png'));
  helpers.forEach((h, i) => { h.visible = states[i]; });
}

$('#snap').addEventListener('click', toggleSnap);
$('#undo').addEventListener('click', () => history.undo());
$('#redo').addEventListener('click', () => history.redo());
$('#duplicate').addEventListener('click', duplicateSelection);
$('#delete').addEventListener('click', () => removeObjects(selection));
$('#focus').addEventListener('click', focusSelection);
$('#clear').addEventListener('click', clearScene);
$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  importFiles([...e.target.files]);
  e.target.value = '';
});
$('#open').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', (e) => {
  if (e.target.files[0]) openProject(e.target.files[0]);
  e.target.value = '';
});
$('#save').addEventListener('click', saveProject);
$('#export').addEventListener('click', exportSelection);
$('#screenshot').addEventListener('click', screenshot);

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (sketch.handleKey(e) || measure.handleKey(e)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
  else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); }
  else if (ctrl && key === 'd') { e.preventDefault(); duplicateSelection(); }
  else if (ctrl && key === 's') { e.preventDefault(); saveProject(); }
  else if (ctrl && key === 'o') { e.preventDefault(); $('#project-file').click(); }
  else if (ctrl && key === 'a') { e.preventDefault(); setSelection([...world.children]); }
  else if (ctrl || e.altKey) return;
  else if (key === 'w') setMode('translate');
  else if (key === 'e') setMode('rotate');
  else if (key === 'r') setMode('scale');
  else if (key === 's') toggleSnap();
  else if (key === 'f') focusSelection();
  else if (key === '1') setTool('rect');
  else if (key === '2') setTool('circle');
  else if (key === '3') setTool('poly');
  else if (key === 'm') setTool('measure');
  else if (key === '0') setView('iso');
  else if (key === '7') setView('top');
  else if (key === '8') setView('front');
  else if (key === '9') setView('right');
  else if (key === 'delete' || key === 'backspace') removeObjects(selection);
  else if (key === 'escape') { if (activeTool) setTool(null); else setSelection([]); }
});

// ---------------------------------------------------------------------------
// İçe aktarma (dosya seçici ve sürükle-bırak)
// ---------------------------------------------------------------------------

async function importFiles(files) {
  const loaded = [];
  for (const file of files) {
    if (/\.json$/i.test(file.name)) {
      await openProject(file);
      continue;
    }
    try {
      const { object, rescaled } = await loadFile(file);
      loaded.push(object);
      if (rescaled) toast(`${file.name} birimi belirsiz olduğu için ölçeklendi.`, 'warn');
    } catch (err) {
      reportError(new Error(`${file.name} yüklenemedi: ${err.message}`));
    }
  }
  if (loaded.length) {
    addObjects(loaded);
    focusSelection();
  }
}

viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.classList.add('dragging');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('dragging'));
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  importFiles([...e.dataTransfer.files]);
});

// ---------------------------------------------------------------------------
// Otomatik kayıt (localStorage)
// ---------------------------------------------------------------------------

let saveTimer = null;
let saveWarned = false;
let restoring = true;

function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveScene, 500);
}

function saveScene() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject(world.children, getSettings())));
    saveWarned = false;
  } catch (err) {
    console.warn('Sahne kaydedilemedi:', err);
    if (!saveWarned) {
      saveWarned = true;
      toast('Sahne tarayıcıya otomatik kaydedilemedi (çok büyük olabilir). "Kaydet" ile proje dosyası indirin.', 'warn', 8000);
    }
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveScene(); });
window.addEventListener('pagehide', () => { if (saveTimer) saveScene(); });

async function restoreScene() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
  if (!data) return false;
  try {
    const { objects, settings, failed } = await parseProject(data);
    objects.forEach((o) => world.add(prepare(o)));
    applySettings(settings);
    if (failed) toast(`${failed} nesne geri yüklenemedi.`, 'warn');
  } catch (err) {
    console.warn('Kayıtlı sahne okunamadı:', err);
    return false;
  }
  return true; // kullanıcı sahneyi boşaltmışsa boş kalsın
}

// ---------------------------------------------------------------------------
// Döngü
// ---------------------------------------------------------------------------

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

renderer.setAnimationLoop(() => {
  orbit.update();
  // Yardımcı katmanlardaki bir hata çizimi durdurmasın.
  try {
    world.updateMatrixWorld();
    updateSelectionBoxes();
    updateEdges();
    measure.update();
  } catch (err) {
    reportError(err);
  }
  renderer.render(scene, camera);
});

if (!(await restoreScene())) {
  const box = createPrimitive('box');
  box.position.set(-1.2, 0.5, 0);
  world.add(prepare(box));
  const cylinder = createPrimitive('cylinder');
  cylinder.position.set(1.2, 0.5, 0);
  world.add(prepare(cylinder));
}
restoring = false;
setSelection([]);
history.onChange();

// Test ve hata ayıklama için.
window.sharp3d = {
  scene, world, camera, history, units,
  get selection() { return selection; },
  setSelection, addObjects, removeObjects, createPrimitive, createExtrusion, runBoolean, setTool, setExtrudeDepth,
  serialize: () => serializeProject(world.children, getSettings()),
};
