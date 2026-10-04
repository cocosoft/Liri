# Spec：分层倒挂收口 —— `memory` / `chronos` / `system` 三组（10 条边）

> 版本 1.0 ｜ 创建 2026-10-01 ｜ 状态：**待批准**
> 状态复核（2026-10-04）：状态头 stale——§3.0/§3.2.1/§3.3.1 显示 10 条边全部消除；仅 MemoryHookDispatcher 零消费者待裁定。
> 来源：`pending-tasks-consolidated-20261001.md` §1 ① **T-①10**；边清单来自 **D-158**（门禁探针实测的 `infra` 源全量权威清单）
> 前序：D-159 `oauth` · D-160 `performance` · D-161 `monitoring` · D-162 `config`（假阳性）· D-163 `state` 已完成 ⇒ `infra` 源 **17 → 10** 条边
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ CS03（回退最小化）/ **CS05（根因优先）** / §1.3（无兼容包袱）

---

## 1. 范围与现状（均为实测取证）

`D-158` 清单中 `infra` 源剩余 **10 条边**，全部落在本 spec 三组内：

### 1.1 `system` 组（3 边，**全为 type-only**，最易）

| # | 文件 | import | 形式 |
|---|---|---|---|
| S1 | `system/state/AppState.ts:11` | `MCPServerConnectionInfo` / `ServerResource` ← `@modules/mcp/types/index.js` | **type-only** |
| S2 | `system/state/AppState.ts:12` | `LoadedPlugin` ← `@modules/plugins/types/PluginTypes.js` | **type-only** |
| S3 | `system/state/types.ts:77` | `export type { TaskState } from '@modules/tasks/types'` | **type-only（re-export）** |

### 1.2 `memory` 组（4 边，**1 值 + 3 类型位**，且牵连历史重复）

| # | 文件 | import | 形式 |
|---|---|---|---|
| M1 | `memory/MemoryHookDispatcher.ts:9` | `HookChainManager` ← `@modules/hooks` | **值**（且用其返回值的 `result.before` 判阻断） |
| M2 | `memory/services/UnifiedSearchService.ts:1-4` | `KnowledgeRoute` / `IKnowledgeSearch` ← 相对 `'../../docs/knowledge-types'` | **type-only** |
| M3 | `memory/services/KnowledgeBaseWriter.ts:8` | `sanitizeFileName` ← `@modules/services/file/fileNaming` | **值**（该工具全仓 **16 个消费方**） |
| M4 | `memory/services/MemorySummarizer.ts:2` | `MemoryQueryResult` ← `@modules/services/prompt/MemoryPromptProvider` | **type-only** |

**纠缠（必须先判）**：`memory/services/KnowledgeBaseWriter.ts` 被 `memory/services/AutoMemoryService.ts:18` **type-only** 引用；而 app 侧 `knowledge/KnowledgeBaseWriter.ts` 头注自述"**迁移自 `memory/services/KnowledgeBaseWriter.ts`**" ⇒ **疑似历史重复实现**。若 memory 侧确认零**值**消费者 ⇒ 可整体删除（顺带消 M3）。

### 1.3 `chronos` 组（3 边，**全为值依赖且方向性错误**，最难）

| # | 文件 | import | 形式 |
|---|---|---|---|
| C1 | `chronos/maintenance/ChronosBackgroundHousekeeping.ts:10` | `initBuddyDreamIntegration` / `initBuddyTaskGrowthIntegration` / `initBuddyCronFeedbackIntegration` ← 相对 `'../../buddy/dreamIntegration'` | **值** |
| C2 | 同文件 `:11` | `DreamEngine` ← 相对 `'../../dream/DreamEngine'` | **值** |
| C3 | `chronos/TaskResultDeliverer.ts:8` | `channelRegistry` ← `@modules/channels` | **值** |

⚠️ C1/C2 的根因是**方向性错误**：`infra` 层在**主动初始化上层模块**（buddy/dream 的集成装配），而非消费其能力。

---

## 2. 目标 / 非目标

