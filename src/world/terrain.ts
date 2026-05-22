/**
 * world/terrain.ts — Génération du maillage Parkland
 *
 * Produit une IMapState complète (grille de tuiles avec élévation et types)
 * puis construit des BufferGeometry Three.js groupés par texture.
 *
 * L'algorithme de génération Parkland suit les règles documentées dans
 * REFERENCE_GUIDE.md §3 (Système de Terrain) :
 *   1. resetTerrain() — toutes les tuiles en WaterShallow, élévation plate
 *   2. applyParklandDistribution() — bruit de valeur + zones fairway
 *   3. placeHoles() — Tees + Greens sur les fairways
 *   4. buildMesh() — construction des maillages Three.js
 */

import * as THREE from 'three';
import {
  TileType,
  CourseTheme,
  ITile,
  IMapState,
  TILE_W,
  TILE_H,
  ELEVATION_SCALE,
} from '../core/types';
import { tileVertexPosition } from '../render/camera';

// ================================================================
// CONSTANTES — Réglages du terrain
// ================================================================

const COSMETIC_MAX = 5;

// ================================================================
// Groupes géométriques (A-E) : déterminés par les 4 hauteurs
// ================================================================

/**
 * Détermine le groupe géométrique (A-E) selon les 4 hauteurs des coins.
 * REFERENCE_GUIDE.md §5.2
 *
 * A = plat (tous égaux)
 * B = pente simple (2 adjacents)
 * C = coin (1 différent)
 * D = diagonale (opposés égaux)
 * E = raide (Δ ≥ 2 entre adjacents)
 */
export function getGeometryType(e: [number, number, number, number]): string {
  const [a, b, c, d] = e;

  // E : Raide — écart ≥ 2 entre 2 coins adjacents
  if (Math.abs(a - b) >= 2 || Math.abs(b - c) >= 2 ||
      Math.abs(c - d) >= 2 || Math.abs(d - a) >= 2)
    return 'E';
  // A : Plat — tous identiques
  if (a === b && b === c && c === d) return 'A';
  // D : Diagonale — les DEUX paires opposées sont égales ET différentes
  //     Ex: [1,0,1,0] → TL=BR=1, TR=BL=0
  if (a === c && b === d && a !== b) return 'D';
  // B : Pente simple — 2 coins adjacents égaux, les 2 autres aussi
  //     Ex: [1,1,0,0] → TL=TR, BR=BL
  if ((a === b && c === d && a !== c) ||
      (b === c && d === a && b !== d))
    return 'B';
  // C : Coin — tout le reste (1 seul coin différent des 3 autres)
  return 'C';
}

/**
 * Familles de terrain — 2 tuiles de même famille ne produisent PAS
 * de bordure de transition (REFERENCE_GUIDE.md §3.6).
 */
const TERRAIN_FAMILIES: Record<number, string> = {
  [TileType.Rough]: 'grass',
  [TileType.Tree]: 'grass',
  [TileType.Flower]: 'grass',
  [TileType.DeepRough]: 'grass',
  [TileType.Fairway]: 'play',
  [TileType.Tee]: 'play',
  [TileType.PuttingGreen]: 'play',
  [TileType.SandBunker]: 'sand',
  [TileType.GrassySand]: 'sand',
  [TileType.GrassBunker]: 'sand',
  [TileType.WaterShallow]: 'water',
  [TileType.WaterMiddle]: 'water',
  [TileType.WaterDeep]: 'water',
  [TileType.Path]: 'path',
  [TileType.Cliff]: 'cliff',
  [TileType.Building]: 'building',
};

export function getTerrainFamily(type: TileType): string {
  return TERRAIN_FAMILIES[type] ?? 'grass';
}

/**
 * Calcule le masque de voisinage 4 bits (N=1, E=2, S=4, W=8).
 * Un bit = 1 si le voisin cardinal est d'une famille différente.
 * REFERENCE_GUIDE.md §5.3
 */
export function computeEdgeMask(
  tiles: ITile[], w: number, h: number, x: number, y: number,
): number {
  const family = getTerrainFamily(tiles[y * w + x].type);
  let mask = 0;
  const checks: [number, number, number][] = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  for (const [dx, dy, bit] of checks) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
      if (getTerrainFamily(tiles[ny * w + nx].type) !== family)
        mask |= bit;
    }
  }
  return mask;
}

// ================================================================
// 1. Bruit de valeur (value noise avec interpolation cosinus)
// ================================================================

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

