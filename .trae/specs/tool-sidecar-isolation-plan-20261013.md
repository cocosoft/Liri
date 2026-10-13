# 实施计划：重型工具侧车隔离（Tool Sidecar Isolation）

> 版本: **1.0（派工计划）** ｜ 创建: 2026-10-13 ｜ 状态: **待授权实施（HARD-GATE：批准前不写产品代码）**
> 输入: `.trae/specs/tool-sidecar-isolation.md` **v1.0**（§11 切片 `S0–S7`）+ `dev_docs/20261012/重型工具侧车化-盘点清单-20261012.md` + `dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md`（**D10**）
> 约束（本稿）: **只写文档、零产品代码改动**；不 `git add/commit/push`；不改 `app/package.json` 版本或任何 feature flag。
> 硬约束（贯穿全计划）: **CD05**（先摘入口→观察→再删实现）· **CD06**（独立提交 + 回滚路径）· **CD07**（关键模块不以静态零引用为判据）· 复用 **D10** `app/src/utils/sidecarIpc.ts`（**禁第三套 IPC**）· 双跑开关**默认关**。
> 锚点说明: 本节 `file:line` 来自定案稿 / 盘点 / D10 方案 + 本稿**直接复核**（`sidecarIpc.ts`、`ToolManagerUtils.ts:190`、`builtinToolRegistry.ts:138`、`featureFlags.ts:164/486-499`、`DiscoverySidecarSupervisor.ts`、`McpToolWrapper.ts:43,114`、`ReActToolLoop.ts:1145`、`ToolResultBudget.ts:30`、`LSPServer.ts:68`、`LSPClient.ts:24`、`app/src/lsp/{LSPServerManager,LSPServerInstance}.ts`）。

---

## §0 概览

- **阶段数：8**（S0 前置 → S7 收尾）；**任务数：19**（`T0.1 … T7.2`）。
- **默认零行为变更**：`TOOL_SIDECAR_LSP`/`TOOL_SIDECAR_MEDIA` 默认关 ⇒ 侧车进程**不启动**，工具面与现状一致。
- 依赖图（`→` = 前置）：

```
T0.1 ─┬───────────────→ T1.* ─→ T2.* ─→ T3.* ─→ T4.* ─→ S5(T5.*) ─→ T6.1 ─→ T7.*
T0.2 ─┘（文档，可并行）                          └──── S3/S4 观察期 ──→ T6.1（CD05 观察）
```

| 阶段 | 任务 | 独立提交物 | 交付物性质 | 真实进程级/真机验证 |
|---|---|---|---|---|
| S0 前置校验 | T0.1 / T0.2 | 文档（零代码） | 契约复核 + 漂移回填 | 否（单测即可） |
| S1 骨架+开关 | T1.1–T1.4 | 开关 + supervisor + 侧车入口 + loader 分支 | 新进程 + 层落点（D11） | **是**（可控注入为默认） |
| S2 LSP 双轨收敛 | T2.1–T2.4 | ~~收敛接线（独立提交）~~ ⇒ **2026-10-13 落地为 Option A：不收敛轨 B + 工具面真接线（独立提交，默认关）** | CD07 保护域（Option A 下**不触碰**） | 中：双跑一致性 |
| S3 崩溃+取消 | T3.1 / T3.2 | 崩溃结算/重启 + 取消帧 | 契约行为 | **是**（可控注入）⇒ **✅ 2026-10-13 已落地** |
| S4 同源门禁 | T4.1 / T4.2 | 注册接线 + 测试 + Landlock 声明 | 安全同源 | 否（注册表断言）⇒ **✅ 2026-10-13 已落地（保名派）** |
| S5 媒体侧车 | T5.1 / T5.2 | `TOOL_SIDECAR_MEDIA` + worker 受管 + sharp 收口一处 | native/OOM 隔离 | **是**（大图/worker，按需）⇒ **✅ 2026-10-13 已落地（真机项部分受阻，见下）** |
| S6 物理删除 | T6.1 | **独立删除提交**（记录哈希） | 不可逆 | 否（走 CD05 观察结论） |
| S7 收尾回填 | T7.1 / T7.2 | 文档（零代码） | 台账/总览 | 否 |

---

## §1 可派工任务清单

### 阶段 S0 · 前置校验（零代码）

**T0.1 复核 D10 IPC 基座可用 + 双轨消费者清单入册**
- 目标：确认 `sidecarIpc` 契约测试绿；固化"轨 A/轨 B"消费者清单（供 S2 收敛用）。
- 涉足文件：`app/src/utils/sidecarIpc.ts:37,72,77,93`；`app/tests/utils/sidecarIpc.test.ts`；盘点清单 §1.1/§1.2。
- 验收（可测断言）：`bun test app/tests/utils/sidecarIpc.test.ts` 全绿；消费者清单含 `tools/lsp/**`（活跃工具面）与 `app/src/lsp/**`（常驻未接线）两轨，各附 `file:line`。
- 风险：低（只读 + 文档）。
- 依赖：无。
- 真实进程级验证：否（单测即覆盖）。
- 回滚：文档，无需回滚。

