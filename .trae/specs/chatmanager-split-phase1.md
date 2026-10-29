# ChatManager 拆分 · 第一阶段（检查点 + 预算）拆分清单

> 对应 issue：[#8](https://github.com/cocosoft/Liri/issues/8)（替代已关闭的 #2）
> 基线（2026-10-29 实测）：`app/src/chat/ChatManager.ts` **4840 行**、方法声明 **164** 个；`app/src/chat/manager/` 已有 **14** 个子模块（最大 `bootstrap.ts` 742 行）。
> 进度（同实测口径）：Cut A 后 **4786 行**（`1017bb9fc`）；Cut B 后 **4552 行**（本刀，见 §二）。
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

### Cut C — 字段/初始化归并，达到 ≤4000

- **抽走**：Cut A/B 留下的字段、构造期初始化、budget 状态（`budgetSuspend*` 相关局部成员）并入 `CheckpointBudgetManager`。
- **验收**：`wc -l src/chat/ChatManager.ts` **≤ 4000**；`checkpointBudget.ts` **≤ 900**；其余门禁同上。

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
3. **Cut C（下一步，唯一还差的一刀）**：目标 `ChatManager.ts` **≤ 4000**（当前 4552，需再移出 ≥552 行）。候选面（按可整块移动排序，基于 Cut B 实测）：
   - 门面 getter/setter 区与 checkpoint 门面委托（`createCheckpoint` / `listCheckpoints` / `rollbackToCheckpoint` / `deleteCheckpoint` / `getLatestCheckpoint` / `deleteSessionCheckpoints`，`4201–4400` 区间内命中 13）；
   - 与检查点/预算绑定的**字段 + 构造期初始化**（`_checkpointService`、`checkpointInterval` 两处、`_budgetSuspendResumeWired` / `_budgetReliefUninstall`）并入各 manager 的持有者；
   - 若仍不足：把 `streamMessage` 内的**预算/检查点单行调用点**收敛为「一次调用一处判定」（Cut B 未做，因实测它们是单行、搬走无收益）。
   - **验收**：`wc -l src/chat/ChatManager.ts` ≤ 4000 + 四道门禁同 §三。
4. 每刀落地后把本文件的行数基线更新为当次实测值（禁止沿用旧数字）。
