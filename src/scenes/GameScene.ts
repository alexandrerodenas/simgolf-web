import Phaser from 'phaser';
import { generateParklandCourse } from '../core/TerrainGenerator';
import { TileRenderer } from '../render/TileRenderer';

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // 1. Générer le terrain Parkland
    const data = generateParklandCourse();

    // 2. Centrer la caméra sur le terrain
    const { width: w, height: h } = data;
    const cx = (w - h) * (128 / 2);
    const cy = (w + h) * (64 / 4);
    this.cameras.main.setScroll(cx - 600, 0);

    // 3. Rendre le terrain
    const renderer = new TileRenderer(this);
    renderer.render(data);

    // 4. Afficher les stats
    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.6);color:#aaa;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999';
    info.textContent = `SimGolf — Parkland ${w}×${h}`;
    document.body.appendChild(info);
  }
}
