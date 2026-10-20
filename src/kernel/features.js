// Özellik (feature) geçmişini OpenCascade katılarına çeviren saf fonksiyonlar.
// Bu dosya Web Worker içinde çalışır; DOM ya da three.js kullanmaz.
//
// Belge, sırayla uygulanan özelliklerden oluşur. Her özellik bir ya da daha
// fazla gövdeyi (body) oluşturur, değiştirir veya siler. Koordinatlar
// milimetre ve Z-yukarıdır.

import {
  Plane, Vector, draw, drawCircle, drawRectangle, makeBox, makeCylinder, makeSphere,
  basicFaceExtrusion, importSTEP, importSTL, measureVolume, measureArea,
} from 'replicad';

export class FeatureError extends Error {}

const fail = (message) => { throw new FeatureError(message); };

export function makePlane({ origin, xDir, normal }) {
  return new Plane(origin, xDir, normal);
}

// Profil tanımından 2B çizim üretir (çizim düzleminin yerel koordinatlarında).
export function profileDrawing(profile) {
  switch (profile.kind) {
    case 'rect': {
      if (!(profile.w > 0 && profile.h > 0)) fail('Dikdörtgen ölçüleri sıfırdan büyük olmalı');
      const r = Math.min(profile.radius || 0, profile.w / 2 - 1e-6, profile.h / 2 - 1e-6);
      return drawRectangle(profile.w, profile.h, r > 0 ? r : undefined).translate([profile.cx, profile.cy]);
    }
    case 'circle':
      if (!(profile.r > 0)) fail('Yarıçap sıfırdan büyük olmalı');
      return drawCircle(profile.r).translate([profile.cx, profile.cy]);
    case 'poly': {
      const pts = profile.points;
      if (!pts || pts.length < 3) fail('Çokgen en az üç nokta gerektirir');
      let pen = draw(pts[0]);
      for (const p of pts.slice(1)) pen = pen.lineTo(p);
      return pen.close();
    }
    default:
      return fail(`Bilinmeyen profil: ${profile.kind}`);
  }
}

function primitive({ shape, params: p, at = [0, 0, 0] }) {
  const [x, y, z] = at;
  const positive = (...values) => values.every((v) => v > 0) || fail('Ölçüler sıfırdan büyük olmalı');
  switch (shape) {
    case 'box':
      positive(p.w, p.d, p.h);
      return makeBox([x - p.w / 2, y - p.d / 2, z], [x + p.w / 2, y + p.d / 2, z + p.h]);
    case 'cylinder':
      positive(p.r, p.h);
      return makeCylinder(p.r, p.h, [x, y, z], [0, 0, 1]);
    case 'sphere':
      positive(p.r);
      return makeSphere(p.r).translate([x, y, z + p.r]);
    case 'cone': {
      positive(p.r1, p.h);
      const top = Math.max(p.r2 || 0, 0);
      let pen = draw([0, 0]).lineTo([p.r1, 0]);
      pen = top > 1e-6 ? pen.lineTo([top, p.h]).lineTo([0, p.h]) : pen.lineTo([0, p.h]);
      return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]).translate([x, y, z]);
    }
    case 'torus':
      positive(p.R, p.r);
      if (p.r >= p.R) fail('Boru yarıçapı halka yarıçapından küçük olmalı');
      return drawCircle(p.r).translate([p.R, 0]).sketchOnPlane('XZ').revolve([0, 0, 1]).translate([x, y, z + p.r]);
    default:
      return fail(`Bilinmeyen katı: ${shape}`);
  }
}

function requireBody(shapes, id) {
  const shape = shapes.get(id);
  if (!shape) fail('Bu özelliğin uygulandığı gövde artık yok');
  return shape;
}

function pickByIndex(list, indices, what) {
  if (!indices?.length) fail(`En az bir ${what} seçin`);
  return indices.map((i) => list[i] || fail(`Seçili ${what} artık bulunamadı`));
}

