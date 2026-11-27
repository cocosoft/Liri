# 工具安全治理计划（v1）

> 状态：**P0 已实施**（2026-11-22）：矩阵 + 门禁 + 执行入口台账已落地，行为零变更。
> 实施记录见 §10；P1/P2 待办见 §5。
>
> 本文件只覆盖**安全治理**维度（能否执行 / 谁批 / 边界在哪 / 有无证据）。
> 工具「包化、可见面、按需发现」已由 [tool-governance-merge-plan.md](./tool-governance-merge-plan.md) 收口，本文件不重复。
>
> 取证日期：2026-11-22。数据来源：`TOOL_EFFECTS`（69 条）、`getAllBuiltinToolLoaders()`（52 无条件 + 16 条件）、
> `BaseTool` 54 个实现类、`packages/infra/src/permission/` 判定链、`app/package.json` 现有门禁。
> 本文所有结论均带文件:行号；**未验证项显式标注**，不臆造。

---

## 0. 结论先行

1. **基础设施已经齐备，缺的是「逐工具的最终结论」与「入口一致性证据」。**
   现有五件套可复用：`TOOL_EFFECTS`（副作用/幂等）、`sandboxLevel`（能力位）、
   `deriveToolRiskClass`（结构化派生）、`PermissionChecker`（风险默认档）、`lint:tool-risk`（棘轮门禁）。
2. **声明覆盖率天然偏低不是缺陷**：54 个工具类里 `sandboxLevel` 4 个（7.4%）、`riskClass*` 15 个（27.8%）、
   `checkPermissions` 3 个（5.6%），其余**刻意**由 `TOOL_EFFECTS + tags + isReadOnly` 派生。
   真正的问题是：**派生结论没有快照、没有门禁** ⇒ 新增工具或改一行声明，风险档可能静默变化而无人复核。
3. **点名缺口（已取证）**：`computer_use` 无任何执行/风险声明（`launchApp` 可启动任意程序）；
   `browser` 无 SSRF 校验（`web_fetch` 有）；`web_fetch` 的 `saveToFile` 会写盘却仍自报只读；
   主聊天链不做 `outputSchema` 校验；≥10 处 `tool.execute()` 直调点的"已授权"证据未固化。
4. **执行策略**：先做「矩阵 + 门禁」（零行为变更），再按缺口清单逐项修（每项独立提交、带负向用例）。

---

## 1. 治理维度（D1–D8，判据唯一）

| ID | 维度 | 判定问题 | 通过标准（客观） |
|---|---|---|---|
| D1 | 声明完整 | 工具的基础属性是否可枚举？ | `TOOL_EFFECTS` 有条目（`Record<ToolName,…>` 已编译期强制）；`riskClass` 派生结果 ≠ `undeclared`，或显式登记 `undeclared + 理由` |
| D2 | 审批默认档 | 每次调用是否至少经过一次 allow/ask/deny 判定？ | 走 `resolvePolicy`/`authorizeToolCall`；`read/discuss ⇒ allow`、`write/external/shell/undeclared ⇒ ask`（`PermissionChecker.ts:513-531`）不被绕过 |
| D3 | 路径边界 | 读写文件是否限制在工作区/项目/VFS 根内？ | 文件类工具经 `guardWorkspaceBoundary` / `findWorkspaceEscape` / `resolveFileIoRoot`；越界 ⇒ ask 或 deny |
| D4 | 网络边界 | 出网工具是否有协议 / SSRF / 域名 / 大小 / 超时约束？ | URL 协议白名单 + SSRF（内网/回环/元数据）+ 超时 + 响应上限；缺一即记缺口 |
| D5 | 执行边界 | 能执行代码/命令/桌面操作的工具是否 fail-closed？ | 有安全链或沙箱（`sandboxLevel='execution'` + 门禁），或显式"不适用 + 理由"；不存在"未知即可批准"的绕过形态 |
| D6 | 资源上限 | 是否有超时 / 结果截断 / 并发安全声明？ | `maxResultSizeChars` 或请求侧截断；`isConcurrencySafe` 有明确结论；长任务可挂起 |
| D7 | 审计可读 | 拦截/审批/执行是否留痕且 reason 可检索？ | `metadata.reason` 有登记（参照 `commandGateRegistry`）；日志含 session/tool/verdict |
| D8 | 证据 | 是否有专属测试或门禁证据？ | 每工具在 `app/docs/SUPPORT-LEVELS.md` 有测试信号；高风险工具必须有负向用例 |

> 判定原则：**能从结构化元数据派生的，不新增手写清单（CS01/CS02）；不能派生的，用门禁登记"例外 + 理由"（不猜）。**

---

## 2. 已有机制（复用，勿重建）

| 机制 | 落点 | 现状 |
|---|---|---|
| 副作用/幂等唯一事实源 | `packages/tool-base/src/tool-base/toolEffects.ts:66-173` | 69 条；`external` 15 个；复合工具按 `op` 覆盖 |
| 风险类别派生 | `packages/tool-base/src/tool-base/toolRiskClass.ts:50-89`、`packages/infra/src/permission/types/RiskClass.ts:139-182` | 声明 > 派生 > 自报只读 > `undeclared`，**不按名猜** |
| 风险默认档 | `packages/infra/src/permission/PermissionChecker.ts:513-531` | read/discuss 放行；其余 ask |
| 沙箱豁免 S1–S4b | `packages/infra/src/permission/sandboxExemption.ts` | 仅 `write-local` + 路径全在挂载根内可免 ask；`shell` 恒 deny 豁免 |
| 审批指纹 | `packages/infra/src/permission/approvalFingerprint.ts` | `file_write` / `file_edit` 按路径；其余默认全参数稳定 JSON |
| 统一判定出口 | `resolvePolicy.ts` / `authorizeToolCall.ts` | 纯判定 / 判定+提交审批卡 |
| 既有门禁 | `lint:tool-schema`、`lint:tool-risk`、`lint:shadow-tools`、`gen/lint:support-levels` | 声明棘轮 / 未声明登记 / 影子工具台账 / 测试证据 |
| bash 命令门登记 | `app/src/tools/bash/commandGateRegistry.ts` | 顺序 + reason 码 + 豁免位，已与源码双向对账 |

---

## 3. 逐工具矩阵（本计划的核心交付）

