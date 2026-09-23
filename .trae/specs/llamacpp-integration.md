# llama.cpp 内置集成 Spec

> 版本: 0.2 | 创建: 2026-08-10 | 状态: 待审阅
> 关联: GR15（Spec-Driven Development）/ GR16-002（跨模块变更必须建 Spec）/ model-usage.md（DB 唯一事实源）
> 决策背景: Ollama 本身基于 llama.cpp，但其配置受 Ollama 官方格式约束。本方案**保留 Ollama 并存**，
> 新增内置 llama.cpp（官方预编译二进制），并在设置模块开发**专业配置页面**，让专业人员按实际环境/场景
> 直接配置 llama.cpp 运行参数（GPU/上下文/KV cache/采样等）。集成方式为官方预编译二进制（纯 TS 项目无 C++ 编译链）。

## 1. 职责边界

- **本模块负责**:
  - `llama-server` 二进制生命周期管理（下载、SHA256 校验、拉起、健康检查、崩溃重启、退出回收）
  - `LlamaCppProvider` 作为独立 local 推理供应商接入 Provider 体系（OpenAI 兼容协议），与 Ollama **并存互不冲突**
  - GGUF 模型文件管理（存放、注册到 `model_registry`、映射任务）
  - **llama.cpp 专业配置页面**（设置模块）：暴露真实运行参数（GPU 层数/上下文/KV cache/线程/采样等），持久化并组装启动命令
- **本模块不负责**:
  - 删除/改动 Ollama（保留并存；`ollama` providerType、OllamaTransport、前端 Ollama 配置原样保留）
  - 训练/微调模型（仅推理服务）
  - 云供应商（OpenAI/DeepSeek 等）任何行为
  - 修改 chat 运行时模型路由架构（modelRouter 不变，仅 `local` 任务可解析到 llama.cpp 或 Ollama 模型，由用户在任务分工选择）

## 2. 架构设计

### 2.1 协议链路（复用 OpenAI 兼容）

```
LlamaCppProvider → ChatCompletionsTransport（现有，复用）
  → llama-server /v1/chat/completions（OpenAI 兼容）
  → OpenAIFormatter / OpenAIResponseParser（现有，复用）
```
- llama.cpp server 原生提供 `/v1/chat/completions` + `/health` + `/models`，与现有 OpenAI 兼容传输链无缝衔接。
- 验证项：确认 `ChatCompletionsTransport` 仅依赖 OpenAI 兼容协议（无供应商专属字段），若有依赖再局部适配。

### 2.2 二进制与模型存储（路径收敛到 `core/paths.ts`）

```
~/.pyapp/data/models/llama/          # resolveModelsDir()/llama（新增路径函数 resolveLlamaDir）
├── llama-server(.exe)               # 官方预编译二进制（锁定版本 + SHA256 清单）
├── models/                          # 用户 GGUF 模型（*.gguf）
└── version.json                     # 当前二进制版本号（升级依据）
```

- 新增 `resolveLlamaDir()` / `resolveLlamaBinaryPath()` 到 `core/paths.ts`（项目唯一路径注册表）。
- 二进制来源：官方 Release 的预编译 `llama-<version>-bin-<platform>.zip`，**锁定具体版本 + SHA256 校验**，不追 latest。

### 2.3 服务生命周期（LlamaCppServerManager）

```
启动链（main.ts → initializeModelManagementServices 旁挂载）
  → 检测 binary（缺失/版本不符 → 下载+校验）
  → 检测端口占用（已有 llama-server 在跑 → 直接接管，不重复拉起）
  → 拉起子进程（--port <LLAMA_PORT> --model <model.gguf>）
  → /health 轮询就绪
  → 就绪后 LlamaCppProvider 激活
  → 崩溃 → 自动重启（带退避） | 应用退出 → kill 子进程
```

- 端口: 默认 `localhost:11435`（避开 Ollama 11434），可配置，环境变量 `LLAMA_CPP_PORT`。
- GPU 选项: 启动参数 `--n-gpu-layers`（CPU=0），可配置，默认按平台探测（Windows 有 CUDA 二进制时用 GPU）。
- 二进制下载可用 `fetch` + 解压（`node:zlib`/`extract-zip`），进度回调前端展示。

