# LobsterAI 多 Agent 协作机制分析 & Liri 自身优化建议

> 分析对象：`E:\PY\Documents\CODES\PY_APP\REF\BA_REF\LobsterAI-main\LobsterAI-main`
> 对比对象：`E:\PY\Documents\CODES\PY_APP\app\src`（Liri 源码）
> 结论均基于实际读取的源码，附文件路径与行号

---

## 一、LobsterAI 的多 Agent 协作架构

### 1.1 核心目录

`src/main/libs/agentEngine/subagent/` 是全部子代理逻辑的归集地，8 个源文件 + 6 个配套单测：

| 文件 | 职责 |
|------|------|
| `tracker.ts` | `SubagentTracker`：生命周期追踪、状态机、历史拉取、DB 持久化 |
| `sessionKeys.ts` | `isSubagentSessionKey` / `parseAgentIdFromSubagentSessionKey` 会话键解析 |
| `sessionMaterializer.ts` | 把子代理 run 物化为可展示的 Cowork 子会话（含被动收尾） |
| `sessionVisibility.ts` | 用 SQL 片段决定哪些子会话对用户可见 |
| `childHistorySync.ts` | 子会话历史增量同步（稳定 JSON 比对 + cursor） |
| `historyBackfill.ts` | 从 chat.history 回填丢失的工具事件 |
| `historyParser.ts` | 网关历史 → Cowork 消息格式的容错解析 |
| `yield.ts` | yield 生命周期判定 + 当前轮 yield 恢复 |

### 1.2 五个关键设计

**① toolCallId 作为唯一关联主键**

`tracker.ts` 的内存映射全部以 toolCallId 为键，而非 agentId：

```ts
/** All in-memory maps are keyed by toolCallId (unique per spawn invocation)
 *  to avoid collisions when multiple subagents share the same agentId. */
private readonly subagentSessionKeys = new Map<string, string>();
private readonly subagentMessages = new Map<string, SubagentCoworkMessage[]>();
private readonly subagentToolCallIdToAgentId = new Map<string, string>();
private readonly subagentStatus = new Map<string, 'running' | 'done' | 'error'>();
/** Reverse map: agentId → Set of toolCallIds */
private readonly agentIdToToolCallIds = new Map<string, Set<string>>();
```

注释明确说明了动机：同一 agentId 被并发 spawn 多次时不会互相覆盖。

**② 多路终态检测（冗余收敛）**

子代理"完成"有三个独立信号源，任一命中即置终态，避免单点漏判：

- `tryMarkDoneFromAnnounceRunId(runId)` — 正则 `^announce:.*:subagent:([0-9a-f-]+)` 解析公告 runId，用 uuid 反查 sessionKey
- `tryMarkTerminalFromSessionKey(sessionKey, status)` — 子会话自己的 sessionKey 命中
- `onResumeOrReadResult(args)` — 父代理调用 `sessions_resume` / `sessions_read` 取结果

且 `tryMarkTerminalFromSessionKey` 里有一条防降级规则：已是 `done` 时不接受 `error` 覆盖。

**③ 陈旧 running 记录自愈**

```ts
// listSubagentRuns()
if (run.status === 'running' && !memoryStatus && !this.pendingSpawnInfo.has(run.id)) {
  const endedAt = Date.now();
  this.store.updateSubagentRunStatus(run.id, 'error', endedAt);
  return { ..., status: 'error' as const, endedAt };
}
```

判定逻辑：DB 说 running，但本进程内存里既没有状态、也不在 pending 队列 → 必然是上次进程退出遗留的僵尸记录，直接判 error 并落库。应用重启后不会留下永久"运行中"的子代理。

**④ 删除墓碑 + 网关清理重试队列**

```ts
/** Run ids explicitly deleted by the user. Suppresses late spawn/backfill re-inserts. */
private readonly deletedSubagentRunIds = new Set<string>();

const GATEWAY_SESSION_DELETE_CONCURRENCY = 2;
const GATEWAY_SESSION_DELETE_MAX_ATTEMPTS = 3;
const GATEWAY_SESSION_DELETE_BASE_DELAY_MS = 5_000;
const GATEWAY_SESSION_DELETE_MAX_DELAY_MS = 20_000;
```

