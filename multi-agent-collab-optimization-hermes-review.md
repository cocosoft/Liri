# 对《多 Agent 协作优化方案 v3》的 Hermes 对标复核与优化建议

> 复核对象：`E:\PY\Documents\CODES\PY_APP\dev_docs\multi-agent-collab-optimization.md`
> 对标基线：`E:\PY\Documents\CODES\PY_APP\REF\BA_REF\hermes-agent-main`
> 方法：只用工具实际读到的内容下结论；每条建议标注证据（文件 + 行号/符号）；无法确证的写成「待核实」并给出核实方法
> 日期：2026-09-21

---

## 0. 结论摘要

方案 v3 的质量整体是高的：A1–A6 的问题判定准确、H1–H7 的对标到位、§7「不做项」里"迁移设计约束而非代码形态"这条自我约束尤其清醒。**但正因为这条自我约束，方案在 O2 上恰好违规了**——它把 Hermes 的 `threading.RLock` 形态直接映射到 Bun/TS 单线程环境，而 Liri 的竞态本质是 **await 交错**，不是线程竞态。这是本次复核最重要的一条修正。

**四类增量（方案未覆盖）**：

| 类别 | 内容 | 严重度 |
|:--|:--|:--:|
| **语义修正** | O2 的"锁 + 单一注册表"与 JS 运行时错配，需改为"单所有者 + 无 await 临界区 + 局部化清理" | 高（会导致按方案实施后问题仍在） |
| **整条缺失链路** | 结算信号的**可靠投递**（Hermes 用 durable completion + claim + 重试上限 + 回放年龄上限）——方案只做了"执行态持久化"，没做"投递态持久化" | 高 |
| **长期风险** | 摘要**上下文预算**与溢出落盘（Hermes `_parent_summary_char_budget` 的 50% 余量 ÷ 批次）；Liri 现在是硬编码 `substring(0,500)` 静默丢弃 | 中高 |
| **语义诚实性** | 陈旧 running 的恢复语义应为 `unknown` 而非 `error`（Hermes 明确理由：无法证明副作用是否发生） | 中 |

**方案原先的判断有两处现在可以定论**（§4 O1 与 §7 的"照搬 runId/turnToken 不做"）——见 §4、§5。

---

## 1. Hermes 侧：方案 H1–H7 之外的可迁移做法

### G1 公开的生命周期句柄契约（版本化 + HMAC 能力令牌 + 9 态状态机）

`agent/subagent_lifecycle.py` 定义了一整套**对插件公开**的契约，而非只暴露内部对象：

- `PUBLIC_CONTRACT_VERSION = 1`，句柄自带版本号；`_record()` 里逐字段做类型校验，`contract_version != 1` 直接返回 `None`（不抛错、不猜）。
- `SubagentHandle.capability` 是 **HMAC 令牌**：`hmac.new(_SECRET, f"{subagent_id}|{parent_session_id}|{created_at:.6f}", sha256)`。伪造/篡改的句柄 `compare_digest` 失败 ⇒ `UNKNOWN_HANDLE`，**不可能访问别人的子代理**。
- `_record()` 还校验 `active_parent_id != handle.parent_session_id` ⇒ 拒绝（**跨会话句柄一律无效**）。
- 状态机 9 态：`PENDING / STARTING / RUNNING / SUCCEEDED / FAILED / INTERRUPTED / CANCEL_REQUESTED / CANCELLED / UNKNOWN`。
- 终态结果**不可变 + 幂等 + 有 hash**：`result_hash` = 对 `dataclasses.asdict(result)`（剔除 hash 字段自身）做 `sha256(json.dumps(sort_keys=True))`；`summary` / `error_message` 上限 `_MAX_RESULT_CHARS = 32000`；文档明确"**omit transcripts and hidden reasoning**"。
- 保留期：`_TERMINAL_RETENTION_SECONDS = 3600`，`_cleanup_locked()` 只回收**已有终态结果且完成时间超期**的记录——**从不回收活着的记录**。

**对 Liri 的启示**：Liri 的终止语义是 `completed / max_turns / aborted / error / budget_exhausted / loop_detected`（`app/src/tools/AgentTool/SubAgentEngine.ts:161`），**缺一个「取消已受理、终态未定」的中间态**。这恰恰是方案 O2 想要的"锁内线性化"的前提：没有 CANCEL_REQUESTED，`stopAgent` 只能在"running"和"failed"之间二选一，无法表达"请求已受理，正在下一个安全边界收敛"。

### G2 陈旧判定用「进程身份 + 进程启动时间」双重校验

`tools/async_delegation.py:169-170` 持久化 `owner_pid` 与 `owner_started_at`；`recover_abandoned_delegations()`（`:343-397`）的判定逻辑：

```python
live = _pid_exists(int(pid))
if live and started is not None:
    live = get_process_start_time(int(pid)) == int(started)   # 防 PID 复用误判
if live:
    continue
```

**为什么必须比对启动时间**：PID 会被操作系统复用；只查 `_pid_exists` 会把"上一个进程已死、PID 被新进程占用"误判成"还活着"，于是这条记录**永远不会被回收**（僵尸永久残留）。方案 O6 只写"陈旧 running 自愈"，**没有定义如何判定'陈旧'** ——这一条就是判定方法。

### G3 恢复语义分级：`unknown` ≠ `error`

Hermes 把"重启后如何处置"拆成两条**语义不同**的路径：

| 场景 | 处理 | 语义 |
|:--|:--|:--|
| 子代理**已完成**但结果未投递 | `restore_undelivered_completions()` 入队重投 | 结果**存在**，只是没送到 |
| 子代理**运行中**进程消失 | `recover_abandoned_delegations()` 判 `unknown` | "**无法证明副作用是否发生**" |

后者写进事件里的原话是：`"Delegation owner exited before recording a terminal result; outcome unknown."`

