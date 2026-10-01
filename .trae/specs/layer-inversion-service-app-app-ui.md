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

### 3.1 子批 A —— `tools -> ink` **47**（最大桶；混合模块拆分）

**现状**：`app/src/tools/**/UI.tsx` 型文件 47 个，直接 import `@modules/ink`（ui 层终端渲染）。

**首选手法：UI 归位** —— 把 47 个 `UI.tsx` 迁出 `tools`，归入 **ui 层**（候选落点：新建 ui 层模块 `toolViews/`，或并入既有 `components/`），`tools` 只保留**业务与渲染器注册契约**。

**⚠️ 动手前必须取证（决定"归位"还是"端口化"）**

1. 这 47 个 `UI.tsx` 的**消费方是谁**：`tools` 自身的注册表？`commands`？`ink` 的渲染循环？（grep `UI.tsx` 的 import 面 + 动态解析表）
2. `tools` 是否已有"tool → UI 组件"的**映射契约**（如 `ToolRegistry` 内带 render）；若有 ⇒ 可端口化为 **ui 侧注册**（`ToolUiRegistry`），`tools` 不再 import ui。
3. 47 个文件里是否混有**非 UI 内容**（业务/类型）——需逐文件判，禁止整体搬迁携带业务。

**退路（若归位成本过高）**：ui 侧注册渲染器 + `tools` 经 **core SPI** 取（属"合法化"，非首选，须在台账写明理由）。

**验收**：`tools` 桶清零（`app -> ui` 64 → 17）；`grep -r "@modules/ink" app/src/tools` = **0**；`bun test tests/tools/` 0 fail。

### 3.2 子批 B —— `app -> ui` 其余 **17**（`knowledge`10 · `commands`4 · `buddy`2 · `docs`1）

- `knowledge/components/*.tsx`（10）与 `buddy` 的 2 个 `.tsx`：同 A（UI 归位）。
- `commands -> ink`(2) / `commands -> ui`(2)：`CommandUI.tsx` / `StatusUI.tsx` 归位；`theme/Theme.ts`、`tools/remote/remote-session.ts` 需**先判**是 UI 还是误报/类型位。
- `docs -> ui`(1)：`docs/HelpSystem.ts`（**1106 行**，已挂 FSZ-048 超限例外）⇒ **先取证**其 UI 部分占比；若 UI 与数据强耦合，可拆出 `help/ui/` 子域归 ui 层，**不得**因消边而制造 2000 行巨型文件。

**验收**：`app -> ui` 桶清零（64 → 0）；`docs`/`commands`/`knowledge`/`buddy` 在 R00-001 的 `app -> ui` 方向归零。

### 3.3 子批 C —— `infrastructure -> app` **19**（装配本体错层）

**判定前提（先取证，再动手）**：核 `infrastructure/http/handlers/**` 的直接消费者是否**仅 entry**（`LocalHTTPService` / `HttpServerSetup` / `routes/*`）：
- 若是 ⇒ **物理归位**（handlers 移入 entry 层或 `runtime/`），同 D-80 判定；
- 若 handlers 同时被 service 内部消费 ⇒ 手法改为**端口化**（core SPI）。

**⚠️ 与 FSZ-* 冲突提示**：多个 handler 文件正挂着**文件大小例外**（`skills-handlers.ts` 1582 行 · `knowledge-handlers.ts` 1759 · `session-handlers.ts` 1012 等）⇒ 本子批**只动归属与 import**，**不顺手拆文件**（拆分属另一专项）。

### 3.4 子批 D —— `service -> app` 低风险 **8**（`channels`4 · `mcp`2 · `bridge`1 · `voice`1）

- `channels -> context`(2) / `-> ai`(2)：`ChannelBootstrapper`（装配缝，候选归位 entry 或端口化）· `ChannelRegistry` · `GatewaySessionTracer` · `messageRouter`。
- `mcp -> tools`(1) / `-> tool`(1)：`mcp/MCPTool.ts`（同 D-67 的 `mcp` 归 service 判断需复核：此处是"service 依赖 app"）。
- `bridge -> workspaces`(1) · `voice -> tools`(1)：单点。

### 3.5 子批 E —— `services -> app` **20**

`services/compact/**`（压缩编排）与 `services/mcp/**`（工具桥）为主：
- 逐个判"**是不是被依赖的 app 能力**"：如 `compact` 依赖 `chat`/`context`/`ai`，若其**编排语义属 app** ⇒ 候选**改归 app 层**（同 D-67/D-84/D-120 的"改归正确层"），比端口化更彻底。
- 剩余真跨层的 ⇒ core SPI 端口。

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
