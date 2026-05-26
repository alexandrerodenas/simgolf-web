/**
 * autotile.ts — Vertex-Based Autotiling Algorithm with Layered Priority System
 *
 * Standard de l'ère SimGolf/Age of Empires : on ne regarde PAS les arêtes
 * entre tuiles adjacentes (ça produit des jonctions en bloc), on examine les
 * SOMMETS (vertex) pour déterminer comment le terrain se mélange.
 *
 * Principe :
 *   - Grille de tuiles H×W → grille de vertex (H+1)×(W+1)
 *   - Chaque vertex regarde les 4 tuiles adjacentes, prend la priorité max
 *   - Pour chaque couche de terrain, on construit un mask 4-bit (16 frames)
 *   - Rendu multi-passes : Water→Sand→HeavyRough→Rough→Fairway→Green
 *
 * Cf. analyse du code original Terrain.dll (FUN_1000e6c0, FUN_10012cf0)
 * et des sprites sheets parkland_textures.pdf.
 */

import { TileType, TILE_W, TILE_H } from '../core/types.js';

// ─── Priorités des terrains (pour vertex-based blending) ───

/**
 * TERRAIN_FAMILY — Tableau de compatibilité ascendante.
 * Utilisé par world/terrain.ts et core/types.ts.
 * Définit 7 familles visuelles (0=grass..6=cliff).
 * REMPLACÉ par getTerrainPriority() pour l'autotiling.
 */
export const TERRAIN_FAMILY: Record<TileType, number> = {
  [TileType.Rough]:         0,
  [TileType.Tree]:          0,
  [TileType.Flower]:        0,
  [TileType.DeepRough]:     0,
  [TileType.Rock]:          0,
  [TileType.Marsh]:         3,
  [TileType.Overgrowth]:    0,
  [TileType.Fairway]:       1,
  [TileType.Tee]:           1,
  [TileType.PuttingGreen]:  1,
  [TileType.FirmFairway]:   1,
  [TileType.TrickyGreen]:   1,
  [TileType.SandBunker]:    2,
  [TileType.GrassySand]:    2,
  [TileType.GrassBunker]:   2,
  [TileType.PotSandBunker]: 2,
  [TileType.ZenSand]:       2,
  [TileType.WaterShallow]:  3,
  [TileType.WaterMiddle]:   3,
  [TileType.WaterDeep]:     3,
  [TileType.Path]:          4,
  [TileType.Bridge]:        4,
  [TileType.Ravine]:        4,
  [TileType.Building]:      5,
  [TileType.RetainingWall]: 5,
  [TileType.Cliff]:         6,
  [TileType.Brush]:         0,
  [TileType.Natural]:       0,
  [TileType.Vegetation]:    0,
};

/**
 * Ordre de priorité (ASCENDANT) :
 *   0 = Water (base, tout en-dessous)
 *   1 = Sand, Bunker
 *   2 = Heavy Rough, Deep Rough, Brush
 *   3 = Rough, Overgrowth, Rock, Tree, Flower
 *   4 = Fairway, Tee
 *   5 = Green, PuttingGreen, TrickyGreen
 *
 * Un terrain avec priorité plus haute "empiète" sur ses voisins
 * de priorité plus basse via les vertex.
 */
export function getTerrainPriority(type: TileType): number {
  // Regroupement par familles visuelles
  switch (type) {
    // ── Priorité 0 : Eau ──
    case TileType.WaterShallow:
    case TileType.WaterMiddle:
    case TileType.WaterDeep:
    case TileType.Marsh:
      return 0;

    // ── Priorité 1 : Sable ──
    case TileType.SandBunker:
    case TileType.PotSandBunker:
    case TileType.ZenSand:
    case TileType.GrassySand:
    case TileType.GrassBunker:
      return 1;

    // ── Priorité 2 : Végétation dense ──
    case TileType.DeepRough:
    case TileType.Brush:
    case TileType.Vegetation:
    case TileType.Natural:
      return 2;

    // ── Priorité 3 : Herbe standard ──
    case TileType.Rough:
    case TileType.Overgrowth:
    case TileType.Rock:
    case TileType.Tree:
    case TileType.Flower:
    case TileType.Cliff:
    case TileType.Ravine:
      return 3;

    // ── Priorité 4 : Fairway ──
    case TileType.Fairway:
    case TileType.FirmFairway:
    case TileType.Tee:
      return 4;

    // ── Priorité 5 : Green ──
    case TileType.PuttingGreen:
    case TileType.TrickyGreen:
      return 5;

    // ── Hors-classement (rendu séparé) ──
    case TileType.Path:
    case TileType.Bridge:
    case TileType.Building:
    case TileType.RetainingWall:
      return -1; // Pas de mélange automatique
  }
}

