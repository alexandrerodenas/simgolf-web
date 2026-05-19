/**
 * TerrainGenerator — Génération de terrain naturel.
 *
 * Pipeline complet :
 *   1. Bruit fractal 2D (permutation table, 5 octaves)
 *   2. Quantification (arrondi entier 0..10)
 *   3. Lissage (|voisin − courant| ≤ 1)
 *   4. Classification (eau, sable, herbe)
 *   5. Végétation (arbres, buissons, fleurs)
 */

import { TerrainEngine } from './TerrainEngine';
import { TileType } from './types';

export class TerrainGenerator {

  generateNatural(terrain: TerrainEngine, seed?: number): void {
    const rng = seed !== undefined ? this.seededRng(seed) : () => Math.random();
    terrain.initFlat();

    // 1. Bruit fractal → heightmap (W+1)×(H+1)
    const raw = this.buildHeightGrid(terrain.width + 1, terrain.height + 1, rng);

    // 2. Quantifier
    const q = this.quantize(raw);

    // 3. Lisser
    const smoothed = this.clampSlope(q);

    // 4. Appliquer aux tuiles
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;
        tile.elevation = [smoothed[y][x], smoothed[y][x+1], smoothed[y+1][x+1], smoothed[y+1][x]];
      }
    }

    // 5. Classifier
    this.classify(terrain, rng);

    // 6. Végétation
    this.placeTrees(terrain, rng);
    this.placeUnderbrush(terrain, rng);
  }

  // ================================================================
  // Bruit fractal 2D
  // ================================================================

  private perm: number[] | null = null;

  private getPermutation(rng: () => number): number[] {
    if (!this.perm) {
      const p: number[] = Array.from({ length: 256 }, (_, i) => i);
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
      }
      this.perm = p.concat(p);
    }
    return this.perm;
  }

  private buildHeightGrid(w: number, h: number, rng: () => number): number[][] {
    const p = this.getPermutation(rng);
    const grid: number[][] = [];
    const baseScale = 12;
    const octaves = 5;
    const amplitudes = [1.0, 0.5, 0.25, 0.125, 0.0625];
    const frequencies = [1.0, 2.0, 4.0, 6.0, 10.0];

    for (let y = 0; y < h; y++) {
      grid[y] = [];
      for (let x = 0; x < w; x++) {
        let v = 0, ta = 0;
        for (let o = 0; o < octaves; o++) {
          v += this.smoothNoise(x * frequencies[o] / baseScale, y * frequencies[o] / baseScale, p) * amplitudes[o];
          ta += amplitudes[o];
        }
        grid[y][x] = ((v / ta) * 0.5 + 0.5) * 10;
      }
    }
    return grid;
  }

  private smoothNoise(x: number, y: number, perm: number[]): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const h = (ix: number, iy: number) => perm[perm[((ix % 256) + 256) % 256] + ((iy % 256) + 256) % 256] / 255;
    const n0 = h(ix, iy) * (1 - ux) + h(ix + 1, iy) * ux;
    const n1 = h(ix, iy + 1) * (1 - ux) + h(ix + 1, iy + 1) * ux;
    return n0 * (1 - uy) + n1 * uy;
  }

  // ================================================================
  // Quantification + lissage
  // ================================================================

  private quantize(raw: number[][]): number[][] {
    return raw.map(row => row.map(v => Math.max(0, Math.min(10, Math.round(v)))));
  }

  private clampSlope(grid: number[][]): number[][] {
    const h = grid.length, w = grid[0].length;
    const work = grid.map(r => [...r]);
    const maxPasses = 20;
    let changed = true, passes = 0;

    while (changed && passes < maxPasses) {
      changed = false; passes++;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cur = work[y][x];
          const neighbors = [
            y > 0 ? work[y-1][x] : cur,
            x < w-1 ? work[y][x+1] : cur,
            y < h-1 ? work[y+1][x] : cur,
            x > 0 ? work[y][x-1] : cur,
          ];
          for (const n of neighbors) {
            if (Math.abs(cur - n) > 1) {
              const avg = (cur + n) / 2;
              work[y][x] = cur > n ? Math.round(Math.min(cur - 1, avg + 0.5)) : Math.round(Math.max(cur + 1, avg - 0.5));
              changed = true;
              break;
            }
          }
        }
      }
    }
    return work;
  }

  // ================================================================
  // Classification
  // ================================================================

  private classify(terrain: TerrainEngine, rng: () => number): void {
    // Eau (altitude ≤ 1)
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;
        if (this.avg(tile.elevation) <= 1) {
          terrain.setTileType(x, y, TileType.WATER, 0);
          tile.elevation = [0, 0, 0, 0];
        }
      }
    }

    // Nettoyer eau isolée (2 passes)
    for (let p = 0; p < 2; p++) {
      for (let y = 1; y < terrain.height - 1; y++) {
        for (let x = 1; x < terrain.width - 1; x++) {
          const t = terrain.tileAt(x, y);
          if (!t || t.type !== TileType.WATER) continue;
          if (this.countNeighbors(terrain, x, y, TileType.WATER) < 2) {
            terrain.setTileType(x, y, TileType.GRASS, 0);
            t.elevation = [2, 2, 2, 2];
            t.variation = Math.floor(rng() * 9);
          }
        }
      }
    }

    // Plages de sable (altitude ≤ 3, voisin eau)
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile || tile.type !== TileType.GRASS) continue;
        const a = this.avg(tile.elevation);
        if (a <= 3 && this.countNeighbors(terrain, x, y, TileType.WATER) > 0) {
          terrain.setTileType(x, y, TileType.SAND, Math.floor(rng() * 5));
          tile.elevation = [a, a, a, a];
        }
      }
    }
  }

  // ================================================================
  // Végétation
  // ================================================================

  private placeTrees(terrain: TerrainEngine, rng: () => number): void {
    const n = 5 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const cx = 3 + Math.floor(rng() * (terrain.width - 6));
      const cy = 3 + Math.floor(rng() * (terrain.height - 6));
      const r = 2 + Math.floor(rng() * 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const t = terrain.tileAt(cx + dx, cy + dy);
          if (!t || t.type !== TileType.GRASS) continue;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d > r || rng() >= 0.6 * (1 - d/(r+1))) continue;
          terrain.setTileType(cx + dx, cy + dy, TileType.TREE, Math.floor(rng() * 9));
        }
      }
    }
    // Épars
    for (let y = 2; y < terrain.height - 2; y++) {
      for (let x = 2; x < terrain.width - 2; x++) {
        const t = terrain.tileAt(x, y);
        if (t && t.type === TileType.GRASS && rng() < 0.03) {
          terrain.setTileType(x, y, TileType.TREE, Math.floor(rng() * 9));
        }
      }
    }
  }

  private placeUnderbrush(terrain: TerrainEngine, rng: () => number): void {
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const t = terrain.tileAt(x, y);
        if (!t || t.type !== TileType.GRASS) continue;
        const r = rng();
        if (r < 0.02) terrain.setTileType(x, y, TileType.FLOWER, Math.floor(rng() * 5));
        else if (r < 0.05) terrain.setTileType(x, y, TileType.BUSH, Math.floor(rng() * 5));
      }
    }
  }

  // ================================================================
  // Helpers
  // ================================================================

  private avg(e: [number, number, number, number]): number {
    return (e[0] + e[1] + e[2] + e[3]) / 4;
  }

  private countNeighbors(t: TerrainEngine, x: number, y: number, type: TileType): number {
    let c = 0;
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const n = t.tileAt(x + dx, y + dy);
      if (n && n.type === type) c++;
    }
    return c;
  }

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => { state = (state * 1664525 + 1013904223) & 0x7fffffff; return state / 0x7fffffff; };
  }
}
