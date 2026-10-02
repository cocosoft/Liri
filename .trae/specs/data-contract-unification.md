# 数据契约统一专项（Data Contract Unification）

> 状态：**⚠️ 本专项正文（T1–T4）已作废（见 §0）；`data-models` 终局议题已裁定并执行 ①②（见 §2.5）**（2026-10-01）
> 前置依赖：本专项是 [layer-inversion-service-app-app-ui.md](./layer-inversion-service-app-app-ui.md) **子批 C 余 1 条 + 子批 E 余 11 条**的**共同前置**
> 关联规则：`project_rules.md §1.3`（数据模型统一 / 禁止 `any` / 无正式用户⇒可无兼容层）、`coding-standards.md` CS01/CS05、`architecture-compliance.md` R00-001 / R02-002 / R03-002 / R05-011

---

## §0 ⚠️ 实施前发现：本 spec 的 D1（落 `src/types/`）**与仓库既定设计冲突，已推翻**

**发现时点**：执行 T1（`git mv chat/types/message.ts → types/message.ts`）后，读取移动后文件头 L1-5 与 `types/index.ts`，发现：

1. **`app/src/core/data-models.ts` 早已存在**，且是**既定的统一数据契约出口**：
   - `DataMessageRole`（`'system'|'user'|'assistant'|'tool'`，`:25`）· `DataMessage`（`:119`）· `DataMessageType` · `DataContentBlock` · `DataAttachment` · `DataSession` · `DataCreateSessionParams` · `DataAuditEvent` …
2. **全仓已有系统性的 `@deprecated` 迁移标记**（≥ 12 个文件），措辞统一为
   `@deprecated 使用 {@link DataXxx} — 从 \`@modules/core/data-models\` 导入`，覆盖
   `chat/types/message.ts`（含 `MessageRole`/`MessageType`/`MessageStatus`/`Message`/`MessageAttachment`…）·
   `chat/models/types.ts` · `ai/models/types.ts` · `session/types/{Session,Message}.ts` ·
   `commands/framework/CommandAuditLogger.ts` · `config`/`governance` 的 audit 服务。
3. **`app/src/types/index.ts:22-31` 明确记载既定立场**：该文件是"**类型中心收缩**（D-51）"后的产物，注释写明
   「已删除 18 个零消费死类型（… `ContentBlock` / **`Message`** / **`Tool`** / … / **`Command`** …）：
   **各模块使用自身领域类型**（`tools/types`、`chat/types`、`permission/` 等），
   会话消息事实规范为 `chat/types/message.ts`（**@deprecated 迁** `@modules/core/data-models` 的 `DataMessage`）」
   ⇒ **`src/types/` 被刻意收缩**（非"类型仓库"），**不是**本专项 D1 设想的落点。

**⇒ 结论**：D1「规范类型统一下沉 `app/src/types/`」**与既定设计相抵触**（`types/` 已被刻意收缩；指定出口是 `core/data-models` 的 `Data*` 契约）。**T1–T4 作废**，移动**已还原**（树干净、`typecheck 0`、门禁 `已豁免 60` 未变）。

**🆕 同批发现（预存不一致，未改）**：`types/index.ts:27-30` 注释称已删除 `Command`，但**同文件 `:36` 仍在定义 `Command`** ⇒ 注释与实现不符，属**预存文档失准**（另见 `lsp/types.ts:243`、`commands/types/index.ts:39` 各自另有 `Command`）。

**待重定选项**（请评审裁定）：

| 选项 | 内容 | 代价 / 风险 |
|---|---|---|
| **A · 跟既有方向走** | 把 E/C 的跨层消费者改为消费 `core/data-models` 的 `Data*` 类型 | 需**逐处形状适配**（`DataMessage` 与领域 `Message` 形状**不等价**：`DataMessage` 用 `timestamp:number` + 必填 `sessionId`/`type`，领域 `Message` 用 `createdAt/updatedAt:Date`、`sessionId` 可选）⇒ 属**真正的数据模型迁移**，收益同（−12）但风险/工作量显著更高 |
| **B · 务实折中（建议）** | ① 先产 **`Data*` ↔ 领域类型形状对照表**（逐个判定"等价/可适配/不等价"）；② **等价或轻量可适配**者直接切 `@modules/core/data-models`（**零新文件**）；③ **不等价**者**不强行迁数据模型**，改走**端口/门面**（同 D-207 手法）；④ 顺手登记 §0 的注释失准 | 中等；**不制造语义债**；收益视①结论而定（部分条目可能转为端口） |
| **C · 撤销本专项** | 回到"逐域端口化"（各域自建端口） | 收益同、无新文件，但**重复度高**（每个域各造一次端口），与 CS01 相悖 |

**⛔ 在选项裁定前，本专项不实施任何代码改动。**

---

## §1 目标

把**被跨层引用的规范数据类型**统一下沉到**唯一低位出口**（core 层 `app/src/types/`），使 service 层（`services/**` · `infrastructure/**` · `session` · `runtime` …）能够**合法**取用这些类型，从而**一次性解锁**分层门禁中长期无法清零的若干倒挂边。

**非目标（明确排除）**：
- ❌ 不合并"语义不同"的同名类型（见 §3 的 `Message` 三分辨析）；
- ❌ 不做全仓类型重构 —— 只动**被跨层引用**且**判定为规范类型**的那几组；
- ❌ 不放宽门禁判定、不新增例外清单条目（`scripts/layer-exceptions.json` 不动）。

---

## §2 现状实测（2026-10-01，逐条有出处）

### 2.1 受影响的门禁边（合计 **12 条**）

| 来源 | 条数 | 目标类型 | 出处 |
|---|---:|---|---|
| 子批 C · `session-handlers.ts` | 1 | `Message` · `MessageRole` · `LiriEventType` · `dedupeMessagesToolCallBlocks` | layer-inversion spec §3.3 D-204 末节 |
| 子批 E · `chat` 组 | 6 | `Message`（+ `MessageRole` / `ContentBlockType`） | 同 spec §3.5（D-208 全量取证） |
| 子批 E · `tools` 组 | 4 | `Tool` · `ToolInfo` · `ToolParam` · `ToolUseContext` · `ToolResult` · `ToolExecutionStatus` | 同上 |
| 子批 E · `commands` 组 | 1 | `Command` | 同上 |
| （E 余 1 条 `ai` 组代价已算在 `ai` 类，不属本专项） | — | — | — |

> 口径：门禁按 **(文件 × 去重目标模块)** 计 ⇒ **同一文件内同类导入必须全部改走低位出口才减计数**（"改一半不减计数"，见 D-186 教训）。

### 2.2 候选规范类型：落点与依赖判定

| 类型组 | 现行定义位置 | 出向依赖（实测） | 判定 |
|---|---|---|---|
| `Message` 全域（`message.ts` 全表 26 个导出：`MessageRole`/`MessageType`/`MessageStatus`/`MessagePriority`/`AttachmentType`/`MessageAttachment`/`MessageCategory`/`UserMessage`/`AssistantMessage`/`SystemMessage`/`ContentBlockType`/`ContentBlock`/`CompactBoundaryType`/`CompactBoundaryMessage`/`ToolUseSummary(Msg)`/`AttachmentMessage`/`Message`/`NormalizedMessage`/`UsageInfo`/`ToolCallEventDetail`/`SendMessageOptions`/`StreamMessageOptions`/`CreateMessageParams`/`ChatResponse`/`StreamChunk`） | `chat/types/message.ts` | ✅ **零项目导入**（900+ 行，纯类型 + 枚举） | ✅ **整文件下沉可行**（D-204 手法） |
| `Tool` 类型组（7 文件：`Tool` · `ToolUseContext` · `ToolResult` · `ToolProgress` · `ToolDef` · `PermissionContext` · `PermissionResult`） | `tools/types/**` | ✅ 仅**内部相互引用** + `@modules/core`（`Tool.ts:9` 取 core 的协议层 `Message`）⇒ **无 app 依赖** | ✅ **整组下沉可行**；⚠️ `tools/types/index.ts` 另转出 2 个 app 产物（`ClipboardOutput`/`ImageEditOutput`）**须留在原址** |
| `Command` | 三处并存：`commands/types/index.ts:39` · `lsp/types.ts:243` · **`types/index.ts:36`（已在类型中心！）** | 待逐处核 | ⚠️ **须先辨析**（是否同形）；若同形 ⇒ 消费者直接改走 `@modules/types` 即可（**零新文件**） |
| `ChatMessage` | `ai/models/types.ts:277`（另有 `chat/models/types.ts:43` extends `AIMessage`） | 待核（同文件含 `AIService`/`AIMessage`/`AIMessageRole`/`AIModelType`） | ⏳ 待取证 |
| `AIService` / `AIMessage` / `AIMessageRole` / `AIModelType` | `ai/models/types.ts:223/167/160/29` | 待核 | ⏳ 待取证 |
| `SystemPromptContext` | `ai/prompts/SystemPromptBuilder.ts:15`（与 `buildSystemPrompt` 同文件） | 待核 | ⏳ 待取证（**值 + 类型同源** ⇒ 类型下沉与值的取用需同批） |

### 2.3 ⚠️ 三分辨析：`Message` **不是**同一个东西（**不得合并**）

