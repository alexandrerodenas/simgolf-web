/**
 * TextureTable3D.ts — Table de textures 3D (port de DAT_100687f8)
 *
 * Le jeu original stocke ses textures OpenGL dans une table 3D aplatie :
 *   byte_offset = terrainType * 4
 *               + variation * 0x24         (36 = 9 × 4)
 *               + (orientation + 0x1b) * 900  (900 = 225 × 4)
 *
 * Organisation : table[orientation + 27][variation][type]
 *   - orientation 0-3 = A-D
 *   - variation 0-8 (9 slots)
 *   - type 0-224 (225 slots — la table est pré-allouée large)
 *
 * Le +27 (0x1B) = 27 slots d'orientation × 900 bytes chacun
 * = 24300 bytes de padding avant les données terrain.
 *
 * Slots spéciaux dans la table :
 *   0x20 (32) → texture overlay/dirt (utilisé par FUN_100108f0)
 *   0x21 (33) → texture overlay/path alternative
 *
 * Sources : FUN_1000e6c0 lignes 44-46, FUN_100108f0 ligne 72
 */

import * as THREE from 'three';
import { TileType } from '../terrain-lib/types.js';

// ── Types de terrain → préfixe de fichier ──
const TYPE_PREFIX: Record<number, string> = {
  [TileType.Rough]:         'ROUGH',
  [TileType.DeepRough]:     'DEEPROUGH',
  [TileType.Fairway]:       'FAIRWAY',
  [TileType.PuttingGreen]:  'PUTTINGGREEN',
  [TileType.SandBunker]:    'SANDBUNKER',
  [TileType.Tee]:           'TEE',
  [TileType.GrassySand]:    'GRASSYSAND',
  [TileType.GrassBunker]:   'GRASSBUNKER',
  [TileType.WaterShallow]:  'WATERSHALLOW',
  [TileType.WaterMiddle]:   'WATERMIDDLE',
  [TileType.WaterDeep]:     'WATERDEEP',
  [TileType.Cliff]:         'CLIFF',
  [TileType.Tree]:          'WOODS',
  [TileType.Flower]:        'BRUSH',
  [TileType.Rock]:          'ROCK',
  [TileType.Marsh]:         'MARSH',
  [TileType.Overgrowth]:    'OVERGROWTH',
  [TileType.FirmFairway]:   'FIRMFAIRWAY',
  [TileType.ZenSand]:       'ZENSAND',
  [TileType.TrickyGreen]:   'TRICKYGREEN',
  [TileType.PotSandBunker]: 'POTSANDBUNKER',
};

const TYPE_FOLDER: Record<number, string> = {
  [TileType.Rough]:         'rough',
  [TileType.DeepRough]:     'deeprough',
  [TileType.Fairway]:       'fairway',
  [TileType.PuttingGreen]:  'puttinggreen',
  [TileType.SandBunker]:    'sandbunker',
  [TileType.Tee]:           'tee',
  [TileType.GrassySand]:    'grassysand',
  [TileType.GrassBunker]:   'grassbunker',
  [TileType.WaterShallow]:  'watershallow',
  [TileType.WaterMiddle]:   'watermiddle',
  [TileType.WaterDeep]:     'waterdeep',
  [TileType.Cliff]:         'cliff',
  [TileType.Tree]:          'woods',
  [TileType.Flower]:        'brush',
  [TileType.Rock]:          'rock',
  [TileType.Marsh]:         'marsh',
  [TileType.Overgrowth]:    'overgrowth',
  [TileType.FirmFairway]:   'firmfairway',
  [TileType.ZenSand]:       'zensand',
  [TileType.TrickyGreen]:   'trickygreen',
  [TileType.PotSandBunker]: 'sandbunker',
};

// ── Types qui utilisent le suffixe A-D comme ORIENTATION (bordures) ──
// Les bordures N→A, E→B, S→C, O→D
const BORDER_TYPES = new Set([
  TileType.GrassySand, TileType.GrassBunker,
  TileType.WaterShallow, TileType.WaterMiddle, TileType.WaterDeep,
  TileType.Cliff, TileType.Overgrowth, TileType.Ravine, TileType.Marsh,
]);

