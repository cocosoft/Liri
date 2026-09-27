# 状态块 `statusType` 契约统一（CS02 根因修复 · Tier 2）

> 状态：**待评审**（本 spec 先于实现创建；**尚未动任何代码**）
> 创建：2026-09-27 | 触发：第 11 批 CS02 根因修复的 Tier 2（[预存错误与待处理问题.md](../../dev_docs/error_repairs/预存错误与待处理问题.md) 第 11 批）
> 关联规则：**GR15**（Spec-Driven）/ **GR16-002**（跨模块变更必须建 Spec）/ **GR01**（基础设施复用）/ **CS01**（归一化）/ **CS02**（状态判据禁字符串匹配）/ **CS03**（回退最小化）/ **CS05**（根因优先）/ **CS06**（证据驱动）/ **R02**（数据模型统一）/ `project_rules` §1.3（无正式用户 ⇒ 无向后兼容负担）/ §1.6（模型可见 ⇔ 已落盘）

---

## §0 修订记录

| 版本 | 变更 | 依据 |
|---|---|---|
| v1（初稿） | 记「6 处缺标记」 | 首轮 grep |
| **v2** | **更正为「8 处缺标记，其中 5 处属瞬态类」**；并把"完备性验收"从"所有 status chunk 均带标记"收窄为"**瞬态类判据 100% 来自结构化标记**" | 穷尽复扫 `type: 'status'` 全量发射点后逐点核对（见 §1.3）；**v1 的两处错误已纠正**：① `chat-handlers.ts:428-429` 实际**已带** `__pyapp_status_type: 'ai_thinking'`（v1 误列为缺标记）；② v1 遗漏 `reactEventsToChunks.ts:73/107` 与 `streamMessageFlow.ts:1825` |
| **v3（实施中更正）** | **§1.6「别名已具备」的结论有误**：`@shared/*` 仅在 **tsconfig** 中映射（服务类型检查）；`client/vite.config.ts` 的 `resolve.alias` **原本只有 `@`**，**无 `@shared`**。既有先例（`voiceService.ts:5`）是 `import type` ⇒ **被擦除、不需运行时解析**；本项引入**值导入**（`isTransientStatusType`）后，dev / build / vitest **三处均解析失败**（实测：18 个测试文件加载失败、用例数 476→313）。**已补** `"@shared": path.resolve(__dirname, "../shared")` | 实施时实测（CS06：以运行时证据覆盖静态推断） |

> **实施状态**：步骤 1-4 + 步骤 6 单测已落地（见 §9）；步骤 3 的**其余生产者字面量替换**与**真机复验**待完成（如实记录，未粉饰）。

---

## §1 现象与证据

### 1.1 问题一：判据双端重复实现，且字符串回退仍被需要（CS01 + CS02）

「是否属于内部过渡状态（协议过程消息，非用户可见 ⇒ 丢弃）」这一判据在**前后端各有一份，逐字重复**：

| 端 | 位置 | 结构化集合 | 字符串回退（13 条模式） |
|---|---|---|---|
| client | `client/src/stores/chat/chat-toolcall.slice.ts:50-76` | `ai_thinking` / `tool_started` / `tool_completed` | `🔧…Running tool`、`✅ Tool`/`❌ Tool`、`AI is thinking/analyzing/preparing/waiting`、`🔍 AI is analyzing the image`、`🎨 AI is generating` |
| app | `app/src/session/storage/EventMessageDeriver.ts:245-269` | 同上（逐字） | 同上（逐字） |

消费点 5 处：client `StatusBlock.tsx:22`、`chat-toolcall.slice.ts:179`（`addStatus`）、`deriveConversationBlocks.ts:578/581`；app `EventMessageDeriver.ts:288/290`。

### 1.2 问题二：结构化通路**取值不匹配**，实际靠字符串回退兜住

`CoreAPIImpl.ts:800-808` 为 `🔧 Running tool` 发的是 **`statusType: 'tool_running'`**，而双端白名单只认 **`'tool_started'`** ⇒ **取值不匹配**，结构化通路对这项**从未生效**；真正在过滤它的是字符串回退 `content.includes('🔧') && content.includes('Running tool')`。

> CS02 的典型病理：**标记存在但两端取值口径不一致 ⇒ 判据静默退回文案匹配**，文案一变即失效。
> 附带取证：`'tool_started'` **全仓无任何生产者**（仅存在于白名单）——即白名单里有一个**死值**，而真正在用的 `'tool_running'` 不在白名单。

