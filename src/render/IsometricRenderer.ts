/**
 * SimGolf Web — Isometric Renderer
 *
 * Chef d'orchestre du rendu isométrique.
 * Combine TextureManager + TileRenderer + culling.
 *
 * Utilise le "painter's algorithm" : rendu ligne par ligne
 * (haut → bas), colonne par colonne (gauche → droite).
 *
 * Gère le scroll via la caméra Phaser native (camera.setScroll)
 * et le zoom via camera.setZoom pour profiter du culling matériel.
 */

import Phaser from 'phaser';
import { TerrainEngine } from '../core/TerrainEngine';
import { TileData } from '../core/types';
import { TextureManager } from './TextureManager';
import { TileRenderer } from './TileRenderer';
import { computeNeighborMask } from './AutotileRules';
import {
  mapToScreen,
  visibleTiles,
  compareRenderOrder,
  ORIGIN_OFFSET_X,
  ORIGIN_OFFSET_Y,
} from './CoordinateSystem';
import { MAP_SIZE } from '../config';

// ================================================================
// Configuration
// ================================================================

export interface IsometricConfig {
  /** Zoom initial (1 = normal) */
  zoom: number;
  /** Zoom min / max */
  zoomMin: number;
  zoomMax: number;
  /** Vitesse de zoom (roulette) */
  zoomSpeed: number;
  /** Activer le drag pour le scroll */
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
  private textures: TextureManager;
  private tileRenderer: TileRenderer;
  private config: IsometricConfig;

  // Container pour tous les sprites de tuiles
  private worldContainer: Phaser.GameObjects.Container;

  // Caméra
  private camera: Phaser.Cameras.Scene2D.Camera;

  // Tuiles actuellement visibles (pour culling intelligent)
  private renderedTileKeys: Set<string> = new Set();

  // État du drag
  private isDragging = false;
  private dragStartScrollX = 0;
  private dragStartScrollY = 0;
  private dragStartPointerX = 0;
  private dragStartPointerY = 0;

  // Stats debug
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

    this.textures = new TextureManager(scene);

    // Container pour toutes les tuiles — ainsi on peut les déplacer
    // ensemble ET la caméra Phaser fait le culling natif
    this.worldContainer = scene.add.container(0, 0);
    this.worldContainer.setDepth(0);

    this.tileRenderer = new TileRenderer(scene, this.textures, this.worldContainer);
    this.camera = scene.cameras.main;
  }

  // ================================================================
  // Initialisation
  // ================================================================

  /**
   * Initialise les textures et centre la caméra sur la carte.
   * À appeler dans create() de la scène.
   */
  init(): void {
    this.textures.init();
    this.camera.setBackgroundColor('#1a2a1a');
    this.centerCamera();
    this.setupInputs();
    this.fullRender();
  }

  // ================================================================
  // Caméra
  // ================================================================

  private centerCamera(): void {
    const { width, height } = this.scene.scale;
    // Centre de la carte en isométrique → centre de l'écran
    const origin = mapToScreen(ORIGIN_OFFSET_X, ORIGIN_OFFSET_Y);
    this.camera.setScroll(
      origin.screenX - width / 2,
      origin.screenY - height / 2,
    );
    this.camera.setZoom(this.config.zoom);
  }

  // ================================================================
  // Inputs (zoom + drag)
  // ================================================================

  private setupInputs(): void {
    // Zoom à la roulette
    this.scene.input.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _gameObjects: Phaser.GameObjects.GameObject[],
      _deltaX: number,
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

    // Drag (scroll)
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
        this.fullRender(); // Rafraîchit après le drag
      }
    });
  }

  // ================================================================
  // Rendu
  // ================================================================

  /**
   * Re-rend toute la zone visible.
   * Appelé après un changement de zoom, un drag, ou un changement
   * du terrain.
   */
  fullRender(): void {
    // Nettoie les anciens sprites
    this.tileRenderer.clearAll();
    this.renderedTileKeys.clear();

    // Calcule la zone visible via la caméra
    const cam = this.camera;
    const vpLeft = cam.scrollX;
    const vpTop = cam.scrollY;
    const vpRight = vpLeft + cam.width / this.config.zoom;
    const vpBottom = vpTop + cam.height / this.config.zoom;

    // Collecte les tuiles dans la zone visible
    // On scanne toute la carte mais avec culling rapide
    const tilesToRender: Array<{ x: number; y: number; data: TileData }> = [];
    const origin = mapToScreen(0, 0); // référence pour l'offset

    // Pour chaque tuile, on vérifie si son diamant est visible
    for (let y = 0; y < this.terrain.height; y++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const data = this.terrain.tileAt(x, y);
        if (!data) continue;

        const { screenX, screenY } = mapToScreen(x, y, 0);
        const tileScreenX = screenX - origin.screenX;
        const tileScreenY = screenY - origin.screenY;

        // Culling rapide : le diamant fait ~64×32 pixels
        // On vérifie si le rectangle englobant est visible
        const tileLeft = tileScreenX - 32;
        const tileRight = tileScreenX + 32;
        const tileTop = tileScreenY - 16;
        const tileBottom = tileScreenY + 16;

        if (
          tileRight > vpLeft &&
          tileLeft < vpRight &&
          tileBottom > vpTop &&
          tileTop < vpBottom
        ) {
          tilesToRender.push({ x, y, data });
        }
      }
    }

    // Tri par ordre de rendu (Painter's algorithm)
    tilesToRender.sort((a, b) => compareRenderOrder(a, b));

    // Rendu
    this.renderedCount = 0;
    for (const { x, y, data } of tilesToRender) {
      const { screenX, screenY } = mapToScreen(x, y, 0);
      const autoTile = computeNeighborMask(this.terrain, x, y);
      this.tileRenderer.renderTile(data,
        screenX - origin.screenX,
        screenY - origin.screenY,
        autoTile);
      this.renderedCount++;
    }

    // Maj debug
    this.updateDebug();
  }

  /**
   * Rafraîchit le rendu si la caméra a bougé significativement.
   */
  update(): void {
    // On ne fait pas de re-render automatique — fullRender est appelé
    // après un drag/zoom. Cette méthode est un hook pour l'avenir.
  }

  // ================================================================
  // Zoom programmatique
  // ================================================================

  zoomIn(): void {
    this.config.zoom = Math.min(
      this.config.zoomMax,
      this.config.zoom * 1.2,
    );
    this.camera.setZoom(this.config.zoom);
    this.fullRender();
  }

  zoomOut(): void {
    this.config.zoom = Math.max(
      this.config.zoomMin,
      this.config.zoom * 0.8,
    );
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
    this.debugText.setDepth(10000); // Au-dessus de tout
  }

  private updateDebug(): void {
    if (!this.debugText) return;

    const cam = this.camera;
    this.debugText.setText([
      `SimGolf Web — ${MAP_SIZE}×${MAP_SIZE} | zoom: ${this.config.zoom.toFixed(2)}`,
      `Tuiles rendues: ${this.renderedCount} / ${MAP_SIZE * MAP_SIZE}`,
      `Cam: (${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)})`,
    ].join('\n'));
  }

  // ================================================================
  // Accès (pour les interactions futures)
  // ================================================================

  /**
   * Retourne les coordonnées carte correspondant à un point écran.
   */
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