> **✅ 执行结论（2026-10-13，S0 实测）**
> - **基座契约测试绿**：`bun test tests/utils/sidecarIpc.test.ts` ⇒ **8 pass / 0 fail**（分帧往返 / 版本协商 major 相等 / 帧判定与心跳 / `BRIDGE_PROTOCOL_VERSION ≡ SIDECAR_IPC_PROTOCOL_VERSION`）。
> - **双轨消费者清单已入册**：
>   - **轨 A（活跃工具面，`tools/lsp/**`）**：`tools/factories/builtinToolRegistry.ts:138`（`createLSPTool: () => new LSPToolAdapter()`）→ `tools/utils/ToolManagerUtils.ts:190`（`cond(coreFeature('LSP'), …)`，工具名 `lsp`）。
>   - **轨 B（常驻未接线，`app/src/lsp/**`）**：**静态**仅 `tools/lsp/LSPToolIntegration.ts:15`（引 `validatePosition/…` 校验函数；其 `createLSPToolIntegration` 在 `tools/lsp/**` 外**无消费者**）。
> - **✅ 轨 B 运行时可达性取证（CD01/CD02 盲区专项）**：
>   - **静态引用结论**：`@modules/lsp` 全仓引用 = `tools/lsp/LSPToolIntegration.ts:15` + `app/tsconfig.json:38-39`（路径别名）+ `modules/ImportManager.ts:107`（别名映射）+ 测试注释 1 处；**生产静态消费者 ≈ 零**（与定案稿 §1.5 一致）。
>   - **动态入口结论（关键）**：**存在字面量动态导入** —— `core/LazyModuleStrategy.ts:364` `lsp: () => import('../lsp/index.js')`（`DYNAMIC_IMPORT_LOADERS`），且 `lsp` 声明为 `loadMode: ON_DEMAND`（`:149-153`）。**但触发链当前不可达**：`requestModule('lsp')` 仅经 `ModuleInitializer.requestOnDemandModule()`（`:410-427`）→ 其**全仓零调用方**（G-C5 登记 `:402-405`；`modules/index.ts:63-64` 仅转出）；且 `lsp` 被 `getDeferredModuleIds` 排除（ON_DEMAND 不参与批量加载，`:403-412`）。
>   - **约定式/配置驱动入口**：`modules/ModuleDefinitions.ts:399-408`（模块元数据，**无 `initialize()`**）、`MODULE_INITIALIZATION_ORDER:957`、`ImportManager.ts:107`、`tsconfig.json:38-39`。
>   - **结论（⚠️ 无法仅凭检索确证"运行时零可达"）**：静态近零 + **动态 thunk 真实存在**（未来若接线 `requestOnDemandModule('lsp')` 即被加载）⇒ 属 CD07「未接线但动态可发现」高风险项，**登记不删**（定案稿 D7）。**若需运行时确证**：对 `requestOnDemandModule`/`requestModule` 埋点，或 `FEATURE_LSP=true` 后调用 `lsp` 工具并观察 `import('../lsp/index.js')` 是否求值。
>   - **✅ 运行时取证补充（2026-10-13，真机 `--http-only` 启动 + 全日志检索）**：启动全量日志中 `lsp`（大小写不敏感）**零命中** —— 无 `初始化模块: lsp`、无 `lsp` 命名空间 logger；仅见 `按需模块已就绪: 9 个`（仅登记、不求值）。与静态"`requestOnDemandModule()` 零调用方"相互印证 ⇒ **当前运行时不可达**（日志证据；"全运行时零求值"的严格证明仍需埋点，但两条独立证据方向一致）。**仍按 CD07：登记不删**（`dead-code-and-unwired-items-rulings.md` §2 UW-5）。

**T0.2 回填 §1 残留漂移（仅文档）**
- 目标：消除 `CHANGELOG` 对 D10 P1 的过时表述。
- 涉足文件：~~`CHANGELOG.md:90`~~ —— **⚠️ 2026-10-13 复核订正该任务前提**：`CHANGELOG.md` **并无** "D10 P1 未落地" 的表述 —— `:221` 早已记 `✅ ① 轻量 IPC 基座收敛（P1）…`，而 `:90` 实为 **MCP 安全段**（子代理报的 `:82`/`:90` 行号引用**与事实不符**）⇒ **CHANGELOG 无需订正**。真正的漂移在 `dev_docs/20261012/工具治理方案-20261012.md`（§5 阶段 2.2 硬依赖段）与 `重型工具侧车化-盘点清单-20261012.md:121`，**已于 2026-10-13 订正**；`五方案总览` 的 `T1-10/T3-5..7` 状态亦已回填。
- 验收：文本改为"已落地（2026-10-10，`utils/sidecarIpc.ts`）"。
- 风险：低。
- 依赖：无（可与 T1.* 并行）。
- 真实进程级验证：否。
- 回滚：文档。

> **⚠️ 与既有裁定的冲突标注**：D10 原稿"P1 未落地"**已失效**（盘点 §4 订正）；定案稿 §1.3 已如实登记。本计划一律以"基座已落地、复用不重建"为前提（禁止第三套 IPC）。

### 阶段 S1 · 侧车骨架 + 双跑开关（默认关）

