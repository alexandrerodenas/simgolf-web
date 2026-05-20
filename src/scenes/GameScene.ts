/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 16×16 en maillage continu texturé.
 * Chaque tuile est un quadrilatère incliné dont les 4 sommets
 * sont à leur hauteur réelle (heightmap) → pentes lisses et continues.
 *
 * Navigation : drag scroll + zoom molette.
 * Touche D / bouton DBG : toggle affichage des codes variante.
 */

import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { MAP_SIZE } from '../config';
import { IsometricRenderer } from '../render';

export class GameScene extends Phaser.Scene {
  private isoRenderer!: IsometricRenderer;

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
    this.isoRenderer.init();
    this.isoRenderer.enableDebug();

    // Touche D
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-D', () => this.toggleDebug());
    }

    // Bouton DBG (mobile)
    this.createDebugButton();
  }

  private toggleDebug(): void {
    this.isoRenderer.toggleDebugVariants();
  }

  private createDebugButton(): void {
    const btn = this.add.text(this.scale.width - 10, 10, 'DBG', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffcc00',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 8, y: 6 },
    });
    btn.setOrigin(1, 0);
    btn.setScrollFactor(0);
    btn.setDepth(10000);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.toggleDebug());
  }

  update(): void {
    this.isoRenderer.update();
  }
}
