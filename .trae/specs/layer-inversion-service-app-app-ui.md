# Spec：分层倒挂收口 —— `service -> app` / `app -> ui` 两桶（134 条）

> 版本 1.0 ｜ 创建 2026-10-01 ｜ 状态：**待批准**
> 来源：`pending-tasks-consolidated-20261001.md` §1 ① **T-①10** 的后续批次（前序 spec §N4 明确"其他桶属 T-①10 后续批次"）
> 前序：`layer-inversion-memory-chronos-system.md`（`system`/`memory`/`chronos` 三组 10 条边，**已完成**，`infra` 源**真实归零**）
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ **CS05（根因优先）** / CS03（回退最小化）/ §1.3（无兼容包袱）

---

## 1. 范围与现状（**全部为门禁探针实测**，2026-10-01 D-173）

**全局底数**：`lint:arch` = 违规 **0** / **`已豁免 151`** / 错误 0 警告 2（仅既有 R07-004 + R00-003）/ `allFiles 3991`。

**计数口径**（D-171 已归因）：`已豁免` = **Σ(文件 × 去重后的目标模块)**，**不是** import 语句数。本 spec 全文按此口径。

**本 spec 覆盖 134 条 = 151 的 89%**，剩 17 条（`core -> app` 11 · `app -> entry` 3 · `service -> ui` 2 · `service -> entry` 1）**不在本 spec**（另批）。

### 1.1 `app -> ui`（64 条，**全为"UI 组件长在 app 层模块里"**）

| # | 源模块 → 目标模块 | 条数 | 实测样例（探针输出） |
|---|---|---:|---|
| A1 | `tools -> ink` | **47** | `tools/AgentTool/UI.tsx` · `tools/AskUserQuestionTool/UI.tsx` · `tools/bash/UI.tsx` |
| A2 | `knowledge -> components` | 10 | `knowledge/components/KnowledgeDocList.tsx` · `KnowledgeGraphAsciiView.tsx` · `KnowledgeQualityPanel.tsx` |
| A3 | `buddy -> components` | 2 | `buddy/CompanionSprite.tsx` · `buddy/useBuddyNotification.tsx` |
| A4 | `commands -> ink` | 2 | `commands/builtin/shared/CommandUI.tsx` · `commands/builtin/status/StatusUI.tsx` |
| A5 | `commands -> ui` | 2 | `commands/builtin/theme/Theme.ts` · `commands/tools/remote/remote-session.ts` |
| A6 | `docs -> ui` | 1 | `docs/HelpSystem.ts` |
| | **合计** | **64** | |

**层归属（`scripts/modules-to-layers.json` 实测）**：`tools`/`knowledge`/`buddy`/`commands`/`docs` = **app**；`ink`/`components`/`cli`/`vim` = **ui**。

**根因（CS05）**：**混合模块**（一个 app 模块里同时住业务与 UI），与 **D-84 `hooks`** 同型（当时把 `hooks` 由 ui 改归 app，理由是其**零 ui 依赖**且被 app/infra 消费）。此处方向相反：这些模块**确实依赖 ui**，故不能靠"改层"消解，必须**把 UI 部分归位**。

### 1.2 `service -> app`（70 条，**真跨层 + 装配错层混合**）

| # | 源模块 → 目标模块 | 条数 | 实测样例 |
|---|---|---:|---|
| B1 | `services -> chat` | 6 | `services/compact/autoCompact.ts` · `AutoCompactService.ts` · `grouping.ts` |
| B2 | `services -> ai` | 5 | `services/compact/CompactService.ts` · `services/compact/utils.ts` · `services/prompt/DiagnosticsReport.ts` |
| B3 | `services -> tools` | 4 | `services/agent/builtInAgents.ts` · `services/mcp/MCPToolBridge.ts` · `MCPToolRegistry.ts` |
| B4 | `services -> context` | 2 | `services/compact/utils.ts` · `services/mcp/MCPToolBridge.ts` |
| B5 | `services -> commands` / `-> plugins` / `-> workspaces` | 1+1+1 | `services/mcp/MCPCacheManager.ts` · `services/mcp/PluginMCPToolServer.ts` · `services/workspace/index.ts` |
| | *`services` 小计* | **20** | |
| B6 | `infrastructure -> sandbox` | 6 | `http/handlers/file-upload-handlers.ts` · `handler-utils.ts` · `knowledge-handlers.ts` |
| B7 | `infrastructure -> tools` | 4 | `agent-control-handlers.ts` · `agent-role-handlers.ts` · `media-template-handlers.ts` |
| B8 | `infrastructure -> chat` | 4 | `chat-handlers.ts` · `checkpoint-handlers.ts` · `file-upload-handlers.ts` |
| B9 | `infrastructure -> agent` | 4 | `orchestration-handlers.ts` · `OrchestrationHistoryAdapter.ts` · `routes/a2a-delegator.ts` |
| B10 | `infrastructure -> auto-reply` | 1 | `auto-reply-handlers.ts` |
| | *`infrastructure` 小计* | **19** | |
| B11 | `session -> chat` | **11** | `session/bootstrap/SessionSystemBootstrap.ts` · `compaction/ServiceAdapters.ts` · `hydration/SessionStateHydrator.ts` |
| B12 | `session -> ai` | 2 | `session/bootstrap/SessionSystemBootstrap.ts` · `session/memory/SessionMemoryManager.ts` |
| B13 | `session -> query` | 2 | `session/SessionGateway.ts` · `session/SessionManager.ts` |
| B14 | `session -> context` | 1 | `session/SessionGateway.ts` |
| | *`session` 小计* | **16** | |
| B15 | `runtime -> chat` / `-> tools` / `-> ai` / `-> agent` | 3+2+1+1 | `runtime/api/CoreAPI.ts` · `CoreAPIImpl.ts` |
| | *`runtime` 小计* | **7** | |
| B16 | `channels -> context` / `-> ai` | 2+2 | `channels/bootstrap/ChannelBootstrapper.ts` · `channels/registry/ChannelRegistry.ts` · `channels/GatewaySessionTracer.ts` · `channels/routing/messageRouter.ts` |
| B17 | `mcp -> tools` / `-> tool` | 1+1 | `mcp/MCPTool.ts` |
| B18 | `bridge -> workspaces` | 1 | `bridge/BridgeMain.ts` |
| B19 | `voice -> tools` | 1 | `voice/VoiceSession.ts` |
| | **合计** | **70** | |

**层归属**：`session`/`bridge`/`channels`/`services`/`voice`/`infrastructure`/`runtime`/`mcp` = **service**；`chat`/`ai`/`tools`/`agent`/`context`/`query`/`commands`/`plugins`/`workspaces`/`auto-reply` = **app**。

**根因分两类（决定手法）**

- **(a) 装配本体错层** —— `infrastructure/**`（19 条，B6-B10）：其自述即"**HTTP 服务层**"，但 handlers 的直接消费者是 **entry 的 HTTP 端点装配**（`LocalHTTPService` 注册路由）⇒ 与 **D-80** 判定的 `AppCoreOTelHelper` / `BootPipelineIntegrator`（"唯一调用方是 entry ⇒ 装配本体错层，搬 entry 即全消"）**同型**。⇒ **候选手法：物理归位 entry（或 `runtime/`→entry），而非端口化**。
- **(b) 真跨层依赖** —— 其余 51 条：service 模块**需要 app 业务能力**（压缩编排、AI 调用、工具/agent 装配、会话生命周期）⇒ 手法 = **core SPI 端口**（同 D-121 `IBroadcastService` / D-144 / D-155 技法）或 **DI 反转**；个别条目可能是"被依赖的 app 模块本就该在 service 层"（需逐条取证）。

---

## 2. 目标 / 非目标

**目标**：按子批 A→F 顺序消除 134 条，**每子批独立可交付、可回退**；`已豁免 151 → 17`。

**非目标**

- N1：**不改 `lint:arch` 判定**与 `allowedDependencies`；例外清单**不新增、不续期**（注：本轮已按 D-77 原则删除 4 个**空**桶，见 D-172）。
- N2：**不改既有 core SPI 契约的语义**（可**新增**端口，同 D-121/D-144/D-155 先例）；已完成的 `IHookChainPort`（D-168）不动。
- N3：**不处理其余 17 条**（`core -> app` 11 · `app -> entry` 3 · `service -> ui` 2 · `service -> entry` 1）——`core -> app` 涉 PDCA 编排链路，应单独立项。
- N4：不新增 HTTP/IPC 端点、不新增事件类型（除非子批内证实必须，且单列决策点）。
- N5：**不做"为消边而消边"的假拆分**（如把 UI 文件塞进一个"什么都装"的桶）——每个子批必须给出**归属依据**。

---

## 3. 设计（6 个子批，按"风险 × 改动量"递增）

### 执行台账（2026-10-01 复查，覆盖 §3.1–§3.6）

| 子批 | 范围 | 状态 | 已完成 | 剩余 |
|---|---|---|---:|---:|
| **A** `tools -> ink`（§3.1） | 47 | ✅ **已完成**（D-174） | 47 | **0** |
| **B** `app -> ui` 其余（§3.2） | 17 | 🟡 **部分完成**：B1 ✅（D-176，7）· B2 ✅（D-189，4，删孤儿组件）· B3 ✅（D-183/184，2） | 13 | **4**（`commands->ink` 1 · `buddy->components` 2 · `commands->ui` 1 ⇒ 均需**整模块拆 UI**） |
| **C** `infrastructure -> app`（§3.3） | 19 | 🟡 **部分完成**：`SandboxPermission` ✅（D-186，4）· **`tools` 域 4 条 ✅**（D-192/194/197/199 —— 静态边归零 🎯）· **`sandbox` 域值类 ✅**（D-200，2）· **`chat` 域 ✅**（D-201，3，**同批修缺陷**）· **`auto-reply` 域 ✅**（D-202，1）· **`agent` 域枚举/类型 ✅**（D-203，2，**下沉 `types/`**）· **A2A 对外面 ✅**（D-204，2，**下沉 `types/a2a` + 新增 `a2aPorts`**） | **18** | **1**（`session-handlers` 1 —— ⛔ **已判定与子批 F 同源**（改 `getSessionEvents({types})` 契约 + 规范 `Message` 模型）⇒ **移交子批 F / 数据契约专项**，见 D-204 末节） |
| **D** `service -> app` 低风险（§3.4） | ~~8~~ **实测 6** | ✅ **已完成（实测 6/6）**：⚠️ 原列 `mcp` 2 条实测不存在 ⇒ 实际 6 条全部收敛：`channels/registry`（D-205，1）· **`channels -> ai` 2 条**（D-206，2）· **`bridge -> workspaces`**（D-207，1）· **`voice -> tools`**（D-207，1）· **`channels/bootstrap`（EffectScope）**（D-207，1） | **6** | **0** |
| **E** `services -> app`（§3.5） | ~~20~~ **实测 19** | 🟡 **部分完成**：已完成 **6**（`mcp/MCPToolBridge.ts -> context` D-208；`ai` 组 (a) `DiagnosticsReport` D-212；(b) `compact/utils.ts` D-213（死导入）· `PromptAssembler.ts` D-214（端口化）；(c) **`SystemPromptReport.ts`** · **`CompactService.ts`** D-215）⇒ **`ai` 组 6 条全部清零** 🎯 · **`chat` 组 7 条清零** 🎯（D-216 死代码删除 3 · D-217 `compact` 改归 app 4）· **`tools` 组 1 条清零**（D-218 删零引用死文件）· **`workspaces` 组 1 条清零**（D-219 删死 barrel + 改直连）· **`commands` 组 1 条清零**（D-220 去假依赖：不透明载荷改 `unknown[]`）；⚠️ 余 3 条**全属**"规范数据模型"类且**硬阻**（`tools` 3 被 `Tool` 双份定义阻塞，见 D-218）⇒ E 组**静态可清部分已清零**，余项待**数据契约专项**收口 | **16** | **3**（`tools` 3（⛔ 受阻于 `Tool` 双份定义）） |
| **F** `session`+`runtime`（§3.6，最高风险） | 23 | 🟡 **部分完成**：**`session` 侧 16 条全清** 🎯（B12 ×2 · B13 ×2 · B14 ×1 · B11 ×11）；**`runtime` 侧已清 3 条**（B11 附带 `chat` ×1 · `query` ×1 · `agent` ×1）⇒ **实测余 5 条**：`CoreAPIImpl.ts` × tools / chat / ai / compaction（**4，均结构性必要**）＋ `CoreAPI.ts` × tools（**1，纯 type-only，待裁定**） | **19** | **5**（＝账面桶算 4 ＋「另计」的 `runtime -> compaction` 1） |

**门禁总账（实测）**：`已豁免` **151 → 28**（**−123**，实测值）= 子批 A 47 + 子批 B 13 + 子批 C **18** + 子批 D **6** + 子批 E **16**（D-208/212/213/214/215 六条 + D-216 死代码 3 + D-217 `compact` 改归 app 4 + D-218 死文件 1 + D-219 死 barrel 1 + D-220 去假依赖 1）+ 子批 F **19**（D-222 B12 −2 · B13 −1 · **B14 −1**（`45bf96ed8`）· **B11 本体 −10**（方案 2′ 拍平）· **B11 装配值端口化 −1** · **`runtime -> chat` −1**（B11 同批附带）· **`runtime -> query` −1**（`FileCheckpointStorage` 下沉 `session/storage/`）· **`runtime -> agent` −1**（尾批审计后动态化））+ **门禁正确性修正 6**（D-190，**非本次代码改动所致**），**另计 D-217 新增 1 条 `runtime -> compaction`**。⚠️ 各项为**分账记账**，±1 的归属以各 `D-*` 记录为准。
**例外清单**：**13 → 7 条**（清掉 5 个空桶 + 1 个空桶 `BULK-011`）。
**质量**：全程 `typecheck 0` · `lint:arch` 违规 0 · 改动文件 `eslint 0/0` · 无半成品残留。

**✅ 已完成（2026-10-01 D-200）**：`sandbox` 域**值类 2 条**（`handler-utils.ts` · `sandbox-handlers.ts`）—— 详见 §3.3 ② 的 D-200 记录 ⇒ **`已豁免 77 → 75`**（恰 −2）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动文件 eslint 0/0 · `bun test tests/http tests/sandbox` = **147 pass / 0 fail**。

**✅ 已完成（2026-10-01 D-201）**：`chat` 域**3 条**（`chat-handlers.ts` · `checkpoint-handlers.ts` · `file-upload-handlers.ts`）—— 详见 §3.3 ③ 的 D-201 记录 ⇒ **`已豁免 75 → 72`**（恰 −3）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动 3 文件 eslint 0/0（3 处 prettier 折行经 `--fix` 收口）· `bun test tests/http tests/chat` = **411 pass / 0 fail**。
**⚠️ 同批修复一个实测缺陷**（非单纯收敛）：两个 checkpoint POST 端点因"抛弃式 ChatManager ⇒ 空会话表"必然 500，详见 `dev_docs/error_repairs/预存错误与待处理问题.md` 末节。

**✅ 已完成（2026-10-01 D-202）**：`auto-reply` 域 **1 条**（`auto-reply-handlers.ts`，**相对路径边**）—— 详见 §3.3 ③ 的 D-202 记录 ⇒ **`已豁免 72 → 71`**（恰 −1）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 / `R02-002` **未新增** · 改动 3 文件 eslint 0/0（1 处 prettier 折行经 `--fix` 收口）· `bun test tests/http` = **76 pass / 0 fail**。
⚠️ 该域**新增 1 处动态跨层引用**（`runtime → auto-reply`）：R00-003 由 **29 → 30**（仅上报，不计违规 —— 与本批 `toolsPorts` 既有做法同性质）。

**✅ 已完成（2026-10-01 D-203）**：`agent` 域**枚举/类型 2 条**（`orchestration-handlers.ts` · `OrchestrationHistoryAdapter.ts`）—— 详见 §3.3 ③ 的 D-203 记录 ⇒ **`已豁免 71 → 69`**（恰 −2）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0（`@modules/types/*` 属规范子入口白名单）· 改动 6 文件 eslint 0/0 · `bun test tests/http tests/tools/AgentTool/toolCallEndStatus.test.ts` = **77 pass / 0 fail**。

**✅ 已完成（2026-10-01 D-204）**：**A2A 对外面 2 条**（`routes/a2a-routes.ts` · `routes/a2a-delegator.ts`）—— 详见 §3.3 ③ 的 D-204 记录 ⇒ **`已豁免 69 → 67`**（恰 −2）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 / `R02-002` **未新增** · 改动 6 文件 eslint 0/0（1 处 prettier 折行经 `--fix`）· `bun test tests/http` = **76 pass / 0 fail**（含 `a2aDelegator.test.ts`）。
⚠️ 新增 1 处动态跨层引用（`runtime → agent`）：R00-003 由 **30 → 31**（仅上报）。

**⛔ 子批 C 剩余 1 条已判定"不宜本批做"**：`session-handlers.ts` —— 见 D-204 末节的取证结论（与**子批 F** 同源，移交专项）。

**✅ 已完成（2026-10-01 D-205，子批 D 首条）**：`channels/registry/ChannelRegistry.ts` **1 条**（`channels -> context`：`dependencyRegistry` **早在 D-157 即下沉 core**，本文件未改低位取用 ⇒ 改**相对直连 core 模块根**）⇒ **`已豁免 67 → 66`**（恰 −1）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0。
**⚠️ 同批取证修正**：子批 D 原列 8 条中 **`mcp` 2 条实测不存在**（全量 grep 0 命中）⇒ **实测 6 条**；逐条处置见 §3.4 表（余 5 条各有**前置防线**，其中 `EffectScope` 若整体下沉会造成**净零收益** ⇒ 已记录为 §3.4 末的「先算净差，再动手」教训）。

**✅ 已完成（2026-10-01 D-206，子批 D）**：**`channels -> ai` 2 条**（`GatewaySessionTracer.ts` · `routing/messageRouter.ts`）—— **整文件下沉 core 模块根 + 原址转出**（`ai/telemetry/SessionSpanTracer.ts` → `core/SessionSpanTracer.ts`，`git mv` 保历史）⇒ **`已豁免 66 → 64`**（恰 −2）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动 4 文件 eslint 0/0 · `bun test tests/channels` = **109 pass / 0 fail**。
理由：该文件**零项目依赖**（仅 Node 内置 `crypto`）⇒ 层无关；落 **core 模块根**（`core/**` 子目录会触发 R03-002，见 D-157 同款说明）。**两条边必须同批**（类型位与值位同源）—— 本批一次拿下。

**✅ 已完成（2026-10-01 D-207，子批 D 收尾 3 条）**：**`bridge -> workspaces`** · **`voice -> tools`** · **`channels/bootstrap`（EffectScope）** ⇒ **`已豁免 64 → 61`**（恰 −3）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动 7 文件 eslint 0/0（5 处 prettier 折行经 `--fix`）· `bun test tests/channels tests/bridge tests/voice tests/utils` = **513 pass / 0 fail**。三条的**差异化手法**（各自最省）：
1. **`voice -> tools`** → **既有 sanctioned 门面**：`voice`(service) 取 `getCoreAPI().getToolManager()`（service→service 合法）。**零语义变更实证**：`CoreAPIImpl.ts:301` 为 `this.toolManager = options?.toolManager ?? globalToolManager` ⇒ **同一实例**（§1.16 亦如此记载）。
2. **`bridge -> workspaces`** → **新增服务层端口** `runtime/api/bridgePorts.ts`（`createWorktreeManager` + `pruneOrphanWorktrees`，返回值按调用方读取面**最小投影** `{ worktreePath }`）+ `CoreAPIImpl.getBridgePort()`（动态导入）。⚠️ 经核**未复用** `workspaceOpsPorts.ts`（该端口只覆盖"工作空间上下文/工作项存储"，与本处"worktree 隔离"**不同域** ⇒ CS01 另立）。
3. **`channels/bootstrap`（EffectScope）** → **改归 infra**（`context/EffectScope.ts` → `utils/EffectScope.ts`，`context/` 原址转出；同 D-157 手法）。**关键判据**：⚠️ **不可下沉 core** —— 该文件依赖 `@modules/error` + `@modules/monitoring`（infra），**实证 `app/src/core/**` 零 `@modules/monitoring|error` 导入** ⇒ 下沉 core 会新增 2 条 `core -> infra` 边（+2 抵消 −1 ⇒ **净变差**）；改归 **infra** 则其依赖变为 `infra -> infra`（合法）⇒ **真 −1**。

