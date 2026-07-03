# AGENTS.md

This file defines the working contract for coding agents in `kata-go-sai`.

## Project intent

Build a browser-first Go/Weiqi application. The deployed static app must remain usable without a server. The current browser engine combines an official KataGo 10-block network with a low-visit batched PUCT/MCTS. Do not equate this simplified 4/12/24-visit search with full KataGo or claim professional strength without match evidence.

## Required checks

Before handing off a change, run:

```bash
npm test
npm run verify:model
npm run build
VITE_BASE_PATH=/kata-go-sai/ npm run build
git diff --check
```

For changes to Phaser rendering or pointer interaction, also exercise the app in a real browser when browser tooling is available. A TypeScript build is not sufficient validation for Canvas/WebGL behavior.

## Architecture boundaries

- `src/App.tsx` owns game orchestration and React UI state.
- `src/components/GoBoard.tsx` only owns the React-to-Phaser lifecycle bridge.
- `src/game/boardScene.ts` owns board drawing, stone drawing, hit testing, hover previews, and Phaser cleanup.
- `src/game/rules.ts` is the deterministic rules source of truth. It must not import React, Phaser, browser globals, or AI code.
- `src/engine/` owns Worker protocols and AI implementations. Expensive search must not run on the UI thread.
- The UI must communicate with future local or remote engines through a narrow adapter/protocol rather than importing an engine throughout the component tree.

React must not redraw stones as DOM overlays. Phaser owns all visible board entities and board pointer hit areas. React may render controls, status text, move history, and analysis panels around the canvas.

## Go rules invariants

Preserve these behaviors and add regression tests when changing them:

- Supported sizes are 9x9, 13x13, and 19x19.
- A move onto an occupied intersection is illegal.
- Opponent groups with no liberties are removed before checking suicide.
- Suicide is illegal unless the move first captures and gains liberties.
- Positional superko is checked against prior board hashes; passes do not create stones.
- Two consecutive passes finish the game.
- Undo restores the exact board, player, captures, pass count, history, and superko history.
- Current scoring is Chinese area scoring. During play, dead stones are not adjudicated, so UI estimates must be labeled approximate.

Keep `rules.ts` data serializable with structured clone so it can cross a Worker boundary. Avoid class instances and mutable `Set`/`Map` fields in `GameState`.

## Phaser lifecycle

- Create one `Phaser.Game` per mounted `GoBoard` and always call `game.destroy(true)` on unmount.
- Update an existing scene when position or interaction state changes; do not recreate the game for each move.
- Rebuild grid and hit areas only when board size changes.
- Keep the 800x800 logical coordinate system and responsive `Phaser.Scale.FIT` behavior unless a change includes browser verification.
- Phaser is lazy-loaded. Do not move it back into the initial React bundle without a measured reason.
- Pointer handlers must read the latest position and disabled state so AI turns cannot accept human moves.

## AI and model work

The current bot is `kata1-b10c128-s1141046784-d204142634`, converted to a TensorFlow.js GraphModel and executed with WebGL inside a Worker. `kataFeatures.ts` is responsible for its 22 spatial and 19 global features, including ladder channels 14-17. Preserve named model inputs/outputs, current-player value perspective, tensor disposal, explicit initialization, and visible error states.

`mcts.ts` owns batched PUCT selection, virtual loss, value backpropagation, root symmetry pruning, principal variation, and tree reuse. The three budgets are 4/12/24 new visits unless a measured change justifies different defaults. Do not silently replace model failures with heuristic play. A failure must be visible and the board must remain usable in two-player mode.

Current and preferred long-term split:

- TypeScript currently owns rules, feature encoding and MCTS. Rust/WASM is a future option for search-tree memory and control flow only after profiling demonstrates material benefit.
- TensorFlow.js WebGL is the measured current backend; WebGPU/ONNX Runtime Web may replace it only after comparative measurements.
- Web Worker: orchestration and isolation from rendering.
- Remote KataGo analysis service: optional high-strength mode, with local fallback.

Do not assume rewriting tensor inference in Rust/WASM makes it faster. Record model download size, startup time, peak memory, single-evaluation latency, visits per second, and device/backend before choosing an implementation.

Model strength claims require a reproducible match setup. In particular, do not describe either the raw reference PWA or this low-visit browser search as professional strength. Record opponent, colors, rules, visits/time, hardware, backend, game count and confidence interval.

## UI conventions

- User-facing copy is Simplified Chinese; code identifiers are English.
- Preserve keyboard-visible focus and disabled states for controls.
- Keep desktop and mobile layouts functional down to 320px.
- Clearly distinguish live results, estimates, loading states, failures, and engine limitations.
- Avoid adding remote fonts, trackers, or runtime CDN dependencies to the static app.

## Dependencies and generated files

- Use `npm ci` in CI and commit `package-lock.json` whenever dependencies change.
- Do not commit `node_modules`, `dist`, coverage, Vite-emitted config files, or `*.tsbuildinfo`.
- Prefer a small dependency surface. Phaser, React, TensorFlow.js, Vite, and Tailwind are deliberate choices; justify additional runtime packages.
- Keep the GitHub Pages base path configurable through `VITE_BASE_PATH`.
- Keep `public/models/dan/SHA256SUMS` in sync with intentional model asset changes. CI and Pages must verify the model before building.

## Reference projects

Sibling directories are read-only references:

- `../chinese-chess`: CI, Vite, Worker, WASM bridge, and Phaser lifecycle patterns.
- `../KataGo`: rules/search/model semantics and backend constraints.
- `../go`: small TF.js network and no-MCTS browser baseline.

Do not edit sibling repositories. Verify licenses and provenance before importing source code, weights, images, or data. Imported model assets must include a local license and provenance record.