**T1.1 新增 feature flag `TOOL_SIDECAR_LSP` / `TOOL_SIDECAR_MEDIA`（默认 `false`）**
- 目标：提供"内置 vs 侧车"零行为变更灰度门。
- 涉足文件：`app/src/core/featureFlags.ts`（键定义，就近 `LSP:false` `:164`；三级解析 `feature()` `:486-499`）。
- 验收（可测断言）：两键默认 `false`；`feature('TOOL_SIDECAR_LSP')` 关时不影响现有工具面（负向测试）。
- 风险：低；**如实**：二者**不属** 17 项 `SAFETY_SWITCHES`（`app/tests/config/featureFlagContract.test.ts`），不受该契约测试约束（对齐定案稿 §10）。
- 依赖：T0.1。
- 真实进程级验证：否。
- 回滚：删键 / 置 `false`（1 行/env）。

**T1.2 新增工具侧车 supervisor（仿 `DiscoverySidecarSupervisor`）**
- 目标：可注入 `spawnFn`（测试不真 spawn）、`maxRestarts` 默认 3、`stop()` 的有界监督器。
- 涉足文件：**新模块**（落点须先定层级，见 T1.4/D11）；模板 `app/src/infrastructure/http/a2a/DiscoverySidecarSupervisor.ts:57-62,104-162,225-245`（`spawnFn` 注入 `:64-72`、有界重启 `:229`、`stop()` `:212`）。
- 验收：注入假 `ChildProcess` 单测（仿 `app/tests/infrastructure/http/a2a/discoverySidecarSupervisor.test.ts`）：就绪握手成功 / 超时 / 版本不兼容 fail-closed / 有界重启达上限后停。
- 风险：中（层落点，D11）；不落 `core`/`infra` 引 `service`/`app`（R03/R09）。
- 依赖：T1.1。
- 真实进程级验证：**否（首选可控注入）**；真机见 S6/T5。
- 回滚：新模块可整体移除（独立提交）。

**T1.3 侧车进程入口脚本（consume `sidecarIpc` 契约）**
- 目标：常驻 LSP 服务进程：startup 握手（带 pid/`protocolVersion`）+ 心跳 + `request/response` 分帧。
- 涉足文件：**新入口脚本**；契约 `app/src/utils/sidecarIpc.ts:37,72,77,93,98-104,107-111`。
- 验收：脚本可独立 `bun run`；发出合法 `startup` 帧（含 `protocolVersion=1`）；非法帧经 `decodeFrame` 返回 `null`（忽略）。
- 风险：中（新进程入口 + 跨平台 stdio）。
- 依赖：T1.2。
- 真实进程级验证：**是**（方法：真起脚本 → 断言 stdout 首帧为 `startup`；成本：低，脚本级）。
- 回滚：删脚本（独立提交）。

**T1.4 工具装载层 loader 分支 + 层级落点定案（D11）**
- 目标：按开关选"内置 loader / 侧车 loader"；先定落点再写码。
- 涉足文件：`app/src/tools/utils/ToolManagerUtils.ts:190`（`cond(coreFeature('LSP'), byKey('createLSPTool'))`）；`app/src/tools/factories/builtinToolRegistry.ts:138`（`createLSPTool: () => new LSPToolAdapter()`）。
- 验收：开关关 ⇒ loader 选择与现状**逐字一致**（负向测试）；开关开 ⇒ 走侧车 loader。
- 风险：中（装配点改动）；层倒置回流（D11）—— 参照 D10 P2 `agent/a2a/`→`infrastructure/http/a2a/` 修正先例。
- 依赖：T1.1/T1.2/T1.3。
- 真实进程级验证：否（loader 选择单测）。
- 回滚：还原 loader 分支（独立提交）。

> **✅ S1 落地说明（2026-10-13）**
> - **落点**：开关 `core/featureFlags.ts`（`TOOL_SIDECAR_LSP`/`TOOL_SIDECAR_MEDIA`，默认关）+ supervisor/receiver 骨架 `app/src/tools/sidecar/{ToolSidecarSupervisor,toolSidecarLifecycle,lspSidecar}.ts` + loader 分支 `tools/utils/ToolManagerUtils.ts`（`selectLspToolLoader`）。
> - **监督器选型（如实）**：**新写**（仿 `DiscoverySidecarSupervisor`：`spawnFn` 可注入 + `maxRestarts` 默认 3 + `stop()`）；**不**复用 `daemon/ProcessManager`（属守护进程控制面，unix-socket/http 语义 ≠ 本契约 stdio 换行 JSON，对齐 D10 §8.5）。`spawnFn` 采用**内联窄签名**（不新增导出 `SpawnFn` 别名，规避 R02-002 同名类型多模块定义）。
> - **⚠️ 与定案稿 §4 阶段 1 验收的差异（如实）**：定案稿阶段 1 写"开关开 ⇒ `lsp` 工具**经侧车返回结果**"；**本切片（S1）仅骨架** —— 开关开时 loader 走**侧车分支**但 **fail-closed 返回 `null`**（不伪造成功、**不**回落内置"每次 spawn"⇒ 规避 spec §2「静默双轨」反目标）；**工具面真接线在 S2/T2.2–T2.3**（与本计划 T2.2/T2.3 的任务边界一致）。
> - **启动层门控**：仅 `maybeStartLspSidecar()` 可 `spawn`，且**开关关 ⇒ 立即返回 `null`（零 spawn）**。