### 2.4 Provider 注册（走现有 DB → Registry 链路，与 Ollama 并存）

- `ProviderType` 枚举（`ai/providers/ProviderManager.ts`）新增 `'llamacpp'`；**`'ollama'` 保留**。
- DB `providers` 表由 `LlamaCppServerManager` 就绪后通过 `ProviderManager.createProvider()` 写入（name=`llama.cpp`，providerType=`llamacpp`，baseUrl=`http://localhost:<port>/v1`，requiresAuth=false），再经 `ProviderSyncService.syncDBProvidersToRegistry()` 同步（**不绕过体系手动注册**，符合 §1.5 模型数据一致性）。
- `models.default.yaml` 播种**保留 `ollama-*`**，新增 `llamacpp` 预设模型（如 `llama3.1-8b`），capability 走 DB。
- 任务分工中 `local` 等任务可解析到 llama.cpp 或 Ollama 模型，由用户在「模型管理 → 任务分工」自由选择（UUID 体系天然支持并存）。

### 2.5 专业配置页面（设置模块）

**入口**: 设置模块新增 `llama.cpp` 子页（对齐现有 `LogViewerPage`/`VoiceSettings` 挂载方式，`SettingsPage.tsx` 的 case 分发 + 侧边栏入口）。

**配置存储**: `~/.pyapp/config.json` 的 `llama` 段（`configManager` 读写），由 `LlamaCppServerManager` 读取并组装 `llama-server` 启动命令；参数变更 → 重启服务生效（页面提供"应用并重启"动作）。

**配置项分组**（设计定稿 2026-08-10；**全部行已实现**：后端 `LlamaServerConfig`/`buildArgs`/`validateConfig`/PUT API + 前端 LlamaConfigPanel 表单控件）：

| 分组 | llama-server 真实参数 | 配置字段 | 默认值 | 说明 |
|------|-----------------------|---------|--------|------|
| 服务 | `--host` | `host` | 127.0.0.1 | 监听地址 |
| 服务 | `--port` | `port` | 11435 | 避开 Ollama 11434 |
| 服务 | （自动启动开关） | `autoStart` | true | 随应用启动 |
| 模型 | `--model <GGUF 路径>` | `model` | — | 从 `models/*.gguf` 扫描下拉，**禁止写死模型名** |
| 性能 | `--n-gpu-layers` | **`gpuLayers`** | 0 | 0 = 纯 CPU；CUDA/Vulkan 二进制才可 >0 |
| 性能 | `--ctx-size` | **`contextWindow`** | 4096 | 与 `model_registry.context_window` 联动提示 |
| 性能 | `--cache-type-k` / `--cache-type-v` | `kvCache` | high (f16) | 档位: low=q4_0 / medium=q8_0 / high=f16（显存敏感） |
| 性能 | `--threads` | `threads` | 0（自动） | 0 = 不传，llama-server 默认按 CPU 核心数 |
| 性能 | `--batch-size` | `batchSize` | 0（默认 2048） | 0 = 不传 |
| 采样 | `--temp` | `temperature` | 0.8 | 显式传默认值（决策 D2） |
| 采样 | `--top-k` | `topK` | 40 | |
| 采样 | `--top-p` | `topP` | 0.95 | |
| 采样 | `--repeat-penalty` | `repeatPenalty` | 1.1 | |
| 采样 | `--seed` | `seed` | -1 | -1 = 随机 |
| 高级 | `--no-mmap` | `noMmap` | false | 开关 |
| 高级 | `--mlock` | `mlock` | false | 开关，锁定内存防换页 |
| 高级 | `--flash-attn [on/off/auto]` | `flashAttn` | auto | 三态选择 |

**设计决策**：

