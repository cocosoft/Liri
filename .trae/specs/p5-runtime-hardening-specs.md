# P5 运行面加固 · 三项未定义项的**最小可判定规格**（草案 v0.1）

> 状态：**待用户裁定**（三项均未接线，默认关闭）
> 来源：`dev_docs/20261027/Liri架构优化方案-20261027.md` §10 P5（原方案只给了名字，无段位/判据）
> 取证口径：2026-10-28 全仓检索「审批四段」「Budget Lease」「预算租约」**零命中** ⇒ 本文件是**首次落盘定义**，不是对既有实现的描述
> 关联：AC-11（`toolRecoveryPolicyGate`）· AC-10（强制边界三级判据）· `INV-EXEC-006`（执行入口契约）· `execution-entrypoints.json`（`ledger` 记账契约）

---

## §0 共同约束（三项都适用）

1. **默认关闭**：三项都是**行为变更**，一律新增 `default-off` 开关（`false`），并按 `.trae/specs/default-off-switches-review-gates.md` §2 登记"启用条件 / 回退 / 迁移期限"。
2. **判据必须可判定**：验收条目只能写"某测试/门禁通过"或"某结构化字段存在"，**不得**写"已实现""已加固"这类形式化表述（`lint:acceptance-criteria` 会拦）。
3. **事实源复用**：不得新增手写清单 —— 不可逆操作一律从 `app/src/tools/toolEffects.ts` 的 `TOOL_EFFECTS` 派生；执行身份一律以 `execution-entrypoints.json` 的 `ledger` 为准。
4. **不做投机接线**（CS03）：无真实事件触发前，`ledger: 'missing'` 的入口保持现状。

---

## §1 审批四段（Approval Four-Stage）

### §1.1 定义（四段，缺一不算审批）

| 段 | 名称 | 输入 | 产物（必须可观测） |
|:-:|---|---|---|
| ① | **申请** `requested` | 工具名 + 参数 + 会话 + 执行身份 | `approval/requested` 事件（含 `approvalId`） |
| ② | **呈现** `presented` | ①的产物 | 呈现载荷：**参数摘要**（脱敏）+ **风险级**（`TOOL_EFFECTS` 派生）+ **授权维度**（`approvalFingerprint`）+ **可选动作**（`allow_once` / `allow_session` / `deny`） |
| ③ | **决定** `decided` | 用户选择或超时 | `approval/decided` 事件（`decision ∈ allow_once|allow_session|deny`；超时 ⇒ `deny`，已有 `PermissionChecker.timeoutToDeny`） |
| ④ | **留痕** `recorded` | ③ + 授权维度 | 指纹落盘（`ApprovedCommandRegistry`）+ **审计事件**（同一条 `events.jsonl`，不新建通道） |

**关键判定**：四段是**同一条链的四个可观测点**，不是四次独立询问。第 ③ 段的 `allow_session` 只对**同一授权维度**生效（`approvalFingerprint`，PR-2 已有）。

### §1.2 判据（可执行）

| # | 判据 | 落点 |
|:-:|---|---|
| A1 | 四段事件名已注册进 `shared/events/eventNames.ts`（`approval/requested` / `approval/presented` / `approval/decided` / `approval/recorded`） | `app/tests/chat/eventTypeParity.test.ts` 同源门禁 + typecheck |
| A2 | 任一 `sideEffect !== 'none'` 的工具被调用时，**必须先产生 ① 与 ② 才能进入 ③**（顺序断言） | 新增 `app/tests/gates/approvalFourStageGate.test.ts`：以内存事件流断言顺序 |
| A3 | 第 ③ 段超时 ⇒ `deny`（不得 fail-open） | 既有 `PermissionChecker.isAskTimedOut` / `timeoutToDeny` 用例（已存在，补一条四段链断言） |
| A4 | 第 ④ 段的指纹必须**按授权维度**匹配，跨维度不得复用（`allow_session` 不得放大到别的参数） | 既有 `approvalFingerprint.test.ts`（已覆盖；四段链新增一条反证） |
| A5 | 负向自证：缺 ②（直接 ①→③）或 ③ 无决定就执行 ⇒ 门禁必红 | 同 A2 文件内夹具 |

**v1 实现范围（2026-10-28 回填，第二次 · 已接线）**：

