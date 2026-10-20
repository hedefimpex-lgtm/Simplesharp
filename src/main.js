import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { History } from './history.js';
import { loadFile, exportGLB, download } from './io.js';

const STORAGE_KEY = 'sharp3d.scene';
const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------------------
// Sahne kurulumu
// ---------------------------------------------------------------------------

const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color($('#bg').value);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
camera.position.set(6, 5, 8);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 0.6);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 50 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const grid = new THREE.GridHelper(40, 40, 0x556070, 0x30363f);
scene.add(grid);

// Gölge alan görünmez zemin.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.3 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Kullanıcının düzenlediği tüm nesneler bu grubun altında durur.
const world = new THREE.Group();
world.name = 'Dünya';
scene.add(world);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0.5, 0);

const transform = new TransformControls(camera, renderer.domElement);
scene.add(transform.getHelper());
transform.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });

const selectionBox = new THREE.BoxHelper(undefined, 0x4f9cff);
selectionBox.visible = false;
scene.add(selectionBox);

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

let selected = null;
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

const counters = {};

function createPrimitive(type) {
  const def = PRIMITIVES[type];
  const color = new THREE.Color().setHSL(Math.random(), 0.55, 0.6);
  const mesh = new THREE.Mesh(
    def.geometry(),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide })
  );
  counters[type] = (counters[type] || 0) + 1;
  mesh.name = `${def.name} ${counters[type]}`;
  mesh.position.set((Math.random() - 0.5) * 4, def.y, (Math.random() - 0.5) * 4);
  if (def.rx) mesh.rotation.x = def.rx;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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

function addObject(object) {
  prepare(object);
  history.execute({
    redo: () => { world.add(object); select(object); },
    undo: () => { world.remove(object); select(null); },
  });
}

function removeObject(object) {
  if (!object) return;
  const index = world.children.indexOf(object);
  history.execute({
    redo: () => { world.remove(object); select(null); },
    undo: () => {
      world.add(object);
      world.children.splice(world.children.indexOf(object), 1);
      world.children.splice(index, 0, object);
      select(object);
    },
  });
}

function duplicateObject(object) {
  if (!object) return;
  const copy = object.clone();
  copy.traverse((child) => {
    if (child.isMesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m) => m.clone())
        : child.material.clone();
    }
  });
  copy.name = `${object.name} kopya`;
  copy.position.x += 1;
  addObject(copy);
}

function clearScene() {
  const removed = [...world.children];
  if (!removed.length) return;
  history.execute({
    redo: () => { removed.forEach((o) => world.remove(o)); select(null); },
    undo: () => { removed.forEach((o) => world.add(o)); refreshTree(); },
  });
}

// Bir değeri değiştiren genel komut.
function setValue(apply, before, after) {
  if (before === after) return;
  history.execute({ redo: () => apply(after), undo: () => apply(before) });
}

function snapshotTransform(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  };
}

function applyTransform(object, state) {
  object.position.copy(state.position);
  object.quaternion.copy(state.quaternion);
  object.scale.copy(state.scale);
  refreshInspectorValues();
}

let dragStart = null;
transform.addEventListener('mouseDown', () => { dragStart = snapshotTransform(transform.object); });
transform.addEventListener('mouseUp', () => {
  const object = transform.object;
  if (!object || !dragStart) return;
  const before = dragStart;
  const after = snapshotTransform(object);
  dragStart = null;
  if (before.position.equals(after.position) && before.quaternion.equals(after.quaternion) && before.scale.equals(after.scale)) return;
  history.push({
    redo: () => applyTransform(object, after),
    undo: () => applyTransform(object, before),
  });
});
transform.addEventListener('objectChange', refreshInspectorValues);

// ---------------------------------------------------------------------------
// Seçim
// ---------------------------------------------------------------------------

function select(object) {
  selected = object;
  if (object) {
    transform.attach(object);
    selectionBox.setFromObject(object);
    selectionBox.visible = true;
  } else {
    transform.detach();
    selectionBox.visible = false;
  }
  refreshTree();
  buildInspector();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const downAt = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (e) => downAt.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || transform.dragging) return;
  if (downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return; // kamera sürüklemesi
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(world.children, true).find((h) => isVisible(h.object));
  select(hit ? topLevel(hit.object) : null);
});