### 阶段 S2 · LSP 双轨收敛（**CD05 / CD07**）

> **✅ 执行结论（2026-10-13，**Option A**，用户裁定）**：**不收敛轨 B、不改 `app/src/lsp/**` 与 `tools/lsp/**`**（前置取证：轨 B 静态近零 + **运行时不可达** ⇒ 无「必须复用」压力；见 T0.1 两条互证结论）。改做**工具面真接线**：
> - 新增 `tools/sidecar/lspConnection.ts`（侧车**自持**最小 LSP 连接：标准 `Content-Length` 分帧；`initialize`/`hover`/`definition`；`resolveLanguageServerCommand()` 语言→命令映射；`spawnFn` 可注入）与 `tools/sidecar/SidecarLspTool.ts`（侧车工具适配器；schema 与内置 `LSPToolAdapter` **deep-equal**）。
> - `lspSidecar.ts` 由 S1 桩改为**真实方法分派**；loader 侧车分支由「返回 `null`」改为 `createToolLoader(() => new SidecarLspTool())`（**off 分支原样**；装配点未动 ⇒ 同一 ToolRegistry/PathGuard/结果上限路径）。
> - **覆盖 3 项**（`lsp.initialize`/`lsp.hover`/`lsp.definition`）；**其余 11 个 action 一律 fail-closed `NOT_IMPLEMENTED`**（不假装成功、不静默回落内置）。
> - **验证**：先红后绿（实现前 7 fail + 2 errors ⇒ 后 **38 pass / 0 fail**）；真实进程级（**假 LS**）E2E 打通（spawn → 握手 → initialize → hover ⇒ `FAKE_HOVER` → definition ⇒ `Location[]` → stop）；`tests/{tools,utils}` **1044 pass / 0 fail**；门禁全绿。证据 `TOOLGOV-SIDECAR-S2`。
> - **如实遗留**：**真实 LS 端到端未验证**（本机无 `typescript-language-server`）；LS 崩溃恢复/退避与**取消下传**未接线（属 **S3**）；**同源门禁**（S4/T1-11）未做。

**T2.1 轨 A / 轨 B 消费者与生命周期梳理**
- 目标：固化两轨的消费者、生命周期、契约边界（不改码）。
- 涉足文件：轨 A `app/src/tools/lsp/**`（`LSPServer.start()` spawn `app/src/tools/lsp/LSPServer.ts:68`；超时 `app/src/tools/lsp/LSPClient.ts:24`）；轨 B `app/src/lsp/**`（`createLSPServerManager()` `app/src/lsp/LSPServerManager.ts:30`、`createLSPServerInstance()` `app/src/lsp/LSPServerInstance.ts:41`）；工具面 `app/src/tools/adapters/LSPToolAdapter.ts:44,48`（`name='lsp'`）。
- 验收：清单明确"轨 B 常驻引擎 = 侧车底座；轨 A 工具面契约（`name='lsp'`/params/action/`maxResultSizeChars=10000`）须保留"。
- 风险：低（只读）。
- 依赖：T0.1。
- 真实进程级验证：否。
- 回滚：文档。

**T2.2 轨 B 常驻引擎接入侧车**
- 目标：把轨 B 的常驻 + 崩溃恢复（`LSPServerInstance` 退避/健康）接入侧车进程。
- 涉足文件：`app/src/lsp/LSPServerInstance.ts:41,49-54`、`app/src/lsp/LSPServerManager.ts:30`；侧车入口（T1.3）。
- 验收：侧车进程内经轨 B 引擎提供 LSP 查询；崩溃恢复/退避在侧车内生效。
- 风险：**中高**（CD07 保护域，误删/误改风险）。
- 依赖：T1.3/T2.1。
- 真实进程级验证：**是**（真起侧车 + 一次 `lsp` 查询；方法见 §1「真机验证」）。
- 回滚：接线独立提交，可单独 revert（**不删任何实现**）。

**T2.3 保留轨 A 工具面契约（形状不变）**
- 目标：`lsp` 工具对外 `params/action 语义/结果形状/maxResultSizeChars` 与内置一致。
- 涉足文件：`app/src/tools/adapters/LSPToolAdapter.ts:44,48`；侧车 loader（T1.4）。
- 验收：开关开/关两态下 `lsp` 工具 schema/结果形状一致（对照测试）。
- 风险：中（契约漂移）。
- 依赖：T2.2。
- 真实进程级验证：否（形状对照）。
- 回滚：还原适配器改动。

**T2.4 先摘入口 → 观察（两轨均**不删**）**
- 目标：把内置 loader 分支改为"开关为真走侧车、否则走内置"，**保留实现体**，进入观察期（CD05②）。
- 涉足文件：`app/src/tools/utils/ToolManagerUtils.ts:190`、`builtinToolRegistry.ts:138`。
- 验收：观察期**无失联消费者 / 无降级告警 / 无 `tools.*` 异常日志**（CD05②）；`README`/`gen:toolnames` 零漂移。
- 风险：中高（CD07 保护域）。
- 依赖：T2.3。
- 真实进程级验证：否（观察期以日志/监控判定）。
- 回滚：还原 loader 分支。

### 阶段 S3 · 崩溃隔离 + 取消下传（全链路契约）

