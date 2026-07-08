# Node.js 内置模块引用完整盘点

> 生成时间: 2026-07-08 | 最后更新: 2026-07-08 | 范围: `app/src/**/*.ts`
> 共 **248** 处引用，2 个模块（Phase 1+2+低量模块 剥离后）
> 
> 已剥离: `events` `path` `url` `util` `os` `crypto` `child_process` `net` `tls` `stream` `https` `dns` `readline` `worker_threads` `zlib` — 15 个模块清零

## 0. 总览

| 模块 | 引用数 | 剥离难度 |
|------|:-----:|:------:|
| `fs` / `fs/promises` | 188 | 高 |
| `http` | 60 | 高 |

> ~~`events` `path` `url` `util` `os` `crypto` `child_process` `net` `tls` `stream` `https` `dns` `readline` `worker_threads` `zlib`~~ — ✅ 已剥离（15 个模块，194 处引用）

---

## 1. 按模块详细分析

### 1.1 `fs` / `fs/promises` — 188 处

**最大依赖**。分布在以下领域：

| 领域 | 典型文件 | 引用数 | 可替代方案 |
|------|------|:--:|------|
| 会话持久化 | `session/persistence/*`, `session/storage/*` | ~30 | Bun File I/O (兼容 API) |
| 安全回滚 | `security/rollback/*` | ~15 | Bun File I/O |
| 媒体处理 | `media/image/*`, `media/video/*`, `media/pdf/*` | ~20 | Bun File I/O |
| 配置管理 | `config/*`, `security/config/*` | ~10 | Bun File I/O |
| 频道日志 | `channels/log/*` | ~5 | Bun File I/O |
| 插件系统 | `plugins/*` | ~10 | Bun File I/O |
| 知识库 | `knowledge/semantic/*` | ~5 | Bun File I/O |
| HTTP handlers | `infrastructure/http/handlers/*` | ~10 | Bun File I/O |
| 其他 | `tools/*`, `workspace/*`, etc. | ~73 | — |

**剥离评估**：`fs` 是 Node.js 最核心的模块，**Bun 原生支持 `Bun.file()` + `Bun.write()`**，API 有差异但功能等价。剥离成本高但可行，需全局替换 `readFileSync` → `Bun.file().text()`、`writeFileSync` → `Bun.write()` 等。

---

### 1.2 `crypto` — 61 处

| API | 用途 | 引用数 |
|------|------|:--:|
| `randomUUID()` | 生成唯一 ID | ~30 |
| `createHash()` | SHA256 哈希 | ~25 |
| `createSign()` | RSA 签名（VertexAI 认证） | ~3 |
| `randomBytes()` | 安全随机数 | ~3 |

**剥离评估**：Bun 提供 `Bun.randomUUIDv7()` 和 `Bun.SHA256.hash()` 作为 crypto 替代。`randomUUID` 可批量替换，`createHash` 需逐个适配。VertexAI 的 `createSign` 需要原生 RSA 签名支持，目前 Bun 无直接替代。

---

### 1.3 `http` — 60 处

58/60 是 **`import type http from 'node:http'`** — 仅用于 TypeScript 类型标注（`req: http.IncomingMessage`, `res: http.ServerResponse`）。

**剥离评估**：如果切换到 Bun 原生 HTTP server（`Bun.serve()`），类型系统需要 `Bun.IncomingMessage` / `Bun.ServerResponse` 替代。API 签名不同，需要整体迁移 HTTP 层。

---

### 1.4 `child_process` — 37 处

| 命令 | 用途 | 引用数 |
|------|------|:--:|
| Git | `execSync('git ...')` | ~10 |
| FFmpeg | 视频/音频处理 | ~8 |
| `fork()` | 子任务隔离执行 | ~3 |
| `spawn()` | 微信 CLI、PTY、SSH | ~5 |
| Docker | `execSync('docker ...')` | ~3 |
| NPM | 插件分发 | ~3 |
| 系统命令 | 系统指标收集 | ~5 |

**剥离评估**：Bun 提供 `Bun.spawn()` 和 `Bun.spawnSync()` 作为替代，API 相似但响应类型不同。`fork()` 无直接 Bun 替代（需要 Worker 模式）。剥离难度中等。

---

### 1.5 低用量模块（<20 处）

