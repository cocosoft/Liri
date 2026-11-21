# 入站消息监视：缺口补齐方案

> 版本 1.4 ｜ 日期 2026-11-21 ｜ 状态：**P1–P4 全部实施（2026-11-21）**
> 关联：[`dedup-message-state.md`](./dedup-message-state.md)（`channel_message_states` 落盘先例）、[`channel-process-isolation.md`](./channel-process-isolation.md)、[`message-router-split.md`](./message-router-split.md)

**结论先行**：Liri 的入站监视**并非空白** —— 指标、消息级链路追踪、渠道实时态三层均已端到端接线（§1 取证）。本方案只处理**四个缺口**（§2）：渠道维度缺失、链路不留存、无阈值告警、消息级无推送。

---

## 1. 现状（已回仓核）

### 1.1 埋点（单一管线内）

| 位置 | 行为 | 证据 |
|---|---|---|
| `routeChannelMessage()` 入口 | 入站计数 + 处理耗时起点 | `packages/channels/src/channels/routing/messageRouter.ts:195-196` |
| 同处 | 登记全链路 trace（`frame_check → dm_auth → dedup → rate_limit → ingest_funnel → session → llm → outbound`），终态 `finish` | `messageRouter.ts:215-221`，各分支 `addStage`/`finish` |
| 出站 | 发送阶段追加 `outbound` 阶段 | `packages/channels/src/channels/routing/channelOutbound.ts:46,54` |

### 1.2 指标

| 指标 | 维度 | 证据 |
|---|---|---|
| `channels.message.inbound_total` | **仅 `module`**（无 channel） | `packages/channels/src/channels/monitoring/ChannelMetrics.ts:44-52` |
| `channels.message.rejected_total` | `reason`（11 类：`INVALID_FRAME` / `UNAUTHORIZED` / `duplicate` / `inflight` / `content_dedup` / `RATE_LIMITED` / `INGEST_FUNNEL` / `SESSION_BUSY` / `INBOX_UNAVAILABLE` / `EMPTY_LLM_RESPONSE` / `LLM_ERROR`） | 同文件 `:87-98` |
| `channels.message.processing_ms` | `channel`（直方图） | 同文件 `:104-118` |
| `channels.delivery.send_total` / `send_ms` / `broadcast_total` | `platform` / 结果 | 同文件 `:124-165` |

出口：`GET /v1/channels/metrics`（`app/src/infrastructure/http/handlers/channel-handlers.ts:1211`）→ 前端 `ChannelMetricsCard`（仪表盘卡片，`DashboardPage.tsx:434`）。

### 1.3 消息级链路

- 内存环形缓冲 **500 条**，逐阶段记录状态/耗时/错误/发送者/50 字预览：`packages/channels/src/channels/monitoring/MessageTraceBuffer.ts`（`DEFAULT_CAPACITY=500` 见 `:77`，`begin/addStage/finish/recent` 见 `:89-190`）。
- 出口：`GET /v1/channels/messages/trace?limit&channel`（`channel-handlers.ts:1477`）、`GET /v1/channels/messages/trace/:traceId`（`:1520`）。
- 前端：`ChannelMonitorPanel`「消息链路」Tab，**10s 轮询**（`client/src/components/common/ChannelMonitorPanel.tsx:292-316`）。

### 1.4 渠道实时态与去重

- 五态机 + SSE（`status_change` / `reconnecting` / `recovered` / `probe_failed`）+ 强制重连：`packages/channels/src/channels/monitoring/ChannelRealtimeMonitor.ts:61-93`；出口 `GET /v1/channels/monitor/status|stream`、`POST /v1/channels/monitor/force-reconnect`（`channel-handlers.ts:1338-1420`）。
- 每渠道运行时状态已含 `lastMessageAt`（`ChannelRealtimeMonitor.ts:73`）——**静默检测需要的数据已存在，只是没有判定**。
- 入站去重处理态落盘：`channel_message_states`（`packages/channels/src/channels/dedup/DedupStore.ts:38,86-96`）。

---

## 2. 缺口（G1–G4）

