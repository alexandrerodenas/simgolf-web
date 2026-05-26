/**
 * sub-tile.ts — Quadrant-Based Sub-Tiling System
 *
 * Port du système de jonction original de SimGolf (Terrain.dll).
 * Chaque tuile logique est divisée en 4 quadrants (TL, TR, BL, BR).
 * Chaque quadrant sélectionne sa texture selon ses 3 voisins immédiats
 * via un bitmask 3-bits, mappé vers les variations 0001-0009.
 *
 * Nomenclature des assets :
 *   {PREFIX}{SUFFIX_GEOM}{VARIATION}.webp
 *   - PREFIX     : abréviation majuscule (DEEPROUGH, ROUGH, FAIRWAY…)
 *   - SUFFIX     : A (plat) / B/C/D/E (pente) — issu de getGeometryType()
 *   - VARIATION  : 0001 (plein) | 0002-0005 (sombre) | 0006-0009 (clair)
 *
 * Sources : parkland_textures.pdf, analyse Terrain.dll (FUN_10012cf0)
 */

import { TileType } from './types.js';

// ─── Types ───

export enum Quadrant {
  TL = 0,  // Haut-Gauche (Top-Left)
  TR = 1,  // Haut-Droit (Top-Right)
  BL = 2,  // Bas-Gauche (Bottom-Left)
  BR = 3,  // Bas-Droit (Bottom-Right)
}

/** Les 4 quadrants dans l'ordre de rendu */
export const QUADRANTS: readonly Quadrant[] = [
  Quadrant.TL, Quadrant.TR, Quadrant.BL, Quadrant.BR,
];

/** Résultat du calcul pour un quadrant */
export interface QuadrantResult {
  /** Le mask 3-bits (0-7) */
  mask: number;
  /** Variation cible 1-9 (1=plein, 2-5=sombre, 6-9=clair) */
  variation: number;
  /** True si une texture de transition est utilisée (variation != 1) */
  isTransition: boolean;
  /** Vrai si la texture existe (false = fallback 0001) */
  textureExists: boolean;
}

// ─── Voisins par quadrant ───

/**
 * Pour chaque quadrant, les 3 voisins à vérifier sous la forme
 * [dx, dy, bit_position, nom_court] :
 *   bit 0 = voisin latéral (W/E)
 *   bit 1 = voisin vertical (N/S)
 *   bit 2 = voisin diagonal (NW/NE/SW/SE)
 */
type NeighborEntry = [dx: number, dy: number, bit: number, label: string];

const QUADRANT_NEIGHBORS: Record<Quadrant, NeighborEntry[]> = {
  [Quadrant.TL]: [
    [ 0, -1, 1, 'N'  ],  // Nord
    [-1,  0, 0, 'W'  ],  // Ouest
    [-1, -1, 2, 'NW' ],  // Nord-Ouest
  ],
  [Quadrant.TR]: [
    [ 0, -1, 1, 'N'  ],  // Nord
    [ 1,  0, 0, 'E'  ],  // Est
    [ 1, -1, 2, 'NE' ],  // Nord-Est
  ],
  [Quadrant.BL]: [
    [ 0,  1, 1, 'S'  ],  // Sud
    [-1,  0, 0, 'W'  ],  // Ouest
    [-1,  1, 2, 'SW' ],  // Sud-Ouest
  ],
  [Quadrant.BR]: [
    [ 0,  1, 1, 'S'  ],  // Sud
    [ 1,  0, 0, 'E'  ],  // Est
    [ 1,  1, 2, 'SE' ],  // Sud-Est
  ],
};

// ─── Luminosité des terrains ───

/**
 * Niveau de luminosité (0 = plus sombre, 5 = plus clair).
 * Utilisé pour déterminer si la transition utilise les variations
 * "sombres" (0002-0005) ou "claires" (0006-0009).
 *
 * Principe : si le voisin est PLUS clair que la tuile courante,
 * la tuile courante utilise les variations CLAIRES (0006-0009)
 * pour montrer l'empiètement du terrain plus clair.
 * Inversement, si le voisin est PLUS sombre, on utilise les
 * variations SOMBRES (0002-0005) pour l'ombre portée.
 */
