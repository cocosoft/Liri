# Task 家族工具出参「字符串化」归一（立项）

> 立项时间：2026-09-29 · 来源：`dev_docs/error_repairs/预存错误与待处理问题.md` **D-10**（T6 批次 1b 取证时发现）
> 状态：**❌ 已废止（2026-09-29，superseded by 台账 D-15）** —— 本 spec 的实施对象（`TaskTool/` 的 4 个工具类）经 D-15 判定为**未注册、无生产消费者的死实现**并**已删除**，故本次改动随之消失、验收 V1–V7 仅具**历史价值**。保留本文件是为存证「为何曾判定它们可接线」。**如需清理，可按 GR15 直接删除本文件。**
> 原状态（历史）：已实施于 2026-09-29；V2/V3/V4/V5 已过，V1/V6 以"生产同款函数"补证（§11）。
> 性质：**工具输出形态变更 + 出参契约恢复**。改动触及「模型可见文本」与「前端渲染」两条既有路径 ⇒ 实施后须逐条过 §7 验收。
> 关联规则：**GR15**（Spec-Driven）/ **GR16-002**（跨模块变更必须建 Spec）/ **GR01**（基础设施复用）/ **GR02**（实现唯一性）/ **GR03**（证据驱动）/ **CS01**（归一化）/ **CS04**（零 Mock）/ **CS05**（根因优先）/ **CS06**（证据驱动）/ **R02**（数据模型统一）/ `project_rules` §1.3（无正式用户 ⇒ 无向后兼容负担）/ §1.6（Write-Ahead Persistence）
> 关联 spec：[`tool-output-schema-layer-audit.md`](./tool-output-schema-layer-audit.md)（T6 收口 —— 这 4 个 `*OutputSchema` 正因"出口是字符串"而被同批删除）

---

## 一、问题定义

Task 家族 6 个工具中，**4 个把出参对象 `JSON.stringify` 成字符串再当 `data`**，另 2 个（`task_stop` / `task_output`）返回**对象** ⇒ **同族内两种形态**。

后果有三（均已在 T6 期间取证）：

1. **结构化契约无法声明** —— 出口 `data` 是字符串，而 `*OutputSchema` 描述的是对象 ⇒ 接线必错 ⇒ T6 批次 1b 只能把这 4 个 schema **删除**（`tool-output-schema-layer-audit.md`「T6 收口结论」：21 接线 / 24 删除）。
2. **模型可见文本被多套一层转义** —— 见 §3 通道 A（框架对**字符串** `data` 会在模型侧再 `JSON.stringify` 一次）。
3. **同一条 `toolResult.result` 的双序列化分叉** —— 前端侧对字符串**原样透传**，模型侧**无条件再序列化**（§3 通道 A vs 通道 D）。

---

## 二、现状（4 处出口，逐项附 `文件:行`）