**目标**：按 `system → memory → chronos` 顺序分 3 个子批消除上述 10 条边，每子批独立可交付、可回退。

**非目标**

- N1：不改 `lint:arch` 判定与 `allowedDependencies`；例外清单不新增、不续期。
- N2：不动 `core` 的既有 SPI 契约，**除 M1 那一处**（且只做**向后兼容的返回值扩展**：现为 `void`）。
- N3：不重构 `memory`/`chronos`/`system` 三个模块的内部结构（仅动被边牵连的 import 与必要的最小搬迁）。
- N4：不处理 `service → app` / `app → ui` 等其他桶（属 T-①10 的后续批次）。
- N5：不新增 HTTP/IPC 端点、不新增事件类型（除 C3 若走既有 `SystemEvents`）。

---

## 3. 设计

### 3.0 ⚠️ 子批 1 的设计更正（2026-10-01 取证后，用户裁定方案 A）

**原 D2（S1/S2 最小结构镜像）与 D3（S3 下沉类型到 core）均作废。** 取证结论：

- `AppState.ts` 对 `MCPServerConnectionInfo` / `ServerResource` / `LoadedPlugin` / `TaskState` 的用法是**纯字段位**（`mcp.clients` / `mcp.resources` / `plugins.enabled` / `tasks[taskId]`），**`AppState` 自身不读这些字段**，只做容器。
- 因此"最小结构镜像"只能写成**全量复制**（下游字段并集）= 两份事实源（违 CS01）；D3 的"下沉类型"也只是给"位置错了"打局部补丁。
- **真根因 = 分层归属错误**：`system`(infra) 里放着一个 **app 级状态容器**。实测其消费方**全部是 app/entry（+同模块）**：`buddy/CompanionSprite.tsx` · `ai/AIStateSyncService.ts` · `hooks/notifs/use{PluginInstallation,TaskCompletion,Startup}Notification.ts` · `entrypoints/mcp.ts` · `system/state/*` 自身；`types/index.ts` 仅**注释**提及。**无任何 infra/service/core 消费者**。

**D2'（用户裁定「方案 A」）：把 `AppState` 家族由 `system/state/`（infra）整体改归 app 层** —— 与既有 **D-84**（`hooks` ui→app）· **D-67**（`mcp` core→service）· **D-120**（`modules` core→app）同属"文件/模块改归正确层"的手法。⇒ S1/S2/S3 **三条边一次全消**（变为 app→app），不镜像、不下沉类型、不动 core 契约。

**执行清单（可机械照做，按序）**

| # | 步骤 | 要点 |
|---|---|---|
| 1 | 确认搬迁范围**仅 AppState 家族** | `system/state/AppState.ts` · `AppStateStore.ts` · `PYAppStateStore.ts` + `system/state/index.ts` 中**属于它们的出口**。⚠️ **不要**整目录搬迁：`system/state/` 还承载 auth/i18n/theme 等**真 infra** 能力（`system` 的存在意义），整体搬会制造新的 infra→app 边 |
| 2 | 定目标目录 | 建议新建 app 层目录 `app/src/appState/`（全新模块 ⇒ 需在 `scripts/modules-to-layers.json` 的 `modules` 中登记 `"appState": { "layer": "app" }`，并写 `description` 说明沿革） |
| 3 | 迁移 3 文件 + 更新 `system/state/index.ts` | 该 `index.ts` **不得**再转出已迁走的符号（否则 `system` 桶转发 app ⇒ 又一条 infra→app 边）。若仍有消费方经 `@modules/system/state` 取 `AppState`，一并改为直连新路径 |
| 4 | 更新全部引用点（实测 6 处） | `buddy/CompanionSprite.tsx` · `entrypoints/mcp.ts` · `ai/AIStateSyncService.ts` · `hooks/notifs/*`（3） + `system/state/{PYAppStateStore,AppStateStore,index}.ts` 内部相互引用 |
| 5 | 门禁 | `bun run lint:arch`：期望 `已豁免` **162 → 159**（−3，恰为 S1/S2/S3）；`R00-001` 违规 0；`R03-002` 若出现新子路径违规，按已有机制处理（新目录有 `index.ts` ⇒ 走桶出口即可） |
| 6 | 类型/测试 | `bun run typecheck` **0**；改动文件 `eslint` **0/0**；`bun test tests/`（CI 口径）**0 fail**（重点回归 `hooks`/`buddy`/`ai` 相关用例） |
| 7 | 复核 | grep：`app/src/**` 内对 `system/state/AppState` 的引用 = **0**（注释除外）；`AppState` 家族不再出现在 `system/` 下 |
| 8 | 记录 | 台账新增 D-164（含"为何不镜像/不下沉"与 D2'/D3 作废理由）；更正本 spec §3.1/D2/D3 |

