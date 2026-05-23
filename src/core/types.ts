/**
 * core/types.ts — Structures de données du moteur SimGolf
 *
 * Source : REFERENCE_GUIDE.md §2.3 (Tile 584 octets du jeu original)
 * Seules les variables d'état nécessaires au rendu sont extraites.
 */

// ================================================================
// TileType — 16 valeurs du jeu original (offset +0x024)
// ================================================================
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
  // Types supplémentaires (présents dans le jeu original, certains thèmes seulement)
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

// ================================================================
// CourseTheme — thèmes visuels du jeu original (4 valeurs)
// ================================================================
export enum CourseTheme {
  Parkland  = 0,
  Links     = 1,
  Desert    = 2,
  Tropical  = 3,
}

// ================================================================
// IRenderPass — Une couche de texture superposée sur une tuile
//
// Le système Multi-Passes permet jusqu'à 4 textures superposées
// par cellule (Base + jusqu'à 3 bordures).
//
// Suffixe :
//   - Grass family : 'A'|'B'|'C'|'D'|'E' = géométrie d'élévation
//   - Non-grass    : 'A'|'B'|'C'|'D' = orientation de bordure
//     (N→A, E→B, S→C, W→D)
// ================================================================
export interface IRenderPass {
  /** Type de terrain pour cette passe */
  type: TileType;
  /** Variation cosmétique (0-indexed, spécifie un fichier texture) */
  variation: number;
  /**
   * Suffixe géométrique ou d'orientation pour la texture :
   *   - Grass : 'A'...'E' = élévation (plat → raide)
   *   - Non-grass : 'A' = base, 'B'|'C'|'D' = bordure E/S/W
   */
  suffix: string;
  /**
   * Sous-type pour les types qui en ont plusieurs (ex: SandBunker 1A-4A).
   *   - SandBunker : 0=A, 1=1A, 2=2A, 3=3A, 4=4A
   */
  subType?: number;

  /**
   * Quadrants à rendre depuis cette texture (0-3).
   * Tableau de 1 à 4 valeurs : [0]=NW, [1]=NE, [2]=SW, [3]=SE.
   * Si omis ou [0,1,2,3] = texture entière 64×64.
   * Ex: [0,1] = les 2 quadrants du haut (bordure Nord)
   */
  quadrants?: number[];

  /**
   * Pour les bordures droites (texture 0002) : direction de la bande
   * de 6 pixels à extraire sur l'arête externe, au lieu du quadrant
   * entier 32×32.
   */
  stripEdge?: 'N' | 'E' | 'S' | 'W';
}

// ================================================================
// ITile — État d'une tuile nécessaire au rendu
//
// Extrait du Tile 584 bytes original (offset 0x000-0x248).
// On ne retient que les champs nécessaires à la génération
// spatiale et au rendu. Les champs de gameplay seront ajoutés
// dans une phase ultérieure.
// ================================================================
export interface ITile {
  /** Position grille X */
  x: number;
  /** Position grille Y */
  y: number;

  /**
   * Type de terrain principal (TileType enum 0-15).
   * Pour la logique de jeu ; le rendu utilise renderPasses[].
   * Offset original : +0x024 (int32)
   */
  type: TileType;

  /**
   * Élévation aux 4 coins de la tuile.
   * Ordre : [TL, TR, BR, BL] (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
   * Plage : 0-4 (5 niveaux, contrainte écart max 1 entre coins adjacents)
   * Offset original : +0x000 (int32[4])
   */
  elevation: [number, number, number, number];

  /**
   * Variation cosmétique principale (0..N) utilisée pour la sélection de
   * texture anti-répétition. Stockée à offset +0x240 dans le jeu original.
   */
  variation: number;

  /**
   * Flags de la tuile. Bits 0-1 = orientation de bordure (N→0, E→1, S→2, O→3).
   * Offset original : +0x028 (int32)
   */
  tileFlags: number;

  /**
   * Sous-type pour les types qui en ont plusieurs (ex: SandBunker 1A-4A).
   * Correspond au typeEffect du setType() original.
   *   - SandBunker : 0=A, 1=1A, 2=2A, 3=3A, 4=4A
   */
  subType?: number;

  /**
   * Passes de rendu (1 à 4 couches superposées).
   *
   * - Pass 0 : Texture de base du type de terrain.
   * - Pass 1..3 : Textures de bordure (si le voisin est d'une famille
   *   différente et que le type possède des textures de transition).
   *
   * Rempli par computeRenderPasses() après génération ou édition du terrain.
   */
  renderPasses: IRenderPass[];
}

// ================================================================
// IMapState — État complet de la carte pour un thème donné
// ================================================================
export interface IMapState {
  /** Largeur de la grille en tuiles */
  width: number;
  /** Hauteur de la grille en tuiles */
  height: number;
  /** Thème visuel */
  theme: CourseTheme;
  /** Tableau row-major des tuiles (tiles[y * width + x]) */
  tiles: ITile[];
}

// ================================================================
// Constantes de projection spatiale (original : TILE_W=128, TILE_H=64)
// ================================================================

/**
 * Largeur d'une tuile en pixels dans la projection dimétrique 2:1.
 * Source : REFERENCE_GUIDE.md §4.2
 */
export const TILE_W = 128;

/**
 * Hauteur d'une tuile en pixels dans la projection dimétrique 2:1.
 * Source : REFERENCE_GUIDE.md §4.2
 */
export const TILE_H = 64;

/**
 * Facteur d'échelle verticale pour l'élévation.
 * Original : chaque niveau d'élévation = 32 pixels en projection écran.
 */
export const ELEVATION_SCALE = 32;

/**
 * Nombre de niveaux d'élévation (0-4).
 * Source : REFERENCE_GUIDE.md §3.3
 */
export const ELEVATION_LEVELS = 5;