### 1.3 问题三：`type:'status'` 发射点的 `statusType` 覆盖情况（**穷尽复扫，逐点核对**）

app 侧 `type: 'status'` 共 **20 处**（`grep 'type: .status.' app/src`，排除 `tests/`）；**8 处缺 `statusType`**：

| # | 位置 | content | 缺标记 | **现状是否被丢弃**（字符串回退） | 归类 |
|:--:|---|---|:---:|:---:|---|
| 1 | `CoreAPIImpl.ts:636-640` | `AI is analyzing your request...` | ❌ | **丢弃** | **瞬态** ⇒ **必须补** |
| 2 | `CoreAPIImpl.ts:699-703` | `AI is preparing context...` | ❌ | **丢弃** | **瞬态** ⇒ **必须补** |
| 3 | `CoreAPIImpl.ts:811-815` | `🎨 AI is generating an image...` | ❌ | **丢弃** | **瞬态** ⇒ **必须补** |
| 4 | `CoreAPIImpl.ts:816-821` | `🔍 AI is analyzing the image...` | ❌ | **丢弃** | **瞬态** ⇒ **必须补** |
| 5 | `CoreAPIImpl.ts:1034-1038` | `AI is waiting for response...` | ❌ | **丢弃** | **瞬态** ⇒ **必须补** |
| 6 | `reactEventsToChunks.ts:70-77` | `执行 N 个工具调用` | ❌ | 渲染（不匹配任何模式） | 可见 ⇒ **本次不动**（见 D8） |
| 7 | `reactEventsToChunks.ts:105-111` | `工具执行中 N%` | ❌ | 渲染（BUG-10 明确要求透传） | 可见 ⇒ **本次不动**（见 D8） |
| 8 | `streamMessageFlow.ts:1824-1829` | `模型思考过长被输出上限截断…` | ❌ | 渲染 | 可见 ⇒ **本次不动**（见 D8） |

**其余 12 处均已带 `statusType`**：`reactEventsToChunks` 28(`ai_thinking`)/145(`tool_retry`)/177(`truncated`)；`streamMessageFlow` 353/387/634/691/712/725/974/1248/2612(`compaction`)、1787/1876(`retry`)；`ChatManager` 5308(`task_all_done`)/5338(`resume`)；`CoreAPIImpl` 801(`tool_running`)/852(`tool_completed`|`tool_failed`)；`chat-handlers` 428-429（SSE 桥接，`ai_thinking`）。

**另 2 类经核对后排除（非本契约域，取证见 §5）**：`AgentTool/agentDisplay.ts:47`（TUI 文本分段，非 `ChatStreamChunk`）、`acp/event-mapper.ts:27`（ACP 协议映射，payload 形状不同）。

**读侧派生块（非 chunk，共 4 处，无文案匹配依赖）**：`EventMessageDeriver.ts:407/415/425/433` 的工作流 run 块（`工作流「x」开始` 等）——不匹配任何字符串模式 ⇒ **无 CS02 风险 ⇒ 本次不动**（D8）。

> **实现顺序红线**：§1.3 的 1-5 号**必须先补标记**，再删字符串回退；否则这 5 条内部消息会**立即泄漏到 UI**（真实回归）。

### 1.4 现状全量 `statusType` 值表（每个值均已取证）

| 值 | 生产者 | 当前是否被丢弃 | 目标归类 |
|---|---|:---:|---|
| `ai_thinking` | `reactEventsToChunks.ts:31`（`思考中`）、`chat-handlers.ts:429`（SSE 桥接） | 结构化 ✅ | 瞬态 |
| `tool_running` | `CoreAPIImpl.ts:807`（`🔧 Running tool: <name>`） | **仅字符串**（取值不匹配） | 瞬态 |
| `tool_completed` | `CoreAPIImpl.ts:859` | 结构化 ✅ | 瞬态 |
| `tool_failed` | `CoreAPIImpl.ts:859`（`❌ Tool … failed`） | **仅字符串** | 瞬态 |
| `tool_started` | **无生产者（死值）** | 结构化（从未命中） | 瞬态（保留以覆盖历史值） |
| `tool_retry` | `reactEventsToChunks.ts:148` | 渲染 | 可见 |
| `truncated` | `reactEventsToChunks.ts:180` | 渲染（A3 明确要求可见） | 可见 |
| `compaction` | `streamMessageFlow.ts` ×9 | 渲染 | 可见 |
| `retry` | `streamMessageFlow.ts:1778/1788/1868/1877` | 渲染 | 可见 |
| `task_all_done` | `ChatManager.ts:5309` | 渲染 | 可见 |
| `resume` | `ChatManager.ts:5339` | 渲染 | 可见 |
| `watermark` / `reconnect` / `error` | client `EventBasedStreamAggregator.ts:339/322/493`（**前端自制**） | 渲染 | 可见 |

