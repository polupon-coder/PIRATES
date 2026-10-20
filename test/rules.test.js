'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/config');
const { GameMap, generateMap } = require('../src/map');
const { Game, maxCasco } = require('../src/game');
const { botStep } = require('../src/bot');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Mapa a medida: '.' mar, '~' arrecife, '#' tierra, 'P' puerto (islas = tierra conectada en cruz).
function customMap(rows) {
  const m = new GameMap(C.SIZE);
  const lines = rows.map((r) => r.padEnd(C.SIZE, '.'));
  while (lines.length < C.SIZE) lines.push('.'.repeat(C.SIZE));
  for (let y = 0; y < C.SIZE; y++) {
    for (let x = 0; x < C.SIZE; x++) {
      m.tiles[y][x] = { '.': 'mar', '~': 'arrecife', '#': 'tierra', P: 'puerto' }[lines[y][x]];
    }
  }
  let id = 0;
  for (let y = 0; y < C.SIZE; y++) {
    for (let x = 0; x < C.SIZE; x++) {
      if (!['tierra', 'puerto'].includes(m.tiles[y][x]) || m.island[y][x] >= 0) continue;
      const cells = [];
      const stack = [[x, y]];
      m.island[y][x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (m.inside(nx, ny) && ['tierra', 'puerto'].includes(m.tiles[ny][nx]) && m.island[ny][nx] < 0) {
            m.island[ny][nx] = id;
            stack.push([nx, ny]);
          }
        }
      }
      m.islands.push({ id, cells, port: null });
      id++;
    }
  }
  for (let y = 0; y < C.SIZE; y++) {
    for (let x = 0; x < C.SIZE; x++) {
      if (m.tiles[y][x] !== 'puerto') continue;
      const prices = Object.fromEntries(C.GOODS.map((g) => [g, { vende: C.GOOD_VALUE[g], compra: C.GOOD_VALUE[g] + 1 }]));
      const port = { id: m.ports.length, name: `Puerto ${m.ports.length}`, x, y, island: m.island[y][x], prices };
      m.islands[port.island].port = port.id;
      m.ports.push(port);
    }
  }
  return m;
}

// Partida de 2 jugadores humanos sobre un mapa a medida, sin barcos neutrales.
function setup(rows, { rng = seeded(1), now } = {}) {
  const g = new Game('T', { rng, now });
  const a = g.addPlayer('Ana');
  const b = g.addPlayer('Beto');
  g.start();
  g.map = customMap(rows);
  g.merchants = [];
  g.frigates = [];
  g.order = [a.id, b.id];
  for (const p of [a, b]) p.known.fill(0);
  g.startTurn(0);
  return { g, a, b };
}

function place(g, p, x, y) {
  p.x = x;
  p.y = y;
  p.docked = null;
  p.visit = null;
  g.reveal(p);
}

// Dados trucados: cada llamada a rng devuelve el siguiente valor de la lista (6 → 0.99, 1 → 0).
const D = (...faces) => faces.map((f) => (f - 1) / 6 + 0.01);
function rigDice(g, faces) {
  const vals = D(...faces);
  let i = 0;
  g.rng = () => (i < vals.length ? vals[i++] : 0);
}

test('el mapa generado cumple el reglamento', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const n = 2 + (seed % 3);
    const m = generateMap(seeded(seed), n);
    assert.ok(m.islands.length >= C.ISLANDS[0] && m.islands.length <= C.ISLANDS[1], 'número de islas');
    assert.strictEqual(m.ports.length, C.PORTS);
    assert.strictEqual(new Set(m.ports.map((p) => p.island)).size, C.PORTS, 'un puerto por isla');
    assert.ok(m.seaConnected(), 'mar conectado');
    for (const p of m.ports) assert.ok(m.portExits(p).length > 0, 'el puerto da al mar');
    // El muelle (abajo en la lámina, girado) da a una casilla de mar.
    for (const p of m.ports) {
      const [dx, dy] = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[p.rot];
      assert.ok(['mar', 'arrecife'].includes(m.t(p.x + dx, p.y + dy)), 'muelle hacia el mar');
    }
    assert.strictEqual(m.starts.length, n);
    for (const s of m.starts) {
      for (const t of m.starts) if (s !== t) assert.ok(m.portDistance(m.ports[s], m.ports[t]) >= C.START_MIN_DIST);
    }
    // Las islas son grupos de tierra conectados en cruz: dos islas nunca se tocan en cruz.
    for (let y = 0; y < C.SIZE; y++) {
      for (let x = 0; x < C.SIZE - 1; x++) {
        const a = m.island[y][x];
        const b = m.island[y][x + 1];
        if (a >= 0 && b >= 0) assert.strictEqual(a, b);
      }
    }
  }
});

