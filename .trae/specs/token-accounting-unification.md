# Token 会计口径统一（G2 专项设计）

> 状态：**P1 + P2 + P3 已实施（2026-11-18）；P4 真机长会话复验已通过（2026-11-21）**
> 来源：真机会话 `session_mwkthat73b80a6724f` 排查（台账 G2）
> 关联：G1（压缩体积口径，**已修**）、`compactionTokenPair.test.ts`（既有先例）

---

## 1. 背景：同一批消息，三个数

2026-11-17 23:48:31（本机）同一秒、同一份 779 条消息，日志给出三个互不相同的 token 数：

| 来源 | 值 | 公式 |
|---|---:|---|
| `compaction:①触发评估` | **293 079** | `estimateMessagesTokens(messages)`（tiktoken 全量） |
| `compaction:决策` / `snapshot.tokens` | **169 331** | `round((tailEstimate + estimatedOutput) × calibrationFactor)` |
| `unified:checkBeforeRequest.estimatedTotal` | **132 274** | `tailEstimate + estimatedOutput`（未乘 factor） |

后果（已在 G1 实测）：

- 压缩节省率用**校准值作前值、原始估值作后值** ⇒ `savingPercent = -16.2%`（"压缩后变大"）；
- 压缩后 `196778` 仍 > `128000` 却无告警（不同尺子比较，看不出超窗）；
- 反抖动阈值、水位展示、成本报表的"节省 token"各自建立在不同尺子上。

---

## 2. 现状：五处口径（唯一事实清单）

| # | 口径 | 实现 | 单位 | 是否校准 | 消费者 |
|---|---|---|---|---|---|
| E1 | 全量原始估值 | `app/src/ai/tokenizer/TokenEstimator.ts` `estimateMessagesTokens()` | 消息数组 tokens（含 role 开销） | 否 | 压缩前后对比、Council、测试 |
| E2 | 尾部协作估值 | 同文件 `estimateMessagesTokensCooperativeFromTail(messages, cap)` | 同上；**达 cap 即提前返回 ⇒ 下界** | 否 | `checkBeforeRequest` 基线 |
| E3 | 未校准总量 | `packages/tokenBudget/src/tokenBudget/UnifiedTokenTracker.ts:333` | `E2 + estimatedOutput` | 否 | **仅作 return.beforeTokens**（语义易误用） |
| E4 | 校准总量 | 同上 `:335-337` | `round(E3 × factor)` | 是（EMA，per-model 持久化） | `ratio`、水位提示、`snapshot.tokens` |
| E5 | 真实用量 | provider `usage`（`metric/timing`） | 服务端真值 | — | 校准输入、成本 |

校准链路（`tokenCalibration.ts:104-127`）：`raw = (真实 input − overhead) / baseline`，`factor ← α·raw + (1−α)·factor`；
`overhead = overheadSystemPrompt + overheadToolDefs`（**tools schema 不在 messages 里**，故必须扣除）。
`baseline` 为 E2 的下界（capped 时偏小）⇒ 该样本会**放大 raw**，这是 E4 与 E1 差距的第二个来源。

---

## 3. 根因（三类，缺一不可）

1. **单位混用**：`beforeTokens`（E4，含 output、含 factor）与 `afterTokens`（E1，纯 input）当同一尺子相减。
2. **语义字段名不含语义**：`beforeTokens` / `snapshot.tokens` 都不说明"含不含 output、含不含 factor"，调用方只能靠读实现判断。
3. **下界当等值用**：E2 触 cap 时是**下界**（日志有 `estimateCapped:true`），但下游没有区分对待，压缩结果据此计算节省。

---

## 4. 设计

### D1 唯一"比较单位"= E1（原始 input tokens）

一切**差值/节省/增长**只允许 `E1 → E1`：
`savingPercent = (rawBefore − rawAfter) / rawBefore`（`_doCompact` 已按此修，见 G1）。
禁止任何"E4 − E1""E3 − E1"形式的算术。

### D2 校准只作用于"决策与展示"，单点应用

`calibratedTotal(messages, model, maxOutput) = round((rawInput + outputReserve) × factor)`；
调用方**不得自行乘 factor**，也不得把 `calibratedTotal` 当 input 使用。

### D3 拆类型：把歧义字段换成语义字段（不保留双写）

`CompactionDecision`（`packages/tokenBudget/src/tokenBudget/UnifiedTokenTracker.ts` 返回类型）：

```ts
interface CompactionDecision {
  decision: 'trigger' | 'warn' | 'skip';
  /** E1：原始 input tokens（比较单位；capped 时为**下界**） */
  rawInputTokens: number;
  /** E3：rawInput + outputReserve（未校准） */
  uncalibratedTotal: number;
  /** E4：uncalibratedTotal × factor（仅用于 ratio/展示） */
  calibratedTotal: number;
  /** 下界标记：true ⇒ rawInputTokens 是下界，节省率不可计算 */
  estimateLowerBound: boolean;
  maxTokens: number;
  ratio: number;
  reason?: string;
}
```

`snapshot` 字段**删除**，`beforeTokens` 字段**删除**（仓库无正式用户，按 `project_rules.md §1.3` 不做兼容层）。
所有消费点按语义改名：`agentPreReasoning.ts:302/319`、`streamMessageFlow.ts:282/294/346`、
`CompactionOrchestrator.ts:377/396/416/479/645`、`client/.../TrajectoryDetail.tsx:382-408`。

### D4 单一入口，两条实现同源

`estimateMessagesTokens`（E1）与 `...FromTail`（E2）收敛为**同一 `tokenOfMessage` 的两种遍历策略**
（当前已是同一 `tokenOfMessage`，本条只做契约化：同输入必须同结果，capped 时显式标注）。
测试沿用 `app/tests/ai/tokenizer/TokenEstimator.test.ts` 的"口径一致"用例并扩展到 cap 边界。

