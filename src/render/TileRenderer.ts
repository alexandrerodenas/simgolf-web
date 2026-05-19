/**
 * SimGolf Web — Tile Renderer (textures du jeu + heightmap)
 *
 * Chaque tuile est rendue comme une Image Phaser avec la texture
 * diamant extraite du jeu original, positionnée à la bonne hauteur
 * via la heightmap partagée → continuité des sommets garantie.
 *
 * Rendu : une Image par tuile, pas de Graphics.
 * Underground : stacking de diamants DIRT sous la surface (optionnel).
 */

import Phaser from 'phaser';
import { TileData, TileType, TerrainEngine } from '../core';
import { DiamondTextureFactory } from './DiamondTextureFactory';
import { mapToScreen, TILE_D } from './CoordinateSystem';

// ================================================================
// Mapping TileType → nom de palette pour les textures
// ================================================================

const TYPE_TO_PALETTE: Record<TileType, string> = {
  [TileType.GRASS]:        'GRASS',
  [TileType.FAIRWAY]:      'FAIRWAY',
  [TileType.GREEN]:        'GREEN',
  [TileType.SAND]:         'SAND',
  [TileType.WATER]:        'WATER',
  [TileType.ROUGH]:        'GRASS',
  [TileType.TEE]:          'FAIRWAY',
  [TileType.PATH]:         'GRASS',
  [TileType.BUILDING]:     'GRASS',
  [TileType.TREE]:         'GRASS',
  [TileType.BUSH]:         'GRASS',
  [TileType.FLOWER]:       'GRASS',
  [TileType.BRIDGE]:       'GRASS',
  [TileType.HOLE]:         'GREEN',
  [TileType.WATER_HAZARD]: 'WATER',
  [TileType.EMPTY]:        'GRASS',
};

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private diamondFactory: DiamondTextureFactory;
  /** Toutes les Images de tuiles actuellement rendues */
  private tileImages: Phaser.GameObjects.Image[] = [];

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainEngine,
    diamondFactory: DiamondTextureFactory,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.diamondFactory = diamondFactory;
  }

  /**
   * Rend TOUTES les tuiles de la grille (appelé par IsometricRenderer).
   * Détruit les anciennes Images et en crée de nouvelles.
   *
   * @param tiles  Tuiles à rendre (déjà filtrées par culling)
   */
  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    this.clearAll();

    for (const { x, y, data } of tiles) {
      this.renderTile(x, y, data);
    }
  }

  /**
   * Rendu d'une tuile individuelle.
   */
  private renderTile(x: number, y: number, data: TileData): void {
    // Hauteurs des 4 sommets depuis la heightmap
    const corners = this.terrain.getTileCorners(x, y);
    const avgH = Math.round(
      (corners[0] + corners[1] + corners[2] + corners[3]) / 4,
    );

    // Position écran (relatif à l'origine)
    const origin = mapToScreen(0, 0);
    const { screenX, screenY } = mapToScreen(x, y, 0);
    const sx = screenX - origin.screenX;
    const sy = screenY - origin.screenY - avgH * TILE_D;

    // Texture diamant selon le type de terrain
    const paletteName = TYPE_TO_PALETTE[data.type] ?? 'GRASS';
    const textureKey = this.diamondFactory.getDiamondKey(paletteName, data.variation);

    // Créer l'Image
    const img = this.scene.add.image(sx, sy, textureKey);
    img.setOrigin(0.5, 0.5);
    img.setDepth(this.computeDepth(x, y, avgH));
    img.setName(`tile_${x}_${y}`);

    this.tileImages.push(img);
  }

  /**
   * Profondeur Z pour le painter's algorithm.
   * Ordre : arrière (petit Y) → avant (grand Y), puis X pour les égalités.
   */
  private computeDepth(x: number, y: number, avgH: number): number {
    return (x + y) * 16 + avgH * 10;
  }

  /**
   * Détruit toutes les Images de tuiles.
   */
  clearAll(): void {
    for (const img of this.tileImages) {
      img.destroy();
    }
    this.tileImages = [];
  }
}
