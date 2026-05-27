/**
 * lighting/AdvancedRaycastLight.ts — Raycast avancé ciblant les coins de tuiles
 *
 * Projette des rayons spécifiquement vers les sommets (coins) des polygones
 * du terrain pour générer des ombres dynamiques précises.
 *
 * Contrairement au RaycastLight standard qui émet des rayons à angles réguliers,
 * celui-ci cible chaque coin de tuile visible dans le cône d'éclairage.
 * Les rayons qui atteignent un coin sans obstruction deviennent des sommets
 * du maillage de lumière. Les rayons bloqués créent des arêtes d'ombre nettes.
 *
 * Résultat : des ombres parfaitement alignées sur la géométrie du terrain,
 * sans artefact d'échantillonnage angulaire.
 */

import * as THREE from 'three';
import type { IAdvancedRaycastLight, RaycastHit, TileVertex } from './types';
import { TileType } from '../terrain-lib/types.js';

export interface AdvancedRaycastMesh {
  /** Sommets du maillage de lumière */
  vertices: THREE.Vector3[];
  /** Indices des triangles */
  indices: number[];
  /** Intensité */
  intensity: number;
}

export class AdvancedRaycastLight {
  /**
   * Effectue le raycast avancé ciblant les coins de tuiles.
   */
  static cast(
    light: IAdvancedRaycastLight,
    tiles: { type: TileType; elevation: [number, number, number, number]; x: number; y: number }[],
    heightMap: Float32Array,
    mapW: number,
    mapH: number,
    isBlocking: (type: TileType) => boolean = AdvancedRaycastLight.defaultBlocking,
  ): AdvancedRaycastMesh {
    const { tileX, tileY, radius, rayCount, intensity: baseIntensity } = light;

    // 1. Collecter tous les coins de tuiles visibles dans le rayon
    const targets = AdvancedRaycastLight.collectTileVertices(
      tileX, tileY, radius, tiles, mapW, mapH,
    );

    // 2. Trier par angle autour de la source
    targets.sort((a, b) => {
      const angleA = Math.atan2(a.tileY - tileY, a.tileX - tileX);
      const angleB = Math.atan2(b.tileY - tileY, b.tileX - tileX);
      return angleA - angleB;
    });

    // 3. Cast un rayon vers chaque coin et filtrer ceux qui sont atteints
    const hits: RaycastHit[] = [];

    for (const target of targets) {
      const hit = AdvancedRaycastLight.castRayToVertex(
        tileX, tileY,
        target,
        radius,
        tiles, heightMap, mapW, mapH,
        isBlocking,
      );
      hits.push(hit);
    }

    // Si aucun coin atteint, créer un cercle simple
    if (hits.length === 0) {
      return AdvancedRaycastLight.fallbackCircle(light, heightMap, mapW, mapH);
    }

    // 4. Générer le maillage
    const vertices: THREE.Vector3[] = [];
    const indices: number[] = [];

    // Centre
    vertices.push(new THREE.Vector3(light.worldX, light.worldY, light.worldZ));

    for (const hit of hits) {
      const dist = hit.hit ? hit.distance : radius;
      const hx = tileX + Math.cos(hit.angle) * dist;
      const hy = tileY + Math.sin(hit.angle) * dist;
      const elev = AdvancedRaycastLight.sampleHeight(hx, hy, heightMap, mapW, mapH);

      vertices.push(new THREE.Vector3(
        (hx - hy) * 64,
        elev * 32,
        (hx + hy) * 32,
      ));
    }

    for (let i = 1; i < vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    return { vertices, indices, intensity: baseIntensity };
  }

  /** Collecte tous les coins de tuiles dans le rayon */
  private static collectTileVertices(
    cx: number, cy: number,
    radius: number,
    tiles: { type: TileType; elevation: [number, number, number, number]; x: number; y: number }[],
    mapW: number, mapH: number,
  ): TileVertex[] {
    const vertices: TileVertex[] = [];
    const r2 = radius * radius;

    for (const tile of tiles) {
      const dx = Math.abs(tile.x - cx);
      const dy = Math.abs(tile.y - cy);
      if (dx > radius || dy > radius) continue;
      if (dx * dx + dy * dy > r2) continue;

      // 4 coins de chaque tuile dans le rayon
      const [hTL, hTR, hBR, hBL] = tile.elevation;
      const corners: Array<{ corner: number; wx: number; wy: number }> = [
        { corner: 0, wx: tile.x, wy: tile.y },
        { corner: 1, wx: tile.x + 1, wy: tile.y },
        { corner: 2, wx: tile.x + 1, wy: tile.y + 1 },
        { corner: 3, wx: tile.x, wy: tile.y + 1 },
      ];

      for (const c of corners) {
        vertices.push({
          tileX: c.wx,
          tileY: c.wy,
          corner: c.corner,
          worldX: (c.wx - c.wy) * 64,
          worldY: 0, // sera calculé après
          worldZ: (c.wx + c.wy) * 32,
        });
      }
    }

    return vertices;
  }

  /** Cast un rayon vers un coin spécifique */
  private static castRayToVertex(
    ox: number, oy: number,
    target: TileVertex,
    maxDist: number,
    tiles: { type: TileType; elevation: [number, number, number, number] }[],
    heightMap: Float32Array,
    mapW: number, mapH: number,
    isBlocking: (type: TileType) => boolean,
  ): RaycastHit {
    const dx = target.tileX - ox;
    const dy = target.tileY - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    if (dist > maxDist) {
      return { angle, distance: maxDist, hitX: 0, hitY: 0, hitZ: 0, hit: false, isVertexHit: false };
    }

    // Suréchantillonnage : vérifier les tuiles le long du segment
    const steps = Math.ceil(dist * 2);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps * dist;
      const tx = ox + dx / dist * t;
      const ty = oy + dy / dist * t;
      const gx = Math.round(tx);
      const gy = Math.round(ty);

      if (gx < 0 || gx >= mapW || gy < 0 || gy >= mapH) continue;

      // Ne pas bloquer sur la tuile cible elle-même
      if (gx === Math.round(target.tileX) && gy === Math.round(target.tileY)) break;

      const tile = tiles[gy * mapW + gx];
      if (tile && isBlocking(tile.type)) {
        return { angle, distance: t, hitX: tx, hitY: ty, hitZ: 0, hit: true, isVertexHit: false };
      }
    }

    return {
      angle, distance: dist,
      hitX: target.tileX, hitY: target.tileY, hitZ: 0,
      hit: true, isVertexHit: true,
    };
  }

