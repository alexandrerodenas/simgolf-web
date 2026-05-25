/**
 * world/terrain.ts — Génération de terrain + textures + maillage
 *
 * ⚠️ SOURCE DE VÉRITÉ : terrain-ts (simgolf-re/terrain-ts)
 *   - Types : TileType, ITile, IRenderPass, IMapState → terrain-ts
 *   - Logique terrain : computeRenderPasses, getGeometryType → terrain-ts
 *   - Familles : TERRAIN_FAMILY, MAX_VARIATION → terrain-ts
 *
 * Ce fichier ne fait QUE :
 *   1. Génération procédurale (bruit + distribution dont water clusters)
 *   2. Mapping passe → chemin de texture WebP
 *   3. Construction de maillage Three.js
 */

import * as THREE from 'three';
import {
  TileType,
  CourseTheme,
  ITile,
  IRenderPass,
  IMapState,
  Terrain,
  TERRAIN_FAMILY,
  MAX_VARIATION,
} from '../terrain-lib/index.js';
import { tileVertexPosition } from '../render/camera';
import { ELEVATION_LEVELS } from '../core/types';

// ─── CONSTANTES DE GÉNÉRATION ───

const COSMETIC_MAX = 5;
const ELEVATION_MAX = 4; // 0-4 comme le jeu original

// ─── GÉNÉRATION VÉGÉTALE + EAU ───

function hash11(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
}

function generateNoise(w: number, h: number, scale: number): Float32Array {
  const n = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ix = x / scale;
      const iy = y / scale;
      const x0 = Math.floor(ix);
      const x1 = x0 + 1;
      const y0 = Math.floor(iy);
      const y1 = y0 + 1;
      const sx = ix - x0;
      const sy = iy - y0;
      const cx = (1 - Math.cos(sx * Math.PI)) / 2;
      const cy = (1 - Math.cos(sy * Math.PI)) / 2;
      const v00 = hash11(x0, y0);
      const v10 = hash11(x1, y0);
      const v01 = hash11(x0, y1);
      const v11 = hash11(x1, y1);
      n[y * w + x] =
        (v00 + (v10 - v00) * cx) +
        ((v01 + (v11 - v01) * cx) - (v00 + (v10 - v00) * cx)) * cy;
    }
  return n;
}

/**
 * Génère une heightmap sur une grille (w+1)×(h+1) pour les coins de tuiles.
 * Retourne Float32Array de taille (w+1)*(h+1) avec valeurs 0..ELEVATION_MAX.
 */
function generateElevationMap(w: number, h: number): Float32Array {
  const gw = w + 1;
  const gh = h + 1;
  const size = gw * gh;
  const map = new Float32Array(size);

  // Bruit large échelle pour les collines
  const noiseLarge = generateNoise(gw, gh, 8);
  // Bruit fin pour les détails
  const noiseFine = generateNoise(gw, gh, 3);

  for (let i = 0; i < size; i++) {
    // Combinaison de bruits
    const n = noiseLarge[i] * 0.7 + noiseFine[i] * 0.3;
    // Distribution vers 0-4 avec courbe douce
    const raw = Math.pow(n, 0.8) * ELEVATION_MAX;
    map[i] = Math.round(Math.max(0, Math.min(ELEVATION_MAX, raw)));
  }

  return map;
}

/**
 * Assigne les élévations aux tuiles depuis une heightmap de coins.
 * Chaque tuile (x,y) prend ses 4 coins depuis la grille (w+1)×(h+1).
 */
function assignElevations(
  tiles: ITile[],
  elevMap: Float32Array,
  w: number, h: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const gw = w + 1;
      tiles[idx].elevation = [
        elevMap[y * gw + x],       // TL (y, x)
        elevMap[y * gw + x + 1],   // TR (y, x+1)
        elevMap[(y + 1) * gw + x + 1], // BR (y+1, x+1)
        elevMap[(y + 1) * gw + x],     // BL (y+1, x)
      ];
    }
  }
}

/**
 * Identifie les tuiles d'eau par bruit + filtre clusters.
 * Retourne un tableau: 0=terre, 1=eau.
 */
