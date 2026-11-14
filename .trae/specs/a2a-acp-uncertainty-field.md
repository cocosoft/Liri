# A2A / ACP 载荷：不确定性与推理轨迹（D5）—— 协议 spec

> **状态**：✅ 一期已实现（2026-11-14）：契约/归一化/协商/ACP 透传/A2A 注入缝均已落地并有 12 条回归；
> **产出方（provider）尚未接线**（缺省 `null` ⇒ 生产环境不写任何 `liri.*` 字段，见 §7）。
> **来源**：`dev_docs/20261113/建议落地方案-20261114.md` §2 波段二 **D5**。
> **关联规则**：GR02（同一语义只一套实现）、CS02（状态判定不用文案）、CS04（不造假数据）、
> §1.6（模型可见输入必须落盘）、R02（不新建事件类型/存储）。
> **相关既有实现**：`app/src/types/a2a.ts`（A2A v1.0 任务/消息/Artifact）、
> `app/src/acp/runtime/types.ts`（`AcpRuntimeEvent` / `AcpRuntimeCapabilities`）、
> `app/src/acp/control-plane/manager.turn-stream.ts`（thought 收集）、
> `app/src/infrastructure/http/handlers/routes/a2a-rpc.ts`（`A2A_METHODS` 11 方法）。

---

## 1. 目标与非目标

**目标**：让**协商场景**下的对端能读到本端回复的**置信度**与**推理轨迹摘要**，
用于"是否采纳 / 是否要人复核 / 是否触发多智能体复核"。

**非目标**：
- **不传原始思维链（CoT）**：只传**结构化步骤摘要**（kind + 一句话），避免泄露细节与放大 token；
- 不做置信度校准/训练（`score` 是**自评或验证器产出**，如实标注来源）；
- 不改变任何**现有必填字段**、不新增会话事件类型、不新建存储。

## 2. 字段定义（全部可选）

### 2.1 A2A（JSON-RPC / REST）

承载位置：`A2AMessage.metadata`（消息级）与 `A2ATask.metadata`（任务级，终态汇总）。
键名带 `liri.` 前缀（与 A2A v1.0 的 `metadata` 自由字段约定一致，**不侵入 schema**）。

```ts
// metadata['liri.uncertainty']
interface LiriUncertainty {
  /** 0..1；越小越有把握（本项目统一"不确定性"语义，避免 confidence/uncertainty 双轨） */
  score: number;
  /** 产出方式，机器可读；禁止用文案推断（CS02） */
  method: 'self_report' | 'verifier' | 'hybrid';
  /** 一句话依据（≤200 字符；不得含密钥/路径等敏感信息） */
  rationale?: string;
}

// metadata['liri.reasoningTrace']：最多 20 条，每条 summary ≤200 字符
interface LiriTraceStep {
  /** 从 1 开始的序号（展示顺序） */
  step: number;
  kind: 'plan' | 'tool' | 'check' | 'revise';
  summary: string;
}
```

- 消息级：回答该条消息的 `score/trace`；
- 任务级：只在**终态**（`TASK_STATE_COMPLETED` / `TASK_STATE_FAILED` 等）写入，
  汇总规则 = 取**最后一个** assistant 消息的 `score`（不重新计算、不平均）；
- Artifact **不加字段**（产物与不确定性正交）。

### 2.2 ACP（`AcpRuntimeEvent`）

- 复用既有 `text_delta.stream='thought'`（**现状已存在**，不改语义）；
- 在 `done` 事件增可选 `_meta`（ACP 约定的扩展位）：

```ts
// AcpRuntimeEvent 的 done 分支
{ type: 'done'; stopReason?: string;
  _meta?: { 'liri.uncertainty'?: LiriUncertainty;
            'liri.traceSteps'?: number /* 本次 turn 的 thought 分段数 */ } }
```

- 能力声明：`AcpRuntimeCapabilities` 增 `supportsUncertainty?: boolean`（默认不设置 = 不支持）。

## 3. 协商与默认关（关键）

**默认不发送**，且**不新增 featureFlag**：

| 协议 | 协商信号 | 未协商时行为 |
|---|---|---|
| A2A | 对端 `AgentCard.capabilities.extensions` 含 `urn:liri:a2a:uncertainty:v1`（`required=false`） | 响应**完全不写** `liri.*` 键（字节级与现状一致） |
| A2A（单次请求） | 请求头 `X-Liri-Uncertainty: accept`（便于未声明卡片的临时对端） | 同上 |
| ACP | `initialize` 的 `clientCapabilities._meta['liri.uncertainty'] === true` 或 `getCapabilities().supportsUncertainty` | 不写 `_meta` 字段 |

理由：字段放进 `metadata`/`_meta` 本可被旧对端忽略，但**默认不发**能避免"对外无提示地多传内部信息"，
也符合 `project_rules §1.4` 的"自主性/信息暴露必须显式 opt-in"。

