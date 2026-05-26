// ─── Types de terrain ───

export enum TileType {
  Rough          = 0,
  Fairway        = 1,
  PuttingGreen   = 2,
  SandBunker     = 3,
  WaterShallow   = 4,
  WaterMiddle    = 5,
  WaterDeep      = 6,
  DeepRough      = 7,
  GrassySand     = 8,
  GrassBunker    = 9,
  Tee            = 10,
  Cliff          = 11,
  Path           = 12,
  Bridge         = 13,
  Building       = 14,
  Tree           = 15,
  Flower         = 16,
  Rock           = 17,
  Ravine         = 18,
  Marsh          = 19,
  Overgrowth     = 20,
  Brush          = 21,
  Vegetation     = 22,
  Natural        = 23,
  ZenSand        = 24,
  FirmFairway    = 25,
  TrickyGreen    = 26,
  PotSandBunker  = 27,
  RetainingWall  = 28,
}

export enum CourseTheme {
  Parkland  = 0,
  Links     = 1,
  Desert    = 2,
  Tropical  = 3,
}

// ─── Tuile de terrain ───

export interface IRenderPass {
  type: TileType;
  variation: number;
  suffix: string;
  subType?: number;
  /** Mask 4-bit de transition (0-15), 15 = plein */
  mask?: number;
  /** 9 floats: x0,y0,z0, x1,y1,z1, x2,y2,z2 — positions 3D du triangle */
  vertexPositions: [number, number, number, number, number, number, number, number, number];
  /** 6 floats: U0,V0, U1,V1, U2,V2 — coordonnées UV */
  texCoordIndices: [number, number, number, number, number, number];
  /** Clé de texture pré-calculée */
  textureKey?: string;
  /** Passe de bordure (rendue par-dessus la base) */
  isOverlay?: boolean;
}

export enum TileFlags {
  None            = 0,
  // Bits 0-1: orientation (0=N, 1=E, 2=S, 3=W) — masque
  OrientMask      = 0x03,
  // Bits 4-7: border flags
  BorderN         = 1 << 4,
  BorderE         = 1 << 5,
  BorderS         = 1 << 6,
  BorderW         = 1 << 7,
  // Bit 8: HasPath
  HasPath         = 1 << 8,
  // Bits 12+: walls
  WallN           = 1 << 12,
  WallE           = 1 << 13,
  WallS           = 1 << 14,
  WallW           = 1 << 15,
}

export interface ITile {
  x: number;
  y: number;

  /** Élévation aux 4 coins : [TL, TR, BR, BL] — offset +0x000 */
  elevation: [number, number, number, number];

  /** Type de terrain principal — offset +0x024 */
  type: TileType;

  /** Flags bitmask — offset +0x028
   *  bits 0-1: orientation (0=N,1=E,2=S,3=W)
   *  bits 4-7: border flags (N/E/S/W)
   */
  flags: TileFlags;

  /** Variation cosmétique (0..N) — offset +0x240 */
  variation: number;

  /** État du mur par direction : [N, E, S, W] */
  walls: [boolean, boolean, boolean, boolean];

  /** Sous-type / typeEffect */
  subType: number;

  /** Passe de rendu calculée */
  renderPasses: IRenderPass[];

  /** ── NOUVEAUX CHAMPS (originaux tile+0x34/38/3c/40) ── */

  /** Orientation 0-3 (bits 0-1 de flags) */
  orientation: number;

  /** Pointeurs vers les tuiles voisines */
  neighborN: ITile | null;
  neighborS: ITile | null;
  neighborE: ITile | null;
  neighborW: ITile | null;

  /** Précédent chemin/décoration pour overlay — tile+0x208/0x20a */
  overlayPrev: number;
  overlayNext: number;

  /** Flags de post-process pour chemins — tile+0x234/0x236/0x238/0x23a */
  pathN: boolean;
  pathE: boolean;
  pathS: boolean;
  pathW: boolean;
}

// ─── Config d'éclairage ───

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
  /** Mode de vue DAT_10070a14 (0=normal, 1-3=rotation/réflexion) */
  viewMode: number;
}

// ─── Constantes de rendu ───

/** Taille d'une tuile vue du dessus (en unités 3D). */
export const TILE_W = 128;
export const TILE_H = 64;

/** Échelle verticale par niveau d'élévation. */
export const ELEVATION_SCALE = 32;
