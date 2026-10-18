/* global drop */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
let view = 'recent';
let filter = 'all';
let query = '';
let selectedAddr = null;
let transfers = [];
const speedSamples = new Map();

// ---------- Utilidades ----------
function fmtSize(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 100 ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

function fmtWhen(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 45) return 'agora';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  const d = new Date(ts);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return time;
}

function dayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
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
const VIEWS = {
  recent: { title: 'Recentes', sub: () => 'Tudo o que entrou e saiu deste PC' },
  send: { title: 'Enviar', sub: () => 'Arquivos que o iPhone, o Mac ou outro computador podem baixar agora' },
  connect: { title: 'Conectar', sub: () => 'iPhone pela câmera, ou qualquer computador da rede pelo navegador' },
  settings: { title: 'Ajustes', sub: () => 'Onde salvar, rede e comportamento do app' },
};

function navigate(v) {
  view = v;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#view-title').textContent = VIEWS[v].title;
  $('#view-sub').textContent = VIEWS[v].sub();
  renderToolbar();
  render(true);
}

function renderToolbar() {
  const el = $('#toolbar-actions');
  if (view === 'recent') {
    el.innerHTML = `
      <div class="segmented" id="seg">
        <button data-f="all" class="${filter === 'all' ? 'on' : ''}">Tudo</button>
        <button data-f="in" class="${filter === 'in' ? 'on' : ''}">Recebidos</button>
        <button data-f="out" class="${filter === 'out' ? 'on' : ''}">Enviados</button>
      </div>
      <label class="search">${I.search}<input id="q" placeholder="Buscar" value="${esc(query)}" /></label>`;
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
      ${state?.outbox.length ? `<button class="btn ghost" id="clear-out">Limpar tudo</button>` : ''}
      <button class="btn primary" id="pick">${I.plus}Adicionar arquivos</button>`;
    $('#pick').onclick = () => act(drop.pickOutbox);
    const c = $('#clear-out');
    if (c) c.onclick = () => act(drop.clearOutbox, 'Lista de envio limpa');
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
    $('#status-title').textContent = 'Servidor parado';
    $('#status-sub').textContent = 'Veja em Ajustes';
  } else if (!a) {
    $('#status-title').textContent = 'Sem rede';
    $('#status-sub').textContent = 'Conecte ao Wi-Fi';
  } else {
    $('#status-title').textContent = 'Pronto para receber';
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
    return html + `
      <div class="empty">
        <div class="rings"><i></i><i></i><i></i></div>
        <h3>${q || filter !== 'all' ? 'Nada encontrado' : 'Nenhum arquivo ainda'}</h3>
        <p>${q || filter !== 'all' ? 'Tente outro filtro ou termo de busca.' : `Abra <b>${a ? `${esc(a.address)}:${state.server.port}` : 'o endereço do PC'}</b> no iPhone ou aponte a câmera para o QR code em Conectar.`}</p>
        ${q || filter !== 'all' ? '' : '<button class="btn primary" data-go="connect">Mostrar QR code</button>'}
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
    html += `<div class="group-title"><span>${esc(label)}</span>${first ? '<button class="btn ghost" id="clear-hist">Limpar histórico</button>' : ''}</div>`;
    first = false;
    html += `<div class="card file-list">${list.map(rowHistory).join('')}</div>`;
  }
  return html;
}

function rowHistory(h) {
  const dir = h.direction === 'in'
    ? `<span class="pill in">${I.down}do ${esc(h.device)}</span>`
    : `<span class="pill out">${I.up}para o ${esc(h.device)}</span>`;
  return `
    <div class="file-row ${h.exists ? '' : 'missing'}" data-open="${esc(h.path)}" title="${esc(h.path)}">
      ${tile(h.name)}
      <div class="file-main">
        <div class="file-name">${esc(h.name)}</div>
        <div class="file-meta">${dir}<span>${fmtSize(h.size)}</span><span>·</span><span>${fmtWhen(h.at)}</span>${h.exists ? '' : '<span>· arquivo movido ou apagado</span>'}</div>
      </div>
      <div class="file-actions">
        ${h.exists ? `<button data-act="open" data-path="${esc(h.path)}" title="Abrir">${I.open}</button>
        <button data-act="folder" data-path="${esc(h.path)}" title="Mostrar na pasta">${I.folder}</button>` : ''}
        <button data-act="rm-hist" data-id="${h.id}" title="Remover do histórico">${I.x}</button>
      </div>
    </div>`;
}

