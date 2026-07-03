# 弈境 · Kata Go Sai

一个面向浏览器的围棋项目。前端使用 React、TypeScript、Tailwind CSS、Vite 和 Phaser 3；KataGo 10-block 小网络通过 TensorFlow.js/WebGL 在本地推理，可直接部署到 GitHub Pages。

当前网络是 `kata1-b10c128-s1141046784-d204142634`，三个权重分片约 11.4 MB。Worker 使用网络的 policy、value 和目差输出执行批量 PUCT/MCTS，而不是直接选择 policy 最大点。它仍是 4/12/24 visits 的浏览器受限搜索，不等同于完整 KataGo，也不宣称职业棋力。

[在线试玩](https://alexiachen.github.io/kata-go-sai/)

## 当前能力

- 9、13、19 路棋盘，Phaser Canvas/WebGL 渲染
- 提子、禁入点、位置全局同形禁着、停一手、悔棋
- 双方连续停一手后结束，中国规则面积计分
- 人机/双人模式、选择执黑或执白、三档 4/12/24 visits 搜索预算
- 22 路 KataGo 特征编码，包括当前与历史征子特征
- 批量 PUCT/MCTS、根节点对称裁剪、主变化和跨回合搜索树复用
- 10-block 网络、TensorFlow.js WebGL 批量推理
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
npm run verify:model
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
├── engine/              # KataGo 特征、征子、MCTS、TensorFlow.js Worker
├── game/
│   ├── boardScene.ts    # Phaser 棋盘场景
│   ├── rules.ts         # 纯 TypeScript 围棋规则与计分
│   └── rules.test.ts    # 规则回归测试
├── App.tsx              # 对局编排与界面
└── styles.css           # Tailwind CSS 入口与视觉样式
```

## 模型网络


模型文件来自参考项目，原始网络列于 [KataGo 官方训练站](https://katagotraining.org/networks/)，许可声明保存在 `public/models/dan/LICENSE.txt`。

这套 10-block 是 KataGo 官方归档中的最终 Extended Training b10c128；官方将 b10/b15 定位为更快、但配合原生搜索仍可达到职业以上的旧小网。该判断不适用于本项目仅 4/12/24 visits 的简化浏览器搜索。2026 年主训练站的新网络已是 b28/b40 量级，适合 PC GPU，不适合当前静态 Pages 包体与等待目标。

模型 JSON、三个权重分片、来源和许可证都已纳入 Git。CI/Pages 在构建前执行 `SHA256SUMS` 校验，因此线上部署使用的就是仓库内这套 10-block 网络，不依赖运行时下载 GitHub Release 或外部模型站。

## 浏览器搜索边界

开发环境的无头 Chromium WebGL 基准中，batch=4 预热后，4/12/24 visits 分别约 2.4/6.6/12.3 秒；首次模型加载和 shader 预热约 14.8 秒。实际速度取决于浏览器和 GPU。受限 MCTS 会比裸 policy 更能利用 value 纠错，但 24 visits 仍远低于桌面 KataGo 的常用预算，棋力需要通过固定对手对局测量，不能从模型大小或单盘观感推断。

详细原理、性能边界和 Rust/WASM 方案见 [架构说明](docs/architecture.md)；Web 与 WSL 模型选择见[模型和后端建议](docs/models-and-backends.md)。