function topLevel(object) {
  while (object.parent && object.parent !== world) object = object.parent;
  return object;
}

function isVisible(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function focusSelection() {
  const box = new THREE.Box3();
  if (selected) box.setFromObject(selected);
  else if (world.children.length) box.setFromObject(world);
  else return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.5);
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, radius * 2.8);
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
    li.classList.toggle('selected', object === selected);
    li.classList.toggle('hidden-obj', !object.visible);
    li.addEventListener('click', () => select(object));
    li.addEventListener('dblclick', () => { select(object); focusSelection(); });
    tree.appendChild(li);
  }
  updateStats();
}

function updateStats() {
  let meshes = 0;
  let triangles = 0;
  world.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  $('#stats').textContent = `${world.children.length} nesne · ${meshes} mesh · ${Math.round(triangles).toLocaleString('tr-TR')} üçgen`;
}

// ---------------------------------------------------------------------------
// Özellik paneli
// ---------------------------------------------------------------------------

const RAD = THREE.MathUtils.RAD2DEG;
let inspectorInputs = null;

function firstMaterial(object) {
  let material = null;
  object.traverse((o) => {
    if (!material && o.isMesh && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial) material = o.material;
  });
  return material;
}

function buildInspector() {
  const props = $('#props');
  props.replaceChildren();
  inspectorInputs = null;
  if (!selected) {
    props.className = 'empty';
    props.textContent = 'Bir nesne seçin';
    return;
  }
  props.className = '';
  const object = selected;

  const nameInput = Object.assign(document.createElement('input'), { type: 'text', value: object.name });
  nameInput.addEventListener('change', () =>
    setValue((v) => { object.name = v; nameInput.value = v; refreshTree(); }, object.name, nameInput.value)
  );
  props.append(labeled('Ad', nameInput));

  const visible = Object.assign(document.createElement('input'), { type: 'checkbox', checked: object.visible });
  visible.addEventListener('change', () =>
    setValue((v) => { object.visible = v; visible.checked = v; selectionBox.visible = v; refreshTree(); }, object.visible, visible.checked)
  );
  props.append(labeled('Görünür', visible));

  inspectorInputs = {
    position: vectorRow(props, 'Konum', object, 'position', 1, 0.1),
    rotation: vectorRow(props, 'Dönüş°', object, 'rotation', RAD, 5),
    scale: vectorRow(props, 'Ölçek', object, 'scale', 1, 0.1),
  };
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

function vectorRow(parent, label, object, prop, factor, step) {
  const row = document.createElement('div');
  row.className = 'vec';
  const span = document.createElement('span');
  span.textContent = label;
  row.append(span);
  const inputs = ['x', 'y', 'z'].map((axis) => {
    const input = Object.assign(document.createElement('input'), { type: 'number', step });
    input.addEventListener('change', () => {
      const value = parseFloat(input.value);
      if (Number.isNaN(value)) return refreshInspectorValues();
      const before = snapshotTransform(object);
      object[prop][axis] = value / factor;
      const after = snapshotTransform(object);
      history.push({ redo: () => applyTransform(object, after), undo: () => applyTransform(object, before) });
      refreshInspectorValues();
    });
    row.append(input);
    return { input, axis };
  });
  parent.append(row);
  return { inputs, prop, factor };
}

function refreshInspectorValues() {
  if (selected) selectionBox.setFromObject(selected);
  if (!inspectorInputs || !selected) return;
  for (const { inputs, prop, factor } of Object.values(inspectorInputs)) {
    for (const { input, axis } of inputs) {
      if (document.activeElement === input) continue;
      input.value = +(selected[prop][axis] * factor).toFixed(3);
    }
  }
}

// ---------------------------------------------------------------------------
// Ortam ayarları
// ---------------------------------------------------------------------------

function setWireframe(mesh, on) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((m) => { if ('wireframe' in m) m.wireframe = on; });
}

$('#bg').addEventListener('input', (e) => scene.background.set(e.target.value));
$('#grid').addEventListener('change', (e) => { grid.visible = e.target.checked; });
$('#shadows').addEventListener('change', (e) => {
  sun.castShadow = e.target.checked;
  ground.visible = e.target.checked;
});
$('#wireframe').addEventListener('change', (e) => {
  world.traverse((o) => { if (o.isMesh) setWireframe(o, e.target.checked); });
});