| 变体 | 位置 | 语义 | 门禁现状 |
|---|---|---|---|
| 领域层 `Message` | `session/types/message.ts`（2026-10-01 B11 本体由 `chat/types/message.ts` 迁入） | 对话领域消息（camelCase，含 `ContentBlock` 等） | **R05-011 认定的规范来源** |
| 协议层 `Message` | `core/types.ts` | LLM 协议消息（**snake_case** 工具字段） | R05-011 **已知例外**（`knownExceptions` 显式登记 `core/types.ts`） |
| 其它域私有 | `agent/TitleGenerator.ts` · `chat/types/ToolUseBlock.ts` · `compaction/ContextEngine.ts` · `subagent/SubAgentCommunicator.ts` · `ui/components/Messages.tsx` | 域内私有变体 | R05-011 **已知例外** |

⇒ 本专项**只下沉领域层 `Message`**，**不触碰**协议层与域私有变体（避免制造语义混淆 —— CS05 根因优先，不做"看着像就合并"）。

---

## §2.4 📊 `Data*` ↔ 领域类型 **形状对照表**（方案 B 步骤①，2026-10-01 产出）

**`core/data-models.ts` 全量清单**（`grep '^export (type|interface|enum|const)'`）：
Message 家族 —— `DataMessageRole`(:25) · `DataMessageType`(:28) · `DataTextBlock`(:39) · `DataImageBlock`(:45) · `DataToolUseBlock`(:56) · `DataToolResultBlock`(:64) · `DataContentBlock`(:72) · `DataContentPart`(:79) · `DataToolCall`(:89) · `DataParsedToolCall`(:99) · `DataMessageMetadata`(:106) · `DataMessage`(:119) · `DataAttachment`(:147) · `DataMessageUsage`(:156)；
Session 家族 —— `DataSessionType`(:167) · `DataSessionStatus`(:175) · `DataSessionMetadata`(:236) · `DataSession`(:312) · `DataCreateSessionParams`(:338) · `DataSessionFilter`(:352) · `DataSessionStats`(:365) · `DataSessionInfo`(:375)；
Audit 家族 —— `DataAuditEventType`(:390) · `DataAuditSeverity`(:411) · `DataAuditEvent`(:414) · `DataAuditQuery`(:446) · `DataAuditQueryResult`(:459)；另有 `ToolTurnBudget`(:200) · `TodoExpansionState`(:220)。
**⇒ 无 `DataTool*` / `DataCommand*` / `DataAIService*` 对应物。**

| # | 领域类型（定义处） | 形状要点 | `Data*` 对应物 | 判定 |
|---|---|---|---|---|
| 1 | `Message`（`chat/types/message.ts:399`） | `id` · `role: MessageRole`(enum) · `type?: MessageType` · `content: string\|ContentBlock[]` · **`createdAt/updatedAt/startedAt: Date`** · `toolCallId?` · `tool_calls?: Array<Record<string,unknown>>` · `blocks?` · **`sessionId?`** · **`metadata?: Record<string,unknown>`** · `lastEventSeq?` · `status?` · `priority?` · `category?` · `attachments?: MessageAttachment[]` · `parentId?` · `threadId?` · `processingTime?` · `errorDetails?` · `relatedMessageId?`（L399-563，共 20+ 字段） | `DataMessage`(:119) | ❌ **不等价（结构性差异 7 处）**：① `sessionId` **必填** vs 可选；② **`type` 必填且语义集不同**（见 #2）；③ 时间 `timestamp:number` vs **`Date` 三字段**；④ `tool_calls` 结构化 `DataToolCall[]` vs `Record<string,unknown>[]`；⑤ 领域独有 `blocks`/`lastEventSeq`/`status`/`priority`/`category`/`parentId`/`threadId`/`processingTime`/`errorDetails`/`relatedMessageId` **Data 侧全无**；⑥ `metadata` 固定字段集 `DataMessageMetadata` vs **任意 Record**（实证：`session-handlers.ts:525-532` 写入自定义键 `persistedBy`/`replyToId` ⇒ 迁 `Data*` **会丢键**）；⑦ `role` enum vs string union（写法不兼容） |
| 2 | `MessageType`(enum，:33) | `NORMAL`/`COMPACT_BOUNDARY`/`TOOL_USE_SUMMARY`/`ATTACHMENT`/`SYSTEM`（**消息形态**语义） | `DataMessageType`(:28) | ❌ **同名不同义，禁止互换**：Data 侧为 `TEXT`/`IMAGE`/`FILE`/`TOOL`/`PROGRESS`/`EMBEDDING`/`ERROR`（**内容类型**语义）—— 仅名字相似 |
| 3 | `MessageRole`(enum，:6) | `USER`/`ASSISTANT`/`TOOL`/`SYSTEM` | `DataMessageRole`(:25) | ⚠️ **值集相同、形态不同**（enum vs string union）⇒ 可迁移但**非零改动**（所有使用点需改写法） |
| 4 | `ContentBlock` / `ContentBlockType`(:132/:157) | `ContentBlockType`: `TEXT`/`CODE`/`TOOL_CALL`/`TOOL_RESULT` | `DataContentBlock`(:72) = `Data{Text,Image,ToolUse,ToolResult}Block` | ❌ **不等价**：成员集不同（领域有 `CODE`/`TOOL_CALL`；Data 有 `IMAGE`/`tool_use`），形状亦不同 |
| 5 | `MessageAttachment`(:102) | `id` 必填 · `type: AttachmentType`(9 值) · `url?` · `data?` · `size?` · `contentType?` · `metadata?` | `DataAttachment`(:147) | ❌ **不等价**：Data 侧 `url` **必填**、**无 `id`/`data`/`metadata`**、`type: string` |
| 6 | `Tool` 组（`tools/types/**` 7 文件） | `Tool`/`ToolInfo`/`ToolParam`/`ToolUseContext`/`ToolResult`/`ToolProgress`/`PermissionResult` | **无** | ❌ **无对应物** ⇒ 只能**端口/门面** |
| 7 | `Command`（3 处并存：`commands/types/index.ts:39` · `lsp/types.ts:243` · **`types/index.ts:36`**） | CLI 命令接口 | **无**（`data-models` 未收 `Command`） | ⚠️ 须**三处辨析**（是否同形）⇒ 同形者可在"`types/` 自身"内收口（不涉 `data-models`） |
| 8 | `AIService`/`AIMessage`/`AIMessageRole`/`AIModelType`/`ChatMessage`（`ai/models/types.ts:223/167/160/29/277`） | AI 服务与消息（**协议向**） | **无** | ❌ **无对应物** ⇒ 端口/门面 |
| 9 | `SystemPromptContext`（`ai/prompts/SystemPromptBuilder.ts:15`） | 提示词组装上下文 | **无** | ❌ **无对应物** ⇒ 与值 `buildSystemPrompt` 同批（端口/门面） |

### 📌 对照表结论（决定 B 的落地形态）

1. **`Data*` 是面向"统一存储/协议"的另一套模型**，与领域模型在 **Message / ContentBlock / Attachment 三组上均不等价**（字段缺失、语义集不同、必填性相反）⇒ **选项 A（消费者整体迁 `Data*`）在本批 12 条边上不可行**：会造成**字段丢失**（如 `blocks`/`lastEventSeq`/自定义 metadata 键）与**语义漂移**（`MessageType` 被误换成内容类型）。
2. **可切 `Data*` 的仅 `MessageRole`（值集相同）**，但仍需 enum→union 改写，且会让领域码改用**协议侧词汇**（语义降级风险）⇒ **建议亦不切**，保持领域模型自持。
3. **`Tool` 组 / `Command` / AI 组 / `SystemPromptContext` 在 `data-models` 中无对应物** ⇒ 天然只能**端口/门面**。
4. ⇒ **B 的净落地 = "跨层取用面收口（端口/门面）"，`Data*` 不参与**；收益仍为 **−12**，但按**域分阶段**推进（与 `layer-inversion` §3.5 的 (b)/(c) 并轨）。
5. ⚠️ **`data-models` 终局议题** —— **已于 2026-10-01 取证裁定（见 §2.5）**。

---

## §2.5 🔨 `data-models` 终局议题：取证与裁定建议（2026-10-01）

### 取证（四查，含一处**自我纠正**）

| # | 查项 | 实测结果 |
|---|---|---|
| 1 | **标记面** | `@deprecated 使用 {@link DataXxx} — 从 @modules/core/data-models 导入` ⇒ **12 个文件 / ~30 处**（`chat/types/message.ts` · `chat/types/session.ts` · `chat/models/types.ts` · `session/types/{Session,Message}.ts` · `ai/models/types.ts` · `security/**`×3 · `governance/**`×1 · `config/**`×1 · `commands/framework/**`×1 · `query/QueryLogTypes.ts`） |
| 2 | **是否零消费** | ⚠️ **我此前的判断有误，须纠正**：按显式路径 grep（`'@modules/core/data-models'`）确为 **0 命中**；但 **`core/index.ts:95` 有 `export * from './data-models';`** ⇒ 经 **`@modules/core` barrel** 可消费（我上一轮漏了 barrel 路径 —— 这正是 D-211 那条"须扫 barrel"教训的再次体现） |
| 3 | **是否有活跃用途** | ✅ **有，且是近期的**：`tool-turn-budget-persistence.md`（`ToolTurnBudget` · `DataSessionMetadata.toolTurnBudget`）与 `todo-expansion-persistence.md`（`TodoExpansionState`）两份已落地 spec 均明确"**数据模型声明在 `core/data-models.ts` 单一事实源**"，且互为"姊妹项" ⇒ 该文件**在新增能力上是活跃事实源**，**不是废弃孤岛** |
| 4 | **存量三模型的真实状态** | ❌ **未迁移**：`event-derivation-read-path-rootfix.md:93` 实录 `SessionMetadata.deletedMessageRanges` **在 `core/data-models.ts` 与 `session/types/Session.ts` 双处声明**，后者虽标 `@deprecated` **却仍是该路径的实际类型**；叠加上 §2.4 对照表（Message / ContentBlock / Attachment **形状不等价**）⇒ 存量边**是"声明双写 + 消费仍在领域侧"的双轨**，而非"已统一" |