`onSpawnResult` / `onBackfillResult` 入口第一行都检查墓碑；网关侧 `sessions.delete` 走并发≤2 的队列 + 指数退避重试（5s→10s→20s，3 次封顶）。本地删除立即返回，网关清理异步兜底。

**⑤ 可见性用 SQL 表达，而非 UI 过滤**

```ts
// sessionVisibility.ts
export const VISIBLE_COWORK_SESSION_SQL = `NOT EXISTS (
  SELECT 1 FROM subagent_runs r
  JOIN cowork_sessions parent ON parent.id = r.parent_session_id
  WHERE r.child_cowork_session_id = s.id
    AND s.parent_session_id = parent.id
    AND COALESCE(NULLIF(TRIM(s.agent_id), ''), 'main')
      = COALESCE(NULLIF(TRIM(parent.agent_id), ''), 'main')
)`;
```

语义：**只隐藏"同一 agent 自我派生"的子会话；跨 agent 委派（fork、专家委派）保持可见**。这是产品语义（用户关心跨角色协作，不关心 agent 内部拆分），且下推到 SQL 层。

### 1.3 权限与边界

`openclawAgentModels.ts`:

```ts
function buildSubagentConfig(agent: Agent): Record<string, unknown> | undefined {
  const selectedAgentIds = normalizeSubagentAllowAgentIds(agent);
  if (!selfId || selectedAgentIds.length === 0) return undefined;
  return { allowAgents: [selfId, ...selectedAgentIds], requireAgentId: true };
}
```

- `allowAgents` 白名单显式包含自身
- `requireAgentId: true` 强制 spawn 必须指定目标 agent
- `normalizeSubagentAllowAgentIds` 去重、去空、**排除自身 id**（防自递归）

配套 DB 字段 `agents.subagent_allow_agent_ids`（`coworkStore.ts:419`）+ UI（`AgentCreateModal.tsx` / `AgentSettingsPanel.tsx`）。

### 1.4 持久化数据模型

`subagentRunStore.ts` 的 `subagent_runs` 表：

