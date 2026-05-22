/**
 * world/terrain.ts — Génération du maillage Parkland
 *
 * Produit une IMapState complète (grille de tuiles avec élévation et types)
 * puis construit un BufferGeometry Three.js maillé pour le rendu.
 *
 * L'algorithme de génération Parkland suit les règles documentées dans
 * REFERENCE_GUIDE.md §3 (Système de Terrain) :
 *   1. resetTerrain() — toutes les tuiles en WaterShallow, élévation plate
 *   2. applyParklandDistribution() — bruit de valeur + zones fairway
 *   3. placeHoles() — Tees + Greens sur les fairways
 *   4. buildMesh() — construction du maillage Three.js
 *
 * Le maillage est conçu pour permettre :
 *   - Modification ultérieure de la hauteur des vertices (déclivité)
 *   - Application des textures UV pour l'auto-tiling
 *   - Ajout de triangles de bordure de transition
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
// CONSTANTES
// ================================================================

const COSMETIC_MAX = 5;

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
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      tiles[y * w + x].variation = ((x * 31 + y * 17) % COSMETIC_MAX) + 1;
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
// 7. Construction du maillage Three.js
// ================================================================

/**
 * Construit un BufferGeometry Three.js à partir de l'état de la carte.
 *
 * Chaque tuile est représentée par 2 triangles (quad) avec :
 *   - Positions 3D calculées par tileVertexPosition()
 *   - Couleurs par vertex basées sur le TileType (palette Parkland)
 *   - Normales pour l'éclairage
 *
 * Le maillage est conçu pour permettre des modifications ultérieures
 * de la hauteur des vertices (les positions sont indexées et on peut
 * update les attributs en place).
 *
 * @param mapState   L'état de la carte à mailler
 * @param material   Le matériau Three.js à utiliser (MeshBasic, MeshStandard, etc.)
 * @returns          { mesh, geometry } — le maillage + sa géométrie
 */
export function buildParklandMesh(
  mapState: IMapState,
  material?: THREE.Material,
): { mesh: THREE.Mesh; geometry: THREE.BufferGeometry } {
  const { width, height, tiles } = mapState;

  // Palette Parkland par type de terrain (RGB 0-1)
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

  // Chaque attribut contient exactement 6 vertices par tuile = 2 triangles
  // Chaque vertex est OWNED par une seule tuile — PAS de partage entre tuiles
  // adjacentes. Les 3 vertex d'un même triangle reçoivent TOUS la même couleur,
  // garantissant des transitions nettes aux frontières.
  const vertsPerTile = 6;
  const totalVerts = width * height * vertsPerTile;

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);

  // Construire chaque tuile individuellement avec ses 6 vertex dédiés
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const tile = tiles[ty * width + tx];
      const [hTL, hTR, hBR, hBL] = tile.elevation;

      // Positions des 4 coins dans l'espace Three.js
      const pTL = tileVertexPosition(tx,     ty,     hTL);
      const pTR = tileVertexPosition(tx + 1, ty,     hTR);
      const pBL = tileVertexPosition(tx,     ty + 1, hBL);
      const pBR = tileVertexPosition(tx + 1, ty + 1, hBR);

      // Couleur de cette tuile avec variation cosmétique (±6%)
      const baseColor = palette[tile.type] ?? [0.227, 0.490, 0.227];
      const v = tile.variation;
      const bright = 1 + (v - 3) * 0.03;
      const color: [number, number, number] = [
        Math.min(1, baseColor[0] * bright),
        Math.min(1, baseColor[1] * bright),
        Math.min(1, baseColor[2] * bright),
      ];

      // Règle de la diagonale : choisir la diagonale minimisant
      // la différence de hauteur entre les coins opposés.
      const d1 = Math.abs(hTL - hBR); // TL↔BR
      const d2 = Math.abs(hTR - hBL); // TR↔BL
      const diagTLBR = d1 < d2;

      // 6 vertex par tuile : 3 par triangle
      let vi: number;
      const setVertex = (x: number, y: number, z: number) => {
        positions[vi * 3]     = x;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = z;
        colors[vi * 3]     = color[0];
        colors[vi * 3 + 1] = color[1];
        colors[vi * 3 + 2] = color[2];
        normals[vi * 3]     = 0;
        normals[vi * 3 + 1] = 1;
        normals[vi * 3 + 2] = 0;
        vi++;
      };

      vi = (ty * width + tx) * vertsPerTile;

      if (diagTLBR) {
        // Diagonale TL↔BR
        // Triangle 1 : TL → TR → BL
        setVertex(pTL.x, pTL.y, pTL.z);
        setVertex(pTR.x, pTR.y, pTR.z);
        setVertex(pBL.x, pBL.y, pBL.z);
        // Triangle 2 : TR → BR → BL
        setVertex(pTR.x, pTR.y, pTR.z);
        setVertex(pBR.x, pBR.y, pBR.z);
        setVertex(pBL.x, pBL.y, pBL.z);
      } else {
        // Diagonale TR↔BL
        // Triangle 1 : TL → TR → BR
        setVertex(pTL.x, pTL.y, pTL.z);
        setVertex(pTR.x, pTR.y, pTR.z);
        setVertex(pBR.x, pBR.y, pBR.z);
        // Triangle 2 : TL → BR → BL
        setVertex(pTL.x, pTL.y, pTL.z);
        setVertex(pBR.x, pBR.y, pBR.z);
        setVertex(pBL.x, pBL.y, pBL.z);
      }
    }
  }

  // ---- Assemblage de la géométrie ----
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeVertexNormals();

  // ---- Matériau par défaut ----
  const mat = material ?? new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.frustumCulled = true;

  return { mesh, geometry };
}
