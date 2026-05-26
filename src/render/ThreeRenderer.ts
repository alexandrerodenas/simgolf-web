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
 *
 * Supporte deux formats de textureKey :
 *   - Tuile pleine  : "type:variation:geomSuffix"   → charge texture existante (ex: FAIRWAYA0001.webp)
 *   - Transition    : "trans:type:mask:variation"     → charge frame spritesheet (fallback couleur si absent)
 *   - Chemin        : "special:path"                  → texture de chemin
 */

import * as THREE from 'three';
import { IMapState, TileType } from '../terrain-lib/index.js';
import { buildParklandMesh, MeshGroup } from '../world/terrain.js';
import { TextureTable3D } from './TextureTable3D.js';

export class ThreeRenderer {
  private scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private textureTable: TextureTable3D;
  private mapState: IMapState | null = null;
  private meshes: THREE.Mesh[] = [];

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
      let texture: THREE.Texture | null = null;

      if (group.textureKey) {
        if (group.textureKey.startsWith('special:')) {
          // Texture spéciale (chemin/dirt)
          const slot = group.textureKey === 'special:path' ? 0x21 : 0x20;
          texture = this.textureTable.getSpecialTexture(slot);
        } else if (group.textureKey.startsWith('trans:')) {
          // Transition spritesheet — charge la texture spritesheet
          texture = this.getOrCreateTransitionTexture(group.textureKey);
        } else {
          // Texture normale pleine (type:variation:geomSuffix)
          texture = this.getOrLoadTexture(group.textureKey);
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
   * getOrLoadTexture — Charge une texture pleine depuis le cache.
   *
   * Format textureKey : "type:variation:geomSuffix"
   *   - type        : TileType (numérique)
   *   - variation   : index de variation cosmétique (0..N)
   *   - geomSuffix  : A/B/C/D/E (type de géométrie de la tile)
   *
   * Génère le chemin : /assets/textures/{theme}/{folder}/{PREFIX}{suffix}{var4}.webp
   */
  private getOrLoadTexture(textureKey: string): THREE.Texture | null {
    if (this.loadedTextures.has(textureKey)) {
      return this.loadedTextures.get(textureKey)!;
    }

    const parts = textureKey.split(':');
    if (parts.length === 4) {
      // Ancien format "type:variation:suffix:isBorder" — compatibilité
      const type = parseInt(parts[0], 10) as TileType;
      const variation = parseInt(parts[1], 10);
      const suffix = parts[2];
      const path = this.textureTable.buildPath(type, variation, suffix);
      if (!path) return null;
      const tex = this.loadTexture(path);
      this.loadedTextures.set(textureKey, tex);
      return tex;
    }

    // Nouveau format "type:variation:geomSuffix" (3 parties)
    if (parts.length !== 3) return null;

    const type = parseInt(parts[0], 10) as TileType;
    const variation = parseInt(parts[1], 10);
    const suffix = parts[2];

    const path = this.textureTable.buildPath(type, variation, suffix);
    if (!path) return null;

    const tex = this.loadTexture(path);
    this.loadedTextures.set(textureKey, tex);
    return tex;
  }

  /**
   * getOrCreateTransitionTexture — Charge ou crée une texture
   * de spritesheet 4×4 pour les transitions.
   *
   * Format textureKey : "trans:type:mask:variation"
   *   - type  : TileType (numérique)
   *   - mask  : mask 4-bit de transition (0-15)
   *   - variation : index cosmétique
   *
   * Chemin attendu : /assets/textures/{theme}/{folder}/{PREFIX}_trans_r{row}_c{col}_v{var4}.webp
   */
  private getOrCreateTransitionTexture(textureKey: string): THREE.Texture | null {
    if (this.loadedTextures.has(textureKey)) {
      return this.loadedTextures.get(textureKey)!;
    }

    const parts = textureKey.split(':');
    if (parts.length !== 4) return null;

    const type = parseInt(parts[1], 10) as TileType;
    const mask = parseInt(parts[2], 10);
    const variation = parseInt(parts[3], 10);

    const { row, col } = this.maskToSpriteCoords(mask);
    const prefix = this.textureTable.getPrefix(type);
    const folder = this.textureTable.getFolder(type);
    if (!prefix || !folder) return null;

    const varStr = String(variation + 1).padStart(4, '0');
    const path = `/assets/textures/parkland/${folder}/${prefix}_trans_r${row}_c${col}_v${varStr}.webp`;

    // On essaie de charger la texture
    try {
      const tex = new THREE.TextureLoader().load(path);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.loadedTextures.set(textureKey, tex);
      return tex;
    } catch {
      // La texture n'existe pas encore — fallback null (→ couleur)
      // Quand le user créera les spritesheets, ça fonctionnera automatiquement
      return null;
    }
  }

  /** Cache built-in pour mask → (row, col) — évite la dépendance vers autotile */
  private maskToSpriteCoords(mask: number): { row: number; col: number } {
    return {
      row: mask >> 2,
      col: mask & 3,
    };
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
