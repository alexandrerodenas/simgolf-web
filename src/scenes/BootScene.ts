/**
 * BootScene — Chargement minimal des assets.
 *
 * Ne charge que les textures nécessaires au rendu de l'herbe :
 *   - RoughA0001 (texture de base pour le pattern fill)
 *   - Variantes A-E 0001-0005 chargées pour disponibilité future
 */

import Phaser from 'phaser';

/** Textures d'herbe du jeu original (thème Parkland) */
const TEXTURES = (() => {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const keys: string[] = [];
  for (const letter of letters) {
    for (let v = 1; v <= 5; v++) {
      keys.push(`Rough${letter}${v.toString().padStart(4, '0')}`);
    }
  }
  return keys;
})();

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    for (const key of TEXTURES) {
      this.load.image(key, `assets/textures/parkland/${key}.png`);
    }
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#1a3a1a');

    this.add.text(width / 2, height / 2, 'SimGolf', {
      fontFamily: 'Georgia, serif',
      fontSize: '2rem',
      color: '#d4d4a0',
    }).setOrigin(0.5);

    this.time.delayedCall(300, () => {
      this.scene.start('GameScene');
    });
  }
}
