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

**✅ 第一步已完成（2026-10-01 D-186）：`SandboxPermission` 4 条 —— 零成本手法**

- **发现（取证）**：`SandboxPermission` **早已是 core 叶子**（`core/sandboxPermission.ts:22 export enum`），且**仓库已有现成先例**：`permission/PermissionService.ts:36` 以**相对路径直连 `'../core/sandboxPermission.js'`**。
- **手法（比端口化更省）**：把 4 个 handler 的 `@modules/sandbox`（app 层）改为 **相对直连 core 模块根** —— `LocalHTTPService.ts:31` · `knowledge-handlers.ts:14` · `file-upload-handlers.ts:32` · `memory-handlers.ts:16`。**零新文件、零白名单、零端口**。
- **验收（与预测逐数吻合）**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 95 → 91`（恰 −4）** · **`R03-002` = 0**（**实证：core 的「模块根文件」相对路径不触发 R03-002** —— 与子批 A 踩到的「模块**子目录**文件」不同）· 改动文件 `eslint` **0/0** · `bun test tests/http tests/infrastructure tests/memory` = **162 pass / 0 fail**。
- **未改**：`handler-utils.ts`（它同时 import `globalWorkspaceManager`(值) ⇒ 改枚举**不减计数**）· `sandbox-handlers.ts`（纯值 ⇒ 需端口，归第 ② 步）。
- **剩余 15 条**：`chat` 4 · `sandbox` 2（值）· `tools` 4 · `agent` 4 · `auto-reply` 1 ⇒ 按上文 ②③ 步继续。

**🔎 第二步取证（2026-10-01 D-187）：`agent` 2 条为「2 个符号之遥」，暂不划算**

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
**④ 其余 3 条同法**（`video-task-handlers` 须先读其 `getVideoTaskPersistence()` 的**全部**调用面再定端口方法；`agent-role-handlers`/`agent-control-handlers` 同理）。

**⚠️ 与 FSZ-* 冲突提示**：多个 handler 文件正挂着**文件大小例外**（`skills-handlers.ts` 1582 行 · `knowledge-handlers.ts` 1759 · `session-handlers.ts` 1012 等）⇒ 本子批**只动 import 与端口**，**不顺手拆文件**（拆分属另一专项）。

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
