/**
 * TerrainGenerator — Génération de terrain 100% herbe avec variation d'élévation.
 *
 * Algorithme : bruit fractal 2D (permutation table + 5 octaves)
 *   → quantification 0-10 → lissage des pentes (|différence| ≤ 1)
 *
 * Strictement conforme à la documentation simgolf-re :
 *   references/natural-terrain-generation.md (Technique A)
 *   references/elevation-quantization.md
 *
 * Résultat : une carte de collines herbeuses naturelles avec quelques arbres.
 */

import { TerrainEngine } from './TerrainEngine';
import { TileType } from './types';

export class TerrainGenerator {

  /**
   * Génère un terrain naturel : herbe + collines + quelques arbres.
   * Toutes les tuiles sont GRASS avec une variante cosmétique déterministe,
   * sauf ~10% qui deviennent des TREE.
   */
  generateNatural(terrain: TerrainEngine, seed?: number): void {
    const rng = seed !== undefined ? this.seededRng(seed) : () => Math.random();
    terrain.initFlat();

    // ── 1. Bruit fractal → heightmap (W+1)×(H+1) ──
    const rw = terrain.width + 1;   // 17
    const rh = terrain.height + 1;  // 17
    const raw = this.buildHeightGrid(rw, rh, rng);

    // ── 2. Quantifier (arrondi, clamp 0-10) ──
    const q = this.quantize(raw);

    // ── 3. Lisser les pentes (|différence entre voisins| ≤ 1) ──
    const smoothed = this.clampSlope(q);

    // ── 4. Appliquer la heightmap au terrain ──
    for (let vy = 0; vy < rh; vy++) {
      for (let vx = 0; vx < rw; vx++) {
        terrain.setVertex(vx, vy, smoothed[vy][vx]);
      }
    }

    // ── 5. Tout en herbe (GRASS) avec variante déterministe ──
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const hash = (x * 31 + y * 17) & 0x7fffffff;
        const variant = (hash % 9) + 1; // 1..9
        terrain.setTileType(x, y, TileType.GRASS, variant);
      }
    }

    // ── 6. Arbres : ~10% des tuiles deviennent des TREE ──
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const hash = (x * 73 + y * 37 + 42) & 0x7fffffff;
        if (hash % 10 === 0) {
          terrain.setTileType(x, y, TileType.TREE, hash % 12);
        }
      }
    }
  }

  // ================================================================
  // Bruit fractal 2D (Technique A — doc natural-terrain-generation.md)
  // ================================================================

  private perm: number[] | null = null;

  /**
   * Table de permutation 256 (Fisher-Yates) × 2 (pour wrapping).
   */
  private getPermutation(rng: () => number): number[] {
    if (this.perm) return this.perm;
    const p: number[] = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = p.concat(p);
    return this.perm;
  }

  /**
   * Grille de hauteurs par bruit fractal.
   * Paramètres ajustés pour une carte 16×16 :
   *   baseScale = 4  (≈ 12 × 16/64, échelle des features)
   *   octaves = 5
   *   amplitudes et fréquences identiques à la doc
   */
  private buildHeightGrid(w: number, h: number, rng: () => number): number[][] {
    const p = this.getPermutation(rng);
    const grid: number[][] = [];

    // Doc RE : baseScale=12 pour 64×64, adapté à 16×16
    const baseScale = 4;
    const octaves = 5;
    const amplitudes = [1.0, 0.5, 0.25, 0.125, 0.0625];
    const frequencies = [1.0, 2.0, 4.0, 6.0, 10.0];
    const totalAmp = amplitudes.reduce((a, b) => a + b, 0);

    for (let y = 0; y < h; y++) {
      grid[y] = [];
      for (let x = 0; x < w; x++) {
        let val = 0;
        for (let o = 0; o < octaves; o++) {
          const sx = x * frequencies[o] / baseScale;
          const sy = y * frequencies[o] / baseScale;
          val += this.smoothNoise(sx, sy, p) * amplitudes[o];
        }
        // Normalisation [0, 1], puis mapping [0, 10]
        const normalized = (val / totalAmp) * 0.5 + 0.5;
        grid[y][x] = normalized * 10;
      }
    }
    return grid;
  }

  /**
   * Bruit lisse avec interpolation cubique (smoothstep).
   */
  private smoothNoise(x: number, y: number, perm: number[]): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const h = (ix: number, iy: number): number => {
      const idx = perm[((ix % 256) + 256) % 256] + ((iy % 256) + 256) % 256;
      return perm[idx & 255] / 255;
    };

    const n00 = h(ix,     iy);
    const n10 = h(ix + 1, iy);
    const n01 = h(ix,     iy + 1);
    const n11 = h(ix + 1, iy + 1);

    const nx0 = n00 * (1 - ux) + n10 * ux;
    const nx1 = n01 * (1 - ux) + n11 * ux;
    return nx0 * (1 - uy) + nx1 * uy;
  }

  // ================================================================
  // Quantification + Lissage des pentes
  // (doc elevation-quantization.md — verbatim)
  // ================================================================

  /**
   * Quantification : arrondi à l'entier, clamp [0, 10].
   */
  private quantize(raw: number[][]): number[][] {
    return raw.map(row =>
      row.map(v => Math.max(0, Math.min(10, Math.round(v))))
    );
  }

  /**
   * Lissage itératif : |voisin − courant| ≤ 1.
   * Max 20 passes (typiquement 3-5 suffisent).
   */
  private clampSlope(grid: number[][]): number[][] {
    const h = grid.length, w = grid[0].length;
    const work = grid.map(row => [...row]);
    let changed = true;
    let passes = 0;

    while (changed && passes < 20) {
      changed = false;
      passes++;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cur = work[y][x];
          const neighbors = [
            y > 0 ? work[y - 1][x] : cur,
            x < w - 1 ? work[y][x + 1] : cur,
            y < h - 1 ? work[y + 1][x] : cur,
            x > 0 ? work[y][x - 1] : cur,
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
  // RNG déterministe
  // (doc natural-terrain-generation.md — LCG Numerical Recipes)
  // ================================================================

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }
}