**对方案的修正**：O6 写"陈旧 running 自愈 ⇒ 判 `error` 回写"。这个语义**过强**。`error` 宣告"确定失败"，而实际是"不知道有没有产生副作用"（子代理可能已经改了文件、已发了请求）。一个诚实的状态机应该有 `unknown` 这一档；用 `error` 会让上层误以为"什么都没发生"而重试，造成**副作用重复**。

### G4 投递（delivery）是与执行并列的一等状态

`async_delegation.py` 的表结构里，`state`（执行态）与 `delivery_state`（投递态）是**两个独立字段**：

- `delivery_state`：`pending / delivered`（+ 终态 `dropped`）
- `delivery_attempts`：每次投递尝试 `+1`，上限 `_MAX_DELIVERY_ATTEMPTS = 8` ⇒ 收敛到终态，**避免每次重启无限重放**
- **claim 机制**：`claim_completion_delivery(delegation_id, claim_id)` → `release_completion_delivery` → `complete_completion_delivery` / `drop_completion_delivery`。多消费者竞争同一事件时，只有"成功接受该合成 turn"的那一个才会 ack；失败者 release 让重试。
- **回放年龄上限** `_MAX_COMPLETION_REPLAY_AGE_S = 48 * 3600`。理由写得很具体：`"a July session replayed in August burned a 102K-token context on the staging fleet"` —— 七月的完成事件在八月回放，会以**全新全上下文 turn** 重跑一个已经没有人在等的会话。超期则终态 drop，payload 仍可查询。
- 被恢复的事件打上 `restored=True`（仅内存标记，不持久化），用于让"无所有权过滤的 drain 路径"**不认领**上一个进程的事件（#64484：新会话在启动数秒后收养了死会话的委派结果）。
- 保留上限：`_MAX_RETAINED_COMPLETED = 50`、`_MAX_DURABLE_PENDING = 1000`、`_DURABLE_RETENTION_SECONDS = 7 天`。

**这是方案最大的结构性缺口**：方案 O 系列只覆盖"**执行态**持久化"，完全没有"**结算信号**可靠投递"这一层。而 Liri 的结算桥是：

- `notifyYieldSettled()`（`app/src/chat/yield/YieldSettlementBridge.ts:34`）**同步遍历模块级监听器数组**（`:35`），无去重、无重试、无持久化、无留痕；
- `handleYieldSettlement` 的失败分支只 `logger.warn` + `abandon`（`app/src/chat/yield/YieldResumer.ts` 的 catch 块）。

也就是说：**结算信号一旦丢失（抛错、进程中断、监听器未装配），父会话永久停在 waiting，且没有补偿通路**。方案 O1 只修了"监听器累积"这一个装配缺陷，没修"信号不可靠投递"。建议新增 **O8**（见 §3）。

### G5 控制面的所有权校验（两层兜底）

`tools/delegate_tool_registry.py`：

- `_is_descendant_of(child_agent, parent_agent, max_hops=8)`（`:179`）：沿 `_delegate_parent_ref` **weakref 链**上溯，**身份相等**才认。用途注释写明："a parent may steer/stop its own children and grandchildren, **never a sibling tree owned by another conversation**"。
- `_owns_subagent_record()`（`:213-236`）是**两层**：Tier 1 身份链；**Tier 2 持久谱系**（`owner_agent_session_id` 比对，且两侧都过 `resolve_resume_session_id` 解压缩轮转 lineage）。
- Tier 2 存在的原因在注释里：身份链 `"is BRITTLE across parent rebuilds"` —— CLI 会在中途 `self.agent = None`（route change / 凭证刷新 / `/model` / MoA one-shot）然后重建一个新 AIAgent，而子代理还持有旧对象的 weakref。`"Delivery routes by durable session id; control must use the same spine or running children go invisible/unsteerable."`
- 网关侧另有 `_subagent_transport_matches()`（`:107`）：授权**在检查时刻现读** owner session 的 live transport slot，而不是用记录里的副本——注释说明每记录一份副本需要在所有 reattach 路径同步，**漏了两处**（#106663）。
- `list_active_subagents()`（`:173-176`）返回**副本**，并**剔除私有字段**（`_PRIVATE_RECORD_KEYS = frozenset({"agent", "owner_session_id", "owner_transport", "owner_session_record", "accepting_steer"})`）——`agent` 引用绝不外泄。

**对 Liri 的启示**：`AgentTool.stopAgent(agentId)`（`app/src/tools/AgentTool/AgentTool.ts:1487-1498`）**没有任何所有权校验**——直接 `this.activeAgents.get(agentId)` + `this.engine.abort(agentId)`。知道 id 就是权力。方案通篇未提"控制面授权"。同时 `getActiveAgents()`（`:1461`）返回 `Array.from(...)`：数组是新的，**元素是内部对象引用**，调用方可原地改 `status`。方案 H3 已识别这一点，但没识别"授权缺失"。

### G6 能力契约的三条硬约束（方案的 O7 只写了第一条）

`agent/subagent_lifecycle.py` 的 `_validate_request()` 里，**三条明确拒绝**：

1. **禁止扩权**：`set(request.allowed_toolsets) - set(TOOLSETS)` 非空 ⇒ 抛"Unknown toolsets"；`not set(request.allowed_toolsets).issubset(set(parent.enabled_toolsets))` ⇒ 抛 **`"Requested toolsets would broaden parent permissions."`**
2. **fail-closed 拒绝而非静默忽略**：`timeout_seconds` ⇒ `"Per-launch timeout is not supported"`；`working_directory` ⇒ `"not supported because Hermes delegates use isolated task environments"`；`blocked_tools` ⇒ `"Per-tool blocking is not supported; use allowed_toolsets. Hermes always blocks unsafe child tools."` 文档原话：*"Requests are fail-closed … explicitly rejected **until Hermes can support them without weakening isolation**."*
3. **规模上限**：`_MAX_GOAL_CHARS = 16000`、`_MAX_CONTEXT_CHARS = 32000`、`_MAX_METADATA_BYTES = 8192`，且 metadata 必须 JSON-可序列化。

