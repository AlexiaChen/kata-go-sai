# AGENTS.md

This file defines the working contract for coding agents in `kata-go-sai`.

## Project intent

Build a browser-first Go/Weiqi application. The deployed static app must remain usable without a server. Do not claim that a heuristic bot, a raw policy network, or a reduced search is “KataGo” unless the real engine and model are actually running.

## Required checks

Before handing off a change, run:

```bash
npm test
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

The current bot is a lightweight heuristic baseline. Any stronger engine should implement explicit initialization, cancellable move generation, optional streaming analysis, and disposal.

Preferred long-term split:

- Rust/WASM: rules, feature encoding, Zobrist hashing, MCTS/PUCT, tree reuse, and compact memory management.
- WebGPU/ONNX Runtime Web or another measured browser GPU backend: neural-network tensor execution.
- Web Worker: orchestration and isolation from rendering.
- Remote KataGo analysis service: optional high-strength mode, with local fallback.

Do not assume rewriting tensor inference in Rust/WASM makes it faster. Record model download size, startup time, peak memory, single-evaluation latency, visits per second, and device/backend before choosing an implementation.

Model strength claims require a reproducible match setup. In particular, do not describe the 4–11 MB raw networks from the reference PWA as professional strength; its own README estimates roughly 5 kyu and amateur 1 dan without MCTS.

## UI conventions

- User-facing copy is Simplified Chinese; code identifiers are English.
- Preserve keyboard-visible focus and disabled states for controls.
- Keep desktop and mobile layouts functional down to 320px.
- Clearly distinguish live results, estimates, loading states, failures, and engine limitations.
- Avoid adding remote fonts, trackers, or runtime CDN dependencies to the static app.

## Dependencies and generated files

- Use `npm ci` in CI and commit `package-lock.json` whenever dependencies change.
- Do not commit `node_modules`, `dist`, coverage, Vite-emitted config files, or `*.tsbuildinfo`.
- Prefer a small dependency surface. Phaser, React, Vite, and Tailwind are deliberate choices; justify additional runtime packages.
- Keep the GitHub Pages base path configurable through `VITE_BASE_PATH`.

## Reference projects

Sibling directories are read-only references:

- `../chinese-chess`: CI, Vite, Worker, WASM bridge, and Phaser lifecycle patterns.
- `../KataGo`: rules/search/model semantics and backend constraints.
- `../go`: small TF.js network and no-MCTS browser baseline.

Do not edit or copy generated/model artifacts from sibling repositories. Verify licenses and provenance before importing source code, weights, images, or data.
