/**
 * lighting/LightingEngine.ts — Orchestrateur principal du système d'éclairage
 *
 * Point d'entrée unique qui coordonne :
 *   - Mode Basic   : ShadowMask + rendu simple
 *   - Mode Advanced : AmbientLight + Mesh Lights (Flood/Raycast/Advanced)
 *                     + 3 caméras + post-processing (blur + blend)
 *
 * Utilisation :
 *   const engine = new LightingEngine(renderer, scene);
 *   engine.initialize(config);
 *   engine.setMapData(tiles, heightMap, w, h);
 *   engine.setMode(LightingMode.Advanced);
 *   engine.addFloodLight(...);
 *   engine.compute();
 *   engine.render();
 */

import * as THREE from 'three';
import {
  LightingMode,
  type ILightingConfig,
  type IFloodLight,
  type IRaycastLight,
  type IAdvancedRaycastLight,
  DEFAULT_LIGHTING_CONFIG,
} from './types';
import { ShadowMask } from './ShadowMask';
import { AmbientLight } from './AmbientLight';
import { LightManager } from './LightManager';
import { LightCameraManager } from './LightCamera';
import { TileType } from '../terrain-lib/types.js';

// Vertex shader de base pour le post-processing
const VERTEX_SHADER = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export class LightingEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private config: ILightingConfig;

  // Mode Basic
  private shadowMask: ShadowMask;

  // Mode Avancé
  private ambientLight: AmbientLight;
  private lightManager: LightManager;
  private cameraManager: LightCameraManager;

  // Post-processing
  private blurMaterial: THREE.ShaderMaterial | null = null;
  private blendMaterial: THREE.ShaderMaterial | null = null;
  private blurTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private quadMesh: THREE.Mesh | null = null;

  // Données de la carte
  private tiles: { type: TileType; elevation: [number, number, number, number]; x: number; y: number }[] = [];
  private heightMap: Float32Array = new Float32Array();
  private mapW = 0;
  private mapH = 0;

  // Mode actif
  private mode: LightingMode = LightingMode.Basic;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = { ...DEFAULT_LIGHTING_CONFIG };

    this.shadowMask = new ShadowMask(this.config.shadowMask);
    this.ambientLight = new AmbientLight(this.config);
    this.lightManager = new LightManager();
    this.cameraManager = new LightCameraManager(renderer);
  }

  /** Initialise le moteur avec une configuration */
  initialize(config?: Partial<ILightingConfig>): void {
    if (config) {
      this.config = { ...DEFAULT_LIGHTING_CONFIG, ...config };
      if (config.shadowMask) {
        this.config.shadowMask = { ...DEFAULT_LIGHTING_CONFIG.shadowMask, ...config.shadowMask };
      }
      if (config.advanced) {
        this.config.advanced = { ...DEFAULT_LIGHTING_CONFIG.advanced, ...config.advanced };
      }
    }

    // Réinitialiser les sous-systèmes
    this.shadowMask = new ShadowMask(this.config.shadowMask);
    this.ambientLight = new AmbientLight(this.config);

    if (this.config.mode === LightingMode.Advanced) {
      this.initAdvanced();
    }
  }

  /** Initialise les sous-systèmes avancés */
  private initAdvanced(): void {
    // Initialiser le post-processing
    this.initPostProcessing();
  }

  /** Initialise le pipeline de post-processing (blur + blend) */
  private initPostProcessing(): void {
    const { advanced } = this.config;

    // Shader de flou
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(advanced.lightResolution, advanced.lightResolution) },
        direction: { value: new THREE.Vector2(1, 0) },
        kernelSize: { value: advanced.blurKernelSize },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: BLUR_FRAG_SHADER,
      depthWrite: false,
      depthTest: false,
    });

    // Shader de blend
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tLight: { value: null },
        tAmbient: { value: null },
        ambientColor: { value: new THREE.Vector4(
          this.config.ambientColor[0],
          this.config.ambientColor[1],
          this.config.ambientColor[2],
          this.config.ambientColor[3],
        ) },
        lightIntensity: { value: 1.0 },
        hasAmbient: { value: false },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: BLEND_FRAG_SHADER,
      depthWrite: false,
      depthTest: false,
    });

    // Render targets pour les passes de flou
    const res = advanced.lightResolution;
    this.blurTargets = [
      new THREE.WebGLRenderTarget(res, res, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      }),
      new THREE.WebGLRenderTarget(res, res, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      }),
    ];

    // Quad plein écran pour les passes
    this.quadMesh = this.createFullscreenQuad();
  }

  /** Crée un quad plein écran pour les passes de post-processing */
  private createFullscreenQuad(): THREE.Mesh {
    const geom = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geom, this.blurMaterial!);
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    mesh.layers.set(0); // Layer principal
    return mesh;
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

    this.lightManager.setMapData(tiles, heightMap, w, h);
  }

  /** Change le mode d'éclairage */
  setMode(mode: LightingMode): void {
    this.mode = mode;
    this.config.mode = mode;

    if (mode === LightingMode.Advanced && !this.blurMaterial) {
      this.initAdvanced();
    }
  }

  /** Ajoute une source Flood Light */
  addFloodLight(light: Omit<IFloodLight, 'id' | 'type'>, id?: string): string {
    const fid = id ?? `flood_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.lightManager.addSource({ ...light, id: fid, type: 'flood' });
    return fid;
  }

  /** Ajoute une source Raycast Light */
  addRaycastLight(light: Omit<IRaycastLight, 'id' | 'type'>, id?: string): string {
    const rid = id ?? `raycast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.lightManager.addSource({ ...light, id: rid, type: 'raycast' });
    return rid;
  }

  /** Ajoute une source Advanced Raycast Light */
  addAdvancedRaycastLight(light: Omit<IAdvancedRaycastLight, 'id' | 'type'>, id?: string): string {
    const aid = id ?? `adv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.lightManager.addSource({ ...light, id: aid, type: 'advanced-raycast' });
    return aid;
  }

  /** Calcule tous les éclairages selon le mode */
  compute(): void {
    switch (this.mode) {
      case LightingMode.Basic:
        this.computeBasic();
        break;
      case LightingMode.Advanced:
        this.computeAdvanced();
        break;
    }
  }

  /** Mode Basic : génère le shadow mask */
  private computeBasic(): void {
    // Créer un masque d'exposition basé sur l'élévation
    const exposedMask = new Uint8Array(this.mapW * this.mapH);
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      exposedMask[i] = (tile.elevation[0] > 0 || tile.elevation[1] > 0
        || tile.elevation[2] > 0 || tile.elevation[3] > 0) ? 1 : 0;
    }
    this.shadowMask.generateFromExposedMask(exposedMask);
  }

  /** Mode Avancé : calcule tout */
  private computeAdvanced(): void {
    // 1. Ambiante (height map)
    this.ambientLight.compute(this.heightMap, this.tiles, this.mapW, this.mapH);

    // 2. Lumières mesh
    this.lightManager.computeAll();

    // 3. Créer les objets de scène
    this.lightManager.createSceneObjects(this.scene);
  }

  /** Effectue le rendu final */
  render(scene: THREE.Scene, mainCamera: THREE.PerspectiveCamera): void {
    switch (this.mode) {
      case LightingMode.Basic:
        this.renderBasic(scene, mainCamera);
        break;
      case LightingMode.Advanced:
        this.renderAdvanced(scene, mainCamera);
        break;
    }
  }

  /** Mode Basic : rendu simple */
  private renderBasic(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.renderer.render(scene, camera);
  }

  /** Mode Avancé : rendu 3 caméras + post-processing */
  private renderAdvanced(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.blurMaterial || !this.blendMaterial || !this.blurTargets || !this.quadMesh) {
      this.renderer.render(scene, camera);
      return;
    }

    const [rt1, rt2] = this.blurTargets;
    const { lightResolution } = this.config.advanced;

    // 1. Rendu principal
    this.renderer.setRenderTarget(null);
    this.renderer.render(scene, camera);

    // 2. Rendu des lumières dans le render target
    this.renderer.setRenderTarget(rt1);
    this.renderer.clear();
    this.renderer.render(scene, camera); // Les lumières sont sur layer 1
    this.renderer.setRenderTarget(null);

    // 3. Passes de flou (pairs de X/Y)
    this.blurMaterial.uniforms.resolution.value.set(lightResolution, lightResolution);

    let src = rt1;
    let dst = rt2;

    for (let i = 0; i < this.config.advanced.blurPasses; i++) {
      // Passe X
      this.blurMaterial.uniforms.direction.value.set(1, 0);
      this.blurMaterial.uniforms.tDiffuse.value = src.texture;
      this.renderer.setRenderTarget(dst);
      this.renderer.render(this.quadMesh, camera);
      this.renderer.setRenderTarget(null);

      // Passe Y
      this.blurMaterial.uniforms.direction.value.set(0, 1);
      this.blurMaterial.uniforms.tDiffuse.value = dst.texture;
      this.renderer.setRenderTarget(src);
      this.renderer.render(this.quadMesh, camera);
      this.renderer.setRenderTarget(null);
    }

    // 4. Blend final
    const ambientData = this.ambientLight.getData();

    this.blendMaterial.uniforms.tDiffuse.value = null; // la scène est déjà rendue
    this.blendMaterial.uniforms.tLight.value = src.texture;
    this.blendMaterial.uniforms.tAmbient.value = ambientData?.texture ?? null;
    this.blendMaterial.uniforms.hasAmbient.value = ambientData !== null;
    this.blendMaterial.uniforms.ambientColor.value.set(
      this.config.ambientColor[0],
      this.config.ambientColor[1],
      this.config.ambientColor[2],
      this.config.ambientColor[3],
    );

    // Rendu final du quad de blend (par-dessus la scène)
    this.blendMaterial.needsUpdate = true;
    this.quadMesh.material = this.blendMaterial;
    this.renderer.render(this.quadMesh, camera);
  }

  /** Redimensionnement */
  resize(width: number, height: number): void {
    this.cameraManager.resize(width, height);
  }

  /** Nettoie tout */
  dispose(): void {
    this.shadowMask.clear();
    this.ambientLight.dispose();
    this.lightManager.dispose();
    this.cameraManager.dispose();

    if (this.blurMaterial) this.blurMaterial.dispose();
    if (this.blendMaterial) this.blendMaterial.dispose();
    if (this.blurTargets) {
      this.blurTargets[0].dispose();
      this.blurTargets[1].dispose();
    }
    if (this.quadMesh) {
      this.quadMesh.geometry.dispose();
    }
  }

  /** Récupère le gestionnaire de lumières */
  getLightManager(): LightManager {
    return this.lightManager;
  }

  /** Récupère le gestionnaire de caméras */
  getCameraManager(): LightCameraManager {
    return this.cameraManager;
  }

  /** Récupère le ShadowMask */
  getShadowMask(): ShadowMask {
    return this.shadowMask;
  }

  /** Récupère le mode actif */
  getMode(): LightingMode {
    return this.mode;
  }
}

// ─── SHADERS INLINE (GLSL) ───

const BLUR_FRAG_SHADER = `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 direction;
uniform int kernelSize;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    vec2 pixelSize = vec2(1.0) / resolution;
    float sigma = float(kernelSize) / 3.0;
    float sigma2 = 2.0 * sigma * sigma;
    int halfKernel = kernelSize / 2;

    for (int i = -10; i <= 10; i++) {
        if (abs(i) > halfKernel) continue;
        float fi = float(i);
        vec2 offset = direction * fi * pixelSize;
        float weight = exp(-(fi * fi) / sigma2);
        color += texture(tDiffuse, vUv + offset) * weight;
        totalWeight += weight;
    }

    fragColor = color / totalWeight;
}
`;

const BLEND_FRAG_SHADER = `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D tDiffuse;
uniform sampler2D tLight;
uniform sampler2D tAmbient;
uniform vec4 ambientColor;
uniform float lightIntensity;
uniform bool hasAmbient;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 sceneColor = texture(tDiffuse, vUv);
    float lightValue = texture(tLight, vUv).r;
    float ambientValue;

    if (hasAmbient) {
        ambientValue = texture(tAmbient, vUv).r;
    } else {
        ambientValue = ambientColor.r;
    }

    float totalLight = max(ambientValue, lightValue * lightIntensity);
    totalLight = clamp(totalLight, 0.0, 1.0);

    vec3 litColor = sceneColor.rgb * totalLight;
    vec3 lightTint = texture(tLight, vUv).rgb;
    litColor += lightTint * lightValue * 0.3;

    fragColor = vec4(litColor, sceneColor.a);
}
`;
