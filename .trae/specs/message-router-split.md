# Spec：`messageRouter.ts` 拆分（C3-S3 子 spec）

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：**S1 已实施**
> **来源**：`dev_docs/20261009/任务计划.md` §3-C3（O7）· 主 spec `.trae/specs/large-file-split.md` §4-S3
> **关联规则**：GR15 · CS01（只搬位置/不改语义）· CS03 · CS06 · R04-001（尺寸）· **R03-004（渠道入站唯一入口，门禁依赖 `messageRouter` 路径/函数名）** · R03-002（模块出口单一）

---

## 1. 背景与约束（CS06 取证）

- 现状：`app/src/channels/routing/messageRouter.ts` **1290 行**；`lint:size` **严重度 = 警告**（门禁 warning 阈值 **500 行**、error 阈值 **2000 行**）⇒ 拆分属**可维护性增量**，**非**合规缺陷修复。
- 对外 API（**必须保持不变**，消费方 `setupChannels.ts` / `ChannelBridgeAdapter.ts` / `tests/channels/MessageRouter.test.ts`）：
  `routeChannelMessage`（函数）· `validateInboundFrame`（函数）· `RouteResult` / `FrameValidationResult` / `RouteMessageOptions`（类型）。
- **硬约束**：`routeChannelMessage` **必须留在 `messageRouter.ts`**（R03-004 门禁按该文件路径/函数名定位渠道入站唯一入口）⇒ 只能把其**外围**（类型/常量/独立助手）与**内聚子阶段**迁出。

## 2. 拆分方案（S1）

| 迁出物 | 新落点 | 性质 |
|---|---|---|
| `RouteResult` · `FrameValidationResult` · `RouteMessageOptions` | `routing/messageRouterContract.ts` | 纯搬迁（类型） |
| 常量（`MAX_MESSAGE_SIZE`/`CONTENT_DEDUP_WINDOW_MS`/`STREAM_IDLE_TIMEOUT_MS`/`LONG_TASK_PLACEHOLDER_AFTER_MS`/`CANCEL_GRACE_MS`/`SESSION_ADMISSION_WAIT_MS`/`ADMISSION_POLL_MS`） | `routing/messageRouterContract.ts` | 纯搬迁（值） |
| `sanitizeSessionId` · `resolveAdmissionWaitMs` · `runSerialized`（含 `sessionQueues`） | `routing/messageRouterSerialization.ts` | 纯搬迁（函数） |
| `validateInboundFrame` | `routing/messageFrameValidation.ts` | 纯搬迁（函数）；**由 `messageRouter.ts` 重导出**保留 API |
| 内容级去重（缓存 + 周期清理 + 判定） | `routing/contentDedup.ts` | **内聚抽取**：`claimContentDedup()` 返回判定，调用方负责日志/追踪/返回 |
| 纯文本审批前置检查 | `routing/textApproval.ts` | **内聚抽取**：`tryHandleTextApproval()` 命中⇒`RouteResult`，未命中⇒`null`（`otel.endSpan` 留调用方保时序） |
| 出站投递（文本 + 文件） | `routing/channelOutbound.ts` | **内聚抽取**：`deliverChannelOutbound()`；文本失败**仍抛出**（外层 catch 承接），文件失败不抛 |
| **流式消费循环**（S2） | `routing/streamConsumption.ts` | **内聚抽取**：`consumeStreamChunks()` 返回 `{content, finishReason}`；空转超时**仍抛** `ExecutionAbortedError`（两段式取消的 catch 留调用方） |

> **不改语义**：所有迁出项的**运行期行为逐字不变**；`routeChannelMessage` 的函数体**除调用点替换外不改写**。

## 3. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01/CS03 | 只搬位置/抽内聚；无逻辑改写 |
| CS06 | 行数、门禁阈值、消费方**均实测取证**（§1） |
| GR15 | 本 spec 先于实施 |
| R03-004 | `routeChannelMessage` **留在原文件**；`messageRouter.ts` 仍是渠道入站唯一入口 |
| R03-002 | 子模块为**模块内相对引用**；对外 API 经 `messageRouter.ts` 重导出 |
| R04-001 | 拆分后 `messageRouter.ts` 行数下降；子文件均 <500 |

## 4. 实施记录

### S1（2026-10-09，已实施并验证）

| 交付 | 落点 |
|---|---|
| 契约（类型 + 常量） | `app/src/channels/routing/messageRouterContract.ts` |
| 串行化 / 会话键 / 准入助手 | `app/src/channels/routing/messageRouterSerialization.ts` |
| 帧验证 | `app/src/channels/routing/messageFrameValidation.ts` |
| 内容去重 | `app/src/channels/routing/contentDedup.ts` |
| 纯文本审批预检 | `app/src/channels/routing/textApproval.ts` |
| 出站投递 | `app/src/channels/routing/channelOutbound.ts` |
| 主文件（保留 `routeChannelMessage`） | `app/src/channels/routing/messageRouter.ts` |

**规模**：`messageRouter.ts` **1290 行 → S1 990 → S2 816 行**；7 个新子文件均 < 500 行。

**验证**：`typecheck` ✅ · `bun run lint` **0** ✅ · `tests/channels/MessageRouter.test.ts` **14 pass** ✅ ·
全量 `bun test` **5178 pass / 36 skip / 0 fail** ✅ · `lint:arch` 错误 **0** ✅ · `lint:size` **0 错误**。

> ⚠️ **预存 flaky（非本次引入）**：`tests/utils/commonId.test.ts`「C1 统一 ID 熵源 > 唯一性」偶发失败
> （`generateId` 6 位十六进制 ≈ 1670 万空间，批量 2000 ⇒ 按生日悖论约 **12%** 碰撞）⇒ 已登记台账 L-6。

### S2（2026-10-09，已实施并验证）—— 流式消费循环抽取

| 交付 | 落点 |
|---|---|
| 流式消费循环 | `app/src/channels/routing/streamConsumption.ts`（`consumeStreamChunks()`） |

**边界（语义不变）**：`for(;;)` 消费循环（空转计时器 / `requestCancel`+`abort` / `done` 分支 `finishExecution` /
`tool_call` 记账 / 工具进度通知 / 长任务占位）整体迁出；**两段式取消的 `catch` 留在 `messageRouter`**
（需 `channelSessionManager.endExecution` + `lease.release`）⇒ 超时仍以 `ExecutionAbortedError` 抛出、
由调用方 grace 段处理。

**验证**：`typecheck` ✅ · `lint` **0** ✅ · 全量 `bun test` **5178 pass / 36 skip / 0 fail** ✅ ·
`lint:arch` 错误 **0** ✅ · `lint:size` **0 错误**（`messageRouter.ts` **816 行**）✅。

> **S3（候选，未做）**：`routeChannelMessage` 剩余（~430 行）的**结果分支抽取**（busy/error/empty 三分支 +
> 准入等待）—— 属**可选**维护性增量（`lint:size` 已 0 错误、文件已 <1000）。
