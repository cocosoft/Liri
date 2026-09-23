# Spec：请求边界事件（P2-2「turn × request 双边界」）

> 版本: **0.2** ｜ 创建: 2026-09-23 ｜ 更新: 2026-09-23 ｜ 状态: **已实施（含实测验证）**
> 关联：对标不足报告 P2-2 ｜`.trae/rules/project_rules.md` §1.6「模型可见 ⇔ 已落盘」｜`dev_docs/error_repairs/预存错误与待处理问题.md` §TB-12（本 Spec 修订依据）
>
> ⚠️ **v0.1 原文保留在文末 §A（历史快照，已被 v0.2 取代）** —— 其 D2/D6 的**前提已被实测推翻**。
> 保留而不删除（含错误前提），以便追溯"当时为何那样判断"。

---

## 0. v0.2 修订摘要（先读这一段）

| 修订 | v0.1 原文 | v0.2 定稿 | 依据（实测） |
|---|---|---|---|
| **D2 → D2'** | 复用**已有** `callSeq` 作配对键，**不引入新 ID** | ❌ 推翻。`callSeq` **不是**"请求编号"：`EventLogStorage.append` 在调用方未显式传入时，会把 `data.callSeq` 填成**该事件自身的 seq**（A1 闭环，供 `tool/result ↔ assistant/tool_call` 配对）⇒ 恒等式 `metric/timing.callSeq === 自身 seq`，**不含"属于哪次请求"的信息**。🔁 改为：**配对键 = 真请求标识** = `request/start` 被分配的 **seq**（`requestId`） | `app/src/session/storage/EventLogStorage.ts:749-775`（含 `:752-755` 的 A1 闭环注释）与 `:776-804`（seq 纠正分支同样改写）；实测见 §0.1 |
| **D6 → 修正** | **不**改 `metric/timing` 的字段语义与落盘口径 | ⚠️ 部分修正：**用量字段口径（tokens/cache/守卫）一律不改**；**仅新增**一个可选字段 `metric/timing.requestId`（旧事件无此字段 ⇒ 读端如实视为"无可配对区间"） | 用户裁决 ①：「配对键 = 真请求标识」必须落到完成侧写入点，否则无法配对 |
| **新增 D7** | （无） | compaction 的摘要 LLM 调用**也**落 `request/start{reason:'compaction'}` + **补一条请求级 `metric/timing`**（用量/延迟能拿才写）⇒ 区间闭合 | v0.1 §1 判定"compaction 从不产任何请求级 `metric/timing`"（`CompactionOrchestrator.ts:858` 走非流式 `aiService.generate`）⇒ 若不补，compaction 的 start 永远无 completion |
| **§6 待确认 → 已裁决** | 4 项待用户拍板 | ✅ 全部已裁决（见 §6） | 用户裁决 |

### 0.1 D2 被推翻的**根本**依据（实测）

- **代码**：`EventLogStorage.append` 的两个分支（`seq <= 0` 原子分配 / `seq <= tailSeq` 冲突纠正）都会执行
  `finalCallSeq = curCallSeq > 0 && curCallSeq !== frozen.seq ? curCallSeq : 分配/纠正后的 seq`
  ⇒ 未显式指定 `callSeq` 的事件，其 `data.callSeq` **恒等于该事件自身的 seq**（`EventLogStorage.ts:759-775`、`:785-804`）。
- **真实日志**（本仓实测，`~/.pyapp/data/sessions/57971aa3/session_mudkjwxjczxad15mtrj/events.jsonl`）：
  该会话全部 5 条 `metric/timing` 的 `callSeq` 与自身 seq **一一相等**（3/3、10/10、13/13、21/21、24/24）。
- **机制推论**：一个在"请求发出**前**"写入的 `request/start`，其 seq **必然小于**同一次请求的完成事件 seq，且**无法预知**该 seq ⇒ 用 `callSeq`（=自身 seq）配对在算术上不可能成立。
- **本轮实施后的复测**（同一约束仍成立，见 §5 原始 JSON）：`request/start` seq=2 的载荷里被 append **自动填** `"callSeq":2`；延迟条 seq=6 带 `"callSeq":6`、用量条 seq=8 带 `"callSeq":8` ⇒ **`callSeq` 语义未被改动**（本轮硬性禁止项），而三者的请求归属由新字段 `requestId=2` 表达。

