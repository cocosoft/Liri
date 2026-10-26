# 熔断分型与"环境阻塞"终止设计（LRO-09）

> 状态：**已实施（2026-10-26：步骤 1a–4 + 台账）** ｜ 日期：2026-10-26
> 来源：`dev_docs/20261026/长程任务失败排查工作计划-20261026.md` §3-R3 / §5-LRO-09
> 证据：`dev_docs/20261026/证据/`（transcript + 失败窗口日志 + `tool_rules.json`）
> 约束：分类**只能**基于结构化字段（CS02 禁止用错误字符串做状态判断）；删除/停用走 CD01–CD07。

---

## 1. 问题（实测，不是假设）

一次"长程任务"在第 0 个产物前被熔断：

| 时刻(UTC) | 事实 |
|---|---|
| 04:17:23 / :25 / :27 | 同一 `file_write` 连续 3 次 `Denied by rule from userSettings` |
| 04:17:27 | `reActLoop:circuit_breaker triggered`（`consecutiveInvalidTurns: 3`，`max: 3`） |

**4 秒内结束**，而根因是**环境层不可自愈的拒绝**（`tool_rules.json` 里同指纹 allow+deny 冲突）。
`checkCircuitBreaker()` 只看 `results.every(r => r.status === 'error')`，不区分：

- 模型输出了非法 tool_call（**该重试/该收**）；
- 权限规则拒绝（**重试一万次也一样**）；
- 安全分析器拦截（同上）；
- 工具真的报错（可能可恢复）。

⇒ 三类语义被塞进同一个预算，最不可自愈的那类反而**最快**烧完预算。

---

## 2. 现状（代码事实）

| 位置 | 现状 |
|---|---|
| `query/ReActLoop.ts:261-280` | `ToolResultEntry = { toolCallId, name, status: 'success'|'error'|'aborted'|'timeout', output?, error? }` —— **没有失败分类字段** |
| `query/ReActLoop.ts:714-747` | `checkCircuitBreaker()`：`allInvalid = every(status==='error')` → `consecutiveInvalidTurns++` → 达 `maxConsecutiveInvalidTurns`（默认 3）熔断 |
| `query/ReActLoop.ts:1217-1239` | 熔断置 `phase='circuit_breaker'`；文案 = `circuit_breaker: consecutive invalid turns exceeded（最近失败：<tool> — <error 前 160 字>）` |
| `chat/ReActToolLoop.ts:843-862` | 被 PathGuard/审批跳过的调用**回填 `status:'error'`** ⇒ 计入 invalid turn |
| `permission/types/PermissionDecision.ts:24-44` | 决策只有 `type/reason/rule?/context?`；`createDenyDecision()` 在 `PermissionManager.ts:614-617` **只传 reason、不传 rule** ⇒ **ruleId 在上游就丢了** |
| `chat/terminationOutput.ts:169-185` | `error` 族 5 类共用"透传 lastError"策略；新增 `error` 类相位**必须**同批写 `state.lastError`，否则正文为空被判空消息拒持久化 |

---

## 3. 目标 / 非目标

**目标**
1. 把"环境阻塞"从"模型无效输出"里**分出来**，各自独立预算；
2. 环境阻塞时**立刻给出可执行结论**（哪条规则/哪个开关/如何放行），而不是让人看 `circuit_breaker`；
3. 终止原因如实落 `finishReason`，下游可统计；
4. 权限拒绝**落结构化事件**（当前只有工具结果文本）。

**非目标**
- 不改 `maxConsecutiveInvalidTurns` 的既有语义与默认值（3）；
- 不自动修改用户权限规则（只给建议 + 一键入口）；
- 不重写审批/Inbox 体系（`Inbox unavailable` 的修复属另一议题）；
- 不做"字符串识别失败类型"（**明令禁止**，见 CS02）。

---

## 4. 设计

### 4.1 失败分类（新字段）

`ToolResultEntry` 增加**可选**字段（加法，不破坏既有构造点）：

```ts
export type ToolFailureKind =
  | 'permission_denied'   // 权限规则/审批拒绝（含 Inbox 不可用降级 ask）
  | 'safety_blocked'      // 安全分析器 / PathGuard / 预处理拦截
  | 'env_unavailable'     // 依赖缺失、能力未就绪（如沙箱 helper 不可用）
  | 'tool_error';         // 工具自身执行失败（可能可恢复）

export interface ToolResultEntry {
  // …既有字段…
  /** 失败分类（仅 status==='error' 时有意义；缺省 = 未分类，按模型无效输出计） */
  failureKind?: ToolFailureKind;
}
```

**谁写这个字段（按生产者，不做字符串解析）**

