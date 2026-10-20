import { Kernel } from './kernel/client.js';
import { Workspace } from './workspace.js';
import { Home } from './home.js';
import { getDesign } from './store.js';
import { toast } from './ui.js';

// Uygulama girişi: proje ekranı (#/) ile tasarım çalışma alanı (#/d/<id>) arasında yönlendirir.

let lastError = '';
function reportError(err) {
  const message = err?.message || String(err);
  console.error(err);
  if (message === lastError) return;
  lastError = message;
  setTimeout(() => { lastError = ''; }, 3000);
  toast(`Hata: ${message}`, 'error', 6000);
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

function fatal(message) {
  document.querySelector('#fatal-message').textContent = message;
  document.querySelector('#fatal').hidden = false;
}

function hasWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  fatal('Bu tarayıcı WebGL 2 desteklemiyor ya da grafik hızlandırma kapalı. Güncel bir Chrome, Edge, Firefox veya Safari kullanın.');
} else if (typeof WebAssembly === 'undefined' || !window.indexedDB) {
  fatal('Bu tarayıcı WebAssembly ya da IndexedDB desteklemiyor.');
} else {
  const kernel = new Kernel();
  const loading = document.querySelector('#kernel-loading');
  kernel.ready
    .then(() => { loading.hidden = true; })
    .catch((err) => {
      loading.classList.add('error');
      loading.textContent = `Geometri çekirdeği yüklenemedi: ${err.message}. Sayfayı yenileyin.`;
    });

  const homeRoot = document.querySelector('#home');
  const workRoot = document.querySelector('#workspace');
  const home = new Home(homeRoot, { onOpen: (id) => { location.hash = `#/d/${id}`; } });
  const workspace = new Workspace(workRoot, kernel, { onHome: () => { location.hash = '#/'; } });

  async function route() {
    const match = /^#\/d\/([\w-]+)/.exec(location.hash);
    if (match) {
      const record = await getDesign(match[1]).catch(() => null);
      if (record) {
        homeRoot.hidden = true;
        document.title = `${record.name} · Sharp3D`;
        await workspace.open(record);
        return;
      }
      toast('Tasarım bulunamadı.', 'warn');
      location.hash = '#/';
      return;
    }
    workspace.close();
    document.title = 'Sharp3D';
    homeRoot.hidden = false;
    await home.render();
  }

  window.addEventListener('hashchange', () => route().catch(reportError));
  window.addEventListener('pagehide', () => workspace.flushSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) workspace.flushSave(); });
  route().catch(reportError);

  // Test ve hata ayıklama için.
  window.sharp3d = { kernel, workspace, home };
}
