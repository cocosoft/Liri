# 梦境 × 前端 × 伙伴系统 · 接线排查与修复方案（2026-11-25）

> 来源：用户提问「前后端梦境模块是否连通？伙伴系统是否与梦境连接？」+ 全仓只读取证。
> 状态：**全部阶段 A/B/C/D 已实施（2026-11-25：P0-1/P0-2/P0-3/P1-1/P1-2/P1-3/P2-1）**。
> 约束：不新建第二套梦境/伙伴实现；删除类动作遵循 `code-deletion.md`（先摘入口 → 观察 → 再删）。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 梦境前后端 | **部分连通**：`POST /v1/memory/dream`、`GET /dream/cycles`、`GET /dream/cycles/:id` 前端有调用；`analytics` 端点**无前端调用**；手动触发与周期编排**口径分裂**（手动不写 `dream_cycles`、不发 SSE/伙伴事件） |
| 伙伴 × 梦境 | **单向已接线**：伙伴消费 `DREAM_*` 事件 → `dreamLogStore` → `/v1/buddy/dreams` → 前端；但 `BuddyDreamDetail` 挂载即置空、后端自述"恒空" |
| 伙伴 × 记忆 | **零连接**（`packages/buddy/src/buddy` 对 `memory/knowledge` 零命中）；伙伴人格文本也未被上下文消费 |
| 空转代码 | `app/src/tasks/dream/*` 无任何构造点；`init.ts` 心跳 `case 'dream'` 为空操作；`useBuddyNotification` 订阅 `"dream"` 事件但全仓无人发布 |

---

## 1. 取证（file:line）

### 1.1 梦境后端

- 引擎与调度：`packages/dream/src/dream/DreamEngine.ts:89-90`（`start()` 启动 `initAutoDream` + 调度器）；
  触发 cron `0 2 * * *` + 空闲 5 分钟（`DreamScheduler.ts:43`、`types.ts:61-65`）。
- 周期编排：`UnifiedDreamCycle.ts:243`（`executeAutoDream`）、`:716-718`（`runMemoryDream`）、
  `:404`（镜像写 `dream_cycles` 表）、`:523`（广播 SSE `dream:cycle:completed`）。
- 启动接线：`app/src/entrypoints/init.ts:493-520`（组合根注入 Engine；`:514-517` 初始化伙伴梦境集成）。

### 1.2 梦境 HTTP 与前端

- 路由注册：`app/src/infrastructure/http/handlers/routes/memory-files-routes.ts:189-207`。
- Handler：`memory-handlers.ts:498`（dream）、`:517`（cycles 列表）、`:554`（analytics）、`:598`（详情）。
- 前端端点：`client/src/services/endpoints.ts:501-503`；服务：`memoryService.ts:290/319/381`；
  调用：`memoryStore.ts:295`、`LiriPage.tsx:73`、`MemoryPage.tsx:42,500`、`DreamLogTab.tsx:70`、
  `DreamCycleDetail.tsx:51`、`useDreamSessionIds.ts:17`。

**口径分裂（真实缺陷）**：`memory-handlers.ts:504-506` 手动触发直接调 `runMemoryDream`，
不写 `dream_cycles`、不发 `dream:cycle:completed` ⇒ 前端周期列表/伙伴经验不会更新。

### 1.3 伙伴系统

- 伙伴本体（通）：`buddy-routes.ts:19-38`（companion/interact/stats/dreams/background-status）；
  前端 `userService.ts:50-71`、`buddyStore.ts`、`BuddyPage.tsx:329-334`、`backgroundTaskService.ts:50-63`。
- 伙伴 ← 梦境（通）：`init.ts:514-517` → `dreamIntegration.ts:409-431`（订阅 `SystemEvents.DREAM_*`）；
  发布方 `AutoDream.ts:142-153`；写 `dreamLogStore.ts:78-95`；经 `/v1/buddy/dreams`、`/v1/buddy/stats` 出前端；
  `buddyStore.ts:89` 另按 SSE `dream:cycle:completed` 加经验。
