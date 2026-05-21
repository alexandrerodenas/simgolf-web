/**
 * TerrainGenerator — Génération de terrain Parkland
 *
 * Basé sur le guide RE simgolf-re/docs/GUIDE_GENERATION_TERRAIN.md
 * (Section 6 — Générateur Parkland, Section 9 — Processus recommandé)
 *
 * Algorithme :
 *   1. resetTerrain() → tout en herbe (GRASS), plat
 *   2. Bruit fractal → heightmap (élévations naturelles)
 *   3. Carte de bruit de valeur → distribution des types
 *   4. Zones de fairway (2 trous pour 16×16)
 *   5. Greens (3×3) au bout des fairways + Tees (3×3)
 *   6. Arbres disséminés dans l'herbe (~8%)
 *   7. Bunkers (SAND) bords des fairways
 *   8. Points d'eau (WATER) dans les zones basses
 *   9. Rochers (~5%)
 *
 * Conforme aux directives du guide : source de vérité.
 */

import { TerrainEngine } from './TerrainEngine';
import { TileType } from './types';

export class TerrainGenerator {

  /**
   * Génère un terrain Parkland complet.
   * @param seed  Optionnel : seed déterministe
   */
  generateNatural(terrain: TerrainEngine, seed?: number): void {
    const rng = seed !== undefined ? this.seededRng(seed) : () => Math.random();
    terrain.initFlat();

    // ── 1. Heightmap : bruit fractal 5 octaves (inchangé) ──
    this.applyHeightmap(terrain, rng);

    // ── 2. Carte de bruit pour distribution des types ──
    //    (RE Section 6.2 — generateSimpleNoise)
    const noiseMap = this.generateTerrainNoise(terrain.width, terrain.height);

    // ── 3. Zones de fairway (RE Section 6.2 — generateFairwayZones) ──
    //    2 trous pour 16×16
    const fairwayZones = this.generateFairwayZones(terrain.width, terrain.height);

    // ── 4. Appliquer la distribution Parkland ──
    //    (RE Section 6.2 — applyParklandDistribution)
    this.applyParklandDistribution(terrain, noiseMap, fairwayZones);

    // ── 5. Placer les trous (RE Section 6.4 — placeHoles) ──
    //    Tee (3×3) → Green (3×3)
    this.placeHoles(terrain, 2);

    // ── 6. Rochers (~5%, conservation compatibilité) ──
    this.addRocks(terrain);
  }

  // ================================================================
  // 1. HEIGHTMAP — Bruit fractal (inchangé, fonctionnel)
  // ================================================================

  private perm: number[] | null = null;

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

  private applyHeightmap(terrain: TerrainEngine, rng: () => number): void {
    const rw = terrain.width + 1;
    const rh = terrain.height + 1;
    const p = this.getPermutation(rng);

    const baseScale = 4;
    const octaves = 5;
    const amplitudes = [1.0, 0.5, 0.25, 0.125, 0.0625];
    const frequencies = [1.0, 2.0, 4.0, 6.0, 10.0];
    const totalAmp = amplitudes.reduce((a, b) => a + b, 0);

    for (let vy = 0; vy < rh; vy++) {
      for (let vx = 0; vx < rw; vx++) {
        let val = 0;
        for (let o = 0; o < octaves; o++) {
          const sx = vx * frequencies[o] / baseScale;
          const sy = vy * frequencies[o] / baseScale;
          val += this.smoothNoise(sx, sy, p) * amplitudes[o];
        }
        const normalized = (val / totalAmp) * 0.5 + 0.5;
        const h = Math.max(0, Math.min(10, Math.round(normalized * 10)));
        terrain.setVertex(vx, vy, h);
      }
    }
  }

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
  // 2. CARTE DE BRUIT POUR DISTRIBUTION
  //    RE Section 6.2 — generateSimpleNoise + hash11
  // ================================================================