---

## 1. 问题（Problem Statement）

**现状**：轨迹无法表达"请求（request）"这一层边界，只有 turn 边界。

- 请求级 `metric/timing` 事件的 `time` 是**响应完成时刻**（如 `{"stage":"request","tokens":16660,"inputTokens":16658,"callSeq":3}`），只能标出"某次请求的**完成点**"，**划不出区间**；
- 延迟类事件 `{"stage":"request","ttfb":772,"ttft":778,"callSeq":10}` 同理（`time` 为完成时刻）；
- 对标参照有 **turn 与 request 双边界**，且普通请求与 compaction 请求**共用一套请求编号**；
- "请求开始"目前只存在于 **OTel span**（`llm_request`）——span **不是**会话事件、不进 `events.jsonl` ⇒ **不可重建**。

**v0.1 的两个前提修正后**（见 §0），本项的可行性依据变为：**只要给请求分配一个真标识并把同一次请求的所有写入点串起来**，区间即可划出（v0.1 的"复用 callSeq 即可"不成立）。

---

## 2. 决策（v0.2，已裁决并实施）

| # | 决策 | 理由 / 依据 |
|---|---|---|
| **D1** | 新增会话事件类型 `request/start` | P2-2 的唯一前置；补上后区间可划 |
| **D2'** | **配对键 = 真请求标识**：`request/start` 落盘后取**它被分配到的 seq** 作 `requestId`，贯穿该请求的**所有**完成侧写入点；**严禁改写 `callSeq` 语义**（它归工具配对） | §0.1（callSeq 恒等自身 seq，无法承载请求归属） |
| **D3** | 请求编号**每会话自增**（seq 天然单调）、普通请求与 compaction 请求**共用同一序列** | 对齐 P2-2 原文对参照的描述；`reason` 字段区分来源 |
| **D4** | 落盘时机：**请求发出前**写入；请求失败**也保留** start | 区间语义依赖 start 存在；失败请求的区间同样有诊断价值 |
| **D5** | 读端：按 `requestId` 配对 `[request/start, 请求级 metric/timing]` 划区间；UI 以 `R#n` 呈现（时间线「请求」轨 + turn 头区间） | 与既有"配对跨度"（turn/tool）同一套做法 |
| **D6'** | **不改** `metric/timing` 既有字段语义（`ttfb`/`ttft`/`tokens`/缓存分桶/`recordUsage` 守卫原样）；**仅新增可选** `requestId` | 避免波及 TB-11 刚修复的用量链路（用户已明确授权这一处新增） |
| **D7** | compaction 的摘要请求**同批落 start + 一条完成事件**（用量/延迟能拿才写，拿不到缺省） | 否则 compaction 区间永不闭合（v0.1 §1 实测缺口） |

**本项唯一性证明**：`requestId` 就是 `request/start` 事件的 seq ⇒ 会话内 seq 单调递增 ⇒ 天然唯一，且与会话内其它事件不冲突（不需要另建 ID 空间、不需要计数器、崩溃重启后自然继续）。

---

## 3. 接口设计（定稿）

### 3.1 事件载荷

```ts
// app/src/chat/types/events.ts
'request/start': {
  /** 所属回合（turn 编号）。请求发出时 turn 尚未分配（如首轮）⇒ 缺省，不猜。 */
  turn?: number;
  model?: string;
  /** 请求来源：普通对话请求 / compaction 摘要请求（两者共用同一编号序列） */
  reason?: 'chat' | 'compaction';
};   // ← 载荷内**不带** requestId：requestId 就是本事件的 seq（避免自引用/两份真值）

'metric/timing': {
  /* …既有字段全部不变… */
  /** P2-2：所属请求标识（= 同请求 request/start 的 seq）；可选，拿不到则**不写** */
  requestId?: number;
};
```

**`request/start` 落盘时机与位置（如实说明一处既有排布）**：写入点在 `streamMessageFlow` 的**请求发出前**（紧邻 `gen.next()`）。本仓现有代码把 `turn/start` 的落盘点排在 `gen.next()` **之后**（历史排布，本轮**未动**）⇒ 首轮 `request/start` 落盘时 `turn` 尚未分配，故载荷**不带** `turn`（`turn` 为可选，不猜）；重试轮的 `currentTurnNo` 已就绪则带上。

