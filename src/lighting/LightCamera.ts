/**
 * lighting/LightCamera.ts — Gestion des 3 caméras et layers
 *
 * Architecture :
 *   1. Main Camera   : Rendu du terrain et des objets (layer 0)
 *   2. Light Camera  : Capture uniquement les lumières (layer 1)
 *   3. Overlay Camera : UI / éléments ignorants l'éclairage (layer 2)
 *
 * Les layers Three.js permettent de filtrer ce que chaque caméra voit.
 */
import * as THREE from 'three';

export enum LightLayer {
  /** Layer 0 — Terrain et objets principaux */
  Main = 0,
  /** Layer 1 — Sources lumineuses et Mesh Lights */
  Light = 1,
  /** Layer 2 — UI et overlays (ignore l'éclairage) */
  Overlay = 2,
}

export interface ICameraSetup {
  mainCamera: THREE.PerspectiveCamera;
  lightCamera: THREE.PerspectiveCamera;
  overlayCamera: THREE.PerspectiveCamera;
  /** Render target pour la lumière (downscaled) */
  lightRenderTarget: THREE.WebGLRenderTarget;
  /** Matériaux/lumières par layer */
  layers: {
    main: Set<THREE.Object3D>;
    light: Set<THREE.Object3D>;
    overlay: Set<THREE.Object3D>;
  };
}

export class LightCameraManager {
  private setup: ICameraSetup | null = null;
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /**
   * Initialise les 3 caméras et le render target lumière.
   *
   * @param mainCamera  La caméra principale existante (ou null pour en créer une)
   * @param lightRes    Résolution du render target lumière (puissance de 2)
   */
  initialize(
    mainCamera: THREE.PerspectiveCamera | null,
    lightRes: number = 512,
  ): ICameraSetup {
    // 1. Caméra principale
    const mainCam = mainCamera ?? new THREE.PerspectiveCamera(45, 1, 1, 10000);
    mainCam.layers.set(LightLayer.Main);

    // 2. Caméra lumière (clone de la principale sur layer 1)
    const lightCam = mainCam.clone();
    lightCam.layers.set(LightLayer.Light);

    // 3. Caméra overlay (clone de la principale sur layer 2)
    const overlayCam = mainCam.clone();
    overlayCam.layers.set(LightLayer.Overlay);

    // 4. Render target pour la lumière (downscaled)
    const canvas = this.renderer.domElement;
    const w = canvas?.width ?? window.innerWidth;
    const h = canvas?.height ?? window.innerHeight;

    const lightRT = new THREE.WebGLRenderTarget(
      lightRes, Math.round(lightRes * (h / w)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      },
    );

    this.setup = {
      mainCamera: mainCam,
      lightCamera: lightCam,
      overlayCamera: overlayCam,
      lightRenderTarget: lightRT,
      layers: {
        main: new Set(),
        light: new Set(),
        overlay: new Set(),
      },
    };

    return this.setup;
  }

  /** Assigne un objet 3D à un layer */
  assignToLayer(obj: THREE.Object3D, layer: LightLayer): void {
    if (!this.setup) return;
    obj.layers.set(layer);

    // Ajouter au set correspondant
    switch (layer) {
      case LightLayer.Main:
        this.setup.layers.main.add(obj);
        break;
      case LightLayer.Light:
        this.setup.layers.light.add(obj);
        break;
      case LightLayer.Overlay:
        this.setup.layers.overlay.add(obj);
        break;
    }
  }

  /** Retire un objet des layers */
  removeFromLayers(obj: THREE.Object3D): void {
    this.setup?.layers.main.delete(obj);
    this.setup?.layers.light.delete(obj);
    this.setup?.layers.overlay.delete(obj);
  }

  /** Effectue le rendu des 3 caméras */
  render(scene: THREE.Scene): void {
    if (!this.setup) return;

    const { mainCamera, lightCamera, overlayCamera, lightRenderTarget } = this.setup;

    // 1. Rendu principal (layer 0)
    this.renderer.autoClear = true;
    this.renderer.render(scene, mainCamera);

    // 2. Rendu de la lumière (layer 1) → render target
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(lightRenderTarget);
    this.renderer.render(scene, lightCamera);
    this.renderer.setRenderTarget(null);

    // 3. Rendu overlay (layer 2) par-dessus
    this.renderer.render(scene, overlayCamera);

    this.renderer.autoClear = true;
  }

  /** Redimensionne les caméras et le render target */
  resize(width: number, height: number, fov: number = 45): void {
    if (!this.setup) return;

    const aspect = width / height;

    this.setup.mainCamera.aspect = aspect;
    this.setup.mainCamera.updateProjectionMatrix();

    this.setup.lightCamera.aspect = aspect;
    this.setup.lightCamera.updateProjectionMatrix();

    this.setup.overlayCamera.aspect = aspect;
    this.setup.overlayCamera.updateProjectionMatrix();

    // Redimensionner le render target (garder le ratio)
    const lw = this.setup.lightRenderTarget.width;
    const lh = Math.round(lw / aspect);
    this.setup.lightRenderTarget.setSize(lw, lh);
  }

  /** Récupère la texture de lumière pour le shader de blend */
  getLightTexture(): THREE.Texture | null {
    return this.setup?.lightRenderTarget.texture ?? null;
  }

  /** Nettoie les ressources */
  dispose(): void {
    if (this.setup) {
      this.setup.lightRenderTarget.dispose();
    }
    this.setup = null;
  }
}
