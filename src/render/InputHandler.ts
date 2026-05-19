/**
 * SimGolf Web — Input Handler
 *
 * Gère l'interaction tactile/souris avec le terrain isométrique :
 *   - Hit detection : conversion tap → coordonnées carte
 *   - Surbrillance de la tuile sous le pointeur
 *   - Dispatch des actions vers le TerrainEditor
 *   - Pinch zoom à 2 doigts
 *   - Raccourcis clavier (undo/redo, outils)
 */

import Phaser from 'phaser';
import { TerrainEngine } from '../core/TerrainEngine';
import { TerrainEditor, EditorTool } from '../core/TerrainEditor';
import { TileType, WallSide } from '../core/types';
import { IsometricRenderer } from './IsometricRenderer';
import { mapToScreen, TILE_W, TILE_H, TILE_D } from './CoordinateSystem';
import { MAP_SIZE, TILE } from '../config';

// ================================================================
// Types
// ================================================================

export interface InputHandlerConfig {
  /** Activer le mode édition (sinon, lecture seule) */
  editMode: boolean;
  /** Activer le pinch zoom */
  pinchZoom: boolean;
  /** Taille du geste pour déclencher le drag (évite les faux drags) */
  dragThreshold: number;
}

const DEFAULT_CONFIG: InputHandlerConfig = {
  editMode: true,
  pinchZoom: true,
  dragThreshold: 8,
};

// ================================================================
// InputHandler
// ================================================================

export class InputHandler {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private editor: TerrainEditor;
  private renderer: IsometricRenderer;
  private config: InputHandlerConfig;

  // Tuile actuellement survolée / sélectionnée
  private hoveredTile: { x: number; y: number } | null = null;
  private selectedTile: { x: number; y: number } | null = null;

  // Surbrillance (graphics overlay)
  private highlightGraphics: Phaser.GameObjects.Graphics;

  // Pinch zoom state
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;

