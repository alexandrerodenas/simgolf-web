/**
 * SimGolf Web — Tile Renderer (refactored)
 *
 * Rendu géométrique pur : chaque tuile est un quadrilatère
 * dont les 4 sommets sont projetés à leurs hauteurs réelles.
 *
 * Plus d'image diamond, plus de polygone de fond.
 * Les tuiles adjacentes partagent leurs sommets (heightmap) →
 * la surface est CONTINUE, sans escalier ni artefact.
 *
 * Principe :
 *   1. Lire les 4 hauteurs [hTL, hTR, hBR, hBL] depuis la heightmap
 *   2. Projeter chaque sommet (vx, vy, h) en 2D isométrique
 *   3. Dessiner le quadrilatère comme 2 triangles (Graphics)
 *   4. Colorer avec la palette du jeu selon le type de terrain
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { mapToScreen, TILE_D } from './CoordinateSystem';

// ================================================================
// Palette — extraite des textures du jeu Parkland
// ================================================================

interface PaletteEntry {
  /** Couleur principale (fill) */
  base: number;
  /** Teinte plus claire (triangle 1) */
  light: number;
  /** Teinte plus foncée (triangle 2) */
  dark: number;
  /** Bordure */
  edge: number;
}

const PALETTE: Record<string, PaletteEntry> = {
  GRASS:   { base: 0x4a8f4a, light: 0x5aac5a, dark: 0x3a7d3a, edge: 0x2d6b2d },
  FAIRWAY: { base: 0x4ea64e, light: 0x5ab85a, dark: 0x429442, edge: 0x3d883d },
  GREEN:   { base: 0x2ecc40, light: 0x35d648, dark: 0x27b338, edge: 0x22a030 },
  TEE:     { base: 0x5cb85c, light: 0x6ac46a, dark: 0x4ea64e, edge: 0x419841 },
  SAND:    { base: 0xe8d5a0, light: 0xf0dca8, dark: 0xdcc890, edge: 0xc8b878 },
  WATER:   { base: 0x3388cc, light: 0x4499dd, dark: 0x2277bb, edge: 0x1166aa },
  ROUGH:   { base: 0x4a7a2a, light: 0x568a35, dark: 0x3d6a20, edge: 0x30601a },
  DIRT:    { base: 0x8B7355, light: 0x9a8365, dark: 0x7a6345, edge: 0x6a5335 },
};

const DEFAULT_PALETTE: PaletteEntry = PALETTE.GRASS;

// ================================================================
// Helpers
// ================================================================

interface Point2D {
  x: number;
  y: number;
}

/**
 * Projette un sommet (vx, vy) à hauteur h en coordonnées écran,
 * relatif à l'origine de la carte (0,0).
 */
function vertexScreen(vx: number, vy: number, h: number): Point2D {
  const p = mapToScreen(vx, vy, h);
  const o = mapToScreen(0, 0);
  return { x: p.screenX - o.screenX, y: p.screenY - o.screenY };
}

