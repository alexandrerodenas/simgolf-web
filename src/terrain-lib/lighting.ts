/**
 * lighting.ts — Système d'éclairage
 *
 * Port du chargeur de fichiers lighting.txt de Terrain.dll.
 * Les fichiers originaux (ParklandLighting.txt, etc.) contiennent :
 *   #AMBIENT R G B A
 *   #DIFFUSE R G B A
 *
 * Ce module parse le format et fournit des presets par thème.
 */

import { ILightConfig } from './types.js';

/**
 * Parse une chaîne de config d'éclairage.
 * Format :
 *   #AMBIENT 0.45 0.50 0.35 1.00
 *   #DIFFUSE 0.85 0.80 0.70 1.00
 */
export function parseLightingConfig(data: string): ILightConfig {
  const config: ILightConfig = {
    ambient: [0.4, 0.4, 0.4, 1.0],
    diffuse: [0.8, 0.8, 0.8, 1.0],
    lightDir: [0.5, -0.5, 1.0],
  };

  const lines = data.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Ignorer les commentaires et lignes vides
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const keyword = parts[0].toUpperCase();
    const values = parts.slice(1).map(Number);

    if (keyword === '#AMBIENT' && values.length >= 4) {
      config.ambient = [
        clamp(values[0], 0, 1),
        clamp(values[1], 0, 1),
        clamp(values[2], 0, 1),
        clamp(values[3], 0, 1),
      ];
    } else if (keyword === '#DIFFUSE' && values.length >= 4) {
      config.diffuse = [
        clamp(values[0], 0, 1),
        clamp(values[1], 0, 1),
        clamp(values[2], 0, 1),
        clamp(values[3], 0, 1),
      ];
    } else if (keyword === '#LIGHTDIR' && values.length >= 3) {
      config.lightDir = [
        values[0],
        values[1],
        values[2],
      ];
    }
  }

  return config;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
