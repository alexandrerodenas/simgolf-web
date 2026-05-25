/**
 * render/ThreeRenderer.ts — Rendu Three.js du terrain SimGolf
 *
 * Conforme au pipeline original de Terrain.dll :
 *   - Pas d'éclairage OpenGL (glDisable(GL_LIGHTING))
 *   - Pas de normales 3D
 *   - Matériau basique : texture × vertex colors
 *   - Chaque passe de rendu = 1 triangle (ou quad complet)
 *
 * Sources : analyse rizin de Terrain.dll
 *   renderTile @ 0x100080e0 : glDisable(GL_LIGHTING), glNormal3f(0,1,0)
 *   render_single_tile @ 0x1000e6c0 : multi-pass avec textures pré-calculées
 */

import * as THREE from 'three';
import { IMapState } from '../terrain-lib/index.js';
import { buildParklandMesh, MeshGroup } from '../world/terrain.js';

export class ThreeRenderer {
  private scene: THREE.Scene;
  /** Caméra orthographique (publique pour les contrôles) */
  camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private meshes: THREE.Mesh[] = [];
  private textureLoader: THREE.TextureLoader;
  private textureCache = new Map<string, THREE.Texture>();

  currentZoom = 1;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a3a1a);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a3a1a, 1);
    container.appendChild(this.renderer.domElement);

    this.textureLoader = new THREE.TextureLoader();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  loadMap(mapState: IMapState): void {
    const meshGroups = buildParklandMesh(mapState);
    this.buildMeshesFromGroups(meshGroups);
  }

  private buildMeshesFromGroups(groups: MeshGroup[]): void {
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

    for (const group of groups) {
      const hasTexture = group.texturePath !== null;
      let texture: THREE.Texture | null = null;

      if (hasTexture && group.texturePath) {
        const cached = this.textureCache.get(group.texturePath);
        texture = cached ?? null;
        if (!texture) {
          texture = this.textureLoader.load(group.texturePath) as THREE.Texture;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          this.textureCache.set(group.texturePath, texture);
        }
      }

      if (hasTexture && texture) {
        // Forcer vertex colors → blanc pour laisser la texture visible
        const colorAttr = group.geometry.getAttribute('color');
        if (colorAttr) {
          const arr = colorAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i++) arr[i] = 1.0;
          colorAttr.needsUpdate = true;
        }

        // Pas d'éclairage : MeshBasicMaterial (comme glDisable(GL_LIGHTING))
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: group.isOverlay ?? false,
          opacity: group.isOverlay ? 1.0 : 1.0,
          depthWrite: !group.isOverlay,
        });

        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        if (group.isOverlay) mesh.renderOrder = 1;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      } else {
        // Pas de texture : vertex colors seuls
        const material = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
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
    this.renderer.dispose();
  }
}