- 伙伴 → 记忆（**零连接**）：`packages/buddy/src/buddy` 下 `memory|Memory|knowledge|Knowledge` 0 命中；
  `dreamProcessedAt` 仅见于 `MemoryMetadata.ts:124`、`MemoryStore.ts:343`。
- 伙伴人格未注入：`packages/buddy/src/buddy/index.ts:36` 导出 `companionIntroText` 等，
  `app/src/context|chat` 零消费。
- 恒空：`BuddyDreamDetail.tsx:22-24` 挂载即 `setDreams([])`；`buddy-handlers.ts:182-185` 自述恒空；
  `useBuddyNotification.ts:38` 订阅 `"dream"`，但全仓 `broadcastEvent('dream'…)` 0 命中。

---

## 2. 缺口分级

| 级别 | 缺口 | 影响 |
|---|---|---|
| **P0-1** | 手动 dream 与周期编排口径分裂 | 手动触发后「周期列表/伙伴经验/SSE」全不更新，用户看到"没效果" |
| **P0-2** | `useBuddyNotification` 订阅不存在的事件名 `"dream"` | 伙伴通知对梦境永远静默（订阅空转） |
| **P0-3** | `BuddyDreamDetail` 恒空 | 伙伴页面"梦境详情"永远空白 |
| **P1-1** | `app/src/tasks/dream/*` 零构造点 + `init.ts` 心跳空分支 | 误导为既有能力（遗留空转） |
| **P1-2** | `analytics` 端点无前端调用 | 契约与实现口径不一致 |
| **P1-3** | `/dream` 与 `/liri` 双入口 | 导航重复，用户路径不唯一 |
| **P2-1** | 伙伴 → 记忆零连接 | 伙伴无法基于长期记忆对话（需新增显式端口） |

---

## 3. 修复方案

### P0-1 手动 dream 统一走引擎 —— ✅ 已实施（2026-11-25）

- `POST /v1/memory/dream` 改为调用 **`DreamEngine.triggerDream()`**（若该方法不存在，则复用
  `UnifiedDreamCycle` 的公开入口），确保：写 `dream_cycles` → 发 `dream:cycle:completed` → 伙伴经验累加。
- 保留 `runMemoryDream` 作为引擎内部步骤，不再被 HTTP 直接调用。
- 验收：手动触发后（临时目录/隔离库）`dream_cycles` 新增一行，且 SSE 收到 `dream:cycle:completed`。

**落地细节**：`ChronosBackgroundHousekeeping.ts` 端口新增可选 `triggerDream?(source)`，并导出
`triggerManualDream()`（`not_running | busy | started`）；`DreamEngine.triggerDream()` 改为返回
`boolean`（false = DREAM_CYCLE_BUSY）。Handler 映射：`not_running → 503`、`busy → 409`、
`started → 200 {triggered, source}`（不静默回退）。前端 `memoryService/memoryStore.triggerDream`
返回类型同步；`api-spec.md` 三个梦境端点订正调用方口径。回归用例：
`app/tests/dream/manualDreamTrigger.test.ts`。

### P0-2 修正 SSE 订阅名 —— ✅ 已实施（2026-11-25）

- `useBuddyNotification` 改为订阅 `dream:cycle:completed`（与 `UnifiedDreamCycle.ts:523` 一致）；
  或删除该订阅（若通知语义已由 `buddyStore` 覆盖）。**二选一，不做双重消费**。

**落地细节**：选定「改订阅名」——`buddyStore`/`operationProgressStore` 消费的是应用内状态，
桌面通知是独立通道，不构成双重消费。payload 用 `status` 区分 completed/partial/failed，
body 优先取 `insights[0]`，回退复用既有 `dream.notifyTask`（不新增 i18n key）。

