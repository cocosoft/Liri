# Spec：事件载荷 `undefined` 键根因修复（模型输入快照 / 压缩事件被 D1 校验拒绝）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**已实施（2026-09-25，见 §6.5）**
> 来源：本轮运行实例复核时于 `%USERPROFILE%\.pyapp\data\logs\app.log` 实测发现并逐行定位（原记录见 `dev_docs/error_repairs/预存错误与待处理问题.md` 第二十六次修复「附带发现 2」）
> 关联规则：GR15（Spec-Driven）/ CS01（归一化）/ CS03（回退最小化）/ CS05（根因优先）/ CS06（证据驱动）/ R02（数据模型统一）
> 关联红线：§1.6「**模型可见 ⇔ 已落盘**」（2026-09-22，v7.12.0）—— 本项是其**实际未成立**的根因修复
> 关联 spec：[model-input-snapshot-events.md](./model-input-snapshot-events.md)（TR-12-B，落地物在本项修复前**从未真正落过盘**）
> 用户裁定：**先出 spec，经批准后实施**

---

## 1. Problem Statement

事件日志落盘前会做 **D1 无损 JSON 校验**（[eventSanitize.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/eventSanitize.ts#L34-L120)，调用点 [EventLogStorage.ts:720-725](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/EventLogStorage.ts#L720-L725)）：载荷含 `undefined` 值即**整条事件被拒绝**。仓内既有约定是「**条件展开**：可选字段有值才写键」（先例：`session-handlers.ts:529`、`workflowRunProjection.ts:142`、`MessageToEventMigrator.ts:301/365`、`streamMessageFlow.ts:2293-2302`）。**两个生产点未遵守该约定**，导致两类事件在实测中稳定丢失。

### 1.1 事实与证据（均来自本轮实跑日志）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`context/model-input` 每轮被拒**（不是偶发） | `event-log: 事件未通过无损 JSON 校验，拒绝写入` + `chat:request-snapshot: 模型输入快照事件追加失败{reason:"invalid-event"}`；`eventType=context/model-input`，`reason=事件载荷含非 JSON 值（event.data.tools.schemas[0].input_schema.properties.cwd.default: undefined …）`。实测样本：`2026-09-25T08:00:59Z`、`08:13:35Z`、`10:32:35Z`（会话 `session_mugm9hewuhvrvc8et19`）、`11:15:34Z`（会话 `session_mugv70e1roe9n0cdcan`） |
| 2 | **`context/compaction` 被拒且后果不止"少一条事件"** | 同日 `10:32:34Z`：`eventType=context/compaction`，`reason=…event.data.summaryEnvelope: undefined…` → 紧接 `chat:streamFlow: compaction:写 context/compaction 事件失败，不提交投影压缩{error:"appendStreamEvent failed: invalid-event"}` → `compaction:build_start{messageCount:484, preCompacted:false}` ⇒ **该次压缩（Tier2 实省 32%）不提交投影**，构建仍用未提交压缩的消息（构建期切窗后 249 条 / 183K tokens） |
| 3 | 产生点已定位（工具 schema 面） | [ToolRegistry.getToolSchemas()](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolRegistry.ts#L217-L250) 内有 **4 处无条件键**：`description: info.description`（:224）、`aliases: info.aliases`（:239）、`description: param.description`（:247）、`default: param.default`（:249）。本次实测命中的是 `param.default`（无默认值的 `cwd` 参数 ⇒ `default: undefined`）；`info.description` / `info.aliases` / `param.description` 缺省时同为 `undefined`，按同一机制具备同等风险（**实施时以全量扫描用例兜住，不逐处臆断**） |
| 4 | 产生点已定位（压缩面） | [streamMessageFlow.ts:478](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L457-L485) 无条件写 `summaryEnvelope: preCompactResult.summaryEnvelope`，而该字段在 `CompactionOrchestrator` 侧是**可选**（[:213](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/compaction/CompactionOrchestrator.ts#L213-L213)，仅 [:886](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/compaction/CompactionOrchestrator.ts#L886-L886) 分支赋值）⇒ Tier2/异步 Tier3 路径下为 `undefined` |
| 5 | **校验侧无过错**（不改） | D1 校验正确拦截了非法载荷（`undefined` 在 JSON 往返中不可无损表达）；问题在**构造端**把 `undefined` 写进键。放宽校验会让"生产者 bug"变成静默丢弃 —— 与 D1 的设计意图相反 |

### 1.2 后果（按事件类型）

- **`context/model-input`（TR-12-B 的落地物）**：**从未成功落盘**（采样 4 次全拒）⇒ 轨迹视图「模型输入」分区无数据、`refSeq` 一跳还原无源 ⇒ §1.6 红线（"模型当时看到了什么"必须可重建）在**绝大多数轮次实际不成立**。
- **`context/compaction`**：事件丢失 ⇒ ① 派生读侧缺该次压缩记录、`trajectoryCompactions` 缓存与事件权威不一致；② **压缩不提交投影** ⇒ 本次压缩的计算白做（构建仍走未压缩消息），且记账（`tokenBudget:unified:compaction recorded` 已按"压缩后"记账）与实际发送上下文可能不一致。

**根因（一句话）**：载荷构造端未遵守仓内既有的「可选字段条件展开」约定，把 `undefined` 写进了事件载荷键；D1 校验如实拒绝，事件整条丢失。

---

## 2. 目标 / 非目标

**目标**

- **G1 工具 schema 面**：`ToolRegistry.getToolSchemas()` 产物**不含任何 `undefined` 值**（按既有约定条件展开）⇒ `context/model-input` 载荷可过 D1 校验。
- **G2 压缩事件面**：`context/compaction` 载荷按同一约定收敛（`summaryEnvelope` 等可选字段**有值才写键**）⇒ 事件可落盘、`compactionCommitted` 恢复正常语义。
- **G3 防回归锁**（本项的"根因"落点 —— 用测试兜住"面"而非只修"点"）：
  - ① **工具 schema 全量扫描用例**：遍历**真实已注册工具**的 `getToolSchemas()` 产物，断言深扫无 `undefined` 值（新增任何"无默认值参数 / 无 description / 无 aliases"的工具都会当场红）；
  - ② **压缩载荷用例**：`summaryEnvelope` 缺省时载荷仍通过 D1 校验（把写法改回无条件 ⇒ 必失败）；
  - ③ **不改** D1 校验语义（保持严格）。
- **G4 可验证**：运行实例复核 ⇒ 日志中 `context/model-input` / `context/compaction` 的 WARN 消失，且 `events.jsonl` 中能查到这两类事件。

**非目标（明确不做）**

- **N1**：**不放宽** `eventSanitize` 的 D1 校验（不加"忽略 undefined"选项）。
- **N2**：**不引入**通用 `stripUndefinedDeep()` 在写入端统一剔除 —— 那会把"生产者 bug"变成静默丢弃，掩盖根因（与 CS05 相悖）；修法一律在**构造端**。
- **N3**：不重构 `ToolSchema` 类型、不改 Provider 侧报文结构（`undefined` 本就被 `JSON.stringify` 丢弃 ⇒ **发给模型的报文逐字节不变**）。
- **N4**：不顺手修其它未实测到的 `undefined` 产生点（不臆造）；但 G3① 会覆盖整个**工具 schema 面**。
- **N5**：不改压缩算法 / 阈值 / 分级策略；不新增事件类型、不加表、不加端点、不加 UI。
- **N6**：不改 `CompactionOrchestrator` 的 `summaryEnvelope` 是否产出（只改**写入端**的条件展开）。

---

## 3. 设计

### 3.1 G1：`ToolRegistry.getToolSchemas()` 条件展开（`app/src/tools/ToolRegistry.ts`）

| 位置 | 现状（无条件写） | 改为 |
|---|---|---|
| `:224` | `description: info.description` | `...(info.description !== undefined ? { description: info.description } : {})` |
| `:239` | `aliases: info.aliases` | 同上（`info.aliases !== undefined` 才写） |
| `:247` | `description: param.description` | 同上 |
| `:249` | `default: param.default` | 同上 |

- **语义零变更**：`undefined` 键在 JSON 中与"不存在"等价（`JSON.stringify` 丢弃）⇒ 送给 Provider 的 tools 报文不变；变的只是**事件载荷合法性**。
- **写法对齐既有先例**（`streamMessageFlow.ts:2295` 的 `...(x ? { x } : {})`），不新增工具函数（N2）。

### 3.2 G2：`context/compaction` 载荷条件展开（`app/src/chat/orchestrator/streamMessageFlow.ts`）

- `:478` `summaryEnvelope: preCompactResult.summaryEnvelope` → `...(preCompactResult.summaryEnvelope ? { summaryEnvelope: preCompactResult.summaryEnvelope } : {})`。
- **同批审视该载荷的其余可选字段**（`summaryMessageId` 等）：凡"类型可选 / 取值可能为 `undefined`"者按同一约定处理 —— 判据是**类型与取值来源**，不是"日志里出现过"。

### 3.3 G3：防回归锁（新增测试）

| 用例 | 断言 | 为什么这样锁 |
|---|---|---|
| 工具 schema 全量无 `undefined` | 取**真实** `getToolRegistry()` 的全部 schema，深扫（含 `properties.*.default` / `properties.*.description` / `aliases`）断言无 `undefined` 值；并断言**去 undefined 后 `JSON.stringify` 与修复前一致**（报文零变更） | "点修复"会随新工具回归；本断言把**整面**锁住（新增无默认值参数的工具 ⇒ 当场红） |
| 压缩载荷可通过 D1 | 构造 `summaryEnvelope` 缺省的压缩结果 ⇒ 组装载荷 ⇒ 过 `validateLosslessJson()`；并断言 `summaryEnvelope` 有值时键存在 | 直接锁住"事件不再被拒"的行为面 |
| 突变验证（人工，不入 CI） | 临时把写法退回无条件 ⇒ 上述用例必失败 | 同仓内既有手法（证明用例非空断言） |

### 3.4 不做的替代方案（记录以便评审对照）

| 方案 | 为何不选 |
|---|---|
| 在 `EventLogStorage.append` 前自动剔除 `undefined` | 静默丢弃 ⇒ 生产者 bug 永久隐形；且与 D1「无损」的设计意图冲突（N2） |
| 把 D1 校验降级为 WARN | 会让事件日志出现不可重建内容，直接违反 §1.6 红线（N1） |
| 只修 `param.default` 一处 | 同一函数还有 3 处同类无条件键，且新工具随时可引入新点 ⇒ 用 G3① 的"面锁"替代"点修" |

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 修**构造端**，不放宽校验 | CS05 根因优先；校验拦得对（事实 5） |
| D2 | 用**条件展开**（既有约定），不引入 `stripUndefinedDeep` | 零新抽象（CS03/CS01）；行为等价于 `JSON.stringify` 语义 |
| D3 | G3 采用**全量扫描用例**（而非逐处修补清单） | 把"这类 bug 不再回来"做成可执行断言 |
| D4 | 压缩载荷除 `summaryEnvelope` 外**同批审视**同类可选字段 | 一次性收口，避免"修完这条又冒下一条" |
| D5 | 是否同时**补记**「压缩不提交投影」的独立可观测指标 | 可选项：本轮只在事件修复后自动恢复；如需指标另立项 |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/tools/ToolRegistry.ts` | **改**：4 处无条件键 → 条件展开（§3.1） |
| 2 | `app/src/chat/orchestrator/streamMessageFlow.ts` | **改**：`context/compaction` 载荷可选字段条件展开（§3.2） |
| 3 | `app/tests/tools/toolSchemaLossless.test.ts` | **新建**：工具 schema 全量无 `undefined` 深扫 + 报文零变更断言（§3.3 行 1） |
| 4 | `app/tests/chat/compactionEventPayload.test.ts` | **新建**：压缩载荷过 D1 校验（§3.3 行 2） |
| 5 | `.trae/docs/api-spec.md` | **不加**（无 HTTP/IPC 端点变更） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` 0；改动文件 `eslint` 0；`bun run lint:arch` 0 错 0 警 |
| G1 静态 | 全量扫描用例：**真实工具集**的 schema 深扫无 `undefined`；且 `JSON.stringify(schemas)` 与修复前**逐字节相同**（用固定夹具比对） |
| G2 静态 | `summaryEnvelope` 缺省 ⇒ 载荷过 `validateLosslessJson`；有值 ⇒ 键存在 |
| 突变验证 | 两处分别退回旧写法 ⇒ 对应用例 red（各 1 例），还原后全绿 |
| **运行实例复核（关键）** | 重启后跑一轮**带工具调用**的对话：`app.log` 中 **不再出现** `event-log: 事件未通过无损 JSON 校验，拒绝写入`（`context/model-input`）；触发一次压缩后同样无该 WARN，且 `compaction:写 context/compaction 事件失败` 不出现 |
| 落盘实证 | `events.jsonl` 中 `grep '"type":"context/model-input"'` **有命中**（修复前为 0 命中）；`'"type":"context/compaction"'` 有命中 |
| 零回归 | 全量 `bun test` 0 fail（基线以实施时实测为准；当前 **3712 pass / 19 skip / 0 fail**） |
| 未做（明确） | D1 校验语义、压缩算法/阈值、新事件类型/表/端点/UI、通用 undefined 剔除器（N1/N2/N5） |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 工具 schema 面 | ✅ [ToolRegistry.getToolSchemas()](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolRegistry.ts#L240-L256)：**2 处**无条件键改为条件展开 —— `aliases`（:245）与 `default`（:256）。**实施校正（如实）**：spec §3.1 原列 4 处，按类型核定后只有 2 处可达 `undefined` —— `ToolInfo.description` / `ToolParam.description` 均为**必填 `string`**（[Tool.ts:75](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/Tool.ts#L73-L89)、[:50](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/Tool.ts#L47-L68)）⇒ 永不 `undefined`，且 `ToolSchema.description` 本身就是必填字段，条件展开反而会破坏类型 |
| G2 压缩事件面 | ✅ 新增纯构造器 [`buildCompactionDoneData()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L146-L180)（导出便于单测，与同文件 `isStreamedContentSuperset` 同惯例）：`summaryMessageId` 与 `summaryEnvelope` 均**有值才写键**；调用点 [:507-516](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/streamMessageFlow.ts#L504-L516) 改为传参（载荷字段逐字保留，仅可选键收敛） |
| G3 防回归锁 | ✅ 新增 [toolSchemaLossless.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tools/toolSchemaLossless.test.ts)（真实工具集全量深扫 + 缺省键不存在 + 有值字段不误删，含**防空跑**守卫）+ [compactionEventPayload.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/compactionEventPayload.test.ts)（走**真实** `sanitizeEvent`）；**未改** D1 校验语义（N1） |
| G4 运行实例复核 | ✅ 见下「运行时验证」 |

**突变验证（×2，均实跑）**：
- **A**：临时把 `param.default` 与 `summaryEnvelope` 一起退回无条件写法 ⇒ **4 例 red**（工具 schema 深扫 / 缺省键约定 / 压缩缺省 / 压缩单值组合），另 2 例（"有值不误删"）保持绿 ⇒ 还原后 **6/6 绿**；
- **B**：仅把 `aliases` 退回无条件 ⇒ **2 例 red**（深扫 + 约定）⇒ 证明该行同样被测住（且证明真实工具集里确有"无 aliases"的工具）。

**静态验证**：`bun run typecheck` 0 · 改动/新增文件 `eslint` 0（已 `--fix`）· `lint:arch` **0 错 0 警**（分层 0 违规）· 全量 **3718 pass / 19 skip / 0 fail**（3737 tests / 374 文件；较上一基线 3712 的 +6 即本批用例）。

**运行时验证（关键，重启后实跑）**：
| 项 | 修复前 | 修复后 |
|---|---|---|
| `app.log` 中的拒绝 WARN | 每轮必现（最后一条 `11:17:32Z`） | 重启（`11:28`）后**无任何新命中**（含 `11:29` 的带工具调用轮次） |
| `events.jsonl` 的 `context/model-input` | **0 命中**（从未落盘） | 验证会话 `session_mugvnqaqeeb6utmv1zq` **2 条命中**，其中 1 条含全量 `schemas`（另 1 条按设计走 `toolsRefSeq` 引用去重） |
| 触发方式 | — | 经本机 API 跑一轮**带 `file_read` 工具调用**的流式对话（`11:29:19` 工具执行成功），验证后会话已 `DELETE` |

**未做（明确，如实）**：D1 校验语义（N1）、通用 `stripUndefinedDeep`（N2）、压缩算法/阈值（N5）、`compaction` 侧的**运行时**验证 —— 该路径需真实触发一次压缩（大会话），本轮仅由单测覆盖其载荷合法性；「压缩不提交投影」是否还有其他抛出点未逐一验证（§8.3-③）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| CS01 归一化 | ✅ 复用既有「条件展开」约定与既有先例写法；不新增抽象 |
| CS02 状态判据 | 不适用（不涉状态判定） |
| CS03 回退最小化 | ✅ 不新增兜底/降级分支；仅收敛载荷构造 |
| CS04 零 Mock | ✅ 用例取**真实**注册表与真实校验器，不造假数据 |
| CS05 根因优先 | ✅ 根因是构造端写 `undefined`；拒绝"放宽校验/统一剔除"两条创可贴路径（§3.4） |
| CS06 证据驱动 | ✅ §1.1 全部结论带实测日志时间戳与文件行号；未实测项标注为"实施时确认" |
| R02 数据模型统一 | ✅ 不改类型（`undefined` 是取值问题，不是字段问题） |
| §1.6 模型可见 ⇔ 已落盘 | ✅ 本项**直接恢复**该红线的可成立性（两类事件此前稳定丢失） |
| §1.1 数据库约定 | ✅ 不涉表结构 |
| CS07 依赖收敛 | 不适用 |

---

## 8. 风险与边界（如实）

1. **收益**：① 恢复 TR-12-B「模型输入快照」的**实际可用性**（此前从未落盘）；② 恢复压缩事件落盘与"压缩即提交投影"，消除压缩白做。
2. **风险（低）**：改动只影响**对象键的存在性**，`undefined` 本就是 JSON 不可表达值 ⇒ Provider 报文零变更；已用"`JSON.stringify` 逐字节相同"用例兜住。
3. **未验证项（实施时确认）**：
   - ① `ToolRegistry` 的其余 3 处无条件键是否**真的**会产出 `undefined`（取决于 `ToolInfo` 的必填性）—— 用 G3① 全量扫描用例给结论，不用推断；
   - ② `context/compaction` 载荷的其它可选字段（`summaryMessageId` 等）是否存在同类风险（同上）；
   - ③ 修复后 `compactionCommitted` 恢复是否**完全**消除"压缩不提交"（该分支还可能有其它抛出点，未逐一验证）。
4. **边界**：本项**不保证**"事件日志再无 `undefined` 拒绝" —— 只收敛**已定位的两个面**（工具 schema / 压缩载荷）+ 给工具 schema 面加面锁；其它面若再现，按同法单独处理（不预造通用剔除器 —— N2）。
5. **不做**：D1 校验语义、压缩算法、UI/端点/表/事件类型、`planId` 透传（另一预存项）。

---

## 附：生效验证步骤（实施后，运维）

1. 重启后端（源文件已改 ≠ 运行生效 —— 见 `todo-expansion-persistence.md` §9 的同一教训）：
   结束 `bun run src/main.ts daemon --http-port 18990` 进程后重新拉起；
2. 跑**一轮带工具调用**的对话，然后核对：
   ```powershell
   Select-String -Path "$env:USERPROFILE\.pyapp\data\logs\app.log" `
     -Pattern '事件未通过无损 JSON 校验|模型输入快照事件追加失败' | Select-Object -Last 5
   ```
   期望：**无新命中**（修复前每轮必命中）；
3. 落盘实证（会话目录 `<sessionsRoot>\<hash>\<sessionId>\events.jsonl`）：
   `Select-String -Path <events.jsonl> -Pattern '"type":"context/model-input"'` 应有命中。
