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
 * celle de la tuile courante.
 *
 * ─────────────────────────────────────────────────────────────────
 * 🔧 ÉDITION MANUELLE : Modifie TerrainTransitionMaps ci-dessous.
 *    Chaque clé = masque cardinal 4-bit (0-15)
 *    Chaque valeur = suffixe texture (ex: "0005" → WOODSA0005)
 * ─────────────────────────────────────────────────────────────────
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
// Squelette 16 états (Bitmask cardinal 4-way)
//
// Nord=1 (Haut-Droite), Est=2 (Bas-Droite),
// Sud=4 (Bas-Gauche), Ouest=8 (Haut-Gauche)
// ================================================================

const Default16StateMap: Record<number, string> = {
  [0]:  "000?", // Isolé (4 bords arrondis)
  [15]: "000?", // Centre (Texture pleine)
  [1]:  "000?", // Voisin NORD (Connexion Haut-Droite)
  [2]:  "000?", // Voisin EST (Connexion Bas-Droite)
  [4]:  "000?", // Voisin SUD (Connexion Bas-Gauche)
  [8]:  "000?", // Voisin OUEST (Connexion Haut-Gauche)
  [5]:  "000?", // Voisins NORD+SUD (Ligne diagonale \ )
  [10]: "000?", // Voisins EST+OUEST (Ligne diagonale / )
  [3]:  "000?", // Angle Extérieur NORD+EST
  [6]:  "000?", // Angle Extérieur EST+SUD
  [12]: "000?", // Angle Extérieur SUD+OUEST
  [9]:  "000?", // Angle Extérieur OUEST+NORD
  [7]:  "000?", // 3 Voisins (Bord arrondi vers OUEST)
  [14]: "000?", // 3 Voisins (Bord arrondi vers NORD)
  [13]: "000?", // 3 Voisins (Bord arrondi vers EST)
  [11]: "000?", // 3 Voisins (Bord arrondi vers SUD)
};

// ================================================================
// 🔧 TerrainTransitionMaps — Registre global
// ================================================================
// Édite les valeurs ci-dessous pour chaque type de terrain.
// Reprends la structure Default16StateMap et remplace les "000?".
// ================================================================

export const TerrainTransitionMaps: Record<string, Record<number, string>> = {
  "Woods": {
    ...Default16StateMap,
    [0]:  "0002",  // isolé
    [15]: "0001",  // centre
    [1]:  "0003",  // N
    [2]:  "0005",  // E
    [4]:  "0006",  // S
    [8]:  "0008",  // W
  },
  "Rough": { ...Default16StateMap },
  "Sand":  { ...Default16StateMap },
  "Water": { ...Default16StateMap },
  "Green": { ...Default16StateMap },
  // Herbe (Grass) = calque du fond, transitions optionnelles
  "Grass": { ...Default16StateMap },
};

// ================================================================
// Calcul du bitmask avec priorité des calques
// ================================================================

/**
 * Calcule le bitmask 8-way pour une tuile, en respectant la
 * hiérarchie des calques.
 *
 * Un voisin est considéré comme "même type" (bit=1) si sa priorité
 * est SUPÉRIEURE OU ÉGALE à celle de la tuile courante.
 *
 * Ainsi :
 *   - Woods (prio 7) → seuls d'autres Woods sont "same bits"
 *   - Grass (prio 4) → Grass, Rough, Woods sont "same bits"
 *   - Sand  (prio 1) → tout est "same bit" (jamais de transition)
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
  return map[card] ?? null;
}

/**
 * Retourne la clé de texture Phaser complète pour une tuile,
 * en combinant le préfixe du type, la lettre de groupe, et le
 * suffixe de transition.
 *
 * Fallback si la texture de transition n'existe pas :
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
  const g = groups[group % groups.length];

  // Essayer le suffixe LUT
  const card = toCardinalMask(mask);
  const suffix = TerrainTransitionMaps[prefix]?.[card];
  if (suffix) {
    const transitionKey = `${prefix}${g}${suffix}`;
    if (textureExists(transitionKey)) return transitionKey;
  }

  // Fallback : texture cosmétique
  const fallbackKey = `${prefix}${g}${variation.toString().padStart(4, '0')}`;
  if (textureExists(fallbackKey)) return fallbackKey;

  return defaultKey;
}
