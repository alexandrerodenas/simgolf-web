/**
 * SimGolf Web — Tile Renderer (diamants du jeu + murs relief)
 *
 * Chaque tuile est un diamant isométrique (64×32) affiché à sa hauteur
 * moyenne. Les textures du jeu (RoughA0001-E0005.png) sont clipées en
 * diamant et choisies selon la forme A-E + variante cosmétique.
 *
 * L'ordre painter's algorithm garantit que les tuiles plus hautes sont
 * dessinées PAR-DESSUS les plus basses.
 *
 * Murs de soutènement : des faces couleur terre sont ajoutées sur les
 * côtés où la tuile domine son voisin → le relief devient visible.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { mapToScreen, TILE_W, TILE_H, TILE_D } from './CoordinateSystem';
import { getShapeLetter, getCosmeticVariant, buildTextureSourceName } from './ShapeClassifier';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private wallsGfx: Phaser.GameObjects.Graphics | null = null;
  private showDebug = false;
  private diamondCache = new Map<string, string>();

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();

    // 1. Trier par profondeur painter's (y + x + hauteur)
    tiles.sort((a, b) => {
      const da = a.x + a.y + this.avgHeight(a.x, a.y);
      const db = b.x + b.y + this.avgHeight(b.x, b.y);
      if (da !== db) return da - db;
      return a.x - b.x;
    });

    // 2. Murs de soutènement (tous dessinés avant les diamants)
    this.wallsGfx = this.scene.add.graphics();
    this.wallsGfx.setDepth(0);

    const origin = mapToScreen(0, 0);
    for (const { x, y } of tiles) {
      this.drawSupportWalls(x, y, origin);
    }

    // 3. Diamants (par-dessus les murs)
    for (const { x, y } of tiles) {
      this.renderTile(x, y, origin);
    }
  }

  // ================================================================
  // Mur de soutènement
  // ================================================================

  /**
   * Dessine un mur de terre sur les côtés où la tuile est plus haute
   * que son voisin. Le mur est un quadrilatère vertical entre les
   * deux niveaux d'élévation.
   */
  private drawSupportWalls(x: number, y: number, origin: { screenX: number; screenY: number }): void {
    const g = this.wallsGfx!;
    const myAvg = this.avgHeight(x, y);

    // 4 directions
    const neighbors = [
      { dx: 0, dy: -1 }, // N
      { dx: 1, dy: 0 },  // E
      { dx: 0, dy: 1 },  // S
      { dx: -1, dy: 0 }, // W
    ];

    // Les 4 sommets du diamond (positions relatives à mapToScreen(0,0))
    const diamondVerts = this.getDiamondVerts(x, y, myAvg, origin);

    // Pour chaque côté, l'arête du diamond (2 sommets consécutifs)
    const edgeIndices = [
      [0, 1], // N: top→right
      [1, 2], // E: right→bottom
      [2, 3], // S: bottom→left
      [3, 0], // W: left→top
    ];

    for (let d = 0; d < 4; d++) {
      const n = neighbors[d];
      const nTile = this.terrain.tileAt(x + n.dx, y + n.dy);
      if (!nTile) continue;

      const nAvg = this.avgHeight(x + n.dx, y + n.dy);
      if (myAvg <= nAvg) continue; // pas de mur si pas plus haut

      // Les 2 sommets du diamond à cette arête
      const e1 = diamondVerts[edgeIndices[d][0]];
      const e2 = diamondVerts[edgeIndices[d][1]];

      // Les mêmes points projetés à la hauteur du voisin
      const nDiamond = this.getDiamondVerts(x, y, nAvg, origin);
      const n1 = nDiamond[edgeIndices[d][0]];
      const n2 = nDiamond[edgeIndices[d][1]];

      // Quadrilatère du mur : dessus (haut) → dessous (bas voisin)
      g.fillStyle(0x8B7355, 1); // terre
      g.beginPath();
      g.moveTo(e1.x, e1.y);
      g.lineTo(e2.x, e2.y);
      g.lineTo(n2.x, n2.y);
      g.lineTo(n1.x, n1.y);
      g.closePath();
      g.fillPath();

      // Bordure foncée sur l'arête supérieure
      g.lineStyle(1, 0x6B5335, 0.8);
      g.beginPath();
      g.moveTo(e1.x, e1.y);
      g.lineTo(e2.x, e2.y);
      g.strokePath();
    }
  }

  /**
   * Retourne les 4 sommets du diamond [haut, droite, bas, gauche]
   * pour une tuile à une hauteur donnée.
   */
  private getDiamondVerts(
    x: number, y: number, h: number, origin: { screenX: number; screenY: number },
  ): Array<{ x: number; y: number }> {
    const center = mapToScreen(x, y, 0);
    const cx = center.screenX - origin.screenX;
    const cy = center.screenY - origin.screenY - h * TILE_D;
    const hw = TILE_W / 2; // 32
    const hh = TILE_H / 2; // 16
    return [
      { x: cx, y: cy - hh },      // top
      { x: cx + hw, y: cy },      // right
      { x: cx, y: cy + hh },      // bottom
      { x: cx - hw, y: cy },      // left
    ];
  }

  // ================================================================
  // Rendu d'une tuile
  // ================================================================

  private renderTile(x: number, y: number, origin: { screenX: number; screenY: number }): void {
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
    const avgH = (hTL + hTR + hBR + hBL) / 4;

    // Texture du jeu selon la forme A-E + variante
    const letter = getShapeLetter(hTL, hTR, hBR, hBL);
    const variant = getCosmeticVariant(x, y, 9);
    const sourceKey = buildTextureSourceName('Rough', letter, variant);
    const texKey = this.getOrCreateDiamond(sourceKey);
    if (!texKey) return;

    // Centre du diamant
    const center = mapToScreen(x, y, 0);
    const cx = center.screenX - origin.screenX;
    const cy = center.screenY - origin.screenY - avgH * TILE_D;

    // Image Phaser
    const img = this.scene.add.image(cx, cy, texKey);
    img.setOrigin(0.5, 0.5);
    const depth = (x + y) * 16 + Math.round(avgH) * 10;
    img.setDepth(depth + 5); // devant les murs
    img.setName(`tile_${x}_${y}`);
    this.tileImages.push(img);

    // Debug overlay
    if (this.showDebug) {
      const lbl = this.scene.add.text(cx, cy + 2, sourceKey, {
        fontFamily: 'monospace', fontSize: '8px', color: '#ffcc00',
        backgroundColor: 'rgba(0,0,0,0.6)', padding: { x: 2, y: 1 },
      });
      lbl.setOrigin(0.5, 0.5);
      lbl.setDepth(depth + 10);
      this.tileImages.push(lbl as unknown as Phaser.GameObjects.Image);
    }
  }

  // ================================================================
  // Texture diamant
  // ================================================================

  private getOrCreateDiamond(sourceKey: string): string | null {
    if (this.diamondCache.has(sourceKey))
      return this.diamondCache.get(sourceKey)!;

    if (!this.scene.textures.exists(sourceKey)) return null;

    const diamondKey = `diamond_${sourceKey}`;
    if (this.scene.textures.exists(diamondKey)) {
      this.diamondCache.set(sourceKey, diamondKey);
      return diamondKey;
    }

    const src = this.scene.textures.get(sourceKey).getSourceImage() as CanvasImageSource;
    if (!src) return null;

    const margin = 2;
    const cw = TILE_W + margin * 2; // 68
    const ch = TILE_H + margin * 2; // 36
    const canvas = this.scene.textures.createCanvas(diamondKey, cw, ch);
    if (!canvas) return null;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2;
    const hw = TILE_W / 2, hh = TILE_H / 2;

    // Clip diamant
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(src, cx - 32, cy - 32, 64, 64);
    ctx.restore();

    // Bordure fine
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.stroke();

    canvas.refresh();
    this.diamondCache.set(sourceKey, diamondKey);
    return diamondKey;
  }

  // ================================================================
  // Helpers
  // ================================================================

  private avgHeight(x: number, y: number): number {
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
    return (hTL + hTR + hBR + hBL) / 4;
  }

  clearAll(): void {
    for (const obj of this.tileImages) obj.destroy();
    this.tileImages = [];
    if (this.wallsGfx) {
      this.wallsGfx.destroy();
      this.wallsGfx = null;
    }
  }
}