  /**
   * Génère une carte de bruit de valeur (0-1) pour la distribution
   * des types de terrain. Le scale=3 donne des features adaptées
   * à une carte 16×16.
   */
  private generateTerrainNoise(width: number, height: number): number[][] {
    const noise: number[][] = [];
    const scale = 3;

    for (let y = 0; y < height; y++) {
      noise[y] = [];
      for (let x = 0; x < width; x++) {
        const ix = x / scale;
        const iy = y / scale;

        const x0 = Math.floor(ix);
        const x1 = x0 + 1;
        const y0 = Math.floor(iy);
        const y1 = y0 + 1;

        const sx = ix - x0;
        const sy = iy - y0;

        // Interpolation cosinus
        const cx = (1 - Math.cos(sx * Math.PI)) / 2;
        const cy = (1 - Math.cos(sy * Math.PI)) / 2;

        const v00 = this.hash11(x0, y0);
        const v10 = this.hash11(x1, y0);
        const v01 = this.hash11(x0, y1);
        const v11 = this.hash11(x1, y1);

        const top = v00 + (v10 - v00) * cx;
        const bottom = v01 + (v11 - v01) * cx;
        noise[y][x] = top + (bottom - top) * cy;
      }
    }
    return noise;
  }

  /**
   * Hash pseudo-aléatoire déterministe (copié du guide RE).
   * Produit une valeur [0, 1] reproductible pour chaque (x, y).
   */
  private hash11(x: number, y: number): number {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
  }

  // ================================================================
  // 3. ZONES DE FAIRWAY
  //    RE Section 6.2 — generateFairwayZones + drawFairwayPath
  // ================================================================

  /**
   * Crée 2 fairways pour une carte 16×16, serpentant du bas vers le haut.
   */
  private generateFairwayZones(width: number, height: number): boolean[][] {
    const zones: boolean[][] = [];
    const holeCount = 2;
    const length = 8;
    const fairwayW = 2;

    for (let h = 0; h < holeCount; h++) {
      const teeX = 3 + Math.floor(h * (width - 6) / (holeCount - 1 || 1));
      const teeY = height - 3;
      const greenX = teeX + Math.floor(this.hash11(h * 7, 13) * 3 - 1);
      const greenY = 3;

      this.drawFairwayPath(zones, width, height, teeX, teeY, greenX, greenY, fairwayW);
    }

    return zones;
  }