- **A1 已做**：`shared/events/eventNames.ts` 增 `approval/requested|presented|decided|recorded`；
  同批补 `app/src/session/types/eventPayloads.ts`、`client/src/types/events.ts`、
  `knownEventTypes.ts`（三端一致性门禁 `app/tests/chat/eventTypeParity.test.ts` 通过）。
- **打点已接**：`app/src/permission/approvalAudit.ts`（开关 + 注入式落盘出口）+
  `app/src/runtime/api/approvalAuditSink.ts`（入口 `init.ts` 安装；按会话串行 append，`seq:0` 原子分配）。
  - ①② 在**两条真实建卡路径**：`PermissionChecker._submitToInbox`、`ChatManager._submitToolApproval`
    （同指纹复用既有卡时**不**新开链 —— 那条链的 ①② 在更早的提交里已落）。
  - ③④ 在 `runtime/inboxApproval.recordApprovalDecision`：读卡上 `metadata.approvalId` 成链；
    缺链起点（卡建于开关关闭期间）⇒ **不落**，避免孤立事件。
- **判定内核**：`app/src/permission/approvalStages.ts`（四段纯状态机）+ 9 条用例。
- **A2/A5 判据**：`app/tests/gates/approvalFourStageGate.test.ts`（**15 条**）。
- **取证补充（偏离规格原文）**：§1.1 第③段原写三值 `allow_once|allow_session|deny`，
  实测 Inbox 是**四档**（`approve`/`approve_session`/`allowlist_*`/`deny`）⇒ 增 `allow_always`
  （同 `allow_session` 必带 `fingerprint`）；`inboxApproval` 的 `APPROVAL_REPLIES` 改为由
  `APPROVAL_REPLY_TO_DECISION` **派生**（受理与审计同源）。
- **仍未接**：`by:'timeout'` —— `PermissionChecker.timeoutToDeny` **零调用方**（真实超时走 Inbox 过期），
  故超时决定当前**不产生** ③ 事件；要接需在 Inbox 过期路径上补一条「超时 ⇒ deny」的落点。

### §1.3 开关与回退

- 开关：**app 侧配置键**（与 §3 同先例）：`config.json → approvalFourStage: { enabled: boolean }`，默认 `false`。
  ⚠️ 不用 `FeatureFlag`：内核 `featureFlags.ts` 的 K08 体量棘轮已顶格（见 §3.3）。
  ⚠️ 读取路径：`permission`（infra）**不得**深路径导入 `@modules/config/settings/*`（`lint:arch`
  实测报红）⇒ 改经 `@modules/config` 的 `configManager.getConfigValue('approvalFourStage')`，
  解析收口 `parseApprovalFourStageConfig`（只有严格 `true` 才开启，其余 fail-closed）。
- 回退：关闭 ⇒ 现状（单次 ask + 指纹缓存，行为零变更；事件量为 0）。
- 迁移期限：~~开启前必须补齐 A2/A5 的端到端打点~~ ⇒ **已补齐**（见上），可直接开启观察。

### §1.4 待裁定（v1 已取默认，可后续调整）

1. ~~四段事件是每条工具调用都落盘，还是仅 `sideEffect !== 'none'`？~~ ⇒ v1 = **每条真实审批链**
   （审批卡本就是"有副作用的工具才需要"，故二者在实践中重合）；开关关闭时为 0。
2. ~~`presented` 是否必须等前端渲染 ack 才进 `decided`？~~ ⇒ v1 **不要求**（无 ack 通道）。

---

## §2 Budget Lease（预算租约）

### §2.1 定义

现状：`tokenBudget` 是**计量**（`ContextStatsCollector` 统计用量），没有"配额让渡/回收"。

租约 = 一次 execution 在**有限期限**内占用的一段预算：

```ts
interface BudgetLease {
  leaseId: string;
  executionId: string;
  amount: number;      // 授予的 token 额度
  used: number;        // 已用（结算时回写）
  expiresAt: number;   // epoch ms；到期未用 ⇒ 回收
}
```

规则（三条，均可判定）：