#### 3.0.1 交接状态（2026-10-01，新会话从此处起步）

- **起始基线**（动手前请先跑一次 `bun run lint:arch` 复核）：`已豁免 162` / 违规 **0** / 错误 **0** 警告 **2**（仅既有 R07-004 + R00-003）；`allFiles 3991`。**预期终点**：`已豁免 159`（−3）。
- **唯一待确认项（需用户拍板）**：目标目录取 ① 新建 `app/src/appState/`（推荐：归属清晰，需登记 `modules-to-layers.json`）还是 ② 并入既有 app 模块（`modules/`、`hooks/`：改动面更小）。
- **本子批未包含**：`memory`（子批 2）与 `chronos`（子批 3）—— 两者根因与 `system` 无关，除非用户同时批准，否则**不要顺手改**。
- **前序沿革**：`infra` 源边数 **17 → 10** 由 D-159(`oauth`2) · D-160(`performance`2) · D-161(`monitoring`1) · D-162(`config`1，实为注释假阳性) · D-163(`state`1) 完成；本子批完成后为 **7**（余 `memory`4 + `chronos`3）。
- **证据口径提醒**：`已豁免` 计数**不可作为唯一证据**（D-153/154/155/159 四次偏差；我提出的"按模块对计数"假设已被 D-160 证伪）⇒ 每步以 **grep 复核 + `bun test tests/`** 为准。

### 3.1 子批 1 —— `system`（3 边，全 type-only）〔**已被 §3.0 取代，保留供对照**〕

| # | 手法 | 说明 |
|---|---|---|
| S1/S2 | **最小结构镜像** | `AppState` 只读这些类型的**部分字段** ⇒ 在 `system/state/` 内声明最小的本地结构类型（既有手法，同端口 DTO 实践：`TaorLoopPort` / `ResearchOrchestrationConfigDto`）。**不**下沉 mcp/plugins 的类型到 core（那会把 app 域类型污染 core）。 |
| S3 | **复用 D-163 落点** | `TaskState` 依赖 `TaskType` + `TaskStatus`（后者已落 `core/taskStatus`）⇒ 建议把 `TaskType`（字符串枚举，**值**）与 `TaskState`（接口）**同源下沉** `core/taskStatus.ts`（或同址新 `core/taskTypes.ts`），`tasks/types.ts` 继续转出（消费方零改动），`system/state/types.ts` 改直连已入白名单的 core 子路径。 |

- **验收**：`infra` 源 10 → 7；`system` 模块在 R00-001 下**归零**。
- 风险最低：S1/S2 只改类型声明；S3 与 D-163 同法（含"先 import 再 export"的既有坑）。

### 3.2 子批 2 —— `memory`（4 边）

