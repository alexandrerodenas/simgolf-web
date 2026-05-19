/**
 * ShapeClassifier — Traduit les 4 hauteurs d'une tuile en lettre A-E
 * (Axe 1 du document RE) + variante cosmétique (Axe 3).
 *
 * Basé sur l'analyse RE de SimGolf :
 *   A = plat       (4 sommets égaux)
 *   B = pente      (2 adjacents surélevés)
 *   C = coin       (1 sommet surélevé ou abaissé)
 *   D = diagonale  (2 opposés surélevés)
 *   E = raide      (différence ≥ 2)
 *
 * Cosmétique : hachage déterministe par position (pas de flicker).
 */

// ================================================================
// Axe 1 : Forme géométrique
// ================================================================

export type ShapeLetter = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * Détermine la lettre de forme (A-E) à partir des 4 hauteurs.
 *
 * @returns 'A' | 'B' | 'C' | 'D' | 'E'
 */
export function getShapeLetter(
  hTL: number, hTR: number, hBR: number, hBL: number,
): ShapeLetter {
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);

  // Normalisation : point le plus bas → 0
  const n = h.map(v => v - min) as [number, number, number, number];
  const max = Math.max(...n);

  // A : tout plat
  if (max === 0) return 'A';

  // E : pente raide (différence ≥ 2)
  if (max >= 2) return 'E';

  // max === 1 : analyser le motif
  const [TL, TR, BR, BL] = n;
  const sum = TL + TR + BR + BL;

  // C : coin convexe (1 élevé) ou concave (3 élevés = 1 abaissé)
  if (sum === 1 || sum === 3) return 'C';

  // sum === 2 : diagonale ou pente simple
  if (sum === 2) {
    // D : diagonale (coins opposés égaux)
    if ((TL === 1 && BR === 1) || (TR === 1 && BL === 1)) return 'D';
    // B : pente simple (2 adjacents)
    return 'B';
  }

  return 'A'; // fallback
}

// ================================================================
// Axe 3 : Variante cosmétique déterministe
// ================================================================

/**
 * Retourne une chaîne de 4 chiffres (0001-0009) basée sur la
 * position (x, y) de la tuile. Déterministe → pas de flicker.
 *
 * Le jeu original utilise un compteur global modulo maxVariation.
 * Pour le port web, un hash de position est plus stable.
 */
export function getCosmeticVariant(
  x: number,
  y: number,
  maxVariants = 9,
): string {
  const hash = (x * 31 + y * 17) & 0x7fffffff;
  const variant = (hash % maxVariants) + 1; // 1..maxVariants
  return variant.toString().padStart(4, '0');
}

/**
 * Construit le nom de texture source complet.
 * Exemple : shape='B', variant='0003', prefix='Rough' → 'RoughB0003'
 */
export function buildTextureSourceName(
  prefix: string,
  letter: ShapeLetter,
  variant: string,
): string {
  return `${prefix}${letter}${variant}`;
}
