/**
 * lighting/index.ts — Baril d'export du module d'éclairage
 */

export { LightingEngine } from './LightingEngine';
export { ShadowMask } from './ShadowMask';
export { AmbientLight } from './AmbientLight';
export { FloodLight, type FloodFillResult } from './FloodLight';
export { RaycastLight, type RaycastLightMesh } from './RaycastLight';
export { AdvancedRaycastLight, type AdvancedRaycastMesh } from './AdvancedRaycastLight';
export { LightManager, type LightResult } from './LightManager';
export { LightCameraManager, LightLayer, type ICameraSetup } from './LightCamera';
export { LightingMode, type ILightSource, type IFloodLight, type IRaycastLight, type IAdvancedRaycastLight, type ILightingConfig, type IShadowMaskConfig, type IAdvancedConfig, DEFAULT_LIGHTING_CONFIG } from './types';