| # | 手法 | 说明 |
|---|---|---|
| 前置 | **取证 `memory/services/KnowledgeBaseWriter.ts` 的活消费者** | 若仅 `AutoMemoryService` 的 **type** 引用且该类型可由 app 侧 `knowledge/KnowledgeBaseWriter` 提供 ⇒ **删该文件**（CS01），M3 边**随之消失**（零成本）。若仍有值消费 ⇒ 走 M3 的搬迁方案。 |
| M3 | **物理归位** `sanitizeFileName` | 该函数是**通用文件命名工具**（16 消费方，横跨 app/service/infra）⇒ 归位 `utils/`（infra，同 D-161 的 cron 先例）；`services/file/fileNaming` 保留转出以免 16 处齐改（若门禁"僵尸转发"判定通过），否则逐点改直连。 |
| M2/M4 | **类型位**：优先**转移持有方** | `MemoryQueryResult` 只被 `memory` 消费 ⇒ 可移交 `memory/types/`（infra），由 `services/prompt` **反向引用**（service→infra 合法 ✓）；`KnowledgeRoute`/`IKnowledgeSearch` 由 `docs` 定义且被多方实现 ⇒ 用**最小结构镜像**（只声明 memory 实际读取的字段）。 |
| M1 | **扩展既有 SPI（唯一动 core 契约处）** | `IHookChainPort.execute` 现返回 `Promise<void>`，丢掉 memory 需要的 `result.before` 阻断语义 ⇒ 扩为返回最小投影 `{ blocked: boolean }`；实现在 `entrypoints/spiWiring.ts` 处由 `result.before` 投影；**cost 侧忽略返回值（零改动）**。 |

- **验收**：`infra` 源 7 → 3（若前置判定为"删文件"，则 M3 不出现在改动里）。
- ⚠️ 风险点：M1 动 core 契约 ⇒ 需同时核 `spiWiring` 的 `as never` 收窄处与 cost 的现有调用；M3 的 16 消费方需 grep 全量确认。

#### 3.2.1 交接状态（2026-10-01，新会话从此处起步）

- **起始基线（已更新，2026-10-01 **D-167** 后）**：`已豁免 157` / 违规 **0** / 错误 **0** 警告 **2**；`allFiles 3992`；分层映射 **85** 个模块。**终点（D-168 达成）**：`已豁免 156` ✓ ⇒ **本子批（`memory` 4 条边）全部完成**，`infra` 源 **4 → 3**（⚠️ 2026-10-01 口径纠正：原写"5 → 4"，与台账链 `6→5→4→3` 及本 spec §3.2 验收"`infra` 源 **7 → 3**"矛盾，已改）。
- **✅ M4 已完成（D-166，`925fb86d4`）**：`MemoryQueryResult` 随域**下沉 `memory/types/MemoryQueryResult.ts`**，`services/prompt` 改为反向引用（service→infra 合法，且是该文件既有做法）。全仓仅 2 处引用 ⇒ 零涟漪。
- **✅ M2 已完成（D-167，`4d1e43212`）**：**未采用 spec 原计划的"最小结构镜像"** —— 取证后发现 `docs/knowledge-types.ts` 含 3 个互引类型（`KnowledgeRoute` + `KnowledgeRouterOptions` + `IKnowledgeSearch`）且**零 import、纯类型** ⇒ 镜像等于复制 3 个类型（两份事实源，违 CS01）；改为**下沉 `core/knowledge-types.ts`**（同 D-163 手法），原址 `docs/knowledge-types.ts` 保留为**转出**（既有多处消费方零改动），并把 `core/knowledge-types` 登记 `canonicalEntryKeys`。
- **✅ 第一步（前置判定 + M3）已完成（D-165）**：`memory/services/KnowledgeBaseWriter.ts` 判定为**孤立的历史重复实现**（app 侧 `knowledge/KnowledgeBaseWriter.ts` 头注自述迁移自它、全仓零值消费者），且其唯一消费者 `AutoMemoryService` 的 `knowledgeBaseWriter` 能力**整条未接线**（构造只传 1 参 · setter 零调用方 · 工厂零调用方 ⇒ 分支永不执行）⇒ **按 CS01/CS05 删死代码**（+11/−214 行），**M3 边消失**，`sanitizeFileName` 的物理归位**未启用**（16 消费方的改动面已避免）。
- **✅ M1 已完成（D-168）**：`IHookChainPort.execute` 由 `Promise<void>` 扩为最小投影 `Promise<HookExecuteResult>`（`{ blocked: boolean }`，本子批**唯一动 core 契约处**）；`entrypoints/spiWiring.ts` 实现侧自 `result.before` 投影"失败或阻止继续"；`cost` 侧忽略返回值 ⇒ **零改动**；`memory/MemoryHookDispatcher.ts` 4 处调用点（`preSave`/`postSave`/`preLoad`/`postLoad`）改经 `resolveHookChain()`。**实测**：`已豁免 157 → 156` ✓、`infra` 源 **4 → 3**（`memory` 组清零）。**取证明细见下 §3.2.1.1 的 M1 条**。
- **🟡 M1 取证时的顺带发现（超本批范围，登记备查，**需用户裁定**）**：`MemoryHookDispatcher` **全仓零消费者**（含 `app/tests/**` 与 `app/scripts/**`）、**未从 `memory/index.ts` 转出**，且全仓 `execute('memory', …)` 调用点**仅在它自己**（4 处）⇒ hook 域 `memory` 当前**从不触发**（`hooks/core/CoreHooks.ts:266-317` 的 `memory.pre-save/post-save` 注册因此无实际效果）。本次按 **D4** 保留能力并使其层合规（**零运行时行为变化**）；若判定"不打算接线" ⇒ 该文件可整体删除，届时 **M1 亦无需动 core 契约**（详见台账 D-168）。
##### 3.2.1.1 剩余三条的取证明细（2026-10-01 实测，供直接开工）

