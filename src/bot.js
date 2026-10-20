'use strict';

// Jugador automático: explora, comercia entre puertos, se mejora y ataca cuando le conviene.
// Solo usa lo que sabe (su mapa descubierto y los barcos que ve).

const C = require('./config');
const M = require('./map');
const { GameError, maxCasco, maxCrew, holdCap, countGoods } = require('./game');

const { cheb, DIRS, isNav, isLand } = M;

function mem(g, p) {
  if (!g._botMem) g._botMem = {};
  if (!g._botMem[p.id]) g._botMem[p.id] = { visit: null, done: new Set() };
  return g._botMem[p.id];
}

const knownTile = (g, p, x, y) => (g.map.inside(x, y) && p.known[y * C.SIZE + x] ? g.map.tiles[y][x] : null);

// Valor esperado de venta de una mercancía en los puertos conocidos (sin contar el último visitado).
function bestKnownSale(g, p, good, exceptPort) {
  let best = 0;
  for (const port of g.map.ports) {
    if (port.id === exceptPort || !knownTile(g, p, port.x, port.y)) continue;
    best = Math.max(best, port.prices[good].vende);
  }
  return best;
}

function wantsPort(g, p) {
  if (p.casco < maxCasco(p)) return true;
  if (p.tripulacion < maxCrew(p) && p.oro >= C.RECRUIT_COST) return true;
  if (p.hold.length >= 2) return true;
  return C.ATTRS.some((a) => p.niveles[a] < 3 && C.UPGRADE_COST[a][p.niveles[a] - 1] <= p.oro);
}

// Casillas objetivo según lo que necesita el bot.
function chooseGoal(g, p) {
  const S = C.SIZE;
  if (wantsPort(g, p)) {
    const ports = g.map.ports.filter((pt) => pt.id !== p.lastPort && !g.portRival(pt.id, p) && knownTile(g, p, pt.x, pt.y));
    if (ports.length) return { kind: 'puerto', tiles: ports.flatMap((pt) => g.map.portExits(pt).filter(([x, y]) => knownTile(g, p, x, y))) };
  }
  const islands = new Set();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = knownTile(g, p, x, y);
      if (isLand(t) && !p.explored.includes(g.map.island[y][x])) islands.add(`${x},${y}`);
    }
  }
  const tiles = [];
  for (const k of islands) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of DIRS) {
      const t = knownTile(g, p, x + dx, y + dy);
      if (t === null ? g.map.inside(x + dx, y + dy) : isNav(t)) tiles.push([x + dx, y + dy]);
    }
  }
  if (tiles.length) return { kind: 'isla', tiles };
  // Frontera: mar conocido junto a lo desconocido.
  const frontier = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!isNav(knownTile(g, p, x, y))) continue;
      if (DIRS.some(([dx, dy]) => g.map.inside(x + dx, y + dy) && !p.known[(y + dy) * S + x + dx])) frontier.push([x, y]);
    }
  }
  if (frontier.length) return { kind: 'frontera', tiles: frontier };
  const ports = g.map.ports.filter((pt) => pt.id !== p.lastPort && !g.portRival(pt.id, p));
  return { kind: 'puerto', tiles: ports.flatMap((pt) => g.map.portExits(pt)) };
}

// Primer paso de la ruta más corta según el mapa del bot (lo desconocido se supone mar).
function nextStep(g, p, goals) {
  const goalSet = new Set(goals.map(([x, y]) => `${x},${y}`));
  const passable = (fx, fy, tx, ty) => {
    if (!g.map.inside(tx, ty)) return false;
    const t = knownTile(g, p, tx, ty);
    if (t !== null && !isNav(t)) return false;
    if (fx !== tx && fy !== ty && isLand(knownTile(g, p, fx, ty)) && isLand(knownTile(g, p, tx, fy))) return false;
    return !g.shipsAtSea().some((s) => s.id !== p.id && s.x === tx && s.y === ty && g.sees(p, s));
  };
  const start = `${p.x},${p.y}`;
  const dist = new Map([[start, 0]]);
  const first = new Map();
  const open = [[0, p.x, p.y]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = open.shift();
    const k = `${x},${y}`;
    if (d > dist.get(k)) continue;
    if (goalSet.has(k) && k !== start) return first.get(k);
    const steps = k === start && p.docked !== null
      ? g.map.portExits(g.map.ports[p.docked]).filter(([nx, ny]) => passable(nx, ny, nx, ny))
      : DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => passable(x, y, nx, ny));
    for (const [nx, ny] of steps) {
      const t = knownTile(g, p, nx, ny);
      const nd = d + (t === 'arrecife' ? 2 : 1);
      const nk = `${nx},${ny}`;
      if (dist.has(nk) && dist.get(nk) <= nd) continue;
      dist.set(nk, nd);
      first.set(nk, first.get(k) || [nx, ny]);
      open.push([nd, nx, ny]);
    }
  }
  return null;
}