### 结论：该议题的真相是「**部分落地的统一契约**」，而非"废弃计划"或"待完成迁移"

- ✅ **已落地部分**：**新增**数据契约（session metadata 持久化字段等）⇒ `data-models.ts` 是**活跃单一事实源**，**应保留并继续沿用**（勿动）。
- ❌ **未落地部分**：**存量三大模型**（Message / Session / Audit）⇒ 声明双写、消费在领域侧、形状不等价 ⇒ 30 处 `@deprecated` **承诺了一个从未发生、且代价极高的迁移** ⇒ **这才是"持续误导"的根源**。

### 裁定建议（推荐 **B′：分而治之**）

| 步骤 | 内容 | 风险 |
|---|---|---|
| **①（推荐立即做）** | **停止误导**：把 30 处 `@deprecated 使用 {@link DataXxx} — 从 …导入`（**命令式**，暗示"应迁未迁"）改为**边界说明式**，例：`@see {@link DataXxx}（协议/存储向模型；与领域模型形状不等价，勿直接互换）`；并在 `data-models.ts` 头部**写明迁移状态**（哪些已统一 / 哪些未迁移 + 为何不等价） | **零语义风险**（纯注释 + 文档） |
| **②（推荐）** | **角色正名**：`data-models.ts` 定位为「**协议/存储边界模型 + 新增契约的单一事实源**」，与"领域模型自持"**并存不争** | 低 |
| **③（不建议现在做）** | 真正完成 Message/Session/Audit 迁移（补全 `Data*` 至等价 + 全仓消费者迁移 + 门禁 `canonicalPaths` 更新） | **极高**（全仓数据模型改造）；且 §1.3"无正式用户⇒无需兼容层"**并不降低**该风险（风险在**字段丢失/语义漂移**与改造面，而非兼容层） |
| **④（仅登记）** | 若未来确需统一，单独立项，前置 = 先做 `Data*` 等价化设计（含 `blocks`/`lastEventSeq`/自定义 metadata 键的去留裁定） | — |

**⇒ 一句话裁定建议**：**保留 `data-models`（其在新增能力上活跃有用），但撤回其"存量迁移"的误导性承诺**（把 30 处命令式 `@deprecated` 改为边界说明），**并明确"存量不迁移"**。

### ✅ 执行结果（2026-10-01，用户裁定按 B′ 执行 ①②）

**① 停止误导**（**已完成**）：**13 个文件 / 全部 ~30 处标记**已由
`@deprecated 使用 {@link DataXxx} — 从 \`@modules/core/data-models\` 导入`
改为
`@see {@link DataXxx}（协议/存储向模型；与领域模型形状不等价，勿直接互换）`
（含 2 处变体措辞：`@deprecated 考虑使用 …` · `… 基类 — 从 … 导入` · `… 或自行定义 — …`，均已一并归一）。
涉及文件：`chat/types/message.ts` · `chat/types/session.ts` · `chat/models/types.ts` · `session/types/{Message,Session}.ts` · `ai/models/types.ts` · `security/{managers/SecurityAuditManager, permission/logging/PermissionAuditLogger, audit/AuditTypes}.ts` · `governance/managers/GovernanceAuditService.ts` · `config/enterprise/audit/EnterpriseAuditService.ts` · `commands/framework/CommandAuditLogger.ts` · `query/QueryLogTypes.ts`。

**② 角色正名**（**已完成**）：`core/data-models.ts` 头部新增「**迁移状态与角色边界**」段（2026-10-01 B′-①②），明确：
- 角色＝「协议/存储边界模型」＋「新增数据契约的单一事实源」，与领域模型自持**并存不争**；
- **已落地**：`ToolTurnBudget` · `TodoExpansionState` · `DataSessionMetadata.toolTurnBudget/todoExpansion`（活跃使用，继续沿用）；
- **未迁移（当前不迁移）**：`DataMessage`/`DataSession*`/`DataAudit*` 与领域并存，**逐条列出形状差异**（`timestamp:number` vs `Date`×3 · `sessionId` 必填 vs 可选 · `metadata` 固定集 vs 任意 Record · 10 个领域独有字段 · ⚠️ `DataMessageType` 与 `MessageType` **同名不同义禁止互换**）；
- 结尾给出**新代码判定规则**（新增契约⇒从本文件导入；已有领域模型⇒沿用领域自持类型）。

**验收**：`typecheck` **0** · `lint:arch` 违规 **0** / **`已豁免 60`（不变，纯注释）** · 改动 14 文件 eslint **0/0** · 残留检查：命令式 `@deprecated 使用/考虑使用 {@link Data…` ＝ **0**。

**⛔ ③（存量真迁移）与 ④（未来单独立项）按裁定**：**不做** / **仅登记**。



---

## §3 门禁配合点（关键，决定"零门禁改动"可行性）

1. **`types/` 前缀已被门禁跳过**：`scripts/lint-architecture.ts` 的 R05-011 实现（`checkMessageModelImports`，L1353-1382）含
   `if (relPath.startsWith('types/')) continue;`，注释为「**跳过类型中心目录自身（`src/types/` 是类型定义来源，其 `Message` 非"自定"违规**）」。
   ⇒ **规范类型下沉 `src/types/` 后，R05-011 自动通过，无需改门禁** ✅
2. **R03-002（模块出口单一）**：路径含 **`types` 段** ⇒ 属规范子入口白名单（D-186/D-203/D-204 均已实证）✅
3. **R00-001（跨层）**：`types` 归 **core**（`modules-to-layers.json:86`："纯类型、无出向依赖；归 core 后各层引用自动合法"）⇒ 任一层引用 `@modules/types/**` **均合法** ✅
4. **建议（可选，评审定）**：把新规范路径**显式**补进 R05-011 的 `canonicalPaths`（当前为 `['chat/types/message', 'chat/types/message.ts', '@modules/chat/types/message']`）—— 因规则 1 已自动覆盖，**非必需**；补入可使口径更显式、可读。
5. ⚠️ **门禁脆弱点提醒**（既有注释记载，`core/index.ts:40`）：**不要在注释里写 `export * from '<包名>'` 形式**，会让该对边在门禁眼里"复活" → 本专项的转出层注释**只写包名本身**。

---

## §4 设计决策（建议）

| ID | 决策 | 理由 |
|---|---|---|
| **D1** | **唯一低位出口 = `app/src/types/`（core 层类型中心）** | 既有先例密集（`orchestrationEvents` D-67 · `orchestrationSnapshot`/`agentEvents` D-203 · `a2a` D-204）；门禁 R05-011 自动豁免；各层引用天然合法 |
| **D2** | **整表/整组下沉 + 原址转出**（`export * from '@modules/types/…'`） | 对外导出名与形状**逐字不变** ⇒ 既有消费方**零改动**（D-204 已实证 4 处消费方零改动）；`git mv` 保历史 |
| **D3** | **不合并语义不同的同名类型**（§2.3） | CS05 根因优先；避免"看着像就合并"引入语义债 |
| **D4** | **每批"加性两步"**：① 下沉 + 转出（树绿、计数不变）→ ② 消费方切低位（计数下降） | 同 D-199/D-200 既有纪律；避免中途红态 |
| **D5** | **门禁口径零放宽**：`layer-exceptions.json` 不动、判定不改 | 项目红线（历史教训：BULK-011 误删事件） |
| **D6** | 若某类型**出向依赖含 app 模块**（如 `ai/models/types.ts` 若依赖 app 内其它模块）⇒ **不下沉**，改走**端口/门面** | 否则 core 会新增 `core -> app` 边（净变差，同 D-207 `EffectScope` 教训） |

---

## §5 任务分解（T1–T6，逐个可独立交付）

> 每项验收统一包含：`bun run typecheck` 0 · `bun run lint:arch` 违规 0 / **已豁免按预期下降** / `R03-002` 0 / `R05-011` 不增 · 改动文件 `eslint 0/0` · 定向测试全绿。

| ID | 任务 | 预期收益 | 验收要点 | 状态 |
|---|---|---:|---|---|
| **T1** | ~~`chat/types/message.ts` → `types/message.ts`（+ 原址转出）~~ | ⛔ **作废（见 §0）** | — | ⛔ |
| **T2** | ~~消费方切低位出口：子批 E `chat` 组 6 文件 + 子批 C `session-handlers.ts`~~ | ⛔ **作废（见 §0）** | — | ⛔ |
| **T3** | ~~`tools/types/**` 7 文件 → `types/tools/**`~~ | ⛔ **作废（见 §0）** | — | ⛔ |
| **T4** | ~~消费方切低位：子批 E `tools` 组 4 文件~~ | ⛔ **作废（见 §0）** | — | ⛔ |
| **T5** | `Command` 辨析与收口：核 `types/index.ts:36` ↔ `commands/types/index.ts:39` ↔ `lsp/types.ts:243` 是否同形；同形 ⇒ 消费者直接改 `@modules/types`（**零新文件**）；不同形 ⇒ 按 D3 处理 | **−1**（`mcp/MCPCacheManager.ts`） | 辨析结论写入本 spec 附注 | ⬜ |
| **T6** | `ai` 组待取证项：`AIService`/`AIMessage`/`AIMessageRole`/`AIModelType`/`ChatMessage`/`SystemPromptContext` 逐项按 D6 判"下沉 or 端口" | 取决于取证 | 取证结论回填本表；`ai` 组剩余边随 `layer-inversion` §3.5 (b)/(c) 推进 | ⬜ |
| **T7（可选）** | R02-002 现存告警：`ToolSearchOutput` 三处重复定义（`components/ui/toolUIs/ToolSearchTool/UI.tsx` · `tools/ToolSearchTool/schemas.ts` · `tools/ToolSearchTool/ToolSearchTool.ts`）统一到单一模块 | 清 `R02-002` 1 条 | 门禁 `R02-002` 归零 | ⬜ |

