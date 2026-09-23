# Liri 代码复查报告 —— O11 断链补齐验收 + 残余缺口

复查时间：2026-09-21
复查对象：`E:\PY\Documents\CODES\PY_APP\app`（上一轮「多 Agent 协作优化建议」中识别的断链点）
复查方式：静态代码核验（文件读取 + 精确检索），每条结论标注文件路径与行号

---

## 一、已修复项验收（确认落地）

上一轮指出的 O11 断链，本轮逐条核验均已闭环，且实现质量高于最低要求：

| 编号 | 原断链 | 现状证据 | 判定 |
|------|--------|----------|------|
| O11-1 | DB 角色**完全不生效** | 新增 `tools/AgentTool/AgentDescriptorResolver.ts`，四级回退（DB → Registry → 内置 → **显式拒绝**）；`AgentTool.ts:1245` 已接入 | ✅ 已修复 |
| O11-2 | 角色无「推荐模型」字段 | `AgentRoleStore.ts` 新增 `model` 列 + `ensureColumns()` 幂等 `ALTER TABLE` 补列；resolver 消费 `role.model` | ✅ 已修复 |
| O11-3 | 角色改动后缓存不失效 | `AgentRegistry.invalidateCache()` 由 private 改 public（`Registry.ts:247`）；`agent-role-handlers.ts` 的 POST/PUT/DELETE 三处均调 `invalidateAgentCache()` | ✅ 已修复 |
| O7 类问题 | 未知名字**静默降级** | resolver ④ 分支 fail-closed 返回 `{ok:false}`；`AgentTool.ts:1249-1254` 显式拒绝，**并结算台账释放并发槽位** | ✅ 已修复 |
| 播种冲突 | 全禁用后重启触发 UNIQUE 冲突 | `AgentRoleStore.count()` 语义已校正为「表是否为空」，与 `enabled` 位解耦（注释已说明） | ✅ 已修复 |
| 陈旧运行态 | 进程重启后状态丢失 | 新增 `AgentRunStore.ts`（`tool_call_id` 主键 + `owner_pid/owner_started_at` 身份 + 陈旧自愈判 `unknown` + 三级保留裁剪） | ✅ 已修复 |
| 台账交错 | 全表扫描清理误删他路径条目 | 新增 `AgentRunLedger.ts`：单一所有者、**临界区无 `await`**、就地注销、终态幂等 | ✅ 已修复 |
| 质量门 fail-open | verifier 拒答即放行 | `AgentSwarm.ts:157 parseVerifyOutput` 已改 fail-closed（无 JSON / 缺 `pass` / 解析失败 三路均判不过） | ✅ 已修复 |

补充：新增测试 `tests/tools/AgentTool/agentDescriptorResolver.test.ts`（覆盖四级回退 + 两种拒绝 + 大小写归一 + 层级短路），`agentRunStore.test.ts`、`agentRunLedger.test.ts` 亦已存在。**上一轮判定的「多 agent 路径零测试覆盖」已不成立。**

---

## 二、残余缺口（本轮新发现，均为可证事实）

### 🔴 P0 —— O11 只覆盖了单代理路径，**并行批次路径整体绕过**

**这是「改了一半」，且是最值得优先处理的一条。**

`AgentTool.ts:1224` 的执行顺序：

```
1224  if (agentInput.tasks && agentInput.tasks.length > 0) {
1225    return await this.runSwarmPath({ ... });     // ← 早退
1226  }
...
1245  const descriptor = await this.resolveAgentDescriptor({ ... });   // ← 永不执行
```

`tasks[]` 非空时在 1225 行直接 `return`，**第 1245 行的描述符解析链对本路径完全不生效**。由此产生三个连带后果：

1. **DB 角色在并行路径失效**。用户在 `/agent/roles` 配的 `architect`/`security` 等角色，单代理路径可用，并行批次路径不可用 —— 与 O11 声称的「统一解析链」不符。
2. **fail-closed 保证有洞**。`tasks[].subagent_type` 拼错时不会被拒绝，因为校验在早退点之后。
3. **`AgentSwarm.ts` 内三个 systemPrompt 全部硬编码**（`:236` worker、`:283` verifier、`:321` synthesizer），`buildSwarmExecutor`（`AgentTool.ts:1059`）将它们**原样透传**给 engine，全程不经过 resolver。

> 三处硬编码位置：`AgentSwarm.ts:236`（worker）、`:283`（verifier）、`:321`（synthesizer）。

### 🔴 P0 —— `agentType` 透传三段断两段

`AgentSwarm.ts:240` 确实把 `agentType` 交给了 executor 契约（`:38` 定义了可选字段），但：

- `AgentTool.ts:1059` —— `buildSwarmExecutor` 只解构 `{ systemPrompt, userPrompt, taskKey }`，**`agentType` 被丢弃**；
- `AgentTool.ts:1068` —— 落盘时 `agentType` **硬编码为 `'general'`**；
- `AgentTool.ts:1075-1084` —— `engine.execute` 入参无 `agentType`，且 `tools: []` 硬编码。