const BRIGHTNESS: Record<TileType, number> = {
  // ── 0 : Eau (le plus sombre) ──
  [TileType.WaterShallow]:  0,
  [TileType.WaterMiddle]:   0,
  [TileType.WaterDeep]:     0,
  [TileType.Marsh]:         0,
  // ── 1 : Sable / Bunker ──
  [TileType.SandBunker]:    1,
  [TileType.PotSandBunker]: 1,
  [TileType.ZenSand]:       1,
  [TileType.GrassySand]:    1,
  [TileType.GrassBunker]:   1,
  // ── 2 : Végétation dense ──
  [TileType.DeepRough]:     2,
  [TileType.Brush]:         2,
  [TileType.Vegetation]:    2,
  [TileType.Natural]:       2,
  // ── 3 : Herbe standard ──
  [TileType.Rough]:         3,
  [TileType.Overgrowth]:    3,
  [TileType.Rock]:          3,
  [TileType.Tree]:          3,
  [TileType.Flower]:        3,
  [TileType.Cliff]:         3,
  [TileType.Ravine]:        3,
  // ── 4 : Fairway ──
  [TileType.Fairway]:       4,
  [TileType.FirmFairway]:   4,
  [TileType.Tee]:           4,
  // ── 5 : Green (le plus clair) ──
  [TileType.PuttingGreen]:  5,
  [TileType.TrickyGreen]:   5,
  // ── Hors transition (pas de mélange automatique) ──
  [TileType.Path]:          -1,
  [TileType.Bridge]:        -1,
  [TileType.Building]:      -1,
  [TileType.RetainingWall]: -1,
};

export function getBrightness(type: TileType): number {
  return BRIGHTNESS[type] ?? -1;
}

// ─── Interface grille ───

export interface SubTileGrid {
  readonly width: number;
  readonly height: number;
  getTileType(r: number, c: number): TileType;
}

// ─── Mapping mask → variation ───

/**
 * Table de mapping : mask 3-bits → index dans les plages dark/light.
 *   mask 0 (000) → plein (variation 1)
 *   mask 1 (001) → bordure simple (arrête latérale)
 *   mask 2 (010) → bordure simple (arrête verticale)
 *   mask 3 (011) → coin (L, deux arrêtes adjacentes)
 *   mask 4 (100) → diagonale (voisin diagonal seulement)
 *   mask 5 (101) → L + diagonale
 *   mask 6 (110) → L + diagonale
 *   mask 7 (111) → coin convexe (trois voisins)
 *
 * darkRange (0002-0005) → index [0..3]
 * lightRange (0006-0009) → index [4..7]
 */
const MASK_TO_VAR_INDEX = [0, 1, 1, 2, 3, 3, 3, 3]; // pas de convexe (mask 7 → 4/8)

/** Variations possibles (indexées par MASK_TO_VAR_INDEX) */
const VAR_DARK  = [1, 2, 2, 3, 4, 4, 4, 5];   // 0001-0005
const VAR_LIGHT = [1, 6, 6, 7, 8, 8, 8, 9];   // 0001 + 0006-0009

// ─── Vérification d'existence des textures ───

/**
 * Ensemble des types qui ont les textures claires (0006-0009).
 * Vérifié contre les fichiers WebP dans public/assets/textures/
 */
const HAS_LIGHT_VARIANTS: Set<TileType> = new Set([
  TileType.DeepRough,
  TileType.Brush,
  TileType.Cliff,
  TileType.GrassBunker,
  TileType.Marsh,
  TileType.Overgrowth,
  TileType.Ravine,
  TileType.Rock,
  TileType.Tree,       // fichier WOODS
  TileType.Flower,     // fichier BRUSH
  TileType.WaterShallow,
  TileType.WaterMiddle,
  TileType.Building,
  TileType.FirmFairway,
  TileType.ZenSand,
  TileType.GrassySand,
  TileType.Tee,
]);

function hasLightVariants(type: TileType): boolean {
  return HAS_LIGHT_VARIANTS.has(type);
}

// ─── API publique ───

/**
 * Calcule le mask 3-bits pour un quadrant donné.
 *
 * @param grid    Grille de terrain
 * @param x       Colonne de la tuile
 * @param y       Ligne de la tuile
 * @param quadrant Le quadrant à évaluer
 * @returns Mask 3-bits (0-7)
 */
