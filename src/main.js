const {
  app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification,
  nativeImage, clipboard, nativeTheme,
} = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Store } = require('./store');
const { DropServer, localAddresses } = require('./server');
const i18n = require('./i18n');

app.setAppUserModelId('com.kromaverso.kdrop');
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
let lang = 'en';
let t = i18n.createT('en');

// Idioma da interface: escolhido em Ajustes ou, no automático, o do Windows.
function systemLang() {
  const prefs = app.getPreferredSystemLanguages?.() || [];
  return i18n.match([...prefs, app.getLocale()]);
}
function applyLanguage() {
  const pref = store.settings.language;
  lang = pref && pref !== 'auto' && i18n.available().includes(pref) ? pref : systemLang();
  t = i18n.createT(lang);
}
const deviceLabel = (d) => (!d || d === 'Device' || d === 'Dispositivo' ? t('device.unknown') : d);

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
    clip: clipState(),
    clipOffer: offerPublic(clipOffer),
    server: { running: !!server.server, port: server.port, error: serverError && (serverError.key ? t(serverError.key, serverError.vars) : serverError.raw) },
    version: app.getVersion(),
    i18n: {
      lang,
      dir: i18n.load(lang)?._dir || 'ltr',
      dict: i18n.load(lang),
      en: i18n.load('en'),
      languages: i18n.languages(),
      systemName: i18n.load(systemLang())?._name,
    },
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
      ? { key: 'server.portInUse', vars: { port: store.settings.port } }
      : { raw: err.message };
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
    title: 'kDrop',
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
  const status = server.server && a ? t('tray.ready', { address: `${a.address}:${server.port}` }) : t('tray.stopped');
  tray.setToolTip(`kDrop — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: t('tray.open'), click: () => showWindow() },
    { label: t('tray.share'), click: () => pickOutbox() },
    { label: t('tray.qr'), click: () => showWindow('connect') },
    { label: t('tray.folder'), click: () => openSaveDir() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}

function openSaveDir() {
  fs.mkdirSync(store.settings.saveDir, { recursive: true });
  shell.openPath(store.settings.saveDir);
}

async function pickOutbox() {
  const r = await dialog.showOpenDialog(win, {
    title: t('dialog.pickOutbox'),
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
  const u = i18n.load(lang)?.units || ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `⁦${new Intl.NumberFormat(lang, { maximumFractionDigits: i && n < 100 ? 1 : 0 }).format(n)} ${u[i]}⁩`;
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
    notify(t('notify.received', { device: deviceLabel(entry.device) }),`${entry.name} · ${fmtSize(entry.size)}`, () => shell.showItemInFolder(entry.path));
    if (store.settings.openFolderOnReceive) shell.showItemInFolder(entry.path);
  });
  server.on('sent', () => pushState());
}

// ---------- Área de transferência ----------
// Observa o que é copiado no PC e oferece, num cartão no canto da janela, mandar para o celular.
const CLIP_TEXT_LIMIT = 200_000;
let clipSig = null; // assinatura do que está na área de transferência agora
let clipOffer = null; // conteúdo oferecido na janela
let sharedSig = null; // o que já está compartilhado (não oferece de novo)
let sharedThumb = null;
let selfCopy = null; // texto que o próprio kDrop copiou (código, endereço)

const sha1 = (data) => require('crypto').createHash('sha1').update(data).digest('hex');

function readClipboard() {
  if (clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      // Miniatura de 16×16 como impressão digital: barata e muda quando a imagem muda.
      const sig = `img:${width}x${height}:${sha1(img.resize({ width: 16, height: 16 }).toBitmap())}`;
      return { sig, kind: 'image', img, width, height };
    }
  }
  const text = clipboard.readText();
  if (!text.trim() || text.length > CLIP_TEXT_LIMIT) return null;
  return { sig: `txt:${sha1(text)}`, kind: 'text', text };
}

function offerPublic(c) {
  if (!c) return null;
  return c.kind === 'text'
    ? { kind: 'text', text: c.text.slice(0, 800), length: c.text.length }
    : { kind: 'image', width: c.width, height: c.height, thumb: c.img.resize({ width: Math.min(c.width, 560) }).toDataURL() };
}

function setClipOffer(c) {
  clipOffer = c;
  send('clip-offer', offerPublic(c));
}

function checkClipboard() {
  if (!store.settings.clipboardPrompt) return;
  let c;
  try { c = readClipboard(); } catch { return; }
  const sig = c?.sig || null;
  if (sig === clipSig) return;
  clipSig = sig;
  if (!c || sig === sharedSig || (c.kind === 'text' && c.text === selfCopy)) return setClipOffer(null);
  setClipOffer(c);
}

function shareClipOffer() {
  const c = clipOffer;
  if (!c) return;
  server.setClip(c.kind === 'text' ? { kind: 'text', text: c.text } : { kind: 'image', png: c.img.toPNG(), width: c.width, height: c.height });
  sharedSig = c.sig;
  sharedThumb = c.kind === 'image' ? c.img.resize({ height: 76 }).toDataURL() : null;
  setClipOffer(null);
  return pushState();
}

function clipState() {
  const p = server.clipPublic();
  if (!p) return null;
  return p.kind === 'text' ? { ...p, text: p.text.slice(0, 300), length: p.text.length } : { ...p, thumb: sharedThumb };
}

// ---------- IPC ----------
const handlers = {
  'get-state': () => buildState(),
  'set-setting': async (key, value) => {
    if (key === 'port') {
      value = Math.round(Number(value));
      if (!(value >= 1024 && value <= 65535)) throw new Error(t('server.invalidPort'));
    }
    if (key === 'deviceName') value = String(value).trim().slice(0, 40) || require('os').hostname();
    if (key === 'language' && value !== 'auto' && !i18n.available().includes(value)) value = 'auto';
    store.setSetting(key, value);
    if (key === 'language') { applyLanguage(); updateTray(); }
    if (key === 'port') await startServer();
    if (key === 'launchAtLogin') applyLoginItem();
    if (key === 'clipboardPrompt') { clipSig = null; setClipOffer(null); checkClipboard(); }
    await pushState();
  },
  'choose-save-dir': async () => {
    const r = await dialog.showOpenDialog(win, {
      title: t('dialog.saveDir'),
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
  'copy': (text) => { selfCopy = String(text); clipboard.writeText(selfCopy); },
  'clip-share': () => shareClipOffer(),
  'clip-dismiss': () => setClipOffer(null),
  'clip-stop': () => { server.setClip(null); sharedSig = null; sharedThumb = null; return pushState(); },
  'win-minimize': () => win.minimize(),
  'win-maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'win-close': () => win.close(),
  'restart-server': () => startServer(),
};
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args) => fn(...args));

// O app se chamava KromaDrop: traz configurações, histórico e código de acesso da pasta antiga.
function migrateFromKromaDrop() {
  const oldFile = path.join(app.getPath('appData'), 'KromaDrop', 'kromadrop.json');
  const newFile = path.join(app.getPath('userData'), 'kdrop.json');
  if (CAPTURE_DIR || fs.existsSync(newFile) || !fs.existsSync(oldFile)) return;
  try {
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.copyFileSync(oldFile, newFile);
  } catch (err) {
    console.error('Migração do KromaDrop falhou:', err);
  }
}

// ---------- App ----------
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  migrateFromKromaDrop();
  store = new Store(app.getPath('userData'));
  if (process.env.KD_LANG) store.data.settings.language = process.env.KD_LANG; // capturas por idioma
  applyLanguage();
  server = new DropServer(store);
  server.logFile = path.join(app.getPath('userData'), 'kdrop.log');
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

  setInterval(checkClipboard, 1200);

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
