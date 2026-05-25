/**
 * ui/types.ts — Types pour le système d'interface SimGolf
 *
 * Basé sur l'analyse du code original (game_ui_system.c) :
 *   5 toolbars, 25 écrans, palette de terrain par thème.
 */

import { TileType, CourseTheme } from '../terrain-lib/types.js';

/** Les 5 barres d'outils du jeu original */
export enum ToolbarTab {
  Terrain   = 0,
  Building  = 1,
  Elevation = 2,
  Amenities = 3,
  Employee  = 4,
}

export const TOOLBAR_LABELS: Record<ToolbarTab, string> = {
  [ToolbarTab.Terrain]:   'Terrain',
  [ToolbarTab.Building]:  'Buildings',
  [ToolbarTab.Elevation]: 'Elevation',
  [ToolbarTab.Amenities]: 'Amenities',
  [ToolbarTab.Employee]:  'Employees',
};

/** Asset paths for toolbar panel backgrounds */
export const TOOLBAR_PANEL_ASSETS: Record<ToolbarTab, string> = {
  [ToolbarTab.Terrain]:   '/assets/ui/BaseTerrainPanel.webp',
  [ToolbarTab.Building]:  '/assets/ui/BuildingPanel.webp',
  [ToolbarTab.Elevation]: '/assets/ui/ElevationPanel.webp',
  [ToolbarTab.Amenities]: '/assets/ui/AmenitiesPanel.webp',
  [ToolbarTab.Employee]:  '/assets/ui/EmployeePanel.webp',
};

/** Un outil de terrain dans la palette */
export interface TerrainTool {
  type: TileType;
  label: string;
  icon: string;         /* chemin vers l'image du bouton */
}

/** Palette de terrain complète pour un thème */
export interface TerrainPalette {
  theme: CourseTheme;
  name: string;
  tools: TerrainTool[];
  buttonsAsset: string; /* ex: /assets/ui/ParkLandTerrainButtons.webp */
}

// ── Palettes par thème ──

const PARKLAND_PALETTE: TerrainPalette = {
  theme: CourseTheme.Parkland,
  name: 'Parkland',
  buttonsAsset: '/assets/ui/ParkLandTerrainButtons.webp',
  tools: [
    { type: TileType.Rough,        label: 'Rough',        icon: 'rough' },
    { type: TileType.Fairway,      label: 'Fairway',      icon: 'fairway' },
    { type: TileType.PuttingGreen, label: 'Green',        icon: 'puttinggreen' },
    { type: TileType.SandBunker,   label: 'Bunker',       icon: 'sandbunker' },
    { type: TileType.WaterShallow, label: 'Water',        icon: 'watershallow' },
    { type: TileType.DeepRough,    label: 'Deep Rough',   icon: 'deeprough' },
    { type: TileType.Tee,          label: 'Tee',           icon: 'tee' },
    { type: TileType.Tree,         label: 'Trees',        icon: 'woods' },
    { type: TileType.Flower,       label: 'Flowers',      icon: 'brush' },
    { type: TileType.Rock,         label: 'Rocks',        icon: 'rock' },
    { type: TileType.Cliff,        label: 'Cliff',        icon: 'cliff' },
    { type: TileType.Path,         label: 'Path',         icon: 'ravine' },
  ],
};

export const PALETTES: Record<CourseTheme, TerrainPalette> = {
  [CourseTheme.Parkland]: PARKLAND_PALETTE,
  [CourseTheme.Links]:    PARKLAND_PALETTE, // TODO: Links palette
  [CourseTheme.Desert]:   PARKLAND_PALETTE, // TODO: Desert palette
  [CourseTheme.Tropical]: PARKLAND_PALETTE, // TODO: Tropical palette
};

/** Événements émis par le toolbar */
export interface ToolbarEvents {
  onTerrainSelect: (type: TileType) => void;
  onTabChange: (tab: ToolbarTab) => void;
  onElevationTool: (tool: 'raise' | 'lower' | 'flatten' | 'smooth') => void;
}
