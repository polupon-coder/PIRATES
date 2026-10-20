/* PIRATAS — cliente web */
'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'piratas.session';
const MUTE_KEY = 'piratas.mudo';

// ------------------------------------------------------------ idioma (español / inglés)

let LANG = (() => { try { return localStorage.getItem('piratas.lang'); } catch { return null; } })()
  || (/^es\b/i.test(navigator.language || '') ? 'es' : 'en');
const L = (es, en) => (LANG === 'en' ? en : es);
// Textos del servidor: cadena (solo español) o { es, en }.
const txt = (m) => (m && typeof m === 'object' ? (m[LANG] || m.es) : m);
const GOOD_LABEL_EN = { comida: 'Food', materiales: 'Materials', manufacturas: 'Goods', lujos: 'Luxuries' };
const ATTR_LABEL_EN = { velas: 'Sails', canones: 'Cannons', casco: 'Hull', bodega: 'Hold', tripulacion: 'Crew' };
const goodLabel = (g) => (LANG === 'en' ? GOOD_LABEL_EN[g] : S.reglas.goodLabel[g]);
const attrLabel = (a) => (LANG === 'en' ? ATTR_LABEL_EN[a] : S.reglas.attrLabel[a]);
function setLang(l) {
  LANG = l;
  try { localStorage.setItem('piratas.lang', l); } catch { /* sin almacenamiento */ }
  applyStaticTexts();
  if (S) render();
}

let S = null; // último estado recibido
let receivedAt = 0;
const ui = {
  modal: null, // 'puerto' | 'mercante' | 'trato' | 'precios' | 'reglas'
  modalId: null,
  portTab: 'comercio',
  qty: { vender: {}, comprar: {} },
  repair: 1,
  recruit: 1,
  deal: { dar: { oro: 0, goods: {} }, pedir: { oro: 0, goods: {} } },
  logOpen: null, // 'cronica' | 'chat'
  unread: 0,
  seenAvisos: null,
  combatSeen: null,
  lastRound: null,
  wasMyTurn: false,
  chat: [],
  finalSeen: false,
};

// ------------------------------------------------------------ utilidades

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function saveSession(s) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
}
const ROMAN = ['', 'I', 'II', 'III'];
const ORO = '<img class="ico" src="img/oro.webp" alt="oro">';
const CARGA = '<img class="ico" src="img/carga.webp" alt="carga">';
const ICON = (name, cls = '') => `<img class="ico ${cls}" src="img/${name}.webp" alt="">`;
// Mercancías con ilustración; las que aún no la tienen usan un emoji.
const GOOD_ICON = { comida: ICON('comida', 'good'), materiales: ICON('materiales', 'good'), manufacturas: ICON('manufacturas', 'good'), lujos: ICON('lujos', 'good') };
const TRIP = ICON('tripulacion');
const CASCO = ICON('casco');
const LEYENDA = ICON('tesoro');
// Brújula junto a los nombres de lugares.
const LUGAR = (name) => `${ICON('brujula', 'place')} ${esc(name)}`;
// Icono de cada mejora del barco.
const ATTR_ICON = { velas: ICON('velas'), canones: ICON('canon'), casco: ICON('casco'), bodega: ICON('carga'), tripulacion: ICON('tripulacion') };
const KIND_LABEL = new Proxy({}, { get: (_, k) => ({ pirata: L('Pirata', 'Pirate'), mercante: L('Mercante', 'Merchant'), fragata: L('Fragata de la Armada', 'Navy frigate') })[k] });
const PICK_LABEL = new Proxy({}, { get: (_, k) => ({ canon: L('Cañonear', 'Fire'), abordaje: L('Abordar', 'Board'), maniobra: L('Maniobrar', 'Maneuver') })[k] });

// Errores del servidor (en español) traducidos al inglés.
const ERR_EN = {
  'Acción desconocida': 'Unknown action', 'Ataque no válido': 'Invalid attack', 'Cantidad no válida': 'Invalid amount',
  'Elige a otro pirata': 'Choose another pirate', 'Elige qué comprar o vender': 'Choose what to buy or sell',
  'Error interno': 'Internal error', 'Espera a que termine lo pendiente': 'Wait for the pending action to finish',
  'Fuera de alcance o sin línea de tiro': 'Out of range or no line of fire', 'Hay un combate en curso': 'A fight is in progress',
  'Hay una propuesta de comercio pendiente': 'A trade offer is pending', 'Jugador desconocido': 'Unknown player',
  'La partida ha terminado': 'The game is over', 'La partida ya ha empezado': 'The game has already started',
  'La propuesta está vacía': 'The offer is empty', 'Los barcos tienen que estar juntos': 'The ships must be next to each other',
  'Maniobra no válida': 'Invalid maneuver', 'Mejora no válida': 'Invalid upgrade', 'No cabe en la bodega': 'It does not fit in the hold',
  'No cabe en la bodega del mercante': 'It does not fit in the merchant\'s hold', 'No es tu turno': 'It is not your turn',
  'No estás en combate': 'You are not in a fight', 'No estás en ninguna sala': 'You are not in a room', 'No estás navegando': 'You are not sailing',
  'No existe ninguna sala con ese código': 'There is no room with that code', 'No hay ninguna isla por explorar junto a tu barco': 'There is no unexplored island next to your ship',
  'No puedes abordar desde el puerto': 'You cannot board from port', 'No puedes atacar desde el puerto': 'You cannot attack from port',
  'No puedes comprar y vender la misma mercancía': 'You cannot buy and sell the same goods', 'No puedes expulsarte': 'You cannot remove yourself',
  'No puedes navegar ahí': 'You cannot sail there', 'No puedes volver al último puerto que visitaste hasta atracar en otro': 'You cannot return to the last port you visited until you dock at another one',
  'No te quedan acciones': 'No actions left', 'No te quedan puntos de movimiento': 'No movement points left', 'No tienes marineros para abordar': 'You have no sailors to board with',
  'No tienes ninguna propuesta': 'You have no offer', 'No tienes oro suficiente': 'Not enough gold', 'Objetivo no válido': 'Invalid target',
  'Para abordar tienes que estar junto al barco': 'To board you must be next to the ship', 'Primero pulsa Navegar': 'Press Sail first', 'Ruta no válida': 'Invalid route',
  'Solo el anfitrión puede añadir bots': 'Only the host can add bots', 'Solo el anfitrión puede empezar': 'Only the host can start',
  'Solo el anfitrión puede expulsar': 'Only the host can remove players', 'Tienes que estar atracado en un puerto': 'You must be docked at a port',
  'Tienes que estar junto al mercante': 'You must be next to the merchant', 'Tienes que estar junto al puerto': 'You must be next to the port',
  'Ya está al nivel máximo': 'Already at the maximum level', 'Ya has elegido maniobra': 'You have already chosen a maneuver',
};
const ERR_EN_RE = [
  [/^La sala está llena \((\d+) jugadores\)$/, 'The room is full ($1 players)'],
  [/^Hacen falta al menos (\d+) jugadores$/, 'At least $1 players are needed'],
  [/^No tienes tanta (.+)$/, 'You do not have that much $1'],
  [/^El mercante no lleva tanta (.+)$/, 'The merchant does not carry that much $1'],
  [/^No puedes revender (.+) en el puerto donde la compraste$/, 'You cannot resell $1 at the port where you bought it'],
  [/^(.+) no tiene tanto oro$/, '$1 does not have that much gold'],
  [/^(.+) no tiene tanta (.+)$/, '$1 does not have that much $2'],
  [/^No cabe en la bodega de (.+)$/, 'It does not fit in $1\'s hold'],
];
function trError(msg) {
  if (LANG !== 'en' || !msg) return msg;
  if (ERR_EN[msg]) return ERR_EN[msg];
  for (const [re, en] of ERR_EN_RE) if (re.test(msg)) return msg.replace(re, en);
  return msg;
}

function toast(text, kind = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = trError(txt(text));
  if (kind === 'tesoro') t.insertAdjacentHTML('afterbegin', '<img class="toast-ico" src="img/tesoro.webp" alt="">');
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'tesoro' ? 6000 : 4200);
}

// ------------------------------------------------------------ sonido (los de HÉROES)

const Sounds = (() => {
  const FILE = { turno: 'turno.wav', boton: 'boton.wav', dados: 'dados.mp3', batalla: 'batalla.mp3', celebracion: 'celebracion.mp3', destruccion: 'destruccion.mp3', victoria: 'victoria.mp3', derrota: 'derrota.mp3', conquista: 'conquista.mp3' };
  const VOL = { dados: 0.7, batalla: 0.7, celebracion: 0.45, destruccion: 0.35, derrota: 0.35, victoria: 0.8 };
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* nada */ }
  return {
    play(name) {
      if (muted || !FILE[name]) return;
      const a = new Audio(`sonidos/${FILE[name]}`);
      a.volume = VOL[name] ?? 0.6;
      a.play().catch(() => {});
    },
    toggle() {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* nada */ }
      return muted;
    },
    get muted() { return muted; },
  };
})();
// Campana de barco (dorada, a juego con el título); tachada cuando no hay sonido.
const BELL = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 3.5v3"/><circle cx="16" cy="3" r="1.4" fill="currentColor" stroke="none"/>
  <path d="M10.5 9.5c0-2 2.4-3.2 5.5-3.2s5.5 1.2 5.5 3.2c0 5 1 9.2 3.5 12.3H7c2.5-3.1 3.5-7.3 3.5-12.3z" fill="currentColor" fill-opacity=".22"/>
  <path d="M6 21.8h20M7.2 24.6h17.6"/><path d="M16 24.6v2.6"/><circle cx="16" cy="28.4" r="1.6" fill="currentColor" stroke="none"/>
  <path d="M12.5 11c0 3-.4 6-1.6 8.6" opacity=".55"/>