// ---------------------------------------------------------------------------
// Araç çubuğu ve kısayollar
// ---------------------------------------------------------------------------

document.querySelectorAll('[data-add]').forEach((button) =>
  button.addEventListener('click', () => addObject(createPrimitive(button.dataset.add)))
);

function setMode(mode) {
  transform.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
document.querySelectorAll('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => setMode(button.dataset.mode))
);

function toggleSnap() {
  const on = !$('#snap').classList.contains('active');
  $('#snap').classList.toggle('active', on);
  transform.setTranslationSnap(on ? 0.5 : null);
  transform.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  transform.setScaleSnap(on ? 0.1 : null);
}

$('#snap').addEventListener('click', toggleSnap);
$('#undo').addEventListener('click', () => history.undo());
$('#redo').addEventListener('click', () => history.redo());
$('#duplicate').addEventListener('click', () => duplicateObject(selected));
$('#delete').addEventListener('click', () => removeObject(selected));
$('#focus').addEventListener('click', focusSelection);
$('#clear').addEventListener('click', () => {
  if (world.children.length && confirm('Sahnedeki tüm nesneler silinsin mi?')) clearScene();
});
$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  importFiles(e.target.files);
  e.target.value = '';
});
$('#export').addEventListener('click', () => {
  if (!world.children.length) return alert('Dışa aktarılacak nesne yok.');
  const visible = world.children.filter((o) => o.visible);
  exportGLB(visible).catch((err) => alert(`Dışa aktarma başarısız: ${err.message}`));
});
$('#screenshot').addEventListener('click', () => {
  const helpers = [grid.visible, transform.getHelper().visible, selectionBox.visible];
  grid.visible = transform.getHelper().visible = selectionBox.visible = false;
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => download(blob, 'sharp3d.png'));
  [grid.visible, transform.getHelper().visible, selectionBox.visible] = helpers;
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
  else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); }
  else if (ctrl && key === 'd') { e.preventDefault(); duplicateObject(selected); }
  else if (ctrl) return;
  else if (key === 'w') setMode('translate');
  else if (key === 'e') setMode('rotate');
  else if (key === 'r') setMode('scale');
  else if (key === 's') toggleSnap();
  else if (key === 'f') focusSelection();
  else if (key === 'delete' || key === 'backspace') removeObject(selected);
  else if (key === 'escape') select(null);
});

// ---------------------------------------------------------------------------
// İçe aktarma (dosya seçici ve sürükle-bırak)
// ---------------------------------------------------------------------------

async function importFiles(files) {
  for (const file of files) {
    try {
      addObject(await loadFile(file));
    } catch (err) {
      console.error(err);
      alert(`${file.name} yüklenemedi: ${err.message}`);
    }
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
  importFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// Otomatik kayıt (localStorage)
// ---------------------------------------------------------------------------

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveScene, 500);
}

function saveScene() {
  try {
    const json = world.children.map((o) => o.toJSON());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  } catch (err) {
    console.warn('Sahne kaydedilemedi (büyük olabilir):', err);
  }
}

async function restoreScene() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
  if (!Array.isArray(data) || !data.length) return false;
  const loader = new THREE.ObjectLoader();
  for (const json of data) {
    try {
      world.add(prepare(await loader.parseAsync(json)));
    } catch (err) {
      console.warn('Nesne geri yüklenemedi:', err);
    }
  }
  return world.children.length > 0;
}

// ---------------------------------------------------------------------------
// Döngü
// ---------------------------------------------------------------------------

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

renderer.setAnimationLoop(() => {
  orbit.update();
  renderer.render(scene, camera);
});

if (!(await restoreScene())) {
  const box = createPrimitive('box');
  box.position.set(-1.2, 0.5, 0);
  const sphere = createPrimitive('sphere');
  sphere.position.set(1.2, 0.5, 0);
  world.add(prepare(box), prepare(sphere));
}
refreshTree();
history.onChange();

// Test ve hata ayıklama için.
window.sharp3d = { scene, world, camera, history, select, addObject, createPrimitive };
