// Tasarımların tarayıcıda (IndexedDB) saklanması.
const DB_NAME = 'sharp3d';
const STORE = 'designs';

let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('modified', 'modified');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Tarayıcı depolaması açılamadı'));
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Depolama işlemi iptal edildi'));
  });
}

// Liste için yalnızca özet bilgiler (belge içeriği olmadan).
export async function listDesigns() {
  const all = await run('readonly', (store) => store.getAll());
  return all
    .map(({ id, name, modified, created, thumbnail, doc }) => ({ id, name, modified, created, thumbnail, featureCount: doc?.features?.length || 0 }))
    .sort((a, b) => b.modified - a.modified);
}

export const getDesign = (id) => run('readonly', (store) => store.get(id));
export const putDesign = (design) => run('readwrite', (store) => store.put(design));
export const deleteDesign = (id) => run('readwrite', (store) => store.delete(id));

export function newId(prefix = 'd') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