| ID | 缺口 | 证据 | 用户可见后果 |
|---|---|---|---|
| **G1** | 入站总数**无 channel 维度** | `ChannelMetrics.ts:44-52`（labels 只有 `module`）；`ChannelMetricsCard.tsx:86-87` 只能把全部渠道加总 | 「飞书今天进来多少条、QQ 多少条」无法从指标回答，只能翻 500 条链路缓冲 |
| **G2** | 链路**纯内存、重启即清、无历史查询** | `MessageTraceBuffer.ts:29-31`（内存环形缓冲，重启即清）；无 `/history` 端点 | 凌晨断流后重启进程，证据消失；无法复盘「昨天 22:00 那批消息卡在哪一阶段」 |
| **G3** | **无阈值告警** | 全仓无渠道告警实现（`channels.*alert*` 零命中）；`lastMessageAt` 仅展示 | 拒绝率飙升、消息长期 `inflight`、渠道整天零入站，都不会主动告知 |
| **G4** | 消息级视图**只有轮询**，SSE 仅推渠道状态 | `ChannelMonitorEventType` 仅 4 个渠道级事件（`ChannelRealtimeMonitor.ts:82-86`）；前端 10s 轮询（`ChannelMonitorPanel.tsx:310-316`） | 突发流量时面板滞后最多 10s；无法做「来一条亮一条」的实时观察 |

---

## 3. 设计原则

1. **观测不在判定路径上**：新增的落盘/推送全部 best-effort（沿用 `MessageTraceBuffer` 的 `@ignore-catch` 口径），失败只留痕，**不得**影响入站受理、去重、限流、会话与 LLM 往返。
2. **单一埋点**：只扩展 `messageRouter` 已有的 `recordInboundMessage / addStage / finish` 三处（及 `MessageTraceBuffer` 内部），**不在各渠道适配器**里重复埋点（否则 20+ 适配器各写一套必然漂移）。
3. **不建第二套入站链路**：所有数据来自 `routeChannelMessage()` 既有调用链。
4. **只新增表**（`project_rules §1.5`）；跨重启的状态必须落盘（**R08-001**），不得只放内存。
5. **默认关的开关按 R07-2 登记**：新增告警开关必须同批登记 `default-off-switches-review-gates.md §2`，并在 `featureFlags.ts` 与 `project_rules §1.4` 表之间保持单边一致（否则 `lint:doc-code` / `lint:gate-parity` 阻断）。

---

## 4. G1：渠道级入站指标

### 4.1 变更

`ChannelMetrics.recordInboundMessage(channelName: string)`（调用点 `messageRouter.ts:196` 处 `channelName` 已在作用域内，`:178` 默认 `'unknown'`）：

- 改为**按渠道懒建**计数器（复用现有 `Map` 缓存模式），指标名仍为 `channels.message.inbound_total`，labels 增加 `channel`。
- **删除原来的无渠道单例计数器** —— 否则同一指标名会同时存在「无 channel」与「有 channel」两套序列，前端按名求和会**翻倍**。
- 渠道缺省归一**留在入口**（`messageRouter.ts:178` 的 `channelName = 'unknown'`），指标层参数**必填**：`'unknown'` 属状态字面量词汇，`lint:state-ratchet` 要求单一真源，指标层再写一份缺省值会新增未报备位点（本方案实施时已被门禁拦下一次）。
- 兼容口径：未知渠道统一记到 `channel="unknown"`，保证总量恒等于各渠道之和（前端 `sum(name)` 语义不变）。

同步（同一处，成本极低且已随 P1 落地）：`recordMessageRejected(reason, channelName)` 增加 channel 维度（参数必填），使 G3 的「某渠道拒绝率突增」判定可以直接读指标；若不动，G3 需改从 trace 缓冲聚合（见 §6.2 备选，受 500 条容量限制）。

### 4.2 前端

`ChannelMetricsCard` 在「入站」卡片下增加**分渠道小表**（渠道 / 入站 / 拒绝 / 平均处理耗时），数据全部来自既有 `/v1/channels/metrics`，不新增端点。

### 4.3 验收

- `curl -s 127.0.0.1:18990/v1/channels/metrics | jq '.metrics[] | select(.key|startswith("channels.message.inbound_total"))'` 出现 `channel=` 标签，且各值之和等于改动前总量。
- 单测：两次不同渠道入站 ⇒ 两条序列，`unknown` 兜底生效。

