/**
 * SimGolf Web — Tile Renderer (vertex-based heightmap)
 *
 * Chaque tuile est un polygone 3D à 4 sommets dont la hauteur vient
 * de la heightmap partagée → surface continue, pentes naturelles.
 *
 * Rendu sur Graphics batché (pas d'objets individuels).
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { TILE_W, TILE_H, TILE_D } from './CoordinateSystem';

// ================================================================
// Palette
// ================================================================

const PALETTE: Record<string, string[]> = {
  GRASS:       ['#3a7d3a', '#2d6b2d', '#4a8f4a', '#367036', '#2e5e2e'],
  FAIRWAY:     ['#4ea64e', '#429442', '#5ab85a', '#3d883d', '#4a9a4a'],
  GREEN:       ['#2ecc40', '#27b338', '#35d648', '#22a030', '#30c840'],
  TEE:         ['#5cb85c', '#4ea64e', '#6ac46a', '#419841', '#58b058'],
  SAND:        ['#e8d5a0', '#dcc890', '#f0dca8', '#c8b878', '#e0cc90'],
  WATER:       ['#3388cc', '#2277bb', '#4499dd', '#1166aa', '#3a90d0'],
  ROUGH:       ['#4a7a2a', '#3d6a20', '#568a35', '#30601a', '#4a7528'],
  PATH:        ['#c8b898', '#bca888', '#d4c4a0', '#a89878', '#c0b090'],
  DIRT:        ['#8B7355', '#7a6345', '#9a8365', '#6a5335', '#8a7355'],
  TREE:        ['#306020', '#204818', '#407828', '#183810', '#2a5a1e'],
  BUSH:        ['#4a7030', '#3d6028', '#568038', '#2e5018', '#426828'],
  FLOWER:      ['#cc4488', '#bb3377', '#dd5599', '#aa2266', '#c04080'],
};

const DEFAULT_COLOR = '#3a7d3a';

// ================================================================
// Point 2D
// ================================================================

interface Point2D { x: number; y: number; }

// ================================================================
// TileRenderer
// ================================================================

export class TileRenderer {
  private terrain: TerrainEngine;

  constructor(terrain: TerrainEngine) {
    this.terrain = terrain;
  }

  /**
   * Position écran d'un sommet (vx, vy) à une hauteur h.
   */
  private vertex(vx: number, vy: number, h: number): Point2D {
    return {
      x: (vx - vy) * (TILE_W / 2),
      y: (vx + vy) * (TILE_H / 2) - h * TILE_D,
    };
  }

  /**
   * Dessine UNE tuile sur le Graphics.
   * Appelé dans l'ordre painter's (back→front) par IsometricRenderer.
   */
  drawTile(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    data: TileData,
  ): void {
    // 1. Hauteurs des 4 sommets (heightmap partagée)
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

    // 2. Positions écran relatives
    const origin = this.vertex(0, 0, 0);
    const rel = (vx: number, vy: number, h: number) => {
      const p = this.vertex(vx, vy, h);
      return { x: p.x - origin.x, y: p.y - origin.y };
    };

    const tl = rel(x,     y,     hTL);
    const tr = rel(x + 1, y,     hTR);
    const br = rel(x + 1, y + 1, hBR);
    const bl = rel(x,     y + 1, hBL);

    // 3. Profondeur painter's = position grille
    const depth = (x + y) * 16;

    // 4. Surface pentue (polygone à 4 sommets)
    this.drawSlopedFace(gfx, tl, tr, br, bl, data, depth);

    // 5. Décorations (arbres, buissons)
    if (data.type === TileType.TREE ||
        data.type === TileType.BUSH ||
        data.type === TileType.FLOWER) {
      this.drawDecoration(gfx, tl, tr, br, bl, data, depth);
    }
  }

  // ================================================================
  // Surface pentue
  // ================================================================

  private drawSlopedFace(
    gfx: Phaser.GameObjects.Graphics,
    tl: Point2D, tr: Point2D, br: Point2D, bl: Point2D,
    data: TileData,
    depth: number,
  ): void {
    const colors = this.getColors(data.type);
    const baseColor = colors[data.variation % colors.length];
    const darkColor = this.darken(baseColor, 0.25);
    const lightColor = this.lighten(baseColor, 0.10);

    const colorNum = Phaser.Display.Color.HexStringToColor(baseColor).color;

    // === Polygone plein ===
    gfx.fillStyle(colorNum, 1);
    gfx.beginPath();
    gfx.moveTo(tl.x, tl.y);
    gfx.lineTo(tr.x, tr.y);
    gfx.lineTo(br.x, br.y);
    gfx.lineTo(bl.x, bl.y);
    gfx.closePath();
    gfx.fillPath();

    // === Bordure fine ===
    gfx.lineStyle(0.5, 0x000000, 0.15);
    gfx.strokePath();

    gfx.setDepth(depth);
  }

  // ================================================================
  // Décorations
  // ================================================================

  private drawDecoration(
    gfx: Phaser.GameObjects.Graphics,
    tl: Point2D, tr: Point2D, br: Point2D, bl: Point2D,
    data: TileData,
    depth: number,
  ): void {
    const def = DECO[data.type];
    if (!def) return;

    // Centre de la surface pentue = moyenne des 4 coins
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    const colors = this.getColors(data.type);
    const baseColor = colors[data.variation % colors.length];
    const colorNum = Phaser.Display.Color.HexStringToColor(baseColor).color;

    // Petit diamant
    const s = def.scale * 8;
    const dy = cy - def.offsetY;

    gfx.fillStyle(colorNum, 0.85);
    gfx.beginPath();
    gfx.moveTo(cx, dy - s);
    gfx.lineTo(cx + s, dy);
    gfx.lineTo(cx, dy + s);
    gfx.lineTo(cx - s, dy);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(0.5, 0x000000, 0.15);
    gfx.strokePath();

    gfx.setDepth(depth + 5);
  }

  // ================================================================
  // Helpers
  // ================================================================

  private getColors(type: TileType): string[] {
    switch (type) {
      case TileType.GRASS:   return PALETTE.GRASS;
      case TileType.FAIRWAY: return PALETTE.FAIRWAY;
      case TileType.GREEN:   return PALETTE.GREEN;
      case TileType.TEE:     return PALETTE.TEE;
      case TileType.SAND:    return PALETTE.SAND;
      case TileType.WATER:   return PALETTE.WATER;
      case TileType.ROUGH:   return PALETTE.ROUGH;
      case TileType.PATH:    return PALETTE.PATH;
      case TileType.TREE:    return PALETTE.TREE;
      case TileType.BUSH:    return PALETTE.BUSH;
      case TileType.FLOWER:  return PALETTE.FLOWER;
      default:               return PALETTE.GRASS;
    }
  }

  private lighten(hex: string, factor: number): string {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) * (1 + factor));
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) * (1 + factor));
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) * (1 + factor));
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  private darken(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16) * (1 - factor);
    const g = parseInt(hex.slice(3, 5), 16) * (1 - factor);
    const b = parseInt(hex.slice(5, 7), 16) * (1 - factor);
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  /** Nettoie les Graphics (délégué à IsometricRenderer) */
  clearAll(): void { /* unused — Graphics gérés par le renderer principal */ }
}

// ================================================================
// Décorations
// ================================================================

interface DecorationDef { offsetY: number; scale: number; }

const DECO: Partial<Record<TileType, DecorationDef>> = {
  [TileType.TREE]:   { offsetY: 12, scale: 0.7 },
  [TileType.BUSH]:   { offsetY: 6,  scale: 0.4 },
  [TileType.FLOWER]: { offsetY: 4,  scale: 0.3 },
};
