// Sharp3D masaüstü uygulaması (Electron).
// Derlenmiş web uygulamasını (dist/) özel bir "sharp3d://" adresinden sunar; böylece
// Web Worker, WebAssembly ve IndexedDB tarayıcıdaki gibi çalışır.
const { app, BrowserWindow, Menu, protocol, shell, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const SCHEME = 'sharp3d';
const ORIGIN = `${SCHEME}://app`;
const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// Aynı anda tek pencere grubu: ikinci açılış mevcut pencereyi öne getirir.
if (!app.requestSingleInstanceLock()) app.quit();

function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Bulunamadı', { status: 404 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Bulunamadı', { status: 404 });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#15181d',
    title: 'Sharp3D',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Dış bağlantılar varsayılan tarayıcıda açılır; uygulama içinde başka sayfaya gidilmez.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'Sharp3D',
      message: 'Uygulama beklenmedik şekilde kapandı.',
      detail: 'Çalışmanız en son otomatik kayıt noktasında saklandı.',
      buttons: ['Yeniden yükle', 'Kapat'],
    });
    if (choice === 0) win.reload();
    else win.close();
  });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

function buildMenu() {
  const template = [
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni pencere', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yeniden yükle' },
        { role: 'togglefullscreen', label: 'Tam ekran' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Gerçek boyut' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Geliştirici araçları' },
      ],
    },
    {
      label: 'Yardım',
      submenu: [{
        label: 'Sharp3D hakkında',
        click: () => dialog.showMessageBox({
          type: 'info',
          title: 'Sharp3D',
          message: `Sharp3D ${app.getVersion()}`,
          detail: 'OpenCascade çekirdekli 3B modelleme.\nTasarımlar bu bilgisayarda saklanır.\n\nthree.js (MIT) · replicad (MIT) · OpenCascade (LGPL-2.1) · Lucide (ISC)',
        }),
      }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  serveApp();
  buildMenu();
  // İndirmeler (dışa aktarma) varsayılan olarak Belgeler klasörüne önerilir.
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
