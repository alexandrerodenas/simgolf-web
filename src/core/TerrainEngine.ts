/**
 * SimGolf Web — TerrainEngine
 *
 * Gère la grille de tuiles 64×64 avec accès O(1),
 * élévation, types de sol, murs et sérialisation.
 */
import { TileData, TileType, TileCorner, WallSide } from './types';

export class TerrainEngine {
  readonly width: number;
  readonly height: number;
  private tiles: (TileData | null)[][];

  constructor(width = 64, height = 64) {
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.initFlat();
  }

  // ================================================================
  // Accès
  // ================================================================

  tileAt(x: number, y: number): TileData | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y]?.[x] ?? null;
  }

  /** Voisin dans une direction (0=N, 1=E, 2=S, 3=W) */
  neighbor(x: number, y: number, dir: number): TileData | null {
    switch (dir) {
      case 0: return this.tileAt(x, y - 1);
      case 1: return this.tileAt(x + 1, y);
      case 2: return this.tileAt(x, y + 1);
      case 3: return this.tileAt(x - 1, y);
      default: return null;
    }
  }

  // ================================================================
  // Type
  // ================================================================

  setTileType(x: number, y: number, type: TileType, variation = 0): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    tile.type = type;
    tile.variation = variation;
  }

  getTileType(x: number, y: number): TileType | null {
    return this.tileAt(x, y)?.type ?? null;
  }

  // ================================================================
  // Élévation
  // ================================================================

  elevateCorner(x: number, y: number, corner: TileCorner): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    tile.elevation[corner] = Math.min(10, tile.elevation[corner] + 1);
    this.propagateAdjacent(x, y, corner);
  }

  lowerCorner(x: number, y: number, corner: TileCorner): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    tile.elevation[corner] = Math.max(0, tile.elevation[corner] - 1);
    this.propagateAdjacent(x, y, corner);
  }

  elevateTile(x: number, y: number): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    for (let i = 0; i < 4; i++) tile.elevation[i] = Math.min(10, tile.elevation[i] + 1);
  }

  lowerTile(x: number, y: number): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    for (let i = 0; i < 4; i++) tile.elevation[i] = Math.max(0, tile.elevation[i] - 1);
  }

  avgElevation(x: number, y: number): number {
    const tile = this.tileAt(x, y);
    if (!tile) return 0;
    return (tile.elevation[0] + tile.elevation[1] + tile.elevation[2] + tile.elevation[3]) / 4;
  }

  /** Propage l'élévation aux coins partagés des tuiles adjacentes */
  private propagateAdjacent(x: number, y: number, corner: TileCorner): void {
    const val = this.tileAt(x, y)?.elevation[corner];
    if (val === undefined) return;

    const mapping: Array<[number, number, TileCorner]> = [
      [0, 0, TileCorner.BOTTOM_RIGHT],  // TL → NO corner BR
      [-1, 0, TileCorner.BOTTOM_LEFT],  // TR → N corner BL
      [-1, -1, TileCorner.TOP_LEFT],    // BR → SO corner TL
      [0, -1, TileCorner.TOP_RIGHT],    // BL → W corner TR
    ];

    const [dx, dy, adjCorner] = mapping[corner];
    const adj = this.tileAt(x + dx, y + dy);
    if (adj) adj.elevation[adjCorner] = val;
  }

  // ================================================================
  // Murs
  // ================================================================

  setWall(x: number, y: number, side: WallSide, active: boolean): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    tile.walls[side] = active;
  }

  toggleWall(x: number, y: number, side: WallSide): void {
    const tile = this.tileAt(x, y);
    if (!tile) return;
    tile.walls[side] = !tile.walls[side];
  }

  // ================================================================
  // Initialisation
  // ================================================================

  initFlat(): void {
    const tiles: (TileData | null)[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: (TileData | null)[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push(this.defaultTile());
      }
      tiles.push(row);
    }
    this.tiles = tiles;
  }

  initRandom(seed = 42): void {
    const rng = this.simpleRng(seed);
    const tiles: (TileData | null)[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: (TileData | null)[] = [];
      for (let x = 0; x < this.width; x++) {
        const tile = this.defaultTile();
        for (let c = 0; c < 4; c++) tile.elevation[c] = Math.floor(rng() * 4);
        const r = rng();
        if (r > 0.95) tile.type = TileType.WATER;
        else if (r > 0.90) tile.type = TileType.SAND;
        row.push(tile);
      }
      tiles.push(row);
    }
    this.tiles = tiles;
  }

  clear(): void {
    this.initFlat();
  }

  // ================================================================
  // Sérialisation
  // ================================================================

  serialize(): TerrainSaveData {
    return {
      width: this.width,
      height: this.height,
      tiles: this.tiles.map(row =>
        row.map(t => t ? { ...t, elevation: [...t.elevation] as [number, number, number, number] } : null)
      ),
    };
  }

  static deserialize(data: TerrainSaveData): TerrainEngine {
    const engine = new TerrainEngine(data.width, data.height);
    engine.tiles = data.tiles;
    return engine;
  }

  // ================================================================
  // Helpers
  // ================================================================

  private defaultTile(): TileData {
    return {
      elevation: [0, 0, 0, 0],
      type: TileType.GRASS,
      variation: Math.floor(Math.random() * 9),
      walls: [false, false, false, false],
      building: null,
    };
  }

  private simpleRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0x100000000;
    };
  }
}

export interface TerrainSaveData {
  width: number;
  height: number;
  tiles: (TileData | null)[][];
}
