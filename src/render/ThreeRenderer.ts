/**
 * render/ThreeRenderer.ts — Rendu Three.js avec éclairage 3D
 *
 * Remplace le rendu Canvas 2D par un rendu WebGL Three.js avec :
 *   - Caméra orthographique dimétrique (2:1)
 *   - Éclairage lambertien (ambient + diffuse) comme le jeu original
 *   - Vertex colors sur toutes les tuiles (fallback quand pas de texture)
 *   - Normales 3D calculées depuis l'élévation
 *
 * Sources : analyse rizin de Terrain.dll (OpenGL 1.x immediate mode)
 *   - glLightfv(GL_LIGHT0, GL_AMBIENT, ...)
 *   - glLightfv(GL_LIGHT0, GL_DIFFUSE, ...)
 *   - glNormal3f par tuile (cross product des diagonales)
 */

import * as THREE from 'three';
import { IMapState, ILightConfig, CourseTheme } from '../terrain-lib/index.js';
import { buildParklandMesh, MeshGroup } from '../world/terrain.js';

// ─── Constantes d'éclairage du jeu original ───
// Sources : Terrain.dll + ParklandLighting.txt
const THEME_LIGHTING: Record<CourseTheme, {
  ambient: [number, number, number, number];
  diffuse: [number, number, number, number];
  lightDir: [number, number, number];
}> = {
  [CourseTheme.Parkland]: {
    ambient: [0.45, 0.50, 0.35, 1.0],
    diffuse: [0.85, 0.80, 0.70, 1.0],
    lightDir: [0.3, -0.6, 0.8],  // soleil sud-ouest
  },
  [CourseTheme.Links]: {
    ambient: [0.40, 0.45, 0.50, 1.0],
    diffuse: [0.75, 0.80, 0.90, 1.0],
    lightDir: [0.5, -0.5, 0.7],
  },
  [CourseTheme.Desert]: {
    ambient: [0.55, 0.45, 0.30, 1.0],
    diffuse: [1.0, 0.85, 0.60, 1.0],
    lightDir: [0.5, -0.7, 1.0],
  },
  [CourseTheme.Tropical]: {
    ambient: [0.35, 0.50, 0.30, 1.0],
    diffuse: [0.90, 0.85, 0.65, 1.0],
    lightDir: [0.2, -0.4, 0.9],
  },
};

// ─── Renderer ───

export class ThreeRenderer {
  private scene: THREE.Scene;
  /** Caméra orthographique (publique pour les contrôles main.ts) */
  camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private meshes: THREE.Mesh[] = [];
  private textureLoader: THREE.TextureLoader;
  private textureCache = new Map<string, THREE.Texture>();
  private mapState: IMapState | null = null;
  private gridW = 0;
  private gridH = 0;

  // Lumières Three.js
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  // Zoom (niveau de zoom géré par main.ts)
  currentZoom = 1;

  constructor(container: HTMLElement) {
    // Scène
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a3a1a); // vert foncé

    // Caméra (sera configurée dans loadMap)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);

    // Renderer WebGL
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a3a1a, 1);
    container.appendChild(this.renderer.domElement);

    // Texture loader
    this.textureLoader = new THREE.TextureLoader();

    // --- Éclairage Three.js (modèle lambertien du jeu original) ---
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.directionalLight.position.set(0.3, -0.6, 0.8).normalize();
    this.directionalLight.target.position.set(0, 0, 0);
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);

    // Événements resize
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * Charge la carte et construit les meshes
   */
  loadMap(mapState: IMapState): void {
    this.mapState = mapState;
    this.gridW = mapState.width;
    this.gridH = mapState.height;

    // Configurer l'éclairage selon le thème
    this.applyThemeLighting(mapState.theme);

    // Construire les meshes groupés par texture
    const meshGroups = buildParklandMesh(mapState);
    this.buildMeshesFromGroups(meshGroups);
  }

  private applyThemeLighting(theme: CourseTheme): void {
    const config = THEME_LIGHTING[theme] ?? THEME_LIGHTING[CourseTheme.Parkland];

    const [ar, ag, ab,] = config.ambient;
    const [dr, dg, db,] = config.diffuse;

    this.ambientLight.color.setRGB(ar, ag, ab);
    this.ambientLight.intensity = 1.0;

    this.directionalLight.color.setRGB(dr, dg, db);
    this.directionalLight.intensity = 1.0;

    this.directionalLight.position.set(
      config.lightDir[0],
      config.lightDir[1],
      config.lightDir[2],
    ).normalize();
  }

  private buildMeshesFromGroups(groups: MeshGroup[]): void {
    // Nettoyer les anciens meshes
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
        // Charger depuis le cache ou créer
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
        // Texture disponible : on multiplie texture × vertexColors blancs
        // Modifier les vertex colors → blanc (1,1,1) pour laisser la texture visible
        const colorAttr = group.geometry.getAttribute('color');
        if (colorAttr) {
          const arr = colorAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i++) {
            arr[i] = 1.0; // white
          }
          colorAttr.needsUpdate = true;
        }

        const material = new THREE.MeshLambertMaterial({
          map: texture,
          vertexColors: true,
          flatShading: true,
          side: THREE.DoubleSide,
          emissive: 0x000000,
        });

        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      } else {
        // Pas de texture : vertex colors seuls
        const material = new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          side: THREE.DoubleSide,
          emissive: 0x000000,
        });

        const mesh = new THREE.Mesh(group.geometry, material);
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
  }

  /**
   * Met à jour les couleurs d'éclairage
   */
  updateLighting(lighting: ILightConfig): void {
    const [ar, ag, ab,] = lighting.ambient;
    const [dr, dg, db,] = lighting.diffuse;

    this.ambientLight.color.setRGB(ar, ag, ab);
    this.directionalLight.color.setRGB(dr, dg, db);
    this.directionalLight.position.set(
      lighting.lightDir[0],
      lighting.lightDir[1],
      lighting.lightDir[2],
    ).normalize();
  }

  /**
   * Boucle de rendu principale
   */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Nettoie les ressources
   */
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