### 3.1 为什么需要矩阵

"逐一核对 69 个工具 × 8 个维度"靠人工必漏。矩阵把这件事变成**可生成、可 diff、可门禁**的产物：

```text
getAllBuiltinToolLoaders()  ─┐
TOOL_EFFECTS                ─┼─► gen-tool-governance-matrix.ts ─► .trae/architecture/tool-governance-matrix.json
工具类声明（sandbox/risk/…）─┤                                     └─► 同名 .md（人读视图）
现有门禁/测试证据            ─┘
```

### 3.2 列定义（每工具一行，**不允许空结论**）

| 列 | 取值 | 来源 |
|---|---|---|
| `name` / `domain` / `registerWhen` | 工具名 / 域（file·shell·net·media·task·agent·mcp…）/ 无条件或 feature gate | loaders 表 |
| `effects` | `none` / `local` / `external` (+ op 覆盖) | `resolveToolEffect` |
| `sandboxLevel` | `none` / `readonly` / `file-io` / `execution`，或 `n/a(理由)` | 工具类声明 |
| `riskDeclared` / `riskDerived` / `riskSource` | 声明值 / 最终值 / `declared·derived·self-readonly·undeclared` | `deriveToolRiskClass` |
| `pathGuard` | `workspace` / `project` / `vfs` / `none(理由)` | 代码取证 + 负向测试 |
| `netGuard` | `ssrf+protocol` / `protocol` / `none` / `n-a` | 代码取证 |
| `execGuard` | `sandbox` / `safety-chain` / `n-a` | 代码取证 |
| `limits` | `timeout` / `maxResult` / `concurrency` | 声明值 |
| `audit` | `reason-registered` / `log-only` / `none` | 源码取证 |
| `evidence` | 测试文件或门禁 id | SUPPORT-LEVELS + tests |
| `verdict` | `pass` / `n-a+理由` / `gap:<id>` | 汇总 |

### 3.3 覆盖率起点（已取证，供矩阵首版核对）

| 分组 | 数量 | 工具 |
|---|---|---|
| **shell（执行类）** | 4 | `bash`、`powershell`、`code_run`、`repl`（`sandboxLevel='execution'`） |
| **external（对外可见）** | 15 | `agent`、`ask_user_question`、`bash`、`broadcast`、`browser`、`browser_vision`、`channel`、`code_run`、`computer_use`、`mcp_auth`、`mcp_tool`、`powershell`、`send_message`、`team_create`、`team_delete` |
| **write（本地状态）** | 34 | `brief`、`canvas`、`clipboard`、`config`、`create_project`、`cron`、`doc_generate`、`file_edit`、`file_write`、`image`、`image_generate`、`image_svg_generate`、`kanban`、`knowledge_save`、`lsp`、`monitor`、`music`、`notebook`、`pdf`、`plan`、`save_conversation`、`sessions`、`sessions_yield`、`skill`、`task_stop`、`task_list`、`todo_write`、`tts`、`tungsten`、`video`、`video_generate`、`vfs`、`worktree`、`write_project_file` |
| **read（只读）** | 19 | `agents_list`、`audio_play`、`file_convert`\*、`file_read`、`glob`、`grep`、`image_analysis`、`image_display`、`list_peers`、`mcp_resource`、`read_project_file`、`sleep`、`task_output`、`tool_search`、`trace_recording`、`video_analysis`、`video_display`、`web_fetch`\*、`web_search` |

\* `file_convert` 在 `docx` 模式下自报非只读 ⇒ 落 `undeclared`（ask），行为正确；矩阵需把这条"按入参分档"单独记一行。
\* `web_fetch` 的 `saveToFile` 形态是已被点名的缺口（见 G3）。

> 注：`cron` / `skill` / `task_list` / `vfs` 的只读子操作由 `byOperation` 覆盖，矩阵按 `工具级 + 子操作` 两行记录。

---

## 4. 已取证缺口（按严重度）

### G1 `computer_use`：桌面自动化无任何治理声明（P1 · **已关闭 2026-11-22**）

- 现状：`packages/tool-desktop` 内**零** `riskClass` / `sandboxLevel` / `checkPermissions` 覆盖
  （全包 grep 无命中；仅继承 `BaseTool` 默认 `checkPermissions`=allow、`getPath`=空串 ⇒ 无工具级约束）；
  仅靠 `TOOL_EFFECTS.computer_use = EXTERNAL` ⇒ 每次调用 ask。
- 风险点：`action` 含 `launchApp` / `keyboardType` / `keyPress` / `setClipboard`（`ComputerUseTool.ts:34-56`）。
  "本会话总是允许"按默认全参数指纹生效 ⇒ 批准一次 `screenshot` 不会串到 `launchApp`（好），
  但批准一次 `launchApp notepad` 后换应用名需重新批准（默认指纹含参数，可接受）。
  **真正缺的是"按 action 分档 + 危险 action 硬约束"**：目前无法表达"截图可放行、启动任意程序必须显式确认"。
- 计划：`riskClassFor(input)` 按 action 分档（截图/读窗口=read，键鼠/剪贴板=external，`launchApp`=external+参数守卫），
  并补 `launchApp` 的程序名白名单/黑名单（至少禁止 `cmd`/`powershell`/`wscript`/`mshta`）。

### G2 `browser`：只有字面量内网判断，缺 DNS / 元数据 / 混淆 IP 与重定向逐跳（P1 · **已关闭 2026-11-22**）

- 现状（修复前）：`PlaywrightDriver.ts:16-19` 明确"仅 http/https、不开放 evaluate"（好）；
  但 `isPrivateHost` 只认**字面量**私有 IP / `localhost` / `::1` ⇒ 缺
  DNS 解析到内网、阿里云元数据 `100.100.100.200`、十进制/十六进制混淆 IP、`.internal/.local`，
  且 `page.goto` 的重定向逐跳未校验。
- 对照：`web_fetch` 的 `checkSsrf` 已覆盖上述形态（含 DNS 解析 + 元数据 + 混淆 IP）。
- 计划：下沉到 `@openliri/infra/security/ssrf`（唯一事实源，R30 禁止 browser 反向 import app），
  导航前 `assertUrlAllowedDeep` + 路由拦截做**导航请求逐跳**校验；补负向测试。

