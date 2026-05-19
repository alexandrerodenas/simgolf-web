/**
 * SimGolf Web — TerrainEngine
 *
 * Gère la grille de tuiles 64×64 + **heightmap (N+1)×(N+1)**.
 *
 * La heightmap est la source de vérité pour les hauteurs.
 * Chaque tile a 4 coins = 4 sommets partagés → continuité garantie.
 *
 * Modifier un sommet (setVertex / raiseVertex / lowerVertex) affecte
 * toutes les tuiles qui partagent ce sommet (jusqu'à 4).
 */
import { TileData, TileType, WallSide } from './types';

export class TerrainEngine {
  readonly width: number;
  readonly height: number;
  private tiles: (TileData | null)[][];
  /** Heightmap (height+1) × (width+1) — source de vérité pour l'altitude */
  private heightmap: number[][];

  constructor(width = 64, height = 64) {
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.heightmap = [];
    this.initFlat();
  }

  // ================================================================
  // Heightmap API
  // ================================================================

  /**
   * Hauteur d'un sommet (vertex). Retourne 0 hors limites.
   * vx, vy = coordonnées du sommet dans [0, width] × [0, height]
   */
  getVertex(vx: number, vy: number): number {
    if (vx < 0 || vx > this.width || vy < 0 || vy > this.height) return 0;
    return this.heightmap[vy]?.[vx] ?? 0;
  }

  /**
   * Modifie un sommet (clampé 0-10).
   */
  setVertex(vx: number, vy: number, h: number): void {
    if (vx < 0 || vx > this.width || vy < 0 || vy > this.height) return;
    this.heightmap[vy][vx] = Math.max(0, Math.min(10, Math.round(h)));
  }

  /**
   * Monte un sommet d'un cran.
   */
  raiseVertex(vx: number, vy: number): void {
    const cur = this.getVertex(vx, vy);
    if (cur < 10) this.setVertex(vx, vy, cur + 1);
  }

  /**
   * Descend un sommet d'un cran.
   */
  lowerVertex(vx: number, vy: number): void {
    const cur = this.getVertex(vx, vy);
    if (cur > 0) this.setVertex(vx, vy, cur - 1);
  }

  /**
   * Retourne les 4 hauteurs de coin d'une tuile : [TL, TR, BR, BL].
   * Lit depuis la heightmap partagée → toujours cohérent avec les voisins.
   */
  getTileCorners(tx: number, ty: number): [number, number, number, number] {
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) {
      return [0, 0, 0, 0];
    }
    return [
      this.getVertex(tx,     ty),      // TL
      this.getVertex(tx + 1, ty),      // TR
      this.getVertex(tx + 1, ty + 1),  // BR
      this.getVertex(tx,     ty + 1),  // BL
    ];
  }

  // ================================================================
  // Accès tiles (compatibilité)
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
  // Élévation (API legacy — agit sur la heightmap)
  // ================================================================

  /** Monte les 4 sommets de la tuile d'un cran */
  elevateTile(x: number, y: number): void {
    const corners = this.getTileCorners(x, y);
    for (let i = 0; i < 4; i++) {
      if (corners[i] < 10) {
        // On agit sur la heightmap directement
        this.setVertexFromCorner(x, y, i as 0|1|2|3, corners[i] + 1);
      }
    }
  }

  /** Descend les 4 sommets de la tuile d'un cran */
  lowerTile(x: number, y: number): void {
    const corners = this.getTileCorners(x, y);
    for (let i = 0; i < 4; i++) {
      if (corners[i] > 0) {
        this.setVertexFromCorner(x, y, i as 0|1|2|3, corners[i] - 1);
      }
    }
  }

  /** Modifie le sommet correspondant au coin `corner` de la tile (x, y) */
  private setVertexFromCorner(tx: number, ty: number, corner: 0|1|2|3, h: number): void {
    // Corner → offset vertex
    const offsets: Array<[number, number]> = [
      [0, 0],   // TL → (tx, ty)
      [1, 0],   // TR → (tx+1, ty)
      [1, 1],   // BR → (tx+1, ty+1)
      [0, 1],   // BL → (tx, ty+1)
    ];
    const [dx, dy] = offsets[corner];
    this.setVertex(tx + dx, ty + dy, h);
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
    // Heightmap plate (tout à 0)
    this.heightmap = [];
    for (let vy = 0; vy <= this.height; vy++) {
      const row: number[] = [];
      for (let vx = 0; vx <= this.width; vx++) {
        row.push(0);
      }
      this.heightmap.push(row);
    }

    // Grille de tiles
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
    this.initFlat();

    // Génère heightmap aléatoire
    for (let vy = 0; vy <= this.height; vy++) {
      for (let vx = 0; vx <= this.width; vx++) {
        this.heightmap[vy][vx] = Math.floor(rng() * 4);
      }
    }

    // Applique les types de sol
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tileAt(x, y);
        if (!tile) continue;
        const r = rng();
        if (r > 0.95) tile.type = TileType.WATER;
        else if (r > 0.90) tile.type = TileType.SAND;
      }
    }
  }

  clear(): void {
    this.initFlat();
  }

  /** Initialise la heightmap depuis les elevations stockées dans les tiles */
  rebuildHeightmapFromTiles(): void {
    for (let vy = 0; vy <= this.height; vy++) {
      for (let vx = 0; vx <= this.width; vx++) {
        this.heightmap[vy][vx] = 0;
      }
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tileAt(x, y);
        if (!tile) continue;
        // Chaque coin de tile met à jour le sommet correspondant
        const corners = this.getTileCorners(x, y);
        const newCorners = tile.elevation;
        for (let i = 0; i < 4; i++) {
          const vx = i === 0 || i === 3 ? x : x + 1;
          const vy = i < 2 ? y : y + 1;
          if (newCorners[i] > this.heightmap[vy][vx]) {
            this.heightmap[vy][vx] = newCorners[i];
          }
        }
      }
    }
  }

  // ================================================================
  // Sérialisation
  // ================================================================

  serialize(): TerrainSaveData {
    // Copie la heightmap dans les tiles pour la sérialisation
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tileAt(x, y);
        if (!tile) continue;
        tile.elevation = [...this.getTileCorners(x, y)];
      }
    }
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
    engine.rebuildHeightmapFromTiles();
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