对照 `tools/delegate_tool.py:50-58` 的 `DELEGATE_BLOCKED_TOOLS`（`frozenset`）：`delegate_task`（禁递归）/ `clarify`（无用户交互）/ `memory`（不写共享 MEMORY.md）/ `send_message`（无跨平台副作用）/ `cronjob`（不借父之名排班）。

**对方案的修正**：O7 只写了"继承父 toolsets − 角色阻断清单"。**缺"禁止扩张"这条校验**。Liri 的 `buildToolDefinitions(allowedTools, deniedTools, toolPool)`（`AgentTool.ts:496-517`）接受**自由白名单**且不与父级做子集校验——若子代理的 `allowedTools` 可越过父级授权，就是**权限放大**。同时 Liri 侧对 `model` / `maxTurns` / `allowedTools` 等参数是**接受即用**，没有 fail-closed 的拒绝清单。

### G7 中断/停止的协作语义与"永不假称成功"

- `cancel()`：先检查 `record.result is not None` ⇒ `already_terminal=True` 直接返回；否则置 `CANCEL_REQUESTED` 并调 `request_hard_interrupt(agent, ...)`。**返回 `accepted` 只代表请求被受理**，文档原话："it **never claims completion** until `wait` or `result` observes a terminal state."
- `interrupt_subagent()`（`delegate_tool_registry.py:92`）注释：在 **next iteration boundary** 停止，**in-flight tool calls 不被切断**，且中断标志递归传播到孙代。
- 停止的返回值语义也分档：`_CONTROL_OUTCOMES`（`:293+`）里 stop 成功返回 `"interrupt_requested"` 并明确"**do not wait or poll**"（部分结果会以 completion message 回来）；失败返回 `"Could not interrupt — it likely finished in the last moment."`

**对 Liri 的启示**：`stopAgent` 把状态直接改成 `'failed'`（`AgentTool.ts:1492-1494`），**把"用户主动停止"和"执行出错"混为一谈**，且丢失了"我已受理、尚未收敛"这一信息。方案 O4 提到"超时即不通过"，但没提停止语义的状态区分。

### G8 摘要上下文预算与溢出落盘（方案完全缺失）

`tools/delegate_tool.py`：

- `_METADATA`：`DEFAULT_MAX_SUMMARY_CHARS = 24000`（硬顶，`0` 关闭）
- `_SUMMARY_HEADROOM_FRACTION = 0.5`：整批摘要允许消耗父**剩余上下文余量**的 50%
- `_MIN_SUMMARY_CHARS = 2000`：父已接近满载时，单条摘要仍给一个可用下限，避免"截断成噪声"
- `_parent_summary_char_budget(parent_agent, n_summaries)`（`:2475-2512`）：`headroom = context_length - used_tokens - reserved`，`batch_budget = headroom * 0.5`，`per_summary = batch_budget // n_summaries`，`tokens→chars` 按 ~4 chars/token 折算；父上下文未知时返回 `None` ⇒ 退回静态上限
- `_apply_summary_budget()`（`:2515+`）：超限时**全文落盘 + 头部切片 + 文件指针**（`_spill_summary_to_file`），"**so nothing is lost**"
- 触发该机制的真实事故记录：issue/PR **#9126** —— "batch fan-out returned N full summaries verbatim, blowing the parent context and (on rate-limited providers) triggering a **compression/429 death spiral**"

**对 Liri 的现状**：`AgentTool.ts:971` 是
```ts
`[${w.success ? 'OK' : 'FAIL'}${w.verified ? '' : ' 未过门禁'}] ${w.id}: ${(w.output || w.feedback || '').substring(0, 500)}`
```
—— **硬编码 500 字符截断、无预算计算、无落盘、无指针**。超长 worker 输出被**静默丢弃**（既不进上下文，也没落盘，也没告诉父代理它被截断了）。这是批量 fan-out 场景下的真实信息损失，方案 O 系列**完全没有这一条**。建议新增 **O9**。

### G9 大文件拆分纪律的**第 5 条**（方案 H6 只列了 4 条）

方案 H6 从 `agent/turn_finalizer.py:1-21` 总结了 4 条（书面计划 / 行为中性 / 保持结构形状 / 惰性导入）。复核 Hermes 实际的拆分产物，还有一条**贯穿所有拆出模块**的纪律：

```python
# tools/delegate_tool_child_run.py:25
logger = logging.getLogger("tools.delegate_tool")  # log-record parity with the origin module
# tools/delegate_tool_dispatch.py:24
logger = logging.getLogger("tools.delegate_tool")  # log-record parity with the origin module
```

拆出模块**刻意沿用原模块的 logger 名**（注释直接写明 "log-record parity"）。理由：一旦 logger 名变了，所有基于 `logger 名称` 的日志筛选、告警规则、现场检索脚本**全部失效**——而拆分本身应该是"行为中性"的。

**对 O5 的补充**：Liri 侧同样要守这条。`AgentTool.ts` 的错误上报是 `handleError(e, { module: 'tools:agentTool', action: 'runDirectCallLLM' })`（`:735-738`）——拆分后 `module`/`action` 字符串**必须保持原值**，否则现有告警规则（若有）断链。建议把这条写成 O5 的**第 5 条硬约束**。

### G10 测试纪律：每个生产缺陷固化为一个用例文件

Hermes 在 `tests/` 下的委派相关文件（glob 实测）：

