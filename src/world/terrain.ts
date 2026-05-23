/**
 * world/terrain.ts — Génération du maillage Parkland
 *
 * Produit une IMapState complète (grille de tuiles avec élévation et types)
 * puis construit des BufferGeometry Three.js groupés par texture.
 *
 * REFERENCE_GUIDE.md §3 (Système de Terrain) :
 *   1. resetTerrain() — toutes les tuiles en eau plate
 *   2. applyDistribution() — bruit de valeur + zones fairway
 *   3. placeHoles() — Tees + Greens
 *   4. buildMesh() — maillages Three.js
 *
 * NOUVEAU : generateVegetationGrid() — génération simplifiée avec
 * uniquement des types famille grass (Rough, DeepRough, Woods, Brush).
 * Aucune bordure entre eux (auto-tiling seam).
 */

import * as THREE from 'three';
import {
  TileType,
  CourseTheme,
  ITile,
  IRenderPass,
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

// ================================================================
// Familles de terrain — Auto-Tiling
// ================================================================

/**
 * Familles de terrain — 2 tuiles de même famille ne produisent PAS
 * de bordure de transition. Basé sur le typeInfo dans le jeu original
 * (champ family à offset +0x04 dans chaque entrée typeInfo à 24 bytes).
 *
 * ID de famille (correspond au jeu original) :
 *   0 = grass   — Rough, DeepRough, Woods, Brush, Rock, Marsh, etc.
 *   1 = play    — Fairway, Tee, PuttingGreen, FirmFairway, TrickyGreen
 *   2 = sand    — SandBunker, GrassySand, GrassBunker, PotSandBunker
 *   3 = water   — WaterShallow, WaterMiddle, WaterDeep
 *   4 = path    — Path, Bridge, Ravine
 *   5 = building — Building, RetainingWall
 *   6 = cliff   — Cliff
 */
const TERRAIN_FAMILY_ID: Record<number, number> = {
  [TileType.Rough]:        0,  // grass
  [TileType.Tree]:         0,  // grass (Woods)
  [TileType.Flower]:       0,  // grass (Brush)
  [TileType.DeepRough]:    0,  // grass
  [TileType.Rock]:         0,  // grass (ou famille roche dédiée)
  [TileType.Marsh]:        0,  // grass
  [TileType.Overgrowth]:   0,  // grass (UNIQUE : A-D border malgré famille grass)
  [TileType.Fairway]:      1,  // play
  [TileType.Tee]:          1,  // play
  [TileType.PuttingGreen]: 1,  // play
  [TileType.FirmFairway]:  1,  // play
  [TileType.TrickyGreen]:  1,  // play
  [TileType.SandBunker]:   2,  // sand
  [TileType.GrassySand]:   2,  // sand (transition sable→herbe)
  [TileType.GrassBunker]:  2,  // sand (transition herbe→sable)
  [TileType.PotSandBunker]:2,  // sand
  [TileType.ZenSand]:      2,  // sand
  [TileType.WaterShallow]: 3,  // water
  [TileType.WaterMiddle]:  3,  // water
  [TileType.WaterDeep]:    3,  // water
  [TileType.Path]:         4,  // path
  [TileType.Bridge]:       4,  // path
  [TileType.Ravine]:       4,  // path
  [TileType.Building]:     5,  // building
  [TileType.RetainingWall]:5,  // building
  [TileType.Cliff]:        6,  // cliff
};

/**
 * Retourne l'ID de famille pour une comparaison d'auto-tiling.
 * Deux tuiles de même family ID ne produisent PAS de bordure.
 */
export function getTerrainFamily(type: TileType): number {
  return TERRAIN_FAMILY_ID[type] ?? 0;
}

// ================================================================
// computeNeighborMask — Masque de voisinage 4 bits
//
// Ordre de priorité strict : Nord (1) > Est (2) > Sud (4) > Ouest (8)
//
// Chaque bit = 1 si le voisin cardinal est d'une famille différente.
// REFERENCE_GUIDE.md §5.3
// ================================================================
export function computeNeighborMask(
  tiles: ITile[], w: number, h: number, x: number, y: number,
): number {
  const idx = y * w + x;
  const family = getTerrainFamily(tiles[idx].type);
  let mask = 0;

  // Ordre cardinal : N(1) > E(2) > S(4) > W(8)
  const checks: [number, number, number][] = [
    [ 0, -1, 1],  // N → bit 1
    [ 1,  0, 2],  // E → bit 2
    [ 0,  1, 4],  // S → bit 4
    [-1,  0, 8],  // W → bit 8
  ];

  for (const [dx, dy, bit] of checks) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
      if (getTerrainFamily(tiles[ny * w + nx].type) !== family) {
        mask |= bit;
      }
    } else {
      // Bord de la carte : considéré comme famille différente (bordure)
      mask |= bit;
    }
  }

  return mask;
}