---

## 5. G2：链路持久化与历史查询

### 5.1 新表（`app.db`，与 `DedupStore` 同库同模式）

```sql
CREATE TABLE IF NOT EXISTS channel_message_traces (
  trace_id        TEXT PRIMARY KEY,
  channel         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  session_id      TEXT,
  sender_id       TEXT,
  status          TEXT NOT NULL,          -- ok | fail | rejected
  error           TEXT,
  content_preview TEXT NOT NULL DEFAULT '',
  started_at      INTEGER NOT NULL,       -- epoch ms
  finished_at     INTEGER NOT NULL,
  total_ms        INTEGER NOT NULL,
  stages_json     TEXT NOT NULL           -- MessageTraceStage[] 序列化
);
CREATE INDEX IF NOT EXISTS idx_cmt_started
  ON channel_message_traces (started_at);
CREATE INDEX IF NOT EXISTS idx_cmt_channel_started
  ON channel_message_traces (channel, started_at);
```

实现位置：`packages/channels/src/channels/monitoring/MessageTraceStore.ts`（新）。

### 5.2 写入与保留

- **只写终态**：`MessageTraceBuffer.finish()` 内追加一次 `store.upsert(trace)`（fire-and-forget + `catch → logger.warn`）。`inflight` 不落盘（避免半成品行污染历史）。
- **保留策略**：`init()` 与每 6h 各裁剪一次 —— 删除 `started_at < now - 7d`；并保证总行数 ≤ 5000（超出按 `started_at` 升序删最旧）。裁剪失败只告警，不影响读写。
- 写放大评估：终态 1 行/条；峰值按 10 条/s ⇒ 10 行/s，SQLite WAL 在本仓既有写入负载（事件日志、通知）同量级，可接受。

### 5.3 查询 API

`GET /v1/channels/messages/trace/history?channel=&status=&from=&to=&limit=100&cursor=`

- `limit` 上限 500；响应 `{ traces, nextCursor, total, updatedAt }`（`traces` 与既有 `/trace` 同形，前端可复用同一渲染）。
- 游标用 `(started_at, trace_id)` 复合键（同 `NotificationPersistence` P0-6 的同秒分页教训：单列 `started_at` 会在同毫秒多条时漏/重）。
- 实现细节：查询**多取 1 条**判定 `hasMore`（否则末页恰好满行会给出走不通的游标）；`from`/`to`/`status` 非法 ⇒ 400。
- 路由注册到 `app/src/infrastructure/http/handlers/routes/channel-surface-routes.ts`（`/history` 必须先于 `/:traceId` 匹配），同步补 `.trae/docs/api-spec.md`。

### 5.4 前端

`ChannelMonitorPanel`「消息链路」Tab 增加时间范围切换（**实时** / 近 1 小时 / 近 24 小时）：实时读内存缓冲（最快），后两者改读 `/history`；刷新按钮与 10s 轮询保留。

### 5.5 验收

- 产生 3 条消息（1 成功 / 1 duplicate / 1 限流）→ `restart` 后端 → `/history` 仍返回 3 条，`status` 与 `stages_json` 完整。
- 保留裁剪单测：注入 5001 行旧数据 ⇒ 裁剪后 ≤ 5000 且最旧被删。

---

## 6. G3：阈值告警

### 6.1 规则（`InboundAlertEvaluator`，`packages/channels/src/channels/monitoring/`）

| 规则 ID | 判据 | 窗口 | 默认阈值 | 静默期 |
|---|---|---|---|---|
| `INBOUND_REJECTION_BURST` | 同一渠道 `rejected` 增量 ≥ 20 **且** `rejected / inbound ≥ 0.5` | 5 分钟 | 20 条 / 50% | 30 分钟 |
| `INBOUND_INFLIGHT_STUCK` | `MessageTraceBuffer` 中 `status='inflight'` 且 `now - startedAtMs > 5min` | 每分钟扫描 | 5 分钟 | 30 分钟 |
| `INBOUND_CHANNEL_SILENT` | 已启用且 `everConnected` 的渠道，`lastMessageAt` 距今 > `silenceHours` | 每小时 | 24h（可配） | 6 小时 |

