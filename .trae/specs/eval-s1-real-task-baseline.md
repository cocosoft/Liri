# Spec：S1 真实任务级回归基线（F2P / P2P 双清单判据）—— A2

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：📋 **待评审（未动码）** —— 实施须先答 **§4 决策点 D1–D4**
> **来源**：`dev_docs/papers/精读笔记-优先级论文-2026-10-06.md` 行动 **A2**；依据 `dev_docs/papers/notes/swe-bench.md` §6（可直接采用 / 需改造）与 **§7.1**
> **关联规则**：GR15（Spec-Driven）· GR01（基础设施复用）· CS01（归一化）· CS02（状态禁字符串）· CS03（回退最小化）· CS04（零 Mock）· CS06（证据驱动）· R12-001（门禁基线）· R06-008（分层）
> **前置 spec**：`eval-framework-a-group.md`（A1–A7 已交付，含 A5「回归门禁 ≠ 信号基线」分层）· `eval-task-source-expansion.md`（S1 流水线已实施）
> **口径**：下列 `file:line` 均为 **2026-10-06 实测**。

---

## 0. 一句话

Liri 的 S1 题源（取自真实修复提交）**筛选、判据、隔离、准入都对齐了 SWE-bench**，但 **(a) 判据只到"整包 green/red"、 (b) 指标无 F2P/P2P 分解、 (c) S1 默认不进题集** ⇒ 还不能当"真实任务级回归基线"。本 spec **只补这三处**，不重造既有件。

---

## 1. 取证（2026-10-06 实测）

### 1.1 已有（复用，不重造）

| 面 | 现状 | 位置 |
|---|---|---|
| 题源筛选 | **双实测**：起点（父提交树 + 该提交测试文件）必须**真红**、覆盖源码后必须**绿**；拒 `unrunnable` | `fixTaskScreening.ts` |
| 判据 | **JUnit 三态** `green` / `red` / `unrunnable`（机器可读，CS02：**不**匹配日志文案） | `repoTestJudge.ts:44-87` |
| 物化 | 跑测试前**重放该提交的测试文件**（防被测者改测试）；准入 `ELIGIBLE_FIX_COMMITS`（fail-closed） | `fixTaskMaterialize.ts` |
| 隔离 | `git archive` 净化快照（不含 `.git`）+ `pathShield` / `shieldPlan` 屏蔽题源 | `repoSnapshot.ts` |
| 回归门禁 | `BaselineEntry{requirePassK,minPass1}` + `checkGate()`（含"未登记即失败"） | `scoring.ts:175-244` |
| 指标 | `summarizeTask` → `pass1` / `passK` | `scoring.ts:56-69` |
| 地板 | **11 条 `fix-*` 已登记**：8×`0.75` · `7035f271`=`0.5` · `50576842`=`0` · `4fc17ee1`=`0` | `baseline.json` |
| 报告 | `report.ts` 产 JSON + Markdown；历史报告在 `dev_docs/evals/` | — |

### 1.2 缺口（本 spec 的净增量）

| # | 缺口 | 证据 |
|---|---|---|
| **G-A** | **判据无逐用例粒度**：`JunitSummary` 只有 `{tests, failures}`，`parseJunitSummary` 只解 `<testsuites>` **头** ⇒ **无法区分"F2P 过了但 P2P 破了"** | `repoTestJudge.ts:47-68` |
| **G-B** | **指标无 F2P/P2P 分解**：`FAIL_TO_PASS` / `PASS_TO_PASS` / `failToPass` / `passToPass` 在 `app/src/evals/` **0 命中**；`summarizeTask` 只出 `pass1`/`passK` | grep 实测 |
| **G-C** | **S1 默认不在题集**：`tasks/index.ts#allTasks` 不含 S1，须 CLI `--fix-tasks` 显式纳入 | `tasks/index.ts` 头注释 |

### 1.3 CS01 归一化检查

- 既有 spec：`eval-framework-a-group.md`（A5 已做"回归门禁 ≠ 信号基线"分层，**不含 F2P/P2P**）、`eval-task-source-expansion.md`（S1 已实施，**不含 F2P/P2P**）⇒ 本 spec 为**净增量**。
- **必须复用**：JUnit 判据 · 双实测 · `checkGate` · `baseline.json` · `report.ts`。**禁止另起第二套指标**。

---

## 2. 目标 / 非目标

**目标**
- **G1 逐用例判据**：JUnit 解析下沉到 `<testcase>` 级，产出每个用例的 pass/fail（`repoTestJudge.ts`）。
- **G2 F2P / P2P 双清单**：由 S1 **双实测自动派生**（起点红 ⇒ F2P；起点绿且修复态绿 ⇒ P2P），随题物化固化到 `EvalTask`。
- **G3 resolved 语义**：`summarizeTask` 增补任务级 `resolved`（F2P 全过 ∧ P2P 全过）/ `breaking`（F2P 过 ∧ P2P 破）/ `no-op`（F2P 全不过），并计 `resolvedRate`。
- **G4 可作回归基线**：把 S1 子集接入门禁路径（沿用 `baseline.json` 地板），且**不引入假红**（2 条 0 地板题仍按 0 期望）。