| 工具 | 出口（`data`） | 形态 | 同族对照 |
|---|---|---|---|
| `task_create` | [`TaskCreateTool.ts:221`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskTool/TaskCreateTool.ts#L214-L228) | `JSON.stringify({task:{id,subject}})` | ✗ 字符串 |
| `task_get` | [`TaskGetTool.ts:169`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskTool/TaskGetTool.ts#L155-L176) | `JSON.stringify(11 字段对象)` | ✗ 字符串 |
| `task_list` | [`TaskListTool.ts:117`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskTool/TaskListTool.ts#L105-L124) | `JSON.stringify({tasks:[…]})` | ✗ 字符串 |
| `task_update` | [`TaskUpdateTool.ts:248`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskTool/TaskUpdateTool.ts#L240-L255) | `JSON.stringify({task:{id,subject,status}})` | ✗ 字符串 |
| `task_stop` | `TaskStopTool.ts`（T6 已接线 `TaskStopOutputSchema`） | 对象 | ✅ 对象 |
| `task_output` | `TaskOutputTool.ts`（T6 已接线 `TaskOutputOutputSchema`） | 对象 | ✅ 对象 |

失败分支：4 者一律 `createToolResult(null, …)`（如 `TaskCreateTool.ts:233`）⇒ 命中 T4 的「**无载荷不校验**」⇒ 不受本变更影响。

---

## 三、关键证据：框架**已原生支持**对象出参（逐通道影响表）

### 3.1 框架侧（决定性）

[`ToolExecutor.ts:765-773`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolExecutor.ts#L757-L776) `processResult()`：

```ts
return {
  toolCallId: toolUseID,
  toolName: tool.name,
  result: result.data,                                    // ← 原样保留结构
  output: typeof result.data === 'string'
    ? result.data
    : JSON.stringify(result.data),                        // ← 对象自动序列化
  …
};
```

⇒ **返回对象不会让任何消费方"看不到内容"**，框架两个出口都能消化。

### 3.2 逐通道影响（改 `data` 为对象之后）

| # | 通道 | 证据 | 今天（`data` = JSON 字符串） | 改为对象后 | 判定 |
|---|---|---|---|---|---|
| **A** | **模型可见** | [`ChatManager.ts:5912-5914`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L5911-L5914) `const raw = pr.result.result ? JSON.stringify(pr.result.result) : pr.result.error \|\| '{}'` | `JSON.stringify("<json文本>")` ⇒ **带引号 + 反斜杠的转义文本**（`"{\"task\":{…}}"`） | `JSON.stringify({task:…})` ⇒ **干净 JSON** | ✅ **改善**（修掉一层转义） |
| **B** | 前端渲染 | [`toolResultText.ts:54-58`](file:///e:/PY/Documents/CODES/PY_APP/client/src/utils/toolResultText.ts#L49-L61) 对**非字符串** `value` 走 `JSON.stringify(it.value ?? "", null, 2)` | 字符串 → 迭代解码 → pretty-print | 对象 → the same `stringify(v,null,2)` | **渲染结果不变** |
| **C** | 落盘/持久化 | [`ToolResultPersister.ts:60-65`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/services/ToolResultPersister.ts#L59-L65) `if (typeof result.result === 'string')… else JSON.stringify(result.result)` | 字符串分支 | 对象分支 | **字符一致**（`project_rules` §1.6 不受影响） |
| **D** | 前端 tool_end 下发 | [`ReActToolLoop.ts:1722-1727`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L1715-L1729) `typeof toolResult.result === 'string' ? toolResult.result : safeStringify(…)` | 字符串**原样透传** | `safeStringify(对象)` | **结果不变**（同为 JSON 文本） |
| **E** | 子 Agent 汇总 | [`SubAgentEngine.ts:860-864`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/AgentTool/SubAgentEngine.ts#L860-L864) `JSON.stringify(output)` | 对字符串再序列化 ⇒ **多一层引号** | 干净 JSON | ✅ **改善** |
| **F** | 协调器 | [`Coordinator.ts:270`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/Coordinator.ts#L270) `result.output \|\| (result.result as string) \|\| ''` | 走 `output`（恒为字符串） | 同 | **不受影响** |

> **方法论说明（CS06）**：通道 A 的"转义"结论不是推测 —— 其链条为：`processResult.result = result.data`（§3.1）→ `ReActToolLoop.ts:1723` 的**既有注释**明确 `toolResult.result` 即"经 ToolExecutor 返回 `result.data`" → `ChatManager.ts:5912` 对该值**无条件** `JSON.stringify`。三段均有 `文件:行`。
> ⚠️ **未取运行期证据（如实）**：以上为静态链 + 既有注释，**未实跑一次 `task_create` 抓取真实 tool 消息文本**。实施时须补 §7-V1。

---

## 四、4 个被删 schema 的原文（已从 git 历史取回）与逐字段核对

来源：`git diff c40bc9bdb^ c40bc9bdb -- app/src/tools/TaskTool/schemas.ts`（T6 收口提交的删除侧）。

| schema | 原文（摘要） | 与**当前出口对象**核对 |
|---|---|---|
| `TaskCreateOutputSchema` | `z.object({task: z.object({id, subject})})` | ✅ 与 `TaskCreateTool.ts:214-219` **逐字段相符** |
| `TaskOutputSchema` | 11 字段：`id` / `subject` / `status`(5 值枚举) / `description?` / `activeForm?` / `priority?`(4 值枚举) / `blockedBy?` / `owner?` / `metadata?` / `createdAt?` / `updatedAt?` | ✅ 与 `TaskGetTool.ts:155-167` **逐字段相符** |
| `TaskListOutputSchema` | `z.object({tasks: z.array(z.object({id, subject, status, owner?, blockedBy}))})` | ✅ 与 `TaskListTool.ts:105-113` **逐字段相符**（`_internal` 过滤已在此前完成） |
| `TaskUpdateOutputSchema` | `z.object({task: z.object({id, subject, status})})` | ✅ 与 `TaskUpdateTool.ts:240-246` **逐字段相符** |

⇒ **schema 本来就是照着出口对象写的**，仅被 `JSON.stringify` 挡在门外 ⇒ 去掉字符串化后**可直接接线，无需重写契约**。

---

## 五、方案

### D1（核心决策）—— 统一为「返回对象」，`JSON.stringify` 下移到需要文本的消费侧

依据：**框架已在 `processResult` 承担序列化**（§3.1）⇒ 工具侧再做一次是**重复实现**（GR02 / CS01 反面），且是通道 A 转义的**根因**（CS05）。

**改动清单（4 文件 + 1 schema 文件）**

| # | 文件 | 改动 |
|:--:|---|---|
| 1 | `app/src/tools/TaskTool/TaskCreateTool.ts:221` | `createToolResult(JSON.stringify(output), …)` → `createToolResult(output, …)` |
| 2 | `app/src/tools/TaskTool/TaskGetTool.ts:169` | 同上 |
| 3 | `app/src/tools/TaskTool/TaskListTool.ts:117` | 同上 |
| 4 | `app/src/tools/TaskTool/TaskUpdateTool.ts:248` | 同上 |
| 5 | `app/src/tools/TaskTool/schemas.ts` | **恢复 4 个 `*OutputSchema`**（原文见 §4），并把现有 4 段"⚠️ 已于 2026-09-29 删除"注释改写为"D-10 恢复 + 为何恢复"的证据注释 |
| 6 | `TaskCreateTool.ts` / `TaskGetTool.ts` / `TaskListTool.ts` / `TaskUpdateTool.ts` | 各加 `outputSchema = TaskXxxOutputSchema`（对齐同族 `task_stop` / `task_output` 的写法） |

**不做**：不改 `output`/`newMessages` 文案、不改失败分支、不改 `TaskStorage`、不改前端。

### D2 —— 不改 `TaskOutputTool` / `TaskStopTool`

二者已是对象形态且 T6 已接线 ⇒ 本 spec 只做"补齐同族一致性"，不动它们。

---

## 六、风险与前置核验（**均已核清**）

| # | 风险点 | 核验结果 |
|:--:|---|---|
| 1 | `TrackedTool.markCompleted(tr.result)` 若要求字符串会被破坏 | ✅ [`TrackedTool.ts:172`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/TrackedTool.ts#L172-L176) 签名为 `markCompleted(result: unknown)` ⇒ **类型安全** |
| 2 | `LongRunningTaskOrchestrator.ts:2199` 的 `s.result as string` | ✅ `s` 是 **checkpoint 快照元素**（`PlanStep.result?: string`，[`TaskOrchestrator.ts:63`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/TaskOrchestrator.ts#L56-L74)），与工具出口 `data` **无关** ⇒ 不受影响 |
| 3 | 前端是否有按名硬解析这 4 个工具结果的代码 | ✅ 全 `client/src` grep `task_create` / `task_get` / `task_list` / `task_update` ⇒ **零命中**（命中的 `create_task_list` / `get_task_list` 是**另一个工具**，非本 4 个） |
| 4 | 前端两形态兼容 | ✅ `toolResultText.ts:54-58` 显式处理非字符串 ⇒ 兼容（§3.2 通道 B） |

### 顺带发现的**预存问题**（与本次改动无关，建议登记台账）

`processedResults` 的声明类型与实际值**不符**：`ChatManager._buildToolRoundMessages` 与 `ReActToolLoop.ts:1270-1273` 均声明 `result: ToolResult`，但实际塞入的是 **`ToolResultBlock`** 形状（证据：[`ReActToolLoop.ts:1340-1344`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L1334-L1345) 的 `{toolCallId, toolName, error}` 与 `processResult()` 的产出形状一致）⇒ 属**类型撒谎**，建议按 `CS`/`R02` 另立条目。

---

## 七、验收标准

| # | 项 | 判据 |
|:--:|---|---|
| V1 | **运行期证据（✅ 已取，但形式被迫调整 —— 见下方阻塞）** | 原计划真实模型触发；验收时发现 4 个工具**未注册**在运行时注册表（`GET /v1/tools` 60 个中无 `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`，活的同族工具是 `create_task_list`/`get_task_list`/`update_task_status`）⇒ **模型调不到**。改用**生产同款函数**驱动（真实 `TaskCreateTool.execute()` + 真实 `ToolExecutor.processResult()`，再套用生产那两行表达式）。**实测**：`model-visible(new) = {"task":{"id":"t-1","subject":"V1验证"}}`（含 `\"` = **false**）vs `old = "{\"task\":{\"id\":\"t-1\",\"subject\":\"V1验证\"}}"`（含 `\"` = **true**）⇒ **新旧不同**（转义层被消除）。 |
| V2 | 类型检查 | `bun run typecheck` ⇒ **0** |
| V3 | 相关测试 | `tests/tools` ⇒ **539 pass / 0 fail**（或不少于改动前基线） |
| V4 | 架构门禁 | `bun run lint:arch` ⇒ **0 错 1 警**（仅既有 R07-004）；且 `R15-001` 由 `定义 21 / 零消费者 0` 变为 **`定义 25 / 零消费者 0`**（+4，全部接线） |
| V5 | 契约真在生效 | 临时把 `TaskCreateOutputSchema` 的 `id` 改为 `z.number()` ⇒ 该校验应报 `metadata.outputSchemaError`（证明接线非摆设）；验毕还原 |
| V6 | 落盘一致（✅ 已取） | 同一探针：`persisted(new)` 与 `persisted(old)` **逐字符相等 = true**（同为 `{"task":{"id":"t-1","subject":"V1验证"}}`）⇒ 落盘文本与"去掉 stringify 之前"完全一致，符合 §3.2 通道 C 的预期 |
| V7 | 无 Mock / 无回退 | 改动不含 mock 数据、不含"以防万一"回退（CS04 / CS03） |

---

## 八、合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15** Spec-Driven | ✅ 本 spec **先于**实现创建；创建时未动代码 |
| **GR16-002** 跨模块变更须建 Spec | ✅ 触及 `tools/` → `chat/`（模型消息）→ `client/`（渲染）跨端路径 |
| **GR01** 基础设施复用 | ✅ **复用**框架既有序列化点（`ToolExecutor.processResult`）与既有契约位（`Tool.outputSchema`），**不新造**任何机制 |
| **GR02** 实现唯一性 | ✅ 本项**即**在消除"工具侧与框架侧重复序列化"这一双实现 |
| **GR03** 证据驱动 | ✅ §2/§3/§4/§6 每条结论附 `文件:行`；**未取运行期证据处已显式标注**（§3.2 注、V1） |
| **GR04** Mock 零容忍 | ✅ 不涉及数据产出；测试沿用既有夹具 |
| **CS01** 归一化 | ✅ 先查已有（框架已有序列化）⇒ 不新增；schema **恢复原文**而非重写 |
| **CS04** 零 Mock | ✅ 见上 |
| **CS05** 根因优先 | ✅ 根因（工具侧重复序列化导致模型侧转义）而非症状（删 schema） |
| **CS06** 证据驱动 | ✅ 见 GR03 |
| **R02** 数据模型统一 | ⚠️ 本 spec **顺带发现** `processedResults` 类型撒谎（§6 末），**本 spec 不修**，仅登记 |
| `project_rules` §1.6 Write-Ahead Persistence | ✅ 落盘文本经核**字符一致**（V6 复验） |
| `project_rules` §1.3 无向后兼容负担 | ✅ 无正式用户 ⇒ 直接改形态，不留兼容层 |

---

## 九、范围边界（明确不做）

1. **不改** `TaskOutputTool` / `TaskStopTool`（已是对象 + 已接线）。
2. **不改**其他"字符串化出参"工具（`ask_user_question` / `time` / `tungsten` / `powerShell` / `send_message` / `subscribe_pr` 等）—— 它们**各自形态不同**（多态、纯文本、`ToolFactory` 内联），须**逐项另判**，不得按本 spec 一并处理。
3. **不修** `processedResults` 的类型撒谎（§6 末）—— 另立项。
4. **不引入**入参侧校验机制（见台账 D-7「符号级残留」的用户裁定：保留不动）。

---

## 十、实施记录（2026-09-29）

**改动清单（6 文件，与 §5 逐项对应）**

| # | 文件 | 实际改动 |
|:--:|---|---|
| 1-4 | `TaskTool/{TaskCreateTool,TaskGetTool,TaskListTool,TaskUpdateTool}.ts` | ① 出口 `createToolResult(JSON.stringify(output), …)` → `createToolResult(output, …)`；② 新增 `readonly outputSchema = TaskXxxOutputSchema;`（附沿革注释）；③ 补 `./schemas` 具名导入 |
| 5 | `TaskTool/schemas.ts` | 恢复 4 个 `*OutputSchema`（**原文取自 git 历史**，见 §4），并把原「⚠️ 已于 2026-09-29 删除」注释改写为「沿革 + D-10 为何恢复」 |
| 6 | （同 1-4，字段即接线，无独立文件） | — |

**验收结果（实测）**

| # | 结论 | 证据 |
|:--:|---|---|
| V2 | ✅ | `bun run typecheck` → `TC_EXIT=0` |
| V3 | ✅ | `bun test tests/tools` → **539 pass / 0 fail**（2417 expect，60 files） |
| V4 | ✅ | `lint:arch` → **0 错 1 警**（仅既有 R07-004）；**R15-001 `定义 21 → 25 个，零消费者 0 个`**（+4 全部接线，与 §7-V4 预期一致）；R15-002 `候选 21 / 零 importer 0` |
| V5 | ✅（等价长期形式） | §7-V5 原写"临时把 `id` 改类型 ⇒ 应报 `metadata.outputSchemaError`，验毕还原"。改为**可持久化**的等价守卫：新增 `tests/tools/toolOutputSchema.test.ts` 第 7 例 —— 对 4 个**真实 schema** 成对断言「真实出口形态 ⇒ 通过」+「把首个必填字段改为 number ⇒ **必须报错**」（证明契约真在校验，而非摆设）。`7 pass / 0 fail`；`eslint` 0 |
| V1 | ✅（**形式调整**：真实模型触发被阻，改用生产同款函数） | 见 §11 —— 4 个工具**未注册**（模型调不到）⇒ 用真实 `execute()` + 真实 `ToolExecutor.processResult()` 取证：模型可见文本由**转义**变为**干净 JSON** |
| V6 | ✅ | 见 §11 —— `persisted(new)` 与 `persisted(old)` **逐字符一致 = true** |
| V7 | ✅ | 改动不含 mock 数据、不含回退（CS03/CS04）|

**过程中的一处自纠**：新增用例首版把 schema 元组标注为 `Array<[string, unknown, unknown]>` ⇒ `typecheck` 报 **2 处 TS2322**（`unknown` 不可赋给校验器期望的结构类型）；改为**从校验器实参派生** `NonNullable<Parameters<typeof validateToolOutputShape>[0]['outputSchema']>` 后归零（与"不用 `unknown` 绕过契约形态"一致）。

---

## 十一、V1 / V6 补做记录（2026-09-29，用户指令「补做 V1 和 V6 验收」）

**做了什么**：① 停掉运行中但**仍是旧代码**的 daemon（PID 33888，起于 9/28 19:29）→ 以新代码起单实例（`/health=ok`、`bun` 进程数 = 1）；② 建会话并发起**真实模型对话**（`deepseek-v4-flash`，要求模型依次调 `task_create` + `task_get`）。

**结果：真实模型触发被阻（新发现的预存问题，非本 spec 缺陷）**
- 该轮**未产出** `task_create`/`task_get` 调用：模型实际调了两次 `tool_search`（`select:task_create` / `select:task_get`），两次结果均为 `matches: []`。
- 直接查注册面：`GET /v1/tools` 返回 **60** 个工具，含 `task_stop` / `create_task_list` / `update_task_status` / `get_task_list` / `todo_write`，**不含** `TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate`，也**不含** `task_output`。
- 定位：真实实现是 [`tools/TaskOrchestratorTools/TaskOrchestratorTools.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts)（`name = 'create_task_list'` / `'update_task_status'` / `'get_task_list'`）；而本 spec 改的 4 个类用**PascalCase 名**（`TaskTool/constants.ts` 的 `TASK_CREATE_TOOL_NAME = 'TaskCreate'` 等），**未被注册**。
- ⇒ **V1 的"真实模型调用"路径不可达**；这不是 D-10 的回归，而是**先于本 spec 存在**的实现/注册不一致（与台账 **N-27**「`ToolFactory.getAllBaseTools()` 从未被 ToolManager 使用」同族）。**已按「发现即记录」登记为台账 D-15**。

**替代证据（用生产同款函数驱动，非自造表达式）**
一次性探针（跑完即删）：真实 `TaskCreateTool.execute()` → 真实 `ToolExecutor.processResult()`，再套用生产的两行表达式。

| 观测 | 值 |
|---|---|
| `typeof res.data` | **object** ⇒ 出口形态已从字符串变为对象 |
| `block.result`（`processResult` 的 `result` 字段） | **object** |
| `block.output` | `{"task":{"id":"t-1","subject":"V1验证"}}` |
| **V1** model-visible(new)（`ChatManager.ts:5912` 表达式） | `{"task":{"id":"t-1","subject":"V1验证"}}`，**含 `\"` = false** |
| **V1** model-visible(old)（同一表达式 + 旧出口） | `"{\"task\":{\"id\":\"t-1\",\"subject\":\"V1验证\"}}"`，**含 `\"` = true** |
| **V1** 新旧是否不同 | **true**（转义层被消除） |
| **V6** persisted(new) vs persisted(old)（`ToolResultPersister.extractResultText` 表达式） | 均为 `{"task":{"id":"t-1","subject":"V1验证"}}` ⇒ **逐字符一致 = true** |

**诚实边界**：替代证据覆盖的是"模型可见文本 / 落盘文本**形态**"这一 V1/V6 的实质问题，且用的是生产函数与生产表达式；**未**覆盖"真实模型经工具循环拿到该文本"这一链路（因工具未注册而被阻）。若将来这 4 个工具被注册（或改由 `TaskOrchestratorTools` 承担），应按 §7 V1 原方法复跑一次。

**清理与成本**：验证会话 `session_mum35eh11ji6qybtew5h` 已 `DELETE`（`{"success":true}`）；探针文件已删；本轮真实调用消耗 **17,383 tokens**（17,230 in / 153 out，cache read 2,304 / cache creation 14,926）——该轮未成功触达 Task 工具，成本仅来自两次 `tool_search`。

**顺带观察（非缺陷，与既有设计一致）**：本轮 `tool/result` 事件里的 `data.result` 是**双层编码**（`"\"{\\\"matches\\\"…}\""`）。核对：`tool_search` 返回的是**对象**（`createToolResult({matches,…})`），事件层对已序列化的文本又做了一次 `JSON.stringify` ⇒ 双层。这与前端 `toolResultText.ts` 注释自述的"信封 value 常为字符串化 JSON ⇒ **迭代解码 ≤3 层**"**一致**，属既有设计、非本次引入。


