'use strict';

// PIRATAS — motor del juego. El servidor valida todas las jugadas; cada jugador
// solo recibe lo que ve (niebla de guerra).

const C = require('./config');
const M = require('./map');
const { aiPick } = require('./ai');

const { cheb, randInt, shuffle, DIRS, isNav } = M;

class GameError extends Error {}

function fail(msg) {
  throw new GameError(msg);
}

const lvl = (p, attr) => C.LEVELS[attr][p.niveles[attr] - 1];
const GL = C.GOOD_LABEL;

function maxCasco(s) {
  if (s.kind === 'pirata') return lvl(s, 'casco');
  return s.kind === 'mercante' ? C.MERCHANT.casco : C.FRIGATE.casco;
}
function maxCrew(s) {
  if (s.kind === 'pirata') return lvl(s, 'tripulacion');
  return s.kind === 'mercante' ? C.MERCHANT.tripulacion : C.FRIGATE.tripulacion;
}
function cannonDice(s) {
  if (s.kind === 'pirata') return lvl(s, 'canones');
  return s.kind === 'mercante' ? C.MERCHANT.canones : C.FRIGATE.canones;
}
function holdCap(s) {
  if (s.kind === 'pirata') return lvl(s, 'bodega');
  return s.kind === 'mercante' ? C.MERCHANT.capacidad : 0;
}
function countGoods(hold) {
  const n = Object.fromEntries(C.GOODS.map((g) => [g, 0]));
  for (const u of hold) n[u.g] += 1;
  return n;
}
// Mensajes en los dos idiomas: { es, en }. El cliente muestra el del jugador.
const T = (es, en) => ({ es, en });
function goodsText(list, lang = 'es') {
  const n = countGoods(list.map((g) => (typeof g === 'string' ? { g } : g)));
  const label = lang === 'en' ? C.GOOD_LABEL_EN : GL;
  return C.GOODS.filter((g) => n[g]).map((g) => `${n[g]} ${label[g].toLowerCase()}`).join(', ') || (lang === 'en' ? 'nothing' : 'nada');
}
const goodsT = (list) => T(goodsText(list, 'es'), goodsText(list, 'en'));
// Unidades de un tipo, las más antiguas primero.
function takeUnits(hold, g, n) {
  const out = [];
  for (let i = 0; i < hold.length && out.length < n;) {
    if (hold[i].g === g) out.push(hold.splice(i, 1)[0]);
    else i++;
  }
  return out;
}
function cleanCounts(obj) {
  const out = {};
  for (const g of C.GOODS) {
    const n = Math.floor(Number(obj && obj[g]) || 0);
    if (n < 0) fail('Cantidad no válida');
    if (n) out[g] = n;
  }
  return out;
}
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

class Game {
  constructor(code, opts = {}) {
    this.code = code;
    this.rng = opts.rng || Math.random;
    this.now = opts.now || Date.now;
    this.phase = 'lobby';
    this.players = [];
    this.hostId = null;
    this.log = [];
    this.round = 0;
    this.order = [];
    this.turnIdx = 0;
    this.turn = null;
    this.combat = null;
    this.offer = null;
    this.merchants = [];
    this.frigates = [];
    this.respawns = []; // [{ kind, rounds }]
    this.neutral = null; // pasos pendientes de la fase neutral
    this.map = null;
    this.final = null;
    this._id = 0;
    this._seq = 0;
  }

  // ---------------------------------------------------------------- utilidades

  nid(prefix) {
    this._id += 1;
    return `${prefix}${this._id}`;
  }