### P0-3 伙伴梦境详情改真实数据 —— ✅ 已实施（2026-11-25）

- `BuddyDreamDetail` 改用 `/v1/buddy/dreams`（或 `/v1/memory/dream/cycles`）拉取最近记录，
  移除挂载即置空逻辑；空态显示"暂无梦境记录"。

**落地细节**：改用 `/v1/buddy/dreams`（伙伴梦境日志，梦境事件落盘的真实来源；与
`DreamLogTab` 的执行日志同源但展示口径不同）。移除无数据来源的「心情 / 符号 / 时长」
虚构字段，改为展示类型（开始/完成/失败）、时间、摘要、会话数与洞察数；加载态复用
`buddy.loadingDreamLog`，失败经 `handleClientError` 记录后显示空态。

### P1-1 `app/src/tasks/dream/*` 处置（先标注，不删） —— ✅ 已标注（2026-11-25）

- 按 `code-deletion.md`：先确认零构造点（已取证），在本轮**只加 `@deprecated` + 文件头说明**，
  观察期后再删；`init.ts` 心跳空分支同步加注释指向本方案。

**落地细节**：`DreamPhases.ts` / `ForkedDreamExecutor.ts` / `dreamWorker.ts` 三个文件头已加
`@deprecated` 与"零构造点 / 真实管线为 DreamEngine"说明（`dreamWorker` 为按路径拉起，属 CD01
动态入口盲区，已在注释中点明）；`init.ts` 心跳 `case 'dream'` 注释指向本方案。**未删除任何代码。**

### P1-2 analytics 口径 —— ✅ 已实施（文档如实标注）

- 二选一：接入前端（DreamLogTab 展示统计）或从 `api-spec.md` 标注"内部端点、无前端调用"。
  本轮优先**文档如实标注**，前端接入另评估。

**落地细节**：`api-spec.md` 该行改标「**内部端点**：无前端调用方」，不改实现、不新增前端调用。

### P1-3 双入口收敛 —— ✅ 已实施（2026-11-25）

- 保留 `/liri` 的梦境入口，`/dream` 重定向或标注 deprecated（按导航注册表实际结构决定）。

**落地细节**：`routes/index.tsx` 的 `/dream` 由「渲染简化版 `DreamPage`」改为 `<Navigate to="/liri" replace />`
（`/liri` 的「梦境日志」页签即 `DreamLogTab`，能力不丢）；`navRegistry` 移除重复的 `wb-dream`
工作台入口；`DreamPage.tsx` 按 CD05 先摘入口并标 `@deprecated` 观察，暂不删除。

### P2-1 伙伴读记忆 —— ✅ 已实施（2026-11-25）

- 新增显式端口 `BuddyMemoryPort`（读会话/全局记忆摘要），由 app 组合根注入伙伴；
  不做隐式全局单例，避免再次"看起来已连"。

**落地细节**：新增 `packages/buddy/src/buddy/memoryPort.ts`（`BuddyMemoryDigest` / `BuddyMemoryPort`
+ `setBuddyMemoryPort` / `getBuddyMemoryPort`）；`InteractionManager` 仅在 `talk` 动作读取
「最近一条真实记忆」并追加一句回忆（未注入 / 无记忆 ⇒ **不追加、不伪造**，其余动作零读取）；
`entrypoints/init.ts` 在后台维护启动同一处注入 app 侧实现：数据源 = `MEMORY.md` 索引头部
（`readMemoryIndexEntries`，与系统提示注入同源，**不逐条读记忆文件**）。回归用例：
`app/tests/buddy/buddyMemoryPort.test.ts`（3 例）、`app/tests/memory/memoryIndexEntries.test.ts`（3 例）。

> 顺查发现并已修复（2026-11-25，独立提交）：输入框把原文本当 `action` 提交，未知 action 会在
> `pickRandom` 抛错 ⇒ `execute()` 入口归一（非动作词汇按 `talk`）；回归用例
> `app/tests/buddy/buddyInteractionAction.test.ts`。