**建议顺序**：T1 → T2（一次 −7，收益最大）→ T3 → T4 → T5 → T6 → T7。

---

## §6 风险与回滚

| 风险 | 缓解 |
|---|---|
| 下沉被门禁误判为新增违规 | 每批前后**实跑 `lint:arch`** 对比 `已豁免`（预期"不变"或"下降"）；D-190 已证实注释会被剥离，但 `core/index.ts:40` 记载的 `export * from '<包名>'` 注释陷阱仍须规避 |
| 类型下沉后 core 出现 `core -> app|infra` 新边 | 每项**先算出向依赖的层**（D6）：零依赖才下沉；否则端口化 |
| 消费方遗漏（有些文件用子路径 `@modules/chat/types/message`，有些用 `@modules/chat/types`） | 每项下沉后**全仓 grep 三种写法**（`chat/types/message` · `chat/types` · `@modules/chat`）逐一核对 |
| 转出层导致运行期循环依赖 | R00-001 已含"循环依赖"检查（门禁输出 `循环依赖: N`），每批验收须为 0 |
| 回滚 | 每项**独立提交**；回滚即 revert 该提交（D2 的"原址转出"保证树随时可编译） |

---

## §7 合规检查清单（评审用）

- [ ] **CS01 归一化**：下沉前已核 `src/types/` 是否**已有**同名/同形类型（`Command` 已存在 ⇒ T5 须先辨析，不得重复定义）
- [ ] **CS05 根因优先**：解法是"确立唯一低位出口"，非逐文件端口化贴创可贴
- [ ] **CS06 证据驱动**：§2 每条均有文件/行号出处；未取证项**显式标注 ⏳ 待取证**，不臆断
- [ ] **§1.3 数据模型统一**：规范类型单一事实来源；产出物与 spec 同步更新
- [ ] **R00-001 / R02-002 / R03-002 / R05-011**：每批实跑门禁并记录前后数字
- [ ] **D3 语义不合并**：§2.3 三分辨析已复核（协议层 / 领域层 / 域私有**不得混一**）
- [ ] **SDD 同步**：实施每批后回填本 spec 状态列 + 在 `layer-inversion` spec 相应条目登记（保持"spec ⇄ 代码"同步）
- [ ] **无 Mock / 无 `any`**：下沉为**纯类型搬运**，不得引入 `any`（`PermissionContext.ts:23` 已存在的 `any[]` 属**存量**，本专项不扩散、不顺手改）

---

## §8 与既有 spec 的关系

| 文档 | 关系 |
|---|---|
| [layer-inversion-service-app-app-ui.md](./layer-inversion-service-app-app-ui.md) | 本专项是其实施者：子批 C 余 1 条 + 子批 E 余 11 条的**共同前置**；本专项完成后回填其台账 |
| （历史）`layer-inversion-memory-chronos-system.md` | 已完成，无冲突 |
| `.trae/specs/a2a-external-exposure.md` | 先例：其 A2A 类型已由 D-204 下沉 `types/a2a.ts`，与本专项同一手法 |

---

## §9 🆕 v2 范围扩展：**重名事实源集群**（2026-10-01，用户裁定立项）

> **为什么扩**：实施 layer-inversion 子批 F 时，B11（`session -> chat` 11 条）与 B14（`session -> context` 1 条）接连被**同名不同物**阻断，同时暴露多组**同名重复实现**。它们与 §2.3 的 `Message` 属**同一类问题**（"一个名字、多份事实源"）⇒ 必须**一并裁定**，否则：① B11/B14 无法推进；② `R02-002` / `R05-013` 会继续用错误口径误导后续改造。

### 9.1 集群清单（实测，逐条有出处）

| # | 名字 | 份数 | 落点 | 判定要点 |
|---|---|---:|---|---|
| 1 | `Message` | **4** | 协议层 `core/types.ts` · 领域层 `session/types/message.ts`（2026-10-01 B11 本体由 `chat/types/` 迁入） · 域私有变体 · **`session/types/UnifiedMessage.ts`（`UnifiedMessage` 家族 322 行；2026-10-01 P2 由 `Message.ts` 改名）** | §2.3 已证"**不是同一个东西、不得合并**"；**第 4 份为本次新增发现** |
| 2 | `SessionContext` | **3** | `context/types/Context.ts` · `memory/types/SessionContext.ts` · `security/SecurityAudit.ts:135` | 同名不同物；⚠️ **B14 类型下沉的唯一冲突源** |
| 3 | `Context` | **2** | `context/types/Context.ts` · `docs/HelpSystem.ts:46` | 同上 |
| 4 | `Tool` | **2** | `types/tool.ts`（22 行极简投影） · `tools/types/Tool.ts`（660 行完整契约） | 阻断 E 组 `tools` 3 条；**Windows 大小写不敏感 ⇒ `tool.ts`/`Tool.ts` 无法同目录并存** |
| 5 | `Command` | **2** | `types/index.ts:36`（极简） · `commands/types/index.ts:39`（完整 CLI 契约，含 `type: CommandType`） | 已按"不合并"处置（D-220 去假依赖：`MCPCacheManager` 改不透明载荷） |
| 6 | `CheckpointStorage` | **2** | `chat/types/checkpoint.ts:35` · `query/types.ts:81` | D-222 B13 附带发现 |
| 7 | `parseContextLimitFromError` | **2** | `ai/ContextDegradation.ts` · `context/window/ContextWindowResolver.ts` | **D-222 B14 的硬阻断源**（`ai` 桶出口同名 ⇒ `TS2300`）；两份**行为可能不同** ⇒ 必须先定事实源 |
| 8 | 其他 | — | 见 `scripts/lint-architecture.ts` 的 R05-013 `knownExceptions` | 既有例外清单，交叉参照 |

### 9.1-U1 📊 全员同名普查结果（2026-10-01 执行，**全量可复核**）

**方法**（不落文件，单条命令即可复现）：遍历 `app/src/**/*.{ts,tsx}`，正则抓取 `export (interface|type|enum|class) <Name>`，按名字归组并**按顶层模块去重**分类。命令：

```
bun -e "…matchAll(/export[ ]+(interface|type|enum|class)[ ]+([A-Za-z_][A-Za-z0-9_]*)/g)… // 见本轮执行记录"
```

**结果**：

| 指标 | 数量 |
|---|---:|
| 全仓 `export` 类型/类名（去重后） | **7451** |
| 出现在 ≥2 个文件的同名 | **619** |
| ↳ **仅同一模块内**（域内私有同构变体，**不处置**） | **166** |
| ↳ **跨 ≥2 个顶层模块**（**本专项处置对象**） | **453** |

**分档结论**：

- **166 个"同模块内重名"不处置** —— 典型如 `channels/*/monitor.ts` 的 `MonitorEvent`/`MonitorStats`/`MonitorListener`（**各 24 份**，每通道一份）· `ink/**` 的 React `Props`（7 份）⇒ 属**域内私有**，无跨模块可见性问题。**⚠️ 若按"文件数"粗筛会把它们误判为高危（24 份！）** —— 这是 U1 必须按模块去重的原因。
- **453 个"跨模块同名"** 按模块数排序，Top（≥4 模块）：

| 名 | 模块数 | 模块 |
|---|---:|---|
| `ValidationResult` | **8** | commands, common, context, plugins, security, services, tools, utils |
| `Message` | **6** | agent, chat, compaction, core, subagent, ui |
| `TaskStatus` | **6** | chronos, common, components, core, knowledge, workspace |
| `CompletionItem` | **6** | cli, commands, hooks, lsp, security, tools |
| `PerformanceMetrics` · `TokenUsage` · `LogLevel` · `SearchResult` | **5** | （见执行记录） |
| `Tool` · `ToolCall` · `ToolContext` · `ToolResult` · `ToolPermissionContext` · `PermissionContext` · `PermissionRule` · `PermissionMode` · `RetryConfig` · `RetryResult` · `AppState` · `NotificationType` · `SessionInfo` · `SessionStatus` · `SessionMetadata` · `SecurityConfig` · `AuditEvent` · `AuditEventType` · `HealthStatus` · `SyncStatus` · `TeamMember` · `AgentDefinition` · `DeliveryResult` · `MigrationResult` · `HistoryEntry` · `MemoryManager` · `TrendAnalysis` · `CleanupResult` | **4** | （见执行记录） |

**⇒ 优先级（本专项只处理"有后果"的子集，不做 453 一次性清洗）**：按

1. **阻断门禁/改造者优先**：`Message`（B11）· `Tool`（E 组 3 条）· `parseContextLimitFromError`（B14）· `Command`/`CheckpointStorage`/`SessionContext`/`Context`（§9.1 已列）；
2. **已在类型中心者**（R05-013 相关）：`Message` · `Tool` · `Command` …；
3. **被跨层消费且同名者**（与 layer-inversion 台账交集）。

**⚠️ 门禁差距（须记入 §9.4）**：实测跨模块同名 **453** 个，而 `R02-002` 当前**仅报 1 条**（`ToolSearchOutput`）⇒ 门禁检测面**远窄于实况**（R02-002 只覆盖"类型中心/核心数据契约"相关的窄集合）。**⇒ 不得把"R02-002 = 1 条"当作"重名问题只有 1 个"**；本专项的判定须以 U1 普查为基数。

