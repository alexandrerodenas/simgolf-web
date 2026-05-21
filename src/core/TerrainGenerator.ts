/**
 * TerrainGenerator — suit fidèlement le GUIDE_GENERATION_TERRAIN.md
 *
 * Algorithme :
 *   1. resetTerrain()   → toutes les tuiles en WaterShallow
 *   2. applyParkland()  → distribution Parkland via bruit + zones fairway
 *   3. placeHoles()     → Tees + Greens
 */

import { TileType, Tile, CourseTheme, TerrainData } from './types';

// ================================================================
// CONSTANTES
// ================================================================

const GRID_W = 64;
const GRID_H = 64;
const COSMETIC_MAX = 5; // Rough/Fairway ont 5 variantes cosmétiques

// ================================================================
// 1. resetTerrain — tout en eau plate
// ================================================================

function resetTerrain(w: number, h: number): Tile[] {
  const tiles: Tile[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = {
        x,
        y,
        type: TileType.WaterShallow,
        elevation: [0, 0, 0, 0],
        variation: 0,
      };
    }
  }
  return tiles;
}

// ================================================================
// 2. Bruit de valeur (value noise) pour la distribution
// ================================================================

function hash11(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
}

function generateSimpleNoise(w: number, h: number, scale: number): Float32Array {
  const noise = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ix = x / scale;
      const iy = y / scale;
      const x0 = Math.floor(ix);
      const x1 = x0 + 1;
      const y0 = Math.floor(iy);
      const y1 = y0 + 1;
      const sx = ix - x0;
      const sy = iy - y0;
      const v00 = hash11(x0, y0);
      const v10 = hash11(x1, y0);
      const v01 = hash11(x0, y1);
      const v11 = hash11(x1, y1);
      const cx = (1 - Math.cos(sx * Math.PI)) / 2;
      const cy = (1 - Math.cos(sy * Math.PI)) / 2;
      const top  = v00 + (v10 - v00) * cx;
      const bot  = v01 + (v11 - v01) * cx;
      noise[y * w + x] = top + (bot - top) * cy;
    }
  }
  return noise;
}

// ================================================================
// 3. Zones de fairway (serpentins)
// ================================================================

function generateFairwayZones(w: number, h: number, count: number): boolean[] {
  const zones = new Array(w * h).fill(false);
  const hw = Math.floor(w / 2);

  for (let i = 0; i < count; i++) {
    const teeX = 4 + ((i * 7 + 3) % (w - 8));
    const teeY = h - 6 - i * 6;
    const greenX = Math.min(w - 5, Math.max(4, teeX + ((i * 3 + 1) % 7 - 3)));
    const greenY = Math.max(4, teeY - 22 + (i % 3));
    drawFairwayPath(zones, w, h, teeX, teeY, greenX, greenY, 3);
  }
  return zones;
}

function drawFairwayPath(
  zones: boolean[], w: number, h: number,
  x1: number, y1: number, x2: number, y2: number, r: number,
): void {
  let x = x1, y = y1;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  while (x !== x2 || y !== y2) {
    for (let wy = -r; wy <= r; wy++) {
      for (let wx = -r; wx <= r; wx++) {
        const tx = x + wx;
        const ty = y + wy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) zones[ty * w + tx] = true;
      }
    }
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// ================================================================
// 4. Distribution Parkland
// ================================================================

function applyDistribution(tiles: Tile[], w: number, h: number, noise: Float32Array, fairway: boolean[]): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const n = noise[idx];
      const isFW = fairway[idx];
      const tile = tiles[idx];

      if (isFW) {
        tile.type = n < 0.2 ? TileType.Fairway
                  : n < 0.3 ? TileType.Tee
                  : n < 0.7 ? TileType.Fairway
                  : n < 0.8 ? TileType.SandBunker
                  : TileType.Rough;
      } else if (n < 0.10) {
        tile.type = TileType.WaterShallow;
      } else if (n < 0.15) {
        tile.type = TileType.SandBunker;
      } else if (n < 0.20) {
        tile.type = TileType.DeepRough;
      } else if (n < 0.85) {
        tile.type = TileType.Rough;
      } else if (n < 0.90) {
        tile.type = TileType.Tree;
      } else {
        tile.type = TileType.Flower;
      }
    }
  }
}

// ================================================================
// 5. Placement des trous (Tee + Green sur fairways)
// ================================================================

function placeHoles(tiles: Tile[], w: number, h: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const teeY = h - 6 - i * 6;
    const teeX = 4 + ((i * 7 + 3) % (w - 8));
    const greenY = Math.max(4, teeY - 20 + (i % 3));
    const greenX = Math.min(w - 5, Math.max(4, teeX + ((i * 3 + 1) % 7 - 3)));

    // Tee 3×3
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = teeX + dx;
        const ty = teeY + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          tiles[ty * w + tx].type = TileType.Tee;
          tiles[ty * w + tx].elevation = [0, 0, 0, 0];
        }
      }
    }

    // Green 5×5
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = greenX + dx;
        const gy = greenY + dy;
        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
            tiles[gy * w + gx].type = TileType.Green;
          } else {
            tiles[gy * w + gx].type = TileType.Fairway;
          }
        }
      }
    }
  }
}

// ================================================================
// 6. Variations cosmétiques
// ================================================================

function applyVariations(tiles: Tile[], w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const tile = tiles[idx];
      // Déterministe par position — pas de flicker
      tile.variation = 1 + Math.abs((x * 31 + y * 17) % COSMETIC_MAX);
    }
  }
}

// ================================================================
// API publique
// ================================================================

export function generateParklandCourse(): TerrainData {
  const w = GRID_W;
  const h = GRID_H;

  // 1. resetTerrain — tout en eau
  const tiles = resetTerrain(w, h);

  // 2. Bruit de valeur (scale=10 pour des features larges)
  const noise = generateSimpleNoise(w, h, 10);

  // 3. Zones de fairway (9 trous)
  const fairway = generateFairwayZones(w, h, 9);

  // 4. Distribution Parkland
  applyDistribution(tiles, w, h, noise, fairway);

  // 5. Trous (Tee + Green)
  placeHoles(tiles, w, h, 9);

  // 6. Variations cosmétiques
  applyVariations(tiles, w, h);

  return { width: w, height: h, tiles };
}
