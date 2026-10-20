// Geometri çekirdeği (OpenCascade / replicad) bu Web Worker'da çalışır; böylece
// ağır işlemler arayüzü dondurmaz.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC, exportSTEP, drawProjection } from 'replicad';
import { applyFeature, errorMessage, bodyProperties } from './features.js';

const MESH_OPTIONS = { tolerance: 0.05, angularTolerance: 0.25 };

let ready = null;

function init() {
  ready ??= opencascade({ locateFile: () => wasmUrl }).then((oc) => {
    setOC(oc);
  });
  return ready;
}

// Artımlı değerlendirme: değişmeyen ilk özelliklerin sonucu yeniden kullanılır.
// steps[i] = { key, shapes, status } -> i. özellik uygulandıktan sonraki durum.
let steps = [];

async function evaluate(features) {
  let start = 0;
  while (start < features.length && start < steps.length && steps[start].key === JSON.stringify(features[start])) start++;
  steps.length = start;
  let shapes = start ? new Map(steps[start - 1].shapes) : new Map();

  for (let i = start; i < features.length; i++) {
    const feature = features[i];
    const next = new Map(shapes);
    let status = { id: feature.id, ok: true };
    if (!feature.suppressed) {
      try {
        await applyFeature(next, feature);
        shapes = next;
      } catch (err) {
        console.warn('Özellik başarısız:', feature, err);
        status = { id: feature.id, ok: false, error: errorMessage(feature, err) };
      }
    }
    steps.push({ key: JSON.stringify(feature), shapes, status });
  }
  return { shapes, statuses: steps.map((s) => s.status) };
}

// three.js'e aktarılacak üçgen ve kenar verisini üretir.
const meshCache = new WeakMap();

function meshBody(shape) {
  if (meshCache.has(shape)) return meshCache.get(shape);
  const mesh = shape.mesh(MESH_OPTIONS);
  const edges = shape.meshEdges(MESH_OPTIONS);

  // Gruplar hashCode ile gelir; seçimde kullanmak için shape.faces/edges sırasındaki indekse çevir.
  const faceIndex = new Map(shape.faces.map((f, i) => [f.hashCode, i]));
  const edgeIndex = new Map(shape.edges.map((e, i) => [e.hashCode, i]));

  const result = {
    vertices: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    triangles: new Uint32Array(mesh.triangles),
    faces: mesh.faceGroups.map((g) => [g.start, g.count, faceIndex.get(g.faceId) ?? -1]),
    lines: new Float32Array(edges.lines),
    edges: edges.edgeGroups.map((g) => [g.start, g.count, edgeIndex.get(g.edgeId) ?? -1]),
    faceCount: shape.faces.length,
    edgeCount: shape.edges.length,
    ...bodyProperties(shape),
  };
  meshCache.set(shape, result);
  return result;
}

async function handle(msg) {
  await init();
  switch (msg.type) {
    case 'init':
      return {};
    case 'evaluate': {
      const { shapes, statuses } = await evaluate(msg.features);
      const bodies = [];
      for (const [id, shape] of shapes) {
        try {
          bodies.push({ id, ...meshBody(shape) });
        } catch (err) {
          console.warn('Gövde ağ örgüsü üretilemedi:', id, err);
        }
      }
      return { bodies, statuses };
    }
    case 'export': {
      const { shapes } = await evaluate(msg.features);
      const list = msg.bodies.map((id) => [id, shapes.get(id)]).filter(([, s]) => s);
      if (!list.length) throw new Error('Dışa aktarılacak gövde yok');
      if (msg.format === 'step') {
        return { blob: exportSTEP(list.map(([id, shape]) => ({ shape, name: msg.names?.[id] || id, color: msg.colors?.[id] }))) };
      }
      if (msg.format === 'stl') {
        let shape = list[0][1];
        for (const [, other] of list.slice(1)) shape = shape.fuse(other);
        return { blob: shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.1 }) };
      }
      throw new Error(`Bilinmeyen biçim: ${msg.format}`);
    }
    case 'drawing': {
      // Teknik çizim: her görünüm için görünen ve gizli kenarların SVG yolları.
      const { shapes } = await evaluate(msg.features);
      let shape = null;
      for (const id of msg.bodies) {
        const s = shapes.get(id);
        if (s) shape = shape ? shape.fuse(s) : s;
      }
      if (!shape) throw new Error('Çizilecek gövde yok');
      const views = {};
      for (const view of ['front', 'top', 'right']) {
        const { visible, hidden } = drawProjection(shape, view);
        views[view] = {
          visible: visible.toSVGPaths().flat(),
          hidden: hidden.toSVGPaths().flat(),
          box: visible.boundingBox ? [visible.boundingBox.bounds[0], visible.boundingBox.bounds[1]] : null,
        };
      }
      return { views, bounds: shape.boundingBox.bounds };
    }
    default:
      throw new Error(`Bilinmeyen istek: ${msg.type}`);
  }
}

self.onmessage = async ({ data }) => {
  try {
    const result = await handle(data);
    const transfer = [];
    for (const body of result.bodies || []) {
      // Önbellekteki diziler aktarılırsa boşalır; kopyasını gönder.
      for (const key of ['vertices', 'normals', 'triangles', 'lines']) {
        body[key] = body[key].slice();
        transfer.push(body[key].buffer);
      }
    }
    self.postMessage({ id: data.id, ok: true, result }, transfer);
  } catch (err) {
    console.error(err);
    self.postMessage({ id: data.id, ok: false, error: err?.message || 'Geometri çekirdeği hatası' });
  }
};