// ================================================================
// 2. Zones de fairway (serpentins Bresenham)
// ================================================================

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

// ================================================================
// 3. Distribution Parkland
// ================================================================

function applyDistribution(
  tiles: ITile[],
  w: number,
  h: number,
  noise: Float32Array,
  fairway: boolean[],
): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const n = noise[idx];
      const t = tiles[idx];

      if (fairway[idx]) {
        t.type = n < 0.3
          ? TileType.Fairway
          : n < 0.5
            ? TileType.Tee
            : n < 0.85
              ? TileType.Fairway
              : n < 0.92
                ? TileType.SandBunker
                : TileType.Rough;
      } else if (n < 0.10) {
        t.type = TileType.WaterShallow;
      } else if (n < 0.14) {
        t.type = TileType.SandBunker;
      } else if (n < 0.18) {
        t.type = TileType.DeepRough;
      } else if (n < 0.85) {
        t.type = TileType.Rough;
      } else if (n < 0.90) {
        t.type = TileType.Tree;
      } else {
        t.type = TileType.Flower;
      }
    }
}

// ================================================================
// 4. Placement des trous (Tee + Green)
// ================================================================

function placeHoles(tiles: ITile[], w: number, h: number): void {
  for (let i = 0; i < 9; i++) {
    const teeY = h - 5 - i * 4;
    const teeX = 3 + ((i * 7 + 3) % (w - 6));
    const greenY = Math.max(3, teeY - 15 + (i % 3));
    const greenX = Math.min(w - 4, Math.max(3, teeX + ((i * 3 + 1) % 5 - 2)));

    // Tee 3×3
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const tx = teeX + dx;
        const ty = teeY + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          tiles[ty * w + tx].type = TileType.Tee;
          tiles[ty * w + tx].elevation = [0, 0, 0, 0];
        }
      }

    // Green 5×5
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const gx = greenX + dx;
        const gy = greenY + dy;
        if (gx >= 0 && gx < w && gy >= 0 && gy < h)
          tiles[gy * w + gx].type =
            Math.abs(dx) <= 1 && Math.abs(dy) <= 1
              ? TileType.PuttingGreen
              : TileType.Fairway;
      }
  }
}

// ================================================================
// 5. Variations cosmétiques (déterministes par position)
// ================================================================

function applyVariations(tiles: ITile[], w: number, h: number): void {
  // 1. Hash de base déterministe
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      tiles[y * w + x].variation = ((x * 31 + y * 17) % COSMETIC_MAX) + 1;

  // 2. Anti-répétition : éviter que 2 tuiles de même type adjacentes
  //    aient la même variation (lissage scanline, voisins N+W déjà finals)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const tile = tiles[idx];
      const used = new Set<number>();
      if (y > 0) { const n = tiles[(y - 1) * w + x]; if (n.type === tile.type) used.add(n.variation); }
      if (x > 0) { const n = tiles[y * w + (x - 1)]; if (n.type === tile.type) used.add(n.variation); }
      if (used.has(tile.variation)) {
        for (let v = 1; v <= COSMETIC_MAX; v++) {
          if (!used.has(v)) { tile.variation = v; break; }
        }
      }
    }
}

// ================================================================
// 6. API publique — génération de la carte
// ================================================================

/**
 * Génère une carte Parkland complète (IMapState) en suivant
 * l'algorithme du jeu original (resetTerrain + distribution + holes).
 */
