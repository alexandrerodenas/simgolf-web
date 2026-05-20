/**
 * SimGolf Web — Isometric Renderer
 *
 * Chef d'orchestre du rendu 2D isométrique.
 * Chaque tuile est un quadrilatère positionné à ses hauteurs réelles.
 * Tri painter's algorithm : arrière → avant.
 * Navigation : drag scroll + zoom molette.
 */

import Phaser from 'phaser';
import { TileRenderer } from './TileRenderer';
import { MAP_SIZE } from '../config';
import type { TerrainEngine, TileData } from '../core';

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

export class IsometricRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private tileRenderer: TileRenderer;
  private config: IsometricConfig;
  private camera: Phaser.Cameras.Scene2D.Camera;

  private isDragging = false;
  private dragStartScrollX = 0;
  private dragStartScrollY = 0;
  private dragStartPointerX = 0;
  private dragStartPointerY = 0;

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainEngine,
    config: Partial<IsometricConfig> = {},
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.tileRenderer = new TileRenderer(scene, terrain);
    this.camera = scene.cameras.main;
  }

  init(): void {
    this.camera.setBackgroundColor('#1a2a1a');
    this.autoFit();
    this.setupInputs();
    this.fullRender();
    console.log('[IsometricRenderer] Init ok');
  }

  private autoFit(): void {
    this.camera.setZoom(this.config.zoom);
    this.camera.setScroll(
      this.tileRenderer.canvasOffsetX,
      this.tileRenderer.canvasOffsetY,
    );
  }

  private setupInputs(): void {
    this.scene.input.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _gos: Phaser.GameObjects.GameObject[],
      _dx: number,
      deltaY: number,
    ) => {
      this.config.zoom = Phaser.Math.Clamp(
        this.config.zoom - deltaY * this.config.zoomSpeed * 0.01,
        this.config.zoomMin,
        this.config.zoomMax,
      );
      this.camera.setZoom(this.config.zoom);
      this.fullRender();
    });

    if (!this.config.enableDrag) return;

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

  fullRender(): void {
    const allTiles: Array<{ x: number; y: number; data: TileData }> = [];

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const data = this.terrain.tileAt(x, y);
        if (!data) continue;
        allTiles.push({ x, y, data });
      }
    }

    allTiles.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    this.tileRenderer.renderAll(allTiles);
  }

  update(): void {
    // Hook pour animations futures
  }

  getConfig(): Readonly<IsometricConfig> {
    return this.config;
  }
}