- **D1（KV cache 参数纠正）**：spec 原稿 `-nkv` 为笔误——llama-server 无该参数。KV cache 量化实际用 `--cache-type-k` / `--cache-type-v`（值 `f16`/`q8_0`/`q4_0` 等）。档位 low/medium/high 对应 `q4_0`/`q8_0`/`f16`。
- **D2（采样/高级显式传默认值）**：采样与高级参数**始终显式拼入启动命令**，默认值与 llama.cpp 原生默认一致（temp=0.8、top-k=40、top-p=0.95、repeat-penalty=1.1、seed=-1、flash-attn=auto）。优点：启动命令完整可审计；不采用"留空不传"方案。
- **D3（线程/批大小 0=自动）**：`threads`/`batchSize` 用 `0 = 不传（llama-server 自动）` 语义，避免平台探测/核心数检测逻辑（spec 原稿"按平台探测"复杂度高、收益低）。
- **D4（buildArgs 抽纯函数）**：后端 `start()` 的参数组装抽为 `buildArgs(config)` 纯函数，便于单测覆盖全部参数与条件传参。
- **D5（实施范围）**：用户决策 2026-08-10 设置页扩展**只出设计不改码**，随后确认分两步实施（2026-08-10 全部落地）：① 后端 `LlamaServerConfig` 扩展 16 字段 + `buildArgs()` + `validateConfig` + PUT API 映射（测试 16 用例全过）；② 前端 `llamaService.LlamaConfig` 类型对齐 + `LlamaConfigPanel` 补全 KV cache 档位/线程/批大小/采样 5 项/高级 3 项控件（typecheck ✓ + eslint 0 告警）。**D1-D4 定义的 UI 交互全部实现**。

**配置模型**（最终形态，供后端 LlamaServerConfig 扩展）:

```typescript
interface LlamaServerConfig {
  host: string;
  port: number;
  model: string;
  autoStart: boolean;
  // 性能
  gpuLayers: number;                          // --n-gpu-layers（0=纯CPU）
  contextWindow: number;                      // --ctx-size
  kvCache: 'low' | 'medium' | 'high';         // --cache-type-k/v（D1）
  threads: number;                            // --threads（0=自动，D3）
  batchSize: number;                          // --batch-size（0=自动，D3）
  // 采样（显式传默认值，D2）
  temperature: number;                        // --temp
  topK: number;                               // --top-k
  topP: number;                               // --top-p
  repeatPenalty: number;                      // --repeat-penalty
  seed: number;                               // --seed（-1=随机）
  // 高级
  noMmap: boolean;                            // --no-mmap
  mlock: boolean;                             // --mlock
  flashAttn: 'off' | 'on' | 'auto';           // --flash-attn
}
```

**API**:
- `GET /v1/llama/config` — 当前配置 + 服务状态 + 模型列表（GGUF 扫描）
- `PUT /v1/llama/config` — 保存配置（持久化 config.json）
- `POST /v1/llama/restart` — 应用配置并重启服务

**校验**: 配置变更前校验 GGUF 存在、端口未被占用、参数数值范围（如 `-ngl >= 0`）。

## 3. 公共 API

| 导出 | 类型 | 位置 | 说明 |
|------|------|------|------|
| `LlamaCppServerManager` | class | `ai/local/llama/LlamaCppServerManager.ts` | 二进制/服务生命周期管理 |
| `LlamaCppProvider` | class | `ai/providers/LlamaCppProvider.ts` | 推理供应商（复用 ChatCompletionsTransport） |
| `handleLlamaStatus` | function | HTTP handler | `GET /v1/llama/status`（二进制版本/服务状态/模型列表） |
| `handleLlamaConfig` | function | HTTP handler | `GET/PUT /v1/llama/config`（专业配置读写） |
| `handleLlamaRestart` | function | HTTP handler | `POST /v1/llama/restart`（应用配置并重启服务） |
| `syncLlamaModelsToRegistry` | function | `ai/local/llama/registerLlamaCppProvider.ts` | GGUF → model_registry 同步（幂等，provider 注册后自动执行） |
| `resolveLlamaDir` | function | `core/paths.ts` | 路径入口 |

## 4. 依赖

| 依赖 | 方向 | 说明 |
|------|:---:|------|
| `core/paths.ts` | ↑ 核心层 | 路径唯一入口（新增 resolveLlamaDir） |
| `ai/providers/ProviderManager.ts` | → | ProviderType 枚举扩展 + createProvider |
| `ai/providers/ProviderSyncService.ts` | → | DB → Registry 同步（复用） |
| `ai/transports/ChatCompletionsTransport.ts` | → | OpenAI 兼容传输（复用，验证无供应商专属依赖） |
| `@modules/error` / `@modules/monitoring` | ↑ 核心层 | handleError / Logger（module: `ai:llama`） |
| `models.default.yaml` | → | 播种更新（is_custom=0 预设） |

