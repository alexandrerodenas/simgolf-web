/**
 * types.ts — Structures de données du moteur terrain SimGolf
 *
 * Port fidèle du struct Tile 584-octets original + types de support.
 * Source : Terrain.dll (Maxis/Firaxis 2001) — analyse rizin complète
 */

// ── Types de terrain (16 valeurs originales + extensions) ──
export enum TileType {
  Rough        = 0,
  Fairway      = 1,
  PuttingGreen = 2,
  SandBunker   = 3,
  WaterShallow = 4,
  WaterMiddle  = 5,
  WaterDeep    = 6,
  DeepRough    = 7,
  GrassySand   = 8,
  GrassBunker  = 9,
  Tee          = 10,
  Cliff        = 11,
  Path         = 12,
  Building     = 13,
  Tree         = 14,
  Flower       = 15,
  Rock         = 16,
  Marsh        = 17,
  Overgrowth   = 18,
  FirmFairway  = 19,
  PotSandBunker= 20,
  ZenSand      = 21,
  TrickyGreen  = 22,
  Bridge       = 23,
  Ravine       = 24,
  RetainingWall= 25,
  Flowerbed    = 26,
  Natural      = 27,
  Vegetation   = 28,
  Brush        = 29,
}

// ── Thèmes de parcours ──
export enum CourseTheme {
  Parkland = 0,
  Links    = 1,
  Desert   = 2,
  Tropical = 3,
}

// ── Nouveau tile 64×64 dans la projection dimétrique ──
export const TILE_W = 64;
export const TILE_H = 32;
export const ELEVATION_SCALE = 16;

// ─── Tile — Port du struct original (584 octets) ───
export interface ITile {
  /** Position dans la grille */
  x: number;
  y: number;

  /** Élévation aux 4 coins : [TL, TR, BR, BL] — offset +0x000 */
  elevation: [number, number, number, number];

  /** Type de terrain principal — offset +0x024 */
  type: TileType;

  /** Flags bitmask — offset +0x028 */
  flags: TileFlags;

  /** Variation cosmétique (0..N) — offset +0x240 */
  variation: number;

  /**
   * État du mur par direction : [N, E, S, W].
   * Offsets +0x1E0 à +0x1E3 (bool[4])
   */
  walls: [boolean, boolean, boolean, boolean];

  /**
   * Sous-type / typeEffect pour les types à variantes
   * (SandBunker 1A-4A, etc.)
   */
  subType: number;

  /** Passe de rendu calculée */
  renderPasses: IRenderPass[];
}

export enum TileFlags {
  None         = 0,
  /** Bordure vers un type de famille différente */
  BorderN      = 1 << 0,
  BorderE      = 1 << 1,
  BorderS      = 1 << 2,
  BorderW      = 1 << 3,
  /** A un chemin */
  HasPath      = 1 << 4,
  /** Mur présent */
  WallN        = 1 << 8,
  WallE        = 1 << 9,
  WallS        = 1 << 10,
  WallW        = 1 << 11,
}

// ─── RenderPass ───
export interface IRenderPass {
  type: TileType;
  /** Index de variation (0 = texture 0001) */
  variation: number;
  /** Suffixe géométrique 'A'|'B'|'C'|'D'|'E' */
  suffix: string;
  subType?: number;
  /** Quadrants [0-3] à rendre depuis cette texture */
  quadrants?: number[];
  stripEdge?: 'N' | 'E' | 'S' | 'W';
}

// ─── Config d'éclairage (depuis les .txt) ───
export interface ILightConfig {
  ambient: [number, number, number, number];
  diffuse: [number, number, number, number];
  lightDir: [number, number, number];
}

// ─── État complet de la carte ───
export interface IMapState {
  width: number;
  height: number;
  theme: CourseTheme;
  tiles: ITile[];
  lighting: ILightConfig;
  zoomLevel: number;
  splineHeight: number;
}
