/**
 * BootScene — Écran de chargement.
 *
 * Charge les textures extraites du jeu SimGolf.
 * Passe à GameScene une fois prêt.
 */
import Phaser from 'phaser';
import { getAllSourceKeys, DiamondTextureFactory } from '../render/DiamondTextureFactory';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Charge les textures de terrain extraites du jeu
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

    // Crée les textures diamant à partir des sources chargées
    const diamondFactory = new DiamondTextureFactory(this);
    diamondFactory.init();

    this.add.text(width / 2, height / 2 + 20, 'Shaping the greens…', {
      fontFamily: 'Georgia, serif',
      fontSize: '0.9rem',
      color: '#a0b0a0',
    }).setOrigin(0.5);

    // Transition immédiate (textures déjà chargées)
    this.time.delayedCall(500, () => {
      this.scene.start('GameScene');
    });
  }
}