- 阈值写常量并集中在一处（`INBOUND_ALERT_RULES`），不散落在判定代码里；每个阈值旁边注明取舍理由。
- 定时器生命周期随渠道运行时启动/停止（`startChannelRuntime` / `stopChannelRuntime`）；**无已启用渠道 ⇒ 不注册定时器**（避免空转与无意义告警）。

### 6.2 数据来源

- 首选：G1 落地后的 `channels.message.{inbound,rejected}_total{channel,reason}` 指标增量（读 `MetricsService` 快照，无需新埋点）。
- 备选（若 G1 拒绝维度暂不做）：从 `MessageTraceBuffer.recent()` 聚合 —— 但受 500 条容量限制，仅适合低频渠道；**不推荐**作为长期方案。

### 6.3 投递与去重

- 投递复用既有收件箱：`NotificationPersistence.create({ category: 'system', priority: 'urgent', title, content, source: 'channel:inbound-alert', source_ref: ruleId })`（决策类 `category` 已被 P0-3 白名单拒绝，告警属告知类，走 `system`）。
- **静默期状态必须落盘**：表 `channel_alert_state(rule_id, channel, last_fired_at)`，`PRIMARY KEY(rule_id, channel)`；重启后沿用（R08-001）。
- **投递成功才写 `last_fired_at`**：投递失败下个 tick 自然重试（不会因"通知失败"把事故永久静音）。
- 同 `(rule_id, channel)` 静默期内只报一次；静默期后未恢复则再次告警。
- 渠道恢复通知（`resolved_at`）**本版不做**（避免噪音）；表结构只保留 `last_fired_at`。

### 6.4 开关

`CHANNEL_INBOUND_ALERTS`，**默认 `false`**（灰度，避免一上线就轰炸）。读取口径：`feature()`（env `FEATURE_CHANNEL_INBOUND_ALERTS` > 构建变体 > 默认）；本版**不加设置页开关**（无 UI ⇒ 不登记 `USER_CONFIG_KEYS`，避免"假开关"）。登记项：

- `packages/kernel/src/core/featureFlags.ts` 注册；
- `.trae/specs/default-off-switches-review-gates.md §2` 新增一行（#20：可观测信号 / 阈值 / 复评节奏）。

### 6.5 验收

- 单测（已落地 9 例）：拒绝突增（触发 / 占比不足 / 窗口未满）、`inflight` 卡死聚合、渠道静默（启用 / 未启用 / uptime 反推 / 刚启动）、静默期跨重启、投递失败重试。
- 开关关 ⇒ `startInboundAlertRuntime()` 直接返回：零评估器、零定时器、零通知（启动日志可证）。

---

## 7. G4：入站事件 SSE

### 7.1 端点

`GET /v1/channels/inbound/stream`（SSE）：

| 事件 | 载荷 | 时机 |
|---|---|---|
| `snapshot` | `{ traces: MessageTrace[], ts }` —— 最近 20 条链路（**`contentPreview` 恒为空串**） | 连接即推 |
| `trace` | `{ kind: 'begin' \| 'stage' \| 'finish', trace: MessageTrace }` —— 同样清空正文，保留 `stages`（阶段名/状态/耗时） | `begin` / `addStage` / `finish` |
| `: ping` | 注释行 | 15s 心跳（同 `monitor/stream` 口径） |

- 数据源：`MessageTraceBuffer` 新增 `subscribe(listener): () => void`（同步扇出；每个订阅者独立 `try/catch`，异常订阅者自动摘除）。
- **隐私边界**：事件里的 `contentPreview` **一律置空串**（正文仍只在内存查询/历史 API 中返回），避免消息内容进入浏览器事件流再被日志采集。实现时保留 `stages` 是刻意的取舍：没有阶段信息，面板展开 SSE 行只能显示空白。
- 连接上限与断开：沿用 `monitor/stream` 的写法（`req.on('close')` 清理订阅）。

### 7.2 前端

`ChannelMonitorPanel` 的 `traces` Tab 改为 `EventSource`：

- 打开即渲染 `snapshot`，随后增量追加/更新 `trace`；
- 保留「手动刷新」按钮（兜底人因操作，不是自动轮询）；
- **仅在** EventSource `onerror` 且原生重连连续失败 3 次后，降级为 30s 轮询（CS03：明确的失败场景才保留回退，不写"以防万一"的双通道）。