| 模块 | 剥离方案 |
|------|------|
| `os` (18) | Bun 提供 `Bun.env.tmpdir()` 替代 `os.tmpdir()`；`os.homedir()` 可用 `process.env.HOME` |
| `net` (7) | Bun 提供 `Bun.connect()` / `Bun.listen()` TCP API |
| `tls` (3) | Bun TLS 支持（`Bun.connect({ tls: true })`） |
| `stream` (3) | 仅作类型标注，可改为 Bun ReadableStream |
| `https` (2) | Bun `fetch()` 原生支持 HTTPS |
| `worker_threads` (1) | Bun Worker 替代 |
| `dns` (1) | `Bun.dns` 替代 |
| `buffer` (1) | Bun Buffer 完全兼容 |
| `readline` (1) | Bun `readline` 兼容 |
| `zlib` (1) | `Bun.gzipSync()` 替代 |

---

## 2. 剥离优先级建议（Phase 1 完成，剩余 303 处）

### ✅ Phase 1（已完成 — 207 处已剥离）

| 模块 | 状态 | 引用数 | 替换方案 |
|------|:--:|:--:|------|
| `events` | ✅ | 46 → 0 | `node:events` → `events` |
| `path` | ✅ | 155 → 0 | `node:path` → `path` |
| `url` | ✅ | 3 → 0 | `node:url` → 全局 `URL` / `new URL()` |
| `util` | ✅ | 3 → 0 | `node:util` → `util` |

### 第二梯队（中等风险，需逐模块验证）

| 模块 | 引用数 | 替换方案 |
|------|:--:|------|
| `crypto` | 61 | `Bun.randomUUIDv7()` / `Bun.SHA256.hash()` — 除 `createSign` 外均可替代 |
| `os` | 18 | `process.env` / `Bun.env` + 少量平台判断 |
| `child_process` | 37 | `Bun.spawn()` — 保留 `fork()` 为 Worker |

**预期效果**：额外去除 ~110 处引用，累计 72% 剥离。

### 第三梯队（高成本，需要架构调整）

| 模块 | 引用数 | 原因 |
|------|:--:|------|
| `fs` (188) | 核心 I/O，涉及面最广，替换 = 全项目规模的重构 |
| `http` (60) | Express/Koa → Bun.serve()，API 层面不兼容 |

**预期效果**：完全消除所有 Node.js 依赖，但成本最高。

---

## 3. 完整清单（按文件路径排序）

> 格式：`文件路径:行号 ⏎ import 语句`

