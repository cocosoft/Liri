# Pending Acceptance（待验收）状态机 —— 设计（G5，2026-11-18）

> 状态：🟢 **D1–D5 已实施（2026-11-18）**，端到端用例已补；两个开关默认关闭，
> 关闭时行为与改造前逐字一致。实施记录与提交号见 **§10**。
> 前置：[LRO 状态枚举一页纸](./lro-state-enumeration.md)（G2）。本文只讲**怎么落**；
> 事实全部来自源码（行号在文内）。

---

## 0. 结论先行

1. **不新建第二套验收器**：仓库已有「步骤全过后用副模型 + 产物取证判目标是否达成」的
   `GoalEvaluateGate`（`PDCA_GOAL_EVALUATE`，默认开）。G5 缺的不是评估能力，而是
   **把"未决/通过"落成状态位并让终态、回执、列表、前端都能区分**。
2. 因此 G5 = 在既有目标门上补一层 **`Plan.acceptance` 子态**（`pending` / `accepted` / `rejected`），
   与 `Plan.paused` 同一手法（**不新增 `Plan.status` 取值**，避免 `lint:state-ratchet` 的 Register-or-Fail）。
3. **默认开（2026-11-19 灰度结论后翻转）**：`PDCA_PENDING_ACCEPTANCE` 默认开；显式 `=false` 即回到
   「未决 ⇒ completed」的旧行为。旧检查点无该字段 ⇒ 视作 `accepted`（读侧兼容不变）。
   翻转依据：灰度中三条子态均真机取证（见 §10），且补了「既有 `rejected` 不被未决降级」护栏。

---

## 1. 现状取证（代码事实）

| 能力 | 事实 | 落点 |
|---|---|---|
| 目标级评估已存在 | 步骤终态后调副模型判"整体目标是否真正达成"；`converged===false` ⇒ 阻止假完成并落 `failed` | `lro/goalConvergence.ts:76-141` |
| 已有独立执行上下文 | 评估用 `GoalEvaluateContext { isolation, executor }`，**不是**执行者那轮的会话上下文 | `review/GoalEvaluateGate.ts:36-39` |
| 已有产物取证 | 按 `step.artifacts` 回读文本产物（≤40 文件 / 20k 字符），让"缺陷是否仍在"可核对 | 同上 `:132-160` |
| 已有超时与三态 | 30s 上限；`converged: true \| false \| undefined`，`evaluated=false` 表示降级/未决 | 同上 `:56-71` |
| **缺口 1：未决即放行** | `converged !== false` 就 `continue` ⇒ 评估超时/降级时**直接走 completed** | `goalConvergence.ts:114-116` |
| **缺口 2：无状态位** | 结论只进 `_goalEvaluation`（观测）与日志，不落计划/检查点 | `goalConvergence.ts:100-113` |
| **缺口 3：终态不可区分** | 回执只有「✅ 完成 / ⚠️ 未完成 / ⏸ 挂起 / ⏹ 中止」四态，没有"已执行待验收" | `lro/terminalReceipt.ts:99-131` |
| **缺口 4：前端不可见** | 任务卡只按 `Plan.status` 渲染 | 客户端任务卡（`plan:task_card`） |

---

## 2. 状态模型（新增一个子态，不动既有词表）

```ts
// TaskOrchestrator.ts（示意；与 Plan.paused 同址）
interface Plan {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted'; // 不变
  paused?: boolean;                                                    // 不变（等审批）
  acceptance?: 'pending' | 'accepted' | 'rejected';                    // 新增子态
}
```

**不变量**

1. `acceptance` 只在 `status==='running'` 且步骤全部终态时出现；`completed` 必须伴随
   `acceptance==='accepted'` **或** 缺省（旧数据）。
2. 不新增 `PlanStep.status` / `PdcaPhase` 取值：验收阶段沿用既有 `decide` 相位。
3. `acceptance` 必须进检查点投影（`lro/checkpointSnapshot.ts`）与续跑回填
   （`lro/resumeFromCheckpoint.ts`），否则重启后"待验收"会退回"进行中"。

