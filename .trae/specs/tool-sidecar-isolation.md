# Spec：重型工具侧车隔离（Tool Sidecar Isolation）

> 版本: **v1.0（定案稿）** ｜ 创建: 2026-10-13 ｜ 状态: **待用户批准实施（HARD-GATE：批准前不写产品代码）**
> 来源:
> · `dev_docs/20261012/重型工具侧车化-盘点清单-20261012.md`（22 项工具 × 依赖/进程边界/常驻/崩溃面；**已裁定的靶点重排**：P1 常驻 LSP / P2 媒体原生面 / P3 `liri-native` 评估项）
> · `dev_docs/20261012/工具治理方案-20261012.md` §5 阶段 2（2.1 已盘点 → 2.2/2.3 待实施）+ §8「2.2 落地切片规划」
> · `dev_docs/20261012/五方案总览-20261012.md` §2 的 `T1-10`/`T1-11` + §8.1（现状：**仅盘点与裁定、零实现**）
> · `dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md`（**D10**；其 **P1「轻量 IPC 基座收敛」已于 2026-10-10 落地** = `app/src/utils/sidecarIpc.ts`）
> 关联规则: **CD05/CD06/CD07**（`code-deletion.md`）· **CS01/CS03/CS05/CS06**（`coding-standards.md`）· **R03/R09**（`architecture.md` 分层：`core`/`infra` 不可引 `service`/`app`）· `project_rules` §1.4（三级开关解析）
> 参照格式: `.trae/specs/long-task-suspend-resume.md`（头部/§0 修订记录/§1…§10）
> 方法: **逐条回仓取证（`file:line`）+ 全仓 grep 交叉验证**；凡"未找到"如实标注（CS06）。**未修改任何产品代码**。

---

## §0 修订记录

| 版本 | 变更 | 依据 |
|---|---|---|
| **v1.0（2026-10-13）** | **定案稿**：把已裁定的靶点重排（P1 常驻 LSP / P2 媒体原生面）落为**可实施 spec**：§1 现状取证（LSP 双轨、媒体原生面、IPC 基座落地）、§2 目标/不目标、§3 逐条定案 **D1–D11**、§4 实施阶段（含验收）、§5 接口/契约、§6 验收标准、§7 风险与回滚、§8 明确不做（Negative list）、§9 与其它 spec/方案的接口、§10 合规清单、**§11 实施切片计划**。**本文不含产品代码改动**。 | 用户 2026-10-13 指派"先出 spec 再实施"；输入 = 上述四份 `dev_docs` 证据底稿 |

> **取证订正（v1.0，如实）**：D10 原稿曾称"P1 轻量 IPC 基座**尚未落地**"，**该结论已失效** —— 基座于 **2026-10-10 已落地**（`app/src/utils/sidecarIpc.ts`，被 `ai/python/JsonRpcBridge.ts` 与 `infrastructure/http/a2a/discoverySidecar.ts` 消费；见 §1.3）。**残留漂移**：`CHANGELOG.md:82` 仍写"（未落地）"，**属过时表述**，列为需回填项（见 §11 收尾）。

---

## §1 问题与取证

### 1.1 P1 · 现状：LSP「两套实现」并存（双轨），且活跃那套是**每次调用冷启动**

| 轨 | 位置 | 进程模型 | 常驻 | 消费者 |
|---|---|---|---|---|
| **轨 A（活跃，工具面）** | `app/src/tools/lsp/**` | **每次 `execute()` 内 start/stop**：`LSPServer.start()` → `spawn(serverPath, …)`（`tools/lsp/LSPServer.ts:68`）；外部服务器 `npx typescript-language-server --stdio` / `pylsp` / `clangd` / `gopls` / `rust-analyzer` / `omnisharp` / `jdtls` 等（`tools/lsp/LSPToolImpl.ts:274-337`） | **否** | 经 `tools/factories/builtinToolRegistry.ts:138`（`createLSPTool: () => new LSPToolAdapter()`）→ `tools/utils/ToolManagerUtils.ts:190`（`cond(coreFeature('LSP'), byKey('createLSPTool'))`）；工具名 `lsp`（`tools/adapters/LSPToolAdapter.ts:44`） |
| **轨 B（常驻，未接线）** | `app/src/lsp/**`（`@modules/lsp`） | **常驻管理器**：`createLSPServerManager()`（`lsp/LSPServerManager.ts:30`）→ `createLSPServerInstance()`（`lsp/LSPServerInstance.ts:41`），含崩溃恢复/退避重试（`LSPServerInstance.ts:57-62,136-181`）、`isHealthy`（`:132`） | **是** | **未找到**外部消费者：`@modules/lsp` 全仓仅 `app/src/tools/lsp/LSPToolIntegration.ts:15`（取 `validatePosition/validateLocation/...` 校验函数）+ `app/src/modules/ImportManager.ts:107`（模块别名映射）+ `app/tsconfig.json:38-39`（路径别名）。`EnhancedLSPManager` / `LSPServerManager` / `LSPServerInstance` / `IntelligentLSPAnalyzer` / `DiagnosticsContextAdapter` / `passiveFeedback` / `LSPDiagnosticDisplay` 符号在 `app/src/lsp/**` 之外**未找到**消费者（已查符号名 + `@modules/lsp` + 相对路径 `../lsp` / `lsp/*`） |

- **两者关系**：**同域两套 LSP 客户端/服务器管理**（轨 A 每次 spawn + 手写 JSON-RPC；轨 B 常驻 + 崩溃恢复），**非同一实现的两处导出** ⇒ 符合"重复实现（双轨）"判据。
- **轨 A 现状缺陷（已修，2026-10-12）**：① `LSPClient.sendRequest` 原**无请求超时** ⇒ 挂起（已补 `LSP_REQUEST_TIMEOUT_MS=30_000`，`tools/lsp/LSPClient.ts:25,132-158`）；② `LSPServer.start()` 原对 `stdin` 调 `setEncoding` ⇒ bun 下抛错（bun 的 child_process 流仅 `stdout`/`stderr` 提供 `setEncoding`）⇒ 工具**不可用**（已修，`tools/lsp/LSPServer.ts:81-87`）。证据 `TOOLGOV-LSP-TIMEOUT` / `TOOLGOV-LSP-BUN-STDIO`；`CHANGELOG.md:83-84`。
- **默认注册**：`LSP=false`（`core/featureFlags.ts:164`）⇒ 该工具**默认关**（长期潜伏）；`TOOL_FLAG_MAP`（`featureFlags.ts:528+`）**无** `ENABLE_LSP` 键（盘点清单附录 A）。
- **收益（已裁定）**：侧车化 = **常驻化**（消 `npx` 冷启动）+ 补超时，**非**"防主进程硬崩溃"（盘点清单 §0 已订正原假设）。