// Yeni katıyı moduna göre sahneye ekler: yeni gövde, mevcut gövdeye ekle ya da ondan çıkar.
function combine(shapes, feature, solid) {
  const mode = feature.mode || 'new';
  if (mode === 'new') {
    shapes.set(feature.body, solid);
    return;
  }
  const target = requireBody(shapes, feature.target);
  if (mode === 'join') shapes.set(feature.target, target.fuse(solid));
  else if (mode === 'cut') shapes.set(feature.target, target.cut(solid));
  else if (mode === 'intersect') shapes.set(feature.target, target.intersect(solid));
  else fail(`Bilinmeyen mod: ${mode}`);
}

const HANDLERS = {
  primitive(shapes, f) {
    shapes.set(f.body, primitive(f));
  },

  extrude(shapes, f) {
    if (!f.distance) fail('Mesafe sıfır olamaz');
    const sketch = profileDrawing(f.profile).sketchOnPlane(makePlane(f.plane));
    combine(shapes, f, sketch.extrude(f.distance));
  },

  revolve(shapes, f) {
    if (!f.angle) fail('Açı sıfır olamaz');
    const plane = makePlane(f.plane);
    const sketch = profileDrawing(f.profile).sketchOnPlane(plane);
    const origin = plane.toWorldCoords(f.axis.point).toTuple();
    const dir = f.axis.dir === 'x' ? f.plane.xDir : plane.yDir.toTuple();
    combine(shapes, f, sketch.revolve(dir, { origin, angle: f.angle }));
  },

  // Bir yüzü normali yönünde iter/çeker (Shapr3D'deki gibi doğrudan modelleme).
  pushpull(shapes, f) {
    const shape = requireBody(shapes, f.target);
    if (!f.distance) fail('Mesafe sıfır olamaz');
    const [face] = pickByIndex(shape.faces, [f.face], 'yüz');
    const normal = face.normalAt();
    const solid = basicFaceExtrusion(face, new Vector(normal.toTuple()).multiply(f.distance));
    shapes.set(f.target, f.distance > 0 ? shape.fuse(solid) : shape.cut(solid));
  },

  fillet(shapes, f) {
    const shape = requireBody(shapes, f.target);
    if (!(f.radius > 0)) fail('Yarıçap sıfırdan büyük olmalı');
    const edges = pickByIndex(shape.edges, f.edges, 'kenar');
    shapes.set(f.target, shape.fillet(f.radius, (finder) => finder.inList(edges)));
  },

  chamfer(shapes, f) {
    const shape = requireBody(shapes, f.target);
    if (!(f.distance > 0)) fail('Pah mesafesi sıfırdan büyük olmalı');
    const edges = pickByIndex(shape.edges, f.edges, 'kenar');
    shapes.set(f.target, shape.chamfer(f.distance, (finder) => finder.inList(edges)));
  },

  shell(shapes, f) {
    const shape = requireBody(shapes, f.target);
    if (!f.thickness) fail('Et kalınlığı sıfır olamaz');
    const faces = pickByIndex(shape.faces, f.faces, 'yüz');
    shapes.set(f.target, shape.shell(f.thickness, (finder) => finder.inList(faces)));
  },

  boolean(shapes, f) {
    let shape = requireBody(shapes, f.target);
    if (!f.tools?.length) fail('İşlem için en az bir gövde daha seçin');
    for (const id of f.tools) {
      const tool = requireBody(shapes, id);
      if (f.op === 'union') shape = shape.fuse(tool);
      else if (f.op === 'subtract') shape = shape.cut(tool);
      else if (f.op === 'intersect') shape = shape.intersect(tool);
      else fail(`Bilinmeyen işlem: ${f.op}`);
      if (!f.keepTools) shapes.delete(id);
    }
    shapes.set(f.target, shape);
  },

  transform(shapes, f) {
    for (const id of f.targets) {
      // replicad dönüşümleri kaynağı siler; önceki adımların önbelleği bozulmasın diye kopyala.
      let shape = requireBody(shapes, id).clone();
      if (f.scale && f.scale !== 1) {
        if (!(f.scale > 0)) fail('Ölçek sıfırdan büyük olmalı');
        shape = shape.scale(f.scale, f.center || [0, 0, 0]);
      }
      if (f.rotation?.angle) shape = shape.rotate(f.rotation.angle, f.rotation.center, f.rotation.axis);
      if (f.translate?.some((v) => v)) shape = shape.translate(f.translate);
      shapes.set(id, shape);
    }
  },

  mirror(shapes, f) {
    const shape = requireBody(shapes, f.target);
    const mirrored = shape.clone().mirror(f.plane, f.origin);
    if (f.copy) shapes.set(f.body, mirrored);
    else shapes.set(f.target, mirrored);
  },

  pattern(shapes, f) {
    const shape = requireBody(shapes, f.target);
    const count = Math.round(f.count);
    if (!(count >= 2 && count <= 100)) fail('Kopya sayısı 2 ile 100 arasında olmalı');
    const step = f.direction.map((v) => v * f.spacing);
    if (f.separate) {
      for (let i = 1; i < count; i++) shapes.set(`${f.body}-${i}`, shape.clone().translate(step.map((v) => v * i)));
    } else {
      let result = shape;
      for (let i = 1; i < count; i++) result = result.fuse(shape.clone().translate(step.map((v) => v * i)));
      shapes.set(f.target, result);
    }
  },

  duplicate(shapes, f) {
    shapes.set(f.body, requireBody(shapes, f.target).clone().translate(f.offset || [0, 0, 0]));
  },

  delete(shapes, f) {
    for (const id of f.targets) shapes.delete(id);
  },
};