### 1.5 wire 与类型声明现状（保持不动）

- wire 字段：`__pyapp_status_type`（producer `chat-handlers.ts:617-618`、`:1025`；consumer `chatService.ts:221-222`、`:891`）
- 类型声明各写一份（均带 `| string` 兜底）：app `CoreAPI.ts:178`、`eventPayloads.ts:514`；client `events.ts:233`、`chatService.ts:171`、`deriveConversationBlocks.ts:572`

### 1.6 归一化落点已具备（GR01，无需新造）

`shared/` 已是**双端共用**契约目录，且其自身声明了治理规则：

- 别名：`app/tsconfig.json:156` `@shared/*`；`client/tsconfig.json:21` `@shared/*`
- 先例：`client/src/services/voiceService.ts:5`、app `services/voice/models/types.ts:132`
- `shared/types/index.ts:1-11` 自述：**「单一事实来源」+「禁止在 local types 中重复定义已有共享类型」**

⇒ 本项正落在这条既有规则上，不新增基础设施（GR01）。

---

## §2 契约设计

### 2.1 落点（D1）

新增 `shared/types/status-types.ts`，由 `shared/types/index.ts` 转出（与 `voice-types.ts` 同构，遵守该文件的 review/一致性治理）。

### 2.2 值表与分类（D2 / D3）

```ts
// shared/types/status-types.ts
/** 状态块 statusType 的规范值（前后端唯一事实来源） */
export const STATUS_TYPE = {
  // —— 内部过渡：协议过程消息，非用户可见 ⇒ 前端丢弃
  AI_THINKING: "ai_thinking",
  TOOL_RUNNING: "tool_running",
  TOOL_STARTED: "tool_started",
  TOOL_COMPLETED: "tool_completed",
  TOOL_FAILED: "tool_failed",
  // —— 用户可见：保留渲染
  COMPACTION: "compaction",
  WATERMARK: "watermark",
  TRUNCATED: "truncated",
  TOOL_RETRY: "tool_retry",
  RETRY: "retry",
  RECONNECT: "reconnect",
  TASK_ALL_DONE: "task_all_done",
  RESUME: "resume",
  ERROR: "error",
} as const;

export type SharedStatusType = (typeof STATUS_TYPE)[keyof typeof STATUS_TYPE];

/** 内部过渡集合（前端据此丢弃；**显式枚举，未知值默认可见**） */
export const TRANSIENT_STATUS_TYPES: ReadonlySet<string> = new Set([
  STATUS_TYPE.AI_THINKING,
  STATUS_TYPE.TOOL_RUNNING,
  STATUS_TYPE.TOOL_STARTED,
  STATUS_TYPE.TOOL_COMPLETED,
  STATUS_TYPE.TOOL_FAILED,
]);
```

**关键取舍：采用「显式瞬态集合 + 未知值默认可见」（fail-visible），不使用"可渲染白名单"。**
理由：① 与现状等价（现状亦为黑名单式丢弃）；② 新增值若漏分类 ⇒ **默认被用户看到**（可发现），而非被静默吞掉（不可发现）；③ CS03：不引入"以防万一"的额外兜底。

### 2.3 与现状的**行为等价性证明**（D3，逐条对齐 §1.4）

