/**
 * SimGolf Web — Terrain Editor
 *
 * Moteur d'édition du terrain avec undo/redo.
 *
 * Actions supportées :
 *   - paintTile(x, y, type)    → changer le type de sol
 *   - elevateTile(x, y)        → monter d'un niveau
 *   - lowerTile(x, y)          → descendre d'un niveau
 *   - toggleWall(x, y, side)   → ajouter/enlever un mur
 *
 * Chaque action est enregistrée dans l'historique pour undo/redo.
 */

import { TerrainEngine } from '../core/TerrainEngine';
import { TileType, WallSide, TileData } from '../core/types';

// ================================================================
// Snapshot d'une action
// ================================================================

export interface EditAction {
  /** Type d'action pour l'affichage dans la toolbar */
  label: string;
  /** Coordonnées affectées */
  x: number;
  y: number;
  /** État avant modification (pour undo) */
  before: TileSnapshot;
  /** État après modification (pour redo) */
  after: TileSnapshot;
}

export interface TileSnapshot {
  type: TileType;
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

  // Historique
  private undoStack: EditAction[] = [];
  private redoStack: EditAction[] = [];
  private maxHistory = 200;

  // Outil actif
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

  /**
   * Applique l'outil courant à la position donnée.
   * Retourne true si le terrain a été modifié.
   */
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
        // Juste un clic, pas de modification
        return false;
    }
  }

  // ================================================================
  // Actions d'édition
  // ================================================================

  paintTile(x: number, y: number, type: TileType): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile || tile.type === type) return false;

    const before = this.snapshot(tile);
    tile.type = type;
    tile.variation = Math.floor(Math.random() * 4);
    const after = this.snapshot(tile);

    this.pushAction({
      label: `Paint ${TileType[type]} at (${x},${y})`,
      x, y, before, after,
    });

    return true;
  }

  elevateTile(x: number, y: number): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return false;

    // Vérifie si on peut encore monter
    const maxElev = Math.max(...tile.elevation);
    if (maxElev >= 10) return false;

    const before = this.snapshot(tile);
    this.terrain.elevateTile(x, y);
    const after = this.snapshot(tile);

    this.pushAction({
      label: `Elevate (${x},${y})`,
      x, y, before, after,
    });

    return true;
  }

  lowerTile(x: number, y: number): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return false;

    const minElev = Math.min(...tile.elevation);
    if (minElev <= 0) return false;

    const before = this.snapshot(tile);
    this.terrain.lowerTile(x, y);
    const after = this.snapshot(tile);

    this.pushAction({
      label: `Lower (${x},${y})`,
      x, y, before, after,
    });

    return true;
  }

  toggleWall(x: number, y: number, side: WallSide): boolean {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return false;

    const before = this.snapshot(tile);
    this.terrain.toggleWall(x, y, side);
    const after = this.snapshot(tile);

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

  private snapshot(tile: TileData): TileSnapshot {
    return {
      type: tile.type,
      elevation: [...tile.elevation] as [number, number, number, number],
      walls: [...tile.walls] as [boolean, boolean, boolean, boolean],
      variation: tile.variation,
      building: tile.building,
    };
  }

  private applySnapshot(x: number, y: number, snap: TileSnapshot): void {
    const tile = this.terrain.tileAt(x, y);
    if (!tile) return;
    tile.type = snap.type;
    tile.elevation = snap.elevation;
    tile.walls = snap.walls;
    tile.variation = snap.variation;
    tile.building = snap.building;
  }

  private pushAction(action: EditAction): void {
    this.redoStack = []; // Invalide le redo après une nouvelle action
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
  }
}