### 1.2 P2 · 现状：媒体原生面 = `sharp`（native addon）+ Python `vision_worker`（已进程外、拟统一管理）

- **`sharp`（libvips，native addon）** —— **真 in-process 原生崩溃面**，调用点**分散**：
  - `app/src/media/image/ImageProcessor.ts:11,16-28`（`loadSharp()` 包装，image 缩放/旋转/格式转换）
  - `app/src/tools/ImageGenerateTool/ImageInputRouter.ts:212,245`（**超大图 (>20MB) 才动态 `import('sharp')`** 逐级缩放）
  - `app/src/utils/externalDeps.ts:65-90`（`loadSharp()` 单一加载器，`require('sharp')` + 编译产物 `getExternalRequire()`）
  - 其它消费者：`app/src/utils/imageResizer.ts:459`、`app/src/tools/converter/converters/ImageConverter.ts:24`、`app/src/tools/CanvasTool/CanvasInstance.ts:15`、`app/src/tools/CanvasTool/CanvasTool.ts:470`
  - 依赖声明：`sharp ^0.34.5`（`app/package.json`，构建期 `--external sharp`）；启动预检 `app/src/bootstrap/preflight.ts:226-232`。
- **Python `vision_worker`（已是进程外常驻）** —— **真 OOM 源**（载 EasyOCR / YOLOv8 / CLIP 等）：
  - 脚本 `app/src/ai/python/vision_worker.py`（header `:1-19`，模型注册表 `:31-69+`；含 colorthief/Pillow/EasyOCR/ultralytics/CLIP）
  - 进程桥 `app/src/ai/python/StdioBridge.ts:33-42`（`extends JsonRpcBridge`，`spawn('python', vision_worker.py)`，startup 3s）
  - 看护 `app/src/ai/python/WorkerGuard.ts:64`（30s 健康检查 `:26`、指数退避重启 `:230-256`、连续 5 次熔断 `:215-227`）
  - 消费方：`app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts:170-190`（`l2WorkerGuard` 懒单例）→ OCR/objects/similarity（`:445-528`）；知识域 `app/src/knowledge/ingestion/extractors/PdfOcrExtractor.ts:78-81`；插件域 `app/src/plugins/core/PythonPluginAdapter.ts:104-105`
- **媒体工具注册**：`app/src/tools/media/MediaModule.ts:48-60`（`globalToolManager.registerTool(...)`，16 个 media 工具）。
- **判定（已裁定）**：`sharp` = 真 native；`vision_worker` = 真 OOM 且**已是进程外** ⇒ 合流为"媒体侧车"可一次收敛"内存大 + native"两类（盘点 §3）。

### 1.3 依赖与前提：D10 IPC 基座**已落地**（原方案"未落地"结论已失效）

| 事实 | 证据 |
|---|---|
| 单一 sidecar IPC 契约已存在 | `app/src/utils/sidecarIpc.ts:37`（`SIDECAR_IPC_PROTOCOL_VERSION=1`）· `:72` `encodeFrame` · `:77` `decodeFrame` · `:93` `isCompatibleVersion`（major 相等；未声明=legacy）· `:98-104` startup/heartbeat 帧判定 |
| 已收敛既有桥（禁止第三套） | `app/src/ai/python/JsonRpcBridge.ts:22-27`（消费契约）· `:36-39`（`BRIDGE_PROTOCOL_VERSION ≡ 契约版本`，再导出）· `:160-183`（startup 帧版本协商，不兼容 ⇒ fail-closed 回收子进程）· `:268,302-312,324`（`encodeFrame`） |
| 已被第二个消费方使用 | `app/src/infrastructure/http/a2a/DiscoverySidecarSupervisor.ts:39-45,128,136,169,208` 与 `app/src/infrastructure/http/a2a/discoverySidecar.ts:46-50,232,262-264,274,293` |
| 落地记录 | D10 稿 §8.5（P1 ✅ 2026-10-10）· `CHANGELOG.md`（P1 记录）· 盘点清单 §4 订正段 |
| **残留漂移（需回填）** | `CHANGELOG.md:82` 仍写"（未落地）"，与 §8.5 矛盾 ⇒ 过时表述 |

- **可复用监督器先例（模板）**：`DiscoverySidecarSupervisor.ts:64-72`（**`spawnFn` 可注入** ⇒ 测试不真 spawn）· `:229`（`maxRestarts` 默认 3 有界重启）· `:212`（`stop()`）；测试 `app/tests/infrastructure/http/a2a/discoverySidecarSupervisor.test.ts`（注入假 `ChildProcess`）。
- **`daemon/IPCService`（unix socket/http）** 属**守护进程控制面**，**不并入**本契约（Windows 无 unix socket）—— D10 §8.5 选型结论。

### 1.4 与既有裁定的冲突处（显式标注「已被裁定」）

| 旧结论 | 现状 | 出处 |
|---|---|---|
| D10 原稿"P1 IPC 基座未落地 ⇒ 2.2 阻塞" | **已失效**（P1–P3 于 2026-10-10 完成） | 盘点清单 §4「订正」· 工具方案 §5 订正段 · 五方案总览 §8.1 |
| 工具方案 §7"阶段 2 首个靶点 = **媒体生图/生视频 + LSP**" | **已被裁定推翻**：媒体生图/生视频主体是**远端 Provider HTTP**（无 in-process 崩溃面）⇒ 重排为 **P1 常驻 LSP / P2 媒体原生面（`sharp` + `vision_worker`）** | 盘点清单 §0/§3；用户 2026-10-12 裁定（工具方案 §5 阶段 2 实施状态；五方案总览 ✅-5） |
| 盘点初判"`liri-native` 不纳入" | **最终裁定 = 纳入侧车评估**（须量化证据，不以 CS03 空谈否） | 盘点清单 §4.2；工具方案 §5 |

### 1.5 明确"未找到 / 无证据"（CS06）

