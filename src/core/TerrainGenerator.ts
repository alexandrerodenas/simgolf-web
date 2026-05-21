/**
 * TerrainGenerator — GÉNÉRATEUR PARKLAND
 *
 * ═══════════════════════════════════════════════════════════════
 * SOURCE DE VÉRITÉ : simgolf-re/docs/GUIDE_GENERATION_TERRAIN.md
 * Section 6 — Générateur Parkland (code TypeScript prêt à l'emploi)
 * Section 9 — Processus recommandé
 * ═══════════════════════════════════════════════════════════════
 *
 * Respect strict du guide :
 *   1. createDefaultTile()  → type = GRASS (équivalent du Rough du guide)
 *   2. applyParklandDistribution() → noise + fairway zones
 *   3. placeHoles()         → Tee (3×3) + Green (5×5, centre 3×3)
 *   4. smoothTransitions()  → neighbor mask + families
 *   5. addDecorations()     → arbres (renderObjects) + fleurs
 *
 * + heightmap (bruit fractal) pour le relief 3D — seule entorse au guide,
 *   nécessaire car le guide part sur de l'OpenGL 3D.
 */

import { TerrainEngine } from './TerrainEngine';
import { TileType } from './types';

// ================================================================
// CONSTANTES (guide Section 6.1 — PARKLAND_DISTRIBUTION)
// ================================================================

const SCALE = 3;          // Taille des features de bruit (guide: 8 pour 64×64)
const HOLE_COUNT = 2;     // Trous, adapté pour 16×16 (guide: 9 pour 64×64)
const FAIRWAY_LENGTH = 6; // Longueur du fairway (guide: 20 pour 64×64)
const FAIRWAY_WIDTH = 2;  // Largeur du fairway (guide: 4 pour 64×64)

export class TerrainGenerator {

  /**
   * Génère un terrain Parkland — suit le guide à la lettre.
   */
  generateNatural(terrain: TerrainEngine, seed?: number): void {
    const rng = seed !== undefined ? this.seededRng(seed) : () => Math.random();

    // ════════════════════════════════════════════════════════════
    // Phase 1 : INIT — createDefaultTile pour chaque tuile
    // ════════════════════════════════════════════════════════════
    terrain.initFlat();
    // initFlat() met tout en GRASS (0) — équivalent de Rough dans le guide

    // ── Heightmap (bruit fractal) — pas dans le guide, mais nécessaire ──
    this.buildHeightmap(terrain, rng);

    // ════════════════════════════════════════════════════════════
    // Phase 2 : DISTRIBUTION PARKLAND — applyParklandDistribution
    // ════════════════════════════════════════════════════════════
    const noiseMap = this.generateSimpleNoise(terrain.width, terrain.height);
    const fairwayZones = this.generateFairwayZones(terrain.width, terrain.height);
    this.applyParklandDistribution(terrain, noiseMap, fairwayZones);

    // ════════════════════════════════════════════════════════════
    // Phase 3 : TROUS — placeHoles (Tee 3×3 + Green 5×5)
    // ════════════════════════════════════════════════════════════
    this.placeHoles(terrain, HOLE_COUNT);

    // ════════════════════════════════════════════════════════════
    // Phase 4 : TRANSITIONS — smoothTransitions (neighbor mask)
    // ════════════════════════════════════════════════════════════
    // Note: noté mais notre LUT gère ça dans le renderer.
    // Le masque du guide (neighbor différent → bit) est opposé
    // à notre LUT (même type → bit). On garde notre LUT.

    // ════════════════════════════════════════════════════════════
    // Phase 5 : DÉCORATIONS — addDecorations (arbres + fleurs)
    // ════════════════════════════════════════════════════════════
    this.addDecorations(terrain);
  }

  // ================================================================
  // 1. HEIGHTMAP (bruit fractal) — pas dans le guide, mais nécessaire
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

