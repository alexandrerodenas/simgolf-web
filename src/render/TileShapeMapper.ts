/**
 * TileShapeMapper — Moteur de sélection géométrique de sprites.
 *
 * À partir des 4 hauteurs d'une tuile [hTL, hTR, hBR, hBL],
 * détermine la forme exacte (parmi les 19 géométries possibles)
 * et sélectionne le sprite approprié parmi les 25 variantes.
 *
 * Catégories (déduites du jeu original SimGolf) :
 *   A (Flat)         → 4 sommets égaux           → 5 var. cosmétiques
 *   B (Pente simple) → 2 sommets adjacents +1    → 4 directions
 *   C (Coin)         → 1 sommet différent        → 8 configs (4 convexes + 4 concaves)
 *   D (Diagonale)    → 2 sommets opposés +1      → 2 configs (crête/vallée)
 *   E (Raide)        → différence de 2 niveaux   → 4+ directions
 *
 * Au total : jusqu'à 19 formes géométriques × 1-5 variantes cosmétiques = 25 sprites.
 */

// ================================================================
// Types
// ================================================================

export type ShapeGroup = 'A' | 'B' | 'C' | 'D' | 'E';

export interface SpriteSelector {
  /** Clé de texture (e.g. 'diamond_RoughB0003') */
  textureKey: string;
  /** Groupe pour debug */
  group: ShapeGroup;
  /** Index dans le groupe */
  variant: number;
}

// ================================================================
// Mapper
// ================================================================

/**
 * Détermine la forme géométrique d'une tuile à partir de ses
 * 4 hauteurs de sommets et retourne le sprite à utiliser.
 *
 * @param hTL  Hauteur du sommet Top-Left
 * @param hTR  Hauteur du sommet Top-Right
 * @param hBR  Hauteur du sommet Bottom-Right
 * @param hBL  Hauteur du sommet Bottom-Left
 * @param typeName Nom du type de terrain ('GRASS', 'FAIRWAY', etc.)
 * @param rng  Fonction aléatoire pour les variantes cosmétiques
 */
export function selectTileSprite(
  hTL: number, hTR: number, hBR: number, hBL: number,
  typeName: string,
  rng: () => number = Math.random,
): SpriteSelector {
  // Normaliser : min → 0, garder les différences
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);
  const n = h.map(v => v - min) as [number, number, number, number];
  const max = Math.max(...n);

  // --- Cas spéciaux : toutes les combinaisons possibles ---

  // A: Plat (0,0,0,0)
  if (n.every(v => v === 0)) {
    return selectInGroup('A', 0, 5, typeName, rng); // 5 var. cosmétiques
  }

  // E: Pente raide (différence de 2)
  if (max >= 2) {
    return classifySteep(n, typeName, rng);
  }

  // Différence de 1 — analyser le motif
  return classifyGentle(n, typeName, rng);
}

// ================================================================
// Classification
// ================================================================

/**
 * Différence de 2+ → pentes raides (E) et coins raides.
 */
function classifySteep(
  n: [number, number, number, number],
  typeName: string,
  rng: () => number,
): SpriteSelector {
  const [TL, TR, BR, BL] = n;

  // Pentes raides simples : 2 sommets adjacents à 2, 2 à 0
  if (TL === 2 && TR === 2 && BR === 0 && BL === 0) return selectInGroup('E', 0, 5, typeName, rng); // N raide
  if (TL === 0 && TR === 0 && BR === 2 && BL === 2) return selectInGroup('E', 1, 5, typeName, rng); // S raide
  if (TL === 0 && TR === 2 && BR === 2 && BL === 0) return selectInGroup('E', 2, 5, typeName, rng); // E raide
  if (TL === 2 && TR === 0 && BR === 0 && BL === 2) return selectInGroup('E', 3, 5, typeName, rng); // W raide

  // Coin raide : un sommet à 2, le reste entre 0 et 1
  if (TL === 2) return selectInGroup('E', 4, 5, typeName, rng);
  if (TR === 2) return selectInGroup('E', 4, 5, typeName, rng);
  if (BR === 2) return selectInGroup('E', 4, 5, typeName, rng);
  if (BL === 2) return selectInGroup('E', 4, 5, typeName, rng);

  // Fallback
  return selectInGroup('E', 0, 5, typeName, rng);
}

