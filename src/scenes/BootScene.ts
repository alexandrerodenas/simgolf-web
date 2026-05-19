/**
 * BootScene — Chargement des assets.
 *
 * Charge la texture grass extraite du jeu et les textures diamant.
 */

import Phaser from 'phaser';
import { DiamondTextureFactory, getAllSourceKeys } from '../render/DiamondTextureFactory';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Texture grass du jeu (pour le Rope rendering)
    for (const key of getAllSourceKeys()) {
      this.load.image(key, `assets/textures/parkland/${key}.png`);
    }
  }

  create(): void {
    const { width, height } = this.scale;

    this.cameras.main.setBackgroundColor('#1a3a1a');

    this.add.text(width / 2, height / 2 - 40, 'SimGolf', {
      fontFamily: 'Georgia, serif',
      fontSize: '2.5rem',
      color: '#d4d4a0',
      letterSpacing: 8,
    }).setOrigin(0.5);

    // Crée les textures diamant
    const df = new DiamondTextureFactory(this);
    df.init();

    this.add.text(width / 2, height / 2 + 20, 'Shaping the greens…', {
      fontFamily: 'Georgia, serif',
      fontSize: '0.9rem',
      color: '#a0b0a0',
    }).setOrigin(0.5);

    this.time.delayedCall(500, () => {
      this.scene.start('GameScene');
    });
  }
}