</svg>`;
const BELL_OFF = BELL.replace('</svg>', '<path d="M4 4l24 24" stroke-width="2.4"/></svg>');
function paintSound() {
  const b = $('soundBtn');
  b.innerHTML = Sounds.muted ? BELL_OFF : BELL;
  b.title = Sounds.muted ? L('Activar sonidos', 'Sound on') : L('Silenciar sonidos', 'Mute sounds');
  b.classList.toggle('muted', Sounds.muted);
}

// ------------------------------------------------------------ barcos (ilustración o dibujo provisional)

function tierOf(niveles) {
  const total = Object.values(niveles || {}).reduce((a, b) => a + b, 0);
  return total <= 7 ? 1 : total <= 11 ? 2 : 3;
}
function svgShip({ hull = '#5a3a1c', sail = '#efe3c4', flag = '#111', masts = 1 }) {
  const mastXs = masts === 1 ? [50] : [32, 52, 70];
  const sails = mastXs.map((x, i) => {
    const h = i === 1 || masts === 1 ? 30 : 24;
    return `<line x1="${x}" y1="${62 - h - 14}" x2="${x}" y2="64" stroke="#3b2414" stroke-width="2.5"/>
      <path d="M${x - 11} ${62 - h} Q${x} ${62 - h - 4} ${x + 11} ${62 - h} L${x + 12} ${58} Q${x} ${54} ${x - 12} ${58} Z" fill="${sail}" stroke="#7a6a4a" stroke-width="1"/>
      <path d="M${x} ${62 - h - 14} l14 3 l-3 4 l3 4 l-14 -2 z" fill="${flag}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${sails}
    <path d="M10 62 L90 62 L80 82 Q50 90 22 82 Z" fill="${hull}" stroke="#1a0f07" stroke-width="2"/>
    <path d="M14 68 L86 68" stroke="#c9a46a" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const FALLBACK = {
  'barco-1': svgShip({ masts: 1 }),
  'barco-2': svgShip({ masts: 3 }),
  'barco-3': svgShip({ masts: 3, hull: '#3b2414' }),
  mercante: svgShip({ masts: 1, hull: '#9a6b3a', sail: '#ffffff', flag: '#3f8f4a' }),
  fragata: svgShip({ masts: 3, hull: '#1f3550', sail: '#ffffff', flag: '#c0392b' }),
};
// Mercantes y fragatas usan las mismas ilustraciones que los piratas.
// Velas del color de cada jugador.
const SAIL = { '#c0392b': 'rojo', '#2471a3': 'azul', '#229954': 'verde', '#d4ac0d': 'amarillo' };
function shipImgName(s) {
  if (s.kind === 'pirata') return `barco-${tierOf(s.niveles)}${SAIL[s.color] ? `-${SAIL[s.color]}` : ''}`;
  return s.kind;
}
// Hacia dónde mira cada ilustración: piratas y fragata, a la derecha; el mercante, a la izquierda.
const FACES_LEFT = { mercante: true };
// Clase para que el barco mire al lado pedido ('left' | 'right').
function facing(s, want) {
  const left = !!FACES_LEFT[s.kind || 'pirata'];
  return (want === 'left') === left ? '' : 'flip';
}
const NEUTRAL_COLOR = { mercante: '#3f8f4a', fragata: '#1f3550' };
// Busca la ilustración en .webp y luego en .png; si no existe, usa el dibujo provisional.
// Se recuerda qué archivo funcionó para no repetir peticiones fallidas en cada repintado.
const SHIP_SRC = {};
function shipImg(s, cls = '') {
  const n = shipImgName(s);
  return `<img class="${cls} kind-${s.kind || 'pirata'}" src="${SHIP_SRC[n] || `img/${n}.webp`}" data-ship="${n}" alt="" onerror="shipFallback(this)" onload="SHIP_SRC[this.dataset.ship]=this.getAttribute('src')">`;
}
function shipFallback(img) {
  const n = img.dataset.ship;
  if (img.getAttribute('src').endsWith('.webp')) img.src = `img/${n}.png`;
  else { img.onerror = null; img.src = FALLBACK[n] || FALLBACK[n.replace(/-[a-z]+$/, '')]; }
}

// ------------------------------------------------------------ conexión

function act(type, data = {}) {
  Sounds.play('boton');
  socket.emit('act', { type, data }, (r) => {
    if (r && !r.ok) toast(r.error, 'error');
  });
}

socket.on('connect', () => {
  const sess = loadSession();
  const url = new URLSearchParams(location.search).get('sala');
  if (sess && (!url || url.toUpperCase() === sess.code)) {
    socket.emit('join', { code: sess.code, token: sess.token, name: sess.name }, (r) => {
      if (!r.ok) {
        saveSession(null);
        showHome();
      }
    });
  } else showHome();
});

socket.on('state', (st) => {
  const first = !S;
  const prev = S;
  S = st;
  receivedAt = Date.now();
  // Avisos y combates ya vistos, por jugador (varios pueden jugar en este dispositivo).
  if (!ui.seenBy) ui.seenBy = {};
  if (!ui.seenBy[st.you]) {
    ui.seenBy[st.you] = { avisos: new Set(((st.me && st.me.avisos) || []).map((a) => a.n)), combat: st.me && st.me.ultimoCombate ? st.me.ultimoCombate.id : null };
  }
  ui.seenAvisos = ui.seenBy[st.you].avisos;
  if (first) ui.finalSeen = st.phase === 'fin';
  const switched = prev && prev.you !== st.you;
  effects(switched ? null : prev, st);
  render();
});
socket.on('chat', (m) => {
  ui.chat.push(m);
  if (ui.logOpen !== 'chat') ui.unread += 1;
  if (ui.chat.length > 60) ui.chat.shift();
  if (S) renderPanel();
});
socket.on('kicked', () => {
  saveSession(null);
  S = null;
  toast(L('Te han expulsado de la sala', 'You have been removed from the room'), 'error');
  showHome();
});

// Avisos, sonidos y cambios de turno.
function effects(prev, st) {
  if (st.me) {
    for (const a of st.me.avisos) {
      if (ui.seenAvisos.has(a.n)) continue;
      ui.seenAvisos.add(a.n);
      toast(a.text, a.kind);
      if (a.kind === 'tesoro') Sounds.play('celebracion');
      if (a.kind === 'hundido') Sounds.play('destruccion');
    }
  }
  const myTurn = !!(st.turn && st.turn.pid === st.you);
  if (myTurn && !ui.wasMyTurn) Sounds.play('turno');
  ui.wasMyTurn = myTurn;
  if (st.combat && (!prev || !prev.combat)) Sounds.play('batalla');
  const pc = prev && prev.combat;
  const nc = st.combat || (st.me && st.me.ultimoCombate);
  if (pc && nc && nc.historial.length > pc.historial.length) Sounds.play('dados');
  if (st.phase === 'fin' && prev && prev.phase !== 'fin') {
    Sounds.play(st.final.winners.includes(st.you) ? 'victoria' : 'derrota');
  }
  if (st.phase !== 'juego') ui.modal = ui.modal === 'reglas' ? 'reglas' : null;
  if (ui.modal === 'puerto' && st.me && st.me.docked === null) ui.modal = null;
}

// ------------------------------------------------------------ portada y sala

function showHome() {
  for (const id of ['lobby', 'game']) $(id).classList.add('hidden');
  $('home').classList.remove('hidden');
  $('roomInfo').textContent = '';
  $('status').textContent = '';
  $('pricesBtn').classList.add('hidden');
  const sess = loadSession();
  if (sess && sess.name) $('nameInput').value = sess.name;
  const url = new URLSearchParams(location.search).get('sala');
  if (url) $('codeInput').value = url.toUpperCase();
}

function enter(r, name) {
  if (!r.ok) {
    $('homeError').textContent = trError(r.error);
    return;
  }
  saveSession({ code: r.code, token: r.token, name });
  history.replaceState(null, '', `?sala=${r.code}`);
}

