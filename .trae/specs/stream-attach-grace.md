# attach 宽限期：刷新后可接回（D1-B）

> 状态：✅ **已实施（2026-11-18）**：P1（主链路断开宽限）+ P2（续跑流同口径）均已落地
> （`b2b0d2c3f` / `5b998a21e`）；真机验证 12/12 + 5/5 PASS，见 §12.2。
> 日期：2026-11-18
> 上游：`.trae/specs/stream-attach.md`（§8 D1：选项 A 已落地，本文是选项 B 的子 spec）

## 1. 目标

用户原话：「在前端会话进程中，应该有一个当前是运行/结束/等待/超时这类的显著标识给用户，不然用户真的以为你挂了。」

attach 端点（`926d1bf50`）+ 客户端接入（`78f16071f`）已解决"能看见、能接回"。仍缺**最常见的一种情形**：**刷新页面**。

现状（已核实）：刷新 ⇒ Rust 通道发送失败 ⇒ 连接关闭 ⇒ 后端 `res.on('close')` ⇒
`abortSessionOnClose` ⇒ `abortSessionStream` ⇒ 本轮被中止（系统侧 reason）。
所以刷新后**没有可 attach 的 run**，attach 只能服务"另一个窗口 / 半开连接 / CLI 触发的运行"。

**目标**：让"刷新 → 重新进入会话 → 在宽限期内 attach"能接回**同一轮**输出；宽限期内无人接回则按现有语义中止（不留孤儿）。

## 2. 关键事实（决定方案形状）

| # | 事实 | 位置 |
|---|---|---|
| G1 | 流式生成器**只在被 `.next()` 推进时才产出**（`coreAPI.chatStream` 生成器由 handler 手动迭代） | `chat-handlers.ts:1116-1164` |
| G2 | 客户端断开时，循环**跳出并 `generator.return()`**，注释明确：否则会话互斥锁永不释放 | `chat-handlers.ts:1116-1135` |
| G3 | 断开还有第二条中止路径：`res.on('close') → abortSessionOnClose → abortSessionStream` | `chat-handlers.ts:927` / `:152` / `chat/manager/streamAbort.ts:36` |
| G4 | 会话互斥锁超时 30s（`SimpleMutex: acquire timeout after 30000ms`） | `packages/kernel/src/core/SimpleMutex.ts:34` |
| G5 | attach hub 已有"帧缓冲 + 订阅 + 结束保留 60s" | `handlers/streamAttachHub.ts` |
| G6 | 前端行态：`streaming` 布尔 + 本页是否接入（`remoteStreaming`）已经能如实表达"后台在跑、本页未接入" | `client/src/components/ChatArea/useWaitState.ts` |

**推论（本 spec 的核心）**：只把 `close → abort` 改成"延迟 abort"**没有用**——
G1/G2 决定了没人 `next()` 生成器就停在那里。必须让 **"推进生成器的泵（pump）"与"HTTP 响应"解耦**：
连接断了，泵继续跑、帧只进 attach hub；宽限期内有人 attach 就继续，无人则中止。

## 3. 方案（P1：仅流式主链路）

### 3.1 泵与响应解耦

在 `handleStreamingChat` 内引入"是否仍向本响应写出"的开关（`detached`），写帧改为单一出口：

```ts
const emit = (frame: string): void => {
  attachRun?.publish(frame);                       // 旁路：始终给 hub（attach 的唯一来源）
  if (!detached && !res.destroyed && !res.writableEnded) {
    res.write(frame);
    safeFlush(res);
  }
};
```

- `detached=false`：与今天逐字等价（先 `res.write`，再……顺序见 §7 不变量 I3）。
- `detached=true`：只 `publish`，不碰已死的 `res`；循环**继续** `generator.next()`。

### 3.2 断开时的两种路径

| 配置 | 行为 |
|---|---|
| `client_disconnect_grace_ms = 0`（**默认**） | 与今天完全一致：`abortSessionStream` + `generator.return()` + `break` |
| `> 0` | ① 置 `detached=true`；② 停心跳定时器；③ 启一个宽限定时器；④ **不** abort、**不** return，继续泵 |

宽限定时器到点：

- **期间有 attach 订阅者出现**（hub 提供 `hasSubscribers(sessionId)`）⇒ 取消定时器，泵继续到本轮自然结束（等同正常流式）；
- **无人 attach** ⇒ `abortSessionStream(activeSessionId)` + `generator.return()` + 清理（与今天的结果一致，只是晚了 `grace` 毫秒）。