### 3.2 §1.6 强制同步（三处必须同批，编译期强制）

1. `app/src/chat/types/events.ts` 的 `LiriEventType` 联合；
2. 同文件 `LiriEventMap` 的载荷；
3. `app/src/chat/types/knownEventTypes.ts` 的 `ALL_SESSION_EVENT_TYPES` 登记清单（漏登记 ⇒ `TS2322`，见 §5 实测）。

### 3.3 `requestId` 贯穿链路（**唯一实施路径**，文件:行）

| 环节 | 位置 | 说明 |
|---|---|---|
| 生成 requestId | `app/src/chat/services/requestBoundary.ts:85`（`startRequest`）→ `:112` `return result.ok ? result.tailSeq : undefined` | 用 append **返回的 `tailSeq`**（TB-19 既有约定；`append` 不写回 `event.seq`） |
| 主请求落 start | `app/src/chat/orchestrator/streamMessageFlow.ts:1073` | 请求发出前（`requestStartAt = Date.now()` 之前），每个**重试轮**各一条 |
| 延迟条（ttfb/ttft） | `streamMessageFlow.ts:1581` | `requestTiming.requestId = currentRequestId` |
| 用量条（请求级分桶） | `app/src/chat/ChatManager.ts:3419` | `timingData.requestId = requestId`（用法守卫/分桶字段**一律未改**） |
| 用量条 ctx 接线 | `streamMessageFlow.ts:1858`（`pipeline.ctx.requestId = …`，与 TB-11 的 `ctx.finalResponse` 同一手法）→ `app/src/chat/pipeline/StreamPipeline.ts:486-490` | 管线 `recordUsage()` 透传第三参 |
| compaction start + 完成 | `app/src/context/compaction/CompactionOrchestrator.ts:892`（start）/`:899`（成功闭合）/`:948`（失败也闭合） | compaction 属 `context/`、拿不到事件日志 ⇒ 由 `ChatManager.ts:855` 注入 `CompactionRequestReporter`（复用 `requestBoundary` 唯一实现） |

**已知"拿不到 requestId"的路径（如实缺省，不硬凑）**：

- **工具轮 LLM 请求**（`ReActToolLoop._reportUsage` → `ctx.recordChatResponseUsage`）：本轮**未**为其产 `request/start` ⇒ 其用量条**不带** `requestId`（实测见 §5：seq 17 / seq 31 两条用量条无 `requestId`）。工具轮的"请求边界"未纳入本项范围。
- **非流式路径**（`sendMessageFlow` 的 `recordChatResponseUsage`）：同样不产 start ⇒ 不写 `requestId`。
- start 落盘失败 / 无 `sessionId` 的 compaction 调用 ⇒ 完成侧不写 `requestId`（`startRequest` 返回 `undefined`）。

### 3.4 读端（前端）

- 新增纯函数 `client/src/stores/chat/deriveRequestSpans.ts`：`deriveRequestSpans(events) ⇒ RequestSpan[]`
  - `{ requestId, index(R#n), startSeq, start, endSeq?, end?, duration?, tokens?, inputTokens?, outputTokens?, cacheReadTokens?, cacheCreationTokens?, ttfb?, ttft?, model?, reason?, turn? }`；
  - **多完成事件归并**（延迟条贡献 `ttfb/ttft`、用量条贡献 `tokens`…），逐字段取首个真实值，**不跨 requestId 混用**；
  - 缺 completion（中断/重启）⇒ `end`/`duration` **如实缺省**（不造 0）；陌生 `requestId`（无对应 start）与旧事件（无 `requestId`）⇒ **忽略**；
  - **复杂度（P3-3）**：时间 `O(E + S log S)`，空间 `O(S)`（`S` = 请求数 ≤ `E`）。
- `TrajectoryTimeline` 新增「请求」轨（**复用既有 span 渲染范式**；`deriveTrajectoryTimeline` 既有语义与既有测试期望**未改**）；
- `ChatInspector` 的 turn 头追加该轮覆盖的请求编号 `R#a` / `R#a~R#b`（归属判据 = `request/start.seq ∈ [turn.startSeq, turn.endSeq]`，不靠文案推断）；compaction 请求带「含压缩」标记。