function generateWaterMask(
  w: number, h: number,
  noise: Float32Array,
  threshold: number,     // seuil de base (ex: 0.18)
  minClusterSize: number, // taille minimale pour garder un cluster
  mergeDist: number,      // distance max pour fusionner clusters
): Uint8Array {
  const mask = new Uint8Array(w * h);

  // 1. Seuillage
  for (let i = 0; i < w * h; i++) {
    mask[i] = noise[i] < threshold ? 1 : 0;
  }

  // 2. Flood-fill pour étiqueter les clusters
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const queue: number[] = [];

  function flood(start: number, label: number): number {
    let count = 0;
    queue.push(start);
    labels[start] = label;
    while (queue.length > 0) {
      const idx = queue.pop()!;
      count++;
      const x = idx % w;
      const y = Math.floor(idx / w);
      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] === 1 && labels[ni] === -1) {
          labels[ni] = label;
          queue.push(ni);
        }
      }
    }
    return count;
  }

  let nextLabel = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] === 1 && labels[i] === -1) {
      const size = flood(i, nextLabel);
      sizes.push(size);
      nextLabel++;
    }
  }

  // 3. Filtrer les petits clusters
  for (let i = 0; i < w * h; i++) {
    const label = labels[i];
    if (label >= 0 && sizes[label] < minClusterSize) {
      mask[i] = 0;
    }
  }

  return mask;
}

/**
 * Assigne la profondeur d'eau pour un masque donné.
 *   - Shallow : bordure (eau adjacente à terre)
 *   - Middle  : transition (1 tuile depuis shallow)
 *   - Deep    : centre (2+ tuiles depuis bordure)
 */
function assignWaterDepth(
  tiles: ITile[],
  mask: Uint8Array,
  w: number, h: number,
  waterType: 'parkland' | 'lake',
): void {
  // Distance à la terre la plus proche (Manhattan approximé)
  const dist = new Int32Array(w * h).fill(99);
  const queue: number[] = [];

  // Initialiser les bords eau↔terre à distance 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) continue; // terre
      // Vérifier les 4 voisins
      const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      let adjacentToLand = false;
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          adjacentToLand = true; // bord de carte = terre
          continue;
        }
        if (mask[ny * w + nx] === 0) adjacentToLand = true;
      }
      if (adjacentToLand) {
        dist[idx] = 1;
        queue.push(idx);
      }
    }
  }

  // BFS pour propager les distances
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    const d = dist[idx] + 1;
    const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (mask[ni] === 1 && dist[ni] > d) {
        dist[ni] = d;
        queue.push(ni);
      }
    }
  }

  // Assigner le type selon distance
  for (let i = 0; i < w * h; i++) {
    if (mask[i] === 0) continue;
    const d = dist[i];
    if (d <= 1) {
      tiles[i].type = TileType.WaterShallow;
    } else if (d <= 3) {
      tiles[i].type = TileType.WaterMiddle;
    } else {
      tiles[i].type = TileType.WaterDeep;
    }
    // L'eau reste plate (élévation 0)
  }
}

/**
 * Génère une carte Parkland avec végétation, élévation et points d'eau.
 *
 * Distribution :
 *   - Eau : ~15% de la carte, en clusters (lacs/étangs)
 *   - Rough     : ~50%
 *   - DeepRough : ~13%
 *   - Woods     : ~12%
 *   - Brush     : ~10%
 *
 * L'élévation est générée par bruit de Perlin-like sur une grille
 * de coins (width+1)×(height+1), valeurs 0-4.
 */
export function generateVegetationGrid(
  width: number = 40,
  height: number = 40,
): IMapState {
  const terrain = Terrain.getInstance();
  terrain.initSystem(width, height, null, false);
  terrain.theme = CourseTheme.Parkland;

  const { tiles } = terrain;

  // ── 1. Génération de l'élévation ──
  const elevMap = generateElevationMap(width, height);
  assignElevations(tiles, elevMap, width, height);

  // ── 2. Bruit terrain (végétation) ──
  const noise1 = generateNoise(width, height, 6);   // grandes zones
  const noise2 = generateNoise(width, height, 3);   // détails

  // Bruit eau (basse fréquence — lacs de grande échelle)
  const waterNoise = generateNoise(width, height, 10);

  // Masque d'eau avec clusters (min 8 tuiles)
  const waterMask = generateWaterMask(width, height, waterNoise, 0.18, 8, 2);

  // ── 3. Distribution des types de sol (hors eau) ──
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (waterMask[idx] === 1) {
        // L'eau garde son élévation, le type sera assigné par assignWaterDepth
        continue;
      }

      const n = noise1[idx] * 0.6 + noise2[idx] * 0.4;
      const type = n < 0.60 ? TileType.Rough
        : n < 0.75 ? TileType.DeepRough
        : n < 0.90 ? TileType.Tree
        : TileType.Flower;
      terrain.setType(tiles[idx], type, 0);
    }
  }

  // ── 4. Assigner profondeurs d'eau ──
  assignWaterDepth(tiles, waterMask, width, height, 'parkland');

  // ── 5. Calculer les passes de rendu ──
  terrain.computeAllRenderPasses();

  return {
    width, height,
    theme: CourseTheme.Parkland,
    tiles,
    lighting: terrain.lighting,
    zoomLevel: terrain.zoomLevel,
    splineHeight: terrain.splineHeight,
    viewMode: 0,
  };
}

