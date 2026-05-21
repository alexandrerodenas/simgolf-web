/**
 * Projection isométrique
 */
export const TILE_W = 128;
export const TILE_H = 64;
export const HEIGHT_SCALE = 32;

export function mapToScreen(x: number, y: number, h: number = 0): { screenX: number; screenY: number } {
  return {
    screenX: (x - y) * (TILE_W / 2),
    screenY: (x + y) * (TILE_H / 2) - h * HEIGHT_SCALE,
  };
}
