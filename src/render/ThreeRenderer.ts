/**
 * render/ThreeRenderer.ts — Rendu Three.js du terrain SimGolf
 *
 * Conforme au pipeline original de Terrain.dll :
 *   - TextureTable3D pour l'indexation (DAT_100687f8)
 *   - View mode DAT_10070a14 pour la rotation des textures
 *   - Overlays blendés (FUN_100108f0)
 *   - Quads de chemins (FUN_1000f7f0)
 *   - Pas d'éclairage OpenGL (glDisable(GL_LIGHTING))
 *   - Normales fixes (glNormal3f(0,1,0))
 */

import * as THREE from 'three';
import { IMapState, TileType } from '../terrain-lib/index.js';
import { buildParklandMesh, MeshGroup } from '../world/terrain.js';
import { TextureTable3D } from './TextureTable3D.js';

export class ThreeRenderer {
  private scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private meshes: THREE.Mesh[] = [];
  private textureTable: TextureTable3D;
  private mapState: IMapState | null = null;

  // Cache de textures chargées
  private loadedTextures = new Map<string, THREE.Texture>();

  currentZoom = 1;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a3a1a);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.textureTable = new TextureTable3D('parkland');

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a3a1a, 1);
    container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setViewMode(mode: number): void {
    if (this.mapState) {
      this.mapState.viewMode = mode;
      // En mode réflexion, la texture est sélectionnée dynamiquement
      // via TextureTable3D.resolveDynamicTexture()
      // On doit re-générer les maillages
      this.rebuild();
    }
  }

  loadMap(mapState: IMapState): void {
    this.mapState = mapState;
    this.textureTable.setTheme(mapState.theme === 0 ? 'parkland' : 'parkland');
    this.rebuild();
  }

  /** Reconstruit tous les maillages après modification du terrain */
  rebuild(): void {
    if (!this.mapState) return;
    this.clearMeshes();
    const meshGroups = buildParklandMesh(this.mapState);
    this.buildMeshesFromGroups(meshGroups);
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.meshes = [];
  }

  private buildMeshesFromGroups(groups: MeshGroup[]): void {
    for (const group of groups) {
      // Résoudre la texture via TextureTable3D
      let texture: THREE.Texture | null = null;

      if (group.textureKey) {
        if (group.textureKey.startsWith('special:')) {
          // Texture spéciale (chemin/dirt)
          const slot = group.textureKey === 'special:path' ? 0x21 : 0x20;
          texture = this.textureTable.getSpecialTexture(slot);
        } else {
          // Texture normale ou avec bordure — traité par le cache composite
          texture = this.getOrLoadBorderTexture(group.textureKey);
        }
      }

      if (texture) {
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      } else {
        // Pas de texture : fallback couleur unie
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(
            group.fallbackColor[0],
            group.fallbackColor[1],
            group.fallbackColor[2],
          ),
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  /**
   * getOrLoadBorderTexture — Charge une texture depuis le cache.
   *
   * Format textureKey : "type:variation:suffix:isBorder"
   *   - isBorder=0 : texture 0001/0003 (pleine, sans bordure)
   *   - isBorder=1 : texture 0002/0004/0005 (avec bordure pré-dessinée)
   *
   * La variation encode directement le numéro 4-digit (0001-0005).
   */
  private getOrLoadBorderTexture(textureKey: string): THREE.Texture | null {
    if (this.loadedTextures.has(textureKey)) {
      return this.loadedTextures.get(textureKey)!;
    }

    // Parser la clé : "type:variation:suffix:isBorder"
    const parts = textureKey.split(':');
    if (parts.length !== 4) return null;
    const type = parseInt(parts[0], 10) as TileType;
    const variation = parseInt(parts[1], 10);
    const suffix = parts[2];

    const path = this.textureTable.buildPath(type, variation, suffix);
    if (!path) return null;

    const tex = this.loadTexture(path);
    this.loadedTextures.set(textureKey, tex);
    return tex;
  }

  private loadTexture(path: string): THREE.Texture {
    const tex = new THREE.TextureLoader().load(path);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearMeshes();
    this.renderer.dispose();
    this.loadedTextures.clear();
  }
}