- `@modules/lsp` 常驻管理器在 `app/src/lsp/**` 与 `barrel index.ts` 之外的生产消费者：**未找到**（已查 `@modules/lsp` 引用、`EnhancedLSPManager`/`createLSPServerManager`/`createLSPServerInstance`/`registerLSPNotificationHandlers`/`getDiagnosticsContextAdapter`/`IntelligentLSPAnalyzer`/`LSPDiagnosticDisplay` 符号、相对路径 `../lsp` / `../../lsp`）。
- `app/src/tools/lsp/LSPToolIntegration.ts`（`createLSPToolIntegration`）在 `tools/lsp/**` 之外的生产消费者：**未找到**（仅 `tools/lsp/index.ts:45-47` 再导出 + `LSPToolIntegration.md` 文档）。
- 任何名为 `sidecar` 的工具域进程实现、工具侧车双跑开关、`ISnapshotCapable` 实现：**未找到**（与五方案总览 §8.1 `T1-10/T1-11` "零实现"一致）。
- 本仓当前无"工具域 MCP 侧车 supervisor"：**未找到**（仅 A2A 发现面有 `DiscoverySidecarSupervisor`，属 A2A 域，不在工具域）。

---

## §2 目标 / 非目标

**目标**
1. **P1**：把 `lsp` 工具从"每次调用冷启动外部 language server"改为**常驻 MCP 侧车**；**侧车进程与主内核之间的 IPC 复用 D10 基座 `utils/sidecarIpc.ts`（禁止第三套 IPC）**。
2. **P2**：把媒体原生面（`sharp` + Python `vision_worker`）纳入**同一"媒体侧车"**并**统一管理面**（注册/权限/配额/生命周期同源）。
3. **双跑开关**：新增 feature flag（**默认关 ⇒ 零行为变更**），支持"内置实现 vs 侧车实现"并行对照。
4. **崩溃隔离 + 取消下传**：侧车崩溃 ⇒ 主内核**不倒且可续跑**；`AbortSignal` 从内核**下传**至侧车（best-effort 中止在飞请求）。
5. **安全/资源同源**：侧车工具与内置工具**同门禁同权限链**（注册表/PathGuard/权限/Landlock/结果上限，对齐 `T1-11`/`TG-6`）。
6. **可回滚**：单一开关回退；删减严格走 CD05/CD06/CD07 分片。

**非目标（Non-goals）**
- 不改 MCP 协议语义、不改 `routeChannelMessage` 管线、不复刻 A2A 委派进程化（D10 判定 A 维持不立项 —— 见 §3-D9）。
- 不新建第二/第三套 IPC（D10 GR02）。
- 不做"全部工具/26 通道"的侧车化。
- 不动与侧车无关的工具实现。
- 不在本期实施 `liri-native` 侧车化（仅产出评估证据 —— §3-D8）。

**反目标（"技术上能跑"也算失败）**
- ❌ **静默双轨**：开关打开后仍有"每次 spawn"与"常驻侧车"两条现实路径未被开关隔离。
- ❌ **权限旁路**：侧车工具绕过 PathGuard/权限链/结果上限（安全姿态静默削弱）。
- ❌ **删除依赖静态零引用**：以"静态引用为零"删除 `app/src/lsp/**`、`tools/lsp/**`、`app/native`、`security/Bash*` 等 CD07 关键模块。
- ❌ **侧车自建内核**：侧车进程内自建 CoreAPI / 工具注册表 / 会话（须经 IPC 回主进程）。
- ❌ **取消失灵**：用户取消后侧车内请求继续跑（资源泄漏）。

---

## §3 定案（D1–D11）

### D1 侧车通信基座：**复用 D10 单一 IPC 契约，禁止第三套** ✅（已被裁定，D10 GR02）

- **结论**：所有侧车 ↔ 内核通信**统一**走 `app/src/utils/sidecarIpc.ts`（`request`/`response`/`notify`/`startup`/`heartbeat` 帧 + `encodeFrame`/`decodeFrame` + `isCompatibleVersion`）。选型 **stdio + 换行分隔 JSON**（跨平台；Windows 无 unix socket）；**不**并入 `daemon/IPCService`（属守护进程控制面）。
- **依据**：① 该基座是仓内**唯一** sidecar IPC 定义（CS01 单一来源，`sidecarIpc.ts:32-34` 自述）；② 已有两个消费方（`JsonRpcBridge`、`discoverySidecar`）证明其可用（§1.3）；③ D10 GR02 明确"禁止第三套 IPC"。
- **取舍（如实）**：新侧车必须自行实现 **startup 握手（含 `protocolVersion`）** 与 **心跳**；契约仅提供帧类型/编解码/兼容判定，不含运行接线（D10 §8.5 边界如实）。

### D2 P1 靶点：**常驻 LSP 侧车**；**先收敛双轨、再侧车** ✅（已被裁定）

- **结论**：
  - **形态**：主进程内核（CoreAPI / 工具注册表 / 权限 / 会话 / DB）**不变**；**新增独立侧车进程**承载"常驻外部 language server"（消 `npx` 冷启动 + 常驻 + 崩溃恢复）；工具仍以 `lsp` 名对内暴露（结果形状不变）。
  - **前置（用户已裁定）**：**LSP 双轨先收敛**（轨 A `tools/lsp/**` 每次 spawn vs 轨 B `app/src/lsp/**` 常驻管理器）——**避免把两套都搬进侧车**（盘点清单 §4.3）。
  - **收敛方向（本 spec 定案）**：以**轨 B（常驻 + 崩溃恢复）**为侧车的常驻引擎底座更契合侧车形态（`LSPServerInstance` 已有 crash recovery/退避/健康检查）；**收敛 ≠ 删除**：轨 A 的**工具面契约**（`LSPToolAdapter` 的 `name='lsp'`、params、`maxResultSizeChars=10000`、各 action 语义）必须保留，轨 A 的**传输/生命周期**改由侧车承担。轨 B 的常驻管理器接入侧车前须先摘/接入口并观察（CD05/CD07）。
- **依据**：① 盘点 §1-#12/#13 已记录两套；② 用户 2026-10-12 裁定"LSP 双轨先收敛再侧车"（盘点 §4.3、工具方案 §5 阶段 2）；③ 轨 A 的 `npx` 冷启动 + 每次 start/stop 是明确劣化点（`LSPToolAdapter.ts:304,465`）。
- **取舍（如实）**：双轨收敛存在"删错一套"风险 ⇒ 严格 CD05/CD07（见 D7）；侧车对 `lsp` 而言收益是**常驻化**而非崩溃隔离（原假设已订正）。

### D3 P2 靶点：**媒体原生面**（`sharp` + Python `vision_worker`）✅（已被裁定）

