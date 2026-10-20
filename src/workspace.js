import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { Viewport } from './viewport.js';
import { SketchTool } from './sketch.js';
import { MeasureTool } from './measure.js';
import { Design, MATERIALS } from './design.js';
import { OPS, AXES, describeFeature } from './ops.js';
import { newId, putDesign } from './store.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import * as units from './units.js';

const $ = (s, root = document) => root.querySelector(s);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Dosya adı: Türkçe karakterleri sadeleştir (bazı tarayıcılar ASCII olmayan adları yok sayar).
export function safeName(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
  return (name || 'tasarim')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c])
    .normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'tasarim';
}

// Basit ve hızlı bir dize özeti (içe aktarılan dosyaları önbellekte tanımak için).
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 7) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Sağdaki araç menüsü (Shapr3D'deki gibi kategorilere ayrılmış).
const TOOL_MENU = [
  ['Çizim', [['rect', 'Dikdörtgen', 'Square', '1'], ['circle', 'Daire', 'Circle', '2'], ['poly', 'Çokgen', 'Pentagon', '3']]],
  ['Katılar', [['op:box', 'Kutu', 'Box'], ['op:cylinder', 'Silindir', 'Cylinder'], ['op:sphere', 'Küre', 'Globe'], ['op:cone', 'Koni', 'Cone'], ['op:torus', 'Simit', 'Torus']]],
  ['Modelleme', [['op:pushpull', 'Uzat', 'ArrowUpFromLine', 'U'], ['op:fillet', 'Yuvarla', 'Blend', 'Y'], ['op:chamfer', 'Pah', 'Triangle'], ['op:shell', 'Kabuk', 'Shell']]],
  ['Birleştirme', [['op:union', 'Birleştir', 'BoolUnion'], ['op:subtract', 'Çıkar', 'BoolSubtract'], ['op:intersect', 'Kesiştir', 'BoolIntersect']]],
  ['Dönüştür', [['op:move', 'Taşı', 'Move3d', 'T'], ['op:scale', 'Ölçekle', 'Scaling'], ['op:mirror', 'Aynala', 'FlipHorizontal2'], ['op:pattern', 'Dizi', 'Rows3']]],
  ['Araçlar', [['measure', 'Ölç', 'Ruler', 'M'], ['import', 'İçe aktar', 'Upload']]],
];

export class Workspace {
  constructor(root, kernel, { onHome }) {
    this.root = root;
    this.kernel = kernel;
    this.onHome = onHome;
    this.selection = [];
    this.hover = null;
    this.filter = 'auto';
    this.space = 'model';
    this.result = { bodies: [], statuses: [] };
    this.activeOp = null;
    this.tool = null;
    this.evalToken = 0;

    this.viewport = new Viewport($('#viewport', root));
    this.hud = $('#hud', root);
    this.sketch = new SketchTool({
      viewport: this.viewport,
      hud: this.hud,
      snapStep: () => this.design?.doc.settings.snap ?? 1,
      onComplete: (sketch) => {
        this.setTool(null);
        this.startOp('sketch', { sketch, newBody: newId('b') });
      },
      onCancel: () => this.setTool(null),
    });
    this.measure = new MeasureTool({ viewport: this.viewport, container: $('#viewport', root), onExit: () => this.setTool(null) });

    for (const [id, name] of [['#home-btn', 'House'], ['#undo', 'Undo2'], ['#redo', 'Redo2'], ['#settings-btn', 'Settings'],
      ['#fit-btn', 'Focus'], ['#ortho-toggle', 'Box'], ['#items-toggle', 'Layers'], ['#tools-toggle', 'Menu']]) {
      $(id).replaceChildren(icon(name, 18));
    }
    this.buildToolMenu();
    this.bindChrome();
    this.bindViewport();
    this.bindKeys();
  }

  // ---------------------------------------------------------------------------
  // Tasarım açma / kapama ve kayıt
  // ---------------------------------------------------------------------------

  async open(record) {
    this.design = new Design(record);
    this.design.onChange((reason) => this.onDesignChange(reason));
    units.setUnit(record.doc.settings.unit || 'mm');
    $('#design-name').value = record.name;
    this.selection = [];
    this.cancelOp();
    this.setTool(null);
    this.setSpace('model');
    this.applySettings();
    this.updateUndo();
    this.setSaveState('saved');
    await this.refresh();
    this.viewport.fit(null, false);
    this.root.hidden = false;
  }

  close() {
    this.cancelOp();
    this.setTool(null);
    this.flushSave();
    this.root.hidden = true;
    this.design = null;
    this.result = { bodies: [], statuses: [] };
    this.viewport.setBodies([], () => ({}));
    this.viewport.setHighlights([], null);
  }

  onDesignChange(reason) {
    this.updateUndo();
    this.scheduleSave();
    if (reason === 'commit' || reason === 'undo' || reason === 'redo') this.refresh();
    if (reason === 'meta' || reason === 'undo' || reason === 'redo') this.renderItems();
    if (reason === 'meta') this.viewport.updateAppearance((id) => this.design.bodyMeta(id));
  }

  setSaveState(state) {
    const label = $('#save-state');
    label.textContent = { saved: 'Kaydedildi', saving: 'Kaydediliyor…', error: 'Kaydedilemedi' }[state];
    label.dataset.state = state;
  }

  scheduleSave() {
    this.setSaveState('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  flushSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.save();
    }
  }

  async save() {
    this.saveTimer = null;
    const design = this.design;
    if (!design) return;
    try {
      if (this.result.bodies.length) {
        design.record.thumbnail = this.viewport.capture(320, 200).toDataURL('image/jpeg', 0.8);
      } else {
        design.record.thumbnail = null;
      }
      await putDesign(design.record);
      if (design === this.design) this.setSaveState('saved');
    } catch (err) {
      console.error(err);
      this.setSaveState('error');
      toast(`Tasarım kaydedilemedi: ${err.message}`, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Değerlendirme
  // ---------------------------------------------------------------------------

  async evaluate(features) {
    const token = ++this.evalToken;
    $('#busy').hidden = false;
    try {
      const result = await this.kernel.evaluate(features);
      if (!result || token !== this.evalToken) return null; // daha yeni bir istek var
      return result;
    } finally {
      if (token === this.evalToken) $('#busy').hidden = true;
    }
  }

  async refresh() {
    if (!this.design) return;
    let result;
    try {
      result = await this.evaluate(this.design.features);
    } catch (err) {
      toast(err.message, 'error', 8000);
      return;
    }
    if (!result || this.activeOp) {
      if (result) this.result = result;
      return;
    }
    this.showResult(result);
  }

  showResult(result) {
    this.result = result;
    this.viewport.setPickBodies(null);
    this.viewport.setBodies(result.bodies, (id) => this.design.bodyMeta(id));
    this.validateSelection();
    this.renderHistory();
    this.renderItems();
    this.renderSelection();
    this.updateStats();
    if (this.space === 'drawing') this.renderDrawing();
  }

  bodyData(id) {
    return this.result.bodies.find((b) => b.id === id);
  }

  // ---------------------------------------------------------------------------
  // Seçim
  // ---------------------------------------------------------------------------

  validateSelection() {
    this.selection = this.selection.filter((item) => {
      const b = this.bodyData(item.body);
      if (!b || this.design.bodyMeta(item.body).visible === false) return false;
      if (item.kind === 'face') return item.index < b.faceCount;
      if (item.kind === 'edge') return item.index < b.edgeCount;
      return true;
    });
  }

  sameItem(a, b) {
    return a && b && a.kind === b.kind && a.body === b.body && a.index === b.index;
  }

  setSelection(items) {
    this.selection = items;
    this.renderSelection();
    this.renderItems();
    if (this.activeOp && !this.activeOp.editIndex && this.activeOp.def.requires) this.updateOpContext();
  }

  toggle(item, additive) {
    if (!item) {
      if (!additive) this.setSelection([]);
      return;
    }
    if (!additive) return this.setSelection(this.sameItem(this.selection[0], item) && this.selection.length === 1 ? [] : [item]);
    const exists = this.selection.some((s) => this.sameItem(s, item));
    this.setSelection(exists ? this.selection.filter((s) => !this.sameItem(s, item)) : [...this.selection, item]);
  }

  selectionContext() {
    const ctx = {
      faces: this.selection.filter((s) => s.kind === 'face'),
      edges: this.selection.filter((s) => s.kind === 'edge'),
      bodies: [...new Set(this.selection.filter((s) => s.kind === 'body').map((s) => s.body))],
    };
    // Gövde seçilmeden yüz/kenar seçilmişse, gövde işlemleri için onların gövdesini kullan.
    if (!ctx.bodies.length && this.selection.length) ctx.bodies = [...new Set(this.selection.map((s) => s.body))];
    if (ctx.faces.length === 1) ctx.faceInfo = this.viewport.faceInfo(ctx.faces[0].body, ctx.faces[0].index);
    const bounds = this.viewport.modelBounds(ctx.bodies.length ? ctx.bodies : undefined);
    if (bounds) {
      ctx.bounds = bounds;
      ctx.center = bounds[0].map((v, i) => (v + bounds[1][i]) / 2);
      ctx.size = bounds[0].map((v, i) => bounds[1][i] - v);
    } else {
      ctx.center = [0, 0, 0];
      ctx.size = [20, 20, 20];
    }
    // Yeni katılar mevcut modelin yanına konur.
    const all = this.viewport.modelBounds();
    ctx.at = all ? [Math.round(all[1][0] + 30), 0, 0] : [0, 0, 0];
    return ctx;
  }

  renderSelection() {
    const items = this.activeOp?.previewing ? [] : this.selection;
    this.viewport.setHighlights(this.activeOp ? (this.activeOp.def.requires ? this.selection : []) : items, this.activeOp && !this.activeOp.def.requires ? null : this.hover);

    const bar = $('#selection-bar');
    const info = $('#selection-info');
    const actions = $('#selection-actions');
    actions.replaceChildren();
    if (!this.selection.length || this.activeOp || this.space !== 'model') {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const ctx = this.selectionContext();
    const parts = [];
    let suggest = [];
    if (ctx.faces.length) {
      const area = ctx.faces.reduce((sum, f) => sum + (this.viewport.faceInfo(f.body, f.index)?.area || 0), 0);
      parts.push(`${ctx.faces.length} yüz · ${units.formatArea(area)}`);
      suggest = ctx.faces.length === 1 ? ['pushpull', 'shell'] : ['shell'];
    }
    if (ctx.edges.length) {
      parts.push(`${ctx.edges.length} kenar`);
      suggest = [...suggest, 'fillet', 'chamfer'];
    }
    const bodies = this.selection.filter((s) => s.kind === 'body');
    if (bodies.length) {
      const volume = bodies.reduce((sum, s) => sum + (this.bodyData(s.body)?.volume || 0), 0);
      parts.push(bodies.length === 1 ? `${this.design.bodyMeta(bodies[0].body).name} · ${units.formatVolume(volume)}` : `${bodies.length} gövde · ${units.formatVolume(volume)}`);
      suggest = bodies.length >= 2 ? ['union', 'subtract', 'intersect', 'move'] : ['move', 'scale', 'mirror', 'pattern'];
    }
    info.textContent = parts.join(' · ');
    for (const id of suggest) {
      actions.append(el('button', { class: 'chip', title: OPS[id].title, onclick: () => this.startOp(id) }, icon(OPS[id].icon, 16), OPS[id].title));
    }
    if (bodies.length) {
      actions.append(
        el('button', { class: 'chip', title: 'Çoğalt (Ctrl+D)', onclick: () => this.duplicateSelection() }, icon('Copy', 16), 'Çoğalt'),
        el('button', { class: 'chip danger', title: 'Sil (Delete)', onclick: () => this.deleteSelection() }, icon('Trash2', 16), 'Sil'),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // İşlemler (araç paneli ve canlı önizleme)
  // ---------------------------------------------------------------------------

  startOp(id, ctxOverride = null, edit = null) {
    const def = OPS[id];
    if (!def) return;
    this.cancelOp(false);
    this.setTool(null);
    const ctx = ctxOverride || { ...this.selectionContext(), newBody: newId('b') };
    if (!ctx.at) ctx.at = this.selectionContext().at;
    const values = {};
    for (const f of def.fields(ctx, values)) values[f.key] = f.value;
    Object.assign(values, def.defaults?.(ctx) || {}, edit?.values || {});
    // Düzenlemede seçim değiştirilemez; bağlam özelliğin kendisinden gelir.
    const opDef = edit ? { ...def, requires: null } : def;
    this.activeOp = { id, def: opDef, ctx, values, editIndex: edit?.index ?? null, editFeature: edit?.feature };
    if (def.requires && !edit) this.selectionToContext();
    this.viewport.setBodies(this.result.bodies, (bid) => this.design.bodyMeta(bid));
    this.viewport.setPickBodies(this.result.bodies);
    this.renderPanel();
    this.renderSelection();
    this.preview();
  }

  selectionToContext() {
    const op = this.activeOp;
    const fresh = this.selectionContext();
    Object.assign(op.ctx, { faces: fresh.faces, edges: fresh.edges, bodies: fresh.bodies, faceInfo: fresh.faceInfo, center: fresh.center, bounds: fresh.bounds, size: fresh.size });
  }

  updateOpContext() {
    this.selectionToContext();
    this.renderPanel();
    this.preview();
  }

  opError() {
    const op = this.activeOp;
    return op.def.requires ? op.def.requires(op.ctx) : null;
  }

  buildFeature() {
    const op = this.activeOp;
    const feature = op.def.build(op.ctx, op.values);
    feature.id = op.editFeature?.id || newId('f');
    return feature;
  }

  featuresWithOp() {
    const op = this.activeOp;
    const features = [...this.design.features];
    const feature = this.buildFeature();
    if (op.editIndex !== null) features[op.editIndex] = feature;
    else features.push(feature);
    return { features, feature };
  }

  async preview() {
    const op = this.activeOp;
    if (!op) return;
    this.updateHandle();
    const message = this.opError();
    $('#op-message').textContent = message || '';
    $('#op-apply').disabled = !!message;
    this.viewport.transform.detach();
    for (const b of this.result.bodies) this.viewport.setBodyMatrix(b.id, null);
    if (message) {
      this.viewport.setBodies(this.result.bodies, (id) => this.design.bodyMeta(id));
      this.renderSelection();
      return;
    }
    // Taşıma ve ölçekleme: çekirdeğe gitmeden görüntü dönüşümüyle önizle.
    if (op.def.matrix) {
      if (op.editIndex === null) {
        const matrix = op.def.matrix(op.ctx, op.values);
        for (const id of op.ctx.bodies) this.viewport.setBodyMatrix(id, matrix);
        if (op.def.gizmo) this.attachGizmo();
        this.renderSelection();
        return;
      }
    }
    try {
      const { features, feature } = this.featuresWithOp();
      const result = await this.evaluate(features);
      if (!result || op !== this.activeOp) return;
      const status = result.statuses.find((s) => s.id === feature.id);
      const later = result.statuses.slice(features.indexOf(feature) + 1).filter((s) => !s.ok);
      $('#op-message').textContent = status && !status.ok ? status.error : later.length ? `Bu değişiklikle sonraki ${later.length} adım başarısız oluyor` : '';
      $('#op-apply').disabled = !!(status && !status.ok);
      this.viewport.setBodies(result.bodies, (id) => this.design.bodyMeta(id));
      op.previewing = true;
      this.renderSelection();
    } catch (err) {
      $('#op-message').textContent = err.message;
    }
  }

  updateHandle() {
    const op = this.activeOp;
    const spec = op?.def.handle?.(op.ctx, op.values);
    if (!spec || this.opError()) {
      this.viewport.hideHandle();
      return;
    }
    const value = op.values[spec.key];
    if (this.viewport.handle && this.viewport.handle.key === spec.key && this.viewport.handle.origin.equals(spec.origin)) {
      this.viewport.handle.value = value;
      return;
    }
    this.viewport.showHandle(spec.origin, spec.dir, value, (v) => {
      const step = this.design.doc.settings.snap || 0;
      const snapped = step ? Math.round(v / step) * step : Math.round(v * 100) / 100;
      if (snapped === op.values[spec.key]) return;
      op.values[spec.key] = snapped || (v > 0 ? step || 0.01 : -(step || 0.01));
      this.syncPanelValues();
      this.preview();
    });
    this.viewport.handle.key = spec.key;
  }

  attachGizmo() {
    const op = this.activeOp;
    const v = this.viewport;
    if (!this.gizmoProxy) {
      this.gizmoProxy = new THREE.Object3D();
      v.scene.add(this.gizmoProxy);
      v.transform.addEventListener('objectChange', () => {
        const o = this.activeOp;
        if (!o?.def.gizmo || v.transform.object !== this.gizmoProxy) return;
        const c = new THREE.Vector3(...o.ctx.center);
        const p = this.gizmoProxy.position;
        o.values.dx = units.round(p.x - c.x, 3);
        o.values.dy = units.round(p.y - c.y, 3);
        o.values.dz = units.round(p.z - c.z, 3);
        const q = this.gizmoProxy.quaternion;
        const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        if (angle > 1e-6) {
          const s = Math.sqrt(1 - q.w * q.w) * Math.sign(q.w || 1);
          const axis = [q.x / s, q.y / s, q.z / s];
          const key = Object.keys(AXES).find((k) => AXES[k].every((x, i) => Math.abs(Math.abs(x) - Math.abs(axis[i])) < 1e-4));
          const sign = key ? Math.sign(axis[{ x: 0, y: 1, z: 2 }[key]]) : 1;
          o.values.axis = key || 'free';
          o.values.freeAxis = axis;
          o.values.angle = units.round(THREE.MathUtils.radToDeg(angle) * sign, 2);
        } else {
          o.values.angle = 0;
        }
        const matrix = o.def.matrix(o.ctx, o.values);
        for (const id of o.ctx.bodies) v.setBodyMatrix(id, matrix);
        this.syncPanelValues();
      });
    }
    const c = new THREE.Vector3(...op.ctx.center);
    this.gizmoProxy.position.set(c.x + op.values.dx, c.y + op.values.dy, c.z + op.values.dz);
    const axis = new THREE.Vector3(...(op.values.axis === 'free' ? op.values.freeAxis || [0, 0, 1] : AXES[op.values.axis])).normalize();
    this.gizmoProxy.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(op.values.angle || 0));
    v.transform.setMode(this.gizmoMode || 'translate');
    v.transform.setSpace('world');
    v.transform.attach(this.gizmoProxy);
  }

  async applyOp() {
    const op = this.activeOp;
    if (!op || this.opError()) return;
    const feature = this.buildFeature();
    const def = op.def;
    this.activeOp = null;
    this.closePanel();
    this.design.commit(def.title, (doc) => {
      if (op.editIndex !== null) doc.features[op.editIndex] = feature;
      else doc.features.push(feature);
      // İşlemin oluşturduğu yeni gövdeler için ad ve renk.
      const createsBody = feature.type === 'primitive' || (feature.mode === 'new' && (feature.type === 'extrude' || feature.type === 'revolve'))
        || (feature.type === 'mirror' && feature.copy) || (feature.type === 'pattern' && feature.separate);
      if (createsBody && !doc.bodies[feature.body]) {
        const id = feature.body;
        const tmp = Design.newBody(doc, def.bodyName || 'Gövde');
        doc.bodies[id] = doc.bodies[tmp];
        delete doc.bodies[tmp];
      }
    });
    // İşlem sonucu yeni bir gövde oluştuysa onu seç.
    if (feature.body && (feature.mode === 'new' || feature.type === 'primitive' || (feature.type === 'mirror' && feature.copy))) {
      this.selection = [{ kind: 'body', body: feature.body }];
    } else if (feature.type === 'transform') {
      this.selection = feature.targets.map((body) => ({ kind: 'body', body }));
    } else if (feature.target) {
      this.selection = [{ kind: 'body', body: feature.target }];
    } else {
      this.selection = [];
    }
  }

  cancelOp(refresh = true) {
    if (!this.activeOp) return;
    this.activeOp = null;
    this.closePanel();
    if (refresh) this.showResult(this.result);
  }

  closePanel() {
    $('#tool-panel').hidden = true;
    this.viewport.hideHandle();
    this.viewport.transform.detach();
    this.viewport.setPickBodies(null);
    for (const b of this.viewport.bodies.keys()) this.viewport.setBodyMatrix(b, null);
    this.renderToolMenu();
  }

  renderPanel() {
    const op = this.activeOp;
    const panel = $('#tool-panel');
    panel.hidden = false;
    $('#op-title').replaceChildren(icon(op.def.icon, 18), op.editIndex !== null ? `${op.def.title} (düzenle)` : op.def.title);
    const body = $('#op-fields');
    body.replaceChildren();
    this.panelInputs = [];
    if (op.def.gizmo) {
      const modes = el('div', { class: 'segmented small' },
        ...[['translate', 'Taşı'], ['rotate', 'Döndür']].map(([mode, label]) => el('button', {
          class: (this.gizmoMode || 'translate') === mode ? 'active' : '',
          onclick: () => { this.gizmoMode = mode; this.renderPanel(); this.preview(); },
        }, label)));
      body.append(modes);
    }
    for (const field of op.def.fields(op.ctx, op.values)) {
      if (!(field.key in op.values)) op.values[field.key] = field.value;
      let input;
      if (field.type === 'select') {
        input = el('select', {}, ...field.options.map(([value, label]) => el('option', { value }, label)));
        input.value = op.values[field.key];
        input.addEventListener('change', () => {
          op.values[field.key] = input.value;
          if (field.rebuild) this.renderPanel();
          this.preview();
        });
      } else if (field.type === 'check') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!op.values[field.key];
        input.addEventListener('change', () => { op.values[field.key] = input.checked; this.preview(); });
      } else {
        const isLength = field.type === 'length';
        input = el('input', { type: 'number', step: field.step ?? (isLength ? 1 : field.type === 'angle' ? 15 : 1), inputmode: 'decimal' });
        input.addEventListener('change', () => {
          const raw = parseFloat(String(input.value).replace(',', '.'));
          if (!Number.isFinite(raw) || (field.min !== undefined && raw < field.min)) {
            this.syncPanelValues();
            return;
          }
          op.values[field.key] = isLength ? units.fromDisplay(raw) : raw;
          this.preview();
        });
      }
      const suffix = field.type === 'length' ? units.unitLabel() : field.type === 'angle' ? '°' : '';
      body.append(el('label', { class: 'field' }, el('span', {}, field.label), el('span', { class: 'input' }, input, suffix ? el('em', {}, suffix) : null)));
      this.panelInputs.push({ field, input });
    }
    this.syncPanelValues();
    this.renderToolMenu();
  }

  syncPanelValues() {
    const op = this.activeOp;
    if (!op) return;
    for (const { field, input } of this.panelInputs) {
      if (document.activeElement === input) continue;
      const v = op.values[field.key];
      if (field.type === 'check') input.checked = !!v;
      else if (field.type === 'select') input.value = v;
      else input.value = field.type === 'length' ? units.round(units.toDisplay(v ?? 0)) : v ?? 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Hızlı komutlar
  // ---------------------------------------------------------------------------

  selectedBodies() {
    return [...new Set(this.selection.filter((s) => s.kind === 'body').map((s) => s.body))];
  }

  deleteSelection() {
    const targets = this.selectedBodies();
    if (!targets.length) return;
    this.selection = [];
    this.design.commit('Sil', (doc) => doc.features.push({ id: newId('f'), type: 'delete', targets }));
  }

  duplicateSelection() {
    const targets = this.selectedBodies();
    if (!targets.length) return;
    const created = [];
    this.design.commit('Çoğalt', (doc) => {
      for (const target of targets) {
        const b = this.bodyData(target);
        const width = b ? b.bounds[1][0] - b.bounds[0][0] : 20;
        const body = Design.newBody(doc, `${this.design.bodyMeta(target).name.replace(/ \d+$/, '')}`);
        Object.assign(doc.bodies[body], { color: this.design.bodyMeta(target).color, material: this.design.bodyMeta(target).material });
        doc.features.push({ id: newId('f'), type: 'duplicate', target, body, offset: [Math.round(width + 10), 0, 0] });
        created.push(body);
      }
    });
    this.selection = created.map((body) => ({ kind: 'body', body }));
  }

  setBodyMeta(id, patch, label = 'Gövde') {
    if (!this.design.doc.bodies[id]) {
      // Türetilmiş gövdeler (dizi) için kayıt oluştur.
      this.design.doc.bodies[id] = { ...this.design.bodyMeta(id) };
      delete this.design.doc.bodies[id].derived;
    }
    const before = this.design.snapshot();
    Object.assign(this.design.doc.bodies[id], patch);
    this.design.undoStack.push({ label, before, after: this.design.snapshot() });
    this.design.redoStack.length = 0;
    this.design.emit('meta');
  }

  // ---------------------------------------------------------------------------
  // Araçlar (çizim, ölçüm)
  // ---------------------------------------------------------------------------

  setTool(tool) {
    if (tool && tool === this.tool) tool = null;
    if (this.tool === 'measure') this.measure.stop();
    else if (this.tool) this.sketch.stop();
    this.tool = tool;
    if (tool) {
      this.cancelOp();
      this.setSelection([]);
    }
    if (tool === 'measure') this.measure.start();
    else if (tool) this.sketch.start(tool);
    // Çizerken sol tık kamerayı döndürmesin; sağ tık ve iki parmak çalışmaya devam eder.
    const drawing = tool && tool !== 'measure';
    this.viewport.controls.mouseButtons.LEFT = drawing ? null : THREE.MOUSE.ROTATE;
    this.viewport.controls.touches.ONE = drawing ? null : THREE.TOUCH.ROTATE;
    this.renderToolMenu();
  }

  runMenuItem(id) {
    if (id === 'import') return $('#import-file').click();
    if (id.startsWith('op:')) {
      const op = id.slice(3);
      if (this.activeOp?.id === op) return this.cancelOp();
      return this.startOp(op);
    }
    this.setTool(id);
  }

  buildToolMenu() {
    const menu = $('#tools');
    menu.replaceChildren();
    for (const [title, items] of TOOL_MENU) {
      menu.append(el('section', {},
        el('h3', {}, title),
        el('div', { class: 'tool-grid' }, ...items.map(([id, label, ic, key]) => el('button', {
          class: 'tool', dataset: { tool: id }, title: key ? `${label} (${key})` : label, onclick: () => this.runMenuItem(id),
        }, icon(ic, 22), el('span', {}, label))))));
    }
  }

  renderToolMenu() {
    for (const b of document.querySelectorAll('#tools .tool')) {
      const id = b.dataset.tool;
      b.classList.toggle('active', id === this.tool || id === `op:${this.activeOp?.id}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Paneller: öğeler, geçmiş, istatistik
  // ---------------------------------------------------------------------------

  renderItems() {
    if (!this.design) return;
    const list = $('#items-list');
    list.replaceChildren();
    const ids = this.result.bodies.map((b) => b.id);
    $('#items-count').textContent = ids.length;
    if (!ids.length) {
      list.append(el('li', { class: 'empty' }, 'Henüz gövde yok. Sağdaki menüden bir çizim ya da katı ile başlayın.'));
      return;
    }
    for (const id of ids) {
      const meta = this.design.bodyMeta(id);
      const selected = this.selection.some((s) => s.kind === 'body' && s.body === id);
      const name = el('span', { class: 'name', title: 'Yeniden adlandırmak için çift tıklayın' }, meta.name);
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = el('input', { type: 'text', value: meta.name, class: 'rename' });
        const done = () => {
          if (input.value.trim() && input.value !== meta.name) this.setBodyMeta(id, { name: input.value.trim() }, 'Yeniden adlandır');
          else this.renderItems();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') input.blur();
          if (ev.key === 'Escape') { input.value = meta.name; input.blur(); }
          ev.stopPropagation();
        });
        input.addEventListener('blur', done);
        name.replaceWith(input);
        input.select();
      });
      const color = el('input', { type: 'color', value: meta.color, title: 'Renk' });
      color.addEventListener('click', (e) => e.stopPropagation());
      color.addEventListener('change', () => this.setBodyMeta(id, { color: color.value }, 'Renk'));
      const eye = el('button', {
        class: 'icon-btn', title: meta.visible === false ? 'Göster' : 'Gizle',
        onclick: (e) => { e.stopPropagation(); this.setBodyMeta(id, { visible: meta.visible === false }, 'Görünürlük'); this.validateSelection(); this.renderSelection(); },
      }, icon(meta.visible === false ? 'EyeOff' : 'Eye', 16));
      list.append(el('li', {
        class: `${selected ? 'selected' : ''} ${meta.visible === false ? 'hidden-body' : ''}`,
        onclick: (e) => { if (meta.visible !== false) this.toggle({ kind: 'body', body: id }, e.shiftKey || e.ctrlKey || e.metaKey); },
      }, color, name, eye));
    }
  }

  renderHistory() {
    const bar = $('#history-list');
    bar.replaceChildren();
    const features = this.design.features;
    $('#history-empty').hidden = features.length > 0;
    features.forEach((f, index) => {
      const d = describeFeature(f);
      const status = this.result.statuses.find((s) => s.id === f.id);
      const failed = status && !status.ok;
      const chip = el('li', {
        class: `step ${failed ? 'failed' : ''} ${this.activeOp?.editIndex === index ? 'editing' : ''}`,
        title: failed ? `${d.title}: ${status.error}` : `${index + 1}. ${d.title}${d.op ? ' · düzenlemek için tıklayın' : ''}`,
      },
      el('button', { class: 'step-main', onclick: () => this.editFeature(index) }, icon(d.icon, 16), el('span', {}, d.title)),
      el('button', { class: 'step-del', title: 'Bu adımı sil', onclick: () => this.removeFeature(index) }, icon('X', 12)));
      bar.append(chip);
    });
    bar.scrollLeft = bar.scrollWidth;
  }

  editFeature(index) {
    const f = this.design.features[index];
    const d = describeFeature(f);
    if (!d.op || !OPS[d.op]?.fromFeature) {
      toast('Bu adımın düzenlenebilir parametresi yok.');
      return;
    }
    const [ctxPart, values] = OPS[d.op].fromFeature(f);
    const ctx = { faces: [], edges: [], bodies: [], center: [0, 0, 0], at: [0, 0, 0], ...ctxPart };
    this.startOp(d.op, ctx, { index, values, feature: f });
  }

  removeFeature(index) {
    const d = describeFeature(this.design.features[index]);
    this.cancelOp(false);
    this.design.commit(`${d.title} adımını sil`, (doc) => doc.features.splice(index, 1));
    toast(`"${d.title}" adımı silindi. Geri almak için Ctrl+Z.`);
  }

  updateStats() {
    const tris = this.result.bodies.reduce((s, b) => s + b.triangles.length / 3, 0);
    $('#stats').textContent = `${this.result.bodies.length} gövde · ${Math.round(tris).toLocaleString('tr-TR')} üçgen · ${units.unitLabel()}`;
  }

  updateUndo() {
    $('#undo').disabled = !this.design?.canUndo;
    $('#redo').disabled = !this.design?.canRedo;
  }

  undo() {
    this.cancelOp(false);
    const label = this.design.undo();
    if (label) toast(`Geri alındı: ${label}`, 'info', 1500);
  }

  redo() {
    this.cancelOp(false);
    const label = this.design.redo();
    if (label) toast(`Yinelendi: ${label}`, 'info', 1500);
  }

  // ---------------------------------------------------------------------------
  // Çalışma alanları: modelleme, görselleştirme, teknik çizim
  // ---------------------------------------------------------------------------

  setSpace(space) {
    this.space = space;
    this.root.dataset.space = space;
    for (const b of document.querySelectorAll('#spaces button')) b.classList.toggle('active', b.dataset.space === space);
    const visual = space === 'visual';
    this.viewport.setEdgesVisible(!visual && this.design?.doc.settings.edges !== false);
    this.viewport.grid.visible = !visual && this.design?.doc.settings.grid !== false;
    if (space !== 'model') {
      this.cancelOp();
      this.setTool(null);
      // Görselleştirmede yalnızca gövde seçimi anlamlıdır.
      this.setSelection([...new Set(this.selection.map((s) => s.body))].map((body) => ({ kind: 'body', body })));
    }
    $('#drawing-sheet').hidden = space !== 'drawing';
    if (space === 'drawing') this.renderDrawing();
    if (visual) this.renderVisualPanel();
  }

  renderVisualPanel() {
    const list = $('#material-list');
    list.replaceChildren();
    for (const [key, m] of Object.entries(MATERIALS)) {
      const swatch = el('span', { class: 'swatch', style: `--c:${m.color || '#8fb4d9'}; --m:${m.metalness}` });
      list.append(el('button', { class: 'material', onclick: () => this.applyMaterial(key) }, swatch, m.name));
    }
  }

  applyMaterial(key) {
    const targets = this.selectedBodies().length ? this.selectedBodies() : this.result.bodies.map((b) => b.id);
    if (!targets.length) return;
    const before = this.design.snapshot();
    for (const id of targets) {
      this.design.doc.bodies[id] ??= { ...this.design.bodyMeta(id) };
      this.design.doc.bodies[id].material = key;
    }
    this.design.undoStack.push({ label: 'Malzeme', before, after: this.design.snapshot() });
    this.design.redoStack.length = 0;
    this.design.emit('meta');
    toast(`${MATERIALS[key].name}: ${targets.length} gövde`, 'info', 1500);
  }

  async renderDrawing() {
    const sheet = $('#drawing-svg');
    const ids = this.result.bodies.filter((b) => this.design.bodyMeta(b.id).visible !== false).map((b) => b.id);
    if (!ids.length) {
      sheet.innerHTML = '<p class="empty">Teknik çizim için önce bir model oluşturun.</p>';
      return;
    }
    sheet.innerHTML = '<p class="empty">Görünüşler hesaplanıyor…</p>';
    try {
      const { views, bounds } = await this.kernel.drawing(this.design.features, ids);
      sheet.replaceChildren(this.drawingSvg(views, bounds));
    } catch (err) {
      sheet.innerHTML = '';
      sheet.append(el('p', { class: 'empty' }, `Çizim üretilemedi: ${err.message}`));
    }
  }

  // A4 yatay pafta: ön, üst ve sağ görünüş + başlık bloğu (birinci açı izdüşümü değil, basit yerleşim).
  drawingSvg(views, bounds) {
    const W = 297;
    const H = 210;
    const size = bounds[0].map((v, i) => bounds[1][i] - v);
    const cells = { front: [10, 10, 140, 95], right: [155, 10, 132, 95], top: [10, 110, 140, 90] };
    // Görünüşlerin hücrelere sığdığı en büyük standart ölçek (ISO 5455).
    let fit = Infinity;
    for (const [view, [, , w, h]] of Object.entries(cells)) {
      const box = views[view]?.box;
      if (!box) continue;
      const bw = Math.max(box[1][0] - box[0][0], 1e-6);
      const bh = Math.max(box[1][1] - box[0][1], 1e-6);
      fit = Math.min(fit, (w - 16) / bw, (h - 16) / bh);
    }
    const standard = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
    const scale = standard.find((s) => s <= fit) ?? fit;
    const scaleText = scale >= 1 ? `${scale}:1` : `1:${Math.round(1 / scale)}`;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('font-family', 'system-ui, sans-serif');
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text) n.textContent = text;
      svg.append(n);
      return n;
    };
    add('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' });
    add('rect', { x: 5, y: 5, width: W - 10, height: H - 10, fill: 'none', stroke: '#111', 'stroke-width': 0.5 });
    const names = { front: 'ÖN GÖRÜNÜŞ', right: 'SAĞ GÖRÜNÜŞ', top: 'ÜST GÖRÜNÜŞ' };
    for (const [view, [x, y, w, h]] of Object.entries(cells)) {
      const v = views[view];
      if (!v?.box) continue;
      const [[x0, y0], [x1, y1]] = v.box;
      const cx = x + w / 2;
      const cy = y + h / 2;
      // replicad SVG yolları Y ekseni ters çevrilmiş olarak üretir.
      const g = add('g', { transform: `translate(${cx} ${cy}) scale(${scale}) translate(${-(x0 + x1) / 2} ${(y0 + y1) / 2})` });
      for (const [list, dashed] of [[v.hidden, true], [v.visible, false]]) {
        for (const d of list) {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', dashed ? '#888' : '#111');
          path.setAttribute('stroke-width', (dashed ? 0.25 : 0.4) / scale);
          if (dashed) path.setAttribute('stroke-dasharray', `${1.5 / scale} ${1 / scale}`);
          g.append(path);
        }
      }
      add('text', { x: cx, y: y + h - 1, 'font-size': 3.2, 'text-anchor': 'middle', fill: '#333' }, names[view]);
    }
    // Başlık bloğu
    const tx = 155;
    const ty = 150;
    add('rect', { x: tx, y: ty, width: 137, height: 55, fill: 'none', stroke: '#111', 'stroke-width': 0.5 });
    for (const yy of [ty + 14, ty + 26, ty + 38]) add('line', { x1: tx, y1: yy, x2: tx + 137, y2: yy, stroke: '#111', 'stroke-width': 0.3 });
    add('text', { x: tx + 4, y: ty + 10, 'font-size': 6, 'font-weight': 'bold' }, this.design.name);
    add('text', { x: tx + 4, y: ty + 22, 'font-size': 3.6 }, `Boyutlar: ${units.format(size[0])} × ${units.format(size[1])} × ${units.format(size[2])}`);
    add('text', { x: tx + 4, y: ty + 34, 'font-size': 3.6 }, `Ölçek: ${scaleText} (A4)   Birim: ${units.unitLabel()}`);
    add('text', { x: tx + 4, y: ty + 47, 'font-size': 3.6 }, `Tarih: ${new Date().toLocaleDateString('tr-TR')}   Sharp3D`);
    return svg;
  }

  // ---------------------------------------------------------------------------
  // Dışa / içe aktarma
  // ---------------------------------------------------------------------------

  exportTargets() {
    const selected = this.selectedBodies();
    const ids = selected.length ? selected : this.result.bodies.map((b) => b.id);
    return ids.filter((id) => this.design.bodyMeta(id).visible !== false);
  }

  async exportAs(format) {
    const ids = this.exportTargets();
    const base = safeName(this.design.name);
    if (format === 'png') {
      const canvas = this.viewport.capture(1920, 1080, { hideGrid: this.space === 'visual' });
      canvas.toBlob((blob) => download(blob, `${base}.png`));
      return;
    }
    if (format === 'svg') {
      const svg = $('#drawing-svg svg');
      if (!svg) return toast('Önce Teknik çizim sekmesini açın.', 'warn');
      download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), `${base}-cizim.svg`);
      return;
    }
    if (format === 'project') {
      const data = { format: 'sharp3d-design', version: 3, name: this.design.name, doc: this.design.doc };
      download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${base}.sharp3d.json`);
      return;
    }
    if (!ids.length) return toast('Dışa aktarılacak görünür gövde yok.', 'warn');
    try {
      if (format === 'step' || format === 'stl') {
        const names = Object.fromEntries(ids.map((id) => [id, this.design.bodyMeta(id).name]));
        const colors = Object.fromEntries(ids.map((id) => [id, this.design.bodyMeta(id).color]));
        const { blob } = await this.kernel.export(this.design.features, ids, format, { names, colors });
        download(blob, `${base}.${format}`);
      } else {
        // GLB ve OBJ görüntü ağlarından üretilir (Y-yukarı; GLB metre, OBJ mm).
        const root = new THREE.Group();
        root.rotation.x = -Math.PI / 2;
        if (format === 'glb') root.scale.setScalar(0.001);
        for (const id of ids) {
          const b = this.viewport.bodies.get(id);
          const mesh = new THREE.Mesh(b.mesh.geometry, b.mesh.material);
          mesh.name = this.design.bodyMeta(id).name;
          root.add(mesh);
        }
        root.updateMatrixWorld(true);
        if (format === 'glb') {
          const data = await new GLTFExporter().parseAsync(root, { binary: true });
          download(new Blob([data], { type: 'model/gltf-binary' }), `${base}.glb`);
        } else {
          download(new Blob([new OBJExporter().parse(root)], { type: 'text/plain' }), `${base}.obj`);
        }
      }
      toast(`${ids.length} gövde ${format.toUpperCase()} olarak dışa aktarıldı.`);
    } catch (err) {
      toast(`Dışa aktarma başarısız: ${err.message}`, 'error', 6000);
    }
  }

  async importFiles(files) {
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      const format = ext === 'stp' || ext === 'step' ? 'step' : ext === 'stl' ? 'stl' : null;
      if (!format) {
        toast(`${file.name}: yalnızca STEP ve STL içe aktarılabilir.`, 'warn');
        continue;
      }
      if (file.size > 30 * 1024 * 1024) {
        toast(`${file.name} çok büyük (30 MB sınırı).`, 'warn');
        continue;
      }
      if (format === 'stl' && file.size > 4 * 1024 * 1024) toast('Büyük STL dosyaları katıya çevrilirken yavaş olabilir.', 'warn');
      const data = await fileToBase64(file);
      let body;
      this.design.commit(`${file.name} içe aktar`, (doc) => {
        body = Design.newBody(doc, file.name.replace(/\.[^.]+$/, ''));
        doc.bodies[body].name = file.name.replace(/\.[^.]+$/, '');
        doc.features.push({ id: newId('f'), type: 'import', format, body, data, hash: hashString(data), name: file.name });
      });
      this.selection = [{ kind: 'body', body }];
      setTimeout(() => this.viewport.fit(), 600);
    }
  }

  // ---------------------------------------------------------------------------
  // Ayarlar
  // ---------------------------------------------------------------------------

  applySettings() {
    const s = this.design.doc.settings;
    units.setUnit(s.unit || 'mm');
    $('#set-unit').value = units.getUnit();
    $('#set-snap').value = String(s.snap ?? 1);
    $('#set-grid').checked = s.grid !== false;
    $('#set-edges').checked = s.edges !== false;
    $('#set-ortho').checked = !!s.ortho;
    this.viewport.grid.visible = s.grid !== false && this.space !== 'visual';
    this.viewport.setEdgesVisible(s.edges !== false && this.space !== 'visual');
    this.viewport.setOrthographic(!!s.ortho);
    $('#ortho-toggle').classList.toggle('active', !!s.ortho);
    this.measure.refresh();
    this.updateStats();
    this.renderSelection();
    if (this.activeOp) this.renderPanel();
  }

  setSetting(key, value) {
    this.design.setSetting(key, value);
    this.applySettings();
  }

  // ---------------------------------------------------------------------------
  // Olaylar
  // ---------------------------------------------------------------------------

  bindChrome() {
    $('#home-btn').addEventListener('click', () => this.onHome());
    const name = $('#design-name');
    name.addEventListener('change', () => this.design.rename(name.value));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    $('#undo').addEventListener('click', () => this.undo());
    $('#redo').addEventListener('click', () => this.redo());
    for (const b of document.querySelectorAll('#spaces button')) b.addEventListener('click', () => this.setSpace(b.dataset.space));
    $('#op-apply').addEventListener('click', () => this.applyOp());
    $('#op-cancel').addEventListener('click', () => this.cancelOp());
    $('#fit-btn').addEventListener('click', () => this.viewport.fit(this.viewport.modelBounds(this.selectedBodies().length ? this.selectedBodies() : undefined)));
    $('#ortho-toggle').addEventListener('click', () => this.setSetting('ortho', !this.design.doc.settings.ortho));
    $('#items-toggle').addEventListener('click', () => this.root.classList.toggle('items-open'));
    $('#tools-toggle').addEventListener('click', () => this.root.classList.toggle('tools-open'));
    for (const b of document.querySelectorAll('#filter button')) {
      b.addEventListener('click', () => {
        this.filter = b.dataset.filter;
        for (const x of document.querySelectorAll('#filter button')) x.classList.toggle('active', x === b);
      });
    }

    const exportMenu = $('#export-menu');
    $('#export-btn').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
    document.addEventListener('click', () => { exportMenu.hidden = true; });
    for (const b of exportMenu.querySelectorAll('[data-format]')) b.addEventListener('click', () => this.exportAs(b.dataset.format));

    const settings = $('#settings-dialog');
    $('#settings-btn').addEventListener('click', () => settings.showModal());
    $('#set-unit').addEventListener('change', (e) => this.setSetting('unit', e.target.value));
    $('#set-snap').addEventListener('change', (e) => this.setSetting('snap', parseFloat(e.target.value)));
    $('#set-grid').addEventListener('change', (e) => this.setSetting('grid', e.target.checked));
    $('#set-edges').addEventListener('change', (e) => this.setSetting('edges', e.target.checked));
    $('#set-ortho').addEventListener('change', (e) => this.setSetting('ortho', e.target.checked));

    $('#import-file').addEventListener('change', (e) => {
      this.importFiles([...e.target.files]);
      e.target.value = '';
    });
    $('#print-drawing').addEventListener('click', () => window.print());
    $('#download-drawing').addEventListener('click', () => this.exportAs('svg'));
    $('#visual-shot').addEventListener('click', () => this.exportAs('png'));
    $('#visual-light').addEventListener('input', (e) => { this.viewport.scene.environmentIntensity = parseFloat(e.target.value); });
    $('#visual-bg').addEventListener('input', (e) => this.viewport.scene.background.set(e.target.value));
    $('#visual-shadows').addEventListener('change', (e) => { this.viewport.ground.visible = e.target.checked; });

    const vp = $('#viewport', this.root);
    vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('dragging'); });
    vp.addEventListener('dragleave', () => vp.classList.remove('dragging'));
    vp.addEventListener('drop', (e) => {
      e.preventDefault();
      vp.classList.remove('dragging');
      this.importFiles([...e.dataTransfer.files]);
    });
  }

  bindViewport() {
    const v = this.viewport;
    const dom = v.dom;
    let down = null;
    let lastClick = { t: 0, x: 0, y: 0 };
    v.transform.addEventListener('mouseDown', () => { this.gizmoDown = true; });
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointermove', (e) => {
      if (this.tool || e.buttons || !this.design) return;
      if (this.activeOp && !this.activeOp.def.requires) return;
      const hit = v.pick(e.clientX, e.clientY, this.space !== 'model' ? 'body' : this.filter);
      const item = hit && this.itemFromHit(hit);
      if (!this.sameItem(item, this.hover)) {
        this.hover = item;
        this.renderSelection();
      }
    });
    dom.addEventListener('pointerleave', () => { this.hover = null; this.renderSelection(); });
    dom.addEventListener('pointerup', (e) => {
      const fromGizmo = this.gizmoDown;
      this.gizmoDown = false;
      if (e.button !== 0 || !down || this.tool || fromGizmo || v.handleJustDragged || v.handle?.dragging) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (this.activeOp && !this.activeOp.def.requires) return;
      // Çift tık: aynı noktaya kısa sürede iki tık.
      const now = performance.now();
      const double = now - lastClick.t < 350 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6;
      lastClick = double ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
      const hit = v.pick(e.clientX, e.clientY, double || this.space !== 'model' ? 'body' : this.filter);
      const item = hit && this.itemFromHit(hit);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey || (this.activeOp && this.activeOp.def.requires && this.activeOp.id !== 'pushpull');
      if (double && item) {
        // Çift tık: gövdenin tamamını seç.
        const rest = additive ? this.selection.filter((s) => s.body !== item.body) : [];
        this.setSelection([...rest, { kind: 'body', body: item.body }]);
        return;
      }
      this.toggle(item, additive);
    });
  }

  itemFromHit(hit) {
    if (hit.kind === 'body') return { kind: 'body', body: hit.body };
    return { kind: hit.kind, body: hit.body, index: hit.index };
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.design) return;
      if (e.target.closest?.('input, textarea, select, dialog')) {
        if (e.key === 'Enter' && this.activeOp && e.target.closest('#tool-panel')) {
          e.target.dispatchEvent(new Event('change'));
          setTimeout(() => this.applyOp(), 0);
        }
        return;
      }
      if (this.sketch.handleKey(e) || this.measure.handleKey(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
      else if (ctrl && key === 'd') { e.preventDefault(); this.duplicateSelection(); }
      else if (ctrl && key === 'a') {
        e.preventDefault();
        this.setSelection(this.result.bodies.filter((b) => this.design.bodyMeta(b.id).visible !== false).map((b) => ({ kind: 'body', body: b.id })));
      }
      else if (ctrl && key === 's') { e.preventDefault(); this.flushSave(); toast('Kaydedildi', 'info', 1200); }
      else if (ctrl || e.altKey) return;
      else if (key === 'enter' && this.activeOp) this.applyOp();
      else if (key === 'escape') {
        if (this.activeOp) this.cancelOp();
        else if (this.tool) this.setTool(null);
        else this.setSelection([]);
      }
      else if (key === 'delete' || key === 'backspace') this.deleteSelection();
      else if (key === '1') this.setTool('rect');
      else if (key === '2') this.setTool('circle');
      else if (key === '3') this.setTool('poly');
      else if (key === 'm') this.setTool('measure');
      else if (key === 'u') this.runMenuItem('op:pushpull');
      else if (key === 'y') this.runMenuItem('op:fillet');
      else if (key === 't') this.runMenuItem('op:move');
      else if (key === 'f') $('#fit-btn').click();
      else if (key === '0') this.viewport.setView('iso');
      else if (key === '7') this.viewport.setView('top');
      else if (key === '8') this.viewport.setView('front');
      else if (key === '9') this.viewport.setView('right');
    });
  }
}
