'use strict';

// PIRATAS — servidor web y salas en tiempo real (Socket.IO).

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const { botStep } = require('./bot');

const PORT = process.env.PORT || 3000;
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS || 450);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // salas inactivas se borran a las 6 h

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Siempre se revalida con el servidor (ETag): tras cada despliegue se ven las ilustraciones nuevas.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/healthz', (req, res) => res.send('ok'));

// code -> { game, tokens: Map(token -> playerId), local: Map(token -> [playerId]) (jugadores extra del
// mismo dispositivo), sockets: Map(playerId -> Set(socket)), botTimer, touched }
const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Cada conexión recibe la vista de su jugador activo y, si en ese dispositivo juegan varios,
// la lista de todos ellos y si alguno tiene que hacer algo.
function sendState(room, s) {
  const g = room.game;
  const mine = [...(s.data.players || [])].filter((id) => g.player(id));
  if (!mine.length) return;
  if (!mine.includes(s.data.playerId)) s.data.playerId = mine[0];
  const view = g.view(s.data.playerId);
  view.local = mine.length > 1 ? mine.map((id) => ({ id, name: g.player(id).name, color: g.player(id).color, needs: g.needsAction(id) })) : null;
  s.emit('state', view);
}

function broadcast(room) {
  room.touched = Date.now();
  const all = new Set();
  for (const set of room.sockets.values()) for (const s of set) all.add(s);
  for (const s of all) sendState(room, s);
  scheduleBots(room);
}

function scheduleBots(room) {
  if (room.botTimer) return;
  const g = room.game;
  if (g.phase !== 'juego' || !g.players.some((p) => p.bot)) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    let acted = false;
    for (const p of g.players) {
      if (!p.bot) continue;
      try {
        acted = botStep(g, p) || acted;
      } catch (e) {
        console.error('Error de bot', e);
      }
      if (acted) break;
    }
    if (acted) broadcast(room);
  }, BOT_DELAY_MS);
}

function attach(room, socket, pid, token) {
  const ids = [pid, ...((token && room.local.get(token)) || [])];
  socket.data.room = room.game.code;
  socket.data.playerId = pid;
  socket.data.players = new Set(ids);
  socket.data.token = token;
  socket.join(room.game.code);
  for (const id of ids) {
    if (!room.sockets.has(id)) room.sockets.set(id, new Set());
    room.sockets.get(id).add(socket);
    const p = room.game.player(id);
    if (p) p.connected = true;
  }
}

io.on('connection', (socket) => {
  const reply = (cb, payload) => typeof cb === 'function' && cb(payload);

  socket.on('create', ({ name } = {}, cb) => {
    const code = newCode();
    const room = { game: new Game(code), tokens: new Map(), local: new Map(), sockets: new Map(), botTimer: null, touched: Date.now() };
    rooms.set(code, room);
    const p = room.game.addPlayer(name);
    const token = crypto.randomUUID();
    room.tokens.set(token, p.id);
    attach(room, socket, p.id, token);
    reply(cb, { ok: true, code, token });
    broadcast(room);
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return reply(cb, { ok: false, error: 'No existe ninguna sala con ese código' });
    let pid = token && room.tokens.get(token);
    if (pid && !room.game.player(pid)) pid = null;
    if (!pid) {
      try {
        pid = room.game.addPlayer(name).id;
        token = crypto.randomUUID();
        room.tokens.set(token, pid);
      } catch (e) {
        return reply(cb, { ok: false, error: e.message });
      }
    }
    attach(room, socket, pid, token);
    reply(cb, { ok: true, code: room.game.code, token });
    broadcast(room);
  });

  socket.on('act', ({ type, data } = {}, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room) return reply(cb, { ok: false, error: 'No estás en ninguna sala' });
    try {
      room.game.act(socket.data.playerId, type, data);
      reply(cb, { ok: true });
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Error interno' });
    }
    for (const [pid, set] of room.sockets) {
      if (room.game.player(pid)) continue;
      for (const s of set) {
        s.data.players.delete(pid);
        if (!s.data.players.size) s.emit('kicked');
      }
      room.sockets.delete(pid);
      for (const [tok, list] of room.local) room.local.set(tok, list.filter((x) => x !== pid));
    }
    broadcast(room);
  });

  // Otro jugador en este mismo dispositivo (se pasan la pantalla por turnos).
  socket.on('addLocal', ({ name } = {}, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || !socket.data.token) return reply(cb, { ok: false, error: 'No estás en ninguna sala' });
    try {
      const p = room.game.addPlayer(name);
      p.local = true;
      p.connected = true;
      const list = room.local.get(socket.data.token) || [];
      list.push(p.id);
      room.local.set(socket.data.token, list);
      const primary = room.tokens.get(socket.data.token);
      for (const s of room.sockets.get(primary) || []) {
        s.data.players.add(p.id);
        if (!room.sockets.has(p.id)) room.sockets.set(p.id, new Set());
        room.sockets.get(p.id).add(s);
      }
      reply(cb, { ok: true });
    } catch (e) {
      reply(cb, { ok: false, error: e.message });
    }
    broadcast(room);
  });

  // Cambiar el jugador activo de este dispositivo.
  socket.on('setActive', ({ playerId } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || !socket.data.players || !socket.data.players.has(playerId)) return;
    socket.data.playerId = playerId;
    sendState(room, socket);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = rooms.get(socket.data.room);
    const p = room && room.game.player(socket.data.playerId);
    const msg = String(text || '').trim().slice(0, 200);
    if (!p || !msg) return;
    io.to(room.game.code).emit('chat', { from: p.name, color: p.color, text: msg });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    for (const id of socket.data.players || []) {
      const set = room.sockets.get(id);
      if (!set) continue;
      set.delete(socket);
      const p = room.game.player(id);
      if (!set.size && p) p.connected = false;
    }
    broadcast(room);
  });
});

// Plazos (maniobras y propuestas de 20 s) y limpieza de salas viejas.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_TTL_MS) {
      clearTimeout(room.botTimer);
      rooms.delete(code);
      continue;
    }
    try {
      if (room.game.tick()) broadcast(room);
    } catch (e) {
      console.error('Error en el reloj', e);
    }
  }
}, 1000).unref();

server.listen(PORT, () => {
  console.log(`PIRATAS escuchando en http://localhost:${PORT}`);
});
