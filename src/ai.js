'use strict';

// Maniobras de los barcos que no maneja una persona: mercantes, fragatas y bots.
// Eligen sin conocer la elección del rival.

function aiPick(game, c, side) {
  const opts = game.combatOptions(c, side);
  const me = game.ship(c[side]);
  const foe = game.ship(c[side === 'a' ? 'd' : 'a']);
  const rng = game.rng;
  if (c.ventaja[side]) {
    if (opts.includes('abordaje') && wantsBoard(me, foe)) return 'abordaje';
    return 'canon';
  }
  if (opts.includes('maniobra')) {
    const chance = me.casco <= 2 ? 0.45 : me.kind === 'mercante' ? 0.3 : 0.2;
    if (c.ronda < 3 && rng() < chance) return 'maniobra';
  }
  if (opts.includes('abordaje') && wantsBoard(me, foe) && rng() < 0.7) return 'abordaje';
  return 'canon';
}

// Abordar compensa si el rival lleva carga y nuestra tripulación no es menor.
function wantsBoard(me, foe) {
  if (!foe || foe.kind === 'fragata') return false;
  const { holdCap } = require('./game');
  return (foe.hold || []).length > 0 && me.tripulacion >= foe.tripulacion && (me.hold || []).length < holdCap(me);
}

module.exports = { aiPick };
