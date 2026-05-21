/**
 * BootScene — Chargement minimal des assets.
 *
 * - RoughA0001..E0005 : textures de base pour le pattern fill herbe
 * - WoodsA0001..D0009 : textures de tuiles terrain boisées (36 textures)
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

/** Textures Woods (tuiles terrain boisées, 4 groupes × 9 variantes) */
const WOODS = (() => {
  const keys: string[] = [];
  for (const group of ['A', 'B', 'C', 'D']) {
    for (let v = 1; v <= 9; v++) {
      keys.push(`woods${group}${v.toString().padStart(4, '0')}`);
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
      this.load.image(key, `assets/textures/parkland/${key}.webp`);
    }
    for (const key of WOODS) {
      this.load.image(key, `assets/textures/parkland/${key}.webp`);
    }

    // FLC Sprite : Willow Tree (arbre animé)
    this.load.atlas(
      'flic_willow',
      'assets/flics/WillowTree/WillowTree.png',
      'assets/flics/WillowTree/WillowTree.json',
    );
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
