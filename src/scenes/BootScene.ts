/**
 * BootScene — Écran de chargement.
 *
 * Affiche un splash screen pendant l'initialisation.
 * Passe à GameScene une fois prêt.
 */
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Plus tard : chargement des assets (textures, sons)
  }

  create(): void {
    const { width, height } = this.scale;

    // Fond
    this.cameras.main.setBackgroundColor('#1a3a1a');

    this.add.text(width / 2, height / 2 - 40, 'SimGolf', {
      fontFamily: 'Georgia, serif',
      fontSize: '2.5rem',
      color: '#d4d4a0',
      letterSpacing: 8,
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 + 20, 'Shaping the greens…', {
      fontFamily: 'Georgia, serif',
      fontSize: '0.9rem',
      color: '#a0b0a0',
    }).setOrigin(0.5);

    // Transition après 1 seconde
    this.time.delayedCall(1000, () => {
      this.scene.start('GameScene');
    });
  }
}
