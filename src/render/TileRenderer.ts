/**
 * SimGolf Web — Tile Renderer (texturé, classification RE)
 *
 * Pour chaque tuile :
 *   1. Lit les 4 hauteurs (heightmap partagée)
 *   2. Classe la forme A-E (ShapeClassifier)
 *   3. Calcule la variante cosmétique déterministe
 *   4. Construit le nom source (ex: RoughB0003)
 *   5. Génère la texture mappée sur le quad (SlopedTextureGenerator)
 *   6. Affiche en Image Phaser à la bonne position
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { SlopedTextureGenerator } from './SlopedTextureGenerator';
import {
  getShapeLetter,
  getCosmeticVariant,
  buildTextureSourceName,
} from './ShapeClassifier';
import { mapToScreen } from './CoordinateSystem';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private textureGen: SlopedTextureGenerator;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private showDebug = false;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
    this.textureGen = new SlopedTextureGenerator(scene);
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();
    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  private renderTile(x: number, y: number, _data: TileData): void {
    // 1. Hauteurs des 4 sommets (heightmap → continuité)
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

    // 2. Classification A-E + variante cosmétique
    const letter = getShapeLetter(hTL, hTR, hBR, hBL);
    const variant = getCosmeticVariant(x, y, 9);
    const sourceKey = buildTextureSourceName('Rough', letter, variant);

    // 3. Positions écran des 4 sommets
    const origin = mapToScreen(0, 0);
    const v = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    const tl = v(x,     y,     hTL);
    const tr = v(x + 1, y,     hTR);
    const br = v(x + 1, y + 1, hBR);
    const bl = v(x,     y + 1, hBL);

    // 4. Centre géométrique
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // 5. Profondeur painter's
    const avgH = (hTL + hTR + hBR + hBL) / 4;
    const depth = (x + y) * 16 + Math.round(avgH) * 10;

    // 6. Texture pré-calculée pour cette forme + source
    const texKey = this.textureGen.getTextureKey(sourceKey, hTL, hTR, hBR, hBL);

    // 7. Image — position arrondie anti-sub-pixel
    const img = this.scene.add.image(Math.round(cx), Math.round(cy), texKey);
    img.setOrigin(0.5, 0.5);
    img.setDepth(depth);
    img.setName(`tile_${x}_${y}`);
    this.tileImages.push(img);
  }

  clearAll(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
  }
}
