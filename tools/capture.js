// Gera capturas de cada tela com dados de exemplo (uso: KD_CAPTURE=<pasta> electron .)
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureViews({ win, store, server, transfers, pushState, outDir }) {
  const samples = path.join(outDir, 'samples');
  fs.mkdirSync(samples, { recursive: true });
  const mk = (name, kb) => {
    const p = path.join(samples, name);
    fs.writeFileSync(p, Buffer.alloc(kb * 1024));
    return p;
  };
  const now = Date.now();
  const hist = [
    ['IMG_4821.HEIC', 3400, 'in', 'iPhone', 2 * 60e3],
    ['Gravação de Tela 2026-10-18.mov', 184000, 'in', 'iPhone', 25 * 60e3],
    ['Proposta Kromaverso v3.pdf', 1200, 'out', 'iPhone', 3 * 3600e3],
    ['Planilha orçamento.xlsx', 88, 'in', 'Mac', 26 * 3600e3],
    ['trilha-final.wav', 52000, 'out', 'Mac', 28 * 3600e3],
  ];
  store.data.history = hist.map(([name, kb, direction, device, ago], i) => ({
    id: String(i), name, size: kb * 1024, direction, device, at: now - ago, path: mk(name, 1),
  }));
  store.data.outbox = [];
  store.addOutbox(mk('Contrato assinado.pdf', 820));
  store.addOutbox(mk('Fotos do evento.zip', 64000));
  transfers.set('t1', { id: 't1', direction: 'in', name: 'IMG_4830.MOV', received: 61e6, total: 148e6, device: 'iPhone' });
  await pushState();
  win.setSize(1040, Number(process.env.KD_CAPTURE_HEIGHT) || 690);
  win.show();
  await wait(1200);
  for (const v of ['recent', 'send', 'connect', 'settings']) {
    win.webContents.send('navigate', v);
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${v}.png`), img.toPNG());
  }
}

module.exports = { captureViews };
