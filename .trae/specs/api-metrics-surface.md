# Spec：API 指标展示（原 `pushApiMetricsEntry` 立项）

> 版本: 1.0 ｜ 创建: 2026-09-23 ｜ 状态: **已实施（2026-09-23）**（三项裁决见 §6；实施偏离见 §8.2）
> 关联：TR-20 / TR-14 / [`TR-12-TR-14-决策记录.md`](../dev_docs/20260922/trajectory-benchmark/TR-12-TR-14-决策记录.md) §8.2｜`.trae/specs/llm-request-otel-span.md`（D7 记录该通道"未启用"）
> 立项缘由：决策记录 §8.2 判定 `pushApiMetricsEntry` **"不是接线缺口，而是缺失接收端"** ⇒ 应单独立项。

---

## 1. 问题（Problem Statement）

**原始诉求**：`ToolUseContext.pushApiMetricsEntry?: (ttftMs: number) => void` 是一条"端点齐全、只缺接收端"的指标通道；配套消息工厂 `createApiMetricsMessage()` 同样是死代码。

**立项前取证（本轮实测，非估算）**：

| # | 事实 | 证据（文件:行） |
|---|---|---|
| 1 | 该钩子**无实现方、无调用**（全仓仅 1 处 = 定义） | `app/src/tools/types/Tool.ts:171` |
| 2 | 配套消息工厂**从未被调用**（全仓 2 处 = 定义 + 类型字面量） | `app/src/utils/messages.ts:303-313` |
| 3 | 指标数据**已落盘**，且含真 TTFT/TTFB | `app/src/chat/types/events.ts:315-335`（`metric/timing`：`ttfb` / `ttft` / `tokens` / `duration`） |
| 4 | 前端**已展示** `ttft`/`ttfb`/`tokens`/`duration`（含"缺失回退 ttfb 且标签如实"） | `client/src/components/Trajectory/TrajectoryRow.tsx:163-179`（`previewTiming`） |
| 5 | OTel 侧另有真 TTFT（`llm_request.ttft_ms`） | 生产 `app/src/chat/orchestrator/streamMessageFlow.ts:1043`；消费 `app/src/monitoring/tracing/SessionTracing.ts:341` |

**结论**：**"缺失的接收端"不是数据链路，而是"聚合展示面"** —— 数据已满足 §1.6「模型可见/可重建 ⇔ 已落盘」，且单条事件的字段已可见；缺的是**会话/回合级的聚合指标视图**。

---

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| **D1** | **不启用** `pushApiMetricsEntry` 内存通道 | ① 与事件溯源**重复**（同一数据已在 `metric/timing`）⇒ 违反 **CS01 归一化**（新增前先查已有）；② "启用"需新建一份 `ToolUseContext` 实现方（跨层改造 + 内存态）⇒ 违反 **CS03 复杂度最小**；③ 内存态**不落盘** ⇒ 与 **§1.6 红线**（可重建性）相悖 |
| **D2** | 立项范围收敛为**读端聚合展示**：会话级 + 回合级"请求指标"视图 | 唯一真实缺口（见 §1 表 3/4） |
| **D3** | 数据源 = **事件日志 `metric/timing`**（唯一事实源）；OTel span 仅作观测，**不参与 UI** | 数出同源（`project_rules.md` §1.5） |
| **D4** | 只展示**事件自带字段**，**不跨事件拼接**（如"tokens ÷ duration"） | 沿用 P3-4 已确立的口径：分属不同事件的字段拼出来的数不是真实测量值 |
| **D5** | 删除死工厂 `createApiMetricsMessage`（无消费者） | 死代码；若将来要 CC 兼容再按需加回（当前应用无正式用户 ⇒ 无需兼容层） |

---

## 3. 接口设计（读端）

### 3.1 计算层（纯函数，可单测）

新建 `client/src/stores/chat/deriveApiMetrics.ts`：

```ts
export interface ApiMetricsSummary {
  requestCount: number;              // `metric/timing` 请求级（stage==='request'）事件数
  latencyEventCount: number;         // 带 `ttfb` 的请求级事件数（延迟样本来源；UI 据此区分"无数据"与"样本不足"）
  ttft: { p50: number; p95: number; n: number } | null;   // n<2 ⇒ null（不出分位数）
  ttfb: { p50: number; p95: number; n: number } | null;
  missingTtftCount: number;          // 延迟类事件中无 ttft（纯 tool_call 响应，如实计数）
  tokens: { input: number; output: number; total: number; cacheRead: number; cacheCreation: number } | null;
  // 注：**不产出** `throughputTps` —— 吞吐 / 模型耗时合计由轨迹时间线 header 承担
  //（`TrajectoryTimeline` 的 `modelMs` / `throughputTps`），本视图只做"请求级"聚合，
  // 避免同一指标两处重复展示（CS01 归一化；2026-09-23 实施时调整，见 §8）。
}
export function deriveApiMetrics(events: LiriEvent[]): ApiMetricsSummary;
```

