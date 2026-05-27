/**
 * lighting/types.ts — Types et interfaces pour le système d'éclairage
 */

export enum LightingMode {
  /** Shadow Mask basique — haute perf, pas de lumière dynamique */
  Basic = 'basic',
  /** Mesh & Ambient avancé — flood/raycast + height map */
  Advanced = 'advanced',
}

/** Source lumineuse de base */
export interface ILightSource {
  id: string;
  /** Position dans le monde (gridToWorld) */
  worldX: number;
  worldY: number;
  worldZ: number;
  /** Position grille de la tuile source */
  tileX: number;
  tileY: number;
  /** Intensité 0-1 */
  intensity: number;
  /** Couleur RGBA */
  color: [number, number, number, number];
  /** Rayon d'influence en tuiles */
  radius: number;
}

/** Flood Light — propagation 8 directions */
export interface IFloodLight extends ILightSource {
  type: 'flood';
  /** Distance max en tuiles */
  maxDistance: number;
  /** Perte d'intensité par tuile traversée (0-1) */
  falloff: number;
}

/** Raycast Light — rayons circulaires */
export interface IRaycastLight extends ILightSource {
  type: 'raycast';
  /** Nombre de rayons (précision angulaire) */
  rayCount: number;
  /** Résolution angulaire en degrés */
  angleStep: number;
}

/** Advanced Raycast — rayons vers les sommets du terrain */
export interface IAdvancedRaycastLight extends ILightSource {
  type: 'advanced-raycast';
  /** Nombre de rayons par coin de tuile */
  rayCount: number;
  /** Hauteur de la source (pour l'angle) */
  height: number;
}

export type LightSource = IFloodLight | IRaycastLight | IAdvancedRaycastLight;

/** Configuration du ShadowMask (mode basic) */
export interface IShadowMaskConfig {
  /** Distance de light bleed en tuiles */
  lightBleedDistance: number;
  /** Taille de la carte en tuiles */
  mapWidth: number;
  mapHeight: number;
}

/** Configuration avancée */
export interface IAdvancedConfig {
  /** Résolution du render target lumière (down scale, puissance de 2) */
  lightResolution: number;
  /** Nombre de passes de flou */
  blurPasses: number;
  /** Taille du kernel de flou (en pixels) */
  blurKernelSize: number;
}

/** Configuration globale */
export interface ILightingConfig {
  mode: LightingMode;
  /** Couleur ambiante par défaut (quand aucune source n'éclaire) */
  ambientColor: [number, number, number, number];
  /** Masque d'ombre */
  shadowMask: IShadowMaskConfig;
  /** Avancé */
  advanced: IAdvancedConfig;
}

export const DEFAULT_LIGHTING_CONFIG: ILightingConfig = {
  mode: LightingMode.Basic,
  ambientColor: [0.05, 0.05, 0.08, 1.0],
  shadowMask: {
    lightBleedDistance: 2,
    mapWidth: 40,
    mapHeight: 40,
  },
  advanced: {
    lightResolution: 512,
    blurPasses: 3,
    blurKernelSize: 5,
  },
};

/** Données de pixel du shadow mask (0-255, 0=noir) */
export type ShadowMaskData = Uint8Array;

/** Résultat d'un raymarch pour un angle donné */
export interface RaycastHit {
  /** Angle en radians */
  angle: number;
  /** Distance parcourue avant impact (en tuiles) */
  distance: number;
  /** Point d'impact dans le monde */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** Y a-t-il eu un impact ? */
  hit: boolean;
  /** L'impact est-il un coin de tuile ? (advanced raycast) */
  isVertexHit: boolean;
}

/** Sommet de tuile pour l'advanced raycast */
export interface TileVertex {
  /** Position dans la grille */
  tileX: number;
  tileY: number;
  /** Index du coin (0=TL, 1=TR, 2=BR, 3=BL) */
  corner: number;
  /** Position dans le monde */
  worldX: number;
  worldY: number;
  worldZ: number;
}
