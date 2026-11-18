# 本地模型：llama.cpp

> 适用版本：v0.6.x 及以后 · 相关 spec：[llamacpp-integration.md](../../../.trae/specs/llamacpp-integration.md)
> 定位：与 Ollama **并存**的本地推理路径（`providerType = llamacpp`）。两者互不替代：Ollama 面向"已装好模型的服务"，llama.cpp 面向"由应用托管二进制与 GGUF 文件"。

---

## 1. 前置条件

| 项 | 说明 |
|---|---|
| 硬件 | CPU 可运行（`gpuLayers = 0` 纯 CPU）；有 GPU 时按层数卸载 |
| 模型文件 | **GGUF** 格式，放在 `<LIRI_DATA_DIR>/models/llama/models/`（默认）或配置项 `modelsDir` 指定的目录 |
| 二进制 | `llama-server`（Windows 为 `llama-server.exe`）由应用**按需下载**，版本锁定为 `LLAMA_VERSION`（当前 `b10225`），下载后做 SHA256 校验；未登记摘要的版本记 warning 并记录实际值 |
| 端口 | 默认 **11435**（刻意避开 Ollama 的 11434）；被占用时会先做"是否已是本应用实例"的接管判断 |

路径一律经 `resolveLlamaDir()` / `resolveLlamaBinaryPath()` / `resolveLlamaModelsDir()` 解析（`packages/infra/src/environment/paths.ts`），不要自行拼接。

---

## 2. 配置项（`config.json` 的 `llama` 段）

| 键 | 默认值 | 语义 |
|---|---|---|
| `host` | 本机回环地址 | 监听地址 |
| `port` | `11435` | 服务端口 |
| `model` | `''` | GGUF 绝对路径；**为空则不启动服务** |
| `autoStart` | `true` | 应用启动时是否自动拉起 |
| `gpuLayers` | `0` | GPU 卸载层数（0 = 纯 CPU） |
| `contextWindow` | `4096` | `--ctx-size` |
| `kvCache` | `high` | KV cache 量化：`low=q4_0` / `medium=q8_0` / `high=f16` |
| `threads` | `0` | `0` = 不传，交给 llama-server 自动 |
| `batchSize` | `0` | `0` = 不传（llama-server 默认 2048） |
| `temperature` | `0.8` | `--temp` |
| `topK` | `40` | `--top-k` |
| `topP` | `0.95` | `--top-p` |
| `repeatPenalty` | `1.1` | `--repeat-penalty` |
| `seed` | `-1` | `-1` = 随机 |
| `noMmap` | `false` | 仅开启时传 `--no-mmap` |
| `mlock` | `false` | 仅开启时传 `--mlock` |
| `flashAttn` | `auto` | `off` / `on` / `auto` |
| `modelsDir` | `''` | 自定义 GGUF 目录；空 = 默认目录 |

启动参数由纯函数 `buildArgs(config)` 组装（便于单测），**核心参数始终传、`threads`/`batchSize` 为 0 时不传、采样与高级参数显式传默认值**。

---

## 3. 设置页

**设置 → AI → llama.cpp**（`client/src/components/settings/LlamaConfigPanel.tsx`，由 `SettingsPage.tsx` 挂载）。

面板按「服务 / 模型 / 性能 / 采样 / 高级」分组：

- 服务：启停、端口、自动启动、日志查看、强制重启 / 强制终止；
- 模型：扫描 GGUF 目录 + 从状态接口拉取候选（**禁止写死模型名**），支持下载与迁移；
- 性能：GPU 层数、上下文窗口、KV cache 档位、线程、批大小；
- 采样：temperature / top-k / top-p / repeat-penalty / seed；
- 高级：`--no-mmap` / `--mlock` / flash-attn。

保存后按需重启服务生效（配置写入 `config.json` 的 `llama` 段）。

---

