# TaskOrchestratorTools 三个活工具出参对象化 + 框架两处修正（立项）

> 立项时间：2026-09-29 · 来源：`dev_docs/error_repairs/预存错误与待处理问题.md` **D-15** 的「未验」项经核查后升级
> 状态：**✅ 已实施（2026-09-29）** —— 用户裁定 **D2-a**「接受 JSON」并批准按 spec 实施；V1–V9 结果见 §10，V2 的**形式调整**原委见 §11。**§4-D4 的 c1/c2 已裁定为 c2（删死分支）并实施**（见 §4-D4 末的处置结论）。
> 性质：**工具输出形态变更（契约变更）+ 框架边界修正**。触及「模型可见文本」「前端工具卡」「会话水合」三条既有路径 ⇒ 实施后须逐条过 §7 验收。
> 关联规则：**GR15**（Spec-Driven）/ **GR16-002**（跨模块变更须建 Spec）/ **GR01**（基础设施复用）/ **GR02**（实现唯一性）/ **GR03**/**CS06**（证据驱动）/ **CS01**（归一化）/ **CS03**（回退最小化）/ **CS05**（根因优先）/ **R02**（数据模型统一）/ `project_rules` §1.3（无正式用户 ⇒ 无向后兼容负担）/ §1.6（Write-Ahead Persistence）
> 关联 spec：[`task-family-tool-output-object.md`](./task-family-tool-output-object.md)（D-10 —— **❌ 已废止**，其对象是死实现；本 spec 是其**在活工具上的重做**，方法论沿用）

---

## 一、问题定义

D-15 曾把「`TaskOrchestratorTools` 三个**活**工具的出口形态是否也存在 D-10 那类问题」标为「未验」。本次按用户指令核查完毕，结论是**三层**：

1. **表层（原另案 ②）**：UI 注册表错配 —— 已在 D-15 内处置（删 4 条永不产生的注册）。
2. **本 spec 主体（形态不齐，非 D-10 原缺陷）**：`create_task_list` / `update_task_status` / `get_task_list` 的出口 `data` 是**人类可读纯文本字符串**；同族的 `task_stop` 是**对象**。⇒ 同族两种形态；模型侧因框架对**字符串** `data` 会再 `JSON.stringify` 一次（§3 通道 A），拿到的是**带引号 + `\n` 转义**的文本；且**无结构化契约**（无法声明 `outputSchema`）。
   - **与 D-10 的区别（不得混为一谈）**：D-10 的病根是「工具**自行** `JSON.stringify` + 框架**再** stringify」的**双层转义**；这三个工具**全文件零 `JSON.stringify`**（grep 实证）⇒ **不存在双层转义**。本次是"文本 vs 对象"的**形态统一**，收益是结构化契约 + 模型可读字段，**不是**修双层转义。
3. **顺带发现（同轮取证，同批处置）**：
   - **(a) 空结果在模型侧被显示为 `{}`** —— `ChatManager._buildToolRoundMessages` 用 **truthiness** 判断载荷 ⇒ `''`/`0`/`false`/`null` **一律**降级为 `pr.result.error || '{}'`。
   - **(b) `processResult` 只读 `result.data`**（不读 `result.result`）⇒ 只填 `result` 的工具，其块 `result`/`output` 均为空。
   - **(c) 候选：`SessionStateHydrator.extractTodos()` 的 `create_task_list` 分支可能永不命中** —— 需**端到端实测**后裁定（§4-D4）。

---

## 二、现状取证（逐项附 `文件:行`）

### 2.1 三个活工具的出口（实测）

| 工具 | `name` | `createToolResult(首参)` | `data` 形态 | human `output` | 自行 stringify |
|---|---|---|---|---|---|
| `TaskCreateListTool` | `create_task_list`（[`:53`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L53)） | [`:163`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L163) 多行文本 | **string** | ❌ | 否 |
| `TaskUpdateStatusTool` | `update_task_status`（[`:574`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L574)） | [`:663`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L663) 单句 | **string** | ❌ | 否 |
| `TaskGetListTool` | `get_task_list`（[`:682`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L682)） | [`:750`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L750) 文本表格 | **string** | ❌ | 否 |
| **对照** `TaskStopTool` | `task_stop` | [`:205/226/238`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskTool/TaskStopTool.ts#L205-L238) | **object**（5 字段） | ✅ `output.message` | 否 |

失败分支三者均为 `createToolResult(null, { newMessages: [...] })`（[`:99`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L99) / [`:119`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L119) / [`:132`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L132) / [`:618`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts#L618) 等）⇒ **无载荷**（沿用 D-10 §2 的"失败分支不受影响"结论）。

### 2.2 活工具清单核对（防"改了不活的"）

- 活 loader 清单：[`ToolManagerUtils.ts:80-82`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/utils/ToolManagerUtils.ts#L80-L82) 含 `createTaskCreateListTool` / `createTaskUpdateStatusTool` / `createTaskGetListTool`（**三者均在**）；`task_stop` 在 [`:79`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/utils/ToolManagerUtils.ts#L79)。
- `ViewTasksTool`（`view_tasks`）/ `AbortTaskTool`（`abort_task`）/ `ViewPlanTool`（`view_plan`）**不在**活 loader 清单（仅存在于 `ToolFactory`）⇒ **本 spec 不动它们**（§9）。

---

## 三、关键证据：载荷如何变成"模型可见 / 前端可见 / 落盘"文本

### 3.1 框架侧两处（决定性）

| # | 位置 | 代码 | 对 `data` 的处置 |
|---|---|---|---|
| ① | [`ToolExecutor.processResult()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolExecutor.ts#L757-L776) | `result: result.data` / `output: typeof result.data === 'string' ? result.data : JSON.stringify(result.data)` | **只读 `data`**（不读 `result`） |
| ② | [`ChatManager._buildToolRoundMessages()`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L5911-L5928) | `const raw = pr.result.result ? JSON.stringify(pr.result.result) : pr.result.error \|\| '{}'` | **truthiness + 无条件 stringify** |

### 3.2 逐通道影响（改 `data` 为对象之后）

| # | 通道 | 证据 | 今天（`data` = 纯文本） | 改为对象后 | 判定 |
|---|---|---|---|---|---|
| **A** | **模型可见** | `ChatManager.ts:5912-5914` | `JSON.stringify("<多行文本>")` ⇒ **带引号 + `\n` 转义** | `JSON.stringify({...})` ⇒ **干净 JSON** | ⚠️ **形态变化（非纯改善）** —— 见 §4-D2 |
| **B** | 前端工具卡 | [`ReActToolLoop.ts:1722-1727`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L1715-L1729) `typeof result === 'string' ? result : safeStringify(result)`（`safeStringify` = 紧凑 `JSON.stringify`，[`:163-165`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L158-L169)） | 文本**原样**透传 | 紧凑 JSON | ⚠️ **展示变化**（`get_task_list` 由"对齐表格"变 JSON） |
| **C** | 前端渲染层 | [`toolResultText.ts:93-102`](file:///e:/PY/Documents/CODES/PY_APP/client/src/utils/toolResultText.ts#L93-L102) 对 `{`/`[` 开头者 `JSON.stringify(…, null, 2)` | 纯文本**原样** | **pretty JSON** | ✅ 兼容（不报错），但内容可读性变化同上 |
| **D** | 落盘（持久化） | [`ToolResultPersister.ts:59-65`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/services/ToolResultPersister.ts#L59-L65) | 字符串分支 | 对象分支 | ⚠️ **落盘文本变化**（符合 §1.6 的"先落盘后渲染"，但**字符不再一致**） |
| **E** | 会话水合 | [`SessionStateHydrator.ts:57-78`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/hydration/SessionStateHydrator.ts#L57-L78) 要求 `create_task_list` 的 content 可解析且含 `todos` **数组** | 纯文本 ⇒ `JSON.parse` 得 **string** ⇒ `.todos` 为 `undefined` ⇒ **不命中** | 对象 JSON ⇒ 仍**无 `todos` 字段** ⇒ **仍不命中** | 见 §4-D4 |

> **方法论（CS06）**：A/B/C/D 四通道的"今天 vs 改后"均由**代码行 + 既有注释**直接推得（`ChatManager` 那行是**无条件** `JSON.stringify`；`ReActToolLoop` 那行有既有注释说明 `toolResult.result` 即 `processResult` 的 `result.data`）。
> ⚠️ **未取运行期证据（如实）**：尚未实跑一次拿到真实 tool 消息文本；实施时按 §7-V2 补。

### 3.3 消费面核验（决定改动的爆炸半径）

| # | 潜在消费方 | 核验结果 |
|:--:|---|---|
| 1 | 前端按名解析这三个工具的结果 | ✅ **零命中** —— 全 `client/src` grep `create_task_list` / `get_task_list` / `update_task_status` ⇒ 仅 [`toolHumanSummary.ts`](file:///e:/PY/Documents/CODES/PY_APP/client/src/utils/toolHumanSummary.ts#L128-L135) 的**名称→标签映射**（`create_task_list: "创建任务列表"` 等，`:306-319` 为**入参**摘要），**不解析结果** |
| 2 | 后端按名解析结果 | ⚠️ 仅 [`SessionStateHydrator.ts:67`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/hydration/SessionStateHydrator.ts#L67)（见 §4-D4）；`sendMessageFlow.ts:722` 只判**调用名**（`tc.name === 'create_task_list'`，不读结果） |
| 3 | 既有测试断言 | ⚠️ [`TaskCreateListTool.test.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tools/TaskCreateListTool.test.ts) 有 **4 处**对 `r.data` 的字符串断言（`:88` / `:89` / `:95` / `:116`）⇒ **必须同步改** |
| 4 | `_todoData` 链路 | ✅ 与这三个工具**无关** —— 生产者为 `TodoWriteTool`；消费为 `ChatHelper.extractTodoData`（[`:146-153`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/ChatHelper.ts#L146-L153)）经 `ReActToolLoop.ts:1730 / :2257` ⇒ 不受影响 |

---

## 四、方案

### D1（核心决策）—— 三工具出口改为**对象**，并接线 `outputSchema`

依据：同族 `task_stop` 已是对象 + 已接线；框架两处出口都能消化对象（§3.1）⇒ 消除"同族两形态"，并使**结构化契约可声明**（GR01 复用既有 `Tool.outputSchema` 契约位，不新造机制）。

**字段设计（严格照实有语义，不发明字段）**

| 工具 | 出口对象 |
|---|---|
| `create_task_list` | `{ created: Array<{ task_id: string; description: string }>; total: number; pending: number; skipped: number }` |
| `update_task_status` | `{ task_id: string; status: string; success: boolean; message: string }` |
| `get_task_list` | `{ count: number; stats: { pending: number; in_progress: number; completed: number; failed: number; cancelled: number }; tasks: Array<{ task_id: string; description: string; status: string }> }` |

命名对齐同族 `task_stop` 的 **snake_case**（`task_id` / `previous_status` / `current_status`）。

### D2（⚠️ 决策点，需评审裁定）—— 人类可读文本的去向

改对象后，模型与前端**都**看到 JSON（§3.2 通道 A/B；`processResult` 不把工具自带的 `ToolResult.output` 透传进块）。因此必须明确取哪一支：

| 支 | 内容 | 代价 / 收益 |
|---|---|---|
| **D2-a（推荐）** | 接受 JSON：三工具只返回对象，不再保留多行文本 | 收益：形态统一、契约可声明、模型读得到字段。代价：`get_task_list` 的**工具卡与模型可见文本由"对齐表格"变为 JSON 数组**（可读性变化，`toolResultText` 会 pretty-print 2 空格） |
| **D2-b** | 对象 + 同时写 `output: <原文文本>`（对齐 `task_stop` 的写法） | 收益：与 `task_stop` 逐字段同构。代价：**当前框架不消费**该字段（`processResult` 只看 `data`）⇒ 实为**形式对齐**，对模型/前端**零效果**；若期望生效，须额外改 `processResult` 让其优先透传 `ToolResult.output` —— 那是**框架级行为变更**，影响面远超本 spec（**建议不并入**，另立项） |
| **D2-c** | 维持字符串出口不动 | 与用户已定方向（对象化）冲突 ⇒ 仅在评审否决对象化时采用 |

> **本 spec 默认按 D2-a 实施**；若评审选 D2-b，须同时确认是否接受 `processResult` 的框架级改动（§9-3 已列为"不做"）。

### D3 —— 框架两处修正（对应顺带发现 a / b）

**D3-a（发现 a）**：`_buildToolRoundMessages` 的两处 **truthiness** 判断改为**显式空值判断**：

```ts
// 改前（:5885-5887 与 :5912-5914 两处）
const raw = pr.result.result ? JSON.stringify(pr.result.result) : pr.result.error || '{}';
// 改后
const payload = pr.result.result;
const raw =
  payload === undefined || payload === null
    ? pr.result.error || '{}'
    : JSON.stringify(payload);
```

- **只修 falsy 误判**（`''`/`0`/`false` 不再变成 `'{}'`）；**不动**"对字符串也 stringify"这一既有行为（那是通道 A 的转义来源，属**另一个话题**，见 §9-2）。
- 两处（日志用 `:5885-5887`、载荷用 `:5912-5914`）**必须同改**，否则日志中的 `chars` 与实际载荷不符。

**D3-b（发现 b）**：`ToolExecutor.processResult()` 的读取面补回退（**最小改动**，仅当 `data` 缺省时才看 `result`）：

```ts
const payload = result.data !== undefined ? result.data : result.result;
return { …, result: payload, output: typeof payload === 'string' ? payload : JSON.stringify(payload), … };
```

依据：`ToolResult` 同时声明 `data?` 与 `result?`（[`ToolResult.ts:40-41`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/types/ToolResult.ts#L40-L68)），且校验器已支持"载荷在 `result` 上"（`tests/tools/toolOutputSchema.test.ts` 第 6 例）⇒ 框架两条读取面**口径不一**（自己承认的契约位却不读）。**不改变** `data` 有值时的任何行为。

### D4（发现 c）—— **先实测，后裁定**（不在本 spec 预设结论）

1. **实测**（§7-V6）：真实会话触发 `create_task_list` → 重载会话 → 观察水合 `todos` 是否恢复；并如实记录持久化后的 tool 消息 `content` 原文。
2. **依结果二选一**：
   - **c1**：若确认**可**命中且水合结果**有价值**（NoteTask 具备持久化语义）⇒ 修 `SessionStateHydrator` 使契约对齐（并补 `todos` 字段到 `create_task_list` 出口）。
   - **c2**：若确认**永不**命中 ⇒ 按"零消费者可删"先例**删除该死分支**（`create_task_list` 那半边），只留 `tasklist_write`（若其亦为死名，一并处置）。
3. **不预设**：D1 不会改变该分支的可命中性（出口无 `todos` 字段，§3.2 通道 E）⇒ D1 与 D4 相互独立，可分别裁定。

> **✅ 处置结论（2026-09-29，用户裁定「按建议执行 c2」）**：实测（§10.2-V6）证明该分支**恒不命中** ⇒ 按 **c2 删除死分支**实施：移除 `SessionStateHydrator.extractTodos()`（其判断只在 `create_task_list` / `tasklist_write` 两个**死名**上生效 —— 后者全仓仅出现在该判断里）、其专属辅助 `parseToolResult()`（零其他调用方）、`HydratedState.todos`、`SessionAccessFacade.hydrateSession` 返回类型中的 `todos`，以及两处**只写不读**的 `metadata.hydratedTodos`（`ChatManager` 与 `SessionLifecycleManager` 各一处）。
> **验收（实测）**：`typecheck` **0** · 5 目录测试（`tests/tools` + `src/tools/__tests__` + `src/chat/services/__tests__` + `tests/session` + `tests/chat`）**1326 pass / 0 fail**（163 文件）· `lint:arch` **0 错 1 警**（`R15-001` 24/0、`R15-002` 22/0、扫描 **3972** 不变）。

---

## 五、改动清单（预估）

| # | 文件 | 改动 |
|:--:|---|---|
| 1 | `app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts` | 三个工具：`createToolResult(<对象>, …)`（成功分支）；新增 `readonly outputSchema = …`；补 `schemas` 具名导入 |
| 2 | `app/src/tools/TaskOrchestratorTools/schemas.ts`（**新建**） | 3 个 `*OutputSchema`（zod），照 §4-D1 字段；**不建**入参 schema（入参侧机制见 `TASK_TOOL_PARAMS`，不在本 spec 范围） |
| 3 | `app/tests/tools/TaskCreateListTool.test.ts` | 4 处字符串断言（`:88/:89/:95/:116`）改为**对象断言**（如 `r.data.created.length` / `r.data.skipped`）——**不得删测**，须保留同等强度 |
| 4 | `app/src/chat/ChatManager.ts` | D3-a：两处 truthiness → 显式空值判断 |
| 5 | `app/src/tools/ToolExecutor.ts` | D3-b：`payload` 回退 |
| 6 | `app/tests/…`（新增/扩充） | ① 三工具出口形态 + schema 成对断言（合规过 / 篡改必报，**同 `toolOutputSchema.test.ts` 第 7 例范式**）；② D3-a 的空值守卫用例（`''`/`0`/`false`/`null` 四态）；③ D3-b 的 `result`-only 用例 |

> **不做**（§9）：不动 `ViewTasksTool`/`AbortTaskTool`/`ViewPlanTool`；不动前端映射与展示逻辑；不动 `processResult` 的隐藏行为（除 D3-b）。

---

## 六、风险与前置核验

| # | 风险点 | 核验结果 |
|:--:|---|---|
| 1 | 改动对象是**活**工具（模型真能调到） | ✅ 三者均在活 loader 清单（§2.2）⇒ 与 D-10 不同，**本 spec 必须做**且**能**做运行期验收 |
| 2 | 前端会不会崩 | ✅ `decodeToolResultContent` 对 `{`/`[` 走 pretty-print（§3.2 通道 C）；前端不按名解析结果（§3.3-1） |
| 3 | 既有测试会不会红 | ⚠️ **会红 4 处**（§3.3-3），已列入改动清单 #3 |
| 4 | 契约是否"接线即真生效" | ✅ `Tool.outputSchema` + `validateToolOutputShape` 为既有机制（`task_stop` 在用）⇒ 按 V4 成对断言守卫 |
| 5 | 展示/落盘是否变化 | ⚠️ **会变**（通道 B/C/D）——这是**知情变更**，非回归；须在评审时确认（D2 决策点） |
| 6 | `R15-001` 是否新增告警 | ⚠️ 新增 3 个 `*OutputSchema` **若接线**则零消费者为 0；**未接线**会被门禁记 warning ⇒ 改动清单 #1 的接线与 #2 的 schema **必须同批** |

---

## 七、验收标准

| # | 项 | 判据 |
|:--:|---|---|
| V1 | 类型检查 | `bun run typecheck` ⇒ **0** |
| V2 | **运行期证据（模型可见文本）** | 起单实例 daemon，真实模型触发 `create_task_list`；抓取该轮 tool 消息 `content`，确认由**转义文本**变为**干净 JSON 对象**（含 `\"` = false） |
| V3 | 相关测试 | `bun test tests/tools` + 新增用例 ⇒ **全绿**，且 `TaskCreateListTool.test.ts` 的对象断言与旧字符串断言**等强度** |
| V4 | 契约真在生效 | 临时把某 `*OutputSchema` 的必填字段改为 `z.number()` ⇒ 该校验应报错；验毕还原（或以成对断言长期化，同 D-10 §7-V5 的"等价长期形式"） |
| V5 | 架构门禁 | `bun run lint:arch` ⇒ **0 错**；`R15-001` 定义数 +3 / **零消费者 0** |
| V6 | **发现 c 端到端实测** | 真实会话 `create_task_list` → 重载 → 记录水合 `todos` 结果与持久化 `content` 原文；据此裁定 c1/c2 并**在同一轮落地或明确登记** |
| V7 | D3-a 守卫 | `''`/`0`/`false` 三态**不再**被降级为 `'{}'`；`null`/`undefined` 仍走 `error \|\| '{}'`（既有行为不回归） |
| V8 | D3-b 守卫 | `data` 缺省 + `result` 有载荷 ⇒ 块 `result`/`output` 不再为空；`data` 有值时行为**逐字符不变** |
| V9 | 无 Mock / 无回退 | 改动不含 mock 数据、不含"以防万一"回退（CS04 / CS03） |

---

## 八、合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15** Spec-Driven | ✅ 本 spec **先于**实现创建；创建时未动任何代码 |
| **GR16-002** 跨模块变更须建 Spec | ✅ 触及 `tools/` → `chat/`（模型消息）→ `session/hydration` → `client/` |
| **GR01** 基础设施复用 | ✅ 复用既有 `Tool.outputSchema` 契约位与 `validateToolOutputShape`，**不新造**机制 |
| **GR02** 实现唯一性 | ✅ 消除"同族两形态"；**不**新建第二套序列化 |
| **GR03**/**CS06** 证据驱动 | ✅ §2/§3/§3.3 每条附 `文件:行`；**未取运行期证据处已显式标注**（§3.2 注、V2） |
| **CS01** 归一化 | ✅ 先查已有（`task_stop` 同族范式、框架既有契约位）⇒ 不另起炉灶 |
| **CS03** 回退最小化 | ✅ D3-b 仅在 `data` 缺省时回退；不引入兜底分支 |
| **CS04** 零 Mock | ✅ 测试沿用真实 `taskRegistry` stub 范式，不新增假数据 |
| **CS05** 根因优先 | ✅ 修"框架 truthiness / 读取面口径不一"的**根因**，而非在工具侧绕过 |
| **R02** 数据模型统一 | ✅ 三个出口对象字段与同族 `task_stop` 命名对齐（snake_case） |
| `project_rules` §1.3 无向后兼容负担 | ✅ 直接改形态，不留兼容层 |
| `project_rules` §1.6 Write-Ahead Persistence | ⚠️ **落盘文本形态会变**（通道 D）——但"先落盘后渲染"的**顺序语义不变**；变化本身是本 spec 的知情结果 |

