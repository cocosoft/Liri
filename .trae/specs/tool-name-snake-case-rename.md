# 工具名 snake_case 收敛（PascalCase 10 项改名）

> 立项：2026-09-29 · 来源：`dev_docs/error_repairs/预存错误与待处理问题.md` **D-36-②**（用户裁定「两项都做（先核实，再改名）」）
> 前置：`tool-name-compile-time-enum.md`（P2-3，已完成的编译期枚举 + 2 条门禁）

---

## 1. 背景（为什么做）

`P2-3` 落地后，生成物 `app/src/constants/toolNames.generated.ts`（**全量 71 名**）成为工具名的事实源，其中**命名风格混有 10 个 PascalCase**（CC 家族名）——其余 61 个为 snake_case。混风格本身不违规（wire codec 只禁冒号），但带来两类实际成本：

1. **清单协同成本**：凡是"按工具名登记"的清单（类别映射、强制保留集、只读判定、子代理禁用集…）都要同时记两套写法 ⇒ 抄错/漏改的机会成倍增加；
2. **已发生过的真实事故族**：本仓工具名漂移已累计 **7+ 例**（台账 D-15/D-29~D-34/N-27/N-41/N-44），其中 `MANDATORY_TOOLS`（`toolCategories.ts:345`）漏登记某名即导致**该工具对模型永久不可见**。

**目标**：把 10 个已注册的 PascalCase 工具名统一为 snake_case，使全仓"按工具名登记"的清单只有一种写法。

## 2. 改名表（10 项，已由用户裁定：**去 `Tool` 后缀**）

