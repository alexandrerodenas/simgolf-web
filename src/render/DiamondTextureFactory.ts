/**
 * DiamondTextureFactory — Crée des textures diamant 64×32 isométriques
 * depuis les textures carrées 64×64 extraites du jeu SimGolf.
 *
 * Chaque texture source est clippée en diamant pour le rendu isométrique.
 * 5 variantes de grass (Rough), 1 fairway, 1 green, 1 sable, 1 eau.
 */

import Phaser from 'phaser';
import { TILE_W, TILE_H } from './CoordinateSystem';

// Mapping TileType → textures à charger
const TEXTURE_MAP: Record<string, string[]> = {
  GRASS: [
    'RoughA0001', 'RoughA0002', 'RoughA0003', 'RoughA0004', 'RoughA0005',
    'RoughB0001', 'RoughB0002', 'RoughB0003', 'RoughB0004', 'RoughB0005',
    'RoughC0001', 'RoughC0002', 'RoughC0003', 'RoughC0004', 'RoughC0005',
    'RoughD0001', 'RoughD0002', 'RoughD0003', 'RoughD0004', 'RoughD0005',
    'RoughE0001', 'RoughE0002', 'RoughE0003', 'RoughE0004', 'RoughE0005',
  ],
  FAIRWAY: ['FairwayA0001'],
  GREEN: ['PuttingGreenA0001'],
  SAND: ['SandBunker1A0001'],
  WATER: ['WaterShallowA0001'],
};

// Toutes les clés de texture source
export function getAllSourceKeys(): string[] {
  const keys = new Set<string>();
  for (const variants of Object.values(TEXTURE_MAP)) {
    for (const v of variants) keys.add(v);
  }
  return [...keys];
}

// Cache les clés de texture diamant générées
const diamondKeyCache = new Map<string, string>();

export class DiamondTextureFactory {
  private scene: Phaser.Scene;
  private ready = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  init(): void {
    if (this.ready) return;
    this.ready = true;

    // Pour chaque source, créer une texture diamant
    for (const [typeName, variants] of Object.entries(TEXTURE_MAP)) {
      for (const srcKey of variants) {
        const diamondKey = `diamond_${srcKey}`;
        if (this.scene.textures.exists(diamondKey)) continue;
        this.createDiamondFromSource(srcKey, diamondKey);
      }
    }

    // Texture DIRT (souterrain) — flat diamond basique
    if (!this.scene.textures.exists('diamond_DIRT')) {
      this.createDirtDiamond('diamond_DIRT');
    }
  }

  /**
   * Retourne la clé de texture diamant pour un type et une variation.
   */
  getDiamondKey(typeName: string, variation: number): string {
    const variants = TEXTURE_MAP[typeName];
    if (!variants || variants.length === 0) {
      // Fallback sur la première texture grass
      return 'diamond_RoughA0001';
    }
    const idx = variation % variants.length;
    return `diamond_${variants[idx]}`;
  }

  /**
   * Crée une texture diamant 64×32 depuis une texture source 64×64.
   */
  private createDiamondFromSource(srcKey: string, outKey: string): void {
    const srcTex = this.scene.textures.get(srcKey);
    const srcImg = srcTex.getSourceImage() as HTMLImageElement;

    if (!srcImg) {
      console.warn(`[DiamondTextureFactory] Source manquante: ${srcKey}`);
      return;
    }

    const margin = 2;
    const canvasW = TILE_W + margin * 2;   // 68
    const canvasH = TILE_H + margin * 2;   // 36
    const canvas = this.scene.textures.createCanvas(outKey, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const hw = TILE_W / 2;  // 32
    const hh = TILE_H / 2;  // 16

    ctx.save();

    // Clip en diamant
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);       // haut
    ctx.lineTo(cx + hw, cy);       // droite
    ctx.lineTo(cx, cy + hh);       // bas
    ctx.lineTo(cx - hw, cy);       // gauche
    ctx.closePath();
    ctx.clip();

    // Dessiner la texture source centrée
    // La source fait 64×64, on centre pour voir la partie milieu
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
    diamondKeyCache.set(outKey, outKey);

    console.log(`[DiamondTextureFactory] ${outKey} (${canvasW}×${canvasH})`);
  }

  /**
   * Crée une texture diamant DIRT (couleur terre).
   */
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