---

## 九、范围边界（明确不做）

1. **不动** `ViewTasksTool`（`view_tasks`）/ `AbortTaskTool`（`abort_task`）/ `ViewPlanTool`（`view_plan`）—— 三者**不在活 loader 清单**（`ToolFactory` 内引用 ≠ 注册），与 D-15 判定的死实现同族；如需处置**另立项**。
2. **不改**通道 A 的"对字符串也 stringify"行为（字符串类工具普遍受影响，属**框架级**话题）⇒ 若要做，**另立项**。
3. **不改** `processResult` 使之透传 `ToolResult.output`（D2-b 的附加条件，框架级行为变更，影响所有工具）。
4. **不修** `processedResults` 的声明类型与实际形状不符（D-10 §6 已登记的"类型撒谎"，`result: ToolResult` 实为 `ToolResultBlock`）⇒ 另立项。
5. **不引入**入参侧校验机制（沿用台账 D-7 的用户裁定）。

---

## 十、实施记录（2026-09-29）

### 10.1 改动清单（实际，7 文件）

| # | 文件 | 实际改动 |
|:--:|---|---|
| 1 | `app/src/tools/TaskOrchestratorTools/schemas.ts`（**新建**） | 3 个 `*OutputSchema`（`CreateTaskListOutputSchema` / `UpdateTaskStatusOutputSchema` / `GetTaskListOutputSchema`） |
| 2 | `app/src/tools/TaskOrchestratorTools/TaskOrchestratorTools.ts` | ① 三工具成功分支出口改**对象**（`create_task_list` 去多行文本、`get_task_list` 去对齐表格与 `statusIcons`）；② 各加 `outputSchema = …`（附沿革注释）；③ 补 `./schemas` 具名导入；④ `get_task_list` 的**空列表分支**改为同形态对象（否则契约校验会记不合规） |
| 3 | `app/src/chat/services/ChatHelper.ts` | 新增**归一化纯函数** `toToolResultRawText(payload, error)`（D3-a 两处共用，消除重复表达式；仅 `undefined`/`null` 视为无载荷） |
| 4 | `app/src/chat/ChatManager.ts` | D3-a：两处（诊断日志 `:5885`、实际载荷 `:5911`）truthiness → 调 `toToolResultRawText`；补 import |
| 5 | `app/src/tools/ToolExecutor.ts` | D3-b：`processResult` 引入 `payload = result.data !== undefined ? result.data : result.result` |
| 6 | `app/tests/tools/TaskCreateListTool.test.ts` | 4 处字符串断言 → **对象断言**（`created.map(description)` / `skipped` / `created[0].description` / `created.length`），**强度不低于原断言** |
| 7 | `app/tests/tools/taskOrchestratorToolsOutput.test.ts`（**新建**） | 8 例：三工具"真实出口 ⇒ 契约通过 / 改坏 ⇒ 必报"成对断言（V4 长期形式）+ 空列表分支同形态 `+ processResult` 读取面 4 例（V8） |
| 8 | `app/src/chat/services/__tests__/ChatHelper.test.ts` | +3 例 `toToolResultRawText`（V7：`''`/`0`/`false` 保留；`undefined`/`null` 走兜底） |

