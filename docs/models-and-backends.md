# 模型与运行后端建议

## Web 静态版

KataGo 官方站提供 `.bin.gz` 网络，不直接提供浏览器格式。本项目使用父目录 `go` 已转换的 TensorFlow.js GraphModel；原始模型来自 KataGo 官方 `kata1` 网络列表。

| 档位 | 网络 | 浏览器资产 | 推理方式 | 适用目标 |
|---|---|---:|---|---|
| 低配候选 | `kata1-b6c96-s175395328-d26788732` | 约 4 MB | 裸 policy | 移动端/旧设备，参考约 5 级；当前未打包 |
| 默认 | `kata1-b10c128-s1141046784-d204142634` | 约 11.4 MB | 裸 policy | 当前已打包，参考约业余 1 段 |
| 浏览器搜索版 | 同一 10-block 网络 | 约 11.4 MB | WebGPU + 受限 MCTS | 后续阶段；必须先解决批量推理和总等待时间 |

当前实测在无头 Chromium WebGL 环境中，预热后单次 19 路推理约 0.53 秒。按这个延迟逐次执行 32/64 visits 会过慢，因此当前 Web 版不应直接叠加串行 MCTS。后续需要 WebGPU、批处理和树并行实测后再决定搜索预算。

## WSL/PC 本地版

官方 KataGo README 的建议是：一般优先较新的 `b18c384nbt`，因为它每次评估更准确；如果特别重视速度，则选择 `b10c128` 或 `b15c192`，这些小网络配合搜索仍被官方描述为职业级以上。这里的“职业级”来自网络加 MCTS，不适用于 Web 裸 policy。

| 硬件 | 推荐网络 | KataGo 后端 | 初始预算 | 说明 |
|---|---|---|---|---|
| 纯 CPU、支持 AVX2 | `b10c128` | Eigen + AVX2 | `maxVisits=50–100`，`maxTime=2–5s` | 先跑 benchmark；低等待优先 10-block |
| 较强 CPU | `b15c192` | Eigen + AVX2 | `maxVisits=80–160`，`maxTime=3–8s` | 比 10-block 更准，但每次评估更慢 |
| WSL2 + NVIDIA GPU | `kata1-b18c384nbt-s9967423488-d4308703317` | CUDA 或 TensorRT | `maxVisits=100–400`，`maxTime=1–3s` | 官方目录中较新的 18-block 网络，推荐的职业级低延迟路线 |
| 高端 NVIDIA GPU | 较新 `b18c384nbt` 或官方当前强网 | TensorRT | benchmark 后提高 visits | 不必盲目选更大的 28/40-block 网络，优先每秒有效搜索强度 |

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
- 网络许可证：https://katagotraining.org/network_license/
- KataGo 引擎与模型选择说明：https://github.com/lightvector/KataGo
- 额外棋盘尺寸网络：https://katagotraining.org/extra_networks/