---

## 4. 执行顺序与验收

| 阶段 | 范围 | 验收 |
|---|---|---|
| **A（本轮，✅ 已完成 2026-11-25）** | P0-1 + P0-2 | 手动 dream 后 `dream_cycles` 有记录 + SSE 广播；伙伴通知订阅名一致；`typecheck` + 相关测试 |
| B（✅ 已完成 2026-11-25） | P0-3 + P1-1 标注 | 伙伴梦境详情展示真实数据；空转文件标注完成 |
| C（✅ 已完成 2026-11-25） | P1-2 + P1-3 | 文档口径一致；导航唯一 |
| D（✅ 已完成 2026-11-25） | P2-1 设计落地 | 伙伴可读记忆（显式端口注入，talk 引用真实记忆） |

每阶段独立提交；不在同一提交混入删除与功能。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 引擎入口为异步长任务，HTTP 超时 | 返回 `202 + cycleId`（或既有同步语义保持不变，只补记录/广播） |
| SSE 改名导致重复通知 | 只改订阅方，不新增发布方；`buddyStore` 的去重逻辑保留 |
| 伙伴详情改真实数据后接口慢 | 取最近 N 条（默认 10），失败降级空态并提示 |
| 空转文件标注被误认为"已删除" | 仅 `@deprecated` + 注释 + 本方案链接 |

---

## 6. 证据索引
- 梦境引擎/调度：`packages/dream/src/dream/DreamEngine.ts:89-90`、`DreamScheduler.ts:43`、`types.ts:61-65`
- 周期编排/广播：`packages/dream/src/dream/UnifiedDreamCycle.ts:243,404,523,716-718`
- HTTP：`app/src/infrastructure/http/handlers/routes/memory-files-routes.ts:189-207`；
  `memory-handlers.ts:498,504-506,517,554,598`
- 启动接线：`app/src/entrypoints/init.ts:493-520,514-517,754-756`
- 伙伴梦境集成：`packages/buddy/src/buddy/dreamIntegration.ts:409-431`；`AutoDream.ts:142-153`；
  `dreamLogStore.ts:78-95`；`buddy-handlers.ts:182-185`
- 前端：`client/src/services/endpoints.ts:501-503`、`memoryService.ts:290/319/381`、
  `MemoryPage.tsx:42,500`、`DreamLogTab.tsx:70`、`DreamCycleDetail.tsx:51`、
  `BuddyDreamDetail.tsx:22-24`、`useBuddyNotification.ts:38`、`buddyStore.ts:89`
- 契约：`.trae/docs/api-spec.md:732`（analytics 无前端调用）

---

## 7. 闭环复查与契约收口（2026-11-25，方案 A）

复查结论：主干已通，但 `/v1/buddy/*` 与前端契约不一致、梦境→伙伴存在静默跳过。本轮**先修契约**（方案 A）：

| 项 | 修复 |
|---|---|
| 伙伴等级/经验无真源 | `GrowthState` 新增 `experience` / `interactionCount`（`buddy-growth.json`，唯一真源）；`packages/buddy/src/buddy/level.ts` 的 `resolveBuddyLevel()` 派生 `level/experience/experienceToNext`（L 级区间 = L×100） |
| `/companion` 缺字段 | `getCompanionSnapshot()` = 骨骼/灵魂 + 派生等级视图；app 门面 `getBuddyCompanion` 改用它 |
| `/interact` 响应错形 | HTTP 层统一返回 `{ companion, message, statChanges }`；门面在交互成功后 `recordBuddyInteraction()`（互动次数 + 经验服务端记账） |
| `/stats` 硬编码 0 | 改读 `buddy-growth.json`：`interactions` / `dreamsCompleted` / `totalXp` 与等级同源 |
| 前端本地算经验 | `buddyStore` 收到 `dream:cycle:completed` 改为**刷新** companion/stats（删除会算出 NaN 的本地累加） |