> 与 §5 预估的差异：**多了 #3**（把 D3-a 的两处重复表达式收敛为单一纯函数）—— 依据 **GR02/CS01**（同一表达式出现在两处即重复实现），且使 V7 可被单测覆盖；未新造机制、未改行为语义。

### 10.2 验收结果（实测）

| # | 项 | 结果 | 证据 |
|:--:|---|---|---|
| V1 | 类型检查 | ✅ | `bun run typecheck` → `EXIT=0` |
| V2 | 运行期证据（模型可见文本） | ⚠️ **形式调整**（真实模型触发被阻，见 §11）→ 用**生产同款函数** | `model-visible(new)` = `{"created":[{"task_id":"note-写周报","description":"写周报"},…],"total":2,"pending":2,"skipped":0}`（含 `\"`=**false**、含字面 `\n`=**false**）；`(old)` = `"Created 2 task(s):\n  - [note-写周报] 写周报\n…"`（引号包裹 + 字面 `\n`）；**new ≠ old = true** |
| V3 | 相关测试 | ✅ | `tests/tools` + `src/tools/__tests__`：**594 → 602 pass / 0 fail**（+8 = 新增文件；**逐数吻合**）；`tests/tools` + `src/chat/services/__tests__`：**638 pass / 0 fail**（63 文件） |
| V4 | 契约真在生效 | ✅（**长期成对断言**） | `taskOrchestratorToolsOutput.test.ts`：三工具各一组"真实出口通过 + 改坏必报"；空列表分支亦通过与校验 |
| V5 | 架构门禁 | ✅ | `lint:arch` **0 错 1 警**（仅既有 R07-004）；**R15-001 `定义 21 → 24`（零消费者 0）**；R15-002 `候选 21 → 22`（零 importer 0）；R07-001 `0`；扫描文件数 **3971 → 3972**（+1 = `schemas.ts`，逐数吻合） |
| V6 | 发现 c 端到端实测 | ✅ 已取，**结论支持 c2** | `V6_todos_new_hit = false`（新对象形态不命中）· `V6_todos_old_hit = false`（旧文本形态亦不命中）· **对照**（content = `{"todos":[…]} `形态）`V6_control_todos_shape_hit = true, len = 1` ⇒ 该分支**只认 `todos` 数组形状**，而 `create_task_list` 两种形态都无 `todos` ⇒ 对该工具**恒不命中**（与 §3.2 通道 E 判定一致，D1 **未**改变可命中性） |
| V7 | D3-a 守卫 | ✅ | 单测：`''`→`""`、`0`→`0`、`false`→`false`（不再变 `'{}'`）；`undefined`/`null` → `error \|\| '{}'`（既有行为不回归） |
| V8 | D3-b 守卫 | ✅ | 单测：`data` 有值 → `{"a":1}`（与修正前逐字符一致）；字符串 `data` → 原样透传；仅 `result` → 块 `result`/`output` 有值；`data: null` → **不被 `result` 顶替** |
| V9 | 无 Mock / 无回退 | ✅ | 未引入 mock 数据；未加"以防万一"回退（CS03/CS04） |

