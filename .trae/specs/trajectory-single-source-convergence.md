# Spec：轨迹「唯一数据来源」收敛（P0 + P1）

> 版本: **0.2** ｜ 创建: 2026-09-23 ｜ 更新: 2026-09-23 ｜ 状态: **已裁决并实施**（见 §6 裁决记录 / §8 实施记录）
> 关联：本轮数据源审计（16 个数据源全静态取证）｜`project_rules.md` §1.6「模型可见 ⇔ 已落盘」｜P0-1「删除收敛」的延续
> 结论先行（审计）：**读路径已单源（`events.jsonl`）**；**落盘层未单源** —— 本 Spec 收敛 3 处真风险（1 项 P0 + 2 项 P1）。

---

## 1. 问题（三项，均附实测证据）

### P0｜`trace-recording` 既是并行副本、又**驱动业务决策**

| 事实 | 证据 |
|---|---|
| **始终启用、不可配置关闭** | `app/src/trace-recording/index.ts:113`（"始终启用，**不可配置关闭**"）、`:163-164`（"Trace 始终启动（必选项）"） |
| 落盘**完整请求体 + 完整响应 + SSE 原始事件** | `TraceWriter.ts:57-96`（`fs.appendFileSync(this.filePath, JSON.stringify(record))`、`trace_${date}.jsonl`）；`types.ts:26-62`（`TraceRecord{ request.body, response.body, response.sseEvents }`） |
| **被业务消费（以它为准）** | `core/tokenBudget/UnifiedTokenTracker.ts:31` `import { traceUsageListeners } from '../../trace-recording/AITracePlugin'` → `:525-533` 用真实 usage 更新 `calibrationFactor` 并 `persistCalibrationFactor(...)` → `:294` 以该 factor 修正 token 估算（影响上下文预算/压缩决策）<br>**（本条已由主分析者亲自复核）** |
| 与事件在"模型可见输入"上重叠 | 完整 `request.body`（含 messages）与 `context/model-input` 事件（TR-12-B）覆盖同一事实 |

⇒ **判定：唯一一处"以非 `events.jsonl` 落盘数据驱动业务决策"的路径**，事实上的第二事实源。
⇒ **同时存在替代数据源**：`metric/timing` 事件（TR-14 + TB-11 已修）**已带真实 usage**（`tokens`/`inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreationTokens`）。

### P1-a｜`trajectoryCompactions` 双写分叉（metadata **优先于**事件）

| 事实 | 证据 |
|---|---|
| 写 metadata | `app/src/chat/orchestrator/streamMessageFlow.ts:479-494`（`session.metadata = { ...trajectoryCompactions: mergeCompactionRanges([...]) }`） |
| 同时写事件 | `context/compaction` 事件（读取见 `EventMessageDeriver.ts:436-456` 提取 `compactedRange`） |
| 读**优先 metadata** | `EventMessageDeriver.ts:426`（"@param opts.compactionRanges 会话 metadata.trajectoryCompactions（**优先于事件**）"）、`:457-460`；`CoreAPIImpl.ts:1744-1754` |
| `trimEvents` 会**物理删除**压缩事件 | `EventLogStorage.ts:1316`（`trimEvents`）⇒ 若以事件为唯一权威，则 trim 不得删压缩区间事件 |

⇒ **判定：metadata 是明确的第二权威**；两者不一致时以 metadata 为准，且事件可能被物理删除 ⇒ 双源长期并存。

### P1-b｜`trajectoryTrims` 有读取、**无写入** ⇒ 对账排除逻辑恒 no-op

| 事实 | 证据 |
|---|---|
| 读取（用于排除"合法 seq 缺口"） | `app/src/session/reconcile/ReconcileService.ts:86,145`（`meta?.trajectoryTrims`）+ `:176` `isInTrimRange` |
| **无生产写入点** | 全仓 grep `trajectoryTrims`：仅注释 `EventLogStorage.ts:1311`、读取 `ReconcileService.ts:86,145`、测试 `reconcileService.test.ts:351` ⇒ **未找到写入者** |
| 相关 `trimEvents` **亦无生产调用点** | 全仓 grep `trimEvents`：仅定义 `EventLogStorage.ts:1316`、内部注释、日志 action `:1370` ⇒ **未找到调用者**（与 TB-10 的形态相同） |

⇒ **判定**：对账"把落在 trims 区间的缺口当合法缺口排除"这一保护**实际不存在**（恒 no-op），缺口判断会失真（合法缺口被报为漂移，或反之的语义含混）。

