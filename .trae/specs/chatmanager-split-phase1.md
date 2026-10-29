# ChatManager 拆分 · 第一阶段（检查点 + 预算）拆分清单

> 对应 issue：[#8](https://github.com/cocosoft/Liri/issues/8)（替代已关闭的 #2）
> 基线（2026-10-29 实测）：`app/src/chat/ChatManager.ts` **4840 行**、方法声明 **164** 个；`app/src/chat/manager/` 已有 **14** 个子模块（最大 `bootstrap.ts` 742 行）。
> 目标：第一阶段把「检查点（checkpoint）+ 预算（budget）」编排抽到 `app/src/chat/manager/checkpointBudget.ts`（≤900 行），`ChatManager.ts` **≤4000 行**，行为不变。

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
  - 5 个 checkpoint 门面方法的实现体（`4652–4677`）；
  - `_ensureCheckpointBoundary`（`3843`）与 `_ensureBudgetSuspendResumeInstalled`（`1674`）的实现体；
  - 与它们绑定的私有字段/常量（`checkpointInterval` 两处、`checkpointBoundaryTool` 相关常量）。
- **ChatManager 保留**：同名 thin delegate（保持 `ChatManagerInterface` 与现有调用点零改动）。
- **预计**：移出 **250–400 行**（含注释与字段）。**单独完成达不到 ≤4000**，但它是后两刀的前置。
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

1. 先做 **Cut A**（低风险、可独立合并），拿到 `git diff --stat` 后据此校准 Cut B/C 的预期行数；
2. Cut A 落地后把本文件的行数基线更新为当次实测值（禁止沿用旧数字）。
