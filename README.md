# 弈境 · Kata Go Sai

一个面向浏览器的围棋项目。前端使用 React、TypeScript、Tailwind CSS、Vite 和 Phaser 3；KataGo 10-block 小网络通过 TensorFlow.js/WebGL 在本地推理，可直接部署到 GitHub Pages。

当前网络是 `kata1-b10c128-s1141046784-d204142634`，三个权重分片约 11.4 MB。它直接使用 policy 选点，不含 MCTS；参考项目标称约 OGS 业余 1 段，不应描述为职业棋力。

## 当前能力

- 9、13、19 路棋盘，Phaser Canvas/WebGL 渲染
- 提子、禁入点、位置全局同形禁着、停一手、悔棋
- 双方连续停一手后结束，中国规则面积计分
- 人机/双人模式、选择执黑或执白、三档 policy 选择方式
- 22 路 KataGo 特征编码、10-block 网络、WebGL 推理
- 模型加载和推理在 Web Worker 中运行，不阻塞 React UI
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
├── engine/              # KataGo 特征、TensorFlow.js Worker 及消息协议
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

模型文件来自参考项目，原始网络列于 [KataGo 官方训练站](https://katagotraining.org/networks/)，许可声明保存在 `public/models/dan/LICENSE.txt`。

详细原理、性能边界和 Rust/WASM 方案见 [架构说明](docs/architecture.md)；Web 与 WSL 模型选择见[模型和后端建议](docs/models-and-backends.md)。
