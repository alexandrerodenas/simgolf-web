/**
 * index.ts — Point d'entrée de terrain-ts
 *
 * Exporte l'intégralité de l'API publique de Terrain.dll
 * en TypeScript, prête à l'emploi.
 */

export { Terrain, terrain, MAX_VARIATION, getGeometryType } from './terrain.js';
export { TERRAIN_FAMILY } from './autotile.js';
export { GLTileRenderer, type TileVertex } from './gl-renderer.js';
export { parseLightingConfig } from './lighting.js';
export { bezierSpline, cardinalSpline, isometricCircle } from './splines.js';
export {
  TileType,
  CourseTheme,
  TileFlags,
  TILE_W,
  TILE_H,
  ELEVATION_SCALE,
  type ITile,
  type IRenderPass,
  type ILightConfig,
  type IMapState,
} from './types.js';