## 5. 数据模型

- 无新表。沿用 `providers`（新增 llamacpp 行）、`model_registry`（GGUF 模型，provider_id 指向 llamacpp provider）。
- `ai_app_model_configs` 中 `local`/`default` 任务映射更新为 llamacpp 模型 UUID（走既有 setTasks，UUID 统一）。
- `~/.pyapp/data/models/llama/` 为二进制与 GGUF 文件存放（第二层数据目录，git 忽略）。

## 6. 实施步骤

### Phase 1 — 服务管理基础设施
- [ ] `core/paths.ts` 新增 `resolveLlamaDir()` / `resolveLlamaBinaryPath()`
- [ ] 新增 `ai/local/llama/LlamaCppServerManager.ts`：版本锁定清单（version+SHA256+URL）、下载解压、`/health` 探测、端口接管判断、子进程拉起/重启（退避）/回收
- [ ] 新增 `GET /v1/llama/status` handler + 路由注册（memory-files-routes 风格，走现有分发链）
- [ ] 单测：mock `child_process.spawn` / `fetch`，覆盖下载校验、健康检查、崩溃重启

### Phase 2 — Provider 接入
- [ ] `ProviderType` 新增 `'llamacpp'`；验证/适配 `ChatCompletionsTransport` 可复用
- [ ] 新增 `LlamaCppProvider`（继承 BaseAIProvider，OpenAI 兼容）
- [ ] 启动链挂载：`LlamaCppServerManager.start()` 就绪 → `ProviderManager.createProvider()` → `syncDBProvidersToRegistry()`
- [ ] `models.default.yaml`：**保留 `ollama-*` 预设**，新增 llamacpp 预设；`lint:models` 白名单同步

### Phase 3 — 专业配置页面（Ollama 保留）
- [ ] 新增 llama.cpp 配置 API：`GET/PUT /v1/llama/config`、`POST /v1/llama/restart`（存 config.json `llama` 段，服务重启联动）
- [ ] 前端设置模块新增 `llama.cpp` 子页（`SettingsPage.tsx` case + 侧边栏入口）：服务/模型/性能/采样/高级分组表单
- [ ] 模型候选从 GGUF 目录扫描 + `/v1/llama/status` 拉取（**禁止写死模型名**）
- [ ] 参数校验（GGUF 存在 / 端口占用 / 数值范围）+「应用并重启」动作
- [ ] Ollama 相关代码与配置**原样保留**，两 provider 并存验证

### Phase 4 — 验证
- [ ] `bun run typecheck` / `lint` / `test` / `lint:arch` / `lint:models` 全绿
- [ ] 实机验证：无二进制 → 下载 → 拉起 → chat 走本地推理 → 崩溃重启
- [ ] `app/docs/` 本地模型文档更新 + `modules:snapshot`

## 7. 合规检查表

- [ ] CS01 归一化：复用 ChatCompletionsTransport / ProviderManager / ProviderSyncService，不另起炉灶
- [ ] 并存验证：Ollama provider/配置/前端入口原样保留，llamacpp 与其互不冲突（端口避开 11434、ProviderType 独立、任务映射可分别指向）
- [ ] CS04 Mock 零容忍：LLAMA 下载/启动逻辑全部真实实现
- [ ] §1.5 模型数据一致性：llamacpp provider 仅经 ProviderManager 写入 + syncDBProvidersToRegistry 同步
- [ ] model-usage.md：GGUF 模型经 `model_registry` 注册，代码不写死模型名（前端候选来自 API）
- [ ] §1.13 路径注册表：llama 路径收敛到 `core/paths.ts`，禁止 `join(homedir(),...)` 拼路径
- [ ] §1.8/§1.9：Logger（module `ai:llama`）/ handleError 统一入口
- [ ] R04-001：新文件 < 800 行（LlamaCppServerManager 若超限按子域拆分）
- [ ] 验证记录：typecheck / lint / test / lint:arch / lint:models