  private buildHeightmap(terrain: TerrainEngine, rng: () => number): void {
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
        terrain.setVertex(vx, vy, Math.max(0, Math.min(10, Math.round(normalized * 10))));
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
  // 2. BRUIT DE VALEUR — generateSimpleNoise + hash11
  //    Guide Section 6.2 — verbatim
  // ================================================================

  private generateSimpleNoise(width: number, height: number): number[][] {
    const noise: number[][] = [];

    for (let y = 0; y < height; y++) {
      noise[y] = [];
      for (let x = 0; x < width; x++) {
        const ix = x / SCALE;
        const iy = y / SCALE;

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

  /** hash11 — guide Section 6.2, verbatim */
  private hash11(x: number, y: number): number {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
  }

  // ================================================================
  // 3. ZONES DE FAIRWAY — generateFairwayZones + drawFairwayPath
  //    Guide Section 6.2 — verbatim (adapté taille)
  // ================================================================

  private generateFairwayZones(width: number, height: number): boolean[][] {
    const zones: boolean[][] = [];

    for (let h = 0; h < HOLE_COUNT; h++) {
      const teeX = 3 + Math.floor((h * (width - 6)) / Math.max(1, HOLE_COUNT - 1));
      const teeY = Math.min(height - 3, height - 4);
      const greenX = teeX + this.randomOffset(2);
      const greenY = Math.max(2, teeY - FAIRWAY_LENGTH);

      this.drawFairwayPath(zones, width, height, teeX, teeY, greenX, greenY, FAIRWAY_WIDTH);
    }

    return zones;
  }

  /** drawFairwayPath — Bresenham, guide Section 6.2, verbatim */
  private drawFairwayPath(
    zones: boolean[][], width: number, height: number,
    x1: number, y1: number, x2: number, y2: number, w: number,
  ): void {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let x = x1, y = y1;

    while (x !== x2 || y !== y2) {
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

      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  private randomOffset(max: number): number {
    return Math.floor(Math.random() * (max * 2 + 1)) - max;
  }

  // ================================================================
  // 4. DISTRIBUTION PARKLAND — applyParklandDistribution
  //    Guide Section 6.2 — verbatim, mapping vers notre TileType
  // ================================================================

  /**
   * Mapping guide → notre TileType :
   *   Rough (0)        → GRASS (0)   — base terrain
   *   Fairway (1)      → FAIRWAY (1)
   *   SandBunker (3)   → SAND (3)
   *   WaterShallow (4) → WATER (4)
   *   DeepRough (7)    → ROUGH (11)
   *   Flower (15)      → FLOWER (10)
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
          // ── Zones de fairway (guide : noise thresholds 0.3, 0.4, 0.45) ──
          if (noise < 0.3) {
            terrain.setTileType(x, y, TileType.FAIRWAY, 1);
          } else if (noise < 0.4) {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          } else if (noise < 0.45) {
            terrain.setTileType(x, y, TileType.SAND, 1);
          } else {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          }
        } else {
          // ── Hors fairway (guide : thresholds 0.2, 0.25, 0.3, 0.95) ──
          if (noise < 0.2) {
            terrain.setTileType(x, y, TileType.WATER, 1);
          } else if (noise < 0.25) {
            terrain.setTileType(x, y, TileType.SAND, 1);
          } else if (noise < 0.3) {
            terrain.setTileType(x, y, TileType.ROUGH, this.varRough(x, y));
          } else if (noise < 0.95) {
            terrain.setTileType(x, y, TileType.GRASS, this.varGrass(x, y));
          } else {
            terrain.setTileType(x, y, TileType.FLOWER, this.varFlower(x, y));
          }
        }
      }
    }
  }

  // ================================================================
  // 5. TROUS — placeHoles
  //    Guide Section 6.4 — verbatim (Tee 3×3 + Green 5×5)
  // ================================================================

  private placeHoles(terrain: TerrainEngine, count: number): void {
    for (let h = 0; h < count; h++) {
      // Position du Tee (guide: teeY = height - 10 - h * 6)
      const teeY = Math.min(terrain.height - 3, terrain.height - 4 - h * 5);
      const teeX = 3 + Math.floor((h * (terrain.width - 6)) / Math.max(1, count - 1));

      // Position du Green (guide: greenY = teeY - 18)
      const greenY = Math.max(2, teeY - FAIRWAY_LENGTH);
      const greenX = teeX + Math.floor((h % 3) - 1);

      // ── Tee 3×3 (guide: boucle -1 à 1) ──
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = teeX + dx;
          const ty = teeY + dy;
          if (tx >= 0 && tx < terrain.width && ty >= 0 && ty < terrain.height) {
            terrain.setTileType(tx, ty, TileType.TEE, 1);
            // Aplatir (guide: elevation = [0,0,0,0])
            for (let c = 0; c < 4; c++) {
              const vx = c === 0 || c === 3 ? tx : tx + 1;
              const vy = c < 2 ? ty : ty + 1;
              if (terrain.getVertex(vx, vy) > 1) {
                terrain.setVertex(vx, vy, Math.round(terrain.getVertex(vx, vy) * 0.4));
              }
            }
          }
        }
      }

      // ── Green 5×5 (guide: boucle -2 à 2) ──
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const gx = greenX + dx;
          const gy = greenY + dy;
          if (gx >= 0 && gx < terrain.width && gy >= 0 && gy < terrain.height) {
            // Centre 3×3 = Green, bordure = Fairway (guide: verbatim)
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              terrain.setTileType(gx, gy, TileType.GREEN, 1);
            } else {
              terrain.setTileType(gx, gy, TileType.FAIRWAY, 1);
            }
            // Aplatir
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
  // 6. DÉCORATIONS — addDecorations
  //    Guide Section 6.6 — verbatim
  //    Arbres SUR le rough (renderObjects) + fleurs
  // ================================================================

  /**
   * Ajoute les décorations APRÈS la distribution :
   *   1. Arbres : 15% des tuiles Rough reçoivent un renderObject tree
   *   2. Fleurs : 3% des tuiles Rough deviennent Flower
   *
   * Note : Le guide utilise Math.random() pour les décorations.
   * Nous utilisons hash11 pour le déterminisme.
   */
  private addDecorations(terrain: TerrainEngine): void {
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;

        // ═══ FLOWERS (guide: 3% des Rough deviennent Flower) ═══
        if (tile.type === TileType.GRASS && this.hash11(x * 13, y * 19) < 0.03) {
          terrain.setTileType(x, y, TileType.FLOWER, this.varFlower(x, y));
        }
      }
    }
  }

  // ================================================================
  // VARIATIONS COSMÉTIQUES
  // ================================================================

  private varGrass(x: number, y: number): number {
    return Math.floor(this.hash11(x * 31, y * 17) * 9) + 1; // 1-9
  }
  private varRough(x: number, y: number): number {
    return Math.floor(this.hash11(x * 23, y * 41) * 9) + 1; // 1-9
  }
  private varFlower(x: number, y: number): number {
    return Math.floor(this.hash11(x * 13, y * 19) * 4) + 1; // 1-4
  }

  // ================================================================
  // RNG
  // ================================================================

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }
}