### 10.3 过程中的一处自纠

在 `ChatHelper.ts` 插入新函数时，首版把 `truncateToolResult` 的既有 JSDoc 与函数体**分离**（新注释插在两者之间）；已当场发现并改回（JSDoc 归位、新函数置于其前）。

### 10.4 环境动作（如实交代）

- 停掉运行**旧代码**的 daemon（PID 32360，起于 10:56）→ 以新代码起**单实例**（`:18990`，`/health=ok`，bun 进程数 = 1）。
- 验证会话 4 个已 `DELETE`（`success=true`）；探针文件 `app/scripts/_probe_v2v6.ts` 已删；`$env:TEMP` 下的 SSE 暂存已清。

---

## 十一、V2 的真实模型触发为何改用"生产同款函数"（如实记录）

**做了什么**：以新代码起单实例后，跑了 **3 轮真实模型对话**（`deepseek-v4-flash`，均新建会话、`stream:true`）：

| 轮 | 提示 | 模型行为 |
|:--:|---|---|
| 1 | 「请调用 `create_task_list` 创建 3 个任务…」 | 先调 `tool_search`×2（`select:create_task_list`）→ 结果 `matches:["todo_write"]`、`total_deferred_tools:2` ⇒ **改调 `todo_write`**（写出 "Wrote 3 todo(s)…"），**未**调 `create_task_list` |
| 2 | 「请**直接**调用工具 `create_task_list`…禁止 tool_search」 | **零工具调用**；回复原文：「无法执行这个请求——**`create_task_list` 这个工具在我的工具集中不存在**…我核对了当前可用工具清单」 |
| 3 | 「`create_task_list` 确实存在于你的工具清单中（60 个之一）…参数为 `{"tasks":[…]}`」 | **仍零工具调用** |