// ================================================================
// computeRenderPasses — Calcule les passes de rendu pour une tuile
//
// Pass 0 : Texture de base du type de terrain.
//   - Grass family : suffixe = géométrie d'élévation (A-E)
//   - Non-grass    : suffixe = 'A' (base)
//
// Pass 1..3 : Textures de bordure (si voisin de famille ≠).
//   - On itère les directions N > E > S > W.
//   - Chaque direction différente génère une passe de bordure avec le
//     suffixe d'orientation correspondant (N→A, E→B, S→C, W→D).
//   - Seulement pour les types qui ONT des textures A-D disponibles.
// ================================================================

/**
 * Types de terrain qui possèdent des textures de bordure (A-D).
 * Ces types génèrent des passes de rendu supplémentaires quand un voisin
 * est de famille différente.
 *
 * Dans le jeu original, ce sont les types où renderMode=1 (bordure)
 * dans la table typeInfo (offset +0x08 dans chaque entrée de 24 bytes).
 *
 * Remarque : GrassySand n'a A-D que dans certains thèmes (Links complet,
 * Desert A-D, Tropical A-C, Parkland A seulement).
 *
 * Remarque : Overgrowth est le SEUL type grass avec des textures A-D
 * directionnelles. Les autres types grass (Rough, Woods, etc.) utilisent
 * les lettres A-E pour la géométrie d'élévation, PAS pour les bordures.
 *
 * Remarque : Ravine a ses propres textures A-D alors que Path et Bridge
 * n'ont que A plat. Ravine dans le jeu original est un type de bordure
 * autonome (renderMode=1).
 */
const TYPES_WITH_BORDER_TEXTURES: Set<TileType> = new Set([
  // Auto-borders : leurs A-D = textures de bordure
  TileType.WaterShallow,
  TileType.WaterMiddle,
  TileType.WaterDeep,
  TileType.Cliff,
  TileType.GrassBunker,
  TileType.GrassySand,      // ⚠️ A-D seulement dans Links/Desert/Tropical
  TileType.Overgrowth,       // grass type MAIS avec A-D border
  TileType.Ravine,           // path type avec A-D border
  TileType.Flower,           // Brush (quand présent en A-D, ex: Links)
]);

/**
 * borderOverride — Types qui utilisent les TEXTURES D'UN AUTRE TYPE
 * comme textures de quadrant pour leurs bordures.
 * Correspond au champ borderOverride (offset +0x0c) dans la table
 * typeInfo du jeu original.
 *
 * CORRIGÉ d'après l'analyse Ghidra (REFERENCE_GUIDE.md §5.8) :
 *   Fairway & FirmFairway → GrassySand (transition VERTE fairway→rough)
 *   SandBunker & PotSandBunker → GrassBunker (transition BRUNE sable→herbe)
 */
const BORDER_OVERRIDE: Partial<Record<TileType, TileType>> = {
  [TileType.SandBunker]:   TileType.GrassBunker,   // brun : sable → herbe
  [TileType.PotSandBunker]:TileType.GrassBunker,   // brun : sable → herbe
  [TileType.Fairway]:      TileType.GrassySand,    // vert  : fairway → rough
  [TileType.FirmFairway]:  TileType.GrassySand,    // vert  : fairway → rough
};

