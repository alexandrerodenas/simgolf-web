/**
 * SimGolf Web — Terrain Editor
 *
 * Moteur d'édition du terrain avec undo/redo.
 * Toutes les opérations d'élévation agissent sur la heightmap partagée.
 *
 * Actions supportées :
 *   - paintTile(x, y, type)          → changer le type de sol
 *   - elevateTile(x, y)              → monter les 4 sommets d'un cran
 *   - lowerTile(x, y)                → descendre les 4 sommets d'un cran
 *   - toggleWall(x, y, side)         → ajouter/enlever un mur
 *   - elevateVertex(vx, vy)          → monter un sommet individuel
 *   - lowerVertex(vx, vy)            → descendre un sommet individuel
 */

import { TerrainEngine } from '../core/TerrainEngine';
import { TileType, WallSide, TileData } from '../core/types';

// ================================================================
// Snapshot d'une action
// ================================================================

export interface EditAction {
  label: string;
  x: number;
  y: number;
  before: TileSnapshot;
  after: TileSnapshot;
}

export interface TileSnapshot {
  type: TileType;
  /** Hauteurs des 4 sommets lues depuis la heightmap */
  elevation: [number, number, number, number];
  walls: [boolean, boolean, boolean, boolean];
  variation: number;
  building: string | null;
}

// ================================================================
// État courant
// ================================================================

export type EditorTool =
  | { mode: 'paint'; tileType: TileType }
  | { mode: 'elevate' }
  | { mode: 'lower' }
  | { mode: 'wall'; side: WallSide }
  | { mode: 'inspect' };

// ================================================================
// TerrainEditor
// ================================================================

export class TerrainEditor {
  private terrain: TerrainEngine;
  private undoStack: EditAction[] = [];
  private redoStack: EditAction[] = [];
  private maxHistory = 200;
  private currentTool: EditorTool = { mode: 'paint', tileType: TileType.FAIRWAY };

  constructor(terrain: TerrainEngine) {
    this.terrain = terrain;
  }

  // ================================================================
  // Outils
  // ================================================================

  setTool(tool: EditorTool): void {
    this.currentTool = tool;
  }

  getTool(): EditorTool {
    return this.currentTool;
  }

  applyTool(x: number, y: number, side?: WallSide): boolean {
    switch (this.currentTool.mode) {
      case 'paint':
        return this.paintTile(x, y, this.currentTool.tileType);
      case 'elevate':
        return this.elevateTile(x, y);
      case 'lower':
        return this.lowerTile(x, y);
      case 'wall':
        return this.toggleWall(x, y, side ?? this.currentTool.side);
      case 'inspect':
        return false;
    }
  }

  // ================================================================
  // Actions d'édition
  // ================================================================

  paintTile(x: number, y: number, type: TileType): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile || tile.type === type) return false;

    const before = this.snapshot(x, y);
    tile.type = type;
    tile.variation = Math.floor(Math.random() * 4);
    const after = this.snapshot(x, y);

    this.pushAction({
      label: `Paint ${TileType[type]} at (${x},${y})`,
      x, y, before, after,
    });
    return true;
  }

  /** Monte les 4 sommets de la tuile d'un cran */
  elevateTile(x: number, y: number): boolean {
    const corners = this.terrain.getTileCorners(x, y);
    if (Math.max(...corners) >= 10) return false;

    const before = this.snapshot(x, y);
    this.terrain.elevateTile(x, y);
    const after = this.snapshot(x, y);

    this.pushAction({
      label: `Elevate (${x},${y})`,
      x, y, before, after,
    });
    return true;
  }

  /** Descend les 4 sommets de la tuile d'un cran */
  lowerTile(x: number, y: number): boolean {
    const corners = this.terrain.getTileCorners(x, y);
    if (Math.min(...corners) <= 0) return false;

    const before = this.snapshot(x, y);
    this.terrain.lowerTile(x, y);
    const after = this.snapshot(x, y);

    this.pushAction({
      label: `Lower (${x},${y})`,
      x, y, before, after,
    });
    return true;
  }

  /** Monte un sommet individuel */
  elevateVertex(vx: number, vy: number): boolean {
    if (this.terrain.getVertex(vx, vy) >= 10) return false;
    this.terrain.raiseVertex(vx, vy);
    return true;
  }

  /** Descend un sommet individuel */
  lowerVertex(vx: number, vy: number): boolean {
    if (this.terrain.getVertex(vx, vy) <= 0) return false;
    this.terrain.lowerVertex(vx, vy);
    return true;
  }

  toggleWall(x: number, y: number, side: WallSide): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return false;

    const before = this.snapshot(x, y);
    this.terrain.toggleWall(x, y, side);
    const after = this.snapshot(x, y);

    this.pushAction({
      label: `Wall ${WallSide[side]} (${x},${y})`,
      x, y, before, after,
    });
    return true;
  }

  // ================================================================
  // Undo / Redo
  // ================================================================

  undo(): EditAction | null {
    const action = this.undoStack.pop();
    if (!action) return null;

    this.redoStack.push(action);
    this.applySnapshot(action.x, action.y, action.before);
    return action;
  }

  redo(): EditAction | null {
    const action = this.redoStack.pop();
    if (!action) return null;

    this.undoStack.push(action);
    this.applySnapshot(action.x, action.y, action.after);
    return action;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // ================================================================
  // Helpers
  // ================================================================

  /**
   * Capture l'état d'une tuile.
   * Les hauteurs sont lues DEPUIS LA HEIGHTMAP (source de vérité).
   */
  private snapshot(x: number, y: number): TileSnapshot {
    const tile = this.terrain.tileAt(x, y);
    return {
      type: tile?.type ?? TileType.GRASS,
      elevation: this.terrain.getTileCorners(x, y),
      walls: tile ? [...tile.walls] as [boolean, boolean, boolean, boolean] : [false, false, false, false],
      variation: tile?.variation ?? 0,
      building: tile?.building ?? null,
    };
  }

  /** Restaure l'état d'une tuile + ses sommets heightmap */
  private applySnapshot(x: number, y: number, snap: TileSnapshot): void {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return;

    tile.type = snap.type;
    tile.walls = snap.walls;
    tile.variation = snap.variation;
    tile.building = snap.building;

    // Restaurer les 4 sommets dans la heightmap
    this.terrain.setVertex(x,     y,     snap.elevation[0]);
    this.terrain.setVertex(x + 1, y,     snap.elevation[1]);
    this.terrain.setVertex(x + 1, y + 1, snap.elevation[2]);
    this.terrain.setVertex(x,     y + 1, snap.elevation[3]);
  }

  private pushAction(action: EditAction): void {
    this.redoStack = [];
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
  }
}
