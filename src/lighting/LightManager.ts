/**
 * lighting/LightManager.ts — Gestion des sources lumineuses
 *
 * Maintient une liste de toutes les sources lumineuses (Flood, Raycast, Advanced)
 * et orchestre leur calcul. Supporte l'ajout/suppression/mise à jour en temps réel.
 */

import * as THREE from 'three';
import type { LightSource, IFloodLight, IRaycastLight, IAdvancedRaycastLight } from './types';
import { FloodLight, type FloodFillResult } from './FloodLight';
import { RaycastLight, type RaycastLightMesh } from './RaycastLight';
import { AdvancedRaycastLight, type AdvancedRaycastMesh } from './AdvancedRaycastLight';
import { TileType } from '../terrain-lib/types.js';

export type LightResult = FloodFillResult | RaycastLightMesh | AdvancedRaycastMesh;

export class LightManager {
  private sources: Map<string, LightSource> = new Map();
  private results: Map<string, LightResult> = new Map();
  private sceneObjects: Map<string, THREE.Mesh> = new Map();

  private tiles: { type: TileType; elevation: [number, number, number, number]; x: number; y: number }[] = [];
  private heightMap: Float32Array = new Float32Array();
  private mapW = 0;
  private mapH = 0;

  /** Vérrouillage des performances */
  private isComputing = false;

  /** Fonction de blocage customisable */
  private blockingFn: (type: TileType) => boolean;

  constructor(blockingFn?: (type: TileType) => boolean) {
    this.blockingFn = blockingFn ?? LightManager.defaultBlocking;
  }

  /** Définit les données de la carte */
  setMapData(
    tiles: { type: TileType; elevation: [number, number, number, number]; x: number; y: number }[],
    heightMap: Float32Array,
    w: number,
    h: number,
  ): void {
    this.tiles = tiles;
    this.heightMap = heightMap;
    this.mapW = w;
    this.mapH = h;
  }

  /** Ajoute une source lumineuse */
  addSource(light: LightSource): void {
    this.sources.set(light.id, light);
  }

  /** Supprime une source */
  removeSource(id: string): void {
    this.sources.delete(id);
    this.results.delete(id);
    this.disposeSceneObject(id);
  }

  /** Met à jour une source existante */
  updateSource(id: string, updates: Partial<LightSource>): void {
    const existing = this.sources.get(id);
    if (existing) {
      Object.assign(existing, updates);
      this.sources.set(id, { ...existing, ...updates } as LightSource);
    }
  }

  /** Calcule TOUTES les sources (mode Avancé) */
  computeAll(): Map<string, LightResult> {
    if (this.isComputing) return this.results;
    this.isComputing = true;

    this.results.clear();

    for (const [id, light] of this.sources) {
      const result = this.computeSingle(light);
      if (result) {
        this.results.set(id, result);
      }
    }

    this.isComputing = false;
    return this.results;
  }

  /** Calcule une source unique */
  computeSingle(light: LightSource): LightResult | null {
    if (!this.tiles.length) return null;

    switch (light.type) {
      case 'flood':
        return FloodLight.propagate(
          light as IFloodLight,
          this.tiles,
          this.mapW,
          this.mapH,
          this.blockingFn,
        );
      case 'raycast':
        return RaycastLight.cast(
          light as IRaycastLight,
          this.tiles,
          this.heightMap,
          this.mapW,
          this.mapH,
          this.blockingFn,
        );
      case 'advanced-raycast':
        return AdvancedRaycastLight.cast(
          light as IAdvancedRaycastLight,
          this.tiles,
          this.heightMap,
          this.mapW,
          this.mapH,
          this.blockingFn,
        );
      default:
        return null;
    }
  }

  /** Crée les objets Three.js pour le rendu des lumières */
  createSceneObjects(scene: THREE.Scene): void {
    for (const [id, result] of this.results) {
      if (this.sceneObjects.has(id)) continue;

      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.MeshBasicMaterial;

      if ('vertices' in result) {
        // Mesh-based (RaycastLightMesh | AdvancedRaycastMesh)
        const meshResult = result as RaycastLightMesh | AdvancedRaycastMesh;
        geometry = new THREE.BufferGeometry();
        const positions: number[] = [];
        for (const v of meshResult.vertices) {
          positions.push(v.x, v.y, v.z);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(meshResult.indices);

        material = new THREE.MeshBasicMaterial({
          color: 0xffffaa,
          transparent: true,
          opacity: Math.min(1, meshResult.intensity * 0.4),
          side: THREE.DoubleSide,
          depthWrite: false,
        });
      } else {
        // FloodFillResult — texture-based
        const floodResult = result as FloodFillResult;
        geometry = new THREE.PlaneGeometry(
          this.mapW * 128, this.mapH * 64,
        );

        material = new THREE.MeshBasicMaterial({
          map: floodResult.texture,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.sceneObjects.set(id, mesh);
    }
  }

  /** Met à jour les objets de scène existants */
  updateSceneObjects(): void {
    // TODO : mise à jour delta
  }

  /** Nettoie un objet de scène */
  private disposeSceneObject(id: string): void {
    const obj = this.sceneObjects.get(id);
    if (obj) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
      this.sceneObjects.delete(id);
    }
  }

  /** Nettoie tout */
  dispose(): void {
    for (const id of this.sceneObjects.keys()) {
      this.disposeSceneObject(id);
    }
    this.sources.clear();
    this.results.clear();
  }

  /** Récupère les résultats */
  getResults(): Map<string, LightResult> {
    return this.results;
  }

  /** Récupère les sources */
  getSources(): Map<string, LightSource> {
    return this.sources;
  }

  static defaultBlocking(type: TileType): boolean {
    return type === TileType.Building
      || type === TileType.Cliff
      || type === TileType.Tree;
  }
}