- **M1**（`memory/MemoryHookDispatcher.ts:9` → `HookChainManager` ← `@modules/hooks`）
  - **用法（决定改法）**：`this.hookChainManager = HookChainManager.getInstance()`；随后 `const result = await this.hookChainManager.execute('memory', { event, data, sessionId })`，再 `for (const hookResult of result.before) { if (!hookResult.success || hookResult.preventContinuation) return { allowed: false } }` ⇒ **必须拿回返回值**，故不能直接换成现 `IHookChainPort`（现契约 `Promise<void>`，会丢掉阻断语义）。4 处调用点：`preSave` / `postSave` / `preLoad` / `postLoad`。
  - **现 SPI 实现处（需同批改）**：`entrypoints/spiWiring.ts:399-401` —— `execute: async (hookName, payload) => { await hookChainManager.execute(hookName, payload as never); }`（返回值被丢弃）。
  - **建议改法**：`IHookChainPort.execute` 返回最小投影 `{ blocked: boolean }`（由实现侧对 `result.before` 投影）；`cost` 侧 `await resolveHookChain().execute(...)` **忽略返回值 ⇒ 零改动**（现有调用形式不变）。
- **M2**（`memory/services/UnifiedSearchService.ts:1-4` → 相对 `'../../docs/knowledge-types'`，**type-only**：`KnowledgeRoute` / `IKnowledgeSearch`）
  - **建议**：最小结构镜像（只声明 memory 实际读取的成员）。⚠️ 先核该文件的**实际成员访问**再定镜像字段（已观察到 L106-L113 读 `route.score` / `title` / `snippet` / `docPath` / `category` / `matchType` 等）。
- **M4**（`memory/services/MemorySummarizer.ts:2` → `MemoryQueryResult` ← `@modules/services/prompt/MemoryPromptProvider`，**type-only**）
  - **全仓仅 2 处引用**：定义 `services/prompt/MemoryPromptProvider.ts:8` + 消费 `MemorySummarizer.ts:2`（另有 `:32` 作返回类型）。
  - **建议**：**移交持有方** —— 类型下沉 `memory/types/`，由 `services/prompt` **反向引用**（service→infra 合法 ✓），无需镜像、无需端口。