// ─── GÉNÉRATION PARKLAND COMPLÈTE ───

function generateFairwayZones(w: number, h: number): boolean[] {
  const z = new Array(w * h).fill(false);
  for (let i = 0; i < 9; i++) {
    let x = 3 + ((i * 7 + 3) % (w - 6));
    let y = h - 5 - i * 4;
    const gx = Math.min(w - 4, Math.max(3, x + ((i * 3 + 1) % 5 - 2)));
    const gy = Math.max(3, y - 16 + (i % 3));
    const dx = Math.abs(gx - x);
    const dy = Math.abs(gy - y);
    const sx = x < gx ? 1 : -1;
    const sy = y < gy ? 1 : -1;
    let err = dx - dy;
    while (x !== gx || y !== gy) {
      for (let wy = -2; wy <= 2; wy++)
        for (let wx = -2; wx <= 2; wx++) {
          const tx = x + wx;
          const ty = y + wy;
          if (tx >= 0 && tx < w && ty >= 0 && ty < h)
            z[ty * w + tx] = true;
        }
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  return z;
}

function placeHoles(tiles: ITile[], w: number, h: number): void {
  const terrain = Terrain.getInstance();
  for (let i = 0; i < 9; i++) {
    const teeY = h - 5 - i * 4;
    const teeX = 3 + ((i * 7 + 3) % (w - 6));
    const greenY = Math.max(3, teeY - 15 + (i % 3));
    const greenX = Math.min(w - 4, Math.max(3, teeX + ((i * 3 + 1) % 5 - 2)));

    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const tx = teeX + dx;
        const ty = teeY + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          const tile = tiles[ty * w + tx];
          terrain.setType(tile, TileType.Tee, 0);
          tile.elevation = [0, 0, 0, 0];
        }
      }

    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const gx = greenX + dx;
        const gy = greenY + dy;
        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
          const tile = tiles[gy * w + gx];
          terrain.setType(tile,
            Math.abs(dx) <= 1 && Math.abs(dy) <= 1
              ? TileType.PuttingGreen
              : TileType.Fairway, 0);
        }
      }
  }
}

function applyVariations(tiles: ITile[], w: number, h: number): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const maxVar = MAX_VARIATION[tiles[idx].type] ?? 1;
      tiles[idx].variation = maxVar > 1
        ? ((x * 31 + y * 17) % maxVar)
        : 0;
    }

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const tile = tiles[idx];
      const maxVar = MAX_VARIATION[tile.type] ?? 1;
      if (maxVar <= 1) continue;

      const used = new Set<number>();
      if (y > 0) { const n = tiles[(y - 1) * w + x]; if (n.type === tile.type) used.add(n.variation); }
      if (x > 0) { const n = tiles[y * w + (x - 1)]; if (n.type === tile.type) used.add(n.variation); }
      if (used.has(tile.variation)) {
        for (let v = 0; v < maxVar; v++) {
          if (!used.has(v)) { tile.variation = v; break; }
        }
      }
    }
}

/**
 * Génère une carte Parkland complète avec fairways, greens, tees,
 * bunkers, élévation et points d'eau.
 */