function portTask(g, p, m) {
  const port = g.map.ports[p.docked];
  const have = countGoods(p.hold);
  if (!m.done.has('vender')) {
    m.done.add('vender');
    const vender = {};
    for (const g2 of C.GOODS) {
      if (!have[g2] || p.visit.bought.includes(g2)) continue;
      const units = p.hold.filter((u) => u.g === g2);
      const avgCost = units.reduce((a, u) => a + u.cost, 0) / units.length;
      if (port.prices[g2].vende > avgCost || port.prices[g2].vende >= C.GOOD_VALUE[g2] + 1) vender[g2] = have[g2];
    }
    if (Object.keys(vender).length) return ['comerciar', { vender, comprar: {} }];
  }
  if (p.casco < maxCasco(p) && p.oro >= C.REPAIR_COST && !m.done.has('reparar')) {
    m.done.add('reparar');
    return ['reparar', { n: Math.min(maxCasco(p) - p.casco, Math.floor(p.oro / C.REPAIR_COST)) }];
  }
  if (p.tripulacion < maxCrew(p) && p.oro >= C.RECRUIT_COST && !m.done.has('reclutar')) {
    m.done.add('reclutar');
    return ['reclutar', { n: Math.min(maxCrew(p) - p.tripulacion, Math.floor(p.oro / C.RECRUIT_COST)) }];
  }
  const prio = ['velas', 'canones', 'bodega', 'casco', 'tripulacion'];
  for (const a of prio) {
    const l = p.niveles[a];
    if (l < 3 && C.UPGRADE_COST[a][l - 1] <= p.oro - 1) return ['mejorar', { attr: a }];
  }
  if (!m.done.has('comprar')) {
    m.done.add('comprar');
    let oro = p.oro - 1;
    let space = holdCap(p) - p.hold.length;
    const comprar = {};
    const options = C.GOODS
      .map((good) => ({ good, price: port.prices[good].compra, margin: bestKnownSale(g, p, good, port.id) - port.prices[good].compra }))
      .filter((o) => o.margin >= 1 || o.price <= C.GOOD_VALUE[o.good])
      .sort((a, b) => b.margin - a.margin);
    for (const o of options) {
      const n = Math.min(space, Math.floor(oro / o.price));
      if (n > 0) {
        comprar[o.good] = n;
        oro -= n * o.price;
        space -= n;
      }
    }
    if (Object.keys(comprar).length) return ['comerciar', { vender: {}, comprar }];
  }
  return null;
}

function attackChoice(g, p) {
  if (p.casco < 3) return null;
  for (const t of g.targetsFor(p)) {
    const s = g.ship(t.id);
    if (s.kind === 'mercante') {
      if (t.abordaje && s.hold.length && p.hold.length < holdCap(p)) return ['atacar', { id: s.id, modo: 'abordaje' }];
      if (t.canon && p.niveles.canones >= 2) return ['atacar', { id: s.id, modo: 'canon' }];
    }
    if (s.kind === 'fragata' && t.canon && p.niveles.canones >= 2 && p.casco >= 5) return ['atacar', { id: s.id, modo: 'canon' }];
    if (s.kind === 'pirata' && t.canon && p.casco >= 4 && p.casco > s.casco + 1 && p.niveles.canones >= s.niveles.canones) {
      return ['atacar', { id: s.id, modo: t.abordaje && s.hold.length && p.tripulacion > s.tripulacion ? 'abordaje' : 'canon' }];
    }
  }
  return null;
}

function decide(g, p) {
  const t = g.turn;
  const m = mem(g, p);
  if (t.moving) {
    const dock = g.dockablePorts(p)[0];
    if (dock && wantsPort(g, p)) return ['atracar', { port: dock.id }];
    if (g.explorableIslands(p).length && t.actions > 0) return ['parar', {}];
    const atk = t.actions > 0 && attackChoice(g, p);
    if (atk) return ['parar', {}];
    const goal = chooseGoal(g, p);
    const step = nextStep(g, p, goal.tiles);
    if (!step || g.map.stepCost(step[0], step[1]) > t.moving.mp) return ['parar', {}];
    return ['mover', { path: [step] }];
  }
  if (t.actions <= 0) return ['terminar', {}];
  if (p.docked !== null) {
    if (m.visit !== p.visit) {
      m.visit = p.visit;
      m.done = new Set();
    }
    return portTask(g, p, m) || ['navegar', {}];
  }
  const isl = g.explorableIslands(p);
  if (isl.length && p.casco >= 2) return ['explorar', { island: isl[0] }];
  const atk = attackChoice(g, p);
  if (atk) return atk;
  const dock = g.dockablePorts(p)[0];
  if (dock && wantsPort(g, p)) return ['atracar', { port: dock.id }];
  return ['navegar', {}];
}

// Da un paso del bot si es su turno. Devuelve true si ha hecho algo.
function botStep(g, p) {
  if (!p.bot || g.phase !== 'juego' || !g.turn || g.turn.pid !== p.id || g.combat || g.offer || g.neutral) return false;
  const [type, data] = decide(g, p);
  try {
    g.act(p.id, type, data);
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    // Si algo falla, no se queda atascado: deja de navegar o termina el turno.
    if (g.turn && g.turn.pid === p.id && !g.combat && !g.offer) {
      if (g.turn.moving) g.turn.moving = null;
      else g.endTurn();
    }
  }
  return true;
}

// ¿Acepta el bot un trato? Si recibe al menos lo que da (oro + valor base de mercancías).
function judgeOffer(g, t, offer) {
  const value = (part) => part.oro + Object.entries(part.goods).reduce((a, [good, n]) => a + n * C.GOOD_VALUE[good], 0);
  return value(offer.dar) >= value(offer.pedir);
}

module.exports = { botStep, judgeOffer };