- `tests/tools/` 下约 **40 个** `test_delegate_*.py` + `test_async_delegation*.py` + `test_subagent_*.py`
- 覆盖维度极细：`test_delegate_liveness_timeout` / `test_delegate_parallel_interrupt_join` / `test_delegate_timeout_cleanup` / `test_delegate_stale_wait_release` / `test_delegate_capability_inheritance` / `test_delegate_toolset_scope` / `test_delegate_late_child_inherits_stop` / `test_async_delegation_fd_leak` / `test_async_delegation_retirement` / `test_restored_delegation_ownership`
- **回归用例带事故编号**：`test_delegate_cascade_49148.py`、`test_subagent_protection_30170.py` —— 每个线上缺陷都落成一个**以编号命名的文件**
- `tests/gateway/test_subagent_protection.py` + `tests/hermes_cli/test_subagent_monitor*.py`（含 `_ui` / `_resize` / `_prompts` / `_notification_display`）
- 另有**线上探针**：`evals/api_delegation_http_probe.py`、`evals/api_delegation_sync_probe.py`、`evals/postmortem/live_ab/nested_delegate_deadline.py`
- `tests/tools/test_delegate_parallel_interrupt_join.py` 这类文件名本身就是**并发场景规格**：并行 + 中断 + join

**对方案的修正**：方案 §8 第 5 条把测试当作"回归网"（"跑 typecheck + bun test，基线 2856 pass / 0 fail"）。建议改为**测试是交付物**：每个 O 项必须新增对应用例**文件**，且文件名应表达场景（对齐 Hermes 的命名法）。特别是：
- O2/O3（状态所有权 / 并发）⇒ `agentTool.concurrency.test.ts` 类
- O6（重启恢复）⇒ 必须覆盖"PID 复用"与"已完成未投递"两个分支
- O8（若采纳）⇒ 必须覆盖"投递失败重试到上限"与"回放超龄 drop"

### G11 血缘判定：`weakref` 链在 TS 侧可行，且应从"可选"升为"必需"

`_is_descendant_of` 用 `getattr(cur, "_delegate_parent_ref")` 取 weakref 再 `ref()` 求值，`max_hops=8` 兜底防环。注释说明弱引用的价值：不阻碍 GC。

方案 §5 把 E1 列为"可选增强"。但结合 G5——**控制面授权需要谱系判定**——E1 其实是 O10（授权）的**必要构件**：没有血缘链就退化成"Tier 2 持久谱系"单腿支撑，而 Hermes 明确说身份链是抗父重建脆性的第一层。JS 有 `WeakRef`（ES2021，Bun 支持），方案 §7"不做项"里"照搬 Python 实现细节"的顾虑**不适用于此**——`WeakRef` 是语言级能力，不是 Python 形态。

### G12 其他值得记录的细节

- **暂停开关**：`set_spawn_paused` / `is_spawn_paused`（`delegate_tool_registry.py:39/46` + `delegate_tool.py:251/263`），用独立的 `_spawn_pause_lock`。语义精确：**阻断新 spawn，已有子代理继续跑**。方案 E2 已识别 ✓
- **过期/残留诊断配套**：`_dump_subagent_timeout_diagnostic`（`delegate_tool.py:2214`）在**零 API 调用超时**时写结构化诊断文件，含"**all live threads**"的栈——理由：子代理卡在嵌套 helper 线程上时，只看子代理自己的栈无法区分"慢 provider"还是"死锁"
- **子代理不继承审批回调**：`delegate_tool.py:61-105` 用 `ThreadPoolExecutor(initializer=...)` 把非交互审批回调注入每个 worker 线程，避免 worker 里的 `input()` 与父 TUI 争 stdin **死锁**。默认 `_subagent_auto_deny`（安全），可 opt-in `auto_approve`
- **worktree 隔离的"证明式清理"**（`tools/subagent_worktree.py`）：只清理**已证明**"零 commit + 干净树"的 worktree；任一枚举探测失败 ⇒ **保留**并写 `inspection_failed: true` + `note`。注释：`"A failed probe proves nothing about the tree"` / `"a destructive cleanup requires affirmative proof"`（#88113）
- **`attribution` 与执行分离**：`_recent_subagents`（`_RECENT_SUBAGENTS_CAP = 200`）保留注销后的记录用于**归因**，理由：子代理启动的后台进程常常**活得比子代理本体重**（`npm ci` + `notify_on_complete`），其完成通知到达父会话时"live registry entry is gone"
- **能力继承的可选性**：`github` 式的 `_get_inherit_mcp_toolsets()` / `_expand_parent_toolsets()` / `_preserve_parent_mcp_toolsets()`——MCP toolsets 是否继承是一个**显式配置**，且有专门的展开/保留逻辑（`delegate_tool.py:1086-1148`）

---

## 2. 方案 §4 逐项修订建议

### O1 修 A5 的两个装配缺陷 —— **现在可以定论**

**已确证**（`app/src/session/yield/YieldRegistry.ts:123-130`）：

```ts
shouldResume(input: YieldConvergeInput): boolean {
  const entry = this.get(input.sessionId);
  if (!entry) return false;
  if (input.hasActiveRuns) return false;        // ← :126 第 2 条判定
  if (input.endedAt < entry.yieldedAt) return false;
  if (input.latestTurn > entry.turn) return false;
  return true;
}
```

`hasActiveRuns` **是**"等待全部结算"的必要判据，且方向是 **fail-closed**（`true` ⇒ 拒绝恢复）。因此方案 O1 的"二选一"取**第一个分支**：**保留该入参，注入真实实现**（`before` 注入 `() => false` 会失去一道防线）。方案 §4 O1 原文已给出这个分支，此处只是**确认它是对的**，并把"待读 `shouldResume` 定论"从 §8 前置检查里划掉。

**但 O1 遗漏了一个更严重的装配缺陷**（新发现）：

`notifyYieldSettled` 全仓 grep 结果（`app/src`，5 处命中）：

| 位置 | 性质 |
|:--|:--|
| `AgentTool.ts:47` | import |
| `AgentTool.ts:993` | **唯一调用点** |
| `ChatManager.ts:3010` | 注释 |
| `chat/yield/index.ts:13` | re-export |
| `YieldSettlementBridge.ts:34` | 定义 |

`AgentTool.ts:993` 位于**并行批次（AgentSwarm）路径的返回之前**，且被 `if (context?.sessionId)` 包裹。也就是说：**结算通知只在"并行批次成功收口"这一条路径上发出**。