**✅ 已完成（2026-10-01 D-208，子批 E 首条）**：`services/mcp/MCPToolBridge.ts -> context`（1 条，`dependencyRegistry` 直连 core 模块根）⇒ **`已豁免 61 → 60`**（恰 −1）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动文件 eslint 0/0。
**⚠️ 同批取证（关键结构性发现）**：子批 E 全量实测 **19 条**（原列 20），其中 **11 条受"规范数据模型"阻塞**（`Message` 6 · `Tool` 类型 4 · `Command` 1）—— 与子批 C 余项**同一根因** ⇒ 建议**先立项"数据契约统一"专项**再回扫；本轮**不零敲**（避免逐文件端口化造成大量重复与反复）。详见 §3.5 表。

**⬅ 下一个未执行任务**：§3.5 之 **`ai` 组 (a)：`prompt/DiagnosticsReport.ts`（1 条）** —— `TiktokenEstimator.ts` **零 app 依赖** ⇒ **改归 infra**（同 D-207 `EffectScope` 手法）；⚠️ 不可落 core（会新增 `core -> infra` 边）。随后按 §3.5 的 (b)/(c) 递进。

**⚠️ 前置取证铁律（D-199/D-200/D-201 教训，三条）**：
1. **端口方法签名必须由实证而非推断决定** —— D-199 `getSpawnPauseState` 误判为 `boolean`，实证为**不透明状态对象** ⇒ 改 `unknown`。
2. **复用既有端口前必须逐条比对语义** —— D-200 `handler-utils` 的"默认工作区不存在 ⇒ 放行"与既有 `hasWorkspacePermission`（fail-closed）在该分支**取舍相反**，盲目复用会造成**真实行为回归**（上传路径鉴权从"放行"变"拒绝"）。
3. **收敛前先查"被取用对象的实例语义"** —— D-201 发现 `createChatManager()` 是**工厂（每次新实例）**而非单例，而 `_chatSessions` 是**实例级** Map ⇒ 原代码的 checkpoint 写端点**长期必失败**。若按"机械替换同等价"处理，就会把这个缺陷**固化**下来。

### 3.1 子批 A —— `tools -> ink` **47**（最大桶；混合模块拆分）

**现状**：`app/src/tools/**/UI.tsx` 型文件 47 个，直接 import `@modules/ink`（ui 层终端渲染）。

**首选手法：UI 归位** —— 把 47 个 `UI.tsx` 迁出 `tools`，归入 **ui 层**（候选落点：新建 ui 层模块 `toolViews/`，或并入既有 `components/`），`tools` 只保留**业务与渲染器注册契约**。

**✅ 前置取证已完成（2026-10-01，D-173 续）—— 结论：可行，且改动面远小于预期**

| 取证问题 | 实测结论 | 对方案的影响 |
|---|---|---|
| **消费方是谁** | **唯一消费者 = ui 层的 `components/ui/ToolUIRegistry.ts`** 的 `initDefaultToolUIRegistry()`，经 **`require('../../tools/<X>/UI')`** 逐个注册（CommonJS，**非** `from`/`import()`） | **搬迁零涟漪**：注册表本就在 ui 层，只改它的 ~20 条 `require` 路径 |
| **是否已有映射契约** | **有**：`ToolUIRenderer` 接口 + `registerToolUI(toolName, renderer)` + 两级查找（注册表 → 工具实例原生渲染方法） | 契约不变，仅换"渲染器从哪里来" |
| **有无非 UI 内容混入** | **有 4 处**：`tools/ReadMcpResourceTool/ReadMcpResourceTool.tsx` · `tools/ListMcpResourcesTool/ListMcpResourcesTool.tsx`（**工具实现本身内联 ink**）；`tools/search/GrepUI.tsx` · `tools/search/GlobUI.tsx`（命名变体） | 47 条 = **43 个 `tools/**/UI.tsx`** + 上述 4 处 ⇒ **必须分类处理，禁止整体搬迁** |

**手法细化（按四类）**

1. **43 个 `tools/**/UI.tsx`** ⇒ 迁入 ui 层；**落点优先 `components/ui/toolUIs/`（并入既有 ui 模块 `components`）** —— 理由：`components` **已是 ui 层** ⇒ **无需新增模块**，可免掉 D-164 踩过的"新模块须同时改 `tsconfig.json` paths + `modules-to-layers.json`"**三处同改**的坑。
2. **`ReadMcpResourceTool.tsx` / `ListMcpResourcesTool.tsx`**（工具实现内联 UI）⇒ 抽出 UI 到 ui 层、工具实现保留业务。⚠️ 属**文件拆分**，与 FSZ-* 专项重叠 ⇒ **先核行数是否超限**，超限则本子批只做"UI 抽离"的最小动作，不顺手重构。
3. **`search/GrepUI.tsx` / `search/GlobUI.tsx`** ⇒ 同第 1 类（纯 UI 命名变体）。
4. **`tools/AgentTool/agentDisplay.ts:7`** 的 `import type { AgentOutput } from './UI'` ⇒ 该 type 随 UI 归位后改指新路径（或把 `AgentOutput` 留在 `tools/AgentTool/types.ts` —— 倾向后者，因它是**工具输出类型**而非 UI 类型）。
5. **`ToolUIRegistry.initDefaultToolUIRegistry()`** 的 ~20 条 `require` 路径同步改指新位置。

**退路（若归位成本过高）**：**未启用**（实际改动面小于预期，见下）。

**✅ 执行结果（2026-10-01，D-174）—— `tools -> ink` **47 → 0**，子批 A 完成**

| 项 | 实测 |
|---|---|
| 搬迁 | `git mv` **41** 个 `tools/**/UI.tsx` → `components/ui/toolUIs/<Tool>/UI.tsx`（git 识别为 rename，历史保留） |
| 删除·**孤儿**（零引用） | **4** 个：`tools/search/GrepUI.tsx` · `tools/search/GlobUI.tsx` · `tools/ReadMcpResourceTool/UI.tsx` · `tools/ListMcpResourcesTool/UI.tsx`（全仓零引用，且注册表未 require） |
| 删除·**死代码** | `ReadMcpResourceTool.tsx` / `ListMcpResourcesTool.tsx` 的**内联 `render*` 方法 + `@modules/ink` 导入**。取证：渲染**唯一查找路径** = `components/ui/ChatMessage.tsx` 的 `getToolUI(toolName)`（**仅查注册表**），而 `read_mcp_resource` / `list_mcp_resources` **已在**注册表（来自 `toolUIs/MCPResourceTool/UI`）⇒ 内联实现**恒被遮蔽**；工具自带 render 的回退路径 `getToolUIWithFallback` **全仓零消费者** |
| 注册表 | `ToolUIRegistry.initDefaultToolUIRegistry()` 的 **41 条** `require` 路径统一由 `../../tools/` 改为 `./toolUIs/` |
| 类型归位 | `AgentDisplayOutput`（**显示投影**形状）由 UI 文件归位到 `tools/AgentTool/types.ts`（该文件是 `types` 段 ⇒ R03-002 豁免；UI 侧经 `@modules/tools/AgentTool/types` 引用）；另为 `ClipboardOutput` / `ImageEditOutput` 在 `tools/types/index.ts` **增设规范子入口再导出** |
| 门禁 | **`已豁免 151 → 104`**（**恰 −47**，`app -> ui` 64 → **17**）· 违规 **0** · `allFiles 3991 → 3987`（−4 删文件） |
| 静态/测试 | `typecheck` **0** · 改动文件 `eslint` **0/0** · `bun test tests/tools` = **575 pass / 0 fail** |

**⚠️ 过程中修正的两处（原计划未预见，均已实测确认）**

1. **相对路径规避不了 R03-002**：`ui -> app` 若用相对路径直指 `tools/<Tool>/<Tool>`（路径中**无 `types` 段**）仍被判"直插模块子目录"（实测 2 处违规）⇒ 必须改走**规范子入口** `@modules/tools/types`（`types` 段豁免）才合规。
2. **`AgentOutput` 同名不同形**：`tools/AgentTool/types.ts` **已有** `AgentOutput`（领域形状：`task_id`/`name`/`completed: boolean`），与 UI + `agentDisplay.ts` 需要的**显示投影形状**（`agentType`/`duration`/`tokenUsage`…）**并非同一类型** ⇒ **未强行合并**，而是新增 `AgentDisplayOutput` 并**同址单一来源**（避免 TNY-001 式"同名不同形"误用）。

**🔴 顺带发现（已登记，建议并入后续批次）**：新增 **R02-002 警告** —— `ToolSearchOutput` 在 **3 个模块**中定义（`components/ui/toolUIs/ToolSearchTool/UI.tsx` · `tools/ToolSearchTool/schemas.ts` · `tools/ToolSearchTool/ToolSearchTool.ts`）。**非本次引进**（重复定义原本就在），而是 **UI 文件迁出后门禁才看得见**（同模块内不判重复）⇒ 属"数据契约统一"议题。

### 3.2 子批 B —— `app -> ui` 其余 **17**（`knowledge`10 · `commands`4 · `buddy`2 · `docs`1）

> **⚠️ 2026-10-01 D-175 执行前取证结论：本子批**设计需更正**，原"UI 归位"一刀切**会反向增边** ⇒ 本子批暂未动手（**未改任何代码**）。**

**17 条逐条定位（实测）**

| 子项 | 文件 | 目标 |
|---|---|---|
| **B1**（7） | `knowledge/tools/Knowledge{Search,Write,Delete,Import,Export,Snapshots,Restore}Tool/UI.tsx` | `'../../../components/ink.js'` |
| **B2a**（3） | `knowledge/components/{KnowledgeDocList,KnowledgeQualityPanel,KnowledgeGraphAsciiView}.tsx` | `'../../components/ink.js'` + `'../../components/ui/{ProgressBar,Table}.js'` |
| **B2b**（2） | `buddy/{CompanionSprite.tsx,useBuddyNotification.tsx}` | `'../components/ink.js'` |
| **B2c**（2） | `commands/builtin/shared/CommandUI.tsx` · `commands/builtin/status/StatusUI.tsx` | `'@modules/ink'` |
| **B3**（3） | `commands/tools/remote/remote-session.ts` · `commands/builtin/theme/Theme.ts` · `docs/HelpSystem.ts` | `'@modules/ui'` / `'../ui/*'`（`TerminalUIIntegration` · `TerminalComponents` · `ThemeManager` · `KeyboardShortcuts`） |

**三类阻碍（决定不能一刀切）**

1. **B1 可行但非零成本**：7 个文件的**唯一消费方 = `ToolUIRegistry`**（零涟漪 ✓），但除 ink 外还依赖同模块的 **`parseToolOutput`（函数）**，而该函数**无任何规范出口**（未被任何 barrel 转出）⇒ 迁出后若用 `@modules/knowledge/tools/parseToolOutput`（无 `types` 段）会触发 **R03-002**。⇒ **须先决策其归属**（随迁到 ui 侧 / 移入 `utils/` / 增设规范出口），再动 B1。
2. **B2 会反向增边（必须改设计）**：`CommandUI.tsx` 被 `commands/builtin/*/` 下**大量 `*UI.tsx` 消费**（WorkspaceUI/VoiceUI/VimUI/VersionUI/UsageUI/UpgradeUI/TutorialUI/ToolUI…）；`CompanionSprite.tsx` / `useBuddyNotification.tsx` 经 **`buddy/index.ts` 对外转出**（`app/docs/API.md:1506-1609` 有公开用法）⇒ **它们是模块公共 API**，朴素搬迁会**为每个消费方新增一条 `app -> ui` 边**（`app -> ui` 反而变多）。治本 = **整个混合模块拆 UI**（同子批 A 对 `tools` 的手法，但 `commands/**/*UI.tsx` 规模更大）⇒ **须单独立项评估**。
3. **B3 不是"搬文件"问题**：这 3 个是**非 UI 的实现文件**，依赖的是 ui 层的**能力**（`ThemeManager` 等）⇒ 手法应是"**判断这些能力是否错层**"（若 `ThemeManager`/`KeyboardShortcuts` 本质是无 UI 依赖的工具，应下沉 infra/utils）或**端口化**，而非归位文件。

**更正后的建议拆分**：`B1`（7 条，先定 `parseToolOutput` 归属）→ `B2`（混合模块拆分专项，需先清点 `commands/**/*UI.tsx` 全量）→ `B3`（3 条，逐条判错层/端口化）。

**✅ B2 已消除 4 条（2026-10-01 D-189）—— 手法：删孤儿 UI 组件（0 消费者即死代码）**

- **取证（全仓 grep，含 barrel 转出与 `require`/动态引用形态）**：以下 **4 个 UI 组件全仓零消费者**（仅自身定义/头注释命中）⇒ 按 CS01/CS05 **判为死代码删除**：
  | 文件 | 原属边 |
  |---|---|
  | `knowledge/components/KnowledgeDocList.tsx` | `knowledge -> components` |
  | `knowledge/components/KnowledgeQualityPanel.tsx` | 同上 |
  | `knowledge/components/KnowledgeGraphAsciiView.tsx` | 同上 |
  | `commands/builtin/status/StatusUI.tsx` | `commands -> ink` |