export function generateParklandGrid(
  width: number = 40,
  height: number = 40,
): IMapState {
  const terrain = Terrain.getInstance();
  terrain.initSystem(width, height, null, false);
  terrain.theme = CourseTheme.Parkland;
  terrain.resetTerrain();

  const { tiles } = terrain;

  // Générer l'élévation d'abord
  const elevMap = generateElevationMap(width, height);
  assignElevations(tiles, elevMap, width, height);

  const noise = generateNoise(width, height, 8);
  const fairway = generateFairwayZones(width, height);

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const n = noise[idx];

      if (fairway[idx]) {
        terrain.setType(tiles[idx],
          n < 0.3 ? TileType.Fairway
          : n < 0.5 ? TileType.Tee
          : n < 0.85 ? TileType.Fairway
          : n < 0.92 ? TileType.SandBunker
          : TileType.Rough, 0);
      } else if (n < 0.10) {
        terrain.setType(tiles[idx], TileType.WaterShallow, 0);
        tiles[idx].elevation = [0, 0, 0, 0];
      } else if (n < 0.14) {
        terrain.setType(tiles[idx], TileType.SandBunker,
          ((x * 7 + y * 13) % 5));
      } else if (n < 0.18) {
        terrain.setType(tiles[idx], TileType.DeepRough, 0);
      } else if (n < 0.85) {
        terrain.setType(tiles[idx], TileType.Rough, 0);
      } else if (n < 0.90) {
        terrain.setType(tiles[idx], TileType.Tree, 0);
      } else {
        terrain.setType(tiles[idx], TileType.Flower, 0);
      }
    }

  placeHoles(tiles, width, height);
  applyVariations(tiles, width, height);
  terrain.computeAllRenderPasses();

  return {
    width, height,
    theme: CourseTheme.Parkland,
    tiles,
    lighting: terrain.lighting,
    zoomLevel: terrain.zoomLevel,
    splineHeight: terrain.splineHeight,
    viewMode: 0,
  };
}

// ─── MAPPING PASSE → CHEMIN DE TEXTURE ───

function textureFolderForType(type: TileType): string {
  switch (type) {
    case TileType.Rough:        return 'rough';
    case TileType.DeepRough:    return 'deeprough';
    case TileType.Fairway:      return 'fairway';
    case TileType.PuttingGreen: return 'puttinggreen';
    case TileType.SandBunker:   return 'sandbunker';
    case TileType.Tee:          return 'tee';
    case TileType.GrassySand:   return 'grassysand';
    case TileType.GrassBunker:  return 'grassbunker';
    case TileType.WaterShallow: return 'watershallow';
    case TileType.WaterMiddle:  return 'watermiddle';
    case TileType.WaterDeep:    return 'waterdeep';
    case TileType.Cliff:        return 'cliff';
    case TileType.Tree:         return 'woods';
    case TileType.Flower:       return 'brush';
    case TileType.Path:         return 'ravine';
    case TileType.Building:     return 'building';
    case TileType.Rock:         return 'rock';
    case TileType.Marsh:        return 'marsh';
    case TileType.Overgrowth:   return 'overgrowth';
    case TileType.FirmFairway:  return 'firmfairway';
    case TileType.ZenSand:      return 'zensand';
    case TileType.TrickyGreen:  return 'trickygreen';
    case TileType.PotSandBunker:return 'sandbunker';
    default:                    return 'rough';
  }
}

function texturePrefixForType(type: TileType, subType?: number): string {
  switch (type) {
    case TileType.Rough:        return 'ROUGH';
    case TileType.DeepRough:    return 'DEEPROUGH';
    case TileType.Fairway:      return 'FAIRWAY';
    case TileType.PuttingGreen: return 'PUTTINGGREEN';
    case TileType.SandBunker:
      return subType ? `SANDBUNKER${subType}` : 'SANDBUNKER';
    case TileType.Tee:          return 'TEE';
    case TileType.GrassySand:   return 'GRASSYSAND';
    case TileType.GrassBunker:  return 'GRASSBUNKER';
    case TileType.WaterShallow: return 'WATERSHALLOW';
    case TileType.WaterMiddle:  return 'WATERMIDDLE';
    case TileType.WaterDeep:    return 'WATERDEEP';
    case TileType.Cliff:        return 'CLIFF';
    case TileType.Tree:         return 'WOODS';
    case TileType.Flower:       return 'BRUSH';
    case TileType.Path:         return 'RAVINE';
    case TileType.Building:     return 'BUILDING';
    case TileType.Rock:         return 'ROCK';
    case TileType.Marsh:        return 'MARSH';
    case TileType.Overgrowth:   return 'OVERGROWTH';
    case TileType.FirmFairway:  return 'FIRMFAIRWAY';
    case TileType.ZenSand:      return 'ZENSAND';
    case TileType.TrickyGreen:  return 'TRICKYGREEN';
    case TileType.PotSandBunker:return 'POTSANDBUNKER';
    default:                    return 'ROUGH';
  }
}