---

## 4. 影响文件（实际）

| 文件 | 变更 |
|---|---|
| `app/src/chat/types/events.ts` | 新增 `request/start`（类型联合 + 载荷）；`metric/timing` 新增可选 `requestId` |
| `app/src/chat/types/knownEventTypes.ts` | 登记 `request/start`（§3.2 第三处） |
| `app/src/chat/services/requestBoundary.ts` | **新建**：`startRequest` / `finishRequest`（唯一写实现，普通请求与 compaction 共用） |
| `app/src/chat/services/timingEvent.ts` | `TimingEventData` 增可选 `requestId`（不碰既有构造逻辑） |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 请求前落 start；延迟条带 `requestId`；`pipeline.ctx.requestId` 接线 |
| `app/src/chat/pipeline/StreamPipeline.ts` | `ctx.requestId` + `recordChatResponseUsage` 第三参透传 |
| `app/src/chat/ChatManager.ts` | `recordChatResponseUsage(…, requestId?)` 写 `requestId`；三处 ctx 接线透传；注入 compaction reporter |
| `app/src/chat/orchestrator/ChatOrchestrator.ts` / `app/src/chat/ToolLoopRunner.ts` | 接口签名加可选 `requestId` |
| `app/src/context/compaction/CompactionOrchestrator.ts` | `CompactionRequestReporter`（注入）；`_foldBatchSummary` 包 start/finish（成功与失败都闭合） |
| `client/src/types/events.ts` | 类型镜像（新事件 + `requestId`） |
| `client/src/stores/chat/deriveRequestSpans.ts` | **新建**：区间派生纯函数 |
| `client/src/components/Trajectory/TrajectoryTimeline.tsx` | 「请求」轨 |
| `client/src/components/ChatInspector/ChatInspector.tsx` | turn 头 `R#n` |
| `client/src/i18n/locales/{zh,en}.ts` | 6 个新键（轨道/标题/缺省文案/turn 头区间/压缩标记） |
| `client/vite.config.ts` | `deriveRequestSpans.ts` 纳入 `coverage.include` + 逐文件棘轮门槛 |
| 测试 | 后端 `app/tests/chat/requestBoundary.test.ts`（新建 14 例）；前端 `deriveRequestSpans.test.ts`（新建 9 例）、`trajectory-timeline.test.tsx`（+2 例）、`trajectory-snapshot.test.tsx`（+1 快照）；e2e `client/e2e/trajectory.spec.ts`（+1 例） |

---

## 5. 验证（实测结论，2026-09-23）