- **验收（与预测逐数吻合）**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 91 → 87`（恰 −4）** · `allFiles 3986 → 3982`（−4）。
- **剩余 4 条（须"整模块拆 UI"，不在本轮）**：`commands -> ink` 1（`commands/builtin/shared/CommandUI.tsx`，被 `commands/builtin/*/*UI.tsx` **大量消费**）· `buddy -> components` 2（`CompanionSprite`/`useBuddyNotification` 经 **`buddy/index.ts` 对外转出**，`app/docs/API.md:1506-1609` 有公开用法）⇒ 二者的搬迁会**为每个消费方新增 `app -> ui` 边**，治本 = 像子批 A 对 `tools` 那样**整模块拆 UI（全量清点后一次迁移）**。

**✅ B1 已完成（2026-10-01，D-176）—— 7 条消除，`app -> ui` **17 → 10****

- **决策（用户批准）**：`parseToolOutput` **随 7 个渲染器一并归位 ui 层** —— 其自述即"**知识工具 UI 渲染器的统一解析入口**"（纯自包含、零 import），且**唯一消费者就是这 7 个文件** ⇒ 既零新增出口、又零新增边。
- **改动**：`git mv` **7** 个 `knowledge/tools/Knowledge*Tool/UI.tsx` + **1** 个 `parseToolOutput.ts`（→ `components/ui/toolUIs/knowledge/parseToolOutput.ts`）；`ToolUIRegistry` 7 条 `require` 改 `./toolUIs/`；7 个渲染器的导入改为 `@modules/ink` + `../knowledge/parseToolOutput`（**同模块**，不计边）+ 领域类型经 `@modules/knowledge/tools/types`（`types` 段 ⇒ R03-002 豁免）；同步更正 `knowledge/tools/CONTRIBUTING.md` 的旧路径指引。
- **验收**：`typecheck` **0** · `lint:arch` **违规 0** / **`已豁免 104 → 97`（恰 −7）** · R03-002 = **0** · 改动文件 `eslint` **0/0** · `bun test tests/tools` = **575 pass / 0 fail**。
- **现状**：`app -> ui` **17 → 10**（余 B2a 3 · B2b 2 · B2c 2 · B3 3）；全局 `已豁免 97`。

---

#### 3.2.1 B3 判断结论（2026-10-01，D-177）—— **不可"下沉纯工具"了事，须先统一实现**

**逐文件判断（实测）**

| 文件 | 依赖 | 判断 | 结论 |
|---|---|---|---|
| `docs/HelpSystem.ts` | `'../ui/KeyboardShortcuts'` + `'../ui/ThemeManager'` | `KeyboardShortcuts` **零 import ⇒ 纯工具**（仅此 1 个消费者）；`ThemeManager` ⇒ 见下 | ⚠️ **单独下沉 `KeyboardShortcuts` 不减计数**（同文件仍 import ui 的 `ThemeManager`；门禁按「文件 × 去重目标模块」计） |
| `commands/builtin/theme/Theme.ts` | `@modules/ui` → `ThemeManager` | **三轨重复实现** | 🔴 **阻断** |
| `commands/tools/remote/remote-session.ts` | `@modules/ui` → `TerminalUIIntegration` · `TerminalComponents` | 真 UI 能力 | ⏸ 需端口化或把该文件归位，另行设计 |

**🔴 核心发现：`ThemeManager` 三轨重复实现（CS01 违规，且 ui 侧自相矛盾）**

| # | 位置 | 层 | 消费方 |
|---|---|---|---|
| 1 | `core/theme.ts:195`（`class ThemeManager` + `getThemeManager()`） | core | —（未见到活消费者） |
| 2 | `ui/ThemeManager.ts:141`（`class ThemeManager`.getInstance）+ `ui/index.ts:27` **转出** | ui | `ui/theme/ThemeContext.tsx:28` · `commands/builtin/theme/Theme.ts:8`（经 `@modules/ui` 桶）· `docs/HelpSystem.ts:8` |
| 3 | `system/theme/ThemeManager.ts:34` + `getThemeManager()` | **infra** | `ui/UIEnhancer.ts:7` · `cli/index.ts:47`（均经 `@modules/system/theme`） |

⚠️ **同一 ui 模块内部就用了两个不同实现**（`UIEnhancer` → `system/theme`，`commands/builtin/theme` → `ui/ThemeManager`）⇒ 这 2 条边**不是"位置错了"，而是"有两份实现"**：搬文件只会把重复实现换个层继续存在（**违 CS01**）。

**⇒ B3 重新拆分（替代原"沉纯工具"方案）**

- **B3-1（前置，必须先行）：统一 `ThemeManager`** —— 先判 canonical（倾向 `system/theme`：它是 infra、已含 `getThemeManager()`、且被 `UIEnhancer`/`cli` 使用）⇒ 迁移 `ui/ThemeManager.ts` 的消费者到 canonical、删除重复、`ui/index.ts` 停止转出。**解开 `docs -> ui` 与 `commands -> ui` 中的 2 条**。
- **B3-2（随 B3-1 同批）：`KeyboardShortcuts` 下沉** —— 它是纯工具（零 import、唯一消费者 `docs/HelpSystem.ts`）⇒ 归位 `utils/`；但**必须与 B3-1 同批**，否则不减计数（见上表）。
- **B3-3（独立）：`remote-session.ts`** —— 依赖 `TerminalUIIntegration`/`TerminalComponents`（真 UI）⇒ 端口化或把"远程会话的命令侧"归位，需单独设计。


- `knowledge/components/*.tsx`（10）与 `buddy` 的 2 个 `.tsx`：同 A（UI 归位）。
- `commands -> ink`(2) / `commands -> ui`(2)：`CommandUI.tsx` / `StatusUI.tsx` 归位；`theme/Theme.ts`、`tools/remote/remote-session.ts` 需**先判**是 UI 还是误报/类型位。
- `docs -> ui`(1)：`docs/HelpSystem.ts`（**1106 行**，已挂 FSZ-048 超限例外）⇒ **先取证**其 UI 部分占比；若 UI 与数据强耦合，可拆出 `help/ui/` 子域归 ui 层，**不得**因消边而制造 2000 行巨型文件。

**验收**：`app -> ui` 桶清零（64 → 0）；`docs`/`commands`/`knowledge`/`buddy` 在 R00-001 的 `app -> ui` 方向归零。

### 3.3 子批 C —— `infrastructure -> app` **19**（装配本体错层）

**⚠️ 2026-10-01 D-185 取证结论：原「装配本体错层 ⇒ 归位 entry」的假设被推翻，手法更正为「端口化」**

- **实测消费者（`app/src` 全量 grep）**：`infrastructure/http/handlers/**` 的直接消费者 = **同模块的 HTTP 装配本体** —— `infrastructure/http/LocalHTTPService.ts:20,27,29,31`（`analytics-handlers` · `handler-utils` · `route-table` · `routes/a2a-delegator`）· `LocalHTTPServiceHelpers.ts:12` · `handlers/routes/*`（`knowledge-routes.ts` 内 8 处动态导入同层 handler）。**不是 entry**。
- **⇒ 原方案（物理归位 entry）会制造新倒挂**：`LocalHTTPService`（**service**）将变成依赖 **entry** ⇒ `service -> entry` 违规 ✗。D-80 的"装配本体错层"判定**不适用于此**（D-80 的对象的唯一调用方确为 entry；此处不是）。
- **✅ 正确手法：端口化 —— 且仓库已有 4 个同型先例可直接照抄**（service 侧定义端口 → app 侧在 `runtime/api/` 注入实现）：
  | 既有端口文件 | 其注释记录的治理对象 |
  |---|---|
  | `runtime/api/toolsPorts.ts` | "`infrastructure/http/handlers/` 下 **4 个文件**动态导入 app 层 `@modules/tools`" |
  | `runtime/api/pluginAdminPorts.ts` | "`infrastructure/http/handlers/` 下 3 个文件共 **13 处**动态导入 app 层" |
  | `runtime/api/thirdPartySkillPorts.ts` | `skills-handlers.ts` 原先直接动态导入 app 层 |
  | `runtime/api/skillsOpsPorts.ts` | 同上（skills 域） |
  ⇒ 本子批**沿用该模式**：为 19 条静态边各自的**app 能力**（`chat` · `tools` · `agent` · `sandbox` · `auto-reply`）新增/扩充端口，handler 侧只依赖端口。**不移动任何文件**（避免与 FSZ-* 超限例外纠缠）。

**📋 19 条逐条定位（2026-10-01 D-186 实测）与**分型设计****

| 域 | 条数 | 文件 → 行 | 被导入符号 | 分型 |
|---|---:|---|---|---|
| `chat` | 4 | `chat-handlers.ts:42` | `eventNotificationService` | 值 |
| | | `checkpoint-handlers.ts:34` | `createChatManager` | 值 |
| | | `file-upload-handlers.ts:30` | `createChatManager` | 值 |
| | | `session-handlers.ts:27-30` | `Message`·`MessageRole`·`LiriEventType`（**类型/枚举**）+ `dedupeMessagesToolCallBlocks` | 混合 |
| `sandbox` | 6 | `LocalHTTPService.ts:28` | `SandboxPermission` | **枚举** |
| | | `knowledge-handlers.ts:13` | `SandboxPermission` | **枚举** |
| | | `file-upload-handlers.ts:31` | `SandboxPermission` | **枚举** |
| | | `memory-handlers.ts:15` | `SandboxPermission` | **枚举** |
| | | `handler-utils.ts:40-41` | `globalWorkspaceManager` + `SandboxPermission` | 混合 |
| | | `sandbox-handlers.ts:37-40` | `SandboxManager`·`processRegistry`·`resourceLimitManager`·`globalWorkspaceManager` | 值 |
| `tools` | 4 | `agent-role-handlers.ts:18` | `refreshAvailableSubagentTypeNames` | 值 |
| | | `agent-control-handlers.ts:21` | （多行 import） | 值 |
| | | `media-template-handlers.ts:14` | `getMediaTemplates` | 值 |
| | | `video-task-handlers.ts:16-17` | `getVideoTaskPersistence` + `ToolUseContext`(**type**) | 混合 |
| `agent` | 4 | `orchestration-handlers.ts:21-23` | `OrchestrationSnapshot`(**type**)·`OrchestrationEventType`·`AgentEventType` | **枚举/类型** |
| | | `OrchestrationHistoryAdapter.ts:16-17` | `OrchestrationEventType`·`AgentEventType` | **枚举** |
| | | `routes/a2a-delegator.ts:15` | `getAgentRegistry` | 值 |
| | | `routes/a2a-routes.ts:40` | （多行 import） | 值 |
| `auto-reply` | 1 | `auto-reply-handlers.ts:36` | **相对** `'../../../auto-reply'`（⚠️ 非别名形式，静态清单易漏） | 值 |

**分型处置（比"一律建端口"省得多，且复用既有设施）**

1. **枚举/类型类（约 8 条：`SandboxPermission`×4 · `Orchestration*`/`AgentEventType`×2 · `session-handlers` 的类型位）** ⇒ 复用 **D-163/D-167 手法**：把纯枚举/类型**下沉 core 叶子**（或经 `types` 子入口），原址转出以免涟漪。**不新建端口**。
2. **`sandbox` 值类 2 条** ⇒ **扩充既有 `core/spi/SandboxService.ts` 的 `ISandboxPort`**（D-154 已建：`shouldUseSandbox`/`isSandboxingEnabled`/`updateSettings`/`hasWorkspacePermission`）—— 按 CS01 复用，**不另立端口**。
3. **`tools` 值类 4 条** ⇒ **扩充既有 `runtime/api/toolsPorts.ts`**（其注释即记录治理过 handlers 的同类依赖）。
4. **`chat` 值类 3 条 + `agent` 值类 2 条 + `auto-reply` 1 条** ⇒ 新增 3 个端口（`chatPorts` · `agentPorts` · `autoReplyPorts`），照抄 `pluginAdminPorts.ts` 模式。
5. **`agent` 的 `getAgentRegistry`** 与 **`a2a-routes.ts`** ⇒ 属 A2A 对外面，需单独核 `getAgentRegistry` 是否已有端口（`runtime/api/` 下可能已有 agent 相关端口）。

**执行顺序建议（按"改动量÷收益"）**：① 枚举/类型下沉（~8 条，纯类型搬运，风险最低）→ ② 扩充 2 个既有端口（`ISandboxPort` · `toolsPorts`，6 条）→ ③ 新增 3 个端口（6 条）。
**进度（截至 D-204）**：① **已完成 6 条**（`SandboxPermission` 4 条 D-186 + **`AgentEventType`/`OrchestrationSnapshot` 2 条** D-203）· ② **`toolsPorts` 4 条 ✅**（D-192/194/197/199）+ **`ISandboxPort` 2 条 ✅**（D-200）⇒ 第 ② 步**全部完成** · ③ **`chat` 域 3 条 ✅**（D-201）+ **`auto-reply` 域 1 条 ✅**（D-202）· **A2A 对外面 2 条 ✅**（D-204，**下沉 `types/a2a` + 新增 `a2aPorts`**）⇒ **子批 C 实质收束 18/19**；剩 `session-handlers` 1 条已判定**移交子批 F / 数据契约专项**（见 D-204 末节）。

**✅ 第一步已完成（2026-10-01 D-186）：`SandboxPermission` 4 条 —— 零成本手法**

- **发现（取证）**：`SandboxPermission` **早已是 core 叶子**（`core/sandboxPermission.ts:22 export enum`），且**仓库已有现成先例**：`permission/PermissionService.ts:36` 以**相对路径直连 `'../core/sandboxPermission.js'`**。
- **手法（比端口化更省）**：把 4 个 handler 的 `@modules/sandbox`（app 层）改为 **相对直连 core 模块根** —— `LocalHTTPService.ts:31` · `knowledge-handlers.ts:14` · `file-upload-handlers.ts:32` · `memory-handlers.ts:16`。**零新文件、零白名单、零端口**。
- **验收（与预测逐数吻合）**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 95 → 91`（恰 −4）** · **`R03-002` = 0**（**实证：core 的「模块根文件」相对路径不触发 R03-002** —— 与子批 A 踩到的「模块**子目录**文件」不同）· 改动文件 `eslint` **0/0** · `bun test tests/http tests/infrastructure tests/memory` = **162 pass / 0 fail**。
- **未改**（**D-186 时点**）：`handler-utils.ts`（它同时 import `globalWorkspaceManager`(值) ⇒ 改枚举**不减计数**）· `sandbox-handlers.ts`（纯值 ⇒ 需端口，归第 ② 步）—— **二者已于 D-200 完成，见下**。
- **剩余 15 条**（**D-186 时点**）：`chat` 4 · `sandbox` 2（值）· `tools` 4 · `agent` 4 · `auto-reply` 1 ⇒ 按上文 ②③ 步继续。
  - **📊 更新（截至 D-199）**：`tools` **4 条已全部完成**（D-192 / D-194 / D-197 / D-199 —— **静态边归零** 🎯）⇒ 本子批**剩余 11 条**：`sandbox` 2（值，⬅**下一个**）· `chat` 3 · `auto-reply` 1 · `agent` 2（建议并入"数据契约统一"专项）· 其余按 §3.3 分型表。
  - **📊 更新（截至 D-200）**：`sandbox` **2 条值类已完成** ⇒ 本子批**剩余 9 条**：`chat` 3（⬅**下一个**）· `auto-reply` 1 · `agent` 2 · 其余按 §3.3 分型表。
  - **📊 更新（截至 D-201）**：`chat` **3 条已完成** ⇒ 本子批**剩余 6 条**：`auto-reply` 1（⬅**下一个**）· `agent` 2 · 其余按 §3.3 分型表。
  - **📊 更新（截至 D-202）**：`auto-reply` **1 条已完成** ⇒ 本子批**剩余 5 条**：`agent` 2（⬅**下一个**，建议并入"数据契约统一"专项）· 其余按 §3.3 分型表。
  - **📊 更新（截至 D-203）**：`agent` 域**枚举/类型 2 条已完成**（下沉 `types/`）⇒ 本子批**剩余 3 条**：`session-handlers` 1（⬅**下一个**）· `routes/a2a-delegator.ts` · `routes/a2a-routes.ts`。
  - **📊 更新（截至 D-204）**：**A2A 对外面 2 条已完成** ⇒ 本子批**剩余 1 条**（`session-handlers`，**经取证判定移交子批 F / 数据契约专项**）⇒ **子批 C 记 18/19 实质收束**。

**✅ 第二步已完成（2026-10-01 D-200）：`sandbox` 值类 2 条 —— 复用既有 core SPI 端口**

**取证（本轮实测，非推断）**：
- `sandbox-handlers.ts:37-40`：4 个**值**符号（`SandboxManager` · `processRegistry` · `resourceLimitManager` · `globalWorkspaceManager`），全部只服务于 `GET /v1/sandbox/status` 的**一段快照**（`getSettings()`/`getConstraints()`/`getViolations().length`/`getStats()`/`getSummary()`/`list().size`）⇒ 可**整体投影为 1 个方法**，无需逐符号建端口。
- `handler-utils.ts:40-41`：枚举 `SandboxPermission`（**仅类型位**，2 处签名）+ 值 `globalWorkspaceManager`（1 处 `get('default')?.hasPermission()`）。
- 🔴 **关键取证（决定了不可朴素复用）**：全仓**无 `create('default')`** ⇒ `get('default')` 恒为 `undefined` ⇒ `handler-utils` 的**「工作区不存在 ⇒ 放行」是实际生效分支**，而既有 `hasWorkspacePermission` 在该分支返回 `false`（fail-closed）⇒ **二者语义相反，复用会造成上传鉴权行为回归**。

**改动（加性两步，各自树绿）**：
1. **端口先就绪**（树绿、计数不变 `77`）：
   - `core/spi/SandboxService.ts`：新增 `SandboxRuntimeStatus`（**最小投影**，子字段 `unknown` 原样进 JSON）+ 两个方法 `isWorkspacePermissionDenied()`（含与 `hasWorkspacePermission` 的**三态对照表**说明）· `getRuntimeStatus()`；代理补默认值（未注册 ⇒ `false` / `_EMPTY_RUNTIME_STATUS` 空对象语义）。
   - `entrypoints/spiWiring.ts`：注册实现（组合根**动态**导入，池内补 `processRegistry` · `resourceLimitManager`）。
2. **调用点切换**（计数 `77 → 75`）：
   - `handler-utils.ts`：枚举 ⇒ `import type { SandboxPermission } from '../../../core/sandboxPermission.js'`（相对直连 core 叶子，同 D-186）；值 ⇒ `resolveSandbox().isWorkspacePermissionDenied(permission)`；`import { resolveSandbox } from '@modules/core/spi'`（服务层 → core 为**下行**，合法）。
   - `sandbox-handlers.ts`：4 个值符号 ⇒ `resolveSandbox().getRuntimeStatus()`；JSON 字段**逐个显式展开**（不用 `...spread`）⇒ 键序与响应形状与改前**逐字段一致**。

**验收（与预测逐数吻合）**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 77 → 75`（恰 −2）** / `R03-002` **0**（`@modules/core/spi` 属规范子入口白名单）· 改动 4 文件 eslint **0/0** · `bun test tests/http tests/sandbox` = **147 pass / 0 fail**。

**手法要点（可复用到 `chat`/`agent`/`auto-reply` 域）**：① **一个"取用面"⇒ 一个投影方法**（`getRuntimeStatus()`），而不是"一个符号 ⇒ 一个 getter"；② 只对 handler **真正读取字段**的对象建投影，纯透传值用 `unknown`（同 D-199 `AgentRunDto` 与 `getActiveAgents()` 的分界）；③ **复用既有端口前必须比对语义**（本条的 `isWorkspacePermissionDenied` 与 `hasWorkspacePermission` 是**两个方向**，故必须新增方法而非复用）。

**✅ 第三步已完成（2026-10-01 D-201）：`chat` 域 3 条 —— 改走既有 `CoreAPI` 门面（**推翻本表 ③ 的"新增 `chatPorts`"预案**）**

**取证（本轮实测）**：

| 文件 | 原导入 | 调用面 |
|---|---|---|
| `chat-handlers.ts:42` | `eventNotificationService`（值） | **9 处** `.on()` / `.off()`（注册/注销 SSE 分发回调） |
| `checkpoint-handlers.ts:34` | `createChatManager`（值） | **6 处** —— 覆盖 6 个端点（5 写 1 读） |
| `file-upload-handlers.ts:30` | `createChatManager`（值） | **1 处**（文件内容送 AI） |

**🔴 取证关键（决定了"零端口新增"与"同批修缺陷"）**：
1. **既有的 sanctioned 缝已存在**：`runtime/api/CoreAPI.ts:394-397` 明确记载 `CoreAPIImpl` 是"本仓既有 sanctioned `service → app` 缝，如 `chatManager` / `chat()`"；`getCoreAPI(): CoreAPIImpl`（具体类）已暴露 `getChatManager()`（`:4865`）。同层 `chat-handlers.ts` 早已用 `getCoreAPI().chatManager?.abortSessionStream()`。
   ⇒ **无需新建 `chatPorts`**（③ 原预案作废）：直接经门面取用，**改动更小、且不新增任何文件/类型**。
2. **`eventNotificationService` 是模块级单例**（`EventNotificationService.getInstance()`，`chat/services/EventNotificationService.ts:295`；`ChatManager.getEventNotificationService()` 原样转发同一实例，`ChatManager.ts:6632-6633`）⇒ 改经门面 **语义零变更**。
3. **`createChatManager()` 是工厂而非单例**（`new ChatManagerImpl()`，`ChatManager.ts:6955-6957`），而 `_chatSessions` 是**实例级** Map（`:406`）⇒ 原 checkpoint 写端点**必然抛 `AppError 'Session not found' (1004)`**（`ResumeCoordinator.ts:73-86`），rollback 亦只落盘不恢复活跃会话；`file-upload` 的送 AI 落在**新建会话**。
   ⇒ 该处**不能按"机械等价替换"处理**，否则会把缺陷固化（已按用户裁定：**改共享实例 + 同批修缺陷**）。

**改动（3 文件，均是"取用面替换"，无新增端口文件）**：
- `chat-handlers.ts`：删静态导入 → 新增模块级 helper `getEventNotificationService()`（`getCoreAPI().getChatManager().getEventNotificationService()`），9 处调用点经它取用（**语义零变更**）。
- `checkpoint-handlers.ts`：删静态导入 → `getCoreAPI().getChatManager()`（6 处），**行为变更**：检查点真正作用于**活跃会话**。
- `file-upload-handlers.ts`：删静态导入 → 同法（1 处），**行为变更**：文件内容发往**当前活跃会话**。

**验收**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 75 → 72`（恰 −3）** / `R03-002` **0** · 改动 3 文件 eslint **0/0**（首轮 3 处 `prettier` 折行，经 `bun x eslint --fix` 收口，纯格式）· `bun test tests/http tests/chat` = **411 pass / 0 fail**。

**⚠️ 遗留（独立议题，已记入 `预存错误与待处理问题.md`）**：这 6 个 checkpoint 端点**无任何测试覆盖** ⇒ 上述缺陷长期静默；建议补 `tests/http` 用例。

**手法要点（补充第 ④ 条，供 `auto-reply` 域复用）**：**先查"是否已有 sanctioned 取用缝"，再决定是否新建端口** —— 本表 ③ 原预案（新增 `chatPorts`）在取证后**被推翻**：既有 `CoreAPI` 门面已满足"handler 只依赖 service 层"，新增端口反而是多余抽象（PY_APP §2 简洁优先 + CS01 归一化）。

**✅ 第四步已完成（2026-10-01 D-202）：`auto-reply` 域 1 条 —— 新增 `autoReplyPorts`（照 ③ 原预案）**

**取证（本轮实测）**：
- `auto-reply-handlers.ts:32-36` 原以**相对路径** `'../../../auto-reply'` 静态导入 `autoReplyEngine`（值）+ `ReplyRule` / `StoredPattern`（类型）——⚠️ **相对路径形式**（非 `@modules/*` 别名），是本子批**唯一**这种形态的边。
- 调用面 **5 处**：`getAllRules()` · `getStats()` · `registerRule(rule)` · `updateRule(id, updates)` · `deleteRule(id)`（**全同步**）。
- ✅ **全仓只有这一个消费者**：`AutoReplyEngine` / `autoReplyEngine` 除模块自身外**无其他引用**（连 `channels` 也没有）⇒ 无第三处取用面。
- ⚠️ **模块无 `@modules/*` 别名**（`tsconfig.json` 为**逐模块显式声明**，无 `@modules/*` 通配）⇒ 端口实现内只能用**相对路径**动态导入（`src/runtime/api/` → `../../auto-reply/index.js`）。
- ❌ **未采用"物理归位/改层映射"**（曾评估）：把 `src/auto-reply/` 移入 service 层虽可零端口消边，但连带 `modules-to-layers.json` · `dependency-snapshot.json`（pre-commit 有快照一致性校验）· `LazyModuleStrategy` 模块名清单 ⇒ **为一对边承担模块级迁移风险**，不划算（且属"改配置消违规"的解释空间）。

**改动（1 新文件 + 2 文件）**：
- **新建** `runtime/api/autoReplyPorts.ts`：`AutoReplyRuleDto`（**最小投影**，结构镜像自 `ReplyRule` 但**用不同导出名** ⇒ 不触发 R02-002）· `AutoReplyRuleInput`（`Omit<…,'id'>`）· `AutoReplyPort`（5 方法，1:1 对齐调用面）。
  - ⚠️ `response` 字段用 `unknown`：端口**不引 app 类型**，且 `strictFunctionTypes` 下"参数 `unknown` 的函数类型"与 app 层 `(ctx: ReplyContext) => …` **逆变不兼容** ⇒ 如实承载为不透明值（同 D-200 `getRuntimeStatus()` 子字段用 `unknown` 的分界）。实测 `unknown` 同时满足 `ReplyRule → DTO` 的结构赋值，`getAllRules()` **无需断言**。
- `runtime/api/CoreAPIImpl.ts`：新增 `getAutoReplyPort()`（动态导入 app 模块，仅 R00-003 可见）+ 端口类型导入；边界两处 `as never` 收窄（`registerRule` / `updateRule` 入参，同 D-154 SPI 先例）。
- `infrastructure/http/handlers/auto-reply-handlers.ts`：删相对导入 → `await getCoreAPI().getAutoReplyPort()`（4 个 handler 各 1 次）；`serializeRule` 形参改 DTO；`parsePattern` 的 `StoredPattern` 改**就地边界结构** `PatternPayload`（**有意不复用端口 DTO** —— 该结构只在此处消费，且为外部 JSON 校验）。**响应形状/状态码/错误文案逐字不变**。

**验收**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 72 → 71`（恰 −1）** / `R03-002` **0** / `R02-002` **未新增** · 改动 3 文件 eslint **0/0**（1 处 prettier 折行经 `--fix`）· `bun test tests/http` = **76 pass / 0 fail**。

**⚠️ 连带影响（如实记录）**：`R00-003` 动态跨层引用 **29 → 30**（新增 `runtime → auto-reply`）—— 与本批 `toolsPorts`（`runtime → tools`）**同性质**：静态边消除的代价是动态边增加 1 处，仅 warning 级上报、不计违规。

**⚠️ 测试盲区（本轮发现，未处理）**：全仓 grep `AutoReplyEngine|autoReplyEngine|auto-reply` 于 `*.test.ts` ⇒ **0 命中** ⇒ 本域 4 个端点**无任何用例覆盖**。本批为**行为保持型**改动（响应逐字不变）故风险可控；建议后续补 `tests/http` 用例。

**✅ 第五步已完成（2026-10-01 D-203）：`agent` 域枚举/类型 2 条 —— 下沉 core `types/`（D-67 手法）**

**取证（本轮实测）**：
- `orchestration-handlers.ts:21-23`：3 符号**同源**自 `@modules/agent`（`OrchestrationSnapshot`(type) · `OrchestrationEventType` · `AgentEventType`）⇒ 按"文件 × 去重目标模块"计 **1 条边**。
- `OrchestrationHistoryAdapter.ts:16-17`：2 符号（`OrchestrationEventType` · `AgentEventType`）⇒ **1 条边**。
- 三个定义的落点：`OrchestrationEventType` **早在 D-67 已下沉** `types/orchestrationEvents.ts`（app 层只是转出）⇒ 本批只需改这 2 个文件的取用面；`AgentEventType`（enum，`agent/events/types.ts:61-135`）与 `OrchestrationSnapshot` + `OrchestrationStatus`（纯类型，`agent/events/OrchestrationEvents.ts:439-480`）**无低位出口** ⇒ 须先下沉。
- ✅ **下沉安全性实证**：`OrchestrationSnapshot` 仅引用**同文件内**的 `OrchestrationStatus`（字符串联合）；`AgentEventType` 为纯 enum ⇒ **零出向依赖**，满足 `types` 模块约束（`modules-to-layers.json:86`："纯类型、无出向依赖；归 core 后各层引用自动合法"）。
- ✅ `@modules/types/*` 别名存在（`tsconfig.json:144-145`），且路径含 **`types` 段 ⇒ R03-002 豁免**（实测 R03-002 = 0）。

**改动（2 新建 + 2 原址转出 + 2 改取用面）**：
- **新建** `types/agentEvents.ts`：`AgentEventType` 枚举**逐字搬迁**（含成员注释）。
- **新建** `types/orchestrationSnapshot.ts`：`OrchestrationStatus` + `OrchestrationSnapshot` 逐字搬迁。
- `agent/events/types.ts` · `agent/events/OrchestrationEvents.ts`：定义体改为 **`export { … } from '@modules/types/…'` 原址转出**（对外导出名与形状**逐字不变**）⇒ app 层其余消费方（`agent/index.ts:271` · `tools/AgentTool/SubAgentEngine.ts:39` · `agent/events/SSEEncoder.ts:7` · `agent/events/index.ts:41`）**零改动**。
- 2 个 handler：`@modules/agent` 静态导入**完全消失**（3 处 / 2 处改为 `@modules/types/*`）。

**验收**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 71 → 69`（恰 −2）** / `R03-002` **0** / `R02-002` **未新增** · 改动 6 文件 eslint **0/0** · `bun test tests/http tests/tools/AgentTool/toolCallEndStatus.test.ts` = **77 pass / 0 fail**（含唯一直引 `AgentEventType` 的测试文件）。

**手法要点（补充第 ⑤ 条）**：**"下沉定义 + 原址转出"是本类边的零风险手法** —— 只把**名字/形状**搬下去、原址保留同名导出，则 app 层其余消费方**无需任何改动**（本批 4 处 app 消费方零改动即实证）；代价仅 2 个新文件。

**⚠️ 发现即记录（与本批无关的预存注释失准）**：`orchestration-handlers.ts:18` 注释称"门禁**不剥离**注释，写了会让「对」复活（见 D-77）" —— 该口径**已被 D-190 的 `stripComments()` 推翻**（注释里写路径不再计违规；本批注释中直接写了 `@modules/agent` 而计数仍**正确 −2**，即为实证）。按 PY_APP §3 **未改该无关注释**，建议后续统一订正。

**✅ 第六步已完成（2026-10-01 D-204）：A2A 对外面 2 条 —— 下沉 `types/a2a` + 新增 `a2aPorts`**

**取证（本轮实测）**：
- `routes/a2a-routes.ts:32-40`：**7 符号同源**自 `@modules/agent`（值 `A2A_PROTOCOL_VERSION` · `a2aTaskStore` · `buildAgentCard` · `computeAgentCardEtag` · `getAgentRegistry` + 类型 `A2AArtifact` · `A2AMessage`）⇒ 按"文件 × 去重目标模块"计 **1 条边**。
- `routes/a2a-delegator.ts:15`：`getAgentRegistry`（值）⇒ **1 条边**。
- ✅ **关键发现**：`agent/a2a/types.ts`（A2A 协议数据模型，215 行）**零出向依赖**（全仓仅 `agentCard.ts` / `taskStore.ts` 以 `./types` 相对引用）⇒ 具备下沉条件（同 D-203 判据）。
- ✅ **协议类型属"对外契约"**（§5.1 Agent Card / §2.2 Message / §2.4 Artifact），非 app 领域载荷 ⇒ 整表下沉 `types/a2a.ts`，端口即可引用**真实类型** ⇒ **零 DTO 复制**（本批优于 D-202 的 DTO 镜像手法）。
- ⚠️ `a2a-delegator` 的**窄端口注入**（`A2ADelegationCore`，为可测性而设）**不动**：人格查询原本即**全局**取用（非经注入的 `core`）⇒ 改经 `getCoreAPI().getA2APort()` **不破坏注入契约**，`tests/http/a2aDelegator.test.ts` **零改动**（若改为"必填方法"会破坏该测试的两处 fake）。

**改动（2 新建 + 1 原址转出 + 1 端口实现 + 2 handler）**：
- **新建** `types/a2a.ts`（整表搬迁）+ `agent/a2a/types.ts` 改为 `export * from '@modules/types/a2a'`（原址转出 ⇒ `agentCard.ts` / `taskStore.ts` / `agent/index.ts` **零改动**）。
- **新建** `runtime/api/a2aPorts.ts`：`A2ACardSnapshotDto`（`card` / `etag` / `agentCount`）+ `A2APort`（5 方法）—— 其中 `buildCard(baseUrl)` 把"取注册表 → `buildAgentCard` → 算 etag"三步**折叠为一个投影方法**（同 D-200 口径）。
- `CoreAPIImpl.getA2APort()`：动态导入 app 模块（仅 R00-003 可见）。
- 2 个 handler 改经端口 ⇒ `@modules/agent` 静态导入**完全消失**；**响应形状 / 状态码 / 304 语义 / 日志字段逐字不变**。

**验收**：`typecheck` **0** · 违规 **0** / **`已豁免 69 → 67`（恰 −2）** / `R03-002` **0** / `R02-002` **未新增** · 6 文件 eslint **0/0**（1 处 prettier 折行经 `--fix`）· `bun test tests/http` = **76 pass / 0 fail**。

**⛔ 子批 C 第 19 条（`session-handlers.ts`）经取证判定「不宜本批做」—— 移交子批 F / 数据契约专项**
- 该文件 4 个导入（`Message` · `MessageRole` · `LiriEventType` · `dedupeMessagesToolCallBlocks`）**全部**落在 `chat`（app）模块 ⇒ 因门禁按"文件 × 去重目标模块"计，须**四者全部**有低位出口才减计数（只改其一无效）。
- 取证发现两处**硬耦合**：① `LiriEventType` 是 `coreAPI.getSessionEvents({ types })` 的**入参类型**（`session-handlers.ts:1176` 的 cast 即为证）⇒ 该**契约本身引用 app 类型** ⇒ 改它属 **§3.6 子批 F（`session`+`runtime` 数据面，23 条，最高风险）**；② `Message` 是门禁 `[Message 模型]` 的**规范来源**（`chat/types/message.ts`）⇒ 下沉会牵动该检查口径，属**数据契约统一专项**。
- **处置**：**不零敲**（避免"改半条契约"留下破损态，CS03/TE03）⇒ 子批 C 记 **18/19 实质收束**。


**🔎 第二步取证（2026-10-01 D-187）：`agent` 2 条为「2 个符号之遥」—— ✅ 已于 D-203 完成**（下列为**当时**取证，保留作沿革）

- `OrchestrationEventType` **已有更低层出口** ✓：`@modules/types/orchestrationEvents`（`export const OrchestrationEventType` + `type OrchestrationEventTypeValue`；`core/events/{TokenTracker,OrchestrationMetrics,EventBusOTelBridge}.ts` 即如此引用；路径含 `types` 段 ⇒ **R03-002 豁免**）。
- ❌ 但两个 handler **同时还依赖**：`AgentEventType`（enum，`agent/events/types.ts:61`）与 `OrchestrationSnapshot`（interface，`agent/events/OrchestrationEvents.ts:449`）—— **二者均无低位出口**（`types/orchestrationEvents.ts` 只有前两者）。
- ⇒ 因门禁按「**文件 × 去重目标模块**」计，**只改 `OrchestrationEventType` 不减计数**；要拿下这 2 条须**先把 `AgentEventType` + `OrchestrationSnapshot` 也下沉 `types/`**（新文件 + 原址转出 + 2 处 import 改造 ≈ 12 步）⇒ **性价比低于上一步（4 步换 −4 条）**，**本轮未做**。
- **建议**：把 `types/` 确认为 `Orchestration*` / agent 事件契约的**规范低位出口**，随"数据契约统一"专项（与 R02-002 `ToolSearchOutput` 三处重复定义同批）一次处理，而非为 2 条边零敲碎打。

**🔎 第三步取证（2026-10-01 D-188）：`tools` 4 条的**真实成本远高于预估**，本轮未动**

- **既有端口机制（读 `runtime/api/toolsPorts.ts` 实测）**：① `runtime/api/<域>Ports.ts` 只声明**接口**；② **只加 1 个取用方法挂 `CoreAPI`**（`getToolsPort()`，实现在 `CoreAPIImpl`）；③ 消费方经 `getCoreAPI()` 取端口。**⚠️ 端口禁止引用 app 类型（连 `import type` 也计 R00-001）**；`Buffer` 等 Node 内置除外。
- **逐条成本**：`video-task-handlers.ts:16`（`getVideoTaskPersistence` —— 端口现有 3 方法只覆盖**部分**调用面 ⇒ 须按该文件**实际调用**逐个映射，**不能只加 getter**，否则等于"端口透传 app 对象"）· `agent-role-handlers.ts:18`（1 方法）· `agent-control-handlers.ts:21`（**多行 import，符号数未知**）· `media-template-handlers.ts:14`（1 方法）⇒ 每条 ≈ **6–8 步**（含 `CoreAPIImpl` 取用方法 + 调用点语义映射 + 验证），**4 条 ≈ 25–30 步**。
- **🔴 新增一层复杂度（取证发现）**：这 4 个文件**同时**存在**动态** `import('@modules/tools')`（`toolsPorts.ts` 注释即记录"**8 个方法面**"，属 R00-003 只上报）⇒ 正确做法须**把静态与动态用法一并收敛到端口**，否则同一文件出现两种取用方式的分裂 ⇒ 改动面**大于**本表最初的估算。
- **⇒ 处置**：本条**不宜按"4 条边"计价**，应作为**一次完整的"`tools` 域取用面收敛"**来排期（含静态 4 条 + 动态 8 个方法面）。**本轮未动手**（预算不足以安全完成，中断会留下"端口已加、调用点未改完"的破损态）。
- **同型提示**：`sandbox` 2 条（`sandbox-handlers.ts` 的 `SandboxManager`/`processRegistry`/`resourceLimitManager`/`globalWorkspaceManager` 4 个符号 + `handler-utils.ts` 1 个）与 `chat` 3 条、`auto-reply` 1 条**同理**：都应按"**域取用面收敛**"整批排期，而非按边零敲。

**🛠️ 首个原子单元（`media-template-handlers.ts`）—— 取证完毕，可直接照此改（D-191）**

> 选它作**最小完整单元**：静态 **1 条**边（`@modules/tools` → `getMediaTemplates`）且**无动态 import**（该文件干净）⇒ 一次改完即"该文件取用面收敛"，不会出现"同文件两种取用方式"。

**① `runtime/api/toolsPorts.ts` 追加**（该文件现有风格：最小投影 DTO + 方法名对齐 handler 实际读取面）：
```ts
/** 媒体模板条目（**最小投影 DTO** —— `media-template-handlers.ts:39-48` 的实际读取面） */
export interface MediaTemplateDto {
  templateId: unknown;
  name: unknown;
  type: unknown;
  category: unknown;
  thumbnailUrl: unknown;
  promptTemplate: unknown;
  requiresImage: unknown;
  sortOrder: unknown;
}

