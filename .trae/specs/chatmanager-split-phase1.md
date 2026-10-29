# ChatManager 拆分 · 第一阶段（检查点 + 预算）拆分清单

> 对应 issue：[#8](https://github.com/cocosoft/Liri/issues/8)（替代已关闭的 #2）
> 基线（2026-10-29 实测）：`app/src/chat/ChatManager.ts` **4840 行**、方法声明 **164** 个；`app/src/chat/manager/` 已有 **14** 个子模块（最大 `bootstrap.ts` 742 行）。
> 进度（同实测口径）：Cut A 后 **4786 行**（`1017bb9fc`）；Cut B 后 **4552 行**；Cut C 后 **3972 行**（即 `2e33aa625`，已达 ≤4000）；Cut D（#16 装配契约守卫）后仍 **3972 行**；Cut D1（#17 第一刀）后 **3898 行**；Cut D2/D3 后 **3807 行**；Cut D4/D5 后 **3738 行**；Cut D6/D7 后 **3666 行**；Cut D8（工具审批外移）后 **3518 行**；Cut D9/D10 后 **3461 行**。
> 目标：第一阶段把「检查点（checkpoint）+ 预算（budget）」编排抽到 `app/src/chat/manager/`（`checkpointBudget.ts` + `budgetResume.ts`，单文件 ≤900 行），`ChatManager.ts` **≤4000 行**，行为不变。

## 一、实测现状（决定拆分粒度的事实）

`ChatManager.ts` 内 `checkpoint|budget` 命中的**行分布**（每 200 行一桶）：

| 区间 | 命中数 | 说明 |
|---|---:|---|
| 201–400 | 20 | 依赖注入/字段（`checkpointService` 注入点在本区间外侧的方法体里被引用） |
| 1001–1400 | 21 | 流式主链路内的 checkpoint 记录调用 |
| 1601–1800 | 19 | 预算（budget）挂起/恢复 + `checkpointInterval` 配置 |
| 2401–3000 | 33 | 流式主链路内的预算检查 / checkpoint 触发 |
| 3801–4000 | 23 | checkpoint 边界工具（`_ensureCheckpointBoundary`） |
| 4201–4400 | 13 | 门面 getter/setter 区（与本次无关，但同区间） |
| 4601–4800 | 16 | checkpoint 公共委托方法 |

**关键结论**：checkpoint/budget 的**逻辑**分散在「门面方法 + 流式主链路内联块 + 两个 `_ensure*` 安装器」三类位置；
单把门面方法搬走只能移出 ~200 行，**达不到 ≤4000 的目标**（需移出 ≥840 行）。因此本阶段必须分三刀，且验收要按刀计。

已确认的成员（行号以基线为准）：

| 成员 | 行 | 归属 |
|---|---|---|
| `_ensureBudgetSuspendResumeInstalled` | 1674 | 预算 |
| `_ensureCheckpointBoundary` | 3843 | 检查点 |
| `createCheckpoint` / `listCheckpoints` / `rollbackToCheckpoint` / `deleteCheckpoint` / `getLatestCheckpoint` | 4652–4677 | 检查点门面 |
| `_getOrCreateTAORLoop` / `_ensureVerifierCallModel` / `_isCommandApproved` / `_submitToolApproval` | 1703 / 1747 / 3912 / 3957 | **不在本阶段范围**（审批/TAOR，后续阶段） |

## 二、三刀拆分（每刀独立可合并）

### Cut A — 门面与安装器外移（低风险，先做）

- **抽走**：`checkpointBudget.ts` 新增 `CheckpointBudgetManager`（沿用 `app/src/chat/manager/` 现有 **deps 注入**方式，**不建全局单例**），承载：
  - ~~5 个 checkpoint 门面方法的实现体~~ ⇒ **实测后未搬**（它们本就是一行委托，搬走只会多一层跳转，见下方「Cut A 实测结果」）；
  - `_ensureCheckpointBoundary`（`3843`）与 `_ensureBudgetSuspendResumeInstalled`（`1674`）的实现体；
  - 与它们绑定的私有字段/常量（`checkpointInterval` 两处、`checkpointBoundaryTool` 相关常量）。
- **ChatManager 保留**：同名 thin delegate（保持 `ChatManagerInterface` 与现有调用点零改动）。
- **Cut A 实测结果（2026-10-29，commit `1017bb9fc`）**：`ChatManager.ts` **4840 → 4786**（**−54 行**）、新模块 `checkpointBudget.ts` **153 行**。原「预计 250–400 行」**估高了** —— 实测两个 `_ensure*` 方法体合计约 85 行，减去新增 import 与 delegate 后净减 54 行；5 个 checkpoint 门面本就是一行委托，**未搬**（搬只会多一层跳转，不产生收益）。
- **验收（实测全绿）**：`bunx tsc --noEmit` ✅；`bun run lint:arch` exit 0 ✅；`bun run lint:size` exit 0（0 错误 / 527 警告）✅；`bun test tests/chat` **725 pass / 0 fail** ✅。
- **对目标的含义（如实）**：距 4000 还差 **786 行**，只能从 **Cut B/C** 的流式主链路内联块（`1001–1400` / `2401–3000` 等，checkpoint|budget 命中 33 处）里出；因此 **Cut A 单独不满足 #8 验收是设计内预期**，不作为 PR 关单依据。
- **验收**：
  ```bash
  cd app && bunx tsc --noEmit
  cd app && bun test tests/chat
  cd app && bun run lint:arch
  wc -l src/chat/ChatManager.ts src/chat/manager/checkpointBudget.ts
  git diff --stat
  ```

### Cut B — 流式主链路内的「触发策略」收敛

- **抽走**：`1001–1400` 与 `2401–3000` 区间里 checkpoint 记录 / 预算检查的**判定与调用**（纯策略函数，如 `shouldRecordCheckpoint(turn, budget)` / `shouldSuspendForBudget(state)`），ChatManager 只保留一处调用点。
- **风险**：改动落在 `streamMessage` 主链路 ⇒ **行为不变**要求高；必须先补「策略函数级」单测再替换。
- **预计**：移出 **300–450 行**。
- **验收**：同上 + 新增 `app/tests/chat/checkpointBudgetPolicy.test.ts`；并跑 `bun test tests/chat` 全绿（含流式相关用例）。
- **Cut B 实测结果（2026-10-29）**：原计划的「纯策略函数化」**未按预估成立** —— 实测 `1001–1400` / `2401–3000` 区间的 checkpoint/budget 命中绝大多数是**单行调用点**（`checkBudget()` / 记账 / `assertEntryBudget`），可抽的**成块逻辑**只有「预算挂起后的续跑」这一段。故 Cut B 实抽：
  - 新模块 `app/src/chat/manager/budgetResume.ts` **327 行**：`resumeSuspendedSession`（taor/stream 分流）、`resumeSuspendedStream`、`submitResumeManualConfirmations`、`markBudgetResumed`、`resolveReplayForcedTools`、`isSubstantiveResumeChunk`；
  - `ChatManager.ts` **4786 → 4552**（**−234 行**，略优于预估 −180~−220），`ChatManagerInterface` **零改动**；
  - 新增 `app/tests/chat/budgetResume.test.ts`（5 例：taor 无检查点 / taor 正常链路顺序 / stream 有进展 / stream 回退重发 / chunk 判据）；
  - 既有两条接线级回归随实现迁移扫描面（`resumePendingSplit.test.ts` 改读新模块；`preparedReplayForce.test.ts` 的 W3 改为直接驱动新模块），**断言强度不变**；
  - 门禁实测：`tsc` 0 错误 / `lint:arch` 0 错误 / `lint:size` 0 错误 527 警告 / `bun test tests/chat` **730 pass / 0 fail**（基线 725 + 新增 5）。
  - **对目标的含义（如实）**：距 4000 仍差 **552 行**，只能由 Cut C 承担。

### Cut C — 构造期装配归并，达到 ≤4000

- **原计划**：Cut A/B 留下的字段、构造期初始化、budget 状态（`budgetSuspend*` 相关局部成员）并入 `CheckpointBudgetManager`。
- **实测订正（2026-10-29）**：本域残余（checkpoint 门面 32 + `flushAllCheckpoints` 16 + 预算装配/清理/停止钩子 ~40 + `_budgetResumeDeps` 23 + 字段 ~20）只有 **≈130–200 行**，且门面全是**一行委托**（搬走只多一层跳转）⇒ **单靠本域到不了 4000**（≈4.3k）。经用户裁定扩围为「构造期装配外移」（该文件唯一成块的另一半：constructor 562 行）。
- **Cut C 实测结果（2026-10-29）**：
  - `manager/hostWiring.ts` **119 行**：全局 sink（goal/yield/selfWake/evolution/workflow/execution）、退出钩子、内存水位；构造器原 97 行 ⇒ **8 行调用**；
  - `manager/orchestratorHost.ts` **442 行**：`ChatOrchestrator` 宿主端口字面量；原 195 行 ⇒ **6 行调用**；
  - `manager/facadeWiring.ts` **481 行**：12 个子门面/服务装配（summarizer/memory/stepLoopFactory/pdcaLauncher/toolExec/sessionLifecycle/resumeCoordinator/contextCompactor/pdcaLaunch/streamSetup/msgPersist/streamFinalize/streamResume）；原 259 行 ⇒ **3 行调用**；
  - `manager/usageAccounting.ts` **121 行**：`recordChatResponseUsage`（本域：水位预算 / 日预算结算 / 金额台账 / `metric/timing`）；原 72 行 ⇒ **25 行 delegate**（同步签名不变）；
  - `ChatManager.ts` **4552 → 3972**（**−580**，`git show` 实测）✅ **达成 ≤4000**；`ChatManagerInterface` **零改动**。
  - 门禁实测：`tsc` 0 错误 / `lint:arch` 0 错误 / `lint:size` 0 错误 527 警告 / `bun test tests/chat` **730 pass / 0 fail**。
  - ⚠️ **如实记录（风险面）**：`orchestratorHost.ts` / `facadeWiring.ts` 以「结构接口 + **调用点单点断言**」接收宿主**私有成员** ⇒ 私有成员改名**不会被编译器发现**，由 `tests/chat` 的构造/编排回归兜底；要彻底消除需把宿主端口改为公开接口（`ChatOrchestratorHost` 直连本类），属后续独立 issue。
  - 状态字面量棘轮：新文件命中的既有取值（`error` / `completed`）按规则在 `.trae/architecture/state-literal-baseline.json` **逐条补登**（未跑 `--update`，避免带入无关重排序噪声）。
- **验收**：`wc -l src/chat/ChatManager.ts` **= 3972 ≤ 4000** ✅；新模块均 < 500 行；其余门禁同上（含全量 `bun test tests`：**8953 pass / 41 skip / 0 fail**）。

### Cut D（issue #16）— 装配宿主端口的契约守卫（2026-10-29）

- **动因**：Cut C 的两个模块（`orchestratorHost.ts` / `facadeWiring.ts`）端口值取自 `ChatManager` 的**私有成员**，只能用 `this as unknown as XHost` 单点断言 ⇒ 私有成员改名/删除时**编译器不报错**、运行时 `undefined`（静默失效）。
- **落地**：
  - 新增 `manager/wiringHostGuard.ts`：`asWiringHost`（**唯一**断言点，集中审计）+ `assertHostSurface`（装配入口按 `key in host` 逐条校验，缺失即**抛错并点名**）；
  - 两模块各带三张键表（`FACADE_HOST_REQUIRED/DEFERRED/OUTPUT_KEYS`、`ORCHESTRATOR_HOST_REQUIRED/DEFERRED_KEYS`），并用 `AssertNever<Exclude<keyof XHost, …>>` 做**编译期全量覆盖检查**（接口加成员而键表漏登记 ⇒ `tsc` 报错）；
  - 新增 `tests/chat/wiringHostGuard.test.ts`（5 例：缺失键抛错并点名 / 原型方法计入 / 未赋值键不误报 / 断言保持引用 / 真实构造 `ChatManagerImpl` 通过守卫）。
- **负向验证（实测，已还原）**：把 `ChatManager._requestReconcile` 临时改名 ⇒ `bunx tsc --noEmit` **仍通过**（确证盲区），构造期抛出 `wireChatFacades: 宿主端口缺失 [_requestReconcile] —— 私有成员被改名/删除？（issue #16 装配契约守卫）`。
- **实测门禁**：`ChatManager.ts` 仍 **3972 行**（未回升）；`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`tests/chat` **735 pass / 0 fail**；全量 `bun test tests` **8958 pass / 41 skip / 0 fail**。
- ⚠️ **未做（如实）**：断言本身仍存在（已收敛到 guard 一处）；要**彻底移除**需把约 70 个宿主成员改为公开端口，属可见性/封装面的独立决策，记录在 #17 的后续项。
  - 另：初版两名模块共用常量名 `HOST_REQUIRED_KEYS` / `HOST_DEFERRED_KEYS` 触发「同名常量」门禁（`hardcodeGateBlocking` 全量回归变红）⇒ 已改为模块前缀命名。

### Cut D1（issue #17 第一刀）— 降级路径外移（2026-10-29）

- **抽走**：`_sendMessageDowngradePath`（`ChatManager` 原 2061–2150，**90 行**）⇒ 新模块 `manager/sendDowngrade.ts`；
  依赖显式注入（`executeTool` / `createAssistantMessage` / `addAndPersistMessage`），`ChatManager` 保留同名 thin delegate。
- **行为不变**：预算闸门 `assertEntryBudget('chat-downgrade')` 仍在**最前**；非幂等失败告诫、`messageProjector.project` 修复配对、失败兜底文案逐字保留；`_addAndPersistMessage` 仍**不 await**（fire-and-forget）。
- **实测**：`ChatManager.ts` **3972 → 3898**（**−74**）；顺带清掉 6 个因外移而不再使用的导入（`assertEntryBudget` / `estimateMessagesTokens` / `messageProjector` / `resolveToolEffect` / `stripThinkResponseTags` / `ChatMessage`）。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持（新文件命中既有取值 `completed` ⇒ 基线补登 1 行）；`bun test tests/chat tests/budget` **775 pass**；全量 `bun test tests` **8958 pass / 41 skip / 0 fail**（既有 `tests/budget/chatDowngradeGate.test.ts` 仍绿）。
- **#17 剩余候选**（实测跨度）：`_submitToolApproval` 137（审批路径，**先补单测**）、`extractMemoryFromChat` 69、`getClientForModel` 46、`getSessionManager` 45、`runPendingReconciles` 43、`_ensureVerifierCallModel` 39、`_buildTAORContext` 36、`_createStreamPipeline` 35、`_isCommandApproved` 35、`_getProjectSandboxPath` 33。

### Cut D2 / D3（issue #17 第二、三刀）— 记忆抽取 + 按模型选客户端（2026-10-29）

- **D2 · `manager/memoryExtract.ts`**：`extractMemoryFromChat`（原 69 行 ⇒ **14 行 delegate**）。
  - `CONVERSATION_MEMORY_MAX_CHARS`（20k 上限）随实现迁为**模块常量**，`ChatManager` 的静态字段删除；
  - 会话 → memoryId 的 Map **仍归宿主**（实例级生命周期），以端口传入（**不得**做成模块级单例，否则跨实例/测试串扰）；
  - 三条分支（缓存命中 / 按会话标签续写 / 首次新建）与封顶、失败只记日志的语义逐字保留。
- **D3 · `manager/modelClient.ts`**：`getClientForModel`（原 46 行 ⇒ **14 行 delegate**）。
  - `toolRegistry` 的 `tools` 域类型在模块内**单点转换**为 `ai` 域类型（与迁移前调用点同口径）；
  - BUG-08「有归属供应商但未注册 ⇒ 抛配置错误、绝不静默回落」逐字保留。
- **实测**：`ChatManager.ts` **3898 → 3807**（**−91**）；同时清掉 2 个失效导入（`resolveModelRoutingFailure` / `providerRegistry`）。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持；`bun test tests/chat tests/ai` **1093 pass**；全量 `bun test tests` **8958 pass / 41 skip / 0 fail**。
- **#17 剩余候选**：`_submitToolApproval` 137（审批路径，先补单测）、`getSessionManager` 45、`runPendingReconciles` 43、`_ensureVerifierCallModel` 39、`_buildTAORContext` 36、`_createStreamPipeline` 35、`_isCommandApproved` 35（审批路径）、`_getProjectSandboxPath` 33。

### Cut D4 / D5（issue #17 第四、五刀）— 会话管理器视图 + 待对账消费（2026-10-29）

- **D4 · `manager/sessionManagerFacade.ts`**：`getSessionManager` 的对象字面量（原 44 行 ⇒ **14 行 delegate**）。
  - 对外签名仍是 `any`（`ChatManagerInterface` **零改动**）；内部改为工厂返回同形视图；检查点方法原样转发；
  - 端口：`getLocalSession` / `currentSessionIdRef` / `chatSessions` / `addAndPersistMessage` / `checkpointService`。
- **D5 · `manager/reconcileDrain.ts`**：`runPendingReconciles`（原 43 行 ⇒ **7 行 delegate**）。
  - 队列仍归宿主（端口传入）；TB-10「只删已处理项、不 clear()」语义逐字保留；失败只 `handleError` 留痕。
- **实测**：`ChatManager.ts` **3807 → 3738**（**−69**）；清掉 2 个失效导入（`ReconcileService` / `DataSessionStatus`）。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持；`bun test tests/chat tests/session` **1097 pass**；全量 `bun test tests` **8958 pass / 41 skip / 0 fail**。
- **#17 剩余候选**：`_submitToolApproval` 137（审批路径，先补单测）、`_ensureVerifierCallModel` 39、`_buildTAORContext` 36、`_createStreamPipeline` 35、`_isCommandApproved` 35（审批路径）、`_getProjectSandboxPath` 33。

### Cut D6 / D7（issue #17 第六、七刀）— 项目 sandboxPath + verifier 模型解析（2026-10-29）

- **D6 · `manager/projectSandboxPath.ts`**：`_getProjectSandboxPath`（原 33 行 ⇒ **6 行 delegate**）。
  - 仍是**延迟 `require`**（`workspace/ProjectStore` 不进启动图，`lint:startup-graph` 棘轮不受影响）；
  - store 缓存改由宿主以 `{ current?: ProjectStoreLike }` 引用持有 ⇒ **实例级生命周期不变**（未改成模块级缓存）。
- **D7 · `manager/verifierModel.ts`**：`_ensureVerifierCallModel`（原 39 行 ⇒ **4 行 delegate**）。
  - 两个字段（`_verifierCallModel` / `_verifierRoleResolved`）收敛为 `VerifierModelState`；注入点改读 `this._verifier.callModel`；
  - 幂等（只尝试一次）/ 未配置不注入 / 解析失败 fail-open 的语义逐字保留。
- **实测**：`ChatManager.ts` **3738 → 3666**（**−72**）；清掉 4 个失效导入（`getCoreAPI` / `resolveDataDir` / `resolveProjectRoot` / `resolveOutputDir`）。
- **既有源码级守卫随实现迁移**：`tests/query/verifierMetrics.test.ts` 的 ①角色解析、④幂等改为扫 `manager/verifierModel.ts`；②入口 await、③条件注入仍扫 `ChatManager.ts`（**断言强度不变**）。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持；`bun test tests/chat` **735 pass**；全量 `bun test tests` **8958 pass / 41 skip / 0 fail**。
- ⚠️ **如实记录**：本轮有一次全量运行的 **1 例失败**（未在后续两次复跑中重现），未定位到稳定复现路径；若再现需单独立项排查。
- **#17 剩余候选**：`_submitToolApproval` 137（审批路径，先补单测）、`_buildTAORContext` 36、`_createStreamPipeline` 35、`_isCommandApproved` 35（审批路径）。

### Cut D8（issue #17 第八刀）— 工具审批链路外移（2026-10-29）

- **抽走**（`manager/toolApproval.ts`，215 行）：
  - `_isCommandApproved`（原 35 行 ⇒ **8 行 delegate**）：放行缓存查询（shell 哈希 / 非 shell 工具调用键）；
  - `_submitToolApproval`（原 137 行 ⇒ **19 行 delegate**）：审批卡片提交（同指纹复用、四档 options、四段打点 ①②）。
- **审批路径纪律（CD07）**：逐字搬迁、零语义改动；依赖仍走**动态 import**（`@modules/permission` / `InboxManager`），不改变启动期 eager 依赖。
- **测试**：
  - 既有端到端决策回归 `tests/chat/ChatManagerPermission.test.ts`（ask / deny / allow / 放行缓存命中）**6 pass**，迁移前后均绿；
  - 新增 `tests/chat/toolApproval.test.ts`（3 例，纯函数、无 mock）：命令类无 command、有 command 无 session、非命令类无 session 三条**短路分支**；
  - 仓库无 `mock.module` 先例，故未引入模块级 stub（避免进程级污染）。
- **既有源码级守卫随实现迁移**：`tests/gates/approvalFourStageGate.test.ts` 的 ①② 扫描面由 `ChatManager.ts` 改为 `manager/toolApproval.ts`（**断言强度不变**）。
- **实测**：`ChatManager.ts` **3666 → 3518**（**−148**，提交后 `git show` 实测；提交钩子的格式化又压缩了 8 行）；清掉 1 个失效导入（`isShellToolName`）。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持；`bun test tests/chat tests/permission tests/gates` 全绿；全量 `bun test tests` **8961 pass / 41 skip / 0 fail**。
- **#17 剩余项（如实评估：不建议继续搬）**：
  - `_buildTAORContext`（36 行）与 `_createStreamPipeline`（35 行）的**方法体本身就是端口字面量**（20+ 个 `() => this.x(...)` 转发），搬到模块只会把同一份字面量挪位置（净收益 ≈ 0 或为负，且多一层跳转）——与 Cut A 对「一行委托门面」的判定一致；
  - 若确实要减，只能改为「宿主整体传入 + 断言」（即 #16 否决过的方向），或等后续把 `ChatOrchestrator` 的端口改为公开接口后再评估。

### Cut D9 / D10（issue #17 第九、十刀）— TAOR 上下文 / 流式管线端口装配（2026-10-29）

- **D9 · `manager/taorContextWiring.ts`**：`_buildTAORContext`（原 38 行 ⇒ **6 行 delegate**）。
  - 端口字面量迁入模块；宿主以 `asWiringHost` 单点断言 + `assertHostSurface` 守卫（键表 10 项，`AssertNever` 编译期全量覆盖）。
- **D10 · `manager/streamPipelineFactory.ts`**：`_createStreamPipeline`（原 39 行 ⇒ **6 行 delegate**）。
  - 键表 9 项；`llmClient` 列入 **deferred**（由 `setLLMClient` 稍后注入，避免装配期误报）。
- **实测**：`ChatManager.ts` **3518 → 3461**（**−57**）；清掉 2 个失效导入（`buildTAORContext` / `PipelineContext`）。
- **如实说明**：这两处方法体**本身就是端口字面量**，搬走**不减少总代码量**（同一份字面量换了文件），收益是 `ChatManager` 更薄 + 契约守卫覆盖；净减 −57 主要来自删除的 import 与折叠后的签名。
- **门禁**：`tsc` 0 错；`lint:arch` / `lint:size` 0 错；`lint:state-ratchet` 维持；`bun test tests/chat tests/gates` **985 pass**；全量 `bun test tests` **8961 pass / 41 skip / 0 fail**。
- **#17 清单至此全部处理完**（含「`_buildTAORContext` / `_createStreamPipeline` 原本评估为不建议搬」的结论——本次按用户要求执行，并如实记录收益来源）。

## 三、统一验收命令（每刀都要跑）

```bash
cd app
bunx tsc --noEmit                      # 类型
bun run lint:size                      # 文件行数阈值（R04-001）
bun run lint:arch                      # 架构合规（含分层/门面）
bun test tests/chat                    # 行为回归
git diff --stat                        # 抽走了哪些文件/多少行
```

**行为不变的三条红线**（issue 正文要求）：不新增配置项、不改默认值、不改事件名 —— 每刀 PR 描述需逐条声明遵守。

## 四、风险与对策

| 风险 | 对策 |
|---|---|
| checkpoint 与 SSE 发射、持久化强耦合，抽走后顺序变化 | 只做**纯函数化 + 委托**，调用顺序与位置不变；Cut B 先补策略单测 |
| `ChatManagerInterface` 暴露面被改动 | ChatManager 保留同名 thin delegate，接口文件零改动 |
| 目标 4000 行一刀达不到 | 按 Cut A→B→C 分批合并，**只在 Cut C 验收 ≤4000**；A/B 的验收是「行为不变 + 门禁绿」 |
| 与外部 PR 冲突 | 本阶段不动 `knowledge/`；与 PR #14 无交集 |

## 五、下一步

1. ~~先做 Cut A~~（**已完成 `1017bb9fc`**：−54 行，四道门禁全绿）；
2. ~~Cut B~~（**已完成，2026-10-29**）：`resumeSuspendedSession`（taor/stream 分流）+ `resumeSuspendedStream` + `submitResumeManualConfirmations` + `markBudgetResumed` + `resolveReplayForcedTools` + `isSubstantiveResumeChunk` 迁入 `budgetResume.ts`（327 行，显式注入）；`ChatManager` **4786 → 4552**（**−234**）；先补 `budgetResume.test.ts`（5 例）再替换调用点；四道门禁全绿（730 pass）。详见 §二 Cut B 实测结果。
3. ~~Cut C~~（**已完成，2026-10-29**，`2e33aa625` + 测试跟随 `3dbd0e483`）：构造期装配外移 4 个模块（`hostWiring` 119 / `orchestratorHost` 442 / `facadeWiring` 481 / `usageAccounting` 121）；`ChatManager` **4552 → 3972**（**−580**）✅ 达成 ≤4000；四道门禁全绿 + 全量测试 8952 pass。详见 §二 Cut C 实测结果。
4. ~~#16 装配契约守卫~~（**已完成 `e76db2b14`**）：`manager/wiringHostGuard.ts`（`asWiringHost` 单点断言 + `assertHostSurface` 存在性守卫 + 键表编译期全量覆盖）；负向验证：私有成员改名 ⇒ `tsc` 仍通过、装配期抛错点名缺失键。`ChatManager` 行数保持 3972（未回升）。
5. ~~#17 按域拆分~~（**已完成并关单，`59ea947f8` / `ee5127951`**）：D1–D10 共 10 刀；本 issue 区间 **3972 → 3461**（−511），累计（自 4840）**−1379 / −28.5%**；全量 `bun test tests` **8961 pass / 41 skip / 0 fail**。未达成「≤1500」。
6. **第二阶段已另开 [#18](https://github.com/cocosoft/Liri/issues/18)（≤1500 行）**：实测依据 —— 外移后**已无大块**（最大方法 `constructor` 57 行、`cleanup` 48、`_wireCodeRunnerDeps` 37，其余 ≤27）⇒ 后续靠「收敛薄委托（按 `code-deletion.md` CD01–CD06 先摘入口再删实现）」与「`ChatOrchestratorHost` 公开化（可能连带删除两个装配模块）」。
7. 每刀落地后把本文件的行数基线更新为当次实测值（禁止沿用旧数字）。

## 六、#18 第 1 步：薄委托收敛（2026-10-29 实测）

> 纪律：按 `code-deletion.md` CD05 拆成「先摘入口（调用点/端口直连）」与「再删实现」两个独立提交；
> 每批前后跑 `tsc` + `tests/chat`，收尾跑全量。

### Batch 1 — 纯宿主内委托（无端口、无外部消费者）

- **独立提交**：`0cb42670a`（改调用点）+ `15e49f47e`（删实现）。
- **零调用者直接删**（5）：`_appendEventsForMessage`、`getSessionSummaries`、`searchSessionSummaries`、`_compressToolHistory`、`_estimateArrayTokens`；
- **单调用点内联后删**（5）：`_getLocalSession`、`_ensureVerifierCallModel`、`_recordModelInputSnapshot`、`_getProjectSandboxPath`、`_releaseInactiveEventLogSnapshots`；
- 源码扫描面随实现迁移：`tests/query/verifierMetrics.test.ts` 的 ② 断言改为 `await ensureVerifierCallModel(this._verifier)`（强度不变）。
- 实测：**3461 → 3355（−106）**；`tests/chat` 746 pass。

### Batch 2 — 事件日志家族端口直连 `ChatEventLogStore`

- **独立提交**：`b5113bb85`（端口直连）+ `2198c1ee4`（删实现）。
- 端口改直连：`facadeWiring` 5 处（`sessionLookup` / `getOrCreateEventLog` / `rebuildToolCallSeqMap` / `getStreamMaxTurn` / `hasTurnEnded`）、`orchestratorHost` 1 处（`getStreamMaxTurn`）、`ChatManager` 构造期 2 处（`_recovery.getStreamMaxTurn`、`installHostWiring.flushAllPendingEventBuffers`）。
- 宿主契约同步：`FacadeWiringHost` / `OrchestratorWiringHost` 各 **−5 成员 +1 字段**（`_eventLogStore`），两张键表同步（`AssertNever` 编译期覆盖保证不漏登记）。
- 删除（5）：`hasTurnEnded`、`_sessionLookup`、`_rebuildToolCallSeqMap`、`getStreamMaxTurn`、`flushAllPendingEventBuffers`。
- ⚠️ **`_getOrCreateEventLog` 保留**：外部结构化消费者 `runtime/api/sessionMessagesRead.ts:389/708` 以**可选链**调用（`chatManager._getOrCreateEventLog?.(sid)`），删除会让读路径**静默降级**（不上报错误）；`tests/runtime/verifySessionDerivation.test.ts` / `sessionMessagesReadOwnership.test.ts` 也以假对象提供该成员。
- 实测：**3355 → 3311（−44）**；`tests/chat` 738 pass。

### Batch 3 — 请求构建家族端口直连 `ChatRequestPrep`

- **独立提交**：`05b6e9fc5`（端口直连）+ `e31956f85`（删实现）。
- 端口改直连：`facadeWiring`（`buildToolDefinitions` / `recordToolsSnapshot` / `persistTurnSummary`）、`orchestratorHost`（`buildToolDefinitions` / `recordToolsSnapshot` / `extractFilePathsFromText` / `sanitizeApiMessages` / `truncateApiMessages` / `persistTurnSummary`）、`streamPipelineFactory`（`extractFilePathsFromText`）。
- `persistTurnSummary` 直连模块函数（不再经宿主同名转发）；三张宿主契约各 **−N 成员 +1 字段**（`_requestPrep`）。
- 删除（6）：`extractFilePathsFromText`、`_sanitizeApiMessages`、`_recordToolsSnapshot`、`_buildToolDefinitions`、`_truncateApiMessages`、`_persistTurnSummary`。
- 实测：**3311 → 3262（−49）**；`tests/chat` 738 pass。

### Batch 4 — 流式准备/收尾 + PDCA 端口直连子模块

- **独立提交**：`353a34837`（端口直连）+ `3cd18d90f`（删实现）。
- 端口改直连：`orchestratorHost`（`_prepareStreamSession` → `_streamSetup.prepare`、`_buildApiMessagesForStream` → `_streamMessageLifecycle.buildApiMessagesForStream`、`_finalizeStreamMessage` → `_streamFinalize.finalize`）、`facadeWiring`（`maybeLaunchPdca` → `_pdcaLaunch.maybeLaunch`）。
- 宿主契约：`OrchestratorWiringHost` **−3 成员 +3 字段**（`_streamSetup` / `_streamMessageLifecycle` / `_streamFinalize`），`FacadeWiringHost` −1 成员。
- 类型修正：`_finalizeStreamMessage` 端口的 `finalResponse` 由 **ai 域** `ChatResponse` 断言改为 **session 域** `SessionChatResponse`（原先经宿主同名方法"顺带"完成了跨域转换，直连后必须显式）。
- 删除（4）：`_prepareStreamSession`、`_buildApiMessagesForStream`、`_finalizeStreamMessage`（24 行）、`_maybeLaunchPdca`。
- 实测：**3262 → 3197（−65）**；`tests/chat` 738 pass。

### Batch 5 — 持久化/审批/TAOR/降级路径端口直连

- **独立提交**：`f3b33d753`（端口直连）+ `37bdb08b0`（删实现）+ `89dc7648b`（测试驱动面迁移）。
- 端口改直连：
  - `_addAndPersistMessage` → `_msgPersist.addAndPersistMessage`（`facadeWiring` 5 处、`orchestratorHost`、`taorContextWiring`、`streamPipelineFactory`；`ChatManager` 的 `_rollback` 端口与 `getSessionManager` 视图同步）；
  - `_buildTAORContext` → 模块函数 `buildTAORContextFor(host, …)`（`facadeWiring` / `orchestratorHost`）；
  - `_isCommandApproved` / `_submitToolApproval` → 模块函数（`facadeWiring`，`toolRegistry: host.toolRegistry`）；
  - `_sendMessageDowngradePath` → 模块函数（`orchestratorHost` 内构造 deps 字面量）。
- 宿主契约：`OrchestratorWiringHost` −3 成员 +1 字段（`_msgPersist`）；`FacadeWiringHost` −4 成员；`TaorContextWiringHost` / `StreamPipelineHost` 各 −1 成员 +1 字段（`_msgPersist`）。
- 删除（6）：`_addAndPersistMessage`、`_buildTAORContext`、`_sendMessageDowngradePath`、`_ensureCheckpointBoundary`、`_isCommandApproved`、`_submitToolApproval`。
- 测试驱动面迁移（断言强度不变）：`tests/budget/chatDowngradeGate.test.ts` 由直调 `ChatManager._sendMessageDowngradePath` 改为驱动**编排宿主端口** `chatOrchestrator.host.sendMessageDowngradePath`（仍走真实装配：host 端口 → 模块）。
- 实测：**3197 → 3087（−110）**；`tests/chat` 738 pass；全量 `bun test tests` **8961 pass / 41 skip / 0 fail**。

### 汇总与门禁（2026-10-29 实测）

- 本步：**3461 → 3087（−374，−10.8%）**；自 4840 起累计 **−1753（−36.2%）**。
- `bunx tsc --noEmit` 0 错误；`lint:arch` 0 错误；`lint:size` 0 错误（529 警告，本轮前既有）；`lint:state-ratchet` 维持；全量 `bun test tests` **8961 pass / 41 skip / 0 fail**。
- ⚠️ **风险如实**：端口直连后，装配模块以宿主**私有字段**作为入参（`_eventLogStore` / `_requestPrep` / `_msgPersist` / `_streamSetup` / `_streamMessageLifecycle` / `_streamFinalize` / `_pdcaLaunch`），与 #16 同一盲区（字段改名编译器不报错）；七个字段均已登记进对应键表，由装配期 `assertHostSurface` + `tests/chat` 构造回归兜底。
- **剩余候选（未做，如实）**：`_startRollbackRound` / `_endRollbackRound` / `_buildToolRoundMessages`（`_rollback` / `_streamMessageLifecycle` 端口）、`getOrAssembleSystemPrompt`（`_promptAssembly`）；`_createStreamPipeline` 需以宿主本体重入工厂（有环风险）故暂留；`_ensureYieldResumerInstalled` 因被 `tests/chat/taorLoopResumeWiring.test.ts` **实例级 monkey-patch** 暂留；`getClientForModel` / `recordChatResponseUsage` / `extractMemoryFromChat` 若要删，需在 4 处装配点各自复现 3 字段 deps 字面量（**耦合反而增加**）⇒ 判定为「不值得收敛」。
- **不可删**：`ChatManagerInterface` 声明的契约方法（`appendStreamEvent` / `getStreamTailSeq` / `readSessionEvents` / `updateMessageBlocks` / `createSession` / `saveSession` …），只可改内部实现。