function renderTransfers() {
  const el = $('#transfers');
  if (!el) return;
  const now = Date.now();
  el.innerHTML = transfers.map((t) => {
    const prev = speedSamples.get(t.id) || { at: now, bytes: t.received, speed: 0 };
    const dt = (now - prev.at) / 1000;
    let speed = prev.speed;
    if (dt > 0.3) {
      speed = (t.received - prev.bytes) / dt;
      speedSamples.set(t.id, { at: now, bytes: t.received, speed });
    } else if (!speedSamples.has(t.id)) speedSamples.set(t.id, prev);
    const pct = t.total ? Math.min(100, (t.received / t.total) * 100) : 0;
    const label = t.direction === 'in' ? `Recebendo do ${esc(t.device)}` : `Enviando para o ${esc(t.device)}`;
    return `
      <div class="card transfer">
        ${tile(t.name)}
        <div class="file-main">
          <div class="file-name">${esc(t.name)}</div>
          <div class="file-meta"><span class="pill ${t.direction}">${t.direction === 'in' ? I.down : I.up}${label}</span><span>${fmtSize(t.received)}${t.total ? ` de ${fmtSize(t.total)}` : ''}</span></div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
        <div class="speed">${speed > 0 ? `${fmtSize(speed)}/s` : 'aguardando'}<br>${t.total ? `${Math.round(pct)}%` : ''}</div>
      </div>`;
  }).join('');
  for (const id of speedSamples.keys()) if (!transfers.some((t) => t.id === id)) speedSamples.delete(id);
}

function viewSend() {
  const a = currentAddr();
  const qr = a && state.qrs[a.address];
  const list = state.outbox.length
    ? `<div class="group-title"><span>Compartilhando ${state.outbox.length} ${state.outbox.length === 1 ? 'arquivo' : 'arquivos'}</span></div>
       <div class="card file-list">${state.outbox.map((o) => `
        <div class="file-row" data-open="${esc(o.path)}" title="${esc(o.path)}">
          ${tile(o.name)}
          <div class="file-main">
            <div class="file-name">${esc(o.name)}</div>
            <div class="file-meta"><span>${fmtSize(o.size)}</span><span>·</span><span>adicionado ${fmtWhen(o.addedAt)}</span></div>
          </div>
          <div class="file-actions">
            <button data-act="folder" data-path="${esc(o.path)}" title="Mostrar na pasta">${I.folder}</button>
            <button data-act="rm-out" data-id="${o.id}" title="Parar de compartilhar">${I.x}</button>
          </div>
        </div>`).join('')}</div>`
    : '';
  return `
    <div class="send-grid">
      <div>
        <div class="dropzone" id="dz">
          <div class="big-icon">${I.share}</div>
          <strong>Arraste arquivos para cá</strong>
          <span>ou clique para escolher — eles aparecem na hora no iPhone</span>
        </div>
        ${list}
      </div>
      <div class="card mini-qr">
        ${qr ? `<img src="${qr.qr}" alt="QR code" />` : ''}
        <strong>Baixe no iPhone</strong>
        <p>Abra a câmera, toque no link e vá em <b>Do PC</b>. Os arquivos vão para o app Arquivos → Downloads.</p>
      </div>
    </div>`;
}

function shortcutUrl(a) {
  return `http://${a.address}:${state.settings.port}/api/upload?t=${state.settings.token}&name=`;
}

