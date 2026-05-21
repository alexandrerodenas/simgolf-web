/**
 * BootScene — charge les textures WebP Parkland
 *
 * Structure assets/textures/parkland/{subdir}/{Type}{Group}{Number}.webp
 * Ex: assets/textures/parkland/rough/RoughA0001.webp
 */

import Phaser from 'phaser';
import { TileType } from '../core/types';

interface TextureSpec {
  prefix: string;
  subdir: string;
  groups: string[];
  variants: number;
}

/** Liste des textures terrain à charger */
const TEXTURES: TextureSpec[] = [
  { prefix: 'Rough',        subdir: 'rough',        groups: ['A','B','C','D','E'], variants: 5 },
  { prefix: 'Fairway',      subdir: 'fairway',      groups: ['A'],                 variants: 5 },
  { prefix: 'PuttingGreen', subdir: 'green',        groups: ['A'],                 variants: 5 },
  { prefix: 'SandBunker',   subdir: 'sand',         groups: ['1A'],                variants: 5 },
  { prefix: 'WaterShallow', subdir: 'water',        groups: ['A','B','C','D'],     variants: 5 },
  { prefix: 'WaterMiddle',  subdir: 'water-middle', groups: ['A','B','C','D'],     variants: 5 },
  { prefix: 'WaterDeep',    subdir: 'water-deep',   groups: ['A','B','C','D'],     variants: 5 },
  { prefix: 'DeepRough',    subdir: 'deeprough',    groups: ['A','B','C','D'],     variants: 5 },
  { prefix: 'Tee',          subdir: 'tee',          groups: ['A'],                 variants: 5 },
  { prefix: 'Woods',        subdir: 'woods',        groups: ['A','B','C','D'],     variants: 5 },
  { prefix: 'Rock',         subdir: 'rock',         groups: ['A','B','C','D','E'], variants: 5 },
];

export class BootScene extends Phaser.Scene {
  private progressText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Barre de progression
    this.progressText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Chargement...', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaa',
    }).setOrigin(0.5);

    // Charger les textures
    for (const spec of TEXTURES) {
      for (const group of spec.groups) {
        for (let v = 1; v <= spec.variants; v++) {
          const key = `${spec.prefix}${group}${String(v).padStart(4, '0')}`;
          const path = `assets/textures/parkland/${spec.subdir}/${key}.webp`;
          this.load.image(key, path);
        }
      }
    }
  }

  create(): void {
    this.progressText.destroy();
    this.scene.start('GameScene');
  }
}
