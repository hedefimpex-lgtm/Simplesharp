import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const DEFAULT_MATERIAL = () =>
  new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.1 });

// Bir dosyayı okuyup Object3D olarak döndürür.
export async function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  let object;

  if (ext === 'glb' || ext === 'gltf') {
    const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
    const gltf = await new GLTFLoader().parseAsync(data, '');
    object = gltf.scene;
  } else if (ext === 'obj') {
    object = new OBJLoader().parse(await file.text());
    object.traverse((child) => {
      if (child.isMesh) child.material = DEFAULT_MATERIAL();
    });
  } else if (ext === 'stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, DEFAULT_MATERIAL());
    // STL dosyaları genelde Z-yukarı kullanır.
    object.rotation.x = -Math.PI / 2;
  } else {
    throw new Error(`Desteklenmeyen dosya türü: .${ext}`);
  }

  object.name = name;
  normalize(object);
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

// Modeli zemine oturtur ve aşırı büyük/küçük modelleri makul bir boyuta ölçekler.
function normalize(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 20 || maxDim < 0.1) {
    object.scale.multiplyScalar(4 / maxDim);
    box.setFromObject(object);
  }
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
}

export async function exportGLB(objects) {
  const result = await new GLTFExporter().parseAsync(objects, { binary: true });
  download(new Blob([result], { type: 'model/gltf-binary' }), 'sharp3d-sahne.glb');
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
