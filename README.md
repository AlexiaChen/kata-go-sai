# 弈境 · Kata Go Sai

一个面向浏览器的围棋项目。前端使用 React、TypeScript、Tailwind CSS、Vite 和 Phaser 3；规则与轻量 AI 完全在本地运行，可直接部署到 GitHub Pages。

> 当前版本是可玩的工程基线，不声称已经接入 KataGo 神经网络。界面中的 AI 是运行在 Web Worker 内的启发式 AI，神经网络与 MCTS 的接入边界见[架构说明](docs/architecture.md)。

## 当前能力

- 9、13、19 路棋盘，Phaser Canvas/WebGL 渲染
- 提子、禁入点、位置全局同形禁着、停一手、悔棋
- 双方连续停一手后结束，中国规则面积计分
- 人机/双人模式、选择执黑或执白、三档轻量 AI
- AI 在 Web Worker 中运行，不阻塞 React UI
- 响应式桌面与移动端布局
- Vitest 规则测试、GitHub Actions CI、GitHub Pages 自动部署

## 本地运行

需要 Node.js 22 或兼容版本。

```bash
npm ci
npm run dev
```

生产验证：

```bash
npm test
npm run build
npm run preview
```

也可使用与父目录中国象棋项目相近的 Make 入口：

```bash
make test
make build
make pages-build
```

## 项目结构

```text
src/
├── components/          # React 控制组件与 Phaser 容器
├── engine/              # Web Worker AI 及消息协议
├── game/
│   ├── boardScene.ts    # Phaser 棋盘场景
│   ├── rules.ts         # 纯 TypeScript 围棋规则与计分
│   └── rules.test.ts    # 规则回归测试
├── App.tsx              # 对局编排与界面
└── styles.css           # Tailwind CSS 入口与视觉样式
```

## 三个参考项目如何分工

| 项目 | 可复用部分 | 不应直接照搬的部分 |
|---|---|---|
| `chinese-chess` | Vite/CI/Pages、Worker 隔离、Phaser 生命周期、引擎桥接分层 | NNUE 是增量全连接评估，计算模型与围棋卷积网络不同 |
| `KataGo` | 围棋规则、特征、policy/value、MCTS 和 GTP/analysis 语义 | 官方后端依赖 CUDA/OpenCL/TensorRT/Eigen，不能直接编译成高性能浏览器 WASM |
| `maksimKorzh/go` | 小模型 + TF.js/WebGL 的纯前端可行性 | 裸网络无 MCTS，README 标称约 5 级/业余 1 段，不是职业棋力 |

详细原理、性能边界和 Rust/WASM 方案见 [docs/architecture.md](docs/architecture.md)。