$('createBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  if (!name) { $('homeError').textContent = L('Escribe tu nombre de capitán', 'Write your captain name'); return; }
  socket.emit('create', { name }, (r) => enter(r, name));
};
$('joinBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name) { $('homeError').textContent = L('Escribe tu nombre de capitán', 'Write your captain name'); return; }
  if (code.length !== 4) { $('homeError').textContent = L('El código tiene 4 letras', 'The code has 4 letters'); return; }
  socket.emit('join', { code, name }, (r) => enter(r, name));
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('soundBtn').onclick = () => { Sounds.toggle(); paintSound(); };
$('rulesBtn').onclick = () => { ui.modal = 'reglas'; renderModal(); };
$('pricesBtn').onclick = () => { ui.modal = 'precios'; renderModal(); };
$('langBtn').onclick = () => setLang(LANG === 'es' ? 'en' : 'es');

// Textos fijos de la página (index.html) en el idioma elegido.
function applyStaticTexts() {
  document.documentElement.lang = LANG;
  const set = (id, prop, es, en) => { const el = $(id); if (el) el[prop] = L(es, en); };
  set('pricesBtn', 'textContent', 'Precios', 'Prices');
  set('rulesBtn', 'textContent', 'Reglas', 'Rules');
  set('nameInput', 'placeholder', 'Tu nombre de capitán', 'Your captain name');
  set('codeInput', 'placeholder', 'CÓDIGO', 'CODE');
  set('createBtn', 'textContent', 'Crear partida', 'Create game');
  set('joinBtn', 'textContent', 'Unirse', 'Join');
  const sub = document.querySelector('.home-sub');
  if (sub) sub.textContent = L('Explora el archipiélago, comercia, mejora tu barco y conviértete en leyenda.', 'Explore the archipelago, trade, upgrade your ship and become a legend.');
  $('langBtn').innerHTML = `<span class="${LANG === 'es' ? 'on' : ''}">ES</span><span class="${LANG === 'en' ? 'on' : ''}">EN</span>`;
  $('langBtn').title = L('Change language: English', 'Cambiar idioma: español');
  paintSound();
}
applyStaticTexts();

// Varios jugadores en este dispositivo: a quién le toca ahora (si no es el activo).
function handoffTarget() {
  if (!S || !S.local || S.phase !== 'juego') return null;
  const meNeeds = S.local.find((p) => p.id === S.you && p.needs);
  if (meNeeds) return null;
  return S.local.find((p) => p.needs && p.id !== S.you) || null;
}
function renderHandoff() {
  const h = $('handoff');
  const to = handoffTarget();
  if (!to) { h.classList.add('hidden'); h.innerHTML = ''; return false; }
  h.innerHTML = `<div class="handoff-card parchment">
    <p class="muted">${L('Mismo dispositivo', 'Same device')}</p>
    <h2><span class="flag" style="background:${to.color}"></span> ${esc(to.name)}</h2>
    <p>${L(`Pasa el dispositivo a <b>${esc(to.name)}</b>. El resto no debe mirar: verá su mapa.`, `Hand the device to <b>${esc(to.name)}</b>. Everyone else, look away: their map will be shown.`)}</p>
    <button class="btn gold big" id="handoffBtn">${L(`Soy ${esc(to.name)}: continuar`, `I'm ${esc(to.name)}: continue`)}</button>
  </div>`;
  h.classList.remove('hidden');
  $('handoffBtn').onclick = () => socket.emit('setActive', { playerId: to.id });
  return true;
}

function render() {
  if (!S) return;
  if (renderHandoff()) return;
  $('home').classList.add('hidden');
  $('roomInfo').textContent = S.code;
  document.body.classList.toggle('in-game', S.phase !== 'lobby');
  if (S.phase === 'lobby') {
    $('game').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('pricesBtn').classList.add('hidden');
    $('status').textContent = L('Preparando la tripulación', 'Gathering the crew');
    renderLobby();
  } else {
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('pricesBtn').classList.remove('hidden');
    renderStatus();
    renderBoard();
    renderPanel();
  }
  renderModal();
  renderCombat();
}

function renderLobby() {
  const host = S.hostId === S.you;
  const link = `${location.origin}/?sala=${S.code}`;
  $('lobby').innerHTML = `
    <div class="lobby-card parchment">
      <h2>${L('Tripulación de la sala', 'Crew of room')} ${esc(S.code)}</h2>
      <p class="muted">${L('De 2 a 4 piratas. Comparte el enlace o el código con tus amigos, o añade jugadores que jueguen en este mismo dispositivo.', 'From 2 to 4 pirates. Share the link or the code with your friends, or add players on this same device.')}</p>
      <div class="share"><input class="input" readonly value="${esc(link)}" id="shareInput"><button class="btn small" id="copyBtn">${L('Copiar', 'Copy')}</button></div>
      ${S.players.map((p) => `
        <div class="player-row">
          <span class="flag" style="background:${p.color}"></span>
          <span class="name">${esc(p.name)}${p.id === S.you ? L(' (tú)', ' (you)') : ''}</span>
          ${p.id === S.hostId ? `<span class="tag">${L('Anfitrión', 'Host')}</span>` : ''}
          ${p.local || (S.local && S.local.some((x) => x.id === p.id) && p.id !== S.you) ? `<span class="tag">${L('Este dispositivo', 'This device')}</span>` : ''}
          ${p.bot ? '<span class="tag">Bot</span>' : p.connected ? '' : `<span class="tag">${L('Desconectado', 'Disconnected')}</span>`}
          ${host && p.id !== S.you ? `<button class="btn small red" data-kick="${p.id}">${L('Expulsar', 'Remove')}</button>` : ''}
        </div>`).join('')}
      ${S.players.length < 4 ? `<div class="share local-add">
        <input class="input" id="localName" maxlength="20" placeholder="${L('Otro jugador en este dispositivo', 'Another player on this device')}">
        <button class="btn small" id="localBtn">${L('Añadir', 'Add')}</button>
      </div>` : ''}
      <div class="row" style="margin-top:14px">
        ${host ? `<button class="btn" id="botBtn" ${S.players.length >= 4 ? 'disabled' : ''}>${L('Añadir bot', 'Add bot')}</button>
        <button class="btn gold" id="startBtn" ${S.players.length < 2 ? 'disabled' : ''}>${L('¡Zarpar!', 'Set sail!')}</button>` : `<p class="muted">${L('Esperando a que el anfitrión empiece la partida…', 'Waiting for the host to start the game…')}</p>`}
      </div>
    </div>`;
  const cb = $('copyBtn');
  if (cb) cb.onclick = () => { navigator.clipboard?.writeText(link); toast(L('Enlace copiado', 'Link copied')); };
  if ($('localBtn')) {
    const add = () => {
      const name = $('localName').value.trim();
      if (!name) { toast(L('Escribe su nombre', 'Write their name'), 'error'); return; }
      socket.emit('addLocal', { name }, (r) => { if (r && !r.ok) toast(r.error, 'error'); });
    };
    $('localBtn').onclick = add;
    $('localName').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  }
  if ($('botBtn')) $('botBtn').onclick = () => act('addBot');
  if ($('startBtn')) $('startBtn').onclick = () => act('start');
  document.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => act('kick', { id: b.dataset.kick }); });
}

// ------------------------------------------------------------ estado y reloj

function remaining(ms) {
  if (ms === null || ms === undefined) return null;
  return Math.max(0, ms - (Date.now() - receivedAt));
}
function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function playerName(id) {
  const p = S.players.find((x) => x.id === id);
  return p ? p.name : '';
}

// Barra superior: ronda y estado del turno (acciones, movimiento y reloj).
function renderStatus() {
  if (S.phase === 'fin') {
    $('status').innerHTML = `<span class="me-turn">${L('La partida ha terminado', 'The game is over')}</span>`;
    return;
  }
  const t = S.turn;
  // En el móvil se muestra la versión corta (.short) de cada dato.
  let html = `<span class="long">${L('Ronda', 'Round')} ${S.round} ${L('de', 'of')} ${S.reglas.maxRounds} · ${LEYENDA} ${S.reglas.winPL} ${L('para ganar', 'to win')}</span><span class="short">${L('Ronda', 'Round')} ${S.round}/${S.reglas.maxRounds}</span> <span class="sep">|</span> `;
  if (S.combat) html += `<span class="me-turn">⚔ ${L('¡Combate!', 'Fight!')}</span>`;
  else if (S.combatOthers) html += `⚔ ${esc(txt(S.combatOthers.a))} ${L('combate contra', 'fights')} ${esc(txt(S.combatOthers.d))}`;
  else if (!t) html += L('Mercantes y Armada se mueven…', 'Merchants and Navy are moving…');
  else if (t.pid === S.you) {
    html += `<span class="me-turn">${L('Tu turno', 'Your turn')}</span> <span class="pips">${Array.from({ length: S.reglas.actions }, (_, i) => `<i class="${i < t.actions ? '' : 'off'}"></i>`).join('')}</span><span class="long"> ${t.actions} ${L('acción(es)', 'action(s)')}</span>`;
    if (t.moving) html += ` · ${ICON('velas')} ${t.moving.mp}<span class="long"> ${L('de movimiento', 'movement')}</span>`;
  } else html += `${L('Turno de', 'Turn:')} <b>${esc(playerName(t.pid))}</b>`;
  const ms = t && remaining(t.deadlineIn);
  if (ms !== null && ms !== undefined && !S.combat) html += ` <span class="clock ${ms < 15000 ? 'low' : ''}" id="clock">${fmt(ms)}</span>`;
  $('status').innerHTML = html;
}

setInterval(() => {
  if (!S || S.phase !== 'juego') return;
  const c = $('clock');
  if (c && S.turn) {
    const ms = remaining(S.turn.deadlineIn);
    if (ms !== null) { c.textContent = fmt(ms); c.classList.toggle('low', ms < 15000); }
  }
  const cc = $('combatClock');
  if (cc && S.combat) cc.textContent = fmt(remaining(S.combat.deadlineIn) || 0);
  const oc = $('offerClock');
  if (oc && S.offer) oc.textContent = fmt(remaining(S.offer.deadlineIn) || 0);
}, 250);

// ------------------------------------------------------------ tablero

const isLandT = (c) => c && (c.t === 'tierra' || c.t === 'puerto');

// ------------------------------------------------------------ capa de mar y costa

// Mar, arrecifes y playa en un lienzo bajo las casillas. La playa es una franja calculada
// alrededor de toda la tierra conocida: rodea las esquinas y rellena los rincones de forma
// natural, en cualquier forma de isla. Los puertos solo aportan su lado de tierra.
const SEA_IMG = {};
for (const n of ['mar', 'arrecife', 'tierra']) {
  SEA_IMG[n] = new Image();
  SEA_IMG[n].onload = () => { seaKey = ''; if (S && S.map) drawSea(); };
  SEA_IMG[n].src = `img/${n}.webp`;
}
// Píxeles de la lámina de tierra, para asomar matas de vegetación sobre la arena.
let VEG = null;
function vegPixels() {
  if (VEG || !SEA_IMG.tierra.complete || !SEA_IMG.tierra.naturalWidth) return VEG;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const cx = c.getContext('2d');
  cx.drawImage(SEA_IMG.tierra, 0, 0, 256, 256);
  VEG = cx.getImageData(0, 0, 256, 256).data;
  return VEG;
}
// Color de vegetación en (fx, fy) casillas, o null si en ese punto la lámina es arena clara.
function vegAt(fx, fy) {
  const v = vegPixels();
  if (!v) return null;
  const x = Math.floor((((fx % 1) + 1) % 1) * 256);
  const y = Math.floor((((fy % 1) + 1) % 1) * 256);
  const i = (y * 256 + x) * 4;
  const r = v[i];
  const g = v[i + 1];
  const b = v[i + 2];
  return g > r + 6 && g > b ? [r, g, b] : null; // solo lo verde
}
const seaCanvas = document.createElement('canvas');
seaCanvas.className = 'sea-layer';
let seaKey = '';

// Ruido suave (valor interpolado) para bordes irregulares y grano de arena.
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi) + (hash2(xi + 1, yi) - hash2(xi, yi)) * sx;
  const b = hash2(xi, yi + 1) + (hash2(xi + 1, yi + 1) - hash2(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

// Islote de una casilla: tierra sin tierra vecina en cruz (y con sus vecinas ya descubiertas).
function isIslet(x, y) {
  const N = S.map.size;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) return true;
    const n = S.map.tiles[ny][nx];
    return n !== null && !isLandT(n);
  });
}

// Canto de la loseta de tierra fundido con la arena donde toca agua (la loseta sigue cuadrada).
function landFeather(x, y, isla) {
  const sea = (dx, dy) => {
    const n = S.map.tiles[y + dy] && S.map.tiles[y + dy][x + dx];
    return !!n && !(isLandT(n) && n.isla === isla);
  };
  const fades = [[0, -1, 'to bottom'], [0, 1, 'to top'], [-1, 0, 'to right'], [1, 0, 'to left']]
    .filter(([dx, dy]) => sea(dx, dy))
    .map(([, , to]) => `linear-gradient(${to}, transparent 0, #000 9%)`);
  if (!fades.length) return '';
  const m = fades.join(', ');
  return `-webkit-mask-image:${m};mask-image:${m};-webkit-mask-composite:source-in;mask-composite:intersect`;
}

// Puerto: igual que la tierra, pero la máscara va en el sistema de la lámina (antes de girarla).
// El lado del muelle (abajo en la lámina) no se toca.
function portFeather(x, y, isla, giro) {
  const turn = ([dx, dy]) => {
    let v = [dx, dy];
    for (let i = 0; i < giro / 90; i++) v = [-v[1], v[0]];
    return v;
  };
  const sea = ([dx, dy]) => {
    const n = S.map.tiles[y + dy] && S.map.tiles[y + dy][x + dx];
    return !!n && !(isLandT(n) && n.isla === isla);
  };
  const fades = [[[0, -1], 'to bottom'], [[-1, 0], 'to right'], [[1, 0], 'to left']]
    .filter(([dir]) => sea(turn(dir)))
    .map(([, to]) => `linear-gradient(${to}, transparent 0, #000 9%)`);
  if (!fades.length) return '';
  const m = fades.join(', ');
  return `-webkit-mask-image:${m};mask-image:${m};-webkit-mask-composite:source-in;mask-composite:intersect`;
}

// Rectángulos de tierra (en casillas). Islotes de una casilla: su lámina ya trae playa.
// Puertos: solo la franja del lado de tierra (la lámina tiene la tierra arriba, girada).
function landRects() {
  const N = S.map.size;
  const rects = [];
  const giro = new Map(S.map.ports.map((p) => [p.id, p.giro || 0]));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = S.map.tiles[y][x];
      if (!isLandT(c)) continue;
      // Islote: su vegetación es redonda, así que la playa se calcula desde un poco más adentro.
      if (c.t === 'tierra' && isIslet(x, y)) { rects.push([x, y, x + 1, y + 1, 'circulo']); continue; }
      if (c.t === 'puerto') {
        const g = giro.get(c.puerto) || 0;
        const d = 0.3; // la arena queda bajo la orilla de la propia lámina, nunca ante el muelle
        if (g === 0) rects.push([x, y, x + 1, y + d]);
        else if (g === 90) rects.push([x + 1 - d, y, x + 1, y + 1]);
        else if (g === 180) rects.push([x, y + 1 - d, x + 1, y + 1]);
        else rects.push([x, y, x + d, y + 1]);
      } else rects.push([x, y, x + 1, y + 1]);
    }
  }
  return rects;
}