// ─── Interface de grille ───

export interface AutotileGrid {
  readonly width: number;
  readonly height: number;
  getTileType(r: number, c: number): TileType;
  getTileElevation(r: number, c: number): [number, number, number, number];
}

// ─── MASK 4-BIT ───
// Bits : [N=0, E=1, S=2, W=3] — ordre N-E-S-W

/** Les 16 frames de transition possibles */
export type TransitionMask = number; // 0..15

export const TRANSITION_NONE  = 0x00; // 0000 — transparent
export const TRANSITION_FULL  = 0x0F; // 1111 — plein

// ─── Texture Sprite Sheet Mapping ───

/**
 * Mapping d'un mask 4-bit vers les coordonnées dans la spritesheet
 * de transition.
 *
 * Notre spritesheet 4×4 (16 frames) est organisée en N-E-S-W :
 *
 *    col 0    col 1    col 2    col 3
 *    ────────────────────────────────
 * L0: 0000    0001    0010    0011    (N)
 *      none    N       E       N+E
 * L1: 0100    0101    0110    0111    (S)
 *      S       N+S     E+S     N+E+S
 * L2: 1000    1001    1010    1011    (W)
 *      W       N+W     E+W     N+E+W
 * L3: 1100    1101    1110    1111    (SW)
 *      S+W     N+S+W   E+S+W   FULL
 *
 * Index = mask, Row = mask >> 2, Col = mask & 3
 */
export function maskToSpriteCoords(
  mask: TransitionMask
): { row: number; col: number } {
  return {
    row: mask >> 2,   // bits 2-3 → row
    col: mask & 3,    // bits 0-1 → col
  };
}

/**
 * Calcule la clé de texture pour un mask donné.
 * ex: "transition_5_3" → mask=5, variation=3
 */
export function maskTextureKey(
  baseType: TileType,
  mask: TransitionMask,
  variation: number
): string {
  const { row, col } = maskToSpriteCoords(mask);
  return `trans_${baseType}_r${row}_c${col}_v${variation}`;
}

// ─── Transition Manager ───

/**
 * Gestionnaire d'autotiling vertex-based.
 *
 * Pour chaque tuile, calcule une série de passes de rendu :
 * chaque passe correspond à une couche de terrain (Water, Sand, Rough, etc.)
 * avec un mask 4-bit indiquant quelle partie de la tuile est couverte.
 */
export class TerrainTransitionManager {
  private grid: AutotileGrid;

  constructor(grid: AutotileGrid) {
    this.grid = grid;
  }

  /**
   * getTileTerrain — Accès sécurisé à une tuile avec gestion des bords.
   * Les tuiles hors-limite sont traitées comme Water (priorité 0)
   * pour éviter les artefacts de bordure.
   */
  getTileTerrain(r: number, c: number): TileType {
    if (r < 0 || r >= this.grid.height || c < 0 || c >= this.grid.width) {
      return TileType.WaterDeep; // bordure = eau (invisible sous la carte)
    }
    return this.grid.getTileType(r, c);
  }

  /**
   * getVertexTerrain — Résout le type de terrain d'un SOMMET (vertex).
   *
   * Un vertex à la position (vr, vc) est partagé par 4 tuiles :
   *   Tile(vr-1, vc-1)  Tile(vr-1, vc)
   *   Tile(vr,   vc-1)  Tile(vr,   vc)
   *
   * On prend le terrain avec la PRIORITÉ MAXIMALE parmi les 4.
   * Ça permet aux terrains haute-priorité (Green > Fairway > Rough)
   * de s'étendre naturellement sur leurs voisins.
   */
  getVertexTerrain(vr: number, vc: number): TileType {
    const t1 = this.getTileTerrain(vr - 1, vc - 1);
    const t2 = this.getTileTerrain(vr - 1, vc);
    const t3 = this.getTileTerrain(vr, vc - 1);
    const t4 = this.getTileTerrain(vr, vc);

    const p1 = getTerrainPriority(t1);
    const p2 = getTerrainPriority(t2);
    const p3 = getTerrainPriority(t3);
    const p4 = getTerrainPriority(t4);

    const maxP = Math.max(p1, p2, p3, p4);

    // En cas d'égalité de priorité, on garde le plus "noble"
    // (ordre de l'énumération TileType)
    if (p1 === maxP) return t1;
    if (p2 === maxP) return t2;
    if (p3 === maxP) return t3;
    return t4;
  }