// 追加进 ToolsPort：
  // ---- 媒体模板（`getMediaTemplates()`）----
  listMediaTemplates(): Promise<MediaTemplateDto[]>;
```

**② `runtime/api/CoreAPIImpl.ts` 的 `getToolsPort()` 内追加**（照抄其既有模式：**动态** `import('@modules/tools')` ⇒ 仅 R00-003 可见，正是该文件既有做法，见 1704-1706 行）：
```ts
    const { getVideoTaskPersistence, getConverterEngine, getMediaTemplates } =
      await import('@modules/tools');
    // return { …现有…,
      listMediaTemplates: async () =>
        getMediaTemplates()
          .list()
          .map((t) => ({
            templateId: t.templateId,
            name: t.name,
            type: t.type,
            category: t.category,
            thumbnailUrl: t.thumbnailUrl || null,
            promptTemplate: t.promptTemplate || null,
            requiresImage: t.requiresImage,
            sortOrder: t.sortOrder,
          })),
```

**③ `infrastructure/http/handlers/media-template-handlers.ts`**：删 `import { getMediaTemplates } from '@modules/tools';`（第 14 行）→ 改为顶部 `import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';`（service→service 合法，同 `file-upload-handlers.ts:29` 既有做法），并把 35-36 行改为：
```ts
    const tm = await getCoreAPI().getToolsPort();
    const templates = await tm.listMediaTemplates();
```
（后续 `templates.map((t) => ({ id: t.templateId, … }))` **保持不变** —— DTO 字段名与读法逐一对齐。）

**验收预期**：`已豁免 81 → 80` · `typecheck 0` · `R03-002 0` · 改动文件 `eslint 0/0` · `bun test tests/http` 0 fail。