- **⚠️ 继承本会话已踩的坑（务必避开）**：
  1. **别名形态别漏**：本仓同时存在 `@modules/<mod>/...`、相对路径、**以及 `@modules/state/...` 这类占用别名**三种写法 —— D-164 因漏检别名形态导致 `typecheck` 报 4× `TS2307`。**改 import 前后各 grep 一遍全形态**。
  2. **新增目录要三处同改**：`tsconfig.json` 的 `paths`（`@modules/*` **不是通配符**，必须显式登记）+ `scripts/modules-to-layers.json`（否则门禁未映射 = **假绿**）+ 消费点。
  3. **`已豁免` 计数不可作唯一证据**：已累积 **5 次**偏差（D-153/154/155/159/164）⇒ 每步以 **grep 复核 + 测试**为准。
  4. **全量 `bun test` 有偶发长耗时**（近 3 批均遇，>4 min）⇒ 遇阻时改跑**定向子集**（如 `tests/memory tests/system ...`）并说明；**不要**把它当成改动引入的挂起。
- **范围**：本子批**不含** `chronos`（子批 3，涉启动时序反转，风险最高）。

### 3.3 子批 3 —— `chronos`（3 边，**需装配反转**）

| # | 手法 | 说明 |
|---|---|---|
| C1/C2 | **反转装配方向** | `ChronosBackgroundHousekeeping` 不应**主动 new/init** buddy·dream；改为**由上层装配**：`entrypoints/init.ts`（entry）在启动时调用 buddy/dream 的集成初始化，并把它**注入**给 chronos（回调/句柄）。若反转成本过高，退路 = 经 **core SPI 端口**（同 D-144/D-147 手法）声明"housekeeping 需要的能力"，由 entry 注入实现。 |
| C3 | **事件化（该文件已具备条件）** | `TaskResultDeliverer` **已 import** `globalEventBus` / `SystemEvents` ⇒ 把"投递到通道"改为**发布既有事件**，由 channels（service）侧订阅并投递 ⇒ infra 不再直连 service。**不新增事件类型**（用既有 `SystemEvents`，若缺失则须单独立项）。 |

- **验收**：`infra` 源 3 → **0**；`chronos` 模块在 R00-001 下归零。
- ⚠️ 本子批**最重**：C1/C2 涉及启动时序（反转后 buddy/dream 的初始化时机变化）⇒ 需额外的启动路径验证（`entrypoints/init.ts` 的调用顺序）。

#### 3.3.1 执行状态（2026-10-01 **D-169**）

- **起始基线**：`已豁免 156` / 违规 **0** / 错误 **0** 警告 **2**；`allFiles 3992`。**实际达成（D-169 + D-170）**：`已豁免 156 → 154 → 153`（−2 = C1/C2；−1 = C3）· 违规 **0** · 错误 **0** 警告 **2**（仅既有 R07-004 + R00-003）· `R03-002` = 0 · `allFiles 3992 → 3991`（−1 删文件）。
  **⇒ 本 spec 三组（`system` 3 · `memory` 4 · `chronos` 3）共 10 条边全部消除。**（⚠️ **2026-10-01 D-172 更正**：本行原写"`infra` 源 3 → 0"**不准确** —— **分桶探针实测**当时尚余 **2 对 infra 源**（`oauth -> infrastructure` · `system -> tasks`），且二者**均为"收口注释里复写旧 import"触发的门禁假阳性**，已由 D-172 归零 ⇒ **`infra` 源真实归零**；详见台账 D-172）
- **✅ C1/C2 已完成（D-169）—— 采用 spec 首选「反转装配方向」，**未启用端口退路**（core 零改动）**：
  - `chronos/maintenance/ChronosBackgroundHousekeeping.ts`：删除 `'../../buddy/dreamIntegration'` 与 `'../../dream/DreamEngine'` 两个越层 import；新增**消费方自持的最小端口** `DreamEnginePort`（`start`/`stop`）与装配注入项 `HousekeepingUpperLayerAssembly`（`createDreamEngine()` + `initBuddyDomainIntegrations()`）；`startBackgroundHousekeeping(assembly)` 改为**必填参数** ⇒ 漏注入 = 编译期报错（**无 null 回退分支**，符合 CS03）。
  - `entrypoints/init.ts`（entry，组合根）：在**原位置**（同一条启动序列）动态导入 `DreamEngine` 与 buddy 三件套并注入 ⇒ **初始化时机与顺序不变**（仍在本入口的该启动环节内），仅**调用方**从 infra 变为 entry。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（已豁免 156 → **154** = −2）· 改动文件 `eslint` **0/0** · 定向测试 `tests/chronos` + `tests/http/dream-cycle-analytics.contract.test.ts` = **91 pass / 0 fail** · **grep 独立复核**：`app/src/chronos/**` 内对 `buddy`/`dream` 的**越层 import = 0**（余者均为注释、本地标识符 `dreamEngine`/`DreamEnginePort`、或 `chronos/autoDream` 自身子模块）。
  - **现状**：`infra` 源 **3 → 1**（`chronos` 组仅余 **C3**，见下）。
