/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain généré par TerrainGenerator (guide RE Parkland).
 * Arbres FLC animés placés sur des tuiles GRASS choisies.
 * Navigation : drag scroll + zoom molette.
 * Debug : touche [D] → labels de texture.
 */

import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { TileType } from '../core/types';
import { MAP_SIZE } from '../config';
import { IsometricRenderer } from '../render';
import { mapToScreen } from '../render/CoordinateSystem';
import {
  calculateTransitionBitmask,
  getTransitionTextureKey,
} from '../render/TransitionLUT';

interface TreeDef {
  atlasKey: string;
  tileX: number;
  tileY: number;
  groundOriginY: number;
}

const TREE_ATLASES: { atlasKey: string; groundOriginY: number }[] = [
  { atlasKey: 'flic_willow', groundOriginY: 56 / 78 },
  { atlasKey: 'flic_maple',  groundOriginY: 63 / 76 },
];

export class GameScene extends Phaser.Scene {
  private isoRenderer!: IsometricRenderer;
  private debugLabels: Phaser.GameObjects.Text[] = [];
  private showDebug = false;
  private terrain!: TerrainEngine;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    this.terrain = terrain;
    const gen = new TerrainGenerator();
    gen.generateNatural(terrain);

    this.isoRenderer = new IsometricRenderer(this, terrain, {
      zoom: 1,
      enableDrag: true,
    });
    this.isoRenderer.init();

    // ── Arbres FLC sur des tuiles GRASS ──
    const grassTiles = this.findTilesOfType(terrain, TileType.GRASS);
    const shuffled = [...grassTiles].sort((a, b) => {
      return (a.x * 73 + a.y * 37) % 65536 - (b.x * 73 + b.y * 37) % 65536;
    });

    const placedTrees: TreeDef[] = [];
    for (let i = 0; i < Math.min(TREE_ATLASES.length, shuffled.length); i++) {
      const tile = shuffled[i];

      // Convertir la tuile en TREE (Woods) pour le sol forestier
      const hash = (tile.x * 73 + tile.y * 37 + 42) & 0x7fffffff;
      terrain.setTileType(tile.x, tile.y, TileType.TREE, (hash % 36) + 1);

      // Voisins en ROUGH (lisière)
      this.setNeighborRough(terrain, tile.x - 1, tile.y);
      this.setNeighborRough(terrain, tile.x + 1, tile.y);
      this.setNeighborRough(terrain, tile.x, tile.y - 1);
      this.setNeighborRough(terrain, tile.x, tile.y + 1);

      placedTrees.push({
        atlasKey: TREE_ATLASES[i].atlasKey,
        tileX: tile.x,
        tileY: tile.y,
        groundOriginY: TREE_ATLASES[i].groundOriginY,
      });
    }

    // Re-rendre après modifications
    this.isoRenderer.fullRender();

    for (const t of placedTrees) {
      this.spawnTree(terrain, t);
    }

    // ── Debug : touche D ──
    this.input.keyboard!.on('keydown-D', () => this.toggleDebug(terrain));
    this.createDebugButton();
  }

  private findTilesOfType(terrain: TerrainEngine, type: TileType): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const tile = terrain.tileAt(x, y);
        if (tile && tile.type === type) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  private setNeighborRough(terrain: TerrainEngine, x: number, y: number): void {
    const tile = terrain.tileAt(x, y);
    if (!tile) return;
    if (tile.type === TileType.GRASS || tile.type === TileType.ROUGH) {
      const hash = (x * 17 + y * 31 + 7) & 0x7fffffff;
      terrain.setTileType(x, y, TileType.ROUGH, (hash % 9) + 1);
    }
  }

  update(): void {
    this.isoRenderer.update();
  }

  private spawnTree(terrain: TerrainEngine, def: TreeDef): void {
    const { atlasKey, tileX, tileY, groundOriginY } = def;
    const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(tileX, tileY);
    const hAvg = (hTL + hTR + hBR + hBL) / 4;
    const p = mapToScreen(tileX + 0.5, tileY + 0.5, hAvg);

    const tex = this.textures.get(atlasKey);
    if (!tex || !tex.key) return;

    const frames = tex.getFrameNames();
    if (frames.length === 0) return;

    const img = this.add.image(p.screenX, p.screenY, atlasKey, frames[0]);
    img.setOrigin(0.5, groundOriginY);
    img.setDepth(tileX + tileY + 1);
  }

  private createDebugButton(): void {
    const btn = this.add.text(this.scale.width - 10, 10, '[D]', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#333333cc',
      padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(999).setScrollFactor(0).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.toggleDebug(this.terrain));
  }

  private toggleDebug(terrain: TerrainEngine): void {
    this.showDebug = !this.showDebug;
    for (const lbl of this.debugLabels) lbl.destroy();
    this.debugLabels = [];
    if (!this.showDebug) return;

    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;

        let label = '?';
        if (tile.type === TileType.TREE || tile.type === TileType.ROUGH) {
          const group = ((tile.variation - 1) % 4 + 4) % 4;
          const variation = ((tile.variation - 1) % 9 + 9) % 9 + 1;
          const mask = calculateTransitionBitmask(terrain, x, y, tile.type);
          const prefix = tile.type === TileType.TREE ? 'Woods' : 'Rough';
          const key = getTransitionTextureKey(
            prefix, group, variation, mask,
            (k: string) => this.textures.exists(k),
          );
          const m = key.match(/(WOODS|ROUGH)([A-D])(\d+)/);
          if (m) {
            const typeLabel = tile.type === TileType.TREE ? 'W' : 'R';
            label = `${typeLabel}${m[2]}${parseInt(m[3], 10)}`;
          }
        } else {
          const names: Record<number, string> = {
            [TileType.GRASS]: 'G', [TileType.FAIRWAY]: 'F',
            [TileType.GREEN]: 'GN', [TileType.SAND]: 'S',
            [TileType.WATER]: 'W', [TileType.TEE]: 'T',
            [TileType.ROUGH]: 'R', [TileType.ROCK]: 'K',
            [TileType.TREE]: 'W',
          };
          const ch = names[tile.type] ?? `${tile.type}`;
          label = `${ch}${tile.variation || ''}`;
        }

        const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(x, y);
        const hAvg = (hTL + hTR + hBR + hBL) / 4;
        const pos = mapToScreen(x + 0.5, y + 0.5, hAvg);

        this.add.text(pos.screenX, pos.screenY, label, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2,
        }).setOrigin(0.5, 0.5).setDepth(x + y + 2);
      }
    }
  }
}
