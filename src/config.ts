/**
 * SimGolf Web — Game Constants
 */
export const MAP_SIZE = 16;

export const TILE = {
  WIDTH: 64,   // Largeur visuelle du diamond
  HEIGHT: 32,  // Hauteur visuelle (ratio 2:1)
  DEPTH: 16,   // Pixels par niveau d'élévation
} as const;

export const GAME = {
  TARGET_FPS: 30,
  START_CASH: { EASY: 100_000, MEDIUM: 50_000, HARD: 25_000 },
} as const;

export const THEMES = ['Desert', 'Links', 'Parkland', 'Tropical'] as const;
export type Theme = typeof THEMES[number];
