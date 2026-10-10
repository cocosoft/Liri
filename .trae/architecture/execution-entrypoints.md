# 执行入口注册清单 / 执行契约矩阵（Execution Entrypoints）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 权威范围：**所有能启动模型生成 / 调用工具 / 执行命令 / 产生副作用的入口**
> 机器可读单一事实源：[`execution-entrypoints.json`](./execution-entrypoints.json)（门禁 `scripts/lint-entrypoints.ts`）
> 关联不变量：[`invariants.md`](./invariants.md)（`INV-EXEC-006` 执行入口契约一致）
> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P1-3**（外部 §八.1）

---

## §0 规则（**强制**）

1. **新增入口必须登记**：任何引入"启动对话轮"（`coreAPI.chatStream(` / `coreAPI.chat(` / 窄端口 `core.chat(`）或"取得执行所有权"（`executionManager.acquire(`）的**新文件**，必须在 `execution-entrypoints.json` 登记 —— 否则 `lint:entrypoints` **CI 阻断**。
2. **登记须与实际一致**：已登记文件若**不再命中**其声明模式（入口被删/改名/搬移）⇒ 同样阻断（防登记漂移）。
3. **五项契约必须显式声明**：执行身份 / 取消传播 / 写前记账 / 权限校验 / 恢复语义 —— **不得留空**（无则写 `none` 并说明）。

---

## §1 执行契约矩阵（2026-10-10 实测）

图例：✅ 具备 ｜ ⚠️ 部分（灰度/缺项） ｜ ❌ 无 ｜ — 不适用

| 入口 | 源码落点 | 执行身份 | 取消传播 | 写前记账 | 权限校验 | 恢复语义 | 状态 |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **渠道 Router** | `channels/routing/messageRouter.ts:445,511` | ✅ `acquire` | ✅ `AbortSignal` | ✅ 经 `ChatManager`（executionId 下传 ⇒ `beginToolCall` fail-closed） | ✅ 工具链共享 | ✅ `executions` 记录 + 去重态落盘 | **verified** |
| **HTTP 流式**（`/v1/chat/completions`） | `infrastructure/http/handlers/chat-handlers.ts:619,682` | ⚠️ 灰度 `CLIENT_STREAM_EXECUTION`（**默认关**） | ❌ 未接取消信号 | ⚠️ 随执行身份（关 ⇒ 不记账） | ✅ 工具链共享 | ⚠️ 随执行身份（关 ⇒ 无恢复语义） | **partial** |
| **HTTP 非流式**（`/v1/chat/completions`） | `chat-handlers.ts:332`（`handleNormalChat`） | ❌ | ❌ | ❌ | ✅ 工具链共享 | ❌ | **gap** |
| **A2A 委派**（外部智能体 → 本地对话轮） | `infrastructure/http/handlers/routes/a2a-delegator.ts:71` | ❌ | ❌ | ❌ | ✅ 工具链共享 | ❌（每次新建会话） | **gap** |
| **工作区任务分解**（单次结构化生成） | `infrastructure/http/handlers/workspaces-handlers.ts:1463` | — | — | — | — | — | **n/a** |
| **子代理（AgentTool / SubAgentEngine）** | `tools/AgentTool/{AgentTool,SubAgentEngine}.ts` | ❌（自有循环 + 自有 `executeToolCall`） | ❌ | ❌（用 `AgentRunLedger`，**非** Execution 台账） | ⚠️ 自有校验链（未核实是否与主链同源） | ❌ | **gap**（未逐一核实） |
| **定时 / 唤醒任务** | `tasks/selfwake/SelfWakeService.ts`（续跑经会话管线） | ⚠️ 经管线（取决于触发路径） | — | ⚠️ 经管线 | ✅ 经管线 | ✅ `fired` 幂等（重启重建索引） | **partial** |
| **恢复任务** | `session/recovery/RecoveryOrchestrator.ts` + `execution` `recover()` | —（自身即恢复） | — | — | — | ✅ 幂等收敛 | **verified** |

> **说明**：本表**只登记"能启动执行"的入口**；纯读接口（会话查询、模型列表等）不在范围。
> **子代理 / 定时任务**两行的细节（是否经查 `ChatManager.executeTool`、是否有 executionId）标注为**未逐一核实** —— 按 CS06 不臆断。

---

## §2 未接入项（gap）与后续触发条件

| 入口 | 缺口 | 触发条件（何时接入 Execution） |
|---|---|---|
| **HTTP 非流式** | 无执行身份/记账/恢复 | 出现"非流式路径产生未记账副作用 / 崩溃后重复执行"的真实事件 |
| **A2A 委派** | 无 `executionId`；每次新建会话（无 ownership/fencing） | A2A 由"默认关闭"转为**对外启用**（`A2A_ENABLED=true` 且配密钥）时 |
| **子代理** | 自有循环/台账，与主链执行契约不统一 | 出现"子代理崩溃后副作用状态不可知"的真实事件（需先补 `INV-EXEC-006` 覆盖） |

> **不得**为"对齐矩阵"而提前接线（CS03：无真实消费者不做投机改造）。

---

## §3 变更触发（何时必须复查本文件）

- **新增**任一"启动对话轮 / 取得执行所有权"的调用点 ⇒ 必须同批更新 `execution-entrypoints.json`（否则门禁阻断）；
- 修改 `CLIENT_STREAM_EXECUTION` / `EXECUTION_TWO_PHASE_CANCEL` 默认值 ⇒ 复查本表 HTTP 行；
- 修改 `ExecutionManager.acquire` 语义 ⇒ 复查本表所有行 + `INV-EXEC-001/002`。

---

## §4 与不变量 / 门禁的关系

| 关联 | 说明 |
|---|---|
| `INV-EXEC-006`（执行入口契约一致） | 本表即该不变量的**证据面**；`status=gap` 的入口即其 `partial` 的成因 |
| `scripts/lint-entrypoints.ts` | 双向校验（扫描命中 ⇄ 登记）；接入 `bun run ci` + `.github/workflows/doc-gate.yml` |
| `scripts/lint-invariants.ts` | 校验 `INV-EXEC-006` 的源码/测试落点可解析 |