function viewConnect() {
  const a = currentAddr();
  if (!a) {
    return `<div class="empty"><div class="rings"><i></i><i></i><i></i></div><h3>Sem conexão de rede</h3><p>Conecte este PC ao mesmo Wi-Fi do iPhone (ou ao mesmo roteador por cabo).</p></div>`;
  }
  const qr = state.qrs[a.address];
  return `
    ${!state.server.running ? `<div class="alert">${I.alert}<span>${esc(state.server.error || 'O servidor não está rodando.')}</span></div>` : ''}
    <div class="connect-grid">
      <div class="card qr-card">
        <div class="qr-frame"><img src="${qr.qr}" alt="QR code para conectar" /></div>
        ${state.addresses.length > 1 ? `<div class="addr-pills">${state.addresses.map((x) => `<button data-addr="${esc(x.address)}" class="${x.address === a.address ? 'on' : ''}">${esc(x.address)}<small>${esc(x.ifname)}</small></button>`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="card">
          <div class="kv"><label>Endereço</label><code>${esc(qr.url.split('?')[0])}</code><button class="btn icon-btn" data-copy="${esc(qr.url)}" title="Copiar link com código">${I.copy}</button></div>
          <div class="kv"><label>Código de acesso</label><code class="token">${esc(state.settings.token)}</code><button class="btn icon-btn" data-copy="${esc(state.settings.token)}" title="Copiar">${I.copy}</button></div>
        </div>

        <div class="group-title">No iPhone ou iPad</div>
        <div class="card">
          <ol class="steps">
            <li><span>Abra a <b>Câmera</b> e aponte para o QR code.</span></li>
            <li><span>Toque no link. A página do KromaDrop abre já com o código de acesso.</span></li>
            <li><span>Dica: toque em <b>Compartilhar → Adicionar à Tela de Início</b> para ter um ícone como um app.</span></li>
          </ol>
        </div>

        <div class="group-title">Outro computador na mesma rede</div>
        <div class="card">
          <div class="card-head">
            <div class="tile t-doc">${I.pc}</div>
            <div><strong>Windows, Mac ou Linux, sem instalar nada</strong><span>Funciona em qualquer navegador: Chrome, Edge, Safari ou Firefox</span></div>
          </div>
          <ol class="steps">
            <li><span>No outro computador, abra o navegador e digite <code>${esc(qr.url.split('?')[0])}</code> <button class="btn ghost" data-copy="${esc(qr.url.split('?')[0])}">Copiar</button></span></li>
            <li><span>Na primeira vez, digite o código de acesso <b style="font-family:var(--mono);letter-spacing:.12em">${esc(state.settings.token)}</b>. Ou mande o <b>link já com o código</b> por chat ou e-mail: <button class="btn ghost" data-copy="${esc(qr.url)}">Copiar link com código</button></span></li>
            <li><span><b>Para mandar a este PC:</b> arraste os arquivos para a página ou clique em <b>Escolher</b>. Eles caem na pasta de destino definida em Ajustes.</span></li>
            <li><span><b>Para receber deste PC:</b> arraste arquivos para esta janela. Eles aparecem em <b>Do PC</b> na página do outro computador; é só clicar em <b>Baixar</b>.</span></li>
          </ol>
        </div>
        <p style="color:var(--text-3);font-size:11.5px;margin:10px 4px 0;line-height:1.5">Não abriu? Confira se os dois estão no mesmo Wi-Fi ou roteador, se a rede deste PC está como <b>Privada</b> nas configurações do Windows e se o firewall liberou o KromaDrop.</p>

        <div class="group-title">Enviar pelo menu Compartilhar (Atalho)</div>
        <div class="card">
          <div class="card-head">
            <div class="tile t-code">${I.bolt}</div>
            <div><strong>“Enviar para PC” ao lado do AirDrop</strong><span>Crie uma vez no app Atalhos do iPhone</span></div>
          </div>
          <ol class="steps">
            <li><span>No app <b>Atalhos</b>, toque em <b>+</b>. Em <b>ⓘ Detalhes</b>, ative <b>Mostrar na Planilha de Compartilhamento</b> e aceite <b>Imagens, Mídia e Arquivos</b>.</span></li>
            <li><span>Adicione <b>Repetir com Cada Item</b> usando a <b>Entrada do Atalho</b>.</span></li>
            <li><span>Dentro do repetir, adicione <b>Obter Conteúdo do URL</b> com o URL abaixo e, logo no final, insira as variáveis <b>Item de Repetição → Nome</b>, um ponto e <b>Item de Repetição → Extensão do Arquivo</b>:<br><code>${esc(shortcutUrl(a))}</code> <button class="btn ghost" data-copy="${esc(shortcutUrl(a))}">Copiar URL</button></span></li>
            <li><span>Em <b>Mostrar Mais</b>: Método <b>POST</b>, Corpo da Solicitação <b>Arquivo</b> → <b>Item de Repetição</b>.</span></li>
            <li><span>Dê o nome <b>Enviar para PC</b>. Pronto: em qualquer foto ou arquivo, toque em Compartilhar e escolha o atalho.</span></li>
          </ol>
        </div>
        <p style="color:var(--text-3);font-size:11.5px;margin:10px 4px 0;line-height:1.5">Se o IP do PC mudar, o QR code atualiza sozinho, mas o Atalho não. Para fixar o IP, reserve-o no seu roteador (DHCP estático).</p>
      </div>
    </div>`;
}

function setting({ icon, color, title, sub, subClass = '', control }) {
  return `<div class="setting"><div class="s-icon ${color}">${icon}</div><div class="s-main"><b>${title}</b>${sub ? `<small class="${subClass}" title="${esc(sub)}">${esc(sub)}</small>` : ''}</div><div class="s-controls">${control}</div></div>`;
}
const toggle = (key) => `<label class="switch"><input type="checkbox" data-toggle="${key}" ${state.settings[key] ? 'checked' : ''}/><span></span></label>`;

function viewSettings() {
  const s = state.settings;
  return `
    <div class="settings">
      ${!state.server.running ? `<div class="alert">${I.alert}<span>${esc(state.server.error || 'O servidor não está rodando.')}</span><button class="btn" id="restart">${I.refresh}Tentar de novo</button></div>` : ''}
      <div class="group-title">Recebimento</div>
      <div class="card">
        ${setting({ icon: I.folder, color: 'ic-blue', title: 'Salvar arquivos recebidos em', sub: `‎${s.saveDir}`, subClass: 'path', control: `<button class="btn" id="open-dir">Abrir</button><button class="btn primary" id="choose-dir">Alterar…</button>` })}
        ${setting({ icon: I.calendar, color: 'ic-orange', title: 'Organizar em pastas por dia', sub: 'Cria uma subpasta como 2026-10-18 para cada dia', control: toggle('organizeByDate') })}
        ${setting({ icon: I.open, color: 'ic-teal', title: 'Mostrar o arquivo ao receber', sub: 'Abre o Explorer com o arquivo selecionado', control: toggle('openFolderOnReceive') })}
      </div>

      <div class="group-title">Geral</div>
      <div class="card">
        ${setting({ icon: I.pc, color: 'ic-gray', title: 'Nome deste PC', sub: 'Aparece na página do iPhone', control: `<input class="field" id="device-name" value="${esc(s.deviceName)}" maxlength="40" style="width:190px" />` })}
        ${setting({ icon: I.bell, color: 'ic-red', title: 'Notificações', sub: 'Avisar quando um arquivo chegar', control: toggle('notifications') })}
        ${setting({ icon: I.power, color: 'ic-green', title: 'Iniciar com o Windows', sub: 'Abre minimizado na bandeja, pronto para receber', control: toggle('launchAtLogin') })}
        ${setting({ icon: I.tray, color: 'ic-indigo', title: 'Continuar na bandeja ao fechar', sub: 'Fechar a janela não desliga o recebimento', control: toggle('closeToTray') })}
      </div>

      <div class="group-title">Rede e segurança</div>
      <div class="card">
        ${setting({ icon: I.plug, color: 'ic-blue', title: 'Porta', sub: state.server.running ? `Servidor ativo na porta ${state.server.port}` : 'Servidor parado', control: `<input class="field" id="port" type="number" min="1024" max="65535" value="${s.port}" style="width:90px;font-family:var(--mono)" /><button class="btn" id="apply-port">Aplicar</button>` })}
        ${setting({ icon: I.lock, color: 'ic-orange', title: 'Código de acesso', sub: 'Gerar um novo desconecta todos os aparelhos', control: `<code style="font-family:var(--mono);font-size:13px;letter-spacing:.15em;font-weight:600;margin-right:6px;user-select:text">${esc(s.token)}</code><button class="btn" id="regen">${I.refresh}Gerar novo</button>` })}
      </div>
      <p style="color:var(--text-3);font-size:11.5px;margin:14px 4px;text-align:center">KromaDrop ${esc(state.version)} · funciona só na sua rede local, nada passa pela internet</p>
    </div>`;
}

// ---------- Eventos da view ----------
function bindView() {
  const el = $('#view');
  el.onclick = (e) => {
    const t = e.target.closest('[data-act],[data-go],[data-copy],[data-addr],#dz,#clear-hist,#choose-dir,#open-dir,#apply-port,#regen,#restart');
    if (!t) return;
    e.stopPropagation();
    if (t.dataset.go) return navigate(t.dataset.go);
    if (t.dataset.copy) return act(() => drop.copy(t.dataset.copy), 'Copiado');
    if (t.dataset.addr) { selectedAddr = t.dataset.addr; return render(); }
    switch (t.dataset.act || t.id) {
      case 'open': return act(() => drop.openFile(t.dataset.path));
      case 'folder': return act(() => drop.showInFolder(t.dataset.path));
      case 'rm-hist': return act(() => drop.removeHistory(t.dataset.id));
      case 'rm-out': return act(() => drop.removeOutbox(t.dataset.id));
      case 'dz': return act(drop.pickOutbox);
      case 'clear-hist': return act(drop.clearHistory, 'Histórico limpo');
      case 'choose-dir': return act(async () => { const d = await drop.chooseSaveDir(); if (d) toast('Pasta de destino atualizada'); });
      case 'open-dir': return act(drop.openSaveDir);
      case 'apply-port': return act(() => drop.setSetting('port', $('#port').value), 'Servidor reiniciado');
      case 'regen': return act(drop.regenerateToken, 'Novo código gerado. Escaneie o QR de novo no iPhone.');
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
  const name = $('#device-name');
  if (name) {
    const commit = () => { if (name.value !== state.settings.deviceName) act(() => drop.setSetting('deviceName', name.value), 'Nome atualizado'); };
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
    if (!n) throw new Error('Só é possível enviar arquivos (pastas não).');
    toast(n === 1 ? '1 arquivo pronto para compartilhar' : `${n} arquivos prontos para compartilhar`);
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
  if (e.ctrlKey && ['1', '2', '3', '4'].includes(e.key)) navigate(['recent', 'send', 'connect', 'settings'][e.key - 1]);
});

drop.on('state', (s) => {
  const outboxChanged = !state || state.outbox.length !== s.outbox.length;
  state = s;
  transfers = s.transfers;
  renderChrome();
  if (outboxChanged && view === 'send') renderToolbar();
  render();
});
drop.on('transfers', (t) => {
  transfers = t;
  if (view === 'recent') renderTransfers();
});
drop.on('navigate', (v) => navigate(v));

(async () => {
  state = await drop.getState();
  transfers = state.transfers;
  renderChrome();
  navigate('recent');
  // Atualiza "há X min" periodicamente.
  setInterval(() => { if (view === 'recent' && !transfers.length) render(); }, 60_000);
})();
