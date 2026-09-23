# 上下文契约（Context Contract）

> **来源**：`dev_docs/多Agent协作与长程任务-升级方案-20260922.md` §5 **B3-1**（2026-09-23）
> **对标依据**：`REF/BA_REF/codex-main/codex-rs/AGENTS.md`「Model visible context」6 条 + 「Change size guidance」
> **状态**：生效中（B3-1 落文档；B3-2 已完成试点迁移，其余落点见 §5 待迁移清单）

---

## 1. 目的

模型上下文（发给推理请求的消息序列）是本项目**唯一无法事后补写**的输入面：一旦某段文字进了请求，
"模型当时看到了什么"就只能靠**事前落盘**回答（`project_rules.md §1.6`「模型可见 ⇔ 已落盘」红线）。

本契约把"往上下文里注入内容"这件事的**硬约束**固定下来，供：

- **编码时**自查（写注入点之前逐条比对）；
- **评审时**逐条判（每条都有判定标准与违反示例）；
- **排障时**归因（"上下文为何膨胀 / 为何被改写 / 为何截断"有唯一答案）。

> 与 `project_rules.md §1.6` 的关系：§1.6 管**可见性**（注入必须落事件）；本契约管**形态**（注入怎么构建）。
> 两者同时成立，缺一即为违规。

---

## 2. 六条硬约束

### CC-01 增量构建（MUST）

**判定标准**：上下文只能**追加**或**替换等价区间**地演进。任何"重排历史 / 丢弃中间轮 / 重新生成既有消息文本"
的路径，必须落在**有记录的压缩**（`CompactionOrchestrator`，落 `context/compaction` 事件）或**发送前截断**
（`truncateApiMessages`，仅作最后兜底）之内，且该动作本身可见。

**违反示例**：

```typescript
// ❌ 每轮都把历史整段重写一遍（等价于"改写历史"，且外部不可观测）
messages = rebuildAllFromScratch(session);
```

**自查问句**：我这次改动是**新增了一段输入**，还是**动过了既有输入**？动过的话，动的是哪条记录、哪条事件？

---

### CC-02 不改写历史（MUST）

**判定标准**：已有消息的 `content` / `role` / 工具配对关系不得被"就地覆写"以适配当前请求。
需要收窄时，用**新增一条摘要消息**（压缩）或**从发送副本中裁掉**（截断），而不是改写原消息。

**违反示例**：

```typescript
// ❌ 为了让当轮请求更小，把历史里的长工具结果原地改短
for (const m of session.messages) if (isLong(m)) m.content = m.content.slice(0, 200);
```

**曾发生的真实缺陷（2026-09-22 已修）**：投影时用"短桩"覆盖正文（`pickMoreCompleteContent` 修复）——
即 CC-02 + CC-03 同时被违反。历史教训见方案 §5 B3-1「与今日工作的衔接」。

**自查问句**：这条历史消息的原文，是否还能从 `messages.jsonl` / `events.jsonl` 逐字还原？

---

### CC-03 有界（MUST）

**判定标准**：任何注入项都有**硬上限**——工具结果、检索片段、文件附件、注入指令均须有
"字符/条数/总 token"三选一（或多项）的**显式上限与截断策略**，且截断本身可见（不是静默变短）。

**违反示例**：

```typescript
// ❌ 把整份文件/整段工具输出直接拼进上下文，无上限
apiMessages.push({ role: 'tool', content: fullFileContent });
```

**自查问句**：如果这个工具**始终**返回 10MB 文本，我的上下文会长到什么规模？上限写在哪一行？

---

### CC-04 单项 ≤ 10K tokens（MUST）

**判定标准**：**单条**注入片段（一条消息 / 一段注入指令 / 一条工具结果）不得超过 **10K tokens**。
超限即为违规，须拆分或摘要，不得"先发过去再说"。

**违规判定口径**：按 `estimateMessagesTokens([item])` 实测，不按字符数目测。

**违反示例**：Tier3 压缩摘要一次性产出 170K 源文本的单条摘要（历史根因，见
`CompactionOrchestrator.ts` 的 `FOLD_BATCH_SOURCE_TOKENS = 12_000` 注释）。

**自查问句**：这一条的实测 token 数是多少？超 10K 时我拆了吗？

---

### CC-05 >1K tokens 的单项须人工复核（MUST）

**判定标准**：新增/变更的注入项若单条 **>1K tokens**，该变更按 **P0** 处理：必须在方案或 PR 中
**显式列出**该项的（来源、上限、实测 token 数、为什么必须这么大），并由人复核后方可合入。
> 对标 codex AGENTS.md #5「Highlight new individual items that can cross >1k tokens as P0」。

