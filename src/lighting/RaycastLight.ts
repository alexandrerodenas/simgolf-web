/**
 * lighting/RaycastLight.ts — Raycast circulaire pour génération de maillage lumière
 *
 * Émet des rayons dans toutes les directions autour de la source.
 * Les points d'impact avec les obstacles deviennent les sommets (vertices)
 * d'un maillage de lumière. Ce maillage est rendu comme une zone éclairée.
 */

import * as THREE from 'three';
import type { IRaycastLight, RaycastHit } from './types';
import { TileType } from '../terrain-lib/types.js';

export interface RaycastLightMesh {
  /** Positions des sommets du maillage (monde, format {x,y,z}[]) */
  vertices: THREE.Vector3[];
  /** Indices des triangles (triangle fan) */
  indices: number[];
  /** Intensité moyenne du maillage */
  intensity: number;
  /** Texture du maillage (rendered) */
  texture: THREE.DataTexture | null;
}

export class RaycastLight {
  /**
   * Effectue un raycast circulaire et génère le maillage de lumière.
   *
   * @param light       Configuration de la source
   * @param tiles       Tuiles de la carte (pour détection d'obstacles)
   * @param heightMap   HeightMap du terrain (Float32Array (w+1)*(h+1))
   * @param mapW        Largeur de la carte en tuiles
   * @param mapH        Hauteur de la carte en tuiles
   * @param isBlocking  Fonction de test d'obstacle
   */
  static cast(
    light: IRaycastLight,
    tiles: { type: TileType; elevation: [number, number, number, number] }[],
    heightMap: Float32Array,
    mapW: number,
    mapH: number,
    isBlocking: (type: TileType) => boolean = RaycastLight.defaultBlocking,
  ): RaycastLightMesh {
    const { tileX, tileY, rayCount, radius, intensity: baseIntensity } = light;
    const hits: RaycastHit[] = [];
    const angleStep = (Math.PI * 2) / rayCount;

    for (let i = 0; i < rayCount; i++) {
      const angle = i * angleStep;
      const hit = RaycastLight.castRay(
        tileX, tileY,
        angle,
        radius,
        tiles,
        heightMap,
        mapW, mapH,
        isBlocking,
      );
      hits.push(hit);
    }

    // Générer le maillage (triangle fan depuis la source)
    const vertices: THREE.Vector3[] = [];
    const indices: number[] = [];

    // Centre = position de la source
    vertices.push(new THREE.Vector3(light.worldX, light.worldY, light.worldZ));

    // Ajouter tous les points d'impact comme sommets
    for (const hit of hits) {
      // Si pas d'impact, le point est à la distance max
      const dist = hit.hit ? hit.distance : radius;
      const hx = tileX + Math.cos(hit.angle) * dist;
      const hy = tileY + Math.sin(hit.angle) * dist;

      // Trouver la hauteur à cette position
      const elev = RaycastLight.sampleHeight(hx, hy, heightMap, mapW, mapH);

      const worldX = (hx - hy) * 64;
      const worldZ = (hx + hy) * 32;
      const worldY = elev * 32;

      vertices.push(new THREE.Vector3(worldX, worldY, worldZ));
    }

    // Triangle fan : centre + (i, i+1)
    for (let i = 1; i < vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    return {
      vertices,
      indices,
      intensity: baseIntensity,
      texture: null,
    };
  }

  /** Cast un seul rayon */
  private static castRay(
    ox: number, oy: number,
    angle: number,
    maxDist: number,
    tiles: { type: TileType; elevation: [number, number, number, number] }[],
    heightMap: Float32Array,
    mapW: number,
    mapH: number,
    isBlocking: (type: TileType) => boolean,
  ): RaycastHit {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const steps = Math.ceil(maxDist * 2); // Suréchantillonnage

    for (let s = 1; s <= steps; s++) {
      const t = s / steps * maxDist;
      const tx = ox + dx * t;
      const ty = oy + dy * t;
      const gx = Math.round(tx);
      const gy = Math.round(ty);

      if (gx < 0 || gx >= mapW || gy < 0 || gy >= mapH) {
        return { angle, distance: t, hitX: tx, hitY: ty, hitZ: 0, hit: true, isVertexHit: false };
      }

      const tile = tiles[gy * mapW + gx];
      if (tile && isBlocking(tile.type)) {
        const elev = RaycastLight.sampleHeight(tx, ty, heightMap, mapW, mapH);
        return {
          angle, distance: t,
          hitX: tx, hitY: ty, hitZ: elev,
          hit: true, isVertexHit: false,
        };
      }
    }

    return { angle, distance: maxDist, hitX: ox, hitY: oy, hitZ: 0, hit: false, isVertexHit: false };
  }

  /** Échantillonne la hauteur du terrain à une position flottante */
  private static sampleHeight(
    x: number, y: number,
    heightMap: Float32Array,
    mapW: number,
    mapH: number,
  ): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= mapW || iy < 0 || iy >= mapH) return 0;

    const gw = mapW + 1;
    // Interpolation bilinéaire simplifiée (prend la moyenne des 4 coins de la tuile)
    const hTL = heightMap[iy * gw + ix] || 0;
    const hTR = heightMap[iy * gw + ix + 1] || 0;
    const hBR = heightMap[(iy + 1) * gw + ix + 1] || 0;
    const hBL = heightMap[(iy + 1) * gw + ix] || 0;
    return (hTL + hTR + hBR + hBL) / 4;
  }

  /** Types bloquant la lumière par défaut */
  static defaultBlocking(type: TileType): boolean {
    return type === TileType.Building
      || type === TileType.Cliff
      || type === TileType.Tree;
  }

  /** Convertit le maillage en géométrie Three.js */
  static toGeometry(mesh: RaycastLightMesh): THREE.BufferGeometry {
    const positions: number[] = [];
    for (const v of mesh.vertices) {
      positions.push(v.x, v.y, v.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(mesh.indices);
    return geom;
  }
}