- **✅ C3 已完成（D-170）—— 用户授权自动执行后的裁定：删除未接线的 F-10 模块**（三重取证如下）：
  - `SystemEvents`（`core/events/EventBus.ts:342-394`）**无**"向通道广播消息"类事件 ⇒ D6 的"事件化（用既有 `SystemEvents`）"**不可行**：`TASK_COMPLETED`/`TASK_FAILED` 同时被 `CronScheduler`、`ProcessManager`、`VideoGenerateTool` 发布，若让 channels 直接订阅它们，会把**所有**任务结果都灌进用户通道 ⇒ **非等价替换**（语义错误）。
  - 既有 core SPI 广播端口 `IBroadcastService`（[BroadcastService.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/spi/BroadcastService.ts)）是 **SSE-only**（`broadcast(event, payload)` → SSE 客户端）⇒ **语义 ≠ 通道投递**，亦不能复用。
  - **🟡 关键取证**：`initializeTaskResultDelivery()` **全仓零调用方**（含 `app/tests/**`、`app/scripts/**`；仅由 `chronos/index.ts:150` 转出，**从未被初始化**）；其**唯一历史调用方**是 `daemon/CronBridge.ts:86`（commit `2f37a70fd`），而现 `CronBridge` 已重写为 polling 模式（自注「替代旧的 createCronScheduler」）**不再调用它** ⇒ F-10 投递**当前完全未接线**（与 M1 的 `MemoryHookDispatcher` 同型：零消费者、零运行时行为）。
  - **裁定（三选一取 ①）**：**删除 `chronos/TaskResultDeliverer.ts`** —— 理由：① 事件化不可行（上条一）；② 新建 core SPI 端口 = **为未接线代码扩契约**（违 CS01/§2 简洁优先，且与 M1 同类代价）；③ 该模块的调用方是在 `CronBridge` polling 重写中被**丢弃**的（非"待接线的新功能"）⇒ 属**遗留死代码**，按 CS01/CS05 删除。**与 M1 的 `MemoryHookDispatcher` 的区别（故 M1 保留）**：M1 有 `hooks/core/CoreHooks.ts:266-317` 已注册的 memory 域处理器作为"另一半"，删除会使那半永久悬空；F-10 无任何对应"另一半"。
  - **改动**：删除 `chronos/TaskResultDeliverer.ts`（105 行）+ 摘除 `chronos/index.ts` 的两处转出；**未动** `channelRegistry` / `channels` 侧（无逆向改动）。
  - **验收**：`typecheck` **0** · `lint:arch` **0 错 / 2 警 / 违规 0**（**已豁免 154 → 153**，恰为 C3 一条边）· `allFiles 3992 → 3991` · `eslint src/chronos/index.ts` **0/0** · 定向测试 `tests/chronos` + `tests/channels` = **195 pass / 0 fail** · **grep 复核**：全仓对 `TaskResultDeliverer` / `initializeTaskResultDelivery` 的引用 = **0**（含 `chronos/README.md` 等文档）。
  - **后续若重建 F-10**：按 D6 的分析走**事件化**（新增专用事件 + channels 侧订阅），**不要**恢复 `infra -> service` 直连。
  - ⚠️ **遗留风险（如实）**：F-10（定时任务结果通知到 IM 通道）**能力上不存在**了 —— 它今日本就不工作（零调用方），删除只是把"事实"与"代码"对齐；记录于台账 D-170，可 `git revert` 复原。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 子批顺序取 `system → memory → chronos` | 按"风险×改动量"递增；每批独立可交付 |