---

## 3. 迁移规则（唯一入口 = 目标门收尾）

| 目标门结论 | 开关关（`PDCA_PENDING_ACCEPTANCE=false`，回退口径） | 开关开（**2026-11-19 起默认**） |
|---|---|---|
| `converged === true` | 走 completed | `acceptance='accepted'` ⇒ completed |
| `converged === undefined`（未决/超时/降级） | 走 completed（旧行为） | `acceptance='pending'`，**不置 completed**，发「⏸ 已执行，待验收」回执；**但**计划已有 `acceptance='rejected'` 时保持原值、走旧口径（未决不能推翻明确的否定结论） |
| `converged === false` | failed + replan（现状） | 不变（未收敛不是"待验收"） |
| 评估被关闭（`PDCA_GOAL_EVALUATE=false`） | 走 completed | 走 completed（开关组合时以此为准，避免"永远待验收"） |

**验收结论如何变成 `accepted` / `rejected`**

- `accepted`：目标门给出 `converged===true`（含后续重跑）；
- `rejected`：目标门给出 `converged===false` ⇒ 既有 `retry`/`escalate` 路径，不另立流程；
- 若要做「盲审」（干净会话只读需求 + 验收标准 + 产物台账），**复用** `GoalEvaluateGate`
  的 `isolation` 注入点扩一条 prompt，不新建执行器（见 §7-D5）。

---

## 4. 必须同步的判定点（漏一个就会出现假完成/假卡死）

| # | 判定点 | 改动 |
|---|---|---|
| 1 | `terminalReceipt.formatPdcaReceipt` | 增 `pendingAcceptance?: boolean`：为真时输出「⏸ 已执行，待验收」，**不得**命中「✅ 完成」分支 |
| 2 | 终态过滤 `PDCA_TERMINAL_PHASES` | 不改集合；`acceptance='pending'` 本质是 `status='running'` ⇒ 列表/`/resume` 天然可见可续 |
| 3 | `/resume` 闸 | 无需新分支：`status='running'` 已放行；**但**要确认它不会把 `acceptance='pending'` 覆盖成 `accepted`（回填时保留原值） |
| 4 | 前端任务卡 | `status='running' && acceptance='pending'` 显示"待验收"而不是"进行中" |
| 5 | 检查点投影 | `projectCheckpointSteps` 不动；`writePdcaCheckpoint` 载荷增 `acceptance` |
| 6 | 观测事件 | `pdca:decision` 载荷可带 `acceptance`（纯旁路，不改状态） |
| 7 | **启动扫描**（必须改） | `scanAndAbortStalePdcaTasks` 以 `isCheckpointLive` 判活（`phase`/`status` 任一终态即非活，`pdca-handlers.ts:146-155`），**活着的会被标 `abort`** ⇒ `acceptance='pending'` 的检查点会在下次启动被误杀。必须加白：`acceptance==='pending'` ⇒ 跳过 abort（落一条 info 日志） |

---

## 5. 失败与超时

| 情形 | 处理 |
|---|---|
| 目标门超时 / 降级（`evaluated=false`） | `acceptance='pending'`：**不谎报完成**，也不判失败 |
| 验收期间进程崩溃 / 重启 | **必须**改启动扫描（§4-⑦）：否则 `running + pending` 会被 `scanAndAbortStalePdcaTasks` 标成 `abort`；改后保留 `pending`，用户可继续验收 |
| 用户手动中止 | 走既有 `writeAbortCheckpoint`（`phase/status=abort`），`acceptance` 保留原值但不再参与判定 |

---

## 6. 兼容与回滚

- 旧检查点 / 旧计划：`acceptance` 缺省 ⇒ 一律视作 `accepted`（零行为变更）；
- 回滚：`PDCA_PENDING_ACCEPTANCE=false` 即回到「未决 ⇒ completed」（**默认已开，回退需显式设 false**）；
- 数据：不新增文件、不新增表；只多一个布尔/枚举字段。