function drawSea() {
  const N = S.map.size;
  const cell = $('board').clientWidth / N;
  if (!cell) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(cell * dpr);
  const key = `${px}|${S.map.tiles.map((r) => r.map((c) => (c ? c.t[0] + (c.isla ?? '') : '_')).join('')).join('/')}|${S.map.ports.map((p) => p.giro).join()}`;
  if (key === seaKey) return;
  seaKey = key;
  const W = px * N;
  seaCanvas.width = W;
  seaCanvas.height = W;
  const ctx = seaCanvas.getContext('2d');
  // Mar continuo (la lámina cubre 4 × 4 casillas).
  if (SEA_IMG.mar.complete && SEA_IMG.mar.naturalWidth) {
    const t = px * 4;
    for (let y = 0; y < W; y += t) for (let x = 0; x < W; x += t) ctx.drawImage(SEA_IMG.mar, x, y, t, t);
  } else {
    ctx.fillStyle = '#2b7896';
    ctx.fillRect(0, 0, W, W);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = S.map.tiles[y][x];
      if (c && c.t === 'arrecife' && SEA_IMG.arrecife.complete) ctx.drawImage(SEA_IMG.arrecife, x * px, y * px, px, px);
    }
  }
  // Lo no descubierto queda vacío: la niebla de pergamino lo cubre sin que asome el mar.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!S.map.tiles[y][x]) ctx.clearRect(x * px, y * px, px, px);
  // Playa, espuma y agua somera alrededor de la tierra.
  const rects = landRects();
  if (!rects.length) return;
  const REACH = 0.5; // hasta dónde llega el agua clara de la orilla (en casillas)
  const img = ctx.getImageData(0, 0, W, W);
  const d = img.data;
  const near = (tx, ty) => rects.filter((r) => r[0] <= tx + 2 && r[2] >= tx - 1 && r[1] <= ty + 2 && r[3] >= ty - 1);
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const c = S.map.tiles[ty][tx];
      if (!c) continue;
      const rs = near(tx, ty);
      if (!rs.length) continue;
      for (let py = ty * px; py < (ty + 1) * px; py++) {
        const fy = (py + 0.5) / px;
        for (let pxx = tx * px; pxx < (tx + 1) * px; pxx++) {
          const fx = (pxx + 0.5) / px;
          let dist = 9;
          for (const r of rs) {
            let dd;
            if (r[4] === 'circulo') {
              // Islote: orilla redonda y algo irregular alrededor del centro de la casilla.
              const ang = Math.atan2(fy - (r[1] + 0.5), fx - (r[0] + 0.5));
              const rad = 0.3 + 0.05 * vnoise(Math.cos(ang) * 2 + r[0] * 7, Math.sin(ang) * 2 + r[1] * 7);
              dd = Math.max(0, Math.hypot(fx - r[0] - 0.5, fy - r[1] - 0.5) - rad);
            } else {
              const dx = Math.max(r[0] - fx, 0, fx - r[2]);
              const dy = Math.max(r[1] - fy, 0, fy - r[3]);
              dd = Math.hypot(dx, dy);
            }
            if (dd < dist) dist = dd;
          }
          if (dist >= REACH) continue;
          const n1 = vnoise(fx * 3.2, fy * 3.2);
          const n2 = vnoise(fx * 9 + 7, fy * 9 + 3);
          const beach = 0.04 + 0.1 * n1 + 0.03 * n2; // ancho irregular de la arena (calas y salientes)
          const i = (py * W + pxx) * 4;
          let r0 = d[i];
          let g0 = d[i + 1];
          let b0 = d[i + 2];
          // Agua clara de orilla: más turquesa y luminosa cerca de la arena.
          const shallow = Math.max(0, 1 - (dist - beach) / (REACH - beach));
          if (dist > beach) {
            const k = 0.55 * shallow * shallow;
            r0 += (130 - r0) * k; g0 += (200 - g0) * k; b0 += (205 - b0) * k;
          }
          // Espuma junto a la arena.
          const foamW = 0.05 + 0.03 * n2;
          if (dist > beach && dist < beach + foamW) {
            const k = (1 - (dist - beach) / foamW) * (0.55 + 0.45 * vnoise(fx * 30, fy * 30));
            r0 += (250 - r0) * k; g0 += (252 - g0) * k; b0 += (245 - b0) * k;
          }
          // Arena: seca junto a la tierra, mojada hacia el agua, con grano.
          if (dist <= beach) {
            const wet = dist / beach;
            const grain = (hash2(pxx, py) - 0.5) * 18 + (n2 - 0.5) * 14;
            const sr = 228 - 40 * wet + grain;
            const sg = 207 - 34 * wet + grain;
            const sb = 158 - 20 * wet + grain * 0.8;
            const edge = Math.min(1, (beach - dist) * px / 1.5); // borde suavizado
            r0 += (sr - r0) * edge; g0 += (sg - g0) * edge; b0 += (sb - b0) * edge;
            // Matas que se asoman desde la isla sobre la arena seca.
            const reach = beach * (0.1 + 0.85 * vnoise(fx * 5 + 3, fy * 5 + 8)); // la vegetación invade la arena a trozos
            if (dist > 0 && dist < reach) {
              const vg = vegAt(fx, fy);
              if (vg) { r0 = vg[0]; g0 = vg[1]; b0 = vg[2]; }
            }
          }
          d[i] = r0; d[i + 1] = g0; d[i + 2] = b0;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Velo oscuro de lo que queda fuera de tu vista, de una sola pieza (sin costuras entre casillas).
const veilCanvas = document.createElement('canvas');
veilCanvas.className = 'veil-layer';
function drawVeil() {
  const N = S.map.size;
  const cell = $('board').clientWidth / N;
  if (!cell) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = cell * dpr;
  const W = Math.round(px * N);
  veilCanvas.width = W;
  veilCanvas.height = W;
  const ctx = veilCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  const me = S.me;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!S.map.tiles[y][x]) continue;
      if (Math.max(Math.abs(me.x - x), Math.abs(me.y - y)) <= S.reglas.terrainView) continue;
      const x0 = Math.round(x * px);
      const y0 = Math.round(y * px);
      ctx.fillRect(x0, y0, Math.round((x + 1) * px) - x0, Math.round((y + 1) * px) - y0);
    }
  }
}
addEventListener('resize', () => { if (S && S.map) { drawSea(); drawVeil(); } });

// ------------------------------------------------------------ zoom del mapa en el móvil

// Lupa de latón con mango de madera y un + o un − en el cristal.
function lens(sign) {
  const bar = '<path d="M14 21h12" stroke="#3b2414" stroke-width="3" stroke-linecap="round"/>';
  const vert = sign === '+' ? '<path d="M20 15v12" stroke="#3b2414" stroke-width="3" stroke-linecap="round"/>' : '';
  return `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
    <path d="M30 30l11 11" stroke="#5a2f12" stroke-width="7" stroke-linecap="round"/>
    <path d="M30 30l3.5 3.5" stroke="#c9952e" stroke-width="7.5" stroke-linecap="round"/>
    <circle cx="20" cy="21" r="14" fill="#e9f3f6" fill-opacity=".88" stroke="#b07d26" stroke-width="4.5"/>
    <circle cx="20" cy="21" r="11.6" fill="none" stroke="#e7bf5f" stroke-width="1.2"/>
    <path d="M12 15a10 10 0 0 1 6-4.5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".8"/>
    ${bar}${vert}
  </svg>`;
}

// En el móvil el mapa empieza acercado y centrado en tu barco; el botón alterna con el mapa entero.
const isMobile = () => matchMedia('(max-width: 900px)').matches;
let zoomed = true;
let centeredOn = '';
function applyZoom(force) {
  const on = isMobile() && zoomed && S && S.phase !== 'lobby';
  document.body.classList.toggle('zoomed', on);
  const btn = $('zoomBtn');
  btn.classList.toggle('hidden', !(isMobile() && S && S.phase !== 'lobby'));
  btn.innerHTML = lens(on ? '-' : '+');
  btn.title = on ? L('Ver el mapa entero', 'See the whole map') : L('Acercar a tu barco', 'Zoom to your ship');
  btn.setAttribute('aria-label', btn.title);
  if (!on || !S.me) { centeredOn = ''; return; }
  const key = `${S.me.x},${S.me.y}`;
  if (!force && key === centeredOn) return;
  centeredOn = key;
  const view = $('boardView');
  const cell = $('board').clientWidth / S.map.size;
  view.scrollTo({ left: (S.me.x + 0.5) * cell - view.clientWidth / 2, top: (S.me.y + 0.5) * cell - view.clientHeight / 2, behavior: force ? 'auto' : 'smooth' });
}
$('zoomBtn').onclick = () => {
  zoomed = !zoomed;
  seaKey = '';
  centeredOn = '';
  renderBoard();
  applyZoom(true);
};
addEventListener('resize', () => { if (S && S.map) applyZoom(true); });

function renderBoard() {
  const me = S.me;
  const N = S.map.size;
  const myTurn = S.turn && S.turn.pid === S.you && !S.combat && !S.offer;
  const reach = new Map(me.reach.map((r) => [`${r.x},${r.y}`, r]));
  const shipsAt = new Map();
  for (const s of S.ships) {
    const k = `${s.x},${s.y}`;
    if (!shipsAt.has(k)) shipsAt.set(k, []);
    shipsAt.get(k).push(s);
  }
  const targets = new Set(me.objetivos.filter((o) => o.canon || o.abordaje).map((o) => o.id));
  const portsById = new Map(S.map.ports.map((p) => [p.id, p]));
  const islandMarked = new Set();
  // Islas conocidas: tamaño y la casilla más interior (lleva la colina si la isla es grande).
  const islandCells = new Map();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = S.map.tiles[y][x];
      if (!isLandT(c)) continue;
      if (!islandCells.has(c.isla)) islandCells.set(c.isla, []);
      islandCells.get(c.isla).push([x, y]);
    }
  }
  const hill = new Map();
  const village = new Map();
  for (const [id, cells] of islandCells) {
    // En las islas con puerto, la tierra junto al puerto es un poblado.
    const port = cells.find(([x, y]) => S.map.tiles[y][x].t === 'puerto');
    if (port) {
      const land = cells.filter(([x, y]) => S.map.tiles[y][x].t === 'tierra')
        .sort((p, q) => Math.abs(p[0] - port[0]) + Math.abs(p[1] - port[1]) - Math.abs(q[0] - port[0]) - Math.abs(q[1] - port[1]))[0];
      if (land) village.set(id, `${land[0]},${land[1]}`);
      continue;
    }
    if (cells.length < 3) continue;
    const inner = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => cells.some(([a, b]) => a === x + dx && b === y + dy)).length;
    const best = cells.filter(([x, y]) => S.map.tiles[y][x].t === 'tierra').sort((p, q) => inner(...q) - inner(...p))[0];
    if (best) hill.set(id, `${best[0]},${best[1]}`);
  }
  let html = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = S.map.tiles[y][x];
      const k = `${x},${y}`;
      if (!c) {
        // Barcos a la vista sobre casillas aún no descubiertas (a 2 casillas): también se dibujan.
        let ships = '';
        for (const sh of shipsAt.get(k) || []) {
          ships += shipImg(sh, `ship ${facing(sh, 'left')}`);
          ships += `<span class="ship-badge" style="background:${sh.kind === 'pirata' ? sh.color : NEUTRAL_COLOR[sh.kind]}"></span>`;
        }
        html += `<div class="cell fog ${ships ? 'clickable' : ''}" style="--x:${x};--y:${y}" data-x="${x}" data-y="${y}">${ships}</div>`;
        continue;
      }
      const inView = Math.max(Math.abs(me.x - x), Math.abs(me.y - y)) <= S.reglas.terrainView;
      const cls = ['cell', c.t];
      if (!inView) cls.push('dim');
      if (isLandT(c) && c.t === 'tierra' && isIslet(x, y)) cls.push('islet');
      let inner = '';
      let clickable = false;
      if (isLandT(c)) {
        const solo = islandCells.get(c.isla).length === 1 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const n = S.map.tiles[y + dy] && S.map.tiles[y + dy][x + dx];
          return n === null && x + dx >= 0 && y + dy >= 0 && x + dx < N && y + dy < N;
        });
        if (c.t === 'puerto') {
          const giro = (portsById.get(c.puerto) || {}).giro || 0;
          inner += `<div class="land puerto" style="--port-img:url(img/puerto-${(c.puerto % 3) + 1}.webp);--rot:${giro}deg;${portFeather(x, y, c.isla, giro)}"></div>`;
        } else {
          const kind = solo ? ' solo' : village.get(c.isla) === k ? ' poblado' : hill.get(c.isla) === k ? ' colina' : '';
          inner += `<div class="land${kind}" style="${solo || kind ? '' : landFeather(x, y, c.isla)}"></div>`;
        }
        if (!islandMarked.has(c.isla)) {
          islandMarked.add(c.isla);
          if (S.map.explored.includes(c.isla)) inner += '<span class="mark" title="Isla explorada">✔️</span>';
        }
        if (me.explorables.includes(c.isla) && myTurn) clickable = true;
      }
      if (c.t === 'puerto') {
        const p = portsById.get(c.puerto);
        if (me.atracables.includes(c.puerto) && myTurn) clickable = true;
      }
      for (const s of shipsAt.get(k) || []) {
        const docked = s.kind === 'pirata' && s.docked !== null && s.docked !== undefined;
        // El barco propio mira a la derecha; todos los demás, a la izquierda.
        inner += shipImg(s, `ship ${docked ? 'docked' : ''} ${s.id === S.you ? 'me-ship' : ''} ${facing(s, s.id === S.you ? 'right' : 'left')}`);
        inner += `<span class="ship-badge" style="background:${s.kind === 'pirata' ? s.color : NEUTRAL_COLOR[s.kind]}"></span>`;
        if (targets.has(s.id) && myTurn) cls.push('target');
        if (s.id !== S.you) clickable = true;
      }
      const rc = myTurn && reach.get(k);
      if (rc) cls.push('reach');
      else if (clickable) cls.push('clickable');
      html += `<div class="${cls.join(' ')}" style="--x:${x};--y:${y}" data-x="${x}" data-y="${y}" ${rc ? `data-cost="${rc.coste}"` : ''}>${inner}</div>`;
    }
  }
  document.body.classList.toggle('zoomed', isMobile() && zoomed && S.phase !== 'lobby');
  $('board').innerHTML = html;
  $('board').prepend(seaCanvas);
  $('board').append(veilCanvas);
  drawSea();
  drawVeil();
  applyZoom(false);
}