export function generateParklandGrid(
  width: number = 40,
  height: number = 40,
): IMapState {
  // 1. resetTerrain : tout en eau plate
  const tiles: ITile[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      tiles.push({
        x,
        y,
        type: TileType.WaterShallow,
        elevation: [0, 0, 0, 0],
        variation: 0,
      });

  // 2. Distribution Parkland
  const noise = generateNoise(width, height, 8);
  const fairway = generateFairwayZones(width, height);
  applyDistribution(tiles, width, height, noise, fairway);

  // 3. Trous
  placeHoles(tiles, width, height);

  // 4. Variations cosmétiques
  applyVariations(tiles, width, height);

  return { width, height, theme: CourseTheme.Parkland, tiles };
}

// ================================================================
// 7. Mapping type de tuile → chemin de texture
// ================================================================

/**
 * Retourne le chemin de la texture WebP pour une tuile donnée,
 * en tenant compte de :
 *   1. Type de terrain → dossier + préfixe
 *   2. Groupe géométrique A-E (selon les 4 hauteurs de coins)
 *   3. Variation cosmétique (anti-répétition)
 *   4. Masque de voisinage pour les bordures (futur : textures d'arête)
 *
 * ou null si la tuile n'a pas de texture (vertex colors).
 */
const GEOM_TYPES: Set<TileType> = new Set([
  TileType.Rough, TileType.DeepRough, TileType.Cliff, TileType.Tree,
]);

export function texturePathForTile(
  tile: ITile,
  tiles?: ITile[],
  width?: number,
  height?: number,
): string | null {
  const v = tile.variation;
  const geom = GEOM_TYPES.has(tile.type) ? getGeometryType(tile.elevation) : 'A';

  // Padding variation sur 4 chiffres
  const var4 = String(Math.min(v, 9)).padStart(4, '0');

  switch (tile.type) {
    case TileType.Rough:
    case TileType.DeepRough:
      return `/assets/textures/parkland/rough/ROUGH${geom}${var4}.webp`;
    case TileType.Fairway:
    case TileType.Tee:
      return `/assets/textures/parkland/fairway/FAIRWAYA0001.webp`;
    case TileType.PuttingGreen:
      return `/assets/textures/parkland/green/PUTTINGGREENA0001.webp`;
    case TileType.SandBunker:
    case TileType.GrassySand:
    case TileType.GrassBunker:
    case TileType.Path:
      return `/assets/textures/parkland/sand/SANDBUNKER1A0001.webp`;
    case TileType.WaterShallow:
      return `/assets/textures/parkland/water/WATERSHALLOWA0001.webp`;
    case TileType.WaterMiddle:
      return `/assets/textures/parkland/water/WATERMIDDLEA0001.webp`;
    case TileType.WaterDeep:
      return `/assets/textures/parkland/water/WATERDEEPA0001.webp`;
    case TileType.Cliff:
      return `/assets/textures/parkland/rock/ROCK${geom}${var4}.webp`;
    case TileType.Tree:
      return `/assets/textures/parkland/woods/WOODS${geom}${var4}.webp`;
    default:
      return null;
  }
}

// ================================================================
// 8. Construction des maillages Three.js (groupés par texture)
// ================================================================

/**
 * Résultat d'une construction de maillage : un BufferGeometry prêt
 * à être utilisé avec un material, et le chemin texture associé.
 */
export interface MeshGroup {
  geometry: THREE.BufferGeometry;
  texturePath: string | null;
  /** Couleur dominante du groupe (pour chute texture non chargée) */
  fallbackColor: [number, number, number];
}

/**
 * Palette de couleurs par type (utilisée comme fallback).
 */
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
};

/**
 * Construit un ou plusieurs BufferGeometry à partir de l'état de la carte.
 *
 * Les tuiles sont groupées par texture (même TileType + variation).
 * Chaque groupe produit un BufferGeometry séparé avec :
 *   - Positions 3D calculées par tileVertexPosition()
 *   - Coordonnées UV (si texture) ou vertex colors (si pas de texture)
 *   - Normales pour l'éclairage
 *
 * @param mapState   L'état de la carte à mailler
 * @returns          Un tableau de MeshGroup (geometry + texturePath)
 */