### 9.2 待裁定的**统一判定原则**（本专项核心产出）

三条原则，供 §9.1 逐条套用（与 §2.3 的"三分"结论一致）：

1. **同名 ≠ 同物 ⇒ 一律不得"看着像就合并"**（CS05）。每条必须给出**形状 / 语义 / 消费方**三列对照，再判「合并 · 各自为事实源 · 一方删除」。
2. **一个名字只允许一个"规范落点"**；其余必须**改名**（如 `SessionContext` → `MemorySessionContext`）或**收敛为唯一事实源**（其余改为再导出）。
3. **"规范落点"所在层必须 ≤ 全部消费方的最低层**（§2.2 判据），且**不得违反两条已付代价的硬约束**：① **Windows 大小写不敏感**（D-217/D-222 教训）；② **模块桶出口唯一**（R03-002；含"不在两个桶里导出同名符号"）。

### 9.3 任务分解（U1–U6，逐个可独立交付）

| ID | 任务 | 交付物 | 解锁 |
|---|---|---|---|
| U1 | ✅ **已完成（2026-10-01）**：产出 **§9.1-U1** 全量普查（`7451` 名 / `619` 重复 / `166` 域内私有（不处置）/ **`453` 跨模块同名**）+ 优先级三档 | 总表（§9.1-U1） | 后续全部 |
| U2 | ✅ **已完成（2026-10-01）**：`Message` **7 份全消名** —— 规范来源 `chat/types/message.ts` 保留，其余 6 份改名（含单独立项的 `ProtocolMessage` `64dd5a077`）⇒ **R05-011 归零**（§9.10） | 判定表 + 处置 | ~~B11~~（**已更正：不解锁 B11**，见 §9.10「更正」） |
| U3 | ✅ **已完成（2026-10-01）**：删死文件 `tools/legacy_types.ts`（零 importer）+ `types/tool.ts` 极简版改名 `AppStateToolRef` / `AppStateToolPermissionContext`（§9.7） | 判定表 + 处置 | E 组 `tools` 3 条（**余项仍受阻**：`Tool` 双份 + Windows 大小写） |
| U4 | ✅ **已完成（2026-10-01）**：`parseContextLimitFromError` 侧改 `parseContextOverflowSignal`（4 文件纯改名），解除 B14 的 `ai` 桶同名硬阻断（§9.6） | 判定表 + 处置 | **B14** ✅ |
| U5 | ✅ **已完成（2026-10-01）**：`ToolPermissionContext`(5→1) · `SessionContext`(3→1) · `Message`(7→1) · `Context` · `CheckpointStorage` · `PermissionMode` 全簇消名；`Command` 按"不合并"处置（D-220 去假依赖）；`Tool` 见 U3（§9.8–§9.12） | 判定表 + 处置 | B14 ✅ / 低风险 |
| U6 | ✅ **已完成（2026-10-01）**：回填两张台账（本文件 §9.13 + layer-inversion spec 的 B12/B13/B14）并收口本专项 | 台账更新 | — |

### 9.4 门禁配合（沿用 §3，补两点）

- **R05-013**：处置口径已落 `scripts/lint-architecture.ts#checkTypeCenterDuplicates` 的 JSDoc（2026-10-01）—— **只扫定义、不扫再导出**；**往 `types/` 塞同名定义前必须核同名**。
- **R02-002**：当前仅 1 条违规（`ToolSearchOutput` ×3）。⚠️ **U1 实测跨模块同名 453 个** ⇒ **门禁检测面远窄于实况**（R02-002 只覆盖类型中心/核心契约相关的窄集合）⇒ **不得以"R02-002 = 1 条"推断"重名问题只有 1 个"**。若 U2–U5 要动手 ⇒ **应先扩 R02-002 的检测面**（否则"改了却没有门禁覆盖"）；但**不得放宽已有例外**。

### 9.5 合规检查清单（评审用，沿用 §7 并补）

- [ ] 每条判定都有**形状 / 语义 / 消费方**三列对照（GR03 证据驱动）
- [ ] 凡"合并"必须给出**可复核的编译期或运行期证据**，不得仅凭命名相似
- [ ] 凡"改名"必须**同批**更新全部消费方，并核 `tsconfig` 别名与桶出口
- [ ] 凡"再导出"必须核 **R05-013（定义）** 与 **R03-002（桶出口唯一）**
- [ ] **不得新增 `layer-exceptions.json` 例外条目**（与"清空例外"方向一致）

---

### 9.6 ✅ U4 裁定：`parseContextLimitFromError` 两份 —— **同名不同物，不得合并；改名是唯一出路**（2026-10-01）

**取证（逐条比对两份实现）**：

| 维度 | `ai/ContextDegradation.ts:152` | `context/window/ContextWindowResolver.ts:131` |
|---|---|---|
| 入参类型 | `Error \| string \| {message?: string} \| unknown`（**吃对象/错误实例**） | `string`（**只吃字符串**） |
| 模式数 | **6**（含 `too long (N > N)` · `exceeds (the) maximum of N` · 泛化 `max_tokens: N`） | **4**（含 llama.cpp 专属 `exceeds the available context size (N tokens)`） |
| **返回契约** | `number \| null`（**无哨兵**） | `number \| null`，其中 **`-1` 为哨兵**（"已知溢出、无精确值"，见其 L149-151） |
| 数字容错 | 支持千分位（`[\d,]*` + `replace(/,/g,'')`） | 不支持 |
| 内部消费 | `tryDegradeContext`（→ `chat/ChatManager` · `chat/orchestrator/streamMessageFlow`，经 `@modules/ai`） | `decideOverflowRecovery`（同文件 L243）+ **`chat/orchestrator/preSendContextProtection.ts:335`** + **8 个单测** |

**⇒ 判定（按 §9.2）**：① **同名 ≠ 同物** —— 两者**入参类型不同**（对象 vs 字符串）、**返回语义不同**（`-1` 哨兵 vs 无）⇒ **不可合并**（合并会**静默改变至少一侧契约**：把 `-1` 喂给 `ai` 的 `tryDegradeContext`，或把对象入参喂给只收字符串那份 ⇒ 类型与行为**双重破坏**，违反 CS05/CS03）。② 依 §9.2 原则 2「一个名字一个规范落点」，**必须消名**。

**裁定（建议，纯改名、零行为变化）**：

- **`ai` 侧保留 `parseContextLimitFromError`** —— 它是"**纯解析器**"（无哨兵、无副作用），名字最贴合；且经 `ai` 桶被 `chat` 链路消费。
- **`context` 侧改名 `parseContextOverflowSignal`** —— 其真实契约是"解析限制；**`-1` = 仅知溢出**；`null` = 未识别" ⇒ 名字须体现**信号语义**。
- **改动面 5 个文件（纯改名）**：`context/window/ContextWindowResolver.ts`（定义 + 同文件 L243 调用）· `context/index.ts:97`（转出）· `chat/orchestrator/preSendContextProtection.ts`（导入 + L335 调用）· `app/tests/context/ContextWindowResolver.test.ts`（导入 + 8 处调用）。
- **效果**：`ai` 桶与 `context` 桶不再同名 ⇒ **解除 B14 的第三处硬阻断**（迁入 `ai/window/` 时不再 `TS2300`）；**计数零变化**（纯改名）。
- ⏳ **执行状态**：**待执行**（等确认后按上述 5 文件落地）。

---

### 9.7 ✅ U3 裁定：`Tool` 同名簇 —— **死文件删除 + 极简版改名**（2026-10-01）

**取证（U1 显示 `Tool` 跨 4 模块 / `ToolDefinition` 4 / `ToolSchema` 4）**：

| 落点 | 形状 | 消费方 |
|---|---|---|
| `tools/types/Tool.ts`（**660 行完整契约**） | `name` · `description` · **`params: ToolParam[]`** · `execute` · `isEnabled` … | **众多**（`tools/**` · `ai` · `permission` · `chat` · `runtime/api`…） |
| `types/tool.ts`（**22 行极简**） | `name` · `description` · **`parameters?: Record<string, unknown>`** · `execute?` + `ToolPermissionContext`(11 字段) | **仅 1 个**：`appState/AppState.ts:7`（且**只作字段声明** `tools: Tool[]` / `toolPermissionContext`，**不访问任何字段**，L167/L223/L340） |
| `tools/legacy_types.ts` | `Tool` / `ToolDefinition` / `ToolSchema` **各一份** | ⚠️ **零 importer**（全仓仅被 `scripts/lint-architecture.ts:1513` 的 **R05-013 例外清单**登记而"存活"）⇒ **死文件** |

**⇒ 判定（按 §9.2）**：三者**同名不同物**（极简版字段名 `parameters` ≠ 完整版 `params`，**形状不兼容**）⇒ 不得合并。

**裁定（两条，均待授权执行）**：

1. **删除 `tools/legacy_types.ts`**（零 importer 死文件；同步移除其 R05-013 例外登记）⇒ **直接减少 3 个同名定义**（`Tool`/`ToolDefinition`/`ToolSchema`），且**例外清单 -1**（与"清空例外"同向）。⚠️ 按项目规则「先报告、不擅自删除」⇒ **待你授权**。
2. **`types/tool.ts` 的极简 `Tool` 消名**，二选一：
   - **甲（真消肿）**：`AppState` 改引完整契约 `@modules/tools/types`（`appState`→`tools` 同属 **app** ⇒ **合法**）。⚠️ 前置：核 `AppState.tools` 的**写方**是否赋入"极简形状"对象（若赋的是真 `Tool` 则成立；否则会类型不兼容）。
   - **乙（零风险）**：极简版**改名**（如 `AppStateToolRef`），语义即"AppState 持有的工具**宽松引用**"。
   - ⚠️ 同文件另有 `ToolPermissionContext`，其同名面跨 **4 模块**（`types/tool.ts` · `tools/types/PermissionContext.ts` · `system/state/types.ts` · `permission/**`）⇒ **属 U5**，与本条分开处置。
