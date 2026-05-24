/**
 * core/types.ts — Types du moteur SimGolf
 *
 * ⚠️ SOURCE DE VÉRITÉ : terrain-ts (simgolf-re/terrain-ts)
 * Tous les types de données sont réexportés depuis terrain-ts.
 * Les constantes de rendu propres à simgolf-web sont définies ici.
 */

// ── Réexport depuis terrain-ts (source de vérité absolue) ──
export {
  TileType,
  CourseTheme,
  TileFlags,
  type ITile,
  type IRenderPass,
  type ILightConfig,
  type IMapState,
  TERRAIN_FAMILY,
  MAX_VARIATION,
  TILE_W,
  TILE_H,
  ELEVATION_SCALE,
} from 'terrain-ts';

// ── Constantes de rendu (propres à simgolf-web) ──
// Le rendu Three.js/Canvas2D peut surcharger les valeurs de terrain-ts
// pour adapter l'échelle à l'affichage.

/** Largeur d'une tuile en pixels (projection dimétrique). */
export const RENDER_TILE_W = 128;

/** Hauteur d'une tuile en pixels (projection dimétrique). */
export const RENDER_TILE_H = 64;

/** Facteur d'échelle verticale pour l'élévation. */
export const RENDER_ELEVATION_SCALE = 32;

/** Nombre de niveaux d'élévation (0-4). */
export const ELEVATION_LEVELS = 5;
