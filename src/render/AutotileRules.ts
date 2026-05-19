/**
 * SimGolf Web — Autotile Rules
 *
 * Calcule les bits de voisinage pour l'autotiling :
 * chaque bit indique si le voisin est du même type.
 *
 * Bits : N(1), E(2), S(4), W(8) → 0-15
 *
 * Utilisé pour sélectionner la bonne variante de texture
 * (bordures, coins, transitions) entre types de terrain.
 */

import { TileType } from '../core/types';
import { TerrainEngine } from '../core/TerrainEngine';

// ================================================================
// Bits de voisinage
// ================================================================

export const NEIGHBOR_FLAGS = {
  NORTH: 1 << 0,  // 1
  EAST:  1 << 1,  // 2
  SOUTH: 1 << 2,  // 4
  WEST:  1 << 3,  // 8
} as const;

// Mapping direction → bit
const DIR_BIT = [1, 2, 4, 8]; // N, E, S, W

// ================================================================
// Règles de transition
// ================================================================

/**
 * Types qui forment des bordures franches entre eux :
 *   - Herbe ↔ Sable → net
 *   - Herbe ↔ Eau → net
 *   - Fairway ↔ Rough → progressif
 *   - Green ↔ Fairway → net
 *   - Eau ↔ Sable → plage (progressif)
 */
const HARD_TRANSITIONS = new Set<string>();

function transKey(a: TileType, b: TileType): string {
  return `${Math.min(a, b)}_${Math.max(a, b)}`;
}

function isHardTransition(a: TileType, b: TileType): boolean {
  return HARD_TRANSITIONS.has(transKey(a, b));
}

// Initialise les transitions dures
function initTransitions(): void {
  const hard: Array<[TileType, TileType]> = [
    [TileType.GRASS, TileType.WATER],
    [TileType.GRASS, TileType.SAND],
    [TileType.FAIRWAY, TileType.GREEN],
    [TileType.GREEN, TileType.ROUGH],
    [TileType.GRASS, TileType.PATH],
    [TileType.FAIRWAY, TileType.PATH],
    [TileType.FAIRWAY, TileType.SAND],
    [TileType.GREEN, TileType.SAND],
  ];
  for (const [a, b] of hard) {
    HARD_TRANSITIONS.add(transKey(a, b));
  }
}
initTransitions();

// ================================================================
// Calcul des voisins
// ================================================================

/**
 * Calcule le masque de voisinage (0-15) pour une tuile donnée.
 *
 * Un bit est à 1 si le voisin correspondant est du MÊME type.
 * Utilisé pour choisir la variante de texture adaptée.
 */
export function computeNeighborMask(
  terrain: TerrainEngine,
  x: number,
  y: number,
): number {
  const tile = terrain.tileAt(x, y);
  if (!tile) return 0;

  const type = tile.type;
  let mask = 0;

  for (let dir = 0; dir < 4; dir++) {
    const neighbor = terrain.neighbor(x, y, dir);
    if (neighbor && neighbor.type === type) {
      mask |= DIR_BIT[dir];
    }
  }

  return mask;
}

/**
 * Calcule le masque de transition : à 1 si le voisin est d'un type
 * qui forme une transition dure avec la tuile courante.
 */
export function computeTransitionMask(
  terrain: TerrainEngine,
  x: number,
  y: number,
): number {
  const tile = terrain.tileAt(x, y);
  if (!tile) return 0;

  let mask = 0;
  for (let dir = 0; dir < 4; dir++) {
    const neighbor = terrain.neighbor(x, y, dir);
    if (neighbor && isHardTransition(tile.type, neighbor.type)) {
      mask |= DIR_BIT[dir];
    }
  }

  return mask;
}

/**
 * Détermine si une tuile nécessite une bordure spéciale
 * (transition entre deux types incompatibles).
 */
export function needsBorder(
  terrain: TerrainEngine,
  x: number,
  y: number,
): boolean {
  return computeTransitionMask(terrain, x, y) !== 0;
}