| 值 / 情形 | 旧行为（结构化 OR 字符串） | 新行为（仅结构化） | 等价 |
|---|---|---|:---:|
| `ai_thinking` | 丢弃 | 丢弃 | ✅ |
| `tool_running` | 丢弃（**仅字符串**） | 丢弃（结构化） | ✅ |
| `tool_completed` | 丢弃 | 丢弃 | ✅ |
| `tool_failed` | 丢弃（**仅字符串**） | 丢弃（结构化） | ✅ |
| `tool_started` | 丢弃（结构化；无生产者） | 丢弃 | ✅ |
| `tool_retry` / `truncated` / `compaction` / `retry` / `task_all_done` / `resume` / `watermark` / `reconnect` / `error` | 渲染 | 渲染 | ✅ |
| §1.3 的 1-5 号（补标记后） | 丢弃（**仅字符串**） | 丢弃（结构化） | ✅ |
| §1.3 的 6-8 号 / 读侧工作流块（**不动**） | 渲染 | 渲染（无标记 ⇒ 未知值 ⇒ 默认可见） | ✅ |

### 2.4 双端一致性（D5）

- 两端**只引用** `STATUS_TYPE` 常量与 `TRANSIENT_STATUS_TYPES`，**禁止**再写字面量（含白名单处）
- 判据实现收敛为一行：`TRANSIENT_STATUS_TYPES.has(statusType)`（两端**同一集合对象**）
- §1.5 的 5 处类型声明把 `| string` 放宽**保留**（D7），但注释指向 shared 契约

---

## §3 实施步骤

| 步 | 内容 | 落点 | 验收 |
|:--:|---|---|---|
| 1 | 新增 `shared/types/status-types.ts`；`shared/types/index.ts` 转出 | shared | 双端 `typecheck` **0** |
| 2 | **给 §1.3 的 1-5 号补 `statusType`**：4 处 AI 提示 → `AI_THINKING`；2 处图像工具提示 → `TOOL_RUNNING` | app `CoreAPIImpl.ts` ×5 | **逐点复扫**：§1.3 表 1-5 行均带标记 |
| 3 | 生产者改用常量（替换字面量） | `reactEventsToChunks` / `streamMessageFlow` / `CoreAPIImpl` / `ChatManager` / `chat-handlers` | `typecheck` 0；grep 字面量残留 **0**（shared 之外） |
| 4 | **删双端字符串回退**（13 条模式），判据 → `TRANSIENT_STATUS_TYPES.has(statusType)` | client `chat-toolcall.slice.ts`；app `EventMessageDeriver.ts` | 两端实现**同源**；`typecheck` 0 |
| 5 | 消费点对齐与注释澄清（`tool_started` 死值说明） | client `StatusBlock.tsx` / `deriveConversationBlocks.ts`；app `EventMessageDeriver.ts` | — |
| 6 | 回归测试 + 门禁 + 真机 | 见 §6 | 全绿 |

**顺序红线**：**步 2 严格先于步 4**（先补标记再删回退），否则 §1.3 的 1-5 号会泄漏到 UI。

---

## §4 决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 契约落 `shared/types/`（既有双端契约目录） | GR01：复用既有共享面；该目录自述"单一事实来源 + 禁 local 重复定义"，正是本项场景 |
| D2 | 只登记**既有值**，不新增语义值 | CS01：`tool_running` 已存在，仅取值口径与白名单不一致 ⇒ 归一取值，不造新词 |
| D3 | 瞬态集合 = 现状字符串回退的**等价集**（5 值） | 只有行为零变化，才能"删回退"而不产生回归；等价性见 §2.3 |
| D4 | §1.3 的 1-5 号归类：4 处 AI 过程提示 → `AI_THINKING`；2 处图像工具提示 → `TOOL_RUNNING` | 语义归类 + 复用既有值（D2） |
| D5 | 常量引用 + 集合判据（禁字面量） | CS02 可执行化：判据集中一处，取值不一致将在**编译期**暴露 |
| D6 | **不**改动 wire 字段名 `__pyapp_status_type` | 契约已存在；改 wire 属无收益风险（R02：不制造第二套契约） |
| D7 | 保留类型的 `\| string` 放宽 | wire 含历史/外部值，收紧会引入运行时未定义行为；未知值按 §2.2「默认可见」 |
| **D8** | **§1.3 的 6-8 号（`执行 N 个工具调用` / `工具执行中 N%` / 思考过长截断）与读侧 4 处工作流块：本次不动、不补标记** | ① 它们**不匹配任何字符串回退模式** ⇒ 现状既可见、也无文案依赖 ⇒ **无 CS02 风险**，不属本项根因；② 若强行补标记，`工具执行中 N%` 只能借 `tool_running` 语义 ⇒ 会被判为瞬态而**丢弃** ⇒ **反而造成行为回归**（BUG-10 明确要求透传展示）；③ PY_APP §2/§3：不做投机性扩展、外科手术式修改 |
| D9 | 验收口径收窄为「**瞬态类判据 100% 来自结构化标记**」，而非「所有 status chunk 均带标记」 | 与 D8 一致，避免为凑"0 例外"而引入上述回归风险 |