- **结论**：
  - **合流为一"媒体侧车"**：`vision_worker`（已是进程外常驻）**升级为 MCP 侧车统一管理**（注册/权限/生命周期同源）；`sharp` 调用**收进侧车**（把 native addon 移出主进程）。
  - **强制评估制约（不预设"全收口"）**：`sharp` 调用点**分散**（§1.2：image 分析、超大图缩放、converter、Canvas、imageResizer、externalDeps）⇒ 收进侧车的**改造面大**，必须按切片**先做"最高价值 + 最低耦合"的一处**（建议优先 `tools/ImageGenerateTool/ImageInputRouter.ts:212,245` 的超大图缩放，因它已是"异常路径 + 动态导入"，改动隔离），**再评估**是否推进到 `media/image/ImageProcessor.ts` 主路径。
- **依据**：盘点 §2.2/§2.4/§3（`sharp` 真 native、Python worker 真 OOM 且已进程外）；用户裁定 P2 = 媒体原生面。
- **取舍（如实）**：`vision_worker` 已是进程外 ⇒ 侧车化收益主要是**统一管理面**（`TG-6` 同源）与**生命周期纳入受管**，而非"新增隔离"；`sharp` 收口是**真隔离收益**但有主路径改造代价。

### D4 双跑开关：**新增 feature flag，默认关（零行为变更）** ✅

- **结论**：新增两项开关，命名遵循既有约定（`FEATURE_FLAGS` 键 + `FEATURE_<name>` env，`feature()` 三级解析 env > 变体层 > 静态默认，`core/featureFlags.ts:486-499`）：
  - `TOOL_SIDECAR_LSP`（P1，默认 `false`）
  - `TOOL_SIDECAR_MEDIA`（P2，默认 `false`）
- **门控点（两处，二者缺一不可）**：
  1. **工具装载层**：`tools/utils/ToolManagerUtils.ts` 的 loader 选择（与 `cond(coreFeature('LSP'), byKey('createLSPTool'))`（`:190`）并列，新增"侧车版 loader"分支）；装配点经 `tools/factories/builtinToolRegistry.ts:138`。
  2. **侧车 supervisor 启动层**：仿 `DiscoverySidecarSupervisor`（`ENV_DISCOVERY_SIDECAR==='true'`，默认 false）——**仅当开关为真才 spawn 侧车**；默认关 ⇒ 侧车进程**根本不起**。
- **依据**：① 对齐既有默认关灰度先例（`A2A_DISCOVERY_SIDECAR`）；② `feature()` 三级解析是仓内既定机制；③ "先加双跑开关、后摘内置注册"已由工具方案 §5 阶段 2.2 确定。
- **取舍（如实）**：新开关属**功能灰度开关**，**不在** `featureFlagContract.test.ts:25-43` 的 17 项 `SAFETY_SWITCHES` 内，也**不**受 `lint:doc-code` 的安全开关断言约束（与 `long-task-suspend-resume.md` §10 v1.7 取证同口径）；如需与既有功能开关统一登记，建议后续并入 `project_rules §1.4` 表（非本期硬要求）。

### D5 崩溃隔离 + 取消下传（全链路契约）✅（对齐 TOOLGOV-S2-2）

- **结论**：
  - **崩溃隔离（故障域收敛）**：侧车进程崩溃/僵死 ⇒ ① `JsonRpcBridge` 的 `process.on('exit')`（`:218-227`）**拒绝所有 pending 请求**并返回错误 ⇒ 主内核收到**普通 RPC 错误**、**主进程存活**、长任务**可续跑**；② supervisor 有界重启（`maxRestarts` 默认 3，仿 `DiscoverySidecarSupervisor.ts:229`），超限进入"降级/不可用"态（**fail-closed 报错，不伪造成功**，CS03）。
  - **取消下传（AbortSignal）**：`AbortSignal` **不能跨进程直传** ⇒ 定案为**两层**：
    1. **本地结算**：工具执行入口监听 `context.abortController.signal`（`ToolUseContext.abortController`，取用先例 `McpToolWrapper.ts:114`）⇒ abort 时**本地 pending 立即结算**（拒绝/取消），不等待侧车；
    2. **跨进程通知**：经 D1 契约发 **`notify` 帧** `{ type:'notify', event:'cancel', data:{ id } }` 给侧车；侧车收到后**best-effort 中止**对应在飞请求（写 stdin 通知 + 必要时由 supervisor 强杀该请求的子进程）。
  - **口径对照 TOOLGOV-S2-2**：`MCPTool`/`McpToolWrapper` 已把 `context.abortController.signal` 透传 SDK `callTool(params, undefined, { signal })`（`fix-evidence-registry.json:863`；`McpToolWrapper.ts:113-114`；测试 `app/tests/tools/toolCancellation.test.ts`）。**侧车场景**因跨进程，等价物 = "本地结算 + notify 帧下传"（**不**引入第三套信号机制）。
- **依据**：D10 A12"侧车隔离可**降低主进程硬崩溃**，但**不消除** RPC 层错误 ⇒ 表述为"故障域收敛 + 主内核可续跑"（工具方案 §2 外部主张 A12）；TOOLGOV-S2-2 先例。
- **取舍（如实）**：notify 取消为 **best-effort**（侧车可能已崩溃/不响应取消）；跨进程"取消后远端确实终止"须以**可注入假子进程的测试**断言"写出的帧"来验证，真机断言留 §6.8。

### D6 注册/发现/权限/PathGuard/Landlock/结果上限：**与内置工具同源**（对齐 T1-11 / TG-6）✅（已被裁定）

- **结论**：侧车工具**必须走与内置/MCP 工具同一条注册链**，从而**自动**获得同一套门禁（**不新增平行门禁**）：
  - **注册/发现**：经 `services/mcp/MCPToolBridge.registerServerTools()`（`MCPToolBridge.ts:113`）注册为 `McpToolWrapper`，工具名 = `${serverName}__${toolName}`（`McpToolWrapper.ts:42`），进同一 `ToolManager`/`ToolRegistry`（唯一写入口 `getToolRegistry()`）。
  - **PathGuard**：因注册进同一工具面，天然经过 `chat/ReActToolLoop.ts:1145` 的 `this.pathGuard.checkToolCall(tc.name, tc.input)`（`pathGuard = createPathGuard(...)`，`:280`）。
  - **权限链**：与内置工具过同一权限判决（不绕过）。
  - **结果上限**：与内置工具共用 `maxResultSizeChars` / `ToolResultBudget`（`context/budget/ToolResultBudget.ts:30`）与 `tools/services/ToolResultPersister.ts` 持久化上限（对齐 `ai-vfs-driver-contract.md §8.1` 硬约束）。
  - **Landlock**：**按工具适用性显式声明** —— 仅对"spawn 用户代码/命令"的工具适用（如 `code_run` 的 `LinuxSandboxRunner`）；只读的 LSP 代码智能查询**不适用** ⇒ **明示 N/A**（**不装作同源**，CS06）。