## 4. 校验与边界

1. `score`：`Number.isFinite` 且 `0 ≤ score ≤ 1`，落盘/发送前**四舍五入到 2 位小数**；
   越界 ⇒ 丢弃该字段（不夹取、不伪造）。
2. `rationale` / `summary`：trim 后 ≤200 字符，超长按字符截断并加 `…`；
3. `trace`：最多 20 条；`step` 连续递增，缺号由产出侧补齐（不臆造内容）；
4. 敏感内容：`summary/rationale` 只取**已脱敏摘要**（复用既有 output guard 的脱敏结果，
   若 guard 关闭则只传 `kind`，不传 summary —— fail-closed）；
5. `method` 取枚举；未声明 ⇒ 不写该字段。

## 5. 向后兼容

- 所有字段**可选**，只出现在 `metadata` / `_meta`；旧对端按"未知字段忽略"处理；
- 不修改 `A2AMessage.parts`、`A2ATask.status`、`AcpRuntimeEvent` 既有分支的必填字段；
- 未协商时序列化结果与当前版本**逐字节一致**（由测试锁定）。

## 6. 验收与测试计划

| # | 用例 | 断言 |
|---|---|---|
| 1 | 未协商（无扩展 URI / 无请求头） | 响应 JSON **不含** `liri.` 键（deep-equal 现状快照） |
| 2 | 协商 + 正常值 | `metadata['liri.uncertainty'].score` 为 0..1 两位小数，`method` 合法 |
| 3 | 越界 score / 超长 summary / 25 条 trace | 越界字段被丢弃；超长被截断；trace 截到 20 条 |
| 4 | 任务级汇总 | 终态任务 `metadata` 的 score = 最后一个 assistant 消息的 score |
| 5 | ACP 未协商 | `done` 事件无 `_meta`；`supportsUncertainty` 未设置 |
| 6 | 审计 | 每条带 `liri.*` 的响应在日志中记 `a2a.uncertainty.exposed`（含 score/method，不含原文） |

## 7. 未做 / 风险（如实）

- **产出方未接线（关键）**：A2A 侧通过 `setA2AUncertaintyProvider()` 注入真实信号；
  当前**没有任何装配点注入** ⇒ 生产响应恒不含 `liri.*`（符合 CS04：不造假）。
  接入方式：在委派执行完成处（`ChatManager` 自评 / `VerifierAgent` 结果）调用该 setter；
- **A2A 任务级汇总**：`lastUncertaintyFromMessages()` 已提供（纯函数），但"消息级写入 + 任务级汇总"
  需随产出方一起接线；`GET /v1/a2a/tasks/{id}` 的持久化 metadata 依赖端口存储合并（当前未做）；
- **不保证置信度准确**：`self_report` 可能过自信；因此 `method` 必填、消费方据此决定是否复核；
- **不传原始 CoT**：只传步骤摘要；需要原始推理时仍走既有 `agent_thought_chunk`（流式、受权限约束）；
- **不做跨端校准**：多智能体场景若要"同行评审置信度"，另立 spec（D4/D3 依赖）；
- **ACP `_meta` 键名**待与上游 ACP 实现核对（本仓 `types.ts` 原先未使用 `_meta`；若上游禁用扩展位，
  改为 `AcpRuntimeCapabilities.supportsUncertainty` + 独立 `status` 事件文本摘要）。

## 8. 实现落点（2026-11-14）

| 落点 | 内容 |
|---|---|
| `app/src/types/uncertainty.ts` | 键名/扩展 URI/边界常量；`normalizeUncertainty` / `normalizeTrace`（越界丢弃、20 条、200 字、无脱敏不传文本）/ `attachUncertaintyMetadata`（空信号不写键）/ `acceptsUncertainty` / `lastUncertaintyFromMessages` |
| `app/src/acp/runtime/types.ts` | `done._meta?`、`AcpRuntimeCapabilities.supportsUncertainty?` |
| `app/src/acp/control-plane/manager.turn-stream.ts` | `TurnStreamResult.uncertaintyMeta?`（最后一个 `done._meta` 透传） |
| `app/src/infrastructure/http/handlers/routes/a2a-routes.ts` | `setA2AUncertaintyProvider` 注入缝；`runDelegation(..., acceptUncertainty)` 仅在协商 + 有信号时合并 metadata；REST 读 `X-Liri-Uncertainty` |
| `a2a-rpc-contract.ts` / `a2a-rpc.ts` | `A2ARpcDeps.acceptUncertainty?`，`SendMessage` 与 REST 共用同一协商结果 |
| `app/tests/types/uncertainty.test.ts` | 12 例：归一化边界 / 合并 / 协商 / ACP 透传 / A2A 注入（含"未协商、无产出方、越界值 ⇒ 无键"） |
