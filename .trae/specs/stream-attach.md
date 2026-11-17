# 聊天流 attach 端点（最小设计）

> 状态：**待评审**（本文只定契约与实现点，不改代码）
> 日期：2026-11-18
> 关联：`client/src/hooks/useRunClock.ts`、`client/src/components/ChatArea/useWaitState.ts`（Run HUD 前两段已落地：运行秒表 + 后端心跳 + 「仍在后台运行」）

## 1. 背景与目标

用户诉求（逐字）：「在前端会话进程中，应该有一个当前是运行/结束/等待/超时这类的显著标识给用户，不然用户真的以为你挂了。」

前两段已给出**本页可见**的状态证据。仍缺一件事：**本页没接上这条流时，无法把输出接回来**。目标是加一个**只读**的后端 attach 端点：

1. 客户端拿到 `GET /v1/sessions/:id/attach` 后，能收到本轮**已产生的帧**（按游标续传）；
2. 之后**实时**收到新帧，直到本轮结束（`[DONE]`）；
3. 任何"接不上"的情形都**显式失败**（404/409/429），前端据此退回"刷新落盘内容"，绝不假装连续。

## 2. 代码事实（本文设计的事实基础，均为当前工作区实测）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 聊天 SSE 由 `handleStreamingChat` 手动迭代 `coreAPI.chatStream(chatRequest)` 生成器，逐 chunk 构造帧并 `res.write` | `app/src/infrastructure/http/handlers/chat-handlers.ts:847` / `:1067` / `:1091-1141` |
| F2 | 帧构造唯一实现是 `buildStreamChunkFrame`，尾部帧由 `writeStreamTail` 写出，末尾 `data: [DONE]` | `handlers/chatStreamFrames.ts:48`；`chat-handlers.ts:1129` / `:1158` / `:1170` |
| F3 | 运行态只有布尔 `isSessionStreaming(sessionId)`，键为 `_sessionAbortControllers`；**没有**任何"按会话的实时帧广播/环形缓冲" | `app/src/chat/ChatManager.ts:382` |
| F4 | 每会话有**落盘** append-only 事件日志（seq 单调）：`append` / `getTailSeq` / `read({fromSeq,…})` | `packages/service/src/session/storage/EventLogStorage.ts:569` / `:402` / `:1127`；宿主 `ChatManager.ts:1039` / `:1094` / `:1106` |
| F5 | 断线恢复是**按检查点重新跑**（`restore()` 出消息快照 + 工具进度计数，再新建生成器），不能接管进程内已在跑的生成器 | `chat/manager/streamResume.ts:253` / `:311`；`StreamingAutoCheckpoint.ts:223` |
| F6 | 全局事件通道 `/v1/events` 按**身份**投递（`broadcastEvent`），只带 `data.sessionId`，无"按会话回放"语义 | `app/src/infrastructure/http/LocalHTTPServiceSSE.ts:97` / `:185` |
| F7 | 客户端首帧断开即中止本轮：Rust 通道发送失败 → `return` → 连接关闭 → `res.on('close')` → `abortSessionOnClose` → `abortSessionStream` | `client/src-tauri/src/commands/backend_ctrl.rs:693`；`chat-handlers.ts:914-918`；`chat/manager/streamAbort.ts:36` |

## 3. 方案选型（为什么不用现成通道）

| 候选 | 可否直接用 | 结论 |
|---|---|---|
| 复用 `events.jsonl`（F4）读历史再 tail | ✗ | 事件是**语义事件**（turn/tool/…），不是逐 token 的 SSE 帧；且落盘有滞后。用它 attach 只能得到粗粒度事件，接不出"正在流的正文" |
| 复用 `/v1/events`（F6） | ✗ | 身份级广播，无会话回放游标；改造成按会话 fan-out 会动全局事件总线（风险 > 收益） |
| 复用 checkpoint resume（F5） | ✗ | 它是"从快照**重跑**"，会重复执行工具/重发模型请求；attach 要求**只读、不重跑** |
| **在帧写出处 tee 到进程内环形缓冲** | ✓ | 零行为变化（主链路字节不变），帧格式直接复用 `buildStreamChunkFrame`（实现唯一性） |

**选定：帧级 tee（本 spec 方案）。** 内存态、进程重启即失效 —— 这是有意的边界（见 §7）。

## 4. 契约

### 4.1 端点

```
GET /v1/sessions/:id/attach?from_seq=<int>&run_id=<string|omit>
```

