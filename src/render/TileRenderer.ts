/**
 * SimGolf Web — Tile Renderer (sprites isométriques purs)
 *
 * Chaque tuile est un Sprite 2D (Phaser Image) clipé en diamant,
 * positionné à sa coordonnée isométrique avec l'élévation du
 * sommet le plus bas comme référence.
 *
 * Aucune transformation affine — les textures du jeu (RoughA-E)
 * sont des sprites pré-rendus : la pente est DANS l'image.
 *
 * L'ancrage setOrigin(0.5, 0.5) centre le diamant sur la position.
 * Le tri painter's algorithm gère le chevauchement : les tuiles
 * avec (x+y+avgHeight) plus grand sont dessinées après.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { mapToScreen, TILE_W, TILE_H, TILE_D } from './CoordinateSystem';
import { getShapeLetter, getCosmeticVariant, buildTextureSourceName } from './ShapeClassifier';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private diamondCache = new Set<string>();
  private showDebug = false;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();

    // 1. Collecter les infos de rendu pour chaque tuile
    interface TileSprite {
      x: number; y: number;
      hTL: number; hTR: number; hBR: number; hBL: number;
      avgH: number;
      baseH: number; // hauteur du sommet le plus bas (référence d'ancrage)
      sourceKey: string;
      scrX: number; scrY: number;
    }

    const origin = mapToScreen(0, 0);
    const sprites: TileSprite[] = [];

    for (const { x, y } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
      const avgH = (hTL + hTR + hBR + hBL) / 4;
      const baseH = Math.min(hTL, hTR, hBR, hBL);

      const letter = getShapeLetter(hTL, hTR, hBR, hBL);
      const variant = getCosmeticVariant(x, y, 9);
      const sourceKey = buildTextureSourceName('Rough', letter, variant);

      // Position à l'écran : grille (x,y) + hauteur de référence (le point le plus bas)
      const pos = mapToScreen(x, y, 0);
      const scrX = pos.screenX - origin.screenX;
      const scrY = pos.screenY - origin.screenY - baseH * TILE_D;

      sprites.push({ x, y, hTL, hTR, hBR, hBL, avgH, baseH, sourceKey, scrX, scrY });
    }

    // 2. Tri painter's algorithm : arrière (petit x+y+avgH) → avant (grand)
    sprites.sort((a, b) => {
      const da = a.x + a.y + a.avgH;
      const db = b.x + b.y + b.avgH;
      if (da !== db) return da - db;
      return a.x - b.x;
    });

    // 3. Créer chaque sprite
    for (const s of sprites) {
      const texKey = this.getOrCreateDiamond(s.sourceKey);
      if (!texKey) continue;

      const img = this.scene.add.image(s.scrX, s.scrY, texKey);
      img.setOrigin(0.5, 0.5);
      img.setDepth((s.x + s.y) * 16 + Math.round(s.avgH) * 10);
      img.setName(`tile_${s.x}_${s.y}`);
      this.tileImages.push(img);

      // Debug
      if (this.showDebug) {
        const lbl = this.scene.add.text(s.scrX, s.scrY + 2, s.sourceKey, {
          fontFamily: 'monospace', fontSize: '8px', color: '#ffcc00',
          backgroundColor: 'rgba(0,0,0,0.6)', padding: { x: 2, y: 1 },
        });
        lbl.setOrigin(0.5, 0.5);
        lbl.setDepth((s.x + s.y) * 16 + Math.round(s.avgH) * 10 + 5);
        this.tileImages.push(lbl as unknown as Phaser.GameObjects.Image);
      }
    }
  }

  // ================================================================
  // Texture diamant clipée
  // ================================================================

  /**
   * Crée une texture diamant isométrique (64×32) depuis la texture
   * source carrée du jeu (64×64). Le résultat est un canvas où
   * seuls les pixels dans le diamant central sont conservés.
   * Tout sprite, qu'il soit plat (A) ou pentu (B-E), est clipé
   * exactement de la même manière → le point d'ancrage est identique.
   */
  private getOrCreateDiamond(sourceKey: string): string | null {
    const diamondKey = `diamond_${sourceKey}`;

    if (this.diamondCache.has(sourceKey) || this.scene.textures.exists(diamondKey)) {
      this.diamondCache.add(sourceKey);
      return diamondKey;
    }

    if (!this.scene.textures.exists(sourceKey)) return null;

    const src = this.scene.textures.get(sourceKey).getSourceImage() as CanvasImageSource;
    if (!src) return null;

    // Canvas du diamant : 68×36 (64×32 + 2px marge)
    const margin = 2;
    const cw = TILE_W + margin * 2;  // 68
    const ch = TILE_H + margin * 2;  // 36
    const canvas = this.scene.textures.createCanvas(diamondKey, cw, ch);
    if (!canvas) return null;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, cw, ch);

    const cx = cw / 2;   // 34 — centre du diamant
    const cy = ch / 2;   // 18
    const hw = TILE_W / 2;  // 32 — demi-largeur
    const hh = TILE_H / 2;  // 16 — demi-hauteur

    // Clip en diamant
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); // haut
    ctx.lineTo(cx + hw, cy); // droite
    ctx.lineTo(cx, cy + hh); // bas
    ctx.lineTo(cx - hw, cy); // gauche
    ctx.closePath();
    ctx.clip();

    // Texture source centrée — le centre (32,32) de l'image 64×64
    // coïncide avec le centre (34,18) du diamant clipé
    ctx.drawImage(src, cx - 32, cy - 32, 64, 64);

    ctx.restore();

    // Bordure subtile
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.stroke();

    canvas.refresh();
    this.diamondCache.add(sourceKey);
    return diamondKey;
  }

  // ================================================================
  // Helpers
  // ================================================================

  clearAll(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
  }
}
