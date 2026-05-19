# SimGolf Web — Roadmap & Tickets

> Portage web du jeu SimGolf (Firaxis, 2002)
> Stack : Vite + TypeScript + Phaser 4
> V1 : Éditeur de parcours + gestion club + golfeurs IA

---

## Légende

```
[⏳] À faire    [🏗️] En cours    [✅] Fini    [❌] Annulé
```

**Priorités :** P0 = Bloquant, P1 = Important, P2 = Souhaitable, P3 = Bonus

---

## Phase 0 — Fondations (scaffolding)

> Objectif : projet Vite + Phaser qui compile, boot scene → game scene

### P0-0 : Projet Vite + TypeScript + Phaser ✅
- [x] `npm init`, `npm install phaser`, `npm install -D typescript vite`
- [x] tsconfig strict, pas de framework supplémentaire
- [x] Vite dev server, build static
- [x] `vite.config.ts`, `.gitignore`

### P0-1 : Scènes Phaser ✅
- [x] BootScene : splash → transition GameScene
- [x] GameScene : fond + debug text + FPS counter
- [x] Game loop intégré (Phaser s'en charge)

### P0-2 : Structure de dossiers ✅
- [x] `src/config.ts` — constantes du jeu
- [x] `src/scenes/` — BootScene, GameScene
- [x] `src/core/` — moteurs de jeu (types, engine, generator, constants)
- [x] `src/data/` — données (golfeurs stub)
- [ ] `src/render/` — rendu isométrique
- [ ] `src/ui/` — HUD, overlays

### P0-3 : Assets pipeline ⏳
- [ ] `public/textures/` — textures originales (terrain)
- [ ] Copier les données depuis `simgolf-re/game_data/`

### P0-4 : Déploiement Vercel ⏳
- [x] `vercel.json` : static
- [ ] Déploiement Vercel initial

---

## Phase 1 — Structures de données & Terrain Engine ✅

> Objectif : carte 64×64 fonctionnelle, modifiable en mémoire

### P1-0 : Structures de base ✅
- [x] Types : `TileData`, `TileType` enum, `TileCorner`, `WallSide`
- [x] GolferSkills interface (10 skills hex)
- [x] EconomyState, ShotResult, WindState types
- [x] ClubType, ShotType, LieType, Difficulty enums

### P1-1 : TerrainEngine ✅
- [x] `class TerrainEngine` : grid 64×64 de `TileData`
- [x] `tileAt(x, y) → TileData | null`
- [x] `setTileType(x, y, type, variation)`
- [x] `elevateCorner` / `lowerCorner` / `elevateTile` / `lowerTile`
- [x] Élévation propagée aux coins partagés des voisins
- [x] Murs `setWall` / `toggleWall`
- [x] `serialize()` / `deserialize()`

### P1-2 : TerrainGenerator ✅
- [x] Bruit fractal 2D (permutation table, 5 octaves, smoothstep)
- [x] Quantification (arrondi entier 0..10)
- [x] Lissage (|voisin − courant| ≤ 1, 20 passes max)
- [x] Classification : eau (≤1), sable (≤3 près de l'eau), herbe
- [x] Nettoyage eau isolée (2 passes)
- [x] Forêts en clusters + arbres épars, buissons, fleurs

### P1-3 : Données golfeurs ✅
- [x] `src/data/golfers.ts` : 4 pros + 2 célébrités (stub)
- [ ] Parse les 96 vrais golfeurs depuis `simgolf-re/`
- [ ] Parse les 50 célébrités depuis `simgolf-re/`

### P1-4 : Constantes de jeu ✅
- [x] `src/core/constants.ts` : GAME, ECONOMY, SCORING, AI, RENDER
- [x] Valeurs calibrées d'après l'analyse RE

---

## Phase 2 — Rendu isométrique

> Objectif : afficher la carte en isométrique avec culling, zoom

### P2-0 : Coordinate System ⏳
### P2-1 : Phaser Camera setup ⏳
### P2-2 : Rendu complet ⏳
### P2-3 : Culling dynamique ⏳
### P2-4 : Texture Manager ⏳
### P2-5 : Tile renderer ⏳
### P2-6 : Auto-tiling ⏳

---

## Phase 3 — Interaction tactile ⏳

## Phase 4 — Simulation & Systèmes de jeu ⏳

## Phase 5 — Interface utilisateur ⏳

## Phase 6 — Sauvegarde & Données ⏳

## Phase 7 — Déploiement & QA ⏳

---

## Résumé des dépendances

```
P0 ─── P1 ─── P2 ─── P3 ─── P4 ─── P5 ─── P6 ─── P7
```
