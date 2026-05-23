/**
 * render/TileRenderer.ts — Pipeline de rendu WebGL/Three.js pour SimGolf
 *
 * Remplace complètement l'ancien rendu Canvas 2D par un rendu GPU natif.
 * Utilise les BufferGeometry produites par buildParklandMesh() avec leurs
 * 24 sommets par tuile (4 quadrants × 2 triangles × 3 verts) et leurs UV
 * correctement mappés par quadrant.
 *
 * Architecture :
 *   TileRenderer.create(container, mapState) → instance prête à render()
 *
 * Le renderer est un Three.js WebGLRenderer en mode orthographique dimétrique.
 * Les interactions (pan, zoom) sont gérées par OrbitControls (rotation désactivée).
 * Les textures sont chargées de manière asynchrone via THREE.TextureLoader
 * avec un fallback colorimétrique en attendant.
 *
 * Projection dimétrique 2:1 confirmée par l'analyse Ghidra :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32
 * Les positions 3D sont pré-calculées dans tileVertexPosition().
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IMapState } from '../core/types';
import { buildParklandMesh, MeshGroup } from '../world/terrain';
import { createDimetricCamera, resizeDimetricCamera } from './camera';

/**
 * Gestionnaire de rendu WebGL/Three.js pour une carte SimGolf.
 *
 * Usage :
 *   const renderer = TileRenderer.create(document.body, mapState);
 *   function animate() {
 *     renderer.render();
 *     requestAnimationFrame(animate);
 *   }
 *   animate();
 */
export class TileRenderer {
  /** Renderer WebGL */
  public readonly renderer: THREE.WebGLRenderer;
  /** Scène Three.js */
  public readonly scene: THREE.Scene;
  /** Caméra orthographique dimétrique */
  public readonly camera: THREE.OrthographicCamera;
  /** Contrôles (pan + zoom, pas de rotation) */
  public controls: OrbitControls;
  /** Groupe contenant tous les meshs de terrain */
  public readonly meshGroup: THREE.Group;
  /** Dimensions de la grille (pour le resize) */
  public gridWidth: number = 40;
  public gridHeight: number = 40;

  /** Cache de textures chargées (chemin → Texture) */
  private textureCache: Map<string, THREE.Texture>;
  /** Loader de textures Three.js */
  private loader: THREE.TextureLoader;
  /** Nombre de textures en cours de chargement */
  private pendingTextures: number = 0;
  /** Position initiale de la caméra (pour resetView) */
  private initialCameraPosition: THREE.Vector3 = new THREE.Vector3();
  /** Cible initiale des contrôles (pour resetView) */
  private initialTarget: THREE.Vector3 = new THREE.Vector3();

  // ================================================================
  // Construction
  // ================================================================

  private constructor(
    container: HTMLElement,
    scene: THREE.Scene,
    camera: THREE.OrthographicCamera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
    this.textureCache = new Map();
    this.loader = new THREE.TextureLoader();

    container.appendChild(renderer.domElement);
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Crée une instance complète de TileRenderer avec caméra dimétrique.
   *
   * @param container Élément DOM hôte du canvas WebGL
   * @param mapState  État initial de la carte
   * @returns         Instance prête à render()
   */
  static create(container: HTMLElement, mapState: IMapState): TileRenderer {
    // Renderer WebGL
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a3a1a); // vert foncé SimGolf
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Scène
    const scene = new THREE.Scene();

    // Caméra dimétrique
    const { width, height } = mapState;
    const { camera } = createDimetricCamera(width, height);
    const instance = new TileRenderer(container, scene, camera, renderer, null!);

    // OrbitControls — rotation désactivée (projection dimétrique fixe)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.0;
    controls.panSpeed = 0.8;
    controls.minZoom = 0.25;
    controls.maxZoom = 20;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.update();

    instance.controls = controls;
    instance.gridWidth = width;
    instance.gridHeight = height;

    // Sauvegarder l'état initial pour resetView
    instance.initialCameraPosition = camera.position.clone();
    instance.initialTarget = controls.target.clone();

    // Charger la carte
    instance.loadMap(mapState);

    return instance;
  }

  // ================================================================
  // Chargement de carte
  // ================================================================

