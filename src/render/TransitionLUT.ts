/**
 * TransitionLUT — Table de correspondance bitmask → sprite
 *
 * ÉDITION MANUELLE : Modifie WoodsTransitionMap ci-dessous.
 * Chaque clé est un masque cardinal 4-bit (N=1, E=2, S=4, W=8).
 * Chaque valeur est le suffixe texture (ex: "0005" → WOODSA0005).
 *
 * Pour régler le mapping :
 *   1. Place une tuile Woods isolée (tous voisins ≠ Woods)
 *   2. Active le debug [D], regarde quel suffixe s'affiche
 *   3. Regarde le sprite : si le bord dessiné ne correspond pas
 *      à la bonne direction, change le numéro dans le dictionnaire
 *
 * ─────────────────────────────────────────────────────────────────
 * WoodsTransitionMap — 🔧 ÉDITE ICI LES VALEURS
 * ─────────────────────────────────────────────────────────────────
 *
 * Masque cardinal (bits) : N=1, E=2, S=4, W=8
 *
 * Clé       Signification                  Suffixe actuel
 * ───       ─────────────                  ──────────────
 *  0        Isolé (tous voisins ≠ Woods)      0002
 *  1=N      Bord Nord seul                    0003
 *  2=E      Bord Est seul                     0005
 *  4=S      Bord Sud seul                     0006
 *  8=W      Bord Ouest seul                   0008
 *  3=N+E    Coin NE                           0010
 *  5=N+S    Opposés N/S                       0010
 *  6=E+S    Coin SE (à vérifier)              0005
 *  9=N+W    Coin NW                           0009
 * 10=E+W    Opposés E/W                       0011
 * 12=S+W    Coin SW                           0007
 *  7=N+E+S  3 côtés (N,E,S)                   0012
 * 11=N+E+W  3 côtés (N,E,W)                   0013
 * 13=N+S+W  3 côtés (N,S,W)                   0015
 * 14=E+S+W  3 côtés (E,S,W)                   0014
 * 15=N+E+S+W Centre (tous voisins = Woods)    0001
 */

// Poids des bits (8-way — utilisés par calculateBitmask)
const N  = 1;
const NE = 2;
const E  = 4;
const SE = 8;
const S  = 16;
const SW = 32;
const W  = 64;
const NW = 128;

// ================================================================
// 🔧 WoodsTransitionMap — ÉDITION MANUELLE
// ================================================================
// Clé = masque cardinal 4-bit (N=1, E=2, S=4, W=8)
// Valeur = suffixe texture (ex: "0005" → WOODSA0005)
// ================================================================

export const WoodsTransitionMap: Record<number, string> = {
  //  Card mask   Suffixe   Situation
  [0]:           "0002",  // isolé (tous voisins ≠ Woods)
  [1]:           "0003",  // N seulement
  [2]:           "0005",  // E seulement
  [4]:           "0006",  // S seulement
  [8]:           "0008",  // W seulement
  [3]:           "0010",  // N+E  — coin NE
  [5]:           "0010",  // N+S  — opposés N/S
  [6]:           "0005",  // E+S  — coin SE
  [9]:           "0009",  // N+W  — coin NW
  [10]:          "0011",  // E+W  — opposés E/W
  [12]:          "0007",  // S+W  — coin SW
  [7]:           "0012",  // N+E+S — 3 côtés
  [11]:          "0013",  // N+E+W — 3 côtés
  [13]:          "0015",  // N+S+W — 3 côtés
  [14]:          "0014",  // E+S+W — 3 côtés
  [15]:          "0001",  // centre (tous voisins = Woods)
};

// ================================================================
// Fonctions internes
// ================================================================

/** Convertit un bitmask 8-way (0-255) en masque cardinal 4-bit */
function cardinalMask(mask: number): number {
  let c = 0;
  if (mask & N)  c |= 1;  // N=1
  if (mask & E)  c |= 2;  // E=4 → 2
  if (mask & S)  c |= 4;  // S=16 → 4
  if (mask & W)  c |= 8;  // W=64 → 8
  return c;
}

// LUT complète 256 entrées (dérivée du dictionnaire ci-dessus)
const _fullLUT = new Map<number, string>();

function buildFullLUT(): void {
  for (let mask = 0; mask < 256; mask++) {
    const card = cardinalMask(mask);
    let suffix = WoodsTransitionMap[card] ?? "0001";

    // Corrections diagonales (ébauche)
    const hasNE = !!(mask & NE);
    const hasSE = !!(mask & SE);
    const hasSW = !!(mask & SW);
    const hasNW = !!(mask & NW);
    const hasN  = !!(mask & N);
    const hasE  = !!(mask & E);
    const hasS  = !!(mask & S);
    const hasW  = !!(mask & W);

    // Diagonale seule sans cardinaux adjacents
    if (hasNE && !hasN && !hasE) suffix = "0003";
    if (hasSE && !hasS && !hasE) suffix = "0005";
    if (hasSW && !hasS && !hasW) suffix = "0007";
    if (hasNW && !hasN && !hasW) suffix = "0009";

    _fullLUT.set(mask, suffix);
  }
}

buildFullLUT();

// ================================================================
// API publique
// ================================================================

/**
 * Retourne le suffixe sprite pour un bitmask 8-way.
 * Lit depuis la LUT complète, avec fallback "0001".
 */
export function woodsTransitionSuffix(mask: number): string {
  return _fullLUT.get(mask) ?? "0001";
}

/**
 * Retourne la clé de texture Phaser complète pour une tuile Woods,
 * en combinant le groupe de variation (A-D) et le suffixe LUT.
 *
 * Fallback si la texture de transition n'existe pas :
 *   transition → variation cosmétique → WOODSA0001
 */
export function woodsTextureKey(
  group: number,
  variation: number,
  mask: number,
  textureExists: (key: string) => boolean,
): string {
  const groups = ['A', 'B', 'C', 'D'];
  const g = groups[group % groups.length];
  const suffix = woodsTransitionSuffix(mask);

  // Essayer la texture de transition d'abord
  const transitionKey = `WOODS${g}${suffix}`;
  if (textureExists(transitionKey)) {
    return transitionKey;
  }

  // Fallback : texture cosmétique 0001-0009
  const fallbackKey = `WOODS${g}${variation.toString().padStart(4, '0')}`;
  if (textureExists(fallbackKey)) {
    return fallbackKey;
  }

  // Dernier recours
  return 'WOODSA0001';
}