  /**
   * Bresenham avec épaisseur — copié du guide RE.
   */
  private drawFairwayPath(
    zones: boolean[][], width: number, height: number,
    x1: number, y1: number, x2: number, y2: number, w: number,
  ): void {
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    let x = x1, y = y1;

    while (true) {
      for (let wy = -w; wy <= w; wy++) {
        for (let wx = -w; wx <= w; wx++) {
          const tx = x + wx;
          const ty = y + wy;
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            if (!zones[ty]) zones[ty] = [];
            zones[ty][tx] = true;
          }
        }
      }

      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  // ================================================================
  // 4. DISTRIBUTION PARKLAND
  //    RE Section 6.2 — applyParklandDistribution (adapté 16×16)
  // ================================================================

  /**
   * Applique les types de terrain selon la carte de bruit + zones fairway.
   * Distribution Parkland (~45% Rough, 25% Fairway, 8% Trees, 8% Water…)
   */
  private applyParklandDistribution(
    terrain: TerrainEngine,
    noiseMap: number[][],
    fairwayZones: boolean[][],
  ): void {
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const noise = noiseMap[y]?.[x] ?? 0;
        const isFairway = fairwayZones[y]?.[x] ?? false;

        if (isFairway) {
          // Zones de fairway
          if (noise < 0.3) {
            terrain.setTileType(x, y, TileType.FAIRWAY, this.varFairway(x, y));
          } else if (noise < 0.4) {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          } else if (noise < 0.5) {
            terrain.setTileType(x, y, TileType.SAND, this.varSand(x, y));
          } else {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          }
        } else if (noise < 0.15) {
          // Points d'eau
          terrain.setTileType(x, y, TileType.WATER, 1);
        } else if (noise < 0.22) {
          // Bunkers naturels
          terrain.setTileType(x, y, TileType.SAND, this.varSand(x, y));
        } else if (noise < 0.28) {
          // Herbe haute (ROUGH)
          terrain.setTileType(x, y, TileType.ROUGH, this.varRough(x, y));
        } else if (noise < 0.90) {
          // Herbe naturelle
          // ~8% deviennent des arbres (Woods) comme dans le guide
          if (this.hash11(x + 37, y + 53) < 0.10) {
            terrain.setTileType(x, y, TileType.TREE, this.varTree(x, y));
          } else {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          }
        } else {
          // Fleurs / décorations
          terrain.setTileType(x, y, TileType.FLOWER, this.varFlower(x, y));
        }
      }
    }
  }

  // ================================================================
  // 5. PLACEMENT DES TROUS
  //    RE Section 6.4 — placeHoles (adapté 16×16, 2 trous)
  // ================================================================

  /**
   * Place les Tees (3×3) et Greens (3×3) pour N trous.
   */
  private placeHoles(terrain: TerrainEngine, count: number): void {
    for (let h = 0; h < count; h++) {
      // Positions échelonnées verticalement
      const teeY = terrain.height - 4 - h * 6;
      const teeX = 3 + Math.floor(h * (terrain.width - 6) / (count - 1 || 1));
      const greenY = 2 + h * 2;
      const greenX = teeX + Math.floor(this.hash11(h * 7 + 1, 31) * 3 - 1);

      // Tee : 3×3
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = teeX + dx;
          const ty = teeY + dy;
          if (tx >= 0 && tx < terrain.width && ty >= 0 && ty < terrain.height) {
            terrain.setTileType(tx, ty, TileType.TEE, this.varTee(tx, ty));
            // Aplatir le Tee
            for (let c = 0; c < 4; c++) {
              const vx = c === 0 || c === 3 ? tx : tx + 1;
              const vy = c < 2 ? ty : ty + 1;
              if (terrain.getVertex(vx, vy) > 2) {
                terrain.setVertex(vx, vy, Math.round(terrain.getVertex(vx, vy) * 0.5));
              }
            }
          }
        }
      }

      // Green : 3×3 centre, bordure FAIRWAY
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const gx = greenX + dx;
          const gy = greenY + dy;
          if (gx >= 0 && gx < terrain.width && gy >= 0 && gy < terrain.height) {
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              terrain.setTileType(gx, gy, TileType.GREEN, this.varGreen(gx, gy));
            } else {
              terrain.setTileType(gx, gy, TileType.FAIRWAY, this.varFairway(gx, gy));
            }
            // Aplatir le Green
            for (let c = 0; c < 4; c++) {
              const vx = c === 0 || c === 3 ? gx : gx + 1;
              const vy = c < 2 ? gy : gy + 1;
              if (terrain.getVertex(vx, vy) > 1) {
                terrain.setVertex(vx, vy, Math.round(terrain.getVertex(vx, vy) * 0.3));
              }
            }
          }
        }
      }
    }
  }

  // ================================================================
  // 6. ROCHERS (~5%)
  // ================================================================

  private addRocks(terrain: TerrainEngine): void {
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const h = this.hash11(x * 47 + 13, y * 29 + 7);
        if (h < 0.05) {
          terrain.setTileType(x, y, TileType.ROCK, Math.floor(this.hash11(x, y + 99) * 45) + 1);
        }
      }
    }
  }

  // ================================================================
  // VARIATIONS COSMÉTIQUES (déterministes)
  // Chaque type de terrain a son propre range de variations
  // ================================================================

  private varGrass(x: number, y: number): number {
    return Math.floor(this.hash11(x * 31, y * 17) * 9) + 1; // 1-9 (groupes A-E, 5 var)
  }
  private varFairway(x: number, y: number): number {
    return 1; // une seule texture fairway
  }
  private varGreen(x: number, y: number): number {
    return 1;
  }
  private varSand(x: number, y: number): number {
    return 1;
  }
  private varRough(x: number, y: number): number {
    return Math.floor(this.hash11(x * 23, y * 41) * 9) + 1; // 1-9
  }
  private varTree(x: number, y: number): number {
    return Math.floor(this.hash11(x * 73, y * 37) * 36) + 1; // 1-36 (Woods A-D × 9)
  }
  private varTee(x: number, y: number): number {
    return 1;
  }
  private varFlower(x: number, y: number): number {
    return Math.floor(this.hash11(x * 13, y * 19) * 4) + 1;
  }

  // ================================================================
  // RNG déterministe (seed optionnel)
  // ================================================================

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }
}
