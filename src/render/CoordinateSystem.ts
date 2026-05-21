/**
 * Projection isométrique — conversion grille ↔ écran
 */

/** Largeur d'une tuile en pixels (base diamond) */
export const TILE_W = 128;
/** Hauteur d'une tuile en pixels (base diamond) */
export const TILE_H = 64;
/** Facteur d'échelle verticale pour l'élévation (hauteur → pixels) */
export const HEIGHT_SCALE = 32;

/**
 * Convertit une position grille (x, y) + hauteur (h) en pixels écran.
 */
export function mapToScreen(
  x: number, y: number, h: number = 0,
): { screenX: number; screenY: number } {
  return {
    screenX: (x - y) * (TILE_W / 2),
    screenY: (x + y) * (TILE_H / 2) - h * HEIGHT_SCALE,
  };
}
