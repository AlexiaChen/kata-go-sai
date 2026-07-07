# Project Learnings

> Append-only knowledge base maintained during issue processing.
> Read this before model, engine, search, or strength-claim work to avoid repeating mistakes.
> Human edits welcome - add, annotate, or mark as [OBSOLETE].

---

### L-001: [gotcha] KataGo training Elo is not a human-rank claim (2026-07-07)
- **Issue**: b10 browser strength and model-choice discussion
- **Trigger**: KataGo Elo, b10c128, amateur rank, professional strength, model size
- **Pattern**: The KataGo training site Elo is an internal network-rating scale, not a direct conversion to human dan/kyu. The official `kata1-b10c128-s1141046784-d204142634` network is a real 2020 KataGo small/tiny architecture network, but this browser app runs only 4/12/24 visits of simplified search. Neither the network filename nor its training Elo proves the static Web app's playing rank.
- **Evidence**: `public/models/dan/PROVENANCE.md:1`, `docs/models-and-backends.md:1`, https://katagotraining.org/networks/
- **Confidence**: 10/10
- **Action**: When discussing strength, separate the official network's training rating from this app's measured engine strength. Do not translate KataGo training Elo into human rank without a reproducible match setup.

### L-002: [research] AlphaGo strength came from network-plus-search, not model age alone (2026-07-07)
- **Issue**: comparing the 2020 b10 model against AlphaGo Lee / AlphaGo Master history
- **Trigger**: AlphaGo, Lee Sedol, Ke Jie, residual network, model size, search
- **Pattern**: AlphaGo beat Lee Sedol in March 2016 and AlphaGo Master beat Ke Jie at the May 2017 Future of Go Summit. The 2016 AlphaGo paper describes policy networks, value networks, rollouts, and Monte Carlo tree search; AlphaGo Zero's 2017 paper/blog is the later shift to one network, no rollouts, and self-play reinforcement learning. Therefore "2020 model is newer than AlphaGo" is not enough: hardware, architecture, training target, and search budget dominate the comparison.
- **Evidence**: https://deepmind.google/research/alphago/, https://www.nature.com/articles/nature16961, https://deepmind.google/blog/alphago-zero-starting-from-scratch/, https://www.nature.com/articles/nature24270
- **Confidence**: 9/10
- **Action**: When using AlphaGo as intuition, state exact dates and distinguish AlphaGo Lee, AlphaGo Master, AlphaGo Zero, and KataGo. Avoid implying this browser b10 search can match historical AlphaGo without games.

### L-003: [architecture] Improve b10 Web strength by spending each evaluation better before changing models (2026-07-07)
- **Issue**: user explicitly scoped current work to the existing b10 model
- **Trigger**: MCTS, PUCT, FPU, score utility, b10 only, WebGL, low visits
- **Pattern**: For this static Web app, larger models are not the current path. The useful search-side improvements are small, measurable changes that preserve the b10 GraphModel and the 4/12/24 visit budgets: score-aware utility, dynamic first-play urgency, batching, tree reuse, root symmetry pruning, and focused regression tests. Training-side ideas like playout cap randomization do not directly improve an already-converted model at runtime.
- **Evidence**: `src/engine/mcts.ts:1`, `src/engine/mcts.test.ts:1`, `../KataGo/cpp/search/searchparams.h:1`, `../KataGo/cpp/search/searchhelpers.cpp:271`
- **Confidence**: 9/10
- **Action**: For future b10-strength work, prefer one search heuristic at a time, add a synthetic regression that proves the intended behavior, and keep default visits unchanged unless measurement justifies a budget change.

### L-004: [gotcha] Raw TF.js KataGo value and score outputs are current-player perspective here (2026-07-07)
- **Issue**: adding score lead to browser MCTS utility
- **Trigger**: scoreLead, miscvalues_output, current player, white perspective, KataGo postprocess
- **Pattern**: KataGo's native C++ `NNOutput` stores values from white's perspective after `nneval.cpp` postprocessing. The raw model output read by this TF.js worker is earlier in the pipeline and is from the side-to-move perspective, matching the existing `winLossValue()` contract. Flipping the score lead to white perspective inside the browser worker would make backpropagation use the wrong sign.
- **Evidence**: `src/engine/browserAi.worker.ts:164`, `../KataGo/cpp/neuralnet/nninputs.h:130`, `../KataGo/cpp/neuralnet/nneval.cpp:1040`, `../KataGo/cpp/neuralnet/nneval.cpp:1168`
- **Confidence**: 9/10
- **Action**: Preserve current-player perspective for value and score in `NetworkEvaluation`. If adding KataGo-style white-perspective postprocessing later, update feature/output tests and MCTS sign handling together.

### L-005: [validation] Search-tuning tests prove mechanics, not Elo (2026-07-07)
- **Issue**: score utility and dynamic FPU implementation
- **Trigger**: MCTS test passes, strength claim, benchmark, Elo
- **Pattern**: Unit tests can prove that MCTS batches evaluations, reuses a subtree, overturns a misleading policy, and prefers a larger score lead when win/loss value is tied. They do not prove human rank, pro strength, or real-game Elo. Browser performance and strength still need fixed hardware, backend, opponent, game count, rules, time/visits, colors, and confidence intervals.
- **Evidence**: `src/engine/mcts.test.ts:1`, `AGENTS.md:1`
- **Confidence**: 10/10
- **Action**: Treat passing tests as implementation evidence only. Before making public strength claims, run reproducible matches or at least fixed-position comparisons against a known opponent.