- **依据**：工具方案 §3 TG-6 + §5 阶段 2.3（`T1-11`）；`ai-vfs-driver-contract.md §8.1`（5 条硬约束）。
- **取舍（如实）**：侧车经 MCP 注册即天然复用 MCP 安全防线（`MCPSecurityFilter` 脱敏、`sessionId` 不外传 —— 五方案总览 §6.3）；**若侧车工具需要能力声明/审批**，须与内置同源，**不得**新造平行权限面。

### D7 摘内置注册 / 删除：**严格 CD05 → 观察 → CD06，关键模块受 CD07 保护** ✅

- **结论（分片，顺序不可颠倒）**：
  1. **先加双跑开关**（D4，默认关）；
  2. **再摘内置注册入口**（**独立提交**，保留实现）：把内置 loader 分支改为"开关为真时走侧车、否则走内置"，或先在**独立提交**中移除内置注册（保留实现体）并观察一期；
  3. **观察期**：确认**无运行时消费者 / 无降级告警 / 无告警日志**；
  4. **最后**才按 **CD06** 单独提交"物理删除实现"（记录被删清单 + 回滚哈希）。
- **CD07 白名单（一票否决）**：`app/src/lsp/**`、`tools/lsp/**`、`app/native`、`sandbox/**`、`security/Bash*`、工具注册表 —— **不得**以"静态零引用"为删据。**特别**：轨 B（`app/src/lsp`）当前"静态近零引用"（§1.5）**恰恰是** `dead-code-and-unwired-items-rulings.md` 意义上的"运行时/配置/动态不可见"高风险项 ⇒ **先摘入口/接回并观察，禁止直接删**。
- **依据**：`code-deletion.md` CD05/CD06/CD07（§0 沙箱误删事故实证）；工具方案 §5 阶段 2.4/2.5、§4 Negative list #4；盘点附录 A「CD07 提示」。
- **取舍（如实）**：删除是**不可逆破坏性操作**；"静态引用为零 ≠ 运行时可删"（CD01/CD02 动态导入/配置注册/运行时发现盲区）。

### D8 `liri-native`（`bun:ffi`）：**本期仅评估，不实施** ✅（已被裁定）

- **结论**：`liri-native`（唯一真 in-process FFI，`app/native/index.js` 模块级 `dlopen`）**不**在本期侧车化；须产出量化评估——"**11 处调用点 × 热路径延迟代价 × 崩溃恢复现状**"——以**证据**决定纳/否（**不得**以 CS03 空谈否）。
- **依据**：盘点 §2.1（消费者：`security/bash/BashAST.ts:51`、`tools/FileReadTool/FileReadTool.ts:108`、`utils/structureCut.ts:37`、`tokenBudget/TokenBudgetController.ts:93`、`tools/CodeRunner/staticValidation.ts:97` 等 11 处高频基础路径）；用户裁定"纳入侧车评估"（盘点 §4.2）。
- **取舍（如实）**：评估产物是**文档/量化报告**，不是代码；结论为"不划算"时须附评估证据（非"静态引用"）。

### D9 **不**新建 MCP 网关长驻进程（维持 D10 判定 A 不立项）✅（已被裁定）

- **结论**：本期侧车是**工具域小切口**（LSP / 媒体），**不**复刻"A2A/MCP 零共享 Sidecar 网关"（D10 判定 A 维持不立项 —— R24 触发条件未满足）。
- **依据**：D10 §3 判定 A / §8（用户裁定启动的是 P0–P3 分期，P2 已做的是 A2A **只读发现面**外置，非网关整做）。

### D10 内核为唯一事实源（侧车不得自建）✅（对齐 D10 P3 / 通道隔离先例）

- **结论**：侧车进程**不得**自建 CoreAPI / 工具注册表 / 会话 / DB / 成本记账；一切需内核能力的动作**经 IPC 回主进程**（反向 RPC 先例：`discoverySidecar` 的 `fromChild` 委派，D10 §8.7）。
- **依据**：D10 P3「不得在 sidecar 内自建 CoreAPI，同 `channel-process-isolation §2-#3`」；`JsonRpcBridge.ts:194-203`（`fromChild` 反向 RPC 支持）。

### D11 分层合规：侧车装配代码的**层级落点** ✅

- **结论**：侧车装配/契约代码落点须遵守 `core`/`infra`**不可引** `service`/`app`（`architecture.md` R03/R09）；**参照 D10 P2 的层级修正先例**：初版 `agent/a2a/` 触发 `R03-002` + `no-direct-module-import` ⇒ 迁到 `infrastructure/http/a2a/`（同模块内相对引用，D10 §8.6）。
- **取舍（如实）**：工具侧车 supervisor 的具体落点（如 `tools/**` 内、或经既有模块）须在实施计划中**先定层级再写码**，避免层倒置回流。

---

## §4 实施阶段（含验收）

> 每阶段**独立可提交、独立可回滚**（CD06）；涉及删减严格走 CD05。阶段 1–3 由 `TOOL_SIDECAR_LSP` / `TOOL_SIDECAR_MEDIA` 门控（**默认关 ⇒ 零行为变更**）。