| 生产者 | 写入值 | 依据 |
|---|---|---|
| 权限决策拒绝（`PermissionChecker` → `ToolExecutionService`） | `permission_denied` | 决策对象是 `DENY` |
| 审批 `ask` 但 Inbox 不可用 | `permission_denied`（附 `reason: 'inbox_unavailable'` 到 decision.context） | `PermissionChecker.ts:693-699` |
| `bashSecurityGate` / PowerShell 允许列表 / PathGuard 跳过 | `safety_blocked` | 各 gate 返回结构化 `reason`（已有 `security_analyzer_deny` 等枚举） |
| 沙箱/依赖探测失败（如 `code_run` failClosed） | `env_unavailable` | 现有 `status:'security-rejected'` 分支 |
| 工具 execute 抛错 | `tool_error` | 兜底 |

> 关键：**不解析 `error` 文本**。文本只用于展示，分类走类型。

### 4.2 双预算计数

`ReActLoop` 内拆两个计数器（互不污染）：

```
consecutiveInvalidTurns        // 既有：模型无效输出 / 未分类失败
consecutiveBlockedTurns        // 新增：permission_denied | safety_blocked | env_unavailable

每轮结束（actResult）：
  非"全部失败"（含 0 条结果）      ⇒ 两者都清零（既有 invalid 语义只对全失败计数，保持不动）
  全部失败且全为"阻塞类"           ⇒ blocked++ ；invalid 保持（不清零，避免掩盖上一轮模型错误）
  全部失败但含 tool_error / 未分类 ⇒ invalid++ ；blocked 保持
```

> 实施注记（2026-10-26）：分型判定落在 `query/ReActLoop.ts` 的 `classifyTurn()` 上——
> 它依赖 `ToolResultEntry`，而 `lint:state-ratchet` 会把"新文件里出现已登记状态词汇"
> （`error` / `blocked`）判为未报备新增 ⇒ 与 `ToolResultEntry` 同文件是最小可过门禁的落点。

- `maxConsecutiveBlockedTurns` **默认 2**（比 3 更早收口：环境阻塞的第二次就足以确认"不是偶发"）。
- 触发顺序：先判 `blocked`（更具体），再判 `invalid`（既有语义不变）。

### 4.3 新终止原因 `environment_blocked`

- `TerminationReason` 增加 `'environment_blocked'`；
- `terminationOutput.ts` 在 `error` 族分支组里加一行，文案骨架：

```
本轮无法继续：<k> 个工具调用被环境拦截（连续 <n> 轮），继续重试不会改变结果。

- file_write → permission_denied：规则 rule_1792970457555_b25ac5b1e（deny，来源 tool_rules.json）
  解除：设置 → 权限 → 工具规则，删除该条；或把该路径加入允许列表
- bash → safety_blocked：security_analyzer_deny（命令 `node -v`）
  解除：见「安全 → 命令允许列表」
```

> **强制**：该分支必须同批写 `state.lastError`（否则正文为空 ⇒ 被空消息护栏拒持久化，见 §2 最后一行）。

### 4.4 决策可解释（LRO-07 的最小交集）

- `createDenyDecision(reason, rule)` **把命中的 rule 一并传入**（`PermissionManager.ts:614` 现只传 reason）；
- `PermissionDecision.context` 增加 `{ ruleId, toolName, inputFingerprint, sourceKind }`；
- 工具结果文本 = `Permission denied: <reason> [rule=<ruleId>]`；
- **sourceKind 不许伪造成 `userSettings`**：真实来源是 `tool_rules.json` 的规则存储，
  现有标签来自 `RuleManager.parseRuleString()` 的硬编码默认值（`RuleManager.ts:361`）。

### 4.5 可观测性（结构化事件）

新增两条**结构化**日志（当前只有工具结果文本）：

```jsonc
{ "module": "permission", "message": "permission:deny",
  "meta": { "toolName": "file_write", "ruleId": "rule_…", "fingerprint": "161df22e…", "sessionId": "…" } }

{ "module": "query:reactLoop", "message": "reactLoop:environment_blocked",
  "meta": { "blockedTurns": 2, "maxBlockedTurns": 2, "reasons": [ { "tool": "file_write", "kind": "permission_denied" } ] } }
```

验收锚点：`bun run logs:scan --grep "permission:deny"` 能直接命中（当前实测为 **0**）。

---

## 5. 兼容性影响

| 消费方 | 影响 | 处置 |
|---|---|---|
| 前端 `finishReason` 分支 | 新值 `environment_blocked` 可能落不到已知分支 | 实施前先 grep 客户端 `finishReason` 使用点；未知值应走"通用失败"样式而不是静默 |
| `tests/chat/reactToolLoop-termination-o2.test.ts` | 逐相位断言正文 | 新增相位需补用例（同批） |
| 统计/审计（若按 `finishReason` 聚合） | 新增一类 | 只增不改；旧值语义不变 |
| 依赖 `ToolResultEntry` 的外部构造点 | 新字段可选 | 零改动 |

---

## 6. 实施步骤（每步独立提交，可单步回滚）

