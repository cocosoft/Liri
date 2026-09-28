# 工具出参 schema「层级归属」核查（立项）

> 立项时间：2026-09-28 · 来源：`architecture-benchmark-20260928.md` §2.1（P1-3 A 档实施期发现）
> 状态：**T1-T6 全部完成**（T4 于 2026-09-28 裁定：3 个悬空 schema **删除**，并补「**无载荷不校验**」机制）
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
| T6 | 全仓扫描 `*OutputSchema` | **✅ 完成（规模确认）**：全仓 **40+ 个 `*OutputSchema`**，分布在 **约 35 个工具**的 `schemas.ts`（远超 top-10 的 3 个）⇒ **问题面比预想大**；逐项分类需另批（见下"后续建议"） |

### T6 的规模数据（可复现）

`grep -n "export const \w+OutputSchema" app/src/tools` ⇒ **40+ 命中**，含 `AskUserQuestion`/`Brief`/`Browser`/`Chronos`(×3)/`CodeAnalysis`/`Config`/`FileEdit`/`FileSearch`/`FileRead`/`FileWrite`/`Glob`/`Grep`/`LSP`/`Monitor`/`Plan`/`PowerShell`/`SendMessage`/`Skill`/`Sleep`/`Task`(×5)/`Team*` 等。

⇒ **这意味着"悬空/误用"不是 top-10 的局部现象**，而是**全仓面**问题（已确认的 4 例同型漂移只是**最先撞到的**）。

### 后续建议（不在 T1-T6 内，供裁定）

1. **先做 T5（文档）** —— 成本最低、防止问题继续扩大（新工具作者不该再往 `Tool.outputSchema` 接内层契约）；
2. ~~T4 建议"改写为出口契约"而非删除~~ → **已于 2026-09-28 依证据改判为「删除」**：`web_search` 出口有**三种**形态、`web_fetch` 有**两种**（均含字符串失败分支，且这些分支**未标 `success: false`**）⇒ "改写"只能落成一个"含 string 的 union"，**几乎不设防**；**意图记录**改由 **T5 文档 §④ + 本 spec** 承担（详见 T4 行）；
3. 40+ 个的**逐项分类**建议**按模块分批**（每批 8-10 个），避免一次性大改。

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