### G3 `web_fetch`：`saveToFile` 写盘却仍自报只读（P1 · **已关闭 2026-11-22**）

- 现状：`TOOL_EFFECTS.web_fetch = NONE`（`toolEffects.ts:170`）；
  `isReadOnly()` 只看 HTTP method（`WebFetchTool.ts:161-164`），GET + `saveToFile:true` 仍返回 true；
  `saveToFile` 实际写 downloads 目录并注册 `FileRegistry`（`:507-553`）。
- 后果：风险派生为 `read` ⇒ **自动放行写盘**（路径固定、影响有限，但违反"read 不改状态"契约，
  且 `deriveToolRiskClass` 的"声明与自报冲突"护栏被自报值骗过）。
- 计划：`isReadOnly` 纳入 `saveToFile`；或 `riskClassFor(input)` 在 `saveToFile` 时返回 `write`。
  二选一即可，优先前者（不动风险引擎）。

### G4 执行类语义：`notebook` 的 `executeCell` 被按 write 放行（P1 · **已关闭 2026-11-22**）

- 复核结论（订正原表述）：`agent`（`external`）、`skill`（`write`）、`lsp`（`write`）**已有** `riskClass` 声明；
  `lsp` 的 `write` 是覆盖 `rename`/`format` 的保守档，保持不变。
- 真正的缺口在 **`notebook`**：整工具固定 `write`（WRITE_LOCAL），而 `executeCell` / `executeAllCells`
  执行任意代码 ⇒ 在会话 `auto-local` / 沙箱豁免下可能被自动放行。
- 修复：`riskClassFor(action)`（`execute*` ⇒ `shell`，其余 `write`）+ `sandboxLevel='execution'`；
  测试 `app/tests/tools/notebookRiskClass.test.ts`。

### G5 入口一致性：`outputSchema` 只在一条链校验（P2 · **已关闭 2026-11-22**）

- 现状（修复前）：`validateToolOutputShape` 仅 `ToolExecutor` 调用；主聊天链
  （`ToolExecutionService` → `ToolRegistry`）与 LRO 直调均不校验（校验本身不阻断，只标
  `metadata.outputSchemaError`）。
- 修复：纯函数下沉到 `packages/infra/src/utils/toolContract/outputSchemaValidation.ts`（LRO 禁止直连
  `@modules/tools`），三个执行入口共同调用；app 侧保留 re-export shim（既有单测路径零改动）。
- 边界：仍**不阻断**（仅标注 + warn），与既有语义一致。

### G6 直调点授权证据未固化（P2 · **已关闭 2026-11-22**）

逐点取证 16 个入口（`tool-execution-entrypoints.json`），结论：

| status | 数量 | 入口 |
|---|---:|---|
| `centralized` | 3 | ToolRegistry / ToolExecutor / OptimizedToolManagerUtils |
| `authorized` | 3 | LRO stepExecution / SubAgentEngine / PlanTool |
| `scoped-readonly` | 1 | LRO stepArtifacts（仅 file_read） |
| `caller-authorized` | 2 | DocPipeline（外层权限闸）/ domainSnapshotOps（video-task-handlers 先授权） |
| `unreachable` | 7 | `app/src/agent/**`（5 文件）、ExtendedToolExecutor、SmartToolIntegrator —— 静态取证无生产调用方 |

- **发现并修复**：`PlanTool` 的 command 分支此前直接 `bashTool.execute`，绕过权限模式/deny 规则；
  已与 tool 分支同源补 `authorizeToolCall`（ask/deny 均不执行）。
- **如实记录的残余风险**：DocPipeline 内层固定调用 `image_generate` / `doc_generate`，不单独授权 ⇒
  针对这两个工具的独立 deny/ask 规则不生效（受外层工具决策约束）。
- `unreachable` 不等于"可删"（CD07）：接入前必须先补授权；台账会在接入文件变化时提醒复核。

### G7 审计 reason 码只在 bash 域有登记（P2 · **已关闭 2026-11-22（重定范围）**）

- 复核结论：file / mcp 域**本来就没有** `metadata.reason` 码（拦截发生在权限层或 MCP server 侧，
  只体现在 error 文案）；network / desktop 有真实拦截点但没有机器可读码。
- 处置：只对**真实拦截点**补码并建表，不为空域凑数：
  - `ssrf_blocked`（`WebFetchTool` 的 SSRF 拦截）；
  - `tool_gate_disabled`（`ComputerUseTool` 功能开关关闭）；
  - bash 五门继续由 `tools/bash/commandGateRegistry.ts` 单独对账（不重复登记）。
- 门禁：`lint:tool-interception-reasons` 对扫描面做双向对账（未登记码 / 僵尸登记 / 来源未纳入扫描）。

### G8 审批指纹粒度（P2，评估项）

- 现状：仅 `file_write` / `file_edit` 声明 `approvalFingerprint`；bash/powershell 走命令哈希专用注册表。
- 其余 `external` 工具默认全参数指纹（最保守）。评估是否对 `channel` / `send_message` / `mcp_tool`
  引入"目标维度"指纹，避免每次改正文都重新批准。**先评估，不预设结论。**

---

## 5. 分阶段执行

### P0：矩阵 + 门禁（零行为变更，1–2 个提交）

| # | 任务 | 落点 | 验收 |
|---|---|---|---|
| P0-1 | 新增矩阵生成器 | `app/scripts/gen-tool-governance-matrix.ts` | 输出 69 行 JSON + Markdown；每行 `verdict` 非空 |
| P0-2 | 新增门禁 | `lint:tool-governance`（`--check` 逐字节比对 + 未登记工具 ERROR） | `app/package.json#ci` 与 `.github/workflows/ci.yml` 同步；`lint:gate-parity` 通过 |
| P0-3 | 入口清单 | `app/architecture/tool-execution-entrypoints.json` + 静态扫描 | 现存的直调点全部登记；未登记新增点 ⇒ 门禁失败 |
| P0-4 | 矩阵首版评审 | 矩阵中所有 `gap:*` 与 `n-a` 必须有人签字/理由 | 本文 §4 的 G1–G8 在矩阵里可检索 |

**P0 的交付价值**：从此"新增一个工具不声明、或改声明让风险档变了"都会在 CI 里被拦住 —— 这是"不再我说治理哪个才处理哪个"的机制保证。

### P1：高危缺口修复（每项独立提交 + 负向用例）