- 鉴权：沿用全局中间层（`LocalHTTPService.ts:449` 的 bearer/session 校验），路由内不重复实现。
- `from_seq`：客户端**已消费**的帧序号（0 = 从头重放）。缺省 0；非整数 ⇒ 400。
- `run_id`：上一次 attach 收到的 `runId`；本轮若已更换 ⇒ 409（防止把两轮帧拼成一条正文）。

### 4.2 成功响应（`200 text/event-stream`）

```
data: {"__pyapp_type":"attach_meta","runId":"chatcmpl-xxxxxxxx","fromSeq":120,"nextSeq":300}

id: 120
data: {…与 /v1/chat/completions 完全同形的帧…}

id: 121
data: {…}
…
: heartbeat            ← 每 15s（attach 自己写，不转发主链路心跳）
data: [DONE]
```

要点：

1. 首帧固定是 `attach_meta`（含 `runId`/`fromSeq`/`nextSeq`），随后按 `id:` 逐帧重放 `from_seq … nextSeq-1`，再转入实时转发。
2. 数据帧**逐字复用**主链路帧（§2 F2），前端解析器无需新分支；旧客户端收到未知 `__pyapp_type` 会自然忽略。
3. `id:` 采用 SSE 标准字段，取值即帧序号（客户端只解析 `id:` 计数，不必依赖 JSON）。
4. 本轮结束 ⇒ 写完 `data: [DONE]` 后 `res.end()`；**attach 不参与**终态写帧（`writeStreamTail` 由主链路写，且其帧同样被 tee ⇒ attach 客户端能看到 usage/done 帧）。
5. 重放按请求时刻的快照进行，之后追加实时帧；同一帧不会重复（游标推进在 publish 时单点完成）。

### 4.3 失败响应（JSON，非 SSE）

| 状态 | `error.code` | 触发条件 | 附带字段 |
|---|---|---|---|
| 404 | `no_active_run` | 该会话无运行中/保留期内的 run | — |
| 409 | `cursor_gap` | `from_seq < oldestSeq`（环形缓冲已淘汰） | `oldestSeq` `nextSeq` `runId` |
| 409 | `run_mismatch` | 带了 `run_id` 且与当前 run 不同 | `runId` `nextSeq` |
| 429 | `too_many_attachments` | 该会话 attach 订阅数 ≥ `ATTACH_MAX_SUBSCRIBERS` | — |

前端对 404/409 的唯一正确反应：**重新拉落盘消息**（`GET /v1/sessions/:id/messages`），并提示"本轮已结束/事件已过期"，不拼接旧帧。

### 4.4 常量（建议值 + 依据）

| 常量 | 值 | 依据 |
|---|---|---|
| `ATTACH_HEARTBEAT_MS` | `15000` | 与主链路心跳一致（`chat-handlers.ts:893-905`） |
| `ATTACH_MAX_FRAMES` | `4000` | 覆盖~10 分钟高频小帧；超出淘汰最旧 |
| `ATTACH_MAX_BYTES` | `8 MiB` | 长工具结果帧的兜底，按帧字符串长度累计 |
| `ATTACH_RETENTION_MS` | `60000` | run 结束后保留 1 分钟：解决"刚结束才 attach"的竞态，attach 仍能拿到全量 + `[DONE]` |
| `ATTACH_MAX_SUBSCRIBERS` | `3` | 只读端，多端观察够用 |
| `ATTACH_SLOW_CLIENT_MAX_BUFFER` | `4 MiB` | 订阅端 `res.writableLength` 超限即断开该订阅（可凭 `from_seq` 重连），避免拖垮主链路 |

## 5. 后端实现点（最小改动面）

### 5.1 新模块 `app/src/infrastructure/http/handlers/streamAttachHub.ts`

纯帧层，**不依赖 ChatManager**（层级：与 `chatStreamFrames.ts` 同级），导出：

```ts
export interface RunHandle {
  publish(frame: string): void; // 每次主链路写出帧后调用（含尾部帧）
  end(): void;                  // 主链路本轮结束：标记 ended，启动 RETENTION 定时清理
}
export function beginRun(sessionId: string, runId: string): RunHandle;
export function openAttach(
  sessionId: string,
  fromSeq: number,
  runId?: string
): { ok: true; meta: string; replay: string[]; subscribe(cb: (frame: string) => void): void; detach(): void }
 | { ok: false; status: 404 | 409 | 429; body: Record<string, unknown> };
```

内部结构：`Map<sessionId, { runId, frames: string[], baseSeq, nextSeq, oldestSeq, ended, subscribers }>`，模块级单例。
必须满足的三条硬约束：