`AgentTool.ts:1049-1052` 的注释自述「底层 SubAgentEngine 入参当前不消费子代理类型，故此处暂不透传」—— 属已知待办，但 `AgentSwarm` 侧已按新契约传参，形成「上游已准备好、中间层丢弃」的空转。

### 🟡 P1 —— 管理页面缺 `model` 输入框

`AgentRoleStore` 有 `model` 列、handlers 接受并落库 `model`、resolver 消费 `role.model`，但前端表单没有这一环：

- `client/src/components/views/CouncilAgentRolesPage.tsx:15-25` 的 `AgentRole` 接口**无 `model` 字段**；
- 该文件全量检索 `model`（忽略大小写）→ **0 命中**。

结果：O11-2 的「推荐模型」只能通过直接调 API 设置，界面用户无法配置。整条链**只差 UI 这一环**。

### 🟡 P1 —— `agentId` 大小写归一不一致（潜在必现）

- resolver 侧：`AgentDescriptorResolver.ts` 执行 `raw.toLowerCase()` 后作为 key 查询；
- DB 侧：`AgentRoleStore.ts` 建表为 `agent_id TEXT NOT NULL UNIQUE`，**无 `COLLATE NOCASE`**，SQLite 默认 `BINARY` 排序规则 ⇒ 比较**区分大小写**。

⇒ 用户在页面把 `agentId` 填成 `Architect`，则单代理路径查询 `architect` 必然落空，最终走 ④ 报「未知的 subagent_type」。当前默认 5 个角色恰好全小写，故未暴露。建议二选一：DB 列加 `COLLATE NOCASE`，或写入/查询两侧统一归一。

### 🟡 P1 —— 工具 schema 描述已过期

`AgentTool.ts:128-134` 的 `subagent_type` 参数 `description` 仍为：
> `The type of specialized agent to use: general, explore, plan, verification, code-guide, statusline-setup`

现在 resolver 实际接受 **DB 角色 + 运行时注册 agent**，但模型从工具 schema 看不到。resolver 的错误提示（`AgentDescriptorResolver.ts` ④ 分支）已正确列出三类来源，**但仅在出错时可见** —— 模型更可能需要的是「事前」知道可用清单。

### 🟢 P2 —— 可观测性

- `AgentTool.ts:1259` 解析来源 `descriptor.source` **仅记日志**，未落 `agent_runs`。事后无法查询「这次 run 用的是 DB 角色还是内置」。
- `AgentTool.ts:1068` 落盘 `agentType: 'general'` 恒值，`batch_id`/`task_key` 之外的真实类型信息丢失。

### 🟢 P2 —— 接线层测试缺口

`agentDescriptorResolver.test.ts` 测的是**纯函数 + 注入依赖**（质量不错）。但 `AgentTool.ts:1245-1254` 的**接线**未覆盖：即「解析失败 ⇒ `settleRun(agentId,'failed')` ⇒ 返回 failureResult」这条调用链，以及「并发槽位确实被释放」。这类 seam 恰是上一轮出问题的地方。

---

## 三、优先级建议

| 优先级 | 事项 | 预估工作量 |
|--------|------|-----------|
| P0 | swarm 路径接入解析链（或至少显式声明该路径不适用并 fail-closed 拒绝 `tasks[].subagent_type`） | 中 |
| P0 | `agentType` 三段贯通（中间层透传 + 落盘真实类型 + engine 消费） | 中（依赖 engine 侧） |
| P1 | UI 补 `model` 输入框 | 小 |
| P1 | `agentId` 大小写归一（DB `COLLATE NOCASE` 或两侧统一） | 小 |
| P1 | 工具 schema 描述动态化（从 resolver 的可用名单生成） | 小 |
| P2 | `descriptor.source` 落盘 | 小 |
| P2 | `AgentTool` 接线层 seam 测试（fail-closed ⇒ 槽位释放） | 小 |

---

## 四、总体评价

本轮的修复**方向正确、执行扎实**：`AgentRunStore` 的「判 `unknown` 而非 `error`」（避免诱导上层重试造成副作用重复）、`AgentRunLedger` 的「临界区不含 `await`」（把 Bun 无线程竞态这一事实写进设计约束）、`parseVerifyOutput` 的 fail-closed 三路分支——这些都不是最低成本的改法，而是**理解了失败语义之后**才写得出的代码。

残余问题的共性只有一个：**新能力（解析链）只在主路径落地，未覆盖所有入口**。P0 两条都属此类，且都能用「入口清单法」系统排查——建议把 `executeDispatch` 的全部分支列一张表，逐个标注「是否经过 resolver / 是否经过 toolset 校验 / 是否落盘」，可一次性清掉同类隐患。

---

*本报告全部结论均来自本轮工具读取的真实代码，标注了文件路径与行号。「大小写归一」一条为静态分析结论（未运行验证），已明确标注为潜在必现。*
