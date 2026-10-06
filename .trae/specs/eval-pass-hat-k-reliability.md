# Spec：pass^k 可靠性曲线（组合式无偏估计）—— 论文行动 A1

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：🟢 **已实施（2026-10-06）** —— 用户「按推荐组合开始实施」直接采纳推荐决策 **D1=a · D2=a · D3=a**（见 §4）
> **来源**：`dev_docs/papers/精读笔记-优先级论文-2026-10-06.md` 行动 **A1**；依据 `dev_docs/papers/notes/tau-bench.md` §3.7（`pass^k` 定义，P4–P5）与 **§7.1**
> **关联规则**：GR15（Spec-Driven）· GR01（基础设施复用）· CS01（归一化）· CS03（回退最小化）· CS06（证据驱动）· R12-001（门禁基线）
> **前置**：`eval-framework-a-group.md`（A1–A7 已交付；**其 "A1" 与本 spec 的 "论文 A1" 同号不同源**，勿混）· `eval-s1-real-task-baseline.md`（论文 A2）
> **口径**：下列 `file:line` 为 **2026-10-06 实测**。

---

## 0. 一句话

Liri **已有**「每任务跑 k 次 + `pass1`/`passK`」（`--k=`，`scoring.ts:56-72`），语义上等价于 τ-bench 的 `pass^k`（**k 次全部成功**）；但 **只出单点**、且**无组合式估计** ⇒ 缺"可靠性**曲线**"。本 spec 只补这两处（**纯增量、旧输出逐字不变**）。

---

## 1. 取证（2026-10-06）

| 面 | 现状 | 位置 |
|---|---|---|
| 多次运行 | `--k=` / `--repeat-fresh=`（默认 1；`--k` 与 `--repeat-fresh` 互斥） | `cli.ts:143-150` |
| 单任务口径 | `pass1 = 符合期望次数 / 次数`；`passK = k 次**全部**符合期望` | `scoring.ts:56-72` |
| 整轮口径 | `passKRate`（全通过任务占比）、`pass1Mean` | `scoring.ts#summarizeRun` |
| 门禁 | `baseline.json` 的 `requirePassK` / `minPass1` | `scoring.ts:175-244` |

**缺口（净增量）**
| # | 缺口 | 说明 |
|---|---|---|
| **G-A** | **无组合式无偏估计** | τ-bench 的定义是 `pass^k = E_task[ C(c,k) / C(n,k) ]`（`n` = 试验次数、`c` = 其中成功次数，**n 可大于 k**）；Liri 只有"正好跑 k 次且全过"的布尔 `passK` ⇒ **无法回答"若只要求连续 k 次全过，可靠性是多少"** |
| **G-B** | **只有单点、无曲线** | τ-bench 的核心发现正是**曲线**（`pass^1 ≈ 61% → pass^8 < 25%`，P7 Fig.4"可靠性崩塌"）；Liri 只有单个 `passK` |

**CS01 归一化**：全仓 `passHatK|pass\\^k 曲线|reliabilityCurve` **0 命中** ⇒ 净增量；且**必须复用**既有 `summarizeTask`/`summarizeRun`/`report.ts`，**不新造指标**。

---

## 2. 目标 / 非目标

**目标**
- **G1**：新增**纯函数** `passHatK(successes, n, k)` —— `C(c,k)/C(n,k)`（组合式，数值稳定，边界显式）。
- **G2**：整轮新增 `reliabilityCurve` —— 对 `k = 1..K` 逐点求**任务平均**，`K` 由实际运行次数决定。
- **G3**：`report.ts` + CLI 汇总**展示曲线**（**仅当 k≥2**；k=1 时曲线退化为单点 ⇒ 不展示，避免噪声）。

**非目标**
- **N1** 不改 `pass1` / `passK` / `passKRate` / `pass1Mean` 语义（`baseline.json` 门禁**逐字不动**）。
- **N2** **不进退出码**（D3=a：与 `expectedPassRange`、`resolved` 同取向：仅观测）。
- **N3** 不引入「LM 用户模拟器 / 策略文档 / 写操作对齐」等 τ-bench 其余迁移点（属 §7.2/§7.3，另立）。
- **N4** 不新增 CLI 参数（复用既有 `--k=`）。
- **N5** 不改变 `--k` 与 `--repeat-fresh` 的互斥与默认。

---

## 3. 设计

### 3.1 纯函数（G1）

```ts
/** τ-bench 的 pass^k 无偏估计：C(successes, k) / C(n, k)（逐步乘法，避免大数） */
export function passHatK(successes: number, n: number, k: number): number;
```
**边界（显式，不猜）**：`n <= 0` ⇒ `0`；`k <= 0` ⇒ `0`；`successes < 0` ⇒ 截到 `0`；`k > n` 或 `k > successes` ⇒ `0`；
否则 `Π_{i=0}^{k-1} (successes - i) / (n - i)`。

> `k = 1` 时退化为 `successes / n`，与既有 `pass1` **同值**（可作为自洽校验）。

### 3.2 整轮曲线（G2）

`EvalRunSummary` 增**可选** `reliabilityCurve?: Array<{ k: number; value: number; tasks: number }>`：

- 逐任务取 `c_t`（`asExpected` 次数）与 `n_t`（`attempts.length`）；
- 对 `k = 1..K`：`value(k)` = **仅对 `n_t >= k` 的任务**取 `passHatK(c_t, n_t, k)` 的**算术平均**；`tasks` = 参与该点的任务数（**如实记录分母**，避免"没跑够"被当作失败）；
- `K = 该轮实际的最小运行次数上限`（= `max(n_t)`，但**只输出到有 ≥1 个任务能参与的点** ⇒ 即 `K = max(n_t)`；`n_t < k` 的任务按上式自动退出该点）；
- 无任何任务有 attempts ⇒ **不出该字段**（与 `security`/`resolvedRate` 同取向：无数据不编造）。

