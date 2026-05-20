/**
 * BootScene — Chargement des assets (minimal).
 *
 * Génère une texture d'herbe procédurale pour le rendu isométrique.
 * Pas besoin de fichiers externes — tout est généré en canvas.
 */

import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Rien à charger — tout est généré procéduralement
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

    // Génère la texture d'herbe procédurale pour les 5 formes × 9 variantes
    this.generateGrassTextures();

    this.add.text(width / 2, height / 2 + 20, 'Shaping the greens…', {
      fontFamily: 'Georgia, serif',
      fontSize: '0.9rem',
      color: '#a0b0a0',
    }).setOrigin(0.5);

    this.time.delayedCall(500, () => {
      this.scene.start('GameScene');
    });
  }

  /**
   * Génère une texture d'herbe procédurale 64×64 pour chaque
   * combinaison (forme A-E, variante 0001-0009).
   *
   * Ces textures sont utilisées par SlopedTextureGenerator pour
   * le mappage affine sur les quadrilatères pentus.
   */
  private generateGrassTextures(): void {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const texSize = 64;

    for (const letter of letters) {
      for (let v = 1; v <= 9; v++) {
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

    console.log('[BootScene] Textures d\'herbe générées');
  }

  /**
   * Dessine une texture d'herbe procédurale.
   * Variation selon la lettre (forme) pour donner un aspect différent.
   */
  private drawGrassTexture(
    ctx: CanvasRenderingContext2D,
    size: number,
    letter: string,
    variant: number,
  ): void {
    // Nuances de vert selon la forme
    const baseColors: Record<string, string> = {
      'A': '#3a7d3a', // plat — vert standard
      'B': '#3a7f3a', // pente
      'C': '#3b7b3b', // coin
      'D': '#3c7e3c', // diagonale
      'E': '#3d803d', // raide — légèrement plus clair
    };

    const base = baseColors[letter] || '#3a7d3a';

    // Teinte variant avec le numéro de variante
    const shift = (variant - 5) * 0.02; // -0.08 à +0.08
    const greenShift = this.parseHex(base);
    const r = Math.max(0, Math.min(255, Math.round(greenShift.r * (1 + shift * 0.3))));
    const g = Math.max(0, Math.min(255, Math.round(greenShift.g * (1 + shift * 0.2))));
    const b = Math.max(0, Math.min(255, Math.round(greenShift.b * (1 + shift * 0.1))));

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, size, size);

    // Dégradé subtil du haut vers le bas
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 15)},${Math.min(255, g + 20)},${Math.min(255, b + 10)}, 0.3)`);
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,0.15)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Texture de brins d'herbe aléatoires
    const seed = (letter.charCodeAt(0) * 31 + variant * 17) & 0x7fffffff;
    const rng = this.lcg(seed);

    for (let i = 0; i < 80 + variant * 10; i++) {
      const gx = rng() * size;
      const gy = rng() * size;
      const len = 3 + rng() * 6;
      const shade = 0.5 + rng() * 0.5;

      ctx.strokeStyle = `rgba(${Math.round(r * shade)},${Math.round(g * shade * 1.1)},${Math.round(b * shade * 0.8)}, ${0.2 + rng() * 0.4})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + (rng() - 0.5) * 3, gy - len);
      ctx.stroke();
    }

    // Petites taches plus foncées (ombre)
    for (let i = 0; i < 10 + variant; i++) {
      const sx = rng() * size;
      const sy = rng() * size;
      const sr = 2 + rng() * 4;
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.08})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
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