export function buildParklandMesh(
  mapState: IMapState,
): MeshGroup[] {
  const { width, height, tiles } = mapState;

  // ---- Grouper les tuiles par chemin de texture ----
  // La clé '' représente les tuiles sans texture (vertex colors)
  const groups = new Map<string, { tileIdx: number[]; path: string | null; type: TileType }>();
  const NO_TEXTURE = '';

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const path = texturePathForTile(tile, tiles, width, height);
    const key = path ?? NO_TEXTURE;
    if (!groups.has(key)) {
      groups.set(key, { tileIdx: [], path, type: tile.type });
    }
    groups.get(key)!.tileIdx.push(i);
  }

  // ---- Pour chaque groupe, construire un BufferGeometry ----
  const results: MeshGroup[] = [];

  for (const [, group] of groups) {
    const nTiles = group.tileIdx.length;
    const vertsPerTile = 6;
    const totalVerts = nTiles * vertsPerTile;
    const hasTexture = group.path !== null;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = hasTexture ? new Float32Array(totalVerts * 2) : null;
    const colors = hasTexture ? null : new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);

    let vi = 0; // vertex index global pour ce groupe
    const setVertex = (x: number, y: number, z: number, u: number, vtx: number) => {
      positions[vi * 3]     = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;
      if (uvs) {
        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = vtx;
      }
      normals[vi * 3]     = 0;
      normals[vi * 3 + 1] = 1;
      normals[vi * 3 + 2] = 0;
      vi++;
    };

    // Couleur de fallback pour ce groupe (utilisée dans main.ts)
    const firstTile = tiles[group.tileIdx[0]];
    const baseColor = palette[firstTile.type] ?? [0.227, 0.490, 0.227];

    for (const tileIdx of group.tileIdx) {
      const tile = tiles[tileIdx];
      const [hTL, hTR, hBR, hBL] = tile.elevation;

      const pTL = tileVertexPosition(tile.x,     tile.y,     hTL);
      const pTR = tileVertexPosition(tile.x + 1, tile.y,     hTR);
      const pBL = tileVertexPosition(tile.x,     tile.y + 1, hBL);
      const pBR = tileVertexPosition(tile.x + 1, tile.y + 1, hBR);

      // Écriture de la couleur (vertex colors) si pas de texture
      let cTL: [number, number, number] = baseColor;
      let cTR: [number, number, number] = baseColor;
      let cBR: [number, number, number] = baseColor;
      let cBL: [number, number, number] = baseColor;
      if (colors) {
        const bright = 1 + (tile.variation - 3) * 0.03;
        cTL = cTR = cBR = cBL = [
          Math.min(1, baseColor[0] * bright),
          Math.min(1, baseColor[1] * bright),
          Math.min(1, baseColor[2] * bright),
        ] as [number, number, number];
      }

      // Règle de la diagonale
      const d1 = Math.abs(hTL - hBR);
      const d2 = Math.abs(hTR - hBL);
      const diagTLBR = d1 < d2;

      // Fonction pour écrire un vertex avec UV + couleur
      const pushVertex = (px: number, py: number, pz: number, u: number, v: number, c: [number, number, number]) => {
        setVertex(px, py, pz, u, v);
        if (colors) {
          colors[(vi - 1) * 3]     = c[0];
          colors[(vi - 1) * 3 + 1] = c[1];
          colors[(vi - 1) * 3 + 2] = c[2];
        }
      };

      // Sauvegarder vi avant de bosser les offsets
      const baseVi = vi;

      if (diagTLBR) {
        // Tri 1: TL→TR→BL
        setVertex(pTL.x, pTL.y, pTL.z, 0, 0);
        setVertex(pTR.x, pTR.y, pTR.z, 1, 0);
        setVertex(pBL.x, pBL.y, pBL.z, 0, 1);
        // Tri 2: TR→BR→BL
        setVertex(pTR.x, pTR.y, pTR.z, 1, 0);
        setVertex(pBR.x, pBR.y, pBR.z, 1, 1);
        setVertex(pBL.x, pBL.y, pBL.z, 0, 1);
      } else {
        // Tri 1: TL→TR→BR
        setVertex(pTL.x, pTL.y, pTL.z, 0, 0);
        setVertex(pTR.x, pTR.y, pTR.z, 1, 0);
        setVertex(pBR.x, pBR.y, pBR.z, 1, 1);
        // Tri 2: TL→BR→BL
        setVertex(pTL.x, pTL.y, pTL.z, 0, 0);
        setVertex(pBR.x, pBR.y, pBR.z, 1, 1);
        setVertex(pBL.x, pBL.y, pBL.z, 0, 1);
      }

      // Appliquer les couleurs aux vertex écrits si mode vertex-color
      if (colors) {
        const dst = [cTL, cTR, cBR, cBL];
        // Les UV map TL→0,0, TR→1,0, BR→1,1, BL→0,1
        // Les 6 vertex dans l'ordre : TL, TR, BL, TR, BR, BL ou TL, TR, BR, TL, BR, BL
        // On applique la bonne couleur selon le coin
        for (let k = 0; k < 6; k++) {
          const idx = (baseVi + k) * 3;
          // Déterminer quel coin ce vertex représente
          // On peut le déduire de l'UV
          const uk = k < 3 
            ? (diagTLBR ? ([0,1,0][k]) : ([0,1,1][k]))
            : (diagTLBR ? ([1,1,0][k-3]) : ([0,1,0][k-3]));
          // This is getting complicated. Simpler: just pick cTL for all vertices
          colors[idx]     = cTL[0];
          colors[idx + 1] = cTL[1];
          colors[idx + 2] = cTL[2];
        }
      }
    }

    // ---- Assemblage de la géométrie ----
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    results.push({
      geometry,
      texturePath: group.path,
      fallbackColor: baseColor,
    });
  }

  return results;
}