  /**
   * getVertexPriority — Version raccourcie qui retourne directement
   * la priorité max autour d'un vertex.
   */
  getVertexPriority(vr: number, vc: number): number {
    const p1 = getTerrainPriority(this.getTileTerrain(vr - 1, vc - 1));
    const p2 = getTerrainPriority(this.getTileTerrain(vr - 1, vc));
    const p3 = getTerrainPriority(this.getTileTerrain(vr, vc - 1));
    const p4 = getTerrainPriority(this.getTileTerrain(vr, vc));
    return Math.max(p1, p2, p3, p4);
  }

  /**
   * getTransitionMask — Calcule le mask 4-bit pour une tuile (r, c)
   * sur une COUCHE de terrain cible.
   *
   * Pour chaque coin (vertex), si la priorité du vertex ≥ priorité cible,
   * le bit correspondant est mis à 1.
   *
   * Bits : [0=Nord, 1=Est, 2=Sud, 3=Ouest]
   */
  getTransitionMask(r: number, c: number, targetPriority: number): TransitionMask {
    // Les 4 sommets de la tuile :
    const vN = this.getVertexPriority(r,     c    ); // Coin Nord     (r,   c)
    const vE = this.getVertexPriority(r,     c + 1); // Coin Est      (r,   c+1)
    const vS = this.getVertexPriority(r + 1, c + 1); // Coin Sud      (r+1, c+1)
    const vW = this.getVertexPriority(r + 1, c    ); // Coin Ouest    (r+1, c)

    const bitN = vN >= targetPriority ? 1 : 0;
    const bitE = vE >= targetPriority ? 1 : 0;
    const bitS = vS >= targetPriority ? 1 : 0;
    const bitW = vW >= targetPriority ? 1 : 0;

    return (bitN << 0) | (bitE << 1) | (bitS << 2) | (bitW << 3) as TransitionMask;
  }

  /**
   * getTileRenderPasses — Retourne les passes de rendu pour une tuile.
   *
   * On rend du plus bas (Water) au plus haut (Green) :
   *   Passe 0 : Water (toujours plein, mask 15) → fond
   *   Passe 1 : Sand/Bunker
   *   Passe 2 : HeavyRough
   *   Passe 3 : Rough
   *   Passe 4 : Fairway
   *   Passe 5 : Green
   *
   * Chaque passe plus haute masque partiellement la précédente selon
   * les vertex où elle domine.
   */
  getTileRenderPasses(
    r: number, c: number
  ): Array<{ priority: number; mask: TransitionMask }> {
    const passes: Array<{ priority: number; mask: TransitionMask }> = [];

    // Les 6 couches par priorité croissante
    // (0 = Water, 5 = Green)
    for (let priority = 0; priority <= 5; priority++) {
      const mask = this.getTransitionMask(r, c, priority);

      // Mask ≠ 0 : ce terrain est présent sur au moins un vertex
      if (mask !== TRANSITION_NONE) {
        passes.push({ priority, mask });
      }
    }

    return passes;
  }

  /**
   * getTileCenterTexture — Pour une tuile, détermine si on doit
   * afficher la texture PLEINE (mask 15 = terrain dominant partout)
   * ou une texture de transition.
   */
  getTileCenterType(r: number, c: number): TileType | null {
    const tileType = this.getTileTerrain(r, c);
    const tilePri  = getTerrainPriority(tileType);

    // Si le terrain de la tuile domine sur ses 4 coins, on affiche
    // sa texture pleine. Sinon, c'est une transition gérée par passes.
    const maskSelf = this.getTransitionMask(r, c, tilePri);
    if (maskSelf === TRANSITION_FULL) {
      return tileType; // Terrain plein, texture centrée
    }
    return null; // Transition, géré par les passes superposées
  }
}
