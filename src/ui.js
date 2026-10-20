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
