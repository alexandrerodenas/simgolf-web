/**
 * SimGolf Web — Types & Interfaces
 *
 * Structures de données basées sur l'analyse RE du binaire original.
 * Tile : 584 bytes dans le jeu → version allégée pour le port web.
 */

// ================================================================
// Terrain
// ================================================================

/** Types de tuiles identifiés dans le jeu original */
export enum TileType {
  GRASS       = 0,
  FAIRWAY     = 1,
  GREEN       = 2,
  SAND        = 3,
  WATER       = 4,
  PATH        = 5,
  TEE         = 6,
  BUILDING    = 7,
  TREE        = 8,
  BUSH        = 9,
  FLOWER      = 10,
  ROUGH       = 11,
  BRIDGE      = 12,
  HOLE        = 13,
  WATER_HAZARD = 14,
  EMPTY       = 15,
  ROCK        = 16,
}

/** Coins d'une tuile (ordre isométrique) */
export enum TileCorner {
  TOP_LEFT     = 0,
  TOP_RIGHT    = 1,
  BOTTOM_RIGHT = 2,
  BOTTOM_LEFT  = 3,
}

/** Direction des murs */
export enum WallSide {
  NORTH = 0,
  EAST  = 1,
  SOUTH = 2,
  WEST  = 3,
}

/** Données d'une tuile */
export interface TileData {
  /** Élévation des 4 coins (0-10) */
  elevation: [number, number, number, number];
  /** Type de terrain */
  type: TileType;
  /** Variation de texture (0 = par défaut) */
  variation: number;
  /** Murs autour de la tuile [N, E, S, W] */
  walls: [boolean, boolean, boolean, boolean];
  /** Bâtiment présent (null = aucun) */
  building: string | null;
}

// ================================================================
// Économie
// ================================================================

export enum ClubLevel {
  DAILY_FEE     = 0,
  COUNTRY       = 1,
  CHAMPIONSHIP  = 2,
}

export interface EconomyState {
  cash: number;
  profit: number;
  revenue: number;
  expenses: number;
  weekNumber: number;
  members: number;
  clubLevel: ClubLevel;
  totalHoles: number;
  employeeCount: number;
}

// ================================================================
// Golfeurs
// ================================================================

export interface GolferSkills {
  powerHitter: number;
  longDriver: number;
  accurateDriver: number;
  accurateIrons: number;
  accuratePutter: number;
  drawShot: number;
  fadeShot: number;
  highBackspin: number;
  recovery: number;
  unknown: number;
}

export interface ProGolfer {
  name: string;
  bodyType: number;
  skinColor: number;
  hat: number;
  shirtColor: number;
  pantsColor: number;
  skills: GolferSkills;
}

// ================================================================
// Physique / Tir
// ================================================================

export enum ClubType {
  DRIVER    = 0,
  WOOD      = 1,
  IRON      = 2,
  WEDGE     = 3,
  PUTTER    = 4,
  SAND_WEDGE = 5,
  CHIP      = 6,
}

export enum ShotType {
  NORMAL = 'normal',
  DRAW   = 'draw',
  FADE   = 'fade',
  HIGH   = 'high',
  LOW    = 'low',
}

export enum LieType {
  TEE     = 0,
  FAIRWAY = 1,
  ROUGH   = 2,
  SAND    = 3,
  GREEN   = 4,
  WATER   = 5,
}

export enum WindDirection {
  NONE    = 0,
  HEAD    = 1,
  TAIL    = 2,
  CROSS_L = 3,
  CROSS_R = 4,
}

export interface WindState {
  direction: WindDirection;
  speed: number;
}

export interface ShotParams {
  clubType: ClubType;
  power: number;
  aim: number;
  spin: ShotType;
  lie: LieType;
}

export interface ShotResult {
  distance: number;
  offline: number;
  success: boolean;
  fairwayHit: boolean;
  description: string;
}

// ================================================================
// Scoring
// ================================================================

export interface HoleResult {
  holeNumber: number;
  par: number;
  strokes: number;
  fairwayHit: boolean;
  greenInRegulation: boolean;
  putts: number;
}

export interface RoundStats {
  totalStrokes: number;
  totalPar: number;
  fairwaysHit: number;
  totalFairways: number;
  gir: number;
  totalPutts: number;
}

// ================================================================
// Configuration du jeu
// ================================================================

export enum Difficulty {
  EASY   = 0,
  MEDIUM = 1,
  HARD   = 2,
}

export interface GameConfig {
  difficulty: Difficulty;
  startCash: number;
  mapWidth: number;
  mapHeight: number;
}