$('board').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !S || S.phase !== 'juego') return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const me = S.me;
  const r = me.reach.find((v) => v.x === x && v.y === y);
  if (r && S.turn && S.turn.pid === S.you) return act('mover', { path: r.path });
  const ship = S.ships.find((s) => s.x === x && s.y === y && s.id !== S.you);
  if (ship) return showShipInfo(ship);
  const c = S.map.tiles[y][x];
  if (c && c.t === 'puerto' && me.atracables.includes(c.puerto)) return act('atracar', { port: c.puerto });
  if (c && isLandT(c) && me.explorables.includes(c.isla)) return act('explorar', { island: c.isla });
});

function showShipInfo(s) {
  ui.modal = 'barco';
  ui.modalId = s.id;
  renderModal();
}

// ------------------------------------------------------------ panel lateral

function statBar(cur, max) {
  const pct = max ? Math.round((cur / max) * 100) : 0;
  return `<div class="bar ${pct > 50 ? 'ok' : ''}"><i style="width:${pct}%"></i></div>`;
}

function shipLabel(s) {
  if (s.kind === 'pirata') return esc(s.name);
  return s.kind === 'mercante' ? `${L('Mercante', 'Merchant')} → ${LUGAR(s.destino)}` : L('Fragata de la Armada', 'Navy frigate');
}

// Arrastrar la ventana de acciones por su título (se queda donde la dejes, dentro del tablero).
function dragFloat(e, fl, key) {
  if (e.target.closest('button') || matchMedia('(max-width: 900px)').matches) return;
  const wrap = fl.parentElement.getBoundingClientRect();
  const box = fl.getBoundingClientRect();
  const dx = e.clientX - box.left;
  const dy = e.clientY - box.top;
  const move = (ev) => {
    const x = Math.max(0, Math.min(wrap.width - box.width, ev.clientX - wrap.left - dx));
    const y = Math.max(0, Math.min(wrap.height - box.height, ev.clientY - wrap.top - dy));
    ui[key] = { x, y };
    Object.assign(fl.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  e.preventDefault();
}

function renderPanel() {
  const me = S.me;
  if (!me) return;
  const R = S.reglas;
  const t = S.turn;
  const myTurn = t && t.pid === S.you && !S.combat && !S.offer && S.phase === 'juego';
  const port = me.docked !== null ? S.map.ports.find((p) => p.id === me.docked) : null;

  // Acciones contextuales.
  let acts = '';
  if (S.phase === 'fin') acts = `<button class="btn gold block" id="finalBtn">${L('Ver clasificación', 'See ranking')}</button>`;
  else if (!myTurn) {
    acts = `<p class="hint">${S.offer && S.offer.to === S.you ? L('Tienes una propuesta de comercio.', 'You have a trade offer.') : S.combat ? L('Combate en curso.', 'Fight in progress.') : t ? `${L('Esperando a', 'Waiting for')} ${esc(playerName(t.pid))}…` : L('Los barcos neutrales se mueven…', 'Neutral ships are moving…')}</p>`;
  } else {
    const noAct = t.actions <= 0;
    if (t.moving) {
      acts += `<p class="hint">${L(`Pulsa una casilla marcada para navegar (te quedan ${t.moving.mp} puntos). Los arrecifes cuestan 2.`, `Tap a marked tile to sail (${t.moving.mp} points left). Reefs cost 2.`)}</p>
        <button class="btn gold block" data-act="parar">${L('Detener el barco', 'Stop the ship')}</button>`;
    } else {
      acts += `<button class="btn gold block" data-act="navegar" ${noAct ? 'disabled' : ''}>${ICON('timon')} ${L('Navegar', 'Sail')} <span class="long">(${me.velas} ${L('casillas', 'tiles')})</span></button>`;
    }
    for (const id of me.atracables) {
      const p = S.map.ports.find((x) => x.id === id);
      acts += `<button class="btn gold block" data-dock="${id}">${L('Atracar', 'Dock')}<span class="long"> ${L('en', 'at')}</span> ${LUGAR(p ? p.name : L('el puerto', 'the port'))} <span class="long"> ${L('(gratis)', '(free)')}</span></button>`;
    }
    for (const id of me.explorables) acts += `<button class="btn gold block" data-explore="${id}" ${noAct ? 'disabled' : ''}>${ICON('catalejo', 'small')} ${L('Explorar la isla', 'Explore the island')}</button>`;
    if (port) acts += `<button class="btn gold block" id="portBtn">${L('Puerto', 'Port')}<span class="long"> ${L('de', 'of')}</span> ${LUGAR(port.name)}</button>`;
    else if (me.lastPort !== null && me.atracables.length === 0) {
      const near = S.map.ports.find((p) => p.id === me.lastPort && Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y)) === 1);
      if (near) acts += `<p class="hint">${L(`No puedes volver a ${esc(near.name)} hasta atracar en otro puerto.`, `You can't return to ${esc(near.name)} until you dock at another port.`)}</p>`;
    }
    acts += `<button class="btn flag-btn block" data-act="terminar">${L('Terminar turno', 'End turn')}</button>`;
  }

  // Rivales: los demás capitanes con sus logros; los que están a la vista se resaltan y
  // muestran su casco y lo que puedes hacer con ellos. Debajo, mercantes y Armada a la vista.
  const tgt = new Map(me.objetivos.map((o) => [o.id, o]));
  const can = myTurn && S.turn.actions > 0;
  const shipActions = (s) => {
    const o = tgt.get(s.id);
    const btns = [];
    if (o && o.canon) btns.push(`<button class="btn small red" data-atk="${s.id}" data-modo="canon" ${can ? '' : 'disabled'}>${ICON('canon')} ${L('Cañonear', 'Fire')}</button>`);
    if (o && o.abordaje) btns.push(`<button class="btn small red" data-atk="${s.id}" data-modo="abordaje" ${can ? '' : 'disabled'}>${ICON('sables')} ${L('Abordar', 'Board')}</button>`);
    if (o && o.comercio) btns.push(`<button class="btn small green" data-merchant="${s.id}" ${can ? '' : 'disabled'}>${ICON('balanza')} ${L('Comerciar', 'Trade')}</button>`);
    const adj = Math.max(Math.abs(s.x - me.x), Math.abs(s.y - me.y)) <= 1;
    if (s.kind === 'pirata' && adj) btns.push(`<button class="btn small green" data-deal="${s.id}" ${can ? '' : 'disabled'}>${ICON('balanza')} ${L('Trato', 'Deal')}</button>`);
    return btns.length ? `<div class="rival-acts">${btns.join('')}</div>` : '';
  };
  const turnOrder = S.order.map((id) => S.players.find((p) => p.id === id)).filter(Boolean);
  const seen = new Map(S.ships.filter((s) => s.id !== S.you).map((s) => [s.id, s]));
  const rivals = turnOrder.filter((p) => p.id !== S.you).map((p) => {
    const s = seen.get(p.id);
    const docked = s && s.docked !== null && s.docked !== undefined;
    return `<div class="rival ${s ? 'seen' : ''} ${t && t.pid === p.id ? 'turn' : ''}">
      <div class="rival-row">
        <span class="flag" style="background:${p.color}"></span>
        <span class="name" title="${esc(p.name)}">${esc(p.name)}${!p.bot && !p.connected ? ' 💤' : ''}</span>
        ${s ? `<span class="seen-tag" title="${L('A la vista', 'In sight')}">${ICON('catalejo', 'tiny')}</span><span class="hull" title="${L('Casco', 'Hull')}">${CASCO} ${s.casco}/${s.cascoMax}</span>` : ''}
        <b class="pts" title="${L('Logros', 'Achievements')}">${LEYENDA} ${p.pl}</b>
      </div>
      ${s ? `<div class="life">${statBar(s.casco, s.cascoMax)}</div>` : ''}
      ${docked ? `<div class="hint">${L('Atracado', 'Docked')}</div>` : ''}
      ${s ? shipActions(s) : ''}
    </div>`;
  }).join('');
  const neutrals = [...seen.values()].filter((s) => s.kind !== 'pirata').map((s) => `
    <div class="rival seen neutral">
      <div class="rival-row">
        <span class="name">${shipLabel(s)}</span>
        <span class="hull" title="Casco">${CASCO} ${s.casco}/${s.cascoMax}</span>
      </div>
      <div class="life">${statBar(s.casco, s.cascoMax)}</div>
      ${shipActions(s)}
    </div>`).join('');

  // Mercancías en una línea: solo icono y número (el nombre y el coste, al pasar el ratón).
  const goods = R.goods.map((g) => `<span class="chip good" title="${goodLabel(g)}${me.mercancias[g] ? ` · ${L('coste medio', 'average cost')} ${me.costes[g]}` : ''}"><b>${me.mercancias[g]}</b>${GOOD_ICON[g]}<small>${goodLabel(g)}</small></span>`).join('');

  const log = S.log.slice().reverse().map((l) => `<p>${esc(txt(l.text))}</p>`).join('');
  const chat = ui.chat.slice().reverse().map((m) => `<p><b style="color:${m.color}">${esc(m.from)}:</b> ${esc(m.text)}</p>`).join('') || `<p class="hint">${L('Aún no hay mensajes.', 'No messages yet.')}</p>`;
  const low = me.casco <= Math.ceil(me.cascoMax / 3);

  $('panel').innerHTML = `
    <div class="box parchment me-box">
      <div class="ship-head">
        ${shipImg({ kind: 'pirata', niveles: me.niveles, color: me.color }, facing({ kind: 'pirata' }, 'right'))}
        <div class="who-wrap">
          <div class="who-row">
            <div>
              <div class="who" style="color:${me.color}">${esc(me.name)}</div>
              <div class="life me-life" title="Casco ${me.casco}/${me.cascoMax}">${statBar(me.casco, me.cascoMax)}</div>
              <div class="hint">${port ? `${L('Atracado en', 'Docked at')} ${LUGAR(port.name)}` : L('En alta mar', 'At sea')}</div>
            </div>
            <div class="mine">
              <span>${LEYENDA} <b>${me.pl}</b> / ${R.winPL}</span>
              <span>${ORO} <b>${me.oro}</b> ${L('oros', 'gold')}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="attrs">
        ${[
          ['velas', `${me.velas}`, L('casillas por navegación', 'tiles per sail')],
          ['canones', `${me.canones}`, L('dados de cañón', 'cannon dice')],
          ['casco', `${me.casco}/${me.cascoMax}`, L('casco actual / máximo', 'current / max hull')],
          ['bodega', `${me.carga}/${me.bodega}`, 'carga / capacidad'],
          ['tripulacion', `${me.tripulacion}/${me.tripMax}`, L('marineros / máximo', 'sailors / max')],
        ].map(([a, v, what]) => `<div class="attr ${a === 'casco' && low ? 'low' : ''}" title="${attrLabel(a)}: ${what} · ${L('nivel', 'level')} ${ROMAN[me.niveles[a]]}">
          <b>${v}</b>${ATTR_ICON[a]}<span class="name">${attrLabel(a)}</span><span class="lv">${L('Nivel', 'Level')} ${ROMAN[me.niveles[a]]}</span></div>`).join('')}
      </div>
      <div class="cargo">
        <div class="chips goods-line">${goods}</div>
        <span class="chip profit" title="${L(`Beneficio comercial: próximo punto de logro al llegar a ${me.siguientePL}`, `Trade profit: next achievement point at ${me.siguientePL}`)}"><b>${me.netProfit}/${me.siguientePL}</b>${ORO}<small>${L('Beneficio', 'Profit')}</small></span>
      </div>
    </div>
    <div class="box parchment rivals-box"><h3>${L('Rivales', 'Rivals')}</h3><div class="rivals-list">${rivals}${neutrals}</div></div>
    <div class="log-buttons">
      <button class="btn block log-btn" data-open="cronica">${L('Crónica', 'Log')}</button>
      <button class="btn block log-btn" data-open="chat">Chat${ui.unread ? ` <span class="unread">${ui.unread}</span>` : ''}</button>
    </div>`;

  // Crónica o chat: ventana flotante con marco de madera.
  const lf = $('logFloat');
  const draft = $('chatInput') ? $('chatInput').value : '';
  const typing = document.activeElement && document.activeElement.id === 'chatInput';
  lf.classList.toggle('hidden', !ui.logOpen);
  if (ui.logOpen) {
    if (ui.logOpen === 'chat') ui.unread = 0;
    lf.innerHTML = `<div class="float-head"><h3>${ui.logOpen === 'chat' ? 'Chat' : L('Crónica', 'Log')}</h3><button class="float-toggle" id="logClose" title="${L('Cerrar', 'Close')}">×</button></div>
      <div class="log">${ui.logOpen === 'chat' ? chat : log}</div>
      ${ui.logOpen === 'chat' ? `<form class="chat-form" id="chatForm"><input class="input" id="chatInput" maxlength="200" placeholder="${L('Escribe a la tripulación…', 'Write to the crew…')}" autocomplete="off"><button class="btn small">${L('Enviar', 'Send')}</button></form>` : ''}`;
    if (ui.logPos) Object.assign(lf.style, { left: `${ui.logPos.x}px`, top: `${ui.logPos.y}px`, right: 'auto', bottom: 'auto' });
    lf.querySelector('.float-head').onpointerdown = (e) => dragFloat(e, lf, 'logPos');
    $('logClose').onclick = () => { ui.logOpen = null; renderPanel(); };
    if ($('chatInput')) {
      $('chatInput').value = draft;
      if (typing) $('chatInput').focus();
    }
  } else lf.innerHTML = '';

  // Acciones: ventana flotante sobre el tablero, solo cuando hay algo que hacer o mirar.
  const fl = $('actionsFloat');
  const showFloat = myTurn || S.phase === 'fin';
  fl.classList.toggle('hidden', !showFloat);
  fl.classList.toggle('collapsed', !!ui.actionsCollapsed && showFloat);
  // En el móvil la ventana va fija abajo: se deja sitio para poder llegar al final del panel.
  document.body.classList.toggle('float-open', showFloat && !ui.actionsCollapsed);
  document.body.classList.toggle('float-min', showFloat && !!ui.actionsCollapsed);
  fl.innerHTML = showFloat
    ? `<div class="float-head"><h3>${L('Acciones', 'Actions')}</h3><button class="float-toggle" id="floatToggle" title="${ui.actionsCollapsed ? L('Mostrar', 'Show') : L('Ocultar', 'Hide')}">${ui.actionsCollapsed ? '▴' : '▾'}</button></div><div class="actions">${acts}</div>`
    : '';
  if ($('floatToggle')) $('floatToggle').onclick = () => { ui.actionsCollapsed = !ui.actionsCollapsed; renderPanel(); };
  if (ui.floatPos) Object.assign(fl.style, { left: `${ui.floatPos.x}px`, top: `${ui.floatPos.y}px`, right: 'auto', bottom: 'auto' });
  const head = fl.querySelector('.float-head');
  if (head) head.onpointerdown = (e) => dragFloat(e, fl, 'floatPos');

  for (const P of [$('panel'), fl]) {
  P.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
  P.querySelectorAll('[data-dock]').forEach((b) => { b.onclick = () => act('atracar', { port: Number(b.dataset.dock) }); });
  P.querySelectorAll('[data-explore]').forEach((b) => { b.onclick = () => act('explorar', { island: Number(b.dataset.explore) }); });
  P.querySelectorAll('[data-atk]').forEach((b) => { b.onclick = () => act('atacar', { id: b.dataset.atk, modo: b.dataset.modo }); });
  P.querySelectorAll('[data-merchant]').forEach((b) => { b.onclick = () => openModal('mercante', b.dataset.merchant); });
  P.querySelectorAll('[data-deal]').forEach((b) => { b.onclick = () => openModal('trato', b.dataset.deal); });
  }
  const P = $('panel');
  P.querySelectorAll('[data-open]').forEach((b) => {
    b.onclick = () => { ui.logOpen = ui.logOpen === b.dataset.open ? null : b.dataset.open; renderPanel(); };
  });
  if ($('portBtn')) $('portBtn').onclick = () => openModal('puerto');
  if ($('finalBtn')) $('finalBtn').onclick = () => { ui.finalSeen = false; renderModal(); };
  if ($('chatForm')) {
    $('chatForm').onsubmit = (e) => {
      e.preventDefault();
      const text = $('chatInput').value.trim();
      if (text) socket.emit('chat', { text });
      $('chatInput').value = '';
    };
  }
}