**✅ 已执行（2026-10-01 D-192，与预期逐数吻合）**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 81 → 80`（恰 −1）** · `eslint` **0/0**（首轮出现 2 处 **prettier** 格式错，已按 prettier 期望改为单行解构）· `bun test tests/http` = **76 pass / 0 fail**。
**手法要点（可复用到其余 3 条）**：① 端口加**最小投影 DTO**（字段逐一对齐 handler 读取面）；② `CoreAPIImpl.getToolsPort()` 内**动态** `import('@modules/tools')` 取实现（仅 R00-003 可见 —— 这是该文件**既有**做法，故 runtime→tools 早已在 R00-003 清单中）；③ handler 改 `await getCoreAPI().getToolsPort()`，**后续字段映射不变**。
**⚠️ 踩坑提示**：`CoreAPIImpl` 的多行解构会被 **prettier** 判错（期望单行）⇒ 直接写成单行 `const { a, b, c } = await import(...)` 再折行。
**④ 其余 3 条的取证结论（2026-10-01 D-193）—— 建议顺序调整：先 `agent-role-handlers`，`video-task-handlers` 放后**

| 文件 | 取证结果 | 预估步数 |
|---|---|---|
| `video-task-handlers.ts` | ✅ **已完成（D-197）**：端口补 `getVideoTask`/`listVideoTasks`/`cleanupStaleTasks` + `updateVideoTask` patch 加 `mode`（**联合字面量**，首轮 typecheck 因 `string` 不可赋值给 `'text-to-video'\|'image-to-video'` 报错，已收窄）+ 删**两个**导入（值 + 未使用的类型）+ 改 5 处调用点 ⇒ **`已豁免 79 → 78`** · typecheck 0 · eslint 0 · tests/http 76 pass | 实测 **10 编辑** |
| `agent-role-handlers.ts` | ✅ **已完成（D-194）**：`refreshAvailableSubagentTypeNames` —— **单一函数**、**唯一** tools 导入、1 处调用点（L126）⇒ `已豁免 80 → 79` · typecheck 0 · eslint 0 · tests/http 76 pass | 实测 **4 编辑** |
| `agent-control-handlers.ts` | ✅ **已完成（D-199）**：多行 import **5 个符号**全删（L15-21：`AgentTool` · `getAgentRunStore` · `resolveAgentToolInstance` · `setSpawnPaused` · `getSpawnPauseState`）+ helper `getAgentTool()` 删除 + **9 处**调用点改经端口 ⇒ `已豁免 78 → 77` · typecheck 0 · eslint 0 · tests/http 76 pass —— **`tools` 域静态边归零** 🎯 | 实测 **11 编辑** |

**⇒ 执行顺序（结果复盘）**：`agent-role-handlers` ✅（D-194，4 编辑）→ `video-task-handlers` ✅（D-197，10 编辑）→ `agent-control-handlers` ✅（D-199，11 编辑）—— **`tools` 域 4 条全部完成，静态边归零** 🎯。

**🛠️ `agent-control-handlers.ts` 完整端口设计（D-198 取证 → D-199 落地 ✅）**

实测调用面（另需：**5 处**调用点 + 删 **5 个符号**（含 `AgentTool` 类型，L32 作返回类型；helper `getAgentTool()` 随之删除））：

| handler 调用点 | 端口方法（**D-199 落地签名 —— 与 D-198 建议的差异已标注**） |
|---|---|
| L54 `getSpawnPauseState()` | ⚠️ **D-198 建议 `boolean`，D-199 实证改为 `unknown`** —— 实际返回**不透明状态对象**，首轮 typecheck 报 `TS2416` ⇒ 按实证签名 |
| L71 `setSpawnPaused(true, reason?)` · L139 `setSpawnPaused(false)` | `setSpawnPaused(paused: boolean, reason?: string \| undefined): unknown`（同步） |
| L106 `getAgentRunStore().listRuns()` | `listAgentRuns(): Promise<AgentRunDto[]>` |
| L55 `agentTool?.getActiveAgents() ?? []` | `getActiveAgents(): unknown[]`（结果**直接**进 JSON，无需字段映射） |
| L168 `agentTool.stopAgent(agentId, { requesterSessionId })` | `stopAgent(agentId: string, opts: { requesterSessionId?: string \| undefined; privileged?: boolean \| undefined }): unknown`（D-199 增 `privileged`，对齐实测调用点） |
| （D-199 新增） | `isAgentToolAvailable(): boolean` —— **专为保留 503 分支语义**（原 helper `getAgentTool()` 的"解包 + 能力判定"职责并入端口） |

**`AgentRunDto`（字段表按 L111-125 实测；**无 `?? null` 的为必填**）**：
```ts
export interface AgentRunDto {
  toolCallId: string;
  agentId: string;
  name: string;
  agentType: string;
  status: string;
  descriptorSource?: unknown;
  batchId?: unknown;
  taskKey?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  error?: unknown;
  attribution?: unknown;
}
```
**⚠️ 注意**：`getActiveAgents()` / `stopAgent()` 返回**不透明值**（结果直接进 JSON、或仅用于判断）⇒ 用 `unknown` 即可，**不要**为它们新建 DTO（避免 CS02/过度设计）；这也是"实例方法投影"与"数据投影"的分界：**只投影 handler 真正读取字段的对象**。

**⚠️ 与 FSZ-* 冲突提示**：多个 handler 文件正挂着**文件大小例外**（`skills-handlers.ts` 1582 行 · `knowledge-handlers.ts` 1759 · `session-handlers.ts` 1012 等）⇒ 本子批**只动 import 与端口**，**不顺手拆文件**（拆分属另一专项）。

### 3.4 子批 D —— `service -> app` 低风险（原列 **8** ⇒ **实测 6**）

**⚠️ 清单实测修正（2026-10-01 D-205 取证）**：原列 `mcp -> tools`(1) / `-> tool`(1) **实测不存在** —— 对 `app/src/mcp/**` 做**全量** grep（`@modules/<app 模块>` 含**子路径**形式 + 相对上跳 `../../`）⇒ **0 命中**（该目录只引 `config` / `monitoring` / `error` / `core` / `services/mcp`，均为下行合法）⇒ 疑与 **D-67「`mcp` 由 core 改归 service」**同源（改动后该两边的方向/归属已变）。**实测 6 条**，逐条如下（含本轮新做的取证）：

| # | 文件 | 导入 | 目标 | 处置 |
|---|---|---|---|---|
| 1 | `channels/registry/ChannelRegistry.ts:21` | `dependencyRegistry`（值） | `context`(app) | ✅ **已完成（D-205）**：该符号**早在 D-157 即已下沉** `core/DependencyRegistry.ts`（`context/` 仅转出）⇒ 改**相对直连 core 模块根** `'../../core/DependencyRegistry.js'`（同 `PermissionInterceptor.ts:40` 先例）⇒ **零端口零白名单** |
| 2 | `channels/bootstrap/ChannelBootstrapper.ts:8` | `EffectScope`（类） | `context`(app) | ✅ **已完成（D-207）**：**改归 infra**（`context/EffectScope.ts` → `utils/EffectScope.ts`，`context/` 原址转出）⇒ 引用改**相对直连 infra 模块根**。⚠️ 实证**不可下沉 core**（其 `error`/`monitoring` 依赖会让 core 新增 2 条跨层边 ⇒ 净变差）；改归 infra 则依赖变 `infra -> infra` 合法。**零配置改动**（`utils` 已在层映射中为 infra） |
| 3 | `channels/GatewaySessionTracer.ts:6-11` | `getSessionSpanTracer` · `SPAN_ATTRIBUTE_KEYS` + 类型 `SessionSpanContext` · `SessionSpanAttributes` | `ai`(app) | ✅ **已完成（D-206）**：该文件**零项目依赖**（仅 `crypto`）⇒ **整文件下沉** `core/SessionSpanTracer.ts`（core 模块根）+ `ai/telemetry/SessionSpanTracer.ts` **原址转出** ⇒ 改**相对直连 core**。**零端口零 DTO**（比 §3.3 ③-预案的"类型下沉+端口"更省） |
| 4 | `channels/routing/messageRouter.ts:51` | `type SessionSpanContext` | `ai`(app) | ✅ **已完成（D-206）**：与 #3 **同批**（类型位随 #3 的实现一起下沉，故两条边一次消除） |
| 5 | `bridge/BridgeMain.ts:20-21` | `createWorkspaceGit` · `pruneOrphanWorktrees` | `workspaces`(app) | ✅ **已完成（D-207）**：**新增服务层端口** `runtime/api/bridgePorts.ts` + `CoreAPIImpl.getBridgePort()`（动态导入）；返回值按调用方读取面最小投影 `{ worktreePath }`。⚠️ 经核**未复用** `workspaceOpsPorts.ts`（不同域 ⇒ CS01 另立） |
| 6 | `voice/VoiceSession.ts:24` | `globalToolManager`（值） | `tools`(app) | ✅ **已完成（D-207）**：改经**既有 sanctioned 门面** `getCoreAPI().getToolManager()`（service→service 合法；`CoreAPIImpl.ts:301` 实证与 `globalToolManager` **同一实例**）⇒ **零端口、零语义变更** |

**⚠️ 关键教训（本轮取证新增，第 ⑥ 条）**：**"改层/下沉前先核其出向依赖的层，先算净差再动手"** —— #2 的 `EffectScope` 看似可下沉 core，但实证 `app/src/core/**` **零 `@modules/monitoring|error` 导入** ⇒ 下沉会让 core **新增 2 条** `core -> infra` 边，**净变差**（+2 −1）。**正解是改归 infra**（依赖变 `infra -> infra` 合法）⇒ 真 −1。同 D-186 的"改一半不减计数"。

**执行顺序建议（结果复盘）**：#1 ✅（D-205）→ **#3+#4 ✅**（D-206，同批一次拿下）→ **#5 ✅ · #6 ✅ · #2 ✅**（D-207）⇒ **子批 D 实测 6/6 全部完成** 🎯。


### 3.5 子批 E —— `services -> app`（原列 **20** ⇒ **实测 19**）

**全量取证（2026-10-01 D-208，`app/src/services/**` 含子路径 + 相对上跳盲区均扫）**：按 **(文件 × 去重目标模块)** 实测 **19 条**、分布于 **6 个 app 目标**：

| 目标 | 条数 | 文件（实测） | 关键性质 / 处方 |
|---|---:|---|---|
| `chat` | **6** | `compact/AutoCompactService.ts` · `compact/autoCompact.ts` · `compact/grouping.ts` · `contextCollapse/types.ts` · `contextCollapse/ContextCollapseService.ts` · `toolUseSummary/ToolUseSummaryService.ts` | 全部是 **`Message` 类型位**（+ `MessageRole` / `ContentBlockType` 值）⇒ ⛔ **与子批 C 余项同源**：`Message` 是门禁 `[Message 模型]` 的**规范来源** ⇒ 须随**数据契约统一专项**（或子批 F）一次处理 |
| `ai` | **5** | `compact/CompactService.ts` · `compact/utils.ts` · `prompt/PromptAssembler.ts` · `prompt/SystemPromptReport.ts` · `prompt/DiagnosticsReport.ts` | 真 app 能力（`modelManager` · `providerRegistry` · `buildSystemPrompt` · `estimateTokens` · `getCachedTiktokenEncoder`）+ 类型（`AIService`/`AIMessage`/`AIMessageRole`/`AIModelType`）⇒ 处方：**复用既有 `runtime/api/aiOpsPorts.ts`**（先核覆盖面，CS01）+ 类型下沉 `types/` |
| `tools` | **4** | `agent/builtInAgents.ts` · `mcp/MCPToolRegistry.ts` · `mcp/MCPToolBridge.ts` · `mcp/McpToolWrapper.ts` | 混合：**类型位为主**（`Tool` · `ToolInfo` · `ToolParam` · `ToolUseContext` · `ToolResult` · `ToolExecutionStatus`）+ 值（`getToolManager` · 2 个 Agent 定义常量）⇒ 处方：**`tools/types/**` 类型下沉 `types/`**（先核零依赖）+ 值走 `getCoreAPI().getToolManager()`（D-207 已实证同一实例） |
| `context` | **2** | `compact/utils.ts`（`resolveContextWindow`）· `mcp/MCPToolBridge.ts`（`dependencyRegistry`） | ✅ **`MCPToolBridge` 已完成（D-208，直连 core 叶子）**；⚠️ 另一半 `resolveContextWindow` **不可下沉 core**（`context/window/ContextWindowResolver.ts` 依赖 `@modules/ai` ⇒ 下沉会给 core 新增 `core -> app` 边）⇒ 须走端口，**且先核 `CoreAPIImpl` 是否已有上下文窗口方法**（`resolveContextWindowAsync()` 见模型规则文档） |
| `workspaces` | **1** | `services/workspace/index.ts`（`WorkspaceScanner` 系列） | 单点、值 ⇒ 处方：核既有 `workspaceOpsPorts` 覆盖面后**扩充或另立** |
| `commands` | **1** | `mcp/MCPCacheManager.ts`（`type Command`） | 单类型位 ⇒ 处方：`Command` 类型是否有低位出口；无则随**类型下沉** |

**⚠️ 总体结论（重要）**：子批 E 的 **19 条里 11 条（chat 6 + tools 类型 3-4 + commands 1）受"规范数据模型"阻塞**（`Message` / `Tool` / `Command`）—— 与子批 C 余项（`session-handlers`）**同一根因**。⇒ 建议**先做一次"数据契约统一"专项**（把 `Message` / `Tool` 等规范类型下沉 `types/` 或确立规范低位出口），再回头批量清零 E/C 的剩余边；否则逐文件端口化会**大量重复**且易反复（"改一半不减计数"）。
**📄 该专项已立档（2026-10-01）：[data-contract-unification.md](./data-contract-unification.md)** —— 含现状实测（12 条边 · 各候选类型的落点与依赖判定 · `Message` 三分辨析）、门禁配合点（**R05-011 自动跳过 `types/` 前缀 ⇒ 零门禁改动**）、设计决策 D1-D6、任务分解 T1-T7（预计一次性解锁 **−12**）与合规清单。**待评审后实施**。

**🔎 `chat` 组落地方案取证（2026-10-01 D-210）** —— 6 条边 = `compact` 3（`AutoCompactService` · `autoCompact` · `grouping`）+ `contextCollapse` 2（`types` · `ContextCollapseService`）+ `toolUseSummary` 1（`ToolUseSummaryService`）。**因 `Data*` 不等价（见 data-contract spec §2.4 对照表）⇒ 不走 `core/data-models`，改按 spec §3.5 原注的"**改归正确层**"评估**：

- **`services/compact/**` 消费方实测**（跨模块引用全量）：
  - app 侧：`chat/ChatManager.ts:330` · `chat/ChatManagerInterface.ts:31` · `chat/services/ContextCompactor.ts:33` · `query/ContextCollapse.ts:9` · `query/ReactiveCompact.ts:12` · `commands/builtin/compact/Compact.ts:15`（含 1 处**动态** `import()`：`query/__tests__/CompactionIntegration.test.ts`）
  - **service 侧（唯一的"上向"消费方）**：`session/compaction/ServiceAdapters.ts:1`（`@modules/services/compact/AutoCompactService`）
  - ⇒ **若把 `services/compact/**` 整组改归 app**：其 6 条跨层出向（chat 3 + **ai 2** + **context 1**）**全部转为合法**（app→app），但**新增 1 条** `session → compact(app)` ⇒ **净 −5**（且顺带清掉 ai/context 组中属 compact 的 3 条）；⚠️ 须**同批**处理该入向（`ServiceAdapters` 端口化，或与 `session/compaction` 一并归位）。
- **`services/contextCollapse/**` 与 `services/toolUseSummary/**`**：✅ **零引用复核已完成（2026-10-01 D-216）—— 确认为"零引用死代码"**：
  - `ContextCollapseService` / `getContextCollapseService` ⇒ 全仓仅出现在**自身目录**（`services/contextCollapse/{index,ContextCollapseService}.ts`）；
  - `ToolUseSummaryService` / `getToolUseSummaryService` ⇒ 全仓仅出现在**自身文件**；
  - 目录名全仓扫描的其它命中**均为无关物**：3 处**注释**（含"用途不同"的明示）· `hooks/types/ToolHooks.ts:121` 的**字段名** `toolUseSummary?` · `query/ReactiveCompact.ts` 的 `ContextCollapser`/`createContextCollapser()`（**query 内独立实现，不同物**）；
  - **无 `services` barrel**（`services/index.ts` 不存在）⇒ 不存在隐藏入口。
  ⇒ **裁定就绪：可删 ⇒ 一次消 3 条边（`contextCollapse` 2 + `toolUseSummary` 1），零层变更、零端口、零风险**。
  ⚠️ 按项目规则「**先报告、不擅自删除**」⇒ **等用户裁定**后再删（删除动作另起一批，含 `git rm` + 验证 + 记档）。
- ⚠️ 与子批 **F**（`session -> *` 16 条）**存在交叠**：`session/compaction/**` 正是 F 的成员 ⇒ **改归 compact 前须先与 F 的排期对齐**，否则会"按下葫芦浮起瓢"。

**⇒ `chat` 组建议**（待裁定）：**整组改归 app**（三目录），**前置条件**：① 核清另两目录的消费方（含 barrel）；② 与子批 F 对齐 `session/compaction` 的处置；③ 需改 `modules-to-layers.json`（新增 app 层条目，属**层再分类**而非放宽门禁）。

**🔎 前置①②已完成（2026-10-01 D-211）**：
1. **barrel 核查**：`app/src/services/index.ts` **不存在** ⇒ **无 `services` barrel** ⇒ 别名子路径是唯一入口；再扫 `ContextCollapseService|ToolUseSummaryService` ⇒ **0 跨模块消费方**
   ⇒ ⚠️ **`services/contextCollapse/**`（2 条边）与 `services/toolUseSummary/**`（1 条边）＝疑似死代码**（注：`query/ContextCollapse.ts` 与 `query/ToolUseSummary.ts` 是**同名但不同物**的独立实现，均**不消费**这两目录）。
   ⇒ 按项目规则**先报告、不擅自删除**；**若确认可删 ⇒ 这 3 条边随删除消失，零层变更、零端口**（可能的最优解）。
2. **`session/compaction/**` 归属核实**：共 **8 文件**（`CompactionRecord` · `CompactionTypes` · `KeyInfoExtractor` · `LayeredCompactor` · `ServiceAdapters` · `SessionCompactionBridge` · `SummaryCompactor` · `index`）＝**会话级压缩子系统**（session 域自持）；其对 compact 的依赖**仅 1 处**（`ServiceAdapters.ts:1` 取 `AutoCompactService`）。
   ⇒ 建议：`session/compaction` **保持 service**（属 session 域），仅把该 1 处取用**端口化**（即"新增 1 条边的修复成本 = 1 个端口方法"）；⚠️ 其内部是否另有 `@modules/chat`（app）取用需并入**子批 F** 排期一并核（F = `session -> *` 16 条）。

**⇒ 修订后的 `chat` 组执行顺序（待裁定）**：
① **先裁定**两个疑似死代码目录（`contextCollapse` · `toolUseSummary`）—— 若可删 ⇒ **−3 条**（零风险路径）；
② `services/compact/**` 改归 app（+ `modules-to-layers.json` 增 app 条目）⇒ **净 −5**（含其 ai 2 / context 1），**同批**端口化 `session/compaction/ServiceAdapters` 的 1 处取用；
③ 明细与 F 的交叠在 F 排期时复核。

**✅ 已完成（2026-10-01 D-216 + D-217）—— `chat` 组 7 条违规边清零（`已豁免 55 → 49`，台账净 −6）**

- **D-216（死代码删除，−3）**：`bun run lint:arch` 前置复核确认 `services/contextCollapse/**`（`ContextCollapseService` · `index` · `types`）与 `services/toolUseSummary/**`（`ToolUseSummaryService` · `index`）**零跨模块消费方**（含 barrel 核查：`services/index.ts` 不存在；`query/ContextCollapse.ts` · `query/ToolUseSummary.ts` 为**同名不同物**的独立实现，均不消费）⇒ 经用户授权 `git rm -r` 删除 5 文件 ⇒ **`已豁免 55 → 52`**（恰 −3）。
- **D-217（`services/compact/**` 改归 app —— **独立模块** `compaction`；7 条违规边全清，台账净 −3）**：
  - **净差取证（D-207 教训）**：迁移前 `services/compact/**` 的跨层出向实测 **4 条**（`chat` 3 文件：`autoCompact.ts` · `AutoCompactService.ts` · `grouping.ts`；`context` 1 文件：`utils.ts`）—— ⚠️ §3.5 原注所列"**净 −5（含 ai 2）**"已**不成立**：`ai` 那 2 条早在 **D-213** 随死导入删除被清掉。
  - **⚠️ 落点走过弯路（方案甲 → 乙）—— 一条 R03-002 教训**：首版按"方案甲"把它**嵌进 `chat/compaction/**`**（动机是免改 `modules-to-layers.json`）。**全量 `lint:arch`（pre-commit 钩子）报出 4 处 `R03-002` 违规**：因 `chat` **有 `index.ts`** ⇒ 直连其子目录即"绕过模块出口"；而改走 `@modules/chat` 桶又会把整个 chat 面（`ChatManager` / `ReActToolLoop`…）拉进 `query` / `commands`。首版漏报之因：**只匹配了 R00-001 汇总行，未看 R03-002 独立小节** ⇒ 已记入教训。
    - **根因（CS05）**：给独立子系统套**假父子关系**以"借用"父层归属 ⇒ **模块边界与子系统边界不重合** ⇒ 与「模块出口单一」**结构性地**冲突（两条出路都不可接受）。**修门禁不如修边界。**
    - **修正（方案乙，用户裁定）**：`compaction` **自持模块身份** —— `git mv` → `app/src/compaction/` · `modules-to-layers.json` **新增 app 条目** · 以**既有 `index.ts` 为唯一出口**，消费方一律 `@modules/compaction` ⇒ **零门禁白名单改动**（属 spec 原注的"**层再分类**"而非放宽）。同时消除对"顶层模块子路径导入恰好被 `parts.length < 3` 跳过"这一边界情形的隐性依赖。
  - **唯一入向的处理（同步门面，非 Promise 端口）**：`session/compaction/ServiceAdapters.ts` 是 service 侧唯一消费方，迁移后会构成 `session -> compaction`(app) 倒挂 ⇒ **取用面投影化**。⚠️ 取证发现 `createWiredCompactionBridge()` 的调用点在 `SessionGateway` **构造函数**与**同步 fluent API**（`wireWithRealServices(): this`）内 ⇒ **不可改异步** ⇒ 改用本仓既有 sanctioned 缝模式（同 `getChatManager()`/`getToolManager()`）：`CoreAPIImpl` 新增**同步**门面 `createAutoCompactService()`（静态导入 `AutoCompactService`），投影类型 = `runtime/api/compactPorts.ts#AutoCompactServiceRefPort`。
  - **计数（如实）**：清掉 **4 条**（`chat` 3 + `context` 1 ⇒ app→app 合法），但**新增 1 条** `runtime -> compaction`（新模块身份带来的必要跨层取用）⇒ **净 −3**（`52 → 49`）。⚠️ 与"嵌入 chat 版"的 −4 相比多 1 条 —— 这是**换掉假边界所付的诚实代价**，换来门禁口径不动。
  - **迁移手法**：`git mv app/src/services/compact app/src/compaction`；⚠️ 目录**深度变化**（3 段 → 2 段）⇒ 目录内 **2 处**相对导入须修正：`postCompactCleanup.ts` 的动态 `import('../session/SessionStorage.js')` · `utils.ts` 的 `require('../../native')`（`strategies/*` 的 `'../ContextEngine'` 为同级、不受影响）。
  - **新增别名**：`app/tsconfig.json` 增 `"@modules/compaction": ["compaction"]` —— **只加裸键、不加 `/*` 通配** ⇒ 子路径导入在**编译期**即失败，双保险落实「唯一出口」。
  - **消费方**：**8 处**改走 `@modules/compaction`（`chat/ChatManager.ts` · `chat/ChatManagerInterface.ts` · `chat/services/ContextCompactor.ts` · `query/ContextCollapse.ts` · `query/ReactiveCompact.ts` · `commands/builtin/compact/Compact.ts` · `runtime/api/CoreAPIImpl.ts` + `query/__tests__/CompactionIntegration.test.ts` 9 处动态 `import()`）。
  - **门禁脚本同步**：`scripts/lint-architecture.ts` 例外清单 `services/compact/ContextEngine.ts` → `compaction/ContextEngine.ts`（R02-002 + R05-011 两处）。
  - **验证**：`已豁免 52 → 49` · `typecheck 0` · `lint:arch` **R03-002 = 0 违规**、总账 `错误 0 / 警告 3`（余 R02-002 · R07-004 · R00-003 均**预存、与本改动无关**）· 改动文件 eslint **0 error**（余 34 warning 均**随文件平移的存量**）· `bun test src/query/__tests__/CompactionIntegration.test.ts` = **19 pass / 10 skip / 0 fail**（含动态 `import('@modules/compaction')` 解析验证）。
  - **遗留（预存，非本次引入）**：`CompactServiceImpl.setAIService()` 全仓无调用方 ⇒ `generateAISummary` 恒走 `generateBasicSummary` 回退（见 D-215 记录），另册跟踪。

**🔎 `tools` 组取证与执行（2026-10-01 D-218）—— 4 条中 1 条可清，3 条**硬阻**

- **4 条实测**（`services -> tools`；去重口径 `file × tools`）：`mcp/MCPToolRegistry.ts`（`type Tool`）· `mcp/McpToolWrapper.ts`（`Tool`/`ToolInfo`/`ToolParam`/`ToolUseContext`/`ToolResult` + 值 `ToolExecutionStatus`）· `mcp/MCPToolBridge.ts`（值 `getToolManager` + `type Tool`）· `agent/builtInAgents.ts`（2 个 Agent 定义常量）。
- **✅ 第 4 条 —— 零引用死代码，已删（用户裁定"丁"）**：`services/agent/builtInAgents.ts` 全仓**零 import / 零再导出 / 无 barrel**（`services/agent/` 无 `index.ts`）；其 `getBuiltInAgents()` 与 **app 侧** `agent/strategies/agentStrategy.ts:501` **重名不同物**，唯一消费方 `agent/managers/AgentSourceManager.ts:9` 取的是 **app 那个** ⇒ 属"陈旧重复死实现"（**非归属错误**）。`git rm` 删除 ⇒ **`已豁免 49 → 48`**（恰 −1）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` = 0 / 错误 0 警告 3（预存）。
  - ⚠️ **原裁定被证伪（记档）**：用户先按"**甲·改归 agent 域**"裁定，取证却发现该文件**是死的**（前提不成立）⇒ 停下重新裁定为"**丁·删除**"（对齐"取证的结论推翻方案时立即停下重新裁定"）。
- **⛔ 余 3 条硬阻 —— `Tool` 双份定义**：
  - **事实**：`src/types/tool.ts` **已存在**，是**另一个**极简 `Tool`（22 行：`{name, description, parameters?, execute?}` + `ToolPermissionContext`）；`tools/types/Tool.ts` 是 **660 行完整工具契约**（`ToolTag` · `ToolParam` · `ToolInfo` · `ToolUseContext` · `ToolDef` · `buildTool` …）⇒ **两者不等价**（与 `Message` 同型）。
  - **物理阻断**：Windows **大小写不敏感** ⇒ `git mv tools/types/Tool.ts types/Tool.ts` 会**覆盖**现有 `types/tool.ts`（数据丢失）⇒ 该迁移在本平台**不可执行**；即便绕过，也会在类型中心制造同名 `Tool` 冲突（当前 `0 处冲突`）。
  - ⇒ **吻合 §3.5 前述预判**（`tools` 类型位与 `chat`/`commands` 同属"**规范数据模型**"阻塞）。**处置：挂起**，并入 [data-contract-unification.md](./data-contract-unification.md) 专项 —— 该专项范围须从 `Message` **扩到 `Tool` / `Command`**，先裁定"`types/tool.ts` 极简版 ↔ `tools/types/Tool.ts` 全量版"的关系。
  - 注：`MCPToolBridge` 的**值位** `getToolManager` 本可独立改走 `getCoreAPI().getToolManager()`（`CoreAPIImpl.ts:5037`；D-207 已实证同一实例），但**该文件仍受 `type Tool` 阻塞** ⇒ 依"**改一半不减计数**"**不单独改**（不制造半成品）。

**🔎 `workspaces` 组取证与执行（2026-10-01 D-219）—— 1 条清零（−1，零端口、零白名单）**

- **实测**：`services/workspace/index.ts` 是**纯转出 barrel**（`export { … } from '@modules/workspaces/WorkspaceScanner'`），构成 `services -> workspaces`(app) 倒挂。
- **消费方实测**：全仓仅 **2 处**，且**都在 app 层** —— `context/promptSections/index.ts:14`（`clearWorkspaceCache`）· `context/promptSections/builtinSections.ts:22`（`readAgentsMd` / `readToolsMd`）；barrel 另导出的 `scanWorkspaceFiles` / `WorkspaceFile(s)` **零外部消费者**（`scanWorkspaceFiles` 仅 `WorkspaceScanner.ts` 内部自用）。
- **处方（比端口更简单）**：`context` 与 `workspaces` **同为 app** ⇒ 直接取 `@modules/workspaces/WorkspaceScanner`（app→app 合法），barrel 随即**成为死代码 ⇒ 删除**（`services/workspace/` 仅此一文件）。**零端口、零白名单、零新增机制**（另见同批 D-218 的死文件删除）。
- **验证**：`已豁免 48 → 47`（恰 −1）· `typecheck 0` · `lint:arch` 违规 0 / `R03-002` = 0 / 错误 0 警告 3（预存）· 改动文件 eslint 0/0 · `bun test tests/prompt/promptSectionLayersGate.test.ts` = **4 pass / 0 fail**。
- **⚠️ 顺带发现（门禁盲区，未修、待裁决）**：R03-002 的"模块根"取自 `scripts/lint-architecture.ts:2001-2047` 的**硬编码 `moduleRoots` Set**，与 `modules-to-layers.json`（**86 模块**）**已漂移** —— 缺 `workspaces` · `compaction` · `workspace` · `docs` · `knowledge` · `governance` · `evals` · `project` · `models` · `flows` · `wizard` · `tool` · `testing` · `plugin-sdk` · `context-engine` · `analytics` · `common` · `constants` · `media` · `i18n` · `lsp` · `security` · `system` · `trace-recording` · `daemon` · `modules` · `appState` 等 ⇒ **这些模块的子路径直连不计入 R03-002**（本例 `@modules/workspaces/WorkspaceScanner` 即因此长期"零违规"）。
  - **对 D-217 的影响（如实）**：`compaction` 的"唯一出口"实际由 **tsconfig 别名（只加裸键、不加 `/*` 通配）** 在**编译期**强制，**并非** R03-002 强制 —— 上条"以 `index.ts` 为唯一出口（R03-002）"的措辞应理解为"结构意图 + 编译期强制"。
  - **处置**：补全 `moduleRoots`（或改为从 `modules-to-layers.json` 派生）会**一次性暴露大批存量**，属**门禁口径变更** ⇒ 另立专项裁定，**本批不动**（已登记 `预存错误与待处理问题.md`）。

**🔎 `commands` 组取证与执行（2026-10-01 D-220）—— 1 条清零（−1，零端口、零白名单）**

- **实测**：`services/mcp/MCPCacheManager.ts` → `type Command`（`@modules/commands`），构成 `services -> commands`(app) 倒挂。
- **先证伪两个常规处方**：① **不可改引 `types/`** —— `commands/types/index.ts:39` 的 `Command`（含 `type: CommandType` 的**完整 CLI 契约**）与 `types/index.ts:36` 的极简 `Command`（`{ name; description; aliases?; execute(args, context?) }`）**并非同一物**（同 `Tool` 情形，不可"看着像就合并"）；② **不必端口/下沉**。
- **根因（CS05）**：实测 `Command` 在该类中**仅出现在类型位置、从未解引用任何字段** —— `private commandCache: Map<string, MCPCacheItem<Command[]>>` · `setCommandCache(name, commands: Command[], ttl?)` · `getCommandCache(name): Command[] | null`，而类头 `implements ICache<string, unknown>` **本就擦成 `unknown`** ⇒ 这是个**不透明载荷容器**，却硬绑了 commands 域模型 ⇒ **语义虚假**的跨层依赖。
- **处方**：**3 处** `Command[]` → `unknown[]`（字段 · setter · getter）+ 删除该 import ⇒ 依赖消失。**零调用方**（`getCommandCache`/`setCommandCache` 全仓仅类内 `get()`/`set()` 两处自用）⇒ **无破坏面**；`unknown` **非 `any`**，不违反"新代码零 any"。
- **验证**：`已豁免 47 → 46`（恰 −1）· `typecheck 0` · `lint:arch` 违规 0 / `R03-002` = 0 / 错误 0 警告 3（预存）· 改动文件 eslint 0/0。
- **E 组收口状态**：剩余 **3 条全在 `tools` 组**、且**全部**受阻于 `Tool` 双份定义（D-218）⇒ **子批 E 的静态可清部分至此清零**，余项待 [data-contract-unification.md](./data-contract-unification.md) 专项裁定（专项范围须含 `Tool` / `Command`）。

**🔎 子批 F 首组 `session -> chat`（B11 · 11 条）取证 —— ⛔ 方案乙被证伪，整组挂起（D-221，2026-10-01）**

- **形态**（去重 `file × chat` = 11）：**10 条为事件/消息契约**取用（`LiriEvent` · `LiriEventType` · `ChatSession` · `Message` + 值 `isLiriEvent` / `KNOWN_SESSION_EVENT_TYPES` / `MessageStatus`），**1 条为装配值**（`compaction/ServiceAdapters.ts` 取 `getCheckpointService`，与 D-217 同型）。
- **用户裁定走"乙 · 契约改归 `session/types/`(service)"** ⇒ 前置**传递闭包取证**，结果 **3 处硬阻断**：
  1. **物理覆盖**：`session/types/` **已有** `Message.ts`（322 行 `UnifiedMessage` 家族：`MessageType`/`MessageRole`/`ContentBlockType` 枚举 · `ContentBlock` 联合 · `FrontendMessageBlock` · `InboxBlockData` · SDK 控制消息族）与 `Session.ts`（`SessionType`/`SessionStatus`/`SessionMetadata`），**均与 `chat/types/*` 不同物**；Windows **大小写不敏感** ⇒ 迁入即**覆盖**（同 `Tool` 情形）。此发现使 `Message` 达 **4 份**（协议层 `core/types.ts` · 领域层 `chat/types/message.ts` · 域私有变体 · session `UnifiedMessage`）。
  2. **新增倒挂**：`chat/types/events.ts` → `./eventPayloads` → **`@modules/tasks`**(app)（`TaskGoalStatus` / `TaskGoalUpdateReason` / `GoalTemplateKind`）⇒ 整组迁 `session` 将**新增 `session -> tasks`** ⇒ 与治理目标自相矛盾。
  3. **同一条亦封死甲**（改下沉 `types/`）：`eventPayloads.ts` 另引 `@modules/utils/mermaidLint`(infra) ⇒ 变成 **`core -> app` / `core -> infra`**（**更差**）。⇒ 甲/乙均需**级联前置**（下沉 `TaskGoal*` app→core、`MermaidLintIssue` infra→core）。
- **唯一可分离小块仍在专项内**：`chat/types/message.ts` **零出向依赖**（实测无任何 `import`）技术上可下沉；但 `types/index.ts:27-31` 明载「`Message` 已从类型中心删除、事实规范为 `chat/types/message.ts`」，且 R05-011 点名该文件 ⇒ 把 `Message` 重新引入 `types/` **正是数据契约专项中被推翻过的提案**（data-contract spec §0「T1 被推翻记录」）⇒ 须专项裁定。
- **⇒ 处置（用户裁定）**：**B11 整组挂起**，并入数据契约专项（范围需含 `Message`(4 份) · `Tool` · `Command` · `LiriEvent`/`eventPayloads` 的 `TaskGoal*` / `MermaidLintIssue` 跨域依赖）；**先做 F 其余 5 条**（`session -> ai` 2 · `-> query` 2 · `-> context` 1），均**不涉**数据契约。
- **取证产物（可复核，`chat/types/**` 出向全表）**：`checkpoint.ts`→`./message`+`./session` · `events.ts`→`@shared/events/eventNames`(值)+`./eventPayloads` · `eventPayloads.ts`→`@modules/core`+**`@modules/tasks`**+**`@modules/utils/mermaidLint`** · `knownEventTypes.ts`→`./events` · `session.ts`→`@modules/core`+`./message` · `message.ts`→**零出向**。

**📌 B11 前置取证（2026-10-01，D-223）—— 两个前置项的证据与裁定建议**

**前置项 P1：`TaskGoal*` / `MermaidLintIssue` 下沉 core**（解除 blocker ②③）

| 类型 | 定义落点 | 形状 | 出向依赖 |
|---|---|---|---|
| `TaskGoalStatus` | `tasks/goal/TaskGoalStore.ts:37` | 6 值字面量联合 | **零** |
| `TaskGoalUpdateReason` | `tasks/goal/TaskGoalStore.ts:64` | 16 值字面量联合 | **零** |
| `GoalTemplateKind` | `tasks/goal/goalTemplates.ts:68` | 5 值字面量联合 | **零** |
| `MermaidLintIssue` | `utils/mermaidLint.ts:50` | 3 字段纯接口（`number`/`number`/`string`） | **零** |

- **消费方实测（全量）**：三个 goal 类型 → `chat/types/eventPayloads.ts`（**唯一跨域消费方**，即 B11 blocker）＋ `tasks/index.ts` 桶 ＋ `tasks/goal/*` 内部；`MermaidLintIssue` → `chat/types/eventPayloads.ts` ＋ `chat/ReActToolLoop.ts` ＋ `utils/mermaidLint.ts` 自身。⇒ **无任何 infra / service / core 消费方** ⇒ 落点 **core** 满足 §9.2 原则 3（落点层 ≤ 消费方最低层）。
- **recipe**：`src/types/goal.ts`（3 个 goal 类型）＋ `src/types/mermaid.ts`（`MermaidLintIssue`）；**原址再导出 shim**（`export type { … } from '@modules/types/…'`）—— 与 A′ 步 `Context` 家族同法，依 R05-013 口径「**再导出不计入冲突**」。
- **净差**：新增 `tasks → types` / `chat → types` / `utils → types` 三向**均为合法方向**（app→core / infra→core）⇒ **不新增任何跨层对**，`已豁免` **42 → 42**。
- **同名核验**：`src/types/**` 内**无**这 4 个名字的定义 ⇒ **R05-013 无冲突** ✓。
- **约定核验**：`@modules/types/<file>` 为仓内通行子入口（实测 **20 处**：`types/a2a` · `types/orchestrationEvents` · `types/tool.js` · `types/router` · `types/plugin.js` · `types/orchestrationSnapshot` · `types/agentEvents` …）✓。
- **✅ 已执行（2026-10-01，D-223 本批）**：新建 `src/types/goal.ts`（3 个 goal 类型）+ `src/types/mermaid.ts`（`MermaidLintIssue`）；原址三处**再导出**（`tasks/goal/TaskGoalStore.ts` · `tasks/goal/goalTemplates.ts` · `utils/mermaidLint.ts`）；`chat/types/eventPayloads.ts` 的 3 条导入（2 行 goal 词表 + 1 行问题项）改指 core ⇒ **该契约文件已成为「纯 core 引用」**（仅 `@modules/core` + `@modules/types/goal` + `@modules/types/mermaid`），**B11 blocker ②③ 已解除**。
  - **验证**：`typecheck 0` · `[类型中心] 32 → 36`（+4，与下沉数吻合）· `类型中心冲突 0`（再导出不计入）· `违规 0` · **`已豁免 42 → 42`（净差 0，与取证预测一致）** · 动态跨层引用 32（不变）· 碎片 0 · 警告 3（预存）· `bun test tests/tasks tests/chat tests/utils` = **814 pass / 0 fail**。

**前置项 P2：文件名去冲突 —— ⚠️ 实测 3 处，**多于**记录中的 1 处**

`chat/types/*` 迁入 `session/types/` 时的**同名文件**（Windows 大小写不敏感）：

| # | 冲突 | chat 侧 | session 侧 | 处置 |
|---|---|---|---|---|
| ① | `message.ts` ⟷ `Message.ts` | 领域消息模型（`Message`/`MessageStatus`…） | `UnifiedMessage` 家族（322 行） | `session/types/Message.ts` → **`UnifiedMessage.ts`**（导出名本就是 `UnifiedMessage`）⇒ **实测波及 46 文件 / 89 处**（取证时的"10 文件"只覆盖 `@modules/…` 形式，**漏计同模块相对路径与 `app/tests/`** —— 见下方执行记录） |
| ② | `session.ts` ⟷ `Session.ts` | `ChatSession` | `UnifiedSession`/`SessionType`/`SessionStatus` | `session/types/Session.ts` → **`UnifiedSession.ts`** ⇒ **同 ①（`session/**` 相对路径亦须改，见执行记录）** |
| ③ | `index.ts` ⟷ `index.ts` | chat 类型聚合桶 | session 类型聚合桶 | **同名无法并存 ⇒ 必须合并为一个 barrel**（非覆盖） |

- **①② 波及面（取证时低估；执行时全量实测 = 46 文件 / 89 处）**：跨模块 `@modules/session/types/*` 形式（10 文件：`channels/routing/messageRouter.ts`（动态）· `chat/ChatManager.ts` · `chat/services/ChatHelper.ts` · `chat/services/__tests__/ChatHelper.test.ts` · `voice/VoiceSession.ts` · `entrypoints/repl.ts`（动态）· `cli/handlers/sessionHandler.ts` · `runtime/InboxManager.ts` · `runtime/api/CoreAPIImpl.ts` · `tools/SessionsTool/SessionsTool.ts`（含 `import(...)` 内联型））＋ **`session/**` 内部相对路径**（`./types/*` · `../types/*`，覆盖 `storage/*` · `archive/*` · `platform/*` · `recovery/*` · `remote/*` · `gateway/*` 等 ≈ 27 文件）＋ **`app/tests/session/*` 8 文件** ＋ `scripts/lint-architecture.ts` 的 R05-013 例外路径串 ＋ `app/docs/核心模块/session-manager.md` 示例 ＋ 3 处注释路径提及（`core/types.ts` · `core/data-models.ts` · `state/session/types.ts`）。
  - ⚠️ **取证教训（方法论）**：上轮的「10 文件 / 2 文件」只统计了 `@modules/…` 形式的**跨模块**引用，**漏计同模块内相对路径**（`session/**` 自身）与 `app/tests/` ⇒ 这是"看起来面很小、实际波及 46 文件"的来源。**同类改名必须按文件名全仓 grep（含相对路径），不能只按 `@modules/` 前缀扫。**
- **P2 净差 = 0**：改名只动**路径**，不动分层 —— 消费方 `chat(app)` / `channels(service)` / `voice(service)` / `runtime(service)` / `tools(app)` / `cli(ui)` / `entrypoints(entry)` → `session(service)` **均为合法方向**（app/ui/entry→service 允许；service→service 同层）⇒ **不新增跨层对** ✓。
- **③ 的额外核验（barrel 合并前置）**：`chat/types` **桶**消费方实测 3 处 —— `compaction/autoCompact.ts:4`（`Message`）· `compaction/grouping.ts:9,10`（`Message` · `MessageRole`）· `docs/PluginDevGuide.ts:203`（该文件为**文档示例内容**，非真实 import）。⇒ 合并桶后须保证这些导出名仍在（两个桶的导出名实测**不重叠**：`Message`/`MessageRole`… 与 `UnifiedMessage`/`SessionType`…）。

**B11 本体（11 条）现状全表（实测，去重 `file × chat` = 11 ✓）**

| # | session 侧文件 | 取用符号 |
|---|---|---|
| 1 | `bootstrap/SessionSystemBootstrap.ts` | `ChatSession` |
| 2 | `compaction/ServiceAdapters.ts` | **装配值**（`@modules/chat` 桶，与 D-217 同型） |
| 3 | `hydration/SessionStateHydrator.ts` | `ChatSession` · `Message` |
| 4 | `reconcile/ReconcileService.ts` | `LiriEvent` |
| 5 | `SessionGateway.ts` | `LiriEvent` |
| 6 | `storage/EventMessageDeriver.ts` | `LiriEvent` · `LiriEventType` · `KNOWN_SESSION_EVENT_TYPES` |
| 7 | `storage/eventSanitize.ts` | `LiriEvent` |
| 8 | `storage/EventLogStorage.ts` | `LiriEvent` · `LiriEventType` · `isLiriEvent` · `KNOWN_SESSION_EVENT_TYPES` |
| 9 | `storage/MessageToEventMigrator.ts` | `LiriEvent` · `Message` · `MessageStatus` |
| 10 | `storage/SessionSummaryReader.ts` | `LiriEvent` |
| 11 | `storage/workflowRunProjection.ts` | `LiriEvent` |

**⇒ 裁定建议**
1. **P1 可立即执行**（净差 0 · 零同名 · 约定已核 · 4 个类型零出向依赖）；**P2 属机械改名 + barrel 合并**（~12 文件），可同批或紧随；
2. P2 完成后 **B11 本体**方可做（`chat/types/*` 迁 `session/types/`）⇒ **收益 `已豁免 42 → 31`（−11）**；
3. ⚠️ 两项均**不得顺手做**：P1 改的是类型落点（涉 4 文件定义 + 原址 shim），P2 涉 barrel 合并（③）—— 须各自独立成批并单独验收。

**✅ P2 执行记录（2026-10-01，D-223）**

- **改名**：`git mv` `app/src/session/types/Message.ts` → `UnifiedMessage.ts` · `Session.ts` → `UnifiedSession.ts`（**不在旧路径留 shim** —— 留转发会与迁入的同名文件再次冲突）；同步订正新 `UnifiedSession.ts` 内部的 `./Message.js` 引用。
- **引用更新**：**46 文件 / 89 处**；`git diff --stat` 为 **89 insertions / 89 deletions**（**完全对称**，佐证纯路径改名、无内容漂移）。
- **排除项（同名但不同文件，未误伤，已复核）**：`session/models/index.ts` 的 `./Session.js`（指向 `session/models/Session.ts`）· `components/ui/index.ts` 的 `./Message.js`（指向 `components/ui/Message.tsx`）· `chat/types/message.ts` / `chat/types/session.ts`（B11 的**迁入方**，不动）。
- **验证（本人独立复跑，非仅采信执行方）**：`typecheck` **exit 0** · **`已豁免 42`（不变）** · `违规 0` · `类型中心冲突 0` · `[Message 模型] 0`（R05-011 未受影响）· 碎片 0 · 警告 3（预存）· `bun test tests/session` = **289 pass / 0 fail**。
- **⚠️ P2-③（`index.ts` barrel 合并）不在本批**：两个 `index.ts` 只有在 `chat/types/*` **实际迁入** `session/types/` 后才同目录；若**提前**合并，会让 session 桶凭空新增 `session -> chat` 取用（**+1 已豁免**，方向倒挂）⇒ **③ 必须并入 B11 本体**（迁移同批完成）。
- **⇒ 现状**：B11 三处硬阻断的处置归位 —— **阻断 2/3**（`eventPayloads → @modules/tasks` / `→ @modules/utils/mermaidLint`）已由 **P1** 解除；**阻断 1**（文件名冲突）中 `Message.ts`/`Session.ts` 两项已由**本批**解除，仅剩 `index.ts`（P2-③）。⇒ **B11 本体可做**，预计 **`已豁免 42 → 31`（−11）**。

**✅ B11 本体执行记录（2026-10-01，方案 2′ · 由 A′ 修正而来）**

- **⚠️ 执行中发现的第 4 处硬阻断（此前三项之外）**：**chat 聚合桶与 session 桶不可合并** —— `session/types/UnifiedMessage.ts` 与迁入的 `session/types/message.ts` **各有一套值域不同的** `MessageType` / `MessageRole`；`export *` 遇同名项会被**静默排除（或取错一套）**，而 `compaction/grouping.ts:10` 正从 chat 桶取 `MessageRole` ⇒ 合并即「静默语义漂移」。**用户裁定先走 A′**（迁入子目录、**保留 chat 桶独立**）。
- **⚠️ 执行中发现的第 5 处阻断（A′ 落地后、提交前被 pre-commit 门禁拦下）**：eslint 自定义规则 `module-registry/no-direct-module-import` 的 **`types` 豁免只允许 `types/` 下「单层」** ⇒ `@modules/session/types/chat/message`（多一层）不再命中，**19 个 error** 全部落在**值导入**上（`import type` 被该规则豁免），集中于六类小写文件 `message` / `session` / `tool` / `checkpoint` / `eventPayloads` / `knownEventTypes`。**旁证（口径本就不一致）**：`lint:arch` 的 R03-002 **本就支持任意深度**（其 JSDoc 明写「类型子路径（*/types，**支持任意深度**如 `ai/models/types.js`）」）⇒ 两条门禁对同一概念的深度口径**原本就不一致**，A′ 只是把它撞了出来。**⇒ 用户裁定改走方案 2′（拍平）—— 未改任何门禁口径、未加任何白名单。**
- **实施（最终形态 · 方案 2′：拍平）**：`git mv app/src/chat/types/*`（**9 个文件**）→ **`app/src/session/types/`**（**拍平**，非子目录）：`events` · `eventPayloads` · `knownEventTypes` · `message` · `session` · `checkpoint` · `tool` · `ToolUseBlock` 直接落 `session/types/`；**聚合桶 `index.ts` 改名 `session/types/chat.ts`**（避开与 `session/types/index.ts` 同名；**裸聚合说明符 `@modules/session/types/chat` 保持不变** —— `types/chat/index.ts` 与 `types/chat.ts` 解析到同一说明符）；旧 `chat/types/` 目录删除；**9 文件内部相对导入零改动**（同目录关系不变）；`session/types/index.ts` **未动**（刻意不合并桶 —— 两桶各有一套**值域不同**的 `MessageType` / `MessageRole`，`export *` 同名会被静默排除）；**不新建任何 shim**。
- **引用更新**：说明符**统一收敛为 `@modules/session/types/<名>`**（**单层 `types/` 下**，回归仓内既有约定 `@modules/<mod>/types/<file>`），覆盖 `chat/**` · `session/**` · `query/**` · `compaction/**` · `subagent/**` · `tools/**` · `runtime/api/**` · `infrastructure/http` · `hooks/**` · `ink/**` · `commands/**` · `tasks/**` · `app/tests/**` 等，**合计约 120 个文件**（两轮累计：先 A′ 的 `types/chat/<名>` 收敛，再本轮的 `types/chat/<名>` → `types/<名>` 前缀重写）。
- **功能性耦合同步（3 处，缺一即回归）**：
  1. `scripts/lint-architecture.ts` **12 处** —— 含 **R05-011 的 `canonicalPaths`（L1357-1359）**，不改则迁移后的 `message.ts` 会被误判为"自定 Message 类型"（门禁回归）；另有 R05-011 / R05-013 两个 `knownExceptions` 清单与 3 处错误文案；
  2. `scripts/layer-exceptions.json` **1 处**（FSZ-036 超限文件登记的路径）；
  3. `app/tests/chat/eventTypeParity.test.ts:28` 的**硬编码读取路径** `join(REPO_ROOT, 'app/src/chat/types/eventPayloads.ts')`。