1. **不超额授予**：`Σ 未结算租约.amount ≤ 会话预算上限`；否则新的 `acquire` 必须等待或拒绝（不得静默超额）。
2. **到期回收**：`expiresAt` 到期未被结算 ⇒ 回收剩余额度（可被后续 execution 获取）。
3. **用尽 → 拒绝下一回合**：租约耗尽时**不中断在途工具调用**，只拒绝**下一次模型回合**（避免把已发出的副作用拦腰截断）。

### §2.2 判据（可执行）

| # | 判据 | 落点 |
|:-:|---|---|
| B1 | 纯函数 `summarizeLeases(leases)` 满足：超额授予 ⇒ 返回 violation；到期租约不计入占用 | 新增 `app/tests/gates/budgetLeaseGate.test.ts`（纯函数 + 负向夹具） |
| B2 | 租约与 execution 一对一：同一 `executionId` 不得同时持有两个未结算租约 | 同文件 |
| B3 | 用尽时的拒绝点是**回合开始**（不是工具执行中）：以 `acquire()` 返回值断言 | 同文件（注入替身） |

**v1 实现范围（2026-10-28 回填 · 第二次）**：**判定内核 + `cap` 来源已落地；接线经取证搁置。**

- 内核：`app/src/execution/budgetLease.ts`
  （`grantLease`：超额 / 同 execution 一对一 / 非正输入 一律拒绝；`settleLease`：结算即回收剩余；
  `summarizeLeases`：只计活跃租约；`shouldRejectNextTurn`：用尽只拒该会话**下一回合**）。
- **`cap` 来源（原 §2.4 第 3 问）已定**：`resolveLeaseCap(configCap, sessionBudgetTotal)` ——
  配置显式值优先（`> 0` 且有限），缺省取**会话级 `tokenBudget` 汇总**，两者不可用 ⇒ `0`
  （交给 `grantLease` fail-closed 拒绝，不猜额度）。
- 用例：`app/tests/execution/budgetLease.test.ts`（**14 条**，含"绕过上限"负向夹具与 cap 三态）。
  ⚠️ 落点偏离 B1 原文（原写 `app/tests/gates/budgetLeaseGate.test.ts`）：模块属执行域，用例就近放
  `tests/execution/`；`tests/gates` 仍只收"跨模块门禁"。
- **接线搁置的取证**：
  1. `ExecutionManager.acquire()` 全仓仅 **2 处**调用，且都在 `feature('CLIENT_STREAM_EXECUTION')`
     **默认关**后面 ⇒ 规格原定的接线点当前**不可达**；
  2. `acquire()` 对同一 session 原子唯一（只允许一个 `RUNNING`）⇒ **会话粒度**租约退化为
     "整会话一条租约"，与既有 `TokenBudgetController.checkBudget() === EXCEEDED` +
     `token_budget_guard` 停止钩子**语义重复**；
  3. `tokenBudget` 在 `ChatManager` 内，`ExecutionManager` 拿不到 ⇒ 需额外注入探针。
  ⇒ 真正有价值的粒度是**并发子执行**（subagent 让渡）；该能力落地前接线属投机（CS03 / §0.4）。
**已定的另两个口径**（原 §2.4 待裁定）：
1. 预算单位 = **会话级 token 汇总**（`cap` 由调用方按会话预算传入，本模块不猜单位；`max_tokens` 是单次请求配置，表达不了会话预算）；
2. 期限 = **墙钟**（`ttlMs`），回合内长任务不被回合边界截断。
**未做**：接线（`acquire()` 后授予、回合开始前判定）—— 取证见上「接线搁置的取证」（方案附录 D.6）。

### §2.3 开关与回退

- 开关（**接线时按 app 侧配置键**，与 §1/§3 同先例）：`config.json → executionBudgetLease: { enabled, cap, ttlMs }`，默认 `{ enabled: false, cap: 0, ttlMs: 1800000 }`（`cap: 0` ⇒ 取会话级 `tokenBudget` 汇总，见 `resolveLeaseCap`）。不用 `FeatureFlag`（内核 K08 体量棘轮已顶格）。
- 回退：关闭 ⇒ 现状（只计量、不限额）；租约表清空不影响既有统计。

### §2.4 待裁定（已在 v1 回填中定口径）