- 单子代理路径（`runWithEngine`，`AgentTool.ts:~550`）无通知点
- `runDirectCall`（简单任务）无通知点
- swarm 路径下 `context?.sessionId` 缺失时**静默不发**

**待核实**（不要臆断）：需要先确认"父会话可能在哪些路径上 yield"。核实方法：grep `YieldRegistry.register(` / `getYieldRegistry().register` 的**全部调用点**，并逐个确认其所在路径是否有对应的 `notifyYieldSettled`。

- **若 yield 只可能发生在并行批次路径** ⇒ 当前实现自洽，但这是**脆弱的隐式耦合**，应加断言或注释固化
- **若 yield 也可发生在单子代理路径** ⇒ 这是比"`hasActiveRuns` 恒假"严重得多的缺陷：**父会话永久停在 waiting，无补偿通路**

### O2 消除 A2 竞态 —— **建议修正表述（本轮最重要的一条）**

方案 O2 写："**单一注册表 + 锁**（H1）：把'活跃子代理'收敛为一处注册表，`register / unregister / 置态 / abort` 全部在**同一把锁**内完成 ⇒ 从根上消除'清理删掉别人条目'的窗口"。

**问题**：Hermes 的 `threading.RLock` 存在的前提是**Python 多线程**——`delegate_tool.py:64` 注释明示子代理跑在 `ThreadPoolExecutor` worker 里；`async_delegation.py` 有独立的 daemon executor 与 monitor 线程。**Bun/TS 是单线程事件循环**，不存在两个线程同时进入临界区的可能。

Liri 的 A2（"A 代理的 `cleanupCompletedAgents()` 删掉 B 代理刚要上报的条目"）在 JS 里的真实成因是：**`await` 让出控制权 ⇒ 另一条子代理路径的续体（continuation）插进来执行全表扫描删除**。这是**交错（interleaving）**，不是**并发（concurrency）**。

**两者的解法不同**：

| | Python 线程竞态 | JS await 交错 |
|:--|:--|:--|
| 根因 | 临界区不可分割性被破坏 | 状态在 await 边界两侧被不同 ownership 修改 |
| 解法 | 加锁串行化 | ① 单所有者 ② 局部化（按 id 删，不全表扫）③ **临界区内不含 await** |
| 加锁能否解决 | ✓ | **✗**（`async-mutex` 只在"锁内无 await"时有效；锁内若有 await，交错窗口原样存在） |

方案 §7"不做项"第 1 条自己写了：**"迁移的是设计约束（单一所有者、锁线性化、行为中性拆分、硬判定），不是代码形态"**。O2 把 `threading.RLock` 直译成"同"一把锁"，**恰好违反了自己定的规矩**。

**建议改为**：

1. **单一所有者**（保留，这是对的）：`SubAgentEngine` 为唯一所有者，或 `AgentTool` 只做只读查询——方案 O3 的两个选项之一。
2. **局部化清理**：`cleanupCompletedAgents()` 的**全表扫描语义**（`AgentTool.ts:1503-1512`，`for (const [id, agent] of this.activeAgents.entries())` 无差别删所有非 running 条目）改为**按 id 精确注销**，由该子代理自己的收尾路径调用。这是消除 A2 的**直接手段**，且不依赖任何锁。
3. **临界区不含 await**：登记 / 置态 / 注销这三个操作必须写成**同步块**（中间不出现 `await`），使其天然不可交错。这是 JS 等价于"synchronized"的唯一正确形式。
4. **两段式生命周期**（H2，保留）：`active` 表 + `recent` 表（方案已写 ✓）。Hermes 侧对应 `_active_subagents` + `_recent_subagents`（`delegate_tool_registry.py:18-27`，`_RECENT_SUBAGENTS_CAP = 200`）。
5. **补用例**（方案已写 ✓）：两代理并发、其一先完成触发清理、另一仍在上报 ⇒ 断言不抛错、终态正确、两表账目一致。

### O3 收敛 A1 + 只读副本

方案内容正确（H3 已识别"返回副本"）。**建议补两条**：

1. **`getActiveAgents()` 应做浅拷贝**：`Array.from(this.activeAgents.values())`（`AgentTool.ts:1461`）产出的数组是新数组，但**元素是内部对象引用**。外部拿到 `agent.status = 'failed'` 就能改内部状态。应 `map(a => ({...a}))`。
2. **`stopAgent` 补所有权校验**（见 O10，建议合并/相邻实施）：`AgentTool.ts:1487-1498` 无任何授权检查。

### O4 统一 A4 的验证语义

方案方向正确（fail-closed + 组合硬判定）。**建议补两条 Hermes 细节**：

```python
# agent/verify/runner.py:43-44
PhaseResult.ok = exit_code == 0 and not timed_out
# :85-88
VerifyResult.ok = phases_ok and readiness_ok
```

1. **超时的处理是"参与判定"而非"另开一路"**：`ok = exit_code == 0 and not timed_out` —— `timed_out` 是 `ok` 的**合取项**。Liri 侧对应 `SubAgentEngine` 的 abort 路径（`SubAgentEngine.ts:250-257` 的超时 abort），需确认超时后的结果**不被计为 ok**。
2. **终止要"按进程组"**：`_terminate_process_group`（`runner.py:162`）——只杀直接子进程会留下**残留进程**（终端命令派生的子进程仍持文件/端口）。Liri 若在子代理里跑 shell，abort 后需要确认进程树被清理。
3. 方案"**前置**：先统计 swarm verifier 输出的非 JSON 占比"这个前置条件**非常必要**（避免严格化后失败率骤升）——保留 ✓

另外，`AgentSwarm.parseVerifyOutput` 的 fail-open 有两层（`AgentSwarm.ts:114-127`）：
```ts
if (!match) return { pass: true };           // :117 非 JSON ⇒ pass
return { pass: parsed.pass !== false, ... }; // :123 JSON 但缺 pass 字段 ⇒ pass
```
**第二层（`:123`）比第一层更隐蔽**：即使 verifier 返回了合法 JSON，只要它忘了写 `pass` 字段，仍然判 pass。改为 fail-closed 时**两层都要改**（应对齐 Hermes 的 `exit_code == 0 and not timed_out` 式的**正向合取**，而非"排除法"）。

