/* global drop */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
let view = 'recent';
let L = { lang: 'en', dir: 'ltr', dict: {}, en: {} };
let plural = new Intl.PluralRules('en');
let filter = 'all';
let query = '';
let selectedAddr = null;
let transfers = [];
const speedSamples = new Map();

// ---------- Idioma ----------
// t() devolve HTML: o texto traduzido pode ter <b>/<br>, e os valores são escapados.
// Para inserir HTML pronto como valor, passe { html: '...' }.
function lookup(key, vars) {
  let v = L.dict?.[key] ?? L.en?.[key] ?? key;
  if (v && typeof v === 'object' && !Array.isArray(v)) v = v[plural.select(Number(vars.n) || 0)] ?? v.other;
  return String(v);
}
function t(key, vars = {}) {
  return lookup(key, vars).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k]?.html ?? esc(vars[k])) : m));
}
// Versão em texto puro, para title, placeholder e toasts.
function tx(key, vars = {}) {
  return lookup(key, vars).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]?.html ?? vars[k]) : m)).replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '');
}
const device = (d) => (!d || d === 'Device' || d === 'Dispositivo' ? tx('device.unknown') : d);

function applyI18n(i) {
  if (!i) return false;
  const changed = i.lang !== L.lang || !L.dict;
  L = i;
  plural = new Intl.PluralRules(i.lang);
  document.documentElement.lang = i.lang;
  document.documentElement.dir = i.dir || 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tx(el.dataset.i18nTitle); });
  return changed;
}

// ---------- Utilidades ----------
function fmtSize(n) {
  const u = L.dict?.units || ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  // Isolado da direção do texto: em árabe continua "62,5 MB", e não "MB 62,5".
  return `⁦${new Intl.NumberFormat(L.lang, { maximumFractionDigits: i && n < 100 ? 1 : 0 }).format(n)} ${u[i]}⁩`;
}

function fmtWhen(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 45) return tx('time.now');
  if (diff < 3600) return tx('time.minAgo', { n: Math.round(diff / 60) });
  return new Date(ts).toLocaleTimeString(L.lang, { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return tx('time.today');
  if (days === 1) return tx('time.yesterday');
  if (days < 7) return d.toLocaleDateString(L.lang, { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString(L.lang, { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'raw', 'dng'],
  video: ['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'hevc'],
  audio: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'aiff'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'txt', 'rtf', 'pages', 'md', 'odt', 'key', 'ppt', 'pptx'],
  sheet: ['xls', 'xlsx', 'csv', 'numbers', 'ods'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'dmg', 'iso'],
  code: ['js', 'ts', 'json', 'html', 'css', 'py', 'cs', 'cpp', 'h', 'java', 'sh', 'ps1', 'exe', 'msi'],
};
const KIND_ICON = {
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 10h16M4 15h16M10 4v16"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M12 4v3m0 2v2m0 2v2"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};
function kindOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return [k, ext];
  return ['other', ext.length <= 4 ? ext : ''];
}
function tile(name) {
  const [k, ext] = kindOf(name);
  return `<div class="tile t-${k}">${KIND_ICON[k]}${ext ? `<small>${esc(ext)}</small>` : ''}</div>`;
}

const I = {
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13.5v4A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-4"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/></svg>',
  tray: '<svg viewBox="0 0 24 24"><path d="M4 14h4l1.5 2.5h5L16 14h4"/><path d="M4 14 6.5 5.5h11L20 14v5H4z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z"/></svg>',
};

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2300);
}

async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (err) {
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  }
}

function currentAddr() {
  if (!state?.addresses.length) return null;
  return state.addresses.find((a) => a.address === selectedAddr) || state.addresses[0];
}

// ---------- Navegação / chrome ----------
const VIEWS = ['recent', 'send', 'connect', 'settings'];

function navigate(v) {
  view = v;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#view-title').textContent = tx(`view.${v}.title`);
  $('#view-sub').textContent = tx(`view.${v}.sub`);
  renderToolbar();
  render(true);
}

