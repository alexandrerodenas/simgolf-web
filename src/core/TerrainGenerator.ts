/**
 * TerrainGenerator — Génération de terrain tout herbe.
 *
 * Pipeline :
 *   1. Bruit fractal 2D → heightmap (W+1)×(H+1)
 *   2. Quantification (arrondi entier 0..10)
 *   3. Lissage (|voisin − courant| ≤ 1)
 *   4. Tout en GRASS (herbe) — seule l'élévation varie
 *
 * La heightmap est écrite directement dans TerrainEngine (source de vérité).
 * Conforme aux docs de simgolf-re (elevation-quantization.md).
 */

import { TerrainEngine } from './TerrainEngine';
import { TileType } from './types';

export class TerrainGenerator {

  /**
   * Génère un terrain 100% herbe avec variation d'élévation douce
   * et des arbres disposés en clusters naturels.
   * Pas d'eau, pas de sable — juste des collines boisées.
   */
  generateNatural(terrain: TerrainEngine, seed?: number): void {
    const rng = seed !== undefined ? this.seededRng(seed) : () => Math.random();
    terrain.initFlat();

    // 1. Bruit fractal → heightmap (W+1)×(H+1)
    const raw = this.buildHeightGrid(terrain.width + 1, terrain.height + 1, rng);

    // 2. Quantifier
    const q = this.quantize(raw);

    // 3. Lisser (pentes douces, |diff| ≤ 1)
    const smoothed = this.clampSlope(q);

    // 4. Appliquer la heightmap au terrain
    for (let vy = 0; vy <= terrain.height; vy++) {
      for (let vx = 0; vx <= terrain.width; vx++) {
        terrain.setVertex(vx, vy, smoothed[vy][vx]);
      }
    }

    // 5. Tout en herbe (GRASS)
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;
        terrain.setTileType(x, y, TileType.GRASS, Math.floor(rng() * 9));
      }
    }

    // 6. Arbres en clusters
    this.placeTrees(terrain, rng);
  }

  // ================================================================
  // Végétation
  // ================================================================

  /**
   * Place des arbres en clusters naturels + épars.
   */
  private placeTrees(terrain: TerrainEngine, rng: () => number): void {
    // 5-10 clusters
    const n = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const cx = 2 + Math.floor(rng() * (terrain.width - 4));
      const cy = 2 + Math.floor(rng() * (terrain.height - 4));
      const radius = 1 + Math.floor(rng() * 3); // 1-3
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const t = terrain.tileAt(cx + dx, cy + dy);
          if (!t || t.type !== TileType.GRASS) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius || rng() >= 0.55 * (1 - d / (radius + 1))) continue;
          terrain.setTileType(cx + dx, cy + dy, TileType.TREE, Math.floor(rng() * 9));
        }
      }
    }
    // Épars (5%)
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const t = terrain.tileAt(x, y);
        if (t && t.type === TileType.GRASS && rng() < 0.05) {
          terrain.setTileType(x, y, TileType.TREE, Math.floor(rng() * 9));
        }
      }
    }
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
    // Échelle réduite pour 16×16 : pentes plus visibles
    const baseScale = 6;
    const octaves = 4;
    const amplitudes = [1.0, 0.5, 0.25, 0.125];
    const frequencies = [1.0, 2.0, 4.0, 6.0];

    for (let y = 0; y < h; y++) {
      grid[y] = [];
      for (let x = 0; x < w; x++) {
        let v = 0, ta = 0;
        for (let o = 0; o < octaves; o++) {
          v += this.smoothNoise(x * frequencies[o] / baseScale, y * frequencies[o] / baseScale, p) * amplitudes[o];
          ta += amplitudes[o];
        }
        // Légère poussée vers le haut pour éviter trop de plat
        const normalized = ((v / ta) * 0.5 + 0.5) * 6 + 1;
        grid[y][x] = normalized;
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
              work[y][x] = cur > n
                ? Math.round(Math.min(cur - 1, avg + 0.5))
                : Math.round(Math.max(cur + 1, avg - 0.5));
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
  // Helpers
  // ================================================================

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => { state = (state * 1664525 + 1013904223) & 0x7fffffff; return state / 0x7fffffff; };
  }
}