| # | 任务 | 验收 |
|---|---|---|
| P1-1 | `computer_use` 按 action 分档 + `launchApp` 参数守卫（G1） | 单测：`screenshot` 与 `launchApp cmd` 的 risk 不同；后者拒绝/必审批 |
| P1-2 | `browser` 复用 `checkSsrf`（含重定向逐跳）（G2） | 负向：127.0.0.1 / 169.254.169.254 / `file:` 被拒 |
| P1-3 | `web_fetch.saveToFile` 纳入 `isReadOnly`（G3） | 单测：GET+saveToFile ⇒ 非只读 ⇒ 风险 `undeclared`（ask） |
| P1-4 | 执行类标记补齐或显式 `n/a`（G4） | 矩阵中每个执行面工具有明确结论；`lint:tool-governance` 绿 |

### P2：一致性与证据（可并行）

| # | 任务 | 验收 |
|---|---|---|
| P2-1 | `outputSchema` 校验收敛到统一出口（G5） | 主聊天链路径上产出 `metadata.outputSchemaError` 的用例 |
| P2-2 | reason 码登记推广到 file/net/desktop/mcp（G7） | 每个域至少 1 条登记表 + 双向对账测试 |
| P2-3 | 审批指纹评估（G8） | 结论写入矩阵 `note`，要么实现要么显式"保持全参数" |
| P2-4 | SUPPORT-LEVELS 增加"治理维度证据"列 | `gen:support-levels --check` 通过 |

---

## 6. 验收与 Definition of Done

```bash
cd app
bun run typecheck
bun test tests/tools tests/permission tests/security
bun run lint:tool-governance
bun run lint:tool-risk
bun run lint:tool-schema
bun run lint:support-levels
bun run lint:permission-single-source
bun run lint:arch && bun run lint:infra
```

DoD：

1. 矩阵覆盖 **100%** 的 `TOOL_NAMES`（69）与运行期注册工具；无空 `verdict`；
2. 每条 `gap:*` 有关闭提交或"接受 + 理由 + 复核日期"；
3. 新增工具路径：`gen:tool-scaffold` 产出的模板自带声明字段，未填则 `lint:tool-governance` 失败；
4. P1 的四个缺口全部有负向测试；
5. `bun run ci` 全绿。

---

## 7. 明确不做

1. **不按工具名关键词猜风险**（CS02）；派生只走结构化元数据。
2. **不改审批默认语义**（read 放行 / write·external·shell·undeclared 询问），除非单独立项。
3. **不与 [tool-governance-merge-plan.md](./tool-governance-merge-plan.md) 重复**（包化、profile、可见面）。
4. **不以"零调用/低覆盖"为删除依据**（CD07）。
5. **不新增第二套风险清单**：矩阵是**派生结果的快照**，不是新的事实源。

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 矩阵把"派生结果"固化成第二事实源 | 生成器只读；`--check` 只比对，不写回；改声明触发 diff 属预期 |
| P1 给 `computer_use` 分档后"截图也要审批" | 分档只让**更宽**的动作升级；截图维持 `read`（与现状一致）才可合入 |
| `browser` SSRF 误伤本地开发页面 | 复用 `checkSsrf` 的既有豁免口径（如需 `LIRI_ALLOW_LOCAL_NET` 之类的显式开关，先评审再定） |
| 门禁过重拖慢 CI | 矩阵生成 + 比对控制 < 3s（与 `gen-support-levels` 同量级） |

---

## 9. 待用户裁定（计划评审时的开放问题）

1. ~~G4：`agent` / `skill` / `lsp` / `notebook` 补 `riskClass` 还是补 `sandboxLevel`？~~
   **已裁定（2026-11-22）**：按建议补 `riskClass`；复核后实际只需修 `notebook`（动态 `shell` + execution 位），
   `agent`/`skill`/`lsp` 原声明已正确（见 G4）。
2. ~~G8：`channel` / `send_message` / `mcp_tool` 是否引入"目标维度"审批指纹？~~
   **评估完成（2026-11-22）**：维持**全参数指纹**（最保守）。理由：这三类工具的"目标"与"危险动作"
   同处参数面（如 MCP tool 的 `args`、`send_message` 的正文），拆目标维度会把"同目标换动作"也放行；
   现有 `ApprovalFingerprint` 默认值已是全参数稳定 JSON，无需改代码。复审条件：真机出现同一目标下
   审批 churn（同一工具/目标反复批准 > 5 次/日）时再立项。
3. ~~P2-1：`outputSchema` 校验是否值得进主聊天链（不阻断、仅观测）？~~
   **已实施（见 G5/P2 记录）**：三个执行入口统一。
4. `browser` 的本地网络访问是否需要显式开关（还是直接按 SSRF 一律拒绝）？

---

## 10. P0 实施记录（2026-11-22）

### 10.1 产物与落点

| 项 | 落点 | 说明 |
|---|---|---|
| 生成器 | `app/scripts/gen-tool-governance.ts` | 实例化全部内置工具，产出矩阵 + 校验台账；`--check` 只比对不写盘 |
| 纯判据 | `app/scripts/lib/toolGovernanceRules.ts` | 缺口规则 / 台账校验 / 例外校验（单测零副作用） |
| 矩阵（机器可读） | `.trae/architecture/tool-governance-matrix.json` | 69 工具 × 声明/派生风险/上限/缺口/verdict |
| 矩阵（人读） | `.trae/architecture/tool-governance-matrix.md` | 按风险档分组 |
| 例外表 | `.trae/architecture/tool-governance-exceptions.json` | `acceptedGaps`（矩阵可检出）+ `knownRisks`（G1–G4/G9，人工确认） |
| 执行入口台账 | `.trae/architecture/tool-execution-entrypoints.json` | `app/src/**` 每处 `tool.execute(` 的 status / authorizedBy / note |
| 门禁脚本 | `gen:tool-governance` / `lint:tool-governance` | `app/package.json`；已进 `ci` 聚合与 `.github/workflows/ci.yml` |
| 预提交 | `app/scripts/setup-git-hooks.ts` → `.git/hooks/pre-commit` | 与 `params:check` 同组（生成物门禁） |
| 单测 | `app/tests/tools/toolGovernanceGate.test.ts` | 10 项：缺口规则 / 台账校验 / 例外校验 |