3. **对 E 组 `tools` 3 条的解锁作用（如实）**：本条**不直接**解锁它们（那 3 条要的是 `tools/types/*` 的**跨层取用**问题，见 layer-inversion §3.5 D-218）—— U3 的价值在于**消除同名、减少 3 个重名项、并纠正一处"例外养死码"**。

**执行状态（2026-10-01 更新）**：

- **① ✅ 已执行**：删除 `tools/legacy_types.ts` + 移除其 R05-013 例外登记 ⇒ 同名定义 **−3**（`Tool`/`ToolDefinition`/`ToolSchema`）· 例外清单 **−1**。**验证**：`typecheck 0` · `lint:arch` 违规 0 / 类型中心冲突 **0** · 错误 0 警告 3（预存）· 检查文件 `3987 → 3986`（恰 −1）· `bun test tests/chat src/appState` = **335 pass / 0 fail**。
- **② ❌「甲」被证伪（同日，用户已授权甲但实施后回滚）**：切到完整契约后 `typecheck` 报 **`AppState.ts(340,28) TS2352`** —— `tools/types` 的 `ToolPermissionContext` **必填** `mode` · `additionalWorkingDirectories` · `alwaysAllowRules` · `alwaysDenyRules` · `alwaysAskRules`，而 AppState 的默认字面量（`isBypassPermissionsModeAvailable`/`Enabled` · `circuitBroken` · `circuitBrokenAt`）**没有这些字段** ⇒ **两者仍属"同名不同物"**（我上一轮前置核验**不完整**：只查了 `Tool` 的字段访问，**漏查 `ToolPermissionContext` 的形状**）。补默认值等于**替它编语义**（违反 CS04/CS05）⇒ **立即回滚甲部分**（`types/tool.ts` 与 `AppState.ts` 已还原），仅保留 ①。
  - ⇒ **改走「乙」**：`types/tool.ts` 的极简对（`Tool` + `ToolPermissionContext`）**整体改名**（如 `AppStateToolRef` / `AppStateToolPermissionContext`），或**按 U5 统一处置** `ToolPermissionContext` 的 **4 模块同名面**后再命名 ⇒ **待裁定**。

---

### 9.8 ✅ U5 已收口：`ToolPermissionContext` 同名簇（5 份 / 4 模块）+ `Tool`（2026-10-01）

**判定表（实测 5 处形状各异 ⇒ 全部"同名不同物"）**：

| # | 落点 | 形状 | 处置 |
|---|---|---|---|
| 1 | `permission/permissions.ts:11` | `mode: PermissionMode` + 4 个集合**必填** | ⭐ **规范落点候选**（权限域事实源） |
| 2 | `tools/types/PermissionContext.ts:28` | `mode: PermissionMode` + 额外工作目录…（**工具契约侧**） | 待核与 #1 是否同构 ⇒ 同构则**收敛为再导出**；否则改名 |
| 3 | `permission/utils/RuleMatcher.ts:41` | **`Partial<Record<PermissionRuleSource, string[]>>`** 变体 | 改名（如 `PartialRuleSourceContext`） |
| 4 | `system/state/types.ts:29` | `mode: string` 宽松版（4 字段，全可选） | 改名（如 `StateToolPermissionContext`） |
| 5 | `types/tool.ts:11` | 极简占位（AppState 用） | ✅ **已改名**（见下） |

- **✅ 已执行（#5 + `Tool`）**：`types/tool.ts` 的极简对改名 **`AppStateToolRef` / `AppStateToolPermissionContext`**（即 U3-② 的「乙」），同步更新唯一消费方 `appState/AppState.ts`（导入 + 3 处引用：`toolPermissionContext` 字段 · `tools:` 字段 · `as …` 断言）。
  - **验证**：`typecheck 0` · `已豁免 43`（不变）· 类型中心冲突 **0** · 错误 0 警告 3（预存）· 改动文件 eslint 0/0 · `bun test src/appState tests/chat` = **335 pass / 0 fail**。
  - **收益**：一次性消掉 **2 个同名**（`Tool` 与 `ToolPermissionContext` 各 **−1 份**；且该文件**无行为变化** —— 零风险改名）。
- ⏳ **余 4 份（#1–#4）待处置**：需先核 **#2 与 #1 是否同构**（决定"收敛为再导出" vs "改名"），再定 #3/#4 的新名。**这是 U5 的主项，随后完成。**

#### ✅ #2 ↔ #1 同构性核验（2026-10-01，**不同构 ⇒ 不可收敛**）

| 字段 | #1 `permission/permissions.ts:11`（**权限域事实源**） | #2 `tools/types/PermissionContext.ts:28`（工具契约侧） |
|---|---|---|
| `mode` | `PermissionMode`（引 `permission/PermissionMode.ts`） | `PermissionMode` —— **本文件 L9 自定** `type PermissionMode = 'default'\|'auto'\|'strict'\|'bypass'` ⚠️ **`PermissionMode` 亦同名又一份**（U1：4 模块） |
| `additionalWorkingDirectories` | **`string[]`** | **`Map<string, AdditionalWorkingDirectory>`** ✗ |
| `alwaysAllowRules`/`Deny`/`Ask` | `Record<PermissionRuleSource, string[]>`（**联合类型**） | `ToolPermissionRulesBySource` = **`Record<string, any[]>`**（含 `any`）✗ |
| `isBypassPermissionsModeAvailable` | `boolean` | `boolean` ✓ |
| 额外字段 | — | `isAutoModeAvailable?` · `strippedDangerousRules?` · `shouldAvoidPermissionPrompts?` · `awaitAutomatedChecksBeforeDialog?` · `prePlanMode?` |
| `getEmptyToolPermissionContext()` | 有（值） | **同名亦一份**（值） |

**⇒ 判定**：#2 是 #1 的「**超集 + 类型劣化**」（`Map` ↔ `string[]`、`any[]` ↔ 联合类型）⇒ **不可收敛为再导出**（会静默降低类型精度）⇒ **只能改名**。

**⇒ 裁定（执行顺序）**：
1. **#1 保留 `ToolPermissionContext`**（权限域事实源；类型最严格）。
2. **✅ #2 已改名 `ToolRuntimePermissionContext`（2026-10-01 执行）** —— 语义 = **工具执行期**权限上下文（含 `Map` 工作目录与 5 个执行期开关）。**实测波及面极小：2 文件 4 处** —— `tools/types/PermissionContext.ts`（定义 + `getEmptyToolPermissionContext` 返回类型）· `tools/types/Tool.ts`（导入 + `ToolUseContext.toolPermissionContext` 字段）。**不受影响**：`getEmptyToolPermissionContext()`（同名**函数**，调用方 `entrypoints/mcp.ts` 零改动）· `tools/types/index.ts`（`export *` 自动转发）· **零外部消费者**（无任何文件从 `@modules/tools/types` 取该类型）。
   - ⚠️ **不可用一键替换**：函数名 `getEmptyToolPermissionContext` 含同名子串，`replace_all` 会连带改坏函数名 ⇒ 必须定点改（4 处）。
   - **验证**：`typecheck 0` · `已豁免 43`（不变）· 类型中心冲突 **0** · 错误 0 警告 3（预存）· 改动文件 eslint 0/0 · `bun test tests/tools src/tools` = **675 pass / 0 fail**。
3. **✅ #3 已改名（2026-10-01 执行）**：`permission/utils/RuleMatcher.ts` 的 `ToolPermissionContext` → **`RuleMatcherPermissionContext`**（语义 = **规则匹配器**所用的权限上下文视图；其 4 个规则表为 `Partial<Record<PermissionRuleSource, string[]>>`）。**实测波及面：2 文件** —— `RuleMatcher.ts`（定义 + 10 处内部引用 + 2 处 `getDenyRules`/`getAskRules` 签名）· **`permission/PermissionManager.ts`（4 处：它从 `./utils/RuleMatcher` 导入该类型** —— 即 `#3` 有 1 个**跨文件**消费者，非仅内部；**该导入指向不变 ⇒ 行为不变**）。
   - ⚠️ **两个坑（均已踩并修正）**：① `replace_all` 只匹配了带尾逗号的形式 ⇒ 漏掉 `getAllowRules` 的**无尾逗号**参数行；② `getToolPermissionContext`/`setToolPermissionContext` **含同名子串** ⇒ 必须定点改。
4. **✅ #4 已改名（2026-10-01 执行）**：`system/state/types.ts` 的 `ToolPermissionContext` → **`StateToolPermissionContext`**（`mode: string` + 3 个规则表**全可选**的 state 侧**宽松**视图）。**波及面：2 文件 2 处** —— `types.ts`（定义）· `system/state/index.ts`（barrel 转出）；**无任何直接消费者**。
5. **✅ 附带发现已处置（2026-10-01）**：`PermissionMode` **亦两份** ⇒ 工具契约侧改名 **`ToolPermissionMode`**（实测落点 `tools/types/PermissionContext.ts:9` 定义 · `:42 mode` · `:92 prePlanMode`）；权限域 `permission/PermissionMode.ts` **保留**（事实源）。值域未收敛为再导出 ⇒ 处置与 #2 同族（**改名**，非合并）。

