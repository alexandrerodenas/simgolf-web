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
import { woodsTextureKey } from '../render/TransitionLUT';
import { TILE } from '../config';

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
  private debugLabels: Phaser.GameObjects.Text[] = [];
  private showDebug = false;

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

    // ── Debug : touche D → labels de texture ──
    this.input.keyboard!.on('keydown-D', () => {
      this.toggleDebug(terrain);
    });
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

  /** Bascule l'affichage des labels de debug (touche D) */
  private toggleDebug(terrain: TerrainEngine): void {
    this.showDebug = !this.showDebug;

    // Détruire les labels existants
    for (const lbl of this.debugLabels) lbl.destroy();
    this.debugLabels = [];
    if (!this.showDebug) return;

    // Créer les labels pour chaque tuile
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const tile = terrain.tileAt(x, y);
        if (!tile) continue;

        // Déterminer le label : lettre + chiffre
        let label = '?';
        if (tile.type === TileType.TREE) {
          // Pour Woods : extraire depuis la LUT comme drawWoodsTile
          const group = (tile.variation - 1) % 4;
          const variation = (tile.variation - 1) % 9 + 1;
          const mask = this.calculateBitmask(terrain, x, y, TileType.TREE);
          const key = woodsTextureKey(
            group, variation, mask,
            (k: string) => this.textures.exists(k),
          );
          // Extraire groupe + suffixe : "WOODSA0005" → "A5"
          const m = key.match(/WOODS([A-D])(\d+)/);
          if (m) label = `${m[1]}${parseInt(m[2], 10)}`;
        } else {
          // Autres types : lettre du type + variation
          const typeNames: Record<number, string> = {
            [TileType.GRASS]: 'G', [TileType.FAIRWAY]: 'F',
            [TileType.GREEN]: 'GN', [TileType.SAND]: 'S',
            [TileType.WATER]: 'W', [TileType.PATH]: 'P',
            [TileType.TEE]: 'T', [TileType.ROUGH]: 'R',
            [TileType.ROCK]: 'K',
          };
          const ch = typeNames[tile.type] ?? `${tile.type}`;
          label = `${ch}${tile.variation || ''}`;
        }

        // Centre de la tuile en isométrique
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

  /** Calcule le bitmask 8-way (copie de TileRenderer.calculateBitmask) */
  private calculateBitmask(
    terrain: TerrainEngine,
    x: number, y: number,
    tileType: TileType,
  ): number {
    const dirs: [number, number, number][] = [
      [0, -1, 1], [1, -1, 2], [1, 0, 4], [1, 1, 8],
      [0, 1, 16], [-1, 1, 32], [-1, 0, 64], [-1, -1, 128],
    ];
    let mask = 0;
    for (const [dx, dy, bit] of dirs) {
      const n = terrain.tileAt(x + dx, y + dy);
      if (n && n.type === tileType) mask |= bit;
    }
    return mask;
  }
}