test('preparación: oro, barco y puerto inicial', () => {
  const g = new Game('T', { rng: seeded(3) });
  g.addPlayer('Ana');
  g.addPlayer('Beto');
  g.addPlayer('', { bot: true });
  g.start();
  for (const p of g.players) {
    assert.strictEqual(p.oro, 5);
    assert.strictEqual(p.casco, 4);
    assert.strictEqual(p.tripulacion, 1);
    assert.strictEqual(p.docked, p.home);
    assert.strictEqual(p.lastPort, p.home);
  }
  assert.strictEqual(new Set(g.players.map((p) => p.home)).size, 3);
  assert.strictEqual(g.merchants.length, 3);
  assert.strictEqual(g.frigates.length, 1);
  assert.strictEqual(g.turn.actions, 3);
});

test('navegación: velas, arrecifes, esquinas y barcos', () => {
  const { g, a, b } = setup([
    '......',
    '.#....',
    '#.~...',
    '......',
  ]);
  place(g, a, 0, 1);
  place(g, b, 5, 5);
  g.act(a.id, 'navegar');
  assert.strictEqual(g.turn.actions, 2);
  assert.strictEqual(g.turn.moving.mp, 3);
  // (0,1) → (1,2) cruza la esquina cerrada por (1,1) y (0,2): prohibido.
  assert.throws(() => g.act(a.id, 'mover', { path: [[1, 2]] }), /No puedes navegar ahí/);
  // Por arriba: (0,0) 1 punto, (1,0) 1 punto; el arrecife (2,2) ya no se alcanza desde ahí.
  g.act(a.id, 'mover', { path: [[0, 0], [1, 0]] });
  assert.deepStrictEqual([a.x, a.y, g.turn.moving.mp], [1, 0, 1]);
  g.act(a.id, 'mover', { path: [[2, 1], [2, 2]] });
  // Solo avanza a (2,1): el arrecife cuesta 2 y no queda.
  assert.deepStrictEqual([a.x, a.y], [2, 1]);
  assert.strictEqual(g.turn.moving, null);
  // Otro barco en el mar bloquea la casilla.
  g.act(a.id, 'navegar');
  place(g, b, 3, 1);
  assert.throws(() => g.act(a.id, 'mover', { path: [[3, 1]] }), /No puedes navegar ahí/);
  // Al moverse descubre el 3 × 3.
  assert.strictEqual(a.known[0 * C.SIZE + 3], 1);
  assert.strictEqual(a.known[5 * C.SIZE + 5], 0);
});

test('atracar: gratis, sin volver al último puerto y salir navegando', () => {
  const { g, a, b } = setup([
    '..........',
    '.P......P.',
    '..........',
  ]);
  place(g, b, 9, 9);
  a.lastPort = 0;
  place(g, a, 2, 2);
  assert.deepStrictEqual(g.dockablePorts(a).map((p) => p.id), []);
  assert.throws(() => g.act(a.id, 'atracar', { port: 0 }), /último puerto/);
  place(g, a, 7, 2);
  g.act(a.id, 'atracar', { port: 1 });
  assert.strictEqual(a.docked, 1);
  assert.strictEqual(g.turn.actions, 3, 'atracar no gasta acción');
  // Salir: la primera casilla de mar cuesta movimiento normal.
  g.act(a.id, 'navegar');
  g.act(a.id, 'mover', { path: [[8, 2], [8, 3]] });
  assert.strictEqual(a.docked, null);
  assert.strictEqual(g.turn.moving.mp, 1);
  // Volver a B sin pasar por otro puerto no vale; a A sí.
  assert.throws(() => g.act(a.id, 'atracar', { port: 1 }), /No puedes volver|Tienes que estar/);
  place(g, a, 2, 2);
  g.act(a.id, 'atracar', { port: 0 });
  assert.strictEqual(a.docked, 0);
});