- `publish` **不可抛**：内部不调用任何用户回调；写订阅者失败只记录 `logger.warn` 并摘除该订阅者；
- 订阅者写入前检查 `res.destroyed || res.writableEnded`；
- `beginRun` 时若已有同会话条目（上一轮未清理）⇒ 以新 run 覆盖，旧订阅者收到 `[DONE]` 后断开。

### 5.2 `handleStreamingChat` 的接线（3 处，字节不变）

- 取 `request.session_id` 后：`const run = beginRun(sessionId, responseId)`（`responseId` 在 `:920` 生成，需把 `beginRun` 移到其后）；
- 把现有各写点收拢为一个局部函数：
  ```ts
  const writeFrame = (frame: string) => { res.write(frame); safeFlush(res); run.publish(frame); };
  ```
  调用点：`:925` 首帧、`:938` 状态帧、`:1135` 循环内帧、`:1160` 尾部帧、`:1170` `[DONE]`；
- 本轮结束（成功/异常/客户端断开三条出口）统一 `run.end()`；**不改变**现有 `close → abort` 语义（见 D1）。

> 唯一性：帧仍然只由 `buildStreamChunkFrame` / `writeStreamTail` 构造，hub 只存字符串，不二次序列化。

### 5.3 新 handler `handleAttachStream(handlerCtx, req, res, sessionId)`

- 解析 `from_seq`（非整数 ⇒ 400）；
- `openAttach(...)` 失败 ⇒ 按 §4.3 写 JSON；
- 成功 ⇒ 写 SSE 头（与主链路同：`text/event-stream; charset=utf-8` / `no-cache` / `keep-alive` / `X-Accel-Buffering: no`）、`safeFlush`、写 `attach_meta`、重放、订阅、起 `ATTACH_HEARTBEAT_MS` 定时器；
- `req`/`res` 的 `close` ⇒ `detach()` + 清定时器。**明确不调用** `abortSessionStream`（只读端断开不得中止本轮）。

### 5.4 路由注册（照抄现有风格）

`app/src/infrastructure/http/handlers/routes/chat-session-routes.ts`，紧邻 `/streaming` 分支（`:271-277`）：

```ts
if (method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/attach$/)) {
  const sid = requireSessionId(url, /^\/v1\/sessions\/(.+)\/attach$/, res);
  if (sid === null) return true;
  await handleAttachStream(handlerCtx, req, res, sid);
  return true;
}
```

## 6. 客户端接入契约（第二阶段，不在本次后端改动内）

1. `chatService.attachStream(sessionId, fromSeq, runId?)`：用现有 `createStreamReader` 读 SSE，解析 `data:` 帧交给**现有** `processChunk` 处理链（不得另建渲染管线）；`id:` 行用于推进 `fromSeq`。
2. 入口：`StatusFloatBar` 在 `wait.remoteStreaming === true` 时显示「接入」按钮（当前只显示文案）；点击 ⇒ attach。
3. 404/409 ⇒ 重拉消息 + 文案「本轮已结束（或事件已过期），已刷新为落盘内容」；不得静默拼接。
4. 接入期间 `isStreaming`/`streamControllers[sid]` 按现有约定登记，使「停止」按钮继续可用（停止仍走 `abortSessionStream`，语义不变）。

## 7. 非目标（明确不做）

- 不做"接管执行"：attach **只读**，不重放工具副作用、不重发模型请求；
- 不做跨进程/跨重启 attach（进程重启后一律 404，恢复仍走既有检查点链路）；
- 不改 `/v1/chat/completions` 的线格式、结束语义与错误语义；
- 不做多端一致性（每个 attach 客户端各自持有游标，互不影响）；
- 不把 `events.jsonl` 当帧源。

## 8. 必须拍板的决策

**D1（关键）：客户端断开是否仍立即中止本轮？**

- 现状（F7）：`close → abort`。后果：**刷新页面后没有可 attach 的 run**，attach 只能服务"另一个客户端/半开连接/CLI 触发的运行"。
- 选项 A（本 spec 默认）：保持现状，先只上端点与 tee。范围最小、零行为变化，但**刷新场景仍接不回来**。
- 选项 B：新增 `client_disconnect_grace_ms`（默认 `0` = 行为不变）。`>0` 时断开后不立即 abort，等 attach 接管；超时才 abort。风险：孤儿运行（用户以为停了）、资源占用。
- 建议：A 先落地并验证；B 单独评审、默认关闭，且需同时定"孤儿运行"的兜底（grace 到期 abort + UI 明示）。

