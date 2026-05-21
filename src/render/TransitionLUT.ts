/**
 * TransitionLUT — Registre global des transitions de terrain
 *
 * Chaque type de terrain peut avoir son propre mapping bitmask → suffixe.
 * Le système utilise un masque cardinal 4-bit (N=1, E=2, S=4, W=8),
 * soit 16 états possibles, pour sélectionner le sprite Firaxis approprié.
 *
 * Le bitmask 8-way (N/NE/E/SE/S/SW/W/NW) est calculé en amont par
 * calculateTransitionBitmask(), qui intègre la hiérarchie des calques :
 * un voisin est considéré comme "même type" si sa priorité est >=
 * celle de la tuile courante (le terrain dominant dessine sa transition
 * sur le dominé).
 *
 * ─────────────────────────────────────────────────────────────────
 * 🔧 ÉDITION MANUELLE : Modifie TerrainTransitionMaps ci-dessous.
 *    Chaque clé = masque cardinal 4-bit (0-15)
 *    Chaque valeur = suffixe texture (ex: "0005" → WOODSA0005)
 * ─────────────────────────────────────────────────────────────────
 *
 * RÈGLE DE SÉCURITÉ : Un suffixe "000?" est ignoré et provoque
 * le fallback vers la texture centrale (0001). Tout bitmask non
 * configuré dans une map se comporte comme "0001".
 *
 * Pour régler visuellement :
 *   1. Active [D] pour voir les suffixes affichés sur chaque tuile
 *   2. Regarde le sprite : si le bord dessiné ne correspond pas
 *      à la bonne direction, change le numéro dans le dictionnaire
 *   3. Rebuild : les nouveaux suffixes s'affichent instantanément
 */

// ================================================================
// Poids des bits (8-way)
// ================================================================

export const B_N  = 1;
export const B_NE = 2;
export const B_E  = 4;
export const B_SE = 8;
export const B_S  = 16;
export const B_SW = 32;
export const B_W  = 64;
export const B_NW = 128;

export const BIT_DIRS: [number, number, number][] = [
  [0, -1, B_N],   [1, -1, B_NE],
  [1,  0, B_E],   [1,  1, B_SE],
  [0,  1, B_S],   [-1, 1, B_SW],
  [-1, 0, B_W],   [-1,-1, B_NW],
];

// ================================================================
// Hiérarchie des calques (Layer Priority)
// Bas → Haut : Water < Sand < Fairway < Green < Grass < Rough < Rock < Woods
// ================================================================

import { TileType } from '../core/types';
import { TerrainEngine } from '../core';

export const LAYER_PRIORITY: Record<TileType, number> = {
  [TileType.WATER]:        0,
  [TileType.WATER_HAZARD]: 0,
  [TileType.SAND]:         1,
  [TileType.FAIRWAY]:      2,
  [TileType.GREEN]:        3,
  [TileType.GRASS]:        4,
  [TileType.ROUGH]:        5,
  [TileType.ROCK]:         6,
  [TileType.TREE]:         7,
  [TileType.BUSH]:         5,
  [TileType.FLOWER]:       4,
  [TileType.PATH]:         6,
  [TileType.TEE]:          4,
  [TileType.BUILDING]:     8,
  [TileType.BRIDGE]:       6,
  [TileType.HOLE]:         8,
  [TileType.EMPTY]:        0,
};

// ================================================================
// Map "full texture only" pour neutraliser les transitions
// Tous les 16 états → "0001" (texture centrale pleine)
// ================================================================

const FullTextureOnlyMap: Record<number, string> = {
  [0]: "0001", [1]: "0001", [2]: "0001", [3]: "0001",
  [4]: "0001", [5]: "0001", [6]: "0001", [7]: "0001",
  [8]: "0001", [9]: "0001", [10]: "0001", [11]: "0001",
  [12]: "0001", [13]: "0001", [14]: "0001", [15]: "0001",
};

// ================================================================
// 🔧 TerrainTransitionMaps — Registre global
// ================================================================
// Woods est notre cobaye actuel, on garde la structure 16 états descriptive
// Les autres terrains sont neutralisés pour nettoyer le rendu.
// ================================================================

export const TerrainTransitionMaps: Record<string, Record<number, string>> = {
  "Woods": {
    [0]:  "0002", // Isolé
    [15]: "0001", // Centre
    [1]:  "0003", // N
    [2]:  "0005", // E
    [4]:  "0006", // S
    [8]:  "0008", // W
    // Toutes les autres combinaisons → 0001 en attendant l'arbitrage visuel
    [3]: "0001", [5]: "0001", [6]: "0001", [9]: "0001",
    [10]: "0001", [11]: "0001", [12]: "0001", [13]: "0001", [14]: "0001",
  },
  // On neutralise les autres terrains pour nettoyer l'écran :
  "Rough": { ...FullTextureOnlyMap },
  "Sand":  { ...FullTextureOnlyMap },
  "Water": { ...FullTextureOnlyMap },
  "Green": { ...FullTextureOnlyMap },
  "Grass": { ...FullTextureOnlyMap },
};

