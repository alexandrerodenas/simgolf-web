/**
 * TerrainGenerator — suit GUIDE_GENERATION_TERRAIN.md
 */
import { TileType, Tile, TerrainData } from './types';

const W = 40;
const H = 40;
const COSMETIC_MAX = 5;

function resetTerrain(w: number, h: number): Tile[] {
  const tiles: Tile[] = new Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      tiles[y * w + x] = { x, y, type: TileType.WaterShallow, elevation: [0, 0, 0, 0], variation: 0 };
  return tiles;
}

function hash11(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
}

function generateSimpleNoise(w: number, h: number, scale: number): Float32Array {
  const n = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ix = x / scale, iy = y / scale;
      const x0 = Math.floor(ix), x1 = x0 + 1, y0 = Math.floor(iy), y1 = y0 + 1;
      const sx = ix - x0, sy = iy - y0;
      const cx = (1 - Math.cos(sx * Math.PI)) / 2;
      const cy = (1 - Math.cos(sy * Math.PI)) / 2;
      const v00 = hash11(x0, y0), v10 = hash11(x1, y0), v01 = hash11(x0, y1), v11 = hash11(x1, y1);
      n[y * w + x] = (v00 + (v10 - v00) * cx) + ((v01 + (v11 - v01) * cx) - (v00 + (v10 - v00) * cx)) * cy;
    }
  return n;
}

function generateFairwayZones(w: number, h: number): boolean[] {
  const z = new Array(w * h).fill(false);
  for (let i = 0; i < 9; i++) {
    let x = 3 + ((i * 7 + 3) % (w - 6));
    let y = h - 5 - i * 4;
    const gx = Math.min(w - 4, Math.max(3, x + ((i * 3 + 1) % 5 - 2)));
    const gy = Math.max(3, y - 16 + (i % 3));
    const dx = Math.abs(gx - x), dy = Math.abs(gy - y);
    const sx = x < gx ? 1 : -1, sy = y < gy ? 1 : -1;
    let err = dx - dy;
    while (x !== gx || y !== gy) {
      for (let wy = -2; wy <= 2; wy++)
        for (let wx = -2; wx <= 2; wx++) {
          const tx = x + wx, ty = y + wy;
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) z[ty * w + tx] = true;
        }
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  return z;
}

function applyDistribution(tiles: Tile[], w: number, h: number, noise: Float32Array, fairway: boolean[]): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const n = noise[idx];
      const t = tiles[idx];
      if (fairway[idx]) {
        t.type = n < 0.3 ? TileType.Fairway : n < 0.5 ? TileType.Tee : n < 0.85 ? TileType.Fairway : n < 0.92 ? TileType.SandBunker : TileType.Rough;
      } else if (n < 0.10) t.type = TileType.WaterShallow;
      else if (n < 0.14) t.type = TileType.SandBunker;
      else if (n < 0.18) t.type = TileType.DeepRough;
      else if (n < 0.85) t.type = TileType.Rough;
      else if (n < 0.90) t.type = TileType.Tree;
      else t.type = TileType.Flower;
    }
}

function placeHoles(tiles: Tile[], w: number, h: number): void {
  for (let i = 0; i < 9; i++) {
    const teeY = h - 5 - i * 4;
    const teeX = 3 + ((i * 7 + 3) % (w - 6));
    const greenY = Math.max(3, teeY - 15 + (i % 3));
    const greenX = Math.min(w - 4, Math.max(3, teeX + ((i * 3 + 1) % 5 - 2)));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const tx = teeX + dx, ty = teeY + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          tiles[ty * w + tx].type = TileType.Tee;
          tiles[ty * w + tx].elevation = [0, 0, 0, 0];
        }
      }
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const gx = greenX + dx, gy = greenY + dy;
        if (gx >= 0 && gx < w && gy >= 0 && gy < h)
          tiles[gy * w + gx].type = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? TileType.Green : TileType.Fairway;
      }
  }
}

function applyVariations(tiles: Tile[], w: number, h: number): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      tiles[y * w + x].variation = ((x * 31 + y * 17) % COSMETIC_MAX) + 1;
}

export function generateParklandCourse(): TerrainData {
  const w = W, h = H;
  const tiles = resetTerrain(w, h);
  applyDistribution(tiles, w, h, generateSimpleNoise(w, h, 8), generateFairwayZones(w, h));
  placeHoles(tiles, w, h);
  applyVariations(tiles, w, h);
  return { width: w, height: h, tiles };
}