/**
 * Types qui ne sont PAS dans une famille grass MAIS n'ont pas de
 * textures de bordure ni de borderOverride → ils font du seam.
 * Utile pour les vérifications.
 */
const TYPES_SEAM_ONLY: Set<TileType> = new Set([
  TileType.PuttingGreen,
  TileType.Tee,
  TileType.TrickyGreen,
  TileType.Path,
  TileType.Bridge,
  TileType.Building,
  TileType.RetainingWall,
  TileType.ZenSand,
]);

/**
 * Mappe un bit de masque de voisinage vers le suffixe de bordure.
 * N=1→A, E=2→B, S=4→C, W=8→D
 */
function maskBitToBorderSuffix(bit: number): string {
  switch (bit) {
    case 1: return 'A';   // Nord → A
    case 2: return 'B';   // Est  → B
    case 4: return 'C';   // Sud  → C
    case 8: return 'D';   // Ouest → D
    default: return 'A';
  }
}

// ================================================================
// Sub-Tiling par Quadrants — Subdivision du diamant en 4 régions
//
// Chaque tuile (64×64 texels) est divisée en 4 quadrants 32×32 :
//   0 = NW = Top-Left corner du diamant (nord-ouest)
//   1 = NE = Top-Right corner (nord-est)
//   2 = SW = Bottom-Left (sud-ouest)
//   3 = SE = Bottom-Right (sud-est)
//
// Chaque quadrant est rendu comme un sous-diamant de 2 triangles
// dans le maillage 3D, pour un total de 8 triangles par tuile.
//
// La sélection du type de texture par quadrant dépend du neighborMask :
//   N(1) → NW, NE   |   E(2) → NE, SE
//   S(4) → SW, SE   |   W(8) → NW, SW
//
// REFERENCE_GUIDE.md §5.9 (Sub-Tiling)
// ================================================================

/**
 * Retourne les 4 types de terrain pour chaque quadrant d'une tuile
 * en fonction de son masque de voisinage.
 *
 * @param mask    Masque de voisinage (bits N=1, E=2, S=4, W=8)
 * @param tileType Type de base de la tuile
 * @returns        [NW, NE, SW, SE] — type par quadrant
 */
export function computeQuadrants(
  mask: number,
  tileType: TileType,
): [TileType, TileType, TileType, TileType] {
  // Types sans borderOverride : les 4 quadrants conservent le type de base
  const borderType = BORDER_OVERRIDE[tileType];
  if (borderType === undefined) {
    return [tileType, tileType, tileType, tileType];
  }

  // Types avec borderOverride : les quadrants affectés par le mask
  // utilisent le type override (ex: Fairway → GrassySand)
  const q: [TileType, TileType, TileType, TileType] =
    [tileType, tileType, tileType, tileType];

  // N(1) → NW(0), NE(1)
  if (mask & 1) { q[0] = borderType; q[1] = borderType; }
  // E(2) → NE(1), SE(3)
  if (mask & 2) { q[1] = borderType; q[3] = borderType; }
  // S(4) → SW(2), SE(3)
  if (mask & 4) { q[2] = borderType; q[3] = borderType; }
  // W(8) → NW(0), SW(2)
  if (mask & 8) { q[0] = borderType; q[2] = borderType; }

  return q;
}

/**
 * Genère les 4 passes de rendu (une par quadrant) pour une tuile.
 *
 * Chaque quadrant reçoit son propre type de texture (base ou border override),
 * une variation cosmétique, et un suffixe géométrique.
 *
 * Le rendu 3D convertira chaque passe en 2 triangles = 8 triangles par tuile.
 *
 * @param tile   La tuile à traiter
 * @param tiles  Grille complète
 * @param w      Largeur de la grille
 * @param h      Hauteur de la grille
 * @returns      Tableau de 4 renderPasses (une par quadrant)
 */