**决定性证据（模型确实"看得到"）**：查该会话的 `context/model-input` 事件（`project_rules §1.6`「模型可见 ⇔ 已落盘」机制）—— 事件载荷 **LEN=54221**，内含 **TOOL_COUNT=60**，**`has_create_task_list = True`**，与 `GET /v1/tools` 的 60 个工具逐名一致。

⇒ **结论：工具在清单内、平台无阻断；是模型自身选择/声称不使用它**（第 2 轮的"不存在"与其可见清单矛盾 ⇒ 属模型侧失误，不作平台缺陷认定）。

**诚实边界**：V2 的替代证据覆盖"模型可见文本**形态**"这一实质问题，用的是生产函数（真实 `execute()` → 真实 `ToolExecutor.processResult()` → 真实 `ChatHelper.toToolResultRawText`）；**未**覆盖"真实模型经工具循环拿到该文本"。若后续模型实际触发该工具，应按 §7-V2 原方法复跑。

### 11.1 同轮顺带发现的预存问题（已按「发现即记录」登记台账）

1. **`tool_search` 别名冲突致检索误导 —— ✅ 已修复（见 §11.2）**：`tool_search(select:create_task_list)` 曾返回 `matches:["todo_write"]` —— 因 `TodoWriteTool` 当时的 `aliases = ['todo', 'tasks', 'todo_list', 'create_task_list']`，**把另一个真实工具名当成了自己的别名** ⇒ 模型按名检索 `create_task_list` 时被导向 `todo_write`（第 1 轮实测复现）。修复后该别名已移除，且 `findToolByName` 改为**真实名优先**（台账「另案 ③-①」）。
2. **非流式路径的会话互斥锁**：新会话首次 `POST /v1/chat/completions`（`stream:false`）即返回"上一条回复仍在生成中（已执行约 3 秒）"（[`ChatOrchestrator.ts:508-512`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L504-L512) 的 `mutex.getHeldDurationMs() > 0` 快速失败分支）⇒ 非流式路径在**全新会话**上即被自身锁挡住（**未深究**：可能是该路径内部二次入锁）。
3. **若真做水合亦与注册表冗余**：`NoteTask` 经 [`TaskRegistry.registerNoteTask`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/TaskRegistry.ts#L594-L598) → `register()` → `saveTasks()` **自身持久化** ⇒ 即便把 `todos` 补进 `create_task_list` 出口让水合分支命中，也与注册表恢复**重复**。

### 11.2 别名冲突修复后：**V2 的真实模型路径已达成**（同日补充）

按用户指令「先解决 tool_search 别名冲突问题」修复 §11.1-① 后（详情见台账「另案 ③-①」，含**同类全排查**：2 处活冲突 + 1 处惰性），重启 daemon 载入修复并**复跑当初复现误导的那轮提示**：

| 观测 | 修复前 | 修复后 |
|---|---|---|
| `tool_search(select:create_task_list)` 的 `matches` | `["todo_write"]`（被别名误导） | **`["create_task_list"]`** |
| 模型是否调用 `create_task_list` | **0 次**（3 轮） | **调用了** |

**首轮仍失败，但暴露了另一个真问题**：模型传 `{"tasks":[{"title":"写周报"},…]}`（用 **`title`**），而该工具只认 `description` ⇒ 全量被过滤成空 ⇒ 返回 `null` 载荷且**不设 `error`** ⇒ 模型只看到 `{}`，遂改用 `todo_write`。已登记为台账 **另案 ④**（同族 `TodoWriteTool` 早有 `normalizeWriteTodos` 兜底，二者标准不一）。

**补一轮带正确参数的调用后**，模型可见文本 / 落盘 `content` 实测为：

```json
{"created":[{"task_id":"写周报","description":"写周报"},{"task_id":"发邮件","description":"发邮件"},{"task_id":"买咖啡","description":"买咖啡"}],"total":3,"pending":3,"skipped":0}
```

⇒ **干净 JSON 对象**（无引号包裹、无字面 `\n`）—— **§10.2 的 V2 由"形式调整"升级为真实模型路径达成**；§11 开头记录的"被阻"保留为历史（其阻因是**别名冲突**，而非平台或工具不可达）。