// İçe aktarılan dosyalar bir kez ayrıştırılır ve önbellekte tutulur.
const importCache = new Map();

async function importShape(f) {
  const key = `${f.format}:${f.hash}`;
  if (!importCache.has(key)) {
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes]);
    const shape = f.format === 'step' ? await importSTEP(blob) : await importSTL(blob);
    importCache.set(key, shape);
  }
  let shape = importCache.get(key).clone();
  if (f.scale && f.scale !== 1) shape = shape.scale(f.scale, [0, 0, 0]);
  if (f.translate) shape = shape.translate(f.translate);
  return shape;
}

// OpenCascade bazen mesajsız WebAssembly istisnası fırlatır; anlaşılır bir mesaja çevir.
const KERNEL_HINTS = {
  fillet: 'Yuvarlatma yapılamadı: yarıçap bu kenarlar için çok büyük olabilir',
  chamfer: 'Pah kırılamadı: mesafe bu kenarlar için çok büyük olabilir',
  shell: 'Kabuk oluşturulamadı: et kalınlığı çok büyük olabilir',
  boolean: 'Boolean işlemi başarısız oldu',
  pushpull: 'Yüz uzatılamadı',
  extrude: 'Katılaştırma başarısız oldu',
  revolve: 'Döndürme başarısız oldu: profil ekseni kesiyor olabilir',
};

export function errorMessage(feature, err) {
  if (err instanceof FeatureError) return err.message;
  const text = err?.message && !/WebAssembly|unreachable|^\d+$/.test(err.message) ? err.message : '';
  return text || KERNEL_HINTS[feature.type] || 'Geometri çekirdeği bu işlemi yapamadı';
}

export async function applyFeature(shapes, feature) {
  if (feature.type === 'import') {
    shapes.set(feature.body, await importShape(feature));
    return;
  }
  const handler = HANDLERS[feature.type];
  if (!handler) fail(`Bilinmeyen özellik: ${feature.type}`);
  handler(shapes, feature);
}

export function bodyProperties(shape) {
  let volume = 0;
  let area = 0;
  try { volume = Math.abs(measureVolume(shape)); } catch { /* yüzey gövdelerinde hacim yok */ }
  try { area = measureArea(shape); } catch { /* yok say */ }
  return { volume, area, bounds: shape.boundingBox.bounds };
}