/**
 * Retourne le chemin de la texture WebP pour une passe de rendu.
 */
export function texturePathForPass(pass: IRenderPass): string {
  const folder = textureFolderForType(pass.type);
  const prefix = texturePrefixForType(pass.type, pass.subType);
  const var4 = String(pass.variation + 1).padStart(4, '0');
  return `/assets/textures/parkland/${folder}/${prefix}${pass.suffix}${var4}.webp`;
}

/**
 * Retourne le chemin de texture pour une tuile (passe 0 uniquement).
 * @deprecated Utiliser texturePathForPass() avec les renderPasses[]
 */
export function texturePathForTile(tile: ITile): string | null {
  if (tile.renderPasses && tile.renderPasses.length > 0) {
    return texturePathForPass(tile.renderPasses[0]);
  }
  return null;
}

// ─── MAILLAGE THREE.JS ───

export interface MeshGroup {
  geometry: THREE.BufferGeometry;
  textureKey: string | null;
  fallbackColor: [number, number, number];
  /** Vrai si c'est une passe d'overlay (transparent, renderOrder=1) */
  isOverlay?: boolean;
}

const palette: Record<number, [number, number, number]> = {
  [TileType.Rough]:        [0.227, 0.490, 0.227],
  [TileType.Fairway]:      [0.306, 0.651, 0.306],
  [TileType.PuttingGreen]: [0.180, 0.800, 0.251],
  [TileType.SandBunker]:   [0.910, 0.835, 0.627],
  [TileType.WaterShallow]: [0.200, 0.533, 0.800],
  [TileType.WaterMiddle]:  [0.133, 0.467, 0.733],
  [TileType.WaterDeep]:    [0.067, 0.400, 0.667],
  [TileType.DeepRough]:    [0.176, 0.353, 0.118],
  [TileType.GrassySand]:   [0.784, 0.722, 0.471],
  [TileType.GrassBunker]:  [0.863, 0.784, 0.565],
  [TileType.Tee]:          [0.361, 0.722, 0.361],
  [TileType.Cliff]:        [0.533, 0.467, 0.400],
  [TileType.Path]:         [0.784, 0.722, 0.596],
  [TileType.Building]:     [0.600, 0.400, 0.267],
  [TileType.Tree]:         [0.176, 0.353, 0.118],
  [TileType.Flower]:       [0.800, 0.267, 0.533],
  [TileType.Rock]:         [0.533, 0.467, 0.400],
  [TileType.Marsh]:        [0.267, 0.400, 0.333],
  [TileType.Overgrowth]:   [0.157, 0.314, 0.078],
  [TileType.FirmFairway]:  [0.357, 0.702, 0.357],
  [TileType.ZenSand]:      [0.953, 0.918, 0.761],
  [TileType.TrickyGreen]:  [0.210, 0.620, 0.271],
  [TileType.PotSandBunker]:[0.953, 0.878, 0.729],
};

/**
 * Calcule la normale d'un quadrilatère par le cross product des diagonales.
 * Formule du jeu original (Terrain.dll) :
 *   nx = (zTR - zBL) * TILE_H
 *   ny = (zBR - zTL) * TILE_W
 *   nz = TILE_W * TILE_H * 2
 * Puis normalisation.
 */
function computeTileNormal(
  hTL: number, hTR: number, hBR: number, hBL: number,
  tileW: number, tileH: number, elevScale: number,
): THREE.Vector3 {
  const zTL = hTL * elevScale;
  const zTR = hTR * elevScale;
  const zBR = hBR * elevScale;
  const zBL = hBL * elevScale;

  // Cross product des diagonales (formule Terrain.dll)
  const nx = (zTR - zBL) * tileH;
  const ny = (zBR - zTL) * tileW;
  const nz = tileW * tileH * 2;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return new THREE.Vector3(nx / len, ny / len, nz / len);
}