- 输入：已被 `filterTrajectoryEvents` 过滤的 `LiriEvent[]`（与列表同源）。
- 缺项语义：**`null` / 不产出**，不造默认值（CS03）。
- 复杂度声明（对齐 P3-3）：时间 `O(E log E)`（主因分位数排序；E = 事件数），空间 `O(k)`（k = 请求级事件数）。

### 3.2 展示层（位置二选一，见 §6）

- **A（推荐）**：轨迹检查器新增「请求指标」分区 —— 复用既有 `ChatInspector` 装配与 `trajectoryStore`，**无消息模型改动**。
- B：聊天区消息下方轻量角标 —— 需建立"消息 ↔ 请求事件"的关联，改动面更大。

---

## 4. 影响文件（预估）

| 文件 | 变更 |
|---|---|
| `client/src/stores/chat/deriveApiMetrics.ts`（新建） | 聚合纯函数 |
| `client/src/tests/api-metrics.test.tsx`（新建）或并入既有 tests 目录 | 单测（缺字段/单样本/多请求/吞吐缺一侧/含失败请求） |
| `client/src/components/Trajectory/*` 或 `ChatInspector.tsx` | 展示分区（按 §6 裁决） |
| `client/src/i18n/locales/zh.ts` / `en.ts` | 文案（zh/en 同步） |
| `client/vite.config.ts` | 新文件纳入逐文件覆盖率门槛（按实测值设棘轮） |
| `client/e2e/trajectory.spec.ts` | 追加"请求指标分区渲染双态"用例（复用既有基座与 `requireRows` 跳过策略） |
| `app/src/utils/messages.ts` | 删除死工厂 `createApiMetricsMessage`（D5） |

---

## 5. 验证

| 层 | 用例 | 通过标准 |
|---|---|---|
| 纯函数单测 | 无 `metric/timing` ⇒ 全 `null`/`undefined`；单样本 ⇒ 不出分位数；多样本 ⇒ p50/p95 正确；缺 `ttft` ⇒ 计入 `missingTtftCount` 且不参与分位数；吞吐一侧缺失 ⇒ `undefined` | 全绿 + **新文件逐文件门槛达标** |
| 覆盖率 | `bun run test:coverage` | **EXIT=0** |
| e2e | 选含 `metric/timing` 的会话 ⇒ 分区渲染；空库/无数据 ⇒ 显式 `skip` | 该 spec 全绿 |
| 回归 | `bun run test` / `tsc --noEmit` / `eslint` | 全绿、0 problem |
| 数据真实性 | 用例数值取自**具名事件的真实 fixture**（不 mock 假值） | CS04 合规 |

---

## 6. 裁决结果（2026-09-23 用户确认「按推荐方案」）

| # | 待确认项 | **裁决** | 影响 |
|---|---|---|---|
| 1 | 视图位置 | **A：轨迹检查器「请求指标」分区** | 复用既有 `ChatInspector` 装配与 `trajectoryStore`，**不改消息模型** |
| 2 | `pushApiMetricsEntry` 处置 | **删除**（连同死工厂 `createApiMetricsMessage`） | `Tool.ts` 移除该可选字段；`messages.ts` 删除未被调用的工厂（当前应用无正式用户 ⇒ 无需兼容层） |
| 3 | 是否纳入"失败请求数 / 错误率" | **首版不纳入** | `request`↔`error` 的稳定配对键**未经证实**，按 CS03 最小化不引入新口径；若后续证实有稳定键，再作为增量项（届时补 Spec §3.1 字段与用例） |

---

## 7. 合规

| 规则 | 结论 |
|---|---|
| CS01 归一化检查 | 复用 `metric/timing` 事件与既有格式化工具（`formatTokens` / `formatDuration`），**不新增数据通道** |
| CS03 回退/复杂度最小 | 缺字段 ⇒ `null`/`undefined`；不做投机性扩展（如分位数可配置） |
| CS04 Mock 零容忍 | 测试用结构合法的真实事件 fixture（沿用既有 spec 的 SCENARIO 写法） |
| §1.6 红线（模型可见 ⇔ 已落盘） | 本项**不新增"模型可见输入"** ⇒ **无需新增事件类型**（不触碰三处同步断言） |
| §1.6.1 前后端接口清单 | 无新增 HTTP/IPC ⇒ 无需更新 `api-spec.md` |
| P3-3 复杂度声明 | §3.1 已声明 |
| 与既有 Spec 的关系 | 明确"**不**启用 `pushApiMetricsEntry`"，与 `llm-request-otel-span.md`（D7）口径一致 |

---

## 8. 实施记录（2026-09-23）

### 8.1 生产者字段核对（实测 grep，非推测）

