// Servidor HTTP da rede local: o iPhone/Mac abre a página e envia/baixa arquivos.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MOBILE_DIR = path.join(__dirname, 'mobile');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8', MOBILE_DIR],
  '/index.html': ['index.html', 'text/html; charset=utf-8', MOBILE_DIR],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json', MOBILE_DIR],
  '/icon.png': ['icon.png', 'image/png', ASSETS_DIR],
};

function safeName(name) {
  let base = path.basename(String(name || '').replace(/\\/g, '/'));
  base = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) base = '_' + base;
  return base.slice(0, 200) || `arquivo-${Date.now()}`;
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

function deviceFromUA(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/CFNetwork|Darwin/i.test(ua)) return 'iPhone'; // app Atalhos
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux|CrOS/i.test(ua)) return 'Linux';
  return 'Dispositivo';
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

class DropServer extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.server = null;
    this.clients = new Set(); // conexões SSE
    this.port = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const port = Number(this.store.settings.port) || 8765;
      const server = http.createServer((req, res) => this.handle(req, res).catch((err) => {
        console.error(err);
        if (!res.headersSent) this.json(res, 500, { error: 'Erro interno' });
        else res.destroy();
      }));
      server.requestTimeout = 0; // uploads grandes
      server.headersTimeout = 60_000;
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        this.server = server;
        this.port = port;
        resolve(port);
      });
    });
  }

  async stop() {
    for (const c of this.clients) c.end();
    this.clients.clear();
    if (!this.server) return;
    await new Promise((r) => {
      this.server.close(() => r());
      this.server.closeAllConnections?.();
    });
    this.server = null;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  // Registro simples para diagnosticar transferências (kromadrop.log na pasta de dados).
  log(line) {
    if (!this.logFile) return;
    fs.appendFile(this.logFile, `${new Date().toISOString()} ${line}\n`, () => {});
  }

  json(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  }

  authorized(req, url) {
    const t = req.headers['x-token'] || url.searchParams.get('t');
    return sameToken(String(t || '').toUpperCase(), this.store.settings.token);
  }

  outboxPublic() {
    return this.store.data.outbox.map(({ id, name, size, addedAt }) => ({ id, name, size, addedAt }));
  }

  broadcastOutbox() {
    const msg = `event: outbox\ndata: ${JSON.stringify(this.outboxPublic())}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const route = url.pathname;

    if (req.method === 'GET' && STATIC[route]) {
      const [file, type, dir] = STATIC[route];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      fs.createReadStream(path.join(dir, file)).pipe(res);
      return;
    }

    if (!route.startsWith('/api/')) return this.json(res, 404, { error: 'Não encontrado' });
    if (!this.authorized(req, url)) return this.json(res, 401, { error: 'Código de acesso inválido' });

    if (req.method === 'GET' && route === '/api/info') {
      return this.json(res, 200, { name: this.store.settings.deviceName, outbox: this.outboxPublic() });
    }

    if (req.method === 'GET' && route === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(`event: outbox\ndata: ${JSON.stringify(this.outboxPublic())}\n\n`);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      this.clients.add(res);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }

    if ((req.method === 'POST' || req.method === 'PUT') && route === '/api/upload') {
      return this.receive(req, res, url);
    }

    const m = route.match(/^\/api\/outbox\/([a-f0-9]+)$/);
    if ((req.method === 'GET' || req.method === 'HEAD') && m) return this.send(req, res, m[1]);

    return this.json(res, 404, { error: 'Não encontrado' });
  }

  async receive(req, res, url) {
    const s = this.store.settings;
    let name = url.searchParams.get('name') || req.headers['x-filename'];
    try { name = decodeURIComponent(name || ''); } catch {}
    name = safeName(name);
    if (!path.extname(name)) {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/heic': '.heic', 'video/quicktime': '.mov', 'application/pdf': '.pdf' }[req.headers['content-type']];
      if (ext) name += ext;
    }

    let dir = s.saveDir;
    if (s.organizeByDate) dir = path.join(dir, new Date().toLocaleDateString('sv-SE'));
    fs.mkdirSync(dir, { recursive: true });

    const total = Number(req.headers['content-length']) || 0;
    const device = deviceFromUA(req.headers['user-agent']);
    const id = crypto.randomUUID();
    const partial = path.join(dir, `.${id}.kromadrop-part`);
    const out = fs.createWriteStream(partial);
    let received = 0;
    let lastEmit = 0;

    this.emit('progress', { id, direction: 'in', name, received, total, device });
    req.on('data', (chunk) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastEmit > 120) {
        lastEmit = now;
        this.emit('progress', { id, direction: 'in', name, received, total, device });
      }
    });

    try {
      await new Promise((resolve, reject) => {
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        req.on('aborted', () => reject(new Error('Envio cancelado')));
        req.on('error', reject);
      });
      if (total && received < total) throw new Error('Envio incompleto');
    } catch (err) {
      out.destroy();
      fs.rm(partial, { force: true }, () => {});
      this.log(`upload falhou "${name}" ${received}/${total} ${device}: ${err.message}`);
      this.emit('progress-end', { id, failed: true });
      if (!res.writableEnded) this.json(res, 400, { error: err.message });
      return;
    }

    this.log(`upload ok "${name}" ${received} bytes ${device}`);
    const finalPath = uniquePath(dir, name);
    fs.renameSync(partial, finalPath);
    this.emit('progress-end', { id });
    const entry = this.store.addHistory({
      direction: 'in',
      name: path.basename(finalPath),
      size: received,
      path: finalPath,
      device,
    });
    this.emit('received', entry);
    this.json(res, 200, { ok: true, name: entry.name, size: received });
  }

  send(req, res, id) {
    const item = this.store.data.outbox.find((o) => o.id === id);
    if (!item || !fs.existsSync(item.path)) return this.json(res, 404, { error: 'Arquivo não está mais disponível' });
    const size = fs.statSync(item.path).size;
    const device = deviceFromUA(req.headers['user-agent']);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(item.name),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };

    let start = 0;
    let end = size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
    }
    if (req.method === 'HEAD') return res.end();

    const tid = crypto.randomUUID();
    const total = end - start + 1;
    let sent = 0;
    let lastEmit = 0;
    let closed = false;
    const stream = fs.createReadStream(item.path, { start, end });
    stream.on('data', (chunk) => {
      sent += chunk.length;
      const now = Date.now();
      // Depois que a conexão fecha ainda pode chegar um pedaço já lido do disco;
      // sem esse "closed", ele recriaria a transferência e ela ficaria presa na tela.
      if (!closed && now - lastEmit > 120) {
        lastEmit = now;
        this.emit('progress', { id: tid, direction: 'out', name: item.name, received: sent, total, device });
      }
    });
    res.on('close', () => {
      closed = true;
      stream.destroy();
      const complete = res.writableFinished;
      this.log(`download ${complete ? 'ok' : 'interrompido'} "${item.name}" ${req.headers.range || 'inteiro'} enviado=${sent}/${total} ${device}`);
      this.emit('progress-end', { id: tid, failed: !complete });
      // Só registra downloads completos do arquivo inteiro.
      if (complete && start === 0) {
        const entry = this.store.addHistory({ direction: 'out', name: item.name, size, path: item.path, device });
        this.emit('sent', entry);
      }
    });
    stream.pipe(res);
  }
}

function localAddresses() {
  const virtual = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|Tailscale|ZeroTier|Docker/i;
  const list = [];
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      list.push({ ifname, address: a.address, virtual: virtual.test(ifname) });
    }
  }
  // Wi-Fi/Ethernet reais primeiro; redes privadas comuns na frente.
  const score = (x) => (x.virtual ? 10 : 0) + (/^192\.168\./.test(x.address) ? 0 : /^10\./.test(x.address) ? 1 : 2);
  return list.sort((a, b) => score(a) - score(b));
}

module.exports = { DropServer, localAddresses };
