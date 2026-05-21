/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 16×16 en quadrilatères isométriques 2D.
 * Chaque tuile est projetée depuis ses 4 hauteurs de coin.
 * Arbres FLC animés placés sur les tuiles TREE (Woods) générées.
 * Navigation : drag scroll + zoom molette.
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
  /** Position Y de la ligne de sol dans l'image (0=top, 1=bottom) */
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

    // ── Arbres FLC sur les tuiles TREE (Woods) ──
    // Le TerrainGenerator a déjà placé des tuiles TREE (~8% de l'herbe).
    // On associe chaque arbre FLC à une tuile TREE aléatoire.
    const treeTiles = this.findTreeTiles(terrain);
    const placedTrees = this.placeTreesOnTiles(terrain, treeTiles);

    for (const t of placedTrees) {
      this.spawnTree(terrain, t);
    }

    // ── Debug : touche D → labels de texture ──
    this.input.keyboard!.on('keydown-D', () => {
      this.toggleDebug(terrain);
    });

    // ── Debug : bouton tactile (mobile) ──
    this.createDebugButton();
  }

  /** Trouve les tuiles TREE (Woods) pour y placer des sprites FLC */
  private findTreeTiles(terrain: TerrainEngine): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (tile && tile.type === TileType.TREE) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  /** Associe les sprites FLC aux tuiles TREE disponibles */
  private placeTreesOnTiles(
    terrain: TerrainEngine,
    treeTiles: Array<{ x: number; y: number }>,
  ): TreeDef[] {
    // On mélange les tuiles TREE (déterministe selon position)
    const shuffled = [...treeTiles].sort((a, b) => {
      const ha = (a.x * 73 + a.y * 37) % 65536;
      const hb = (b.x * 73 + b.y * 37) % 65536;
      return ha - hb;
    });

    const placed: TreeDef[] = [];
    const count = Math.min(TREE_ATLASES.length, shuffled.length);

    for (let i = 0; i < count; i++) {
      const tile = shuffled[i];
      // Épaissir le sol autour (voisins → ROUGH pour créer une lisière)
      this.setNeighborRough(terrain, tile.x - 1, tile.y);
      this.setNeighborRough(terrain, tile.x + 1, tile.y);
      this.setNeighborRough(terrain, tile.x, tile.y - 1);
      this.setNeighborRough(terrain, tile.x, tile.y + 1);

      placed.push({
        atlasKey: TREE_ATLASES[i].atlasKey,
        tileX: tile.x,
        tileY: tile.y,
        groundOriginY: TREE_ATLASES[i].groundOriginY,
      });
    }

    return placed;
  }

  /** Passe un voisin en ROUGH si c'est de l'herbe (lisière de forêt) */
  private setNeighborRough(terrain: TerrainEngine, x: number, y: number): void {
    const tile = terrain.tileAt(x, y);
    if (!tile) return;
    if (tile.type === TileType.GRASS) {
      const hash = (x * 17 + y * 31 + 7) & 0x7fffffff;
      const variant = (hash % 9) + 1;
      terrain.setTileType(x, y, TileType.ROUGH, variant);
    }
  }

  update(): void {
    this.isoRenderer.update();
  }

  private spawnTree(
    terrain: TerrainEngine,
    def: TreeDef,
  ): void {
    const { atlasKey, tileX, tileY, groundOriginY } = def;

    const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(tileX, tileY);
    const hAvg = (hTL + hTR + hBR + hBL) / 4;

    const p = mapToScreen(tileX + 0.5, tileY + 0.5, hAvg);

    const tex = this.textures.get(atlasKey);
    if (!tex || !tex.key) {
      console.warn(`[GameScene] Texture ${atlasKey} non trouvée`);
      return;
    }

    const frames = tex.getFrameNames();
    if (frames.length === 0) return;

    const img = this.add.image(p.screenX, p.screenY, atlasKey, frames[0]);
    img.setOrigin(0.5, groundOriginY);
    img.setDepth(tileX + tileY + 1);

    console.log(
      `[GameScene] ${atlasKey} placé sur tuile TREE (${tileX}, ${tileY}) → ` +
      `écran (${p.screenX}, ${p.screenY})`,
    );
  }

  /** Crée le bouton debug tactile (mobile) */
  private createDebugButton(): void {
    const btn = this.add.text(this.scale.width - 10, 10, '[D]', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#333333cc',
      padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(999).setScrollFactor(0).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      this.toggleDebug(this.terrain);
    });
  }

  /** Bascule l'affichage des labels de debug (touche D) */
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
          const mask = this.calculateBitmask(terrain, x, y, tile.type);
          const prefix = tile.type === TileType.TREE ? 'Woods' : 'Rough';
          const key = getTransitionTextureKey(
            prefix, group, variation, mask,
            (k: string) => this.textures.exists(k),
          );
          const m = key.match(/(WOODS|ROUGH)([A-D])(\d+)/);
          if (m) label = this.shortenType(tile.type) + `${m[2]}${parseInt(m[3], 10)}`;
        } else if (tile.type === TileType.GRASS) {
          label = `G${tile.variation || ''}`;
        } else {
          const typeNames: Record<number, string> = {
            [TileType.GRASS]: 'G', [TileType.FAIRWAY]: 'F',
            [TileType.GREEN]: 'GN', [TileType.SAND]: 'S',
            [TileType.WATER]: 'W', [TileType.PATH]: 'P',
            [TileType.TEE]: 'T', [TileType.ROUGH]: 'R',
            [TileType.ROCK]: 'K', [TileType.TREE]: 'W',
            [TileType.FLOWER]: 'FL',
          };
          const ch = typeNames[tile.type] ?? `${tile.type}`;
          label = `${ch}${tile.variation || ''}`;
        }

        const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(x, y);
        const hAvg = (hTL + hTR + hBR + hBL) / 4;
        const pos = mapToScreen(x + 0.5, y + 0.5, hAvg);

        const txt = this.add.text(pos.screenX, pos.screenY, label, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2,
        }).setOrigin(0.5, 0.5).setDepth(x + y + 2);

        this.debugLabels.push(txt);
      }
    }
  }

  private shortenType(type: TileType): string {
    const map: Record<number, string> = {
      [TileType.TREE]: 'W', [TileType.ROUGH]: 'R',
    };
    return map[type] ?? '?';
  }

  /** Calcule le bitmask 8-way (délègue à TransitionLUT) */
  private calculateBitmask(
    terrain: TerrainEngine,
    x: number, y: number,
    tileType: TileType,
  ): number {
    return calculateTransitionBitmask(terrain, x, y, tileType);
  }
}