**✅ 簇收口状态（2026-10-01）**：`ToolPermissionContext` 的 **5 份已全部消名** —— #1 保留（权限域事实源）· #2 → `ToolRuntimePermissionContext` · #3 → `RuleMatcherPermissionContext` · #4 → `StateToolPermissionContext` · #5 → `AppStateToolPermissionContext`。**验证（#3/#4 批）**：`typecheck 0` · `已豁免 43`（不变）· 类型中心冲突 **0** · 错误 0 警告 3（预存）· 改动文件 eslint 0/0 · `bun test src/permission tests/permission tests/security` = **97 pass / 1 skip / 0 fail**。

---

### 9.9 🟡 U5：`SessionContext` 同名簇（3 份 / 3 模块）—— 取证与裁定（2026-10-01）

**判定表（三份字段完全不同 ⇒ 全员"同名不同物"）**：

| # | 落点 | 形状 | 消费方 |
|---|---|---|---|
| **A** | `context/types/Context.ts:10` | `extends Context { type:'session'; sessionId; userId?; agentName?; channelType? }` —— **AsyncLocalStorage 注入的会话运行时上下文** | `session/SessionGateway`（导入 + 构造）· `context/ContextFactory` · `context/AsyncContextStorage`；⚠️ **`context/types/SessionContext.ts:8` 已**是它的再导出 shim（原文注明「R07-P1 归并：原此处独立定义…」） |
| **B** | `memory/types/SessionContext.ts:5` | `{ sessionId; turnCount; duration; startedAt; tags?; recentTopics?; projectId? }` —— **记忆检索专用**（用于检索权重调整） | **6 文件**：`services/prompt/PromptAssembler` · `services/prompt/MemoryPromptProvider` · `memory/services/MemorySummarizer` · `chat/ChatManager` · `chat/services/MessageContextPipeline` · `memory/index.ts`（barrel） |
| **C** | `security/SecurityAudit.ts:135` | `{ sessionId; taskDescription; currentMode: 'auto'\|'normal'\|'allow_all'\|'deny_all' }` —— **命令执行 / 审计专用** | 同文件内 2 处（294/628） |

**⇒ 裁定（按 §9.2 原则 2「一名一规范落点」）**：

1. **A 保留 `SessionContext`** —— 理由两条：① 语义最通用（"会话**运行时**上下文"）；② **仓内已把它当 context 域规范名**（`context/types/SessionContext.ts` 已是它的再导出 shim，且注明 R07-P1 归并结论）。
2. **B → 改名 `MemorySessionContext`**（记忆检索语义；⚠️ 工作量集中在此 —— **6 文件**）。
3. **C → 改名 `SecuritySessionContext`**（审计语义；⚠️ **不能**用 `AuditSessionContext` —— 该名已被 `security/SecurityAuditLogger.ts:25` 占用，是另一概念）。
4. ⚠️ `security/SecurityAuditLogger.ts` 的 `AuditSessionContext` 与 `security/index.ts` 的转出**本已区分**，不在本簇内（佐证"按角色命名"是该仓既有做法）。

✅ **执行状态：已完成（2026-10-01）** —— **B → `MemorySessionContext`**（实测 `memory/types/SessionContext.ts:10` 定义 · `memory/index.ts:76` 转出 · `memory/services/MemorySummarizer.ts` 5 处消费）· **C → `SecuritySessionContext`**（实测 `security/SecurityAudit.ts:141` 定义 · `:300` · `:634`）· **A 保留 `SessionContext`**（规范落点）。

---

### 9.10 🟡 U5：`Message` 同名簇（**7 份** / 7 模块）—— 取证与裁定（2026-10-01）

**判定表（7 份字段集全不相同 ⇒ 全员"同名不同物"）**：

| # | 落点 | 形状 | 角色 |
|---|---|---|---|
| 1 | `agent/TitleGenerator.ts:37` | `{ role: string; content: string }` | 标题生成输入 |
| 2 | `core/types.ts:33` | `{ role: 'system'\|'user'\|'assistant'\|'tool'; content; tool_calls?; tool_call_id? }` | **协议层**（snake_case；R05-011 已列 knownException） |
| 3 | `chat/types/ToolUseBlock.ts:51` | `{ role; content: string\|ContentBlock[]; usage?; … }` | 工具块消息变体 |
| 4 | **`session/types/message.ts:399`**（2026-10-01 B11 本体迁入） | 领域完整（`id` 起） | ⭐ **R05-011 认定的规范来源** |
| 5 | `compaction/ContextEngine.ts:7` | `{ id; role; content; createdAt: Date; tokenCount?; metadata? }` | 压缩/上下文引擎 |
| 6 | `ui/components/Messages.tsx:9` | `{ id; content; **sender**; timestamp?; type?; codeLanguage? }` | UI（用 `sender` 而非 `role`） |
| 7 | `subagent/SubAgentCommunicator.ts:11` | `{ id; type; **content: any**; sender; receiver; timestamp }` | 子代理 IPC（**含 `any`**） |
| ＋ | `session/types/UnifiedMessage.ts`（**文件名**曾与 `chat/types/message.ts` 同名，导出的是 `UnifiedMessage` 家族 322 行） | — | **文件名**冲突源（Windows 大小写）；2026-10-01 P2 已改名 `UnifiedMessage.ts`（B11 前置） |

