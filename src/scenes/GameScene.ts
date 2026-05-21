/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 16×16 en quadrilatères isométriques 2D.
 * Chaque tuile est projetée depuis ses 4 hauteurs de coin.
 * Arbre FLC WillowTree animé au centre (8, 8).
 * Navigation : drag scroll + zoom molette.
 */

import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { MAP_SIZE } from '../config';
import { IsometricRenderer } from '../render';
import { mapToScreen } from '../render/CoordinateSystem';

export class GameScene extends Phaser.Scene {
  private isoRenderer!: IsometricRenderer;
  private centerTree: Phaser.GameObjects.Sprite | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(terrain);

    this.isoRenderer = new IsometricRenderer(this, terrain, {
      zoom: 1,
      enableDrag: true,
    });

    // Place l'arbre AVANT init pour qu'il soit pris en compte
    // dans le positionnement initial du canvas
    this.isoRenderer.init();

    // ── Arbre FLC au centre (8, 8) ──
    this.spawnCenterTree(terrain);
  }

  update(): void {
    this.isoRenderer.update();
  }

  private spawnCenterTree(terrain: TerrainEngine): void {
    const cx = MAP_SIZE / 2;    // 8
    const cy = MAP_SIZE / 2;    // 8

    // Hauteur moyenne au centre de la tuile (8, 8)
    const [hTL, hTR, hBR, hBL] = terrain.getTileCorners(cx, cy);
    const hAvg = (hTL + hTR + hBR + hBL) / 4;

    // Position isométrique au centre de la tuile + hauteur
    const p = mapToScreen(cx + 0.5, cy + 0.5, hAvg);

    const tex = this.textures.get('flic_willow');
    if (!tex || !tex.key) {
      console.warn('[GameScene] Texture flic_willow non trouvée');
      return;
    }

    // Première frame du spritesheet
    const frames = tex.getFrameNames();
    if (frames.length === 0) return;

    const img = this.add.image(p.screenX, p.screenY, 'flic_willow', frames[0]);
    img.setOrigin(0.5, 1);                // Ancré bas-centre → le sol touche le terrain
    img.setDepth(cx + cy + 1);            // Painter's depth au-dessus du terrain
    img.setScale(1);

    this.centerTree = img as Phaser.GameObjects.Sprite;
    console.log(`[GameScene] Arbre placé au centre (${cx}, ${cy}) → écran (${p.screenX}, ${p.screenY})`);
  }
}
