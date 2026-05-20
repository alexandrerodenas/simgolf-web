/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 16×16 en quadrilatères isométriques 2D.
 * Chaque tuile est projetée depuis ses 4 hauteurs de coin.
 * Navigation : drag scroll + zoom molette.
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
  }

  update(): void {
    this.isoRenderer.update();
  }
}