export function computeRenderPasses(
  tile: ITile,
  tiles: ITile[],
  w: number,
  h: number,
): IRenderPass[] {
  const mask = computeNeighborMask(tiles, w, h, tile.x, tile.y);
  const quadrants = computeQuadrants(mask, tile.type);
  const geomSuffix = getGeometryType(tile.elevation);

  const passes: IRenderPass[] = [];

  for (let q = 0; q < 4; q++) {
    const qType = quadrants[q];
    const qFamily = getTerrainFamily(qType);

    // Suffixe : A-E pour grass family, 'A' pour les autres
    const suffix = qFamily === 0 ? geomSuffix : 'A';

    passes.push({
      type: qType,
      variation: tile.variation,
      suffix,
      quadrant: q as 0 | 1 | 2 | 3,
    });
  }

  return passes;
}

/**
 * Calcule les renderPasses pour toutes les tuiles de la grille.
 * Appelée après toute modification du terrain.
 */
export function computeAllRenderPasses(
  tiles: ITile[],
  w: number,
  h: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      tiles[idx].renderPasses = computeRenderPasses(tiles[idx], tiles, w, h);
    }
  }
}

// ================================================================
// Nombre max de variations cosmétiques disponibles pour chaque type
// ================================================================

/**
 * Nombre max de variations cosmétiques disponibles pour chaque type de tuile.
 * REFERENCE_GUIDE.md §5.4 + §5.10
 *
 * Ces valeurs sont utilisées par setType() avec rand() % maxVariation.
 * Les types sans * n'ont qu'une seule texture.
 */
export function maxVariationForType(type: TileType): number {
  switch (type) {
    case TileType.Rough:
      return 5;   // Rough A-E × 5
    case TileType.DeepRough:
      return 9;   // DeepRough A-D × 9
    case TileType.Fairway:
      return 5;   // Fairway A × 5
    case TileType.PuttingGreen:
      return 5;   // PuttingGreen A × 5
    case TileType.SandBunker:
      return 5;   // SandBunker{1-4}A × 5
    case TileType.Tee:
      return 25;  // Tee A × 25
    case TileType.GrassySand:
      return 9;   // GrassySand A × 9
    case TileType.GrassBunker:
      return 9;   // GrassBunker A-D × 9
    case TileType.WaterShallow:
      return 9;   // WaterShallow A-D × 9
    case TileType.WaterMiddle:
      return 9;   // WaterMiddle A-D × 9
    case TileType.WaterDeep:
      return 5;   // WaterDeep A-D × 5
    case TileType.Cliff:
      return 9;   // Cliff A-D × 9
    case TileType.Tree:
      return 9;   // Woods A-D × 9
    case TileType.Flower:
      return 9;   // Brush A-D × 9
    default:
      return 1;
  }
}

// ================================================================
// Génération Végétale (VEGETATION INIT)
//
// generateVegetationGrid() — génération simplifiée avec uniquement
// des types famille grass (Rough, DeepRough, Woods, Brush).
//
// Caractéristiques :
//   - 4 types seulement, tous famille grass (ID 0)
//   - Aucune bordure entre eux (auto-tiling n'ajoute pas de passes)
//   - Élévation plate [0,0,0,0]
//   - Variations via rand() % maxVariation
// ================================================================

// ---- Bruit de valeur (value noise avec interpolation cosinus) ----

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

// ---- Seconde couche de bruit pour les patches de Woods/Brush ----

function generateSecondaryNoise(w: number, h: number, scale: number): Float32Array {
  return generateNoise(w, h, scale);
}

/**
 * Génère une carte Parkland simplifiée (uniquement végétation).
 *
 * Distribution :
 *   Rough     : 60% (bruit bas à moyen)
 *   DeepRough : 15% (bruit bas-moyen, zones denses)
 *   Woods     : 15% (bruit moyen-haut, patches)
 *   Brush     : 10% (bruit haut, lisières)
 *
 * Tous sont famille grass → seamless, pas de bordures.
 * Élévation plate [0,0,0,0].
 * Variations via rand() % maxVariation.
 */
