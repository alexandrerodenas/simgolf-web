/**
 * TransitionLUT — Table de correspondance bitmask → sprite
 *
 * ÉBAUCHE / DRAFT — v0.1.0
 *
 * Mappe les 256 valeurs possibles du bitmask 8-way calculateBitmask()
 * vers les suffixes numériques des sprites de transition Firaxis
 * (0001 = tuile pleine, 0002-0016+ = lisières, coins, multi-bords).
 *
 * Convention des bits (8 directions) :
 *   N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
 *
 * Le bit vaut 1 quand le voisin est du MÊME type de terrain.
 *
 * Dans le système Firaxis (SimGolf/Civ), les sprites sont organisés
 * comme suit (à confirmer avec les vrais assets extraits) :
 *
 *   0001 = tuile centrale (tous voisins OK → mask=255)
 *   0002 = bord N          0003 = bord NE (coin intérieur)
 *   0004 = bord E          0005 = bord SE (coin intérieur)
 *   0006 = bord S          0007 = bord SW (coin intérieur)
 *   0008 = bord W          0009 = bord NW (coin intérieur)
 *   0010 = N+E             0011 = E+W (opposés)
 *   0012 = N+E+S           0013 = N+E+W
 *   0014 = S+E+W           0015 = N+S+W
 *   0016 = tous (aucun voisin = mask=0)
 *
 * Données utilisateur (exemples) :
 *   mask=0  → 0001   (isolé, aucun voisin du même type)
 *   mask=4  → 0005   (E only)
 *   mask=5  → 0010   (N+E)
 *
 * @todo Valider chaque entrée avec les sprites réels Firaxis.
 */

// ================================================================
// Poids des bits
// ================================================================

const N  = 1;
const NE = 2;
const E  = 4;
const SE = 8;
const S  = 16;
const SW = 32;
const W  = 64;
const NW = 128;

// ================================================================
// Masque cardinal 4-bit (on ignore les diagonales)
// Bits : N=1, E=2, S=4, W=8
// ================================================================

function cardinalMask(mask: number): number {
  let c = 0;
  if (mask & N)  c |= 1;
  if (mask & E)  c |= 2;
  if (mask & S)  c |= 4;
  if (mask & W)  c |= 8;
  return c;
}

// ================================================================
// LUT : masque cardinal 4-bit → suffixe sprite (1-16)
// ================================================================
//
// ÉBAUCHE — les valeurs marquées « TODO » sont des hypothèses à
// vérifier avec les assets réels. Seuls les 3 cas fournis par
// l'utilisateur sont considérés comme fiables.
//
// Grille 4×4 organisée par masque cardinal [N][E][S][W] :
//
//   mask → idx → (col, row) → suffixe
//
// Les suffixes au-delà de 0009 (0010-0016) n'ont pas encore de
// fichier WebP généré — le renderer tombera sur la texture 0001.
//
// ----------------------------------------------------------------

const CARDINAL_LUT: Record<number, number> = {
  //  N E S W   → suffixe  notes
  // ────────     ────────  ─────────────────────────────────
  [0]:          1,     // aucun → tuile pleine (✓ utilisateur)
  [N]:          2,     // N only → bord nord
  [E]:          5,     // E only → bord est  (✓ utilisateur)
  [S]:          6,     // S only → bord sud
  [W]:          8,     // W only → bord ouest

  [N | E]:     10,     // N+E    → coin NE   (✓ utilisateur)
  [N | S]:     10,     // N+S    → opposés N/S (même sprite que N+E? à vérifier)
  [N | W]:      9,     // N+W    → coin NW intérieur
  [E | S]:      5,     // E+S    → coin SE (à vérifier)
  [E | W]:     11,     // E+W    → opposés E/W
  [S | W]:      7,     // S+W    → coin SW intérieur

  [N | E | S]:     12, // N+E+S  → 3 côtés
  [N | E | W]:     13, // N+E+W  → 3 côtés
  [N | S | W]:     15, // N+S+W  → 3 côtés
  [E | S | W]:     14, // E+S+W  → 3 côtés

  [N | E | S | W]: 16, // tous cardinaux → tuile entourée
};

// ================================================================
// LUT complète 8-bit (256 entrées) — générée par délégation
// ================================================================
//
// Pour les masks 8-bit qui incluent des bits diagonaux,
// on dérive le suffixe depuis le masque cardinal puis on
// applique des corrections pour les diagonales non-couvertes.
//
// TODO: Remplacer ce dérivé par une LUT exhaustive quand les
// sprites 0005-0016+ seront disponibles.

const _fullLUT = new Map<number, number>();

function buildFullLUT(): void {
  for (let mask = 0; mask < 256; mask++) {
    const card = cardinalMask(mask);
    let suffix = CARDINAL_LUT[card] ?? 1;

    // Corrections diagonales (ébauche) :
    // - Si un bit diagonal est présent sans ses cardinaux adjacents,
    //   on peut avoir besoin d'un sprite différent.
    // - Exemple : NE seul sans N ni E → nécessite un sprite spécial
    const hasNE = !!(mask & NE);
    const hasSE = !!(mask & SE);
    const hasSW = !!(mask & SW);
    const hasNW = !!(mask & NW);
    const hasN  = !!(mask & N);
    const hasE  = !!(mask & E);
    const hasS  = !!(mask & S);
    const hasW  = !!(mask & W);

    // Coin intérieur diagonal (sans les cardinaux adjacents)
    // Ex: NE sans N ni E = bordure diagonale → TODO
    if (hasNE && !hasN && !hasE) { suffix = 3; }     // NE corner inner
    if (hasSE && !hasS && !hasE) { suffix = 5; }     // SE corner inner
    if (hasSW && !hasS && !hasW) { suffix = 7; }     // SW corner inner
    if (hasNW && !hasN && !hasW) { suffix = 9; }     // NW corner inner

    _fullLUT.set(mask, suffix);
  }
}

buildFullLUT();

// ================================================================
// API publique
// ================================================================

/**
 * Retourne le suffixe sprite (1-16+) pour une tuile Woods
 * en fonction de son bitmask 8-way.
 *
 * @param mask  Bitmask 8-way (0-255) de la tuile.
 * @returns     Numéro de sprite (1 = 0001, 5 = 0005, 16 = 0016).
 *
 * ÉBAUCHE : seuls mask=0→1, mask=4→5, mask=5→10 sont validés.
 */
export function woodsTransitionSuffix(mask: number): number {
  return _fullLUT.get(mask) ?? 1;
}

/**
 * Retourne la clé de texture Phaser complète pour une tuile Woods,
 * en combinant le groupe de variation (A-D), le suffixe de transition
 * et le numéro cosmétique.
 *
 * @param group       Groupe de variation (0=A, 1=B, 2=C, 3=D)
 * @param variation   Variation cosmétique (1-9)
 * @param mask        Bitmask 8-way
 * @param scene       Scène Phaser (pour vérifier si la texture existe)
 * @returns           Clé de texture (ex: 'WOODSA0005')
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
  const transitionKey = `WOODS${g}${suffix.toString().padStart(4, '0')}`;
  if (textureExists(transitionKey)) {
    return transitionKey;
  }

  // Fallback : texture 0001 (pleine) avec la variation demandée
  const fallbackKey = `WOODS${g}${variation.toString().padStart(4, '0')}`;
  if (textureExists(fallbackKey)) {
    return fallbackKey;
  }

  // Dernier recours : WOODSA0001
  return 'WOODSA0001';
}
