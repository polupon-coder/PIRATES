'use strict';

// Mapa: generación aleatoria del archipiélago, movimiento en 8 direcciones,
// distancias por mar y línea de tiro.

const C = require('./config');

const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const isNav = (t) => t === 'mar' || t === 'arrecife';
const isLand = (t) => t === 'tierra' || t === 'puerto';
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const key = (x, y) => `${x},${y}`;

function randInt(rng, a, b) {
  return a + Math.floor(rng() * (b - a + 1));
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class GameMap {
  constructor(size) {
    this.size = size;
    this.tiles = Array.from({ length: size }, () => Array(size).fill('mar'));
    this.island = Array.from({ length: size }, () => Array(size).fill(-1));
    this.islands = []; // [{ id, cells: [[x, y]], port }]
    this.ports = []; // [{ id, name, x, y, island, prices }]
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  t(x, y) {
    return this.inside(x, y) ? this.tiles[y][x] : null;
  }

  // ¿Se puede pasar de (fx,fy) a (tx,ty) en un paso? Sin cruzar una esquina cerrada por tierra.
  canStep(fx, fy, tx, ty) {
    if (!this.inside(tx, ty) || cheb(fx, fy, tx, ty) !== 1 || !isNav(this.t(tx, ty))) return false;
    if (fx !== tx && fy !== ty && isLand(this.t(fx, ty)) && isLand(this.t(tx, fy))) return false;
    return true;
  }

  stepCost(x, y) {
    return this.t(x, y) === 'arrecife' ? 2 : 1;
  }

  portAt(x, y) {
    return this.ports.find((p) => p.x === x && p.y === y) || null;
  }

  // Casillas de mar junto a un puerto (desde las que se atraca y por las que se sale).
  portExits(port) {
    return DIRS.map(([dx, dy]) => [port.x + dx, port.y + dy]).filter(([x, y]) => isNav(this.t(x, y)));
  }

  // Distancias en pasos por mar desde varias casillas de mar (sin coste de arrecife).
  seaDistances(starts, blocked) {
    const dist = new Map();
    const queue = [];
    for (const [x, y] of starts) {
      if (!isNav(this.t(x, y))) continue;
      dist.set(key(x, y), 0);
      queue.push([x, y]);
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      const d = dist.get(key(x, y));
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (dist.has(key(nx, ny)) || !this.canStep(x, y, nx, ny)) continue;
        if (blocked && blocked(nx, ny)) continue;
        dist.set(key(nx, ny), d + 1);
        queue.push([nx, ny]);
      }
    }
    return dist;
  }

  // Distancia entre dos puertos contando casillas: salir, navegar y entrar.
  portDistance(a, b) {
    const dist = this.seaDistances(this.portExits(a));
    let best = Infinity;
    for (const [x, y] of this.portExits(b)) {
      const d = dist.get(key(x, y));
      if (d !== undefined) best = Math.min(best, d + 2);
    }
    return best;
  }

  // Línea de tiro despejada hasta distancia 2. La tierra la bloquea; los barcos, no.
  lineOfSight(ax, ay, bx, by) {
    const d = cheb(ax, ay, bx, by);
    if (d > C.CANNON_RANGE) return false;
    if (d <= 1) return true;
    const dx = bx - ax;
    const dy = by - ay;
    const mids = [];
    if (Math.abs(dx) !== 1 && Math.abs(dy) !== 1) mids.push([ax + dx / 2, ay + dy / 2]);
    else if (Math.abs(dx) === 2) mids.push([ax + dx / 2, ay], [ax + dx / 2, by]);
    else mids.push([ax, ay + dy / 2], [bx, ay + dy / 2]);
    return mids.some(([x, y]) => !isLand(this.t(x, y)));
  }

  // Islas cuyo terreno toca (incluidas diagonales) la casilla (x, y).
  islandsAround(x, y) {
    const ids = new Set();
    for (const [dx, dy] of DIRS) {
      const id = this.inside(x + dx, y + dy) ? this.island[y + dy][x + dx] : -1;
      if (id >= 0) ids.add(id);
    }
    return [...ids];
  }

  // Todo el mar conectado respetando las esquinas.
  seaConnected() {
    const sea = [];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (isNav(this.tiles[y][x])) sea.push([x, y]);
    if (!sea.length) return false;
    return this.seaDistances([sea[0]]).size === sea.length;
  }
}

function pickWeighted(rng, pairs) {
  let r = rng();
  for (const [v, p] of pairs) {
    r -= p;
    if (r < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

function makePrices(rng) {
  const prices = {};
  for (const g of C.GOODS) {
    const sell = Math.max(1, C.GOOD_VALUE[g] + randInt(rng, C.PRICE_VAR[0], C.PRICE_VAR[1]));
    prices[g] = { vende: sell, compra: sell + C.PRICE_SPREAD }; // vende = lo que paga el puerto
  }
  return prices;
}

function tryGenerate(rng, nPlayers) {
  const S = C.SIZE;
  const m = new GameMap(S);
  const nIslands = randInt(rng, C.ISLANDS[0], C.ISLANDS[1]);
  // Una casilla puede ser de la isla k si no toca (ni en diagonal) tierra de otra isla.
  const free = (x, y, k) => {
    if (!m.inside(x, y) || m.island[y][x] >= 0) return false;
    for (const [dx, dy] of DIRS) {
      const id = m.inside(x + dx, y + dy) ? m.island[y + dy][x + dx] : -1;
      if (id >= 0 && id !== k) return false;
    }
    return true;
  };
  for (let k = 0; k < nIslands; k++) {
    let seed = null;
    for (let i = 0; i < 300 && !seed; i++) {
      const x = randInt(rng, 0, S - 1);
      const y = randInt(rng, 0, S - 1);
      if (free(x, y, k)) seed = [x, y];
    }
    if (!seed) return null;
    const cells = [seed];
    m.island[seed[1]][seed[0]] = k;
    const size = pickWeighted(rng, C.ISLAND_SIZES);
    for (let i = 0; i < 40 && cells.length < size; i++) {
      const [cx, cy] = cells[Math.floor(rng() * cells.length)];
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
      if (free(cx + dx, cy + dy, k)) {
        m.island[cy + dy][cx + dx] = k;
        cells.push([cx + dx, cy + dy]);
      }
    }
    for (const [x, y] of cells) m.tiles[y][x] = 'tierra';
    m.islands.push({ id: k, cells, port: null });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) if (m.tiles[y][x] === 'mar' && rng() < C.REEF_RATE) m.tiles[y][x] = 'arrecife';
  }
  if (!m.seaConnected()) return null;

  const names = shuffle(rng, [...C.PORT_NAMES]);
  const portIslands = shuffle(rng, [...m.islands]).slice(0, C.PORTS);
  for (const isl of portIslands) {
    const coast = isl.cells.filter(([x, y]) => DIRS.some(([dx, dy]) => isNav(m.t(x + dx, y + dy))));
    if (!coast.length) return null;
    const [x, y] = coast[Math.floor(rng() * coast.length)];
    m.tiles[y][x] = 'puerto';
    const port = { id: m.ports.length, name: names[m.ports.length], x, y, island: isl.id, prices: makePrices(rng) };
    isl.port = port.id;
    m.ports.push(port);
  }

  // Puertos de salida separados al menos START_MIN_DIST casillas por mar.
  const order = shuffle(rng, m.ports.map((p) => p.id));
  const starts = [];
  const pick = (i) => {
    if (starts.length === nPlayers) return true;
    for (let j = i; j < order.length; j++) {
      const p = m.ports[order[j]];
      if (starts.every((s) => m.portDistance(m.ports[s], p) >= C.START_MIN_DIST)) {
        starts.push(p.id);
        if (pick(j + 1)) return true;
        starts.pop();
      }
    }
    return false;
  };
  if (!pick(0)) return null;
  m.starts = starts;
  return m;
}

function generateMap(rng, nPlayers) {
  for (let i = 0; i < 2000; i++) {
    const m = tryGenerate(rng, nPlayers);
    if (m) return m;
  }
  throw new Error('No se pudo generar el mapa');
}

module.exports = { GameMap, generateMap, DIRS, isNav, isLand, cheb, key, randInt, shuffle };