### 7.3 验收

- `curl -N 127.0.0.1:18990/v1/channels/inbound/stream` 后从任一渠道发一条消息：依次看到 `begin`（`frame_check`）与终态事件。
- 断开网络/杀连接 ⇒ 浏览器自动重连并重新收到 `snapshot`。
- 断言 SSE 帧中**不含**消息正文。

---

## 8. 实施顺序（每步独立提交，可单独回滚）

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P1** | G1 渠道级入站指标 + 卡片分渠道表 | 指标标签 + 总量守恒 + 单测 |
| **P2** | G2 `MessageTraceStore` + 表 + `/history` + 保留裁剪 | ✅ **已实施（2026-11-21）**：`channel_message_traces` 表 + 终态落盘 + 7d/5000 行裁剪 + 复合游标分页 + 面板范围切换（见 §12） |
| **P3** | G4 `subscribe` + `/inbound/stream` + 前端 SSE | ✅ **已实施（2026-11-21）**：`MessageTraceBuffer.subscribe` + SSE（snapshot/trace/ping）+ 面板实时改 EventSource（连续失败 3 次才降级轮询）（见 §12） |
| **P4** | G3 规则 + 评估器 + `channel_alert_state` + 开关登记 | ✅ **已实施（2026-11-21）**：三条规则 + `channel_alert_state` 落盘静默期 + 收件箱投递 + `CHANNEL_INBOUND_ALERTS`（默认关，登记表 #20）（见 §12） |

依赖：P3 只依赖既有缓冲（可与 P2 并行）；P4 依赖 P1（指标）**或** P2（历史聚合），二选一即可。

---

## 9. 测试与门禁

- 单测（`app/tests/channels/` 同族）：`ChannelMetrics`（渠道维度与总量守恒）、`MessageTraceStore`（终态写入 / 游标 / 裁剪）、`InboundAlertEvaluator`（阈值 / 静默 / 跨重启 / 开关关闭）、SSE handler（订阅扇出 / 断开清理 / 正文不外泄）。
- 门禁：`bun run typecheck`、`bun run lint:channels`、`bun run lint:infra`（新增文件在 `packages/channels` 包内）、`bun run lint:gate-parity`（若新增脚本）。
- 新增 HTTP 端点须同步 `.trae/docs/api-spec.md`（§4 映射表 + §5 缺口清单）。

---

## 10. 非目标

- ❌ 不做**入站正文审计**（全文落盘涉及隐私与体积；如确需，另立 spec 并明确保留期与访问控制）。
- ❌ 不把 trace 写入 `events.jsonl`（那是「模型可见输入」的落盘面，本项是系统观测面，性质不同）。
- ❌ 不做多租户/多设备聚合、不上外部 APM（OTel 已有 span，本方案只补应用内可见性）。
- ❌ 不改 `routeChannelMessage()` 的判定、顺序、拒绝语义与去重行为。

---

## 11. 风险与取舍

| 风险 | 评估 | 处置 |
|---|---|---|
| 指标基数膨胀 | `CHANNEL_MAX_COUNT=10`（`project_rules §1.14`）⇒ 序列数上限可控 | 只按 channel/固定 reason 建序列，不做用户维度 |
| 写放大 | 终态 1 行/条；峰值 10 条/s | 保留 7d / 5000 行 + 每 6h 裁剪 |
| 告警风暴 | 阈值 + 静默期 + 默认关 | P4 灰度，先观察一周再考虑默认开 |
| 观测失败反噬主流程 | 落盘/推送均可能失败 | 全部 best-effort，独立 `try/catch` + `logger.warn`（沿用 `MessageTraceBuffer` 口径） |
| 与既有指标重复计数 | G1 若保留旧单例会翻倍 | 明确**删除**旧单例，`unknown` 兜底，总量守恒纳入单测 |

---

## 12. 执行记录

### P1（G1 渠道级指标）—— 已实施（2026-11-21）

