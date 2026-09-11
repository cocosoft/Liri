# 前后端接口清单

> **版本**: 2.3.0 | **更新**: 2026-08-01 | **状态**: 持续维护
>
> 本文档是前后端通信的**唯一事实来源**。涉及前后端通信的开发、测试、调试场景时，**必须先查阅本文档**，确认接口是否存在、参数是否对齐，再进行编码。

---

## §0 强制规则

1. **新增接口前**：必须先查本文档确认无重复，然后在本文件中新增条目。
2. **修改接口前**：必须先查本文档确认影响范围，所有调用方同步更新。
3. **前后端开发并行时**：以本文档为契约，先对齐接口定义再各自实现。
4. **PR Review 时**：检查是否涉及接口变更，如有变更必须同步更新本文档。
5. **已知缺口（标记 ❌）**：不可作为新功能参考模板，新增功能需同步补齐对应通道。

---

## §1 通信架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  前端 (client/src/)                                           │
│  ┌──────────────────────┐  ┌───────────────────────────────┐ │
│  │ Tauri IPC (invoke)   │  │  HTTP (fetch/httpClient)      │ │
│  │ 优先级: 3 (兜底)     │  │  优先级: 1 (主通道)           │ │
│  └──────────┬───────────┘  └──────────────┬────────────────┘ │
│             │                              │                   │
│             │ Tauri Bridge                 │ HTTP + Bearer     │
│             ▼                              ▼                   │
│  ┌──────────────────────┐  ┌────────────────────────────────┐ │
│  │ Rust 侧车 (Tauri)    │  │ Node.js 后端 (app/src/)          │ │
│  │ client/src-tauri/    │  │ LocalHTTPService                │ │
│  │ 命令 → 内存 fallback │  │ :7890 + /v1/* routes           │ │
│  └──────────────────────┘  └────────────────────────────────┘ │
│                                                               │
│  前端调用链: HTTP → Tauri IPC → 内存 mock（3级降级）         │
└──────────────────────────────────────────────────────────────┘
```

- **主通道**: HTTP `http://127.0.0.1:{port}`（默认 7890），路径前缀 `/v1/`
- **降级通道**: Tauri IPC `@tauri-apps/api/core.invoke(method, args)`
- **事件通道**: SSE `/v1/events`、窗口事件 `window.emit('stream-chunk'/'stream-done'/'stream-error')`
- **认证**: HTTP 请求自动携带 `Authorization: Bearer {shared_secret}`（由 Tauri 侧车随机生成）
- **图例**: ✅ 前后端对齐 | ❌ 缺失（后端无实现或前端无调用方）

---

## §2 Tauri IPC 命令清单（Rust → 前端）

**定义位置**: [client/src-tauri/src/lib.rs](file:///e:/PY/CODES/PY_APP/client/src-tauri/src/lib.rs) `invoke_handler`

### §2.1 已注册命令（22个）

| # | 命令名 | 参数 | 返回值 | 前端调用方 |
|---|--------|------|--------|-----------|
| 1 | `start_backend` | 无 | `BackendStatus` | `chatService.startBackend` |
| 2 | `stop_backend` | 无 | `void` | `chatService.stopBackend` |
| 3 | `get_backend_status` | 无 | `BackendStatus` | `chatService.getBackendStatus` |
| 4 | `get_backend_secret` | 无 | `string \| null` | `chatService.startBackend` |
| 5 | `set_backend_port` | `{ port: u16 }` | `void` | `SettingsPage.tsx` |
| 6 | `get_app_config` | 无 | `AppConfig` | `appConfigService.get` |
| 7 | `set_app_config` | `{ config: AppConfig }` | `void` | `appConfigService.set` |
| 8 | `set_backend_url` | `{ url: String }` | `void` | 无前端调用方 |
| 9 | `send_message` | `{ content, sessionId }` | `Message` | `chatService.sendMessage` (fallback) |
| 10 | `stream_message` | `{ content, sessionId }` + window | 事件流 | `chatService.streamMessage` (fallback) |
| 11 | `list_sessions` | 无 | `Vec<Session>` | `sessionService.list` (fallback) |
| 12 | `create_session` | `{ title }` | `Session` | `sessionService.create` (fallback) |
| 13 | `switch_session` | `{ id }` | `()` → 前端期望 `Session` ⚠️ | `sessionService.switch` (fallback) |
| 14 | `delete_session` | `{ id }` | `()` | `sessionService.delete` (fallback) |
| 15 | `get_current_session` | 无 | `Option<Session>` | `sessionService.getCurrent` (fallback) |
| 16 | `rename_session` | `{ id, title }` | `()` | `sessionService.rename` (fallback) |
| 17 | `list_models` | 无 | `Vec<ModelInfo>` (空数组) | 无前端调用方 |
| 18 | `list_tools` | 无 | `Vec<Tool>` | `toolService.list` (fallback) |
| 19 | `execute_tool` | `{ toolName, args }` | `Value` | `toolService.execute` (fallback) |
| 20 | `get_config` | `{ key }` | `Value` | `configService.get` (fallback) |
| 21 | `set_config` | `{ key, value }` | `()` | `configService.set` (fallback) |
| 22 | `list_config` | 无 | `HashMap` | `configService.list` (fallback) |

> ⚠️ `switch_session` Rust 返回 `()`，但前端 `tryTauri<Session>` 期望 `Session`，会触发 catch → fallback 到 memory mock。

### §2.2 窗口事件（Rust → 前端 Webview）

| 事件名 | 触发来源 | payload |
|--------|---------|---------|
| `stream-chunk` | `stream_message` LLM 增量 | `{ chunk: string, index: number }` |
| `stream-done` | `stream_message` 完成 | `{ session_id: string, done: true }` |
| `stream-error` | `stream_message` 出错 | `{ error: string }` |

---

## §3 HTTP API 清单（Node.js 后端 → 前端）

**定义位置**:
- 主路由: [LocalHTTPService.ts](file:///e:/PY/CODES/PY_APP/app/src/core/gateway/local/LocalHTTPService.ts)
- 子路由: [ModelManagementAPI.ts](file:///e:/PY/CODES/PY_APP/app/src/ai/ModelManagementAPI.ts)（通过 `tryHandleRoute` 挂载）

### §3.1 系统

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/health` | ✅ | `chatService.checkHealth`（免认证） |
| GET | `/v1/events` | ✅ | 无明确前端调用方（SSE 事件总线） |
| POST | `/v1/system/sleep/resolve` | ✅ **2026-08-14 新增** | `systemService.resolveSleep`（休眠恢复用户决策，body `{ runMissed: boolean }`） |
| GET | `/v1/system/estop` | ✅ **2026-09-02 新增** | `systemService.getEstopStatus`（全局急停状态，响应 `{ engaged, state: { reason?, engagedAt? } \| null }`） |
| POST | `/v1/system/estop` | ✅ **2026-09-02 新增** | `systemService.engageEstop`（启用全局急停，body `{ reason? }`；暂停新消息/新 cron，不杀进行中的） |
| DELETE | `/v1/system/estop` | ✅ **2026-09-02 新增** | `systemService.disengageEstop`（解除全局急停） |

### §3.2 模型

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/models` | ✅ | `modelService.list`, `chatService.fetchModels` |
| POST | `/v1/models/test` | ✅ | 无前端调用方 |
| POST | `/v1/models/probe` | ✅ **2026-08-19 新增** | `modelService.probeCapabilities`（模型能力静态探测：body `{ modelId, persist? }`（modelId 为模型名，默认 persist=true 写回 `model_registry.capabilities`）；返回 `{ data: { modelId, providerType, method: static\|skipped\|failed, tool_use, vision, persisted } }`；仅本地可静态探测 Provider（ollama `/api/show`、llamacpp `/props`），云端返回 skipped） |
| GET | `/v1/models/current` | ✅ | `modelSwitchService.getCurrent` |
|  | 响应新增 `isNonChat: boolean` 字段（v2.3） |  | 非聊天模型标记，前端据此显示警告 |
| POST | `/v1/models/switch` | ✅ | `modelSwitchService.switch` |
|  | 响应 `{ data: { modelId, modelName } }` |  | modelId=UUID, modelName=模型名 |
| GET | `/v1/models/tasks` | ✅ | `modelSwitchService.getTasks` |
| PUT | `/v1/models/tasks` | ✅ | `modelSwitchService.saveTasks` |
| PUT | `/v1/models/default` | ✅ | `modelSwitchService.setDefaultModel` |

### §3.3 模型供应商（子路由: ModelManagementAPI）

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/providers` | ✅ | `providerService.list` |
| POST | `/v1/providers` | ✅ | `providerService.create` |
| GET | `/v1/providers/stats` | ✅ | `providerService.stats` |
| GET | `/v1/providers/status` | ✅ **2026-08-19 新增** | `modelService.providerStatus`（本地服务运行状态：仅 Ollama/llama.cpp；返回 `{ data: [{ providerType, running, detail?: { port?, model? } }] }`，ollama 走 `/api/tags`、llamacpp 走 `LlamaCppServerManager.getStatus`） |
| GET | `/v1/providers/{id}` | ✅ | `providerService.get` |
| PUT | `/v1/providers/{id}` | ✅ | `providerService.update` |
| DELETE | `/v1/providers/{id}` | ✅ | `providerService.remove` |
| POST | `/v1/providers/{id}/toggle` | ✅ | `providerService.toggle` |
| GET | `/v1/providers/{id}/test` | ✅ | `providerService.test` |
| GET | `/v1/providers/{id}/models` | ✅ | `providerService.fetchModels` |
| GET | `/v1/models/app-config` | ✅ | 无前端调用方 |
| GET | `/v1/models/app-config/{appType}` | ✅ | 无前端调用方 |
| PUT | `/v1/models/app-config/{appType}` | ✅ | 无前端调用方 |
| DELETE | `/v1/models/app-config/{appType}` | ✅ | 无前端调用方 |
| POST | `/v1/models/pricing/sync` | ✅ **2026-08-16 新增** | 无前端调用方（内置官方价格源同步：启动时自动执行 + 手动触发；进库前经 schema 校验，非法数据阻止写入；不覆盖 `pricingSource=manual` 的手工配置；响应 `{ data: { updated: number } }`） |

> **模型价格字段（2026-08-16 扩展）**：`GET /v1/models` 响应中 `pricing` 对象新增 `billingMode`（`token` / `per_request` / `token_and_per_request`）、`pricePerRequest`（美元/请求）、`timeBasedPricing`（分时价差数组 `[{ start, end, inputCostPerMillion?, outputCostPerMillion?, cacheReadCostPerMillion?, cacheWriteCostPerMillion? }]`，`end < start` 表示跨天时段）、`pricingSource`（`official`=官方价格自动同步 / `manual`=用户手工配置 / `default`=默认）。`POST /v1/models`（自定义模型创建）与 `PUT /v1/models/{id}`（模型更新）同样透传这 3 个字段；更新价格字段时 `pricingSource` 自动置为 `manual`（官方价格同步不再覆盖）。

### §3.3.1 llama.cpp 本地推理（2026-08-10 新增，llamacpp-integration）

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/llama/status` | ✅ | `llamaService.getStatus` |
| GET | `/v1/llama/config` | ✅ | `llamaService.getConfig` |
| PUT | `/v1/llama/config` | ✅ | `llamaService.saveConfig` |
| POST | `/v1/llama/restart` | ✅ | `llamaService.restart` |

### §3.4 用量与计费（子路由: ModelManagementAPI）

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/usage/summary` | ✅ | `usageService.summary` |
| GET | `/v1/usage/trend` | ✅ | `usageService.trend` |
| GET | `/v1/usage/models` | ✅ | `usageService.modelStats` |
| GET | `/v1/usage/providers` | ✅ | `usageService.providerStats` |
| GET | `/v1/usage/logs` | ✅ | `usageService.logs` |
| GET | `/v1/usage/cost/summary` | ✅ **v3 新增** | `usageService.getCostSummary` |
| GET | `/v1/usage/cost/records` | ✅ **v3 新增** | `usageService.getCostRecords` |
| GET | `/v1/usage/cost/range` | ✅ **v3 新增** | `usageService.getCostByDateRange` |
| GET | `/v1/usage/cost/report` | ✅ **v3 新增** | `usageService.getCostReport` |
| GET | `/v1/usage/cost/reconcile` | ✅ **v1.2 新增** | `usageService.getCostReconcile` |
| GET | `/v1/usage/balances` | ✅ **v3 新增** | `usageService.batchCheckBalance` |
| POST | `/v1/usage/balance` | ✅ **v3 新增** | `usageService.checkBalance` |
| GET | `/v1/balances` | ⚠️ 301→`/v1/usage/balances` | 旧路径，保留兼容 |
| POST | `/v1/balance` | ⚠️ 301→`/v1/usage/balance` | 旧路径，保留兼容 |
| GET | `/v1/pricing` | ✅ | `pricingService.list` |
| POST | `/v1/pricing` | ✅ | `pricingService.upsert` |
| DELETE | `/v1/pricing/{modelId}` | ✅ | `pricingService.remove` |

### §3.5 聊天

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/chat/completions` | ✅ | `chatService.sendMessage`, `chatService.streamMessage` |
| POST | `/v1/openai/chat/completions` | ✅ **2026-09-08 新增（OpenAI 兼容网关，B-1）** | 无前端调用方；供 TRAE/第三方以 OpenAI 格式直连内网 dawate Provider |

> OpenAI 兼容网关（B-1）：无状态直连 `providerRegistry.getByModel(model)`（当前为 DawateProvider），透传完整 messages 历史、不做会话/工具/落盘；`stream:true` 以标准 OpenAI chunk + `data: [DONE]` 返回。鉴权沿用全局 `LIRI_API_SECRET`。模型 ID = 大瓦特 Agent 的 `model_id`（如 `246676332`）。

> P0-1（2026-08-26）：请求体新增可选 `continue_from: { content, messageId? }`——流中断续写：后端把已生成内容作为 assistant 上下文注入，"请从中断处继续"，用于自动恢复而非从头重发。
> P1-1（2026-08-26）：SSE 事件 `__pyapp_error_code` 新增 `STREAM_INTERRUPTED`——前端据此识别"可恢复的流中断"并触发自动续写/重试。

#### §3.5.1 SSE 流式事件协议（P2-4 固化）

`POST /v1/chat/completions`（`stream:true`）以 SSE 返回，每行 `data: <JSON>`。前端解析：[parseSseChunk](client/src/services/chatService.ts)、[chat-message.slice.ts streamMessage](client/src/stores/chat/chat-message.slice.ts)。

**`__pyapp_type` 枚举**（后端 [chat-handlers.ts](app/src/infrastructure/http/handlers/chat-handlers.ts) 转发 `ChatStreamChunk.type`）：

| __pyapp_type | 关键字段 | 含义 |
|--------------|---------|------|
| `text` | `choices[0].delta.content` | 流式文本增量 |
| `thinking` | `choices[0].delta.content` | 思考过程（前端 thinking 块） |
| `status` | `__pyapp_status_type` | 状态提示（`ai_thinking`/`retry`/`task_all_done`/`resume`/**`tool_retry`**） |
| `context_state` | `watermarkState` | 上下文水位（压缩/召回） |
| `error` | `__pyapp_error_code` | 流式错误（前端渲染错误块） |
| `tool_call` | `__pyapp_tool_status`, `choices[0].delta.tool_calls` | 工具调用块（status: running/completed/failed） |
| `question` | `__pyapp_question` | ask_user_question 交互（前端 question 块） |
| `todo` | `todoData` | 任务列表块 |
| `usage` | `choices[0].finish_reason`, `usage` | 用量统计 + finishReason（`length`=截断） |
| `execution_phase` | `executionPhase` | 执行阶段进度 |
| `tool_completed` | `tool_call_id`, `result_data`（含 `pendingApproval`） | 工具完成事件（生图/审批等待态） |

**约定**：
- `statusType` 联合类型已含 `tool_retry`（后端 CoreAPI.ts 与前端 chatService.ts 同步，改动需双端一致）
- 审批等待态通过 `tool_completed` + `result_data.pendingApproval === true` 传递，非 error 语义
- 请求体可选字段 `assistant_message_id`（P0 根治，2026-08-14）：前端流式消息 id（`crypto.randomUUID`），后端 `createAssistantMessage` 复用它作消息 id，使 `PUT /v1/sessions/{id}/messages/{mid}/blocks`（updateMessageBlocks）直接命中落盘，刷新后 blocks 与流式一致；缺省时后端自动生成 `msg-{timestamp}-{suffix}`
- 事件总线 `/v1/events`（`broadcastEvent` → 前端 `sseService.on`）与对话流内转发**并存**：长程任务等无活跃 chatStream 的场景走事件总线
- `session:paused`（根因 C）：崩溃恢复把会话标记 PAUSED 后主动推送 `{ sessionId, reason: 'crash_recovery', crashedAt }`，前端展示"会话已暂停"提示（[chat store index.ts](client/src/stores/chat/index.ts)）

### §3.6 会话

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/sessions` | ✅ | `sessionService.list` |
| POST | `/v1/sessions` | ✅ | `sessionService.create` |
| DELETE | `/v1/sessions` | ✅ | `sessionService.clearAll` |
| GET | `/v1/sessions/current` | ✅ | `sessionService.getCurrent` |
| GET | `/v1/sessions/{id}` | ✅ | `sessionService.get` |
| PUT | `/v1/sessions/{id}` | ✅ | `sessionService.rename` |
| PATCH | `/v1/sessions/{id}/meta` | ✅ M1-T1.3 | `sessionService.updateSessionMeta` / `sessionService.setPinned`（body `{ model?, provider_id?, workspace_id?, tasks_override?, pinned? }`；**pinned-only 更新不 touch updatedAt**，防列表重排；`pinned` 必须严格 boolean，非法值 400；驱动侧栏「固定到顶部」持久化 + 会话列表置顶排序） |
| DELETE | `/v1/sessions/{id}` | ✅ | `sessionService.delete`（**M2-T2.2** 级联：会话删除 → 引擎中止 ✓ → 孤儿审批项关闭（pending/processing → dismissed，/v1/inbox 不残留可答复项）→ 检查点/事件日志/协商状态清理 ✓；通道为 bot 级长连接，无 per-session 订阅需退订） |
| POST | `/v1/sessions/{id}/switch` | ✅ | `sessionService.switch` |
| GET | `/v1/sessions/{id}/messages` | ✅ | `sessionService.getMessages` / `sessionService.loadConversation`（KB-LONG-SESSION：支持 `?limit&before` 分页——`limit>0` 取末尾 limit 条并返回 `{ messages, hasMore }`，`before` 为 lastEventSeq 游标加载更早；不传 limit 返回数组全量，兼容旧格式） |
| GET | `/v1/sessions/{id}/events` | ✅ M1-6 | `trajectoryService.getEvents`（M1-7；`?fromSeq&toSeq&types&limit&recent`，recent=1 时尾部优先取最后 limit 条——日志/轨迹面板显示最近事件） |
| GET | `/v1/sessions/{id}/events/export` | ✅ P7 | `trajectoryService.exportEvents`（导出 jsonl/json，`?format=jsonl\|json`） |
| GET | `/v1/sessions/{id}/stats` | ✅ D7 | `trajectoryService.getSessionStats`（事件投影统计：消息/工具/轮次/压缩，与 `/v1/usage` token 成本维度不同） |
| POST | `/v1/sessions/{id}/fork` | ✅ D3 | 前端「另存为分支」`sessionService.forkSession`（body `{ boundary?, childTitle? }`；复制 `[1..boundary]` 前缀事件 + 血缘 `parentSessionId/seedLength`，boundary 缺省=tailSeq，open turn 拒绝 400） |
| POST | `/v1/sessions/{id}/messages` | ✅ 写前持久化 | `chatService.addMessage`（断网 outbox 补发） |
| POST | `/v1/sessions/{id}/title` | ✅ | `sessionService.generateTitle` |
| PUT | `/api/session/{id}/message/{msgId}/blocks` | ✅ | `chatService.updateMessageBlocks` |
| GET | `/v1/sessions/{id}/streaming` | ✅ P1-5 | `chat-message.slice.ts` ghostCheckTimer |
| GET | `/v1/sessions/{id}/checkpoints/latest` | ✅ P2-1 | `chat-message.slice.ts` reconnect |
| POST | `/v1/sessions/{id}/resume` | ✅ P2-1 | `chatService.streamMessageWithReconnect` |

**来源语义（M4-T4.1）**：`GET /v1/sessions` / `GET /v1/sessions/{id}` 返回的 `source` 字段标识会话来源渠道（`_resolveSessionSource`：优先 `metadata.channel` → session ID 前缀推断（c2c:/group:→qq）→ 兜底 `web`）。通道会话（QQ/Telegram/飞书等）首次带 `channel` 元数据的请求到达时，后端 set_once 补写 `metadata.channel`（不覆盖既有来源），前端 `SESSION_SOURCE_LABELS` 展示来源徽标。

### §3.7 工具

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/tools` | ✅ | `toolService.list` |
| POST | `/v1/tools/{name}/execute` | ✅ | `toolService.execute` |

### §3.8 Agent 任务

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/agents/tasks` | ✅ | `agentService.listTasks` |
| POST | `/v1/agents/tasks` | ✅ | `agentService.createTask` |
| GET | `/v1/agents/tasks/{id}` | ✅ | `agentService.getTask` |
| POST | `/v1/agents/tasks/{id}/cancel` | ✅ | `agentService.cancelTask` |
| POST | `/v1/agents/tasks/execute` | ❌ | `agentService.executeTask` |
| PUT | `/v1/agents/tasks/{id}` | ❌ | `agentService.updateTask` |
| DELETE | `/v1/agents/tasks/{id}` | ❌ | `agentService.deleteTask` |
| GET | `/v1/agents/tasks/{id}/logs` | ❌ | `agentService.getTaskLogs` |
| GET | `/v1/agents/tasks/history` | ❌ | `agentService.listTaskHistory` |

### §3.9 语音

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/voice/transcribe` | ✅ | `voiceService.transcribe` |
| GET | `/v1/voice/settings` | ✅ | `voiceService.getSettings` |
| PUT | `/v1/voice/settings` | ✅ | `voiceService.updateSettings` |
| POST | `/v1/voice/session/start` | ✅ | `voiceService.startSession` |
| POST | `/v1/voice/session/{id}/end` | ✅ | `voiceService.endSession` |
| GET | `/v1/voice/sessions` | ✅ | `voiceService.getSessions` |
| GET | `/v1/voice/session/{id}` | ✅ | `voiceService.getSession` |
| POST | `/v1/voice/upload` | ✅ | `voiceService.uploadAudio` |
| GET | `/v1/voice/stream/{id}` | ✅ | `voiceService.getAudioStream` |
| POST | `/v1/voice/tts` | ✅ | `voiceService.synthesizeSpeech` |
| GET | `/v1/voice/providers` | ✅ | `voiceService.getProviders` |
| GET | `/v1/voice/health` | ✅ | `voiceService.checkTTSHealth` |
| GET | `/v1/voice/voices` | ✅ | `voiceService.getVoices` |
| POST | `/v1/voice/wakeword/{id}/test` | ✅ | `voiceService.testWakeWord` |
| POST | `/v1/voice/wake/start` | ✅ | `voiceStore`（`client/src/stores/voiceStore.ts`） |
| POST | `/v1/voice/wake/stop` | ✅ | `voiceStore`（`client/src/stores/voiceStore.ts`） |
| GET | `/v1/voice/wake/status` | ✅ | 无前端调用方（后端监控自用） |

**WebSocket 升级端点（语音）**：

| 路径 | 类型 | 后端状态 | 前端调用方 | 说明 |
|------|------|----------|-----------|------|
| `/v1/voice/stt` | WS 升级 | ✅ | `voiceService.createSTTStream` | 3.4/P1-1 流式 STT：TEXT config → PCM16 二进制帧 → 节流 interim → finalize 最终转录（`STTStreamServer`） |
| `/v1/voice` | WS 升级 | ✅ | `client/src/services/voice` | 实时语音会话（OpenAI Realtime / Gemini Live）：`session.config`/`audio.append`/`transcript.*`/`audio.delta` 等（`upgrade.ts` → `VoiceSession`） |

### §3.10 文件

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/files/upload` | ✅ | `fileService.upload`, `fileService.uploadBase64` |
| POST | `/v1/files/convert` | ✅ | `fileService.convert` |
| POST | `/v1/files/detect` | ✅ | `fileService.detect` |
| POST | `/v1/files/send-to-ai` | ✅ | `fileService.sendToAI` |
| GET | `/v1/files/health` | ✅ | 无前端调用方（后端监控自用） |
| GET | `/v1/files/registry/list` | ✅ | —（前端 registry 页列表走 search 无 q 分支，未直连本路由） |
| GET | `/v1/files/registry/search` | ✅ | `fileService.searchFiles` |
| GET | `/v1/files/registry/detail` | ✅ | `fileService.getFileDetail` |
| GET | `/v1/files/registry/stats` | ✅ | `fileService.getFileStats` |
| DELETE | `/v1/files/registry/delete` | ✅ | `fileService.deleteRegistryFiles`（单删）；`fileService.batchDelete`（批量，2026-09-07 P0-2：按 `fileIds=` 逗号多 id ≤200 分批走本路由软删，原独立 batch-delete 路由期望撤销） |

| POST | `/v1/files/registry/register` | ❌ | 无（后端未实现） |

> 注（2026-09-07 P0-1）：registry 查询接口（list/detail/search/stats）成功返回**裸对象**（`{items,total}` / record / stats），无 `{success,data}` 包装；错误走 HTTP 非 2xx + `{error:{message}}`。

### §3.11 知识库

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/knowledge` | ✅ | `knowledgeService.list`, `knowledgeService.listFiles` |
| POST | `/v1/knowledge/search` | ✅ | `knowledgeService.search`, `knowledgeService.hybridSearch`（R3：`?buckets=1` 返回 `{docs,rules,faqs}` 分桶，2026-09-07） |
| POST | `/v1/knowledge` | ✅ | `knowledgeService.create` |
| GET | `/v1/knowledge/bases` | ✅ | `knowledgeService.listBases` |
| POST | `/v1/knowledge/bases` | ✅ | `knowledgeService.createBase` |
| PUT | `/v1/knowledge/bases/{name}` | ✅ | `knowledgeService.updateBase` |
| DELETE | `/v1/knowledge/bases/{name}` | ✅ | `knowledgeService.deleteBase` |
| POST | `/v1/knowledge/save-from-chat` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/upload` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/compile` | ✅ | `knowledgeService.triggerCompile`（三入口：`useKnowledgeBaseList` 知识库页、`PendingCompilePanel` 待编译面板、`KnowledgePipelinePage` 全部/选中编译）——body `{force?, files?, domain?}`：`files` 非空时仅编译这些 raw 文件（按文件名匹配）；**D6-5：`domain` 为目标域**（决定用哪个域的本体约束抽取、产物与血缘归属哪个域），缺省回落 `knowledge`。异步启动：**202 立即返回**，进度轮询 `/v1/knowledge/compile-status`。⚠️ 旧描述"无前端调用方"已失效（2026-09-11 修正） |
| GET | `/v1/knowledge/raw-preview` | ✅ | KnowledgePage PDF 内嵌预览（`?file=<相对 raw 路径>`，仅 PDF，realpath 白名单；F5，2026-09-08） |
| GET | `/v1/knowledge/raw-files` | ✅ | 无前端调用方 |
| GET | `/v1/knowledge/lineage` | ✅ | `knowledgeService.getLineage`（血缘反查 R6：`docPath` / `artifactType+artifactId` / `domain` / `version`，返回 `{links,count}`，2026-09-07；**D6-5 起 `domain` 由流水线页按目标域传入**，前缀为 `LineageView`） |
| PUT | `/v1/knowledge/docs` | ✅ | `knowledgeService.updateDoc`（支持 `{ base }` 移动目录，2026-08-07 P2-4） |
| POST | `/v1/knowledge/trash` | ✅ | `knowledgeService.trash` |
| POST | `/v1/knowledge/restore` | ✅ | `knowledgeService.restoreSnapshot`（返回 `{ restored, content }`，2026-08-07 P2-5） |
| POST | `/v1/knowledge/restore-trash` | ✅ | `knowledgeService.restoreTrash` |
| POST | `/v1/knowledge/export-to-notebook` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/import-from-file` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/batch-delete` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/batch-tag` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/ingest` | ✅ | `fileService.saveToKnowledge` |
| PUT | `/v1/knowledge/{id}` | ✅ | `knowledgeService.update` |
| DELETE | `/v1/knowledge/{id}` | ✅ | `knowledgeService.delete` |
| GET | `/v1/knowledge/domains` | ✅ | `schemaService.listDomains`（D6-3，2026-09-11）——**只读**返回知识域清单 `{defaultDomain, domains:[{name,label,description,keywordTags,wikiPageCount,isDefault}]}`。**默认域 `knowledge` 始终存在**（即使 `~/.pyapp/knowledge/domains/` 目录不存在）；其余域来自该目录下**带 config 的子目录**（`DomainManager.list()` 语义）。不创建目录、不写盘 |
| GET | `/v1/knowledge/schema` | ✅ | `schemaService.getSchema`（2026-09-11 B1①，知识库「本体」Tab = `/knowledge?tab=ontology`）——**只读**：返回 `{mode( freeform\|constrained ), domain, domainFallback, schemaDir, files, counts, edges[], form, raw}`；**D6-3/D6-4**：支持 `?domain=` —— **读按逐文件兜底**（域目录有该文件用域，否则用全局；与 `SchemaLoader.loadGraphSchemas()` / 编译侧**完全一致**），响应含 `domain`、`domainFallback`（=存在文件继承自全局）、`writeDir`（写入目标目录）、`fileDirs`（逐文件来源目录）；默认域 `knowledge` 与不传 `?domain=` 等价（`writeDir` = 全局 `.schema/`，行为与改造前完全相同）；**不触发 `ensureDefaults`**，调用前后 `.schema/` 目录内容不变。`form.{entities,edges}` = `{expressible, reason?, rows?}`（B2a）：`expressible=false` 表示该文件含表单无法表达的内容（顶层多余键 / 条目非映射 / 值无法 JSON 往返），前端据此**禁用**表单模式，禁止有损转换。`raw.{entities.yaml,edges.yaml,xref.yaml}` = 原始 YAML 文本或 `null`（B2b 新增 entities/edges，B2c 扩到 xref；缺失为 null；**坏文件仍返回文本**，便于在原始模式下修复） |
| POST | `/v1/knowledge/schema/validate` | ✅ | `schemaService.validate`（2026-09-11 B1②，B2a 扩展）——**只读**逐项校验，固定返回 **200** + `{ok, errors[], warnings[], summary, scope}`（校验失败属诊断结果，不用 4xx，便于前端直接渲染明细）。可选 body：`{files:{"entities.yaml"\|"edges.yaml"\|"xref.yaml": "<YAML 文本>"}}` 或 `{models:{...}}`（结构化模型，服务端 dump 成 YAML 后校验）→ `scope=draft`；不带 body → `scope=disk` |
| POST | `/v1/knowledge/schema/diff` | ✅ | `schemaService.diff`（2026-09-11 B2b）——**只读**预览"磁盘现状 → 待保存草稿"的 unified diff，body 与 validate 同源（`{files}` / `{models}`），返回 `{diffs: { "<file>": {diff, additions, deletions, skipped?} }}`；复用 `computeUnifiedDiff`（与文件写入工具同一实现）；无差异 `diff: ''`；超大文件（> 250k 单元格）`skipped: true` |
| PUT | `/v1/knowledge/schema/{file}?domain=` | ✅ | `schemaService.putFile`（2026-09-11 B2a，B2c 扩白名单，**O17 起按域**）——写入单个本体文件，body `{content}`（原始 YAML 模式）或 `{model:[...]}`（表单模式，**仅 entities/edges**，`xref` 用 model 提交会 400）。**D6-4 写语义**：`?domain=` → 默认域 `knowledge`（或不传域）写**全局 `.schema/`**（迁移语义：全局即 knowledge 域的本体，**不复制文件、不新建 `domains/knowledge/`**）；**非默认域写该域目录**（缺失文件即"为该域新建"，不反向污染全局基线）。校验时本文件用待保存内容覆盖、其余文件按**逐文件兜底**读取（与 GET / 编译侧同源）。**服务端强制校验**（与 validate 同一份 `SchemaValidator`，且校验与写入**同一目录**）→ 不过则 **400 且不写盘**；通过则 写前备份到 `<schemaDir>/.backup/<时间戳>/`（保留最近 10 份）+ **原子写**（`.tmp`→`rename`）；**不触发重编译**、**不调用 `ensureDefaults`**。白名单：`entities.yaml` / `edges.yaml` / `xref.yaml`。⚠️ 路由在 `knowledge-routes.ts` 必须早于 `PUT /v1/knowledge/(?!bases\|docs)(.+)` 通配 |
| GET | `/v1/knowledge/schema/backup` | ✅ | `schemaService.listBackups`（2026-09-11 B2c）——**只读**列出历史备份（新→旧，最多 10 份，与写入清理策略一致）：`{schemaDir, keep, backups:[{id, createdAt, files:[{name,size}]}]}`；`id` = 备份目录名（时间戳），恢复时原样回传 |
| POST | `/v1/knowledge/schema/backup/{id}/restore` | ✅ | `schemaService.restoreBackup`（2026-09-11 B2c）——用指定备份覆盖某文件，body `{"file":"<entities\|edges\|xref>.yaml"}`。三重防护：① `id` 必须匹配时间戳格式（**防路径穿越**）② 备份内容**先校验**，不过则 400 且不做任何改动 ③ 覆盖前**先备份当前状态** → 恢复本身可回滚（返回 `previousBackup`）。同样为原子写 + 不触发重编译 |
| POST | `/v1/knowledge/schema/scaffold` | ✅ | 无前端调用方（2026-09-11 新增，B1③）——**唯一 scaffold 写盘入口**，两段式：不带 `{"confirm":true}` 仅返回预览（**不落盘**）；带 confirm 则写入默认 **3 份** YAML（entities/edges/xref，**不含 records.yaml**）并返回影响面（新白名单 vs 图中现有 `edge_type`）。目录已存在（含空目录）→ `skipped`，不覆盖用户定义 |

### §3.11a 知识图谱（kg_edges）

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/knowledge/graph/edges` | ✅ | `graphService.listEdges`（`?domain=&entityId=&type=&limit=`，limit 默认 200） |
| GET | `/v1/knowledge/graph/stats` | ✅ | `graphService.getStats` —— 返回 `{totalEdges, byType, totalEntities, derivedEntities}`。**D2（2026-09-11）起**：`totalEntities` = `kg_nodes` **节点表总数（含孤立实体）**；新增 `derivedEntities` = 由边派生的端点数（旧口径，保留供界面标注与对照） |
| GET | `/v1/knowledge/graph/export` | ✅ | 无前端调用方（2026-09-11 新增，B0-②）——返回 `application/x-ndjson; charset=utf-8` + `Content-Disposition: attachment`，内容为 `exportJsonl()` 原样输出 |
| POST | `/v1/knowledge/graph/import` | ✅ | 无前端调用方（2026-09-11 新增，B0-②）——**body 为 JSONL 文本**（export 的原样输出），返回 `{ imported, skipped }`；`INSERT OR IGNORE` 以 `edge_id` 判重 → 重复导入幂等；body 为空返回 **400** |
| POST | `/v1/knowledge/graph/edges` | ✅ | 无前端调用方（2026-09-11 新增，B3）——新增关系，body `{from,to,type,direction?,domain?,attributes?}`；**D8 幂等**（同 `(from,to,type,domain)` 返回既有边）；人工写入自动打 `attributes.source='manual'`；schema 白名单外 type → **400**（`KG_INVALID_EDGE_TYPE`） |
| PATCH | `/v1/knowledge/graph/edges/{id}` | ✅ | 无前端调用方（B3）——改 `type`/`direction`/`attributes`（attributes **合并**语义）；`from`/`to`/`domain` 不可改；id 不存在 → **404**；改成与既有边同键 → **400**（`KG_EDGE_UPDATE_CONFLICT`） |
| DELETE | `/v1/knowledge/graph/edges/{id}` | ✅ | 无前端调用方（B3）——删除关系；不存在 → **404**。⚠️ **O3 根因修复（2026-09-11）**：`/v1/knowledge/{graph\|schema\|bases\|docs\|snapshots\|trash\|datasources\|config\|health\|…}`（24 个保留段）下的 PUT/PATCH/DELETE 不再可能被"文档 id"通配吞掉 —— 未命中专用路由时统一 **404「未实现的接口」**，守卫与注册顺序**无关**（详见 knowledge-routes.ts 顶部清单） |
| POST | `/v1/knowledge/graph/edges/bulk` | ✅ | 无前端调用方（B3）——body `{edges:[...]}`，单次 ≤ **1000**（超出 400）；返回 `{submitted, ok, failed[{index,reason}]}`，逐条容错不中断 |
| POST | `/v1/knowledge/graph/edges/bulk-delete` | ✅ | `graphService.deleteEdgesByType`（D4，2026-09-11）——按关系类型批量删除该类型的**全部**边，body `{type, domain?, confirm:true}`；**必须 confirm**（否则 400）、`type` 必填非空、单次上限 2000（超出 400）；逐条走 `deleteEdge` → 每条写入**墓碑 + 审计**（可逐条撤销，且不会被下次抽取加回）；**不提供"删除全部"入口** |
| GET | `/v1/knowledge/graph/entities?domain=&limit=` | ✅ | 无前端调用方（B3）——由边派生：`{entities:[{id,degree}], total}`；**必须落在 `GET /v1/knowledge/graph` 兜底分支内**（否则被 stats 吞掉）。"来源(doc)"需 lineage 反查，属 B5 |
| DELETE | `/v1/knowledge/graph/entities/{id}` | ✅ | 无前端调用方（B3）——删除实体（= 删其所有关联边），返回 `{deleted,id,removedEdges}`；无关联边 → **404**；id 需 URL 编码（O15-B 后为裸 slug，如含特殊字符仍应编码） |
| GET | `/v1/knowledge/graph/nodes?domain=&limit=&search=` | ✅ | `graphService.listNodes`（D2-2，D2-3 加 `search`）——**实体档案**列表（**含孤立实体**，每行带 `degree` = 关联边数）；`search` 由**服务端** LIKE 匹配 `node_id/name/description/kind`（前端不再只能搜"已加载窗口"）；⚠️ **必须落在 `GET /v1/knowledge/graph` 兜底分支内**（否则被 stats 吞掉）；limit 默认 200、服务端钳制 1..1000 |
| GET | `/v1/knowledge/graph/nodes/{id}` | ✅ | `graphService.getNode`（D2-2）——单实体档案；不存在 → **404**；id 需 URL 编码 |
| POST | `/v1/knowledge/graph/nodes` | ✅ | `graphService.createNode`（D2-2）——创建实体（**支持孤立实体**，即暂无关系）；**O15-B：`id` 即裸 slug**（也可只给 `slug`，等价）；`kind` 是**档案属性**（分类标签，不参与 ID 拼接），domain 默认 `knowledge`；以 `origin='manual'` 写入（后续自动抽取**不覆盖**档案）；`id` 与 `slug` 都没有 → **400** |
| PATCH | `/v1/knowledge/graph/nodes/{id}` | ✅ | `graphService.updateNode`（D2-2）——改档案字段 `kind/name/description/aliases/tags/attributes`；**身份字段（id）不可改**（改身份 = 删旧建新）；**O15-B：`kind` 已归档案属性，可改**；不存在或无可更新字段 → **404** |
| DELETE | `/v1/knowledge/graph/nodes/{id}?cascade=true` | ✅ | `graphService.deleteNode`（D2-2）——删实体：无关联边直接删；**有关联边必须 `cascade=true`**（否则 **400**），级联路径走 `deleteEntity`（写墓碑 + 审计，可逐条撤销） |
| POST | `/v1/knowledge/graph/nodes/merge` | ✅ | `graphService.mergeNodes`（**O15，2026-09-11**）——**合并两个实体**：把 `from` 的全部关系**改指**到 `into` 并删除 `from` 节点，用于修复"同一实体被写成两个 ID"的历史分裂（实测真实库 4 组：`plan`↔`pdca:plan` 等）。body `{from, into, confirm:true}`（**必须 confirm**；缺 confirm / 目标不存在 / 合并自身 → **400**）。改指后与既有边**同自然键**（D8 `from+to+type+domain`）→ 判重**去重**（同样写墓碑 + 审计）；每条改动写审计（`note: 合并实体：from → into`）→ **可逐条撤销**。返回 `{merged, from, into, repointed, deduped}` |
| GET | `/v1/knowledge/graph/audit?edgeId=&limit=` | ✅ | `graphService.listAudit`（D5）——append-only 审计列表（最新在前，limit ≤ 500）；**必须落在 `GET /v1/knowledge/graph` 兜底分支内** |
| POST | `/v1/knowledge/graph/audit/{auditId}/undo` | ✅ | `graphService.undoAudit`（D5）——按动作语义撤销：`create`→删除（不写墓碑）、`update`→回滚 before 快照、`delete`→恢复快照并**解除墓碑**；`cleanup`/`import`/`undo` → **400**；未知 id → **400** |

> CLI 同源入口（同一方法，非 HTTP 转发）：`pyapp knowledge export-graph [--out <file>]` / `pyapp knowledge import-graph <file>`，注册于 [knowledge/cli/graph.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/knowledge/cli/graph.ts)。
> ⚠️ **路由注册顺序（否则被吞）**：`GET .../graph/export` 必须在 `url.startsWith('/v1/knowledge/graph')` 兜底分支内/之前；`POST .../graph/import` 必须早于 `/v1/knowledge/{id}` 的 `PUT`/`DELETE` 通配。

### §3.11b OfficeCli 安装管理

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/officecli/status` | ✅ | `officeService.getOfficeCLIStatus` |
| POST | `/v1/officecli/install` | ✅ | `officeService.installOfficeCLI` |
| POST | `/v1/doc/detect` | ✅ | 无前端调用方（内部重新检测） |

### §3.12 Buddy 电子宠物

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/buddy/companion` | ✅ | 无前端调用方 |
| POST | `/v1/buddy/interact` | ✅ | 无前端调用方 |
| GET | `/v1/buddy/stats` | ✅ | 无前端调用方 |
| GET | `/v1/buddy/dreams` | ✅ | `dreamService.getDreamLogs` |
| GET | `/v1/background/status` | ✅ | `backgroundStatusService.getStatus`（运行状况面板） |
| GET | `/v1/state/all` | ✅ | `backgroundStatusService.getStateAll`（运行状况面板 · 应用状态区，§十 阶段 D） |

### §3.13 定时任务 (Cron)

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/cron` | ✅ | `cronService.list` |
| POST | `/v1/cron` | ✅ | `cronService.create` |
| GET | `/v1/cron/{id}` | ✅ | `cronService` (get) |
| PUT | `/v1/cron/{id}` | ✅ | `cronService.update` |
| DELETE | `/v1/cron/{id}` | ✅ | `cronService.delete` |
| POST | `/v1/cron/{id}/run` | ✅ | `cronService.runNow` |

**`CronTask` 响应字段**:
`id`, `name`, `expression`, `description`, `enabled`, `scheduleMode` (cron/every/at), `scheduleDisplay` (人类可读), `silent` (boolean), `lastRun` (ms), `nextRun` (ms), `lastDurationMs`, `lastStatus` (ok/error/skipped), `lastError`, `consecutiveErrors`, `status` (idle/running/error).

**创建/更新** 接受额外字段: `scheduleMode`, `silent` (boolean).

### §3.14 渠道 (Channels)

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/channels` | ✅ | `channelService.list` |
| GET | `/v1/channels/{id}` | ✅ | `channelService.get` |
| PUT | `/v1/channels/{id}` | ✅ | `channelService.update` |
| POST | `/v1/channels/{id}/toggle` | ✅ | `channelService.toggle` |
| DELETE | `/v1/channels/{id}` | ✅ | `channelService.delete` |
| GET | `/v1/channels/plugins` | ✅ | `channelService.listPlugins` |
| POST | `/v1/channels/plugins/install` | ✅ | `channelService.installPlugin` |
| GET | `/v1/channels/health` | ✅ | `channelService.health` — 聚合健康 |
| GET | `/v1/channels/metrics` | ✅ | `channelService.getMetrics` — ChannelMetricsCard 仪表盘卡片 |
| GET | `/v1/channels/monitor/status` | ✅ | `channelService.getMonitorStatus` — 渠道实时监控快照（五态机/探测/重连计数/错误快照） |
| GET | `/v1/channels/monitor/stream` | ✅ | `ChannelMonitorPanel` EventSource — 渠道实时监控 SSE 事件流（snapshot + status_change/reconnecting/recovered/probe_failed） |
| POST | `/v1/channels/monitor/force-reconnect` | ✅ | `channelService.forceReconnect` — 强制重连兜底，body `{ channelId }` |
| POST | `/v1/channels/config/apply` | ❌ | `channelService.applyConfig` |

### §3.15 配置

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/config` | ✅ | `configService.list` |
| GET | `/v1/config/{key}` | ✅ | `configService.get` |
| PUT | `/v1/config/{key}` | ✅ | `configService.set` |
| DELETE | `/v1/config/{key}` | ✅ | 无前端调用方 |

### §3.16 Router（智能路由）

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/router/config` | ✅ | `routerService.getConfig` |
| PUT | `/v1/router/config` | ✅ | `routerService.updateConfig` |

### §3.17 设置

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/settings/data-directory` | ✅ | `SettingsPage.loadDataDirectory` |
| PUT | `/v1/settings/data-directory` | ✅ | `SettingsPage.handleSaveDataDirectory` |

### §3.17 Skills 技能系统

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/skills` | ✅ | `skillMarketService.getInstalledSkills` |
| GET | `/v1/skills/system` | ✅ | `skillService.list` |
| GET | `/v1/skills/system/{id}/content` | ✅ | `skillService.getContent` |
| GET | `/v1/skills/system/{id}/files/content` | ✅ | `skillService.getFileContent` |
| GET | `/v1/skills/search` | ✅ | `skillMarketService.search` |
| GET | `/v1/skills/recommended` | ✅ | `skillMarketService.getRecommended` |
| GET | `/v1/skills/categories` | ✅ | `skillService.getCategories`, `skillMarketService.getCategories` |
| GET | `/v1/skills/sources` | ✅ | `skillMarketService.getSources` |
| POST | `/v1/skills/sources` | ✅ | `skillMarketService.addSource` |
| DELETE | `/v1/skills/sources/{name}` | ✅ | `skillMarketService.removeSource` |
| GET | `/v1/skills/{id}` | ✅ | `skillService.get`, `skillMarketService.getSkillDetail` |
| POST | `/v1/skills/install` | ✅ | `skillMarketService.install` |
| POST | `/v1/skills/{id}/uninstall` | ✅ | `skillMarketService.uninstall` |
| POST | `/v1/skills/{id}/update` | ✅ | `skillMarketService.update` |
| POST | `/v1/skills/{id}/toggle` | ✅ | `skillMarketService.toggleEnabled` |
| POST | `/v1/skills` | ✅ | `skillService.create` |
| PUT | `/v1/skills/{id}` | ✅ | `skillService.update` |
| DELETE | `/v1/skills/{id}` | ✅ | `skillService.delete` |
| POST | `/v1/skills/{id}/enable` | ✅ | `skillService.enable` |
| POST | `/v1/skills/{id}/disable` | ✅ | `skillService.disable` |
| GET | `/v1/skills/{id}/files` | ❌ | `skillService.getFiles` |
| GET | `/v1/skills/export` | ❌ | `skillMarketService.exportAll` |
| POST | `/v1/skills/import` | ❌ | `skillMarketService.importSkills` |
| POST | `/v1/skills/{id}/clone` | ❌ | `skillMarketService.clone` |

### §3.18 监控

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/monitor/summary` | ✅ | `monitorService.getSummary` |
| GET | `/v1/monitor/metrics` | ✅ | `monitorService.getMetrics` |
| GET | `/v1/monitor/alerts` | ✅ | `monitorService.getAlerts` |
| POST | `/v1/monitor/alerts/{id}/acknowledge` | ✅ | `monitorService.acknowledgeAlert` |
| GET | `/v1/monitor/logs` | ✅ | `monitorService.getLogs` |
| GET | `/v1/health/report` | ✅ | `monitorService.getSystemHealth` |
| GET | `/v1/trace/stats` | ✅ | `traceService.getTraceStats` — Trace 统计快照（真实 API token 消耗） |

### §3.19 分析

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/analytics/dashboard` | ✅ | `monitorService.getAnalyticsDashboard` |

### §3.20 费用 (旧路径，301 → `/v1/usage/cost/*`)

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/api/cost/summary` | ⚠️ 301→`/v1/usage/cost/summary` | 旧路径，保留兼容 |
| GET | `/api/cost/records` | ⚠️ 301→`/v1/usage/cost/records` | 旧路径，保留兼容 |
| GET | `/api/cost/range` | ⚠️ 301→`/v1/usage/cost/range` | 旧路径，保留兼容 |
| GET | `/api/cost/report` | ⚠️ 301→`/v1/usage/cost/report` | 旧路径，保留兼容 |

### §3.21 命令

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/commands` | ✅ | 无前端调用方 |
| POST | `/v1/commands/execute` | ✅ | 无前端调用方 |

### §3.22 MCP 市场

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/mcp/marketplace/search` | ✅ | `mcpMarketplaceService.search` |
| GET | `/v1/mcp/marketplace/registries` | ✅ | `mcpMarketplaceService.getRegistries` |
| GET | `/v1/mcp/marketplace/categories` | ✅ | `mcpMarketplaceService.getCategories` |
| GET | `/v1/mcp/marketplace/servers/{id}` | ✅ | `mcpMarketplaceService.getServerDetail` |
| GET | `/v1/mcp/marketplace/installed` | ✅ | `mcpMarketplaceService.getInstalledServers` |
| POST | `/v1/mcp/marketplace/servers/{id}/install` | ✅ | `mcpMarketplaceService.install` |
| POST | `/v1/mcp/marketplace/servers/{id}/uninstall` | ✅ | `mcpMarketplaceService.uninstall` |
| POST | `/v1/mcp/marketplace/servers/{id}/toggle` | ✅ | `mcpMarketplaceService.toggleServer` |

### §3.22.1 插件市场（2026-08-06 新增，J-13）

> 服务对象为 Liri 应用插件（PluginMarketplace），与 MCP 市场（服务 MCP 协议服务器）不同。

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/plugins/marketplace/search?query=&page=&pageSize=` | ✅ | `pluginMarketplaceService.search` |
| GET | `/v1/plugins/marketplace/categories` | ✅ | `pluginMarketplaceService.getCategories` |
| GET | `/v1/plugins/marketplace/installed` | ✅ | `pluginMarketplaceService.getInstalledPlugins` |
| GET | `/v1/plugins/marketplace/plugins/{id}` | ✅ | `pluginMarketplaceService.getPluginDetail` |
| POST | `/v1/plugins/marketplace/plugins/{id}/install` | ✅ | `pluginMarketplaceService.install` |
| POST | `/v1/plugins/marketplace/plugins/{id}/uninstall` | ✅ | `pluginMarketplaceService.uninstall` |


### §3.23 MCP 服务器 & 工具

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/mcp/servers/{id}/verify` | ✅ | `mcpMarketplaceService.verifyServer` |
| GET | `/v1/mcp/tools` | ✅ | `mcpMarketplaceService.listTools` |
| PATCH | `/v1/mcp/tools/{id}/toggle` | ✅ | `mcpMarketplaceService.toggleTool` |

### §3.24 认证

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/auth/login` | ✅ | 无前端调用方 |
| POST | `/v1/auth/register` | ✅ | 无前端调用方 |
| POST | `/v1/auth/logout` | ✅ | 无前端调用方 |
| GET | `/v1/auth/me` | ✅ | 无前端调用方 |
| GET | `/v1/auth/permissions` | ✅ | 无前端调用方 |

### §3.25 API Keys

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/apikeys` | ✅ | 无前端调用方 |
| POST | `/v1/apikeys` | ✅ | 无前端调用方 |
| DELETE | `/v1/apikeys/{id}` | ✅ | 无前端调用方 |

### §3.26 记忆

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/memory` | ✅ | `memoryService.list` |
| GET | `/v1/memory/search` | ✅ | `memoryService.search` |
| GET | `/v1/memory/weights` | ✅ | `memoryService.getWeights` |
| GET | `/v1/memory/sync-status` | ✅ | `memoryService.getSyncStatus` |
| GET | `/v1/memory/{id}/summary` | ✅ | `memoryService.getSummary` |
| GET | `/v1/memory/{id}` | ✅ | `memoryService.get` |
| POST | `/v1/memory` | ✅ | `memoryService.create` |
| POST | `/v1/memory/sync` | ✅ | `memoryService.triggerSync` |
| POST | `/v1/memory/consolidate` | ✅ | `memoryService.consolidate` |
| PUT | `/v1/memory/{id}` | ✅ | `memoryService.update` |
| DELETE | `/v1/memory` | ✅ | `memoryService.deleteAll` |
| POST | `/v1/memory/create-from-file` | ✅ | `fileService.saveToMemory` |
| DELETE | `/v1/memory/{id}` | ✅ | `memoryService.delete` |
| POST | `/v1/memory/dream` | ✅ | 无前端调用方（存量补录：手动触发梦境） |
| GET | `/v1/memory/dream/cycles` | ✅ | 无前端调用方（存量补录：JSON 周期列表） |
| GET | `/v1/memory/dream/cycles/{cycleId}` | ✅ | 无前端调用方（存量补录：周期详情） |
| GET | `/v1/memory/dream/cycles/analytics` | ✅ | 无前端调用方（2026-09-03 新增：DB 镜像分析视图，列表 + stats；参数 from/to/triggerSource/status/limit 语义见 dev_docs/dailys/20260903/3-4-梦境周期HTTP查询端点-设计方案-20260903.md） |

### §3.27 文件系统 API

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/api/file/open` | ✅ | 无前端调用方 |
| GET | `/api/file/read` | ✅ | `chatStore` 直接 fetch |
| GET | `/api/file/paths` | ✅ | 无前端调用方 |
| GET | `/api/file/resolve-path` | ✅ | `filePathResolver.resolveFilePath` |
| GET | `/api/file/html/*` | ✅ | `FilePreviewContent` iframe 加载（路径段方式，HTML 预览及其相对引用的 css/js/图片） |

### §3.28 翻译 API

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| POST | `/v1/translate` | ✅ | `translateService.translate` |
| POST | `/v1/translate/stream` | ✅ | `translateService.streamTranslate` |
| GET | `/v1/translate/history` | ✅ | `translateService.getHistory` |

**请求示例（非流式）**：
```json
POST /v1/translate
{
  "text": "Hello world",
  "sourceLang": "auto",
  "targetLang": "zh"
}
```

**响应示例（非流式）**：
```json
{
  "data": {
    "id": "uuid",
    "sourceText": "Hello world",
    "translatedText": "你好世界",
    "sourceLang": "en",
    "targetLang": "zh",
    "model": "deepseek-chat",
    "durationMs": 1234,
    "usage": { "promptTokens": 10, "completionTokens": 5, "totalTokens": 15 },
    "createdAt": 1720000000
  }
}
```

**流式 SSE 事件**：
```
data: {"type":"token","token":"你"}
data: {"type":"token","token":"好"}
data: {"type":"done","result":{...}}
```

### §3.29 PDCA（长程任务编排，S1 灰度观测 2026-08-13 新增）

> 指标接口挂 `pdca-handlers.ts`（`handlePdcaMetrics`），数据源 `LongRunningTaskOrchestrator.getAllOrchestrators() → getMetrics()`。
> 记账同源：经典路径与快速路径（PlanDrivenLoop）步骤统计均经 `taskOrchestrator` 单例（TaskOrchestrator.ts L545）。
> 存量 `/v1/pdca/*` 路由 2026-09-03 起部分收录（list/start/status 契约，1-5 P1/P2）；audit/confirm/review/decide 仍属已知缺口（§5 待补齐登记）。

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/tasks/pdca/metrics` | ✅ | 无前端调用方（S1 灰度观测，curl 调用） |
| POST | `/v1/pdca/start` | ✅ | 无前端调用方；响应含 phase 契约（2026-09-03）：`{taskId, status:'started', workItemId, phase:'plan'}` |
| POST | `/v1/pdca/list` | ✅ | 无前端调用方；请求体（可选）`{workspaceId?, projectId?, sessionId?}`（1-5 P1，2026-09-03）；数据源 = 内存 orchestrator + checkpoint 回退（重启后非空）；条目统一含 taskId/phase/status/归属字段，checkpoint-only 条目带 `source:'checkpoint'` |
| GET | `/v1/pdca/:taskId` | ✅ | PdcaPipeline / projects 编排 tab；读模型 = 有内存 → `getStatus()`（含 plan/progress/audit/currentStep）；无内存 → checkpoint 回退（1-5 P2，2026-09-04）：构造 getStatus 对齐形态（`plan`/`progress` 由快照 `steps` 推导并原样透传，无 steps 则省略不编造，带 `source:'checkpoint'`）；checkpoint 不存在 → `{taskId, phase:'none', planId:'', lifecycle:[]}` |

**响应示例**：
```json
{
  "tasks": [{ "taskId": "pdca_xxx", "metrics": { "totalCycles": 1, "totalSteps": 4, "completedSteps": 3, "failedSteps": 0, "avgStepDurationMs": 1200, "avgReviewScore": 85, "reviewPassRate": 100, "toolFailureSteps": 0, "abortRate": 0 } }],
  "total": { "totalCycles": 1, "totalSteps": 4, "completedSteps": 3, "failedSteps": 0, "avgStepDurationMs": 1200, "avgReviewScore": 85, "reviewPassRate": 100, "toolFailureSteps": 0, "abortRate": 0 }
}
```

---

### 3.15 Inbox API（v2.2 新增）

| 方法 | 路径 | 描述 |
|------|------|------|
| **GET** | `/v1/inbox` | 列出 Inbox 项（支持 ?sessionId=&status=&type=&limit=&offset=） |
| **GET** | `/v1/inbox/count` | 获取待处理数量（支持 ?sessionId=） |
| **GET** | `/v1/inbox/:id` | 获取单个 Inbox 项 |
| **POST** | `/v1/inbox/:id/reply` | 回复 Inbox 项（body: { reply, selectedOption? }）。**M2-T2.1**：批准类答复（approve/allowlist_tool/allowlist_command）由后端 fire-and-forget 续跑——checkpoint/resume 优先，无自动检查点时从 events.jsonl 尾部重建未完成 turn（已答工具跳过，对齐 openworker `_unanswered_trailing_tool_calls`）；前端不再负责续跑决策。双渠道并发答复由 DB 级 CAS（pending→processing）保证 first-responder-wins，二次答复返回 `already_processed`/`concurrent_conflict` |

**InboxItem 数据结构**：
```json
{
  "id": "uuid",
  "sessionId": "abc123",
  "type": "approval|question|authorization",
  "title": "PDCA 计划审批",
  "message": "目标描述...",
  "status": "pending|replied|expired|dismissed",
  "reply": "批准",
  "options": ["approve", "reject", "modify"],
  "offlineCapable": true,
  "source": "pdca",
  "metadata": {},
  "createdAt": 1720000000,
  "updatedAt": 1720000000,
  "repliedAt": 1720000100
}
```

### 3.16 Usage API

| 方法 | 路径 | 描述 |
|------|------|------|
| **GET** | `/v1/usage` | 获取用量统计（支持 ?range=today\|7d\|30d&sessionId=） |

### §3.30 媒体（Media，2026-08-26 新增登记）

> 路由注册：`tool-media-routes.ts`（`dispatchToolMediaRoutes`）。
> 此前 images/videos 端点未登记，属已知缺口（§5），本次一并补齐。

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/images/list?page=&pageSize=&keyword=&dateRange=` | ✅ | `MediaPage.loadGallery`（keyword/dateRange 2026-08-26 新增：文件名/mtime 过滤） |
| GET | `/v1/images/metadata?path=` | ✅ | `MediaPage`（imageService） |
| GET | `/v1/images/static/*` | ✅ | 画廊 img src |
| POST | `/v1/images/upload` | ✅ | `imageService.upload` |
| DELETE | `/v1/images/delete?path=` | ✅ | `MediaPage.handleDeleteItem` |
| GET | `/v1/videos/list?page=&pageSize=&keyword=&dateRange=` | ✅ | `MediaPage.loadGallery`（keyword/dateRange 2026-08-26 新增） |
| GET | `/v1/videos/metadata?path=` | ✅ | `MediaPage` |
| GET | `/v1/videos/by-source-image?path=` | ✅ | 图生视频关联 |
| GET | `/v1/videos/thumbnail?path=` | ✅ 2026-08-26 新增 | 画廊视频 poster（ffmpeg 截帧 + mtime 缓存） |
| GET | `/v1/videos/static/*` | ✅ | 画廊 video src（支持 Range） |
| DELETE | `/v1/videos/delete?path=` | ✅ | `MediaPage.handleDeleteItem` |
| **POST** | `/v1/videos/extract-audio?path=` | ✅ 2026-08-26 新增 | `MediaPage` 右键菜单"提取音频" |
| POST | `/v1/video/tasks/:id/cancel` | ✅ 2026-08-26 新增 | `videoService.cancelVideoTask`（取消视频生成） |
| GET | `/v1/audio/static/*` | ✅ | 提取音频后播放/下载 |

**`POST /v1/videos/extract-audio` 说明**（P0-3 第二步）：
- `path` 参数与 delete 一致：相对 `~/.pyapp/media/video/` 的文件名或绝对路径
- 后端 `videoProcessor.extractAudio`（ffmpeg）转码为 16kHz 单声道 WAV
- 输出到 `~/.pyapp/media/audio/`，返回 `{ success, url: '/v1/audio/static/<name>.wav', path }`

---

### §3.31 Workspaces（2026-08-30 新增登记）

> 路由注册：`workspace-routes.ts`（`dispatchWorkspaceRoutes`）。
> 其余 `/v1/workspaces/*` 端点（list/sessions/items/tasks/config/rules/liri/changesets 等）未在清单收录，属已知缺口（§5 待补齐登记）。

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| DELETE | `/v1/workspaces/:id` | ✅ 2026-08-30 新增 | `workspaceService.deleteWorkspace`（workspaceSlice.deleteWorkspace → ProjectsPage「删除项目 / 撤销创建」、WorkspaceSwitcher） |

**说明**：按 `meta.id`（`ws_*`）匹配工作空间，删除其物理目录 + `.workspace.json` 元数据；不存在返回 404。修复前端删除项目后本地工作空间目录残留（此前 404 被 workspaceSlice catch 吞掉）。

---

## §4 前端服务 → 后端接口映射表（三级降级全景）

| 前端服务 | 方法 | HTTP 路径 | Tauri IPC 命令 | IPC 状态 |
|----------|------|----------|---------------|----------|
| **chatService** | `startBackend` | `/health` + IPC | `start_backend`, `get_backend_secret` | ✅ |
| | `stopBackend` | — | `stop_backend` | ✅ |
| | `getBackendStatus` | `/health` + IPC | `get_backend_status` | ✅ |
| | `sendMessage` | `POST /v1/chat/completions` | `send_message` | ✅ |
| | `streamMessage` | `POST /v1/chat/completions` (stream) | `stream_message` | ✅ |
| | `fetchModels` | `GET /v1/models` | — | ✅ (HTTP only) |
| | `updateMessageBlocks` | `PUT /api/session/{id}/message/{msgId}/blocks` | — | ✅ (HTTP only) |
| **sessionService** | `list` | `GET /v1/sessions` | `list_sessions` | ✅ |
| | `create` | `POST /v1/sessions` | `create_session` | ✅ |
| | `switch` | `POST /v1/sessions/{id}/switch` | `switch_session` | ✅ |
| | `delete` | `DELETE /v1/sessions/{id}` | `delete_session` | ✅ |
| | `rename` | `PUT /v1/sessions/{id}` | `rename_session` | ✅ |
| | `updateSessionMeta` | `PATCH /v1/sessions/{id}/meta` | — | ✅ (HTTP only) |
| | `setPinned` | `PATCH /v1/sessions/{id}/meta`（pinned-only） | — | ✅ (HTTP only) |
| | `getCurrent` | `GET /v1/sessions/current` | `get_current_session` | ✅ |
| | `get` | `GET /v1/sessions/{id}` | `get_session` | ❌ |
| | `generateTitle` | `POST /v1/sessions/{id}/title` | `generate_session_title` | ❌ |
| | `getMessages` | `GET /v1/sessions/{id}/messages` | `get_session_messages` | ❌ |
| | `clearAll` | `DELETE /v1/sessions` | `clear_all_sessions` | ❌ |
| **toolService** | `list` | `GET /v1/tools` | `list_tools` | ✅ |
| | `execute` | `POST /v1/tools/{name}/execute` | `execute_tool` | ✅ |
| **configService** | `get` | `GET /v1/config/{key}` | `get_config` | ✅ |
| | `set` | `PUT /v1/config/{key}` | `set_config` | ✅ |
| | `list` | `GET /v1/config` | `list_config` | ✅ |
| **appConfigService** | `get` | — | `get_app_config` | ✅ |
| | `set` | — | `set_app_config` | ✅ |
| **knowledgeService** | `list` / `listFiles` | `GET /v1/knowledge` | `list_knowledge` | ❌ |
| | `get` | `GET /v1/knowledge/{id}` | `get_knowledge` | ❌ |
| | `create` | `POST /v1/knowledge` | `create_knowledge` | ❌ |
| | `update` | `PUT /v1/knowledge/{id}` | `update_knowledge` | ❌ |
| | `delete` | `DELETE /v1/knowledge/{id}` | `delete_knowledge` | ❌ |
| | `search` / `hybridSearch` | `POST /v1/knowledge/search` | `search_knowledge` | ❌ |
| | `listBases` | `GET /v1/knowledge/bases` | `list_knowledge_bases` | ❌ |
| | `createBase` | `POST /v1/knowledge/bases` | `create_knowledge_base` | ❌ |
| | `updateBase` | `PUT /v1/knowledge/bases/{name}` | `update_knowledge_base` | ❌ |
| | `deleteBase` | `DELETE /v1/knowledge/bases/{name}` | `delete_knowledge_base` | ❌ |
| | `updateDoc` | `PUT /v1/knowledge/docs` | — | ✅ (2026-08-07 P2-4 支持 base 移动) |
| | `trash` | `POST /v1/knowledge/trash` | — | ✅ (2026-08-07) |
| | `restoreSnapshot` | `POST /v1/knowledge/restore` | — | ✅ (2026-08-07 P2-5) |
| | `restoreTrash` | `POST /v1/knowledge/restore-trash` | — | ✅ (2026-08-07) |
| | `cloneBase` | `POST /v1/knowledge/bases/{name}/clone` | — | ✅ (v8.0 新增) |
| | `duplicateBase` | `POST /v1/knowledge/bases/{name}/duplicate` | — | ✅ (v8.0 新增) |
| | `listFAQ` | `GET /v1/knowledge/{base}/faq` | — | ✅ (v8.0 新增) |
| | `createFAQ` | `POST /v1/knowledge/{base}/faq` | — | ✅ (v8.0 新增) |
| | `updateFAQ` | `PUT /v1/knowledge/{base}/faq/{id}` | — | ✅ (v8.0 新增) |
| | `deleteFAQ` | `DELETE /v1/knowledge/{base}/faq/{id}` | — | ✅ (v8.0 新增) |
| | `batchDeleteFAQ` | `POST /v1/knowledge/{base}/faq/batch-delete` | — | ✅ (v8.0 新增) |
| | `importFAQ` | `POST /v1/knowledge/{base}/faq/import` | — | ✅ (v8.0 新增) |
| | `searchFAQ` | `GET /v1/knowledge/{base}/faq/search?q=...` | — | ✅ (v8.0 新增) |
| | `getFAQCategories` | `GET /v1/knowledge/{base}/faq/categories` | — | ✅ (v8.0 新增) |
| **agentService** | `listTasks` | `GET /v1/agents/tasks` ✅ | `list_agent_tasks` | ❌ |
| | `getTask` | `GET /v1/agents/tasks/{id}` ✅ | `get_agent_progress` | ❌ |
| | `getTaskLogs` | `GET /v1/agents/tasks/{id}/logs` ❌ | `get_agent_task_logs` | ❌ |
| | `createTask` | `POST /v1/agents/tasks` ✅ | `create_agent_task` | ❌ |
| | `executeTask` | `POST /v1/agents/tasks/execute` ❌ | `execute_agent_task` | ❌ |
| | `updateTask` | `PUT /v1/agents/tasks/{id}` ❌ | `update_agent_task` | ❌ |
| | `deleteTask` | `DELETE /v1/agents/tasks/{id}` ❌ | `delete_agent_task` | ❌ |
| | `cancelTask` | `POST /v1/agents/tasks/{id}/cancel` ✅ | `cancel_agent_task` | ❌ |
| | `listTaskHistory` | `GET /v1/agents/tasks/history` ❌ | `list_agent_task_history` | ❌ |
| **fileService** | `listDir` | — | `list_files` | ❌ |
| | `readFile` | — | `read_file` | ❌ |
| | `upload` / `uploadBase64` | `POST /v1/files/upload` | — | ✅ (HTTP only) |
| | `convert` | `POST /v1/files/convert` | — | ✅ (HTTP only) |
| | `detect` | `POST /v1/files/detect` | — | ✅ (HTTP only) |
| | `sendToAI` | `POST /v1/files/send-to-ai` | — | ✅ (HTTP only) |
| | `getRegistryList` | `GET /v1/files/registry/list` | — | ✅ (HTTP only) |
| | `getRegistryDetail` | `GET /v1/files/registry/detail` | — | ✅ (HTTP only) |
| | `searchRegistry` | `GET /v1/files/registry/search` | — | ✅ (HTTP only) |
| | `getRegistryStats` | `GET /v1/files/registry/stats` | — | ✅ (HTTP only) |
| | `deleteRegistryFiles` | `DELETE /v1/files/registry/delete` | — | ✅ (HTTP only) |
| **voiceService** | 全部 13 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **channelService** | 全部 8 个方法 | 6/8 ✅ | — | ✅ (HTTP only 含 2 缺口) |
| **skillService** | 全部 8 个方法 | 7/8 ✅ | — | ✅ (HTTP only 含 1 缺口) |
| **skillMarketService** | 全部 14 个方法 | 11/14 ✅ | — | ✅ (HTTP only 含 3 缺口) |
| **memoryService** | 全部 12 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **monitorService** | 全部 7 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **modelService** | `list` | 全部 ✅ | — | ✅ (HTTP only) |
| **modelSwitchService** | 全部 5 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **routerService** | `getConfig` | `GET /v1/router/config` ✅ | — | ✅ (New) |
| | `updateConfig` | `PUT /v1/router/config` ✅ | — | ✅ (New) |
| **usageService** | 全部 5 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **inboxService** | `list` | `GET /v1/inbox` ✅ | — | ✅ (v2.2 新增) |
|  | `get` | `GET /v1/inbox/:id` ✅ | — | ✅ |
|  | `count` | `GET /v1/inbox/count` ✅ | — | ✅ |
|  | `reply` | `POST /v1/inbox/:id/reply` ✅ | — | ✅ |
| **pricingService** | 全部 3 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **balanceService** | `check` | `POST /v1/balance` ✅ | — | ✅ (HTTP only) |
| | `batchCheck` | `GET /v1/balances` ✅ **新增** | — | ✅ (HTTP only) |
| **providerService** | 全部 9 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **mcpMarketplaceService** | 全部 11 个方法 | 全部 ✅ | — | ✅ (HTTP only) |
| **translateService** | `translate` | `POST /v1/translate` ✅ | — | ✅ (HTTP only) |
| | `streamTranslate` | `POST /v1/translate/stream` ✅ | — | ✅ (HTTP only) |
| | `getHistory` | `GET /v1/translate/history` ✅ | — | ✅ (HTTP only) |

---

## §5 已知问题与缺口（按严重程度排序）

### §5.1 HTTP 路由缺失（后端未实现，前端调用 → 404/500）

| # | 缺失路由 | 调用方 | 影响 |
|---|----------|--------|------|
| 1 | `POST /v1/agents/tasks/execute` | `agentService.executeTask` | Agent 任务执行失败 |
| 2 | `PUT /v1/agents/tasks/{id}` | `agentService.updateTask` | 任务更新失败 |
| 3 | `DELETE /v1/agents/tasks/{id}` | `agentService.deleteTask` | 任务删除失败 |
| 4 | `GET /v1/agents/tasks/{id}/logs` | `agentService.getTaskLogs` | 日志查询失败 |
| 5 | `GET /v1/agents/tasks/history` | `agentService.listTaskHistory` | 历史任务为空 |
| 6 | `GET /v1/channels/{id}/health` | `channelService.health` | 渠道健康检查失败 |
| 7 | `POST /v1/channels/config/apply` | `channelService.applyConfig` | 配置应用失败 |
| 8 | `GET /v1/skills/{id}/files` | `skillService.getFiles` | 技能文件列表为空 |
| 9 | `GET /v1/skills/export` | `skillMarketService.exportAll` | 技能导出失败 |
| 10 | `POST /v1/skills/import` | `skillMarketService.importSkills` | 技能导入失败 |
| 11 | `POST /v1/skills/{id}/clone` | `skillMarketService.clone` | 技能克隆失败 |

### §5.2 Tauri IPC 命令缺失（Tauri 桌面环境 fallback 失效）

以下模块在 Tauri 桌面环境下 HTTP 失败后，`tryTauri()` 会调用不存在的 IPC 命令 → catch 异常 → 降级到内存 mock（数据为空但不会崩溃）。

| 模块 | 缺失 IPC 命令 | 数量 |
|------|-------------|------|
| `knowledgeService` | `list_knowledge`, `get_knowledge`, `create_knowledge`, `update_knowledge`, `delete_knowledge`, `search_knowledge`, `list_knowledge_bases`, `create_knowledge_base`, `update_knowledge_base`, `delete_knowledge_base` | 10 |
| `agentService` | `list_agent_tasks`, `get_agent_progress`, `get_agent_task_logs`, `create_agent_task`, `execute_agent_task`, `update_agent_task`, `delete_agent_task`, `cancel_agent_task`, `list_agent_task_history` | 9 |
| `sessionService` | `get_session`, `generate_session_title`, `get_session_messages`, `clear_all_sessions` | 4 |
| `fileService` | `list_files`, `read_file` | 2 |

### §5.3 后端已有路由但前端无调用方（预留接口）

以下路由已在后端 `LocalHTTPService` / `ModelManagementAPI` 中注册，但 `client/src/` 中未找到直接调用方。按模块：

- **模型**: `/v1/models/test`
- **模型配置**: `/v1/models/app-config` CRUD（4 个端点）
- **知识库**: `/v1/knowledge/save-from-chat`, `upload`, `compile`, `raw-files`, `lineage`, `docs`, `export-to-notebook`, `import-from-file`, `batch-delete`, `batch-tag`
- **Buddy**: 全部 4 个端点
- **Cron**: 全部 6 个端点
- **配置**: `DELETE /v1/config/{key}`
- **设置**: `GET/PUT /v1/settings/data-directory`
- **费用**: `/api/cost/summary`, `/api/cost/records`, `/api/cost/range`
- **命令**: `/v1/commands`, `/v1/commands/execute`
- **认证**: 全部 5 个端点
- **API Keys**: 全部 3 个端点
- **文件系统**: `/api/file/open`, `/api/file/paths`
- **系统**: `/v1/events` (SSE)

### §5.4 前端调用方式不统一（非标准路径）

| 文件 | 调用方式 | 路径 | 问题 |
|------|---------|------|------|
| `chatStore.ts:561` | 直接 `fetch()` | `/api/file/read?path=...` | 未走 `httpClient`，无 Bearer 认证头 |
| `filePathResolver.ts:11` | 直接 `fetch()` | `/api/file/resolve-path?path=...` | 未走 `httpClient` |
| `voiceService.ts:103` | 直接 `fetch()` + FormData | `/v1/voice/upload` | 未走 `httpClient`，但后端是 FormData 上传场景 |
| `voiceService.ts:116` | 直接 `fetch()` | `/v1/voice/stream/{id}` | 未走 `httpClient` |

---

## §6 维护规则

### 6.1 新增接口流程

1. 查本文档确认无重复
2. 后端 `LocalHTTPService.handleRequest()` 注册路由
3. 如需 Tauri fallback → Rust `lib.rs` `invoke_handler` 新增命令
4. 更新本文档对应表格，标记 ✅
5. PR 中附上本文档变更 diff

### 6.2 修改接口流程

1. 查 §4 映射表确认所有调用方
2. 同步修改后端、前端、Rust IPC（如适用）
3. 更新本文档对应条目
4. PR 描述中注明 breaking change

### 6.3 删除接口流程

1. 查 §4 确认无调用方或已清理
2. 从本文档移除对应条目
3. 移除后端路由 + Rust 命令（如适用）

### 6.4 PR Review 检查项

- [ ] 新路由/命令是否已在本文档登记？
- [ ] 前端 `invoke` 的 Tauri 命令是否在 §2 中存在？
- [ ] HTTP 请求方法、路径、参数是否与 §3 一致？
- [ ] 是否新增了 §5 已知缺口？
- [ ] 直接 `fetch()` 的调用是否应改用 `httpClient`？

---

## §7 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.2.0 | 2026-07-26 | 新增 §3.15 Inbox API（4 个端点） + §3.16 Usage API；§4 新增 inboxService 映射 |
| 2.0.0 | 2026-06-03 | 全量扫描：新增 11 个 HTTP 路由缺口标记（Agent 5个 + Channel 2个 + Skills 4个）；新增 §5.3 预留接口清单（10个模块）；新增 §5.4 非标准调用标记（4处）；完善 25 个 IPC 缺口计数；所有状态标记 ✅/❌ |
| 1.0.0 | 2026-06-03 | 初始版本 |