// ── Types qui utilisent le suffixe A-E comme GÉOMÉTRIE ──
const GEOM_TYPES = new Set([
  TileType.Rough, TileType.DeepRough, TileType.Tree, TileType.Flower,
  TileType.Rock, TileType.Brush, TileType.Natural, TileType.Overgrowth,
  TileType.Marsh,
]);

// ── Suffixes d'orientation par direction ──
const ORIENT_TO_SUFFIX = ['A', 'B', 'C', 'D'];  // N→A, E→B, S→C, W→D
const GEOM_SUFFIXES = ['A', 'B', 'C', 'D', 'E'];

// ── Constantes de la table 3D ──
const STRIDE_TYPE      = 4;       // bytes par type
const STRIDE_VARIATION = 0x24;    // 36 bytes (9 types × 4)
const STRIDE_ORIENT    = 900;     // 225 types × 4
const TABLE_OFFSET     = 0x1b;    // +27 slots d'orientation
const SPECIAL_SLOT_DIRT = 0x20;   // slot spécial pour texture de chemin/dirt
const SPECIAL_SLOT_PATH = 0x21;   // slot spécial pour texture de path

/**
 * TextureTable3D — Port de DAT_100687f8
 *
 * Gère une table de textures indexée par (type, variation, orientation)
 * avec le décalage +27 et les slots spéciaux.
 */
export class TextureTable3D {
  private cache = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private theme: string;

  constructor(theme: string = 'parkland') {
    this.theme = theme;
  }

  setTheme(theme: string): void {
    this.theme = theme;
  }

  // ── API publique ──

  /**
   * getTexture — Récupère une texture depuis la table 3D.
   * Équivalent du calcul d'index dans FUN_1000e6c0 lignes 44-46.
   *
   * @param type       TileType (terrainType byte)
   * @param variation  Index de variation cosmétique (0..N)
   * @param orientation Index d'orientation (0-3 pour A-D)
   * @returns Texture Three.js (chargée ou en cache)
   */
  getTexture(type: TileType, variation: number, orientation: number): THREE.Texture | null {
    const key = this.tableIndex(type, variation, orientation);
    return this.loadTexture(key);
  }

  /**
   * getTextureByKey — Récupère une texture par clé directe.
   * Utilisé par le renderer après avoir pré-calculé la clé.
   */
  getTextureByKey(key: string): THREE.Texture | null {
    return this.loadTexture(key);
  }

  /**
   * getSpecialTexture — Récupère une texture depuis un slot spécial.
   * Utilisé par les overlays de FUN_100108f0.
   *
   * @param slot 0x20 = dirt, 0x21 = path
   */
  getSpecialTexture(slot: number): THREE.Texture | null {
    const specials: Record<number, string> = {
      [SPECIAL_SLOT_DIRT]: 'path',
      [SPECIAL_SLOT_PATH]: 'pathx',
    };
    const name = specials[slot];
    if (!name) return null;
    const key = `special:${name}`;

    if (!this.cache.has(key)) {
      const path = `/assets/textures/special/${name}.webp`;
      const tex = this.loader.load(path);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.cache.set(key, tex);
    }
    return this.cache.get(key)!;
  }

  /**
   * computeKey — Calcule la clé de texture pour une passe de rendu.
   * C'est l'équivalent du pré-calcul (tile+pass*0x38+0x6c).
   */
  computeKey(type: TileType, variation: number, suffix: string): string {
    return `${type}:${variation}:${suffix}`;
  }

  /**
   * resolveDynamicTexture — Calcule la texture dynamique quand
   * DAT_10070a14 != 0 et que le type est un type à réflexion (eau).
   *
   * Formule exacte du jeu original :
   *   orientation = (tileFlags & 3) - DAT_10070a14
   *   if (orientation < 0) orientation += 4
   *   index = type*4 + variation*36 + (orient+27)*900
   */
  resolveDynamicTexture(
    type: TileType,
    variation: number,
    tileOrientation: number,
    viewMode: number,
  ): THREE.Texture | null {
    let orient = tileOrientation - viewMode;
    if (orient < 0) orient += 4;
    return this.getTexture(type, variation, orient);
  }