| 阶段 | 内容 | 落点（本 spec 取证锚点） | 验收 |
|---|---|---|---|
| **0. 前置校验（零代码）** | 复核 D10 IPC 基座可用（契约单测绿）+ 记录"双轨"消费者清单 + 回填 §1 残留漂移 | `utils/sidecarIpc.ts`、`tests/utils/sidecarIpc.test.ts` | 基座契约测试绿；消费清单入册（§1.5） |
| **1. 侧车骨架 + 双跑开关（P1 前置）** | ① 新增 supervisor（仿 `DiscoverySidecarSupervisor`：`spawnFn` 可注入、`maxRestarts` 有界重启、`stop()`）；② 新增开关 `TOOL_SIDECAR_LSP`（默认关）；③ 侧车进程 = 常驻 LSP 服务（consumes `sidecarIpc` 契约：startup 握手 + 心跳 + request/response）；④ 工具装载按开关选择"内置 loader / 侧车 loader" | `core/featureFlags.ts`（开关）；`tools/utils/ToolManagerUtils.ts`（loader 选择，`:190` 并列）；`tools/factories/builtinToolRegistry.ts:138`；新 supervisor 模块 | 开关关 ⇒ 行为与现状**完全一致**（负向测试）；开关开 ⇒ `lsp` 工具经侧车返回结果，形状与内置一致；supervisor 单测（注入假 `ChildProcess`） |
| **2. LSP 双轨收敛（CD05/CD07）** | ① 梳理轨 A/轨 B 的消费者与生命周期；② 将**常驻引擎**（轨 B `LSPServerInstance`/`LSPServerManager` 的 crash recovery）接入侧车；③ 保留轨 A 的**工具面契约**（`LSPToolAdapter` 的 params/action/`maxResultSizeChars`）；④ 先摘入口 → 观察（`tools/lsp/**` 与 `app/src/lsp/**` 均**不删**） | `tools/lsp/**`、`app/src/lsp/**`、`tools/adapters/LSPToolAdapter.ts` | 双跑期轨 A/轨 B/侧车**结果一致**；观察期无失联消费者告警；**不删任何实现**（删除另立提交） |
| **3. 崩溃隔离 + 取消下传验收** | ① 崩溃：注入侧车僵死/退出 ⇒ 主内核收 RPC 错误且**主进程存活、长任务续跑**；② 取消：abort ⇒ **本地结算 + notify 帧写出**（断言帧内容） | supervisor、侧车进程、工具执行入口（`ToolUseContext.abortController`） | 注入假子进程测试：崩溃 ⇒ pending 全部 reject、supervisor 有界重启；取消 ⇒ 断言 `{type:'notify',event:'cancel'}` 帧被写出（§6.3） |
| **4. 同源门禁（T1-11）** | 侧车工具经 `MCPToolBridge.registerServerTools()` 注册为 `${server}__${tool}`，进同一注册表 ⇒ 自动过 PathGuard/权限/结果上限；Landlock 显式 N/A | `services/mcp/MCPToolBridge.ts:113`、`services/mcp/McpToolWrapper.ts:42,113-114`、`chat/ReActToolLoop.ts:1145` | 注册进同一 registry（测试断言）；PathGuard 命中拦截侧车工具；结果上限生效；Landlock 适用性有显式声明 |
| **5. P2 媒体侧车（评估驱动切片）** | ① `vision_worker` 升级为受管 MCP 侧车；② `sharp` **先收一处**（建议 `ImageInputRouter.ts:212,245` 超大图缩放），再评估主路径 | `ai/python/{StdioBridge,WorkerGuard,vision_worker.py}`、`tools/ImageAnalysisTool/ImageAnalysisTool.ts:170-190`、`tools/ImageGenerateTool/ImageInputRouter.ts:212,245` | 开关关 ⇒ 零行为变更；开关开 ⇒ OCR/objects/similarity 经侧车同源；`sharp` 收口处功能与结果等价 |
| **6. 收尾（CD05/CD06 分片）** | 若观察期确认无消费者 ⇒ **独立提交**物理删除被替代实现（记录清单 + 回滚哈希）；回填 §11 待回填项 | `tools/lsp/**`、`app/src/lsp/**`（视观察结论） | 独立提交；回滚哈希可复原；门禁全绿 |

> **开关关时（默认）**：侧车进程**不启动**，工具面与结果与**现状完全一致**；一切新能力受 `TOOL_SIDECAR_LSP` / `TOOL_SIDECAR_MEDIA` 门控。

---

## §5 接口 / 契约

### 5.1 侧车 IPC 帧契约（复用 `utils/sidecarIpc.ts`，禁止第三套）

| 帧 | 形状 | 语义 |
|---|---|---|
| `startup` | `{ type:'startup', pid?, protocolVersion? }` | 子进程 → 主进程就绪握手；`protocolVersion` 缺省=legacy 兼容；不兼容 ⇒ **fail-closed 拒绝启动并回收子进程**（先例 `JsonRpcBridge.ts:164-183`） |
| `request` | `{ id, method, params }` | 主 → 子 请求 |
| `response` | `{ id, success, result?, error?, errorCode? }` | 子 → 主 响应（`success=false` 时 `requestResult` 抛错） |
| `notify` | `{ type:'notify', event?, data? }` | 双向单向推送（**取消下传**走此帧：`event:'cancel'`） |
| `heartbeat` | `{ type:'heartbeat', at }` | 双向心跳（契约提供 `buildHeartbeat`） |

- 协议版本：`SIDECAR_IPC_PROTOCOL_VERSION = 1`；兼容判据 = **major 相等**（`isCompatibleVersion`，`sidecarIpc.ts:93-96`）。

### 5.2 侧车 MCP 服务契约（工具面）

- **工具名**：`${serverName}__${toolName}`（`McpToolWrapper.ts:42`），**不**得改写为 `mcp__<server>__<tool>`。
- **参数/结果形状**：复用 `McpToolWrapper`（`services/mcp/McpToolWrapper.ts`），结果脱敏复用 `filterMCPToolResult` + `redactMcpPayload`（五方案总览 §6.3 `G-1`）。
- **取消契约**：`{ type:'notify', event:'cancel', data:{ id } }`（本地 pending 先结算，侧车 best-effort 中止）。

### 5.3 生命周期契约

- **就绪**：startup 握手（含实际 pid/端口/版本）。
- **健康**：心跳（契约帧）；supervisor 有界重启（`maxRestarts` 默认 3）。
- **停止**：`stop()` 有序关闭（先通知、后强杀；超限 fail-closed 报错）。
- **可观测**：复用 `tools/monitoring/ToolMetrics.ts` 既有埋点（`tools.schema.*` / `tools.invocation.*`），**不新建指标名**（CS01）。

---

## §6 验收标准

1. **双跑一致性**：`TOOL_SIDECAR_LSP` 关/开两态下，`lsp` 工具的 **params/action 语义/结果形状/`maxResultSizeChars`** 一致（开=侧车、关=内置）。
2. **默认关零行为变更**：开关关时侧车进程**不启动**，工具面与现状**逐字一致**（负向测试）。
3. **崩溃隔离（可测）**：注入假 `ChildProcess` 让侧车"崩溃/僵死" ⇒ ① 所有 pending **reject**（`JsonRpcBridge.ts:218-227` 同源语义）；② **主进程存活**、长任务**可续跑**；③ supervisor **有界重启**；超限 ⇒ 降级报错（**不伪造成功**）。参考测试范式：`tests/infrastructure/http/a2a/discoverySidecarSupervisor.test.ts`（注入假子进程）+ `app/tests/execution/processCrashInjection.test.ts`。
4. **取消下传（可测）**：abort ⇒ ① 本地 pending **结算**；② 断言**写出的 `notify` cancel 帧**（假子进程 stdin 捕获）。对齐 `TOOLGOV-S2-2`（`McpToolWrapper.ts:114`；`tests/tools/toolCancellation.test.ts`）。
5. **同源门禁**：侧车工具注册进**同一** `ToolRegistry`；PathGuard（`ReActToolLoop.ts:1145`）命中**拦截**侧车工具；结果上限生效；Landlock **适用性显式声明**。
6. **门禁全绿**：`lint:arch` 0 违规（R03/R09）；`lint:tool-schema` 0 ERROR；`gen:toolnames` 零漂移；`test:guarded` 全绿。
7. **真实/可控进程级验证（成本）**：
   - **可控（首选，低成本）**：注入假 `ChildProcess` 的 supervisor 单测（不真 spawn）——覆盖崩溃/重启/取消帧。
   - **真实（按需，中成本）**：真起侧车子进程做一次 `lsp` 查询端到端（先例：D10 §8.6 真 sidecar + `fetch` 200/304/401；D10 §8.7 真 sidecar 反向 RPC E2E）——**须能独立 `bun run` 侧车脚本**。
   - **真机（高成本，若某项只能真机）**：真实 language server（如 `typescript-language-server`）需本机已装 ⇒ 标注为**真机验证项**，方法与成本见 §7「只能真机验证」。
