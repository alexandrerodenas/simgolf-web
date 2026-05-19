/**
 * SimGolf Web — Coordinate System
 *
 * Conversion bidirectionnelle entre coordonnées de la carte (x, y)
 * et coordonnées isométriques à l'écran (screenX, screenY).
 *
 * Le système isométrique utilisé est le "diamond" standard :
 *   - L'axe X de la carte va du coin haut vers le coin bas-droit
 *   - L'axe Y de la carte va du coin haut vers le coin bas-gauche
 *
 * Élévation : chaque niveau ajoute TILE.DEPTH pixels vers le haut.
 */

import { TILE, MAP_SIZE } from '../config';

/** Dimensions d'une tuile en pixels */
export const TILE_W = TILE.WIDTH;   // 64 — largeur du diamond
export const TILE_H = TILE.HEIGHT;  // 32 — hauteur du diamond
export const TILE_D = TILE.DEPTH;   // 16 — pixels par niveau d'altitude

/** Offset pour centrer la carte au démarrage */
export const ORIGIN_OFFSET_X = (MAP_SIZE * TILE_W) / 4;
export const ORIGIN_OFFSET_Y = TILE_H / 2;

// ================================================================
// Conversions
// ================================================================

/**
 * Carte → Écran (coin haut du diamond)
 *
 * @param mapX    Colonne sur la carte
 * @param mapY    Ligne sur la carte
 * @param elev    Élévation moyenne de la tuile (0-10)
 * @returns       { screenX, screenY } — coin haut du diamond à l'écran
 */
export function mapToScreen(
  mapX: number,
  mapY: number,
  elev = 0,
): { screenX: number; screenY: number } {
  const screenX = (mapX - mapY) * (TILE_W / 2);
  const screenY = (mapX + mapY) * (TILE_H / 2) - elev * TILE_D;
  return { screenX, screenY };
}

/**
 * Écran → Carte (approximatif, renvoie la tuile la plus proche)
 *
 * @param screenX  X à l'écran
 * @param screenY  Y à l'écran
 * @returns        { mapX, mapY } — coordonnées carte (flottantes)
 */
export function screenToMap(
  screenX: number,
  screenY: number,
): { mapX: number; mapY: number } {
  const mapX = screenX / TILE_W + screenY / TILE_H;
  const mapY = screenY / TILE_H - screenX / TILE_W;
  return { mapX, mapY };
}

// ================================================================
// Ordre de rendu (Painter's algorithm)
// ================================================================

/**
 * Compare deux tuiles pour l'ordre de rendu (arrière vers avant).
 * Les tuiles avec un Y plus petit (haut de la carte) sont rendues
 * en premier, puis celles avec un X plus petit (gauche).
 *
 * Tri stable pour le rendu isométrique :
 *   tuile A avant tuile B si A.y < B.y, ou (A.y === B.y && A.x < B.x)
 */
export function compareRenderOrder(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

// ================================================================
// Culling
// ================================================================

export interface Viewport {
  /** Coin haut-gauche à l'écran */
  screenX: number;
  screenY: number;
  /** Largeur / hauteur de la zone visible */
  width: number;
  height: number;
  /** Niveau de zoom (1 = normal, 0.5 = zoomé arrière, 2 = zoomé) */
  zoom: number;
}

/**
 * Calcule les tuiles visibles dans le viewport.
 * Ajoute une marge de 2 tuiles pour éviter le pop-in.
 *
 * @returns { minX, minY, maxX, maxY } — plage de tuiles visibles
 */
export function visibleTiles(
  viewport: Viewport,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const margin = 2;
  // Coin haut-gauche
  const tl = screenToMap(0, 0);
  // Coin bas-droit
  const br = screenToMap(viewport.width / viewport.zoom, viewport.height / viewport.zoom);

  return {
    minX: Math.max(0, Math.floor(Math.min(tl.mapX, br.mapX)) - margin),
    minY: Math.max(0, Math.floor(Math.min(tl.mapY, br.mapY)) - margin),
    maxX: Math.min(MAP_SIZE - 1, Math.ceil(Math.max(tl.mapX, br.mapX)) + margin),
    maxY: Math.min(MAP_SIZE - 1, Math.ceil(Math.max(tl.mapY, br.mapY)) + margin),
  };
}