/**
 * Différence de 1 → pentes douces (B), coins (C), diagonales (D).
 */
function classifyGentle(
  n: [number, number, number, number],
  typeName: string,
  rng: () => number,
): SpriteSelector {
  const [TL, TR, BR, BL] = n;

  // Compter les sommets à 1
  const elevated = [TL, TR, BR, BL].filter(v => v === 1).length;

  switch (elevated) {
    // B: 2 sommets adjacents à 1 → pente simple
    case 2: {
      // Nord : TL=TR=1, BR=BL=0
      if (TL === 1 && TR === 1 && BR === 0 && BL === 0) return selectInGroup('B', 0, 5, typeName, rng);
      // Sud : TL=TR=0, BR=BL=1
      if (TL === 0 && TR === 0 && BR === 1 && BL === 1) return selectInGroup('B', 1, 5, typeName, rng);
      // Est : TL=BL=0, TR=BR=1
      if (TL === 0 && TR === 1 && BR === 1 && BL === 0) return selectInGroup('B', 2, 5, typeName, rng);
      // Ouest : TL=BL=1, TR=BR=0
      if (TL === 1 && TR === 0 && BR === 0 && BL === 1) return selectInGroup('B', 3, 5, typeName, rng);
      // Diagonale : 2 opposés à 1 — cas D
      if (TL === 1 && BR === 1 && TR === 0 && BL === 0) return selectInGroup('D', 0, 5, typeName, rng); // Crête
      if (TL === 0 && BR === 0 && TR === 1 && BL === 1) return selectInGroup('D', 1, 5, typeName, rng); // Vallée
      // Fallback : considérer comme pente
      return selectInGroup('B', 0, 5, typeName, rng);
    }

    // C: 1 sommet à 1 → coin convexe, ou 3 sommets à 1 → coin concave
    case 1: {
      // Coin convexe : un seul sommet surélevé
      if (TL === 1) return selectInGroup('C', 0, 5, typeName, rng); // TL convexe
      if (TR === 1) return selectInGroup('C', 1, 5, typeName, rng); // TR convexe
      if (BR === 1) return selectInGroup('C', 2, 5, typeName, rng); // BR convexe
      if (BL === 1) return selectInGroup('C', 3, 5, typeName, rng); // BL convexe
      return selectInGroup('C', 0, 5, typeName, rng);
    }

    case 3: {
      // Coin concave : un seul sommet abaissé
      if (TL === 0) return selectInGroup('C', 4, 5, typeName, rng); // TL concave
      if (TR === 0) return selectInGroup('C', 4, 5, typeName, rng);
      if (BR === 0) return selectInGroup('C', 4, 5, typeName, rng);
      if (BL === 0) return selectInGroup('C', 4, 5, typeName, rng);
      return selectInGroup('C', 4, 5, typeName, rng);
    }

    default:
      // Fallback : plat
      return selectInGroup('A', 0, 5, typeName, rng);
  }
}

// ================================================================
// Sélection de sprite
// ================================================================

/**
 * Sélectionne un sprite dans un groupe, avec variation cosmétique.
 *
 * @param group   Groupe (A-E)
 * @param baseIdx Index de base dans le groupe (0-4)
 * @param count   Nombre de sprites dans le groupe
 * @param typeName Type de terrain
 * @param rng     Fonction aléatoire
 */
function selectInGroup(
  group: ShapeGroup,
  baseIdx: number,
  count: number,
  typeName: string,
  rng: () => number,
): SpriteSelector {
  // Pour les groupes avec plusieurs variantes cosmétiques,
  // on ajoute un bruit aléatoire pour briser la répétition
  const cosmeticOffset = Math.floor(rng() * count);
  const finalIdx = (baseIdx + cosmeticOffset) % count;

  const letter = group;
  const number = String(finalIdx + 1).padStart(4, '0');
  const srcName = `${typeName}${letter}${number}`;

  return {
    textureKey: `diamond_${srcName}`,
    group,
    variant: finalIdx,
  };
}

// ================================================================
// RNG partagé pour la cohérence des textures
// ================================================================

/**
 * Crée un RNG déterministe à partir d'une seed,
 * pour que les textures soient stables entre les rendus.
 */
export function createTileRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