export function generateVegetationGrid(
  width: number = 40,
  height: number = 40,
): IMapState {
  const tiles: ITile[] = [];

  // 1. Grille initiale : tout en Rough plat
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({
        x,
        y,
        type: TileType.Rough,
        elevation: [0, 0, 0, 0],
        variation: 1,
        renderPasses: [],
      });
    }
  }

  // 2. Bruit de valeur pour la distribution
  const noise1 = generateNoise(width, height, 6);    // grandes zones
  const noise2 = generateSecondaryNoise(width, height, 3);  // détails

  // 3. Distribution des 4 types grass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const n1 = noise1[idx];
      const n2 = noise2[idx];

      // Mélange des deux couches de bruit
      const n = (n1 * 0.6 + n2 * 0.4);

      if (n < 0.60) {
        tiles[idx].type = TileType.Rough;
      } else if (n < 0.75) {
        tiles[idx].type = TileType.DeepRough;
      } else if (n < 0.90) {
        tiles[idx].type = TileType.Tree;  // Woods
      } else {
        tiles[idx].type = TileType.Flower;  // Brush
      }
    }
  }

  // 4. Élévation plate (paramétrable)
  // Par défaut [0,0,0,0] comme initialisé ci-dessus.

  // 5. Variations cosmétiques via rand() % maxVariation
  // On utilise un seed simple pour la reproductibilité
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const tile = tiles[idx];
      const maxVar = maxVariationForType(tile.type);
      // "vrai rand()" : Math.random() seedé par position pour
      // reproductibilité
      const r = ((x * 31 + y * 17) % maxVar) + 1;
      tile.variation = Math.max(1, Math.min(maxVar, r));
    }
  }

  // 6. Anti-répétition : éviter variations identiques adjacentes
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const tile = tiles[idx];
      const maxVar = maxVariationForType(tile.type);
      if (maxVar <= 1) continue;

      const used = new Set<number>();
      if (y > 0) {
        const n = tiles[(y - 1) * width + x];
        if (n.type === tile.type) used.add(n.variation);
      }
      if (x > 0) {
        const n = tiles[y * width + (x - 1)];
        if (n.type === tile.type) used.add(n.variation);
      }
      if (used.has(tile.variation)) {
        for (let v = 1; v <= maxVar; v++) {
          if (!used.has(v)) { tile.variation = v; break; }
        }
      }
    }
  }

  // 7. Calcul des renderPasses (auto-tiling)
  computeAllRenderPasses(tiles, width, height);

  return { width, height, theme: CourseTheme.Parkland, tiles };
}

// ================================================================
// 1. Bruit de valeur (pour generateParklandGrid legacy)
// ================================================================

// (les mêmes fonctions de hash/noise sont partagées ci-dessus)

// ================================================================
// 2. Zones de fairway (serpentins Bresenham) — legacy
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
// 3. Distribution Parkland — legacy
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
// 4. Placement des trous (Tee + Green) — legacy
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
// 5. Variations cosmétiques (déterministes par position) — legacy
// ================================================================

function applyVariations(tiles: ITile[], w: number, h: number): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const maxVar = maxVariationForType(tiles[idx].type);
      tiles[idx].variation = maxVar > 1
        ? ((x * 31 + y * 17) % maxVar) + 1
        : 1;
    }

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const tile = tiles[idx];
      const maxVar = maxVariationForType(tile.type);
      if (maxVar <= 1) continue;

      const used = new Set<number>();
      if (y > 0) { const n = tiles[(y - 1) * w + x]; if (n.type === tile.type) used.add(n.variation); }
      if (x > 0) { const n = tiles[y * w + (x - 1)]; if (n.type === tile.type) used.add(n.variation); }
      if (used.has(tile.variation)) {
        for (let v = 1; v <= maxVar; v++) {
          if (!used.has(v)) { tile.variation = v; break; }
        }
      }
    }
}