| # | 现名（PascalCase） | 新名（snake_case） | 声明位置 |
|---|---|---|---|
| 1 | `Agent` | `agent` | [`AgentTool/constants.ts:8`](../../app/src/tools/AgentTool/constants.ts#L8) `AGENT_TOOL_NAME` |
| 2 | `Skill` | `skill` | [`SkillTool/constants.ts:8`](../../app/src/tools/SkillTool/constants.ts#L8) `SKILL_TOOL_NAME` |
| 3 | `MCPTool` | `mcp_tool` | [`mcp/MCPTool.ts:64`](../../app/src/mcp/MCPTool.ts#L64) |
| 4 | `MonitorTool` | `monitor` | [`MonitorTool/MonitorTool.ts:18`](../../app/src/tools/MonitorTool/MonitorTool.ts#L18) |
| 5 | `TraceRecordingTool` | `trace_recording` | [`TraceRecordingTool/TraceRecordingTool.ts:42`](../../app/src/tools/TraceRecordingTool/TraceRecordingTool.ts#L42) |
| 6 | `ListMcpResources` | `list_mcp_resources` | [`ListMcpResourcesTool.tsx:14`](../../app/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.tsx#L14) |
| 7 | `ReadMcpResource` | `read_mcp_resource` | [`ReadMcpResourceTool.tsx:14`](../../app/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.tsx#L14) |
| 8 | `ListPeers` | `list_peers` | [`ListPeersTool.ts:57`](../../app/src/tools/ListPeersTool/ListPeersTool.ts#L57) |
| 9 | `EnterWorktree` | `enter_worktree` | [`EnterWorktreeTool.ts:53`](../../app/src/tools/EnterWorktreeTool/EnterWorktreeTool.ts#L53) |
| 10 | `ExitWorktree` | `exit_worktree` | [`ExitWorktreeTool.ts:52`](../../app/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts#L52) |

> ⚠️ **计数更正（D-36-②）**：`tool-name-compile-time-enum.md` §7.3 的 T1 附注原记 **9 个**（`Agent`/`Skill`/`MCPTool`/`MonitorTool`/`TraceRecordingTool`/`ListMcpResources`/`ReadMcpResource`/`EnterWorktree`/`ExitWorktree`）—— **漏 `ListPeers`**。本表以**生成物**为判据重数得 **10**。

## 3. 影响面清单（实测：51 处引号字面量 / 32 文件）

### 3.1 必须改（真名引用 —— 漏改即漂移）

| 类别 | 落点 |
|---|---|
| **名字声明（10）** | 见 §2 表 |
| **类别映射（10）** | [`toolCategories.ts`](../../app/src/tools/toolCategories.ts) 的 `TOOL_CATEGORIES`：`Skill`(70) / `Agent`(129) / `MonitorTool`(134) / `TraceRecordingTool`(135) / `EnterWorktree`(145) / `ExitWorktree`(146) / `ListPeers`(164) / `MCPTool`(188) / `ListMcpResources`(190) / `ReadMcpResource`(191) |
| **强制保留集（1）** | `toolCategories.ts:345` `MANDATORY_TOOLS` 的 `'Agent'` ⇒ `'agent'`（**最关键**：漏改 ⇒ Agent 在普通对话被裁剪） |
| **真名清单（5）** | [`AgentToolsetContract.ts`](../../app/src/tools/AgentTool/AgentToolsetContract.ts) `DELEGATE_BLOCKED_TOOLS` 的 `'Agent'` · [`VerificationStrategy.ts:144`](../../app/src/tools/AgentTool/strategies/VerificationStrategy.ts#L144) `disallowedTools` 的 `'Agent'` · [`TaskComplexityClassifier.ts:63`](../../app/src/ai/router/TaskComplexityClassifier.ts#L63) `writeTools` 的 `'Agent'` · [`ReActLoop.ts:44`](../../app/src/query/ReActLoop.ts#L44) `EXTERNAL_FETCH_TOOLS` 的 `'Skill'` · [`MemoryExtractionHook.ts:44`](../../app/src/hooks/postSampling/MemoryExtractionHook.ts#L44) `MEMORABLE_TOOLS` 的 `'Agent'` |
| **按名解析/执行（2）** | [`resolveAgentToolInstance.ts:50`](../../app/src/tools/utils/resolveAgentToolInstance.ts#L50) `resolve('Agent')` · [`commands/tools/ai/agent.ts:577`](../../app/src/commands/tools/ai/agent.ts#L577) `executeTool('Agent', …)` |
| **测试（6 文件）** | `toolCategories.test.ts` · `SkillToolRegistry.test.ts` · `resolveAgentToolInstance.test.ts` · `agentToolsetContract.test.ts` · `agentDelegationGrant.test.ts` · `toolNameCodec.test.ts`（样例名换真实名） |

### 3.2 **不改**（经逐处判定：非"工具名"语义）

| 落点 | 为什么不改 |
|---|---|
| [`Uninstall.ts:233`](../../app/src/commands/builtin/uninstall/Uninstall.ts#L233) `agent: 'Agent'` | 是**类型显示标签**（`getTypeLabel`），不是工具名 |
| [`agent/display/index.ts:85`](../../app/src/agent/display/index.ts#L85) `AgentTool: { name: 'Agent' }` | 是**按类名索引的显示映射**，`name` 是 UI 文案 |
| [`AgentTool/UI.tsx`](../../app/src/tools/AgentTool/UI.tsx) 3 处 · [`agentDisplay.ts:40`](../../app/src/tools/AgentTool/agentDisplay.ts#L40) | `?? 'Agent'` 是**默认显示兜底文案** |
| [`tools/index.ts`](../../app/src/tools/index.ts) `getTools()`（`'MonitorTool'` 等） | 推入的是**类名**（同列的 `'CronListTool'`/`'VoiceTool'` 全都不是注册名）|
| 注释（`agents.ts:60` / `agent.ts:92` / `agent-control-handlers.ts:27` / `ToolLazyWrapper.ts:161` / `resolveAgentToolInstance.ts:4` / `AgentToolsetContract.ts:53`） | 叙述性文字；**但引用了旧名的注释须同步**，避免留下过期描述（实施时逐处判断） |

## 4. 顺带发现的**新漂移**（登记台账，**不在本 spec 范围**）

改名过程中逐处判定时发现 4 处清单**本就含 CC 漂移名**（与本 spec 的改名无关，属既有缺陷）：

| 落点 | 漂移名 | 真实名 |
|---|---|---|
| `TaskComplexityClassifier.writeTools` | `Write` / `Edit` / `SubAgent` | `file_write` / `file_edit` / `agent` |
| `ReActLoop.EXTERNAL_FETCH_TOOLS` | `search_codebase` | `grep` / `glob` |
| `MemoryExtractionHook.MEMORABLE_TOOLS` | `Write` / `Edit` / `Bash` / `PowerShell` | `file_write` / `file_edit` / `bash` / `powershell` |
| `VerificationStrategy.disallowedTools` | `Task` / `FileEdit` / `FileWrite` / `NotebookEdit` / `ExitPlanMode` | `notebook`；其余本仓无对应 |
| `agentToolsetContract.test.ts` `PARENT` 夹具 | `Bash` / `Read` / `Write` / `WebFetch` / `Task` | 同族 |

> 处置原则：**本 spec 只改与 10 项改名相关的字符串**（即上述清单里的 `Agent` / `Skill`）；其余漂移名**原地保留并登记台账**，避免把"改名"扩成"清漂移"两件事混做（CS01 / 外科手术式修改）。

## 5. 验收标准（可证伪）

1. **生成物重生成**：`bun run gen:toolnames` 后 **71 名不变**、且**不含任何 PascalCase**（用正则断言 `^[a-z_][a-z0-9_]*$` 全覆盖）。
2. **门禁通过**：`toolNames.generated.test.ts`（4 例）+ `toolNameLists.test.ts`（含"清单名 ∈ 生效注册面"）**全绿** ⇒ 反证 10 处改名**没有遗漏任何清单**。
3. **类别映射无漏**：`toolCategories.test.ts` 全绿；且 `getToolCategory('agent') === 'agent'`、`getToolCategory('monitor') === 'system'` 等 10 项逐条为**非 `misc`**（漏改即 `misc` ⇒ 被裁剪）。
4. **`MANDATORY_TOOLS` 生效**：`filterToolsByTask` 用例断言 `agent` 在任何任务集下都被保留。
5. **零残留**：全仓 `'(Agent|Skill|MCPTool|MonitorTool|TraceRecordingTool|ListMcpResources|ReadMcpResource|ListPeers|EnterWorktree|ExitWorktree)'` 命中数 = §3.2「不改」表所列处（**可枚举的闭集**），无新增。
6. **回归**：`app typecheck` 0 · `client typecheck` 0 · `tests/tools` + `tests/mcp` 全绿 · **全量 `bun test` 0 fail**（基线 4232 pass / 21 skip）· `lint:arch` 0 错（仅预存 R07-004）。
7. **行为等价论证**：改名只影响"名字字符串"，不改工具实现/入参/出参 ⇒ 除"模型可见名字"与"清单匹配"外无行为变化；**无正式用户 ⇒ 无历史会话兼容负担**（`project_rules.md §1.3`）。

## 6. 不在范围

- ❌ 不改 §4 登记的 4 处**既有 CC 漂移**（另案处置）。
- ❌ 不处置 **D-36-③** 的 4 个未注册类（`EnterPlanMode`/`ExitPlanMode`/`TeamCreate`/`TeamDelete`）——用户裁定**只改 10 个已注册的**；`toolCategories.ts` 里 `TeamCreate`/`TeamDelete` 两条例外**原地保留**。
- ❌ 不动 `ToolRegistry` / 别名机制 / wire codec 的**行为**。
- ❌ 不改 §3.2 的显示层文案。

## 7. 实施记录（2026-09-29）

**改动文件 30 个**：10 个名字声明 · `toolCategories.ts` · 5 处真名清单 · 2 处按名解析 · 6 个测试 · 3 处注释同步（`agents.ts` / `agent-control-handlers.ts` / `ToolLazyWrapper.ts`）· 生成物重生成 · 2 个文档（`docs/USAGE.md` / `src/docs/APIDocumentation.ts`）。

**与 §5 验收逐条对应（实测）**：

| # | 判据 | 结果 |
|---|---|---|
| 1 | `gen:toolnames` 71 名不变 + 无 PascalCase | ✅ 输出「71 个工具名」；`^\s*"[A-Z]` **零命中**；末次重跑**幂等** |
| 2 | 两条门禁全绿 | ✅ `tests/tools` **569 pass / 0 fail**（63 文件）|
| 3 | 类别映射无漏（10 项非 `misc`） | ✅ `toolCategories.test.ts` 全绿 |
| 4 | `MANDATORY_TOOLS` 生效 | ✅ `filterToolsByTask` 用例断言 `agent` 恒保留 |
| 5 | 零残留（闭集） | ✅ 宽扫（含**双引号/模板串**，超出原单引号正则）：代码侧剩余命中**全部**落在 §3.2「不改」表（`display/index.ts:85`｜`Uninstall.ts:233`｜`UI.tsx:20/62/141`｜`agentDisplay.ts:40`｜`tools/index.ts:257`）+ `client/src/stores/mcpStore.ts` 的 `MCPToolEntry`（**类型名**，非工具名）；其余为台账/spec/rules 历史记录 |
| 6 | 回归 | ✅ `app typecheck` **0** · `tests/tools`+`tests/mcp` **569 pass / 0 fail** · **全量 4232 pass / 21 skip / 0 fail（4253 / 444，98.97s，exit 0）—— 与改名前一模一样** · `lint:arch` **0 错 / 1 警**（仅预存 R07-004） |
| 7 | 行为等价 | ✅ 改名只改"名字字符串"，未改任何工具实现/入参/出参/注册结构 |

**范围外补充处置（本 spec 之外、但属 D-36-② 引用点）**：
- [`docs/USAGE.md`](../../app/docs/USAGE.md#L394-L395) 的"AI 工具"两条（`Agent`/`Skill` 是真工具名）⇒ 改为 `agent`/`skill`；同列 `SleepTool`/`MonitorTool` 是**类名**，**未动**（该列表混用两套命名，属既有文档不精确 ⇒ 登记台账）。
- [`src/docs/APIDocumentation.ts:304`](../../app/src/docs/APIDocumentation.ts#L304) 的工具调用 JSON 示例 `"name": "Skill"` ⇒ 改为 `"skill"`（示例必须是合法工具名）。

**过程如实记录（1 处返工）**：首轮对 `docs/USAGE.md` 跑了 `prettier --write`，prettier 顺带重排该 markdown（84/72 行，表格对齐与空行）⇒ 与"只动必须动的"相悖，已把该文件**还原到 HEAD 后仅重放 2 行改名**，此后**不对 markdown 跑 prettier**（`prettier --check` 对 `.md` 的既有不通过属**预存**状态）。

**⚠️ 事后补正（2026-09-29，台账 D-42）——上面第 5 行的「零残留」曾是**过度声明**（如实更正）**：
- 当时的核查只覆盖**带引号**的名字（`'…'` / `"…"` / 反引号），**漏了两类**：(a) **提示词里的裸词** —— [`SkillInjectionService.ts:244`](../../app/src/skills/services/SkillInjectionService.ts#L244) 的**模型可见**注入文本"用 `Skill` 工具执行技能"；(b) **注释里的反引号** —— `AgentToolsetContract.ts` ×2 与 `AgentTool.ts` ×5 的 `` `Agent` ``。
- **均已修正**（提示词 → `skill`；7 处注释 → `agent`）。
- **修正后的准确口径**：代码中**按名字引用**旧名之处 = **0**；剩余 **14 处**全为**描述性中文用语**（"Agent 工具"/"Skill 工具"），分布在注释、CLI 显示、HTTP 错误文案、插件类别描述 ⇒ 按 §3.2 既定口径（**显示/描述性文案不改**）**保留**（台账已逐一计量）。

## 8. 关联

- 上游：`tool-name-compile-time-enum.md`（P2-3；本 spec 是其 §7.3 T1 附注"9 个 PascalCase"的**计数更正与改名落地**）
- 台账：**D-36-②**（计数更正）、**D-37**（本 spec 实施 + 新发现漂移清单）