function renderToolbar() {
  const el = $('#toolbar-actions');
  if (view === 'recent') {
    el.innerHTML = `
      <div class="segmented" id="seg">
        <button data-f="all" class="${filter === 'all' ? 'on' : ''}">${t('recent.all')}</button>
        <button data-f="in" class="${filter === 'in' ? 'on' : ''}">${t('recent.received')}</button>
        <button data-f="out" class="${filter === 'out' ? 'on' : ''}">${t('recent.sent')}</button>
      </div>
      <label class="search">${I.search}<input id="q" placeholder="${esc(tx('recent.search'))}" value="${esc(query)}" /></label>`;
    $('#seg').onclick = (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      filter = f;
      $('#seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
      render();
    };
    $('#q').oninput = (e) => { query = e.target.value; render(); };
  } else if (view === 'send') {
    el.innerHTML = `
      ${state?.outbox.length ? `<button class="btn ghost" id="clear-out">${t('send.clearAll')}</button>` : ''}
      <button class="btn primary" id="pick">${I.plus}${t('send.add')}</button>`;
    $('#pick').onclick = () => act(drop.pickOutbox);
    const c = $('#clear-out');
    if (c) c.onclick = () => act(drop.clearOutbox, tx('toast.outboxCleared'));
  } else {
    el.innerHTML = '';
  }
}

function renderChrome() {
  if (!state) return;
  $('#brand-device').textContent = state.settings.deviceName;
  const st = $('#status');
  const a = state.addresses[0];
  st.classList.toggle('ok', state.server.running && !!a);
  st.classList.toggle('err', !state.server.running || !a);
  if (!state.server.running) {
    $('#status-title').textContent = tx('status.stopped');
    $('#status-sub').textContent = tx('status.stoppedSub');
  } else if (!a) {
    $('#status-title').textContent = tx('status.noNetwork');
    $('#status-sub').textContent = tx('status.noNetworkSub');
  } else {
    $('#status-title').textContent = tx('status.ready');
    $('#status-sub').textContent = `${a.address}:${state.server.port}`;
  }
  const received = state.history.filter((h) => h.direction === 'in' && Date.now() - h.at < 86400000).length;
  $('#badge-recent').textContent = received || '';
  $('#badge-send').textContent = state.outbox.length || '';
}

// ---------- Views ----------
function render(animate = false) {
  if (!state) return;
  // Não reconstrói a tela enquanto o usuário digita num campo dela.
  if (!animate && document.activeElement?.closest?.('#view') && document.activeElement.tagName === 'INPUT') return;
  const el = $('#view');
  el.innerHTML = { recent: viewRecent, send: viewSend, connect: viewConnect, settings: viewSettings }[view]();
  el.classList.remove('view-enter');
  if (animate) { void el.offsetWidth; el.classList.add('view-enter'); el.scrollTop = 0; }
  bindView();
  if (view === 'recent') renderTransfers();
}

function viewRecent() {
  const q = query.trim().toLowerCase();
  const items = state.history.filter((h) => (filter === 'all' || h.direction === filter) && (!q || h.name.toLowerCase().includes(q)));
  let html = '<div id="transfers"></div>';
  if (!items.length) {
    const a = currentAddr();
    const filtered = q || filter !== 'all';
    return html + `
      <div class="empty">
        <div class="rings"><i></i><i></i><i></i></div>
        <h3>${t(filtered ? 'recent.noMatchTitle' : 'recent.emptyTitle')}</h3>
        <p>${filtered ? t('recent.noMatchBody') : t('recent.emptyBody', { address: a ? `${a.address}:${state.server.port}` : tx('recent.emptyAddressFallback') })}</p>
        ${filtered ? '' : `<button class="btn primary" data-go="connect">${t('recent.showQr')}</button>`}
      </div>`;
  }
  const groups = new Map();
  for (const h of items) {
    const k = dayLabel(h.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  let first = true;
  for (const [label, list] of groups) {
    html += `<div class="group-title"><span>${esc(label)}</span>${first ? `<button class="btn ghost" id="clear-hist">${t('recent.clear')}</button>` : ''}</div>`;
    first = false;
    html += `<div class="card file-list">${list.map(rowHistory).join('')}</div>`;
  }
  return html;
}

function rowHistory(h) {
  const dir = h.direction === 'in'
    ? `<span class="pill in">${I.down}${t('dir.from', { device: device(h.device) })}</span>`
    : `<span class="pill out">${I.up}${t('dir.to', { device: device(h.device) })}</span>`;
  return `
    <div class="file-row ${h.exists ? '' : 'missing'}" data-open="${esc(h.path)}" title="${esc(h.path)}">
      ${tile(h.name)}
      <div class="file-main">
        <div class="file-name">${esc(h.name)}</div>
        <div class="file-meta">${dir}<span>${fmtSize(h.size)}</span><span>·</span><span>${fmtWhen(h.at)}</span>${h.exists ? '' : `<span>· ${t('recent.missing')}</span>`}</div>
      </div>
      <div class="file-actions">
        ${h.exists ? `<button data-act="open" data-path="${esc(h.path)}" title="${esc(tx('action.open'))}">${I.open}</button>
        <button data-act="folder" data-path="${esc(h.path)}" title="${esc(tx('action.showInFolder'))}">${I.folder}</button>` : ''}
        <button data-act="rm-hist" data-id="${h.id}" title="${esc(tx('action.removeFromHistory'))}">${I.x}</button>
      </div>
    </div>`;
}

function renderTransfers() {
  const el = $('#transfers');
  if (!el) return;
  const now = Date.now();
  el.innerHTML = transfers.map((tr) => {
    const prev = speedSamples.get(tr.id) || { at: now, bytes: tr.received, speed: 0 };
    const dt = (now - prev.at) / 1000;
    let speed = prev.speed;
    if (dt > 0.3) {
      speed = (tr.received - prev.bytes) / dt;
      speedSamples.set(tr.id, { at: now, bytes: tr.received, speed });
    } else if (!speedSamples.has(tr.id)) speedSamples.set(tr.id, prev);
    const pct = tr.total ? Math.min(100, (tr.received / tr.total) * 100) : 0;
    const label = t(tr.direction === 'in' ? 'transfer.receiving' : 'transfer.sending', { device: device(tr.device) });
    const amount = tr.total ? t('transfer.of', { done: fmtSize(tr.received), total: fmtSize(tr.total) }) : fmtSize(tr.received);
    return `
      <div class="card transfer">
        ${tile(tr.name)}
        <div class="file-main">
          <div class="file-name">${esc(tr.name)}</div>
          <div class="file-meta"><span class="pill ${tr.direction}">${tr.direction === 'in' ? I.down : I.up}${label}</span><span>${amount}</span></div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
        <div class="speed">${speed > 0 ? `${fmtSize(speed)}/s` : t('transfer.waiting')}<br>${tr.total ? `${Math.round(pct)}%` : ''}</div>
      </div>`;
  }).join('');
  for (const id of speedSamples.keys()) if (!transfers.some((tr) => tr.id === id)) speedSamples.delete(id);
}

function viewSend() {
  const a = currentAddr();
  const qr = a && state.qrs[a.address];
  const list = state.outbox.length
    ? `<div class="group-title"><span>${t('send.sharing', { n: state.outbox.length })}</span></div>
       <div class="card file-list">${state.outbox.map((o) => `
        <div class="file-row" data-open="${esc(o.path)}" title="${esc(o.path)}">
          ${tile(o.name)}
          <div class="file-main">
            <div class="file-name">${esc(o.name)}</div>
            <div class="file-meta"><span>${fmtSize(o.size)}</span><span>·</span><span>${t('send.added', { when: fmtWhen(o.addedAt) })}</span></div>
          </div>
          <div class="file-actions">
            <button data-act="folder" data-path="${esc(o.path)}" title="${esc(tx('action.showInFolder'))}">${I.folder}</button>
            <button data-act="rm-out" data-id="${o.id}" title="${esc(tx('action.stopSharing'))}">${I.x}</button>
          </div>
        </div>`).join('')}</div>`
    : '';
  return `
    <div class="send-grid">
      <div>
        <div class="dropzone" id="dz">
          <div class="big-icon">${I.share}</div>
          <strong>${t('send.dropTitle')}</strong>
          <span>${t('send.dropSub')}</span>
        </div>
        ${list}
      </div>
      <div class="card mini-qr">
        ${qr ? `<img src="${qr.qr}" alt="QR" />` : ''}
        <strong>${t('send.qrTitle')}</strong>
        <p>${t('send.qrBody')}</p>
      </div>
    </div>`;
}

function shortcutUrl(a) {
  return `http://${a.address}:${state.settings.port}/api/upload?t=${state.settings.token}&name=`;
}

function viewConnect() {
  const a = currentAddr();
  if (!a) {
    return `<div class="empty"><div class="rings"><i></i><i></i><i></i></div><h3>${t('connect.noNetworkTitle')}</h3><p>${t('connect.noNetworkBody')}</p></div>`;
  }
  const qr = state.qrs[a.address];
  const base = qr.url.split('?')[0];
  const code = (v) => ({ html: `<code>${esc(v)}</code>` });
  const shortcutName = tx('connect.shortcutName');
  return `
    ${!state.server.running ? `<div class="alert">${I.alert}<span>${esc(state.server.error || tx('server.notRunning'))}</span></div>` : ''}
    <div class="connect-grid">
      <div class="card qr-card">
        <div class="qr-frame"><img src="${qr.qr}" alt="${esc(tx('connect.qrAlt'))}" /></div>
        ${state.addresses.length > 1 ? `<div class="addr-pills">${state.addresses.map((x) => `<button data-addr="${esc(x.address)}" class="${x.address === a.address ? 'on' : ''}">${esc(x.address)}<small>${esc(x.ifname)}</small></button>`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="card">
          <div class="kv"><label>${t('connect.address')}</label><code dir="ltr">${esc(base)}</code><button class="btn icon-btn" data-copy="${esc(qr.url)}" title="${esc(tx('connect.copyLinkWithCode'))}">${I.copy}</button></div>
          <div class="kv"><label>${t('connect.code')}</label><code class="token" dir="ltr">${esc(state.settings.token)}</code><button class="btn icon-btn" data-copy="${esc(state.settings.token)}" title="${esc(tx('connect.copy'))}">${I.copy}</button></div>
        </div>

        <div class="group-title">${t('connect.iphoneTitle')}</div>
        <div class="card">
          <ol class="steps">
            <li><span>${t('connect.iphone1')}</span></li>
            <li><span>${t('connect.iphone2')}</span></li>
            <li><span>${t('connect.iphone3')}</span></li>
          </ol>
        </div>

        <div class="group-title">${t('connect.otherTitle')}</div>
        <div class="card">
          <div class="card-head">
            <div class="tile t-doc">${I.pc}</div>
            <div><strong>${t('connect.otherHead')}</strong><span>${t('connect.otherHeadSub')}</span></div>
          </div>
          <ol class="steps">
            <li><span>${t('connect.other1', { address: code(base) })} <button class="btn ghost" data-copy="${esc(base)}">${t('connect.copy')}</button></span></li>
            <li><span>${t('connect.other2', { code: { html: `<b class="mono-code">${esc(state.settings.token)}</b>` } })} <button class="btn ghost" data-copy="${esc(qr.url)}">${t('connect.copyLinkWithCode')}</button></span></li>
            <li><span>${t('connect.other3')}</span></li>
            <li><span>${t('connect.other4')}</span></li>
          </ol>
        </div>
        <p class="hint">${t('connect.otherHelp')}</p>

        <div class="group-title">${t('connect.shortcutTitle')}</div>
        <div class="card">
          <div class="card-head">
            <div class="tile t-code">${I.bolt}</div>
            <div><strong>${t('connect.shortcutHead', { name: shortcutName })}</strong><span>${t('connect.shortcutHeadSub')}</span></div>
          </div>
          <ol class="steps">
            <li><span>${t('connect.shortcut1')}</span></li>
            <li><span>${t('connect.shortcut2')}</span></li>
            <li><span>${t('connect.shortcut3')}<br><code dir="ltr">${esc(shortcutUrl(a))}</code> <button class="btn ghost" data-copy="${esc(shortcutUrl(a))}">${t('connect.copyUrl')}</button></span></li>
            <li><span>${t('connect.shortcut4')}</span></li>
            <li><span>${t('connect.shortcut5', { name: shortcutName })}</span></li>
          </ol>
        </div>
        <p class="hint">${t('connect.shortcutHelp')}</p>
      </div>
    </div>`;
}

function setting({ icon, color, title, sub, subClass = '', control }) {
  return `<div class="setting"><div class="s-icon ${color}">${icon}</div><div class="s-main"><b>${title}</b>${sub ? `<small class="${subClass}" title="${esc(sub)}">${esc(sub)}</small>` : ''}</div><div class="s-controls">${control}</div></div>`;
}
const toggle = (key) => `<label class="switch"><input type="checkbox" data-toggle="${key}" ${state.settings[key] ? 'checked' : ''}/><span></span></label>`;

function languageSelect() {
  const cur = state.settings.language || 'auto';
  const opts = [`<option value="auto" ${cur === 'auto' ? 'selected' : ''}>${t('settings.languageAuto', { name: L.systemName || 'English' })}</option>`]
    .concat(L.languages.map((l) => `<option value="${esc(l.code)}" ${cur === l.code ? 'selected' : ''}>${esc(l.name)}</option>`));
  return `<select class="field" id="lang">${opts.join('')}</select>`;
}

function viewSettings() {
  const s = state.settings;
  const today = new Date().toLocaleDateString('sv-SE');
  return `
    <div class="settings">
      ${!state.server.running ? `<div class="alert">${I.alert}<span>${esc(state.server.error || tx('server.notRunning'))}</span><button class="btn" id="restart">${I.refresh}${t('settings.retry')}</button></div>` : ''}
      <div class="group-title">${t('settings.receiving')}</div>
      <div class="card">
        ${setting({ icon: I.folder, color: 'ic-blue', title: t('settings.saveTo'), sub: `‎${s.saveDir}`, subClass: 'path', control: `<button class="btn" id="open-dir">${t('settings.open')}</button><button class="btn primary" id="choose-dir">${t('settings.change')}</button>` })}
        ${setting({ icon: I.calendar, color: 'ic-orange', title: t('settings.byDate'), sub: tx('settings.byDateSub', { example: today }), control: toggle('organizeByDate') })}
        ${setting({ icon: I.open, color: 'ic-teal', title: t('settings.reveal'), sub: tx('settings.revealSub'), control: toggle('openFolderOnReceive') })}
      </div>

      <div class="group-title">${t('settings.general')}</div>
      <div class="card">
        ${setting({ icon: I.globe, color: 'ic-indigo', title: t('settings.language'), sub: tx('settings.languageSub'), control: languageSelect() })}
        ${setting({ icon: I.pc, color: 'ic-gray', title: t('settings.deviceName'), sub: tx('settings.deviceNameSub'), control: `<input class="field" id="device-name" value="${esc(s.deviceName)}" maxlength="40" style="width:190px" />` })}
        ${setting({ icon: I.bell, color: 'ic-red', title: t('settings.notifications'), sub: tx('settings.notificationsSub'), control: toggle('notifications') })}
        ${setting({ icon: I.power, color: 'ic-green', title: t('settings.launch'), sub: tx('settings.launchSub'), control: toggle('launchAtLogin') })}
        ${setting({ icon: I.tray, color: 'ic-indigo', title: t('settings.tray'), sub: tx('settings.traySub'), control: toggle('closeToTray') })}
      </div>

      <div class="group-title">${t('settings.network')}</div>
      <div class="card">
        ${setting({ icon: I.plug, color: 'ic-blue', title: t('settings.port'), sub: state.server.running ? tx('settings.portActive', { port: state.server.port }) : tx('status.stopped'), control: `<input class="field" id="port" type="number" min="1024" max="65535" value="${s.port}" style="width:90px;font-family:var(--mono)" /><button class="btn" id="apply-port">${t('settings.apply')}</button>` })}
        ${setting({ icon: I.lock, color: 'ic-orange', title: t('settings.code'), sub: tx('settings.codeSub'), control: `<code class="mono-code" dir="ltr" style="font-size:13px;margin-inline-end:6px;user-select:text">${esc(s.token)}</code><button class="btn" id="regen">${I.refresh}${t('settings.regen')}</button>` })}
      </div>
      <p class="hint" style="text-align:center;margin:14px 4px">${t('settings.footer', { version: state.version })}</p>
    </div>`;
}

// ---------- Eventos da view ----------
function bindView() {
  const el = $('#view');
  el.onclick = (e) => {
    const tg = e.target.closest('[data-act],[data-go],[data-copy],[data-addr],#dz,#clear-hist,#choose-dir,#open-dir,#apply-port,#regen,#restart');
    if (!tg) return;
    e.stopPropagation();
    if (tg.dataset.go) return navigate(tg.dataset.go);
    if (tg.dataset.copy) return act(() => drop.copy(tg.dataset.copy), tx('toast.copied'));
    if (tg.dataset.addr) { selectedAddr = tg.dataset.addr; return render(); }
    switch (tg.dataset.act || tg.id) {
      case 'open': return act(() => drop.openFile(tg.dataset.path));
      case 'folder': return act(() => drop.showInFolder(tg.dataset.path));
      case 'rm-hist': return act(() => drop.removeHistory(tg.dataset.id));
      case 'rm-out': return act(() => drop.removeOutbox(tg.dataset.id));
      case 'dz': return act(drop.pickOutbox);
      case 'clear-hist': return act(drop.clearHistory, tx('toast.historyCleared'));
      case 'choose-dir': return act(async () => { const d = await drop.chooseSaveDir(); if (d) toast(tx('toast.folderUpdated')); });
      case 'open-dir': return act(drop.openSaveDir);
      case 'apply-port': return act(() => drop.setSetting('port', $('#port').value), tx('toast.serverRestarted'));
      case 'regen': return act(drop.regenerateToken, tx('toast.newCode'));
      case 'restart': return act(drop.restartServer);
    }
  };
  el.ondblclick = (e) => {
    const row = e.target.closest('[data-open]');
    if (row && !e.target.closest('.file-actions')) act(() => drop.openFile(row.dataset.open));
  };
  el.querySelectorAll('[data-toggle]').forEach((inp) => {
    inp.onchange = () => act(() => drop.setSetting(inp.dataset.toggle, inp.checked));
  });
  const langSel = $('#lang');
  if (langSel) langSel.onchange = () => act(() => drop.setSetting('language', langSel.value));
  const name = $('#device-name');
  if (name) {
    const commit = () => { if (name.value !== state.settings.deviceName) act(() => drop.setSetting('deviceName', name.value), tx('toast.nameUpdated')); };
    name.onblur = commit;
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  }
  const port = $('#port');
  if (port) port.onkeydown = (e) => { if (e.key === 'Enter') $('#apply-port').click(); };
}

// ---------- Arrastar e soltar (janela inteira) ----------
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (++dragDepth === 1) $('#drop-overlay').classList.add('show');
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.remove('show'); }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').classList.remove('show');
  const paths = [...e.dataTransfer.files].map((f) => drop.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  await act(async () => {
    const n = await drop.addOutbox(paths);
    if (!n) throw new Error(tx('toast.onlyFiles'));
    toast(tx('toast.ready', { n }));
    if (view !== 'send') navigate('send');
  });
});

// ---------- Inicialização ----------
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
document.querySelectorAll('[data-win]').forEach((b) => (b.onclick = () => drop.win[b.dataset.win]()));
window.addEventListener('blur', () => document.body.classList.add('blurred'));
window.addEventListener('focus', () => document.body.classList.remove('blurred'));
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); act(drop.pickOutbox); }
  if (e.ctrlKey && e.key.toLowerCase() === 'f' && view === 'recent') { e.preventDefault(); $('#q')?.focus(); }
  if (e.ctrlKey && ['1', '2', '3', '4'].includes(e.key)) navigate(VIEWS[e.key - 1]);
});

drop.on('state', (s) => {
  const outboxChanged = !state || state.outbox.length !== s.outbox.length;
  state = s;
  transfers = s.transfers;
  const langChanged = applyI18n(s.i18n);
  renderChrome();
  if (langChanged) return navigate(view);
  if (outboxChanged && view === 'send') renderToolbar();
  render();
});
drop.on('transfers', (list) => {
  transfers = list;
  if (view === 'recent') renderTransfers();
});
drop.on('navigate', (v) => navigate(v));

(async () => {
  state = await drop.getState();
  transfers = state.transfers;
  applyI18n(state.i18n);
  renderChrome();
  navigate('recent');
  // Atualiza "há X min" periodicamente.
  setInterval(() => { if (view === 'recent' && !transfers.length) render(); }, 60_000);
})();
