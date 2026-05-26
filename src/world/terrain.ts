/**
 * world/terrain.ts — Génération de terrain + textures + maillage
 *
 * ⚠️ SOURCE DE VÉRITÉ : terrain-ts (simgolf-re/terrain-ts)
 *   - Types : TileType, ITile, IRenderPass, IMapState → terrain-ts
 *   - Logique terrain : computeRenderPasses, getGeometryType → terrain-ts
 *   - Autotiling vertex-based : TerrainTransitionManager → terrain-ts
 *
 * Ce fichier ne fait QUE :
 *   1. Génération procédurale (bruit + distribution dont water clusters)
 *   2. Construction de maillage Three.js à partir des passes de rendu
 *   3. Chemins / overlays
 */

import * as THREE from 'three';
import {
  TileType,
  CourseTheme,
  ITile,
  IMapState,
  Terrain,
  MAX_VARIATION,
  getGeometryType,
} from '../terrain-lib/index.js';

// ─── CONSTANTES DE GÉNÉRATION ───

const COSMETIC_MAX = 5;
const ELEVATION_MAX = 4; // 0-4 comme le jeu original

// ─── Palette de couleurs (fallback pour transitions sans texture) ───

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
        elevMap[y * gw + x],           // TL (y, x)
        elevMap[y * gw + x + 1],       // TR (y, x+1)
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

  // ── 5. Calculer les passes de rendu via vertex-based autotiling ──
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

// ─── GÉNÉRATION ROUGH UNI (DEBUG) ───

/**
 * Génère une carte 100% Rough, élévation plate, variation 0001.
 * Utile pour tester le rendu de base sans transitions.
 */
export function generateGridRough(
  width: number = 40,
  height: number = 40,
): IMapState {
  const terrain = Terrain.getInstance();
  terrain.initSystem(width, height, null, false);
  terrain.theme = CourseTheme.Parkland;
  terrain.resetTerrain();

  const { tiles } = terrain;

  for (let i = 0; i < tiles.length; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    tiles[i].type = TileType.Rough;
    tiles[i].elevation = [0, 0, 0, 0];
    tiles[i].variation = 0;
    tiles[i].subType = 0;

    // Bande de Fairway horizontale au milieu
    if (y >= Math.floor(height / 2) - 1 && y <= Math.floor(height / 2) + 1) {
      tiles[i].type = TileType.Fairway;
    }
    // Bande de Fairway verticale au milieu
    if (x >= Math.floor(width / 2) - 1 && x <= Math.floor(width / 2) + 1) {
      tiles[i].type = TileType.Fairway;
    }
  }

  // Tuile Wood au centre exact (entourée de Fairway → 0004 sur 4 coins)
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  tiles[cy * width + cx].type = TileType.Tree;
  tiles[cy * width + cx].variation = 0;

  // Re-link neighbors (resetTerrain le fait déjà via linkNeighbors)
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
          ((x * 7 + y * 13) % 4) + 1);
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
 * Retourne le chemin de la texture WebP pour une passe de rendu
 * qui est une tuile PLEINE (texture de base existante).
 * @deprecated Les passes utilisent maintenant textureKey directement
 */
function texturePathForPass(type: TileType, variation: number, suffix: string, subType?: number): string | null {
  const folder = textureFolderForType(type);
  const prefix = texturePrefixForType(type, subType);
  const var4 = String(variation + 1).padStart(4, '0');
  return `/assets/textures/parkland/${folder}/${prefix}${suffix || 'A'}${var4}.webp`;
}

/**
 * Retourne le chemin de texture WebP pour une variation de transition.
 * Format: {PREFIX}{GEOM}{VAR4}.webp
 * Exemple: DEEPROUGHA0004.webp (variation 4 = 0004)
 */
function transitionPathForVariation(type: TileType, variation: number, geomSuffix: string = 'A'): string {
  const folder = textureFolderForType(type);
  const prefix = texturePrefixForType(type);
  const var4 = String(variation).padStart(4, '0');
  return `/assets/textures/parkland/${folder}/${prefix}${geomSuffix}${var4}.webp`;
}

/**
 * Retourne le chemin de texture pour une tuile (passe 0 uniquement).
 * @deprecated Les passes utilisent maintenant textureKey directement
 */
export function texturePathForTile(tile: ITile): string | null {
  if (tile.renderPasses && tile.renderPasses.length > 0) {
    const pass = tile.renderPasses[0];
    return texturePathForPass(pass.type, pass.variation, pass.suffix || 'A', pass.subType);
  }
  return null;
}

// ─── MAILLAGE THREE.JS ───

