// Komut tabanlı geri al / yinele yığını.
// Her komut { undo(), redo() } fonksiyonlarına sahip bir nesnedir.
export class History {
  constructor(limit = 100, onChange = () => {}) {
    this.limit = limit;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  // Komutu zaten uygulanmış kabul ederek kaydeder.
  push(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  // Komutu uygular ve kaydeder.
  execute(command) {
    command.redo();
    this.push(command);
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
    this.onChange();
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    command.redo();
    this.undoStack.push(command);
    this.onChange();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
