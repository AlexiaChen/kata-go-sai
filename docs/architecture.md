# Web KataGo 架构与推理路线

## 1. 结论

Vite 可以直接构建 React，本项目已使用 React + Vite + Tailwind CSS 4。静态 Web 与 Serverless 托管完全可行，但“完整 KataGo 推理”不适合普通按请求计费的 CPU Serverless Function。

建议把问题分成三层：

1. React 管理对局状态、设置、棋谱和分析展示；Phaser 只管理棋盘渲染与指针交互。
2. Worker 管理规则、特征编码、MCTS 树和批量调度；只有性能剖析证明有收益后再把控制逻辑迁移到 Rust/WASM。
3. 神经网络张量计算优先使用 WebGPU；WASM SIMD 作为兼容回退，而不是唯一后端。

当前仓库已经实现 React/Phaser 界面、可替换的 Worker 协议、TensorFlow.js/WebGL 10-block 批量推理，以及 TypeScript PUCT/MCTS。搜索包含树复用、虚拟损失、根节点对称裁剪和 14–17 征子输入特征。Rust/WASM 搜索和远端原生 KataGo 是可选后续阶段。

## 2. 三个项目的原理差异

### 中国象棋项目

父目录 `chinese-chess` 将 C++ 规则、搜索与 Pikafish NNUE 一起用 Emscripten 编译成 WASM，模型作为 `.data` 预加载，搜索放在 Web Worker。NNUE 对单个局面的评估很小，并且可随走子增量更新，因此 CPU/WASM 能得到良好响应。

这个项目适合复用的是工程结构：

- UI 与引擎桥接分离；
- 搜索进入 Worker；
- Pages base path 由 Vite 环境变量注入；
- CI 同时执行测试和生产构建；
- Phaser 场景由框架组件创建、更新和销毁。

### KataGo

KataGo 不是 NNUE。它以多层卷积/残差网络同时输出 policy、胜率/局势价值、目差和所有权等结果，MCTS 每扩展一个节点都需要网络评估。官方 C++ 项目提供 CUDA、TensorRT、OpenCL、Metal 与 Eigen 后端；其中 Eigen 是 CPU 后端，但官方说明即使在原生 AVX2 CPU 上，小型 15/20-block 网络也常见只有每秒 10–20 次访问。

把 C++ 改写为 Rust 再编译 WASM，只能改善内存安全、接口和部分控制逻辑，不能消除卷积网络的主要计算量。浏览器 WASM SIMD 也不等于原生 AVX2，更不等于 GPU 批处理。

### `maksimKorzh/go`

这个项目使用 TensorFlow.js，优先选择 WebGL 后端，加载约 4 MB 的 6-block 网络和约 11 MB 的 10-block 网络。每次直接使用裸网络选择着法，没有 MCTS，因此速度和包体适合 PWA。

代价是棋力上限：项目 README 标称小网约 OGS 5 级、大网约 OGS 业余 1 段，并明确说明裸网络会在征子、死活等战术上失误。KataGo 文档提到小型 `b10c128` 网络可达到职业级以上时，指的是网络配合搜索，不是直接取 policy 最大值。

## 3. 推荐的渐进式推理方案

### A. 纯静态、裸小网（参考基线）

- 模型：6-block 或 10-block，4–11 MB 量级；
- 后端：当前为 TensorFlow.js WebGL；后续可对比 ONNX Runtime Web/WebGPU；
- 搜索：无，或只做规则过滤和少量战术修正；
- 目标：快速、离线、约 5 级到业余初段，不承诺职业棋力。

这是 GitHub Pages 最容易稳定交付的版本。

### B. 纯静态、小网 + 受限 MCTS（当前实现）

- TypeScript：棋盘、合法性、特征编码、PUCT、树复用和根节点对称裁剪；
- TensorFlow.js/WebGL：网络加载和 batch=4 推理；
- Worker：搜索和张量执行均与 UI 线程隔离；
- 搜索预算：当前为 4/12/24 visits，并受 4/8/16 秒硬上限约束；
- 目标：明显强于裸网络，但实际棋力必须通过固定硬件和对局集测量。

Rust/WASM 仍适合搜索树和规则，但目前总耗时由卷积推理主导。先手写 Rust CPU 卷积不会自动变快；后续应先实测 WebGPU/ONNX Runtime Web，再决定迁移边界。

### C. 远端完整 KataGo

- 常驻 GPU 容器加载 KataGo 和模型；
- Web 端通过 HTTP/WebSocket 使用 KataGo analysis engine；
- 按用户/棋局限制 visits、并发和超时；
- 前端仍可回退到本地轻量 AI。

这条路线可以提供强棋力和实时胜率/目差/所有权图。部署目标应是有 GPU 的常驻容器或推理平台，不是普通 CPU Function：函数冷启动、模型下载、内存限制、执行时长和缺少 GPU 都会抵消 Serverless 的优势。

## 4. 引擎边界

当前 `src/engine/types.ts` 定义了 Worker 请求/响应，`kataFeatures.ts` 生成固定的 `[1,361,22]` 和 `[1,19]` 输入，`browserAi.worker.ts` 加载 10-block GraphModel。UI 不感知 TensorFlow.js 细节：

```text
React / Phaser
      │ GameState + search budget
      ▼
Engine Worker
      ├── TypeScript 批量 PUCT/MCTS（当前）
      ├── TensorFlow.js 10-block policy/value（当前）
      ├── Rust/WASM 搜索 + WebGPU model（候选）
      └── remote KataGo analysis client
```

下一阶段建议扩展为统一的 `EngineAdapter`：

- `init(model, device)`：加载模型并完成设备基准；
- `genmove(position, budget, signal)`：可取消搜索；
- `analyze(position, budget, onUpdate)`：流式返回候选点、胜率、目差和所有权；
- `dispose()`：释放 GPU buffer、Worker 和 WASM 内存。

## 5. 下一阶段验收指标

不要只用“能运行”判断模型方案。至少记录：

- 首次模型下载大小、解压后内存、冷启动时间；
- 9/13/19 路单次 batch=1 推理延迟；
- 4/12/24 visits 总耗时、有效 visits/s 与 UI 帧率；
- Chrome WebGPU、Safari WebGPU、无 WebGPU 回退行为；
- 连续 20 盘后的内存是否稳定；
- 对固定 GTP 对手的 Elo/胜率，而不是用模型大小推断棋力。

当前在无头 Chromium WebGL 环境中的一次开发态测量为：模型加载加 batch=1/batch=4 shader 预热约 14.8 秒；预热后 4/12/24 visits 搜索约 2.4/6.6/12.3 秒。batch=4 明显优于逐叶串行推理，但该数字不代表所有设备；生产部署和真实 GPU/移动设备仍需分别测量。

当前 PUCT 是面向浏览器低预算的简化实现，并非逐行移植 KataGo 搜索。它未包含 KataGo 的 score utility、LCB、图搜索、子树价值偏差修正等高级机制。是否增强这些机制，应以固定 GTP 对手的胜率回归为依据。