| 层 | 用例 | 结果 |
|---|---|---|
| 编译期 | 三处同步（§3.2）：临时移除 `ALL_SESSION_EVENT_TYPES` 中的 `'request/start'` | ✅ `bun run typecheck` 报 `src/chat/types/knownEventTypes.ts(165,7): error TS2322: Type 'true' is not assignable to type 'never'.`；恢复登记后 `bun run typecheck` **0 错**（移除→报错→恢复→0 错，逐步实跑） |
| 后端单测 | `app/tests/chat/requestBoundary.test.ts`（14 例）：start 取 tailSeq 作 requestId / 载荷无 `callSeq` / 失败返回 undefined / finish 分桶+requestId / 只写 duration / 都不写则不产事件 / 拿不到 requestId 不写 / start→延迟条→用量条同 requestId / compaction 成功与失败均闭合 / 未注入 reporter 不伪造 | ✅ 14 pass |
| 后端回归 | `bun test tests/chat tests/session tests/ai` | ✅ 559 pass / 0 fail（74 文件） |
| 后端静态 | `bun run typecheck` ｜ `bunx eslint src --ext .ts` | ✅ 0 ｜ 0（EXIT=0） |
| 读端单测 | `deriveRequestSpans.test.ts`（9 例：配对/多完成归并/缺完成缺省/陌生 requestId 忽略/编号稳定/不跨 requestId 混用/倒挂/非法字段/空输入） | ✅ 9 pass |
| 组件与快照 | `trajectory-timeline.test.tsx`（含请求轨渲染 + 点击回调 2 例）、`trajectory-snapshot.test.tsx`（+`deriveRequestSpans` 快照） | ✅ 全绿；快照 1 条新增（`$env:CI=""` 下写入） |
| 前端全量 | `bun run test` ｜ `bun x tsc --noEmit` ｜ `bunx eslint src` | ✅ 406 pass ｜ 0 ｜ 0 error（139 warning 全为既有 react-hooks 存量，我的文件 0 warning） |
| 覆盖率 | `bun run test:coverage`（`EXIT=0`，连续 4 次复跑 3 次全 0；**另 1 次曾 EXIT=1 但表格各文件均达标、无法复现**，如实记录） | ✅ `deriveRequestSpans.ts` 实测 lines 100 / stmts 98 / funcs 100 / br 93.02，写入门槛 100/97/100/92（棘轮，留 1 点余量）。同批复核：`TrajectoryTimeline.tsx` 96.83/92.08/100/100 ≥ 既有门槛 95/91/99/99；其余文件均未跌破既有门槛 |
| e2e | `$env:CI=""; bun x playwright test e2e/trajectory.spec.ts`（新增「请求轨与 turn 轨并存渲染（双态容错）」） | ✅ **8 passed / EXIT=0**（含新增例，真实渲染出 `请求 R#1 · …` 条） |
| 真实数据 | `POST /v1/sessions` → `POST /v1/chat/completions`（`deepseek-v4-flash`, `stream:true`） | ✅ 见下方原始 JSON；同 `requestId` 配出完整区间 |

**真实数据原始 JSON**（会话 `session_mudp6s8hyw4h3i0jp5`，`~/.pyapp/data/sessions/57971aa3/.../events.jsonl`）：

```jsonl
{"type":"request/start","seq":2,"time":1790143448010,"sessionId":"session_mudp6s8hyw4h3i0jp5","data":{"model":"deepseek-v4-flash","reason":"chat","callSeq":2}}
{"type":"metric/timing","seq":6,"time":1790143448895,"sessionId":"session_mudp6s8hyw4h3i0jp5","data":{"stage":"request","ttfb":720,"ttft":767,"requestId":2,"callSeq":6}}
{"type":"metric/timing","seq":8,"time":1790143448938,"sessionId":"session_mudp6s8hyw4h3i0jp5","data":{"stage":"request","tokens":11264,"inputTokens":11262,"outputTokens":2,"cacheReadTokens":3072,"cacheCreationTokens":8190,"requestId":2,"callSeq":8}}
{"type":"metric/timing","seq":10,"time":1790143449064,"sessionId":"session_mudp6s8hyw4h3i0jp5","data":{"stage":"assistant","duration":1439,"callSeq":10}}
```

读端可得区间：`R#1 = [1790143448010, 1790143448895]`（885ms，`ttfb=720` / `ttft=767`），并归并用量条 `tokens=11264`（读端合并同一 `requestId=2` 的两条完成事件）。

**工具轮"无边界"的实测缺省**（会话 `session_mudpbztg7f2a9e7w45y`，34 事件，含工具调用）：

```jsonl
{"type":"request/start","seq":3,"data":{"model":"deepseek-v4-flash","reason":"chat","callSeq":3}}
{"type":"metric/timing","seq":9, "data":{"stage":"request","ttfb":1754,"ttft":1759,"requestId":3,"callSeq":9}}
{"type":"metric/timing","seq":10,"data":{"stage":"request","tokens":11665,"…":"…","requestId":3,"callSeq":10}}
{"type":"metric/timing","seq":17,"data":{"stage":"request","tokens":15660,"inputTokens":15460,"outputTokens":200,"cacheReadTokens":11264,"cacheCreationTokens":4196,"callSeq":17}}
{"type":"metric/timing","seq":31,"data":{"stage":"request","tokens":26848,"inputTokens":26384,"outputTokens":464,"cacheReadTokens":15360,"cacheCreationTokens":11024,"callSeq":31}}
```

⇒ 一次对话 3 次 LLM 请求（主请求 + 2 个工具轮），**只有主请求**有 `requestId=3`；工具轮两条用量条**无** `requestId`（如实缺省，读端视为"无可配对区间"）。

