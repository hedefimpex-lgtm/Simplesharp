import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

// Katı model boolean işlemleri (birleştir / çıkar / kesiştir).

const OPERATIONS = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

// Nesnedeki tüm mesh'leri dünya koordinatlarında tek bir geometride toplar.
function worldGeometry(object) {
  object.updateWorldMatrix(true, true);
  const parts = [];
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes.position) return;
    let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    g.morphAttributes = {};
    g.applyMatrix4(child.matrixWorld);
    parts.push(g);
  });
  if (!parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) parts.forEach((g) => g.dispose());
  return merged;
}

function toBrush(object) {
  const geometry = worldGeometry(object);
  if (!geometry) throw new Error(`"${object.name}" içinde katı geometri yok`);
  const brush = new Brush(geometry);
  brush.updateMatrixWorld();
  return brush;
}

// base nesnesine sırayla tools nesnelerini uygular; sonuç yeni bir Mesh'tir.
export function booleanOperation(op, base, tools, material) {
  const operation = OPERATIONS[op];
  if (operation === undefined) throw new Error(`Bilinmeyen işlem: ${op}`);
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;

  let result = toBrush(base);
  for (const tool of tools) {
    const next = evaluator.evaluate(result, toBrush(tool), operation);
    result.geometry.dispose();
    result = next;
  }

  const geometry = result.geometry;
  if (!geometry.attributes.position || geometry.attributes.position.count === 0) {
    throw new Error('İşlem sonucu boş bir katı oluştu');
  }

  // Pivotu sonucun merkezine al.
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