// ================================================================
// Tile Renderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private quads: Phaser.GameObjects.Graphics[] = [];
  private debugLabels: Phaser.GameObjects.Text[] = [];
  private showDebug = false;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();

    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  // ================================================================
  // Rendu d'une tuile
  // ================================================================

  private renderTile(x: number, y: number, data: TileData): void {
    // 1. Hauteurs des 4 sommets (heightmap partagée → continuité)
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

    // 2. Projection des 4 sommets
    const tl = vertexScreen(x,     y,     hTL);
    const tr = vertexScreen(x + 1, y,     hTR);
    const br = vertexScreen(x + 1, y + 1, hBR);
    const bl = vertexScreen(x,     y + 1, hBL);

    // 3. Profondeur painter's (arrière → avant)
    const avgH = (hTL + hTR + hBR + hBL) / 4;
    const depth = (x + y) * 16 + Math.round(avgH) * 10;

    // 4. Palette selon le type
    const pal = paletteForType(data.type);

    // 5. Quadrilatère = 2 triangles
    const gfx = this.scene.add.graphics();
    gfx.setDepth(depth);
    gfx.setName(`tile_${x}_${y}`);

    // Triangle 1 : TL → TR → BR (teinte intermédiaire)
    gfx.fillStyle(pal.dark, 1);
    gfx.beginPath();
    gfx.moveTo(tl.x, tl.y);
    gfx.lineTo(tr.x, tr.y);
    gfx.lineTo(br.x, br.y);
    gfx.closePath();
    gfx.fillPath();

    // Triangle 2 : TL → BR → BL (teinte intermédiaire)
    gfx.fillStyle(pal.light, 1);
    gfx.beginPath();
    gfx.moveTo(tl.x, tl.y);
    gfx.lineTo(br.x, br.y);
    gfx.lineTo(bl.x, bl.y);
    gfx.closePath();
    gfx.fillPath();

    // Bordure fine
    gfx.lineStyle(0.5, pal.edge, 0.3);
    gfx.beginPath();
    gfx.moveTo(tl.x, tl.y);
    gfx.lineTo(tr.x, tr.y);
    gfx.lineTo(br.x, br.y);
    gfx.lineTo(bl.x, bl.y);
    gfx.closePath();
    gfx.strokePath();

    this.quads.push(gfx);

    // 6. Debug : code variante (basé sur la forme)
    if (this.showDebug) {
      const label = debugLabel(hTL, hTR, hBR, hBL);
      const cx = (tl.x + tr.x + br.x + bl.x) / 4;
      const cy = (tl.y + tr.y + br.y + bl.y) / 4;
      const txt = this.scene.add.text(cx, cy, label, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      });
      txt.setOrigin(0.5, 0.5);
      txt.setDepth(depth + 1);
      txt.setName(`debug_${x}_${y}`);
      this.debugLabels.push(txt);
    }
  }

  // ================================================================
  // Nettoyage
  // ================================================================

  clearAll(): void {
    for (const g of this.quads) g.destroy();
    this.quads = [];
    for (const t of this.debugLabels) t.destroy();
    this.debugLabels = [];
  }
}

// ================================================================
// Palette helper
// ================================================================

function paletteForType(type: TileType): PaletteEntry {
  switch (type) {
    case TileType.GRASS:        return PALETTE.GRASS;
    case TileType.FAIRWAY:      return PALETTE.FAIRWAY;
    case TileType.GREEN:        return PALETTE.GREEN;
    case TileType.SAND:         return PALETTE.SAND;
    case TileType.WATER:        return PALETTE.WATER;
    case TileType.ROUGH:        return PALETTE.ROUGH;
    case TileType.TEE:          return PALETTE.TEE;
    case TileType.BUILDING:     return PALETTE.DIRT;
    case TileType.TREE:         return PALETTE.GRASS;
    case TileType.BUSH:         return PALETTE.GRASS;
    case TileType.FLOWER:       return PALETTE.GRASS;
    default:                    return DEFAULT_PALETTE;
  }
}

// ================================================================
// Debug label — détermine le code A-E + index de forme
// ================================================================

function debugLabel(hTL: number, hTR: number, hBR: number, hBL: number): string {
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);
  const n = h.map(v => v - min) as [number, number, number, number];

  if (n.every(v => v === 0)) return 'A0001';

  const [TL, TR, BR, BL] = n;
  const max = Math.max(...n);

  if (max >= 2) {
    if (TL === 2 && TR === 2) return 'E0001';
    if (BR === 2 && BL === 2) return 'E0002';
    if (TR === 2 && BR === 2) return 'E0003';
    if (TL === 2 && BL === 2) return 'E0004';
    return 'E0005';
  }

  const elevated = [TL, TR, BR, BL].filter(v => v === 1).length;

  if (elevated === 2) {
    if (TL === 1 && TR === 1) return 'B0001';
    if (BR === 1 && BL === 1) return 'B0002';
    if (TR === 1 && BR === 1) return 'B0003';
    if (TL === 1 && BL === 1) return 'B0004';
    if (TL === 1 && BR === 1) return 'D0001';
    if (TR === 1 && BL === 1) return 'D0002';
    return 'B0005';
  }

  if (elevated === 1) {
    if (TL === 1) return 'C0001';
    if (TR === 1) return 'C0002';
    if (BR === 1) return 'C0003';
    if (BL === 1) return 'C0004';
    return 'C0005';
  }

  if (elevated === 3) return 'C0005';

  return 'A0001';
}
