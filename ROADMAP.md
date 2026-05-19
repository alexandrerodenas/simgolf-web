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
- [x] `src/render/` — rendu isométrique
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

## Phase 2 — Rendu isométrique ✅

> Objectif : afficher la carte en isométrique avec culling, zoom

### P2-0 : Coordinate System ✅
- [x] Conversion carte ↔ écran (mapToScreen, screenToMap)
- [x] Ordre de rendu (Painter's algorithm)
- [x] Culling spatial (rectangle englobant du diamant)

### P2-1 : Phaser Camera setup ✅
- [x] Scroll par drag (camera.setScroll)
- [x] Zoom à la roulette (camera.setZoom)
- [x] Centrage automatique sur la carte

### P2-2 : Rendu complet ✅
- [x] IsometricRenderer : orchestre TextureManager + TileRenderer
- [x] Boucle de rendu avec tri isométrique
- [x] World container pour le batching

### P2-3 : Culling dynamique ✅
- [x] Scan complet de la grille avec test de rectangle englobant
- [x] Rendu uniquement des tuiles visibles
- [x] Nettoyage des sprites avant re-render

### P2-4 : Texture Manager ✅
- [x] Génération procédurale de textures (canvas)
- [x] 12 palettes de couleurs (herbe, sable, eau, fairway, green...)
- [x] Dégradés diagonaux pour relief isométrique
- [x] Variations aléatoires par type
- [x] Textures de mur (pierre)

### P2-5 : Tile renderer ✅
- [x] Rendu diamond du sol avec empilement pour l'élévation
- [x] Murs sur les 4 côtés (graphics primitives)
- [x] Imposteurs arbres/buissons/fleurs
- [x] Texture "dirt" pour les couches souterraines

### P2-6 : Auto-tiling ✅
- [x] Masque de voisinage (4 bits NSEW)
- [x] Règles de transition (herbe↔eau, herbe↔sable, fairway↔green...)
- [x] Intégration dans le pipeline de rendu

---

## Phase 3 — Interaction tactile ✅

> Objectif : éditer le terrain au doigt, undo/redo, pinch zoom

### P3-0 : Hit detection ✅
- [x] Conversion tap→carte (screenToMap avec compensation caméra)
- [x] Surbrillance hover (diamond jaune)
- [x] Surbrillance sélection (diamond blanc avec point central)
- [x] Indicateurs de côtés en mode wall

### P3-1 : Outils d'édition ✅
- [x] TerrainEditor avec undo/redo (200 actions max)
- [x] Paint : changer type de sol (herbe, fairway, green, sable, eau)
- [x] Elevate / Lower : modifier l'altitude
- [x] Wall : toggle mur (détection automatique du côté via position du tap)
- [x] Inspect : mode lecture seule

### P3-2 : Toolbar UI ✅
- [x] Barre d'outils horizontale (6 outils + undo/redo)
- [x] Boutons interactifs avec hover
- [x] Raccourcis clavier 1-6 + Ctrl+Z / Ctrl+Shift+Z

### P3-3 : Pinch zoom ✅
- [x] Zoom à 2 doigts (pinch-to-zoom)
- [x] Clampé entre 0.4× et 2.5×

### P3-4 : Undo/Redo ✅
- [x] Piles undo/redo avec snapshots des tuiles modifiées
- [x] Boutons UI + raccourcis clavier
- [x] Re-render automatique après undo/redo

### P3-5 : Fichiers créés
- `src/core/TerrainEditor.ts` — moteur d'édition avec historique
- `src/render/InputHandler.ts` — hit detection, pinch zoom, surbrillance

## Phase 4 — Simulation & Systèmes de jeu ⏳

## Phase 5 — Interface utilisateur ⏳

## Phase 6 — Sauvegarde & Données ⏳

## Phase 7 — Déploiement & QA ⏳

---

## Résumé des dépendances

```
P0 ─── P1 ─── P2 ─── P3 ─── P4 ─── P5 ─── P6 ─── P7
```
