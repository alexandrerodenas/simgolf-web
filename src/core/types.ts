/** Types de terrain SimGolf */
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

export interface Tile {
  x: number; y: number;
  type: TileType;
  elevation: [number, number, number, number];
  variation: number;
}

export interface TerrainData {
  width: number; height: number;
  tiles: Tile[];
}