| 写入点（文件:行） | `stage` | 实际写入字段 |
|---|---|---|
| `app/src/chat/orchestrator/streamMessageFlow.ts:1533-1548` | `'request'` | `ttfb`（必写，`firstChunkElapsedMs !== null` 时）、`ttft`（**仅**有内容 chunk 时） |
| `app/src/chat/ChatManager.ts:3386-3394`（`buildRequestTimingData`，`recordChatResponseUsage` 内） | `'request'` | `tokens` / `inputTokens` / `outputTokens` / `cacheReadTokens?`(>0) / `cacheCreationTokens?`(>0) |
| `app/src/chat/ChatManager.ts:1619-1627`（`buildAssistantTimingData`） | `'assistant'` | `duration`（回合级，**不计入**本视图任何指标） |

⇒ 与类型声明（`chat/types/events.ts:315-348`）**一致**；但**延迟类与用量类分属两条事件**（一次成功 API 调用最多 2 条请求级事件，无请求 ID 可配对）⇒ `requestCount` 语义为"**请求级事件数**"，UI 文案据此如实标注（不写"请求数/API 调用数"）。

### 8.2 相对 §3.1 原稿的偏离（均为实施期归一化调整）

| # | 偏离 | 理由 |
|---|---|---|
| 1 | **删除** `throughputTps` | 轨迹时间线 header 已展示 `modelMs` / `throughputTps`（`TrajectoryTimeline.tsx` + `deriveTrajectoryTimeline.ts`）⇒ 本视图重复展示同一指标违反 CS01；本视图只保留"请求级"维度（TTFT/TTFB 分位数、缺失计数、token 分桶） |
| 2 | **新增** `latencyEventCount` | 原稿的 `ttft/ttfb: ... | null` 无法区分"**无延迟数据**"（应整条不渲染）与"**有延迟数据但 n<2**"（应显示"样本不足"）⇒ UI 无法诚实表达双态。该字段=带 `ttfb` 的请求级事件数，纯数据推导、可单测 |
| 3 | `missingTtftCount` 口径**收窄**为"延迟类事件（有 `ttfb`）中缺 `ttft` 的条数" | 原稿"请求级事件中无 ttft 的条数"会把**全部用量类事件**（本就不含延迟字段）计为"TTFT 缺失"，语义失真 |
| 4 | 复杂度由 `O(E)`/`O(1)` 修正为 `O(E log E)`/`O(k)` | 分位数需排序；近似算法会引入误差，与"只报真实测量值"冲突 ⇒ 选精确最近秩 |
| 5 | `requestCount` UI 文案用"请求级事件"而非"请求数" | 见 §8.1 的双生产者事实（一次调用最多 2 条） |

### 8.3 交付物对照

| 交付物 | 状态 |
|---|---|
| `client/src/stores/chat/deriveApiMetrics.ts`（新建） | ✅ 时间 `O(E log E)`、空间 `O(k)`，注释含生产者核对结论文档 |
| `client/src/tests/api-metrics.test.ts`（新建） | ✅ 11 例（无数据/单样本/分位数/缺 ttft/ttft-ttfb 独立/token 分桶 3 例/非请求级排除/脏值守卫） |
| `ChatInspector.tsx`「请求指标」分区（时间线之下、事件列表之上） | ✅ 双态：无数据 ⇒ "暂无请求指标"；`n<2` ⇒ "样本不足"；无该项 ⇒ 不渲染 |
| `i18n/locales/zh.ts` + `en.ts`（`trajectory.apiMetrics.*`） | ✅ zh/en 同步补齐 |
| `client/vite.config.ts` | ✅ `coverage.include` 增列该文件（`deriveTrajectory*.ts` glob **不匹配** `deriveApiMetrics.ts`）+ 逐文件阈值 100/100/100/100（实测四项全满） |
| `client/e2e/trajectory.spec.ts` | ✅ 追加"请求指标分区双态"用例（沿用 `requireRows` skip 策略；本地实测 7 passed / 0 skipped） |
| `app/src/tools/types/Tool.ts` | ✅ 删除 `pushApiMetricsEntry?`（全仓无其他引用） |
| `app/src/utils/messages.ts` | ✅ 删除 `createApiMetricsMessage`；`'api_metrics'` 仅为该工厂入参的字面量，`SystemMessage.subtype?: string` 为**普通 string**（非联合类型）⇒ 无孤儿类型需处置 |

### 8.4 未覆盖 / 待跟进（如实记录，不粉饰）

1. **本机数据中 `metric/timing` 事件数 = 0**（实测：`~/.pyapp/data/sessions/**/events.jsonl` 共 240 文件，按行首 `{"type":"metric/timing"` 命中 0 条；仅 4 个文件是 assistant/thinking 正文里的**文字提及**）⇒ e2e 用例在本机只走**空态分支**，"有数据态"的端到端渲染**未在 e2e 中实证**（数据态逻辑由 §2.2 单测 + 代码路径覆盖）。已同步登记到 `dev_docs/error_repairs/预存错误与待处理问题.md`。
2. 待用**一次真实对话（当前代码）**确认 §8.1 两个写入点确实落盘；若仍为 0，按 CS05 追根因（属生产者侧，非本 Spec 读端）。