---

## 2. 决策（**v0.2：已裁决，按此实施**）

| # | 决策 | 理由 / 前置 |
|---|---|---|
| **D1（已裁决·采纳）** | **P0 收敛：token 校准闭环改读事件** —— `UnifiedTokenTracker` 的真实 usage 来源从 `traceUsageListeners` 改为 **`metric/timing` 事件载荷**（复用"调用方直接喂入"既有通路），`traces/` **显式降级为观测层**（声明"不可作业务判据"），并纳入保留/清理策略 | ① 唯一数据源目标；② 事件侧 usage **已存在**（TR-14/TB-11）；③ 解耦"观测"与"决策"。**前置**：核实 `metric/timing` usage 的**覆盖度**（TB-11 修复前流式无 usage；未修的 provider 仍可能缺）⇒ 需定义"样本不足时的回退"与可观测计数（不得用估算冒充） |
| D2（备选，不推荐） | 保留 traces 为校准源，但**显式声明为第二个事实源**并写清权威边界与一致性校验 | 违背"唯一数据源"目标；仅在 D1 前置不成立时退让 |
| D3（备选） | 让 traces **可配置关闭**（默认关） | 与 `:113` 现声明"不可配置关闭"冲突；且关闭会切断其他诊断用途 ⇒ 需单独评估，且**不解决**"校准依赖非事件数据"的根因 |
| **D4（已裁决·采纳）** | **P1-a：以事件为唯一权威**，`trajectoryCompactions` 降级为**可重建缓存**（读取侧仍可优先命中缓存，但必须能由 `context/compaction` 事件重建；不一致 ⇒ **事件为准** + 记 warning） | 与"事件溯源"一致。**前置（已落地）**：`trimEvents` 随 D5 一并删除 ⇒ 压缩区间事件不再被物理删除，权威不再丢失 |
| D4′（备选） | 反向声明 metadata 为唯一权威、事件仅作日志 | 与事件溯源目标相悖；且 trim 会删事件 ⇒ 日志不完整 |
| **D5（已裁决=删除）** | **P1-b：`trajectoryTrims`/`trimEvents` 已确认无产品入口 ⇒ 删除**该排除逻辑与字段（消除"看似有保护实际没有"） | 实施前查证结论见 §8「D5 查证」：**生产侧 0 调用点**（仅测试直接调用被测方法本身） |
| **D6（已裁决·纳入）** | **`traces/` 隐私与保留**：保留策略**复用既有唯一实现** `session/ArtifactRetention.ts`（`traceKeepDays=7`）；凭据在**落盘前剥离**（敏感头整值脱敏 + URL 凭据查参脱敏） | 见 §8「traces 实测」；**不新增第二套清理机制**（CS01/§3.11 实现唯一性） |

---

## 3. "唯一数据来源"的可测判据（本 Spec 的验收基准）

某数据源判定为**可接受缓存/派生**，须同时满足：
1. **可从 ① 重建**（给出重建代码位置）；
2. **读路径不依赖它**（缺失/损坏 ⇒ 自动降级，不抛错、不用旧值）；
3. **有显式降级分支**（可指认的重建/忽略路径）。

判定为**需收敛**的情形：存在"以它为准"的业务逻辑，或"同一事实有两份可写副本"。

**可执行的验收方式（实施后逐条实测）**：
- 删除 `~/.pyapp/data/traces/` 后：token 校准仍工作（D1 生效），且无功能降级；
- 删除会话 `session.json` 中的 `trajectoryCompactions` 后：压缩区间仍能从事件重建（D4 生效）；
- 人为制造"合法 seq 缺口"：对账报告不再把它当漂移（D5 的选定分支生效）；
- 全仓 grep 判定项：`trace-recording` 不再被任何业务模块 import（仅观测/导出层可引用）。

---

## 4. 影响文件（预估）

