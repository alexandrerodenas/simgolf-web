/**
 * SimGolf Web — Constantes de jeu
 *
 * Valeurs calibrées d'après l'analyse RE du binaire original.
 */

export const GAME = {
  MAP_WIDTH: 64,
  MAP_HEIGHT: 64,
  START_CASH: {
    EASY: 100_000,
    MEDIUM: 50_000,
    HARD: 25_000,
  } as const,
} as const;

export const ECONOMY = {
  GREENS_FEE_PER_HOLE: 10,
  MEMBERSHIP_FEES: [50, 150, 500] as const,
  EMPLOYEE_SALARIES: {
    GROUNDSKEEPER: 100,
    RANGER: 80,
    CLUB_PRO: 120,
    CART_ATTENDANT: 60,
  } as const,
  MAINTENANCE_PER_TILE: 0.5,
} as const;

export const SCORING = {
  HOLE_PAR: [3, 4, 5] as const,
  HOLES_PER_ROUND: 18,
} as const;

export const AI = {
  CLUB_DISTANCES: {
    DRIVER: 200,
    WOOD: 150,
    LONG_IRON: 100,
    WEDGE: 50,
    PUTTER: 30,
  } as const,
  SKILL_LABELS: [
    'Power Hitter', 'Long Driver', 'Accurate Driver',
    'Accurate Irons', 'Accurate Putter', 'Draw Shot',
    'Fade Shot', 'High Backspin', 'Recovery', 'Unknown',
  ] as const,
  SKILL_MAX: 15,
} as const;

export const RENDER = {
  TILE_PIXEL_SIZE: 64,
  FULL_RENDER_ROWS: 31,
  FULL_RENDER_COLS: 31,
  CULLING_WINDOW: 50,
  TARGET_FPS: 30,
} as const;
