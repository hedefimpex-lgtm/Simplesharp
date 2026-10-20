import * as THREE from 'three';

// İşlem tanımları. Her işlem bir bağlam (seçim) ve alan değerlerinden bir özellik üretir.
//
// ctx: { faces: [{body, index}], edges: [...], bodies: [id], sketch, newBody, center, size, at }
// Alan türleri: length (mm, birimle gösterilir), angle (°), number, select, check.

const sameBody = (items) => items.length && items.every((i) => i.body === items[0].body);

export const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const axisOptions = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];

function profileBounds(p) {
  if (p.kind === 'rect') return [p.cx - p.w / 2, p.cy - p.h / 2, p.cx + p.w / 2, p.cy + p.h / 2];
  if (p.kind === 'circle') return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
  const xs = p.points.map((q) => q[0]);
  const ys = p.points.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function profileCenter(sketch) {
  const [x0, y0, x1, y1] = profileBounds(sketch.profile);
  const { origin, xDir, normal } = sketch.plane;
  const o = new THREE.Vector3(...origin);
  const u = new THREE.Vector3(...xDir);
  const n = new THREE.Vector3(...normal);
  const v = new THREE.Vector3().crossVectors(n, u);
  return o.addScaledVector(u, (x0 + x1) / 2).addScaledVector(v, (y0 + y1) / 2);
}

function revolveAxis(profile, choice) {
  const [x0, y0, x1, y1] = profileBounds(profile);
  return {
    left: { point: [x0, 0], dir: 'y' },
    right: { point: [x1, 0], dir: 'y' },
    bottom: { point: [0, y0], dir: 'x' },
    top: { point: [0, y1], dir: 'x' },
  }[choice];
}

const PRIMITIVE_FIELDS = {
  box: [['w', 'Genişlik', 40], ['d', 'Derinlik', 40], ['h', 'Yükseklik', 40]],
  cylinder: [['D', 'Çap', 40], ['h', 'Yükseklik', 40]],
  sphere: [['D', 'Çap', 40]],
  cone: [['D1', 'Taban çapı', 40], ['D2', 'Üst çap', 0], ['h', 'Yükseklik', 40]],
  torus: [['DR', 'Halka çapı', 50], ['Dr', 'Boru çapı', 12]],
};

const PRIMITIVE_PARAMS = {
  box: (v) => ({ w: v.w, d: v.d, h: v.h }),
  cylinder: (v) => ({ r: v.D / 2, h: v.h }),
  sphere: (v) => ({ r: v.D / 2 }),
  cone: (v) => ({ r1: v.D1 / 2, r2: v.D2 / 2, h: v.h }),
  torus: (v) => ({ R: v.DR / 2, r: v.Dr / 2 }),
};

const PRIMITIVE_VALUES = {
  box: (p) => ({ w: p.w, d: p.d, h: p.h }),
  cylinder: (p) => ({ D: p.r * 2, h: p.h }),
  sphere: (p) => ({ D: p.r * 2 }),
  cone: (p) => ({ D1: p.r1 * 2, D2: p.r2 * 2, h: p.h }),
  torus: (p) => ({ DR: p.R * 2, Dr: p.r * 2 }),
};

function primitiveOp(shape, title, icon) {
  return {
    title,
    icon,
    bodyName: title,
    fields: () => [
      ...PRIMITIVE_FIELDS[shape].map(([key, label, value]) => ({ key, label, type: 'length', value, min: 0 })),
      { key: 'x', label: 'Konum X', type: 'length', value: 0 },
      { key: 'y', label: 'Konum Y', type: 'length', value: 0 },
      { key: 'z', label: 'Konum Z', type: 'length', value: 0 },
    ],
    defaults: (ctx) => ({ x: ctx.at[0], y: ctx.at[1], z: ctx.at[2] }),
    build: (ctx, v) => ({ type: 'primitive', shape, body: ctx.newBody, params: PRIMITIVE_PARAMS[shape](v), at: [v.x, v.y, v.z] }),
    fromFeature: (f) => [{ newBody: f.body }, { ...PRIMITIVE_VALUES[shape](f.params), x: f.at[0], y: f.at[1], z: f.at[2] }],
  };
}

export const OPS = {
  box: primitiveOp('box', 'Kutu', 'Box'),
  cylinder: primitiveOp('cylinder', 'Silindir', 'Cylinder'),
  sphere: primitiveOp('sphere', 'Küre', 'Globe'),
  cone: primitiveOp('cone', 'Koni', 'Cone'),
  torus: primitiveOp('torus', 'Simit', 'Torus'),

  // Çizimden katı: katılaştırma ya da eksen etrafında döndürme.
  sketch: {
    title: 'Çizimi katılaştır',
    icon: 'ArrowUpFromLine',
    bodyName: 'Gövde',
    fields: (ctx, v) => {
      const p = ctx.sketch.profile;
      const dims = p.kind === 'rect'
        ? [{ key: 'w', label: 'Genişlik', type: 'length', value: p.w, min: 0 }, { key: 'h', label: 'Uzunluk', type: 'length', value: p.h, min: 0 },
          { key: 'radius', label: 'Köşe yarıçapı', type: 'length', value: p.radius || 0, min: 0 }]
        : p.kind === 'circle' ? [{ key: 'D', label: 'Çap', type: 'length', value: p.r * 2, min: 0 }] : [];
      const revolve = v?.method === 'revolve';
      return [
        { key: 'method', label: 'İşlem', type: 'select', value: 'extrude', options: [['extrude', 'Katılaştır'], ['revolve', 'Döndür']], rebuild: true },
        ...(revolve
          ? [{ key: 'angle', label: 'Açı', type: 'angle', value: 360 },
            { key: 'axis', label: 'Eksen', type: 'select', value: 'left', options: [['left', 'Sol kenar'], ['right', 'Sağ kenar'], ['bottom', 'Alt kenar'], ['top', 'Üst kenar']] }]
          : [{ key: 'distance', label: 'Mesafe', type: 'length', value: 20 }]),
        {
          key: 'mode', label: 'Sonuç', type: 'select', value: ctx.sketch.body ? 'join' : 'new',
          options: [['new', 'Yeni gövde'], ...(ctx.sketch.body ? [['join', 'Gövdeye ekle'], ['cut', 'Gövdeden çıkar'], ['intersect', 'Kesişim']] : [])],
        },
        ...dims,
      ];
    },
    build: (ctx, v) => {
      const profile = { ...ctx.sketch.profile };
      if (profile.kind === 'rect') Object.assign(profile, { w: v.w, h: v.h, radius: v.radius });
      if (profile.kind === 'circle') profile.r = v.D / 2;
      const common = { plane: ctx.sketch.plane, profile, mode: v.mode, body: ctx.newBody, target: ctx.sketch.body || undefined };
      if (v.method === 'revolve') return { type: 'revolve', ...common, angle: v.angle, axisChoice: v.axis, axis: revolveAxis(profile, v.axis) };
      // Çıkarma modunda derinlik her zaman yüzeyin içine doğrudur.
      return { type: 'extrude', ...common, distance: v.mode === 'cut' ? -Math.abs(v.distance) : v.distance };
    },
    defaults: (ctx) => (ctx.sketch.body ? { distance: 10 } : {}),
    handle: (ctx, v) => (v.method === 'revolve' ? null : {
      key: 'distance',
      origin: profileCenter(ctx.sketch),
      dir: new THREE.Vector3(...ctx.sketch.plane.normal).multiplyScalar(v.mode === 'cut' ? -1 : 1),
    }),
    fromFeature: (f) => [
      { sketch: { plane: f.plane, profile: f.profile, body: f.target || null }, newBody: f.body },
      {
        method: f.type, distance: f.mode === 'cut' ? Math.abs(f.distance) : f.distance, angle: f.angle, axis: f.axisChoice || 'left', mode: f.mode,
        ...(f.profile.kind === 'rect' ? { w: f.profile.w, h: f.profile.h, radius: f.profile.radius || 0 } : {}),
        ...(f.profile.kind === 'circle' ? { D: f.profile.r * 2 } : {}),
      },
    ],
  },

  pushpull: {
    title: 'Uzat',
    icon: 'ArrowUpFromLine',
    hint: 'Bir yüz seçin',
    requires: (ctx) => (ctx.faces.length === 1 ? null : 'Uzatmak için tek bir yüz seçin'),
    fields: () => [{ key: 'distance', label: 'Mesafe', type: 'length', value: 10 }],
    build: (ctx, v) => ({ type: 'pushpull', target: ctx.faces[0].body, face: ctx.faces[0].index, distance: v.distance }),
    handle: (ctx) => ctx.faceInfo && { key: 'distance', origin: ctx.faceInfo.center, dir: ctx.faceInfo.normal },
    fromFeature: (f) => [{ faces: [{ body: f.target, index: f.face }] }, { distance: f.distance }],
  },

  fillet: {
    title: 'Yuvarla',
    icon: 'Blend',
    requires: (ctx) => (ctx.edges.length && sameBody(ctx.edges) ? null : 'Aynı gövdeden bir ya da daha fazla kenar seçin'),
    fields: () => [{ key: 'radius', label: 'Yarıçap', type: 'length', value: 3, min: 0 }],
    build: (ctx, v) => ({ type: 'fillet', target: ctx.edges[0].body, edges: ctx.edges.map((e) => e.index), radius: v.radius }),
    fromFeature: (f) => [{ edges: f.edges.map((index) => ({ body: f.target, index })) }, { radius: f.radius }],
  },

  chamfer: {
    title: 'Pah kır',
    icon: 'Triangle',
    requires: (ctx) => (ctx.edges.length && sameBody(ctx.edges) ? null : 'Aynı gövdeden bir ya da daha fazla kenar seçin'),
    fields: () => [{ key: 'distance', label: 'Mesafe', type: 'length', value: 2, min: 0 }],
    build: (ctx, v) => ({ type: 'chamfer', target: ctx.edges[0].body, edges: ctx.edges.map((e) => e.index), distance: v.distance }),
    fromFeature: (f) => [{ edges: f.edges.map((index) => ({ body: f.target, index })) }, { distance: f.distance }],
  },

  shell: {
    title: 'Kabuk',
    icon: 'Shell',
    requires: (ctx) => (ctx.faces.length && sameBody(ctx.faces) ? null : 'Açılacak yüzleri seçin (aynı gövdeden)'),
    fields: () => [{ key: 'thickness', label: 'Et kalınlığı', type: 'length', value: 2, min: 0 }],
    build: (ctx, v) => ({ type: 'shell', target: ctx.faces[0].body, faces: ctx.faces.map((f) => f.index), thickness: Math.abs(v.thickness) }),
    fromFeature: (f) => [{ faces: f.faces.map((index) => ({ body: f.target, index })) }, { thickness: Math.abs(f.thickness) }],
  },

  ...Object.fromEntries([['union', 'Birleştir', 'BoolUnion'], ['subtract', 'Çıkar', 'BoolSubtract'], ['intersect', 'Kesiştir', 'BoolIntersect']].map(([op, title, icon]) => [op, {
    title,
    icon,
    requires: (ctx) => (ctx.bodies.length >= 2 ? null : 'En az iki gövde seçin; ilk seçilen ana gövdedir'),
    fields: () => [{ key: 'keepTools', label: 'Araç gövdeleri kalsın', type: 'check', value: false }],
    build: (ctx, v) => ({ type: 'boolean', op, target: ctx.bodies[0], tools: ctx.bodies.slice(1), keepTools: v.keepTools }),
    fromFeature: (f) => [{ bodies: [f.target, ...f.tools] }, { keepTools: !!f.keepTools }],
  }])),

  move: {
    title: 'Taşı / Döndür',
    icon: 'Move3d',
    gizmo: true,
    requires: (ctx) => (ctx.bodies.length ? null : 'Taşımak için gövde seçin'),
    fields: () => [
      { key: 'dx', label: 'X', type: 'length', value: 0 },
      { key: 'dy', label: 'Y', type: 'length', value: 0 },
      { key: 'dz', label: 'Z', type: 'length', value: 0 },
      { key: 'axis', label: 'Dönüş ekseni', type: 'select', value: 'z', options: [...axisOptions, ['free', 'Serbest']] },
      { key: 'angle', label: 'Açı', type: 'angle', value: 0 },
    ],
    build: (ctx, v) => ({
      type: 'transform',
      targets: ctx.bodies,
      translate: [v.dx, v.dy, v.dz],
      rotation: v.angle ? { angle: v.angle, axis: v.axis === 'free' ? v.freeAxis : AXES[v.axis], center: ctx.center } : undefined,
    }),
    // Önizleme çekirdeksiz, yalnızca görüntü dönüşümüyle yapılır.
    matrix: (ctx, v) => {
      const c = new THREE.Vector3(...ctx.center);
      const axis = new THREE.Vector3(...(v.axis === 'free' ? v.freeAxis || [0, 0, 1] : AXES[v.axis])).normalize();
      return new THREE.Matrix4().makeTranslation(v.dx, v.dy, v.dz)
        .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
        .multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(v.angle || 0)))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    },
    fromFeature: (f) => {
      const axisKey = f.rotation ? Object.keys(AXES).find((k) => AXES[k].every((x, i) => Math.abs(x - f.rotation.axis[i]) < 1e-9)) : 'z';
      return [{ bodies: f.targets, center: f.rotation?.center }, {
        dx: f.translate[0], dy: f.translate[1], dz: f.translate[2],
        angle: f.rotation?.angle || 0, axis: axisKey || 'free', freeAxis: f.rotation?.axis,
      }];
    },
  },

  scale: {
    title: 'Ölçekle',
    icon: 'Scaling',
    requires: (ctx) => (ctx.bodies.length ? null : 'Ölçeklemek için gövde seçin'),
    fields: () => [{ key: 'factor', label: 'Oran', type: 'number', value: 1.5, min: 0, step: 0.1 }],
    build: (ctx, v) => ({ type: 'transform', targets: ctx.bodies, scale: v.factor, center: ctx.center }),
    matrix: (ctx, v) => {
      const c = new THREE.Vector3(...ctx.center);
      const s = v.factor > 0 ? v.factor : 1;
      return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    },
    fromFeature: (f) => [{ bodies: f.targets, center: f.center }, { factor: f.scale }],
  },

  mirror: {
    title: 'Aynala',
    icon: 'FlipHorizontal2',
    bodyName: 'Ayna',
    requires: (ctx) => (ctx.bodies.length === 1 ? null : 'Aynalamak için tek bir gövde seçin'),
    fields: () => [
      { key: 'plane', label: 'Yön', type: 'select', value: 'YZ', options: [['YZ', 'X yönünde'], ['XZ', 'Y yönünde'], ['XY', 'Z yönünde']] },
      { key: 'at', label: 'Ayna düzlemi', type: 'select', value: 'max', options: [['max', 'Gövdenin + kenarı'], ['min', 'Gövdenin − kenarı'], ['center', 'Gövde merkezi'], ['origin', 'Dünya merkezi']] },
      { key: 'copy', label: 'Kopya oluştur', type: 'check', value: true },
    ],
    build: (ctx, v) => {
      const axis = { YZ: 0, XZ: 1, XY: 2 }[v.plane];
      const origin = [0, 0, 0];
      if (v.at !== 'origin') origin[axis] = v.at === 'center' ? ctx.center[axis] : ctx.bounds[v.at === 'min' ? 0 : 1][axis];
      return { type: 'mirror', target: ctx.bodies[0], plane: v.plane, origin, copy: v.copy, body: ctx.newBody, at: v.at };
    },
    fromFeature: (f) => [{ bodies: [f.target], newBody: f.body, center: f.origin, bounds: [f.origin, f.origin] }, { plane: f.plane, at: f.at === 'origin' ? 'origin' : 'center', copy: f.copy }],
  },

  pattern: {
    title: 'Doğrusal dizi',
    icon: 'Rows3',
    bodyName: 'Dizi',
    requires: (ctx) => (ctx.bodies.length === 1 ? null : 'Dizi için tek bir gövde seçin'),
    fields: (ctx) => [
      { key: 'axis', label: 'Yön', type: 'select', value: 'x', options: axisOptions },
      { key: 'count', label: 'Adet', type: 'number', value: 3, min: 2, step: 1 },
      { key: 'spacing', label: 'Aralık', type: 'length', value: Math.round((ctx.size?.[0] || 20) + 10) },
      { key: 'separate', label: 'Ayrı gövdeler', type: 'check', value: true },
    ],
    build: (ctx, v) => ({ type: 'pattern', target: ctx.bodies[0], direction: AXES[v.axis], count: v.count, spacing: v.spacing, separate: v.separate, body: ctx.newBody }),
    fromFeature: (f) => [{ bodies: [f.target], newBody: f.body }, {
      axis: Object.keys(AXES).find((k) => AXES[k].every((x, i) => x === f.direction[i])) || 'x', count: f.count, spacing: f.spacing, separate: f.separate,
    }],
  },
};