### 10.2 首版矩阵结论

- **69 工具**：`pass 67` · `accepted-gap 2`（`powershell` / `code_run` 的 `no-result-limit`，G9）· `gap 0`。
- `riskUndeclared = 0`：全部工具都能由声明 / effects / sandboxLevel 推出风险档（无 `undeclared`）。
- 覆盖修正：`checkPermissions` / `getPath` 在 `BaseTool` 有**默认实现**（直接 allow / 返回空串），
  矩阵因此区分 `checkPermissionsOverridden` / `getPathOverridden` —— 首版只有 **Glob / Grep** 覆盖了
  `checkPermissions`（`code_analysis` 非 BaseTool，另计），与计划 §4 的"3 个"一致。
- 未实例化名字 18 个（flag-gated / 影子工具）在矩阵 `declaredNotInstantiated` 中如实列出（WARN，不阻断）。

### 10.3 执行入口台账（16 文件 / 20 处）

| status | 数量 | 文件 |
|---|---|---|
| `centralized` | 3 | `ToolRegistry`、`ToolExecutor`、`OptimizedToolManagerUtils` |
| `authorized` | 1 | `tasks/lro/stepExecution`（`authorizeLroToolCall`） |
| `scoped-readonly` | 1 | `tasks/lro/stepArtifacts`（仅 `file_read` 写后读回） |
| `needs-review` | 11 | agent 循环/策略/批量、子代理、PlanTool、ExtendedToolExecutor、SmartToolIntegrator、Doc 流水线、domainSnapshotOps |

`needs-review` 全部按 G6 登记了待取证说明；新增直调点或出现次数变化 ⇒ 门禁失败（必须先复核授权）。

### 10.4 验收

| 命令 | 结果 |
|---|---|
| `cd app && bun run gen:tool-governance` | ✅ 69 工具 / pass 67 / accepted 2 / gap 0 |
| `cd app && bun run lint:tool-governance` | ✅ 矩阵与事实源一致；台账完整 |
| `cd app && bun test tests/tools/toolGovernanceGate.test.ts` | ✅ 10 pass |
| `cd app && bun run typecheck` | ✅ |
| `cd app && bun run lint:exit` | ✅（入口脚本显式退出） |
| `cd .. && bun run scripts/lint-gate-parity.ts` | ✅ 87 条门禁：CI 覆盖 86 · 豁免 1 · 缺失 0 |

### 10.5 未做（按计划留给 P1/P2）

~~G1 … G9~~ 全部关闭（见 §11/§12）；**本计划无剩余待办**。

---

## 11. P1 实施记录（2026-11-22）

### P1-1 `computer_use`：按 action 分档 + `launchApp` 参数守卫（G1）

| 项 | 落点 |
|---|---|
| 风险分档 | `ComputerUseTool.riskClassFor(input)`：截图 / 读窗口 / 读剪贴板 / 读坐标 ⇒ `read`；`screenshot+analyze` 与键鼠/写剪贴板/`launchApp` ⇒ `external` |
| 参数守卫 | `isDeniedLaunchTarget()` + `validateInput()` + `handleLaunchApp()` 同源兜底：命令解释器 / 脚本宿主 / 下载器 / 计划任务 / 系统管理 LOLBin，以及 `.bat/.cmd/.ps1/.vbs/.hta/.msi/.reg` 等扩展名 |
| 测试 | `app/tests/tools/computerUseGovernance.test.ts`（32 pass）：分档矩阵 + 13 个禁止目标 + 3 个放行目标 |

### P1-2 `browser`：SSRF 归属下沉 + 导航逐跳校验（G2）

| 项 | 落点 |
|---|---|
| 唯一事实源 | `packages/infra/src/security/ssrf.ts`（由 app 下沉；`app/src/tools/WebFetchTool/ssrf.ts` 改为 re-export shim，既有 import 零改动） |
| 深校验 | `assertUrlAllowedDeep()`：同步校验（scheme / 白名单 / 字面量内网）之上叠加 `checkSsrf`（DNS / 元数据 / 混淆 IP / 内部 TLD） |
| 重定向 | `guardNavigation()`：`page.route('**/*')` 对**导航请求**逐个校验并 `abort('blockedbyclient')`；`allowPrivateNetwork=true` 显式豁免 |
| 边界（如实） | 只校验 `isNavigationRequest()`；页面**子资源**未覆盖（剩余风险，需另行立项） |
| 测试 | `app/tests/tools/browserSsrf.test.ts`（10 pass）：127.0.0.1 / localhost / 169.254.169.254 / 100.100.100.200 / 十进制与十六进制 IP / `.local` / `.internal` / `file:` / `javascript:` 全部阻断；公网放行；显式豁免与域名白名单生效 |

### P1-3 `web_fetch`：`saveToFile` 纳入只读判定（G3）

- `WebFetchTool.isReadOnly()`：`saveToFile === true` ⇒ `false`；`isConcurrencySafe()` 随同。
- 效果：`deriveToolRiskClass(tool, { saveToFile: true })` 不再落 `read`（自动放行），而为 `undeclared`（ask）。
- 测试：`app/tests/tools/webFetchReadOnly.test.ts`（4 pass）。

### P1-4 `notebook`：执行单元格按 shell 分档（G4）

- `NotebookToolAdapter`：`riskClassFor(action)`（`executeCell` / `executeAllCells` ⇒ `shell`，其余 ⇒ `write`）
  + `sandboxLevel='execution'`（与"执行任意代码"自洽；`ToolExecutor` 的 command 预检不受影响）。
- 复核订正：`agent`（external）/ `skill`（write）/ `lsp`（write）原声明已存在，本次不改。
- 测试：`app/tests/tools/notebookRiskClass.test.ts`（3 pass）。

### P1 验收

| 命令 | 结果 |
|---|---|
| `bun test tests/tools/{computerUseGovernance,browserSsrf,webFetchReadOnly,notebookRiskClass}.test.ts` | ✅ 49 pass / 0 fail |
| `bun test tests/tools/webFetchSsrf.test.ts`（shim 回归） | ✅ |
| `bun run gen:tool-governance` | ✅ 69 工具 / pass 67 / accepted 2（powershell·code_run 的 G9）/ gap 0 |
| `bun run typecheck` / 门禁 | ✅（见提交记录） |