test('comercio en puerto: beneficio neto, umbrales de PL y no revender', () => {
  const { g, a, b } = setup(['.P........']);
  place(g, b, 9, 9);
  g.dock(a, 0);
  a.oro = 50;
  // Puerto 0 compra (vende) comida a 2 y la vende (compra) a 3.
  g.act(a.id, 'comerciar', { comprar: { comida: 3 } });
  assert.strictEqual(a.oro, 41);
  assert.throws(() => g.act(a.id, 'comerciar', { vender: { comida: 1 } }), /revender/);
  // En otro puerto la comida se paga a 8: beneficio 5 por unidad.
  g.map.ports[0].prices.comida.vende = 8;
  a.visit.bought = [];
  g.act(a.id, 'comerciar', { vender: { comida: 2 } });
  assert.strictEqual(a.netProfit, 10);
  assert.strictEqual(a.pl, 2, '10 de beneficio = 2 PL');
  // Una pérdida no quita PL ni deja volver a cobrar el mismo umbral.
  g.map.ports[0].prices.comida.vende = 0;
  g.turn.actions = 3;
  g.act(a.id, 'comerciar', { vender: { comida: 1 } });
  assert.strictEqual(a.netProfit, 7);
  assert.strictEqual(a.pl, 2);
  a.hold.push({ g: 'lujos', cost: 0 });
  g.map.ports[0].prices.lujos.vende = 2;
  g.act(a.id, 'comerciar', { vender: { lujos: 1 } });
  assert.strictEqual(a.netProfit, 9);
  assert.strictEqual(a.pl, 2, 'aún no supera 12');
  // Bodega llena.
  g.turn.actions = 3;
  assert.throws(() => g.act(a.id, 'comerciar', { comprar: { lujos: 7 } }), /bodega/);
});

test('mejoras, reparar y reclutar', () => {
  const { g, a, b } = setup(['.P........']);
  place(g, b, 9, 9);
  g.dock(a, 0);
  a.oro = 30;
  a.casco = 2;
  g.act(a.id, 'mejorar', { attr: 'casco' });
  assert.strictEqual(maxCasco(a), 6);
  assert.strictEqual(a.casco, 4, 'suma la diferencia sin reparar daños');
  assert.strictEqual(a.oro, 25);
  g.act(a.id, 'reparar', { n: 2 });
  assert.strictEqual(a.casco, 6);
  assert.strictEqual(a.oro, 23);
  assert.throws(() => g.act(a.id, 'reparar', { n: 1 }), /Cantidad/);
  g.act(a.id, 'mejorar', { attr: 'tripulacion' });
  assert.strictEqual(a.tripulacion, 2);
  assert.throws(() => g.act(a.id, 'mejorar', { attr: 'velas' }), /No te quedan acciones/);
  g.turn.actions = 3;
  a.tripulacion = 0;
  g.act(a.id, 'reclutar', { n: 2 });
  assert.strictEqual(a.tripulacion, 2);
  assert.strictEqual(a.oro, 14);
  // En el mar no se puede.
  place(g, a, 3, 3);
  assert.throws(() => g.act(a.id, 'reparar', { n: 1 }), /atracado/);
});

test('explorar: una vez por isla y resultado', () => {
  const { g, a, b } = setup(['..........', '..##......']);
  place(g, b, 9, 9);
  place(g, a, 1, 0);
  assert.deepStrictEqual(g.explorableIslands(a), [0]);
  g.rng = () => 0.1; // 10 → tesoro; luego oro mínimo
  g.act(a.id, 'explorar', { island: 0 });
  assert.strictEqual(a.pl, 3);
  assert.ok(a.oro >= 5 + 3);
  assert.throws(() => g.act(a.id, 'explorar', { island: 0 }), /No hay ninguna isla/);
});

test('el peligro puede hundir el barco: vuelve a su puerto', () => {
  const { g, a, b } = setup(['.P........', '..........', '.....#....']);
  place(g, b, 9, 9);
  a.home = 0;
  a.lastPort = 0;
  place(g, a, 4, 1);
  a.casco = 1;
  a.hold = [{ g: 'comida', cost: 2 }, { g: 'lujos', cost: 5 }, { g: 'comida', cost: 2 }];
  const island = g.map.island[2][5];
  g.rng = () => 0.7; // 70 → peligro
  g.act(a.id, 'explorar', { island });
  assert.strictEqual(a.docked, 0);
  assert.strictEqual(a.casco, 4);
  assert.strictEqual(a.hold.length, 1, 'pierde la mitad redondeando hacia arriba');
});

