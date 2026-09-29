# 工具出参 schema「层级归属」核查（立项）

> 立项时间：2026-09-28 · 来源：`architecture-benchmark-20260928.md` §2.1（P1-3 A 档实施期发现）
> 状态：**T1-T6 全部完成**（T4 于 2026-09-28 裁定：3 个悬空 schema **删除**，并补「**无载荷不校验**」机制）
> 📅 **日期口径提示（2026-09-29 补注）**：本 spec 早期条目按 **UTC** 记为 `2026-09-28`；按本机时区（+08）实为 **2026-09-29 00:xx**（`git log` 作者时间 `2026-09-29 00:32 +0800` 可证）⇒ T6 分类条目标 `2026-09-29`，**与前者是同一次连续工作**，不是两次。
> 性质：**审计 + 收口** spec。**在"层级判定"完成前不接线**（接线错误会每次调用失败）。

---

## 一、为什么要立项（问题定义）

P1-3 A 档把 `Tool.outputSchema`（原类型 `unknown`，纯占位）接上运行期校验后，填充 top-10 工具时**连续踩到同一类坑**：

> `*OutputSchema` 写得像"工具出参契约"，但它的**实际层级**可能不是"工具出口的 `data`"，而是**内层函数的返回值** —— 甚至**根本没有任何消费者**。

**两种错法的后果**（已在 `glob`/`bash` 上验证）：

- 若把"内层函数契约"接到 `Tool.outputSchema` ⇒ **每次调用都校验失败**（往 `metadata.outputSchemaError` 灌噪音）；
- 若把"孤立 schema"直接接上 ⇒ 同上（字段名与出口不一致时）。

⇒ 所以需要的不是"接线"，而是先**判定每个 `*OutputSchema` 的层级归属**。

---

## 二、核查结果（10 个高频工具，逐项附 `文件:行`）

| 类别 | 工具 | `*OutputSchema` 位置 | 实际层级判定 | 出口 `data` 形态 | 处置 |
|---|---|---|---|---|---|
| **A. 描述「内层函数」输出**（被误当作出参契约） | `glob` | `tools/GlobTool/schemas.ts:26`（`{filenames, durationMs, numFiles, truncated}`） | **内层** `globAsync()` | **字符串数组**（只取 `filenames`） | ✅ 已按出口新写 `z.array(z.string())` |
| | `bash` | `BashTool.ts:89`（`{stdout, stderr, exitCode}`） | **内层** `execBashCommand()`（其返回 `{stdout,stderr}`，见 `:758`） | **字符串** `output` | ✅ 已按出口新写 `z.string()` |
| **B. 正确的「出口契约」** | `grep` | `GrepTool/schemas.ts:70`（且出口标 `satisfies GrepOutputType`，见 `GrepTool.ts:229-237`） | **出口** ✅ | 结构对象 | ✅ **仅接线**（唯一正确者） |
| **C. 纯孤立定义**（**零消费者**） | `todo_write` | ~~`TodoWriteTool/schemas.ts:50`~~（**已删除**） | **悬空（无层级）** | 成功分支恒为**字符串**；5 处失败分支传 `null`（`:686/881/919/1014/1037`） | ✅ **已删除**（T4）：出口契约已就地在 `TodoWriteTool.ts:420` 声明 `z.string()` |
| | `web_search` | ~~`WebSearchTool/schemas.ts:45`~~（**已删除**） | **悬空** | **三形态**：错误 string（`:154/212/323/342/357/385`）/ 空结果对象（`:242`）/ 成功对象 `WebSearchResult`（`:285`，定义 `:561`） | ✅ **已删除**（T4）：多态出口，单一 schema **无法表达** |
| | `web_fetch` | ~~`WebFetchTool/schemas.ts:46`~~（**已删除**） | **悬空** | **混合**：失败 string（`:181/192/220/287/374/399`）/ 成功对象 `WebFetchResult`（`:352`，定义 `:536`） | ✅ **已删除**（T4）：同上；且原 schema 字段名与出口**不一致**（`statusCode` vs `status`） |
| **D. 无 schema**（本次新写出口契约） | `file_read` | — | — | 字符串 | ✅ `z.string()` |
| | `tool_search` | — | — | 结构对象 | ✅ `z.object({...})` |
| | `file_convert` | — | — | 字符串 | ✅ `z.string()` |
| | `sessions` | — | — | **多态（随 `action` 变化）**：`list`/`status`/`history`/`spawn`/`send`/`delete` 各返回不同结构；成功分支 `{success:true, data, output}`（`SessionsTool.ts:317-321`），错误分支**无 `data`**（`:284`/`:290`/`:330`）。⚠️ 且它**不用** `createToolResult` 族（全仓 grep 零命中）⇒ 手写构造 `ToolResult` | ⬜ **不接**：多态出口，单一 schema 无法表达（**T3 已完成**） |

