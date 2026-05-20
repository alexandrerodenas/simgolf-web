/**
 * BootScene — Chargement des assets.
 *
 * Charge les textures du jeu original (parkland) + génère
 * les variantes cosmétiques manquantes (0006-0009) en procédural.
 */

import Phaser from 'phaser';

/** Liste des textures du jeu à charger */
const GAME_TEXTURES: string[] = (() => {
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
    // Charge les textures du jeu
    for (const key of GAME_TEXTURES) {
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

    // Génère les textures manquantes (0006-0009) en procédural
    this.generateFallbackTextures();

    this.add.text(width / 2, height / 2 + 20, 'Shaping the greens…', {
      fontFamily: 'Georgia, serif',
      fontSize: '0.9rem',
      color: '#a0b0a0',
    }).setOrigin(0.5);

    this.time.delayedCall(500, () => {
      this.scene.start('GameScene');
    });
  }

  private generateFallbackTextures(): void {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const texSize = 64;

    for (const letter of letters) {
      for (let v = 6; v <= 9; v++) {
        const variant = v.toString().padStart(4, '0');
        const key = `Rough${letter}${variant}`;

        if (this.textures.exists(key)) continue;

        const canvas = this.textures.createCanvas(key, texSize, texSize);
        if (!canvas) continue;

        const ctx = canvas.context;
        this.drawGrassTexture(ctx, texSize, letter, v);
        canvas.refresh();
      }
    }
  }

  private drawGrassTexture(
    ctx: CanvasRenderingContext2D,
    size: number,
    letter: string,
    variant: number,
  ): void {
    const baseColors: Record<string, string> = {
      'A': '#3a7d3a',
      'B': '#3a7f3a',
      'C': '#3b7b3b',
      'D': '#3c7e3c',
      'E': '#3d803d',
    };
    const base = baseColors[letter] || '#3a7d3a';
    const { r, g, b } = this.parseHex(base);
    const shift = (variant - 7) * 0.03;

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, size, size);

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `rgba(${Math.min(255,r+20)},${Math.min(255,g+25)},${Math.min(255,b+15)},0.3)`);
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const seed = (letter.charCodeAt(0) * 31 + variant * 17) & 0x7fffffff;
    const rng = this.lcg(seed);
    for (let i = 0; i < 80 + variant * 10; i++) {
      const gx = rng() * size;
      const gy = rng() * size;
      const len = 3 + rng() * 6;
      const shade = 0.5 + rng() * 0.5;
      ctx.strokeStyle = `rgba(${Math.round(r*shade)},${Math.round(g*shade*1.1)},${Math.round(b*shade*0.8)},${0.2+rng()*0.4})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + (rng() - 0.5) * 3, gy - len);
      ctx.stroke();
    }
  }

  private parseHex(hex: string): { r: number; g: number; b: number } {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  private lcg(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
  }
}