// ================================================================
// 6. API publique — Génération legacy (complète)
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
        renderPasses: [],
      } as ITile);

  // 2. Distribution Parkland
  const noise = generateNoise(width, height, 8);
  const fairway = generateFairwayZones(width, height);
  applyDistribution(tiles, width, height, noise, fairway);

  // 3. Trous
  placeHoles(tiles, width, height);

  // 4. Variations cosmétiques
  applyVariations(tiles, width, height);

  // 5. Render passes
  computeAllRenderPasses(tiles, width, height);

  return { width, height, theme: CourseTheme.Parkland, tiles };
}

// ================================================================
// 7. Mapping passe de rendu → chemin de texture
// ================================================================

/**
 * Types qui utilisent la géométrie d'élévation (A-E) pour leur
 * suffixe de texture, même en tant que base non-grass.
 */
const GEOM_TYPES: Set<TileType> = new Set([
  TileType.Rough, TileType.DeepRough, TileType.Cliff, TileType.Tree,
  TileType.Flower,
]);

/**
 * Convertit le dossier de texture pour un type donné.
 */
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
    default:                    return 'rough';
  }
}

/**
 * Convertit le type en préfixe de nom de fichier texture.
 */
function texturePrefixForType(type: TileType): string {
  switch (type) {
    case TileType.Rough:        return 'ROUGH';
    case TileType.DeepRough:    return 'DEEPROUGH';
    case TileType.Fairway:      return 'FAIRWAY';
    case TileType.PuttingGreen: return 'PUTTINGGREEN';
    case TileType.SandBunker:   return 'SANDBUNKER';
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
    default:                    return 'ROUGH';
  }
}

/**
 * Retourne le chemin de la texture WebP pour une passe de rendu donnée.
 *
 * Format : /assets/textures/parkland/{folder}/{PREFIX}{suffix}{variation}.webp
 *
 * Exemples :
 *   - texturePathForPass({type: Rough, variation: 3, suffix: 'A'})
 *     → /assets/textures/parkland/rough/ROUGHA0003.webp
 *   - texturePathForPass({type: GrassBunker, variation: 5, suffix: 'B'})
 *     → /assets/textures/parkland/grassbunker/GRASSBUNKERB0005.webp
 */
export function texturePathForPass(pass: IRenderPass): string {
  const folder = textureFolderForType(pass.type);
  const prefix = texturePrefixForType(pass.type);
  const var4 = String(pass.variation).padStart(4, '0');
  return `/assets/textures/parkland/${folder}/${prefix}${pass.suffix}${var4}.webp`;
}

/**
 * Retourne le chemin de la texture WebP pour une tuile donnée.
 *
 * Version legacy utilisant la première passe de renderPasses.
 * Pour le rendu multi-pass, utiliser texturePathForPass().
 *
 * @deprecated Utiliser texturePathForPass() avec les renderPasses[]
 */