---

## 6. 裁决记录（v0.1「待确认」的最终结论）

1. **事件名**：`request/start`（与 `turn/start`/`session/start` 同风格；已裁决）。
2. **不新增 `request/end`**：completion 由既有请求级 `metric/timing` 承担（已裁决，沿用）。
3. **UI 粒度**：**两处都呈现** —— 时间线「请求」轨（区间）+ turn 头 `R#n` 区间（已裁决）。
4. **compaction 对用户可见**：**可见且与普通请求同序列**，带 `reason='compaction'` 标记（UI 显示「压缩」/「含压缩」）；并**补齐其完成事件**（D7）——否则区间会断号（已裁决）。

---

## 7. 合规

| 规则 | 结论 |
|---|---|
| §1.6「模型可见 ⇔ 已落盘」 | 本项新增的是**时序元数据**（不改模型输入）⇒ 不触发红线的新增要求；恰好增强可重建性（请求区间可复现）。三处同步 + 编译期穷尽断言已同步登记（实测 TS2322） |
| **硬性禁止项：不改写 `callSeq` 语义** | ✅ 未改：`EventLogStorage` 的 A1 闭环逻辑**未动**；实测 `callSeq` 仍恒等各事件自身 seq（§0.1） |
| **硬性禁止项：不改 TB-11 的用量口径** | ✅ 未改字段语义 / `recordUsage` 守卫 / provider `wantsStreamUsage`；**仅新增** `requestId` 透传（用户授权） |
| CS01 归一化 | 复用 `EventLogStorage.tailSeq` 约定（TB-19）、复用 `buildRequestTimingData` 唯一实现、复用既有 span 渲染范式与 `readTurnNo` 口径；**不**新增 `request/end`（避免同一事实两处落盘） |
| CS02 状态检测 | turn 归属用**事件自身 seq 区间**判定，不用文案/标题匹配 |
| CS03 复杂度最小 | 缺 `end` ⇒ 如实缺省；写入失败 ⇒ 不阻断主流程（`@ignore-catch` 标注）；未注入 reporter ⇒ 不伪造 |
| CS04 Mock 零容忍 | 用例全部用真实事件结构与真实 Append 语义（内存模拟器只模拟 seq 分配） |
| 单文件 ≤1000 行 | `CompactionOrchestrator.ts` 曾达 1001 行 ⇒ 已压缩注释至 **997 行**（lint-file-size 红线，`>1000` 即 error） |

---

## 8. 实施记录（2026-09-23）

1. **三处同步**：`events.ts`（联合 + 载荷）、`knownEventTypes.ts`（清单）同批；编译期门禁实测（§5）。
2. **后端生产端**：新建 `requestBoundary.ts`（`startRequest`/`finishRequest`）；`streamMessageFlow` 请求前落 start 并把 `requestId` 贯穿到延迟条与用量条；`StreamPipeline`/`ChatManager`/`ChatOrchestratorHost`/`ToolLoopRunner` 增加**可选** `requestId` 透传。
3. **compaction**：`CompactionOrchestrator` 增 `CompactionRequestReporter` 注入点（`setRequestReporter`，与既有 `setTracker` 同一手法，避免 `context/` → `chat/` 反向 import）；`_foldBatchSummary` 在 `aiService.generate` 前后上报，**成功与失败都闭合区间**（失败时只写真实墙钟耗时，不写用量）。
4. **前端**：类型镜像 + `deriveRequestSpans` 纯函数 + 时间线「请求」轨 + turn 头 `R#n` + i18n 双端 6 键 + vitest 覆盖率 include/门槛。
5. **测试**：后端 14 例、前端 9 例 + 2 例 + 1 快照、e2e +1 例；全量验收结论见 §5。
6. **未纳入范围（如实登记）**：工具轮 LLM 请求与非流式路径**未产** `request/start` ⇒ 其用量条无 `requestId`（§3.3）；`CompactionSummaryEnvelope.usage` 历史上从未被填充（P1-2 遗留缺口，本轮未动）。
7. **环境副作用（如实登记）**：为取得"可滚动"的 e2e 基座数据，本机新建并保留了会话「E2E 长轨迹基座」（`session_mudpbztg7f2a9e7w45y`，34 事件，1 次真实请求）；另建的 `session_mudp6s8hyw4h3i0jp5` 已删除。e2e 的短会话脆弱性登记为 TB-13。