// ================================================================
// Calcul du bitmask avec priorité des calques
// ================================================================

/**
 * Calcule le bitmask 8-way pour une tuile, en respectant la
 * hiérarchie des calques.
 *
 * RÈGLE : Un voisin est considéré comme "même type" (bit=1) si sa
 * priorité est SUPÉRIEURE OU ÉGALE à celle de la tuile courante.
 *
 * Conséquence :
 *   - Woods (prio 7) → seuls les autres Woods sont "même type"
 *     → Woods dessine ses bords de transition face au gazon
 *   - Grass (prio 4) → Woods (prio 7) est "même type" → bit=1
 *     → Grass ne dessine PAS de transition vers Woods (elle montre
 *       sa texture centrale "0001"), ce qui est correct puisque
 *       c'est le terrain dominant qui porte la transition.
 *   - Sand (prio 1) → tout est "même type" → jamais de transition
 */
export function calculateTransitionBitmask(
  terrain: TerrainEngine,
  x: number, y: number,
  tileType: TileType,
): number {
  const ownPriority = LAYER_PRIORITY[tileType] ?? 0;
  let mask = 0;
  for (const [dx, dy, bit] of BIT_DIRS) {
    const n = terrain.tileAt(x + dx, y + dy);
    if (n) {
      const neighborPriority = LAYER_PRIORITY[n.type] ?? 0;
      if (neighborPriority >= ownPriority) {
        mask |= bit;
      }
    }
  }
  return mask;
}

// ================================================================
// Lookup dans le registre
// ================================================================

/** Convertit un bitmask 8-way (0-255) en masque cardinal 4-bit */
export function toCardinalMask(mask: number): number {
  let c = 0;
  if (mask & B_N)  c |= 1;
  if (mask & B_E)  c |= 2;
  if (mask & B_S)  c |= 4;
  if (mask & B_W)  c |= 8;
  return c;
}

/**
 * Retourne le nom de la map de transition pour un TileType.
 * Ex: TileType.TREE → "Woods", TileType.ROUGH → "Rough"
 */
function typeToMapName(type: TileType): string | null {
  const map: Partial<Record<TileType, string>> = {
    [TileType.TREE]:  "Woods",
    [TileType.ROUGH]: "Rough",
    [TileType.SAND]:  "Sand",
    [TileType.WATER]: "Water",
    [TileType.GREEN]: "Green",
    [TileType.GRASS]: "Grass",
  };
  return map[type] ?? null;
}

/**
 * Retourne le suffixe de transition pour une tuile, en fonction
 * de son type et de son bitmask 8-way.
 *
 * @returns Suffixe "0005" ou null si le type n'a pas de map
 *          ou si le suffixe configuré est "000?" (non-configuré)
 */
export function getTransitionSuffix(
  tileType: TileType,
  mask: number,
): string | null {
  const mapName = typeToMapName(tileType);
  if (!mapName) return null;
  const map = TerrainTransitionMaps[mapName];
  if (!map) return null;
  const card = toCardinalMask(mask);
  const suffix = map[card];
  // RÈGLE DE SÉCURITÉ : ignorer les "000?" (non configuré)
  if (!suffix || suffix === '000?') return null;
  return suffix;
}

/**
 * Retourne la clé de texture Phaser complète pour une tuile,
 * en combinant le préfixe du type, la lettre de groupe, et le
 * suffixe de transition.
 *
 * Chaîne de fallback :
 *   transition → variation cosmétique → texture par défaut
 *
 * @param prefix   Préfixe de texture (ex: "WOODS", "ROUGH")
 * @param group    Groupe décoratif (0=A, 1=B, 2=C, 3=D)
 * @param variation Variation cosmétique (1-9)
 * @param mask     Bitmask 8-way
 * @param textureExists  Callback de vérification
 * @param defaultKey     Clé de dernier recours
 */
export function getTransitionTextureKey(
  prefix: string,
  group: number,
  variation: number,
  mask: number,
  textureExists: (key: string) => boolean,
  defaultKey = `${prefix}A0001`,
): string {
  const groups = ['A', 'B', 'C', 'D'];
  const g = groups[((group % 4) + 4) % 4]; // sécurité JS modulo négatif

  // Essayer le suffixe LUT (avec vérification "000?")
  const card = toCardinalMask(mask);
  const suffix = TerrainTransitionMaps[prefix]?.[card];
  if (suffix && suffix !== '000?') {
    const transitionKey = `${prefix}${g}${suffix}`;
    if (textureExists(transitionKey)) return transitionKey;
  }

  // Fallback : texture cosmétique (variation 1-9, groupe A-D)
  const v = Math.max(1, Math.min(9, variation || 1));
  const fallbackKey = `${prefix}${g}${v.toString().padStart(4, '0')}`;
  if (textureExists(fallbackKey)) return fallbackKey;

  return defaultKey;
}