### 3.3 展示（G3）

- `report.ts`：汇总行后新增「**可靠性曲线**」小表（`k | pass^k | 参与任务数`）；**仅当 `curve.length >= 2`**。
- `cli.ts` 汇总段：追加一行 `pass^1 → pass^K` 的关键点（**仅当 k≥2**）。

---

## 4. 决策点（采纳推荐项）

| ID | 决策项 | 选项 | 采纳 |
|:--:|---|---|---|
| **D1** | 曲线取哪些 k | (a) **`k = 1..K`（连续）**／(b) τ-bench 的 `1/2/4/8`（需 n≥8） | **(a)** —— 不依赖"必须跑满 8 次"，对任意 `--k=n` 都可用 |
| **D2** | 某点分母口径 | (a) **只算 `n_t >= k` 的任务，并记录 `tasks`**／(b) 把 `n_t < k` 记为失败（0） | **(a)** —— (b) 会把"没跑够"混进"不可靠"，属**失真** |
| **D3** | 是否进退出码 | (a) **仅观测**／(b) 进 `checkGate` | **(a)** —— 与 `expectedPassRange`/`resolved` 同取向；进码须另立 |

---

## 5. 任务分解

| # | 步骤 | 产出 |
|:--:|---|---|
| **T1** | `scoring.ts` 新增 `passHatK()`（+ 边界注释） | 1 纯函数 |
| **T2** | `types.ts`：`EvalRunSummary.reliabilityCurve?`；`summarizeRun` 计算（无数据 ⇒ 不出） | 类型 + 组装 |
| **T3** | `report.ts` + `cli.ts` 展示（**仅 k≥2**） | 报告 / CLI |
| **T4** | 单测：边界（k>n / k>c / n=0 / k=0）· **k=1 与 `pass1` 同值**自洽 · 曲线端点（all-pass ⇒ 全 1；all-fail ⇒ 全 0；3/4 ⇒ `0.75/0.5/0.25/0`）· 无数据 ⇒ 字段不出 · **旧输出不变** | 测试 |

---

## 6. 验收（可证伪）

1. `bun run typecheck` → **0**；`bun run lint:arch` → **错误 0**（警告回基线）；
2. `passHatK(3, 4, 1..4)` = **`0.75 / 0.5 / 0.25 / 0`**（τ-bench 组合式，逐点可手算）；
3. `passHatK(c, n, 1) === c / n`（与 `pass1` 口径**同值**）；
4. 边界：`k > n` / `k > c` / `n = 0` / `k = 0` ⇒ **0**（不抛错）；
5. **旧输出不变**：`--k=1` 轮次**不产生** `reliabilityCurve`（字段缺省）；`pass1`/`passK`/`passKRate`/`pass1Mean` 逐字不变；
6. 全量 `bun test` → **0 fail**（当前基线：**4629 pass / 21 skip / 0 fail / 4650 tests / 490 files**）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| **GR15** Spec-Driven | ✅ 先 spec；决策已在 §4 采纳推荐项 |
| **GR01** 基础设施复用 | ✅ 复用 `summarizeTask`/`summarizeRun`/`report.ts`；**不新造指标** |
| **CS01** 归一化 | ✅ `passHatK`/曲线 全仓 **0 命中**；`k=1` 与既有 `pass1` 同值（自洽校验） |
| **CS03** 回退最小化 | ✅ 无数据 ⇒ **不出字段**（不做"以防万一"的 0 填充） |
| **CS04** 零 Mock | ✅ 测试为纯数值断言 |
| **CS06** 证据驱动 | ✅ §1 带 `file:line`；公式与页码对 τ-bench P4–P5 |
| **R12-001** 门禁基线 | ✅ `checkGate`/`baseline.json` **逐字不动** |

---

## 8. 未取证（如实）

| # | 项 | 说明 |
|:--:|---|---|
| **U1** | 多任务曲线的**真实分布** | 需真机跑 `--k=4/8`（模型额度）——本批只落**机制**，不给经验数值 |
| **U2** | `n_t` 不齐（基建重试/异常）时的曲线可读性 | 已用"记录参与任务数"缓解，**真机表现未验** |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项 + 实施（同批）** | 用户「按推荐组合开始实施」⇒ 采纳 **D1=a · D2=a · D3=a**。**T1–T4 一次交付**：`passHatK()` + `computeReliabilityCurve()`（`scoring.ts`）· `ReliabilityPoint` + `EvalRunSummary.reliabilityCurve?`（`types.ts`）· `summarizeRun` 组曲线（**无数据 ⇒ 字段不出**）· `report.ts` + `cli.ts`（**同为 k≥2 点**才展示）。测试 `tests/evals/passHatK.test.ts` **10 例** |
| 2026-10-06 | **实施中修正（如实）** | 首版用例把「不等 n」一点的期望值手算错（写成 `0.5`，实为 `C(2,2)/C(4,2) = 1/6`）⇒ **实现无误、期望值已按定义订正**（`toBeCloseTo` 精确断言），并保留该点为组合式的**区分性证据**（若退化为 `c/n`，该点会是 `0.5`） |
| 2026-10-06 | **验证（四证）** | `typecheck` **0** · `eslint`（`src/evals` + `tests/evals`）**0** · `lint:arch` **错误 0 / 警告 4（基线）**、分层文件数 **3886 不变** · 定向 **10 pass / 0 fail** · 全量 **4639 pass / 21 skip / 0 fail**（4660 tests / 491 files；较 A2 基线 **+10 例 / +1 文件 = 本批新增**，逐数吻合） |