---

## §A 历史快照：v0.1 原文（**已被 v0.2 取代**，保留以便追溯，不抹掉错误前提）

> 版本: 0.1 ｜ 创建: 2026-09-23 ｜ 状态: **待评审（未实施）**
> 关联：对标不足报告 P2-2（原判「前提不成立」）｜`.trae/rules/project_rules.md` §1.6「模型可见 ⇔ 已落盘」
> 立项缘由：P2-2 记录的**触发条件已具备** —— 补一个"请求开始"事件即可划出请求区间（详见 §1）。

---

## 1. 问题（Problem Statement）

**现状（实测）**：轨迹无法表达"请求（request）"这一层边界，只有 turn 边界。
- 请求级 `metric/timing` 事件的 `time` 是**响应完成时刻**（实测载荷如 `{"stage":"request","tokens":16660,"inputTokens":16658,"callSeq":3}`），只能标出"第 N 次请求的**完成点**"，**划不出区间**；
- 延迟类事件 `{"stage":"request","ttfb":772,"ttft":778,"callSeq":10}` 同理（`time` 为完成时刻）；
- 对标参照有 **turn 与 request 双边界**，且普通请求与 compaction 请求**共用一套请求编号**。

**为什么现在能做（P2-2 原判"前提不成立"的解除依据）**：
- 实测确认请求级事件**已带 `callSeq`**（会话内调用序号）⇒ 只要补一个"请求开始"事件，即可用 **`callSeq` 配对** `[start, completion]`，**无需新造配对 ID**；
- 而"请求开始"目前只存在于 **OTel span**（`llm_request`）—— span **不是**会话事件、不进 `events.jsonl` ⇒ **不可重建**，读端拿不到。

## 2. 决策（待评审）

| # | 决策 | 理由 / 依据 |
|---|---|---|
| **D1** | 新增会话事件类型 `request/start`（命名待确认，须与 `turn/start`/`session/start` 风格一致） | P2-2 的唯一前置；补上后区间可划 |
| **D2** | 载荷复用**已有** `callSeq` 作配对键，**不引入新 ID**（如 `requestId`） | 实测请求级事件已含 `callSeq`（§1）；避免为配对另造字段（CS03） |
| **D3** | 请求编号**每会话自增**、普通请求与 compaction 请求**共用同一序列** | 对齐 P2-2 原文对参照的描述 |
| **D4** | 落盘时机：**请求发出前**写入（与 §1.6「关键节点即时落盘」一致）；请求失败**也保留** start | 区间语义依赖 start 存在；失败请求的区间同样有诊断价值（与 `llm_request` span 的"失败也记"口径一致） |
| **D5** | 读端：`deriveTrajectoryLayout` / `deriveTrajectoryTimeline` 以 `[request/start.time, 同 callSeq 的 metric/timing.time]` 划请求区间；UI 以 `R#n` 呈现 | 与现有"配对跨度"（turn/tool）同一套做法，不新造渲染范式 |
| **D6** | **不**改 `metric/timing` 的字段语义与落盘口径（`ttfb`/`ttft`/`tokens`/`duration` 原样） | 避免波及 TB-11 刚修复的用量链路 |

## 3. 接口设计

### 3.1 事件载荷（草案）

```ts
'request/start': {
  /** 会话内调用序号（与同一次请求的 `metric/timing` 事件**相同**，作为配对键） */
  callSeq: number;
  /** 所属回合（turn 编号） */
  turn?: number;
  /** 模型标识（可选，便于按模型分组读数） */
  model?: string;
  /** 是否 compaction 触发的请求（编号与普通请求共用同一序列） */
  reason?: 'chat' | 'compaction';
};
```

### 3.2 §1.6 强制同步（**三处必须同批**，现由编译期强制）
1. `app/src/chat/types/events.ts` 的 `LiriEventType` 联合；
2. 同文件 `LiriEventMap` 的载荷；
3. `app/src/chat/types/knownEventTypes.ts` 的 `ALL_SESSION_EVENT_TYPES` 登记清单（漏登记 ⇒ `TS2322` 编译失败）。