**核查方法（可复现）**：对每个 `*OutputSchema` 做两次 grep —— ① 定义位置；② **消费者**（若只在定义文件内命中 ⇒ 零消费者 ⇒ 悬空；若能对上某内层函数的返回 ⇒ 内层）。再比对工具出口各 `createToolResult/createSuccessResult` 的**第一实参**（= `data`）。

---

## 三、待办

| # | 项 | 状态 / 结论 |
|:--:|---|---|
| T1 | 补 `web_search` 成功分支的 `data` 形态 | **✅ 完成**：成功分支 = **对象** `WebSearchResult`（`WebSearchTool.ts:260` 赋值、`:561` 定义 `{query, results, totalResults, searchUrl, safeSearch}`）；错误分支 = string（6 处：`:154/212/323/342/357/385`），**另有第三种形态**——"空结果"对象（`:242` = `{query, results: [], totalResults, message}`）⇒ **与 `web_fetch` 同型（第 4 例漂移），且多一种形态**。其 `WebSearchOutputSchema`（`{results:[…], totalResults, searchTime}`）与上述**全都不一致** ⇒ 悬空 |
| T2 | 补 `todo_write` 成功分支形态 | **✅ 完成且已接线**：成功分支**恒为字符串**（`:716` 的 `'No todos found…'` / `:772` / `:816` / `:855` / `:896`）⇒ 已加 `outputSchema = z.string()`（`TodoWriteTool.ts:420`）。⚠️ **原判据已被 T4 更正**：本条原写"错误分支不参与校验（`ToolExecutor` 仅在 `result.success !== false` 时校验）"——**不成立**，该工具**从不设 `success`**（全仓 grep：该类 3 工具零命中）⇒ 5 处 `null` 分支原本也会被校验；现由 T4 的「**无载荷不校验**」规则排除 |
| T3 | 补 `sessions` 全部返回分支 | **✅ 完成**：**多态出口**（随 `action` 变化）⇒ **不接** |
| T4 | C 类 3 个悬空 schema 的**去留** | **✅ 完成 —— 裁定「删除」**（我原建议"改写为出口契约"，**依新证据改判**）。3 个 schema **零消费者**（grep 确认：仅在各自文件内命中）⇒ 删除 schema 与同名 `*OutputType`，原位留"为什么删"的证据注释（防后人误接）。**为什么不改写**：`web_search` 出口**三种形态**（string / 空结果对象 / 成功对象）、`web_fetch` **两种**（string / 成功对象）——改写为出口契约只能落成 `z.union([z.string(), …])`，而"含 string 的 union"**几乎不设防**；其根因是**这些分支未标 `success: false`**（工具层缺陷，修它属另一议题）。**意图未丢**：T5 文档 §④ + 本 spec 已如实记录"不适合声明"的形态与原因；`todo_write` 的正确契约已就地在工具上（`TodoWriteTool.ts:420` = `z.string()`）。<br>**本次顺带修正（机制级）**：新增「**无载荷不校验**」——`validateToolOutputShape` 对 `data == null` 直接判为"不校验"（错误分支本就没有产出，不该被判"出参违规"）；回归测试仍 5 例，第 5 例由"回退校验 `result` 本体"**替换**为"无载荷不校验"（原第 5 例断言的行为已**证伪**：校验整个 `ToolResult` 无意义） |
| T5 | 把 `Tool.outputSchema` 语义写进工具开发文档（**禁止把内层函数契约接到它上面**） | **✅ 完成**：写入 [`app/docs/概念与架构/tool-system.md`](file:///e:/PY/Documents/CODES/PY_APP/app/docs/概念与架构/tool-system.md#L18-L64)，在「工具定义」与「工具注册」之间新增「**出参契约（`outputSchema`）—— ⚠️ 新增工具必读**」小节，含 4 块：① **它是什么**（执行点/不阻断/未声明不校验/**无载荷不校验**/`success === false` 豁免）；② **它不是什么**（**4 例实证误用** + "接线前必须实测出口 `data`"+ **T4 已删 3 处错层 schema 的注记**）；③ **怎么写**（✅❌ 对照示例，含"多态出口不要声明"）；④ **已知不适合声明的形态**表（`sessions` / `web_fetch` / `web_search`） |
| T6 | 全仓扫描 `*OutputSchema` | **✅ 完成（规模 + 逐项分类）**：定义共 **45 个**（`export const \w+OutputSchema`，全部位于 `tools/*/schemas.ts`）⇒ **分类结果：仅 1 个有消费者、44 个零消费者**（详见下节「**T6 分类结果**」） |

### T6 分类结果（2026-09-29 机械判定 —— **结论出乎预期**）

**方法（三步，均含假阴性兜底，可复现）**：

1. **枚举定义**：`grep "export const \w+OutputSchema" app/src` ⇒ **45 命中**（**全部**位于 `tools/*/schemas.ts`）。
2. **枚举消费者**：`grep "from '[^']*[Ss]chema[^']*'" app/src` —— **模式刻意放宽为"路径里含 schema"**，以兜住两类假阴性：① `./schemas.js` 后缀（**本仓确有 `.js` 后缀导入的先例**：`WebFetchTool.ts:28` 的 `'./ssrf.js'`）；② barrel 再导出（该模式确实捕到了 `lsp/index.ts:45` 的 `export * from './schemas.js'`，证明它有效）。另以 `grep "OutputSchema" app/tests` 覆盖测试侧。
   ⇒ **`tools/**` 内只有 2 个文件 import 自己的 `./schemas`**：
   - [`GrepTool.ts:25-26`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/GrepTool/GrepTool.ts#L25-L26)：入参类型 + `validateGrepInput` + **`GrepOutputSchema`**；
   - [`FileSearchTool.ts:21-22`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/FileSearchTool/FileSearchTool.ts#L21-L22)：**只** import 入参（`FileSearchInputType` + `validateFileSearchInput`），**未 import 输出**。
3. **交叉**：45 个定义中，**只有 `GrepOutputSchema` 既被 import 又被接线**（[`GrepTool.ts:107`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/GrepTool/GrepTool.ts#L107)）。

| 判定 | 数量 | 依据 |
|---|:--:|---|
| ✅ **已被消费**（唯一正确的出口契约） | **1** | `GrepOutputSchema` —— 唯一被 import 者，且已接 `Tool.outputSchema` |
| ⚠️ **零消费者（悬空）** | **44** | 无任何 import（`app/src` 含 barrel、`app/tests` 均已扫）；其 `z.infer` 类型别名亦**只在同文件内被自身引用** |
| ⚠️ **同型、但不在本清单**（局部同名、描述内层函数） | **2** | [`BashTool.ts:88`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/bash/BashTool.ts#L88)、[`PowerShellTool.ts:224`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/PowerShellTool/PowerShellTool.ts#L224) —— 定义在**工具文件内**（非 `schemas.ts`），服务于**内层函数** |

**44 个零消费者（按目录列举，`Chronos`/`Task` 为多枚）**：
`AskUserQuestion` · `Brief` · `BrowserTool` · `Chronos`(×3：CronCreate/CronDelete/CronList) · `CodeAnalysis` · `Config` · `EnterPlanMode` · `EnterWorktree` · `ExitPlanMode` · `ExitWorktree` · `FileEdit` · `FileRead` · `FileSearch` · `FileWrite` · `GlobTool` · `LSP` · `ListMcpResources` · `ListPeers` · `MCPResource` · `Monitor` · `Plan` · `PushNotification` · `ReadMcpResource` · `SendMessage` · `Skill` · `Sleep` · `SubscribePR` · `TaskOutput` · `TaskStop` · `TaskTool`(×5：Create/Output/List/Update/Stop) · `TeamCreate` · `TeamDelete` · `Time` · `ToolSearch` · `Tungsten` · `VoiceInput` · `VoiceOutput` · `PowerShell`（`schemas.ts` 版）

**这改变了什么（三点）**：

1. **「工具出参契约」这一层事实上不存在** —— 44 个 schema 是**无人消费的意图记录**；T4 删掉的 3 个**不是特例，而是通例**（此前"第 3/4 例同型漂移"的表述**低估了规模**）。
2. **top-N 的接线做法被证明是对的** —— 给 7 个高频工具**新写**出口契约（而非复用 `schemas.ts` 里那 44 个）是正确选择；若按"看到 `*OutputSchema` 就接"，绝大多数会立刻误报。
3. **它们是"死代码"而非"误接陷阱"**（与 T4 那 3 个**不同层**）：T4 那 3 个已实测**字段名与出口不符**（接上必错）；这 44 个**尚未逐项实测** ⇒ **既不能一刀切删**（可能有些本就相符，如 `TaskStop`/`Skill` 类），**也不能一刀切接**（可能多数描述的是内层函数）。

**处置建议（分批，每批 8-10 个，逐项用同一套判定）**：对每个 schema ① 实测该工具**出口各分支的 `data` 形态**（各处 `createToolResult` 第一实参）→ ② 与 schema 字段比对 → ③ **相符 ⇒ 接线**；**不符 ⇒ 删除**（原位留证据注释）；**多形态 ⇒ 删除 + 记入「不适合声明」表**（T4 方法复用）。

**门禁设计（机械可判定，但落地时机 = 批次之后）**：

- **判据**：`export const *OutputSchema` 若**全仓无消费者** ⇒ **warning**（提示"要么接线、要么删除"）。这是 T4/T6 教训的制度化落点。
- ⚠️ **为何不现在加**：当前会**一次性产生 44 条 warning**，冲垮既有基线（0 错 1 警）并淹没真实告警 ⇒ **应与批次清理同步落地**（先"新规则 + 存量豁免清单"，随批次递减至 0 后再撤豁免，避免制造第二份事实源）。

#### 分批处置进展（T6 之后；每批 8-10 项）

| 批次 | 项 | 判定 | 依据（**实测出口 `data` 形态**） | 状态 |
|:--:|---|---|---|---|
| 1a | `file_read` / `FileReadOutputSchema` | **删除** | 出口 = **字符串**（`FileReadTool.ts:253` 已声明 `z.string()`）；原 schema 是"读取元信息对象"⇒ 错层 | ✅ |
| 1a | `file_write` / `FileWriteOutputSchema` | **删除** | 出口 **恒为字符串（6/6 处已核：`FileWriteTool.ts:194/223/238/253/300/325`）**；原 schema 是"写入结果对象"⇒ 错层。该工具**未声明** `outputSchema`（是否**新写** `z.string()` 属 top-N 扩展，**不在本批**） | ✅ |
| 1a | `glob` / `GlobOutputSchema` | **删除** | 原 schema 描述**内层 `globAsync()`**；出口 = **字符串数组**（`search/GlobTool.ts:41` 已声明 `z.array(z.string())`） | ✅ |
| 1a | `tool_search` / `ToolSearchOutputSchema` | **接线**（本批唯一）× 归一化 | 出口对象与 schema **同构**；且实测 `matches` **就是 `string[]`**（`:371-375` 的 `const found: string[]` + `found.push(tool.name)`、`:434`）⇒ **删掉我内联的重复定义**改 import 该 schema，并把 `matches` 由 `z.array(z.unknown())` **收紧为 `z.array(z.string())`** —— 这正是"改写 vs 删除"两种判定的对照实例 | ✅ |
| 1b | `task_create` / `TaskCreateOutputSchema` · TaskGet 的 `TaskOutputSchema` · `task_list` / `TaskListOutputSchema` · `task_update` / `TaskUpdateOutputSchema` | **删除**（4 项） | 四个工具**出口 `data` 全是 JSON 字符串**（`TaskCreateTool.ts:221` / `TaskGetTool.ts:169` / `TaskListTool.ts:117` / `TaskUpdateTool.ts:248` 的 `JSON.stringify(output)`），而 schema 描述的是**对象** ⇒ 错层（根因另立 D-10） | ✅ |
| 1b | `task_stop` / `TaskStopOutputSchema` | **接线** | 出口 5 处全为对象 `{task_id, previous_status, current_status, success, message}`（`TaskStopTool.ts:149/175/196/217/229`）⇒ 与 schema **逐字段相符** | ✅ |
| 1b | `task_output` / `TaskOutputOutputSchema` | **接线** | 出口 7 处全为 `{retrieval_status, task}`；`retrieval_status` 全在枚举内（`:290-292`），`TaskOutputData`（`:28-38`，9 字段）与 `TaskOutputDataSchema` **逐字段一致** | ✅ |
| 1b | `TaskStopTool/schemas.ts` 的 `TaskStopOutputSchema` | **删除**（原转 D-9，2026-09-29 收口） | **不是"单个悬空 schema"，而是"孤儿模块"问题**：该目录的 tool 文件 `TaskStopTool.tsx` **未被发现引用**（真正的 `task_stop` 在 `TaskTool/TaskStopTool.ts`，由 `ToolFactory.ts:49/1164` 注册），其 `UI.tsx` 则被 `ToolUIRegistry.ts:372` `require` 而**存活**；且该 `.tsx` 的内联 schema 与本 schema **逐字重复**（双份事实源）⇒ 另立 **D-9** 裁定；**已于同日按 D-9 处置**：删除 `.tsx`/`schemas.ts`/`prompt.ts` 三个孤儿文件、**保留活的 `UI.tsx`** | ✅ |
| 2 | `EnterPlanMode` / `ExitPlanMode` / `EnterWorktree` / `ExitWorktree`（4 个） | **接线** | 出口 `data` **全为对象且与各自 schema 逐字段相符**：两个 PlanMode 工具含 `mode` 字面量（`'plan'` / `'normal'`）；两个 Worktree 工具为 `{success, message, worktree_path? / previous_branch?}`，失败分支 `{success:false, message}` 亦符合（可选字段缺省） | ✅ |
| 2 | `plan` / `PlanToolOutputSchema` | **接线** | 出口为 `let result: PlanToolOutput` 累积后交给 `createToolResult(result, …)`；而**本文件内**的 `PlanToolOutput`/`PlanData`/`PlanStep` 三接口与 `schemas.ts` 的三个 schema **逐字段同构**（含四值枚举、必填项）⇒ **TS 赋值已强制**符合。**遗留**：本地 3 接口 vs 3 schema = **双份事实源**，归一化（改用 `z.infer` 派生）另议 | ✅ |
| 2 | `SkillOutputSchema` · `SleepOutputSchema` · `MonitorOutputSchema` | **删除**（3 项） | 三者**都不用 `createToolResult`**（手工构造）：`sleep` 成功分支 `data = {durationMs, elapsed, reason}`（与 `{sleptMs, message}` **字段名全不同**）；`monitor` 的 `data = {metric, ...result}` 有 **4 种形态**（memory/cpu/disk/network）**均无** schema 要求的 `value`/`timestamp`；`skill` ⚠️ **理由已于批次 3 更正**：载荷在 `result`（现已可回退校验），其 `result` 是**字符串**而 schema 是对象 ⇒ 仍不符 ⇒ 删除 | ✅ |
| 3 | `file_edit` / `FileEditOutputSchema` | **删除** | 出口 `data` **两形态混杂且都不符**：**字符串 4 处**；对象仅 2 种，其中 `{filePath, replaced}`（`FileEditTool.ts:321`）**缺 `linesChanged`/`oldStringFound` 两个必填字段** ⇒ 接上必误报（另一种 `{…, replaceAll}` 多出的键会被 zod 默认 strip，无害） | ✅ |
| 3 | `file_search` / `FileSearchOutputSchema` | **接线** | 成功出口（`createSuccessResult`）的 `data = {durationMs, numFiles, files: [{relativePath, filePath, canonicalPath}], truncated}` ⇒ 与 schema **顶层逐字段相符**；`files[]` 多出的 `filePath` 被 zod 默认 **strip**（非 `.strict()`）。**失败路径双重免疫**：`createFailureResult` 返回 `{data: undefined, success: false}` ⇒ 同时命中「`success===false` 豁免」与「**无载荷不校验**」 | ✅ |
| 3 | `CronCreateOutputSchema` · `CronListOutputSchema` | **删除**（2 项） | `cron_create` 出口 `{id, name, humanSchedule, nextRunAt}` ⇒ **缺 `recurring`/`durable` 两个必填字段**；`cron_list` 出口元素为 `{id, name, schedule, prompt, enabled, state, nextRunAt?, lastRunAt?, silent}`（`CronListTool.ts:37-47`）⇒ **用 `schedule` 而非 schema 的 `cron`、且无 `humanSchedule`**（两者必填）。⚠️ 旁证：`CronCreateTool` 的**入参** schema（`cron`/`prompt`/`recurring`/`durable`）与实现读取的 `expression`/`scheduleMode`/`name` 也**不符**（D-7 第 3 例） | ✅ |
| 3 | `cron_delete` / `CronDeleteOutputSchema` | **接线** | 成功出口 `{id, name: existing.name}` ⇒ **含必填 `id`**（多出的 `name` 被 strip）；失败经 `createFailureResult` ⇒ **双重豁免** | ✅ |
| 3 | `voice_input` / `voice_output` | **接线**（2 项） | 二者**手写 `ToolResult`、载荷放在 `result`**（非 `data`）⇒ 依赖本片补的「载荷**回退 `result`**」才生效。实测各 action 成功分支的 `result` **全在 schema 的"全可选"字段并集内**（`voice_input` 8 字段 / `voice_output` 6 字段 —— 字段全 optional 正是"多 action 并集"的写法）；失败分支 `result: null` ⇒ 无载荷跳过 | ✅ |
| 3 | **机制补强**：`validateToolOutputShape` 的载荷改为 `data ?? result` | —（非 schema 项） | ⚠️ **发现机制盲区**：校验器原本**只看 `data`**，而 `voice_*` / `skill` 等**手写 ToolResult 的工具把载荷放在 `result`** ⇒ 其声明的 schema 会**静默永不校验**（正是本机制要消灭的"摆设契约"）。已改为读 `data`、缺省**回退 `result.result`**（二者是 `ToolResult` 的**并行载荷字段**：`data?: T` / `result?: T`）；回归测试 **5 → 6 例**。**已标 `TODO: CS05-ROOTFIX`** —— 回退是过渡，根因（`data`/`result` 重复）由**B 档**收敛 | ✅ |
| 4a | `list_mcp_resources` ・ `read_mcp_resource` ・ `mcp_resource`（**MCP 三兄弟**） | **接线**（其中 2 项叠加**归一化**） | 三者出口 `data` 与各自 schema **逐字段相符**（资源数组 / `{contents:[…]}` / `{success, …}`）。⚠️ **前两者原本已有一份"内联 `get outputSchema()`"**，与 `schemas.ts` 的常量**逐字重复** ⇒ 本次**改引常量、消除"双份事实源"**（CS01）；`mcp_resource` 原无 getter，属**纯新增接线** | ✅ |
| 4a | `TeamCreate` ・ `TeamDelete` | **接线**（2 项） | 出口 `data` 与 schema **完全相符**：`TeamCreate` 三处出口全是 `{team_name, team_file_path, lead_agent_id}`（失败分支用 `''` 占位，且**未标 `success:false`** ⇒ 会被校验，但符合）；`TeamDelete` 为 `{success, message, team_name, terminated_teammates?}`（第 4 键**可选**） | ✅ |
| 4a | `SendMessageOutputSchema` ・ `PushNotificationOutputSchema` | **删除**（2 项） | `send_message` 成功出口把对象 **`JSON.stringify` 成字符串**再当 `data`（2 个失败分支传 `null`）⇒ 与对象 schema 不符（同 **D-10**）；`push_notification` 的工具**定义在 `ToolFactory` 的内联对象里**（不在其目录），`execute` 只返回 `{success, output}` —— **没有任何载荷字段**，结构化结果被塞进 **`output` 字符串** ⇒ schema 描述的形态**不存在** | ✅ |
| 4b | `browser` ・ `code_analysis` ・ `ListPeers` | **接线**（3 项） | 出口与 schema **逐字段相符**：`browser` 成功出口 `data = BrowserToolOutput`（`{success, message, data?, tabs?, screenshot?}`，失败分支自带 `success:false`）；`code_analysis` **手写 ToolResult、载荷在 `result`**（`result: output`，`CodeAnalysisOutput` = `{analysis:{type,stats,details?}, filesAnalyzed, analysisTime}`，6 处失败经 `createFailureResult`）；`ListPeers` 唯一出口 `{peers, total, active}`，其 `PeerInfo` 与 `PeerInfoSchema` **逐字段同构**（含两处枚举取值） | ✅ |
| 4b | `BriefOutputSchema` ・ `TungstenOutputSchema` ・ `ConfigOutputSchema` ・ `LSPOutputSchema` ・ `TimeOutputSchema` ・ `PowerShellOutputSchema` ・ `AskUserQuestionOutputSchema` ・ `SubscribePROutputSchema` | **删除**（8 项） | **四类错法各占**：① **schema 描述的是 `ToolResult` 本体**（`brief` / `config` —— 出口只有 `{success, output, error}`，`output` 是**人类可读文本**、不作载荷）；② **出口是字符串/多形态**（`tungsten` 14 处全为字符串或 `null`；`time` 是 `JSON.stringify`（且三 format 字段集互不相同）；`powerShell` 成功 `data` 是**字符串**（与 `bash` 同型）；`ask_user_question` 是 `JSON.stringify` 或 `{error, retryable}`）；③ **错层**（`LSP`：出口 `data = result`，按接口 `lsp/types/LSPTool.ts:31-54` 其返回是 `CompletionItem[]`/`Location[]`/`Diagnostic[]`/**`string`**，而 schema 描述的是"归一化后的对象"）；④ **第 ④ 族**（`subscribe_pr`：定义在 `ToolFactory` 内联对象里，出口只有 `{success, output}`） | ✅ |

- **验收（批次 1–4b，全部）**：`typecheck` **0** · `eslint` **0** · `tests/tools` **539 pass / 0 fail**（校验器专项 **6 例**）。
- **计数变化（最终；⚠️ 用 grep 独立核验，不靠减法学）**：有消费者 **1 → 21**；零消费者 **44 → 0**。
  · **核验方式**：`grep "export const \w+OutputSchema" app/src` ⇒ 定义数 **45 → 21**（逐批删除累计 **3+4+3+3+2+8+1 = 24**，末项即 **D-9 收口**删掉的 `TaskStopTool/schemas.ts`）；消费方 = **21** ⇒ 零消费者 = 21 − 21 = **0**。
  · ⚠️ **本表此前两处计数算错**（`44 → 41`、`41 → 37`）—— 漏算"**接线项会从零消费者转入有消费者**"这一步；正确应为 `44 → 40`、`40 → 34`，现按上式更正。

### ✅ T6 收口结论（2026-09-29）

| 项 | 数 | 说明 |
|---|:--:|---|
| **接线** | **21** | 出参与 schema 相符者（含 3 处叠加**归一化**：`tool_search` / `list_mcp_resources` / `read_mcp_resource`） |
| **删除** | **24** | 错层（描述内层函数 / `ToolResult` 本体）、出口字符串化、多形态、第 ④ 族（`ToolFactory` 内联定义）；**含 D-9 收口的 1 个**（孤儿模块 `TaskStopTool/schemas.ts`） |
| **转另案** | **0** | ~~1（`TaskStopTool` 孤儿模块）~~ ⇒ 已于同日按 **D-9** 删除 |
| **合计** | **45** | = 立项时的全部 `*OutputSchema` 定义数 |

- **达标判定**：立项时"44 个零消费者"**全部有结论**（0 遗留）；**含原转 D-9 的 1 个也已于同日收口** ⇒ 仓内零消费者 `*OutputSchema` = **0**（`lint:arch` 的 R15-001 实测 `定义 21 个，零消费者 0 个`）。
- **过程产出（超出原目标）**：① 修掉 1 处**机制盲区**（载荷只看 `data` ⇒ 改为 `data ?? result`，并标 `TODO: CS05-ROOTFIX`）；② 沉淀**四族出口构造法 + 三处载荷位置**的判定方法（见上）；③ 顺带记录 **D-7 四例入参漂移**、**D-9 孤儿模块**、**D-10 出参字符串化**。
- **未做（如实）**：① ~~**门禁**（「`*OutputSchema` 无消费者 ⇒ warning」）尚未落地~~ ⇒ ✅ **已落地（2026-09-29）**：新增 **`R15-001`**（`scripts/lint-architecture.ts#checkOrphanOutputSchemas` + `.trae/rules/architecture-compliance.md` §R15），**warning 级、零豁免上线**；实测输出 `定义 22 个，零消费者 0 个`（**D-9 收口后为 `21 个`，仍 0 零消费者**）、总告警仍为 1（仅既有 R07-004）⇒ **无新增噪音**；并做 **A 档变异测试**（临时插入孤立定义 ⇒ `零消费者 1 个：R15MutationProbeOutputSchema`、告警 1→2、报 1 条违规；已还原且残留 0）。② ~~`schemas.ts` 的**入参侧**死定义未清（D-7）~~ ⇒ ✅ **已清（2026-09-29）**：按同判据（**零 importer**）量出 **20/41** 个 `tools/<X>/schemas.ts` **整文件死亡**（其 `*InputSchema` / `validateXxxInput` / `logger` 全无人消费，且**已实测与实现漂移**）⇒ **全部删除**（仓内 **21 个均有 importer**）；配套新增门禁 **R15-002**（"零 importer 的 `schemas.ts` ⇒ warning"，**零豁免上线**、A 档验证会红）；4 例入参漂移**随死文件删除而消解**（详见台账 D-7）。
- **方法补充（批次 3 新增，重要）**：出口构造有**三族**，逐项判定时**三族都要看** ——
  ① `createToolResult(data, …)`（多数工具，`data` 为第一实参）；
  ② `ToolUtils.createSuccessResult` / `createFailureResult`（如 `file_search`；**前者** `{data, success:true}` 会被校验，**后者** `{data: undefined, success:false}` ⇒ **双重豁免**）；
  ③ **手写 `ToolResult` 对象**（如 `voice_input` / `voice_output` / `skill` / `sleep` / `monitor` / `sessions`）——
     **还要再分两种**：(a) 载荷放在 **`result`**（`voice_*` / `skill`）⇒ 2026-09-29 起校验器已**回退**读它，可正常判定；
     (b) 载荷放在 `data`（`sleep` / `monitor`）或**没有载荷字段**（`sessions` 部分分支）⇒ 按一般规则判定。
  ④ **工具定义不在 `tools/<Tool>/`，而在 [`ToolFactory`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/ToolFactory.ts) 的"内联对象"里**
     （如 `push_notification` / `subscribe_pr`）—— 其 `execute` 常返回 `{success, output}`，
     **没有任何载荷字段**（结构化结果被 `JSON.stringify` 塞进 **`output` 字符串**）⇒ **该目录下的 `*OutputSchema` 一律"声明无意义"**。
     ⇒ **取证时必须同时查 `ToolFactory.ts`**，否则会误判为"可接线"。
- **载荷位置共 3 处（别搞混）**：`data`（**主**载荷）/ `result`（**并行载荷**，2026-09-29 起已回退读取）/ `output`（**人类可读文本** —— `ToolResult.output?: string`，**不作为载荷**；拿它去校验必然误报）。
- **批次进度**：批次 1 **10 项**（1a 4 + 1b 6；另 1 项转 D-9）· 批次 2 **8 项** · 批次 3 **7 项**（3 删 + 4 接线）· 批次 4a **7 项**（5 接线 + 2 删除）⇒ **累计 32 项**，**余 12 项**。**另 +1 项机制补强**（载荷回退 `result`）。

### 后续建议（不在 T1-T6 内，供裁定）

1. **先做 T5（文档）** —— 成本最低、防止问题继续扩大（新工具作者不该再往 `Tool.outputSchema` 接内层契约）；
2. ~~T4 建议"改写为出口契约"而非删除~~ → **已于 2026-09-28 依证据改判为「删除」**：`web_search` 出口有**三种**形态、`web_fetch` 有**两种**（均含字符串失败分支，且这些分支**未标 `success: false`**）⇒ "改写"只能落成一个"含 string 的 union"，**几乎不设防**；**意图记录**改由 **T5 文档 §④ + 本 spec** 承担（详见 T4 行）；
3. **~~40+ 个的逐项分类建议按模块分批~~ → 分类已完成（2026-09-29，见上「T6 分类结果」）**：结论 = **1 有消费者 / 44 零消费者 / 2 处局部同名（内层函数）**。**下一步是分批处置**（每批 8-10 个，判定法见该节），并**与批次同步落地门禁**（无消费者 ⇒ warning，随批次递减至 0 后撤豁免）。

---

## 四、非目标

- ❌ 本 spec **不改** `ToolExecutor` / `Tool` 的机制（A 档已落地，见 `architecture-benchmark-20260928.md` §2.1）
- ❌ **不在层级判定完成前接线**（T1-T3 未完成者一律不接）
- ❌ 不动 B 档 / C 档（主契约收敛、基座类型抽取）—— 那是另一议题

---

## 五、合规对照

| 规则 | 落实方式 |
|---|---|
| **CS01**（归一化：新增前先查已有） | 每个工具先查是否已有 `*OutputSchema`（避免重复定义）——**全部 10 个已查** |
| **CS04 / CS06**（禁止 Mock / 禁止空结果编造） | 未取证者标"未确证/未取证"，**不臆断形态**（T1-T3 即为此设） |
| **CS05**（根因优先） | 根因是"缺'工具出口契约'这一层"，故本 spec 先做层级审计，而非逐个打补丁 |
| **CS03**（回退最小化） | A 档校验**默认不阻断**（失败只记录），避免审计期影响线上 |
