/**
 * GameScene — Scène principale du jeu.
 *
 * Affiche le terrain 64×64 généré avec la texture grass du jeu,
 * chaque tuile utilisant la variante géométrique exacte selon
 * les 4 hauteurs de ses sommets (TileShapeMapper).
 *
 * Navigation : drag pour scroller, molette pour zoomer.
 */

import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator } from '../core';
import { MAP_SIZE } from '../config';
import { IsometricRenderer, DiamondTextureFactory } from '../render';

export class GameScene extends Phaser.Scene {
  private isoRenderer!: IsometricRenderer;
  private diamondFactory!: DiamondTextureFactory;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // Textures diamant
    this.diamondFactory = new DiamondTextureFactory(this);
    this.diamondFactory.init();

    // Terrain généré
    const terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(terrain);

    // Rendu isométrique (drag + zoom)
    this.isoRenderer = new IsometricRenderer(this, terrain, this.diamondFactory, {
      zoom: 1,
      enableDrag: true,
    });
    this.isoRenderer.init();
    this.isoRenderer.enableDebug();
  }

  update(): void {
    this.isoRenderer.update();
  }
}
