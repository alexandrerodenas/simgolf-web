/**
 * GameScene — Scène principale du jeu.
 *
 * Phase 3 : interaction tactile + textures du jeu original.
 */

import Phaser from 'phaser';
import {
  TerrainEngine, TerrainGenerator, TerrainEditor,
  TileType,
} from '../core';
import { MAP_SIZE } from '../config';
import {
  IsometricRenderer, InputHandler, DiamondTextureFactory,
} from '../render';

export class GameScene extends Phaser.Scene {
  private terrain!: TerrainEngine;
  private editor!: TerrainEditor;
  private isoRenderer!: IsometricRenderer;
  private inputHandler!: InputHandler;
  private diamondFactory!: DiamondTextureFactory;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // ---- Textures diamant (héritées du BootScene) ----
    this.diamondFactory = new DiamondTextureFactory(this);
    this.diamondFactory.init();

    // ---- Terrain ----
    this.terrain = new TerrainEngine(MAP_SIZE, MAP_SIZE);
    const gen = new TerrainGenerator();
    gen.generateNatural(this.terrain);

    // ---- Éditeur ----
    this.editor = new TerrainEditor(this.terrain);

    // ---- Rendu isométrique avec textures du jeu ----
    this.isoRenderer = new IsometricRenderer(this, this.terrain, this.diamondFactory, {
      zoom: 1,
      enableDrag: true,
    });
    this.isoRenderer.init();
    this.isoRenderer.enableDebug();

    // ---- Interaction tactile ----
    this.inputHandler = new InputHandler(
      this,
      this.terrain,
      this.editor,
      this.isoRenderer,
      { editMode: true, pinchZoom: true },
    );
    this.inputHandler.init();

    // ---- Toolbar (éditeur de terrain uniquement) ----
    this.createToolbar();

    // FPS counter
    const fpsText = this.add.text(10, this.scale.height - 20, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888',
    });
    fpsText.setScrollFactor(0);
    fpsText.setDepth(10001);

    this.events.on('postupdate', () => {
      fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    });

    console.log('[GameScene] Phase 3 — Textures du jeu chargées');
  }

  update(): void {
    this.isoRenderer.update();
  }

  // ================================================================
  // Toolbar
  // ================================================================

  private createToolbar(): void {
    const { width } = this.scale;

    // Outils d'édition du terrain (pas de construction)
    const items: Array<{ label: string; tool: Parameters<TerrainEditor['setTool']>[0] }> = [
      { label: '🌿 Herbe',  tool: { mode: 'paint', tileType: TileType.GRASS } },
      { label: '⛳ Fairway', tool: { mode: 'paint', tileType: TileType.FAIRWAY } },
      { label: '🟢 Green',  tool: { mode: 'paint', tileType: TileType.GREEN } },
      { label: '🏖️ Sable',  tool: { mode: 'paint', tileType: TileType.SAND } },
      { label: '💧 Eau',    tool: { mode: 'paint', tileType: TileType.WATER } },
      { label: '⬆️',        tool: { mode: 'elevate' } },
      { label: '⬇️',        tool: { mode: 'lower' } },
      { label: '🧱',        tool: { mode: 'wall', side: 0 } },
    ];

    const startX = 10;

    items.forEach((item, i) => {
      const x = startX + i * 55;
      const txt = this.add.text(x, 50, item.label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#cccccc',
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 6, y: 4 },
      });
      txt.setOrigin(0, 0.5);
      txt.setScrollFactor(0);
      txt.setDepth(10000);
      txt.setInteractive({ useHandCursor: true });

      txt.on('pointerdown', () => {
        this.editor.setTool(item.tool);
      });

      txt.on('pointerover', () => {
        txt.setStyle({
          color: '#ffffff',
          backgroundColor: 'rgba(40,80,40,0.9)',
        });
      });

      txt.on('pointerout', () => {
        txt.setStyle({
          color: '#cccccc',
          backgroundColor: 'rgba(0,0,0,0.7)',
        });
      });
    });

    // Undo / Redo
    this.toolbarButton(width - 110, 50, '↩ Undo', () => {
      this.editor.undo();
      this.isoRenderer.fullRender();
    });

    this.toolbarButton(width - 50, 50, '↪ Redo', () => {
      this.editor.redo();
      this.isoRenderer.fullRender();
    });
  }

  private toolbarButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize: '11px',
      color: '#aaaaaa', backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 6, y: 4 },
    });
    btn.setScrollFactor(0);
    btn.setDepth(10000);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerdown', onClick);
  }
}