8. **可回滚**：关开关（或 `FEATURE_TOOL_SIDECAR_LSP=false`）⇒ 回落到内置实现，行为与启用前一致。

---

## §7 风险与回滚

| 风险 | 处置 |
|---|---|
| **双轨收敛误删**（轨 B 静态近零引用，易被当"死面"删 —— **沙箱事故同源**） | 严格 CD05（先摘入口 → 观察 → 再删）+ CD07（关键模块不以静态零引用为删据）；删除**独立提交** + 记录回滚哈希 |
| **`sharp` 收口改造面大**（调用点分散 §1.2） | 评估驱动切片：先收"异常路径 + 已动态导入"的一处（`ImageInputRouter.ts:212,245`），再评估主路径 |
| **Windows 差异**（无 unix socket） | 统一 **stdio + 换行 JSON**（D1 选型，D10 §8.5）；**不**依赖 `daemon/IPCService` |
| **取消 best-effort**（侧车可能不响应） | 本地 pending **先结算**（不阻塞用户）；notify 为补充；超时由 supervisor 强杀 |
| **层倒置回流**（新 server 代码跨层直连） | D11：先定层级再写码；参照 D10 P2 的 `agent/a2a/` → `infrastructure/http/a2a/` 修正先例 |
| **取消 / 崩溃路径测试只能"可控"** | 明确区分"可控注入（默认）"与"真机（按需）"；真机项在 §6.7 标注方法与成本 |
| **回滚** | 关 `TOOL_SIDECAR_LSP` / `TOOL_SIDECAR_MEDIA`（默认关即回退）；每阶段独立提交可单独 revert |

**只能真机验证的项（验证方法与成本）**：

- **真实 language server 冷启动 vs 常驻时延对比**：需本机安装对应 LS（如 `typescript-language-server`，经 `npx`）⇒ 方法 = 起真侧车、连续两次同查询、对比首次（含冷启动）与次次时延；成本 = 需本机 LS 环境 + 手工/脚本驱动。
- **真实 `sharp` 超大图崩溃面收敛**：需 >20MB 真实大图 ⇒ 方法 = 开关开/关两态跑 `ImageInputRouter` 缩放路径，观察主进程是否受 native 崩溃影响；成本 = 需大图夹具 + 可控崩溃注入（难；可退化为"路径等价"验证）。

---

## §8 明确不做（Negative list）

1. **不新建第二/第三套 IPC**（D10 GR02；复用 `utils/sidecarIpc.ts`）。
2. **不做 26 通道 / 全部工具的侧车化**（只做已裁定的 P1/P2 靶点）。
3. **不动与侧车无关的工具实现**（不做"顺手重构"）。
4. **不做 CD07 禁止的"无运行时证据删除"**：`app/src/lsp/**`、`tools/lsp/**`、`app/native`、`sandbox/**`、`security/Bash*`、工具注册表**不得**以静态零引用为删据。
5. **不在侧车内自建 CoreAPI/注册表/会话**（D10）。
6. **不复刻 A2A/MCP 网关零共享 Sidecar**（D9）。
7. **本期不实施 `liri-native` 侧车化**（D8，仅评估）。
8. **不新增观测指标名**（复用 `ToolMetrics`）。
9. **不改 MCP 协议语义 / 不改 `routeChannelMessage` 管线**。
10. **不做依赖静态分析的"下一步自动删"**（CD05 顺序不可颠倒）。

---

## §9 与其它 spec / 方案的接口

| 对接方 | 接口（定案） |
|---|---|
| `dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md`（**D10**） | **复用**其 P1 交付物 `utils/sidecarIpc.ts` 作为**唯一** IPC 契约（禁止第三套，GR02）；监督器形态参照其 P2 `DiscoverySidecarSupervisor`（`spawnFn` 可注入 + 有界重启）。**不**复用 A2A 发现面语义（不同域）。 |
| `dev_docs/20261012/工具治理方案-20261012.md` §5 阶段 2 / §8 | 本 spec = 阶段 2.2/2.3（`T1-10`/`T1-11`）的**正式 spec**；2.4/2.5（摘注册/删除）按 CD05/CD06 分片。 |
| `dev_docs/20261012/重型工具侧车化-盘点清单-20261012.md` | 靶点与证据底稿（P1/P2/P3）；本 spec 承接其 §3/§4 裁定。 |
| `dev_docs/20261012/五方案总览-20261012.md` §2（`T1-10`/`T1-11`）/§8.1 | 需回填"已出 spec"状态（见 §11 待回填）。 |
| `.trae/specs/long-task-suspend-resume.md` | **可选**接口 `ISnapshotCapable`（长耗时侧车工具挂起/续跑）：**本期不接**（`long-task-suspend-resume` 已落地其挂起/续跑通路；本 spec 不新增无消费者空抽象，CS03）。`SUSPENDED` 投影生产者唯一 = 该专项的 `BudgetSuspendCoordinator`（不重复）。 |
| `ai-vfs-driver-contract.md §8.1` | 侧车工具结果上限/生命周期硬约束**同源**（D6）。 |
| `.trae/specs/dead-code-and-unwired-items-rulings.md` | 轨 B（`app/src/lsp`）"未见消费者"属**登记不删**范畴（CD07）；如需新增登记条目，见 §11 待回填。 |
| `channel-process-isolation.md §2-#3` | 侧车**不得**自建 CoreAPI（D10）。 |

---

## §10 合规清单