/**
 * Construit des BufferGeometry Three.js groupés par texture.
 *
 * Chaque tuile est rendue comme 2 triangles avec la diagonale
 * la plus courte comme coupe (TL-BR ou TR-BL).
 *
 * Toutes les passes de rendu sont incluses (pas seulement la passe 0).
 * Les passes 1+ sont marquées isOverlay=true pour le rendu transparent.
 *
 * Pas de normales 3D (MeshBasicMaterial, pas d'éclairage — comme le jeu original).
 */
export function buildParklandMesh(mapState: IMapState): MeshGroup[] {
  const { width, height, tiles } = mapState;
  // Groupe de géométrie par textureKey
  const baseGroups = new Map<string, { tileIdx: number[]; textureKey: string; type: TileType; isOverlay: boolean }>();
  const overlayGroups = new Map<string, { tileIdx: number[]; textureKey: string; type: TileType; isOverlay: boolean }>();
  const pathGroups: MeshGroup[] = [];

  const TILE_W = 128;
  const TILE_H = 64;
  const ELEV_SCALE = 32;

  // ── 1. Grouper les passes par textureKey ──
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const passes = tile.renderPasses.length > 0
      ? tile.renderPasses
      : [{ type: tile.type, variation: tile.variation, suffix: 'A', textureKey: `${tile.type}:${tile.variation}:A`, terrainTypeByte: tile.type } as IRenderPass];

    for (let p = 0; p < passes.length; p++) {
      const pass = passes[p];
      const key = pass.textureKey ?? `${pass.type}:${pass.variation}:${pass.suffix}`;
      const target = p === 0 ? baseGroups : overlayGroups;
      if (!target.has(key)) {
        target.set(key, { tileIdx: [], textureKey: key, type: pass.type, isOverlay: p > 0 });
      }
      target.get(key)!.tileIdx.push(i);
    }
  }


  const results: MeshGroup[] = [];

  // ── 2. Construire la géométrie pour chaque groupe de passe de base ──
  for (const [, group] of baseGroups) {
    const mesh = buildGeometryForGroup(group, tiles, TILE_W, TILE_H, ELEV_SCALE);
    if (mesh) results.push(mesh);
  }

  // ── 3. Construire la géométrie pour chaque groupe d'overlay ──
  for (const [, group] of overlayGroups) {
    const mesh = buildGeometryForGroup(group, tiles, TILE_W, TILE_H, ELEV_SCALE);
    if (mesh) results.push(mesh);
  }

  // ── 4. Générer les quads de chemins (post-process paths) ──
  const pathVerts: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    // Chemins N/S/E/W — quads de connexion entre tiles voisines
    if (tile.pathN && tile.neighborN) addPathQuad(i, 'N', tiles, width, pathVerts, TILE_W, TILE_H, ELEV_SCALE);
    if (tile.pathS && tile.neighborS) addPathQuad(i, 'S', tiles, width, pathVerts, TILE_W, TILE_H, ELEV_SCALE);
    if (tile.pathE && tile.neighborE) addPathQuad(i, 'E', tiles, width, pathVerts, TILE_W, TILE_H, ELEV_SCALE);
    if (tile.pathW && tile.neighborW) addPathQuad(i, 'W', tiles, width, pathVerts, TILE_W, TILE_H, ELEV_SCALE);
  }
  if (pathVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pathVerts), 3));
    results.push({ geometry: geo, textureKey: 'special:path', fallbackColor: [0.6, 0.5, 0.4], isOverlay: true });
  }

  return results;
}

// ── Helper pour construire la géométrie d'un groupe ──

