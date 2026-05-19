/**
 * GameScene — Scène principale du jeu.
 *
 * Phase 0 : fond coloré + texte debug.
 * Phase 1+ : terrain isométrique, HUD, gameplay.
 */
import Phaser from 'phaser';
import { MAP_SIZE } from '../config';

export class GameScene extends Phaser.Scene {
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const { width, height } = this.scale;

    // Fond
    this.cameras.main.setBackgroundColor('#2a4a2a');

    // Texte debug
    this.debugText = this.add.text(10, 10, `SimGolf Web — ${MAP_SIZE}×${MAP_SIZE}\nPhaser running`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#d4d4a0',
    });

    // FPS counter (optionnel)
    const fpsText = this.add.text(10, height - 20, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#888',
    });

    this.events.on('postupdate', () => {
      fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    });
  }
}