  // Drag state (pour différencier tap vs drag)
  private pointerDownPos: { x: number; y: number } | null = null;
  private pointerMoved = false;

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainEngine,
    editor: TerrainEditor,
    renderer: IsometricRenderer,
    config: Partial<InputHandlerConfig> = {},
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.editor = editor;
    this.renderer = renderer;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Graphics pour la surbrillance (au-dessus du terrain)
    this.highlightGraphics = scene.add.graphics();
    this.highlightGraphics.setDepth(5000); // Au-dessus des tuiles
  }

  // ================================================================
  // Initialisation
  // ================================================================

  init(): void {
    if (!this.config.editMode) return;

    this.setupTapHandler();
    this.setupPinchZoom();
    this.setupKeyboard();

    // Suivi du pointeur pour hover
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.config.editMode) return;

      // Détecte le drag
      if (this.pointerDownPos && pointer.isDown) {
        const dx = Math.abs(pointer.x - this.pointerDownPos.x);
        const dy = Math.abs(pointer.y - this.pointerDownPos.y);
        if (dx > this.config.dragThreshold || dy > this.config.dragThreshold) {
          this.pointerMoved = true;
        }
      }

      // Met à jour la tuile survolée
      const mapCoords = this.screenToMap(pointer.x, pointer.y);
      if (mapCoords) {
        const prev = this.hoveredTile;
        if (!prev || prev.x !== mapCoords.x || prev.y !== mapCoords.y) {
          this.hoveredTile = mapCoords;
          this.drawHighlight();
        }
      }
    });
  }

  // ================================================================
  // Tap → Action
  // ================================================================

  private setupTapHandler(): void {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pointerDownPos = { x: pointer.x, y: pointer.y };
      this.pointerMoved = false;
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerDownPos) return;

      // Si le pointeur a bougé, c'est un drag, pas un tap
      if (this.pointerMoved) {
        this.pointerDownPos = null;
        return;
      }

      this.pointerDownPos = null;

      const mapCoords = this.screenToMap(pointer.x, pointer.y);
      if (!mapCoords) return;

      const { x, y } = mapCoords;
      this.selectedTile = { x, y };

      const tool = this.editor.getTool();

      if (tool.mode === 'wall') {
        // Pour les murs, on détermine le côté en fonction de la position
        // relative du tap par rapport au centre de la tuile
        const side = this.detectWallSide(pointer.x, pointer.y, x, y);
        if (side !== null) {
          this.editor.applyTool(x, y, side);
        }
      } else {
        this.editor.applyTool(x, y);
        // En mode paint, on peut "peindre" en continu via pointermove
        // → géré par la suite
      }

      this.drawHighlight();
    });
  }

  /**
   * Détecte quel côté du mur est cliqué en fonction de la position
   * relative du pointeur par rapport au centre du diamond.
   */
  private detectWallSide(
    screenX: number,
    screenY: number,
    mapX: number,
    mapY: number,
  ): WallSide | null {
    const origin = mapToScreen(0, 0);
    const { screenX: tileScreenX, screenY: tileScreenY } = mapToScreen(mapX, mapY, 0);

    // Position relative du pointeur par rapport au centre du diamond
    const relX = screenX - (tileScreenX - origin.screenX);
    const relY = screenY - (tileScreenY - origin.screenY);

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Les diagonales du diamond divisent l'espace en 4 quadrants
    // Nord : y < 0 et |x| < -y * (hw/hh) → au-dessus du diamond
    // etc.

    const slope = hw / hh;

    // Nord (haut)
    if (relY <= -hh + 4 && Math.abs(relX) <= (-relY) * slope) {
      return WallSide.NORTH;
    }
    // Sud (bas)
    if (relY >= hh - 4 && Math.abs(relX) <= relY * slope) {
      return WallSide.SOUTH;
    }
    // Est (droite)
    if (relX >= hw - 4 && Math.abs(relY) <= relX / slope) {
      return WallSide.EAST;
    }
    // Ouest (gauche)
    if (relX <= -hw + 4 && Math.abs(relY) <= (-relX) / slope) {
      return WallSide.WEST;
    }

    return null; // À l'intérieur du diamond
  }

  // ================================================================
  // Pinch Zoom
  // ================================================================

  private setupPinchZoom(): void {
    if (!this.config.pinchZoom) return;

    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const active = this.scene.input.manager.pointers.filter(p => p.isDown);
      if (active.length === 2) {
        this.pinchStartDistance = Phaser.Math.Distance.Between(
          active[0].x, active[0].y,
          active[1].x, active[1].y,
        );
        this.pinchStartZoom = this.renderer.getConfig().zoom;
      }
    });

    this.scene.input.on('pointermove', () => {
      const active = this.scene.input.manager.pointers.filter(p => p.isDown);
      if (active.length !== 2) return;

      const currentDist = Phaser.Math.Distance.Between(
        active[0].x, active[0].y,
        active[1].x, active[1].y,
      );

      if (this.pinchStartDistance > 0) {
        const scale = currentDist / this.pinchStartDistance;
        let newZoom = Phaser.Math.Clamp(
          this.pinchStartZoom * scale,
          0.4, 2.5,
        );
        // Appliquer via la caméra
        this.scene.cameras.main.setZoom(newZoom);
      }
    });

    this.scene.input.on('pointerup', () => {
      this.pinchStartDistance = 0;
    });
  }

  // ================================================================
  // Clavier (raccourcis)
  // ================================================================

  private setupKeyboard(): void {
    if (!this.scene.input.keyboard) return;

    // Undo : Ctrl+Z
    this.scene.input.keyboard.on('keydown-Z', (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.shiftKey) {
          this.editor.redo();
        } else {
          this.editor.undo();
        }
        this.renderer.fullRender();
        this.drawHighlight();
      }
    });

    // Outils via touches 1-6
    const toolKeys: Record<string, EditorTool> = {
      ONE:   { mode: 'paint', tileType: TileType.GRASS },
      TWO:   { mode: 'paint', tileType: TileType.FAIRWAY },
      THREE: { mode: 'paint', tileType: TileType.GREEN },
      FOUR:  { mode: 'paint', tileType: TileType.SAND },
      FIVE:  { mode: 'paint', tileType: TileType.WATER },
      SIX:   { mode: 'elevate' },
    };

    for (const [key, tool] of Object.entries(toolKeys)) {
      this.scene.input.keyboard.on(`keydown-${key}`, () => {
        this.editor.setTool(tool);
        this.drawHighlight();
      });
    }
  }

  // ================================================================
  // Conversion Écran → Carte
  // ================================================================

  /**
   * Convertit des coordonnées écran en coordonnées carte.
   * Retourne null si le point est hors carte.
   */
  screenToMap(screenX: number, screenY: number): { x: number; y: number } | null {
    const cam = this.scene.cameras.main;

    // Coordonnées monde (compense le scroll de la caméra)
    const worldX = screenX + cam.scrollX;
    const worldY = screenY + cam.scrollY;

    // Inverse de la transformation isométrique
    // screenX = (mapX - mapY) * TILE_W/2
    // screenY = (mapX + mapY) * TILE_H/2
    //
    // → mapX = screenX/TILE_W + screenY/TILE_H
    // → mapY = screenY/TILE_H - screenX/TILE_W

    // Ajuste pour le décalage d'origine
    const origin = mapToScreen(0, 0);
    const adjX = worldX - origin.screenX;
    const adjY = worldY - origin.screenY;

    const mapX = adjX / TILE_W + adjY / TILE_H;
    const mapY = adjY / TILE_H - adjX / TILE_W;

    // Arrondi et clamp
    const x = Math.round(mapX);
    const y = Math.round(mapY);

    if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) {
      return null;
    }

    return { x, y };
  }

  // ================================================================
  // Surbrillance
  // ================================================================

  /**
   * Dessine la surbrillance de la tuile sélectionnée et/ou survolée.
   */
  private drawHighlight(): void {
    this.highlightGraphics.clear();

    const target = this.selectedTile ?? this.hoveredTile;
    if (!target) return;

    const origin = mapToScreen(0, 0);
    const { screenX, screenY } = mapToScreen(target.x, target.y, 0);
    const corners = this.terrain.getTileCorners(target.x, target.y);
    const elev = Math.round((corners[0] + corners[1] + corners[2] + corners[3]) / 4);

    const sx = screenX - origin.screenX;
    const sy = screenY - origin.screenY - elev * TILE_D;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Diamond de surbrillance
    const color = this.selectedTile ? 0xffffff : 0xffff00;
    const alpha = this.selectedTile ? 0.8 : 0.4;

    this.highlightGraphics.lineStyle(2, color, alpha);
    this.highlightGraphics.beginPath();
    this.highlightGraphics.moveTo(sx, sy - hh);       // haut
    this.highlightGraphics.lineTo(sx + hw, sy);        // droite
    this.highlightGraphics.lineTo(sx, sy + hh);        // bas
    this.highlightGraphics.lineTo(sx - hw, sy);        // gauche
    this.highlightGraphics.closePath();
    this.highlightGraphics.strokePath();

    // Petit point au centre
    this.highlightGraphics.fillStyle(color, alpha * 0.5);
    this.highlightGraphics.fillCircle(sx, sy, 3);

    // Si outil wall, affiche les côtés
    const tool = this.editor.getTool();
    if (tool.mode === 'wall') {
      const wallAlpha = 0.6;
      // Nord
      this.drawWallIndicator(sx - hw, sy - hh, sx, sy - hh * 2, 0x44ff44, wallAlpha);
      // Est
      this.drawWallIndicator(sx, sy - hh * 2, sx + hw, sy - hh, 0x44ff44, wallAlpha);
      // Sud
      this.drawWallIndicator(sx + hw, sy - hh, sx, sy, 0x44ff44, wallAlpha);
      // Ouest
      this.drawWallIndicator(sx, sy, sx - hw, sy - hh, 0x44ff44, wallAlpha);
    }
  }

  private drawWallIndicator(
    x1: number, y1: number,
    x2: number, y2: number,
    color: number, alpha: number,
  ): void {
    this.highlightGraphics.lineStyle(3, color, alpha);
    this.highlightGraphics.beginPath();
    this.highlightGraphics.moveTo(x1, y1);
    this.highlightGraphics.lineTo(x2, y2);
    this.highlightGraphics.strokePath();
  }

  // ================================================================
  // Accès
  // ================================================================

  getSelectedTile(): { x: number; y: number } | null {
    return this.selectedTile;
  }

  getHoveredTile(): { x: number; y: number } | null {
    return this.hoveredTile;
  }

  clearSelection(): void {
    this.selectedTile = null;
    this.drawHighlight();
  }
}