### O5 拆分 `execute()` —— **补第 5 条纪律**

方案 H6 的 4 条硬约束（书面计划 / 行为中性 / 保持结构形状 / 惰性导入）+ 建议新增的 **logger 名一致性**（G9）：

```ts
// 拆分后各模块必须保持：
handleError(e, { module: 'tools:agentTool', action: '<保留原值>' })
```
—— `AgentTool.ts:735-738` 现有的 `module`/`action` 取值是外部告警/检索的接口，拆分后不得改名。

**seam 划分**（方案已给出 `executeGuard` / `executeDispatch` / `executeLifecycle` / `executeProgress`）是合理的。补充一点：`executeLifecycle` 与 O2/O3/O10 同落点（登记 / 置态 / 注销 / 授权），这三项**必须同批**（方案 B2 已写 ✓）。

### O6 运行态持久化 —— **从 3 要素扩到 5 要素**

| # | 要素 | 来源 | 对方案的修正 |
|:--:|:--|:--|:--|
| 1 | `toolCallId` 作唯一主键 | 方案已有 ✓ | 保留 |
| 2 | 陈旧 running 自愈 | 方案已有 ⚠️ | **判定方法需补**：`owner_pid` + `owner_started_at` **双校验**（G2，`async_delegation.py:169-170, 343-397`）；**语义需改**：判 `unknown` 而非 `error`（G3）|
| 3 | `schema_version` + 幂等 DDL + 显式迁移 | 方案已有 ✓（H7）| 保留。补 Hermes 的 `ALTER TABLE ADD COLUMN` 逐列补齐模式（`async_delegation.py:177-191`）——**只增不删**，与 Liri 硬约束天然契合 |
| 4 | **投递态**（`delivery_state` / `delivery_attempts` / claim）| **方案缺失** | 见新增 O8 |
| 5 | **保留上限** | **方案缺失** | `_MAX_RETAINED_COMPLETED = 50` / `_MAX_DURABLE_PENDING = 1000` / `_DURABLE_RETENTION_SECONDS = 7d`（`async_delegation.py:77-79`）。**无上限的台账 = 无界增长**（`_prune_durable_records` 的三段删除策略：先删已投递超期的，再按 terminal 数超限删，最后按 pending 数超限删）|

**关于事务边界的一个易漏细节**（`async_delegation.py:194-210`）：Python 的 `sqlite3.Connection.__enter__/__exit__` **只 commit/rollback，不 close**。Hermes 专门写了 `_transaction()` 上下文管理器在 `finally` 里 `conn.close()`，注释记录后果：每次持久化泄漏一个连接 + WAL/SHM 文件描述符，"deferred to the garbage collector"，长跑网关会耗尽 `RLIMIT_NOFILE`（#69567 / PR #69594）。Liri 若用 SQLite 做台账，**同样的陷阱**（Bun 的 `bun:sqlite` 语义不同，但仍需显式 close / 复用连接）。

### O7 能力契约 —— 补两条硬约束

1. **禁止扩权**（G6-1）：子代理的 tools **必须是父级授权集的子集**，越界**抛错**而非静默忽略。这条直接对应 Liri `buildToolDefinitions` 的自由白名单（`AgentTool.ts:496-517`）。
2. **fail-closed 参数清单**（G6-2）：明确列出"**不支持则拒绝**"的参数（而非接受即忽略）。参考 Hermes 拒绝的三项：per-launch timeout / working_directory / per-tool blocking——理由都是"不能在不削弱隔离的前提下支持"。
3. 补一条**上下文契约**：Hermes 在 `delegate_tool.py:16-17` 的模块 docstring 里把契约写成一句话——*"The parent's context only sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning."* 方案 O7 提了"父只见摘要（需在实施时核实）"✓，建议**同样写进代码 docstring**，而不只是写在方案文档里。

### O8（新增）结算信号的可靠投递

**问题**：见 G4。Liri 的 `notifyYieldSettled` 是同步遍历无重试无留痕（`YieldSettlementBridge.ts:34-35`），信号丢失 ⇒ 父会话永久 waiting，无补偿。

**建议**（对标 `async_delegation.py` 的 completion rail）：

1. **持久化结算事件**：`notifyYieldSettled` 先落台账（`sessionId` / `toolCallId` / `endedAt` / `state=pending`），再尝试投递。
2. **delivery 状态机**：`pending → delivered`，失败重试 `delivery_attempts++`，超过上限（Hermes 用 8）⇒ `dropped` 终态，**避免每次重启无限重放**。
3. **claim 机制**：多监听器/多路径竞争时，只有成功 `handleYieldSettlement` 返回 `true`（真的触发了恢复，`YieldResumer.ts` 已有该返回值 ✓）的那一个 ack；失败者释放 claim 让重试。**Liri 已有的返回值设计正好可以承载 claim**——这是方案里现成可复用的接口。
4. **回放年龄上限**：超期（Hermes 用 48h）的 pending 事件**终态 drop**，不再以"全上下文新 turn"重放。理由见 G4（102K token 事故）。
5. **`restored` 标记**：重启恢复的事件打内存标记，**让无所有权过滤的路径不认领**（#64484：新会话收养死会话结果）。
6. **补用例**：投递失败重试到上限 ⇒ dropped；回放超龄 ⇒ drop；两个消费者竞争 ⇒ 只有一个 ack。

### O9（新增）摘要上下文预算与溢出落盘

**问题**：见 G8。`AgentTool.ts:971` 硬编码 `substring(0, 500)`，超长输出静默丢弃。

**建议**：