---

## 12. P2 实施记录（2026-11-22）

### P2-1 `outputSchema` 校验收敛到三个执行入口（G5）

| 项 | 落点 |
|---|---|
| 唯一实现 | `packages/infra/src/utils/toolContract/outputSchemaValidation.ts`（纯函数；与 `Tool`/`ToolResult` 同目录） |
| 入口接线 | `ToolExecutor`（既有·改为 re-export + 调用）、`ToolRegistry.executeTool`、LRO `stepExecution.runAuthorizedToolCall` |
| 语义 | 不阻断；失败仅写 `metadata.outputSchemaError` + warn（与既有 ToolExecutor 口径一致） |
| 兼容 | `app/src/tools/outputSchemaValidation.ts` 为 re-export shim ⇒ 既有 `@modules/tools/ToolExecutor` 单测 import 零改动 |
| 测试 | `app/tests/tools/outputSchemaWiring.test.ts`（4 项结构守卫：三入口都调用 + LRO 不直连 `@modules/tools`） |

### P2-3 审批指纹评估（G8，仅评估不改代码）

**结论**：`channel` / `send_message` / `mcp_tool` **维持全参数指纹**。

- 三类工具的"目标"与"危险动作"同处参数面（MCP `args`、消息正文），按目标拆指纹会把"同目标换动作"也放行；
- 现有默认指纹（全参数稳定 JSON）已是三者中最保守的可用档；
- 复审条件：真机出现"同一工具/目标被反复批准（> 5 次/日）"的审批 churn 时再立项。

### P2-2 拦截 reason 码登记（G7）

| 项 | 落点 |
|---|---|
| 登记表 | `app/src/tools/governance/interceptionReasons.ts`（码 → 域 → 来源文件；扫描面由表派生） |
| 补码 | `ssrf_blocked`（WebFetch SSRF）、`tool_gate_disabled`（ComputerUse 开关关闭），均写入 `metadata.reason` |
| 门禁 | `app/scripts/lint-tool-interception-reasons.ts` → `lint:tool-interception-reasons`（`ci` + CI step） |
| 对账 | 未登记码 / 僵尸登记 / 来源未纳入扫描 ⇒ 失败；bash 域仍由 `commandGateRegistry` 负责 |
| 测试 | `app/tests/tools/interceptionReasons.test.ts`（6 项纯判据） |

### P2-4 `SUPPORT-LEVELS` 增加「治理维度证据」列

- `app/scripts/gen-support-levels.ts`：读取 `.trae/architecture/tool-governance-matrix.json`（只读既有生成物），
  为通道 / 工具表新增一列「风险档 · 结论」（acceptedGap 附带 riskId）；通道无矩阵行 ⇒ `—`。
- fail-closed：矩阵缺失 / 解析失败 ⇒ 抛错（AR-3，不静默降级为"无治理证据"）。
- 台账已重生（`lint:support-levels --check` 通过）。

### G9 执行类结果上限（powershell / code_run）

- 两个工具显式声明 `maxResultSizeChars = 100000`（与 `bash` 一致），由统一截断链路兜住超长输出。
- 治理矩阵：`no-result-limit` 缺口消失 ⇒ **69 工具 / pass 69 / accepted 0 / gap 0**；例外表清空。
- 行为变化（如实）：两者现在受统一出参截断约束（上限 100k 字符，与 bash 同口径）。

### P2-5 直调点授权取证（G6）

| 项 | 落点 |
|---|---|
| 台账 | `.trae/architecture/tool-execution-entrypoints.json`：16 入口全部给出结论（3 centralized / 3 authorized / 1 scoped-readonly / 2 caller-authorized / 7 unreachable） |
| 状态扩展 | `app/scripts/lib/toolGovernanceRules.ts`：新增 `caller-authorized`（必须写 authorizedBy）与 `unreachable`（必须写无调用方证据） |
| 代码修复 | `PlanTool` command 分支补 `authorizeToolCall`（此前直接 `bashTool.execute`，绕过权限模式/deny 规则） |
| 测试 | `toolGovernanceGate.test.ts` 新增两类状态校验（14 pass） |
| 残余风险 | DocPipeline 内层 `image_generate` / `doc_generate` 不单独授权（受外层工具决策约束，已记录） |

### P2 收口

G1–G9 与 P2-4/P2-5 全部关闭。**二次复查又发现新遗漏**（见 §13）：F1/F2 已修复，
F3–F10 仍待办 ⇒ 本节原「本计划无剩余待办」表述已按事实订正。
后续新增工具 / 新直调点由 `lint:tool-governance`、`lint:tool-interception-reasons`、
`lint:support-levels` 三道门禁持续约束。

---

## 13. 二次复查（2026-11-22）

复查范围：执行面 / 权限链 / 资源面（只读审计）。结论：G1–G9 的静态声明覆盖成立，
但**判定顺序**与**运行期派生一致性**未被门禁覆盖，存在 fail-open。

### 13.1 已修复

