// Tasarım belgesi: özellik geçmişi, gövde bilgileri ve geri al / yinele.
import { newId } from './store.js';

export const MATERIALS = {
  plastic: { name: 'Plastik', roughness: 0.45, metalness: 0 },
  gloss: { name: 'Parlak plastik', roughness: 0.15, metalness: 0 },
  rubber: { name: 'Kauçuk', roughness: 0.9, metalness: 0 },
  aluminum: { name: 'Alüminyum', roughness: 0.3, metalness: 1, color: '#c9ced6' },
  steel: { name: 'Çelik', roughness: 0.2, metalness: 1, color: '#9aa1ab' },
  brass: { name: 'Pirinç', roughness: 0.25, metalness: 1, color: '#d4a64a' },
  copper: { name: 'Bakır', roughness: 0.3, metalness: 1, color: '#c87533' },
  glass: { name: 'Cam', roughness: 0.05, metalness: 0, opacity: 0.35, color: '#bfe3ff' },
  wood: { name: 'Ahşap', roughness: 0.7, metalness: 0, color: '#a0703c' },
};

const PALETTE = ['#8fb4d9', '#d99a8f', '#9fd18f', '#d1c38f', '#b39ad9', '#8fd1c8', '#d98fbf', '#c0c6cf'];

export function emptyDesign(name = 'Adsız tasarım') {
  const now = Date.now();
  return {
    id: newId(),
    name,
    created: now,
    modified: now,
    doc: { version: 3, features: [], bodies: {}, settings: { unit: 'mm' } },
  };
}

export class Design {
  constructor(record) {
    this.record = record;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  get doc() { return this.record.doc; }
  get features() { return this.doc.features; }
  get name() { return this.record.name; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) { this.record.modified = Date.now(); for (const fn of this.listeners) fn(reason); }

  snapshot() { return JSON.stringify({ features: this.doc.features, bodies: this.doc.bodies }); }

  restore(json) {
    const { features, bodies } = JSON.parse(json);
    this.doc.features = features;
    this.doc.bodies = bodies;
  }

  // Belgeyi değiştirir ve geri alınabilir bir adım olarak kaydeder.
  commit(label, mutate) {
    const before = this.snapshot();
    mutate(this.doc);
    const after = this.snapshot();
    if (before === after) return false;
    this.undoStack.push({ label, before, after });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('commit');
    return true;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.restore(step.before);
    this.redoStack.push(step);
    this.emit('undo');
    return step.label;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.restore(step.after);
    this.undoStack.push(step);
    this.emit('redo');
    return step.label;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  rename(name) {
    this.record.name = name.trim() || 'Adsız tasarım';
    this.emit('rename');
  }

  setSetting(key, value) {
    this.doc.settings[key] = value;
    this.emit('settings');
  }

  // Yeni gövde kimliği ve varsayılan görünüm bilgisi oluşturur (doc içinde çağrılmalı).
  static newBody(doc, baseName) {
    const id = newId('b');
    doc.bodies[id] = {
      name: Design.nextName(doc, baseName),
      color: PALETTE[Object.keys(doc.bodies).length % PALETTE.length],
      visible: true,
      material: 'plastic',
    };
    return id;
  }

  static nextName(doc, base) {
    let max = 0;
    for (const meta of Object.values(doc.bodies)) {
      const m = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`).exec(meta.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${base} ${max + 1}`;
  }

  bodyMeta(id) {
    // Desen gibi özelliklerin ürettiği gövdeler için kaynak gövdenin bilgisini miras al.
    const meta = this.doc.bodies[id];
    if (meta) return meta;
    const base = id.replace(/-\d+$/, '');
    const parent = this.doc.bodies[base];
    const suffix = id.slice(base.length + 1);
    return { ...(parent || { color: '#c0c6cf', visible: true, material: 'plastic', name: 'Gövde' }), name: `${parent?.name || 'Gövde'} (${suffix})`, derived: true };
  }
}
