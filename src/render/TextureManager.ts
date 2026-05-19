/**
 * SimGolf Web — Texture Manager
 *
 * Génère les textures procédurales pour le rendu isométrique.
 * Chaque type de tuile + type de transition obtient une texture canvas
 * générée par code (pas besoin d'assets externes).
 *
 * Palette inspirée du jeu original SimGolf.
 */

import Phaser from 'phaser';
import { TileType } from '../core/types';
import { TILE_W, TILE_H, TILE_D } from './CoordinateSystem';

// ================================================================
// Palette
// ================================================================

const COLOR = {
  GRASS:       ['#3a7d3a', '#2d6b2d', '#4a8f4a', '#367036', '#2e5e2e'],
  FAIRWAY:     ['#4ea64e', '#429442', '#5ab85a', '#3d883d', '#4a9a4a'],
  GREEN:       ['#2ecc40', '#27b338', '#35d648', '#22a030', '#30c840'],
  TEE:         ['#5cb85c', '#4ea64e', '#6ac46a', '#419841', '#58b058'],
  SAND:        ['#e8d5a0', '#dcc890', '#f0dca8', '#c8b878', '#e0cc90'],
  WATER:       ['#3388cc', '#2277bb', '#4499dd', '#1166aa', '#3a90d0'],
  ROUGH:       ['#4a7a2a', '#3d6a20', '#568a35', '#30601a', '#4a7528'],
  PATH:        ['#c8b898', '#bca888', '#d4c4a0', '#a89878', '#c0b090'],
  BUILDING:    ['#996644', '#885533', '#aa7755', '#774422', '#885533'],
  TREE:        ['#2d5a1e', '#224a16', '#386a24', '#1a3a10', '#2a5018'],
  BUSH:        ['#4a7030', '#3d6028', '#568038', '#2e5018', '#426828'],
  FLOWER:      ['#cc4488', '#bb3377', '#dd5599', '#aa2266', '#c04080'],
  WALL:        ['#887766', '#776655', '#998877', '#665544', '#807060'],
};

const DEFAULT_COLOR = COLOR.GRASS[0];

// ================================================================
// Cache de textures
// ================================================================

interface TextureKey {
  type: TileType;
  variation: number;
  /** Environnement (autotile) — 4 bits NSEW */
  neighbors: number; // 0-15
}

/**
 * Gère la création et le cache des textures de tuiles.
 *
 * Chaque tuile est rendue comme un diamond 64×40 (largeur×hauteur
 * incluant la profondeur d'élévation) en vue isométrique.
 */
export class TextureManager {
  private scene: Phaser.Scene;
  private cache: Map<string, string> = new Map();
  private ready = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Initialise toutes les textures de base.
   * À appeler dans create() de la scène.
   */
  init(): void {
    if (this.ready) return;

    // Génère les textures de base pour chaque type × 4 variations
    for (const type of Object.values(TileType)) {
      if (typeof type !== 'number') continue;
      for (let v = 0; v < 4; v++) {
        this.generateTexture(type as TileType, v, 0);
      }
    }

    // Wall side texture
    this.generateWallTexture();

    this.ready = true;
    console.log(`[TextureManager] ${this.cache.size} textures générées procéduralement`);
  }

  /**
   * Récupère la clé de texture pour une tuile donnée.
   * Retourne la texture de base si la variante autotile n'existe pas.
   */
  getTextureKey(
    type: TileType,
    variation: number,
    neighbors: number = 0,
  ): string {
    if (!this.ready) this.init();

    // Essaie d'abord avec autotile
    const fullKey = `tile_${type}_${variation}_${neighbors}`;
    if (this.cache.has(fullKey)) return fullKey;

    // Fallback : sans autotile
    const baseKey = `tile_${type}_${variation}_0`;
    if (this.cache.has(baseKey)) return baseKey;

    // Fallback ultime : variation 0
    const fallbackKey = `tile_${type}_0_0`;
    if (this.cache.has(fallbackKey)) return fallbackKey;

    // Génère à la volée
    this.generateTexture(type, variation, neighbors);
    return `tile_${type}_${variation}_${neighbors}`;
  }

