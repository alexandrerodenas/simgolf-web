/**
 * SimGolf Web — Tile Renderer
 *
 * Chaque tuile est rendue comme une Image Phaser positionnée
 * au centre géométrique de la tuile (pas au TL vertex).
 *
 * Pour les tuiles pentues, un polygone de fond (Graphics) remplit
 * l'espace entre les 4 sommets réels — la flat diamond ne couvre
 * pas toujours toute la surface.
 *
 * Mode debug : affiche le code variante (A0001, B0003…) au centre.
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { DiamondTextureFactory } from './DiamondTextureFactory';
import { mapToScreen, TILE_D, TILE_H } from './CoordinateSystem';

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
  private fillGraphics: Phaser.GameObjects.Graphics[] = [];
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

  setDebug(active: boolean): void {
    this.showDebug = active;
  }

  isDebug(): boolean {
    return this.showDebug;
  }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();
    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  private renderTile(x: number, y: number, data: TileData): void {
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
    const avgH = Math.round((hTL + hTR + hBR + hBL) / 4);

    // Palette
    const paletteName = TYPE_TO_PALETTE[data.type] ?? 'GRASS';
    const textureKey = this.diamondFactory.getTextureKey(
      hTL, hTR, hBR, hBL, paletteName, x, y,
    );

    // === Positions écran ===
    const origin = mapToScreen(0, 0);
    const rel = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    // 4 sommets de la tuile à leurs hauteurs réelles
    const tl = rel(x,     y,     hTL);
    const tr = rel(x + 1, y,     hTR);
    const br = rel(x + 1, y + 1, hBR);
    const bl = rel(x,     y + 1, hBL);

    // Centre géométrique de la tuile (moyenne des 4 coins)
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // Profondeur painter's
    const depth = (x + y) * 16 + avgH * 10;

    // === Polygone de fond (comble les vides sur les pentes) ===
    const gfx = this.scene.add.graphics();
    gfx.fillStyle(0x3a7d3a, 1); // vert herbe moyen
    gfx.beginPath();
    gfx.moveTo(tl.x, tl.y);
    gfx.lineTo(tr.x, tr.y);
    gfx.lineTo(br.x, br.y);
    gfx.lineTo(bl.x, bl.y);
    gfx.closePath();
    gfx.fillPath();
    gfx.setDepth(depth - 1);
    gfx.setName(`fill_${x}_${y}`);
    this.fillGraphics.push(gfx);

    // === Image de la tuile (flat diamond texture) ===
    const img = this.scene.add.image(cx, cy, textureKey);
    img.setOrigin(0.5, 0.5);
    img.setDepth(depth);
    img.setName(`tile_${x}_${y}`);
    this.tileImages.push(img);

    // === Debug : code variante ===
    if (this.showDebug) {
      const variant = this.extractVariant(textureKey);
      const txt = this.scene.add.text(cx, cy, variant, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      });
      txt.setOrigin(0.5, 0.5);
      txt.setDepth(depth + 1);
      txt.setName(`debug_${x}_${y}`);
      this.debugLabels.push(txt);
    }
  }

  private extractVariant(textureKey: string): string {
    const match = textureKey.match(/[A-E]\d{4}/);
    return match ? match[0] : '?';
  }

  clearAll(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];

    for (const txt of this.debugLabels) txt.destroy();
    this.debugLabels = [];

    for (const gfx of this.fillGraphics) gfx.destroy();
    this.fillGraphics = [];
  }
}