---

## 7. 分阶段实施（每阶段独立提交）

| 阶段 | 内容 | 验收 |
|---|---|---|
| D1 | `Plan.acceptance` 字段 + 目标门收尾写值（开关关时只写 `accepted`，行为不变）+ 检查点投影/回填 | 单测：四种结论映射；旧数据缺省不误判 |
| D2 | 回执与列表：`formatPdcaReceipt` 增待验收态；`/v1/pdca/:id` 透出 `acceptance` | 回执四态矩阵单测（❌ 不得出现"✅ 完成"） |
| D3 | 开关化：`PDCA_PENDING_ACCEPTANCE` 打开后未决 ⇒ pending | 端到端：超时/降级时计划不置 completed；`/resume` 可续 |
| D4 | 前端任务卡"待验收"徽标（含 i18n zh/en） | client vitest + i18n parity |
| D5 | 盲审增强：复用 `GoalEvaluateContext.isolation` 扩一条"只读需求 + 验收标准 + 产物台账"的 prompt | 评估样例落库可核对；关闭即回退 |

---

## 8. 不做（明确边界）

- 不新增 `PlanStep.status` 取值（如 `awaiting_acceptance`）——会让三张派生映射全部要改；
- 不新建第二套"验收 Agent 执行器"——已有 `GoalEvaluateGate` 的 isolation/取证/超时；
- 不把"验收"做成阻塞主流程的人工卡（本期用状态位 + 回执，人工可在 UI 上按 `/resume` 处理）；
- 不改 `PDCA_TERMINAL_PHASES` 的语义（否则崩溃恢复与列表过滤会连带改写）。

---

## 9. 测试清单

| 层 | 用例 |
|---|---|
| 单测 | 四结论 × 开关两态 → `acceptance`/`status` 矩阵；旧数据缺省 = accepted |
| 单测 | `formatPdcaReceipt`：`pendingAcceptance` 为真时**不出现**「✅ 完成」 |
| 契约 | `GET /v1/pdca/:id` 透出 `acceptance`；检查点读写往返保留该字段 |
| 端到端 | 目标门超时 ⇒ `running + pending`、回执为「⏸ 已执行，待验收」、`/resume` 可续 |
| 门禁 | `bun test`、`lint:state-ratchet`（不得新增状态词汇）、`lint:arch`、`lint:fn-size` |

---

## 10. 实施记录（2026-11-18）

| 阶段 | 提交 | 落点（实测） |
|---|---|---|
| D1 | `4e96fe8d6` | `Plan.acceptance` + `PLAN_ACCEPTANCE_*`（`TaskOrchestrator.ts`）；目标门写值（`lro/goalConvergence.ts`）；检查点载荷（`lro/checkpointPersist.ts`）与续跑回填（`lro/resumeFromCheckpoint.ts`） |
| D2 | `47a0af431` | `formatPdcaReceipt` 增 `pendingAcceptance` 分支（`lro/terminalReceipt.ts`）；检查点读模型透出 `plan.acceptance`（`infrastructure/http/handlers/pdca-handlers.ts`） |
| D3 | `7c55cbcae` | `isPendingAcceptanceEnabled()`（`lro/portResolvers.ts`）；`pendingAcceptance` 结论 + 编排循环早退（`LongRunningTaskOrchestrator.ts`）；`emitPdcaPendingAcceptanceReceipt`；启动扫描加白（`pdca-handlers.ts`） |
| D4 | `f37d6f002` | 客户端 `Plan.acceptance` / `TaskCardData.acceptance` / `mapPlanToTaskCard`；`TaskCard` 徽标；i18n `chat.taskPendingAcceptance`（zh/en） |
| D5 | `2ca233cd2` | `PDCA_GOAL_BLIND_REVIEW`（默认关）+ 盲审 prompt/systemPrompt；`GoalEvaluateInput.steps[].acceptanceCriteria` 投影 |
| 端到端 | `7afffa163` | `tests/tasks/lroExecuteDecideRounds.test.ts`：未决 + 开关开 ⇒ `decide/running/pending` + 回执 + 检查点 + `/resume` 复现 |