- **验证（本人独立复跑）**：`typecheck` **exit 0** · **`eslint src` = 0 errors / 46 warnings**（A′ 那 19 个 error 已清零）· **`已豁免 42 → 31`** · `违规 0` · `类型中心冲突 0` · **`[Message 模型] 0`**（**规范来源已正确显示 `session/types/message.ts`** ⇒ R05-011 无回归）· 碎片 0 · `lint:arch` 警告 3（预存）· `bun test tests/session tests/chat tests/tasks tests/http` = **967 pass / 0 fail**。
- **⚠️ 账目修正（−11 的构成，勿整体误记为 B11 收益）**：**42 → 31 = −11**，其中
  - **B11 本体 −10**：10 个 session 文件的目标模块由 `chat` 变为**同模块 `session`** ⇒ 该「文件 × 模块」对消失；
  - **子批 F 的 `runtime -> *` 桶 −1（非 B11）**：`runtime/api/CoreAPI.ts` 迁移前的**唯一** chat 依赖即 `@modules/chat/types/events`（`git diff` 实测该文件**仅此 1 行变化**）⇒ 改指后 `runtime(service) → session(service)` **同层合法**，其 `runtime -> chat` 豁免随之消失 ⇒ 子批 F 的 `runtime -> *` 余项 **7 → 6**。