### 3.3 读端（草案）
- 新增纯函数（或扩展现有派生器）：`deriveRequestSpans(events) ⇒ Array<{ callSeq, start, end?, duration?, model?, reason? }>`
  - `end` 缺失（有 start 无 completion：请求中断/进程重启）⇒ **如实缺省**，不以 0 或估算填充（CS03）；
- `deriveTrajectoryTimeline` 增一条 "请求" 轨（可复用现有 span 渲染）；
- 列表/turn 头显示 `R#n` 编号（与 turn 编号并存，不互相覆盖）。

## 4. 影响文件（预估）

| 文件 | 变更 |
|---|---|
| `app/src/chat/types/events.ts` | 新增事件类型 + 载荷（D1/D2） |
| `app/src/chat/types/knownEventTypes.ts` | 登记清单同步（§3.2） |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 请求发出前写 `request/start`（D4；compaction 路径同批） |
| `client/src/types/events.ts` | 类型镜像（前端读端） |
| `client/src/stores/chat/deriveRequestSpans.ts`（或并入现有派生器） | 区间派生（D5） |
| `client/src/components/Trajectory/*` | 请求轨 / `R#n` 呈现 |
| 两端测试 + 快照 + e2e + 覆盖率门槛 | 见 §5 |

## 5. 验证

| 层 | 用例 | 通过标准 |
|---|---|---|
| 编译期 | 三处同步（§3.2） | 故意漏登记 ⇒ `bun run typecheck` 必报 `TS2322`（与 §1.6 验收一致） |
| 后端单测 | 成功请求 ⇒ start 先于 completion 落盘；中断请求 ⇒ 有 start 无 completion（读端缺省 `end`）；compaction 请求共用序列且编号连续 | 全绿 |
| 读端单测 | `deriveRequestSpans`：配对成功 / 缺 completion / 乱序到达 / 跨 turn 不误配 | 全绿 + 覆盖率门槛达标 |
| e2e | 复用 `client/e2e/trajectory.spec.ts` 基座：请求轨与 turn 轨**并存**渲染；无数据 ⇒ 显式双态 | 全绿（空库 skip 策略不变） |
| 实测 | 真实对话后：`events.jsonl` 出现 `request/start`，且用 `callSeq` 能配出 ≥1 个完整区间 | 给出原始事件 JSON |
| 回归 | `bun test`（两端）+ `test:coverage` + 两端 `tsc`/`eslint` | 全绿 |

## 6. 待确认（需裁决后才进入实施）

1. **事件名**：`request/start` 还是 `llm/request_start`？（须与既有命名风格一致，且与 `metric/timing` 的 `stage:'request'` 语义对齐）
2. **是否同时补 `request/end`**：建议**不补** —— completion 由既有 `metric/timing`（同 `callSeq`）承担，补 `end` 会造成"同一事实两处落盘"（CS01）。
3. **UI 粒度**：请求编号只在时间线/列表显示，还是要进入 turn 头的汇总（如 `Turn 3 · R#7~R#9`）？
4. **compaction 请求是否对用户可见**：建议**可见但与普通请求同序列、加 `reason` 标记**（否则区间会"莫名断号"）。

## 7. 合规

| 规则 | 结论 |
|---|---|
| §1.6「模型可见 ⇔ 已落盘」 | 本项新增的是**时序元数据**（不改模型输入）⇒ 不触发红线的新增要求；但**恰好增强可重建性**（请求区间可复现） |
| §1.6 三处同步 + 编译期强制 | §3.2 已列，验收含"漏登记必编译失败" |
| CS01 归一化 | 复用 `callSeq` 配对、复用既有 span 渲染范式；**不**新增 `request/end`（避免重复落盘） |
| CS03 复杂度最小 | 缺 `end` ⇒ 如实缺省；不做投机性扩展（如请求级重试链） |
| CS04 Mock 零容忍 | 用例用真实事件结构 fixture |
| 依赖关系 | P3-4 的吞吐/模型耗时读端**不改**；TB-11 的用量链路**不改**（D6） |

## 8. 实施记录

（待评审通过后填写）