  /**
   * Clé pour le rendu des murs
   */
  getWallKey(): string {
    return 'wall_texture';
  }

  /**
   * Vérifie si le manager est initialisé
   */
  isReady(): boolean {
    return this.ready;
  }

  // ================================================================
  // Génération procédurale
  // ================================================================

  private generateTexture(
    type: TileType,
    variation: number,
    neighbors: number,
  ): void {
    const key = `tile_${type}_${variation}_${neighbors}`;
    if (this.cache.has(key)) return;

    // Le canvas fait 68×44 : 64 large + 2px marge de chaque côté,
    // 32 de hauteur du diamond + 8 pour l'élévation max + 4 marge
    const canvasW = TILE_W + 4;    // 68
    const canvasH = TILE_H + 12;   // 44
    const canvas = this.scene.textures.createCanvas(key, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const colors = COLOR[this.typeToPalette(type)] ?? [DEFAULT_COLOR];
    const baseColor = colors[variation % colors.length];

    // Dessine le diamond principal
    const cx = canvasW / 2;  // centre X
    const cy = 4 + TILE_H / 2;  // centre Y (décalé vers le haut pour laisser place à l'élévation)

    ctx.save();
    ctx.translate(cx, cy);

    this.drawDiamond(ctx, baseColor, variation, neighbors);

    ctx.restore();

    canvas.refresh();
    this.cache.set(key, key);
  }

  private drawDiamond(
    ctx: CanvasRenderingContext2D,
    baseColor: string,
    variation: number,
    neighbors: number,
  ): void {
    const hw = TILE_W / 2;  // 32
    const hh = TILE_H / 2;  // 16

    // Remplissage de base
    ctx.beginPath();
    ctx.moveTo(0, -hh);           // haut
    ctx.lineTo(hw, 0);            // droite
    ctx.lineTo(0, hh);            // bas
    ctx.lineTo(-hw, 0);           // gauche
    ctx.closePath();

    // Dégradé diagonal pour donner du relief (gauche→droite)
    const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
    grad.addColorStop(0, this.lighten(baseColor, 0.12));
    grad.addColorStop(0.5, baseColor);
    grad.addColorStop(1, this.darken(baseColor, 0.15));

    ctx.fillStyle = grad;
    ctx.fill();

    // Bordure fine
    ctx.strokeStyle = this.darken(baseColor, 0.25);
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Petit point de texture aléatoire pour casser l'uniformité
    if (variation > 0) {
      ctx.fillStyle = this.darken(baseColor, 0.05 + variation * 0.02);
      for (let i = 0; i < 3 + variation; i++) {
        const px = (Math.sin(variation * 7 + i * 13) * hw * 0.5);
        const py = (Math.cos(variation * 11 + i * 7) * hh * 0.5);
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private generateWallTexture(): void {
    const key = 'wall_texture';
    const w = 8;
    const h = TILE_H + 16; // Hauteur max d'un mur
    const canvas = this.scene.textures.createCanvas(key, w, h);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, w, h);

    // Dégradé vertical pierre
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#a09080');
    grad.addColorStop(0.3, '#908070');
    grad.addColorStop(0.6, '#807060');
    grad.addColorStop(1, '#706050');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Lignes de pierre
    ctx.strokeStyle = '#605040';
    ctx.lineWidth = 0.5;
    for (let y = 4; y < h; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    canvas.refresh();
    this.cache.set(key, key);
  }

  // ================================================================
  // Helpers
  // ================================================================

  private typeToPalette(type: TileType): keyof typeof COLOR {
    switch (type) {
      case TileType.GRASS:        return 'GRASS';
      case TileType.FAIRWAY:      return 'FAIRWAY';
      case TileType.GREEN:        return 'GREEN';
      case TileType.TEE:          return 'TEE';
      case TileType.SAND:         return 'SAND';
      case TileType.WATER:        return 'WATER';
      case TileType.ROUGH:        return 'ROUGH';
      case TileType.PATH:         return 'PATH';
      case TileType.BUILDING:     return 'BUILDING';
      case TileType.TREE:         return 'TREE';
      case TileType.BUSH:         return 'BUSH';
      case TileType.FLOWER:       return 'FLOWER';
      default:                    return 'GRASS';
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
}