| 文件 | 变更 |
|---|---|
| `packages/channels/src/channels/monitoring/ChannelMetrics.ts` | `recordInboundMessage(channelName)` 与 `recordMessageRejected(reason, channelName)` 按维度懒建（参数必填，缺省归一留在入口）；**删除**无渠道入站单例；新增 `resetChannelMetricsForTest()` |
| `packages/channels/src/channels/routing/messageRouter.ts` | 12 处埋点补 `channelName`（入站 1 处 + 拒绝 11 处） |
| `packages/channels/src/channels/routing/textApproval.ts` | `INBOX_UNAVAILABLE` 拒绝补 `channelName` |
| `client/src/components/common/ChannelMetricsCard.tsx` | 新增 `inboundByChannel` / `rejectedByChannel` 聚合；原「处理耗时」chips 换成**分渠道表**（渠道 / 入站 / 拒绝 / 平均耗时） |
| `client/src/i18n/locales/{zh,en}/base.ts` | 新增 6 个 key（表头 + 数值模板），删除 2 个不再使用的 key（zh/en 对称） |
| `app/tests/channels/channelMetrics.test.ts` | 5 例：分渠道互不影响 / 无 channel 总量序列不存在 / `unknown` 兜底 / 拒绝渠道+原因分维 / 缺省渠道 |

验证：`bun test tests/channels/channelMetrics.test.ts` 5 pass；`bun run typecheck`（app + client）0 错；`bun run lint:channels` 0 error；client `eslint` 改动文件 0 问题；`i18nKeyParity` / `i18nKeyCoverage` 6 pass。

未做（留在 P4）：阈值告警。

### P2（G2 链路持久化）—— 已实施（2026-11-21）

| 文件 | 变更 |
|---|---|
| `packages/channels/src/channels/monitoring/messageTraceTypes.ts`（新） | 类型下沉到叶子模块（`Buffer → Store → Buffer` 会形成 madge 环），新增 `FinishedMessageTrace`（只允许终态） |
| `packages/channels/src/channels/monitoring/MessageTraceStore.ts`（新） | `channel_message_traces` 表（`trace_id` PK + `started_at` / `(channel, started_at)` 索引）；终态 upsert；`history()` 复合游标分页（多取 1 条判 `hasMore`）；7d / 5000 行裁剪（init + 每 6h，`unref`）；单例 + `resetMessageTraceStoreForTest()`；`persistFinishedMessageTrace()` best-effort |
| `packages/channels/src/channels/monitoring/MessageTraceBuffer.ts` | 类型改为从叶子再导出；`finish()` 调 `persistFinishedMessageTrace`（内部已 catch，不阻塞入站） |
| `app/src/infrastructure/http/handlers/channel-handlers.ts` | 新增 `handleChannelMessageTraceHistory`（`from`/`to`/`status` 非法 ⇒ 400；`limit` 1–500） |
| `app/src/infrastructure/http/handlers/routes/channel-surface-routes.ts` | `/history` 路由**先于** `/:traceId` 匹配 |
| `client/src/{types/channel.ts,types/index.ts,services/channelService.ts,services/endpoints.ts}` | `MessageTraceHistoryResponse` + `getMessageTraceHistory()` |
| `client/src/components/common/ChannelMonitorPanel.tsx` | 「消息链路」Tab 增加 实时 / 近 1 小时 / 近 24 小时切换（后者走 `/history`） |
| `client/src/i18n/locales/{zh,en}/base.ts` | 3 个范围 key（zh/en 对称） |
| `app/tests/channels/messageTraceStore.test.ts`（新） | 5 例：跨实例可查 / 维度过滤 / 复合游标不重不漏 / 7 天裁剪 / 缓冲 `finish` 接线自证 |
| `.trae/docs/api-spec.md` | 新增 `/v1/channels/messages/trace/history` 行（pre-existing 的 `/trace`、`/trace/:id` 两条历史缺口未动，另行处理） |

验证：`tests/channels` **746 pass / 0 fail**（88 文件）；`typecheck`（app 3 project + client）0 错；`lint`（app）/ `lint:channels` / client eslint 0 error；`check:circular` 无环；`lint:state-ratchet` 棘轮维持。

设计期两处自纠（如实）：① `doInit` 内若调 `prune()` 会重入 `init()` 死锁 ⇒ 拆出 `pruneRows()`；② 首版 `nextCursor` 用"页满即给游标" ⇒ 末页满行时给出走不通的游标（测试暴露）⇒ 改为多取 1 条判 `hasMore`。