  /** Fallback : cercle simple */
  private static fallbackCircle(
    light: IAdvancedRaycastLight,
    heightMap: Float32Array,
    mapW: number,
    mapH: number,
  ): AdvancedRaycastMesh {
    const { tileX, tileY, radius, worldX, worldY, worldZ } = light;
    const vertices: THREE.Vector3[] = [new THREE.Vector3(worldX, worldY, worldZ)];
    const segments = 16;

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const tx = tileX + Math.cos(angle) * radius;
      const ty = tileY + Math.sin(angle) * radius;
      const elev = AdvancedRaycastLight.sampleHeight(tx, ty, heightMap, mapW, mapH);
      vertices.push(new THREE.Vector3(
        (tx - ty) * 64,
        elev * 32,
        (tx + ty) * 32,
      ));
    }

    const indices: number[] = [];
    for (let i = 1; i < vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    return { vertices, indices, intensity: light.intensity };
  }

  private static sampleHeight(
    x: number, y: number,
    heightMap: Float32Array,
    mapW: number, mapH: number,
  ): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= mapW || iy < 0 || iy >= mapH) return 0;
    const gw = mapW + 1;
    return (heightMap[iy * gw + ix] + heightMap[iy * gw + ix + 1]
      + heightMap[(iy + 1) * gw + ix + 1] + heightMap[(iy + 1) * gw + ix]) / 4;
  }

  static defaultBlocking(type: TileType): boolean {
    return type === TileType.Building
      || type === TileType.Cliff
      || type === TileType.Tree;
  }

  static toGeometry(mesh: AdvancedRaycastMesh): THREE.BufferGeometry {
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