> **✅ 执行结论（2026-10-13）**：
> - **取消下传（T3.2）逐跳**：工具层认领 `AbortSignal`（`SidecarLspTool.ts:237`，对齐既有 `McpToolWrapper`）⇒ supervisor 写 `notify` 帧（**沿用 `sidecarIpc` 既有 `{type:'notify',event,data}` 形状，未造新协议**）并**本地结算**（`ToolSidecarSupervisor.ts:217-221`）⇒ 侧车 `inflight.get(id).abort()`（`lspSidecar.ts:120-127`）⇒ 连接层写标准 LSP **`$/cancelRequest`**（`lspConnection.ts:240-243`）。取消 ⇒ 明确「已取消」且**不回落内置**。
> - **崩溃结算/重启（T3.1）**：崩溃 ⇒ **pending 全拒**（明确错误）+ **不自动重试**（避免重复副作用）+ **有界重启**（`waitUntilReady`：重启窗口内请求等待握手就绪；超限 ⇒ `fatal` fail-closed）。
> - **验证**：先红后绿（实现前 **2 pass / 5 fail** ⇒ 后 **7 pass / 0 fail**；如实：崩溃结算与开关关等价两例因 S1 已落地本已为绿）+ **真实进程级 + 故障注入（假 LS）E2E** 全链通过（`abort()` ⇒ 假 LS 收到 `cancel:` 且主内核存活 ⇒ `kill()` ⇒ 重启 `getRestarts()===1` ⇒ 再请求成功）；`tests/{tools,utils}` **1051 pass / 0 fail**；门禁全绿。证据 `TOOLGOV-SIDECAR-S3`。
> - **如实遗留**：**真实 `typescript-language-server` 语义端到端未验证**（本机未装，同 S0/S2）；取消为 **best-effort**；`fatal` 态后请求立即 fail-closed。

**T3.1 崩溃隔离：pending 全结算 + 有界重启**
- 目标：侧车崩溃 ⇒ 主内核收**普通 RPC 错误**、主进程存活、长任务可续跑；supervisor 有界重启，超限降级报错（不伪造成功）。
- 涉足文件：`app/src/ai/python/JsonRpcBridge.ts:218-227`（`exit` 时 reject 全部 pending，**同源语义**）；侧车 supervisor（T1.2）；测试范式 `app/tests/execution/processCrashInjection.test.ts`。
- 验收（可测断言）：注入假子进程"崩溃/僵死" ⇒ ① 所有 pending **reject**；② 主进程存活；③ supervisor **有界重启**；超限 ⇒ 降级报错（fail-closed，CS03）。
- 风险：中。
- 依赖：T1.2/T2.4。
- 真实进程级验证：**是**（可控注入为默认；真机可选）。
- 回滚：独立提交 revert。

**T3.2 取消下传：本地结算 + `notify` cancel 帧**
- 目标：`AbortSignal` 跨进程 = 本地 pending 先结算 + 经契约发 `{type:'notify',event:'cancel',data:{id}}`。
- 涉足文件：工具执行入口 `context.abortController`（对齐 `app/src/services/mcp/McpToolWrapper.ts:114`）；契约 `app/src/utils/sidecarIpc.ts:61-66`（`notify` 帧）；测试对齐 `app/tests/tools/toolCancellation.test.ts`。
- 验收（可测断言）：abort ⇒ ① 本地 pending **结算**；② 断言**写出的 `notify` cancel 帧**（假子进程 stdin 捕获）；不引入第三套信号机制。
- 风险：中（notify 为 **best-effort**，侧车可能已崩）。
- 依赖：T3.1。
- 真实进程级验证：**是**（假子进程 stdin 捕获为主）。
- 回滚：独立提交 revert。

### 阶段 S4 · 同源门禁（T1-11）

> **✅ 执行结论（2026-10-13，**保名派**）**：
> - **取证三问**：① 侧车工具**已**在同一 `ToolRegistry` / 同一装配链（`ToolManagerUtils.ts:207` 的 `cond(coreFeature('LSP'), …)` 位于 `buildBuiltinToolLoaders()` 清单内 ⇒ 经 `getBuiltinToolLoaders()` 进唯一注册表 `ToolRegistry.ts:798`）；② **PathGuard 与结果上限已天然覆盖**（门禁落点 `ReActToolLoop.ts:1145`；`resolveToolParamNames` 从全局注册表读 `params`，侧车 `file_path ∈ PATH_ARG_KEYS` ⇒ 被提取判定拦截；`maxResultSizeChars=10000` 经 `getInfo()` 透出至公共预算器）；③ **改名派不可行**（破坏 S2 的 schema deep-equal 不变量 + 需整套 MCP server 基建，而侧车**不是** MCP server）。
> - **裁定**：**保名派**（同一 registry + 同一门禁链即达成 T4.1 的**目标**；工具名恒 `lsp`）；T4.1 验收原文已订正（见上）。
> - **T4.2 落地**：`SIDECAR_LSP_LANDLOCK_APPLICABILITY = { applies:false, reason:'LSP 工具为只读代码智能查询 ⇒ Landlock 不适用' }` **显式声明**（`SidecarLspTool.ts:48-61`；**代码常量 + 注释 + 测试断言三处一致**，对齐 D6「明示、不装作同源」）；新增测试 `sidecarSameSourceGate.test.ts` **9 例**（同源注册 / PathGuard 拦截 / 结果上限 / Landlock N/A / 开关关等价）。
> - **先红后绿（如实）**：真实红→绿**仅**在 Landlock 常量（实现前 `SyntaxError…` ⇒ 0 pass/1 fail/1 error；后 **9 pass / 0 fail**）；PathGuard/结果上限两例**首次可运行即绿**（机制层 S2 已天然覆盖 ⇒ 本片为**验证 + 回归锁定**，**未编造红**）。
> - **验证**：`tests/{tools,chat,utils}` **1597 pass / 0 fail**；门禁全绿。证据 `TOOLGOV-SIDECAR-S4`。
> - **如实遗留**：真实 LS 端到端仍未验证；未在 `ReActToolLoop` 全栈做整轮拦截断言（改在门禁落点证明同源）。