**D2**：`from_seq` 语义按"帧序号"（本 spec）还是按已有 `events.jsonl` 的 `seq`？建议帧序号（帧才是 attach 要重放的对象）。

**D3**：是否需要给 attach 单独限流（例如每会话每分钟 10 次）？建议先不加，用 `ATTACH_MAX_SUBSCRIBERS` 兜住。

## 9. 验收标准（可执行）

1. 运行中 `curl -N "$BASE/v1/sessions/$SID/attach?from_seq=0"` ⇒ 收到 `attach_meta` + 帧流 + 15s 心跳；本轮结束收到 `[DONE]` 并连接关闭。
2. `from_seq=N`（N 为重放中观察到的中间值）⇒ 首帧 `attach_meta.fromSeq === N`，重放从 `id: N` 起，**无重复、无缺口**。
3. 带旧 `run_id` 请求 ⇒ 409 `run_mismatch`；`from_seq` 小于已淘汰下界 ⇒ 409 `cursor_gap`；无 run ⇒ 404。
4. **关闭 attach 连接后，`GET .../streaming` 仍为 `streaming:true`**（只读端不得中止本轮）。
5. 主链路字节不变：同一轮在"有 attach / 无 attach"两种情况下，原客户端收到的帧序列逐字相同（可对比测试）。
6. run 结束后 `ATTACH_RETENTION_MS` 内 attach 仍可拿到全量 + `[DONE]`；超时后 404 且 hub 条目被释放。

## 10. 测试计划

- 单测（`app`，`bun test`）：`streamAttachHub` 的游标单调、淘汰 → `cursor_gap`、`run_mismatch`、保留期清理、订阅者异常断开不影响 publish。
- 路由测：400/404/409/429 与 SSE 头字段；`openAttach` 后立即 `end()` 的竞态（先 `[DONE]` 后关闭）。
- 回归：`handleStreamingChat` 既有测试（若有）必须全绿；新增"无 attach 时 `run.publish` 为 no-op 路径"的用例。
- 手工 E2E：长工具调用期间 attach，比对 attach 收到的正文与最终落盘 `assistantMessage.content`。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| tee 侵入流式热路径 | 只加一次 map 查找 + 数组 push；`publish` 不抛；主链路写点收拢为一个函数（diff 可读） |
| 慢订阅端拖垮主链路 | `writableLength` 超限即断开该订阅（§4.4） |
| 内存增长 | 帧数/字节双上限 + 保留期定时清理（§4.4） |
| 会话内容越权 | 与 `/messages` 同级：需要同一 API key + 会话 id；本地单主体模型，不新增暴露面（沿用 `LocalHTTPService` 鉴权） |
| 误以为"刷新也能接回" | D1 未选 B 前，UI 不得承诺"刷新可接回"；404 文案必须说"已结束" |

## 12. 实施记录（2026-11-18，P1 = 端点 + tee）

按 §8 建议选 **A**：只上端点与 tee，**不改** `close → abort` 语义。

| 项 | 落点 |
|---|---|
| 帧缓冲/订阅/游标 | `app/src/infrastructure/http/handlers/streamAttachHub.ts`（新增，含 §4.4 常量） |
| 主链路 tee | `chat-handlers.ts#handleStreamingChat`：新增 `attachRun` + `writeFrame`，6 个写点收拢；`finally` 统一 `end()` |
| SSE 响应头去重 | 同文件常量 `SSE_RESPONSE_HEADERS`（chat 流与 `handleResumeChat`、attach 共用） |
| handler | `chat-handlers.ts#handleAttachStream`（只写自己的 `res`，**不**调用 `abortSessionStream`） |
| 路由 | `routes/chat-session-routes.ts`：`GET /^\/v1\/sessions\/(.+)\/attach$/`（紧邻 `/streaming`） |
| 单测 | `handlers/__tests__/streamAttachHub.test.ts`（13 条）+ `attachStreamHandler.test.ts`（5 条） |

**已知限制（如实记录）**：

1. `handleResumeChat`（`POST /v1/sessions/:id/resume`）的续跑流**未**接入 tee ⇒ 对"续跑产生的这一轮" attach 会 404。补接线时只需同样收拢其 3 个 `res.write` 写点。
2. 进程重启后一律 404（内存态，见 §7）。
3. 客户端「接入」按钮与 `attachStream` 消费端尚未实现（§6 属第二阶段）。