## 4. HTTP 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/v1/llama/status` | 服务状态（`stopped` / `downloading` / `starting` / `running` / `error`）、端口、模型、日志摘要 |
| GET / PUT | `/v1/llama/config` | 读取 / 保存配置（校验后持久化） |
| POST | `/v1/llama/restart` | 优雅重启 |
| POST | `/v1/llama/force-kill` | 强制终止子进程 |
| POST | `/v1/llama/force-restart` | 终止并重新拉起 |
| GET | `/v1/llama/logs` · `/v1/llama/logs/stream` | 日志快照 / 流式日志 |
| GET | `/v1/llama/hardware` | 硬件探测（用于推荐参数） |
| GET | `/v1/llama/recommendations` | 参数推荐 |
| POST | `/v1/llama/download` | 下载二进制 / 模型 |
| POST | `/v1/llama/migrate` · `/v1/llama/migrate/cancel` | 模型目录迁移与取消 |
| DELETE | `/v1/llama/models/{name}` | 删除本地模型文件 |

---

## 5. 启动与 Provider 注册

1. `LlamaCppServerManager.start()`：确保二进制 → 拉起子进程 → `/health` 就绪探测（失败按退避重启）→ 退出时回收；
2. 就绪后 `ensureLlamaCppProviderRegistered()` 经 `ProviderManager` 写入 DB（`baseUrl = http://<host>:<port>/v1`），再 `syncDBProvidersToRegistry()` 同步到运行时。

**模型数据流遵循「DB 是唯一事实来源」**：llama.cpp 的可用模型必须经模型管理注册（`model_registry`），代码不得写死模型名；任务分工（chat / embedding 等）仍走既有模型路由。

---

## 6. 与 Ollama 的边界

| 维度 | Ollama | llama.cpp |
|---|---|---|
| Provider 类型 | `ollama` | `llamacpp` |
| 默认端口 | 11434 | 11435 |
| 模型管理 | 由 Ollama 自身拉取 | 应用托管 GGUF 文件 + 二进制 |
| 配置入口 | 设置 → AI → Ollama | 设置 → AI → llama.cpp |

两者可同时启用；同一任务类型只会路由到一个模型，切换在「模型管理 → 任务分工」完成。

---

## 7. 故障排查

| 现象 | 排查 |
|---|---|
| `status = stopped` 且模型为空 | 未选择 GGUF ⇒ 先选模型再启动 |
| `status = downloading` 长时间不动 | 网络阻断；查看 `/v1/llama/logs` 与目标 URL 可达性 |
| 启动即失败 | 端口被占用（先看是否已是本应用实例）；GGUF 路径失效；二进制 SHA256 不匹配（日志含期望/实际值） |
| 推理中途退出 | 查看日志尾部；内存不足时降低 `contextWindow` / `gpuLayers` / `kvCache` |
| 设置页改了不生效 | 需点击「应用并重启」；只保存配置不会热加载 |

---

## 8. 相关文件

| 文件 | 职责 |
|---|---|
| `app/src/ai/local/llama/LlamaCppServerManager.ts` | 下载 / 校验 / 拉起 / 健康探测 / 重启 / 回收；`buildArgs` 纯函数 |
| `app/src/ai/local/llama/registerLlamaCppProvider.ts` | 就绪后写 DB provider 并同步 Registry |
| `app/src/ai/local/llama/LlamaModelsDirGuard.ts` | 模型目录安全校验 |
| `app/src/ai/local/llama/LlamaServerLogs.ts` | 子进程日志缓冲与快照 |
| `app/src/ai/providers/LlamaCppProvider.ts` | OpenAI 兼容 Provider 实现 |
| `app/src/infrastructure/http/handlers/llama-handlers.ts` · `routes/llama-routes.ts` | REST 接口 |
| `client/src/components/settings/LlamaConfigPanel.tsx` | 设置页面板 |
| `packages/infra/src/environment/paths.ts` | llama 路径解析（`resolveLlama*`） |
| `app/tests/ai/llama/LlamaCppServerManager.test.ts` | 参数组装 / 下载校验 / 健康检查 / 重启 |