**T4.1 经 `MCPToolBridge` 注册为 `${server}__${tool}`**
- 目标：侧车工具进**同一** `ToolRegistry`，自动获同套门禁。
- 涉足文件：`app/src/services/mcp/MCPToolBridge.ts:112-115`（`registerServerTools()`）；`app/src/services/mcp/McpToolWrapper.ts:43`（工具名 `${serverName}__${toolName}`）。
- 验收：测试断言侧车工具注册进同一 registry；~~工具名格式为 `${server}__${tool}`（**非** `mcp__...`）~~ ⇒ **2026-10-13 订正为「保名派」**：经**同一装配链 / 同一 `ToolRegistry`**（`getBuiltinToolLoaders()` → `ToolManager.loadBuiltinTools()`）接入 ⇒ **自动获同套门禁**，工具名**恒 `lsp`**（与内置契约 deep-equal）。依据：改名派（计划原文）会破坏 S2 锁定不变量（`sidecarLspTool.test.ts:237-241` 的 schema deep-equal）且需引入整套 MCP server 基建（侧车**不是** MCP server）⇒ 不可行；冲突影响清单与两份口径见证据 `TOOLGOV-SIDECAR-S4`。
- 风险：中（注册链同源）。
- 依赖：T2.4。
- 真实进程级验证：否（注册表断言）。
- 回滚：注销接线。

**T4.2 PathGuard / 权限 / 结果上限同源 + Landlock 显式 N/A**
- 目标：侧车工具天然过 `pathGuard.checkToolCall` 与结果上限；Landlock 只读 LSP 查询 **N/A**（明示，不装作同源）。
- 涉足文件：`app/src/chat/ReActToolLoop.ts:1145`（`this.pathGuard.checkToolCall(tc.name, tc.input)`；`createPathGuard` 导入 `:30`）；`app/src/context/budget/ToolResultBudget.ts:30`（`maxResultSizeChars`）；定案稿 D6。
- 验收：PathGuard 命中**拦截**侧车工具；结果上限生效；Landlock 适用性有**显式声明**（LSP=只读 ⇒ N/A）。
- 风险：中（安全姿态，CS06 不装作同源）。
- 依赖：T4.1。
- 真实进程级验证：否。
- 回滚：独立提交 revert。

### 阶段 S5 · P2 媒体侧车（评估驱动切片，受 `TOOL_SIDECAR_MEDIA`）

> **✅ 执行结论（2026-10-13，开关**默认关**）**：
> - **T5.1**：新增 `tools/sidecar/{mediaSidecar,mediaSidecarLifecycle,mediaCapabilities,SidecarMediaAnalyzer}.ts`（**复用** `ToolSidecarSupervisor` + `sidecarIpc`，**无第三套 IPC**）；`ImageAnalysisTool.getL2WorkerGuard` 改**双跑**（关 ⇒ 既有 `WorkerGuard` 逐字不变；开 ⇒ 经 `media.analyze` 同形状）；覆盖 `ocr`/`objects`/`similarity`，其余（`sam_segment`/`depth_estimate`…）**显式 fail-closed**。
> - **T5.2**：**只收一处** —— `ImageInputRouter` 的超大图缩放（原 >20MB 动态 `import('sharp')`）开关开 ⇒ 经 `media.resize`；关 ⇒ 逐字原路径；**未触碰** `media/image/ImageProcessor.ts` 主路径与其它 `sharp` 调用点。**等价性**：off/on **字节级等价**（on 后端 = 同参数真 sharp）；后端抛错 ⇒ **不静默回落**。
> - **验证**：先红后绿（3 errors + 5 fail / 1 pass ⇒ **17 pass / 0 fail**）；`tests/tools/sidecar` **64 pass**；`tests/{tools,utils,ai}` **1325 pass / 0 fail**；门禁全绿。证据 `TOOLGOV-SIDECAR-S5`。
> - **真机（如实）**：真起侧车 ⇒ 握手 OK ⇒ `media.resize` 经**真 sharp** 得 JPEG 50×50 ⇒ `sam_segment` NOT_IMPLEMENTED ⇒ `media.analyze(ocr)` **受阻**（`Model 'easyocr' is not installed`）⇒ **真实 L2 模型端到端未验证**（未伪造）。
> - **遗留**：无 >20MB 真图夹具（以 161KB 图 + 缩小 `maxBytes` 触发同一路径做等价验证，属计划允许的退化）；**未摘未删** `ai/python/**`（CD05/CD06/CD07）。

