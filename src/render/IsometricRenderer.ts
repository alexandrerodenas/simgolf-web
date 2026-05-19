/**
 * SimGolf Web — Isometric Renderer
 *
 * Chef d'orchestre du rendu isométrique avec textures du jeu original.
 *
 * Chaque tuile est une Image Phaser positionnée à la bonne hauteur
 * (heightmap). La caméra gère scroll/drag/zoom nativement.
 *
 * Culling : seules les tuiles visibles sont rendues.
 * Tri : painter's algorithm (arrière → avant).
 */

import Phaser from 'phaser';
import { DiamondTextureFactory } from './DiamondTextureFactory';
import { TileRenderer } from './TileRenderer';
import { mapToScreen, TILE_H, TILE_D, TILE_W } from './CoordinateSystem';
import { MAP_SIZE } from '../config';
import type { TerrainEngine, TileData } from '../core';

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
    diamondFactory: DiamondTextureFactory,
    config: Partial<IsometricConfig> = {},
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.tileRenderer = new TileRenderer(scene, terrain, diamondFactory);
    this.camera = scene.cameras.main;
  }

  // ================================================================
  // Initialisation
  // ================================================================

  init(): void {
    this.camera.setBackgroundColor('#1a2a1a');
    this.autoFit();
    this.setupInputs();
    this.fullRender();

    console.log('[IsometricRenderer] Init ok');
  }

  // ================================================================
  // Caméra — ajustement automatique
  // ================================================================

  /**
   * Ajuste zoom et scroll pour que la carte 64×64 remplisse
   * l'écran sans padding. La carte tient dans :
   *   X : [ -(N-1)*TW/2 , +(N-1)*TW/2 ]
   *   Y : [ -maxElev*TD  , 2*(N-1)*TH/2 ]
   */
  private autoFit(): void {
    const { width: sw, height: sh } = this.scene.scale;
    const N = MAP_SIZE - 1;

    const mapLeft = -N * (TILE_W / 2);
    const mapRight = N * (TILE_W / 2);
    const mapTop = -10 * TILE_D; // hauteur max = 10
    const mapBottom = N * TILE_H;

    const mapW = mapRight - mapLeft;
    const mapH = mapBottom - mapTop;

    // Zoom pour que la carte remplisse l'écran
    const zoomX = sw / mapW;
    const zoomY = sh / mapH;
    this.config.zoom = Math.min(zoomX, zoomY);
    this.camera.setZoom(this.config.zoom);

    // Scroll pour que le coin haut-gauche de la carte soit en
    // haut-gauche de l'écran (pas de padding)
    this.camera.setScroll(mapLeft, mapTop);
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
  // Rendu
  // ================================================================

  fullRender(): void {
    // Pas de culling : toutes les tuiles sont toujours rendues
    const allTiles: Array<{ x: number; y: number; data: TileData }> = [];
    const origin = mapToScreen(0, 0);

    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const data = this.terrain.tileAt(x, y);
        if (!data) continue;

        const { screenX, screenY } = mapToScreen(x, y, 0);
        const tsx = screenX - origin.screenX;
        const tsy = screenY - origin.screenY;

        allTiles.push({ x, y, data });
      }
    }

    // Tri painter's algorithm (arrière → avant)
    allTiles.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    // Rendu batché
    this.renderedCount = allTiles.length;
    this.tileRenderer.renderAll(allTiles);

    this.updateDebug();

    if (this.renderedCount === 0) {
      console.warn('[IsometricRenderer] Aucune tuile visible');
    }
  }

  update(): void {
    // Hook pour animations futures
  }

  // ================================================================
  // Zoom
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
    this.autoFit();
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
      `SimGolf — ${MAP_SIZE}×${MAP_SIZE} | zoom: ${this.config.zoom.toFixed(2)}`,
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
