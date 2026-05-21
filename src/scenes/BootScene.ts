/**
 * BootScene — Chargement minimal des assets.
 *
 * Textures organisées en sous-dossiers, tous les noms en MAJUSCULES.
 * Subdirs : rough/, fairway/, green/, sand/, water/, woods/, rock/
 * Clés Phaser : ROUGHA0001, FAIRWAYA0001, WOODSA0001, etc.
 */

import Phaser from 'phaser';

/** Textures d'herbe (thème Parkland) */
const TEXTURES = (() => {
  const keys: string[] = [];
  const groups = ['A', 'B', 'C', 'D', 'E'];
  for (const group of groups) {
    for (let v = 1; v <= 5; v++) {
      keys.push(`ROUGH${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return keys;
})();

const TEXTURE_SUBDIRS: Record<string, string> = {
  ROUGH: 'rough',
  FAIRWAY: 'fairway',
  PUTTINGGREEN: 'green',
  SANDBUNKER1: 'sand',
  WATERDEEP: 'water',
  WATERMIDDLE: 'water',
  WATERSHALLOW: 'water',
  WOODS: 'woods',
  ROCK: 'rock',
};

/** Textures Woods (4 groupes × 9 variantes) */
const WOODS = (() => {
  const keys: string[] = [];
  for (const group of ['A', 'B', 'C', 'D']) {
    for (let v = 1; v <= 9; v++) {
      keys.push(`WOODS${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return keys;
})();

/** Textures Rock (5 groupes × 9 variantes) */
const ROCKS = (() => {
  const keys: string[] = [];
  for (const group of ['A', 'B', 'C', 'D', 'E']) {
    for (let v = 1; v <= 9; v++) {
      keys.push(`ROCK${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return keys;
})();

function keyToPath(key: string): string {
  // Cherche le préfixe dans TEXTURE_SUBDIRS
  for (const [prefix, subdir] of Object.entries(TEXTURE_SUBDIRS)) {
    if (key.startsWith(prefix)) {
      return `assets/textures/parkland/${subdir}/${key}.webp`;
    }
  }
  return `assets/textures/parkland/rough/${key}.webp`;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    for (const key of TEXTURES) {
      this.load.image(key, keyToPath(key));
    }
    for (const key of WOODS) {
      this.load.image(key, keyToPath(key));
    }
    for (const key of ROCKS) {
      this.load.image(key, keyToPath(key));
    }

    // FLC Sprite : Willow Tree (arbre animé)
    this.load.atlas(
      'flic_willow',
      'assets/flics/WillowTree/WillowTree.png',
      'assets/flics/WillowTree/WillowTree.json',
    );

    // FLC Sprite : Maple Medium (arbre animé)
    this.load.atlas(
      'flic_maple',
      'assets/flics/TreeMapleMedium/TreeMapleMedium.png',
      'assets/flics/TreeMapleMedium/TreeMapleMedium.json',
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
