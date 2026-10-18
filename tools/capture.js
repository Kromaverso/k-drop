// Gera capturas de cada tela com dados de exemplo (uso: KD_CAPTURE=<pasta> electron .)
// Também captura a página do celular numa janela do tamanho de um iPhone.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureViews({ win, store, server, transfers, pushState, outDir }) {
  const samples = path.join(outDir, 'samples');
  fs.mkdirSync(samples, { recursive: true });
  store.data.settings.deviceName = 'Studio-PC';
  // Caminho de exemplo só para as capturas do PC (nada é salvo nelas); a página do
  // celular, que envia arquivos de verdade, usa a pasta temporária logo abaixo.
  store.data.settings.saveDir = 'C:\\Users\\Studio\\Downloads\\kDrop';
  const mk = (name, kb) => {
    const p = path.join(samples, name);
    fs.writeFileSync(p, Buffer.alloc(kb * 1024));
    return p;
  };
  const now = Date.now();
  const hist = [
    ['IMG_4821.HEIC', 3400, 'in', 'iPhone', 2 * 60e3],
    ['Screen Recording 2026-10-18.mov', 184000, 'in', 'iPhone', 25 * 60e3],
    ['Proposal v3.pdf', 1200, 'out', 'iPhone', 3 * 3600e3],
    ['Budget 2027.xlsx', 88, 'in', 'Mac', 26 * 3600e3],
    ['final-mix.wav', 52000, 'out', 'Mac', 28 * 3600e3],
  ];
  store.data.history = hist.map(([name, kb, direction, device, ago], i) => ({
    id: String(i), name, size: kb * 1024, direction, device, at: now - ago, path: mk(name, 1),
  }));
  store.data.outbox = [];
  store.addOutbox(mk('Signed contract.pdf', 820));
  store.addOutbox(mk('Event photos.zip', 64000));
  transfers.set('t1', { id: 't1', direction: 'in', name: 'IMG_4830.MOV', received: 61e6, total: 148e6, device: 'iPhone', seen: Date.now() + 1e9 });
  await pushState();
  win.setSize(1040, Number(process.env.KD_CAPTURE_HEIGHT) || 690);
  win.show();
  await wait(1500);
  for (const v of ['recent', 'send', 'connect', 'settings']) {
    win.webContents.send('navigate', v);
    await wait(1500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${v}.png`), img.toPNG());
  }

  // Página do iPhone
  store.data.settings.saveDir = path.join(outDir, 'received');
  const phone = new BrowserWindow({ width: 390, height: 844, show: true, frame: false, backgroundColor: '#0b0b12' });
  await phone.loadURL(`http://127.0.0.1:${server.port}/?t=${store.settings.token}`);
  await wait(1200);
  await phone.webContents.executeJavaScript(`
    enqueue([new File([new Uint8Array(2048)], 'IMG_4902.HEIC', { type: 'image/heic' }),
             new File([new Uint8Array(1024)], 'Notes.pdf', { type: 'application/pdf' })]);
  `);
  await wait(1800);
  const img = await phone.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'phone.png'), img.toPNG());
  phone.destroy();
}

module.exports = { captureViews };