// ------------------------------------------------------------ ventanas

function openModal(kind, id = null) {
  ui.modal = kind;
  ui.modalId = id;
  ui.qty = { vender: {}, comprar: {} };
  ui.repair = 1;
  ui.recruit = 1;
  ui.deal = { dar: { oro: 0, goods: {} }, pedir: { oro: 0, goods: {} } };
  renderModal();
}
function closeModal() {
  ui.modal = null;
  renderModal();
}

function stepper(name, value, min, max) {
  return `<span class="stepper"><button data-step="${name}" data-d="-1" ${value <= min ? 'disabled' : ''}>−</button><span>${value}</span><button data-step="${name}" data-d="1" ${value >= max ? 'disabled' : ''}>+</button></span>`;
}

// Tabla de compraventa (puerto o mercante).
function tradeTable(prices, stock, opts) {
  const me = S.me;
  const R = S.reglas;
  const q = ui.qty;
  let income = 0;
  let cost = 0;
  for (const g of R.goods) {
    income += (q.vender[g] || 0) * prices[g].vende;
    cost += (q.comprar[g] || 0) * prices[g].compra;
  }
  const load = me.carga - Object.values(q.vender).reduce((a, b) => a + b, 0) + Object.values(q.comprar).reduce((a, b) => a + b, 0);
  const rows = R.goods.map((g) => {
    const sellMax = opts.noResell && opts.noResell.includes(g) ? 0 : me.mercancias[g];
    const buyMax = stock ? stock[g] : 99;
    const canBuyMore = load < me.bodega && me.oro + income - cost >= prices[g].compra && !(q.vender[g] > 0);
    const canSellMore = !(q.comprar[g] > 0);
    return `<tr>
      <td>${GOOD_ICON[g]} ${goodLabel(g)}</td>
      <td>${me.mercancias[g]}${me.mercancias[g] ? ` <span class="muted">(${me.costes[g]})</span>` : ''}</td>
      <td><b>${prices[g].vende}</b></td>
      <td>${stepper(`vender.${g}`, q.vender[g] || 0, 0, canSellMore ? sellMax : (q.vender[g] || 0))}</td>
      <td><b>${prices[g].compra}</b>${stock ? ` <span class="muted">(${stock[g]})</span>` : ''}</td>
      <td>${stepper(`comprar.${g}`, q.comprar[g] || 0, 0, canBuyMore ? buyMax : (q.comprar[g] || 0))}</td>
    </tr>`;
  }).join('');
  const total = income - cost;
  return `
    <table class="trade">
      <tr><th>${L('Mercancía', 'Goods')}</th><th>${L('Tienes (coste)', 'You have (cost)')}</th><th>${L('Te paga', 'Pays you')}</th><th>${L('Vender', 'Sell')}</th><th>${L('Te cobra', 'Charges')}${stock ? L(' (lleva)', ' (carries)') : ''}</th><th>${L('Comprar', 'Buy')}</th></tr>
      ${rows}
    </table>
    <p class="summary">${L('Cobras', 'You get')} <b>${income}</b>, ${L('pagas', 'you pay')} <b>${cost}</b> → ${total >= 0 ? '+' : ''}<b>${total}</b> ${L('oros', 'gold')} · ${L('Bodega', 'Hold')} ${load}/${me.bodega}</p>
    ${opts.noResell && opts.noResell.length ? `<p class="hint">${L('Comprado en esta visita (no se puede revender aquí)', 'Bought on this visit (cannot be resold here)')}: ${opts.noResell.map((g) => goodLabel(g)).join(', ')}.</p>` : ''}
    <button class="btn gold block" id="doTrade" ${income || cost ? '' : 'disabled'}>${L('Comerciar (1 acción)', 'Trade (1 action)')}</button>`;
}