export interface MeshGroup {
  geometry: THREE.BufferGeometry;
  textureKey: string | null;
  fallbackColor: [number, number, number];
  /** Sous-type (pour SandBunker notamment) */
  subType?: number;
}

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
 * Construit des BufferGeometry Three.js groupés par textureKey.
 *
 * Chaque tuile = 4 quadrants × 2 triangles = 8 passes.
 * Chaque passe a déjà ses vertexPositions, texCoordIndices et
 * textureKey pré-calculés par computeRenderPasses().
 *
 * On groupe les triangles par textureKey pour minimiser les
 * changements de texture (draw calls).
 */
export function buildParklandMesh(mapState: IMapState): MeshGroup[] {
  const { tiles } = mapState;

  // Groupe de triangles par textureKey
  interface TriGroup { positions: number[]; uvs: number[]; type: TileType }
  const groups = new Map<string, TriGroup>();

  const addTri = (
    key: string,
    positions: [number,number,number,number,number,number,number,number,number],
    uvs: [number,number,number,number,number,number],
    type: TileType,
  ) => {
    if (!groups.has(key)) groups.set(key, { positions: [], uvs: [], type });
    const g = groups.get(key)!;
    g.positions.push(...positions);
    g.uvs.push(...uvs);
  };

  for (let ti = 0; ti < tiles.length; ti++) {
    const tile = tiles[ti];
    const type = tile.type;

    for (const pass of tile.renderPasses) {
      addTri(
        pass.textureKey ?? `${type}:0:A`,
        pass.vertexPositions,
        pass.texCoordIndices,
        pass.type,
      );
    }
  }

  // ── 2. Construire les MeshGroup ──
  const results: MeshGroup[] = [];
  for (const [key, group] of groups) {
    const n = group.positions.length / 3;
    if (n === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(group.positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(group.uvs), 2));

    const c = palette[group.type] ?? [0.227, 0.490, 0.227];
    results.push({ geometry, textureKey: key, fallbackColor: c });
  }

  // ── 3. SubType par groupe (extraction du premier triangle) ──
  // Pour connaître le subType d'un groupe, on cherche dans les passes originales
  // le premier pass dont la textureKey correspond.
  // Note : le subType vient de la passe, pas du MeshGroup — utilisons la key.
  // Les types SandBunker ont des keys uniques grâce à la variation.
  // Pas de subType dans MeshGroup — il est encodé dans la textureKey via buildPath.

  // ── 3. Chemins (post-process paths) ──
  const pv: number[] = [];
  for (const tile of tiles) {
    if (tile.pathN && tile.neighborN) addPathQuad(tile, 'N', pv);
    if (tile.pathS && tile.neighborS) addPathQuad(tile, 'S', pv);
    if (tile.pathE && tile.neighborE) addPathQuad(tile, 'E', pv);
    if (tile.pathW && tile.neighborW) addPathQuad(tile, 'W', pv);
  }
  if (pv.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pv), 3));
    results.push({ geometry: geo, textureKey: 'special:path', fallbackColor: [0.6, 0.5, 0.4] });
  }

  return results;
}

function addPathQuad(
  tile: ITile,
  dir: 'N' | 'S' | 'E' | 'W',
  out: number[],
): void {
  const neighbor = dir === 'N' ? tile.neighborN
    : dir === 'S' ? tile.neighborS
    : dir === 'E' ? tile.neighborE
    : tile.neighborW;
  if (!neighbor) return;

  const [hTL, hTR, hBR, hBL] = tile.elevation;
  const p = (x: number, y: number, z: number) => [(x - y) * 64, z * 32, (x + y) * 32];

  const mx = (tile.x + neighbor.x) / 2;
  const my = (tile.y + neighbor.y) / 2;
  const W = 0.3;

  let q: number[][];
  if (dir === 'N' || dir === 'S') {
    const hSelf = (hTL + hTR) / 2;
    const hNei = (neighbor.elevation[0] + neighbor.elevation[1]) / 2;
    const sign = dir === 'S' ? 1 : -1;
    q = [
      p(mx - W, my, hSelf),
      p(mx + W, my, hSelf),
      p(mx + W, my + W * 2 * sign, hNei),
      p(mx - W, my + W * 2 * sign, hNei),
    ];
  } else {
    const hSelf = (hTL + hBL) / 2;
    const hNei = (neighbor.elevation[0] + neighbor.elevation[3]) / 2;
    const sign = dir === 'E' ? 1 : -1;
    q = [
      p(mx, my - W, hSelf),
      p(mx, my + W, hSelf),
      p(mx + W * 2 * sign, my + W, hNei),
      p(mx + W * 2 * sign, my - W, hNei),
    ];
  }
  for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]])
    out.push(v[0], v[1], v[2]);
}