**非目标**
- **N1** 不做 **attempt 级六分法**归因（`no-op`/`regression`/`partially-resolved`/`breaking-resolved`）—— 属 `notes/swe-bench.md` §7.2，**另立**。
- **N2** 不做**上下文/检索对照维度**（§7.3），另立。
- **N3** **不接入 SWE-bench Verified 公开基准本体**（需另行下载，超出 A2）。
- **N4** **不引入 patch 文本形态**（与 Liri 工具编辑范式冲突）。
- **N5** **不新增模型名/供应商硬编码**（`model-usage.md`）。
- **N6** F2P/P2P **不改** judgeSanity 语义、**不放宽**任何既有地板、**不改变**无 f2p/p2p 旧题的输出。

---

## 3. 设计

### 3.1 逐用例判据（G1）

新增**纯解析**（复用既有 fail-closed 取向）：

```ts
export interface JunitCaseResult { classname: string; name: string; passed: boolean; }
/** 报告缺失 / 结构不符 ⇒ null（调用方按 unrunnable 处理，**不**猜测推断） */
export function parseJunitCases(xml: string | null): JunitCaseResult[] | null;
```

> 判据来自**结构**（`<testcase>` 及其子元素 `<failure>`），**不**做日志文案匹配（CS02）。既有 `parseJunitSummary` / `classifyRepoTestRun` **保持不动**。

### 3.2 F2P / P2P 派生（G2）

在 S1 物化期，用**同一次双实测的两次运行**机械派生（零人工标注）：
- 起点运行中**失败**的用例 → **F2P**（必须由修复转绿）
- 起点运行中**通过**的用例 → **P2P**（修复后必须仍绿）

新增字段（`types.ts`，可选、向后兼容）：

```ts
f2p?: string[]; // 稳定键 "classname::name"
p2p?: string[];
```

**不变量**：`f2p ∩ p2p = ∅`；`f2p.length ≥ 1`（无 F2P 的题不是"修复类" ⇒ 物化期拒绝）。

### 3.3 resolved 语义（G3）

`summarizeTask` 在**带 f2p/p2p 的任务**上增补（无该字段的旧题**逐字不变**）：

- `resolved` = F2P 全过 ∧ P2P 全过
- `breaking` = F2P 全过 ∧ P2P 有破
- `no-op` = F2P 全不过（且判据可运行）

`EvalTaskResult` 增可选 `f2pP2P?: { f2pPassed, f2pTotal, p2pPassed, p2pTotal }`；`EvalRunSummary` 增 `resolvedRate?`（**仅有该字段的任务**参与分母）。

### 3.4 回归基线（G4）

- **D3** 决定 S1 与默认题集的关系（§4）。
- **基线登记**：沿用 `baseline.json`（11 条已在）；物化期新增 `f2p.length ≥ 1` 校验。
- 若 **D4=(b)**，`checkGate` 增 `resolved` 断言（**默认关**，避免影响既有地板语义）。

---

## 4. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D1** | F2P/P2P 事实源 | (a) **由双实测自动派生**（起点红→F2P / 起点绿→P2P）／(b) 静态推断提交 diff／(c) 手工登记 | **(a)** —— 机械可证、复用既有双实测、零人工标注 |
| **D2** | 逐用例判据实现 | (a) **新增 `<testcase>` 解析器**（一次运行即得）／(b) 只跑"仅 F2P 文件 / 仅 P2P 文件"两次分桶（不改解析） | **(a)** —— 一次运行、且能报"**哪个用例**破"（诊断价值） |
| **D3** | S1 与默认题集 | (a) **维持 `--fix-tasks` 显式**（不改默认）／(b) 纳入 `allTasks` 默认／(c) 新增显式"回归基线档" | **(a) 或 (c)** —— (b) 会让默认评测变慢并引入 11 条地板（含 2 条 0 地板），收益未证 |
| **D4** | F2P/P2P 是否进退出码 | (a) **仅观测**（对齐 A2/A5 既有约定）／(b) 进 `checkGate` | **(a)** —— 与 `expectedPassRange` 同取向；进码须先有多轮数据 |

---

## 5. 任务分解（T1–T5，D1/D2 定后执行）