**⇒ 裁定（§9.2 原则 2）**：**规范落点 = #4 `session/types/message.ts`**（R05-011 + `project_rules §1.6` 双重认定；2026-10-01 B11 本体由 `chat/types/message.ts` 迁入）⇒ **其余 6 份改名**（建议名）：
`TitleGenMessage`(#1) · `ProtocolMessage`(#2，⚠️ **波及最大** —— providers 广泛使用，须单独评估) · `ToolUseMessage`(#3) · `ContextEngineMessage`(#5) · `UIMessage`(#6) · `SubAgentMessage`(#7)。
另：✅ `session/types/Message.ts` **文件名**已改 `UnifiedMessage.ts`（2026-10-01，B11 前置 P2；其导出名本就是 `UnifiedMessage`）⇒ 消除与 `chat/types/message.ts` 的**文件名**冲突。同批 `session/types/Session.ts` → `UnifiedSession.ts`。

**⚠️ 更正（2026-10-01，重要的是非粉饰）**：**U2 并不能解锁 B11** —— B11（`session -> chat` 11 条）的阻断是 **① 文件名冲突**（`session/types/Message.ts` ⟷ `chat/types/message.ts`，Windows 大小写不敏感；**U2 改的是 Type 名，对文件名无效**，除非采纳上条"文件名改 `UnifiedMessage.ts`"）+ **② `eventPayloads → @modules/tasks`(app) / `@modules/utils/mermaidLint`(infra)** 的传递依赖（与 U2 完全无关）。⇒ **B11 的解锁依赖"级联下沉"（`TaskGoal*` + `MermaidLintIssue` → core）或另立 recipe**，U2 的价值是**消名 + 收敛 R05-011 的 6 条长期例外**。
⇒ **U3 的 `tasks` 行**（U2 原写"解锁 B11"）**据此更正为"解锁：无直接解锁项；收益 = 消名 + R05-011 例外收敛"**。

✅ **执行状态：已完成（2026-10-01）** —— 7 份**全消名**：#1 → `TitleGenMessage` · #2 → `ProtocolMessage`（`64dd5a077`，4 文件 7 处）· #3 → `ToolUseMessage` · #5 → `ContextEngineMessage` · #6 → `UIMessage` · #7 → `SubAgentMessage`；**#4 `chat/types/message.ts` 保留为规范来源**。
**验收（实测 `bun run lint:arch`）**：`[Message 模型] 0 个文件自定 Message 类型（规范来源: chat/types/message.ts）` ⇒ **R05-011 归零**。

#### U2 执行：消费者面清点与顺序（2026-10-01）

以**一次 grep**（`from '…(TitleGenerator|ToolUseBlock|ContextEngine|SubAgentCommunicator|components/Messages)'`）扫全 `app/src`，得各目标的**按路径消费者**：

| 序 | 目标 | 消费者面（按路径） | 备注 |
|---|---|---|---|
| **1** | `subagent/SubAgentCommunicator.ts`（#7） | **2 个**：`subagent/communication/MessageBus.ts:4` · `MailboxSystem.ts:4`（均**显式** `import { Message }`） | ✅ **最小、面最清** ⇒ **建议首个执行** |
| **2** | `compaction/ContextEngine.ts`（#5） | **3 个**：`compaction/strategies/{AutoCompact,ContextCollapse,ReactiveCompact}Strategy.ts`（经 `'../ContextEngine'`） | ⚠️ 需核这 3 处是否**导入了 `Message`**（它们导入了其他符号也可能） |
| 3 | `agent/TitleGenerator.ts`（#1） | 路径 grep **零命中** | ⚠️ **前置**：核 `agent/index.ts` 是否 `export *`/转出 `./TitleGenerator` ⇒ 若有，`Message` 会经 barrel 逃逸（外部按名导入 ⇒ 路径 grep 不可见） |
| 4 | `chat/types/ToolUseBlock.ts`（#3） | 该文件另导出 `ToolUseBlock`（`chat/index.ts:99` + `tools/orchestration/*` ×3） | ⚠️ 同上，需核 `Message` 是否经 `chat/types/index.ts`（`export *`）逃逸 |
| 5 | `ui/components/Messages.tsx`（#6） | 路径 grep 零命中（组件多经 barrel/`index`） | ⚠️ 同上 |

**⚠️ 关键教训（第 4 类风险，已三次踩中同类）**：**"按路径 grep" 可能漏掉经 barrel 转出的消费者** ⇒ 对 #1/#3/#6 **必须先核 barrel**（`export *` / `export { Message }`）再改名；#5 需核 3 个 strategy 是否真导入 `Message`。

**⇒ `ProtocolMessage`（#2 `core/types.ts`）单独立项**：它是**协议层消息契约**，被 providers 广泛使用（且 `R05-011` 已列 knownException），**不与本批 5 份混做** ⇒ 需单独：① 全量消费者普查；② 评估改名 vs 保留例外；③ 与 `ai` 协议适配层一并考虑。

⏳ **执行状态**：**待执行**（本步完成面清点与顺序；无代码改动）。

#### 🔎 #1/#3/#6 的 barrel 核验结果（2026-10-01）

| # | 文件 | Barrel 逃逸？ | 证据 |
|---|---|---|---|
| **#3** `chat/types/ToolUseBlock.ts` | ✅ **不逃逸** | `chat/types/index.ts` **未转出** `./ToolUseBlock`（其 grep 仅命中 `./message` 的 `Message` 与 `MessageRole/Type/Status/Priority`）⇒ 消费方一律走 `@modules/chat/types/ToolUseBlock` **直接子路径**（`chat/index.ts:99` · `tools/orchestration/*` ×3 均如此）⇒ **前景最安全** |
| **#1** `agent/TitleGenerator.ts` | ⚠️ **逃逸** | `agent/index.ts:252` = **`export * from './TitleGenerator.js';`** ⇒ `Message` 随星号转出 ⇒ 外部可 `import { Message } from '@modules/agent'` ⇒ **按路径 grep 不可见** ⇒ 改名**前置**：按 `@modules/agent` 扫 `Message` 引用 |
| **#6** `ui/components/Messages.tsx` | ⚠️ **逃逸** | `ui/components/index.ts:39` = **`export type { Message, MessagesProps } from './Messages';`**（**显式**再导出）⇒ 外部可 `import type { Message } from '@modules/ui/components'` ⇒ 改名**前置**：按该桶扫 `Message` 引用 |

**⇒ 顺序修订**：**#3 先做**（无 barrel 逃逸、零已知消费者 ⇒ 预计 1 处定义 + 可能 0 消费者）；**#1/#6 需先按桶名扫消费者**（各 1 次 grep）后再定范围。

#### ✅ 进度（U2 执行）

- ✅ **#7** `subagent/SubAgentCommunicator.ts` → `SubAgentMessage`（`f440c535a`；3 文件）
- ✅ **#5** `compaction/ContextEngine.ts` → `ContextEngineMessage`（`11ef62824`；4 文件；收敛 R05-011 例外 1 条）
- ✅ **#3** → `ToolUseMessage` · ✅ **#1** → `TitleGenMessage` · ✅ **#6** → `UIMessage` · ✅ **#2** → `ProtocolMessage`（`64dd5a077`）⇒ **本清单全部收口**（#4 `chat/types/message.ts` 保留为规范来源）

#### 📌 #2 `core/types.ts` → `ProtocolMessage` 立项单（2026-10-01 普查完成）

**提案**：`core/types.ts:33` 的 `Message`（协议层形状：`role: 'system'|'user'|'assistant'|'tool'` + **snake_case** `tool_calls` / `tool_call_id`）→ 改名 **`ProtocolMessage`**。

**全量消费者普查（3 处，无遗漏）**：

| # | 位置 | 形态 |
|---|---|---|
| 1 | `core/index.ts:43` | barrel 转出 `export type { Message, ToolCall, ToolResult, ToolContext } from './types';` |
| 2 | `tools/types/Tool.ts:9` | `import type { Message } from '@modules/core';` |
| 3 | `memory/integrations/MemoryIntegration.ts:3` | `import type { Message } from '@modules/core';` |

**普查口径**：multiline 命名导入 grep 覆盖 `@modules/core` · `@modules/core/types` · `@modules/core/index` · `./types` · `../types` 五种路径 ⇒ 除上表外**零命中**；`core/types.ts` 文件内 `Message` 仅 2 处（定义 L33 + 内部 `newMessages?: Message[]` L51）。

**裁决**：面小（**5 处编辑**：定义 1 + 文件内 1 + barrel 1 + 消费者 2），**不属"需保留例外"** ⇒ 建议执行改名。
**R05-013 无冲突**：`core/types.ts` 不在 `src/types/**` 类型中心内。

✅ **执行状态**：**已完成**（`64dd5a077`，4 文件 7 处）—— U2 全部收口。

### 9.12 U5 剩余簇取证与裁定（2026-10-01）

#### ① `Context`（2 份）

| 落点 | 形状 | 裁定 |
|---|---|---|
| `context/types/Context.ts:10` | 会话运行时上下文（`type:'session'` + sessionId/userId/agentName/channelType） | **保留 `Context`**（规范落点，同 `SessionContext` 簇结论） |
| `docs/HelpSystem.ts:46` | 帮助系统文档上下文（用于 `getContextHelp(Partial<Context>)`） | → 改名 **`HelpContext`**（文件内 4 处：L46 定义 + L1027/1048/1072） |

⚠️ 前置：需先扫 `HelpContext`/`Context` 的**外部消费者**（`docs/**` 之外是否有人 import 之）。

#### ② `CheckpointStorage`（2 份，同名不同物）

| 落点 | 语义 | 消费者 |
|---|---|---|
| `session/types/checkpoint.ts:35`（2026-10-01 B11 本体迁入） | **会话检查点**存储 | `chat/services/SessionCheckpointService.ts`（4 处）· `chat/services/CheckpointDatabase.ts`（implements）· **`query/FileCheckpointStorage.ts`（implements）** |
| `query/types.ts:81` | **TAOR** 检查点存储 | `query/FileTAORCheckpointStorage` · `query/DBTAORCheckpointStorage` · `query/ResumeManager` · `query/TAORLoop`（含 `MemoryCheckpointStorage`）|

**裁定**：chat 侧**保留** `CheckpointStorage`（跨模块被 query 消费 ⇒ 更"规范"）；query 侧 → 改名 **`TAORCheckpointStorage`**（与既有 `TAORCheckpoint` 同族，语义准确）。
⚠️ **必须先行核验**：`query/FileCheckpointStorage.ts:14` 的 `CheckpointStorage` **导入源**（chat 还是 `./types.js`）—— 决定它是"实现 chat 接口"还是"实现 query 接口"，进而决定改名波及面。

#### ③ `PermissionMode`（2 份）

| 落点 | 形状 | 裁定 |
|---|---|---|
| `tools/types/PermissionContext.ts:9` | 本地 `type PermissionMode = 'default' \| 'auto' \| 'strict' \| 'bypass'` | 待核**值域是否同源** → 同源则改**再导出**（并解决 `@modules/permission/...` 子路径的 R03-002 口径）；不同源则改名 **`ToolPermissionMode`** |
| `permission/PermissionMode.ts` | 权限域事实源 | **保留** |

**文件内消费**：`mode: PermissionMode`（L42）· `prePlanMode?`（L92）。

⏳ **执行状态**：见 §9.13（U6 收口）。

---

### 9.13 ✅ U6 收口：台账回填与专项结论（2026-10-01）

**回填范围（两张台账）**

| 台账 | 回填项 | 结果 |
|---|---|---|
| 本文件（data-contract-unification） | §9.3 任务表 U2–U6 · §9.6 U4 · §9.7 U3 · §9.8 U5 主簇（含 `PermissionMode` 附注）· §9.9 U5 `SessionContext` 簇 · §9.10 U5 `Message` 簇 · §9.12 U5 剩余三簇 | 全部标记 ✅ 已完成（逐条带**实测落点**） |
| `layer-inversion-service-app-app-ui.md` | B12（`session -> ai` ×2 清零）· B13（`session -> query` ×2 清零）· B14/B14b（`session -> context` 清零） | 全部标记 ✅ 已落地 |

**专项成果（可复核）**

- **重名处置**：U1 普查出跨模块同名 **453** 个；本专项处置 **7 个簇** —— `Message`(7→1) · `SessionContext`(3→1) · `Context`(2→1) · `Tool`(2→1，另删死文件 `tools/legacy_types.ts`) · `CheckpointStorage`(2→1) · `PermissionMode`(2→1) · `parseContextLimitFromError`(2→1)；`Command` 按"**不合并**"处置（D-220 去假依赖）。
- **门禁验收（提交 `45bf96ed8` 实测）**：`[Message 模型] 0 个文件自定 Message 类型` ⇒ **R05-011 归零** · `[类型中心冲突] 0` · `[R02-003 Session 模型] 0` · `违规 0` · `已豁免 42`（本会话 **151 → 42**）· `typecheck 0`。
- **⚠️ 未纳入处置（如实记录，不粉饰）**：`Command` 同名**实测 4 处定义** —— `types/index.ts:36` · `commands/types/index.ts:39`（即 §9.1 所列 2 份）＋ **`commands/types/index.ts:405`（嵌套声明）** ＋ **`lsp/types.ts:243`（LSP 协议 `Command`，外部规范绑定）**。后两者 §9.1 **未列**、**不在本专项范围**；LSP 那份属"协议适配白名单"性质（**不得改名**）。
- **遗留（转下批，不在本专项内）**：① **B11** 前置取证 = 级联下沉 `TaskGoalStatus` / `TaskGoalUpdateReason` / `GoalTemplateKind`（app→core）+ `MermaidLintIssue`（infra→core）；② **E 组 `tools` 余 3 条** 仍受阻于 `Tool` 双份 + Windows 大小写不敏感；③ 门禁 **R02-002 检测面远窄于实况**（453 个跨模块同名 vs 1 条违规）—— §9.4 已记口径，**扩检测面尚未实施**。