function buildGeometryForGroup(
  group: { tileIdx: number[]; textureKey: string; type: TileType; isOverlay: boolean },
  tiles: ITile[],
  TILE_W: number, TILE_H: number, ELEV_SCALE: number,
): MeshGroup | null {
  const nTiles = group.tileIdx.length;
  const vertsPerTile = 6;
  const totalVerts = nTiles * vertsPerTile;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);

  const baseColor = palette[group.type] ?? [0.227, 0.490, 0.227];
  let vi = 0;

  const appendVertex = (x: number, y: number, z: number, u: number, v: number) => {
    const i3 = vi * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    uvs[vi * 2] = u;
    uvs[vi * 2 + 1] = v;
    normals[i3] = 0;
    normals[i3 + 1] = 1;
    normals[i3 + 2] = 0;
    vi++;
  };

  for (const tileIdx of group.tileIdx) {
    const tile = tiles[tileIdx];
    const [hTL, hTR, hBR, hBL] = tile.elevation;

    const pTL = tileVertexPosition(tile.x, tile.y, hTL);
    const pTR = tileVertexPosition(tile.x + 1, tile.y, hTR);
    const pBL = tileVertexPosition(tile.x, tile.y + 1, hBL);
    const pBR = tileVertexPosition(tile.x + 1, tile.y + 1, hBR);

    const d1 = Math.abs(hTL - hBR);
    const d2 = Math.abs(hTR - hBL);
    const diagTLBR = d1 < d2;

    const baseVi = vi;

    if (diagTLBR) {
      appendVertex(pTL.x, pTL.y, pTL.z, 0, 0);
      appendVertex(pTR.x, pTR.y, pTR.z, 1, 0);
      appendVertex(pBL.x, pBL.y, pBL.z, 0, 1);
      appendVertex(pTR.x, pTR.y, pTR.z, 1, 0);
      appendVertex(pBR.x, pBR.y, pBR.z, 1, 1);
      appendVertex(pBL.x, pBL.y, pBL.z, 0, 1);
    } else {
      appendVertex(pTL.x, pTL.y, pTL.z, 0, 0);
      appendVertex(pTR.x, pTR.y, pTR.z, 1, 0);
      appendVertex(pBR.x, pBR.y, pBR.z, 1, 1);
      appendVertex(pTL.x, pTL.y, pTL.z, 0, 0);
      appendVertex(pBR.x, pBR.y, pBR.z, 1, 1);
      appendVertex(pBL.x, pBL.y, pBL.z, 0, 1);
    }

    for (let k = 0; k < 6; k++) {
      const idx = (baseVi + k) * 3;
      colors[idx] = baseColor[0];
      colors[idx + 1] = baseColor[1];
      colors[idx + 2] = baseColor[2];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  return {
    geometry,
    textureKey: group.textureKey,
    fallbackColor: baseColor,
    isOverlay: group.isOverlay,
  };
}

// ── Helper pour générer les quads de chemin (post-process paths) ──

function addPathQuad(
  tileIdx: number,
  dir: 'N' | 'S' | 'E' | 'W',
  tiles: ITile[],
  gridW: number,
  out: number[],
  TILE_W: number, TILE_H: number, ELEV_SCALE: number,
): void {
  const tile = tiles[tileIdx];
  const neighbor = tile.neighborN ?? tile.neighborS ?? tile.neighborE ?? tile.neighborW;
  if (!neighbor) return;

  // Chemin = petit quad entre les deux tiles
  // On crée 2 triangles centrés sur la bordure
  const hSelf = tile.elevation[0]; // approximation
  const hNei = neighbor.elevation[0];

  // Positions le long de la bordure entre les deux tiles
  const ax = tile.x;
  const ay = tile.y;
  const bx = neighbor.x;
  const by = neighbor.y;

  // Milieu de la bordure
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  // Points du quad
  const p0 = tileVertexPosition(ax, ay, hSelf);
  const p1 = tileVertexPosition(bx, by, hNei);

  // Petit quad de 0.3 tile de large
  const W = 0.3;
  let q: { x: number; y: number; z: number }[];
  if (dir === 'N' || dir === 'S') {
    // Bordure horizontale dans la grille → quads décalés en Z
    q = [
      tileVertexPosition(mx - W, my, hSelf),
      tileVertexPosition(mx + W, my, hSelf),
      tileVertexPosition(mx + W, my + W * 2 * (dir === 'S' ? 1 : -1), hNei),
      tileVertexPosition(mx - W, my + W * 2 * (dir === 'S' ? 1 : -1), hNei),
    ];
  } else {
    // Bordure verticale → décalés en X
    q = [
      tileVertexPosition(mx, my - W, hSelf),
      tileVertexPosition(mx, my + W, hSelf),
      tileVertexPosition(mx + W * 2 * (dir === 'E' ? 1 : -1), my + W, hNei),
      tileVertexPosition(mx + W * 2 * (dir === 'E' ? 1 : -1), my - W, hNei),
    ];
  }

  // 2 triangles
  for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
    out.push(v.x, v.y, v.z);
  }
}