### 3.3 三条边界（防孤儿）

1. **只有宽限期，没有"无限后台"**：`detached` 且**无订阅者**的时间不得超过 `client_disconnect_grace_ms`。
2. **有订阅者后不再设上限**：此时有人看着，等同于正常流式（否则长任务会被误杀）；仍受既有"停止"与看门狗约束。
3. **既有中止入口一律保留**：`stopMessage` → `abortSessionStream`；切换会话 → `stopAndFlush`；进程重启 → 全部失效。
   `detached` 不是新的生命周期所有者，只是"暂时没有 HTTP 接收端"。

### 3.4 时序（正常 / 刷新 / 超时）

```
t0  流开始（chatcmpl-*），帧 → res + hub
t1  客户端刷新 ⇒ res close
      grace=0 : abort + return（今天）
      grace>0 : detached=true，泵继续；hub 持续积累
t2a 新页面进入会话 → GET /streaming = true → 浮动栏「仍在后台运行」→ 点「接入」
      → attach 回放 0..N + 实时；宽限定时器取消；正文在结束时按落盘刷新
t2b grace 到期仍无人接入 ⇒ abortSessionStream（消息以当前部分内容落盘，同今天）
```

## 4. 配置

| 键 | 形式 | 默认 | 说明 |
|---|---|---|---|
| `client_disconnect_grace_ms` | `LIRI_CLIENT_DISCONNECT_GRACE_MS`（`packages/infra/src/constants/defaults.ts` 的 `envInt`，`common.ts` 以 `@kind B` 转出） | `0` | `0` = 完全关闭（零行为变化，可随时回滚）；建议启用值 `60000`（覆盖一次刷新 + 用户点"接入"的时间） |

> 不提供 UI 开关（属诊断/自托管配置）；若后续要暴露，走设置页独立事项。

## 5. 改动点（预估）

| 文件 | 改动 |
|---|---|
| `packages/infra/src/constants/defaults.ts` + `common.ts` | 新增 `clientDisconnectGraceMs`（默认 0，B 类） |
| `handlers/streamAttachHub.ts` | 新增 `hasSubscribers(sessionId): boolean`（只读查询，1 行） |
| `handlers/chat-handlers.ts#handleStreamingChat` | ① `writeFrame` → `emit`（含 `detached` 判定）；② `res.on('close')` 分叉（grace=0 原样 / grace>0 置 detached + 定时器）；③ 循环内断开分支同上；④ `finally` 清定时器 |
| `handlers/chat-handlers.ts#handleResumeChat` | 同一套 `emit` + 宽限（续跑轮已接 tee，语义应一致；可后置为 P2 独立提交） |
| 前端 | **无需改动**（§6 的可选项另议） |

## 6. 客户端（可选，后置）

- 现状已足够：刷新后 `remoteStreaming=true` → 文案 + 「接入」按钮（`78f16071f`）。
- 可选项（建议**不做**在 P1）：进入会话时若 `remoteStreaming` 自动 attach。理由：自动接入会让"另一个窗口正在看"的场景出现双端争抢语义，且用户可能只是想看一眼别的会话。

## 7. 不变量（必须同时成立）

- **I1 零行为变化**：`grace=0` 时，`chat-handlers` 的帧字节、中止时机、日志与今天逐字一致。
- **I2 只读语义不变**：attach 断开仍**不**中止本轮；宽限期的中止**只**由"宽限到期且无订阅者"触发。
- **I3 帧顺序不变**：`emit` 内 hub 与 res 的先后不改变各自顺序（hub 按 publish 顺序，res 按 write 顺序）。
- **I4 锁一定会释放**：无论哪条出口（正常 / 宽限超时 / abort / return 超时兜底），互斥锁都必须在有限时间内释放（沿用 G2 的 `Promise.race(..., 5000)` 兜底）。
- **I5 落盘不受影响**：本轮消息仍由生成器自身的收尾路径写；宽限期只是"继续推进同一生成器"，不新建第二条写入。
- **I6 无新增内存无界**：hub 仍受 4000 帧 / 8MiB 上限；detach 期间不额外缓存别的东西。

## 8. 验收标准（可执行）

