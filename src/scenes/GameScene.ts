/**
 * GameScene — Scène principale du jeu.
 *
 * Phase 2 : rendu isométrique du terrain avec scroll et zoom.
 */
import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { MAP_SIZE } from '../config';
import { IsometricRenderer } from '../render';

export class GameScene extends Phaser.Scene {
  private terrain!: TerrainEngine;
  private isoRenderer!: IsometricRenderer;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // ---- Terrain ----
    this.terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(this.terrain);

    // ---- Rendu isométrique ----
    this.isoRenderer = new IsometricRenderer(this, this.terrain, {
      zoom: 1,
      enableDrag: true,
    });
    this.isoRenderer.init();
    this.isoRenderer.enableDebug();

    // FPS counter (fixe à l'écran)
    const fpsText = this.add.text(10, this.scale.height - 20, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888',
    });
    fpsText.setScrollFactor(0);
    fpsText.setDepth(10001);

    this.events.on('postupdate', () => {
      fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    });

    console.log('[GameScene] Rendu isométrique initialisé');
  }

  update(): void {
    this.isoRenderer.update();
  }
}