| ~~D2~~ | ~~S1/S2 取**最小结构镜像**~~ ⇒ **已作废（2026-10-01，见 §3.0）** | 取证反证：`AppState` 不读这些字段、只做容器 ⇒ 镜像只能写成全量复制（违 CS01） |
| ~~D3~~ | ~~S3 的 `TaskType`/`TaskState` 同源下沉 core~~ ⇒ **已作废（2026-10-01，见 §3.0）** | 同上：真根因是分层归属错误，下沉类型属局部补丁 |
| **D2'** | **AppState 家族由 `system/state`（infra）改归 app 层**（用户裁定「方案 A」） | 消费方全为 app/entry、无 infra/service/core 消费者 ⇒ 同 D-84/D-67/D-120 的"改归正确层" |
| D4 | M1 **扩展** `IHookChainPort` 返回值（不新建第二个端口） | CS01：既有端口本就是"hook 域分发"能力，缺的只是返回值投影 |
| D5 | C1/C2 取**装配反转**（entry 侧初始化），端口法为退路 | 反转消除**方向性错误**（infra 启动 app）；端口法只是"合法化"该调用 |
| D6 | C3 走**既有 `SystemEvents` 事件化**；若既有事件不足以承载投递归约，则**本子批拆出、单独立项** | N5：不新增事件类型 |

---

## 5. 验收方案（每子批各自执行）

| 项 | 通过标准 |
|---|---|
| 静态 | `bun run typecheck` **0**；改动文件 `eslint` **0/0** |
| 门禁 | `bun run lint:arch` **0 错 / 2 警**；`已豁免` 递减数 **= 本子批消除边数**（若不符，按 T-③02 记录偏差对照事实，不阻断） |
| 测试 | `bun test tests/`（**CI 口径**）**0 fail**；`memory`/`chronos`/`system` 相关用例重点回归；子批 3 另需启动路径手工/日志验证 |
| 复核 | 每个被消边附 **grep 复核**（源模块对该目标模块的引用 = **0**，注释除外） |
| 未做（明确） | 其他桶收口（N4）、门禁改动（N1）、core 契约变更（N2，除 M1） |

---

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ M1 复用既有 `IHookChainPort` 而非新建第二端口；前置若判定 `memory/services/KnowledgeBaseWriter` 为历史重复 ⇒ **删重复**而非搬迁；M3 归位而非复制 |
| CS03 回退最小化 | ✅ 无新增回退分支；M3 若保留转出，属"避免 16 处齐改"的**有意选择**并注明 |
| **CS05 根因优先** | ✅ C1/C2 明确指出**方向性错误**（infra 主动装配 app）并选择"反转"而非"端口合法化"为**首选** |
| §1.3 无兼容包袱 | ✅ 类型镜像只声明**实际读取字段**；不保留双份定义 |
| 门禁口径 | ✅ 沿用 D-158 的探针法复核；偏差按 T-③02 记录 |

---

## 7. 风险与边界（如实）

1. **子批 3 是唯一涉及运行时行为（启动时序）的批次** ⇒ 其余两批为纯静态改动，可先行独立落地。
2. **M3 的 16 消费方**是单点最大的横向影响面；若选择"保留 `services/file/fileNaming` 转出"，则边虽消但留下 app 桶转发 infra 的形态（同 D-161 的 `tasks/cron` 处置，已在台账登记）。
3. **`已豁免` 计数口径仍不可靠**（D-153/154/155/159 四次偏差，D-160 反证了"按模块对计数"假设）⇒ 每批以 **grep 复核 + 全量测试**为独立证据，不单看计数。
4. **本 spec 不承诺一次性完成**：三组可分批批准、分批交付；若评审只批 `system`，其余两组保持"待批准"。