| ID | 问题 | 修复落点 | 测试 |
|---|---|---|---|
| F1 | `McpToolWrapper.isReadOnly()` **恒 true** ⇒ 动态 MCP 工具派生为 `read` ⇒ 默认档自动放行 | `SerializedTool.annotations` 透传（`client.ts`）；包装器只认 `readOnlyHint === true`，缺省 ⇒ `undeclared` ⇒ ask；并发安全随只读 | `app/tests/services/mcp/mcpToolWrapperRisk.test.ts`（5 项） |
| F2 | 安全白名单排在用户 deny / ask **之前**，且关键词用 `includes` 子串匹配（`budget_set` 含 `get`） | `handleDefault` / `handleAuto` 的白名单降到全部 deny / ask 之后；关键词改为按分隔符**整段**匹配；`server__tool` 不参与名字猜测 | `app/tests/permission/allowlistOrdering.test.ts`（7 项） |
| F3 | 别名调用按别名判定 ⇒ 按真名配置的 `tool_rules` 不命中；只传字符串名 ⇒ 风险退回名字启发式 | `toolPermission` 在 `context.tool` 存在时以 `tool.name`（真名）判定；`CodeRunner` 改走 `authorizeToolCall` 并传工具对象；CoreAPI 路径解析注册工具（`getInner().getTool` 含别名解析）后传入 | `app/tests/permission/aliasCanonicalName.test.ts`（2 项） |
| F4 | `maxResultSizeChars` 只被透传/展示，真实截断一律用全局 50k | `ToolResultPersister` 新增 `resolveSingleResultLimit`，内部经 `getToolRegistry()` 读取声明（缺省 50k）；单轮 200k 聚合仍为硬兜底 | `app/tests/tools/toolResultLimit.test.ts`（3 项） |
| F5 | 超时仅 chat 链且不取消底层；Registry / ToolManager / LRO 无超时 | 新增唯一实现 `app/src/tools/utils/toolDeadline.ts`（超时 abort 派生 controller、父取消转发）；接入 `ToolRegistry`、`ToolManager`、LRO `runAuthorizedToolCall`；缺省值取常量真源 `DEFAULT_TOOL_EXEC_TIMEOUT_MS`（`LIRI_TOOL_TIMEOUT_MS` 原 30s 且零消费者 ⇒ 对齐 chat 链 300s） | `app/tests/tools/toolDeadline.test.ts`（3 项） |
| F6 | 真实拦截点缺 `metadata.reason` | 新增 4 码并登记：`path_guard_blocked` / `workspace_escape_blocked` / `policy_denied` / `mcp_not_connected`；`recordSkippedToolCall` 透传 metadata | `interceptionReasons.test.ts` 追加 1 项 |
| F7 | `coordinator.agentTool.execute` 无授权 | 取证：唯一调用方是 `sessionAgentOps.addAgentTask`（HTTP 任务 API）；子代理内工具由 `SubAgentEngine` 授权 ⇒ **非独立工具入口**，不新增判定 | — |
| F8 | `MediaPlugin` 直调 image 工具、传空 context | 取证：`generateImage` / `analyzeImage` **无生产调用方**（未接线插件兼容接口）⇒ 非模型工具面 | — |
| F9 | `LSPToolIntegration` 绕过 Registry/权限链 | 取证：`createLSPToolIntegration` 在 `tools/lsp/**` 外**无生产消费者**（sidecar spec 已记录）；**接线前必须补授权** | — |
| F10 | 写同资源工具标记并发安全 | `media_delete` / `media_delete_batch` / `knowledge_save` / `mcp_tool` 改为 `isConcurrencySafe=false`；图片族保持（残余风险：同输出路径竞争，模型通常按不同路径调用） | `app/tests/tools/concurrencySafety.test.ts`（4 项） |
| F11 | 无人值守读静态 `FEATURE_FLAGS` ⇒ env 开关不生效 | `UnattendedModeManager.isUnattended()` 改走 `feature('UNATTENDED_MODE')`（与 `infra/utils/unattendedAnswers` 同口径）；`setEnabled` 用实例覆盖（优先） | `app/tests/runtime/unattendedModeManager.test.ts`（2 项） |
| F12 | bypass 档无 killswitch | `handleBypassPermissions` 先查 `bypassPermissionsKillswitch.isDisabled()` 与 `PERMISSION_BYPASS_DISABLED=true` ⇒ deny；未禁用保持原行为 | `app/tests/permission/bypassKillswitch.test.ts`（3 项） |
| F13 | `ToolManager.executeTool` 授权按入参名（别名）且不传工具对象 | 改为 `toolName: tool.name` + `context.tool`（F3 的同类遗漏，本入口在 ToolManager 内） | — |
| F14 | 禁用工具只在 ToolManager 私有集合 ⇒ Registry 可执行；别名调用绕过 | 禁用状态收口到 `ToolRegistry`（真名/别名归一）；`executeTool` fail-closed 并写 `metadata.reason='tool_disabled'`；ToolManager 委托 Registry | `app/tests/tools/registryDisabledTool.test.ts`（3 项） |
| F15 | `ToolExecutor` 两条路径无统一超时 | 治理路径与遗留路径均接入 `runWithToolDeadline`（派发 controller、父取消转发） | — |
| F16 | `ToolExecutor` 无禁用检查 | 入口 fail-closed：`isToolDisabled` 或 `isEnabled() === false` ⇒ 拒绝并写 `tool_disabled` | — |
| F17 | 子代理授权用模型传入名且不传工具对象 | 改真名 + `context.tool`；执行接入统一超时 | — |
| F18 | `PlanTool` 授权不传工具对象 | `context.tool` 补齐（风险按声明式派生） | — |
| F19 | `ToolRegistry` 不查工具自报 `isEnabled()` | 与 F14 合并为同一 fail-closed 判定 | `registryDisabledTool.test.ts`（+1 项） |
| F20 | `ToolExecutor` 治理 / hooks 上下文写死 `permissionMode: 'auto'` | 改为 `PermissionMode.DEFAULT`（最保守）；避免 plan / dontAsk 被当作 auto 评估策略 | — |
| F23 | `DocPipeline` 内层工具不单独授权 | `image_generate` / `doc_generate` 补 `authorizeToolCall`（真名 + tool 对象） | — |
| F22 | `shieldGuard` 拦截无 reason 码 | 新增 `path_shield_blocked` 并登记（file 域） | 码表对账（lint） |
| F21 | `onToolLoaded` 动态 `require` 拼接工具名（潜在 RCE） | 改为 `getToolRegistry().getTool()` 查询；未注册不回调 | — |
| F24 | 拦截码提取只认单引号（双引号写法绕过对账） | 正则支持单/双引号；新增双引号用例 | `interceptionReasons.test.ts`（+1 项） |
| F25 | 入口台账只扫 `tool.execute(`，漏 `xxxTool.execute(` | 扫描面扩为 `(?:\w*[Tt]ool\|tool)\.execute\(`（排除日志文案空参形态）；补登 MediaPlugin / Config / ToolLazyWrapper，PlanTool occurrences 1→2 | `lint:tool-governance` 通过 |
| F26 | 懒加载包装器 `isReadOnly` 用注册快照 | 已加载时委托真身（未加载仍用快照，避免权限判定触发懒加载） | — |
| F27 | 拦截码扫描面漏 `ToolExecutor.ts` | `tool_disabled` 的 sources 补 ToolExecutor（该文件 F16 起写该码） | `lint:tool-interception-reasons` |
| F28 | 权限拒绝点无 `metadata.reason` | 新增 `permission_ask` / `permission_denied`；ToolManager / PlanTool（tool+command）/ CoreAPI 路径写入；HTTP DTO 补可选 metadata | 码表对账（lint） |
| F29 | `ToolExecutor` 安全闸 / hooks 阻断无码 | 新增 `security_blocked` / `hook_blocked` 并写入 | 码表对账（lint） |
| F30 | 持久化侧结果上限仍是统一 50k | `createToolResultMessage` 落 `metadata.toolName`；`shrinkToolResultMessageForPersistence` 按工具声明解析上限（缺省 50k） | — |