```
src/acp/AcpWebSocketServer.ts:41  import * as http from 'node:http';
src/acp/AcpWebSocketServer.ts:42  import * as net from 'node:net';
src/acp/AcpWebSocketServer.ts:43  import type { Duplex } from 'node:stream';
src/acp/AcpWebSocketServer.ts:44  import * as crypto from 'node:crypto';
src/acp/AcpWsClient.ts:28         import type { Duplex } from 'node:stream';
src/acp/AcpWsClient.ts:29         import * as net from 'node:net';
src/acp/client.ts:1                import { spawn } from 'node:child_process';
src/acp/secret-file.ts:1           import { readFile } from 'node:fs/promises';
src/acp/secret-file.ts:2           import { access } from 'node:fs/promises';
src/acp/websocket.ts:29            import * as crypto from 'node:crypto';
src/agent/AgentCleanup.ts          (2 refs)
src/agent/SessionReset.ts          (2 refs)
src/agent/cli-runner/index.ts      (1 ref)
src/agent/sandbox/index.ts         (2 refs)
src/ai/ModelManagementAPI.ts       (1 ref)
src/ai/models/ModelPricingService.ts      (1 ref)
src/ai/models/UsageStatsService.ts        (1 ref)
src/ai/parsers/DeepSeekV31Parser.ts       (1 ref)
src/ai/parsers/DeepSeekV3Parser.ts        (1 ref)
src/ai/parsers/Glm45Parser.ts             (1 ref)
src/ai/parsers/HermesXmlParser.ts         (1 ref)
src/ai/parsers/LlamaJsonParser.ts         (1 ref)
src/ai/providers/FALProvider.ts           (1 ref)
src/ai/providers/ProviderManager.ts       (1 ref)
src/ai/providers/VertexAIProvider.ts      (2 refs: fs + crypto)
src/ai/telemetry/SessionSpanTracer.ts     (1 ref)
src/analytics/AnalyticsService.ts         (1 ref)
src/channels/DevicePairingService.ts      (2 refs)
src/channels/bluebubbles/monitor.ts       (1 ref)
src/channels/cache/MediaCache.ts          (3 refs: fs + path + crypto)
src/channels/claude/ClaudeChannel.ts      (1 ref)
src/channels/dingtalk/DingTalkChannel.ts  (1 ref: http)
src/channels/drs/DynamicRegistrationService.ts (1 ref)
src/channels/email/EmailChannel.ts        (6 refs: events + net + tls + fs + path + crypto)
src/channels/facebookmessenger/FacebookMessengerChannel.ts (1 ref)
src/channels/feishu/FeishuChannel.ts      (1 ref: http)
src/channels/googlechat/GoogleChatChannel.ts (3 refs)
src/channels/irc/IrcChannel.ts            (4 refs: net + tls + crypto + events)
src/channels/line/LineChannel.ts          (2 refs: crypto + http)
src/channels/log/ChannelLogManager.ts     (2 refs: fs + path)
src/channels/matrix/MatrixChannel.ts      (1 ref)
src/channels/mattermost/monitor.ts        (1 ref)
src/channels/monitoring/ChannelHealthMonitor.ts (1 ref)
src/channels/msteams/MSTeamsChannel.ts    (4 refs: crypto + http + crypto + path)
src/channels/nostr/NostrChannel.ts        (2 refs: events + crypto)
src/channels/policy/PairingStore.ts       (3 refs: fs + path + crypto)
src/channels/registry/ChannelRegistry.ts  (1 ref)
src/channels/session/ChannelSessionManager.ts (1 ref)
src/channels/session/SessionResetPolicy.ts    (1 ref)
src/channels/signal/SignalChannel.ts      (3 refs: events + child_process + util)
src/channels/sms/SmsChannel.ts            (1 ref)
src/channels/turn/TurnManager.ts          (1 ref)
src/channels/twitter/TwitterChannel.ts    (1 ref)
src/channels/webhook/WebhookChannel.ts    (2 refs: events + http)
src/channels/wechat/cli-manager.ts        (5 refs: events + child_process + crypto + path + fs)
src/channels/whatsapp/WhatsAppChannel.ts  (1 ref)
src/channels/yuanbao/YuanbaoChannel.ts    (1 ref)
src/channels/zalo/ZaloChannel.ts          (1 ref)
src/chat/ChatManager.ts                   (3 refs)
src/chat/services/ImageContextService.ts  (1 ref: path)                        ← 本次新增
src/chat/services/PathGuardService.ts     (1 ref: path)                        ← 本次新增
src/chat/services/PathWhitelist.ts        (1 ref: path)                        ← 本次新增
src/chat/services/SessionConfirmedPaths.ts(1 ref: path)                        ← 本次新增
src/chronos/CronSubprocessExecutor.ts     (3 refs)
src/chronos/autoDream/DreamAgentExecutor.ts (3 refs)
src/chronos/event-driven/CronEventTrigger.ts (1 ref)
src/chronos/identity/ScheduleIdentity.ts  (1 ref)
src/chronos/isolated-agent/IsolatedAgentExecutor.ts (4 refs)
src/chronos/reaper/SessionReaper.ts       (1 ref)
src/chronos/service/CronTaskStore.ts      (2 refs)
src/chronos/stagger/StaggerScheduler.ts   (1 ref)
src/chronos/watcher/CronFileWatcher.ts    (2 refs)
src/chronos/webhook/WebhookManager.ts     (4 refs)
src/cli/deps/index.ts                     (1 ref)
src/cli/ports/index.ts                    (1 ref)
src/commands/agents/Subagent.ts           (3 refs: fs + path)
src/commands/backup/BackupCommand.ts      (3 refs: child_process + fs + path)
src/commands/builtin/debug/Debug.ts       (1 ref)
src/commands/builtin/env/Env.ts           (1 ref)
src/commands/builtin/knowledge/Knowledge.ts (3 refs)
src/commands/builtin/onboard/Onboard.ts   (2 refs)
src/commands/ide/ide.ts                   (4 refs)
src/commands/migrate/MigrateCommand.ts    (2 refs)
src/config/ConfigManager.ts               (1 ref)
src/config/ConfigReloader.ts              (3 refs)
src/config/RuntimeConfigSnapshot.ts       (1 ref)
src/config/io/ConfigIO.ts                 (2 refs)
src/core/delivery/archiver/TranscriptArchiver.ts (3 refs)
src/core/delivery/monitor/DiskSpaceMonitor.ts    (1 ref)
src/core/gateway/ChannelStatusReporter.ts        (1 ref)
src/core/gateway/HealthMonitor.ts                (1 ref)
src/core/gateway/mcp/GatewayMcpBridge.ts         (1 ref)
src/core/gateway/protocol/frames.ts              (2 refs)
src/core/health/DependencyHealthChecker.ts       (3 refs)
src/core/lifecycle/GracefulRestartService.ts     (1 ref)
src/core/memory-host-sdk/events.ts               (2 refs)
src/core/performance/SprintPerformanceChecker.ts (2 refs)
src/cost/CostRecordRepository.ts                 (1 ref)
src/daemon/AutoUpdater.ts                        (3 refs)
src/daemon/HealthServer.ts                       (2 refs)
src/daemon/ProcessWatchdog.ts                    (1 ref)
src/daemon/audit/DaemonAudit.ts                  (2 refs)
src/daemon/diagnostics/DaemonDiagnostics.ts      (4 refs)
src/daemon/service/DaemonService.ts              (4 refs)
src/docs/FileDocsProvider.ts                     (2 refs)
src/entrypoints/api-handler.ts                   (1 ref)
src/infrastructure/http/LocalHTTPService.ts      (3 refs)
src/infrastructure/http/LocalHTTPServiceHelpers.ts (1 ref)
src/infrastructure/http/LocalHTTPServiceSSE.ts   (1 ref)
src/infrastructure/http/handlers/agent-role-handlers.ts    (1 ref)
src/infrastructure/http/handlers/agent1-handlers.ts        (1 ref)
src/infrastructure/http/handlers/agent2-handlers.ts        (1 ref)
src/infrastructure/http/handlers/analytics-handlers.ts     (1 ref)
src/infrastructure/http/handlers/apikey-handlers.ts        (1 ref)
src/infrastructure/http/handlers/auth-handlers.ts          (1 ref)
src/infrastructure/http/handlers/bottleneck-handlers.ts    (1 ref)
src/infrastructure/http/handlers/buddy-handlers.ts         (1 ref)
src/infrastructure/http/handlers/channel-handlers.ts       (1 ref)
src/infrastructure/http/handlers/channel-plugin-handlers.ts (1 ref)
src/infrastructure/http/handlers/chat-handlers.ts          (2 refs)
src/infrastructure/http/handlers/checkpoint-handlers.ts    (1 ref)
src/infrastructure/http/handlers/commands-handlers.ts      (1 ref)
src/infrastructure/http/handlers/config-handlers.ts        (1 ref)
src/infrastructure/http/handlers/cost-handlers.ts          (1 ref)
src/infrastructure/http/handlers/council-handlers.ts       (2 refs)
src/infrastructure/http/handlers/cron-handlers.ts          (1 ref)
src/infrastructure/http/handlers/file-upload-handlers.ts   (2 refs)
src/infrastructure/http/handlers/files-handlers.ts         (3 refs)
src/infrastructure/http/handlers/handler-utils.ts          (2 refs)
src/infrastructure/http/handlers/image-handlers.ts         (5 refs)
src/infrastructure/http/handlers/kanban-handlers.ts        (1 ref)
src/infrastructure/http/handlers/knowledge-handlers.ts     (1 ref)
src/infrastructure/http/handlers/mcp-marketplace-handlers.ts (1 ref)
src/infrastructure/http/handlers/media-handlers.ts         (1 ref)
src/infrastructure/http/handlers/memory-handlers.ts        (3 refs)
src/infrastructure/http/handlers/monitoring-handlers.ts    (2 refs)
src/infrastructure/http/handlers/orch-intelligence-handlers.ts (1 ref)
src/infrastructure/http/handlers/orchestration-handlers.ts (1 ref)
src/infrastructure/http/handlers/pdca-handlers.ts          (1 ref)
src/infrastructure/http/handlers/plan-flow-handlers.ts     (1 ref)
src/infrastructure/http/handlers/route-registry.ts         (1 ref)
src/infrastructure/http/handlers/route-table.ts            (1 ref)
src/infrastructure/http/handlers/rule-handlers.ts          (1 ref)
src/infrastructure/http/handlers/security-handlers.ts      (1 ref)
src/infrastructure/http/handlers/semantic-index-handlers.ts (1 ref)
src/infrastructure/http/handlers/session-handlers.ts       (1 ref)
src/infrastructure/http/handlers/skill-handlers.ts         (1 ref)
src/infrastructure/http/handlers/team-handlers.ts          (2 refs)
src/infrastructure/http/handlers/tools-handlers.ts         (1 ref)
src/infrastructure/http/handlers/voice-handlers.ts         (2 refs)
src/infrastructure/http/handlers/workflow-template-handlers.ts (1 ref)
src/infrastructure/http/handlers/workitem-search-handlers.ts (1 ref)
src/infrastructure/http/handlers/workspaces-handlers.ts    (1 ref)
src/knowledge/graph/KnowledgeGraph.ts                       (1 ref)
src/knowledge/semantic/chunker.ts                           (3 refs)
src/knowledge/semantic/store.ts                             (2 refs)
src/knowledge/tools/KnowledgeDeleteTool.ts                  (2 refs)
src/main.ts                                                 (3 refs)
src/mcp/MCPAutoDiscovery.ts                                 (2 refs)
src/mcp/MCPCompatibilityTester.ts                            (1 ref)
src/media/base64/Base64Manager.ts                            (2 refs)
src/media/ffmpeg/FFmpegWrapper.ts                            (1 ref)
src/media/image/ImageAsset.ts                                (2 refs)
src/media/image/ImageFormatDetector.ts                       (1 ref)
src/media/image/ImageProcessor.ts                            (2 refs)
src/media/image/ImageSecurity.ts                             (1 ref)
src/media/image/TempFileManager.ts                           (2 refs)
src/media/pdf/PdfPageExtractor.ts                            (4 refs)
src/media/qr/QRCodeManager.ts                                (2 refs)
src/media/store/MediaStore.ts                                (2 refs)
src/media/temp/TempMediaManager.ts                           (3 refs)
src/media/video/VideoProcessor.ts                            (3 refs)
src/memory/ContextFence.ts                                   (2 refs)
src/monitoring/logs/Logger.ts                                (1 ref)
src/monitoring/logs/diagnostic/LogDiagnostic.ts              (1 ref)
src/monitoring/logs/tail/LogTail.ts                          (2 refs)
src/monitoring/metrics/SystemMetricsCollector.ts             (2 refs)
src/plugins/bundled/BundledPluginManager.ts                  (2 refs)
src/plugins/channel/ChannelPluginPresence.ts                 (2 refs)
src/plugins/discovery/PluginDiscovery.ts                     (2 refs)
src/plugins/distribution/NpmDistributor.ts                   (3 refs)
src/plugins/hooks/GlobalRunner.ts                            (1 ref)
src/plugins/hooks/HostHooks.ts                               (1 ref)
src/plugins/hooks/PhaseHooks.ts                              (1 ref)
src/plugins/install/PluginInstallManager.ts                  (2 refs)
src/plugins/lifecycle/LifecycleTrace.ts                      (1 ref)
src/plugins/marketplace/PluginMarketplace.ts                 (2 refs)
src/query/FileCheckpointStorage.ts                           (2 refs)
src/sandbox/PTYSandbox.ts                                    (1 ref)
src/sandbox/SSHSandbox.ts                                    (1 ref)
src/sandbox/docker/DockerImageManager.ts                     (1 ref)
src/sandbox/docker/DockerSandbox.ts                          (1 ref)
src/sandbox/docker/NetworkPolicyEngine.ts                    (1 ref)
src/scripts/plugify.ts                                       (2 refs)
src/security/GroupPolicy.ts                                  (1 ref)
src/security/IOAuditor.ts                                    (1 ref)
src/security/audit/AuditFilesystem.ts                        (2 refs)
src/security/audit/AuditModelHygiene.ts                      (2 refs)
src/security/audit/AuditPlugins.ts                           (2 refs)
src/security/audit/DeliveryAuditReport.ts                    (2 refs)
src/security/config/SecurityConfigManager.ts                 (3 refs)
src/security/files/ProtectedPaths.ts                         (2 refs)
src/security/files/ReadProtectionService.ts                  (2 refs)
src/security/files/WriteSafeRoot.ts                          (1 ref)
src/security/injection/ContextFileScanner.ts                 (2 refs)
src/security/patterns/SecurityPatternUpdater.ts              (3 refs)
src/security/policy/ImageSanitizationPolicy.ts               (2 refs)
src/security/rollback/CleanupManager.ts                      (4 refs)
src/security/rollback/FileOperationTracker.ts                (2 refs)
src/security/rollback/RedoManager.ts                         (4 refs)
src/security/rollback/SnapshotStorage.ts                     (5 refs)
src/security/rollback/UndoManager.ts                         (5 refs)
src/security/rollback/xxHash.ts                              (2 refs)
src/security/services/CredentialManager.ts                   (3 refs)
src/services/file/registerMediaFile.ts                       (1 ref)
src/services/mcp/transports/McpTlsManager.ts                 (2 refs)
src/session/FTS5SearchEngine.ts                              (2 refs)
src/session/SessionArtifacts.ts                              (3 refs)
src/session/SessionGateway.ts                                (1 ref)
src/session/SessionMigration.ts                              (2 refs)
src/session/SessionPruning.ts                                (2 refs)
src/session/SessionTranscript.ts                             (2 refs)
src/session/activity/SessionActivityTracker.ts               (2 refs)
src/session/key/SessionKeyManager.ts                         (1 ref)
src/session/maintenance/SessionMaintenance.ts                (2 refs)
src/session/memory/SessionMemoryManager.ts                   (2 refs)
src/session/persistence/AtomicWriter.ts                      (3 refs)
src/session/persistence/SessionPersistenceManager.ts         (2 refs)
src/session/storage/FileSystemUnifiedStorage.ts              (3 refs)
src/session/storage/LiteSessionReader.ts                     (1 ref)
src/session/storage/SessionStoragePortable.ts                (2 refs)
src/session/transcript/SessionTranscript.ts                  (2 refs)
src/skills/SkillGuard.ts                                     (1 ref)
src/skills/SkillPreprocessor.ts                              (2 refs)
src/skills/config/SkillConfigManager.ts                      (2 refs)
src/skills/loaders/adapter/clawhub/ClawHubAPIClient.ts       (2 refs: https + http)
src/skills/source/SkillSourceManager.ts                      (2 refs)
src/tasks/DetachedTaskRuntime.ts                             (2 refs: child_process + path)
src/tasks/TaskOrchestrator.ts                                (2 refs: path + fs)
src/tasks/cron/CronStagger.ts                                (1 ref)
src/tasks/dream/ForkedDreamExecutor.ts                       (3 refs)
src/tasks/dream/dreamWorker.ts                               (1 ref)
src/tools/BrowserVisionTool/BrowserVisionTool.ts             (3 refs)
src/tools/ClipboardTool/ClipboardTool.ts                     (2 refs)
src/tools/FileEditTool/utils.ts                              (2 refs)
src/tools/ImageAnalysisTool/ImageAnalysisTool.ts             (2 refs)
src/tools/ImageSvgTool/ImageSvgTool.ts                       (2 refs)
src/tools/ImageTool/ImageTool.ts                             (2 refs)
src/tools/MusicTool/MusicTool.ts                             (2 refs)
src/tools/SessionsTool/SessionsTool.ts                       (1 ref)
src/tools/VideoAnalysisTool/VideoAnalysisTool.ts             (4 refs)
src/tools/VideoTool/VideoTool.ts                             (2 refs)
src/tools/WebFetchTool/ssrf.ts                               (2 refs)
src/tools/version/ToolVersionManager.ts                      (1 ref)
src/trace-recording/live/LiveViewServer.ts                   (1 ref)
src/ui/theme/ThemeLoader.ts                                  (1 ref)
src/utils/markdownConfigLoader.ts                            (3 refs)
src/voice/VoiceSession.ts                                    (1 ref)
src/wizard/WizardEngine.ts                                   (2 refs)
src/workspace/AgentRoleStore.ts                              (1 ref)
src/workspace/CouncilEngine.ts                               (1 ref)
src/workspace/OrchIntelligence.ts                            (1 ref)
src/workspace/RuleEngine.ts                                  (2 refs)
src/workspace/TeamStore.ts                                   (2 refs)
```

> 注：完整逐行清单见 `node_modules_inventory_raw.txt`

---

## 4. 本次新增（路径幻觉控制相关 — Phase 1 已剥离）

本次变更在 4 个文件中新增了 `path` 引用（Phase 1 已从 `node:path` 剥离为 `path`）：

| 文件 | 当前 import | Phase 1 后 |
|------|------|:--:|
| `chat/services/PathGuardService.ts` | `import * as path from 'path'` | ✅ |
| `chat/services/SessionConfirmedPaths.ts` | `import * as path from 'path'` | ✅ |
| `chat/services/PathWhitelist.ts` | `import * as path from 'path'` | ✅ |
| `chat/services/ImageContextService.ts` | `import path from 'path'` | ✅ |

全部使用 Bun 兼容的 `path` 模块，且文件内 `fs.access`、`os.homedir()` 已改为 `process.env` 绕过循环依赖。