  say(text, to = null) {
    this._seq += 1;
    this.log.push({ n: this._seq, text, to });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  notify(p, text, kind = 'info') {
    if (!p || p.kind !== 'pirata') return;
    this._seq += 1;
    p.avisos.push({ n: this._seq, text, kind });
    if (p.avisos.length > 20) p.avisos.shift();
  }

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  ship(id) {
    return this.player(id) || this.merchants.find((s) => s.id === id) || this.frigates.find((s) => s.id === id) || null;
  }

  shipName(s, lang = 'es') {
    if (s.kind === 'pirata') return s.name;
    if (lang === 'en') return s.kind === 'mercante' ? 'a merchant' : 'the Navy frigate';
    return s.kind === 'mercante' ? 'un mercante' : 'la fragata de la Armada';
  }

  // Barcos en el mar (los atracados no bloquean ni pueden ser atacados).
  shipsAtSea() {
    return [...this.players.filter((p) => this.phase !== 'lobby' && p.docked === null), ...this.merchants, ...this.frigates];
  }

  occupied(x, y, exceptId) {
    return this.shipsAtSea().some((s) => s.id !== exceptId && s.x === x && s.y === y);
  }

  // Jugadores que ven la casilla (x, y) ahora mismo.
  observers(...cells) {
    return this.players.filter((p) => cells.some(([x, y]) => cheb(p.x, p.y, x, y) <= C.SHIP_VIEW)).map((p) => p.id);
  }

  sees(p, s) {
    return s.id === p.id || cheb(p.x, p.y, s.x, s.y) <= C.SHIP_VIEW;
  }

  roll(n) {
    return Array.from({ length: Math.max(0, n) }, () => 1 + Math.floor(this.rng() * 6));
  }

  reveal(p) {
    const r = C.TERRAIN_VIEW;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (this.map.inside(x, y)) p.known[y * C.SIZE + x] = 1;
      }
    }
  }

  // motivo: { es, en }
  addPL(p, n, motivo) {
    if (!p || p.kind !== 'pirata' || n <= 0) return;
    p.pl += n;
    this.say(T(`${p.name} gana ${n} de leyenda (${motivo.es}).`, `${p.name} earns ${n} legend (${motivo.en}).`));
  }

  // ---------------------------------------------------------------- sala

  addPlayer(name, opts = {}) {
    if (this.phase !== 'lobby') fail('La partida ya ha empezado');
    if (this.players.length >= C.MAX_PLAYERS) fail(`La sala está llena (${C.MAX_PLAYERS} jugadores)`);
    const clean = String(name || '').trim().slice(0, 20);
    const used = new Set(this.players.map((p) => p.color));
    const p = {
      id: this.nid('p'),
      kind: 'pirata',
      name: clean || (opts.bot ? this.botName() : `Pirata ${this.players.length + 1}`),
      color: C.COLORS.find((c) => !used.has(c)),
      bot: !!opts.bot,
      connected: !!opts.bot,
      avisos: [],
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.say(T(`${p.name} sube a bordo.`, `${p.name} comes aboard.`));
    return p;
  }

  // Un nombre de capitán célebre que no esté ya en la sala.
  botName() {
    const used = new Set(this.players.map((p) => p.name));
    const free = C.BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? free[Math.floor(this.rng() * free.length)] : `Capitán ${this.players.length + 1}`;
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = (this.players.find((p) => !p.bot) || this.players[0] || {}).id || null;
  }

  start() {
    if (this.phase !== 'lobby') fail('La partida ya ha empezado');
    if (this.players.length < C.MIN_PLAYERS) fail(`Hacen falta al menos ${C.MIN_PLAYERS} jugadores`);
    this.map = M.generateMap(this.rng, this.players.length);
    this.order = shuffle(this.rng, this.players.map((p) => p.id));
    this.players.forEach((p, i) => {
      const port = this.map.ports[this.map.starts[i]];
      Object.assign(p, {
        pl: 0,
        oro: C.START_GOLD,
        niveles: Object.fromEntries(C.ATTRS.map((a) => [a, 1])),
        hold: [],
        x: port.x,
        y: port.y,
        docked: port.id,
        home: port.id,
        lastPort: port.id,
        visit: { port: port.id, bought: [] },
        known: Array(C.SIZE * C.SIZE).fill(0),
        explored: [],
        netProfit: 0,
        profitPL: 0,
        hundimientos: 0,
        lastCombat: null,
      });
      p.casco = maxCasco(p);
      p.tripulacion = maxCrew(p);
      this.reveal(p);
    });
    const n = this.players.length;
    for (let i = 0; i < C.MERCHANTS_BY_PLAYERS[n]; i++) this.spawnMerchant();
    for (let i = 0; i < C.FRIGATES_BY_PLAYERS[n]; i++) this.spawnFrigate();
    this.phase = 'juego';
    this.round = 1;
    const names = this.order.map((id) => this.player(id).name).join(', ');
    this.say(T(`¡Zarpamos! Orden de turno: ${names}.`, `We set sail! Turn order: ${names}.`));
    this.startTurn(0);
  }

  // ---------------------------------------------------------------- turnos

  current() {
    return this.turn ? this.player(this.turn.pid) : null;
  }

  startTurn(idx) {
    this.turnIdx = idx;
    const p = this.player(this.order[idx]);
    this.turn = { pid: p.id, actions: C.ACTIONS_PER_TURN, moving: null, deadline: C.TURN_MS ? this.now() + C.TURN_MS : null, left: null };
    this.say(T(`— Ronda ${this.round}: turno de ${p.name}.`, `— Round ${this.round}: ${p.name}'s turn.`));
  }

  pauseTurn() {
    if (!this.turn || this.turn.deadline === null) return;
    this.turn.left = Math.max(0, this.turn.deadline - this.now());
    this.turn.deadline = null;
  }

  resumeTurn() {
    if (!this.turn || this.turn.deadline !== null || !C.TURN_MS) return;
    this.turn.deadline = this.now() + Math.max(this.turn.left || 0, 10000);
    this.turn.left = null;
  }

  endTurn() {
    if (this.combat) fail('Hay un combate en curso');
    if (this.offer) fail('Hay una propuesta de comercio pendiente');
    const next = this.turnIdx + 1;
    this.turn = null;
    while (next < this.order.length && !this.player(this.order[next])) this.order.splice(next, 1);
    if (next < this.order.length) this.startTurn(next);
    else this.startNeutral();
  }

  spend(p) {
    if (this.phase !== 'juego' || !this.turn || this.turn.pid !== p.id) fail('No es tu turno');
    if (this.combat) fail('Hay un combate en curso');
    if (this.offer) fail('Hay una propuesta de comercio pendiente');
    if (this.turn.actions <= 0) fail('No te quedan acciones');
    this.turn.actions -= 1;
    this.turn.moving = null;
  }

  // ---------------------------------------------------------------- acciones

  act(pid, type, data = {}) {
    const p = this.player(pid);
    if (!p) fail('Jugador desconocido');
    const h = this[`a_${type}`];
    if (typeof h !== 'function') fail('Acción desconocida');
    if (this.phase === 'fin') fail('La partida ha terminado');
    h.call(this, p, data || {});
  }

  a_addBot(p) {
    if (p.id !== this.hostId) fail('Solo el anfitrión puede añadir bots');
    this.addPlayer('', { bot: true });
  }

  a_kick(p, { id }) {
    if (p.id !== this.hostId) fail('Solo el anfitrión puede expulsar');
    if (this.phase !== 'lobby') fail('La partida ya ha empezado');
    if (id === p.id) fail('No puedes expulsarte');
    const t = this.player(id);
    if (!t) fail('Jugador desconocido');
    this.removePlayer(id);
    this.say(T(`${t.name} abandona la tripulación.`, `${t.name} leaves the crew.`));
  }

  a_start(p) {
    if (p.id !== this.hostId) fail('Solo el anfitrión puede empezar');
    this.start();
  }

  a_terminar(p) {
    if (this.phase !== 'juego' || !this.turn || this.turn.pid !== p.id) fail('No es tu turno');
    this.endTurn();
  }

  a_navegar(p) {
    this.spend(p);
    this.turn.moving = { mp: lvl(p, 'velas') };
  }

  a_parar(p) {
    if (!this.turn || this.turn.pid !== p.id || !this.turn.moving) fail('No estás navegando');
    this.turn.moving = null;
  }

  // Pasos posibles desde la posición actual (desde el puerto se sale a cualquier casilla de mar vecina).
  stepsFrom(s, x, y) {
    if (s.docked !== null && s.docked !== undefined && x === s.x && y === s.y) {
      return this.map.portExits(this.map.ports[s.docked]);
    }
    return DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => this.map.canStep(x, y, nx, ny));
  }

  a_mover(p, { path }) {
    const mv = this.turn && this.turn.pid === p.id && this.turn.moving;
    if (!mv || this.combat || this.offer) fail('Primero pulsa Navegar');
    if (!Array.isArray(path) || !path.length) fail('Ruta no válida');
    let moved = 0;
    for (const step of path.slice(0, 12)) {
      const [x, y] = (Array.isArray(step) ? step : []).map(Number);
      const ok = this.stepsFrom(p, p.x, p.y).some(([a, b]) => a === x && b === y);
      const cost = ok ? this.map.stepCost(x, y) : Infinity;
      if (!ok || cost > mv.mp || this.occupied(x, y, p.id)) {
        if (!moved) fail(ok && cost > mv.mp ? 'No te quedan puntos de movimiento' : 'No puedes navegar ahí');
        break;
      }
      if (p.docked !== null) {
        const pn = this.map.ports[p.docked].name;
        this.say(T(`${p.name} zarpa de ${pn}.`, `${p.name} sails from ${pn}.`), this.observers([p.x, p.y]));
        p.docked = null;
        p.visit = null;
      }
      p.x = x;
      p.y = y;
      mv.mp -= cost;
      moved += 1;
      this.reveal(p);
    }
    if (mv.mp <= 0) this.turn.moving = null;
  }

  // Rival atracado en ese puerto (no se puede atracar mientras siga allí).
  portRival(portId, p) {
    return this.players.find((o) => o.id !== p.id && o.docked === portId) || null;
  }

  dockablePorts(p) {
    if (p.docked !== null) return [];
    return this.map.ports.filter((port) => cheb(port.x, port.y, p.x, p.y) === 1 && port.id !== p.lastPort && !this.portRival(port.id, p));
  }

  // Puertos vecinos cerrados porque hay un rival atracado.
  blockedPorts(p) {
    if (p.docked !== null) return [];
    return this.map.ports.filter((port) => cheb(port.x, port.y, p.x, p.y) === 1 && port.id !== p.lastPort && this.portRival(port.id, p));
  }

  a_atracar(p, { port }) {
    if (this.phase !== 'juego' || !this.turn || this.turn.pid !== p.id) fail('No es tu turno');
    if (this.combat || this.offer) fail('Espera a que termine lo pendiente');
    const pt = this.map.ports[Number(port)];
    if (!pt || p.docked !== null || cheb(pt.x, pt.y, p.x, p.y) !== 1) fail('Tienes que estar junto al puerto');
    if (pt.id === p.lastPort) fail('No puedes volver al último puerto que visitaste hasta atracar en otro');
    if (this.portRival(pt.id, p)) fail('Hay un rival atracado en ese puerto');
    this.turn.moving = null;
    this.dock(p, pt.id);
    this.say(T(`${p.name} atraca en ${pt.name}.`, `${p.name} docks at ${pt.name}.`), this.observers([pt.x, pt.y]));
  }

  dock(p, portId) {
    const pt = this.map.ports[portId];
    p.docked = portId;
    p.lastPort = portId;
    p.x = pt.x;
    p.y = pt.y;
    p.visit = { port: portId, bought: [] };
    this.reveal(p);
  }

  explorableIslands(p) {
    if (p.docked !== null) return [];
    return this.map.islandsAround(p.x, p.y).filter((id) => !p.explored.includes(id));
  }

  a_explorar(p, { island }) {
    const id = Number(island);
    if (!this.explorableIslands(p).includes(id)) fail('No hay ninguna isla por explorar junto a tu barco');
    this.spend(p);
    p.explored.push(id);
    let r = this.rng() * 100;
    let res = C.EXPLORE[C.EXPLORE.length - 1][0];
    for (const [name, prob] of C.EXPLORE) {
      r -= prob;
      if (r < 0) { res = name; break; }
    }
    const obs = this.observers([p.x, p.y]);
    if (res === 'tesoro') {
      const oro = randInt(this.rng, C.TREASURE_GOLD[0], C.TREASURE_GOLD[1]);
      p.oro += oro;
      this.notify(p, T(`¡Tesoro! Encuentras ${oro} oros.`, `Treasure! You find ${oro} gold.`), 'tesoro');
      this.say(T(`${p.name} explora una isla y encuentra un tesoro.`, `${p.name} explores an island and finds treasure.`), obs);
      this.addPL(p, C.PL.tesoro, T('tesoro', 'treasure'));
    } else if (res === 'mercancias') {
      const n = randInt(this.rng, C.EXPLORE_GOODS[0], C.EXPLORE_GOODS[1]);
      const found = Array.from({ length: n }, () => C.GOODS[Math.floor(this.rng() * C.GOODS.length)]);
      const room = holdCap(p) - p.hold.length;
      const kept = found.slice(0, Math.max(0, room));
      for (const g of kept) p.hold.push({ g, cost: 0 });
      const lost = found.length - kept.length;
      this.notify(p, T(`Encuentras mercancías: ${goodsText(found)}.${lost ? ` No caben ${lost} en la bodega.` : ''}`,
        `You find cargo: ${goodsText(found, 'en')}.${lost ? ` ${lost} don't fit in the hold.` : ''}`), 'mercancias');
      this.say(T(`${p.name} explora una isla y encuentra mercancías.`, `${p.name} explores an island and finds cargo.`), obs);
    } else if (res === 'peligro') {
      const d = randInt(this.rng, C.DANGER_DAMAGE[0], C.DANGER_DAMAGE[1]);
      p.casco = Math.max(0, p.casco - d);
      this.notify(p, T(`¡Peligro en la isla! Tu barco recibe ${d} de daño.`, `Danger on the island! Your ship takes ${d} damage.`), 'peligro');
      this.say(T(`${p.name} explora una isla y sufre un percance.`, `${p.name} explores an island and runs into trouble.`), obs);
      if (p.casco <= 0) this.sink(p, null, T('los peligros de la isla', 'the island\'s dangers'));
    } else {
      this.notify(p, T('La isla está desierta: no encuentras nada.', 'The island is deserted: you find nothing.'), 'nada');
      this.say(T(`${p.name} explora una isla sin encontrar nada.`, `${p.name} explores an island and finds nothing.`), obs);
    }
  }

  docked(p) {
    if (p.docked === null) fail('Tienes que estar atracado en un puerto');
    return this.map.ports[p.docked];
  }

  // Vende y luego compra varias unidades en una sola acción.
  a_comerciar(p, { vender, comprar }) {
    const port = this.docked(p);
    const sell = cleanCounts(vender);
    const buy = cleanCounts(comprar);
    if (!sum(sell) && !sum(buy)) fail('Elige qué comprar o vender');
    const have = countGoods(p.hold);
    for (const g of Object.keys(sell)) {
      if (have[g] < sell[g]) fail(`No tienes tanta ${GL[g].toLowerCase()}`);
      if (p.visit.bought.includes(g)) fail(`No puedes revender ${GL[g].toLowerCase()} en el puerto donde la compraste`);
    }
    for (const g of Object.keys(buy)) if (sell[g]) fail('No puedes comprar y vender la misma mercancía');
    const income = Object.entries(sell).reduce((a, [g, n]) => a + n * port.prices[g].vende, 0);
    const cost = Object.entries(buy).reduce((a, [g, n]) => a + n * port.prices[g].compra, 0);
    if (p.oro + income < cost) fail('No tienes oro suficiente');
    if (p.hold.length - sum(sell) + sum(buy) > holdCap(p)) fail('No cabe en la bodega');
    this.spend(p);
    let profit = 0;
    for (const [g, n] of Object.entries(sell)) {
      for (const u of takeUnits(p.hold, g, n)) profit += port.prices[g].vende - u.cost;
    }
    p.oro += income - cost;
    for (const [g, n] of Object.entries(buy)) {
      for (let i = 0; i < n; i++) p.hold.push({ g, cost: port.prices[g].compra });
      if (!p.visit.bought.includes(g)) p.visit.bought.push(g);
    }
    const sold = Object.entries(sell).flatMap(([g, n]) => Array(n).fill(g));
    const bought = Object.entries(buy).flatMap(([g, n]) => Array(n).fill(g));
    const es = [];
    const en = [];
    if (sum(sell)) { es.push(`vendes ${goodsText(sold)} por ${income} oros`); en.push(`you sell ${goodsText(sold, 'en')} for ${income} gold`); }
    if (sum(buy)) { es.push(`compras ${goodsText(bought)} por ${cost} oros`); en.push(`you buy ${goodsText(bought, 'en')} for ${cost} gold`); }
    this.notify(p, T(`En ${port.name} ${es.join(' y ')}.`, `At ${port.name} ${en.join(' and ')}.`), 'comercio');
    this.say(T(`${p.name} comercia en ${port.name}.`, `${p.name} trades at ${port.name}.`), this.observers([port.x, port.y]));
    if (sum(sell)) this.addProfit(p, profit);
  }

  // Cada PROFIT_PER_PL oros de beneficio neto acumulado = 1 PL (solo al superar un nuevo máximo).
  addProfit(p, profit) {
    p.netProfit += profit;
    const sign = profit > 0 ? '+' : '';
    if (profit) this.notify(p, T(`Beneficio de la venta: ${sign}${profit}. Beneficio acumulado: ${p.netProfit}.`, `Sale profit: ${sign}${profit}. Total profit: ${p.netProfit}.`), 'comercio');
    const earned = Math.floor(Math.max(0, p.netProfit) / C.PROFIT_PER_PL);
    if (earned > p.profitPL) {
      this.addPL(p, earned - p.profitPL, T('beneficio comercial', 'trade profit'));
      p.profitPL = earned;
    }
  }

  a_mejorar(p, { attr }) {
    this.docked(p);
    if (!C.ATTRS.includes(attr)) fail('Mejora no válida');
    const level = p.niveles[attr];
    if (level >= 3) fail('Ya está al nivel máximo');
    const cost = C.UPGRADE_COST[attr][level - 1];
    if (p.oro < cost) fail('No tienes oro suficiente');
    this.spend(p);
    const oldCasco = maxCasco(p);
    p.oro -= cost;
    p.niveles[attr] += 1;
    if (attr === 'casco') p.casco += maxCasco(p) - oldCasco;
    if (attr === 'tripulacion') p.tripulacion = Math.min(maxCrew(p), p.tripulacion + 1);
    const lv = 'I'.repeat(p.niveles[attr]);
    this.notify(p, T(`${C.ATTR_LABEL[attr]} mejorado a nivel ${lv} por ${cost} oros.`, `${C.ATTR_LABEL_EN[attr]} upgraded to level ${lv} for ${cost} gold.`), 'mejora');
    this.say(T(`${p.name} mejora su barco.`, `${p.name} upgrades their ship.`), this.observers([p.x, p.y]));
  }

  a_reparar(p, { n }) {
    this.docked(p);
    const amount = Math.floor(Number(n) || 0);
    if (amount < 1 || p.casco + amount > maxCasco(p)) fail('Cantidad no válida');
    if (p.oro < amount * C.REPAIR_COST) fail('No tienes oro suficiente');
    this.spend(p);
    p.oro -= amount * C.REPAIR_COST;
    p.casco += amount;
    this.notify(p, T(`Reparas ${amount} punto(s) de casco por ${amount * C.REPAIR_COST} oros.`, `You repair ${amount} hull point(s) for ${amount * C.REPAIR_COST} gold.`), 'mejora');
  }

  a_reclutar(p, { n }) {
    this.docked(p);
    const amount = Math.floor(Number(n) || 0);
    if (amount < 1 || p.tripulacion + amount > maxCrew(p)) fail('Cantidad no válida');
    if (p.oro < amount * C.RECRUIT_COST) fail('No tienes oro suficiente');
    this.spend(p);
    p.oro -= amount * C.RECRUIT_COST;
    p.tripulacion += amount;
    this.notify(p, T(`Reclutas ${amount} marinero(s) por ${amount * C.RECRUIT_COST} oros.`, `You recruit ${amount} sailor(s) for ${amount * C.RECRUIT_COST} gold.`), 'mejora');
  }

  // Comercio con un mercante adyacente, a los precios de su puerto de destino.
  a_mercante(p, { id, vender, comprar }) {
    const m = this.merchants.find((s) => s.id === id);
    if (!m || p.docked !== null || cheb(m.x, m.y, p.x, p.y) !== 1) fail('Tienes que estar junto al mercante');
    const prices = this.map.ports[m.to].prices;
    const sell = cleanCounts(vender);
    const buy = cleanCounts(comprar);
    if (!sum(sell) && !sum(buy)) fail('Elige qué comprar o vender');
    const have = countGoods(p.hold);
    const cargo = countGoods(m.hold);
    for (const g of Object.keys(sell)) if (have[g] < sell[g]) fail(`No tienes tanta ${GL[g].toLowerCase()}`);
    for (const g of Object.keys(buy)) {
      if (cargo[g] < buy[g]) fail(`El mercante no lleva tanta ${GL[g].toLowerCase()}`);
      if (sell[g]) fail('No puedes comprar y vender la misma mercancía');
    }
    const income = Object.entries(sell).reduce((a, [g, n]) => a + n * prices[g].vende, 0);
    const cost = Object.entries(buy).reduce((a, [g, n]) => a + n * prices[g].compra, 0);
    if (p.oro + income < cost) fail('No tienes oro suficiente');
    if (p.hold.length - sum(sell) + sum(buy) > holdCap(p)) fail('No cabe en la bodega');
    if (m.hold.length + sum(sell) - sum(buy) > holdCap(m)) fail('No cabe en la bodega del mercante');
    this.spend(p);
    let profit = 0;
    for (const [g, n] of Object.entries(sell)) {
      for (const u of takeUnits(p.hold, g, n)) {
        profit += prices[g].vende - u.cost;
        m.hold.push({ g, cost: 0 });
      }
    }
    for (const [g, n] of Object.entries(buy)) {
      takeUnits(m.hold, g, n);
      for (let i = 0; i < n; i++) p.hold.push({ g, cost: prices[g].compra });
    }
    p.oro += income - cost;
    this.notify(p, T(`Comercias con el mercante: ${income ? `cobras ${income}` : ''}${income && cost ? ' y ' : ''}${cost ? `pagas ${cost}` : ''} oros.`,
      `You trade with the merchant: ${income ? `you receive ${income}` : ''}${income && cost ? ' and ' : ''}${cost ? `you pay ${cost}` : ''} gold.`), 'comercio');
    if (sum(sell)) this.addProfit(p, profit);
  }

  // ---------------------------------------------------------------- comercio entre jugadores

  a_proponer(p, { to, dar, pedir }) {
    const t = this.player(to);
    if (!t || t.id === p.id) fail('Elige a otro pirata');
    if (cheb(p.x, p.y, t.x, t.y) > 1) fail('Los barcos tienen que estar juntos');
    const give = { oro: Math.floor(Number(dar && dar.oro) || 0), goods: cleanCounts(dar && dar.goods) };
    const want = { oro: Math.floor(Number(pedir && pedir.oro) || 0), goods: cleanCounts(pedir && pedir.goods) };
    if (give.oro < 0 || want.oro < 0) fail('Cantidad no válida');
    if (!give.oro && !want.oro && !sum(give.goods) && !sum(want.goods)) fail('La propuesta está vacía');
    this.checkTrade(p, t, give, want);
    this.spend(p);
    this.offer = { from: p.id, to: t.id, dar: give, pedir: want, deadline: this.now() + C.OFFER_MS };
    this.pauseTurn();
    this.say(T(`${p.name} propone un trato a ${t.name}.`, `${p.name} offers a deal to ${t.name}.`), [p.id, t.id]);
    if (t.bot) this.answerOffer(t, require('./bot').judgeOffer(this, t, this.offer));
  }

  checkTrade(a, b, give, want) {
    const ha = countGoods(a.hold);
    const hb = countGoods(b.hold);
    if (a.oro < give.oro) fail(`${a.name} no tiene tanto oro`);
    if (b.oro < want.oro) fail(`${b.name} no tiene tanto oro`);
    for (const g of C.GOODS) {
      if (ha[g] < (give.goods[g] || 0)) fail(`${a.name} no tiene tanta ${GL[g].toLowerCase()}`);
      if (hb[g] < (want.goods[g] || 0)) fail(`${b.name} no tiene tanta ${GL[g].toLowerCase()}`);
    }
    if (a.hold.length - sum(give.goods) + sum(want.goods) > holdCap(a)) fail(`No cabe en la bodega de ${a.name}`);
    if (b.hold.length - sum(want.goods) + sum(give.goods) > holdCap(b)) fail(`No cabe en la bodega de ${b.name}`);
  }

  a_responder(p, { aceptar }) {
    if (!this.offer || this.offer.to !== p.id) fail('No tienes ninguna propuesta');
    this.answerOffer(p, !!aceptar);
  }

  answerOffer(t, accept) {
    const o = this.offer;
    const a = this.player(o.from);
    this.offer = null;
    this.resumeTurn();
    if (!a) return;
    if (accept) {
      try {
        this.checkTrade(a, t, o.dar, o.pedir);
      } catch (e) {
        this.say(T(`El trato entre ${a.name} y ${t.name} no se puede cerrar: ${e.message}.`, `The deal between ${a.name} and ${t.name} cannot be closed.`), [a.id, t.id]);
        return;
      }
      a.oro += o.pedir.oro - o.dar.oro;
      t.oro += o.dar.oro - o.pedir.oro;
      for (const [g, n] of Object.entries(o.dar.goods)) t.hold.push(...takeUnits(a.hold, g, n));
      for (const [g, n] of Object.entries(o.pedir.goods)) a.hold.push(...takeUnits(t.hold, g, n));
      this.say(T(`${t.name} acepta el trato de ${a.name}.`, `${t.name} accepts ${a.name}'s deal.`), [a.id, t.id]);
      this.notify(a, T(`${t.name} acepta tu trato.`, `${t.name} accepts your deal.`), 'comercio');
    } else {
      this.say(T(`${t.name} rechaza el trato de ${a.name}.`, `${t.name} rejects ${a.name}'s deal.`), [a.id, t.id]);
      this.notify(a, T(`${t.name} rechaza tu trato.`, `${t.name} rejects your deal.`), 'info');
    }
  }

  // ---------------------------------------------------------------- combate

  targetsFor(p) {
    if (p.docked !== null) return [];
    return this.shipsAtSea().filter((s) => s.id !== p.id && this.sees(p, s)).map((s) => {
      const d = cheb(p.x, p.y, s.x, s.y);
      return {
        id: s.id,
        canon: this.map.lineOfSight(p.x, p.y, s.x, s.y),
        abordaje: d === 1 && p.tripulacion > 0,
        comercio: d === 1 && s.kind === 'mercante',
      };
    });
  }

  a_atacar(p, { id, modo }) {
    if (p.docked !== null) fail('No puedes atacar desde el puerto');
    const s = this.ship(id);
    if (!s || s.id === p.id || (s.kind === 'pirata' && s.docked !== null)) fail('Objetivo no válido');
    const d = cheb(p.x, p.y, s.x, s.y);
    if (modo === 'abordaje') {
      if (d !== 1) fail('Para abordar tienes que estar junto al barco');
      if (p.tripulacion <= 0) fail('No tienes marineros para abordar');
    } else if (modo === 'canon') {
      if (!this.map.lineOfSight(p.x, p.y, s.x, s.y)) fail('Fuera de alcance o sin línea de tiro');
    } else fail('Ataque no válido');
    this.spend(p);
    this.startCombat(p, s, modo, false);
  }

  startCombat(att, def, first, neutral) {
    const c = {
      id: this.nid('c'),
      a: att.id,
      d: def.id,
      dist: cheb(att.x, att.y, def.x, def.y),
      ronda: 1,
      picks: { a: first, d: null },
      maniobro: { a: false, d: false },
      ventaja: { a: false, d: false },
      historial: [],
      deadline: null,
      neutral,
      fin: null,
      obs: [],
    };
    this.combat = c;
    this.pauseTurn();
    // Cada pirata del combate descubre la casilla de su rival (si atacan desde 2 casillas).
    for (const [me, foe] of [[att, def], [def, att]]) {
      if (me.kind === 'pirata') me.known[foe.y * C.SIZE + foe.x] = 1;
    }
    c.obs = this.observers([att.x, att.y], [def.x, def.y]);
    const verb = first === 'abordaje' ? T('aborda', 'boards') : T('cañonea', 'fires on');
    this.say(T(`⚔ ${this.shipName(att)} ${verb.es} a ${this.shipName(def)}.`, `⚔ ${this.shipName(att, 'en')} ${verb.en} ${this.shipName(def, 'en')}.`), c.obs);
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    if (def.kind === 'pirata') this.notify(def, T(`¡${cap(this.shipName(att))} te ataca!`, `${cap(this.shipName(att, 'en'))} attacks you!`), 'combate');
    this.autoPicks();
  }

  isHuman(s) {
    return s && s.kind === 'pirata' && !s.bot;
  }

  combatOptions(c, side) {
    const s = this.ship(c[side]);
    const opts = ['canon'];
    if (c.dist <= 1 && s.kind === 'pirata' && s.tripulacion > 0) opts.push('abordaje');
    if (!c.maniobro[side]) opts.push('maniobra');
    return opts;
  }

  autoPicks() {
    const c = this.combat;
    for (const side of ['a', 'd']) {
      if (c.picks[side] || this.isHuman(this.ship(c[side]))) continue;
      c.picks[side] = aiPick(this, c, side);
    }
    if (c.picks.a && c.picks.d) this.resolveRound();
    else c.deadline = this.now() + C.CHOICE_MS;
  }

  a_maniobra(p, { eleccion }) {
    const c = this.combat;
    const side = c && (c.a === p.id ? 'a' : c.d === p.id ? 'd' : null);
    if (!side) fail('No estás en combate');
    if (c.picks[side]) fail('Ya has elegido maniobra');
    if (!this.combatOptions(c, side).includes(eleccion)) fail('Maniobra no válida');
    c.picks[side] = eleccion;
    if (c.picks.a && c.picks.d) this.resolveRound();
  }

  resolveRound() {
    const c = this.combat;
    const S = { a: this.ship(c.a), d: this.ship(c.d) };
    const pk = c.picks;
    const other = (s) => (s === 'a' ? 'd' : 'a');
    const r = { ronda: c.ronda, picks: { ...pk }, tiradas: {}, texto: [] };
    const N = (side, lang) => this.shipName(S[side], lang);
    const offense = (side, base) => {
      const n = base + (c.ventaja[side] ? 1 : 0);
      c.ventaja[side] = false;
      return n;
    };
    const hits = (dice) => dice.filter((v) => v >= C.HIT_MIN).length;
    let ended = null;

    for (const side of ['a', 'd']) if (pk[side] === 'maniobra') c.maniobro[side] = true;

    // Cañonazos (simultáneos).
    const dmg = { a: 0, d: 0 };
    for (const side of ['a', 'd']) {
      if (pk[side] !== 'canon') continue;
      const dice = this.roll(offense(side, cannonDice(S[side])));
      let h = hits(dice);
      r.tiradas[side] = { tipo: 'canon', dados: dice, exitos: h };
      const tgt = other(side);
      if (pk[tgt] === 'maniobra' && h > 0) {
        h -= 1;
        r.texto.push(T(`${N(tgt)} maniobra y esquiva un impacto.`, `${N(tgt, 'en')} maneuvers and dodges a hit.`));
      }
      dmg[tgt] += h;
      r.texto.push(T(`${N(side)} dispara: ${h} impacto(s).`, `${N(side, 'en')} fires: ${h} hit(s).`));
    }
    for (const side of ['a', 'd']) S[side].casco = Math.max(0, S[side].casco - dmg[side]);
    for (const side of ['a', 'd']) {
      if (pk[side] === 'maniobra') {
        c.ventaja[side] = true;
        if (pk[other(side)] === 'abordaje') r.texto.push(T(`${N(side)} maniobra y evita el abordaje.`, `${N(side, 'en')} maneuvers and avoids the boarding.`));
      }
    }
    if (pk.a === 'maniobra' && pk.d === 'maniobra') r.texto.push(T('Ambos barcos maniobran: nadie recibe daño.', 'Both ships maneuver: no one takes damage.'));

    // Abordajes.
    const boarders = ['a', 'd'].filter((s) => pk[s] === 'abordaje');
    const contest = (x, y, yOffensive) => {
      const dx = this.roll(offense(x, S[x].tripulacion));
      const dy = this.roll(yOffensive ? offense(y, S[y].tripulacion) : S[y].tripulacion);
      r.tiradas[`${x}Abordaje`] = { tipo: 'abordaje', dados: dx, exitos: hits(dx) };
      r.tiradas[`${y}Abordaje`] = { tipo: 'defensa', dados: dy, exitos: hits(dy) };
      const hx = hits(dx);
      const hy = hits(dy);
      if (hx > hy || (hx === hy && x === 'd')) return x;
      return y;
    };
    if (boarders.length === 2) {
      const w = contest('a', 'd', true);
      ended = this.boardingWin(S[w], S[other(w)], r);
    } else if (boarders.length === 1) {
      const x = boarders[0];
      const y = other(x);
      if (pk[y] === 'maniobra') {
        c.ventaja[x] = false;
      } else if (S[x].casco > 0) {
        const w = contest(x, y, false);
        if (w === x) ended = this.boardingWin(S[x], S[y], r);
        else {
          S[x].tripulacion = Math.max(0, S[x].tripulacion - 1);
          r.texto.push(T(`${N(y)} rechaza el abordaje: ${N(x)} pierde un marinero.`, `${N(y, 'en')} repels the boarding: ${N(x, 'en')} loses a sailor.`));
        }
      }
    }

    c.historial.push(r);
    const sunk = ['a', 'd'].filter((s) => S[s].casco <= 0);
    if (sunk.length) ended = 'hundimiento';
    else if (!ended && c.ronda >= C.COMBAT_ROUNDS) ended = 'asaltos';
    this.say(T(`Asalto ${c.ronda}: ${r.texto.map((x) => x.es).join(' ')}`, `Round ${c.ronda}: ${r.texto.map((x) => x.en).join(' ')}`), [...new Set([...c.obs, c.a, c.d])]);
    if (ended) {
      c.fin = { motivo: ended, hundidos: sunk.map((s) => c[s]) };
      if (ended === 'asaltos') this.say(T('Tras tres asaltos, ningún barco se impone.', 'After three rounds, neither ship prevails.'), c.obs);
      this.combat = null;
      const summary = { ...c, nombres: { a: T(N('a'), N('a', 'en')), d: T(N('d'), N('d', 'en')) } };
      for (const s of ['a', 'd']) if (S[s].kind === 'pirata') S[s].lastCombat = summary;
      for (const s of sunk) this.sink(S[s], S[other(s)], 'combate');
      this.afterCombat(c);
      return;
    }
    c.ronda += 1;
    c.picks = { a: null, d: null };
    c.deadline = null;
    this.autoPicks();
  }

  boardingWin(w, l, r) {
    l.tripulacion = Math.max(0, l.tripulacion - 1);
    const room = w.kind === 'pirata' ? holdCap(w) - w.hold.length : 0;
    const n = Math.min(C.BOARD_CAPTURE, l.hold.length, room);
    const best = [...l.hold].sort((a, b) => C.GOOD_VALUE[b.g] - C.GOOD_VALUE[a.g]).slice(0, n);
    for (const u of best) {
      l.hold.splice(l.hold.indexOf(u), 1);
      w.hold.push({ g: u.g, cost: 0 });
    }
    r.texto.push(T(`¡${this.shipName(w)} gana el abordaje${n ? ` y captura ${goodsText(best)}` : ''}! ${this.shipName(l)} pierde un marinero.`,
      `${this.shipName(w, 'en')} wins the boarding${n ? ` and captures ${goodsText(best, 'en')}` : ''}! ${this.shipName(l, 'en')} loses a sailor.`));
    return 'abordaje';
  }

  afterCombat(c) {
    if (c.neutral) this.runNeutral();
    else this.resumeTurn();
  }

  sink(s, by, cause) {
    const obs = this.observers([s.x, s.y]);
    if (s.kind === 'pirata') {
      const lose = Math.ceil(s.hold.length / 2);
      const lost = shuffle(this.rng, [...s.hold]).slice(0, lose);
      for (const u of lost) s.hold.splice(s.hold.indexOf(u), 1);
      let taken = [];
      if (by && by.kind === 'pirata') {
        taken = lost.slice(0, Math.max(0, holdCap(by) - by.hold.length));
        for (const u of taken) by.hold.push({ g: u.g, cost: 0 });
        if (taken.length) this.notify(by, T(`Recoges del naufragio: ${goodsText(taken)}.`, `You salvage from the wreck: ${goodsText(taken, 'en')}.`), 'combate');
      }
      s.hundimientos += 1;
      const home = this.map.ports[s.home].name;
      const why = typeof cause === 'string' ? T(cause, cause) : cause;
      this.say(T(`☠ ${s.name} se hunde${by ? ` a manos de ${this.shipName(by)}` : ` por ${why.es}`} y vuelve a ${home}.`,
        `☠ ${s.name} sinks${by ? ` at the hands of ${this.shipName(by, 'en')}` : ` due to ${why.en}`} and returns to ${home}.`));
      this.notify(s, T(`Tu barco se ha hundido. Pierdes ${goodsText(lost)} y vuelves a tu puerto de origen.`, `Your ship has sunk. You lose ${goodsText(lost, 'en')} and return to your home port.`), 'hundido');
      this.dock(s, s.home);
      s.casco = maxCasco(s);
      s.tripulacion = maxCrew(s);
      if (this.turn && this.turn.pid === s.id) this.turn.moving = null;
      if (by && by.kind === 'pirata') this.addPL(by, C.PL.pirata, T(`hundir a ${s.name}`, `sinking ${s.name}`));
    } else if (s.kind === 'mercante') {
      this.merchants = this.merchants.filter((m) => m !== s);
      this.respawns.push({ kind: 'mercante', rounds: C.MERCHANT.respawn });
      this.say(T(`☠ ${by ? this.shipName(by) : 'Alguien'} hunde un mercante.`, `☠ ${by ? this.shipName(by, 'en') : 'Someone'} sinks a merchant.`), obs);
      if (by && by.kind === 'pirata') this.addPL(by, C.PL.mercante, T('hundir un mercante', 'sinking a merchant'));
    } else {
      this.frigates = this.frigates.filter((f) => f !== s);
      this.respawns.push({ kind: 'fragata', rounds: C.FRIGATE.respawn });
      this.say(T(`☠ ${by ? this.shipName(by) : 'Alguien'} hunde una fragata de la Armada.`, `☠ ${by ? this.shipName(by, 'en') : 'Someone'} sinks a Navy frigate.`));
      if (by && by.kind === 'pirata') this.addPL(by, C.PL.fragata, T('hundir una fragata', 'sinking a frigate'));
    }
  }

  // ---------------------------------------------------------------- barcos neutrales

  freeSeaTiles(minDistFromPirates = 0) {
    const out = [];
    for (let y = 0; y < C.SIZE; y++) {
      for (let x = 0; x < C.SIZE; x++) {
        if (!isNav(this.map.t(x, y)) || this.occupied(x, y)) continue;
        if (this.players.some((p) => cheb(p.x, p.y, x, y) < minDistFromPirates)) continue;
        out.push([x, y]);
      }
    }
    return out;
  }

  spawnMerchant() {
    const ports = shuffle(this.rng, [...this.map.ports]);
    for (const from of ports) {
      const exits = this.map.portExits(from).filter(([x, y]) => !this.occupied(x, y));
      if (!exits.length) continue;
      const dests = ports.filter((p) => p !== from && this.map.portDistance(from, p) >= C.MERCHANT.minRoute);
      if (!dests.length) continue;
      const to = dests[Math.floor(this.rng() * dests.length)];
      const [x, y] = exits[Math.floor(this.rng() * exits.length)];
      const n = randInt(this.rng, C.MERCHANT.carga[0], C.MERCHANT.carga[1]);
      const hold = Array.from({ length: n }, () => ({ g: C.GOODS[Math.floor(this.rng() * C.GOODS.length)], cost: 0 }));
      const m = { id: this.nid('m'), kind: 'mercante', x, y, from: from.id, to: to.id, hold, casco: C.MERCHANT.casco, tripulacion: C.MERCHANT.tripulacion };
      this.merchants.push(m);
      return m;
    }
    return null;
  }

  spawnFrigate() {
    let tiles = this.freeSeaTiles(4);
    if (!tiles.length) tiles = this.freeSeaTiles(2);
    if (!tiles.length) return null;
    const [x, y] = tiles[Math.floor(this.rng() * tiles.length)];
    const f = { id: this.nid('f'), kind: 'fragata', x, y, casco: C.FRIGATE.casco, tripulacion: C.FRIGATE.tripulacion, wp: null };
    this.frigates.push(f);
    return f;
  }

  // Primer paso hacia el destino más cercano (ruta por mar, evitando barcos y con coste de arrecifes).
  routeStep(s, goals) {
    const goalSet = new Set(goals.map(([x, y]) => M.key(x, y)));
    if (goalSet.has(M.key(s.x, s.y))) return null;
    const dist = new Map([[M.key(s.x, s.y), 0]]);
    const first = new Map();
    const open = [[0, s.x, s.y]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, x, y] = open.shift();
      if (d > dist.get(M.key(x, y))) continue;
      if (goalSet.has(M.key(x, y))) return first.get(M.key(x, y));
      for (const [nx, ny] of this.stepsFrom(s, x, y)) {
        if (this.occupied(nx, ny, s.id)) continue;
        const nd = d + this.map.stepCost(nx, ny);
        const k = M.key(nx, ny);
        if (dist.has(k) && dist.get(k) <= nd) continue;
        dist.set(k, nd);
        first.set(k, first.get(M.key(x, y)) || [nx, ny]);
        open.push([nd, nx, ny]);
      }
    }
    return null;
  }

  // Avanza con un presupuesto de movimiento; onStep puede detener el avance.
  advance(s, goals, mp, onStep) {
    while (mp > 0) {
      const step = this.routeStep(s, goals);
      if (!step) return mp;
      const cost = this.map.stepCost(step[0], step[1]);
      if (cost > mp) return mp;
      s.x = step[0];
      s.y = step[1];
      mp -= cost;
      if (onStep && onStep()) return mp;
    }
    return mp;
  }

  startNeutral() {
    this.neutral = ['mercantes', ...this.frigates.map((f) => `fragata:${f.id}`), 'reapariciones', 'final'];
    this.runNeutral();
  }

  runNeutral() {
    while (this.neutral && this.neutral.length && !this.combat) {
      const step = this.neutral.shift();
      if (step === 'mercantes') this.moveMerchants();
      else if (step.startsWith('fragata:')) this.moveFrigate(step.slice(8));
      else if (step === 'reapariciones') this.respawn();
      else if (step === 'final') this.endRound();
    }
  }

  moveMerchants() {
    for (const m of [...this.merchants]) {
      const dest = this.map.ports[m.to];
      const goals = this.map.portExits(dest);
      this.advance(m, goals, C.MERCHANT.mov);
      if (cheb(m.x, m.y, dest.x, dest.y) === 1) {
        this.merchants = this.merchants.filter((x) => x !== m);
        this.say(T(`Un mercante descarga en ${dest.name}.`, `A merchant unloads at ${dest.name}.`), this.observers([m.x, m.y]));
      }
    }
  }

  pirateInSight(f) {
    const prey = this.players.filter((p) => p.docked === null && cheb(p.x, p.y, f.x, f.y) <= C.FRIGATE.vista);
    prey.sort((a, b) => cheb(a.x, a.y, f.x, f.y) - cheb(b.x, b.y, f.x, f.y));
    return prey[0] || null;
  }

  moveFrigate(id) {
    const f = this.frigates.find((x) => x.id === id);
    if (!f) return;
    let target = this.pirateInSight(f);
    let mp = C.FRIGATE.mov;
    if (!target) {
      // Patrulla: rumbo a un punto al azar del mar; si ve un pirata por el camino, va a por él.
      for (let i = 0; i < 3 && (!f.wp || (f.wp[0] === f.x && f.wp[1] === f.y)); i++) {
        const tiles = this.freeSeaTiles();
        f.wp = tiles[Math.floor(this.rng() * tiles.length)] || null;
      }
      if (f.wp) mp = this.advance(f, [f.wp], mp, () => !!this.pirateInSight(f));
      target = this.pirateInSight(f);
      if (!target && f.wp && cheb(f.x, f.y, f.wp[0], f.wp[1]) === 0) f.wp = null;
      if (!target) return;
    }
    const inRange = () => this.map.lineOfSight(f.x, f.y, target.x, target.y);
    if (!inRange()) {
      const goals = DIRS.map(([dx, dy]) => [target.x + dx, target.y + dy]).filter(([x, y]) => isNav(this.map.t(x, y)));
      this.advance(f, goals, mp, inRange);
    }
    if (inRange()) this.startCombat(f, target, 'canon', true);
  }

  respawn() {
    for (const r of this.respawns) r.rounds -= 1;
    const ready = this.respawns.filter((r) => r.rounds <= 0);
    this.respawns = this.respawns.filter((r) => r.rounds > 0);
    for (const r of ready) {
      if (r.kind === 'mercante') this.spawnMerchant();
      else this.spawnFrigate();
    }
    // Los mercantes que completan su ruta se sustituyen sin retraso.
    const target = C.MERCHANTS_BY_PLAYERS[this.order.length] || C.MERCHANTS_BY_PLAYERS[C.MAX_PLAYERS];
    const pending = this.respawns.filter((r) => r.kind === 'mercante').length;
    while (this.merchants.length + pending < target && this.spawnMerchant());
  }

  endRound() {
    this.neutral = null;
    if (this.players.some((p) => p.pl >= C.WIN_PL) || this.round >= C.MAX_ROUNDS) {
      this.finish();
      return;
    }
    this.round += 1;
    this.startTurn(0);
  }

  finish() {
    this.phase = 'fin';
    this.turn = null;
    const ranking = [...this.players].sort((a, b) => b.pl - a.pl || b.oro - a.oro || b.explored.length - a.explored.length);
    const top = ranking[0];
    const winners = ranking.filter((p) => p.pl === top.pl && p.oro === top.oro && p.explored.length === top.explored.length);
    this.final = {
      ranking: ranking.map((p) => ({ id: p.id, name: p.name, color: p.color, pl: p.pl, oro: p.oro, islas: p.explored.length })),
      winners: winners.map((p) => p.id),
    };
    this.say(T(`🏴‍☠️ Fin de la partida. ${winners.length > 1 ? 'Victoria compartida' : 'Gana'}: ${winners.map((p) => p.name).join(' y ')}.`,
      `🏴‍☠️ Game over. ${winners.length > 1 ? 'Shared victory' : 'Winner'}: ${winners.map((p) => p.name).join(' and ')}.`));
  }

  // ---------------------------------------------------------------- tiempo

  // Se llama cada segundo: aplica los plazos vencidos. Devuelve true si algo cambió.
  tick() {
    if (this.phase !== 'juego') return false;
    const now = this.now();
    const c = this.combat;
    if (c) {
      if (c.deadline !== null && now >= c.deadline) {
        for (const side of ['a', 'd']) {
          if (!c.picks[side]) {
            c.picks[side] = 'canon';
            const s = this.ship(c[side]);
            this.notify(s, T('Se acabó el tiempo: tu barco cañonea.', 'Time\'s up: your ship fires.'), 'info');
          }
        }
        this.resolveRound();
        return true;
      }
      return false;
    }
    if (this.offer) {
      if (now >= this.offer.deadline) {
        this.answerOffer(this.player(this.offer.to), false);
        return true;
      }
      return false;
    }
    if (this.turn && this.turn.deadline !== null && now >= this.turn.deadline) {
      const p = this.current();
      this.say(T(`Se acabó el tiempo de ${p ? p.name : 'turno'}.`, `Time's up for ${p ? p.name : 'the turn'}.`));
      this.endTurn();
      return true;
    }
    return false;
  }

  // ¿Este jugador tiene que hacer algo ahora mismo?
  needsAction(pid) {
    if (this.phase !== 'juego') return false;
    const c = this.combat;
    if (c) return (c.a === pid && !c.picks.a) || (c.d === pid && !c.picks.d);
    if (this.offer) return this.offer.to === pid;
    return !!this.turn && this.turn.pid === pid;
  }

  // ---------------------------------------------------------------- vista de cada jugador

  // Casillas alcanzables con el movimiento que queda, por terreno conocido.
  reachFor(p) {
    const mv = this.turn && this.turn.pid === p.id && this.turn.moving;
    if (!mv || this.combat || this.offer) return [];
    const known = (x, y) => p.known[y * C.SIZE + x];
    const blocked = (x, y) => this.shipsAtSea().some((s) => s.id !== p.id && s.x === x && s.y === y && this.sees(p, s));
    const best = new Map([[M.key(p.x, p.y), { d: 0, path: [] }]]);
    const open = [[0, p.x, p.y]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, x, y] = open.shift();
      const cur = best.get(M.key(x, y));
      if (d > cur.d) continue;
      for (const [nx, ny] of this.stepsFrom(p, x, y)) {
        if (!known(nx, ny) || blocked(nx, ny)) continue;
        const nd = d + this.map.stepCost(nx, ny);
        if (nd > mv.mp) continue;
        const k = M.key(nx, ny);
        if (best.has(k) && best.get(k).d <= nd) continue;
        best.set(k, { d: nd, path: [...cur.path, [nx, ny]] });
        open.push([nd, nx, ny]);
      }
    }
    best.delete(M.key(p.x, p.y));
    return [...best.values()].map((v) => ({ x: v.path[v.path.length - 1][0], y: v.path[v.path.length - 1][1], coste: v.d, path: v.path }));
  }

  shipView(s, viewer) {
    const base = { id: s.id, kind: s.kind, x: s.x, y: s.y, casco: s.casco, cascoMax: maxCasco(s), tripulacion: s.tripulacion };
    if (s.kind === 'pirata') {
      return { ...base, name: s.name, color: s.color, docked: s.docked, niveles: { ...s.niveles }, carga: s.hold.length };
    }
    if (s.kind === 'mercante') {
      const near = viewer && cheb(viewer.x, viewer.y, s.x, s.y) <= 1;
      return { ...base, destino: this.map.ports[s.to].name, carga: s.hold.length, cargamento: near ? countGoods(s.hold) : null, precios: near ? this.map.ports[s.to].prices : null };
    }
    return base;
  }

  combatView(c, pid) {
    if (!c) return null;
    const side = c.a === pid ? 'a' : c.d === pid ? 'd' : null;
    if (!side) return null;
    const S = { a: this.ship(c.a), d: this.ship(c.d) };
    const info = (s) => s && { ...this.shipView(s), name: this.shipName(s), nameEn: this.shipName(s, 'en'), canones: cannonDice(s), tripMax: maxCrew(s) };
    return {
      id: c.id,
      yo: side,
      ronda: c.ronda,
      a: info(S.a),
      d: info(S.d),
      dist: c.dist,
      eligio: !!c.picks[side],
      rivalEligio: !!c.picks[side === 'a' ? 'd' : 'a'],
      opciones: c.fin ? [] : this.combatOptions(c, side),
      maniobro: c.maniobro,
      ventaja: c.ventaja,
      historial: c.historial,
      fin: c.fin,
      nombres: c.nombres || null,
      deadlineIn: c.deadline ? Math.max(0, c.deadline - this.now()) : null,
    };
  }

  view(pid) {
    const me = this.player(pid);
    const base = {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      you: pid,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, local: !!p.local, connected: p.connected, pl: p.pl ?? 0 })),
      log: this.log.filter((l) => !l.to || l.to.includes(pid)).slice(-80),
      reglas: {
        size: C.SIZE, maxRounds: C.MAX_ROUNDS, winPL: C.WIN_PL, actions: C.ACTIONS_PER_TURN, levels: C.LEVELS,
        upgradeCost: C.UPGRADE_COST, repair: C.REPAIR_COST, recruit: C.RECRUIT_COST, goods: C.GOODS, goodLabel: C.GOOD_LABEL,
        goodValue: C.GOOD_VALUE, attrs: C.ATTRS, attrLabel: C.ATTR_LABEL, profitPerPL: C.PROFIT_PER_PL, terrainView: C.TERRAIN_VIEW, shipView: C.SHIP_VIEW,
      },
    };
    if (this.phase === 'lobby' || !me) return base;

    const S = C.SIZE;
    const tiles = [];
    for (let y = 0; y < S; y++) {
      const row = [];
      for (let x = 0; x < S; x++) {
        if (!me.known[y * S + x]) { row.push(null); continue; }
        const t = this.map.tiles[y][x];
        const cell = { t };
        if (t === 'tierra' || t === 'puerto') cell.isla = this.map.island[y][x];
        if (t === 'puerto') cell.puerto = this.map.portAt(x, y).id;
        row.push(cell);
      }
      tiles.push(row);
    }
    const ports = this.map.ports.filter((p) => me.known[p.y * S + p.x]).map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, isla: p.island, giro: p.rot || 0, precios: p.prices }));
    const visible = this.shipsAtSea().filter((s) => this.sees(me, s));
    const dockedHere = this.players.filter((p) => p.docked !== null && this.sees(me, p));
    const c = this.combat;
    if (c && (c.a === pid || c.d === pid)) {
      for (const id of [c.a, c.d]) {
        const s = this.ship(id);
        if (s && !visible.includes(s)) visible.push(s);
      }
    }
    const t = this.turn;
    const o = this.offer;
    return {
      ...base,
      round: this.round,
      order: this.order,
      turn: t && {
        pid: t.pid,
        actions: t.actions,
        moving: t.moving,
        deadlineIn: t.deadline !== null ? Math.max(0, t.deadline - this.now()) : null,
        left: t.left,
      },
      neutral: !!this.neutral,
      map: { size: S, tiles, ports, explored: me.explored },
      ships: [...new Set([...visible, ...dockedHere])].map((s) => this.shipView(s, me)),
      me: {
        id: me.id,
        name: me.name,
        color: me.color,
        pl: me.pl,
        oro: me.oro,
        casco: me.casco,
        cascoMax: maxCasco(me),
        tripulacion: me.tripulacion,
        tripMax: maxCrew(me),
        bodega: holdCap(me),
        carga: me.hold.length,
        mercancias: countGoods(me.hold),
        costes: C.GOODS.reduce((acc, g) => {
          const us = me.hold.filter((u) => u.g === g);
          acc[g] = us.length ? Math.round((us.reduce((a, u) => a + u.cost, 0) / us.length) * 10) / 10 : null;
          return acc;
        }, {}),
        niveles: { ...me.niveles },
        velas: lvl(me, 'velas'),
        canones: lvl(me, 'canones'),
        x: me.x,
        y: me.y,
        docked: me.docked,
        home: me.home,
        lastPort: me.lastPort,
        compradoAqui: me.visit ? me.visit.bought : [],
        netProfit: me.netProfit,
        siguientePL: (me.profitPL + 1) * C.PROFIT_PER_PL,
        explorables: this.explorableIslands(me),
        atracables: this.dockablePorts(me).map((p) => p.id),
        cerrados: this.blockedPorts(me).map((pt) => ({ id: pt.id, name: pt.name, rival: this.portRival(pt.id, me).name })),
        objetivos: this.targetsFor(me),
        reach: this.reachFor(me),
        avisos: me.avisos,
        ultimoCombate: me.lastCombat && this.combatView(me.lastCombat, pid),
      },
      combat: this.combatView(c, pid),
      combatOthers: c && c.a !== pid && c.d !== pid ? {
        a: T(this.shipName(this.ship(c.a)), this.shipName(this.ship(c.a), 'en')),
        d: T(this.shipName(this.ship(c.d)), this.shipName(this.ship(c.d), 'en')),
      } : null,
      offer: o && (o.from === pid || o.to === pid) ? { ...o, fromName: this.player(o.from).name, toName: this.player(o.to).name, deadlineIn: Math.max(0, o.deadline - this.now()) } : null,
      final: this.final,
    };
  }
}

module.exports = { Game, GameError, maxCasco, maxCrew, cannonDice, holdCap, countGoods };
