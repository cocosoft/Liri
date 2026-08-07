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

### §3.2 模型

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/models` | ✅ | `modelService.list`, `chatService.fetchModels` |
| POST | `/v1/models/test` | ✅ | 无前端调用方 |
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

### §3.6 会话

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/sessions` | ✅ | `sessionService.list` |
| POST | `/v1/sessions` | ✅ | `sessionService.create` |
| DELETE | `/v1/sessions` | ✅ | `sessionService.clearAll` |
| GET | `/v1/sessions/current` | ✅ | `sessionService.getCurrent` |
| GET | `/v1/sessions/{id}` | ✅ | `sessionService.get` |
| PUT | `/v1/sessions/{id}` | ✅ | `sessionService.rename` |
| DELETE | `/v1/sessions/{id}` | ✅ | `sessionService.delete` |
| POST | `/v1/sessions/{id}/switch` | ✅ | `sessionService.switch` |
| GET | `/v1/sessions/{id}/messages` | ✅ | `sessionService.getMessages` |
| POST | `/v1/sessions/{id}/title` | ✅ | `sessionService.generateTitle` |
| PUT | `/api/session/{id}/message/{msgId}/blocks` | ✅ | `chatService.updateMessageBlocks` |
| GET | `/v1/sessions/{id}/streaming` | ✅ P1-5 | `chat-message.slice.ts` ghostCheckTimer |
| GET | `/v1/sessions/{id}/checkpoints/latest` | ✅ P2-1 | `chat-message.slice.ts` reconnect |
| POST | `/v1/sessions/{id}/resume` | ✅ P2-1 | `chatService.streamMessageWithReconnect` |

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
| GET | `/v1/files/registry/list` | ✅ | `fileService.getRegistryList` |
| GET | `/v1/files/registry/search` | ✅ | `fileService.searchFiles` |
| GET | `/v1/files/registry/detail` | ✅ | `fileService.getFileDetail` |
| GET | `/v1/files/registry/stats` | ✅ | `fileService.getFileStats` |
| DELETE | `/v1/files/registry/delete` | ✅ | `fileService.deleteRegistryFiles` |
| POST | `/v1/files/registry/batch-delete` | ✅ | `fileService.batchDelete` |
| POST | `/v1/files/registry/register` | ❌ | 无（后端未实现） |

### §3.11 知识库

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/knowledge` | ✅ | `knowledgeService.list`, `knowledgeService.listFiles` |
| POST | `/v1/knowledge/search` | ✅ | `knowledgeService.search`, `knowledgeService.hybridSearch` |
| POST | `/v1/knowledge` | ✅ | `knowledgeService.create` |
| GET | `/v1/knowledge/bases` | ✅ | `knowledgeService.listBases` |
| POST | `/v1/knowledge/bases` | ✅ | `knowledgeService.createBase` |
| PUT | `/v1/knowledge/bases/{name}` | ✅ | `knowledgeService.updateBase` |
| DELETE | `/v1/knowledge/bases/{name}` | ✅ | `knowledgeService.deleteBase` |
| POST | `/v1/knowledge/save-from-chat` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/upload` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/compile` | ✅ | 无前端调用方 |
| GET | `/v1/knowledge/raw-files` | ✅ | 无前端调用方 |
| PUT | `/v1/knowledge/docs` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/export-to-notebook` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/import-from-file` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/batch-delete` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/batch-tag` | ✅ | 无前端调用方 |
| POST | `/v1/knowledge/ingest` | ✅ | `fileService.saveToKnowledge` |
| PUT | `/v1/knowledge/{id}` | ✅ | `knowledgeService.update` |
| DELETE | `/v1/knowledge/{id}` | ✅ | `knowledgeService.delete` |

### §3.12 Buddy 电子宠物

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/v1/buddy/companion` | ✅ | 无前端调用方 |
| POST | `/v1/buddy/interact` | ✅ | 无前端调用方 |
| GET | `/v1/buddy/stats` | ✅ | 无前端调用方 |
| GET | `/v1/buddy/dreams` | ✅ | 无前端调用方 |

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
| GET | `/v1/channels/{id}/health` | ❌ | `channelService.health` |
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

### §3.27 文件系统 API

| 方法 | 路径 | 后端状态 | 前端调用方 |
|------|------|----------|-----------|
| GET | `/api/file/open` | ✅ | 无前端调用方 |
| GET | `/api/file/read` | ✅ | `chatStore` 直接 fetch |
| GET | `/api/file/paths` | ✅ | 无前端调用方 |
| GET | `/api/file/resolve-path` | ✅ | `filePathResolver.resolveFilePath` |

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

---

### 3.15 Inbox API（v2.2 新增）

| 方法 | 路径 | 描述 |
|------|------|------|
| **GET** | `/v1/inbox` | 列出 Inbox 项（支持 ?sessionId=&status=&type=&limit=&offset=） |
| **GET** | `/v1/inbox/count` | 获取待处理数量（支持 ?sessionId=） |
| **GET** | `/v1/inbox/:id` | 获取单个 Inbox 项 |
| **POST** | `/v1/inbox/:id/reply` | 回复 Inbox 项（body: { reply, selectedOption? }） |

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
- **知识库**: `/v1/knowledge/save-from-chat`, `upload`, `compile`, `raw-files`, `docs`, `export-to-notebook`, `import-from-file`, `batch-delete`, `batch-tag`
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