### P3（G4 入站事件 SSE）—— 已实施（2026-11-21）

| 文件 | 变更 |
|---|---|
| `packages/channels/src/channels/monitoring/messageTraceTypes.ts` | 新增 `MessageTraceEventKind` / `MessageTraceEvent`（`contentPreview` 恒空串的隐私契约写在类型注释里） |
| `packages/channels/src/channels/monitoring/MessageTraceBuffer.ts` | 新增 `subscribe()` + 私有 `emit()`：`begin`/`stage`/`finish` 同步扇出，深拷贝 stages，异常订阅者自动摘除；`monitoring/index.ts` 同步导出 |
| `app/src/infrastructure/http/handlers/channel-handlers.ts` | 新增 `handleChannelInboundStream`（snapshot + trace + 15s ping + close 退订） |
| `app/src/infrastructure/http/handlers/routes/channel-surface-routes.ts` | 注册 `GET /v1/channels/inbound/stream` |
| `client/src/components/common/ChannelMonitorPanel.tsx` | 实时范围改 `EventSource`（`snapshot` 覆盖、`trace` 按 traceId 合并置顶）；**连续 3 次失败**才降级 30s 轮询；切范围时重置降级标记 |
| `app/tests/channels/messageTraceStream.test.ts`（新） | 4 例：事件顺序与正文清空 / 取消订阅 / 异常订阅者摘除 / SSE snapshot+增量+断开退订（含"帧内无正文"断言） |
| `.trae/docs/api-spec.md` | 新增 `/v1/channels/inbound/stream` 行 |

验证：`bun test tests/channels/messageTraceStream.test.ts` 4 pass；`tests/channels` 全量见提交记录；`typecheck`（app 3 project + client）0 错；`lint`（app）/ `lint:channels` / client eslint 0 error；`check:circular` 无环；`lint:state-ratchet` 棘轮维持。

### P4（G3 阈值告警）—— 已实施（2026-11-21）

| 文件 | 变更 |
|---|---|
| `packages/kernel/src/core/featureFlags.ts` | 新增 `CHANNEL_INBOUND_ALERTS: false`（默认关；env `FEATURE_CHANNEL_INBOUND_ALERTS`） |
| `packages/channels/src/channels/monitoring/InboundAlertEvaluator.ts`（新） | 三条规则（阈值集中在文件顶部常量）；读者（指标/缓冲/渠道态/时钟）全部可注入；`start/stop` 幂等、定时器 `unref`；**投递成功才记静默期** |
| `packages/channels/src/channels/monitoring/ChannelAlertStateStore.ts`（新） | `channel_alert_state(rule_id, channel, last_fired_at)` + `shouldFire/markFired`（R08-001 跨重启） |
| `app/src/entrypoints/inboundAlertWiring.ts`（新） | 开关关 ⇒ 直接返回；开 ⇒ 启动监控器（幂等）+ 评估器，`notify` 写收件箱（`system` / `urgent` / `source_ref=ruleId`）；**不调 `init()`**（重复起过期调度器） |
| `app/src/entrypoints/channelRuntime.ts` | 随通道运行时启动（REPL/DAEMON 共用） |
| `app/tests/channels/inboundAlertEvaluator.test.ts`（新） | 9 例：三条规则触发/不触发 + 静默期跨重启 + 投递失败重试（用例独占渠道名，避免静默期串扰） |
| `.trae/specs/default-off-switches-review-gates.md` | §2 新增 #20（误报率 ≤20% 且至少提前发现 1 次事故等判据） |

验证：`bun test tests/channels/inboundAlertEvaluator.test.ts` 9 pass；`tests/channels` 全量见提交记录；`typecheck`（app 3 project + client）0 错；`lint`（app）/ `lint:channels` 0 error；`check:circular` 无环；`lint:state-ratchet` 棘轮维持。

实现期自纠（如实）：首版 `collectChannelSilent` 把注入的读者**当成数据**直接 `for...of`（`{} is not iterable`，9 例全红）⇒ 改为 `this.readChannels()` 调用；另在测试中发现"同名渠道跨用例共享静默期"⇒ 每个用例使用独占渠道名。