1. 以父会话**剩余上下文余量**计算批次总预算，除以 worker 数得单条预算（Hermes 取余量 50%）。
2. 设**静态硬顶**（Hermes 24000 chars）与**下限**（Hermes 2000 chars，防止父满载时截成噪声）。
3. 超限时：**全文落盘 + 头部切片 + 文件指针**（"nothing is lost"），而不是丢弃。
4. 触发场景对齐 Hermes：批量 fan-out 的 N 份完整摘要同时进父上下文 ⇒ 压缩/429 死亡螺旋（#9126）。
5. **补用例**：单条超限 / 整批超限 / 父上下文未知时的退化路径（Hermes 返回 `None` ⇒ 退回静态上限）。

### O10（新增）控制面授权与谱系

**问题**：见 G5。`stopAgent(agentId)`（`AgentTool.ts:1487`）无授权校验；`getActiveAgents()`（`:1461`）泄漏内部引用。

**建议**：

1. **Tier 1 身份**：`WeakRef` 血缘链上溯，只在**自己的 spawn tree** 内授权。`max_hops = 8` 兜底防环（Hermes 取 8）。
2. **Tier 2 持久谱系**：`sessionId` 比对（含 lineage 解析兜底）——Liri 已有 `parentSessionId` 存于 `Session.metadata`（上轮已确认 `Session.ts:58`），可复用。
3. **查询返回副本**：`getActiveAgents()` 浅拷贝；`getAgentStatus()` 已是只读返回值 ✓；`getEngine().getActiveAgents()`（`SubAgentEngine.ts:578-580`）已返回**新建对象**（`.map()` ✓）——引擎侧是对的，工具侧要补齐。
4. **专有字段不外泄**：参考 `_PRIVATE_RECORD_KEYS`，明确哪些字段不进快照。
5. **补状态**：停止请求要有 `CANCEL_REQUESTED` 之类的中间态（G1），不要直接写 `'failed'`（现状 `AgentTool.ts:1492-1494`）。

---

## 3. 建议批次（对方案 §6 的修订）

| 批次 | 内容 | 相对方案的变更 |
|:--:|:--|:--|
| **B1** | O1（含"通知点单点化"核实）+ `shouldResume` 已定论 | **收敛**：定论已完成，工作量下降 |
| **B2** | O2 + O3 + O5 + **O10** | **加项**：O10 与 O2/O3 同落点（注册表 / 置态 / 授权），必须同批 |
| **B3** | O4 + O7 + **状态机定义（G1）** | **加项**：状态机是 O2 线性化与 O10 停止语义的共同前提 |
| **B4** | O6（并入 C1）| **扩项**：3 要素 → 5 要素 |
| **B5（新）** | **O8 + O9** | **新增批次**：结算投递 + 摘要预算，二者互不依赖，可并行；建议**不晚于 B4**（O8 依赖 O6 的台账，但台账表结构可先在 O6 里预留）|
| **可选** | E1 → **升为 O10 的构件**；E2 / E3 / E4 维持可选 | E1 不再是"可选增强" |
| **贯穿** | **测试作为交付物**（G10）：每 O 项新增命名表达场景的用例文件 | 方案 §8 第 5 条需改写 |

**依赖关系**：

```
B1 (yield 装配)
  └─> B5 (O8 结算投递，依赖 yield 通路正确)

B2 (注册表/所有权/授权/拆分)  ─┐
B3 (状态机/验证/能力契约)      ─┴─> B4 (持久化，依赖终态可信)
                                    └─> B5 (O8 依赖 B4 的台账表)
```

---

## 4. 方案判断正确、应予背书的部分

复核中**没有发现反例**的方案结论：

