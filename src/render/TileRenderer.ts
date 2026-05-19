/**
 * SimGolf Web — Tile Renderer (textures du jeu + heightmap)
 *
 * Chaque tuile est rendue comme une Image Phaser avec la texture
 * diamant extraite du jeu original. La texture est sélectionnée
 * par le TileShapeMapper en fonction des 4 hauteurs réelles.
 *
 * Mode debug : affiche la variante (A0001, B0003…) au centre
 * de chaque tuile.
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { DiamondTextureFactory } from './DiamondTextureFactory';
import { mapToScreen, TILE_D } from './CoordinateSystem';

// ================================================================
// Mapping TileType → nom de palette pour les textures
// ================================================================

const TYPE_TO_PALETTE: Record<TileType, string> = {
  [TileType.GRASS]:        'GRASS',
  [TileType.FAIRWAY]:      'FAIRWAY',
  [TileType.GREEN]:        'GREEN',
  [TileType.SAND]:         'SAND',
  [TileType.WATER]:        'WATER',
  [TileType.ROUGH]:        'GRASS',
  [TileType.TEE]:          'FAIRWAY',
  [TileType.PATH]:         'GRASS',
  [TileType.BUILDING]:     'GRASS',
  [TileType.TREE]:         'GRASS',
  [TileType.BUSH]:         'GRASS',
  [TileType.FLOWER]:       'GRASS',
  [TileType.BRIDGE]:       'GRASS',
  [TileType.HOLE]:         'GREEN',
  [TileType.WATER_HAZARD]: 'WATER',
  [TileType.EMPTY]:        'GRASS',
};

// ================================================================
// Tile Renderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private diamondFactory: DiamondTextureFactory;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private debugLabels: Phaser.GameObjects.Text[] = [];
  private showDebug = false;

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainEngine,
    diamondFactory: DiamondTextureFactory,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.diamondFactory = diamondFactory;
  }

  /** Active/désactive l'affichage du numéro de variante sur chaque tuile */
  setDebug(active: boolean): void {
    this.showDebug = active;
  }

  isDebug(): boolean {
    return this.showDebug;
  }

  /**
   * Rend toutes les tuiles.
   */
  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();

    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  private renderTile(x: number, y: number, data: TileData): void {
    // 1. Hauteurs des 4 sommets depuis la heightmap
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
    const avgH = Math.round((hTL + hTR + hBR + hBL) / 4);

    // 2. Sélection du sprite géométrique exact (déterministe par position)
    const paletteName = TYPE_TO_PALETTE[data.type] ?? 'GRASS';
    const textureKey = this.diamondFactory.getTextureKey(
      hTL, hTR, hBR, hBL, paletteName, x, y,
    );

    // 3. Position écran
    const origin = mapToScreen(0, 0);
    const { screenX, screenY } = mapToScreen(x, y, 0);
    const sx = screenX - origin.screenX;
    const sy = screenY - origin.screenY - avgH * TILE_D;

    // 4. Image de la tuile
    const img = this.scene.add.image(sx, sy, textureKey);
    img.setOrigin(0.5, 0.5);
    img.setDepth(this.computeDepth(x, y, avgH));
    img.setName(`tile_${x}_${y}`);
    this.tileImages.push(img);

    // 5. Debug : numéro de variante au centre
    if (this.showDebug) {
      const variant = this.extractVariant(textureKey);
      const txt = this.scene.add.text(sx, sy, variant, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      });
      txt.setOrigin(0.5, 0.5);
      txt.setDepth(this.computeDepth(x, y, avgH) + 1);
      txt.setName(`debug_${x}_${y}`);
      this.debugLabels.push(txt);
    }
  }

  /**
   * Extrait le numéro de variante (ex: B0003) depuis une clé de texture.
   */
  private extractVariant(textureKey: string): string {
    // textureKey = "diamond_RoughB0003" → "B0003"
    const match = textureKey.match(/[A-E]\d{4}/);
    return match ? match[0] : '?';
  }

  private computeDepth(x: number, y: number, avgH: number): number {
    return (x + y) * 16 + avgH * 10;
  }

  clearAll(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];

    for (const txt of this.debugLabels) txt.destroy();
    this.debugLabels = [];
  }
}