**T5.1 `vision_worker` 升级为受管 MCP 侧车**
- 目标：`vision_worker`（已进程外常驻、真 OOM 源）纳入同一管理面（注册/权限/生命周期同源）。
- 涉足文件：`app/src/ai/python/StdioBridge.ts:33-42`、`app/src/ai/python/WorkerGuard.ts:64`、`app/src/ai/python/vision_worker.py`；消费方 `app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts:170-190`。
- 验收：开关关 ⇒ 零行为变更；开关开 ⇒ OCR/objects/similarity 经侧车**同源**返回。
- 风险：中（主路径改造面）。
- 依赖：T1.1/T4.1。
- 真实进程级验证：**是**（按需：真 worker + 一次 OCR；成本：需模型/依赖环境）。
- 回滚：关 `TOOL_SIDECAR_MEDIA`。

**T5.2 `sharp` 先收一处（超大图缩放，异常路径）**
- 目标：**先收"最高价值 + 最低耦合"一处**（已异常路径 + 已动态导入），再评估主路径。
- 涉足文件：`app/src/tools/ImageGenerateTool/ImageInputRouter.ts:212,245`（>20MB 动态 `import('sharp')`）；对照主路径 `app/src/media/image/ImageProcessor.ts:11,16-28`（**本片不动**）。
- 验收：收口处功能与结果**等价**；开关关 ⇒ 零行为变更。
- 风险：中（`sharp` 主路径改造面大，故仅收一处）。
- 依赖：T5.1。
- 真实进程级验证：**是（按需/真机）**（>20MB 大图开关开/关两态对照；成本：需大图夹具 + 可控崩溃注入难，可退化为"路径等价"验证）。
- 回滚：关开关 / revert 收口提交。

### 阶段 S6 · 观察期后物理删除（**CD06**，仅当确认无消费者）

**T6.1 独立删除提交（记录被删清单 + 回滚哈希）**
- 目标：若 S2 观察期确认无消费者 ⇒ **独立提交**物理删除被替代实现。
- 涉足文件：`app/src/tools/lsp/**`、`app/src/lsp/**`（**视观察结论**；**CD07 一票否决域**）。
- 验收：删除在**独立提交**；提交信息写明**六步核查结论**（CD01–CD04）+ 回滚方式；回滚哈希可复原。
- 风险：**中高（不可逆）**；`app/src/lsp/**` 静态近零引用**恰是** CD07 高风险项 ⇒ **禁止**仅凭静态零引用删（CD01/CD02 动态导入/配置/运行时发现盲区）。
- 依赖：S2/S3/S4 观察期**结论**。
- 真实进程级验证：否（依观察结论）。
- 回滚：`git revert` 该独立提交（保留哈希）。

### 阶段 S7 · 收尾回填（文档，零代码）

**T7.1 回填 CHANGELOG / 五方案总览 / 工具方案**
- 目标：把"仅盘点与裁定、零实现"更新为"已出 spec（v1.0）· 待批准"。
- 涉足文件：`CHANGELOG.md:90`；`dev_docs/20261012/五方案总览-20261012.md:267`（`T1-10`/`T1-11`）；`dev_docs/20261012/工具治理方案-20261012.md`（§5 阶段 2.2 实施状态）。
- 验收：三处状态一致，无"未落地"残留。
- 风险：低。
- 依赖：S1 落地后。
- 真实进程级验证：否。
- 回滚：文档。

**T7.2 台账登记 `reopenWhen` + 可选 dead-code 登记**
- 目标：为 `TOOLGOV-SIDECAR-TARGETS` 补 `reopenWhen`（"改侧车 IPC 基座 / 靶点 / 开关语义时"）；可选登记轨 B"当前无生产消费者"（**只登记不删**）。
- 涉足文件：`.trae/architecture/fix-evidence-registry.json`（`TOOLGOV-SIDECAR-TARGETS`）；`.trae/specs/dead-code-and-unwired-items-rulings.md`（可选）。
- 验收：条目自洽（`lint:fix-evidence` 通过）。
- 风险：低。
- 依赖：T7.1。
- 真实进程级验证：否。
- 回滚：文档。

---

## §2 CD05 / CD06 / CD07 合规对照

| 规则 | 落在哪些任务 | 落实要点 |
|---|---|---|
| **CD05**（先摘入口→观察→再删实现） | **T2.4**（摘入口，保留实现）→ 观察期 → **T6.1**（才物理删除） | 顺序**不可颠倒**；禁止"入口与实现同提交一起删" |
| **CD06**（独立提交 + 回滚） | 全部任务（每片独立可提交）；**T6.1** 为**独立删除提交** + 记录哈希 | 每片独立 revert；删除提交写明六步核查结论 |
| **CD07**（关键模块不以静态零引用为判据） | **T2.2/T2.4/T6.1**：`app/src/lsp/**`、`tools/lsp/**` **一票否决** | 轨 B"静态近零引用"**恰是** CD07 高风险项 ⇒ 先摘/接回入口并观察，**禁止直接删** |

## §3 IPC 复用约束（D10，禁第三套）

