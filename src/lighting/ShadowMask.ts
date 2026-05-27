/**
 * lighting/ShadowMask.ts — Shadow Mask pour le mode Basic
 *
 * Génère une texture 2D couvrant le monde. Chaque pixel représente l'opacité
 * de l'ombre en fonction de la distance au bord du maillage (light bleed).
 * Les blocs au-delà de la distance de light bleed sont totalement noirs
 * pour masquer l'intérieur du terrain.
 */

import * as THREE from 'three';
import type { IShadowMaskConfig, ShadowMaskData } from './types';

export class ShadowMask {
  private data: ShadowMaskData | null = null;
  private config: IShadowMaskConfig;
  private texture: THREE.DataTexture | null = null;

  constructor(config: IShadowMaskConfig) {
    this.config = config;
  }

  /** Génère le masque d'ombre depuis la heightmap du terrain */
  generate(heightMap: Float32Array): void {
    const { mapWidth: w, mapHeight: h, lightBleedDistance: bleed } = this.config;
    this.data = new Uint8Array(w * h);

    // Pour chaque tuile, calculer la distance au bord du maillage
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const distToEdge = this.distanceToEdge(x, y, w, h);
        const hVal = heightMap[idx];

        // Light bleed : les tuiles près du bord sont éclairées
        // Les tuiles enterrées (sous la surface) sont noires
        if (distToEdge <= bleed && hVal > 0) {
          // Proche du bord + au-dessus de la surface → atténuation linéaire
          const brightness = Math.max(0, 1 - distToEdge / bleed);
          this.data[idx] = Math.round(brightness * 255);
        } else if (distToEdge > bleed) {
          // Loin du bord → noir complet (intérieur du terrain)
          this.data[idx] = 0;
        } else {
          // En surface, loin du bord → pleine lumière
          this.data[idx] = 255;
        }
      }
    }

    this.createTexture();
  }

  /** Génère depuis un masque booléen (true = tuile visible/exposée) */
  generateFromExposedMask(exposedMask: Uint8Array): void {
    const { mapWidth: w, mapHeight: h, lightBleedDistance: bleed } = this.config;
    this.data = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!exposedMask[idx]) {
          // Tuile non exposée → noire
          this.data[idx] = 0;
          continue;
        }

        const distToEdge = this.distanceToEdge(x, y, w, h);
        if (distToEdge <= bleed) {
          const brightness = Math.max(0, 1 - distToEdge / bleed);
          this.data[idx] = Math.round(brightness * 255);
        } else {
          this.data[idx] = 255;
        }
      }
    }

    this.createTexture();
  }

  /** Crée ou met à jour la texture Three.js */
  private createTexture(): void {
    if (!this.data) return;
    const { mapWidth: w, mapHeight: h } = this.config;

    if (this.texture) {
      this.texture.image.data = this.data;
      this.texture.needsUpdate = true;
    } else {
      this.texture = new THREE.DataTexture(
        this.data,
        w, h,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.wrapS = THREE.ClampToEdgeWrapping;
      this.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.texture.needsUpdate = true;
    }
  }

  /** Calcule la distance au bord du maillage */
  private distanceToEdge(x: number, y: number, w: number, h: number): number {
    const dx = Math.min(x, w - 1 - x);
    const dy = Math.min(y, h - 1 - y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Réinitialise les données */
  clear(): void {
    this.data = null;
    this.texture = null;
  }

  /** Récupère les données brutes pour lecture rapide */
  getData(): ShadowMaskData | null {
    return this.data;
  }

  /** Récupère la texture Three.js */
  getTexture(): THREE.DataTexture | null {
    return this.texture;
  }

  /** Récupère l'opacité à une position grille (0-1) */
  getOpacityAt(x: number, y: number): number {
    if (!this.data) return 1.0;
    const { mapWidth: w } = this.config;
    const idx = y * w + x;
    if (idx < 0 || idx >= this.data.length) return 0;
    return this.data[idx] / 255;
  }

  /** Applique la texture comme masque sur un matériau */
  applyToMaterial(material: THREE.MeshBasicMaterial): void {
    if (this.texture) {
      // Utilisé comme masque d'occlusion ambiante
      material.aoMap = this.texture;
      material.aoMapIntensity = 1.0;
      material.needsUpdate = true;
    }
  }

  /** Exporte le masque en format adapté à un canvas debug */
  toImageData(): ImageData | null {
    if (!this.data) return null;
    const { mapWidth: w, mapHeight: h } = this.config;
    const img = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = this.data[i];
      img[i * 4] = 255 - v;      // R → ombre
      img[i * 4 + 1] = 255 - v;  // G
      img[i * 4 + 2] = 255 - v;  // B
      img[i * 4 + 3] = 255;      // A
    }
    return new ImageData(img, w, h);
  }
}