1. **§7"照搬 LobsterAI 的 runId / turnToken"列为不做项 —— 判断正确，且可再强化**。Hermes **也没有** `runId`/`turnToken`；它的键是 `delegation_id`（一次 `delegate_task` 调用）+ `subagent_id`（单个子代理）+ `owner_agent_session_id`（归属）。Liri 用 `toolCallId` 作主键与 Hermes 用 `subagent_id` 作主键是**同一抽象的两个命名**，无需引入第三方命名。
2. **A2 的问题判定准确**：`cleanupCompletedAgents()` 确实是全表扫描删除（`AgentTool.ts:1503-1512`），5 处 `get(agentId)!` 非空断言确实存在（`:946/1236/1257/1345/1385`）。**只是解法需要从"加锁"改为"局部化 + 无 await 临界区"**。
3. **H4（继承 − 阻断清单）方向正确**：`tools/delegate_tool.py:50-58` 的 `DELEGATE_BLOCKED_TOOLS` 是 `frozenset`，语义就是"父 toolsets 减阻断项"。方案 O7 的改造方向对，只是**不完整**（缺禁止扩权 + fail-closed 清单）。
4. **H7（schema 版本化）与 Liri 硬约束天然契合**：Hermes 的 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` 逐列补齐（`async_delegation.py:154-191`）正是"只增不删"的标准做法，方案这个跨语言移植**没有形态问题**。
5. **A6（运行态无持久化）与 O6 的顺序约束正确**：Hermes 自己也强调"durable completion **durability is not durable execution**"——**持久化的是结果投递，不是让子代理从崩溃中续跑**。方案"终态先可信，持久化才有意义"的顺序判断是对的，且应把这个**边界**显式写进 O6（避免实施时误期待"崩溃续跑"）。
6. **§7"为一处不臆断 shouldResume 后果"的自我约束 —— 值得肯定**。这是整个方案里最能体现工程审慎的一条：`hasActiveRuns` 恒假确实只证明"输入恒假"，不证明"过早恢复"。本报告已在 §2 O1 完成定论 ✓

---

## 5. 待核实项（不要臆断）

| # | 待核实 | 核实方法 | 若结论为 A / B 的影响 |
|:--:|:--|:--|:--|
| V1 | **yield 可能发生在哪些执行路径** | grep `register(` 在 `app/src/session/yield/` 与 `app/src/chat/` 的全部调用点，逐个确认所在路径是否有 `notifyYieldSettled` | A=仅并行批次 ⇒ 隐式耦合，加断言固化；B=含单子代理 ⇒ **严重缺陷**，须并入 O8 |
| V2 | `context.sessionId` 在 swarm 路径的**缺失概率** | 追 `AgentTool.execute()` 的 `context` 参数来源，确认哪些调用方不传 `sessionId` | 若常态化缺失 ⇒ `:992` 的 `if` 使结算通知**静默不发**，属 O8 范围 |
| V3 | 子代理 timeout abort 后是否**真正清理进程树** | 读 `SubAgentEngine.ts:250-257` 的 abort 分支 + 子代理内 shell 工具的进程管理 | 若只 abort 不杀进程组 ⇒ 补 O4-3（`_terminate_process_group` 等价物） |
| V4 | 超时后结果是否被计为 ok | 追 `SubAgentEngine` 的 `terminationReason`（`:919`）到验证判定入口的传导 | 若超时仍可判 ok ⇒ O4 需补"超时即不 ok"的合取项 |
| V5 | 现有告警/日志检索规则是否依赖 `module`/`action` 字符串 | grep `'tools:agentTool'` 的消费方（监控/告警配置） | 若有 ⇒ O5 的 logger/action 一致性从"建议"升为"阻断项" |
| V6 | 父会话是否已"只见摘要"、子代理是否已"全新上下文" | 读 `SubAgentEngine.execute()` 的 messages 构造（`AgentTool.ts:~550` 附近）| 方案 O7 已标"实施时核实" ✓ |

---

## 6. 一句话总结

方案 v3 的诊断层（A1–A6）与对标层（H1–H7）是扎实的，**主要的改进空间在"落地表述"与"链路完整性"**：O2 需要把 Python 的锁语义**正确翻译**为 JS 的"单所有者 + 无 await 临界区 + 局部化清理"（而不是直译 `RLock`）；整份方案缺了**结算信号可靠投递**（O8）、**摘要上下文预算**（O9）、**控制面授权**（O10）三条链路；O6 需要从 3 要素扩到 5 要素，并把"陈旧判定"与"unknown/error 语义区分"补上。测试应从"回归网"升格为"交付物"。

---

### 证据索引

**Hermes 侧**（均为本次实际读取）
- `agent/subagent_lifecycle.py` — 公开契约版本 / HMAC capability / 9 态状态机 / `_validate_request` 三条拒绝 / `_cleanup_locked` 保留期
- `tools/async_delegation.py` — `:71-121` 模块状态与阈值注释；`:142-191` 幂等 DDL + 逐列补齐；`:194-210` `_transaction()` 连接泄漏修复；`:213-241` 路由来源快照；`:343-397` `recover_abandoned_delegations`（PID + 启动时间双校验）；`:400-455` `restore_undelivered_completions`（`restored` 标记 + 48h 上限）；`:467-556` claim / release / drop / complete
- `tools/delegate_tool_registry.py` — `:18-27` active/recent 两表；`:50-161` 注册/注销/retain/steer 生命周期函数；`:173-176` `list_active_subagents` 返回副本 + 私有字段剔除；`:179-195` `_is_descendant_of` weakref 链；`:213-236` `_owns_subagent_record` 两层校验；`:293+` `_CONTROL_OUTCOMES` 状态语义
- `tools/delegate_tool.py` — `:1-18` 模块契约 docstring；`:49-58` `DELEGATE_BLOCKED_TOOLS`；`:61-105` 子代理审批回调防死锁；`:138-169` 运行时状态与失败状态集；`:1149-1184` 摘要上限/心跳阈值/无默认超时理由；`:2475-2527` 摘要预算与落盘；`:2214` 超时诊断
- `tools/delegate_tool_child_run.py:1-25`、`tools/delegate_tool_dispatch.py:1-24` — 拆分产物 + logger 名一致性
- `agent/turn_finalizer.py:1-21` — 拆分纪律四条
- `agent/delegation_context.py` — ContextVar 隔离（避免污染全局 env）
- `tools/subagent_worktree.py` — 证明式清理 / `inspection_failed` 上报
- `skills/.../references/delegate-task-concurrency-diagnosis.md` — 三处真实 cap 路径与"模型自我限流"误报的诊断法
- `website/docs/{user-guide/features/delegation.md, guides/delegation-patterns.md, developer-guide/subagent-lifecycle-api.md}` — 契约与边界的书面化
- 测试：`tests/tools/` 约 40 个委派相关文件（含编号化回归 `test_delegate_cascade_49148.py`、`test_subagent_protection_30170.py`）

**Liri 侧**（均为本次实际读取）
- `app/src/tools/AgentTool/AgentTool.ts` — `:209-225` activeAgents + teammate handle 两处状态；`:462-468` `checkConcurrencyLimit` 只数一份；`:496-517` `buildToolDefinitions` 自由白名单；`:663-680` `buildSwarmExecutor`（`tools: []` + agentType 未透传注释）；`:735-738` `handleError` 的 module/action；`:971` 硬编码 `substring(0,500)`；`:992-997` 唯一 `notifyYieldSettled` 调用点；`:1454-1462` `getActiveAgents` 返回内部引用；`:1487-1498` `stopAgent` 无授权；`:1503-1512` 全表扫描清理
- `app/src/tools/AgentTool/SubAgentEngine.ts` — `:161` 终止语义 6 态；`:179/215/411/501/567-571` 第二份 activeAgents；`:578-580` `getActiveAgents` 返回新建对象
- `app/src/tasks/swarm/AgentSwarm.ts` — `:114-127` `parseVerifyOutput` 两层 fail-open；`:206-233` verifier 门禁
- `app/src/session/yield/YieldRegistry.ts` — `:123-130` `shouldResume` 四条判定（`:126` 为 `hasActiveRuns`）
- `app/src/chat/yield/YieldResumer.ts` — `:141-154` `installYieldResumer` 返回卸载函数
- `app/src/chat/yield/YieldSettlementBridge.ts` — `:34-35` 同步遍历监听器数组
- `app/src/chat/ChatManager.ts` — `:4428-4457` `hasActiveRuns: () => false` 及其理由注释