| 编号 | 步骤 | 产出 | 前置 |
|:--:|---|---|---|
| **T1** | `parseJunitCases()` 纯解析器 + 单测（截断 / 缺字段 / 空用例集 ⇒ `null`） | 1 函数 + 测试 | D2=a |
| **T2** | S1 物化期派生 `f2p`/`p2p` 写入 `EvalTask`（含不变量校验） | `fixTaskMaterialize.ts` + 测试 | D1=a、T1 |
| **T3** | `summarizeTask` 增 `resolved/breaking/no-op` + `f2pP2P`；`summarizeRun` 增 `resolvedRate` | `scoring.ts` + 测试 | T2 |
| **T4** | `report.ts` 展示（JSON / MD 各一处） | `report.ts` | T3 |
| **T5** | 按 D3/D4 接线门禁；S1 子集 `--gate` 实跑 | CLI / 基线 + 报告 | T3、D3/D4 |

---

## 6. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/evals/repoTestJudge.ts` | **新增** `parseJunitCases`（**不动**既有三态判据） |
| 2 | `app/src/evals/types.ts` | `EvalTask.f2p/p2p?` · `EvalTaskResult.f2pP2P?` · `EvalRunSummary.resolvedRate?` |
| 3 | `app/src/evals/fixTaskMaterialize.ts` | 物化期派生 + 不变量校验 |
| 4 | `app/src/evals/scoring.ts` | `summarizeTask` / `summarizeRun` 增补（**旧题行为不变**） |
| 5 | `app/src/evals/report.ts` | 展示 |
| 6 | `app/tests/evals/*` | 新增 / 扩展用例 |

---

## 7. 验收（可证伪）

1. `bun run typecheck` → **0 错误**；
2. `bun run lint:arch` → **错误 0**（警告回基线）；
3. 纯函数单测：`parseJunitCases` 覆盖「有失败用例 / 全过 / 报告缺失 / 结构不符 / 空用例集」；
4. **不变量测试**：`f2p ∩ p2p = ∅` 且 `f2p` 非空；**无 f2p/p2p 的旧题** `summarizeTask` 输出**逐字不变**（回归锁定）；
5. `resolved` / `breaking` / `no-op` 三态各 ≥1 例（构造 attempts）；
6. 全量 `bun test` → **0 fail**（当前基线：**4612 pass / 21 skip / 0 fail / 4633 tests / 488 files**）；
7. **S1 子集 `--gate` 实跑**不引入假红（含 2 条 0 地板题仍按 0 期望）。

---

## 8. 合规检查清单

| 规则 | 结论 |
|---|---|
| **GR15** Spec-Driven | ✅ 先 spec，§4 裁定后动码 |
| **GR01** 基础设施复用 | ✅ 复用 JUnit 判据 / 双实测 / `checkGate` / `baseline.json` / `report.ts`；**不新造指标** |
| **CS01** 归一化 | ✅ §1.3 已查：无既有 F2P/P2P 实现（**0 命中**） |
| **CS02** 状态禁字符串 | ✅ 判据基于 JUnit **结构**（classname + name），非日志文案 |
| **CS03** 回退最小化 | ✅ 报告缺失一律 `unrunnable`（fail-closed），不做"以防万一"的猜测推断 |
| **CS04** 零 Mock | ✅ 测试用字面 JUnit XML 片段 + 构造 attempts |
| **CS06** 证据驱动 | ✅ §1 全部带 `file:line` |
| **R12-001** 门禁基线 | ✅ 新题须登记；**不放宽**既有地板 |
| **R06-008** 分层 | ✅ 改动全在 `app/src/evals/`（app 层） |

---

## 9. 未取证（如实列出，不作结论）

| # | 项 | 说明 |
|:--:|---|---|
| **U1** | JUnit XML 中 `classname` 的稳定性 | 需实测 `bun test --reporter=junit` 在嵌套 `describe` 下的命名形态 —— **未测** |
| **U2** | `fixTaskScreening` 双实测能否**逐用例**留存 | 现接口只回 `verdict`，是否需扩展签名 —— **未核** |
| **U3** | 11 条 `fix-*` 的 F2P/P2P 实际规模 | 未统计（影响"难度分层"判断） |
| **U4** | S1 纳入默认题集后的耗时 | 未测 |

---

## 10. 与既有 spec 的关系

| Spec | 关系 |
|---|---|
| `eval-framework-a-group.md` | **前置**：A1–A7 已交付；本 spec 承接其"回归门禁"面，**不改** A5 的信号基线分层 |
| `eval-task-source-expansion.md` | **前置**：S1 流水线已实施；本 spec 在其判据上**加逐用例粒度与 F2P/P2P**，**不改**其准入/隔离 |
| （未来）attempt 级六分法 spec | **边界**：本 spec 只做**任务级三态**；attempt 级六分法（§7.2）另立 |

---

## 11. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项（未动码）** | 本 spec 创建（来源 `papers/精读笔记-优先级论文-2026-10-06.md` **A2**）。取证：既有 S1 已对齐 SWE-bench（§1.1），净增量为 G-A/G-B/G-C（§1.2）。**状态=待评审**，实施须先答 **§4 D1–D4** |