**违反示例**：PR 描述只写"新增系统提示注入"，未给出 token 量级与上限。

**自查问句**：这条注入超过 1K tokens 吗？超了，我在哪里把它的量级和理由写给复核者看了？

---

### CC-06 注入片段须为结构化类型（MUST）

**判定标准**：禁止把裸字符串直接拼进 user/tool content（`` `[SYSTEM] ${x}` `` 这类调用方手写前缀）。
注入片段必须构造成统一类型 **`ContextualFragment`**
（`app/src/context/fragments/ContextualFragment.ts`），并经**唯一渲染入口** `renderFragment()` 产出最终文本。
前缀由类型按 `kind` 提供，**调用方不得硬编码**。

**违反示例**：

```typescript
// ❌ 前缀与正文在调用方拼装：前缀改了要全仓搜，且与落盘正文可能漂移
messages.push({ role: 'user', content: `[STEERING] ${text}` });

// ✅ 结构化片段 + 唯一渲染入口
import { createFragment, renderFragment } from '@modules/context/fragments/ContextualFragment';
messages.push({ role: 'user', content: renderFragment(createFragment({ kind: 'steering', text })) });
```

**例外（不属违规）**：整串常量文本（不含变量拼接）在**读取侧**的判别（如
`content.startsWith('[STEERING]')`）——读取侧归 CC-06 的**待迁移**问题（见 §5 #6/#12），
变更时一并处理，不在本条强制回溯。

**自查问句**：我写的这段拼接里，前缀是从哪来的？为什么不是我调的类型的 `kind` 决定的？

---

## 3. 与现有规则的关系

| 现有规则 | 本契约的强化点 |
|---|---|
| `project_rules.md §1.6`「模型可见 ⇔ 已落盘」 | §1.6 要求注入**落事件**；CC-01/CC-06 要求注入**可归因、形态统一**（否则事件里的 text 与实际注入可能漂移） |
| `coding-standards.md CS01` 归一化检查 | CC-06 是注入面的归一化：新增注入**先查** `ContextualFragment` 能否复用 |
| `coding-standards.md CS02` 状态检测禁止字符串匹配 | CC-06 例外条款明确：读取侧 `startsWith('[STEERING]')` 式判别是**待迁移**的字符串匹配（§5 #6/#12） |
| `coding-standards.md CS03` 回退策略最小化 | CC-03 的"截断"是**有界**的降级而非"以防万一"；CC-04/05 禁止用"反正会截断"掩盖超大注入 |
| `coding-standards.md CS04` Mock 数据零容忍 | 契约不引入任何"示例注入数据"；违反示例仅为反例说明 |
| `PY_APP.md §4` 目标驱动执行 | CC-05 把">1K tokens 单项"变成**可验收**的 P0 动作（列出量级 + 人工复核） |

---

## 4. 如何验收

| 项 | 方式 | 现状 |
|---|---|---|
| CC-06 类型与唯一渲染入口存在 | `renderFragment()` 是导出函数；`grep -rn "renderFragment(" app/src` 的调用点均为注入点 | ✅ 已落地（B3-2） |
| CC-06 试点迁移无文案变化 | 既有逐字断言（`tests/tasks/goal/goalEvents.test.ts`、`goalMainSessionWrapUp.test.ts`）全绿 | ✅ 已落地（B3-2） |
| 漏登记/形态回退可被编译期捕获 | `bun run typecheck`（新注入点若绕过类型，评审按 CC-06 判） | ✅ 命令可用 |
| 单项 token 上限 | 按 `estimateMessagesTokens([item])` 实测；>10K 判违规，>1K 按 P0 复核 | ⚠ 尚无自动化门禁（`lint:models` 同类的脚本化检查未落地，见 `model-usage.md` 同款说明） |
| compaction 失败不得静默 | `context/compaction{phase:'failed'}` 事件 + `CompactionOutcome.failure` 结构化归因（B3-3） | ✅ 已落地（B3-3） |

**验收命令**：
```powershell
cd app
bun run typecheck
bun test tests/tasks/goal tests/chat tests/http
```

---

## 5. 注入型提示落点清单（B3-2 实测 grep，2026-09-23）

> 口径：`grep -rn "\[SYSTEM\]|\[STEERING\]|\[工具完整性\]|\[toolIntegrity\]" app/src`。
> **未找到** `[工具完整性]` / `[toolIntegrity]` 任何落点（该前缀在本仓不存在）。

### 5.1 本批已迁移（B3-2 试点，4 处）