  /**
   * (Re)charge une carte dans le moteur de rendu.
   * Détruit les anciens meshes, construit les nouveaux via buildParklandMesh(),
   * et lance le chargement asynchrone des textures.
   *
   * @param mapState État de la carte à afficher
   */
  loadMap(mapState: IMapState): void {
    this.gridWidth = mapState.width;
    this.gridHeight = mapState.height;

    // Nettoyer les anciens meshes
    this.disposeMeshes();

    // Construire les BufferGeometry groupées par texture
    const meshGroups = buildParklandMesh(mapState);

    // Collecter tous les chemins de texture uniques
    const neededPaths = new Set<string>();
    for (const group of meshGroups) {
      if (group.texturePath) neededPaths.add(group.texturePath);
    }

    // Lancer le chargement des textures manquantes
    this.pendingTextures = neededPaths.size;
    for (const path of neededPaths) {
      if (this.textureCache.has(path)) {
        this.pendingTextures--;
        continue;
      }

      // Placeholder en attendant le chargement
      this.textureCache.set(path, null!);

      this.loader.load(
        path,
        (tex: THREE.Texture) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.anisotropy = rendererCapabilities().maxAnisotropy;
          this.textureCache.set(path, tex);
          this.pendingTextures--;
          this.refreshMaterials();
        },
        undefined,
        () => {
          // Échec de chargement
          console.warn(`[TileRenderer] Texture manquante: ${path}`);
          this.textureCache.set(path, null!);
          this.pendingTextures--;
        },
      );
    }

    // Créer les meshes
    for (const group of meshGroups) {
      this.createMesh(group);
    }
  }

  // ================================================================
  // Cycle de rendu
  // ================================================================

  /**
   * Rendu d'une frame. À appeler dans requestAnimationFrame.
   */
  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Redimensionnement du canvas au container parent.
   * Appelé automatiquement au resize de la fenêtre.
   */
  resize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    this.renderer.setSize(w, h);
    resizeDimetricCamera(this.camera, this.gridWidth, this.gridHeight);
  }

  /**
   * Nettoie toutes les ressources GPU.
   */
  dispose(): void {
    this.disposeMeshes();
    this.renderer.dispose();
    this.controls.dispose();
    for (const tex of this.textureCache.values()) {
      if (tex) tex.dispose();
    }
    this.textureCache.clear();
    window.removeEventListener('resize', () => this.resize());
  }

  /**
   * Réinitialise la vue à la position dimétrique par défaut.
   */
  resetView(): void {
    this.camera.position.copy(this.initialCameraPosition);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
  }

  // ================================================================
  // Internes de maillage
  // ================================================================

  /**
   * Crée un Mesh Three.js pour un groupe de géométrie + texture.
   * Utilise MeshBasicMaterial (pas d'éclairage, rendu 1:1 avec les textures).
   */
  private createMesh(group: MeshGroup): void {
    const fallbackColor = new THREE.Color(
      group.fallbackColor[0],
      group.fallbackColor[1],
      group.fallbackColor[2],
    );

    const material = new THREE.MeshBasicMaterial({
      color: fallbackColor,
      side: THREE.DoubleSide,
    });

    // Si la texture est déjà chargée, l'appliquer
    if (group.texturePath) {
      const tex = this.textureCache.get(group.texturePath);
      if (tex) {
        material.map = tex;
        material.color.setHex(0xffffff);
      }
    }

    const mesh = new THREE.Mesh(group.geometry, material);
    mesh.userData.texturePath = group.texturePath;
    mesh.userData.fallbackColor = group.fallbackColor;
    this.meshGroup.add(mesh);
  }

  /**
   * Détruit tous les meshes et libère la mémoire GPU.
   */
  private disposeMeshes(): void {
    for (let i = this.meshGroup.children.length - 1; i >= 0; i--) {
      const child = this.meshGroup.children[i];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      this.meshGroup.remove(child);
    }
  }

  /**
   * Met à jour les matériaux de tous les meshes dont la texture
   * vient d'être chargée.
   */
  private refreshMaterials(): void {
    for (const child of this.meshGroup.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const path = child.userData.texturePath as string | undefined;
      if (!path) continue;

      const tex = this.textureCache.get(path);
      if (!tex) continue; // pas encore chargée

      const mat = child.material as THREE.MeshBasicMaterial;
      if (mat.map === tex) continue; // déjà à jour

      mat.map = tex;
      mat.color.setHex(0xffffff); // supprime le fallback
      mat.needsUpdate = true;
    }
  }
}

// ================================================================
// Helper : capacités du renderer (anisotropy max)
// ================================================================

let _caps: { maxAnisotropy: number } | null = null;

function rendererCapabilities(): { maxAnisotropy: number } {
  if (_caps) return _caps;
  const tmp = new THREE.WebGLRenderer({ alpha: true });
  const max = tmp.capabilities.getMaxAnisotropy();
  tmp.dispose();
  _caps = { maxAnisotropy: isFinite(max) ? max : 4 };
  return _caps;
}
