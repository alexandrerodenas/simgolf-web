/**
 * GameScene — génère le terrain Parkland et le rend
 */

import Phaser from 'phaser';
import { generateParklandCourse } from '../core/TerrainGenerator';
import { TileRenderer } from '../render/TileRenderer';
import { mapToScreen } from '../render/CoordinateSystem';

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const data = generateParklandCourse();
    const { width: w, height: h } = data;

    // Calculer les bornes du terrain en pixels écran
    const bounds = this.computeBounds(data);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    // Centrer la caméra sur le terrain
    const sw = this.scale.width;
    const sh = this.scale.height;
    this.cameras.main.setScroll(cx - sw / 2, cy - sh / 2);

    const renderer = new TileRenderer(this);
    renderer.render(data);

    // Débogage : afficher les infos dans la console
    console.log('[SimGolf] Terrain généré', { w, h, bounds, cx, cy });
    console.log('[SimGolf] Camera scroll', this.cameras.main.scrollX, this.cameras.main.scrollY);

    // Texte d'info en bas à gauche (via DOM)
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999';
    el.textContent = `SimGolf Parkland — ${w}×${h} | cam:(${Math.round(this.cameras.main.scrollX)},${Math.round(this.cameras.main.scrollY)})`;
    document.body.appendChild(el);
  }

  private computeBounds(data: { width: number; height: number; tiles: { x: number; y: number; elevation: [number,number,number,number] }[] }): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of data.tiles) {
      const pts = [
        mapToScreen(t.x, t.y, t.elevation[0]),
        mapToScreen(t.x+1, t.y, t.elevation[1]),
        mapToScreen(t.x+1, t.y+1, t.elevation[2]),
        mapToScreen(t.x, t.y+1, t.elevation[3]),
      ];
      for (const p of pts) {
        if (p.screenX < minX) minX = p.screenX;
        if (p.screenY < minY) minY = p.screenY;
        if (p.screenX > maxX) maxX = p.screenX;
        if (p.screenY > maxY) maxY = p.screenY;
      }
    }
    return { minX, minY, maxX, maxY };
  }
}
