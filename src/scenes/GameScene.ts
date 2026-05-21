/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 16×16 en quadrilatères isométriques 2D.
 * Chaque tuile est projetée depuis ses 4 hauteurs de coin.
 * Arbres FLC animés placés sur la carte.
 * Navigation : drag scroll + zoom molette.
 */

import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { TileType } from '../core/types';
import { MAP_SIZE } from '../config';
import { IsometricRenderer } from '../render';
import { mapToScreen } from '../render/CoordinateSystem';

interface TreeDef {
  atlasKey: string;
  tileX: number;
  tileY: number;
  /** Position Y de la ligne de sol dans l'image (0=top, 1=bottom) */
  groundOriginY: number;
}

const TREES: TreeDef[] = [
  // WillowTree : 85x78, sol à y=56/78
  { atlasKey: 'flic_willow', tileX: 8, tileY: 8, groundOriginY: 56 / 78 },
  // TreeMapleMedium : 59x76, sol à y=63/76
  { atlasKey: 'flic_maple',  tileX: 6, tileY: 7, groundOriginY: 63 / 76 },
];

export class GameScene extends Phaser.Scene {
  private isoRenderer!: IsometricRenderer;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(terrain);

    // ── Chercher des tuiles plates pour les arbres ──
    const flatTiles = this.findFlatTiles(terrain);

    if (flatTiles.length === 0) {
      console.warn('[GameScene] Aucune tuile plate trouvée pour les arbres');
    }

    // Associer chaque arbre à une tuile plate
    const placedTrees: TreeDef[] = [];
    for (let i = 0; i < TREES.length && i < flatTiles.length; i++) {
      const ft = flatTiles[i];
      placedTrees.push({ ...TREES[i], tileX: ft.x, tileY: ft.y });
    }

    // ── Sol Woods sous les arbres (AVANT le rendu) ──
    for (const t of placedTrees) {
      const hash = (t.tileX * 73 + t.tileY * 37 + 42) & 0x7fffffff;
      terrain.setTileType(t.tileX, t.tileY, TileType.TREE, (hash % 36) + 1);
      // Voisins cardinaux → ROUGH (lisière de forêt)
      this.setNeighborRough(terrain, t.tileX - 1, t.tileY);
      this.setNeighborRough(terrain, t.tileX + 1, t.tileY);
      this.setNeighborRough(terrain, t.tileX, t.tileY - 1);
      this.setNeighborRough(terrain, t.tileX, t.tileY + 1);
    }

    this.isoRenderer = new IsometricRenderer(this, terrain, {
      zoom: 1,
      enableDrag: true,
    });
    this.isoRenderer.init();

    // ── Arbres FLC ──
    for (const t of placedTrees) {
      this.spawnTree(terrain, t);
    }
  }

  /** Passe un voisin en ROUGH si c'est de l'herbe (lisière de forêt) */
  private setNeighborRough(terrain: TerrainEngine, x: number, y: number): void {
    const tile = terrain.tileAt(x, y);
    if (!tile) return;
    // Ne change que les tuiles GRASS, pas les ROCK, TREE, WATER etc.
    if (tile.type === TileType.GRASS) {
      const hash = (x * 17 + y * 31 + 7) & 0x7fffffff;
      const variant = (hash % 9) + 1; // 1..9
      terrain.setTileType(x, y, TileType.ROUGH, variant);
    }
  }

  /** Trouve les tuiles plates (4 coins à la même hauteur), non ROCK */
  private findFlatTiles(
    terrain: TerrainEngine,
  ): Array<{ x: number; y: number; height: number }> {
    const tiles: Array<{ x: number; y: number; height: number }> = [];
    for (let y = 1; y < terrain.height - 1; y++) {
      for (let x = 1; x < terrain.width - 1; x++) {
        const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(x, y);
        if (hTL === hTR && hTR === hBR && hBR === hBL) {
          // Pas de rocher sur cette tuile
          const tile = terrain.tileAt(x, y);
          if (tile && tile.type !== TileType.ROCK) {
            tiles.push({ x, y, height: hTL });
          }
        }
      }
    }
    // Trier par proximité au centre de la carte
    const cx = terrain.width / 2;
    const cy = terrain.height / 2;
    tiles.sort((a, b) => {
      const da = Math.abs(a.x - cx) + Math.abs(a.y - cy);
      const db = Math.abs(b.x - cx) + Math.abs(b.y - cy);
      return da - db;
    });
    return tiles;
  }

  update(): void {
    this.isoRenderer.update();
  }

  private spawnTree(
    terrain: TerrainEngine,
    def: TreeDef,
  ): void {
    const { atlasKey, tileX, tileY, groundOriginY } = def;

    // Hauteur moyenne au centre de la tuile
    const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(tileX, tileY);
    const hAvg = (hTL + hTR + hBR + hBL) / 4;

    // Position isométrique au centre de la tuile + hauteur
    const p = mapToScreen(tileX + 0.5, tileY + 0.5, hAvg);

    const tex = this.textures.get(atlasKey);
    if (!tex || !tex.key) {
      console.warn(`[GameScene] Texture ${atlasKey} non trouvée`);
      return;
    }

    const frames = tex.getFrameNames();
    if (frames.length === 0) return;

    const img = this.add.image(p.screenX, p.screenY, atlasKey, frames[0]);
    img.setOrigin(0.5, groundOriginY);            // Ancré sur la ligne de sol (pas au bas de l'image)
    img.setDepth(tileX + tileY + 1);              // Painter's depth au-dessus du terrain

    console.log(
      `[GameScene] ${atlasKey} placé à (${tileX}, ${tileY}) → ` +
      `écran (${p.screenX}, ${p.screenY}), sol_origin=${groundOriginY.toFixed(3)}`,
    );
  }
}