A 之外的后续项：**B** = dream→buddy 事件断点（见 §7.1，已实施）；**C** = 前端缺失字段显示降级（A 已消除该前提，不再需要）。

### 7.1 方案 B：dream → buddy 事件断点（✅ 已实施 2026-11-25）

- `AutoDream.executeAutoDream(context?)` 改返回 `boolean`（true = 本轮**真正执行**并已 emit `DREAM_*`；false = 被 `minHours` / 10min 节流 / `minSessions` / 锁 / 未初始化跳过）；
- 新增 `AutoDreamRunOptions.force`：`UnifiedDreamCycle` 在**手动触发**（`source==='manual'`）时传 `{ force: true }`，跳过三道时间/数量门槛；
- `UnifiedDreamCycle` 记录 `autoDreamRan`，并在**周期收尾**（`saveCycle` 之后）于 `false` 时按最终状态补发
  `SystemEvents.DREAM_COMPLETED` / `DREAM_FAILED`（taskId = cycleId，摘要取周期最终统计）⇒ 伙伴日志/统计与周期一一对应，
  失败周期不会被提前误记为"完成"；
- 回归用例：`app/tests/dream/autoDreamSkipSignal.test.ts`（未初始化 ⇒ false，调用方据此补发）。

### 7.2 真机 E2E 记录（2026-11-25，本地 `bun --watch` 后端）

| 步骤 | 结果 |
|---|---|
| 基线 | `dream/cycles.total=101` 而 `/v1/buddy/dreams.total=0` ⇒ 复现"周期完成、伙伴无感" |
| 首次 `POST /v1/memory/dream` | 返回 `{triggered:true,source:'manual'}`（P0-1 生效）；周期 `manual/completed`；伙伴日志新增 `dream:started` + `dream:failed`（`worker exited with code 1`） |
| 根因 | `DreamAgentExecutor` 硬编码 `app/src/chronos/autoDream/consolidationWorker.js` —— 包迁移后不存在 ⇒ 每次 AutoDream 必失败 |
| 修复 | worker 路径改为同目录 `path.join(import.meta.dir, 'consolidationWorker.ts')`（bun 的 fork 直接执行 TS） |
| 复测 | 伙伴日志新增 `dream:completed`（14 洞察 / 1 文件）；`/v1/buddy/stats` = `{dreamsCompleted:1,totalXp:70}`（14×5，服务端真源） |
| 伙伴快照（临时注入 `config.companion` 验证） | `/v1/buddy/companion` 返回 `level:1, experience:70, experienceToNext:100`（由 XP 派生）✅ |
| 交互契约 | `POST /interact` → `{companion, message, statChanges}`；`stats` 变为 `{interactions:1, dreamsCompleted:1, totalXp:71}` ✅ |
| 竞态（实测发现并修复） | 首次交互返回的 `experience` 慢 1（`persist` fire-and-forget）⇒ `recordInteraction()` 改为 `await` 落盘；复测 `71 → 72` 与 `stats.totalXp` 一致 |
| 记忆回响（P2-1） | `talk` 返回 `… — It recalls: 状态机治理核心原则…`（读 `MEMORY.md` 索引头部）✅ |

> 验证用的伙伴是**临时注入 config**，验证后已恢复原 config（`companion` 回到 `null`）。
> **形状不一致已修（2026-11-25）**：config 为 `{ name, soul }` 而 `Companion` 需要
> `personality/hatchedAt` ⇒ 新增 `buildCompanionFromStored()` 显式映射（`soul → personality`、
> `hatchedAt` 缺省 0）；真机复验 `personality=好奇但务实 / hatchedAt=0`，用例
> `app/tests/buddy/companionShape.test.ts`。
> **仍未修（另立）**：仓库内没有写入 `config.companion` 的孵化路径（伙伴只能手改配置产生）。