// Geçmiş çubuğunda gösterilecek ad ve simge.
export function describeFeature(f) {
  const prim = { box: OPS.box, cylinder: OPS.cylinder, sphere: OPS.sphere, cone: OPS.cone, torus: OPS.torus };
  switch (f.type) {
    case 'primitive': return { op: f.shape, title: prim[f.shape]?.title || 'Katı', icon: prim[f.shape]?.icon || 'Box' };
    case 'extrude': return { op: 'sketch', title: f.mode === 'cut' ? 'Cep' : 'Katılaştır', icon: 'ArrowUpFromLine' };
    case 'revolve': return { op: 'sketch', title: 'Döndür', icon: 'RotateCw' };
    case 'pushpull': return { op: 'pushpull', title: f.distance < 0 ? 'Bastır' : 'Uzat', icon: 'ArrowUpFromLine' };
    case 'boolean': return { op: f.op, title: OPS[f.op].title, icon: OPS[f.op].icon };
    case 'transform': return { op: f.scale && f.scale !== 1 ? 'scale' : 'move', title: f.scale && f.scale !== 1 ? 'Ölçekle' : 'Taşı', icon: f.scale && f.scale !== 1 ? 'Scaling' : 'Move3d' };
    case 'import': return { op: null, title: `İçe aktar (${f.format.toUpperCase()})`, icon: 'Upload' };
    case 'delete': return { op: null, title: 'Sil', icon: 'Trash2' };
    case 'duplicate': return { op: null, title: 'Çoğalt', icon: 'Copy' };
    default: return { op: f.type, title: OPS[f.type]?.title || f.type, icon: OPS[f.type]?.icon || 'Circle' };
  }
}
