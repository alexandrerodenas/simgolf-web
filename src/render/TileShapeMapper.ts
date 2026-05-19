/**
 * TileShapeMapper — Moteur de sélection géométrique de sprites.
 *
 * Basé sur l'analyse RE de SimGolf (Terrain.dll + fichiers BMP).
 * Voir : simgolf-re/cleaned_c/analyse_variantes_tuiles.md
 *
 * 4 axes orthogonaux de variation :
 *   Axe 1 : Forme géométrique      → A-Flat, B-Slope, C-Corner, D-Diag, E-Steep
 *   Axe 2 : Orientation bordure    → A/B/C/D (pour sable/eau avec voisins)
 *   Axe 3 : Cosmétique anti-répét. → 0001-0005 (Parkland) ou 0001-0009 (Desert)
 *   Axe 4 : Multi-passes           → compositing (V2)
 *
 * Parkland Rough : 5 groupes × 5 sprites = 25 textures.
 *   A0001-0005 : Flat (cosmétique uniquement — pas de sous-forme)
 *   B0001-0005 : Pente N,S,E,W + extra
 *   C0001-0005 : Coins concaves/convexes
 *   D0001-0005 : Diagonales (crête/vallée)
 *   E0001-0005 : Raides (dénivelé ≥ 2)
 *
 * La variation cosmétique est déterministe par position (x,y).
 */

// ================================================================
// SpriteSelector
// ================================================================

export interface SpriteSelector {
  textureKey: string;
  group: ShapeGroup;
  variant: number;
}

export type ShapeGroup = 'A' | 'B' | 'C' | 'D' | 'E';

// ================================================================
// Moteur principal
// ================================================================

/**
 * Sélectionne le sprite exact pour une tuile selon ses 4 hauteurs.
 *
 * @param hTL,hTR,hBR,hBL  Hauteurs des sommets (heightmap)
 * @param paletteName       'GRASS', 'FAIRWAY', etc.
 * @param x,y               Position grille (pour le déterministe)
 * @returns                 SpriteSelector avec la clé texture exacte
 */
export function selectTileSprite(
  hTL: number, hTR: number, hBR: number, hBL: number,
  paletteName: string,
  x: number, y: number,
): SpriteSelector {
  // Normalisation : min → 0, garder les différences relatives
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);
  const n = h.map(v => v - min) as [number, number, number, number];
  const max = Math.max(...n);

  // Seed déterministe pour la variation cosmétique
  const detSeed = (x * 31 + y * 17) & 0x7fffffff;

  // === A : Plat (0,0,0,0) ===
  if (n.every(v => v === 0)) {
    return selectInGroup('A', 0, 5, paletteName, detSeed);
  }

  // === E : Raide (différence ≥ 2) ===
  if (max >= 2) {
    return classifySteep(n, paletteName, detSeed);
  }

  // === B, C, D : Différence de 1 ===
  return classifyGentle(n, paletteName, detSeed);
}

// ================================================================
// Classification des formes
// ================================================================

/**
 * Pentes raides : différence de 2+ entre sommets adjacents.
 */
function classifySteep(
  n: [number, number, number, number],
  paletteName: string,
  seed: number,
): SpriteSelector {
  const [TL, TR, BR, BL] = n;

  // Pentes raides simples (2 sommets adjacents à 2)
  if (TL === 2 && TR === 2 && BR === 0 && BL === 0) return selectInGroup('E', 0, 5, paletteName, seed); // N raide
  if (TL === 0 && TR === 0 && BR === 2 && BL === 2) return selectInGroup('E', 1, 5, paletteName, seed); // S raide
  if (TL === 0 && TR === 2 && BR === 2 && BL === 0) return selectInGroup('E', 2, 5, paletteName, seed); // E raide
  if (TL === 2 && TR === 0 && BR === 0 && BL === 2) return selectInGroup('E', 3, 5, paletteName, seed); // W raide

  // Coin raide : 1 sommet à 2, les autres 0 ou 1
  if (TL === 2) return selectInGroup('E', 4, 5, paletteName, seed);
  if (TR === 2) return selectInGroup('E', 4, 5, paletteName, seed);
  if (BR === 2) return selectInGroup('E', 4, 5, paletteName, seed);
  if (BL === 2) return selectInGroup('E', 4, 5, paletteName, seed);

  // Fallback
  return selectInGroup('E', 0, 5, paletteName, seed);
}