1. ~~预算单位~~ ⇒ **会话级 token 汇总**（`cap` 由调用方传入）。
2. ~~期限按回合还是墙钟~~ ⇒ **墙钟**（`ttlMs`）。
3. ~~`cap` 的来源~~ ⇒ **配置显式值优先，缺省取会话级 `tokenBudget` 汇总**（`resolveLeaseCap`）；两者不可用 ⇒ 拒绝授予。

---

## §3 Checkpoint 边界（不可逆操作前必须可回滚）

### §3.1 定义

现有 `CheckpointService`/`fileCheckpointing` 是**文件级快照**（按需触发）。"边界"= 一条**派生规则**：

> 任一 `TOOL_EFFECTS[name].sideEffect !== 'none' && !idempotent` 的工具执行**之前**，同会话必须存在一个**晚于上次该工具调用**的 checkpoint；否则按开关策略处理。

策略两档（可配置，默认严格）：

- `strict`：缺 checkpoint ⇒ **拒绝执行**（fail-closed）；
- `relaxed`：缺 checkpoint ⇒ 先**自动创建**再执行；创建失败 ⇒ 拒绝。

### §3.2 判据（可执行）

| # | 判据 | 落点 |
|:-:|---|---|
| C1 | 边界清单**派生自** `TOOL_EFFECTS`（不手写）：`deriveCheckpointBoundaryTools(effects)` 的输入输出可断言 | 新增 `app/tests/gates/checkpointBoundaryGate.test.ts` |
| C2 | `strict`：无 checkpoint ⇒ 工具不得执行（执行器返回拒绝 + 原因码） | 同文件（注入替身） |
| C3 | `relaxed`：自动创建失败 ⇒ 拒绝（不得 fail-open） | 同文件 |
| C4 | 只读工具（`sideEffect === 'none'`）**不触发** checkpoint（防空转/防噪声） | 同文件 |

### §3.3 开关与回退

- 开关（**已按应用侧配置键落地**）：`config.json → checkpointBoundary`（`enabled` / `mode: strict|relaxed`，默认 `{false, relaxed}`）。
- 回退：`enabled: false` ⇒ 现状（checkpoint 仍按既有策略触发）。
- 风险：`strict` 会显著降低"写文件/发消息"类工具的可用性（首次调用必被拦）⇒ 建议**先 relaxed** 上线观察，再切 strict。

**v1 实现范围（2026-10-28 回填）**：**策略 + 配置 + 接线均已落地**。
- 策略：`app/src/tools/policy/checkpointBoundary.ts`（边界清单派生自 `TOOL_EFFECTS` = 54 条；`allow / create-then-allow / deny`）。
- 开关（**应用侧配置键**，不进内核 `featureFlags` —— 内核 K08 体量棘轮已顶格）：
  `config.json → checkpointBoundary: { enabled: boolean, mode: 'strict' | 'relaxed' }`，
  默认 `{ enabled: false, mode: 'relaxed' }`；解析收口 `parseCheckpointBoundaryConfig`（非法值 fail-closed 到"关闭/relaxed"）。
- 接线点：`ChatManager.executeTool`（唯一主循环工具执行收口）在**写前记账之前**判定；
  配置读取走**动态 import**（否则 eager +1 文件会撞 AC-28 棘轮 —— 实测已踩中并回退）。
- 用例：`checkpointBoundaryGate`（7 条）+ `checkpointBoundaryConfig`（4 条）。

### §3.4 待裁定

1. checkpoint 的**粒度**：整会话（cp 覆盖所有文件）还是单文件（只备份目标路径）？文件级成本低但回滚不完整。
2. 非文件类不可逆操作（`send_message` / `broadcast` / `mcp_tool`）**无法用文件快照回滚** ⇒ 是否改为"事前幂等键 + 事后确认"（与 AC-11 同源）？

---

## §4 落地顺序建议（若三项都被批准）

1. **§3 Checkpoint 边界**（纯派生 + 单点拦截，风险可控，`relaxed` 起步）；
2. **§1 审批四段**（补事件 + 顺序门禁，不动执行链）；
3. **§2 Budget Lease**（需先定预算单位，改动面最大）。

每项独立提交，各配 `default-off` 开关 + 负向夹具 + 附录回填。

---

## §5 验收（本文件自身）

- 本文件不引入代码；三项均**未接线**。
- 落地时每项必须给出：开关名与默认值、门禁用例数、负向夹具、回退方式、`fix-evidence` 条目。
