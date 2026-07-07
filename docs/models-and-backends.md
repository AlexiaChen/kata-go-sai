# 模型与运行后端建议

## Web 静态版

KataGo 官方站提供 `.bin.gz` 网络，不直接提供浏览器格式。本项目使用父目录 `go` 已转换的 TensorFlow.js GraphModel；原始模型来自 KataGo 官方 `kata1` 网络列表。

截至 2026-07-03，官方归档中的最终 Extended Training 10-block 就是本项目使用的 `b10c128-s1141046784-d204142634`（原生压缩网络约 11 MB）。因此当前 Web 模型不是随意训练的小网，也没有一个更新很多、体积仍同为 b10c128 的官方替代品。主训练站的最新网络已经发展到 b28，最强置信网络为 b40；它们更适合桌面 GPU，不适合直接塞进纯静态 Web。

| 档位 | 网络 | 浏览器资产 | 推理方式 | 适用目标 |
|---|---|---:|---|---|
| 低配候选 | `kata1-b6c96-s175395328-d26788732` | 约 4 MB | 裸 policy 或极低 visits | 移动端/旧设备；当前未打包 |
| 默认 | `kata1-b10c128-s1141046784-d204142634` | 约 11.4 MB | WebGL + batch=4 PUCT/MCTS | 当前已打包，4/12/24 visits，含轻量 score utility 与动态 FPU |
| 后续浏览器版 | 同一 10-block 网络 | 约 11.4 MB | WebGPU + 更高 visits | 需先完成真实设备兼容和胜率基准 |

当前实测在无头 Chromium WebGL 环境中，预热后 batch=4 的 4/12/24 visits 搜索约 2.4/6.6/12.3 秒。实现以 policy 作为 PUCT 先验、value 与目差组成叶节点 utility，并复用后续回合命中的子树；它比裸 policy 更有纠错能力，但预算仍很低，不能据此声称职业棋力。

4 MB 的 6-block 裸网络可以降低下载和等待，但不会达到职业级。对当前目标，更合理的取舍是保留 10-block，并通过批处理、树复用和对称裁剪提高单位时间内的有效搜索，而不是退回更弱网络。

## WSL/PC 本地版

官方 KataGo README 的建议是：一般优先较新的 `b18c384nbt`，因为它每次评估更准确；如果特别重视速度，则选择 `b10c128` 或 `b15c192`，这些小网络配合搜索仍被官方描述为职业级以上。这里的“职业级”来自网络加 MCTS，不适用于 Web 裸 policy。

| 硬件 | 推荐网络 | KataGo 后端 | 初始预算 | 说明 |
|---|---|---|---|---|
| 纯 CPU、支持 AVX2 | `b10c128` | Eigen + AVX2 | `maxVisits=50–100`，`maxTime=2–5s` | 先跑 benchmark；低等待优先 10-block |
| 较强 CPU | `b15c192` | Eigen + AVX2 | `maxVisits=80–160`，`maxTime=3–8s` | 比 10-block 更准，但每次评估更慢 |
| WSL2 + NVIDIA GPU | `kata1-b18c384nbt-s8829289728-d4010562809` | CUDA 或 TensorRT | `maxVisits=100–400`，`maxTime=1–3s` | 官方 README 仍优先推荐最新/最强 b18，单位评估更准确 |
| 高端 NVIDIA GPU | 最新 b28，或当前最强置信 b40 | TensorRT | benchmark 后提高 visits | 2026 年主站强网；先比较有效搜索强度，不要只看网络 Elo |

访问数和时间只是安全的起始范围，不是棋力保证。KataGo 会同时受网络、后端、批大小、线程和 GPU 影响；应以本机 `benchmark` 结果调整。

### CPU/Eigen 构建

```bash
cmake -S ../KataGo/cpp -B build/katago-eigen \
  -DUSE_BACKEND=EIGEN -DUSE_AVX2=1 -DCMAKE_BUILD_TYPE=Release
cmake --build build/katago-eigen --config Release -j
./build/katago-eigen/katago benchmark -model /path/to/model.bin.gz
```

### NVIDIA/CUDA 构建

```bash
cmake -S ../KataGo/cpp -B build/katago-cuda \
  -DUSE_BACKEND=CUDA -DCMAKE_BUILD_TYPE=Release
cmake --build build/katago-cuda --config Release -j
./build/katago-cuda/katago benchmark -model /path/to/model.bin.gz
```

后续将 PC 模式接入 Web UI 时，应启动常驻的 KataGo analysis engine 和一个仅监听 `127.0.0.1` 的适配服务，通过 WebSocket 流式返回候选点、胜率、目差和 ownership。不要为每一步启动一次 KataGo 进程或重新加载模型。

## 官方来源

- KataGo 网络目录：https://katagotraining.org/networks/
- KataGo 旧版/小型网络归档：https://katagoarchive.org/g170/neuralnets/
- 网络许可证：https://katagotraining.org/network_license/
- KataGo 引擎与模型选择说明：https://github.com/lightvector/KataGo
- 额外棋盘尺寸网络：https://katagotraining.org/extra_networks/
