// Persistência simples em JSON (configurações, histórico e arquivos compartilhados).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HISTORY_LIMIT = 300;

function newToken() {
  // 8 caracteres fáceis de digitar (sem 0/O/1/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'kromadrop.json');
    const defaults = {
      settings: {
        saveDir: path.join(os.homedir(), 'Downloads', 'KromaDrop'),
        organizeByDate: false,
        port: 8765,
        token: newToken(),
        deviceName: os.hostname(),
        language: 'auto',
        notifications: true,
        openFolderOnReceive: false,
        launchAtLogin: false,
        closeToTray: true,
      },
      history: [],
      outbox: [],
    };
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    this.data = {
      settings: { ...defaults.settings, ...(data.settings || {}) },
      history: Array.isArray(data.history) ? data.history : [],
      outbox: Array.isArray(data.outbox) ? data.outbox : [],
    };
    // Remove itens compartilhados cujo arquivo não existe mais.
    this.data.outbox = this.data.outbox.filter((o) => fs.existsSync(o.path));
    this.save();
  }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this._t);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    if (!(key in this.data.settings)) throw new Error(`Configuração desconhecida: ${key}`);
    this.data.settings[key] = value;
    this.save();
  }

  regenerateToken() {
    this.data.settings.token = newToken();
    this.save();
    return this.data.settings.token;
  }

  addHistory(entry) {
    const item = { id: crypto.randomUUID(), at: Date.now(), ...entry };
    this.data.history.unshift(item);
    this.data.history.length = Math.min(this.data.history.length, HISTORY_LIMIT);
    this.save();
    return item;
  }

  removeHistory(id) {
    this.data.history = this.data.history.filter((h) => h.id !== id);
    this.save();
  }

  clearHistory() {
    this.data.history = [];
    this.save();
  }

  addOutbox(filePath) {
    const existing = this.data.outbox.find((o) => o.path === filePath);
    const stat = fs.statSync(filePath);
    if (existing) {
      existing.size = stat.size;
      existing.addedAt = Date.now();
      this.save();
      return existing;
    }
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      addedAt: Date.now(),
    };
    this.data.outbox.unshift(item);
    this.save();
    return item;
  }

  removeOutbox(id) {
    this.data.outbox = this.data.outbox.filter((o) => o.id !== id);
    this.save();
  }

  clearOutbox() {
    this.data.outbox = [];
    this.save();
  }
}

module.exports = { Store };