| # | 提交 | 内容 | 验收 |
|---|---|---|---|
| 1a | `refactor(chat): 抽出「跳过结果」构造` | 把 `ReActToolLoop` 里的 `recordSkippedTool` + 两处 push 抽成独立模块（**纯搬运，行为零变更**） | `tsc` 0；既有测试全绿；`ReActToolLoop` 行数 < 2000 |
| 1b | `feat(loop): ToolResultEntry 增加 failureKind` | 类型 + 各生产者**只加字段不改行为** | `tsc` 0；既有测试全绿 |
| 2 | `fix(permission): deny 决策带出 ruleId` | `createDenyDecision` 传 rule；`context` 带 `ruleId/fingerprint/sourceKind`；来源标签不伪造 | 单测断言 ruleId 透出；日志出现 `permission:deny` |
| 3 | `feat(loop): 熔断分型（双预算）` | 拆计数器 + `environment_blocked` 相位 + 文案 | 新增用例：**2** 次环境阻塞 ⇒ `environment_blocked`（不再 `circuit_breaker`）；3 次非法 tool_call ⇒ 仍 `circuit_breaker` |
| 4 | `fix(bash): 预处理拦截语义与安全拦截一致` | 预处理"禁止"分支不再返回 success（LRO-10 的交集） | 用例：被预处理拦下 ⇒ `status:'error'` + `failureKind:'safety_blocked'` |
| 5 | `docs+evidence` | 台账登记 + 本 spec 状态改"已实施" | 台账三门禁绿 |

> **进度（2026-10-26）**：步骤 1a ✅ · 1b ✅ · 2 ✅（`4b6b3986c`）· 3 ✅（`27b2460b3`）· 4 ✅（`71b0ba812`）· 5 ✅（台账 `CIRCUIT-BREAKER-CLASSIFICATION`）。
> **4 的类型落点**：`ToolFailureKind` 单一事实源放在 `utils/toolContract/ToolResult.ts`（infra 层，
> `tools`(app) 与 `session`(service) 都可合法向下依赖），`session/types/tool.ts` 以 re-export 复用。
> **1a 是硬前置**：`chat/ReActToolLoop.ts` 抽取前 **2000 行**（= `R04-001` 上限，`split('\n')` 口径），
> 1b 的接线要 +12 行 ⇒ 直接被架构门禁拒提；且 pre-commit 的 `eslint --fix`（prettier）
> 会把压行的改动重新折回去，**压行不是解法**。
> 1a 后实测 **1989 行**（跳过结果构造已抽到 `app/src/chat/toolResultPostProcess.ts` 的
> `recordSkippedToolCall`，与成功路径 `_postProcessToolResult` 同处：新建独立文件会让
> `status: 'error'` 成为 `lint:state-ratchet` 的**新文件新出现点**而阻断提交，且同处更聚合）。

> 步骤 3 依赖 1b、2；步骤 4 独立。**不要**把 1b+3 合提（回滚粒度）。

---

## 7. 测试计划

- **分型判定（纯函数）**：`classifyTurn(results)` → `'progress' | 'blocked' | 'invalid'`，覆盖
  `全成功` / `全 permission_denied` / `混合 blocked+success` / `tool_error` / `未分类 error` / 空数组。
- **计数器**：连续 blocked=2 ⇒ 终止；blocked 与 invalid 交替 ⇒ 各自预算互不推进。
- **负向对照**：故意把 `failureKind` 填 `permission_denied` 但 `status:'success'` ⇒ 不得被当阻塞（防误用）。
- **文案**：`environment_blocked` 的 `lastError` 必须非空且含 `ruleId`（空正文会丢消息）。
- **回归**：`reactToolLoop-termination-o2` 全绿；`circuit_breaker` 既有用例语义不变。

---

## 8. 风险与回滚

| 风险 | 处置 |
|---|---|
| `environment_blocked` 过早终止（用户其实想手动放行后重试） | 默认阈值 2 且**只针对已确认的阻塞类**；文案明确给"放行后重发"路径 |
| 分类字段被误填（把普通 tool_error 标成 permission） | 生产者集中在少数映射点；`classifyTurn` 单测锁死；未知/未分类一律按旧语义 |
| 新 `finishReason` 打破前端展示 | 先 grep 客户端；未知值走通用失败分支；必要时前端的 switch 加 default |
| 与 Inbox 修复冲突 | 本设计只把"Inbox 不可用"归为 `permission_denied` 并标注 `inbox_unavailable`，不改审批链路 |

---

## 9. 待拍板（3 项）——**已于 2026-10-26 拍板**

1. **`ruleId` 要不要给模型看？** ⇒ **只给用户与日志**（模型只看到"被拦截"的事实；`ruleId` 随
   `error` 文本进终止文案与日志，不注入模型可见输入）。
2. **阻塞阈值取 2 还是 3？** ⇒ **2**（`maxConsecutiveBlockedTurns: 2`，`0` 可禁用）。
3. **`environment_blocked` 是否允许"自动续跑"？** ⇒ **不自动**（v1 只给放行入口，用户处理后重发）。

---

## 10. 不做

- 不引入"按错误文本分类"（CS02）。
- 不为此改 `maxConsecutiveInvalidTurns` 默认值。
- 不在本设计里解决 `security_analyzer_deny` 的误伤集合（LRO-04 取证后再定）。
- 不为进度条/前端观感改语义（LRO-12 单独处理）。