  // ── Construction de la table ──

  /**
   * buildPath — Construit le chemin de fichier pour une texture.
   * Cette fonction remplace texturePathForPass() du code actuel.
   */
  buildPath(type: TileType, variation: number, suffix: string, subType?: number): string | null {
    const prefix = TYPE_PREFIX[type];
    const folder = TYPE_FOLDER[type];
    if (!prefix || !folder) return null;

    // SandBunker : préfixe numérique optionnel
    const subPrefix = (type === TileType.SandBunker && subType && subType > 0)
      ? `${subType}`
      : '';

    const varStr = String(variation + 1).padStart(4, '0');
    return `/assets/textures/${this.theme}/${folder}/${prefix}${subPrefix}${suffix}${varStr}.webp`;
  }

  /**
   * preloadTile — Pré-calcule la clé de texture pour une tuile
   * et la stocke dans ses passes de rendu.
   */
  preloadTile(type: TileType, variation: number, suffix: string, subType?: number): string | null {
    const path = this.buildPath(type, variation, suffix, subType);
    if (!path) return null;
    const key = this.computeKey(type, variation, suffix);
    // On ne charge pas la texture ici — le ThreeLoader le fera à la demande
    // L'important est d'avoir la clé pour le tri par texture
    return key;
  }

  // ── Helpers ──

  /**
   * tableIndex — Calcule l'index dans le tableau 3D.
   * Formule exacte : type*4 + variation*36 + (orientation+27)*900
   */
  private tableIndex(type: number, variation: number, orientation: number): string {
    // Le type doit être dans [0, 224], la variation dans [0, 8]
    const t = type & 0xFF; // byte
    const v = variation % 9;
    const o = (orientation % 4) + TABLE_OFFSET;
    const byteOffset = t * STRIDE_TYPE + v * STRIDE_VARIATION + o * STRIDE_ORIENT;
    return `t3d:${byteOffset}`;
  }

  /**
   * loadTexture — Charge ou retourne une texture mise en cache.
   */
  private loadTexture(key: string): THREE.Texture | null {
    if (this.cache.has(key)) return this.cache.get(key)!;

    // Construire le chemin depuis la clé
    // Format : "type:variation:suffix" pour les clés normales
    //          "t3d:byteOffset" pour les clés table 3D
    //          "special:name" pour les textures spéciales
    if (key.startsWith('t3d:')) {
      // Table 3D — on ne charge pas directement, on retourne null
      // Le renderer doit utiliser buildPath() pour obtenir le fichier
      return null;
    }

    if (key.startsWith('special:')) {
      // Les textures spéciales sont gérées par getSpecialTexture()
      return null;
    }

    // Clé normale : "type:variation:suffix"
    const parts = key.split(':');
    if (parts.length !== 3) return null;
    const type = parseInt(parts[0], 10);
    const variation = parseInt(parts[1], 10);
    const suffix = parts[2];

    const path = this.buildPath(type, variation, suffix);
    if (!path) return null;

    const tex = this.loader.load(path);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    this.cache.set(key, tex);
    return tex;
  }

  // ── Méthodes utilitaires statiques ──

  /**
   * suffixForOrientation — Retourne le suffixe de fichier pour une orientation.
   * N→A, E→B, S→C, W→D (convention du jeu original)
   */
  static suffixForOrientation(orientation: number): string {
    return ORIENT_TO_SUFFIX[orientation & 3] ?? 'A';
  }

  /**
   * hasBorderOrientation — Vrai si ce type utilise A-D pour l'orientation.
   */
  static hasBorderOrientation(type: TileType): boolean {
    return BORDER_TYPES.has(type);
  }

  /**
   * hasGeomSuffix — Vrai si ce type utilise A-E pour la géométrie.
   */
  static hasGeomSuffix(type: TileType): boolean {
    return GEOM_TYPES.has(type);
  }
}