---

## §5 明确不做

| 不做 | 理由 |
|---|---|
| 改任何 `content` 文案 | 与本项无关；会连带触发导出/i18n 面（PY_APP §3 外科手术式修改） |
| 用字符串匹配判 `compaction`（如 `content.includes('正在压缩')`） | 正是本 spec 要消灭的 CS02 病理 |
| 给 §1.3 的 6-8 号补标记 | 见 **D8**（其中 #7 会因语义借用导致**行为回归**） |
| 给读侧工作流块（`EventMessageDeriver.ts:407/415/425/433`）补 `status` | 无文案依赖 ⇒ 无 CS02 风险；补标记会改持久化块的渲染分支 ⇒ 面扩大（D8） |
| 收紧类型为纯联合（去掉 `\| string`） | 见 D7 |
| 处理 `AgentTool/agentDisplay.ts:47`、`acp/event-mapper.ts:27` | **取证排除**：前者是 TUI 文本分段（`segments.push({type:'status', label, value, level})`），后者是 ACP 协议映射（payload 形状为 `{text,tag,used,size}`）——**均非 `ChatStreamChunk`**，不属本契约域 |
| 为 `status` 事件新增 session 事件类型 | 事件类型已是既有 `assistant/status` + `data.statusType`；且 status **不入模型请求** ⇒ 不触发 §1.6 红线（见 §7） |
| 统一 `info` 等历史值 | grep 无生产者证据 ⇒ 按 CS06 不臆测 |
| 前端 UI 呈现策略调整（如把 `tool_failed` 改为可见） | 属产品决策，不在根因修复范围 |

---

## §6 验证计划

### 6.1 单测（新增）

1. **契约一致性**：`TRANSIENT_STATUS_TYPES` 与 §2.3 逐值对齐（5 瞬态 / 9 可见），且**不含** `tool_retry`/`truncated` 等可见值。
2. **判据等价性（client）**：对 §2.3 全表逐值断言"是否丢弃"与旧字符串回退**结果一致**；并**反向锁定**：`❌ Tool … failed` 这类旧文案**即便 statusType 缺失也不再被丢弃**（证明判据已脱离文案）。
3. **补标记的 5 处（app）**：对 1-5 号 content 断言 `statusType` 已设置且属于瞬态集合（防回退）。
4. **不变性守卫**：§1.3 的 6-8 号 content ⇒ 断言**不被丢弃**（锁 D8 决策，防后人误加标记造成回归）。
5. **双端同源**：断言两端判据引用**同一** shared 集合（如 app/client 各自的 `isInternalTransitionStatus` 对该集合的成员判定一致）。

### 6.2 门禁

- app：`bun run typecheck` **0**；`eslint`（改动文件）**0**；`lint:arch` **0 错 0 警**；`bun test`
- client：`bun run typecheck` **0**；`eslint`（改动文件）**0**；`bun run test`（基线 **50 文件 / 476 用例**，新增用例后 ≥ 该值且**零回归**）
- **字面量残留扫描**：`ai_thinking|tool_running|tool_completed|tool_failed|tool_started` 等**仅允许**出现在 `shared/types/status-types.ts`（两端业务代码 0 命中）

### 6.3 真机（必做，涉及流式 UI）

触发一次长会话（含压缩 + 工具调用 + 图像工具），核对：① `🔧 Running tool` **不出现**为独立状态气泡（与现状一致）；② `✅/❌ Tool …` 不出现；③ 「正在压缩历史…」**出现**；④ `工具执行中 N%` **出现**（BUG-10 行为不变，锁 D8）；⑤ `truncated` 提示**出现**；⑥ console 无告警。

---

## §7 合规清单

