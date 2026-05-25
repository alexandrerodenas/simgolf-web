/**
 * ui/toolbar.ts — Gestion de la toolbar SimGolf
 *
 * Barre d'outils en bas de l'écran avec 5 panels :
 *   Terrain, Building, Elevation, Amenities, Employees
 *
 * Chaque panel expose une liste d'outils.
 * L'outil sélectionné détermine l'action au clic sur la carte.
 */

// ─── État de la toolbar ───

export interface ToolDef {
  id: string;
  label: string;
}

export interface ToolbarState {
  activePanel: string;
  activeTool: string | null;
}

let state: ToolbarState = {
  activePanel: 'terrain',
  activeTool: 'rough',
};

type ToolCallback = (tool: string) => void;
let onToolChange: ToolCallback | null = null;

// ─── Définitions des outils par panel ───

export const PANEL_TOOLS: Record<string, ToolDef[]> = {
  terrain: [
    { id: 'rough', label: 'Rough' },
    { id: 'fairway', label: 'Fairway' },
    { id: 'green', label: 'Putting Green' },
    { id: 'tee', label: 'Tee' },
    { id: 'deeprough', label: 'Deep Rough' },
    { id: 'bunker', label: 'Sand Bunker' },
    { id: 'water', label: 'Water' },
    { id: 'woods', label: 'Woods' },
    { id: 'brush', label: 'Brush' },
  ],
  building: [
    { id: 'clubhouse', label: 'Clubhouse' },
    { id: 'proshop', label: 'Pro Shop' },
    { id: 'path', label: 'Path' },
    { id: 'bridge', label: 'Bridge' },
  ],
  elevation: [
    { id: 'raise', label: 'Raise' },
    { id: 'lower', label: 'Lower' },
    { id: 'flatten', label: 'Flatten' },
    { id: 'smooth', label: 'Smooth' },
  ],
  amenities: [
    { id: 'flowers', label: 'Flowers' },
    { id: 'rocks', label: 'Rocks' },
    { id: 'bench', label: 'Bench' },
    { id: 'lamp', label: 'Lamp' },
  ],
  employees: [
    { id: 'groundskeeper', label: 'Groundskeeper' },
    { id: 'pro', label: 'Pro' },
  ],
};

// ─── Initialisation ───

export function initToolbar(onChange?: ToolCallback): void {
  if (onChange) onToolChange = onChange;

  const tabs = document.querySelectorAll('.panel-tab');
  const toolBtns = document.querySelectorAll('.tool-btn');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.getAttribute('data-panel');
      if (!panel) return;

      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show panel
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const targetPanel = document.getElementById(`panel-${panel}`);
      if (targetPanel) targetPanel.classList.add('active');

      state.activePanel = panel;
    });
  });

  // Tool selection
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      if (!tool) return;

      // Update tool active state
      const parent = btn.closest('.panel');
      if (parent) {
        parent.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');

      state.activeTool = tool;

      // Notify
      if (onToolChange) onToolChange(tool);
    });
  });

  // Restore state
  restoreState();
}

function restoreState(): void {
  // Activer le panel et l'outil par défaut
  const defaultTab = document.querySelector(`.panel-tab[data-panel="${state.activePanel}"]`);
  if (defaultTab) {
    defaultTab.classList.add('active');
    document.getElementById(`panel-${state.activePanel}`)?.classList.add('active');
  }

  if (state.activeTool) {
    const btn = document.querySelector(`.tool-btn[data-tool="${state.activeTool}"]`);
    if (btn) btn.classList.add('active');
  }
}

// ─── API ───

export function getActiveTool(): string | null {
  return state.activeTool;
}

export function getActivePanel(): string {
  return state.activePanel;
}

export function selectTool(toolId: string): void {
  const btn = document.querySelector(`.tool-btn[data-tool="${toolId}"]`);
  if (btn) {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeTool = toolId;
  }
}

export function selectPanel(panelId: string): void {
  const tab = document.querySelector(`.panel-tab[data-panel="${panelId}"]`);
  if (tab) {
    (tab as HTMLButtonElement).click();
  }
}
