# Spec：学习语料的真实回归审计（`gateBlocked` 真值）

- **状态**：✅ 已实施（2026-11-15，提交 `cf469d7ad`；2026-11-21 复查：`bun test tests/evals/learningCaseGateAudit.test.ts` 7/7 pass）
- **来源**：`.trae/specs/learning-feedback-loop.md` §5-M6「真实回归拦截数回写台账」
- **前置**：同 spec M3（种子物料化）· M5（登记缺口 = 假阴性的一半）

---

## 1. 问题

M5 的 `gateBlocked` 只统计**登记缺口**（未登记进 `baseline.json` ⇒ `--gate` 必然阻断）。
它**回答不了**「已登记的题有没有真的退化」——而这正是闭环要度量的第三个数字（G5：回归拦截数）。

`evals --gate` 自己会算这件事（`checkGate`），但结果只出现在**跑批的 stdout 与报告文件**里：

- 跑批需要模型与长耗时 ⇒ 不能进提交门禁；
- 报告落在 `dev_docs/evals/eval-<stamp>.json`（本机文档面，不入库）；
- 目前没有任何命令能把「学习语料的回归情况」单独捞出来看。

## 2. 目标 / 非目标

**目标**
- **G1 可查**：一条命令读出「最近一次跑批里，`learning-case-*` 的通过 / 回归 / 未登记」三态明细。
- **G2 口径单一**：回归判定**复用** `checkGate` 的判据（`pass^1 < minPass1`、`requirePassK && !passK`），
  不另写一套"看起来差不多"的比较（CS01）。
- **G3 零副作用**：只读报告与基线；**不跑模型、不改基线、不写台账**。
- **G4 可失败**：发现回归时以非 0 退出（可挂到 CI/本地脚本），无回归时 0。

**非目标**
- **N1 不做自动登记**：基线 `minPass1` / `requirePassK` 仍由人工跑一次后录入。
- **N2 不新建存储**：不把回归结果写进候选台账/种子文件（避免第二套存储，R02）；"回写"= 命令可查。
- **N3 不改 `evals` 跑批行为**：`--gate` 的输出与退出码逐字不变。
- **N4 不解析 Markdown 报告**：只读 JSON 报告（结构化字段，CS02）。

## 3. 数据源

| 来源 | 形状（只取所需字段） |
|---|---|
| 跑批报告 `dev_docs/evals/eval-*.json` | `{ startedAt, model, k, tasks: [{ id, pass1, passK, attempts? }] }` |
| 门禁基线 `packages/evals/src/evals/baseline.json` | `{ tasks: Record<taskId, { minPass1, requirePassK }> }` |
| 语料前缀 | `learning-case-`（`LEARNING_CASE_TASK_PREFIX`，M3） |

> 报告缺省取 `dev_docs/evals/` 下**最新**（按 mtime）的 `eval-*.json`；可用 `--report=<path>` 指定。

## 4. 设计

```
eval-*.json ──┐
              ├─▶ auditLearningCaseGate()（纯函数） ──▶ { total, passed, regressions[], unregistered[] }
baseline.json ┘
                                                   └─▶ 脚本打印 + 退出码（有回归 ⇒ 1）
```

**纯函数**（`packages/evals/src/evals/tasks/learning-cases.ts`）
- `auditLearningCaseGate(reportTasks, baselineTasks)`：
  - 只取 `id` 以 `learning-case-` 开头的条目（其余任务不参与）；
  - 每条用 `checkTaskAgainstBaseline()`（本批从 `checkGate` 里抽出的**同一份判据**）判定；
  - 三态：`passed` / `regressions[]`（含 `kind: 'passK' | 'pass1'` 与原文案）/ `unregistered[]`。

**判据抽取**（`scoring.ts`）
- `checkTaskAgainstBaseline(taskId, stats, required)` ⇒ `{ unregistered, passKViolated, pass1Violated, messages[] }`；
- `checkGate` 改为调用它并 `push(...messages)` ⇒ **输出逐字不变**（有既有单测兜底）。

**命令**（`app/scripts/report-learning-regressions.ts`，`bun run report:learning-regressions`）
- 打印：报告路径/时间/模型、语料题数、通过、回归逐条（含原因）、未登记逐条；
- 未指定 `--report` 时自动取最新报告；一份都没有 ⇒ 提示先跑 `bun run eval -- --model=... --task=...`，退出码 2；
- 有回归 ⇒ 退出码 1；全通过 ⇒ 0。

## 5. 验收

| 项 | 判据 |
|---|---|
| 三态口径 | 通过 / 回归（passK、pass1 两类）/ 未登记 各 1 例单测 |
| 范围隔离 | 非 `learning-case-*` 的任务即使回归也不计入（不冒充全局门禁结果） |
| 判据单一 | 删除 `checkTaskAgainstBaseline` 的 `pass1` 分支 ⇒ 新审计与既有 `checkGate` 单测**同时**转红 |
| 零副作用 | 命令只读；`--gate` 行为逐字不变（既有门禁用例全绿） |
| 数据缺失 | 报告缺失 ⇒ 退出码 2 + 明确提示（不伪造 0 回归） |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 旧报告被误当"最新" | 打印报告时间与模型；需要时用 `--report` 指定 |
| 报告里没有 learning-case 题 | 显式打印「本次跑批未包含学习语料」，退出码 0（不误报失败） |
| 与 `--gate` 口径漂移 | 共用 `checkTaskAgainstBaseline`；单测同时覆盖两条调用路径 |
