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
| S2 LSP 双轨收敛 | T2.1–T2.4 | 收敛接线（独立提交） | CD07 保护域 | 中：双跑一致性 |
| S3 崩溃+取消 | T3.1 / T3.2 | 崩溃结算/重启 + 取消帧 | 契约行为 | **是**（可控注入） |
| S4 同源门禁 | T4.1 / T4.2 | 注册接线 + 测试 + Landlock 声明 | 安全同源 | 否（注册表断言） |
| S5 媒体侧车 | T5.1 / T5.2 | `TOOL_SIDECAR_MEDIA` + worker 受管 + sharp 收口一处 | native/OOM 隔离 | **是**（大图/worker，按需） |
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

**T0.2 回填 §1 残留漂移（仅文档）**
- 目标：消除 `CHANGELOG` 对 D10 P1 的过时表述。
- 涉足文件：`CHANGELOG.md:90`（现写"D10 的 **P1（未落地）**"，与 D10 §8.5/P1 **已落地**矛盾；注：定案稿引 `:82`，实际行号已漂移到 `:90`）；`dev_docs/20261012/五方案总览-20261012.md:267/:270`。
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

### 阶段 S2 · LSP 双轨收敛（**CD05 / CD07**）

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

**T4.1 经 `MCPToolBridge` 注册为 `${server}__${tool}`**
- 目标：侧车工具进**同一** `ToolRegistry`，自动获同套门禁。
- 涉足文件：`app/src/services/mcp/MCPToolBridge.ts:112-115`（`registerServerTools()`）；`app/src/services/mcp/McpToolWrapper.ts:43`（工具名 `${serverName}__${toolName}`）。
- 验收：测试断言侧车工具注册进同一 registry；工具名格式为 `${server}__${tool}`（**非** `mcp__...`）。
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
2. **S2 双轨收敛的"以轨 B 为底座"是否引入轨 A 未覆盖能力缺口**：轨 A 有 `npx` 冷启动的各 external LS（`LSPToolImpl.ts:274-337`，引自盘点 §1），轨 B 常驻引擎支持的 LS 集合（`LSPServerManager.ts:44-59`：ts/rust/go/python/c/java）与之**是否等价**未逐项比对 —— 需 S2/T2.1 清单确认。
3. **`liri-native` 侧车评估**（定案稿 D8，本期仅评估）：不在本计划任务内；其量化评估（11 处调用点 × 热路径代价 × 崩溃恢复）**未产出**。
4. **真机验证环境**：真实 `typescript-language-server`（经 `npx`）与 >20MB 大图夹具**是否可用**未确认（§1 真机项依赖本机环境）。
5. **`FeatureFlag` 联合类型是否允许直接新增键**：`feature()` 从 `FEATURE_FLAGS` 取值（`core/featureFlags.ts:498`），新增键需同步 `FeatureFlag` 类型——**未逐点核验**该类型的声明位置（实施期确认）。

## §5 需回填的台账 / 总览项（主循环）

| # | 目标 | 现状（取证） | 建议改为 |
|---|---|---|---|
| 1 | `CHANGELOG.md`（**实际 `:90`**） | "D10 的 **P1（未落地）**" | "已落地（2026-10-10，`utils/sidecarIpc.ts`）"，与 D10 §8.5 消矛盾 |
| 2 | `dev_docs/20261012/五方案总览-20261012.md:267` | `T1-10`/`T1-11` = "**仅盘点与裁定，零实现**" | "**已出 spec**（`.trae/specs/tool-sidecar-isolation.md` v1.0 待批准）" |
| 3 | `dev_docs/20261012/工具治理方案-20261012.md`（§5 阶段 2.2） | 靶点已裁定 + 前置已具备 | 补"本计划已产出（`tool-sidecar-isolation-plan-20261013.md`）" |
| 4 | `TOOLGOV-SIDECAR-TARGETS` 台账 | 无 `reopenWhen` | 补 reopenWhen="改侧车 IPC 基座 / 靶点 / 开关语义时" |
| 5 | （可选）`dead-code-and-unwired-items-rulings.md` | 轨 B 未登记 | 登记 `app/src/lsp/**` 常驻管理器"当前无生产消费者"（**只登记不删**，CD07） |
