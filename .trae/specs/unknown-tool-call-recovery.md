# Spec：崩溃恢复后 `unknown` 工具调用的处置（Unknown Tool-Call Recovery）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：**S1 ✅ / S2 ✅**
> **来源**：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P0-4**（对应核验项 E-8/E-9）
> **关联规则**：GR15 · CS01 · CS03（不做死抽象）· CS05 · R02-002（类型单一来源）· 13-P1-2（`toolEffects`）· R07-3（非幂等重试审批）

---

## 1. 问题（根因）

崩溃恢复已把「未结算工具调用」置为 `unknown`（`ExecutionStore.markUnsettledToolCallsUnknown`，R3），
但**没有任何消费者据此阻止重放**：

- `ExecutionStore.listToolCalls()` **仅测试引用**（`app/src` 零生产消费者）⇒ `unknown` 状态**落库即止**；
- 外部审查（CHANGELOG 专项 §五）：*"`UNKNOWN` 是对事实不确定性的表达，不是一个可直接重试的失败状态"* ——
  若恢复机制对 `unknown` 调用**无条件重放**，会造成"数据库看起来恢复正常，但外部世界**已重复操作**"。

⇒ 缺少**恢复策略分类**与**重放守卫**：不同类型的副作用应有不同处置。

---

## 2. 范围决策

- **做**：① `toolEffects` 增**恢复策略**推导（`retryable` / `manual`）+ 重放守卫 `canReplayAfterUnknown`；
  ② `ExecutionManager.recover()` 消费 `listToolCalls(unknown)` ⇒ 返回值带出 `unknownToolCalls`；
  ③ 组合根（`main.ts`）按策略分类并**告警登记**不可自动重放者。
- **不做**（诚实边界，CS03）：
  - 外部审查建议的第三档「**可查询远端**」（先查远端状态再决定重试）**本版不实现** ——
    无任一内置工具声明了通用的"远端状态查询"能力，实现即**投机扩展**。
  - **不做**自动补偿/补偿事务（无真实消费者）。
  - **不新增**会话事件类型（§1.6）：恢复结果经**日志 + `recover()` 返回值**承载（非"模型可见输入"）。

**第三档「可查询远端」的触发条件（登记）**：出现**同时满足**的真实场景 ——
① 某工具的副作用发生在**可查询的远端系统**（如工单/订单/消息 API 可回查）；② 该工具被标记为非幂等；
③ 存在**崩溃后需自动对账再决定重放**的真实需求。满足后按本 spec 扩展 `ToolRecoveryPolicy`。

---

## 3. 设计

### 3.1 恢复策略（`tools/toolEffects.ts`，纯函数）

```ts
export type ToolRecoveryPolicy = 'retryable' | 'manual';
resolveToolRecoveryPolicy(name): ToolRecoveryPolicy
  // resolveToolEffect(name)?.idempotent === true ⇒ 'retryable'（可安全重放）
  // 否则（非幂等 / 未声明 MCP·插件）⇒ 'manual'（禁止自动重放，需人工/补偿）
canReplayAfterUnknown(name): boolean   // === (policy === 'retryable')
```

**单一来源**：与 `shouldBlindRetryTool` / `isNonIdempotentRetry` 同取 `resolveToolEffect`，不新建声明表。

### 3.2 `recover()` 带出 `unknownToolCalls`（`execution/`）

`ExecutionManager.recover()` 在把未结算调用置 `unknown` 后，**读取并分类前**先收集：
`RecoveryResult = { recovered, kept, unknownToolCalls: RecoveredUnknownToolCall[] }`（`execution/types.ts`）。
这是 `ExecutionStore.listToolCalls` 的**生产消费点**（消除"死 API"）。

### 3.3 组合根分类（`main.ts`）

`execution` 属 service 层 ⇒ **不得**反向依赖 app 层的 `tools`（R00-001）。故分类在**组合根**做：
恢复后按 `resolveToolRecoveryPolicy` 统计 `autoReplayAllowed` / `manualRequired` 并 `logger.warn`
（**只记工具名去重，不记参数**，防敏感值落日志）。

---

## 4. 验收

- ① `resolveToolRecoveryPolicy`：幂等工具（`file_read`）⇒ `retryable`；非幂等（`file_write`/`bash`）⇒ `manual`；未声明（`mcp__x`）⇒ `manual`。
- ② `canReplayAfterUnknown` 与 ① 一致（仅 `retryable` 为真）。
- ③ `recover()` 返回 `unknownToolCalls`：预置执行 + 未结算工具调用（陈旧心跳）⇒ 恢复后**含该工具名**；无未结算 ⇒ 空数组。
- ④ 未接入 store ⇒ `{recovered:0, kept:0, unknownToolCalls:[]}`。
- 回归：`tests/execution` 全绿（既有 `toEqual({recovered,kept})` 断言已同批补齐 `unknownToolCalls`）。

---

## 5. 实施记录

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **S1** | 恢复策略 + 重放守卫（纯函数）+ 出口 | `tools/toolEffects.ts` · `tools/index.ts` | ✅ 2026-10-10 |
| **S2** | `recover()` 带出 `unknownToolCalls` + 组合根分类告警 + 类型/出口 | `execution/types.ts` · `execution/ExecutionManager.ts` · `execution/index.ts` · `main.ts` | ✅ 2026-10-10 |
