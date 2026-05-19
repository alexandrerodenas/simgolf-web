/**
 * SimGolf Web — Isometric Renderer (vertex-based heightmap)
 *
 * Chef d'orchestre du rendu isométrique.
 * Utilise un unique Graphics batché pour tout le terrain.
 * Rendu dans l'ordre painter's algorithm (arrière → avant).
 *
 * Caméra : scroll via drag + zoom roulette (Phaser native).
 */

import Phaser from 'phaser';
import { TerrainEngine, TileData } from '../core';
import { TileRenderer } from './TileRenderer';
import { mapToScreen, TILE_W, TILE_H } from './CoordinateSystem';
import { MAP_SIZE } from '../config';

// ================================================================
// Configuration
// ================================================================

export interface IsometricConfig {
  zoom: number;
  zoomMin: number;
  zoomMax: number;
  zoomSpeed: number;
  enableDrag: boolean;
}

const DEFAULT_CONFIG: IsometricConfig = {
  zoom: 1,
  zoomMin: 0.4,
  zoomMax: 2.5,
  zoomSpeed: 0.1,
  enableDrag: true,
};

// ================================================================
// Isometric Renderer
// ================================================================

export class IsometricRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private tileRenderer: TileRenderer;
  private config: IsometricConfig;
  private camera: Phaser.Cameras.Scene2D.Camera;

  // Graphics batch unique (recréé à chaque fullRender)
  private gfx: Phaser.GameObjects.Graphics | null = null;

  // État du drag
  private isDragging = false;
  private dragStartScrollX = 0;
  private dragStartScrollY = 0;
  private dragStartPointerX = 0;
  private dragStartPointerY = 0;

  // Stats
  private renderedCount = 0;
  private debugText: Phaser.GameObjects.Text | null = null;

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainEngine,
    config: Partial<IsometricConfig> = {},
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.tileRenderer = new TileRenderer(terrain);
    this.camera = scene.cameras.main;
  }

  // ================================================================
  // Initialisation
  // ================================================================

  init(): void {
    this.camera.setBackgroundColor('#1a2a1a');
    this.centerCamera();
    this.setupInputs();
    this.fullRender();

    console.log(
      `[IsometricRenderer] Init zoom=${this.config.zoom}`,
    );
  }

  // ================================================================
  // Caméra
  // ================================================================

  private centerCamera(): void {
    const { width, height } = this.scene.scale;
    const center = mapToScreen(MAP_SIZE / 2, MAP_SIZE / 2);
    this.camera.setScroll(
      center.screenX - width / 2,
      center.screenY - height / 2,
    );
    this.camera.setZoom(this.config.zoom);
  }

  // ================================================================
  // Inputs
  // ================================================================

  private setupInputs(): void {
    // Zoom roulette
    this.scene.input.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _gos: Phaser.GameObjects.GameObject[],
      _dx: number,
      deltaY: number,
    ) => {
      const oldZoom = this.config.zoom;
      this.config.zoom = Phaser.Math.Clamp(
        this.config.zoom - deltaY * this.config.zoomSpeed * 0.01,
        this.config.zoomMin,
        this.config.zoomMax,
      );
      this.camera.setZoom(this.config.zoom);
      if (Math.abs(oldZoom - this.config.zoom) > 0.001) {
        this.fullRender();
      }
    });

    if (!this.config.enableDrag) return;

    // Drag scroll
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStartScrollX = this.camera.scrollX;
      this.dragStartScrollY = this.camera.scrollY;
      this.dragStartPointerX = pointer.x;
      this.dragStartPointerY = pointer.y;
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging || !pointer.isDown) return;
      const dx = this.dragStartPointerX - pointer.x;
      const dy = this.dragStartPointerY - pointer.y;
      this.camera.setScroll(
        this.dragStartScrollX + dx / this.config.zoom,
        this.dragStartScrollY + dy / this.config.zoom,
      );
    });

    this.scene.input.on('pointerup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.fullRender();
      }
    });
  }

  // ================================================================
  // Rendu (batché)
  // ================================================================

  fullRender(): void {
    // Détruit l'ancien Graphics
    if (this.gfx) {
      this.gfx.destroy();
    }

    // Crée un nouveau Graphics
    this.gfx = this.scene.add.graphics();
    this.gfx.setDepth(0);

    // Collecte les tuiles visibles
    const cam = this.camera;
    const vpLeft = cam.scrollX;
    const vpTop = cam.scrollY;
    const vpRight = vpLeft + cam.width / this.config.zoom;
    const vpBottom = vpTop + cam.height / this.config.zoom;

    const tilesToDraw: Array<{ x: number; y: number; data: TileData; order: number }> = [];
    const origin = mapToScreen(0, 0);

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const data = this.terrain.tileAt(x, y);
        if (!data) continue;

        const { screenX, screenY } = mapToScreen(x, y, 0);
        const tsx = screenX - origin.screenX;
        const tsy = screenY - origin.screenY;

        // Culling : rectangle englobant du diamond
        if (
          tsx + 32 > vpLeft && tsx - 32 < vpRight &&
          tsy + 16 > vpTop && tsy - 16 < vpBottom
        ) {
          tilesToDraw.push({ x, y, data, order: (x + y) * 16 });
        }
      }
    }

    // Tri painter's algorithm (arrière → avant)
    tilesToDraw.sort((a, b) => a.order - b.order);

    // Rendu batché sur le Graphics
    this.renderedCount = 0;
    for (const { x, y, data } of tilesToDraw) {
      this.tileRenderer.drawTile(this.gfx!, x, y, data);
      this.renderedCount++;
    }

    this.updateDebug();

    if (this.renderedCount === 0) {
      console.warn('[IsometricRenderer] Aucune tuile visible');
    }
  }

  update(): void {
    // Hook pour animations futures
  }

  // ================================================================
  // Zoom programmatique
  // ================================================================

  zoomIn(): void {
    this.config.zoom = Math.min(this.config.zoomMax, this.config.zoom * 1.2);
    this.camera.setZoom(this.config.zoom);
    this.fullRender();
  }

  zoomOut(): void {
    this.config.zoom = Math.max(this.config.zoomMin, this.config.zoom * 0.8);
    this.camera.setZoom(this.config.zoom);
    this.fullRender();
  }

  resetZoom(): void {
    this.config.zoom = 1;
    this.centerCamera();
    this.fullRender();
  }

  // ================================================================
  // Debug
  // ================================================================

  enableDebug(): void {
    if (this.debugText) return;
    this.debugText = this.scene.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#d4d4a0',
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: { x: 6, y: 4 },
    });
    this.debugText.setScrollFactor(0);
    this.debugText.setDepth(10000);
  }

  private updateDebug(): void {
    if (!this.debugText) return;
    const cam = this.camera;
    this.debugText.setText([
      `SimGolf Web — ${MAP_SIZE}×${MAP_SIZE} | zoom: ${this.config.zoom.toFixed(2)}`,
      `Tuiles: ${this.renderedCount} / ${MAP_SIZE * MAP_SIZE}`,
      `Cam: (${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)})`,
    ].join('\n'));
  }

  // ================================================================
  // Accès
  // ================================================================

  screenToMapCoords(screenX: number, screenY: number): { x: number; y: number } {
    const cam = this.camera;
    const worldX = screenX + cam.scrollX;
    const worldY = screenY + cam.scrollY;
    return {
      x: Math.round(worldX / 32 + worldY / 16),
      y: Math.round(worldY / 16 - worldX / 32),
    };
  }

  getConfig(): Readonly<IsometricConfig> {
    return this.config;
  }
}