- **⛔ B11 尚余 1 条未清**：`session/compaction/ServiceAdapters.ts:10-11` 的**装配值** `getCheckpointService` 取自 `@modules/chat` 桶（与 D-217 同型）—— 移类型文件治不了它，须**端口化**（B13 手法；且需先核 `CoreAPIImpl` 引 chat 是**动态**边 ⇒ 加同步门面可能净 0，须另做取证）。本批**刻意未动**（`git diff` 实测该文件为空）⇒ **B11 现状 = 11 → 1**。

**📌 口径说明（本次目录迁移的文档影响）**

- `chat/types/*` 的实际路径自本批起为 **`session/types/<file>`**（**拍平**；聚合桶为 `session/types/chat.ts`）；**新条目一律用新路径**。
- **本 spec 与其余 spec（`api-metrics-surface.md` · `architecture-benchmark-20260928.md` · `data-contract-unification.md` · `goal-entity.md` 等）中的既往条目保留当时的 `chat/types/...` 写法** —— 那些是**带行号/日期的同期证据记录**，文件内容与行号均未变、仅目录迁移，改写会破坏证据可追溯性。**功能耦合（门禁脚本 / 例外清单 / 测试硬编码路径）已全部同步，无遗漏。**

**📌 B11 余 1 条（`ServiceAdapters` 装配值）端口化取证（2026-10-01）**

**取用面实测（`session/compaction/ServiceAdapters.ts`）**：从 `@modules/chat` 只取 **2 个符号** ——
- **值** `getCheckpointService`（L10；唯一调用点 L82 `const checkpointService = getCheckpointService();`）
- **类型** `SessionCheckpointService as RealCheckpointService`（L9；仅用于 L50 构造参数类型 `constructor(private real: RealCheckpointService)`）

**真实取用面极窄**：适配器只用 **1 个方法** `real.createCheckpoint({ sessionId, autoCreated: true })`（L56），且只读返回值的 **2 个字段** `cp.id` · `cp.createdAt`（L60）。

**被调方签名（事实源）**：`chat/services/SessionCheckpointService.ts:42` → `createCheckpoint(params: CreateCheckpointParams): Promise<SessionCheckpoint>`；`session/types/checkpoint.ts:25-33` `CreateCheckpointParams`（**除 `sessionId` 外全可选**，含 `autoCreated?: boolean`）；`:4-14` `SessionCheckpoint.createdAt: **number**`。⇒ 投影可无损收敛为 **1 方法 + 2 字段**。

**净差判据（关键，决定可行性）**：`runtime/api/CoreAPIImpl.ts` **已静态导入 `@modules/chat`**（L100-106：`ChatManager`(type) + `createChatManager` 等值导入），且**其自身注释（L1938）明写**「👉 计数影响：`runtime -> chat` 对**已存在**（本文件已静态导入 `@modules/chat`）」⇒ **在同一文件再加一个 chat 符号，不产生任何新的「文件 × 模块」对** ⇒ 端口化 **净 = −1**（`session -> chat` 消失、零新增）✓ ⇒ **可收口 B11**。

**同步性约束**：`createWiredCompactionBridge()` 是**同步函数**（返回 `SessionCompactionBridge`，由 `SessionGateway` 构造函数 / 同步 fluent API 调用 —— 见 D-217 同款约束）⇒ 调用点 L82 在同步体内 ⇒ **必须用同步门面**，不可改 Promise 端口（与 B13 `getCheckpointCleanup()` 同手法）。

**拟实施（3 处，预期 `已豁免 31 → 30` ⇒ B11 归零）**
1. 新建 `runtime/api/sessionCheckpointPorts.ts`：`export interface SessionCheckpointRefPort { createCheckpoint(params: { sessionId: string; autoCreated?: boolean }): Promise<{ id: string; createdAt: number }>; }`
2. `CoreAPIImpl` 新增**同步**门面 `getSessionCheckpointRef(): SessionCheckpointRefPort` ⇒ 内部 `return getCheckpointService();`（静态 import，**零新增对**）。⚠️ `CoreAPI.ts` **无需改**（实测该文件**未**声明 `getCheckpointCleanup` ⇒ 无接口约束）。
3. `ServiceAdapters.ts`：**删除整条 `from '@modules/chat'` 导入**（**值 + 类型两个符号必须一并去掉** —— 只去掉值导入则该「文件 × 模块」对仍存在、计数不减），改用投影类型 + `getCoreAPI().getSessionCheckpointRef()`。

**验收**：`已豁免 31 → 30` · `typecheck 0` · `eslint src` = 0 errors · `lint:arch` 违规 0 · `bun test tests/session tests/chat tests/tasks` 0 fail · **B11 归零（11 → 0）**。

**✅ 已执行（2026-10-01）**：新建 `runtime/api/sessionCheckpointPorts.ts`（`SessionCheckpointRefPort`：**1 方法 + 2 字段**最小投影，带 MIT 头）；`CoreAPIImpl` 的 `@modules/chat` **值导入**追加 `getCheckpointService`（**同文件 × 同模块 ⇒ 零新增对**）+ 新增**同步**门面 `getSessionCheckpointRef()`（紧邻 `getCheckpointCleanup()`）；`ServiceAdapters.ts` **整条**删除 `@modules/chat` 导入（**值 + 类型一并**），改用投影类型与 `getCoreAPI().getSessionCheckpointRef()`。
- **验证（本人独立复跑）**：`typecheck` **exit 0** · **`已豁免 31 → 30`（恰 −1）** · `违规 0` · 碎片 0 · 警告 3（预存）· `eslint src` = **0 errors / 46 warnings** · `bun test tests/session tests/chat tests/tasks` = **891 pass / 0 fail** · **实测 `session/**` 对 `@modules/chat` 的引用 = 0** ⇒ **B11 归零（11 → 0）** 🎯

**📌 子批 F 尾批（`runtime -> app`）逐符号 sync/async 审计（2026-10-01）**

**实测清单**：`runtime/**` 的**静态** `service -> app` 对共 **7 条**（账面"余 6"系桶算差异，见门禁总账）。逐条定性：

| # | 对 | 定性 | 依据（实测） |
|---|---|---|---|
| 1 | `CoreAPIImpl.ts` × **tools** | **结构性必要（静态不可去）** | ① 构造函数内初始化：`this.converterEngine = … getConverterEngine()`（L319）· `this.fileTypeDetector = new FileTypeDetector()`（L320）· `this.toolManager = … globalToolManager`（L317）；② **同步**门面 `getToolManager(): ToolManager`（L5084）；③ 类型位 `ReturnType<typeof getConverterEngine>`（L277） |
| 2 | `CoreAPIImpl.ts` × **chat** | **结构性必要** | 构造函数 `this.chatManager = … createChatManager()`（L314）＋ **同步**门面 `getSessionCheckpointRef()`（本轮新增） |
| 3 | `CoreAPIImpl.ts` × **ai** | **结构性必要** | **同步**门面 `getGlobalEmbeddingManager()`（L1981，其注释自证）· `setSmartRouter`/`getSmartRouter` 的**类型位**（L348/L364）· 同步字段 `providerRegistry` |
| 4 | `CoreAPIImpl.ts` × **agent** | **✅ 可去（非必要）** | `getTitleGenerator` 的**唯一**使用点在 **async** 方法 `generateSessionTitle()`（L4851）内 ⇒ 无 sync 约束 |
| 5 | `CoreAPIImpl.ts` × **compaction** | **保留（已裁定的诚实代价）** | D-217：改归 app 后必需；其注释明写「清 4 增 1 ⇒ 净 −3，优于嵌入 chat 版的 −4」 |
| 6 | `CoreAPIImpl.ts` × **query** | ✅ **已清**（上一批：`FileCheckpointStorage` 下沉 `session/storage/`） | — |
| 7 | `CoreAPI.ts` × **tools** | ⚠️ **纯 `import type`（待裁定）** | L27 `import type { ConversionResult, FileInfo }`；`lint:arch` **计** type-only，而 eslint 规则明确**豁免** type-only（"类型导入无运行时依赖，不会导致循环依赖"）⇒ **两条门禁口径不一致** |

**⇒ 本轮处置：清 #4。**

- **改法**：按本文件**既有模式**（`getToolsPort()` 内 `await import('@modules/tools')`、`getKnowledgeOpsPort()` 内 `await import('@modules/knowledge/faq/FAQService')`）把该**唯一**取用点改为**方法内动态导入**。
- **计数**：**净 −1**（`已豁免 29 → 28`）；**R00-003 计数不变（仍 32）** —— 实测 `runtime -> agent` **本已在该清单中**（`getA2APort()` 等多处动态取用），本次只是把"静态那条"并入既有动态对。
- **附带收益**：模块**求值期**不再拉入 `@modules/agent`（**懒加载**）。
- **⚠️ 如实说明（口径边界）**：本处置**不改变依赖本身**，只把它从「已豁免（上桥 · 参与启动期求值）」转为「R00-003（可见但不上桥）」，与 D-217 `getToolsPort()` 的动态取用**同性质**，故沿用既有模式。**但不得据此把 #1/#2/#3 也"动态化"** —— 这三条被**构造函数初始化与同步门面刚性约束**，改了会破坏初始化语义（或须先重构装配方向，属 C1/C2 级风险）。
- **验证**：`typecheck 0` · **`已豁免 29 → 28`** · `违规 0` · `eslint src` = 0 errors / 46 warnings · `bun test tests/session tests/chat tests/tasks` = **891 pass / 0 fail**。

**尚未处置**：#7 待用户裁定（**门禁口径对齐** vs **2 个类型下沉 core**）；#1/#2/#3/#5 保留，均已在例外清单内（`service -> app`，`expiresAt 2027-04-18`）。

**📌 B14b 立项单 —— `session -> context`（B14）的净负收口路径（2026-10-01，D-222 续）**

**背景：同一条边、四次否决的完整记录**

| # | 尝试 | 否决原因 |
|---|---|---|
| 1 | 原「改归 `ai/` + `utils` + 原址转出」（D-222） | ① 13 符号转出枚举不全（9 处 `TS2305`）② 类型导出致**类型中心冲突** ③ 迁入 `ai/` 与 `ai/index.ts` 桶出口**同名**（`TS2300`） |
| 2 | **A′/B′/C′ 三步**（本日，**已提交、树全绿**） | ✅ **未被否决** —— 这是**去耦前提**，已就位：`Context` 家族 5 类型下沉 `src/types/context.ts`（`d934caf64`，`[类型中心] 27 → 32`）· `AsyncContextStorage` 迁 `utils/`（`b1afd463d`）· `SessionGateway.ts:17` 改指 infra（`ecb4e51c7`） |
| 3 | **D 步**：下沉 `ContextWindowResolver` 到 `utils/` | ❌ **净差判据否决** —— 该文件 L15 `import { ModelRegistry } from '@modules/ai'`（**app 耦合**）⇒ 迁 infra 新增 `utils -> ai` **+1**，与 `session -> context` **−1** 相抵 ⇒ **净 0** |
| 4 | **端口化**（`session` 经 CoreAPI 门面取 `resolveContextWindow`） | ❌ **亦净 0** —— 实测 `runtime/**` **静态** `@modules/context` 边 = **0**；端口方在 runtime 层，提供该能力必须**静态**导入 `@modules/context` ⇒ 新增 `runtime -> context` 配对 **+1** ⇒ 相抵（⚠️ R00-003 报告内的 `runtime -> context` 是**动态**导入，**不计入** `已豁免`，故不能"免费搭车"） |

**根因（唯一）**：这条边的**守卫者自身带 app 层耦合** ——
`context/window/ContextWindowResolver.ts:15` → `import { ModelRegistry } from '@modules/ai'`。
⇒ 它**既不能落 infra**（会引入 `infra -> ai`），**也不能被低层端口免费代理**（端口方同样必须静态引 app）。

**本单所要实施的唯一净负路径**：

1. **解除 `ContextWindowResolver` 的 `@modules/ai` 静态耦合**（把 `ModelRegistry` 的用法改为**端口化/注入化**获取模型窗口信息，例如经参数传入窗口查询函数，或经 `CoreAPI`/`AiOpsPort` 注入）⇒ 该文件变为**零 app 依赖**；
2. 然后 `git mv context/window/ContextWindowResolver.ts → utils/`（**13 符号全量**）+ 原址**再导出 shim**（R05-013 口径：再导出不计入冲突；既有 ~9 个 `context` 消费方 + `tests/context/*` **零改动**）；
3. `session/SessionGateway.ts:21` 改指 `@modules/utils/ContextWindowResolver` ⇒ **B14 整条边消失**。

**影响面 / 成本评估**：该文件 **13 个导出** · `context` 内 ~9 个消费方 · `tests/context/ContextWindowResolver.test.ts`（75 tests）；步骤 1 改的是**依赖获取方式**（结构性），非纯改名 ⇒ 需**独立成批**（预计 2–3 轮），**不得顺手做**。

**验收**：`已豁免 43 → 42` · `typecheck 0` · `类型中心冲突 0` · `R05-011 = 0` · `bun test tests/context` 全绿。

**✅ 执行记录（2026-10-01，本日）**

- **步 1–2（已提交 `d205013a7`）**：解除 `ContextWindowResolver` 的 `@modules/ai` 静态耦合 —— 同步取数改由 infra 级窗口缓存承担（`ModelRegistry` 在装载/刷新模型时**同步推入**，DB 仍为唯一事实来源）。
- **步 3（本批）**：`git mv context/window/ContextWindowResolver.ts → utils/`（13 符号全量）+ 原址**再导出 shim**（`context/**` 消费方 + `tests/context/*` **零改动**）；`SessionGateway.ts` 两条取用改指 `@modules/utils/ContextWindowResolver`。
- **⚠️ 关键发现（此前误判，已纠正）**：步 3 落地后 `已豁免` **仍为 43**（未降）。**根因**：`SessionGateway.ts` 的第三条 `session -> context` 边是**相对路径**类型导入 `'../context/types/Context'`（写相对路径而非 `@modules/context` ⇒ **长期未被识别**）；且计数口径为「文件 × **去重**目标模块」⇒ 该文件的目标模块 Set 本已含 `context`，故删除两条 `@modules/context` 导入**计数不变**。改指类型中心 `'../types/context'`（B′ 步已确立约定）后，该「文件 × 模块」对方才消失。
- **碎片回归（同批修复）**：步 1 新建的 `utils/ModelWindowCache.ts`（36 行 < 40）使 `utils/` 达 **3 个微文件** ⇒ 触发 R06-009-1 告警（3 → 6）。依规则建议**并入其唯一读取方** `utils/ContextWindowResolver.ts` 并删除原文件 ⇒ 碎片 **0**，告警回落 **3**（预存）。
- **验证**：`已豁免 43 → 42`（恰 −1）· `typecheck 0` · `类型中心冲突 0` · `违规 0` · 碎片 **0** · 警告 **3**（预存）· `bun test tests/context` = **75 pass / 0 fail**。
- **旁注（R00-003）**：动态跨层引用 **31 → 32**（`utils/ContextWindowResolver.ts` 的 `await import('../ai/...')`，仅上报、不计入 `已豁免`）。

**当前状态**：B14 **已清零** ✅（`已豁免 42`，与验收一致）。

---

**🔎 子批 F 其余 5 条 —— 首条落地 + 其余方案（D-222，2026-10-01）**

