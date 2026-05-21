/** Types de terrain SimGolf — correspond aux 16 types du jeu original */
export enum TileType {
  Rough        = 0,
  Fairway      = 1,
  Green        = 2,
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

/** Thèmes de parcours */
export enum CourseTheme {
  Parkland  = 0,
  Links     = 1,
  Desert    = 2,
  Tropical  = 3,
}

/** Une tuile de terrain */
export interface Tile {
  x: number;
  y: number;
  type: TileType;
  elevation: [number, number, number, number]; // [TL, TR, BR, BL]
  variation: number; // index cosmétique 0..N
}

/** Données complètes du terrain */
export interface TerrainData {
  width: number;
  height: number;
  tiles: Tile[];
}
