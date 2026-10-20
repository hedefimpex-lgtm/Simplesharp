import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { MM_PER_UNIT } from './units.js';

export const PROJECT_FORMAT = 'sharp3d-project';
export const PROJECT_VERSION = 2;

// Dosyadaki birimin sahne birimine çevrim katsayısı.
const METERS = 1000 / MM_PER_UNIT;
const MILLIMETERS = 1 / MM_PER_UNIT;

const DEFAULT_MATERIAL = () =>
  new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.1 });

// Bir model dosyasını okuyup Object3D olarak döndürür.
export async function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  let object;

  if (ext === 'glb' || ext === 'gltf') {
    const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
    const gltf = await new GLTFLoader().parseAsync(data, '');
    object = gltf.scene;
    object.scale.multiplyScalar(METERS); // glTF metre kullanır
  } else if (ext === 'obj') {
    object = new OBJLoader().parse(await file.text());
    object.traverse((child) => {
      if (child.isMesh) child.material = DEFAULT_MATERIAL();
    });
    object.scale.multiplyScalar(MILLIMETERS); // OBJ'de birim yok; CAD dünyasında genelde mm
  } else if (ext === 'stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, DEFAULT_MATERIAL());
    object.scale.multiplyScalar(MILLIMETERS); // STL genelde mm ve Z-yukarı
    object.rotation.x = -Math.PI / 2;
  } else {
    throw new Error(`Desteklenmeyen dosya türü: .${ext}`);
  }

  object.name = name;
  const rescaled = normalize(object);
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return { object, rescaled };
}

// Modeli zemine oturtur; birimi belli olmayan aşırı büyük/küçük modelleri ölçekler.
function normalize(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  let rescaled = false;
  if (maxDim > 200 || maxDim < 0.01) {
    object.scale.multiplyScalar(4 / maxDim);
    box.setFromObject(object);
    rescaled = true;
  }
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  return rescaled;
}

// Nesneleri sahneden koparmadan dışa aktarım için ortak bir köke kopyalar.
function exportRoot(objects, scale, rotationX = 0) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  root.rotation.x = rotationX;
  for (const object of objects) root.add(object.clone());
  root.updateMatrixWorld(true);
  return root;
}

export async function exportModel(objects, format) {
  if (format === 'glb') {
    const root = exportRoot(objects, 1 / METERS);
    const result = await new GLTFExporter().parseAsync(root, { binary: true });
    download(new Blob([result], { type: 'model/gltf-binary' }), 'sharp3d-model.glb');
  } else if (format === 'stl') {
    // 3B yazıcılar için: milimetre, Z-yukarı.
    const root = exportRoot(objects, MM_PER_UNIT, Math.PI / 2);
    const result = new STLExporter().parse(root, { binary: true });
    download(new Blob([result], { type: 'model/stl' }), 'sharp3d-model.stl');
  } else if (format === 'obj') {
    const root = exportRoot(objects, MM_PER_UNIT);
    const result = new OBJExporter().parse(root);
    download(new Blob([result], { type: 'text/plain' }), 'sharp3d-model.obj');
  } else {
    throw new Error(`Bilinmeyen biçim: ${format}`);
  }
}

// ---------------------------------------------------------------------------
// Proje dosyası (.sharp3d.json): sahnenin tamamı, düzenlenebilir hâliyle.
// ---------------------------------------------------------------------------

export function serializeProject(objects, settings) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    settings,
    objects: objects.map((o) => o.toJSON()),
  };
}

// Proje verisini nesnelere çevirir. Eski sürümün düz dizi biçimini de okur.
export async function parseProject(data) {
  let objects;
  let settings = {};
  if (Array.isArray(data)) {
    objects = data;
  } else if (data && data.format === PROJECT_FORMAT && Array.isArray(data.objects)) {
    objects = data.objects;
    settings = data.settings || {};
  } else {
    throw new Error('Geçerli bir Sharp3D proje dosyası değil');
  }
  const loader = new THREE.ObjectLoader();
  const result = [];
  let failed = 0;
  for (const json of objects) {
    try {
      result.push(await loader.parseAsync(json));
    } catch (err) {
      console.warn('Nesne yüklenemedi:', err);
      failed++;
    }
  }
  return { objects: result, settings, failed };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