1. `grace=0`：全套既有测试全绿；刷新后 `GET .../streaming` 立即 `false`（与今天一致）。
2. `grace=60000`：运行中刷新 → 60s 内 `GET .../streaming` 仍 `true` → `GET .../attach?from_seq=0` 能拿到**刷新前**已产生的帧。
3. `grace=5000`：刷新后**不**接入 → 5s 后 `streaming=false`，且会话互斥锁已释放（紧接着发消息不出现 `SESSION_BUSY` / 30s 超时）。
4. 宽限期内接入 → 本轮正常跑到结束，落盘消息为**完整正文**（不是刷新时刻的部分文本）。
5. 接入后再断开（关掉新页面）→ 本轮**不中止**（I2），且 `streaming` 仍为 `true`。
6. 运行中点"停止"（无论是否 detached）→ 立即中止，`streaming=false`。

## 9. 测试计划

- 单测（`app`，`bun test`）：把"断开 → detached / 定时器 / hasSubscribers 取消"的判定抽成纯函数（输入：`grace`、是否已 detached、是否有订阅者、是否到点）→ 覆盖 §8 的 1/3/4。
- hub：新增 `hasSubscribers` 用例；`end()` 后为 false。
- 回归：`chat-handlers` 的帧产出不变（现有 `attachStreamHandler` / `streamAttachHub` 测试全绿）。
- 手工 E2E：`grace=60000` 下刷新页面，用 curl attach 对比刷新前后帧序。

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 互斥锁被"无人接收的运行"长时间占用，用户发消息被排队/超时 | 宽限默认 0；宽限期很短（建议 60s）；启用后 UI 已显示「仍在后台运行」，用户知道在等 |
| 孤儿运行（宽限期内用户再没回来） | 宽限到期 abort（I4）；不做"无限后台" |
| 刷新时的部分消息 vs 完整消息落盘差异 | 这正是收益（§8 第 4 条）：宽限内跑完即完整落盘；超时则与今天一致 |
| 与 `res.on('close')` 的原中止路径冲突 | 两条路径共用同一个 `detached` 标志位，只有一处能触发 abort（§3.2 单点） |

**回滚**：`LIRI_CLIENT_DISCONNECT_GRACE_MS=0`（默认值）即等价于改动前；代码侧保留 `grace=0` 原分支，无需 revert。

## 11. 未决问题

1. 宽限期内若**另一个窗口**先 attach，而原页面刷新回来又 attach —— 允许两个订阅者（hub 上限 3），是否需要"最后接入者优先"？建议：不需要，只读多端天然共存。
2. `handleResumeChat` 的宽限是否与主链路同批？建议：主链路先行（P1），resume 作为 P2 独立提交（它已接 tee，不接宽限只是"刷新后不能接回续跑轮"）。
3. 是否需要把 `detached` 状态暴露到 `GET /streaming`（如 `detached: true`）？建议：暂不暴露——`streaming + 本页无流` 已能推出 UI 需要的全部信息（G6）。

## 12. 实施记录（2026-11-18，P1 = 主链路）

按 §3 落地，`grace=0` 分支保持原样（I1）。

| 项 | 落点 |
|---|---|
| 配置 | `packages/infra/src/constants/defaults.ts`：`clientDisconnectGraceMs`（`LIRI_CLIENT_DISCONNECT_GRACE_MS`，默认 `0`）；`common.ts` 导出 `CLIENT_DISCONNECT_GRACE_MS`（`@kind B`） |
| 纯函数判定 | `handlers/streamDisconnectGrace.ts`（`resolveDisconnectAction` / `shouldAbortWhenGraceExpires`） |
| 订阅查询 | `handlers/streamAttachHub.ts#hasSubscribers` |
| 泵解耦 | `chat-handlers.ts#handleStreamingChat`：`writeFrame` = 先 publish、再（未 detached 时）写 res；新增 `detached` / `graceTimer` / `runFinished` / `tryDetachFromResponse` |
| 断开分支 | `res.on('close')` 与循环内 `destroyed` 分支统一走 `tryDetachFromResponse`；宽限到期且 `!hasSubscribers(sid)` 才 `abortSessionStream` |
| 收尾 | `finally` 清定时器 + `runFinished=true` + `attachRun.end()`；尾部/错误帧在 detached 下仍进 hub |
| 单测 | `__tests__/streamDisconnectGrace.test.ts`（6 条）+ hub `hasSubscribers`（1 条） |

**行为变化（仅在 `grace > 0` 时）**：