验证：`typecheck` 通过；全量 `bun run ci` **13723 pass / 42 skip / 0 fail**；
`lint:tool-governance`（69 pass / gap 0，矩阵已重生）、`lint:tool-interception-reasons`、`lint:arch`、`lint:consts` 通过。

### 13.2 遗留项台账（F / SG；2026-11-27 四项目均已处置）

| ID | 问题 |
|---|---|
| — | F1–F30 已全部处理（F7/F8/F9 取证为非入口/未接线，接线前必须补授权；其余已修复） |
| SG-1 | **已修复（2026-11-27）**：`notebook` / `repl` 的执行面已接入平台写隔离 —— `REPLToolImpl.startREPL` 先经 `repl/replSandboxSpawn.planReplSandboxSpawn` 计算 spawn 形态：Linux = `landlock-run <规则> -- <解释器>…`、macOS = `sandbox-exec -p <SBPL> -- <解释器>…`、Windows = `win-sandbox-run.exe --timeout-ms 0 -- <exe>…`（Low IL，会话期临时降完整性标签，`stopREPL` / 进程退出时恢复）。三种包裹都**透传 stdio** ⇒ marker 协议与跨执行状态不变。写白名单与 bash **同源**（`buildShellManagedWritableDirs` + `buildBashLandlockPolicy`，CS01）。不可用时：`failClosed=false` 降级普通 spawn 并 WARN（与 `code_run` 同口径）；`failClosed=true` ⇒ `refuse`（`SG1_REPL_SANDBOX_UNENFORCEABLE`）。取证：`app/tests/tools/replSandboxSpawn.test.ts`（16 项）+ `repl.integration.test.ts` 真机双向断言（工作区可写 / 家目录根写入被拒，Windows 实测通过）+ macOS `verify:sandbox-macos` 第 ⑥ 项。**Windows `.cmd/.bat`（如 `npx`）已补齐（2026-11-27）**：经 `cmd.exe /d /s /c` + 环境变量转交（`LIRI_REPL_CMD`），参数按 MSVCRT 规则加引号（含空格/双引号的值保真，`& | < > ^` 落引号内；仅 `%`/换行仍降级），真机冒烟 `exit=0` 通过；同批修掉 Low IL 授权链的两个真问题（`(IO)` 标签误判、降级了恢复不了的 High/System ⇒ 改为跳过），详见 `.trae/specs/windows-sandbox.md` §8.4 |
| SG-2 | `notebook` 的 `path`（create/save/export 落点）已于 2026-11-27 纳入权限层写闸（`WRITE_PATH_GATED_TOOLS`），受保护路径 deny × 五档 |
| SG-3 | **已修复（2026-11-27）**：REPL 进程生命周期 —— ①子进程此前**完全不在** `ProcessRegistry`（`/v1/sandbox/status` 的 `processStats` 看不到 notebook/repl 的执行进程）⇒ 现 `startREPL` 以 `status=running` 登记、自然退出 `completed` / spawn 失败 `error` / `stopREPL` `killed` / 执行超时 `timed_out` 收敛（幂等）；②`REPLSessionManager.cleanupExpiredSessions` 是**只删登记、不杀进程**的零调用实现 ⇒ 收敛为纯查询 `collectExpiredSessions` + `REPLToolImpl.reclaimIdleSessions`（查询 → `stopREPL`：kill + 收终态 + 释放 Windows 会话授权），`NotebookToolImpl` 的闲置回收改为复用它。取证：`app/tests/tools/replSessionLifecycle.test.ts`（8 项，含真实 spawn 的 running→killed） |
| SG-4 | **已修复（2026-11-27，A 组状态面）**：状态面此前**说不清"靠什么隔离"** —— `mode` 只有 `landlock/container/ssh/pty/none` ⇒ macOS Seatbelt / Windows Low IL 在状态页与启动日志里一律看起来像"没隔离"。现新增**后端名**（单一判据 `resolveShellWriteIsolationBackend`，`none` ⇔ 未生效）：进 `SandboxExecutionSignal.shellWriteIsolation`、`SandboxPosture.shellWriteIsolation`、`GET /v1/sandbox/status` 的 `posture.shellWriteIsolation`（同时补齐 kernel 契约里漏登记的 `bashSandboxReason` / `shellWriteIsolated`），设置页显示「写隔离后端：Landlock / Seatbelt / Low IL」。**能力探测细节**（`posture.capabilities`：`platform` / `available` / `reasonCode` / `reason` / Windows `runnable`）一并透出 ⇒ "为什么没隔离"可从 API/页面直接看到（不看总开关，总开关见 `landlock.enabled`）。⚠️ **刻意不改 `mode`**：它是沙箱豁免 S1 的判据（`isSandboxSignalUsable` 要求非 `none`），把"仅写隔离"标成非 `none` 会放宽审批。取证：`app/tests/sandbox/shellWriteIsolationBackend.test.ts`（13 项）+ `sandboxPosture` / `sandboxExecutionSignal` 断言 |

### 13.3 G9 结论订正（如实）

G9 原写「统一截断链路兜住超长输出」**不成立**：`maxResultSizeChars` 此前只被
`ToolFactory` 透传与 `tools info` 展示。F4 已把**上下文侧**单条上限接线到工具声明
（`ToolResultPersister.resolveSingleResultLimit`）；**持久化侧**（`shrinkToolResult…`）
仍用统一 50k 阈值（防磁盘膨胀，未按工具区分）。

### 13.4 门禁缺口（建议）

现有门禁只校验「声明是否齐全」，不校验「判定顺序」与「运行期派生一致性」。建议补：

1. 无 `TOOL_EFFECTS` 条目的动态工具（MCP / 插件）**禁止**用 `isReadOnly` 兜底放行；
2. `deny` 必须先于 allowlist 的顺序断言（或由单测锁住）。