function renderModal() {
  const m = $('modal');
  if (S && S.phase === 'fin' && !ui.finalSeen && !ui.modal) return renderFinal();
  if (!ui.modal || !S) { m.classList.add('hidden'); m.innerHTML = ''; return; }
  let body = '';
  const me = S.me;
  const R = S.reglas;
  if (ui.modal === 'reglas') body = rulesHtml();
  else if (ui.modal === 'precios') body = pricesHtml();
  else if (ui.modal === 'barco') {
    const s = S.ships.find((x) => x.id === ui.modalId);
    if (!s) return closeModal();
    body = `<h2>${shipLabel(s)}</h2>
      <div class="ship-head">${shipImg(s, facing(s, 'left'))}<div>
        <div>${KIND_LABEL[s.kind]}</div>
        <div>${CASCO} ${L('Casco', 'Hull')} ${s.casco}/${s.cascoMax} · ${TRIP} ${L('Tripulación', 'Crew')} ${s.tripulacion}</div>
        ${s.kind === 'pirata' ? `<div>${R.attrs.map((a) => `${attrLabel(a)} ${ROMAN[s.niveles[a]]}`).join(' · ')}</div><div>${L('Carga', 'Cargo')}: ${s.carga} ${L('mercancías', 'goods')}</div>` : ''}
        ${s.kind === 'mercante' ? `<div>${L('Rumbo a', 'Bound for')} ${LUGAR(s.destino)} ${L('con', 'with')} ${s.carga} ${L('mercancías', 'goods')}</div>` : ''}
      </div></div>
      <p class="hint">${L('Usa los botones del panel Rivales para atacar o comerciar.', 'Use the buttons in the Rivals panel to attack or trade.')}</p>`;
  } else if (ui.modal === 'puerto') {
    const port = S.map.ports.find((p) => p.id === me.docked);
    if (!port) return closeModal();
    const tabs = [['comercio', `${ICON('balanza')} Comerciar`], ['mejoras', `${ICON('yunque')} Mejorar`], ['reparar', `${ICON('martillo')} Reparar`], ['reclutar', `${ICON('tripulacion')} Reclutar`]];
    let content = '';
    const hasAct = S.turn && S.turn.pid === S.you && S.turn.actions > 0;
    if (ui.portTab === 'comercio') content = tradeTable(port.precios, null, { noResell: me.compradoAqui });
    else if (ui.portTab === 'mejoras') {
      content = R.attrs.map((a) => {
        const l = me.niveles[a];
        const cost = l < 3 ? R.upgradeCost[a][l - 1] : null;
        return `<div class="up-row"><span>${ATTR_ICON[a]} <b>${attrLabel(a)}</b> ${ROMAN[l]} <span class="muted">(${R.levels[a][l - 1]}${l < 3 ? ` → ${R.levels[a][l]}` : ''})</span></span>
          <span>${cost !== null ? `${cost} ${L('oros', 'gold')}` : L('Máximo', 'Max')}</span>
          <button class="btn small gold" data-up="${a}" ${cost === null || me.oro < cost || !hasAct ? 'disabled' : ''}>${L('Mejorar a', 'Upgrade to')} ${ROMAN[l + 1] || '—'}</button></div>`;
      }).join('') + `<p class="hint">${L('Cada mejora cuesta 1 acción y es permanente, aunque te hundan.', 'Each upgrade costs 1 action and is permanent, even if you sink.')}</p>`;
    } else if (ui.portTab === 'reparar') {
      const max = Math.min(me.cascoMax - me.casco, Math.floor(me.oro / R.repair));
      ui.repair = Math.max(1, Math.min(ui.repair, max));
      content = max > 0
        ? `<p>${L('Casco', 'Hull')} ${me.casco}/${me.cascoMax}. ${L(`Cada punto cuesta ${R.repair} oro.`, `Each point costs ${R.repair} gold.`)}</p><p>${L('Reparar', 'Repair')} ${stepper('repair', ui.repair, 1, max)} ${L('punto(s)', 'point(s)')} → ${ui.repair * R.repair} ${L('oros', 'gold')}</p>
          <button class="btn gold block" id="doRepair" ${hasAct ? '' : 'disabled'}>${L('Reparar (1 acción)', 'Repair (1 action)')}</button>`
        : `<p>${me.casco >= me.cascoMax ? L('El casco está intacto.', 'The hull is intact.') : L('No tienes oro para reparar.', 'Not enough gold to repair.')}</p>`;
    } else {
      const max = Math.min(me.tripMax - me.tripulacion, Math.floor(me.oro / R.recruit));
      ui.recruit = Math.max(1, Math.min(ui.recruit, max));
      content = max > 0
        ? `<p>${L('Tripulación', 'Crew')} ${me.tripulacion}/${me.tripMax}. ${L(`Cada marinero cuesta ${R.recruit} oros.`, `Each sailor costs ${R.recruit} gold.`)}</p><p>${L('Reclutar', 'Recruit')} ${stepper('recruit', ui.recruit, 1, max)} → ${ui.recruit * R.recruit} ${L('oros', 'gold')}</p>
          <button class="btn gold block" id="doRecruit" ${hasAct ? '' : 'disabled'}>${L('Reclutar (1 acción)', 'Recruit (1 action)')}</button>`
        : `<p>${me.tripulacion >= me.tripMax ? L('Tu tripulación está completa.', 'Your crew is complete.') : L('No tienes oro para reclutar.', 'Not enough gold to recruit.')}</p>`;
    }
    body = `<h2>${LUGAR(port.name)}</h2>
      <p class="muted">${ORO} ${L('Oro', 'Gold')}: <b>${me.oro}</b> · ${L('Acciones', 'Actions')}: <b>${S.turn && S.turn.pid === S.you ? S.turn.actions : 0}</b></p>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-ptab="${k}" class="${ui.portTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${content}`;
  } else if (ui.modal === 'mercante') {
    const s = S.ships.find((x) => x.id === ui.modalId);
    if (!s || !s.precios) return closeModal();
    body = `<h2>${L('Mercante rumbo a', 'Merchant bound for')} ${LUGAR(s.destino)}</h2>
      <p class="muted">${L(`Comercia a los precios de ${esc(s.destino)}.`, `Trade at ${esc(s.destino)} prices.`)} ${ORO} ${L('Oro', 'Gold')}: <b>${me.oro}</b></p>
      ${tradeTable(s.precios, s.cargamento, {})}`;
  } else if (ui.modal === 'trato') {
    const other = S.ships.find((x) => x.id === ui.modalId);
    if (!other) return closeModal();
    const d = ui.deal;
    const side = (key, who, gold, goods) => `
      <div><h4>${who}</h4>
        <p>${ORO} ${L('Oro', 'Gold')} ${stepper(`${key}.oro`, d[key].oro, 0, gold)}</p>
        ${R.goods.map((g) => `<p>${GOOD_ICON[g]} ${goodLabel(g)} ${stepper(`${key}.goods.${g}`, d[key].goods[g] || 0, 0, goods ? goods[g] : 9)}</p>`).join('')}
      </div>`;
    body = `<h2>${L('Trato con', 'Deal with')} ${esc(other.name)}</h2>
      <div class="duel" style="grid-template-columns:1fr 1fr">
        ${side('dar', L('Tú das', 'You give'), me.oro, me.mercancias)}
        ${side('pedir', L('Tú pides', 'You ask'), 99, null)}
      </div>
      <p class="hint">${L(`Proponer cuesta 1 acción. ${esc(other.name)} tiene 20 segundos para aceptar. Los logros por comercio solo se ganan vendiendo en puertos o a mercantes.`, `Offering costs 1 action. ${esc(other.name)} has 20 seconds to accept. Trade achievements are only earned selling at ports or to merchants.`)}</p>
      <button class="btn gold block" id="doDeal">${L('Proponer trato (1 acción)', 'Offer deal (1 action)')}</button>`;
  }
  m.innerHTML = `<div class="dialog framed"><button class="close" id="closeModal" aria-label="${L('Cerrar', 'Close')}">×</button>${body}</div>`;
  m.classList.remove('hidden');
  bindModal();
}

function bindModal() {
  const m = $('modal');
  $('closeModal').onclick = closeModal;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  m.querySelectorAll('[data-ptab]').forEach((b) => { b.onclick = () => { ui.portTab = b.dataset.ptab; ui.qty = { vender: {}, comprar: {} }; renderModal(); }; });
  m.querySelectorAll('[data-step]').forEach((b) => {
    b.onclick = () => {
      const path = b.dataset.step.split('.');
      const d = Number(b.dataset.d);
      if (path[0] === 'repair') ui.repair += d;
      else if (path[0] === 'recruit') ui.recruit += d;
      else if (path[0] === 'vender' || path[0] === 'comprar') ui.qty[path[0]][path[1]] = Math.max(0, (ui.qty[path[0]][path[1]] || 0) + d);
      else if (path[1] === 'oro') ui.deal[path[0]].oro = Math.max(0, ui.deal[path[0]].oro + d);
      else ui.deal[path[0]].goods[path[2]] = Math.max(0, (ui.deal[path[0]].goods[path[2]] || 0) + d);
      renderModal();
    };
  });
  m.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => act('mejorar', { attr: b.dataset.up }); });
  if ($('doTrade')) {
    $('doTrade').onclick = () => {
      if (ui.modal === 'puerto') act('comerciar', { vender: ui.qty.vender, comprar: ui.qty.comprar });
      else act('mercante', { id: ui.modalId, vender: ui.qty.vender, comprar: ui.qty.comprar });
      ui.qty = { vender: {}, comprar: {} };
      if (ui.modal === 'mercante') closeModal();
    };
  }
  if ($('doRepair')) $('doRepair').onclick = () => act('reparar', { n: ui.repair });
  if ($('doRecruit')) $('doRecruit').onclick = () => act('reclutar', { n: ui.recruit });
  if ($('doDeal')) $('doDeal').onclick = () => { act('proponer', { to: ui.modalId, dar: ui.deal.dar, pedir: ui.deal.pedir }); closeModal(); };
  m.querySelectorAll('[data-again]').forEach((b) => { b.onclick = () => { saveSession(null); location.href = '/'; }; });
}

function pricesHtml() {
  const R = S.reglas;
  const ports = S.map.ports;
  if (!ports.length) return `<h2>${L('Precios', 'Prices')}</h2><p>${L('Todavía no has descubierto ningún puerto.', 'You have not discovered any port yet.')}</p>`;
  return `<h2>${L('Precios conocidos', 'Known prices')}</h2>
    <p class="hint">${L('«Paga» es lo que te da el puerto al venderle; «cobra», lo que te pide al comprarle. Las rutas rentables están en las diferencias.', '"Pays" is what the port gives you when you sell; "charges", what it asks when you buy. Profitable routes are in the differences.')}</p>
    <table class="trade"><tr><th>${L('Puerto', 'Port')}</th>${R.goods.map((g) => `<th>${GOOD_ICON[g]} ${goodLabel(g)}<br>${L('paga / cobra', 'pays / charges')}</th>`).join('')}</tr>
    ${ports.map((p) => `<tr><td><b>${LUGAR(p.name)}</b>${p.id === S.me.lastPort ? ` <span class="muted">${L('(último)', '(last)')}</span>` : ''}</td>${R.goods.map((g) => `<td>${p.precios[g].vende} / ${p.precios[g].compra}</td>`).join('')}</tr>`).join('')}
    </table>`;
}

function rulesHtml() {
  if (LANG === 'en') {
    return `<div class="rules"><h2>Pirates rules</h2>
    <p><b>Goal:</b> get 12 ${LEYENDA} Legend Points. The game ends when the round in which someone reaches 12 is completed, or after round 15. Whoever has the most points wins (tie-break: gold, then islands explored).</p>
    <h3>Your turn: 3 actions</h3>
    <ul>
      <li><b>Sail:</b> move as many tiles as your Sails (3/4/5), in 8 directions. Reefs cost 2. You cannot cross corners closed by land or tiles with ships at sea.</li>
      <li><b>Explore:</b> next to an island you have not explored. Treasure 25% (3–8 gold and +3 ${LEYENDA}), cargo 35%, danger 25% (1–2 damage) or nothing.</li>
      <li><b>Fire</b> (up to 2 tiles, with line of fire) or <b>Board</b> (next to the ship): starts a fight.</li>
      <li><b>In port:</b> trade, upgrade, repair (1 gold per point) and recruit (2 gold per sailor). Each one is 1 action.</li>
      <li><b>Docking</b> is free from a tile next to the port, but you cannot return to the last port visited until you dock at another one.</li>
      <li><b>Trade</b> with a merchant or offer a deal to another pirate next to you.</li>
    </ul>
    <h3>Fights</h3>
    <p>Up to 3 rounds. In each one, both captains secretly choose <b>Fire</b>, <b>Board</b> or <b>Maneuver</b> (once per fight). Each 5 or 6 on the dice is a success.</p>
    <ul>
      <li>Fire: each success deals 1 damage. Maneuver cancels 1 hit and gives <b>advantage</b> (+1 die on your next attack roll).</li>
      <li>Board: crew against crew; ties favour the defender. The winner captures up to 2 goods and the other loses a sailor. If you fire at whoever boards you, you shoot first.</li>
      <li>If you are sunk, you lose half your cargo (taken by whoever sank you if a pirate) and return to your home port repaired.</li>
    </ul>
    <h3>Legend Points</h3>
    <ul><li>Treasure: +3 ${LEYENDA} · Sink a merchant: +1 ${LEYENDA} · Sink a pirate: +2 ${LEYENDA} · Sink a frigate: +3 ${LEYENDA}</li>
    <li>Every 4 gold of accumulated net trade profit (sale − purchase cost): +1 ${LEYENDA}</li></ul>
    <h3>The sea</h3>
    <p>You see the terrain 3 × 3 around your ship and ships up to 2 tiles away. Merchants sail between ports and the Navy patrols and attacks the pirates it sees. You have 90 s per turn and 20 s to choose a maneuver.</p>
    <h3>Same device</h3>
    <p>In the room you can add players who play on this same device: when it is their turn, the game asks you to hand them the device.</p>
  </div>`;
  }
  return `<div class="rules"><h2>Reglas de Piratas</h2>
    <p><b>Objetivo:</b> conseguir 12 ${LEYENDA} Puntos de Leyenda. La partida termina al completar la ronda en que alguien llega a 12, o tras la ronda 15. Gana quien más puntos tenga (desempate: oro, luego islas exploradas).</p>
    <h3>Tu turno: 3 acciones</h3>
    <ul>
      <li><b>Navegar:</b> mueve tantas casillas como tus Velas (3/4/5), en 8 direcciones. Los arrecifes cuestan 2. No se cruzan esquinas cerradas por tierra ni casillas con barcos en el mar.</li>
      <li><b>Explorar:</b> junto a una isla que no hayas explorado. Tesoro 25 % (3–8 oros y +3 ${LEYENDA}), mercancías 35 %, peligro 25 % (1–2 de daño) o nada.</li>
      <li><b>Cañonear</b> (hasta 2 casillas, con línea de tiro) o <b>Abordar</b> (junto al barco): empieza un combate.</li>
      <li><b>En puerto:</b> comerciar, mejorar, reparar (1 oro por punto) y reclutar (2 oros por marinero). Cada una es 1 acción.</li>
      <li><b>Atracar</b> es gratis desde una casilla vecina al puerto, pero no puedes volver al último puerto visitado hasta atracar en otro.</li>
      <li><b>Comerciar</b> con un mercante o proponer un trato a otro pirata junto a ti.</li>
    </ul>
    <h3>Combate</h3>
    <p>Hasta 3 asaltos. En cada uno, los dos capitanes eligen a la vez <b>Cañonear</b>, <b>Abordar</b> o <b>Maniobrar</b> (una vez por combate). Cada 5 o 6 en los dados es un éxito.</p>
    <ul>
      <li>Cañonear: cada éxito hace 1 de daño. Maniobrar anula 1 impacto y da <b>ventaja</b> (+1 dado en tu próxima tirada ofensiva).</li>
      <li>Abordar: tripulación contra tripulación; el empate favorece al defensor. Quien gana captura hasta 2 mercancías y el otro pierde un marinero. Si cañoneas a quien te aborda, disparas primero.</li>
      <li>Si te hunden, pierdes la mitad de la carga (se la lleva quien te hundió si es pirata) y vuelves a tu puerto de origen reparado.</li>
    </ul>
    <h3>Puntos de Leyenda</h3>
    <ul><li>Tesoro: +3 ${LEYENDA} · Hundir mercante: +1 ${LEYENDA} · Hundir pirata: +2 ${LEYENDA} · Hundir fragata: +3 ${LEYENDA}</li>
    <li>Cada 4 oros de beneficio comercial neto acumulado (venta − coste de compra): +1 ${LEYENDA}</li></ul>
    <h3>Mar</h3>
    <p>Ves el terreno en 3 × 3 alrededor de tu barco y los barcos hasta 2 casillas. Los mercantes viajan entre puertos y la Armada patrulla y ataca a los piratas que ve. Tienes 90 s por turno y 20 s para elegir maniobra.</p>
    <h3>Mismo dispositivo</h3>
    <p>En la sala puedes añadir jugadores que juegan en este mismo dispositivo: cuando les toca, el juego te pide que les pases el dispositivo.</p>
  </div>`;
}