| 规则 | 落实 |
|---|---|
| **GR15** Spec-Driven | ✅ 本 spec 先于实现创建；未动代码，待评审 |
| **GR16-002** 跨模块变更须建 Spec | ✅ 本项即跨端（app ↔ client）契约变更 |
| **GR01** 基础设施复用 | ✅ 复用既有 `shared/` + `@shared/*`（有先例）；**不新造**第三套判据 |
| **CS01** 归一化 | ✅ 双端各一份的判据收敛为 **shared 单一来源**；值表登记既有值，不新增语义 |
| **CS02** 判据非字符串 | ✅ 判据改为 `TRANSIENT_STATUS_TYPES.has(statusType)`；删净 **13 条**字符串模式；修复 `tool_running` 取值不匹配（并标注 `tool_started` 为死值） |
| **CS03** 回退最小化 | ✅ 字符串回退**被删除**；瞬态集合为显式枚举，不设"以防万一" |
| **CS05** 根因优先 | ✅ 根因＝"取值口径不一致 + 判据分散"；修法＝契约统一，非加兜底 |
| **CS06** 证据驱动 | ✅ 20 处发射点逐点核对；**v1 的两处误记已在本稿更正**（§0）；`info` 无证据故不做；`agentDisplay`/`acp` 经取证排除 |
| **R02** 数据模型统一 | ✅ `statusType` 取值表单源；wire 字段沿用 `__pyapp_status_type`（D6） |
| **R06-008** 分层 | ✅ `shared/` 为契约层，无反向依赖，符合既有方向 |
| `project_rules` §1.3 | ✅ 无正式用户 ⇒ 可**直接删**字符串回退（无需过渡期） |
| `project_rules` §1.6 模型可见 ⇔ 已落盘 | ✅ **不触发**：status 事件不入模型请求。反向收益：步 2 让 5 条 status 的 `statusType` **进入事件日志**，提升可重建性 |
| `project_rules` §1.8 日志 | ✅ 不新增 Logger，沿用既有 |

---

## §8 风险与回退

| 风险 | 处置 |
|---|---|
| 步 2/4 顺序颠倒 ⇒ 5 条内部消息泄漏 UI | §3 顺序红线；§6.1-3 单测锁定；§6.3 真机核对 ① |
| 后人给 §1.3 的 6-8 号补标记 ⇒ 误判为瞬态而丢失（尤其 #7 工具进度） | **D8 + §6.1-4 不变性守卫**（断言这三条不被丢弃） |
| 出现未知 `statusType` ⇒ 由"原丢弃"变"可见" | §2.2 fail-visible 为**有意**选择（可发现优于静默）；§6.3 真机核对覆盖 |
| `shared/` 改动影响双端构建 | 仅**新增**文件 + 转出，无既有类型改动；该目录已自述"须经两端 review" |
| 回滚 | 单 PR 可整体回退（无 DB 变更、无数据迁移、无 wire 变更） |

---

## §9 任务状态

| # | 任务 | 状态 |
|:--:|---|:---:|
| 1 | 新增 `shared/types/status-types.ts` + 转出 | ✅ 已完成（另**补** `client/vite.config.ts` 的 `@shared` 运行时别名 —— 见 §0 v3） |
| 2 | §1.3 的 1-5 号补 `statusType` | ✅ 已完成（`CoreAPIImpl` 5 处：4×`AI_THINKING` + 2×图像工具 `TOOL_RUNNING`） |
| 3 | 生产者改用常量（禁字面量） | 🟡 **部分**：`CoreAPIImpl` 已全部改常量并引入契约；**其余待替换**：`reactEventsToChunks`（3 处）、`streamMessageFlow`（compaction×9 / retry×2）、`ChatManager`（2 处）、`chat-handlers`（1 处） |
| 4 | 删双端字符串回退，判据收敛为 shared 集合 | ✅ 已完成（client `chat-toolcall.slice.ts`、app `EventMessageDeriver.ts` 均改为 `isTransientStatusType`，同一集合） |
| 5 | 消费点对齐与注释澄清 | ✅ 已完成（两端函数注释已重写并指向本 spec；`content` 形参保留、判据不再使用） |
| 6 | 单测 5 组 + 双端门禁 + 真机 | 🟡 **单测+门禁 ✅ / 真机 ⬜**：client 新增 `status-type-contract.test.ts` **10 例**（契约一致性 / 判据脱离文案 / D8 不变性守卫）；client **51 文件 486 用例全通过**；app `typecheck` 0 且 `tests/session tests/chat` **591 pass / 0 fail**；**真机（§6.3）未做** |
| 7 | 台账回写 | ✅ 已完成（第 11 批 Tier 2 段） |