| 规则 | 落实 |
|---|---|
| **GR15 / SDD** | ✅ 本 spec 先于实现；本文**不含产品代码改动** |
| **CD05** 先摘入口→观察→再删实现 | ✅ §3-D7、§4 阶段 2/6：删除顺序不可颠倒 |
| **CD06** 独立提交 + 回滚路径 | ✅ §4 每阶段独立可提交；删除独立提交 + 记录哈希 |
| **CD07** 关键模块不以静态零引用为删据 | ✅ §3-D7、§8 #4：`app/src/lsp`、`tools/lsp`、`app/native`、`sandbox/**`、`security/Bash*` 明确保护 |
| **CS01** 归一化（先查已有） | ✅ 复用 `sidecarIpc`/`DiscoverySidecarSupervisor`/`MCPToolBridge`/`McpToolWrapper`/`ToolMetrics`；**禁止**第三套 IPC / 新指标名 / 新权限面 |
| **CS03** 回退最小化 | ✅ 侧车崩溃 fail-closed 报错（不伪造成功）；不新增无消费者抽象（不接 `ISnapshotCapable`） |
| **CS05** 根因优先 | ✅ 根因 = "LSP 双轨 + 每次冷启动" 与 "native/OOM 在主进程" ⇒ 侧车隔离 + 常驻化，而非打补丁 |
| **CS06** 证据驱动 | ✅ §1 全带 `file:line`；"未找到"项（§1.5）显式标注；残留漂移（`CHANGELOG.md:82`）如实记录 |
| **R03/R09** 分层 | ✅ §3-D11：层倒置回流风险显式处置（先定层级再写码） |
| **R02** 实现唯一性 | ✅ 双轨收敛（D2）目标即"消除同域两套"；收敛 ≠ 新造第二套 |
| `project_rules` §1.4 | ✅ 新增 `TOOL_SIDECAR_LSP`/`TOOL_SIDECAR_MEDIA`（三级解析 env > 变体层 > 静态默认，`core/featureFlags.ts:486-499`）；**默认关**。**取证（如实）**：二者**不在** 17 项 `SAFETY_SWITCHES`（`tests/config/featureFlagContract.test.ts:25-43`）内，故不受该契约测试约束（同 `long-task-suspend-resume.md` §10 v1.7 口径） |

---

## §11 实施切片计划（供派工）

> 每片**独立可提交、独立可回滚**；★ = 前置/高优先；○ = 依赖前片。

| 切片 | 目标 | 独立提交物 | 风险 | 预计涉足文件（取证锚点） |
|---|---|---|---|---|
| **S0 ★** | 前置校验（零代码）：基座契约复核 + 消费者清单入册 | 无代码（或仅文档回填） | 低 | `utils/sidecarIpc.ts`、`tests/utils/sidecarIpc.test.ts` |
| **S1 ★** | 侧车骨架 + `TOOL_SIDECAR_LSP` 开关（默认关）+ loader 分支 | ① 开关；② supervisor（`spawnFn` 可注入 + `maxRestarts`）；③ 侧车进程骨架（consume 契约）；④ loader 分支 | 中（新进程 + 层落点，D11） | `core/featureFlags.ts`、`tools/utils/ToolManagerUtils.ts:190`、`tools/factories/builtinToolRegistry.ts:138`、新 supervisor 模块、新侧车入口脚本 |
| **S2 ○** | LSP 双轨收敛：轨 B 常驻引擎接入侧车；**保留**轨 A 工具面契约；**不删**任一实现 | 收敛接线（**独立提交**） | **中高**（CD07 保护域，误删风险） | `tools/lsp/**`、`app/src/lsp/**`、`tools/adapters/LSPToolAdapter.ts` |
| **S3 ○** | 崩溃隔离 + 取消下传（注入假子进程测试） | ① 崩溃结算/重启；② 取消 notify 帧 + 本地结算 | 中 | supervisor、侧车进程、工具执行入口（`ToolUseContext.abortController`）、`tests/**` |
| **S4 ○** | 同源门禁（T1-11）：经 `MCPToolBridge` 注册；PathGuard/权限/结果上限同源；Landlock 显式 N/A | 注册接线 + 测试 | 中 | `services/mcp/MCPToolBridge.ts:113`、`services/mcp/McpToolWrapper.ts`、`chat/ReActToolLoop.ts:1145`、`context/budget/ToolResultBudget.ts:30` |
| **S5 ○** | P2 媒体侧车：`vision_worker` 受管化 + `sharp` 先收一处（`ImageInputRouter`） | ① `TOOL_SIDECAR_MEDIA`；② worker 受管；③ sharp 收口一处 | 中（`sharp` 主路径改造面） | `ai/python/{StdioBridge,WorkerGuard,vision_worker.py}`、`tools/ImageAnalysisTool/ImageAnalysisTool.ts:170-190`、`tools/ImageGenerateTool/ImageInputRouter.ts:212,245` |
| **S6 ○** | （观察期后）按 CD06 物理删除被替代实现（若确认无消费者） | **独立删除提交**（记录清单 + 回滚哈希） | 中（不可逆） | `tools/lsp/**`、`app/src/lsp/**`（视观察结论） |
| **S7 ★** | 收尾回填（文档，零代码）：见下方"待回填" | 文档 | 低 | `CHANGELOG.md:82`、五方案总览 §2/§8.1、工具方案 §5 |

**待回填项（主循环据此回填台账/总览）**
1. `CHANGELOG.md:82` 的"（未落地）"→ "已落地（2026-10-10，`utils/sidecarIpc.ts`）"，与 D10 §8.5 消矛盾。
2. 五方案总览 §2 `T1-10`/`T1-11` 状态：由"未落地（仅盘点与裁定）"→ "**已出 spec**（`.trae/specs/tool-sidecar-isolation.md` v1.0 待批准）"。
3. 工具方案 §5 阶段 2.2 实施状态：补"靶点已裁定 + 前置（D10 P1 基座）已具备 + 本 spec 已产出"。
4. 台账：为 `TOOLGOV-SIDECAR-TARGETS`（靶点裁定，`CHANGELOG.md:82`）后续补本 spec 的 `reopenWhen`（"改侧车 IPC 基座 / 靶点 / 开关语义时"）。
5. （可选）`dead-code-and-unwired-items-rulings.md`：登记轨 B `app/src/lsp/**` 常驻管理器"当前无生产消费者"（**只登记不删**，CD07）。

---

## §12 下一步

1. **本文待用户批准**（HARD-GATE：批准前不写产品代码）。
2. 批准后：出实施计划（按 §11 切片 S0→S7，含每片测试清单），再进入编码。
3. 联动：S1 落地后回填 §11 待回填 1–4；S2 观察期结束再决定 S6 删除范围。