```sql
INSERT OR REPLACE INTO subagent_runs (
  id, parent_session_id, session_key, child_cowork_session_id,
  agent_id, task, label, status, created_at, ended_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

状态枚举 `'running' | 'done' | 'error'`；配套 `subagent_messages` 表（`subagentMessageStore`）存历史消息，用 `messages_persisted` 标志位 + `markMessagesPersisted()` / `isMessagesPersisted()` 做写入幂等。

API 面：`getSubTaskHistory` 三级回退 —— 内存缓存（仅 done/error 才给）→ 本地 DB → 网关 `chat.history` RPC。

### 1.5 常量与 IPC 契约

- `src/shared/cowork/subagent.ts`：`SubagentToolName.Spawn/Yield`、`SubagentYield` 全套状态常量
- `src/shared/cowork/constants.ts:72-74`：`SubagentList` / `SubagentListByAgent` / `SubagentDelete` 三个 IPC 通道名
- `src/main/libs/agentEngine/constants.ts`：`AgentLifecyclePhase`、`OpenClawGatewayEvent.SubagentSettleFailed = 'lobsterai.subagent.settle_failed'`

### 1.6 测试覆盖

`src/main/libs/agentEngine/subagent/` 下每个非测试文件都有配套 `.test.ts`。`tracker.test.ts` 的 11 个用例覆盖：单 run 删除（含网关 transcript）、本地删除不等网关、网关清理重试封顶、跨父会话删除拒绝、onSessionDeleted 级联、历史时间戳保序、失败 run 无 session key 时的历史处理、墓碑抑制迟到 spawn、无实时事件时从历史重建 run、被禁 spawn 记为 error、accepted spawn 解析真实 agent。

---

## 二、Liri 自身的多 Agent 实现现状

### 2.1 相关模块

| 路径 | 内容 |
|------|------|
| `app/src/tools/AgentTool/` | `AgentTool.ts`(1500+行)、`SubAgentEngine.ts`、`ForkSubagent.ts`、`types.ts`、`prompt.ts`、`strategies/` |
| `app/src/subagent/` | `SubAgentManager.ts`、`SubAgentFactory.ts`、`TeammateManager.ts`、`SubAgentCommunicator.ts`、`types/`(4 种载体)、`backends/`、`communication/` |
| `app/src/tasks/swarm/AgentSwarm.ts` | 并行 workers + verifier 门禁 + synthesizer 合成 + 黑板 |
| `app/src/chat/yield/` | `YieldSettlementBridge.ts`、`YieldResumer.ts` |
| `app/src/session/yield/YieldRegistry.ts` | yield 等待登记表 |
| `app/src/tasks/limits.ts` | 并发护栏集中定义 |

### 2.2 已有的护栏（值得肯定）

**并发上限已集中到单一事实来源**（`limits.ts:37`），支持 env 覆盖：

```ts
maxTeammates: limitFromEnv('TASK_MAX_TEAMMATES', 10),
agentConcurrency: limitFromEnv('TASK_AGENT_CONCURRENCY', 5),
subagentDepth: limitFromEnv('TASK_SUBAGENT_DEPTH', 3),
maxTasksPerCall: limitFromEnv('TASK_MAX_TASKS_PER_CALL', 20),
maxSubtasks: limitFromEnv('TASK_MAX_SUBTASKS', 5),
```

**递归防护是双层的**（`AgentTool.ts:574-576` + `804-824`）：

```ts
// 第一层：工具池裁剪
const subAgentToolPool = getAllTools().filter(
  (t) => t.name !== AGENT_TOOL_NAME && t.name !== LEGACY_AGENT_TOOL_NAME
);
// 第二层：深度硬上限（纵深防御）
const parentDepth = context?.subagentDepth ?? 0;
if (parentDepth >= MAX_SUBAGENT_DEPTH) { /* 拒绝 */ }
```

**yield 收敛判定已有完备的四条规则**（`YieldRegistry.shouldResume`）：存在 waiting 条目 ∧ 无活跃子代理 run ∧ 结算时间不早于登记时间 ∧ turn 未被取代。且用引用相等校验防"等待期间被新 yield 覆盖时错结新条目"。

**AgentSwarm 的降级设计**（`AgentSwarm.ts:13-14`）：executor/verifier/synthesizer 任一失败都不阻断主流程。

### 2.3 已识别的差距

以下差距均为源码可验证的事实。

---

## 三、优化建议（按优先级）

### P0-1：子代理运行态缺持久化 —— 进程重启后状态全丢

**证据（Liri）**

- `AgentTool.ts:209` — `private activeAgents: Map<...>` 纯内存
- `SubAgentEngine.ts:179` — `private activeAgents: Map<...>` 纯内存
- `YieldRegistry.ts:14` — 注释自述："本模块纯内存、无 IO；持久化随 C1「运行台账」一并落地，避免本期重复建表"
- 在 `app/src` 全量检索 `subagent_runs` / `subagentRun` / `SubagentRunStore` / `subagent_messages` → **0 命中**

**后果**：进程退出后，所有 `running` 的子代理既无 DB 记录也无内存状态，重启后前端拿不到任何子代理列表、历史与会话血缘。用户刷新即丢失"刚才派了哪些子任务"。

**证据（LobsterAI）**：`subagent_runs` + `subagent_messages` 两张表 + `tracker.test.ts` 的僵尸自愈用例。

**建议**

1. 新增 `subagent_runs` 表，字段对齐 LobsterAI：`id`(=toolCallId)、`parent_session_id`、`session_key`、`child_session_id`、`agent_id`、`task`、`label`、`status`、`created_at`、`ended_at`、`messages_persisted`
2. 新增 `subagent_messages` 表承载子代理对话历史
3. 在 `AgentTool.execute()` 的 tool start / tool result 两个时机落库（对应 LobsterAI 的 `onToolStart` / `onSpawnResult`）
4. **增加僵尸自愈**：列表查询时，`status==='running' && 无内存态 && 不在 pending 队列` → 判 `error` 并回写

> 说明：`YieldRegistry.ts` 注释里已规划了「C1 运行台账」，本建议与该规划一致，可合并实施。

---

### P0-2：多 Agent 协作路径几乎零测试覆盖

**证据（Liri）**

- `glob app/src/**/AgentTool/*.test.ts` → 空
- `glob app/src/**/{swarm,yield,subagent}/**/*.test.ts` → 空
- `glob app/src/**/AgentSwarm*.test.ts` → 空
- `app/src` 全量 `.test.ts` 共 31 个，集中在 `query/`、`session/archive/`、`tools/CanvasTool/`、`permission/` 等，**多 agent 相关为零**

**证据（LobsterAI）**：`subagent/` 目录 8 源文件配 6 个单测文件，`tracker.test.ts` 单文件 11 个用例，且用例全是"删除竞态""墓碑抑制""重试封顶""跨父会话拒绝"这类**边界与异常路径**。

**建议**：优先为以下纯逻辑单元补测试（无需起 Electron，符合 LobsterAI 「避免在测试中直接 import Electron-only API」的实践）：

| 待测单元 | 建议用例 |
|---------|---------|
| `YieldRegistry.shouldResume` | 四条规则各自否决 + 引用相等防错结 + turn 被取代 |
| `AgentSwarm.parseVerifyOutput` | 非 JSON 视为 pass 的容错边界 |
| `AgentSwarm.runBatched` | signal 中途取消、批次内 allSettled 隔离 |
| `AgentTool.checkConcurrencyLimit` | 并发上限边界 |
| `AgentTool` 深度检查 | `subagentDepth` 达到上限时的拒绝路径 |

---

### P1-1：`AgentSwarm` 的 `agentType` 与 `tools` 契约未被消费

**证据（Liri）** — `AgentTool.ts:663-680` 注释自述：

```
注：底层 SubAgentEngine 入参当前不消费"子代理类型"（既有并行路径同样未使用
    `tasks[].subagent_type`，见该实现的 executeSingle），故此处暂不透传 agentType；
    该字段已在 AgentSwarm 契约中预留，待引擎支持后再接。