- **唯一 IPC 契约** = `app/src/utils/sidecarIpc.ts`（`SIDECAR_IPC_PROTOCOL_VERSION=1` `:37`；帧类型 `:40-45`；`encodeFrame/decodeFrame` `:72/:77`；`isCompatibleVersion` `:93`；`startup/heartbeat` 判定与构造 `:98-111`）。已由 `JsonRpcBridge` 与 `discoverySidecar` 消费。
- 选型：**stdio + 换行分隔 JSON**（跨平台；Windows 无 unix socket）；`daemon/IPCService`（unix socket/http）属**守护进程控制面**，**不并入**。
- 侧车须自行实现 **startup 握手（含 `protocolVersion`）** + **心跳**（契约仅提供帧/编解码/兼容判定，不含运行接线）。
- **禁止**新造第二/第三套 IPC（GR02）；监督器**不新建第二套**（仿 `DiscoverySidecarSupervisor` 模板，`spawnFn` 可注入）。

## §4 无法确认清单（如实）

1. **工具侧车 supervisor 的**具体层级落点**未定**：D11 要求"先定层级再写码"；本稿给候选（`tools/**` 内 vs 经既有模块）但**未拍板**（缺"装配代码归属模块"的既定约定）。
   - **✅ S1 定案（2026-10-13）**：落 `app/src/tools/sidecar/**`（`tools` = **app** 层，见 `scripts/modules-to-layers.json:36`）；出向仅 `@modules/core`（`FeatureFlag`）/`@modules/monitoring`（Logger）/`@modules/utils/sidecarIpc` ⇒ **app → core/infra**，合法，无层倒置（`lint:arch` 0 违规）。
2. **S2 双轨收敛的"以轨 B 为底座"是否引入轨 A 未覆盖能力缺口**：轨 A 有 `npx` 冷启动的各 external LS（`LSPToolImpl.ts:274-337`，引自盘点 §1），轨 B 常驻引擎支持的 LS 集合（`LSPServerManager.ts:44-59`：ts/rust/go/python/c/java）与之**是否等价**未逐项比对 —— ~~需 S2/T2.1 清单确认~~ ⇒ **已结案（2026-10-13，Option A）**：**不收敛两轨**（用户裁定），侧车**自持**最小 LSP 连接 ⇒ 本项**不再相关**。
3. **`liri-native` 侧车评估**（定案稿 D8，本期仅评估）：不在本计划任务内；其量化评估（11 处调用点 × 热路径代价 × 崩溃恢复）**未产出**。
4. **真机验证环境**：真实 `typescript-language-server`（经 `npx`）与 >20MB 大图夹具**是否可用**未确认（§1 真机项依赖本机环境）。
   - **⚠️ 探测结果（2026-10-13，S0 实测）**：`npx --no-install typescript-language-server --version` ⇒ **失败**（`npm error npx canceled due to missing packages and no YES option: ["typescript-language-server@6.0.2"]`）⇒ 本机**未安装**该 LS，**离线环境不可用**（真机时延对比项受阻）。仓库内 `*.png/jpg/jpeg/webp/tiff/bmp` 中**无 >5MB 文件**（更无 >20MB）⇒ **无可用大图夹具**（P2 真机项受阻）。二者均需**外部环境补齐**后方可真机验证。
5. **`FeatureFlag` 联合类型是否允许直接新增键**：`feature()` 从 `FEATURE_FLAGS` 取值（`core/featureFlags.ts:498`），新增键需同步 `FeatureFlag` 类型——**未逐点核验**该类型的声明位置（实施期确认）。
   - **✅ S1 取证（2026-10-13）**：`export type FeatureFlag = keyof typeof FEATURE_FLAGS`（`core/featureFlags.ts:510`）⇒ 新增 `TOOL_SIDECAR_LSP`/`TOOL_SIDECAR_MEDIA` 后**自动并入联合类型**；`feature('TOOL_SIDECAR_LSP')` 编译期通过（`typecheck` 3 工程 0 错）。

## §5 需回填的台账 / 总览项（主循环）

| # | 目标 | 现状（取证） | 建议改为 |
|---|---|---|---|
| 1 | `CHANGELOG.md`（**实际 `:90`**） | "D10 的 **P1（未落地）**" | "已落地（2026-10-10，`utils/sidecarIpc.ts`）"，与 D10 §8.5 消矛盾 |
| 2 | `dev_docs/20261012/五方案总览-20261012.md:267` | `T1-10`/`T1-11` = "**仅盘点与裁定，零实现**" | "**已出 spec**（`.trae/specs/tool-sidecar-isolation.md` v1.0 待批准）" |
| 3 | `dev_docs/20261012/工具治理方案-20261012.md`（§5 阶段 2.2） | 靶点已裁定 + 前置已具备 | 补"本计划已产出（`tool-sidecar-isolation-plan-20261013.md`）" |
| 4 | `TOOLGOV-SIDECAR-TARGETS` 台账 | 无 `reopenWhen` | 补 reopenWhen="改侧车 IPC 基座 / 靶点 / 开关语义时" |
| 5 | （可选）`dead-code-and-unwired-items-rulings.md` | 轨 B 未登记 | 登记 `app/src/lsp/**` 常驻管理器"当前无生产消费者"（**只登记不删**，CD07） |