- 刷新后本轮**继续推进**（不再立即中止），帧累计在 attach hub；
- 宽限期内有人 attach ⇒ 跑到自然结束（**完整正文落盘**，不是刷新时刻的部分文本）；
- 宽限到期无人接入 ⇒ 中止（与今天结果一致，只是晚了 `grace` 毫秒）；
- 期间互斥锁仍被本轮持有（`SimpleMutex` 30s 超时口径不变）⇒ 用户马上发新消息会排队/失败，属已知代价。

**未做**：自动接入（§6 建议不做）；`detached` 未暴露到 `/streaming`（§11.3）。

**门禁备注**：`handleStreamingChat` 圈复杂度由 <40 升到 56（`eslint` warning，非 error）；
`lint:complexity` 重尾棘轮（≥100）未增长，通过。

### 12.1 P2（续跑流，2026-11-18 同日补）

- 把 §3.2 的判定抽成 **`createGracefulDetach`**（同一控制器：幂等 detach、宽限定时器、
  收尾清理），主链路与续跑流共用 —— 避免两处各写一份导致 grace 口径分叉（CS01）。
- `chat-handlers.ts#handleResumeChat`：`writeFrame` 同样先 publish 再（未 detached 时）写 res；
  `close` / 循环内 `destroyed` 统一走控制器；`finally` 清定时器 + `attachRun.end()`。
- 单测：`streamDisconnectGrace.test.ts` 增 4 条控制器用例（grace=0 不后台、幂等 detach、
  有订阅者不中止、finish 后不再 arm）。
- 全量回归：`app` 13088 pass / 0 fail / 42 skip（1565 文件）。

### 12.2 真机验证（2026-11-18，真实后端 + 真实模型，非 mock）

环境：本机后端以 `--http-only --http-port 18990` 启动（真实 `~/.pyapp` 数据与真实供应商），
模型用已配置的 **`glm-5.2`（智谱）** 与 **`deepseek-v4-flash`（DeepSeek）** 各跑一轮；
脚本对真实 HTTP/SSE 操作（临时脚本在系统 TEMP，不入库）。

**场景 A：刷新后可接回（`LIRI_CLIENT_DISCONNECT_GRACE_MS=60000`）—— 两个模型各 12/12 PASS**

以 `glm-5.2` 一轮为例（`deepseek-v4-flash` 同样全绿）：

| 观测 | 结果 |
|---|---|
| 收到 8 帧后**掐断连接**（等价刷新） | — |
| 断开后 `GET /streaming` | `streaming:true`（宽限生效，未中止） |
| `GET /attach?from_seq=0` | 200；`attach_meta.nextSeq=36` —— **断开后后端继续产出了 28 帧**，直接证明泵在后台继续 |
| 回放 / 实时 | 回放 36 帧 + 实时 514 帧，收 `[DONE]` 自然结束（18s） |
| 结束后 `GET /streaming` | `false` |
| `GET /messages` 落盘正文 | **1716 字，与 attach 累计正文 1716 字逐字等长**（不是刷新时刻的残片） |
| 保留期内再 attach（已结束轮次） | 200 且回放含 `[DONE]` |
| 无运行轮次 | 404 `no_active_run` |

**场景 B：宽限到期无人接入（`=3000`，模型 `deepseek-v4-flash`）—— 5/5 PASS**

| 观测 | 结果 |
|---|---|
| 断开瞬间 `streaming` | `true` |
| 不 attach，轮询 | **3s 后 `streaming:false`**（到期中止，无孤儿运行） |
| 立刻再发一条消息 | 200 且正常产出帧 —— **互斥锁已释放**，无 `SESSION_BUSY` / 30s 锁超时 |

**环境侧排除项（如实记录）**：本机 Ollama 本地模型无法完成长输出 ——
`qwen3.6-27b:latest` 在 120s 处 `The operation timed out`（用户随后已卸载该模型）；
换 `qwen2.5-coder:14b` 同样在 ~120s 超时（`chunkCount` 惨淡、无正文、该轮 `finishReason=error`）。
**与 attach/宽限期改动无关**，属本机本地推理速度 / provider 120s 超时；
换远端真实模型（`glm-5.2`、`deepseek-v4-flash`）后全部通过。

**当前机器状态**：验证结束后后端已重启回 `LIRI_CLIENT_DISCONNECT_GRACE_MS=60000` 并保持运行
（PID 见 `~/.pyapp/data/.liri.lock`）。



