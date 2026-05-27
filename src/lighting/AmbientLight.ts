/**
 * lighting/AmbientLight.ts — Lumière ambiante basée sur la Height Map
 *
 * Utilise la hauteur du terrain pour placer des sources lumineuses uniquement
 * sur les blocs situés au-dessus de la surface. Simule un éclairage directionnel
 * frappant le relief tout en laissant les zones "sous la surface" dans l'obscurité.
 *
 * Algorithme :
 *   1. Génération d'un masque d'exposition (tuiles exposées à la surface)
 *   2. Calcul d'un gradient directionnel (soleil) basé sur le relief
 *   3. Les tuiles exposées qui font face au soleil sont éclairées
 *   4. Les zones sous la surface (grottescavées) restent sombres
 */

import * as THREE from 'three';
import type { ILightingConfig } from './types';
import { TileType } from '../terrain-lib/types.js';

export interface IAmbientLightData {
  /** Texture de lumière ambiante (format DataTexture) */
  texture: THREE.DataTexture;
  /** Données brutes (0-255 par pixel) */
  data: Uint8Array;
  /** Largeur/hauteur en tuiles */
  width: number;
  height: number;
}

export class AmbientLight {
  private config: ILightingConfig;
  private data: IAmbientLightData | null = null;

  /** Direction de la lumière (normalisée) */
  private sunDirection: THREE.Vector3;

  constructor(config: ILightingConfig) {
    this.config = config;
    // Lumière directionnelle venant du haut-gauche (isométrique)
    this.sunDirection = new THREE.Vector3(-0.5, 0.8, -0.3).normalize();
  }

  /**
   * Calcule l'éclairage ambiant à partir de la heightmap et des types de tuiles.
   *
   * @param heightMap  Float32Array de taille (w+1)*(h+1) — coins des tuiles
   * @param tiles      ITile[]  — types de terrain pour détection d'exposition
   * @param w          Largeur en tuiles
   * @param h          Hauteur en tuiles
   */
  compute(
    heightMap: Float32Array,
    tiles: { type: TileType; elevation: [number, number, number, number] }[],
    w: number,
    h: number,
  ): IAmbientLightData {
    const data = new Uint8Array(w * h);
    const gw = w + 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;

        // Récupérer les 4 hauteurs de coins de cette tuile
        const hTL = heightMap[y * gw + x];
        const hTR = heightMap[y * gw + x + 1];
        const hBR = heightMap[(y + 1) * gw + x + 1];
        const hBL = heightMap[(y + 1) * gw + x];

        const tile = tiles[idx];

        // Hauteur moyenne de la tuile
        const avgH = (hTL + hTR + hBR + hBL) / 4;

        // Surface exposée : tuiles avec hauteur moyenne > 0
        // et dont le type est un type de surface (pas du vide)
        const isExposed = this.isSurfaceType(tile.type);

        if (!isExposed || avgH <= 0) {
          // Sous la surface → sombre
          data[idx] = 0;
          continue;
        }

        // Calcul du gradient de hauteur (normale de la tuile)
        const normal = this.computeTileNormal(hTL, hTR, hBR, hBL);

        // Cosinus de l'angle entre la normale et la direction du soleil
        const ndotl = Math.max(0, normal.dot(this.sunDirection));

        // Éclairage ambiant de base (0.15) + contribution directionnelle (0.85 * ndotl)
        const ambientBase = 0.15;
        const brightness = ambientBase + (1 - ambientBase) * ndotl;

        data[idx] = Math.round(Math.min(1, brightness) * 255);
      }
    }

    const texture = this.createTexture(data, w, h);
    this.data = { texture, data, width: w, height: h };
    return this.data;
  }

  /** Calcule la normale d'une tuile à partir de ses 4 hauteurs de coin */
  private computeTileNormal(
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): THREE.Vector3 {
    // Vecteurs du plan de la tuile (échelle isométrique)
    // La tuile fait 1×1 en grille → 128×64 en monde
    const v1 = new THREE.Vector3(64, (hTR - hTL) * 32, 32);   // TL→TR
    const v2 = new THREE.Vector3(-64, (hBL - hTL) * 32, 32);  // TL→BL
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
    return normal;
  }

  /** Types qui sont en surface (exposés à la lumière) */
  private isSurfaceType(type: TileType): boolean {
    // Tous les types de surface sont exposés
    // Les types 'souterrains' (si existent) seraient exclus
    return type !== TileType.Path; // Path est traité à part
  }

  /** Crée la texture Three.js */
  private createTexture(
    data: Uint8Array,
    w: number,
    h: number,
  ): THREE.DataTexture {
    const tex = new THREE.DataTexture(
      data, w, h,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Récupère les données calculées */
  getData(): IAmbientLightData | null {
    return this.data;
  }

  /** Change la direction du soleil (pour debug) */
  setSunDirection(dir: THREE.Vector3): void {
    this.sunDirection.copy(dir).normalize();
  }

  /** Nettoie les ressources */
  dispose(): void {
    if (this.data?.texture) {
      this.data.texture.dispose();
    }
    this.data = null;
  }
}
