// Gera assets/icon.png (256px) e assets/tray.png (32px) sem dependências.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x supersampling para bordas suaves
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / 16) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Squircle com gradiente azul e "ondas" concêntricas + ponto central.
function appIcon(u, v) {
  const x = u - 0.5, y = v - 0.5;
  const n = 5, rr = 0.46;
  const inside = Math.pow(Math.abs(x) / rr, n) + Math.pow(Math.abs(y) / rr, n) <= 1;
  if (!inside) return [0, 0, 0, 0];
  const bg = mix([94, 214, 255], [10, 92, 255], Math.min(1, Math.max(0, v * 0.9 + u * 0.3)));
  const cx = x, cy = y - 0.12; // centro das ondas, um pouco abaixo do meio
  const d = Math.hypot(cx, cy);
  const ang = Math.atan2(cy, cx);
  const upper = ang < -0.25 && ang > -Math.PI + 0.25;
  const ring = (r, w) => Math.abs(d - r) < w && upper;
  if (d < 0.055 || ring(0.15, 0.025) || ring(0.25, 0.025) || ring(0.35, 0.025)) return [255, 255, 255, 1];
  return [...bg, 1];
}

function trayIcon(u, v) {
  const x = u - 0.5, y = v - 0.5 - 0.12;
  const d = Math.hypot(x, y);
  const ang = Math.atan2(y, x);
  const upper = ang < -0.3 && ang > -Math.PI + 0.3;
  const on = d < 0.09 || (upper && (Math.abs(d - 0.24) < 0.055 || Math.abs(d - 0.42) < 0.055));
  return on ? [255, 255, 255, 1] : [0, 0, 0, 0];
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png(256, appIcon));
fs.writeFileSync(path.join(out, 'tray.png'), png(32, trayIcon));
console.log('Ícones gerados em', out);
