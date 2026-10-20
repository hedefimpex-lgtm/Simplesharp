import { emptyDesign, Design } from './design.js';
import { listDesigns, getDesign, putDesign, deleteDesign, newId } from './store.js';
import { download, fileToBase64, hashString, safeName } from './workspace.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

// Proje ekranı: kayıtlı tasarımların galerisi.

function sampleDesign() {
  const record = emptyDesign('Örnek: Bağlantı braketi');
  const doc = record.doc;
  const base = Design.newBody(doc, 'Taban');
  const wall = Design.newBody(doc, 'Duvar');
  doc.bodies[base].name = 'Braket';
  const top = { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] };
  const front = { origin: [0, 18, 25], xDir: [1, 0, 0], normal: [0, -1, 0] };
  doc.features = [
    { id: newId('f'), type: 'primitive', shape: 'box', body: base, params: { w: 90, d: 60, h: 10 }, at: [0, 0, 0] },
    { id: newId('f'), type: 'primitive', shape: 'box', body: wall, params: { w: 90, d: 12, h: 50 }, at: [0, 24, 0] },
    { id: newId('f'), type: 'boolean', op: 'union', target: base, tools: [wall] },
    { id: newId('f'), type: 'extrude', plane: top, profile: { kind: 'circle', cx: -30, cy: -12, r: 5 }, distance: -10, mode: 'cut', target: base },
    { id: newId('f'), type: 'extrude', plane: top, profile: { kind: 'circle', cx: 30, cy: -12, r: 5 }, distance: -10, mode: 'cut', target: base },
    { id: newId('f'), type: 'extrude', plane: front, profile: { kind: 'rect', cx: 0, cy: 8, w: 40, h: 16, radius: 4 }, distance: -12, mode: 'cut', target: base },
  ];
  delete doc.bodies[wall];
  return record;
}

export class Home {
  constructor(root, { onOpen }) {
    this.root = root;
    this.onOpen = onOpen;
    root.querySelector('#new-design').addEventListener('click', () => this.create(emptyDesign()));
    root.querySelector('#sample-design').addEventListener('click', () => this.create(sampleDesign()));
    root.querySelector('#home-import').addEventListener('click', () => root.querySelector('#home-file').click());
    root.querySelector('#home-file').addEventListener('change', (e) => {
      this.importFiles([...e.target.files]);
      e.target.value = '';
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      this.importFiles([...e.dataTransfer.files]);
    });
  }

  async create(record) {
    try {
      await putDesign(record);
      this.onOpen(record.id);
    } catch (err) {
      toast(`Tasarım oluşturulamadı: ${err.message}`, 'error');
    }
  }

  async importFiles(files) {
    for (const file of files) {
      try {
        if (/\.json$/i.test(file.name)) {
          const data = JSON.parse(await file.text());
          if (data?.format !== 'sharp3d-design' || !Array.isArray(data.doc?.features)) throw new Error('Geçerli bir Sharp3D tasarım dosyası değil');
          const record = emptyDesign(data.name || file.name.replace(/\.sharp3d\.json$|\.json$/i, ''));
          record.doc = { ...record.doc, ...data.doc };
          await this.create(record);
        } else if (/\.(step|stp|stl)$/i.test(file.name)) {
          const name = file.name.replace(/\.[^.]+$/, '');
          const record = emptyDesign(name);
          const body = Design.newBody(record.doc, name);
          record.doc.bodies[body].name = name;
          const b64 = await fileToBase64(file);
          const format = /\.stl$/i.test(file.name) ? 'stl' : 'step';
          record.doc.features.push({ id: newId('f'), type: 'import', format, body, data: b64, hash: hashString(b64), name: file.name });
          await this.create(record);
        } else {
          toast(`${file.name}: desteklenmeyen dosya (STEP, STL ya da .sharp3d.json)`, 'warn');
        }
      } catch (err) {
        toast(`${file.name} açılamadı: ${err.message}`, 'error');
      }
    }
  }

  async render() {
    const grid = this.root.querySelector('#design-grid');
    let designs = [];
    try {
      designs = await listDesigns();
    } catch (err) {
      toast(`Tasarımlar okunamadı: ${err.message}`, 'error', 8000);
    }
    grid.replaceChildren();
    this.root.querySelector('#home-empty').hidden = designs.length > 0;
    for (const d of designs) grid.append(this.card(d));
  }

  card(d) {
    const card = document.createElement('article');
    card.className = 'design-card';
    card.tabIndex = 0;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (d.thumbnail) {
      const img = new Image();
      img.src = d.thumbnail;
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.append(icon('Box', 40));
    }
    const title = document.createElement('h3');
    title.textContent = d.name;
    const meta = document.createElement('p');
    meta.textContent = `${new Date(d.modified).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })} · ${d.featureCount} adım`;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const action = (ic, label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = `icon-btn ${cls}`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.append(icon(ic, 16));
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      actions.append(b);
    };
    action('Pencil', 'Yeniden adlandır', () => this.rename(d));
    action('Copy', 'Çoğalt', () => this.duplicate(d));
    action('Download', 'Tasarım dosyasını indir', () => this.downloadDesign(d));
    action('Trash2', 'Sil', () => this.remove(d), 'danger');
    card.append(thumb, title, meta, actions);
    card.addEventListener('click', () => this.onOpen(d.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.onOpen(d.id); });
    return card;
  }

  async rename(d) {
    const name = prompt('Tasarım adı', d.name);
    if (!name?.trim()) return;
    const record = await getDesign(d.id);
    record.name = name.trim();
    await putDesign(record);
    this.render();
  }

  async duplicate(d) {
    const record = await getDesign(d.id);
    const now = Date.now();
    await putDesign({ ...record, id: newId(), name: `${record.name} (kopya)`, created: now, modified: now });
    this.render();
  }

  async downloadDesign(d) {
    const record = await getDesign(d.id);
    const data = { format: 'sharp3d-design', version: 3, name: record.name, doc: record.doc };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeName(record.name)}.sharp3d.json`);
  }

  async remove(d) {
    if (!confirm(`"${d.name}" silinsin mi? Bu işlem geri alınamaz.`)) return;
    await deleteDesign(d.id);
    this.render();
  }
}