test('combate: cañonear contra maniobrar y ventaja táctica', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 2, 2);
  place(g, b, 4, 2);
  g.act(a.id, 'atacar', { id: b.id, modo: 'canon' });
  assert.ok(g.combat);
  assert.deepStrictEqual(g.combatOptions(g.combat, 'd'), ['canon', 'maniobra'], 'a distancia 2 no se aborda');
  rigDice(g, [6, 5]);
  g.act(b.id, 'maniobra', { eleccion: 'maniobra' });
  assert.strictEqual(b.casco, 3, '2 impactos, la maniobra anula 1');
  assert.strictEqual(g.combat.ventaja.d, true);
  assert.throws(() => g.act(b.id, 'maniobra', { eleccion: 'maniobra' }), /Maniobra no válida/);
  // Asalto 2: ambos cañonean; B tira 3 dados por la ventaja.
  rigDice(g, [1, 1, 6, 6, 6]);
  g.act(a.id, 'maniobra', { eleccion: 'canon' });
  g.act(b.id, 'maniobra', { eleccion: 'canon' });
  assert.strictEqual(a.casco, 1);
  assert.strictEqual(g.combat.historial[1].tiradas.d.dados.length, 3);
  assert.strictEqual(g.combat.ventaja.d, false);
  // Asalto 3 sin daños: termina el combate.
  rigDice(g, [1, 1, 1, 1]);
  g.act(a.id, 'maniobra', { eleccion: 'canon' });
  g.act(b.id, 'maniobra', { eleccion: 'canon' });
  assert.strictEqual(g.combat, null);
  assert.strictEqual(a.lastCombat.fin.motivo, 'asaltos');
  assert.strictEqual(g.turn.actions, 2, 'el defensor no gasta acciones; el turno sigue');
});

test('abordaje: empate a favor del defensor, captura y pérdida de marinero', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 2, 2);
  place(g, b, 3, 2);
  b.hold = [{ g: 'lujos', cost: 5 }, { g: 'comida', cost: 2 }, { g: 'manufacturas', cost: 4 }];
  g.act(a.id, 'atacar', { id: b.id, modo: 'abordaje' });
  rigDice(g, [6, 6]); // A 1 éxito, B 1 éxito → empate → gana el defensor
  g.act(b.id, 'maniobra', { eleccion: 'abordaje' });
  assert.strictEqual(g.combat, null);
  assert.strictEqual(a.tripulacion, 0);
  assert.strictEqual(b.tripulacion, 1);
  assert.strictEqual(b.hold.length, 3, 'A no lleva carga que capturar');
  // Con tripulación, A gana y captura las 2 más valiosas a coste 0.
  a.tripulacion = 1;
  g.turn.actions = 3;
  g.act(a.id, 'atacar', { id: b.id, modo: 'abordaje' });
  rigDice(g, [6, 1]);
  g.act(b.id, 'maniobra', { eleccion: 'abordaje' });
  assert.deepStrictEqual(a.hold.map((u) => [u.g, u.cost]), [['lujos', 0], ['manufacturas', 0]]);
  assert.strictEqual(b.tripulacion, 0);
});

test('cañonear contra abordar: dispara primero; el rechazo cuesta un marinero', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 2, 2);
  place(g, b, 3, 2);
  b.hold = [{ g: 'lujos', cost: 5 }];
  g.act(a.id, 'atacar', { id: b.id, modo: 'abordaje' });
  // B cañonea: 2 dados (6, 6) → 2 de daño a A; luego abordaje A 1 dado (1) contra B 1 dado (5).
  rigDice(g, [6, 6, 1, 5]);
  g.act(b.id, 'maniobra', { eleccion: 'canon' });
  assert.strictEqual(a.casco, 2);
  assert.strictEqual(a.tripulacion, 0);
  assert.ok(g.combat, 'un abordaje rechazado no termina el combate');
  assert.deepStrictEqual(g.combatOptions(g.combat, 'a'), ['canon', 'maniobra']);
});

test('hundir a un pirata: +2 PL y se lleva la mitad de su carga', () => {
  const { g, a, b } = setup(['.P........', '..........', '..........']);
  b.home = 0;
  place(g, a, 4, 2);
  place(g, b, 5, 2);
  b.casco = 1;
  b.hold = [{ g: 'lujos', cost: 5 }, { g: 'comida', cost: 2 }, { g: 'materiales', cost: 3 }];
  g.act(a.id, 'atacar', { id: b.id, modo: 'canon' });
  rigDice(g, [6, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  g.act(b.id, 'maniobra', { eleccion: 'canon' });
  assert.strictEqual(g.combat, null);
  assert.strictEqual(a.pl, 2);
  assert.strictEqual(b.hold.length, 1);
  assert.strictEqual(a.hold.length, 2);
  assert.ok(a.hold.every((u) => u.cost === 0));
  assert.strictEqual(b.docked, 0);
  assert.strictEqual(b.casco, 4);
});

test('los barcos atracados no pueden ser atacados', () => {
  const { g, a, b } = setup(['.P........']);
  g.dock(b, 0);
  place(g, a, 2, 1);
  assert.deepStrictEqual(g.targetsFor(a), []);
  assert.throws(() => g.act(a.id, 'atacar', { id: b.id, modo: 'canon' }), /Objetivo no válido/);
});

test('línea de tiro: la tierra intermedia la bloquea', () => {
  const { g } = setup(['..#.......', '..........']);
  assert.strictEqual(g.map.lineOfSight(1, 0, 3, 0), false);
  assert.strictEqual(g.map.lineOfSight(1, 1, 3, 1), true);
  assert.strictEqual(g.map.lineOfSight(1, 0, 3, 1), true, 'en salto de caballo basta un hueco');
  assert.strictEqual(g.map.lineOfSight(1, 0, 4, 0), false, 'más de 2 casillas');
});

test('comercio entre jugadores con aceptación', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 2, 2);
  place(g, b, 3, 3);
  a.hold = [{ g: 'lujos', cost: 4 }];
  b.oro = 9;
  g.act(a.id, 'proponer', { to: b.id, dar: { goods: { lujos: 1 } }, pedir: { oro: 6 } });
  assert.ok(g.offer);
  assert.throws(() => g.act(a.id, 'navegar'), /propuesta/);
  g.act(b.id, 'responder', { aceptar: true });
  assert.strictEqual(a.oro, 11);
  assert.strictEqual(b.oro, 3);
  assert.deepStrictEqual(b.hold, [{ g: 'lujos', cost: 4 }], 'conserva el coste histórico');
  assert.strictEqual(a.pl, 0, 'no da Leyenda comercial');
  assert.strictEqual(g.turn.actions, 2);
});