function renderFinal() {
  const m = $('modal');
  const f = S.final;
  const win = f.winners.includes(S.you);
  m.innerHTML = `<div class="dialog framed">
    <button class="close" id="closeModal" aria-label="${L('Cerrar', 'Close')}">×</button>
    <p class="winner-title">${win ? L('¡Eres una leyenda!', 'You are a legend!') : `${L('Gana', 'Winner:')} ${f.winners.map(playerName).map(esc).join(L(' y ', ' and '))}`}</p>
    <table class="final-table"><tr><th>#</th><th>${L('Pirata', 'Pirate')}</th><th>${LEYENDA}</th><th>${L('Oro', 'Gold')}</th><th>${L('Islas', 'Islands')}</th></tr>
      ${f.ranking.map((r, i) => `<tr><td>${i + 1}</td><td><span class="flag" style="background:${r.color};display:inline-block"></span> ${esc(r.name)}</td><td><b>${r.pl}</b></td><td>${r.oro}</td><td>${r.islas}</td></tr>`).join('')}
    </table>
    <button class="btn gold block" data-again>${L('Nueva partida', 'New game')}</button>
  </div>`;
  m.classList.remove('hidden');
  $('closeModal').onclick = () => { ui.finalSeen = true; m.classList.add('hidden'); };
  m.querySelectorAll('[data-again]').forEach((b) => { b.onclick = () => { saveSession(null); location.href = '/'; }; });
}

// ------------------------------------------------------------ combate y propuestas

function diceHtml(t, fresh) {
  if (!t) return '';
  return `<span class="dice">${t.dados.map((v) => `<span class="die ${v >= 5 ? 'hit' : ''} ${fresh ? 'roll' : ''}">${v}</span>`).join('')}</span>`;
}

function fighter(s, side, c, right) {
  if (!s) return `<div class="fighter ${right ? 'right' : ''}"><div class="fname">${esc(txt((c.nombres || {})[side]) || L('Hundido', 'Sunk'))}</div><p>☠ ${L('Hundido', 'Sunk')}</p></div>`;
  const raw = LANG === 'en' && s.nameEn ? s.nameEn : s.name;
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `<div class="fighter ${right ? 'right' : ''}">
    ${shipImg(s, facing(s, right ? 'left' : 'right'))}
    <div class="fname" ${s.color ? `style="color:${s.color}"` : ''}>${esc(name)}${side === c.yo ? L(' (tú)', ' (you)') : ''}</div>
    <div>${CASCO} ${s.casco}/${s.cascoMax}</div>${statBar(s.casco, s.cascoMax)}
    <div>🎯 ${s.canones} ${L('dados', 'dice')} · ${TRIP} ${s.tripulacion}</div>
    <div class="badges">${c.ventaja[side] ? `<span class="badge adv">${L('Ventaja +1', 'Advantage +1')}</span>` : ''}${c.maniobro[side] ? `<span class="badge">${L('Ya maniobró', 'Already maneuvered')}</span>` : ''}</div>
  </div>`;
}

function renderCombat() {
  const box = $('combat');
  if (!S || S.phase === 'lobby') { box.classList.add('hidden'); return; }
  const live = S.combat;
  const done = !live && S.me && S.me.ultimoCombate && S.me.ultimoCombate.id !== ui.combatSeen ? S.me.ultimoCombate : null;
  const offer = !live && S.offer && S.offer.to === S.you ? S.offer : null;
  if (offer) {
    const R = S.reglas;
    const list = (part) => [part.oro ? `${ORO} ${part.oro} ${L('oros', 'gold')}` : '', ...R.goods.filter((g) => part.goods[g]).map((g) => `${GOOD_ICON[g]} ${part.goods[g]} ${goodLabel(g).toLowerCase()}`)].filter(Boolean).join(', ') || L('nada', 'nothing');
    box.innerHTML = `<div class="dialog framed">
      <h2>${L('Propuesta de', 'Offer from')} ${esc(offer.fromName)}</h2>
      <p>${L('Te da', 'Gives you')}: <b>${list(offer.dar)}</b></p>
      <p>${L('Te pide', 'Asks for')}: <b>${list(offer.pedir)}</b></p>
      <p class="waiting">${L('Tienes', 'You have')} <span id="offerClock">${fmt(remaining(offer.deadlineIn))}</span> ${L('para responder.', 'to answer.')}</p>
      <div class="row"><button class="btn green" style="flex:1" id="acceptBtn">${L('Aceptar', 'Accept')}</button><button class="btn red" style="flex:1" id="rejectBtn">${L('Rechazar', 'Reject')}</button></div>
    </div>`;
    box.classList.remove('hidden');
    $('acceptBtn').onclick = () => act('responder', { aceptar: true });
    $('rejectBtn').onclick = () => act('responder', { aceptar: false });
    return;
  }
  const c = live || done;
  if (!c) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const ICON = { canon: '<img class="choice-ico" src="img/canon.webp" alt="">', abordaje: '<img class="choice-ico" src="img/sables.webp" alt="">', maniobra: '🌀' };
  const DESC = {
    canon: `Dispara ${c[c.yo].canones + (c.ventaja[c.yo] ? 1 : 0)} dados`,
    abordaje: L(`Lucha con ${c[c.yo].tripulacion + (c.ventaja[c.yo] ? 1 : 0)} dados de tripulación`, `Fight with ${c[c.yo].tripulacion + (c.ventaja[c.yo] ? 1 : 0)} crew dice`),
    maniobra: L('Esquiva 1 impacto o evita el abordaje y gana ventaja', 'Dodge 1 hit or avoid boarding and gain advantage'),
  };
  let choose = '';
  if (live && !c.eligio) {
    choose = `<p class="center"><b>${L('Elige tu maniobra', 'Choose your maneuver')}</b> · <span id="combatClock">${fmt(remaining(c.deadlineIn) || 0)}</span></p>
      <div class="choices">${['canon', 'abordaje', 'maniobra'].map((k) => `
        <button class="btn choice ${k === 'canon' ? 'red' : k === 'abordaje' ? 'gold' : 'green'}" data-pick="${k}" ${c.opciones.includes(k) ? '' : 'disabled'}>
          <span class="big-ico">${ICON[k]}</span><b>${PICK_LABEL[k]}</b><small>${DESC[k]}</small></button>`).join('')}</div>`;
  } else if (live) {
    choose = `<p class="waiting">${L('Esperando la decisión del rival…', 'Waiting for the rival\'s decision…')} <span id="combatClock">${fmt(remaining(c.deadlineIn) || 0)}</span></p>`;
  }
  let result = '';
  if (done) {
    const sunk = c.fin.hundidos || [];
    const end = c.fin.motivo === 'abordaje' ? L('El combate termina con un abordaje.', 'The fight ends with a boarding.')
      : c.fin.motivo === 'hundimiento' ? (sunk.includes(S.you) ? L('☠ Tu barco se ha hundido.', '☠ Your ship has sunk.') : L('☠ ¡Barco enemigo hundido!', '☠ Enemy ship sunk!'))
        : L('Tras tres asaltos, ningún barco se impone.', 'After three rounds, neither ship prevails.');
    result = `<p class="winner-title" style="font-size:30px">${end}</p><button class="btn gold block" id="combatClose">${L('Continuar', 'Continue')}</button>`;
  }
  const hist = c.historial.slice().reverse().map((r, i) => {
    const fresh = i === 0;
    const line = ['a', 'd'].map((sd) => {
      const n = sd === c.yo ? L('Tú', 'You') : esc((c[sd] && (LANG === 'en' && c[sd].nameEn ? c[sd].nameEn : c[sd].name)) || txt((c.nombres || {})[sd]) || '');
      const t = r.tiradas[sd] || r.tiradas[`${sd}Abordaje`];
      return `${n}: <b>${PICK_LABEL[r.picks[sd]]}</b>${diceHtml(r.tiradas[sd], fresh)}${r.tiradas[`${sd}Abordaje`] ? diceHtml(r.tiradas[`${sd}Abordaje`], fresh) : ''}${t ? '' : ''}`;
    }).join(' · ');
    return `<div class="round-log"><b>${L('Asalto', 'Round')} ${r.ronda}</b> — ${line}<br>${esc(r.texto.map(txt).join(' '))}</div>`;
  }).join('');
  box.innerHTML = `<div class="dialog framed">
    <h2>⚔ ${L('Combate', 'Fight')} · ${L('Asalto', 'Round')} ${Math.min(c.ronda, 3)} ${L('de', 'of')} 3</h2>
    <div class="duel">${fighter(c.a, 'a', c, false)}<div class="vs">VS</div>${fighter(c.d, 'd', c, true)}</div>
    ${choose}${result}
    <div class="history">${hist}</div>
  </div>`;
  box.classList.remove('hidden');
  box.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => act('maniobra', { eleccion: b.dataset.pick }); });
  if ($('combatClose')) $('combatClose').onclick = () => { ui.combatSeen = c.id; renderCombat(); };
}
