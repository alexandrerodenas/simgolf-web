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
   * Type de terrain (TileType enum 0-15).
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
   * Variation cosmétique (0..N) utilisée pour la sélection de texture
   * anti-répétition. Index dans la table de textures du thème.
   * Stockée à offset +0x240 dans le jeu original.
   */
  variation: number;
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