export function texturePathForTile(
  tile: ITile,
  tiles?: ITile[],
  width?: number,
  height?: number,
): string | null {
  // Si renderPasses est disponible, utiliser la passe 0
  if (tile.renderPasses && tile.renderPasses.length > 0) {
    return texturePathForPass(tile.renderPasses[0]);
  }

  // Fallback legacy
  const geom = GEOM_TYPES.has(tile.type) ? getGeometryType(tile.elevation) : 'A';
  const var4 = String(tile.variation).padStart(4, '0');
  const prefix = texturePrefixForType(tile.type);
  const folder = textureFolderForType(tile.type);

  return `/assets/textures/parkland/${folder}/${prefix}${geom}${var4}.webp`;
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
 * Entrée de groupe de maillage : une paire (tuile, quadrant).
 */
interface GroupEntry {
  tileIdx: number;
  quadrant: number; // 0=NW, 1=NE, 2=SW, 3=SE
  /** Type de terrain pour la couleur de fallback */
  type: TileType;
}

/**
 * Construit un ou plusieurs BufferGeometry à partir de l'état de la carte.
 *
 * Les tuiles sont groupées par texture (même TileType + variation + suffix).
 * Chaque groupe produit un BufferGeometry séparé avec :
 *   - Positions 3D calculées par tileVertexPosition()
 *   - Coordonnées UV mappées par quadrant (chaque quadrant = 32×32 sous-région
 *     de la texture 64×64, produisant 2 triangles = 6 vertices)
 *   - Normales pour l'éclairage
 *
 * Sub-Tiling : chaque tuile est découpée en 4 quadrants (NW, NE, SW, SE).
 * Chaque quadrant = 2 triangles → 6 verts → 24 verts par tuile.
 *
 * 9 positions 3D sont calculées par tuile :
 *   TL, TR, BR, BL (4 coins du diamant)
 *   TC, RC, BC, LC (4 milieux d'arêtes)
 *   CC (centre)
 *
 * @param mapState   L'état de la carte à mailler
 * @returns          Un tableau de MeshGroup (geometry + texturePath)
 */
export function buildParklandMesh(
  mapState: IMapState,
): MeshGroup[] {
  const { width, height, tiles } = mapState;

  // ---- Grouper (tuile, quadrant) par texture ----
  // Chaque renderPass génère un groupe avec (tileIdx, quadrant)
  const groups = new Map<string, { entries: GroupEntry[]; path: string | null }>();
  const NO_TEXTURE = '';

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const passes = tile.renderPasses.length > 0
      ? tile.renderPasses
      : [{ type: tile.type, variation: tile.variation, suffix: 'A' } as IRenderPass];

    for (const pass of passes) {
      const path = texturePathForPass(pass);
      const key = path ?? NO_TEXTURE;
      if (!groups.has(key)) {
        groups.set(key, { entries: [], path });
      }
      groups.get(key)!.entries.push({
        tileIdx: i,
        quadrant: pass.quadrant ?? 0,
        type: pass.type,
      });
    }
  }

  // ---- Pour chaque groupe, construire un BufferGeometry ----
  const results: MeshGroup[] = [];

  for (const [, group] of groups) {
    const nEntries = group.entries.length;
    // Chaque entrée = 1 quadrant × 2 triangles × 3 verts = 6 verts
    const vertsPerEntry = 6;
    const totalVerts = nEntries * vertsPerEntry;
    const hasTexture = group.path !== null;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = hasTexture ? new Float32Array(totalVerts * 2) : null;
    const colors = hasTexture ? null : new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);

    let vi = 0; // vertex index global pour ce groupe
    const setVertex = (x: number, y: number, z: number, u: number, v: number) => {
      positions[vi * 3]     = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;
      if (uvs) {
        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = v;
      }
      normals[vi * 3]     = 0;
      normals[vi * 3 + 1] = 1;
      normals[vi * 3 + 2] = 0;
      vi++;
    };

    // Couleur de fallback pour ce groupe
    const firstEntry = group.entries[0];
    const baseColor = palette[firstEntry.type] ?? [0.227, 0.490, 0.227];
    const c: [number, number, number] = baseColor;

    // Tableau des UV des sommets de sous-diamant, par quadrant
    // Chaque quadrant a 4 sommets : [corner1_edge, midpoint, corner2_edge, center]
    // qui produisent 2 triangles : T1(c1, mid, center), T2(mid, c2, center)
    type UV4 = [number, number]; // [u, v]
    const QUAD_UV: Record<number, { c1: UV4; mid: UV4; c2: UV4; cc: UV4 }> = {
      0: { // NW
        c1:  [0.5,   0.0  ],  // TL
        mid: [0.25,  0.25 ],  // LC
        c2:  [0.0,   0.5  ],  // BL
        cc:  [0.5,   0.5  ],  // CC
      },
      1: { // NE
        c1:  [0.5,   0.0  ],  // TL
        mid: [0.75,  0.25 ],  // TC
        c2:  [1.0,   0.5  ],  // TR
        cc:  [0.5,   0.5  ],  // CC
      },
      2: { // SW
        c1:  [0.0,   0.5  ],  // BL
        mid: [0.25,  0.75 ],  // BC
        c2:  [0.5,   1.0  ],  // BR
        cc:  [0.5,   0.5  ],  // CC
      },
      3: { // SE
        c1:  [1.0,   0.5  ],  // TR
        mid: [0.75,  0.75 ],  // RC
        c2:  [0.5,   1.0  ],  // BR
        cc:  [0.5,   0.5  ],  // CC
      },
    };

    for (const entry of group.entries) {
      const tile = tiles[entry.tileIdx];
      const [hTL, hTR, hBR, hBL] = tile.elevation;
      const q = entry.quadrant;

      // 5 positions 3D uniques pour ce sous-diamant
      const pTL  = tileVertexPosition(tile.x,     tile.y,     hTL);
      const pTR  = tileVertexPosition(tile.x + 1, tile.y,     hTR);
      const pBL  = tileVertexPosition(tile.x,     tile.y + 1, hBL);
      const pBR  = tileVertexPosition(tile.x + 1, tile.y + 1, hBR);

      // Edge midpoints & center
      const TC  = tileVertexPosition(tile.x + 0.5, tile.y,     (hTL + hTR) / 2);
      const RC  = tileVertexPosition(tile.x + 1,   tile.y + 0.5, (hTR + hBR) / 2);
      const BC  = tileVertexPosition(tile.x + 0.5, tile.y + 1,   (hBL + hBR) / 2);
      const LC  = tileVertexPosition(tile.x,       tile.y + 0.5, (hTL + hBL) / 2);
      const CC  = tileVertexPosition(tile.x + 0.5, tile.y + 0.5,
        (hTL + hTR + hBR + hBL) / 4);

      // 3D positions pour ce quadrant : {c1, mid, c2, cc}
      const POS: Record<string, { x: number; y: number; z: number }> = {
        TL: pTL, TR: pTR, BR: pBR, BL: pBL, TC, RC, BC, LC, CC,
      };

      const qIdx = q < 0 || q > 3 ? 0 : q;
      const uv = QUAD_UV[qIdx];
      const p = (name: string) => POS[name as keyof typeof POS];

      // Mapper chaque sommet du sous-diamant vers sa position 3D
      // selon le quadrant
      interface QVertex { pos: string; uv: [number, number] }

      // Quadrant → [c1, mid, c2, center] → les 4 sommets du sous-diamant
      const Q_NAMES: Record<number, { c1: string; mid: string; c2: string; cc: string }> = {
        0: { c1: 'TL', mid: 'LC', c2: 'BL', cc: 'CC' },
        1: { c1: 'TL', mid: 'TC', c2: 'TR', cc: 'CC' },
        2: { c1: 'BL', mid: 'BC', c2: 'BR', cc: 'CC' },
        3: { c1: 'TR', mid: 'RC', c2: 'BR', cc: 'CC' },
      };

      const names = Q_NAMES[qIdx];

      // Triangle 1 : c1 → mid → cc
      const c1  = p(names.c1);
      const mid = p(names.mid);
      const cc  = p(names.cc);
      const c2  = p(names.c2);

      const uv1 = QUAD_UV[qIdx].c1;
      const uvMid = QUAD_UV[qIdx].mid;
      const uvCC = QUAD_UV[qIdx].cc;
      const uv2 = QUAD_UV[qIdx].c2;

      setVertex(c1.x, c1.y, c1.z, uv1[0], uv1[1]);
      setVertex(mid.x, mid.y, mid.z, uvMid[0], uvMid[1]);
      setVertex(cc.x, cc.y, cc.z, uvCC[0], uvCC[1]);

      // Triangle 2 : mid → c2 → cc
      setVertex(mid.x, mid.y, mid.z, uvMid[0], uvMid[1]);
      setVertex(c2.x, c2.y, c2.z, uv2[0], uv2[1]);
      setVertex(cc.x, cc.y, cc.z, uvCC[0], uvCC[1]);

      // Couleurs vertex si mode vertex-color
      if (colors) {
        for (let k = 0; k < 6; k++) {
          const idx = (vi - 6 + k) * 3;
          colors[idx]     = c[0];
          colors[idx + 1] = c[1];
          colors[idx + 2] = c[2];
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
