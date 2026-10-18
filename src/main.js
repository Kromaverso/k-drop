const {
  app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification,
  nativeImage, clipboard, nativeTheme,
} = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Store } = require('./store');
const { DropServer, localAddresses } = require('./server');

app.setAppUserModelId('com.kromaverso.kromadrop');
// Modo de captura de telas (desenvolvimento): perfil isolado, salva PNGs e fecha.
const CAPTURE_DIR = process.env.KD_CAPTURE;
if (CAPTURE_DIR) app.setPath('userData', path.join(CAPTURE_DIR, 'profile'));
else if (!app.requestSingleInstanceLock()) app.exit(0);

const ASSETS = path.join(__dirname, '..', 'assets');
let win = null;
let tray = null;
let store = null;
let server = null;
let serverError = null;
let quitting = false;
const transfers = new Map();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function buildState() {
  const s = store.settings;
  const addresses = localAddresses();
  const qrs = {};
  for (const a of addresses) {
    const url = `http://${a.address}:${s.port}/?t=${s.token}`;
    qrs[a.address] = {
      url,
      qr: await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0b0b10', light: '#ffffff' } }),
    };
  }
  return {
    settings: s,
    history: store.data.history.map((h) => ({ ...h, exists: fs.existsSync(h.path) })),
    outbox: store.data.outbox,
    addresses,
    qrs,
    transfers: [...transfers.values()],
    server: { running: !!server.server, port: server.port, error: serverError },
    version: app.getVersion(),
  };
}

async function pushState() {
  send('state', await buildState());
}

async function startServer() {
  try {
    await server.restart();
    serverError = null;
  } catch (err) {
    serverError = err.code === 'EADDRINUSE'
      ? `A porta ${store.settings.port} já está em uso. Escolha outra em Ajustes.`
      : err.message;
  }
  updateTray();
  pushState();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 690,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'KromaDrop',
    icon: path.join(ASSETS, 'icon.png'),
    titleBarStyle: 'hidden',
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('maximize', () => send('maximized', true));
  win.on('unmaximize', () => send('maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow(view) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (view) send('navigate', view);
}

function updateTray() {
  if (!tray) return;
  const a = localAddresses()[0];
  const status = server.server && a ? `Pronto em ${a.address}:${server.port}` : 'Servidor parado';
  tray.setToolTip(`KromaDrop — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Abrir KromaDrop', click: () => showWindow() },
    { label: 'Compartilhar arquivos…', click: () => pickOutbox() },
    { label: 'Mostrar QR code', click: () => showWindow('connect') },
    { label: 'Abrir pasta de recebidos', click: () => openSaveDir() },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}

function openSaveDir() {
  fs.mkdirSync(store.settings.saveDir, { recursive: true });
  shell.openPath(store.settings.saveDir);
}

async function pickOutbox() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolha arquivos para enviar ao iPhone',
    properties: ['openFile', 'multiSelections'],
  });
  if (!r.canceled) addOutbox(r.filePaths);
}

function addOutbox(paths) {
  let added = 0;
  for (const p of paths) {
    try {
      if (fs.statSync(p).isFile()) { store.addOutbox(p); added++; }
    } catch {}
  }
  if (added) {
    server.broadcastOutbox();
    pushState();
  }
  return added;
}

function notify(title, body, onClick) {
  if (!store.settings.notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') });
  if (onClick) n.on('click', onClick);
  n.show();
}

function applyLoginItem() {
  app.setLoginItemSettings({ openAtLogin: !!store.settings.launchAtLogin, args: ['--hidden'] });
}

function fmtSize(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

function wireServer() {
  let pending = null;
  const flushProgress = () => {
    pending = null;
    send('transfers', [...transfers.values()]);
  };
  server.on('progress', (p) => {
    transfers.set(p.id, { ...p, seen: Date.now() });
    if (!pending) pending = setTimeout(flushProgress, 100);
  });
  // Rede de segurança: tira da tela transferências paradas há mais de 45 s.
  setInterval(() => {
    let changed = false;
    for (const [id, t] of transfers) {
      if (Date.now() - t.seen > 45_000) { transfers.delete(id); changed = true; }
    }
    if (changed) flushProgress();
  }, 5000);
  server.on('progress-end', ({ id }) => {
    transfers.delete(id);
    if (!pending) pending = setTimeout(flushProgress, 100);
  });
  server.on('received', (entry) => {
    pushState();
    notify(`Recebido do ${entry.device}`, `${entry.name} · ${fmtSize(entry.size)}`, () => shell.showItemInFolder(entry.path));
    if (store.settings.openFolderOnReceive) shell.showItemInFolder(entry.path);
  });
  server.on('sent', () => pushState());
}

// ---------- IPC ----------
const handlers = {
  'get-state': () => buildState(),
  'set-setting': async (key, value) => {
    if (key === 'port') {
      value = Math.round(Number(value));
      if (!(value >= 1024 && value <= 65535)) throw new Error('Porta inválida (1024–65535).');
    }
    if (key === 'deviceName') value = String(value).trim().slice(0, 40) || require('os').hostname();
    store.setSetting(key, value);
    if (key === 'port') await startServer();
    if (key === 'launchAtLogin') applyLoginItem();
    await pushState();
  },
  'choose-save-dir': async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Onde salvar os arquivos recebidos?',
      defaultPath: store.settings.saveDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    store.setSetting('saveDir', r.filePaths[0]);
    await pushState();
    return r.filePaths[0];
  },
  'open-save-dir': () => openSaveDir(),
  'pick-outbox': () => pickOutbox(),
  'add-outbox': (paths) => addOutbox(paths),
  'remove-outbox': (id) => { store.removeOutbox(id); server.broadcastOutbox(); return pushState(); },
  'clear-outbox': () => { store.clearOutbox(); server.broadcastOutbox(); return pushState(); },
  'remove-history': (id) => { store.removeHistory(id); return pushState(); },
  'clear-history': () => { store.clearHistory(); return pushState(); },
  'open-file': async (p) => {
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  },
  'show-in-folder': (p) => shell.showItemInFolder(p),
  'regenerate-token': () => {
    store.regenerateToken();
    for (const c of server.clients) c.end();
    return pushState();
  },
  'copy': (text) => clipboard.writeText(String(text)),
  'win-minimize': () => win.minimize(),
  'win-maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'win-close': () => win.close(),
  'restart-server': () => startServer(),
};
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args) => fn(...args));

// ---------- App ----------
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  server = new DropServer(store);
  server.logFile = path.join(app.getPath('userData'), 'kromadrop.log');
  wireServer();
  nativeTheme.themeSource = 'system';

  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.on('click', () => showWindow());
  await startServer();
  applyLoginItem();

  if (CAPTURE_DIR) {
    const { captureViews } = require('../tools/capture');
    captureViews({ win, store, server, transfers, pushState, outDir: CAPTURE_DIR })
      .then(() => { quitting = true; app.quit(); });
    return;
  }

  // Redes mudam (troca de Wi-Fi, IP novo): atualiza endereços/QR.
  let lastAddrs = JSON.stringify(localAddresses());
  setInterval(() => {
    const now = JSON.stringify(localAddresses());
    if (now !== lastAddrs) {
      lastAddrs = now;
      updateTray();
      pushState();
    }
  }, 5000);
});

app.on('before-quit', () => {
  quitting = true;
  store?.flush();
});
app.on('window-all-closed', () => {});
