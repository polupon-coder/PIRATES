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

// code -> { game, tokens: Map(token -> playerId), sockets: Map(playerId -> Set(socket)), botTimer, touched }
const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcast(room) {
  room.touched = Date.now();
  const g = room.game;
  for (const [pid, set] of room.sockets) {
    if (!g.player(pid)) continue;
    const view = g.view(pid);
    for (const s of set) s.emit('state', view);
  }
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
  socket.data.room = room.game.code;
  socket.data.playerId = pid;
  socket.data.token = token;
  socket.join(room.game.code);
  if (!room.sockets.has(pid)) room.sockets.set(pid, new Set());
  room.sockets.get(pid).add(socket);
  const p = room.game.player(pid);
  if (p) p.connected = true;
}

io.on('connection', (socket) => {
  const reply = (cb, payload) => typeof cb === 'function' && cb(payload);

  socket.on('create', ({ name } = {}, cb) => {
    const code = newCode();
    const room = { game: new Game(code), tokens: new Map(), sockets: new Map(), botTimer: null, touched: Date.now() };
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
      for (const s of set) s.emit('kicked');
      room.sockets.delete(pid);
    }
    broadcast(room);
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
    const set = room.sockets.get(socket.data.playerId);
    if (set) {
      set.delete(socket);
      const p = room.game.player(socket.data.playerId);
      if (!set.size && p) p.connected = false;
    }
    broadcast(room);
  });
});

// Plazos (turnos de 90 s, maniobras y propuestas de 20 s) y limpieza de salas viejas.
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
