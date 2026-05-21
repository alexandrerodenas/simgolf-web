# Auto-Tiling Fix: Layer Priority & Asymmetric Transitions

> **Goal:** Replace the symmetric 45% blend with an asymmetric fade-out controlled by a strict layer priority hierarchy. Woods (highest priority) should gently recede into Grass at its borders, not be invaded by rectangular Grass borders.

**Root cause:** `renderAutoTileOverlays()` draws a transition strip on BOTH tiles at a boundary, each filled with the OTHER's color. This creates a visual mess where Grass aggressively bleeds into Woods.

**Fix:** Only the higher-priority tile draws a transition strip, filled with ITS OWN color → the dominant terrain fades out at its edge.

## Layer Priority (low → high)
Water < Sand < Fairway < Green < Grass < Rough < Rock < Woods

## Algorithm Change

In `renderAutoTileOverlays()`, for each tile `q` and each cardinal direction:
1. Get neighbor type
2. If `neighborType === q.type`: skip (same type, no transition)
3. If `priority(q.type) <= priority(neighborType)`: skip (only dominant draws)
4. If `priority(q.type) > priority(neighborType)`: draw transition strip with `q`'s base color at fixed opacity over `q`'s own pattern texture

## Files
- Modify: `src/render/TileRenderer.ts` (~line 343-415)

## Tasks

### Task 1: Add layer priority map and fix renderAutoTileOverlays

- [ ] **Step 1: Add `LAYER_PRIORITY` map** — an ordered Map or Record mapping TileType → priority number
- [ ] **Step 2: Modify `renderAutoTileOverlays`** — for each tile, for each neighbor, check priority. If dominant, draw strip with own color. Skip if not dominant.
- [ ] **Step 3: Remove `overlayColor` method** — no longer need neighbor's color lookup
- [ ] **Step 4: Build & verify** — `npm run build` must pass

### Task 2: Verify and commit

- [ ] **Step 1: Build** — `npm run build` passes with exit 0
- [ ] **Step 2: Final review** — read `renderAutoTileOverlays` to ensure logic is correct
- [ ] **Step 3: Commit** — clear message referencing the spec
