/**
 * SimGolf Web — Tile Renderer (texturé)
 *
 * Chaque tuile est rendue comme une Image Phaser utilisant une
 * texture pré-calculée où l'herbe du jeu est mappée sur le
 * quadrilatère exact formé par les 4 sommets à leurs hauteurs
 * réelles — via 2 triangles affines (Canvas 2D).
 *
 * Le rendu est continu, sans escalier, sans diagonale visible.
 *
 * Les textures sont générées une fois par forme géométrique
 * unique (~20 formes) par SlopedTextureGenerator.
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { SlopedTextureGenerator } from './SlopedTextureGenerator';
import { mapToScreen, TILE_D } from './CoordinateSystem';

// ================================================================
// Tile Renderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private textureGen: SlopedTextureGenerator;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private showDebug = false;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
    this.textureGen = new SlopedTextureGenerator(scene, 'RoughA0001');
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();
    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  // ================================================================
  // Rendu d'une tuile
  // ================================================================

  private renderTile(x: number, y: number, _data: TileData): void {
    // 1. Hauteurs des 4 sommets (heightmap → continuité)
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

    // 2. Positions écran des 4 sommets
    const origin = mapToScreen(0, 0);
    const v = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    const tl = v(x,     y,     hTL);
    const tr = v(x + 1, y,     hTR);
    const br = v(x + 1, y + 1, hBR);
    const bl = v(x,     y + 1, hBL);

    // 3. Centre géométrique de la tuile
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // 4. Profondeur painter's
    const avgH = (hTL + hTR + hBR + hBL) / 4;
    const depth = (x + y) * 16 + Math.round(avgH) * 10;

    // 5. Texture pré-calculée pour cette forme
    const texKey = this.textureGen.getTextureKey(hTL, hTR, hBR, hBL);

    // 6. Image texturée
    const img = this.scene.add.image(cx, cy, texKey);
    img.setOrigin(0.5, 0.5);
    img.setDepth(depth);
    img.setName(`tile_${x}_${y}`);
    this.tileImages.push(img);
  }

  // ================================================================
  // Nettoyage
  // ================================================================

  clearAll(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
  }
}