### D5 负节省不是错误，但**必须显式**

`rawAfter > rawBefore` 时：
- 压缩侧：Tier3 结果**拒绝采纳**（G1 已实现），节省率不写入反抖动样本；
- 报表侧（`CostReportService`、`ContextTracker`）：`saved = max(0, before − after)` 保留，但另记 `grew` 计数。

### D6 可观测：一次决策打一行，字段自解释

```
unified:checkBeforeRequest {
  decision, rawInputTokens, uncalibratedTotal, calibratedTotal,
  calibrationFactor, outputReserve, estimateLowerBound, maxTokens, ratio
}
```
压缩：
```
compaction:applied {
  beforeTokens,        // = measuredBeforeTokens（全量估算，与 afterTokens/savingPercent 同口径）
  afterTokens,
  savingPercent,
  decisionRawInputTokens,  // 决策侧 raw（可能是 1× 窗口下界）
  estimateLowerBound
}
```
两行日志**不得互相引用对方的数值**；排障时看 `beforeTokens/afterTokens` 判"是否真的变小"，看 `ratio` 判"是否超窗"。
（2026-11-21 订正：原写法 `rawBeforeTokens/rawAfterTokens` 与实现字段名不符；实现里 `beforeTokens` 语义即"全量 raw 实测基线"。）

### D7 不在本专项内做的事

- 不新增第二套估算器（CS01）；
- 不改 provider `usage` 口径、不改 tokenizer 精度（属另一专项）；
- 不对 `estimateCapped` 做"补算全量"（会重演 70s 阻塞，D-232/D-233 已裁定用下界 + 提前返回）。

---

## 5. 分期与验收

| 期 | 内容 | 验收（可证伪） |
|---|---|---|
| **P1** | D3+D6：`CompactionDecision` 类型改造 + 全部消费点改名 + 双字段日志 | ✅ **已实施（2026-11-18）**：`snapshot` / `beforeTokens` 已删除，全仓 `snapshot.tokens` 归零（仅历史注释保留）；`tsc` 三 project 0 错；`tests/chat + tests/context + tokenBudget` **1321 pass / 0 fail**；`lint:fn-size` 棘轮未增长 |
| **P2** | D3 前端：`TrajectoryDetail` 只展示 `ratio` + `rawBefore/rawAfter`（不再展示混口径 K 值） | 🟡 **最小切片已实施**：压缩进度文案改为「上下文水位 N%（估算）」；`TrajectoryDetail` 的 before/after 差值本就同源（raw），未改 |
| **P3** | D4+D5：估算器契约测试（同输入同结果 / cap 下界）；报表 `grew` 计数 | ✅ **已实施（2026-11-18）**：`TokenEstimator.test.ts` 新增 3 例（未触 cap 逐值相等 / cap 下界区间 `[cap, full]` / 空输入 0）；`CostReportService.TierStats` 增 `grewCount` / `grewTokens`（负增量**不抵扣**正向节省）+ 文本报告列出"N 次变大（未计入节省）"；`tests/cost` 4 例。`ContextTracker.getTotalTokensSaved()` 本就 `max(0, …)` 且无 grew 消费者 ⇒ 不新增 API（CS03） |
| **P4** | 真机复验：同一会话跑满窗口 | ✅ **已通过（2026-11-21，真机）**：会话 `session_mwpyw5fe51b2daacb8` 连发 6 轮大消息，ratio 达 **0.949** ⇒ 触发 tier-2 压缩（`beforeTokens=106794 → afterTokens=52022`，`savingPercent=51.3`）。离线复验 `bun run verify:token-accounting --since <会话开始>`：**决策 12 · applied 5 · mismatch 0 · no_effect 0**，四项断言全绿（① 决策字段完整 ② `savingPercent` 与前后同源 ③ raw 差异仅来自 `estimateLowerBound` ④ 无 `snapshot` 回流）。⚠️ 复验时后端仍跑**改动前**的构建 ⇒ 该批 `applied` 日志尚无本次新增的 `decisionRawInputTokens` / `estimateLowerBound`（重启后生效；脚本对缺省字段不判失败，只对"存在但不同源"判失败）。<br>附：复验中发现并修复的日志口径分裂见 §D6 订正 |

回滚：P1 为纯改名 + 类型拆分（无行为变更），单提交可 revert；P2 独立提交；P3/P4 不改变运行时决策。

---

## 6. 风险

| 风险 | 处置 |
|---|---|
| 改 `checkBeforeRequest` 返回类型影响 5 处消费点 | 编译期穷尽（删字段即报错），按 P1 一次改完，不设兼容层 |
| `estimateCapped` 下界被当成真实值 | D3 的 `estimateLowerBound` 显式字段 + D5 禁止据此算节省 |
| 校准因子本身偏差（EMA α、baseline 下界） | 本专项不改算法，只保证"乘 factor 只发生一次、且只在 calibratedTotal" |
| 前端展示语义变化 | P2 独立提交，含客户端用例 |

---

## 7. 与既有工作的关系

- **G1（已修）**：`CompactionOrchestrator._doCompact` 已把节省率改为 raw→raw，并加了"不降即拒 / 仍超窗告警 / 口径分裂留痕"。本专项是它的**类型层收口**（让混用无法编译通过）。
- **`compactionTokenPair.test.ts`**：已完成 `phase:'done'` 分支的同源修正，可作为 P1 的范式。
- **`UnifiedTokenTracker` 的 D-232/D-233**：尾部估算 + 1× 窗口封顶是性能裁定，本专项保留，只补"下界"语义。