test('niebla: solo se ven los barcos cercanos y el terreno descubierto', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 1, 1);
  place(g, b, 8, 8);
  const v = g.view(a.id);
  assert.ok(!v.ships.some((s) => s.id === b.id));
  assert.strictEqual(v.map.tiles[8][8], null);
  assert.ok(v.map.tiles[1][1]);
  place(g, b, 3, 3);
  assert.ok(g.view(a.id).ships.some((s) => s.id === b.id), 'a distancia 2 se ve');
});

test('plazos: el turno no tiene límite de tiempo y el combate cañonea a los 20 s', () => {
  let t = 0;
  const { g, a, b } = setup(['..........'], { now: () => t });
  g.startTurn(0);
  place(g, a, 2, 2);
  place(g, b, 3, 2);
  g.act(a.id, 'atacar', { id: b.id, modo: 'canon' });
  t += C.CHOICE_MS + 1;
  rigDice(g, [1, 1, 1, 1]);
  assert.ok(g.tick());
  assert.strictEqual(g.combat.ronda, 2);
  assert.strictEqual(g.combat.historial[0].picks.d, 'canon');
  g.combat = null;
  g.resumeTurn();
  t += 3600 * 1000;
  assert.ok(!g.tick());
  assert.strictEqual(g.turn.pid, a.id);
});

test('la Armada ataca a un pirata cercano en la fase neutral', () => {
  const { g, a, b } = setup(['..........']);
  place(g, a, 2, 2);
  place(g, b, 9, 9);
  g.frigates = [{ id: 'f1', kind: 'fragata', x: 4, y: 4, casco: 5, tripulacion: 2, wp: null }];
  g.endTurn();
  g.endTurn();
  assert.ok(g.combat, 'empieza el combate');
  assert.strictEqual(g.combat.a, 'f1');
  assert.strictEqual(g.combat.d, a.id);
  rigDice(g, Array(30).fill(1));
  for (let i = 0; i < 3 && g.combat; i++) g.act(a.id, 'maniobra', { eleccion: 'canon' });
  assert.strictEqual(g.combat, null);
  assert.strictEqual(g.round, 2, 'la ronda avanza al terminar el combate');
});

test('partidas completas con bots terminan sin atascos', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const n = 2 + (seed % 3);
    const g = new Game('T', { rng: seeded(seed) });
    for (let i = 0; i < n; i++) g.addPlayer(`B${i}`, { bot: true });
    g.start();
    let steps = 0;
    while (g.phase !== 'fin') {
      let acted = false;
      for (const p of g.players) if (botStep(g, p)) acted = true;
      assert.ok(acted, `atasco en la ronda ${g.round}`);
      assert.ok(++steps < 20000, 'demasiados pasos');
      for (const p of g.players) {
        assert.ok(p.hold.length <= C.LEVELS.bodega[p.niveles.bodega - 1], 'bodega');
        assert.ok(p.casco > 0 && p.casco <= maxCasco(p), 'casco');
        assert.ok(p.oro >= 0, 'oro');
      }
    }
    assert.ok(g.round <= C.MAX_ROUNDS);
    assert.ok(g.final.winners.length >= 1);
    assert.ok(g.round === C.MAX_ROUNDS || g.players.some((p) => p.pl >= C.WIN_PL));
  }
});
