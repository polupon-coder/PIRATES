'use strict';

// PIRATAS — todas las tablas del reglamento V1.39. Para equilibrar el juego, se cambia aquí.

module.exports = {
  SIZE: 12,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  ISLANDS: [12, 15],
  // Tamaño de cada isla (casillas) y su probabilidad.
  ISLAND_SIZES: [[1, 0.25], [2, 0.3], [3, 0.3], [4, 0.15]],
  PORTS: 9,
  REEF_RATE: 0.1,
  START_MIN_DIST: 6,
  ACTIONS_PER_TURN: 3,
  MAX_ROUNDS: 15,
  WIN_PL: 12,

  // Visión: el terreno se descubre en 3 × 3 (radio 1). Los barcos se ven hasta el alcance
  // de los cañones (radio 2): si no, nunca se podría cañonear a distancia 2.
  TERRAIN_VIEW: 1,
  SHIP_VIEW: 2,

  // Tiempos (ms).
  TURN_MS: 90000,
  CHOICE_MS: 20000,
  OFFER_MS: 20000,

  START_GOLD: 5,

  ATTRS: ['velas', 'canones', 'casco', 'bodega', 'tripulacion'],
  ATTR_LABEL: { velas: 'Velas', canones: 'Cañones', casco: 'Casco', bodega: 'Bodega', tripulacion: 'Tripulación' },
  LEVELS: {
    velas: [3, 4, 5],
    canones: [2, 3, 4],
    casco: [4, 6, 8],
    bodega: [6, 9, 12],
    tripulacion: [1, 2, 3],
  },
  // Coste de pasar a nivel II y a nivel III.
  UPGRADE_COST: {
    velas: [6, 10],
    canones: [6, 10],
    casco: [5, 8],
    bodega: [4, 7],
    tripulacion: [5, 8],
  },
  REPAIR_COST: 1,
  RECRUIT_COST: 2,

  GOODS: ['comida', 'materiales', 'manufacturas', 'lujos'],
  GOOD_LABEL: { comida: 'Comida', materiales: 'Materiales', manufacturas: 'Manufacturas', lujos: 'Lujos' },
  GOOD_VALUE: { comida: 2, materiales: 3, manufacturas: 4, lujos: 5 },
  // Precio al que el puerto compra: valor base + [-1, +2]. Vende 1 oro más caro.
  PRICE_VAR: [-1, 2],
  PRICE_SPREAD: 1,
  PROFIT_PER_PL: 4,

  EXPLORE: [['tesoro', 25], ['mercancias', 35], ['peligro', 25], ['nada', 15]],
  TREASURE_GOLD: [3, 8],
  EXPLORE_GOODS: [1, 3],
  DANGER_DAMAGE: [1, 2],

  HIT_MIN: 5,
  COMBAT_ROUNDS: 3,
  CANNON_RANGE: 2,
  BOARD_CAPTURE: 2,

  MERCHANT: { casco: 3, canones: 1, tripulacion: 1, mov: 2, carga: [2, 4], capacidad: 6, respawn: 3, minRoute: 4 },
  MERCHANTS_BY_PLAYERS: { 2: 2, 3: 3, 4: 3 },
  FRIGATE: { casco: 5, canones: 3, tripulacion: 2, mov: 3, vista: 2, respawn: 4 },
  FRIGATES_BY_PLAYERS: { 2: 1, 3: 1, 4: 2 },

  PL: { tesoro: 3, mercante: 1, pirata: 2, fragata: 3 },

  PORT_NAMES: ['Tortuga', 'Port Royal', 'Nassau', 'Maracaibo', 'Cartagena', 'Portobelo', 'La Habana',
    'Santo Domingo', 'Campeche', 'Veracruz', 'San Juan', 'Barbados'],
  COLORS: ['#c0392b', '#2471a3', '#229954', '#d4ac0d'],
};