export function getQuadrantMask(
  grid: SubTileGrid,
  x: number, y: number,
  quadrant: Quadrant,
): number {
  const currentType = grid.getTileType(y, x);
  const neighbors = QUADRANT_NEIGHBORS[quadrant];

  let mask = 0;
  for (const [dx, dy, bit] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    const neighborType = grid.getTileType(ny, nx);
    // Le voisin est "différent" s'il a un type différent ET
    // une luminosité valide (pas -1, donc pas Path/Building etc.)
    if (neighborType !== currentType && getBrightness(neighborType) >= 0) {
      mask |= (1 << bit);
    }
  }
  return mask;
}

/**
 * Détermine si la transition doit utiliser les variations claires (0006-0009)
 * ou sombres (0002-0005).
 *
 * @returns true = clair (0006-0009), false = sombre (0002-0005)
 */
export function useLightRange(
  grid: SubTileGrid,
  x: number, y: number,
  quadrant: Quadrant,
): boolean {
  const currentType = grid.getTileType(y, x);
  const currentBrightness = getBrightness(currentType);
  const neighbors = QUADRANT_NEIGHBORS[quadrant];

  // On cherche le voisin le plus différent (écart de luminosité max)
  let maxDelta = 0;
  let needsLight = false;

  for (const [dx, dy] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    const neighborType = grid.getTileType(ny, nx);
    if (neighborType === currentType) continue;

    const neighborBrightness = getBrightness(neighborType);
    if (neighborBrightness < 0) continue; // pas de transition

    const delta = neighborBrightness - currentBrightness;
    const absDelta = Math.abs(delta);
    if (absDelta > maxDelta) {
      maxDelta = absDelta;
      // Si le voisin est PLUS clair → on est sombre → on utilise clair
      // Si le voisin est PLUS sombre → on est clair → on utilise sombre
      needsLight = delta > 0;
    }
  }

  return needsLight;
}

/**
 * Calcule la variation (0001-0009) pour un quadrant.
 *
 * @returns Le numéro de variation (1-9, où 1 = plein, 2-5 = sombre, 6-9 = clair)
 */
export function getQuadrantVariation(
  grid: SubTileGrid,
  x: number, y: number,
  quadrant: Quadrant,
  geomSuffix: string = 'A',
): { mask: number; variation: number; textureExists: boolean } {
  const mask = getQuadrantMask(grid, x, y, quadrant);
  const currentType = grid.getTileType(y, x);

  if (mask === 0) {
    return { mask: 0, variation: 1, textureExists: true };
  }

  const light = useLightRange(grid, x, y, quadrant);
  const varIndex = MASK_TO_VAR_INDEX[mask];

  if (light && hasLightVariants(currentType)) {
    const variation = VAR_LIGHT[varIndex];
    return { mask, variation, textureExists: true };
  }

  // Fallback : plage sombre (toujours disponible)
  const variation = VAR_DARK[varIndex];
  return { mask, variation, textureExists: true };
}

/**
 * Calcule et retourne les résultats pour les 4 quadrants d'une tuile.
 */
export function getQuadrants(
  grid: SubTileGrid,
  x: number, y: number,
  geomSuffix: string = 'A',
): QuadrantResult[] {
  return QUADRANTS.map(quadrant => {
    const { mask, variation, textureExists } = getQuadrantVariation(
      grid, x, y, quadrant, geomSuffix,
    );
    return {
      mask,
      variation,
      isTransition: variation !== 1,
      textureExists: textureExists || variation === 1,
    };
  });
}

/**
 * Construit le nom de fichier pour un quadrant.
 * Format : {PREFIX}{GEOM}{VAR4}.webp
 *
 * Exemple : DEEPROUGHA0004.webp
 */
export function buildQuadrantFilename(
  prefix: string,
  geomSuffix: string,
  variation: number,
): string {
  const varStr = String(variation).padStart(4, '0');
  return `${prefix}${geomSuffix}${varStr}.webp`;
}

/**
 * Construit la texture key pour le ThreeRenderer.
 * Full tiles (var=1) → "type:variation:geomSuffix"
 * Transitions (var>1) → "trans:type:variation:geomSuffix:mask"
 */
export function buildQuadrantTextureKey(
  type: TileType,
  variation: number,
  geomSuffix: string,
  mask: number,
): string {
  if (variation === 1) {
    return `${type}:0:${geomSuffix}`;
  }
  return `trans:${type}:${variation}:${geomSuffix}:${mask}`;
}