```

实现里 `tools: []` 硬编码、`model` 透传但 `agentType` 丢弃。而 `AgentSwarm.ts` 内部已为 verifier 指定 `agentType: 'verification'`、synthesizer 指定 `'general'`（第 219、252 行），这些设定到达 executor 后被静默丢弃。

**对照 LobsterAI**：`sessionMaterializer.shouldMaterialize()` 用 `parseAgentIdFromSubagentSessionKey(childSessionKey)` 解析出真实 agentId，并据此决定子会话可见性 —— 子代理的"身份"是贯穿始终的一等公民。

**建议**

1. 打通 `SubAgentEngine` 对 `agentType` 的消费：按类型注入不同 systemPrompt（`strategies/` 下已有 General/Explore/Plan/Code 四套策略，说明能力已存在）
2. `buildSwarmExecutor` 传入 `agentType` 并按类型解析工具白名单，替换硬编码的 `tools: []`
3. 让 `SubAgentEngine` 尊重 `tools` 参数（当前 swarm 路径固定空工具池 → worker 实际无法调用任何工具，"只读不改"是靠提示词约束而非工具约束）

---

### P1-2：缺少"同 agent 派生 vs 跨角色委派"的可见性区分

**证据（LobsterAI）**：`sessionVisibility.ts` 的 `VISIBLE_COWORK_SESSION_SQL` —— 只有 `child.agent_id === parent.agent_id` 的自派生会话才被隐藏。

**证据（Liri）**：`parentSessionId` 仅存在于 `Session.metadata`（`Session.ts:58`），只在 fork 场景由 `SessionGateway.ts:730` 写入；检索 `agent/src` 未发现基于 agent 身份区分可见性的逻辑。`AgentTool` 派生的子代理不建独立会话，因此用户界面无法呈现"谁派了谁、谁在跑"。

**建议**：为子代理建立可选的子会话（对齐 LobsterAI 的 `sessionMaterializer.materialize`），并采用相同的可见性口径 —— **跨 agent 委派可见、同 agent 自派生隐藏**。这既是产品语义，也能避免列表被内部拆分刷屏。

---

### P1-3：终态检测路径单一，缺冗余收敛

**证据（LobsterAI）**：三条独立终态信号（announce runId / 子 sessionKey / resume-read 工具结果）+ 一条防降级规则（done 不被 error 覆盖）+ 一条"迟到事件 tombstone 抑制"。

**证据（Liri）**：`AgentTool.execute()` 的状态流转依赖 `runWithEngine` 的返回值（`AgentTool.ts:1345`）：

```ts
this.activeAgents.get(agentId)!.status = result.completed ? 'completed' : 'failed';
```

即**单点依赖 engine 返回**。一旦 engine 的 Promise 因异常路径未 resolve（例如 aborted 后未走 catch），状态会永久停在 `running`。虽然 `cleanupCompletedAgents()`（`:1503`）清理已完成条目，但对"永远 running"的条目无能为力。

**建议**

1. 为每个子代理 run 加超时兜底（`AgentConfig.timeoutMs` 已存在，需确认真被执行）
2. 增加**心跳/存活检测**：run 超过 N 分钟无进度事件 → 置 failed 并记录
3. 加墓碑集合，抑制已删除 run 迟到的回调重插入（LobsterAI 用 `deletedSubagentRunIds`）

---

### P2-1：`AgentTool.ts` 体量过载（1500+ 行）

**证据**：`AgentTool.ts` 从第 66 行的 `setAgentToolManager` 一直到 1500+ 行，混杂了：工具元信息、输入校验、工具池构建、swarm 执行、direct call、engine 执行、后台任务、worktree 隔离、fork 注入、teammate 注册、token 汇聚、状态查询共 11 类职责。

**对照 LobsterAI**：`openclawRuntimeAdapter.ts` 虽也有 12000+ 行（该仓库同样承认存在 legacy 大文件），但**所有子代理逻辑被抽到独立的 `subagent/` 目录**，adapter 只保留"委托调用"的一行转发（`openclawRuntimeAdapter.ts:12062-12081` 的 `listSubagentRuns` / `getSubTaskHistory` / `deleteSubagentSession` 全是单行 delegate）。

**建议**（按 LobsterAI AGENTS.md 的「大文件改动前先出抽取计划」原则，建议先确认再动手）：

| 抽取模块 | 移出的职责 | 预估行数 |
|---------|-----------|---------|
| `AgentTool/swarmExecutor.ts` | `buildSwarmExecutor` + tasks 并行分支（663-1018） | ~360 |
| `AgentTool/backgroundTask.ts` | 后台任务注册与收尾（1174-1283） | ~110 |
| `AgentTool/isolation.ts` | worktree 创建/降级/清理（1100-1143、1427-1438） | ~60 |
| `AgentTool/agentState.ts` | `activeAgents` 状态机 + 并发检查（209、462-472、1440、1503-1510） | ~80 |
| `AgentTool/forkContext.ts` | fork 消息构建注入（1146-1172） | ~30 |

---

### P2-2：符号与常量的集中度不足

**证据（LobsterAI）**：
- `shared/cowork/subagent.ts` 集中 `SubagentToolName` / `SubagentYield`
- `shared/cowork/constants.ts:72-74` 集中三个 IPC 通道名
- `agentEngine/constants.ts` 集中事件名，`SubagentSettleFailed: 'lobsterai.subagent.settle_failed'`

**证据（Liri）**：`subagent_type` 字符串字面量在 `AgentTool.ts` 中直接比较（`:8951` 类似的 `toolNameRaw.toLowerCase() === 'sessions_spawn'` 模式），`AgentType` 联合类型虽已在 `types.ts` 定义，但 `'sessions_spawn'` / `'sessions_yield'` / `'sessions_resume'` / `'sessions_read'` 这些跨模块判别字符串散落在 `AgentTool.ts` 与 `agentEngine` 各处。

**建议**：
1. 新建 `app/src/shared/agent/subagentConstants.ts`，集中 spawn/yield/resume/read 工具名与状态枚举
2. `AgentTool.ts` 与 `AgentSwarm.ts` 共用同一份常量（LobsterAI AGENTS.md 的规则："不要用裸字符串字面量表示在多个地方被比较的判别值"）
3. `AgentType` 已定义在 `types.ts`，需确保全部消费方 import 而非写字面量

---

### P2-3：`AgentSwarm` verifier 的"非 JSON 视为 pass"过于宽松

**证据（`AgentSwarm.ts:114-127`）**：

```ts
function parseVerifyOutput(text: string): SwarmVerifyResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: true };   // ← LLM 输出异常时默认放行
  ...
  } catch { return { pass: true }; }   // ← JSON 解析失败也默认放行
}
```

质量门在解析失败时 fail-open，等于门禁在最需要它的时候（LLM 输出不规范）失效。

**对照 LobsterAI**：`yield.ts` 的 `isSuccessfulYieldResult` 是**严格判定** —— 必须 `JSON.parse` 成功 ∧ `status === 'yielded'` ∧ `error == null`，任一条不满足即 `false`。测试 `yield.test.ts` 里专门有 `test.each` 覆盖 `''`、`'Turn yielded.'`、`'null'`、`'[]'`、`{"status":"error",...}` 等应被拒绝的输入。

**建议**：改为 fail-closed 或至少三态 —— `pass: true | false | 'unknown'`，`unknown` 时标记"门禁未通过"并附原因，避免静默放行。

---

## 四、优先级汇总

| 优先级 | 建议 | 类型 | 证据强度 |
|-------|------|------|---------|
| P0-1 | 子代理运行态持久化 + 僵尸自愈 | 可靠性 | 强（表不存在，检索 0 命中） |
| P0-2 | 多 agent 路径补单测 | 工程质量 | 强（测试文件 glob 为空） |
| P1-1 | 打通 `agentType` / `tools` 契约 | 功能完整性 | 强（代码注释自述） |
| P1-2 | 子会话物化 + 可见性口径 | 功能缺失 | 中（跨目录检索未命中） |
| P1-3 | 终态检测冗余化 | 可靠性 | 中（基于状态流转单点依赖） |
| P2-1 | `AgentTool.ts` 拆分 | 可维护性 | 强（行数 + 职责数） |
| P2-2 | 常量集中 | 可维护性 | 中 |
| P2-3 | verifier fail-open 收紧 | 正确性 | 强（代码即证据） |

---

## 五、一点方法论上的观察

LobsterAI 的多 agent 代码有一个值得注意的特征：**每个复杂度都配了一条边界用例**。看它的 `tracker.test.ts` 用例标题列表——

```
deleteSubagentRun removes a single run, messages, and gateway transcript
deleteSubagentRun returns after local deletion without waiting for gateway cleanup
gateway cleanup retries are capped when delete keeps failing
deleteSubagentRun refuses to delete a run from another parent session
deleted subagent run is not reinserted by late spawn results
forbidden spawn result is recorded as error
accepted visible spawns resolve the real agent instead of the task label
```

七条里有五条是**对抗性场景**（重试封顶、跨父会话拒绝、迟到事件重插入、被禁 spawn）。这解释了为什么它的源码里那些"墓碑集合""防降级规则""尝试次数上限"看起来像过度设计 —— 因为每一条都被一个具体的失败场景驱动。

Liri 的对应代码里，防递归（双层）、并发上限（env 可覆盖）、yield 收敛（四条判定）的设计质量其实不低，甚至 `AgentSwarm` 的降级理念比 LobsterAI 更明确。**真正的差距不在设计思路，而在"没有测试把思路钉住"** —— 没有测试，就无法判断某次重构是否破坏了那四条 yield 判定规则。

因此如果只能做一件事：**先做 P0-2（补测），再做 P0-1（持久化）**。有了测试，持久化改造才敢动。