/**
 * Différence de 1 → pentes (B), coins (C), diagonales (D).
 */
function classifyGentle(
  n: [number, number, number, number],
  paletteName: string,
  seed: number,
): SpriteSelector {
  const [TL, TR, BR, BL] = n;
  const elevated = [TL, TR, BR, BL].filter(v => v === 1).length;

  switch (elevated) {
    // === B : 2 sommets adjacents à 1 → pente simple ===
    case 2: {
      // B0001 = Nord (TL=TR=1)
      if (TL === 1 && TR === 1) return selectInGroup('B', 0, 5, paletteName, seed);
      // B0002 = Sud (BR=BL=1)
      if (BR === 1 && BL === 1) return selectInGroup('B', 1, 5, paletteName, seed);
      // B0003 = Est (TR=BR=1)
      if (TR === 1 && BR === 1) return selectInGroup('B', 2, 5, paletteName, seed);
      // B0004 = Ouest (TL=BL=1)
      if (TL === 1 && BL === 1) return selectInGroup('B', 3, 5, paletteName, seed);
      // B0005 = Diagonale — cas D
      if (TL === 1 && BR === 1) return selectInGroup('D', 0, 5, paletteName, seed); // Crête
      if (TR === 1 && BL === 1) return selectInGroup('D', 1, 5, paletteName, seed); // Vallée
      return selectInGroup('B', 4, 5, paletteName, seed);
    }

    // === C : 1 ou 3 sommets à 1 → coins ===
    case 1: {
      // Convexes (1 élevé) : C0001=TL, C0002=TR, C0003=BR, C0004=BL
      if (TL === 1) return selectInGroup('C', 0, 5, paletteName, seed);
      if (TR === 1) return selectInGroup('C', 1, 5, paletteName, seed);
      if (BR === 1) return selectInGroup('C', 2, 5, paletteName, seed);
      if (BL === 1) return selectInGroup('C', 3, 5, paletteName, seed);
      return selectInGroup('C', 4, 5, paletteName, seed);
    }

    case 3: {
      // Concaves (1 abaissé) : C0005
      return selectInGroup('C', 4, 5, paletteName, seed);
    }

    default:
      return selectInGroup('A', 0, 5, paletteName, seed);
  }
}

// ================================================================
// Sélection finale
// ================================================================

/**
 * Sélectionne un sprite dans un groupe, avec index déterministe.
 *
 * @param group        Groupe A-E
 * @param shapeIdx     Index de la forme dans le groupe (0..count-1)
 * @param count        Nombre de sprites dans le groupe (5 pour Parkland)
 * @param paletteName  'GRASS', 'FAIRWAY', etc.
 * @param seed         Seed déterministe (basée sur position)
 */
function selectInGroup(
  group: ShapeGroup,
  shapeIdx: number,
  count: number,
  paletteName: string,
  seed: number,
): SpriteSelector {
  // Le shapeIdx est l'index exact dans le groupe. Le jeu utilise
  // un compteur global modulo maxVariation pour la variation cosmétique,
  // mais comme nous avons ≤ 5 sprites par groupe pour Parkland,
  // chaque sprite a déjà une forme spécifique.
  // shapeIdx: 0..count-1
  const variant = Math.max(0, Math.min(shapeIdx, count - 1));
  const letter = group;
  const number = String(variant + 1).padStart(4, '0');
  const srcName = `${prefixForPalette(paletteName)}${letter}${number}`;

  return {
    textureKey: `diamond_${srcName}`,
    group,
    variant,
  };
}

// ================================================================
// Mapping palette → préfixe source
// ================================================================

const PALETTE_TO_PREFIX: Record<string, string> = {
  GRASS:   'Rough',
  FAIRWAY: 'Fairway',
  GREEN:   'PuttingGreen',
  SAND:    'SandBunker1',
  WATER:   'WaterShallow',
};

function prefixForPalette(paletteName: string): string {
  return PALETTE_TO_PREFIX[paletteName] ?? 'Rough';
}
