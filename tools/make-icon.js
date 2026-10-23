// Gera assets/icon.png (512px) e assets/tray.png (32px) a partir de assets/icon-source.png.
// Rode com o Electron (npm run icon), que já traz o redimensionamento de imagens.
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const dir = path.join(__dirname, '..', 'assets');
const source = nativeImage.createFromPath(path.join(dir, 'icon-source.png'));

// O glifo branco vira o ícone da bandeja: pixels claros e neutros ficam opacos, o azul some.
function trayIcon(img, size) {
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  const out = Buffer.alloc(bgra.length);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let i = 0; i < bgra.length; i += 4) {
    const lo = Math.min(bgra[i], bgra[i + 1], bgra[i + 2]);
    const a = Math.max(0, Math.min(1, (lo - 170) / 60)) * (bgra[i + 3] / 255);
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = Math.round(a * 255); // branco pré-multiplicado
    if (a > 0.5) {
      const x = (i / 4) % width, y = Math.floor(i / 4 / width);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  // Recorte quadrado em volta do glifo, com uma margem pequena.
  const side = Math.round(Math.max(x1 - x0, y1 - y0) * 1.08);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const glyph = nativeImage.createFromBitmap(out, { width, height })
    .crop({ x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), width: side, height: side });
  return glyph.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(() => {
  fs.writeFileSync(path.join(dir, 'icon.png'), source.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(dir, 'tray.png'), trayIcon(source, 32).toPNG());
  console.log('Ícones gerados em', dir);
  app.quit();
});
