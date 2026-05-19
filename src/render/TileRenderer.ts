/**
 * SimGolf Web — Tile Renderer
 *
 * Rendu d'une tuile individuelle en isométrique.
 * Gère : diamond du sol, élévation (pile de couches), murs,
 *       arbres/buissons/fleurs (imposteurs diamant).
 */

import Phaser from 'phaser';
import { TileData, TileType } from '../core/types';
import { TextureManager } from './TextureManager';
import { TILE_W, TILE_H, TILE_D } from './CoordinateSystem';
import { NEIGHBOR_FLAGS } from './AutotileRules';

// ================================================================
// Configuration des éléments décoratifs
// ================================================================

interface DecorationDef {
  textureKey: string;
  offsetY: number;   // Décalage Y vers le haut (négatif = plus haut)
  scale: number;     // Échelle du sprite
  alpha: number;     // Transparence
}

const DECO: Partial<Record<TileType, DecorationDef>> = {
  [TileType.TREE]: {
    textureKey: 'tile_TREE_0_0',
    offsetY: -20,
    scale: 0.7,
    alpha: 0.9,
  },
  [TileType.BUSH]: {
    textureKey: 'tile_BUSH_0_0',
    offsetY: -8,
    scale: 0.4,
    alpha: 0.85,
  },
  [TileType.FLOWER]: {
    textureKey: 'tile_FLOWER_0_0',
    offsetY: -6,
    scale: 0.3,
    alpha: 0.9,
  },
};