- **范围**：`session -> ai` ×2（B12）· `session -> query` ×2（B13）· `session -> context` ×1（B14）。
- **净差关键事实**：`CoreAPIImpl` **已静态导入 `@modules/ai`** ⇒ B12 走门面**零新增对**；但**未**引 `query`/`context` ⇒ 为 B13/B14 加门面会各 **+1** ⇒ 故 B14 走"改归"路线（见下）。
- **✅ B12 已落地（−2）**：新增 `runtime/api/embeddingPorts.ts#EmbeddingRefPort`（按调用方实读面最小投影：`embedOne(text)` / `embed(texts).embeddings`）+ `CoreAPIImpl` **同步**门面 `getGlobalEmbeddingManager()`（⚠️ 因 `getSessionMemoryManager()` 是**同步懒初始化** ⇒ 不可改异步；同 D-217 手法）；`SessionMemoryManager` 改引该投影、`extractPerTurn` 的轮次消息改**本服务自持最小契约** `TurnMessageLike`（实测该方法**全仓零外部调用方**，改本地契约零破坏面）；`SessionSystemBootstrap` 改经 `getCoreAPI()` 取句柄。
  - **验证**：`已豁免 46 → 44`（恰 −2）· `typecheck 0` · `lint:arch` 违规 0 / `R03-002` = 0 / 错误 0 警告 3（预存）· 改动文件 eslint 0/0 · `bun test src/session` = **27 pass / 0 fail**。
- **✅ B13 已落地（−1）**：新增 `runtime/api/checkpointPorts.ts#CheckpointCleanupPort`（实测两处取用**完全相同**：`(id) => new FileCheckpointStorage().deleteSessionCheckpoints(id)` ⇒ 只投影这 **1 个方法**，不做类替身）+ `CoreAPIImpl` **同步**门面 `getCheckpointCleanup()`（⚠️ 调用点在**同步回调**内（拼装 `SessionPruner` 选项）⇒ 不可改异步）；`SessionGateway` / `SessionManager` 改经 `getCoreAPI()`。该文件引 `../chat/types/checkpoint` ⇒ **app 耦合、不可下沉**（故非"改归"路线）。
  - **验证**：`已豁免 44 → 43`（"清 2 增 1 `runtime -> query`" ⇒ 净 −1）· `typecheck 0` · `lint:arch` 违规 0 / `R03-002` = 0 / 错误 0 警告 3（预存）· 改动文件 eslint 0/0。
  - **另注（既有重复类型，另册）**：`chat/types/checkpoint.ts:35` 与 `query/types.ts:81` **各有一份 `CheckpointStorage`**。
- **❌ B14 尝试后**回滚**（同日）—— 两条根因（均已复现，可复核）**：按"改归 `ai` + `utils` + **原址转出**"实施后，门禁/编译同时报错 ⇒ 已**干净回滚**（`git reset` + 按路径 `checkout`，未用 `reset --hard`；回滚后 `typecheck 0` / `已豁免 43` / 类型中心冲突 0 / 错误 0 警告 3）。
  1. **转出覆盖不全**：`ContextWindowResolver.ts` 实际导出 **13 个符号**（`ContextWindowInfo` · `resolveContextWindow` · `resolveContextWindowAsync` · `getEffectiveContextWindow` · `parseContextLimitFromError` · `parsePromptTokensFromError` · `isOutputCapError` · `calibrateContextWindow` · `getNextDegradationTier` · `validateMinimumContext` · `applyDegradationProbe` · `RecoveryDecision` · `decideOverflowRecovery`），另有 **`tests/context/ContextWindowResolver.test.ts`** 依赖其中 8 个 ⇒ 我按 3 个符号写的转出**直接编译失败**（9 处 `TS2305`）。
  2. **⚠️【结构发现 + 更正】冲突真因 =「下沉 `types/` 引入同名类型」，**不是**"原址转出/双桶导出"**：`context/types/Context.ts` 定义 **5 个 interface**（`Context` · `SessionContext` · `TeammateContext` · `UserContext` · `WorkloadContext`）⇒ 类型中心 `27 → 32`（+5）；而 `Context` 与 `docs/HelpSystem.ts:46`、`SessionContext` 与 `memory/types/SessionContext.ts:5` + `security/SecurityAudit.ts:135` **同名** ⇒ **`[类型中心冲突] 3 处（2 名）`，逐数吻合**。判定实现 `R05-013` 只扫**定义**（`export interface|type|class`）、**不扫再导出** ⇒ **shim / 桶转发根本不进该规则**，上一轮"「原址转出」+「类型导出」= 冲突"的结论**予以更正**（`LiriEvent` 等同型路线并不因此封死）。
  - **⇒ 处置口径（2026-10-01 用户裁定，已落 `scripts/lint-architecture.ts#checkTypeCenterDuplicates` JSDoc）**：① 往 `types/` 新增/迁移类型前**必须核同名**（`grep -E "export (interface|type|class) (名…)" app/src`）；② 命中 ⇒ **不得落 `types/`**，改落**非类型中心目录**（如 `utils/`）或登记 `knownExceptions`（优先前者）；③ 值/类型**均可原址转出**，受限的只有"往类型中心塞同名定义"。
  - **⇒ B14 修订版（口径落地后**解锁**，改动小）**：① `context/types/Context.ts` → **`utils/`**（非 `types/`，避开同名）+ 原址转出；② `context/AsyncContextStorage.ts` → `utils/` + 原址转出；③ `context/window/ContextWindowResolver.ts` → `ai/window/`，**保留原址转出但枚举全 13 个符号**（转出不触发 R05-013）；④ `CoreAPIImpl` 增同步门面 `getContextWindowOf(model)`（经 `@modules/ai`，零新增对）；⑤ `SessionGateway` 三处改引（`utils/` / 门面 / `utils/` 类型）⇒ **净 −1**。
  - **❌ 修订版实施后**再次回滚** —— 第三处阻断：`ai` 桶出口**同名冲突**（已记档，2026-10-01）**：修订版按上述 5 步实施，`typecheck` 报 **`src/ai/index.ts(59,3) TS2300: Duplicate identifier 'parseContextLimitFromError'`**（与 L156 冲突）。根因：**`ai/index.ts:152-158` 已从 `./ContextDegradation` 导出了同名的 `parseContextLimitFromError`**（**另一份实现**）。⇒ 若强行取用，`context/window/ContextWindowResolver.ts` 的转出会把消费方（`tests/context/ContextWindowResolver.test.ts` · `context/analytics/ContextStatsService.ts`）**静默指向另一份实现** ⇒ **行为漂移**，不可接受。
    - **⇒ 结论**：`resolveContextWindow` 系列迁 `ai/` 被**桶出口同名**封死 ⇒ **B14 维持挂起**（用户裁定"按乙挂起"），已第三次干净回滚（`git reset` + 按路径 `checkout`；回滚后 `typecheck 0` / `已豁免 43` / 类型中心冲突 0 / 错误 0 警告 3）。
    - **🆕 顺带发现（既有问题，另册登记）**：**`parseContextLimitFromError` 存在两份实现** —— `ai/ContextDegradation.ts`（经 `ai` 桶导出）与 `context/window/ContextWindowResolver.ts`（经 `context` 桶导出）⇒ 属 R02-002/重复实现范畴，须专项裁定"谁是事实源"。

**子批 E 建议顺序**：① **`ai` 组 5 条**（复用既有 `aiOpsPorts`，收益最大且不依赖数据契约）→ ② **`context` 组剩 1 条**（核 CoreAPI 既有方法）→ ③ `workspaces` 1 · `commands` 1（单点）→ ④ **数据契约专项后**再收 `chat` 6 + `tools` 类型位。

**🔎 `ai` 组深入取证（2026-10-01 D-209，逐符号）** —— 结论：**该组内部分化，不可整组同法**：

| 文件 | 符号 | 性质 / 处方 |
|---|---|---|
| `prompt/DiagnosticsReport.ts` | `getCachedTiktokenEncoder` | ✅ **已完成（D-212）**：`TiktokenEstimator.ts` 仅依赖 `monitoring`/`error`（infra）、**零 app 依赖** ⇒ 已 **改归 infra**（`utils/TiktokenEstimator.ts`，`ai/tokenizer/` 原址同名转出）⇒ 引用改**相对直连 infra**；⚠️ 不可落 core（净变差）；**零配置改动** |
| `prompt/SystemPromptReport.ts` | `getCachedTiktokenEncoder` + `estimateTokens` | ✅ **已完成（D-215）**：① `getCachedTiktokenEncoder` 改**相对直连 infra**（D-212 已下沉）；② `estimateTokens` 改经端口 `ai.estimateTokensOf`（D-214 所加）—— 因 `estimateTokensPrecise`/`generatePromptReport` 均为**同步**⇒ 给二者**加 `ai` 形参**并由唯一调用方 `PromptAssembler`（已持有 `ai`）下传 ⇒ `已豁免 57 → 55`（与下条同批 −2） |
| `compact/CompactService.ts` | 类型 `AIService`/`AIMessage` + 值 `AIMessageRole`/`AIModelType` | ✅ **已完成（D-215）**：改为**本服务自持的注入契约** `CompactAiMessage`/`CompactAiService`（最小结构面，仅 `generate`）⇒ **零端口、零 DTO**（因该服务由调用方注入、且消息本地构造）；`AIMessageRole` 以字面量 `'system'`/`'user'` 替代；⚠️ 实测 `AIModelType` 本就**未被使用**（死导入）。**🆕 顺带发现（未处理）**：全仓 grep 显示 `CompactServiceImpl.setAIService()` **从未被调用**（生产装配处 `ChatManager.ts:883` 为 `new CompactServiceImpl()` 无参）⇒ `generateAISummary` 的 AI 路径实际**恒走 `generateBasicSummary` 回退** ⇒ 属**预存"接线缺口"**（提请后续专项核；不影响本次收敛） |

| `compact/utils.ts` | `modelManager` | ✅ **已完成（D-213）**：实测为**死导入**（P1-3-b 已改走 `resolveContextWindow` 同事实源）⇒ 直接删除导入 ⇒ `已豁免 59 → 58` |
| `prompt/PromptAssembler.ts` | `buildSystemPrompt` · `modelManager` · `providerRegistry` · `estimateTokens` + 类型 `SystemPromptContext` | ✅ **已完成（D-214）**：`AiOpsPort` 追加 4 个**同步**方法（`estimateTokensOf` · `getCurrentModelId` · `resolveProviderIdByModel` · `buildSystemPromptText`）+ `SystemPromptContextDto`；端口**构造期**解析 `@modules/ai`；调用方在异步入口**取一次句柄后显式下传** ⇒ `已豁免 58 → 57` |

**🛠️ `PromptAssembler.ts` 端口设计（D-213 取证 → ✅ **D-214 已按此实施**，下列保留作沿革）**

**实测调用面**（符号 · 行号 · 同步性）：
| 调用点 | 性质 |
|---|---|
| `providerRegistry.getByModel(modelName).id`（L93-94，helper `resolveProviderFromModel` L90） | **同步**（外层有 try/catch 回退） |
| `modelManager.getCurrentModel()`（L338，helper `resolveModelContext` L336） | **同步** |
| `estimateTokens(content)`（L199 循环内 + L424） | **同步**（**不可改 await**） |
| `buildSystemPrompt(combined, {…})`（L282） | 同步纯函数（内含注入检测，**可能 throw**） |
| 类型 `SystemPromptContext`（L45，用于**导出**接口 `AssembleOptions`） | 类型位 |

**定义处**：`modelManager = ModelManager.getInstance()`（`ai/models/ModelManager.ts:283`，单例）· `providerRegistry = new ProviderRegistry()`（`ai/providers/ProviderRegistry.ts:238`，单例）· `buildSystemPrompt`（`ai/prompts/SystemPromptBuilder.ts:25`）· `estimateTokens`（`ai/tokenizer/TokenEstimator.ts:74`；⚠️ 该文件依赖 app 的 `ChatMessage` ⇒ **不可下沉 core/infra**）。

**✅ 「句柄只取一次」可行**：该文件已有**异步入口** `assembleSystemPrompt`（L130）· `assembleDefaultSystemPrompt`（L465）⇒ 端口在入口取一次即可，同步 helper 用**显式下传**的参数。

**扩展面（建议：**扁平追加**到既有 `AiOpsPort`，同域共用同一入口 —— CS01，不另立 `aiPorts`）**：
```ts
/** —— 追加进 AiOpsPort（**同步**方法：原调用点位于同步函数内，不可改为 await）—— */
estimateTokensOf(text: string): number;                       // 原 estimateTokens(text)
getCurrentModelId(): string;                                  // 原 modelManager.getCurrentModel()
resolveProviderIdByModel(model: string): { id: string } | null; // 原 providerRegistry.getByModel(model)（保留调用方 try/catch）
buildSystemPromptText(base: string, ctx: SystemPromptContextDto): string; // 原 buildSystemPrompt(...)
```
外加 **`SystemPromptContextDto`**（**最小投影**：7 个可选字段 `platform`/`provider`/`modelName`/`includeEnvironmentHints`/`includePlatformHint`/`includeModelGuidance`/`modelGuidanceMode`；最后一项**收宽为 `string`**）。

**⚠️ 设计取舍（建议 A）**：
- **A（建议）显式下传**：入口 `const ai = await getCoreAPI().getAiOpsPort();` → 传参给 `resolveProviderFromModel(modelName, ai)` · `resolveModelContext(ai)`，循环处用 `ai.estimateTokensOf(...)`（约改 4 处签名；确定性好、可测）
- **B（不推荐）模块级 current-port 变量**：改动最小但引入隐式状态（仅在调用深度 >2 时再考虑）

**⚠️ 类型位处理**：`SystemPromptContext` **不下沉 `types/`**（`types/` 已"刻意收缩"，见 [data-contract spec §0](./data-contract-unification.md)）⇒ 用**端口 DTO** + 实现侧边界收窄（`as never`，同 D-154/D-202 先例）；调用方传 DTO，`buildSystemPromptText` 实现内收窄。

**🔗 连带收益**：`estimateTokensOf` 亦可直接服务 **(c)** 的 `prompt/SystemPromptReport.ts`（同一符号）⇒ (b) 实施后 (c) 少一个待解符号。
**⇒ `ai` 组进度与再细分（2026-10-01 D-213 更新）**：**(a)** `DiagnosticsReport` ✅（D-212）→ **(b)** `compact/utils` ✅（D-213，死导入）+ `PromptAssembler` 🛠️ **设计完成待实施**（D-213）→ **(c)** `SystemPromptReport` 1 + `CompactService` 1（**待处理**：前者的 `estimateTokens` 将由 (b) 的 `estimateTokensOf` 一并解决；后者 2 类型 + 2 枚举需端口 DTO —— 因 `not下沉 types/`，见 data-contract spec §0）。
**⚠️ 既有 `AiOpsPort` 经核不覆盖本组**（其范围为 HTTP handlers 的 P1-P4 共 22 方法）⇒ 按该端口自述的规程（"**同域分阶段共用同一入口** `getAiOpsPort()`"）**扩充**即可，**不另立** `aiPorts`（CS01）。


**✅ D-208 首条已完成**：`services/mcp/MCPToolBridge.ts → context`（`dependencyRegistry` 早在 D-157 即下沉 core ⇒ 改**相对直连 core 模块根**）⇒ `已豁免 61 → 60`（恰 −1）· typecheck 0 · `lint:arch` 违规 0 / `R03-002` 0 · 改动文件 eslint 0/0。
⚠️ 同文件仍持 `@modules/tools`（`getToolManager` 值 + `Tool` 类型位）⇒ **`tools` 边未消**（须与类型下沉同批，故本轮**未**改 `getToolManager`，避免"改了不减计数"）。
⚠️ **测试盲区**：全仓 `*.test.ts` grep `MCPToolBridge` ⇒ **0 命中**（该文件无覆盖）。


### 3.6 子批 F —— `session -> *`(16) + `runtime -> *`(7) = **23**（**最高风险，最后做**）

`session -> chat`(11) 与 `runtime -> chat`(3) 位于**会话主链路 + PDCA 编排**（`SessionSystemBootstrap` · `ServiceAdapters` · `SessionStateHydrator` · `CoreAPIImpl`）⇒ 涉及启动时序与运行时装配（同前序 spec 子批 3 的 C1/C2 教训：**反转装配方向**风险最高）。
**手法**：优先**装配反转**（entry 装配后注入），退路才是 core SPI 端口。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 子批顺序取 `A → B → C → D → E → F` | 风险×改动量递增；A 虽量大但**机械**（纯搬文件），F 涉主链路 |
| D2 | 子批 A/B 取 **UI 归位**（迁出 app 模块）而非端口化 | 根因是**混合模块**（CS05）；端口化只是"合法化"错误归属，且要新增 SPI 契约 |
| D3 | `tools/**/UI.tsx` 的落点：**新建 ui 层模块** vs **并入 `components/`** | 待子批 A 取证后定；倾向新建（归属清晰、避免 `components/` 继续膨胀） |
| D4 | 子批 C 先做"**消费者仅 entry**"判定，**是则归位、否则端口化** | 同 D-80 已定方法论 |
| D5 | 子批 E 优先复核"**模块是否归错层**"（`compact` 等），再谈端口 | CS05：改归正确层比端口化更根因 |
| D6 | 子批 F 取**装配反转**为首选 | 同前序 spec D5（C1/C2）——"infra/service 主动装配 app"是方向性错误 |

---

## 5. 验收方案（**每子批各自执行**）

| 项 | 通过标准 |
|---|---|
| 静态 | `bun run typecheck` **0**；改动文件 `eslint` **0/0** |
| 门禁 | `bun run lint:arch` **0 错 / 2 警**；`已豁免` 递减数 **= 本子批消除条数**（按 D-171 口径：**文件 × 去重目标模块**）；不符合时按 T-③02 口径对照事实，不阻断 |
| 测试 | 定向子集 `bun test tests/<相关域>` **0 fail**；子批 F 另需**启动路径验证**（`entrypoints/init.ts` 调用顺序 + 日志） |
| 复核 | 每个被消桶附**独立 grep**：`app/src/<源模块>/**` 对目标模块的 import = **0**（注释除外；⚠️ **写收口注释时禁止复写 `from '@modules/…'` 字面**，否则门禁假阳性复活 —— D-162/D-172 已 3 次踩坑） |
| 未做（明确） | 其余 17 条（N3）· 门禁判定改动（N1）· 文件拆分（FSZ 专项） |

---

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 端口新增前先查 `core/spi/` 既有端口（`IBroadcastService`/`IHookChainPort`/`IAiAccess` 等 11 项）；**不重复立端口** |
| CS03 回退最小化 | ✅ 子批 A/B 的"归位"不留双份实现；无"以防万一"分支 |
| **CS05 根因优先** | ✅ 明确区分**装配错层**（C）· **真跨层依赖**（E/F）· **混合模块**（A/B），各自选对应手法，**不以端口化一律糊过去** |
| §1.3 无兼容包袱 | ✅ 归位不保留旧路径转发（消费方一次性改直连） |
| 门禁口径（D-171） | ✅ 全文按"文件 × 去重目标模块"表述，避免再次产生"计数偏差"假象 |

---

## 7. 风险与边界（如实）

1. **子批 A 是单点最大改动面**（47 个文件搬迁 + 其消费方）。若 47 个 `UI.tsx` 由 `tools` **自身注册表**装配，则"归位"需**同时**引入 ui 侧注册机制 ⇒ 成本高于预期，届时应走 D2 的退路并如实记账。
2. **子批 C 与 FSZ-* 超限例外重叠**：多个 handler 文件已超 1000 行；本 spec **不拆文件**，只动归属 ⇒ 不得把"归位"变成"顺手重构"。
3. **子批 F 涉启动时序**：`SessionSystemBootstrap` / `CoreAPIImpl` 是运行时装配核心，反转后**初始化时机变化**，必须做启动路径验证（前序 spec 子批 3 已给先例）。
4. **本 spec 不承诺一次性完成**：6 个子批可分批批准、分批交付。若只批 A，其余保持"待批准"。
5. **`已豁免` 计数只作辅助证据**（D-171 已定性为可预测，但 D-153/154/155/159/164 的历史残差仍在）⇒ 每子批以 **grep + 测试** 为独立证据。

---

## 8. 取证方法（可复现）

本 spec §1 的两张表来自 **门禁临时探针**（D-173）：在 `scripts/lint-architecture.ts` 的 `checkLayerCompliance()` 内临时聚合 `(源模块 -> 目标模块) → 计数 + 样例文件`，跑一次 `bun run lint:arch` 后**完整撤销**（`git status` 证明该文件无残留改动）。**不修改门禁判定**。

> 复现要点：探针只加在 `isException(...)` 命中分支内（即"已豁免"处），因此**输出天然等于** `已豁免 151` 的分解；两次探针（D-172 分桶、D-173 逐对）合计均与门禁 `已豁免` 逐数吻合 ⇒ 口径自洽。
