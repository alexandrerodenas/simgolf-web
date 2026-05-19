/**
 * GameScene — Scène principale du jeu.
 *
 * Phase 1 : instancie TerrainEngine, génère le terrain,
 *          affiche les stats en overlay debug.
 */
import Phaser from 'phaser';
import { TerrainEngine, TerrainGenerator, TileType } from '../core';
import { MAP_SIZE } from '../config';
import { sampleGolfers } from '../data/golfers';

export class GameScene extends Phaser.Scene {
  private terrain!: TerrainEngine;
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2a4a2a');

    // ---- Terrain ----
    this.terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(this.terrain);

    // ---- Stats du terrain généré ----
    const stats = this.computeStats();

    // ---- Debug overlay ----
    const { width, height } = this.scale;
    this.debugText = this.add.text(12, 12,
      `SimGolf Web  —  ${MAP_SIZE}×${MAP_SIZE}  |  Phaser 4\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Eau: ${stats.water}   Sable: ${stats.sand}   Herbe: ${stats.grass}\n` +
      `Arbres: ${stats.trees}   Buissons: ${stats.bushes}   Fleurs: ${stats.flowers}\n` +
      `Altitude min: ${stats.minElev}   max: ${stats.maxElev}   moyenne: ${stats.avgElev}\n` +
      `Golfeurs chargés: ${sampleGolfers.length}`,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#d4d4a0',
        lineSpacing: 4,
      }
    );

    // FPS
    const fpsText = this.add.text(10, height - 20, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888',
    });
    this.events.on('postupdate', () => {
      fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    });

    // Log console
    console.log('[GameScene] Terrain généré :', stats);
  }

  private computeStats() {
    let water = 0, sand = 0, grass = 0, trees = 0, bushes = 0, flowers = 0;
    let minE = 10, maxE = 0, sumE = 0, count = 0;

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const t = this.terrain.tileAt(x, y);
        if (!t) continue;
        switch (t.type) {
          case TileType.WATER: water++; break;
          case TileType.SAND: sand++; break;
          case TileType.GRASS: grass++; break;
          case TileType.TREE: trees++; break;
          case TileType.BUSH: bushes++; break;
          case TileType.FLOWER: flowers++; break;
        }
        const a = (t.elevation[0]+t.elevation[1]+t.elevation[2]+t.elevation[3])/4;
        if (a < minE) minE = a;
        if (a > maxE) maxE = a;
        sumE += a;
        count++;
      }
    }

    return {
      water, sand, grass, trees, bushes, flowers,
      minElev: minE, maxElev: maxE,
      avgElev: Math.round(sumE / count),
    };
  }
}