// ================================================================
// Tile Renderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private textures: TextureManager;
  private parent: Phaser.GameObjects.Container | null;

  constructor(scene: Phaser.Scene, textures: TextureManager, parent?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.textures = textures;
    this.parent = parent ?? null;
  }

  /**
   * Ajoute un objet au bon parent (container ou scène).
   */
  private addObj<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    if (this.parent) {
      this.parent.add(obj);
    }
    // Si pas de parent, l'objet est déjà ajouté à la scène par `scene.add.xxx()`
    return obj;
  }

  /**
   * Rendu complet d'une tuile à sa position isométrique.
   *
   * @param data     Données de la tuile
   * @param screenX  Position X à l'écran (coin haut du diamond)
   * @param screenY  Position Y à l'écran
   * @param autoTile Bits de voisinage pour l'autotile (optionnel)
   */
  renderTile(
    data: TileData,
    screenX: number,
    screenY: number,
    autoTile = 0,
  ): void {
    const elev = this.avgElevation(data);

    // ---- Sol : dessine un diamond empilé pour l'élévation ----
    const textureKey = this.textures.getTextureKey(
      data.type,
      data.variation,
      autoTile,
    );

    for (let layer = 0; layer <= elev; layer++) {
      const ly = screenY - layer * TILE_D;
      // Seule la couche du dessus a la texture, les couches inférieures
      // sont pleines (couleur terre/roche)
      const key = layer === elev ? textureKey : 'tile_DIRT';

      // Génère la texture "dirt" si elle n'existe pas
      if (layer < elev && !this.scene.textures.exists('tile_DIRT')) {
        this.generateDirtTexture();
      }

      const img = this.addObj(this.scene.add.image(screenX, ly, key));
      img.setOrigin(0.5, 0.5);
      img.setDepth(this.computeDepth(data, screenY));
      img.setName(`tile_${screenX}_${ly}_${layer}`);
    }

    // ---- Murs ----
    this.renderWalls(data, screenX, screenY, elev);

    // ---- Décoration (arbre/buisson/fleur au-dessus) ----
    this.renderDecoration(data, screenX, screenY, elev);
  }

  /**
   * Nettoie tous les sprites marqués comme tiles de la scène.
   * Utile pour re-render complet.
   */
  clearAll(): void {
    const children = this.scene.children.getAll();
    // Nettoie les images de tuiles (sol + décorations)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child instanceof Phaser.GameObjects.Image && child.name.startsWith('tile_')) {
        child.destroy();
      }
    }
    // Nettoie les graphics (murs) — on les identifie par leur depth > 100
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const child = this.scene.children.list[i];
      if (child instanceof Phaser.GameObjects.Graphics && child.name === '') {
        child.destroy();
      }
    }
  }

  // ================================================================
  // Murs
  // ================================================================

  private renderWalls(
    data: TileData,
    screenX: number,
    screenY: number,
    elev: number,
  ): void {
    if (!data.walls.some(w => w)) return;

    const wallKey = this.textures.getWallKey();
    const baseY = screenY + TILE_H / 2;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Nord (bord haut-gauche → haut-droit du diamond)
    if (data.walls[0]) {
      this.drawWallLine(wallKey, screenX - hw, baseY - hh,
        screenX, baseY - hh * 2, elev);
    }
    // Est (bord haut-droit → bas-droit)
    if (data.walls[1]) {
      this.drawWallLine(wallKey, screenX, baseY - hh * 2,
        screenX + hw, baseY - hh, elev);
    }
    // Sud (bord bas-droit → bas-gauche)
    if (data.walls[2]) {
      this.drawWallLine(wallKey, screenX + hw, baseY - hh,
        screenX, baseY, elev);
    }
    // Ouest (bord bas-gauche → haut-gauche)
    if (data.walls[3]) {
      this.drawWallLine(wallKey, screenX, baseY,
        screenX - hw, baseY - hh, elev);
    }
  }

  private drawWallLine(
    _textureKey: string,
    x1: number, y1: number,
    x2: number, y2: number,
    elev: number,
  ): void {
    // Mur depuis la base jusqu'à l'élévation actuelle
    const graphics = this.addObj(this.scene.add.graphics());
    const depth = y1 + 100; // profondeur approximative

    graphics.setDepth(depth);

    const wallColor = 0x887766;
    const wallTop = 0x998877;

    for (let layer = 0; layer <= elev; layer++) {
      const offsetY = layer * TILE_D;
      const ly1 = y1 - offsetY;
      const ly2 = y2 - offsetY;

      // Mur principal
      graphics.fillStyle(wallColor, 1);
      graphics.beginPath();
      graphics.moveTo(x1, ly1);
      graphics.lineTo(x2, ly2);
      graphics.lineTo(x2, ly2 + 3); // épaisseur vers le bas
      graphics.lineTo(x1, ly1 + 3);
      graphics.closePath();
      graphics.fillPath();

      // Surbrillance au sommet
      if (layer === elev) {
        graphics.fillStyle(wallTop, 0.6);
        graphics.beginPath();
        graphics.moveTo(x1, ly1);
        graphics.lineTo(x2, ly2);
        graphics.lineTo(x2, ly2 + 1);
        graphics.lineTo(x1, ly1 + 1);
        graphics.closePath();
        graphics.fillPath();
      }
    }
  }

  // ================================================================
  // Décoration
  // ================================================================

  private renderDecoration(
    data: TileData,
    screenX: number,
    screenY: number,
    elev: number,
  ): void {
    const def = DECO[data.type];
    if (!def) return;

    const y = screenY + def.offsetY - elev * TILE_D;
    const img = this.addObj(this.scene.add.image(screenX, y, def.textureKey));
    img.setOrigin(0.5, 0.5);
    img.setScale(def.scale);
    img.setAlpha(def.alpha);
    img.setDepth(this.computeDepth(data, screenY) + 0.5);
    img.setName(`tile_deco_${screenX}_${y}`);
  }

  // ================================================================
  // Helpers
  // ================================================================

  private avgElevation(data: TileData): number {
    return Math.round(
      (data.elevation[0] + data.elevation[1] +
       data.elevation[2] + data.elevation[3]) / 4
    );
  }

  /** Profondeur Z pour le tri isométrique */
  private computeDepth(data: TileData, screenY: number): number {
    return screenY + this.avgElevation(data) * 10;
  }

  /** Génère une texture de terre/roche pour les couches d'élévation */
  private generateDirtTexture(): void {
    const canvas = this.scene.textures.createCanvas('tile_DIRT', TILE_W + 4, TILE_H + 4);
    if (!canvas) return;

    const ctx = canvas.context;
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const cx = (TILE_W + 4) / 2;
    const cy = 2 + TILE_H / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();

    ctx.fillStyle = '#8B7355';
    ctx.fill();
    ctx.strokeStyle = '#6B5335';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    canvas.refresh();
  }
}

// Re-export
export { NEIGHBOR_FLAGS };
