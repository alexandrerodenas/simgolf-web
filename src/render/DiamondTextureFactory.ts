/**
 * DiamondTextureFactory — Crée des textures diamant 64×32 isométriques
 * depuis les textures carrées extraites du jeu SimGolf.
 *
 * Délègue la sélection du sprite exact à TileShapeMapper,
 * qui analyse les 4 hauteurs pour choisir la bonne forme géométrique.
 */

import Phaser from 'phaser';
import { TILE_W, TILE_H } from './CoordinateSystem';
import { selectTileSprite, createTileRng } from './TileShapeMapper';

// ================================================================
// Texture sources (chemins réels vers les fichiers)
// ================================================================

interface TextureEntry {
  /** Nom du type de terrain */
  typeName: string;
  /** Clé source (e.g. 'RoughA0001') */
  srcKey: string;
}

/**
 * Liste des fichiers de texture disponibles.
 * Seules les textures présentes dans public/assets/ sont listées.
 * Pour le thème Parkland : 25 Rough (grass) + 1 Fairway + 1 Green + 1 Sand + 3 eau.
 */
const TEXTURE_SOURCES: TextureEntry[] = [
  // Grass — 25 variantes géométriques
  ...(() => {
    const letters = ['A','B','C','D','E'];
    const names: TextureEntry[] = [];
    for (const letter of letters) {
      for (let i = 1; i <= 5; i++) {
        names.push({
          typeName: 'GRASS',
          srcKey: `Rough${letter}${String(i).padStart(4, '0')}`,
        });
      }
    }
    return names;
  })(),
  // Fairway (1 seule pour l'instant)
  { typeName: 'FAIRWAY', srcKey: 'FairwayA0001' },
  // Green
  { typeName: 'GREEN', srcKey: 'PuttingGreenA0001' },
  // Sand
  { typeName: 'SAND', srcKey: 'SandBunker1A0001' },
  // Water (3 variantes mais on utilise Shallow pour le moment)
  { typeName: 'WATER', srcKey: 'WaterShallowA0001' },
];

/** Cache des sources par type */
const sourcesByType = new Map<string, string[]>();
for (const entry of TEXTURE_SOURCES) {
  if (!sourcesByType.has(entry.typeName)) {
    sourcesByType.set(entry.typeName, []);
  }
  sourcesByType.get(entry.typeName)!.push(entry.srcKey);
}

/** Toutes les clés sources uniques */
export function getAllSourceKeys(): string[] {
  return [...new Set(TEXTURE_SOURCES.map(e => e.srcKey))];
}

/** Noms sources pour un type */
function getSourceNames(typeName: string): string[] {
  return sourcesByType.get(typeName) ?? sourcesByType.get('GRASS')!;
}

// ================================================================
// Factory
// ================================================================

export class DiamondTextureFactory {
  private scene: Phaser.Scene;
  private ready = false;
  private rng: () => number;

  constructor(scene: Phaser.Scene, seed = 42) {
    this.scene = scene;
    this.rng = createTileRng(seed);
  }

  init(): void {
    if (this.ready) return;

    let created = 0;
    for (const entry of TEXTURE_SOURCES) {
      const diamondKey = `diamond_${entry.srcKey}`;
      if (this.scene.textures.exists(diamondKey)) continue;
      if (!this.scene.textures.exists(entry.srcKey)) continue;
      this.createDiamondFromSource(entry.srcKey, diamondKey);
      created++;
    }

    // Texture DIRT
    if (!this.scene.textures.exists('diamond_DIRT')) {
      this.createDirtDiamond('diamond_DIRT');
      created++;
    }

    this.ready = true;
    console.log(`[DiamondTextureFactory] ${created} textures diamant créées`);
  }

  /**
   * Sélectionne la texture pour une tuile selon ses 4 hauteurs.
   * Utilise le TileShapeMapper pour la forme géométrique exacte.
   */
  getTextureKey(
    hTL: number, hTR: number, hBR: number, hBL: number,
    typeName: string,
  ): string {
    const selector = selectTileSprite(hTL, hTR, hBR, hBL, typeName, this.rng);

    // Vérifier que la texture existe
    if (this.scene.textures.exists(selector.textureKey)) {
      return selector.textureKey;
    }

    // Fallback : première texture dispo pour ce type
    for (const srcKey of getSourceNames(typeName)) {
      const key = `diamond_${srcKey}`;
      if (this.scene.textures.exists(key)) return key;
    }

    // Fallback ultime
    return 'diamond_RoughA0001';
  }

  // ================================================================
  // Création de texture diamant
  // ================================================================

  private createDiamondFromSource(srcKey: string, outKey: string): void {
    const srcTex = this.scene.textures.get(srcKey);
    const srcImg = srcTex.getSourceImage() as HTMLImageElement;

    if (!srcImg) {
      console.warn(`[DiamondTextureFactory] Source manquante: ${srcKey}`);
      return;
    }

    const margin = 2;
    const canvasW = TILE_W + margin * 2;
    const canvasH = TILE_H + margin * 2;
    const canvas = this.scene.textures.createCanvas(outKey, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    ctx.save();

    // Clip en diamant
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.clip();

    // Texture source centrée
    ctx.drawImage(srcImg, cx - 32, cy - 32, 64, 64);

    ctx.restore();

    // Bordure subtile
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.stroke();

    canvas.refresh();
  }

  private createDirtDiamond(key: string): void {
    const margin = 2;
    const canvasW = TILE_W + margin * 2;
    const canvasH = TILE_H + margin * 2;
    const canvas = this.scene.textures.createCanvas(key, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#6B5335';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.stroke();

    canvas.refresh();
  }
}