**与 §9 的对应（如实）**

- 单测/契约/端到端/门禁四项均已有对应用例（`tests/tasks/goalConvergenceAcceptance.test.ts`、
  `tests/tasks/review/GoalEvaluateGate.test.ts`、`tests/http/pdca-{receipt,status.contract,checkpoint-liveness.contract}.test.ts`、
  `tests/tasks/lroExecuteDecideRounds.test.ts`；客户端 `src/utils/__tests__/planRestoreAcceptance.test.ts` + i18n parity）。
- 全量门禁基线（2026-11-18）：后端 `13062 pass / 42 skip / 0 fail`；客户端 `1032 pass`（146 files）。
- **真机灰度（2026-11-19 已执行，结论如实）**：`PDCA_PENDING_ACCEPTANCE=true` 起临时实例后跑了 3 个**产出交付物**的真实任务
  （`pdca_mwn8sp00` / `pdca_mwn9jcv0` / `pdca_mwn9peny`，DeepSeek V4 Pro/Flash）——
  `converged=true ⇒ accepted + completed`（2 次）与 `converged=false ⇒ rejected + failed`（1 次，`confidence=0.92`，
  拦下一次"产物写成别的目录"的假完成）**均已观察到**，回执分别命中「✅ 完成」与「⚠️ 未完成」。
- **pending 分支：补测后已观察到（2026-11-19 同日）**。首轮因超时写死 30s、目标门总能按时返回明确结论 ⇒ 真机无法制造
  `evaluated=false`；遂把超时改为可配 `PDCA_GOAL_EVALUATE_TIMEOUT_MS`（默认 30000 不变），以 `=1000` 复跑：
  `phase=decide`、`acceptance=pending`、回执「⏸ 长程任务已执行，待验收」；**杀进程重启后检查点未被启动扫描 abort**（§4-⑦ 生效）；
  `/resume` 后仍 pending；恢复默认超时再 `/resume` ⇒ `completed + accepted`（收口）。全链见记录 §6.3。
- **补测暴露并修掉两个真实缺陷（同一提交）**：
  ① 「计划保持 running」原未真正落实 —— 步骤结算 `_settlePlanFinalStatus` 已把计划置 `completed`，pending 后
  `status=completed` 与 `acceptance=pending` 并存（前端徽标 `running && pending` 永不命中）⇒ pending 分支显式回退为 `running` 并清 `completedAt`；
  ② `/resume` 被「内存编排器存活 + 活跃 status」闸回 409「正在运行」，与回执「可 POST /resume 处理」自相矛盾 ⇒ 对 `acceptance==='pending'` 放行。
  记录：`dev_docs/20261119/G5-灰度观察记录-20261119.md`（含回执原文、状态字段、费用口径与复原清单）。

**开关与回退（2026-11-19 增补 1 项；`PDCA_PENDING_ACCEPTANCE` 同日翻默认开）**

| 开关 | 默认 | 开启效果 | 回退 |
|---|:--:|---|---|
| `PDCA_PENDING_ACCEPTANCE` | **`true`**（2026-11-19 起） | 目标门未决 ⇒ `acceptance='pending'`、计划保持 `running` | 显式设 `false` ⇒ 回到"未决 ⇒ completed" |
| `PDCA_GOAL_BLIND_REVIEW` | `false` | 评估改盲审口径（原始需求 + 验收标准 + 产物证据） | 设 `false`/删除即回原 prompt |
| `PDCA_GOAL_EVALUATE_TIMEOUT_MS` | `30000` | 目标门评估超时（毫秒）—— 缩短它即可在真机复现 `evaluated=false ⇒ pending` | 删除即 30000；非数字/≤0 同样回退默认 |