| # | 位置 | 迁移前形态 | 迁移后 |
|---|---|---|---|
| 1 | `app/src/tasks/goal/GoalEvents.ts:184-208`（`takeBatchGoalInstruction`） | 返回 `{templateKind, text}`；前缀由 `AgentTool:2530` 手写 `[SYSTEM] ` | 返回 `{templateKind, text, fragment}`（`kind:'goal_instruction'`，`source:'goal'`，`goalId`） |
| 2 | `app/src/tasks/goal/GoalEvents.ts:220-244`（`takeIdleContinuationInstruction`） | 返回正文 `string`（无前缀，user_message 通道） | 经 `createFragment({kind:'goal_continuation'})` → `renderFragment()` 产出（**逐字不变**） |
| 3 | `app/src/tasks/goal/GoalEvents.ts:260-277`（`takeMainSessionBudgetWrapUp`） | 返回正文 `string`（无前缀，交给 steering 通道） | 同上（`kind:'goal_continuation'`） |
| 4 | `app/src/chat/ReActToolLoop.ts:2079-2085`（`onSteering`） | `` content: `[STEERING] ${sm}` `` | `renderFragment(createFragment({kind:'steering', text: sm}))`（**逐字不变**） |
| 5 | `app/src/tools/AgentTool/AgentTool.ts:2529-2531` | `` `${aggregatedOutput}\n\n[SYSTEM] ${goalInstruction}` `` | 改为渲染 #1 返回的 `fragment`（**逐字不变**） |

### 5.2 待迁移清单（**本批不迁移**，含风险）

| # | file:line | 当前形态 | 风险 |
|---|---|---|---|
| 1 | `app/src/chat/ReActToolLoop.ts:2065-2068` | 裸字符串拼接 `` content: `[SYSTEM] ${instruction}` ``（重试指令） | 中：与前缀协议强耦合；迁移收益明确（同类 `system` 片段） |
| 2 | `app/src/chat/ReActToolLoop.ts:1942` | 字面量拼接 `'[SYSTEM] 工具轮次已用尽…\n' + …` | 低：整串常量 + 变量拼在一处，改动需同时看上下文 |
| 3 | `app/src/chat/ReActToolLoop.ts:2247` | 模板串 `` `[SYSTEM] 你刚刚重复调用了…（${names}…）。` + `` | 低：同上 |
| 4 | `app/src/chat/ReActToolLoop.ts:685` | 字面量 `'[SYSTEM] 请以最新一条用户消息为准重新规划当前任务；…'` | 低 |
| 5 | `app/src/chat/ReActToolLoop.ts:642` | **读取侧**：`content.startsWith('[STEERING]') \|\| content.startsWith('[SYSTEM]')` | **高（CS02）**：按协议前缀做字符串匹配来判别"注入指令残留"；若前缀口径变化即静默失效 ⇒ 应改为结构化标记（如 `metadata.fragmentKind`） |
| 6 | `app/src/query/TAORLoop.ts:1024` | 模板串 `` `[SYSTEM] ${renderGoalTemplate('tool_execution_errors', …)}` `` | 中：正文已模板化（B2-3），缺的是片段类型 |
| 7 | `app/src/query/TAORLoop.ts:1154` | 字面量 `'[SYSTEM] 自动验证未通过（编译/测试失败），请修复后重新执行。'` | 低 |
| 8 | `app/src/query/TAORLoop.ts:1319` | 裸字符串拼接 `` `[STEERING] ${sm}` ``（与 #4 同构，**非 chat 层**） | 中：与 `ReActToolLoop.onSteering` 重复实现同一前缀口径 ⇒ 双轨风险 |
| 9 | `app/src/query/TAORLoop.ts:1490` | 模板串 `` `[SYSTEM] ${…}` `` | 中 |
| 10 | `app/src/query/ErrorRecoveryManager.ts:182,184,186,188,190,192,195,198,200,338` | 10 条整串字面量 `'[SYSTEM] …'`（返回给调用方拼接） | 中：条数多，属"文案 + 前缀"混装，迁移时应同时抽模板 |
| 11 | `app/src/tools/KnowledgeSaveTool/KnowledgeSaveTool.ts:184` | **检测侧**：判别"内容疑似引用系统指令"时列举 `[SYSTEM]/[STEERING]/[FILE_OPERATION]` | 低-中：检测面依赖前缀字面量；前缀口径变化会静默放宽（建议改为按 `FragmentKind` 派生的前缀集合） |
| 12 | `app/src/chat/ReActToolLoop.ts:349,625-626` | 注释性描述（非代码路径） | 无（文档同步） |

**迁移建议顺序**：#5（读取侧结构化，CS02 优先）→ #1（同文件、同类型）→ #8/#6/#9/#10（query 层批量）
→ #11（检测面）。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-23 | 初版：6 条约束 + 落点清单（B3-1）；B3-2 试点迁移 4 处；B3-3 compaction 失败可见化 |