| 文件 | 变更 |
|---|---|
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts` | 校准数据源切换（`traceUsageListeners` → 事件侧 usage 回调） |
| `app/src/trace-recording/index.ts`、`AITracePlugin.ts`、`TraceWriter.ts` | 定位声明为观测层；保留/清理策略（含**含完整请求体的隐私处置**） |
| `app/src/session/storage/EventLogStorage.ts` | `trimEvents`：D4 前置（不得删压缩区间事件）；D5 的写入/删除 |
| `app/src/chat/orchestrator/streamMessageFlow.ts`、`chat/ChatManager.ts` | 压缩区间：metadata 写入降级为"缓存刷新"；事件为准 |
| `app/src/session/storage/EventMessageDeriver.ts`、`runtime/api/CoreAPIImpl.ts` | 读侧：优先缓存但可重建；不一致时事件为准 + warning |
| `app/src/session/reconcile/ReconcileService.ts` | D5 分支（删排除逻辑 / 保留并依赖真实写入） |
| `app/tests/**` | 新增/调整用例（见 §5） |
| 架构文档（`.trae/rules/architecture.md` 或 `app/docs/`） | 声明 `traces/`、`otel-traces/` 为**观测层**（不可作业务判据） |

---

## 5. 验证

| 层 | 用例 | 通过标准 |
|---|---|---|
| 单测 | 校准：给定 `metric/timing` usage 序列 ⇒ `calibrationFactor` 收敛值与切源前一致（**行为等价**）；样本缺失 ⇒ 保持上次值/1.2 默认，**不估算冒充** | 全绿 |
| 单测 | 压缩区间：仅凭事件可重建区间；metadata 与事件冲突 ⇒ **事件胜** + 有 warning | 全绿 |
| 单测 | 对账：D5 选定分支下，"合法缺口"与"真漂移"各一例 | 全绿 |
| 实测（§3 的 4 条判据） | 删 traces / 删 metadata / 造缺口 / grep 无业务 import | 全部成立 |
| 真实对话 | 一次真实流式对话：usage 事件驱动校准（给出原始事件 + 校准前后 factor） | 有据可查 |
| 回归 | 两端 `tsc` / `eslint` / `bun test` / `test:coverage` | 全绿 |

---

## 6. 裁决记录（v0.2，2026-09-23，用户裁决）

> 本节取代 v0.1 的「待确认」四问。裁决即实施依据；实施证据见 §8。

| 待确认项（v0.1） | **裁决** | 落地要点 |
|---|---|---|
| 1. P0 选 D1 / D2 / D3？ | **选 D1** | 校准改读 `metric/timing`（**不再以 `trace-recording` 落盘数据为准**）；`traces/` **显式降级为观测层**（不可作业务判据）。**接受**"覆盖率不足的 provider 校准样本变少"这一代价 ⇒ 必须以**可观测计数**呈现，且缺样本时**保持既有因子**（禁止估算/默认值冒充） |
| 2. P1-a 选 D4 / D4′？ | **选 D4** | 以**事件为唯一权威**，`trajectoryCompactions`（session metadata）降级为**可重建缓存**：读取侧可优先命中缓存，但必须能由 `context/compaction` 事件重建；**冲突 ⇒ 事件为准 + 记 warning**。（原"trimEvents 不得删压缩事件"的前置，因 D5 直接删掉 `trimEvents` 而自然满足） |
| 3. P1-b 删除还是补齐？ | **删除** | 删除 `trajectoryTrims` 相关**排除逻辑与字段**；并删除**无调用点**的 `trimEvents`（含 `EventLogStorage` 内的相关注释/状态提及，清理到"不残留虚假承诺"）。**约束**：删除前若发现**真实调用点** ⇒ 停下报告，不硬删 |
| 4. `traces/` 隐私与保留是否纳入本 Spec？ | **纳入** | ① 保留/清理策略（按天或按量上限，择一并说明依据）；② **核实** `TraceRecord` 是否含凭据，若含 ⇒ **落盘前剥离**（列出被剥离字段） |

**边界（裁决同时明确，实施须遵守）**：
1. 校准数据源切换**只改消费者**（D1），**不动 TB-11 已修口径**（`metric/timing` 字段语义、`recordUsage` 守卫、三家 provider 的 `wantsStreamUsage`）。
2. **诚实性铁律**：某 provider/路径拿不到真实 usage ⇒ **不得用估算/默认值冒充**，保持既有值 + 增加可观测计数。
3. 校准**行为等价性优先**：数据充足时，切源前后 `calibrationFactor` 的收敛结果应一致。
4. `traces/` 降级后：`trace-recording` **不得再被业务模块 import**（观测/导出/查看层除外）。

---

## 7. 合规

| 规则 | 结论 |
|---|---|
| §1.6「模型可见 ⇔ 已落盘」 | 本项**增强**该红线：把"模型可见输入"的唯一权威收敛到事件（`context/model-input`），traces 降级为观测 |
| CS01 归一化 | 复用已有 `metric/timing` usage 与 `context/compaction` 事件，**不新增数据通道** |
| CS03 复杂度最小 | 样本缺失 ⇒ 保持既有值，不造估算；不引入新配置开关（D3 仅在必要时） |
| CS05 根因优先 | 不做"把 traces 关掉"式的贴创可贴（不解决"决策依赖非事件数据"的根因） |
| CS02 | 对账/重建不得用"时间顺序或字符串"启发式判状态；一律基于持久标记（事件/明确字段） |
| 与既有 Spec 的关系 | 与 `request-boundary-events.md`（P2-2，已实施）一致：新事实一律落事件；本 Spec 继续把残留副本收敛 |

---

## 8. 实施记录（2026-09-23，v0.2）

### 8.1 D1 —— 校准改读 `metric/timing`，`traces/` 降级为观测层

| 项 | 内容 |
|---|---|
| 新 usage 通路 | `ChatManager.recordChatResponseUsage` → `buildRequestTimingData(usage)`（**唯一构造点**，即 `metric/timing` 的事件载荷，`chat/services/timingEvent.ts:62`）→ `UnifiedTokenTracker.recordTimingUsage(payload)` → 内部唯一实现 `_applyUsageSample()`（`core/tokenBudget/UnifiedTokenTracker.ts:530,586`）。**复用既有"调用方直接喂入"通路，未新建总线/轮询** |
| 删除 | `import { traceUsageListeners }`、`_subscribeTraceUsage()`、`_onTraceUsage()`、`_unsubscribeTrace`（`UnifiedTokenTracker`）；`ChatManager` 原 `recordPostRequest({usage})` 调用点改为喂事件载荷 |
| 保留的唯一另一入口 | `recordPostRequest(apiBody)`（`QueryEngine.ts:689` 非 chat 路径，数据源是 provider 返回的**原始 usage**）——与 `recordTimingUsage` 共用 `_applyUsageSample` 单一实现 |
| 缺样本可观测计数 | `getCalibrationStats()` 返回 `{ applied, missingUsage, missingBaseline, factor }`；`missingUsage` = 无有效 usage（缺字段/全 0/格式未知）；`missingBaseline` = 有真实 usage 但无估算基线。二者**只计数、不改因子**（不估算冒充） |
| 观测层声明 | `trace-recording/index.ts`、`AITracePlugin.ts`、`engine/TraceWriter.ts` 文件头 + `.trae/rules/architecture.md` §3.14（新增） |
| 业务 import 收敛 | `app/src` 内 `trace-recording` 仅剩观测/导出/查看层引用（`commands/builtin/trace-recording`、`tools/TraceRecordingTool`、`AppCoreOTelHelper`、`infrastructure/http/handlers/trace-handlers`）；`traceUsageListeners` 现**无任何业务订阅者**（仅 `AITracePlugin` 内部遍历） |
| **行为等价（实测）** | `tests/core/tokenBudget/calibrationSource.test.ts`：① 事件载荷与旧 api-body 路径抽出的 token 逐样本一致（4 种 provider 形态）；② 同一序列喂入两入口，`calibrationFactor` **逐次相等** —— 实测 `baseline=6495`、raw 序列 `0.85/1.00/1.15/0.95`、收敛序列 `0.955012 → 0.968508 → 1.022944 → 1.001049`；③ 缺 usage/缺基线 ⇒ 因子不变 + 计数递增 |
| **真实对话实测** | 后端 `bun run src/main.ts --http-only`；会话 `session_mudrg64grjgmcbf6yf`（`deepseek-v4-flash`）<br>· 非流式：事件 `{"type":"metric/timing","seq":3,...,"stage":"request","tokens":16736,"inputTokens":16660,"outputTokens":76,"cacheReadTokens":3072,"cacheCreationTokens":13588}` ⇒ 日志 `unified:calibration updated {"source":"metric/timing","oldFactor":1,"newFactor":1.93,"raw":4.0883,"inputTokens":16660,"baselineInputTokens":4075,"appliedSamples":1}`<br>· 流式：事件 `seq=13`（同载荷 + `requestId:7`）⇒ `unified:calibration updated {"oldFactor":1.93,"newFactor":2.14,"raw":2.6295,"appliedSamples":2}`；随后的 `checkBeforeRequest` 日志显示 `calibrationFactor:1.93 → 2.14` **已进入压缩决策口径** |
| 口径未动 | `metric/timing` 字段语义 / `recordUsage` 守卫 / 三家 provider `wantsStreamUsage` **一行未改**（D1 只改消费者） |

### 8.2 D4 —— 压缩区间：事件为权威，metadata 为可重建缓存

| 项 | 内容 |
|---|---|
| 重建路径 | `session/storage/EventMessageDeriver.ts`：新增 `extractCompactionRangesFromEvents(events)`（权威来源）+ `resolveCompactionRanges(cached, fromEvents)`（缓存优先命中、**冲突 ⇒ 事件胜**）；`deriveMessagesFromEvents` 改调它（原 `mergeCompactionRanges([...metadata, ...events])` 的"metadata 优先"语义删除） |
| 冲突判定 + warning | 同 `startSeq` 而 `endSeq`/`summary`/`summaryMessageId` 任一不一致 ⇒ 采用事件区间，并 `logger.warn('session:event-deriver 压缩区间缓存与事件冲突，以事件为准')`（`session:event-deriver`） |
| 写侧降级为缓存刷新 | `chat/orchestrator/streamMessageFlow.ts:479` 注释与语义改为"刷新缓存"；`runtime/api/CoreAPIImpl.ts:1744` 注释同步（仍传 metadata，但读侧以事件为准） |
| 对账侧一致化 | `session/reconcile/ReconcileService.ts` 的压缩区间同样经 `resolveCompactionRanges` 解析（半状态自愈判据不再单靠 metadata） |
| 用例 | `tests/session/EventMessageDeriver.test.ts` 新增 3 例：① **删掉 metadata 的 `trajectoryCompactions` 后，压缩区间仍能由 `context/compaction` 事件重建**（区间 `[1,2]` 生效 + summary 合成）；② 缓存可用则用（事件侧无区间时沿用缓存）；③ **冲突 ⇒ 事件胜 + warning**（`spyOn(console,'warn')` 断言告警文案） |

### 8.3 D5 —— 删除 `trajectoryTrims` 与 `trimEvents`

**D5 查证（删除前自查，含 `app/tests`、`client`、脚本）**：全仓 grep 结果 ——
`trimEvents` 在 `app/src` 仅"定义 + 注释 + 日志 action"，**无生产调用点**；`app/tests` 内**有 2 个直接调用**（`tests/session/EventLogStorage.test.ts:249,495`），但它们是**针对被删方法自身**的行为测试（trim 后快照失效 / 索引作废），非产品入口 ⇒ 按"不残留虚假承诺"取舍：**随方法一并删除**（非"放宽断言"，是删除已无被测对象的用例）。**未发现真实生产调用点**，故执行删除。

| 删除项 | 位置 |
|---|---|
| `trimEvents()` 方法（含 JSDoc 中"须写 `session.metadata.trajectoryTrims`"的承诺） | `session/storage/EventLogStorage.ts`（原 `:1304-1375`） |
| 残留提及 | 同文件：`snapshotIneligible` 注释（原 `:292`）、`copyPrefixTo` 的"参照 trimEvents"（原 `:1384`）、`getFreshSnapshot` 失效场景清单（原 `:1674`）——全部改为不指向已删除方法 |
| `trajectoryTrims` 读取/排除逻辑 | `session/reconcile/ReconcileService.ts`：`TrimRange` 接口、`trimRanges`、`isInTrimRange()`、`①` 分支的排除行；并更新文件头仲裁规则与 `buildRepairPlan` 文案（"跳过已修剪区间"） |
| 测试 | `tests/session/reconcileService.test.ts`：⑥ 用例**按真实语义改写**（原锁"trims 区间缺口被排除"⇒ 现锁"**人为塞入旧字段 `trajectoryTrims` 也不再豁免缺口**，一律 `event-missing` + 反向补全候选"，注释写明原因与依据 = Spec D5 + CS02）；`InMemoryEventLog` 的 `trimEvents` 桩删除；`tests/session/EventLogStorage.test.ts` 删除 2 个 trim 用例 |
| grep 验收 | 全仓 `trimEvents` / `trajectoryTrims`：**生产代码 0 命中**；仅存的提及均为"历史记录 + 已删除"标注（本 Spec、`dev_docs/error_repairs/预存错误与待处理问题.md`、`ReconcileService` 头部 D5 说明、测试中的"旧字段不再生效"用例） |

### 8.4 D6 —— `traces/` 保留策略与凭据剥离

| 项 | 结论 |
|---|---|
| 保留策略（**唯一实现**） | `session/ArtifactRetention.ts#DEFAULT_ARTIFACT_RETENTION.traceKeepDays = 7`（按 **mtime** 判龄，匹配 `trace_*.jsonl`，由 `SessionGateway.startPruneInterval` 的 5 分钟节拍驱动）。**取值依据**：真机实测增速 ~190MB/天（单日最高 662MB），7 天覆盖排查窗口且把上限收敛到 ~1.3GB；按龄（而非"目录总大小上限"）可保证"刚发生的请求一定可查" |
| 为何不在 `TraceWriter` 内实现 | 实施中核实发现 `ArtifactRetention` **已实现同一策略**（2026-09-22 D3）⇒ 在 `TraceWriter` 再加一套（文件名日期判定）将是**第二套清理机制**，违反 CS01/§3.11 实现唯一性。故**撤除**该新增，改为在 `TraceWriter`/`index.ts`/`AITracePlugin` 文件头**指向唯一实现** |
| **实测**（只对真实 `traces/` 目录执行一次保留，其余目录注入空临时目录 ⇒ 未触碰真实 checkpoints/snapshots/logs） | 清理前 **38 文件 / 7324.1MB** → 清理后 **8 文件 / 1953.2MB**；`traces.deleted=30`、`bytesFreed=5,631,791,013`（≈5.63GB）；`otherDirs.deleted = [0,0,0,0,0,0,0]` |
| **凭据核实** | ❌ **`TraceRecord` 含凭据载体**：`types.ts:41,46`（`request.headers` / `response.headers`）+ `upstreamBaseUrl`/`request.path` 落的是**完整 URL**；且 `GoogleProvider.ts:115,195,287,358` 把 API Key 放 **query（`?key=`）**。**改动前** `sanitizeHeaders` 只截断到前 12 位（`Bearer sk-xx…`）⇒ **部分凭据落盘** |
| **剥离（落盘前）** | ① **被剥离的敏感头**（整值 `***`，不留前缀）：`authorization`、`x-api-key`、`cookie`、`set-cookie`、`x-session-id`；② **被剥离的 URL 查参**：`key`、`api_key`、`api-key`、`apikey`、`access_token`、`token`、`x-api-key`（值 → `***`，保留参数名与其它参数）。实现：`interceptor/URLMatcher.ts#sanitizeHeaders`（改）/ `#sanitizeUrl`（新），在 `FetchInterceptor.buildRecord` 落盘前应用 |
| 用例 | `tests/integration/trace-recording.test.ts`：敏感头整值脱敏（**断言不留 `sk-` 前缀**）+ URL 查参脱敏且保留 `alt=sse` |

### 8.5 验收（实测）

| 命令 | 结果 |
|---|---|
| `cd app; bun run typecheck` | **EXIT=0** |
| `cd app; bunx eslint src --ext .ts` | **0 problem（EXIT=0）** |
| `cd app; bun test tests/chat tests/session tests/ai tests/core tests/integration/trace-recording.test.ts` | **647 pass / 0 fail**（84 files，38.08s） |
| 真实对话（§8.1） | 事件 + 校准日志双证据齐备（见上） |
| `client` | **本轮未改前端**（无 client 变更）⇒ 未跑 client 测试，如实标注 |

### 8.6 偏离与残留（如实记录）

1. **D6 位置偏离**：Spec/任务书建议在 `TraceWriter` 内加保留策略；实施核实后发现 `ArtifactRetention` 已实现同一策略 ⇒ **改为复用**（撤除新增的第二套清理），并在文件头指向唯一实现。
2. **删除测试的取舍**：`tests/session/EventLogStorage.test.ts` 中 2 个用例**仅测试被删方法 `trimEvents` 自身**，随方法删除（非放宽/篡改断言）；已在本节写明。
3. **D1 覆盖面**：`buildRequestTimingData` 不识别 Anthropic 原始 `input_tokens`/`output_tokens`（与 `extractUsage` 非对称），当前**无实际影响**（`AnthropicProvider` 已在 provider 层归一化为 `prompt_tokens`）；属 TB-11 口径范围，**未动**，已登记 `dev_docs/error_repairs/预存错误与待处理问题.md`。
4. **未验证项**：`client` 测试未跑（未改前端）；`traces/` 保留策略的"启动时触发"由既有 5 分钟节拍覆盖（**非**启动即跑），若需"启动即清"须改 `SessionGateway`（本轮未改）。
