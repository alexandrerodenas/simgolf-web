/**
 * lighting/FloodLight.ts — Propagation de lumière en 8 directions (Flood Fill)
 *
 * Algorithme : BFS/Flood-Fill dans 8 directions (N, NE, E, SE, S, SO, W, NO)
 * traversant un nombre défini de blocs. L'intensité décroît avec la distance
 * via un facteur falloff. Utilise un Uint8Array pour la propagation.
 */

import * as THREE from 'three';
import type { IFloodLight } from './types';
import { TileType } from '../terrain-lib/types.js';

/** Directions de propagation en 8-neighbors */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

export interface FloodFillResult {
  /** Texture de la zone éclairée */
  texture: THREE.DataTexture;
  /** Données brutes */
  data: Float32Array;
  /** Position de la source */
  tileX: number;
  tileY: number;
  /** Rayon effectif atteint */
  effectiveRadius: number;
}

export class FloodLight {
  /**
   * Effectue la propagation flood fill pour une source FloodLight.
   *
   * @param light    Configuration de la source
   * @param tiles    Tableau des tuiles (pour test d'obstacle)
   * @param mapW     Largeur de la carte
   * @param mapH     Hauteur de la carte
   * @param isBlocking Fonction qui détermine si une tuile bloque la lumière
   */
  static propagate(
    light: IFloodLight,
    tiles: { type: TileType }[],
    mapW: number,
    mapH: number,
    isBlocking: (type: TileType) => boolean = FloodLight.defaultBlocking,
  ): FloodFillResult {
    const size = mapW * mapH;
    const intensity = new Float32Array(size);
    const { tileX, tileY, maxDistance, falloff, intensity: baseIntensity } = light;

    // File d'attente BFS : [x, y, distanceParcourue, intensiteCourante]
    const queue: number[][] = [];

    // Tuile source
    const srcIdx = tileY * mapW + tileX;
    intensity[srcIdx] = Math.min(1, baseIntensity);
    queue.push([tileX, tileY, 0, intensity[srcIdx]]);

    let maxDist = 0;

    while (queue.length > 0) {
      const [cx, cy, dist, currIntensity] = queue.shift()!;

      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];

        if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;

        const ni = ny * mapW + nx;
        const neighborDist = dist + 1;

        if (neighborDist > maxDistance) continue;

        // Vérifier si la tuile voisine bloque la lumière
        const neighborType = tiles[ni]?.type ?? TileType.Rough;
        if (isBlocking(neighborType)) continue;

        // Calcul de la nouvelle intensité
        const newIntensity = currIntensity * (1 - falloff);

        // Si la tuile a déjà été visitée avec une intensité >=, on ignore
        if (intensity[ni] >= newIntensity) continue;

        intensity[ni] = newIntensity;
        maxDist = Math.max(maxDist, neighborDist);
        queue.push([nx, ny, neighborDist, newIntensity]);
      }
    }

    const texture = FloodLight.createTexture(intensity, mapW, mapH);

    return {
      texture,
      data: intensity,
      tileX,
      tileY,
      effectiveRadius: maxDist,
    };
  }

  /** Types de terrain qui bloquent la lumière */
  static defaultBlocking(type: TileType): boolean {
    return type === TileType.Building
      || type === TileType.Cliff
      || type === TileType.Tree;
  }

  /** Crée une texture depuis les données d'intensité */
  static createTexture(
    data: Float32Array,
    w: number,
    h: number,
  ): THREE.DataTexture {
    // Convertir Float32 → Uint8 pour la texture
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      pixels[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
    }

    const tex = new THREE.DataTexture(
      pixels, w, h,
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
}
