// Ekranın köşesinde kısa bildirimler gösterir (alert yerine).
export function toast(message, type = 'info', duration = 3500) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// prompt() yerine: masaüstü sürümünde (Electron) prompt desteklenmez.
export function askText(title, value = '') {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ask';
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.required = true;
    const buttons = document.createElement('div');
    buttons.className = 'panel-buttons';
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'İptal' });
    const ok = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn primary', textContent: 'Tamam' });
    buttons.append(cancel, ok);
    form.append(heading, input, buttons);
    dialog.append(form);
    document.body.append(dialog);
    let result = null;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', () => { result = input.value.trim() || null; });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
    input.select();
  });
}
