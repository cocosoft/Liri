<!-- 由 `bun run gen:support-levels` 生成，请勿手改；校验见 `bun run lint:support-levels` -->
# 支持等级台账（SUPPORT LEVELS）

> 目的：把「哪些通道 / 工具在被持续验证」摊开，避免上游 API 变更后长期无人发现。
> 更新：`cd app && bun run gen:support-levels` ｜ 校验：`bun run lint:support-levels`（CI + pre-commit 门禁）。

## 口径（可核对，不替代产品判断）

| 等级 | 判据 |
|---|---|
| `core` | 在 `app/tests/**` 有**专属测试**引用该标识（见「专属测试证据」列） |
| `community` | 随包分发，但当前无专属测试引用 ⇒ 回归覆盖不足，优先补测试 |
| `experimental` | 维护者在 `.trae/architecture/support-levels.json` 显式标注 |

- 推导是**标识符级 grep**（启发式）：命中只说明"有测试提到它"，不等于覆盖充分；台账如实给出命中文件，供人工复核。
- 维护者可用 overrides 覆盖等级（如把无测试但实际稳定的通道标为 `core`，或把新通道标 `experimental`）。

## 汇总

| 面 | 总数 | core | community |
|---|---:|---:|---:|
| 消息通道 | 27 | 16 | 11 |
| 内建工具 | 69 | 49 | 20 |

## 消息通道

| 标识 | 支持等级 | 专属测试证据 |
|---|---|---|
| `mobile` | core | `app/tests/channels/mobileAudit.test.ts` |
| `telegram` | core | `app/tests/channels/channelCapabilityContract.test.ts` |
| `discord` | core | `app/tests/channels/channelConfigTenantScope.test.ts` |
| `qq` | core | `app/tests/channels/budgetInlineRelief.test.ts` |
| `dingtalk` | core | `app/tests/channels/channelSecretDisplay.test.ts` |
| `feishu` | core | `app/tests/channels/budgetInlineRelief.test.ts` |
| `wechat` | community | —（无专属测试） |
| `slack` | core | `app/tests/channels/budgetInlineRelief.test.ts` |
| `line` | core | `app/tests/channels/ChannelPrompt.test.ts` |
| `irc` | core | `app/tests/channels/ChannelPrompt.test.ts` |
| `nostr` | core | `app/tests/channels/channelCatalogEnablement.test.ts` |
| `email` | core | `app/tests/chat/DecisionGate.test.ts` |
| `sms` | core | `app/tests/channels/ChannelPrompt.test.ts` |
| `webhook` | core | `app/tests/channels/channelCapabilityContract.test.ts` |
| `wecom` | core | `app/tests/http/channelListReconciliation.test.ts` |
| `googlechat` | core | `app/tests/channels/ChannelContract.test.ts` |
| `msteams` | community | —（无专属测试） |
| `zalo` | community | —（无专属测试） |
| `yuanbao` | community | —（无专属测试） |
| `whatsapp` | community | —（无专属测试） |
| `signal` | core | `app/tests/tasks/swarm/AgentSwarm.test.ts` |
| `matrix` | community | —（无专属测试） |
| `facebook` | community | —（无专属测试） |
| `twitter` | community | —（无专属测试） |
| `claude` | community | —（无专属测试） |
| `mattermost` | community | —（无专属测试） |
| `bluebubbles` | community | —（无专属测试） |

## 内建工具

| 标识 | 支持等级 | 专属测试证据 |
|---|---|---|
| `agent` | core | `app/tests/agent/agentAssignment.test.ts` |
| `agents_list` | core | `app/tests/tools/agentsListTool.test.ts` |
| `ask_user_question` | core | `app/tests/chat/events-trailing-turn.test.ts` |
| `audio_play` | community | —（无专属测试） |
| `bash` | core | `app/tests/ai/parsers/InvokeXmlParser.test.ts` |
| `brief` | core | `app/tests/chat/sessionCacheOwnership.test.ts` |
| `broadcast` | core | `app/tests/entrypoints/spiWiringCoverage.test.ts` |
| `browser` | community | —（无专属测试） |
| `browser_vision` | community | —（无专属测试） |
| `canvas` | community | —（无专属测试） |
| `channel` | core | `app/tests/commands/commandGroups.test.ts` |
| `clipboard` | core | `app/tests/tools/toolCapability.test.ts` |
| `code_run` | core | `app/tests/chat/resumePendingSplit.test.ts` |
| `computer_use` | core | `app/tests/chat/orchestrator/sessionLookupInjection.test.ts` |
| `config` | core | `app/tests/ai/fastModeRouting.test.ts` |
| `create_project` | core | `app/tests/tools/createProjectIdentity.test.ts` |
| `cron` | core | `app/tests/chronos/cron.test.ts` |
| `doc_generate` | core | `app/tests/modules/doc/docPipelineTool.test.ts` |
| `file_convert` | core | `app/tests/chat/MessageContextPipeline.test.ts` |
| `file_edit` | core | `app/tests/chat/streamMessageLifecycleWriteHint.test.ts` |
| `file_read` | core | `app/tests/ai/transports/anthropicCacheBreakpoints.test.ts` |
| `file_write` | core | `app/tests/analytics/analyticsIdentityBuckets.test.ts` |
| `glob` | core | `app/tests/chat/events-trailing-turn.test.ts` |
| `grep` | core | `app/tests/ai/transports/messagesApiCacheOrchestration.test.ts` |
| `image` | core | `app/tests/ai/deriveModelType.test.ts` |
| `image_analysis` | core | `app/tests/chat/orchestrator/preparedReplayForce.test.ts` |
| `image_display` | community | —（无专属测试） |
| `image_generate` | core | `app/tests/modules/doc/docPipelineTool.test.ts` |
| `image_svg_generate` | community | —（无专属测试） |
| `kanban` | core | `app/tests/tools/kanbanTool.test.ts` |
| `knowledge_save` | community | —（无专属测试） |
| `list_peers` | community | —（无专属测试） |
| `lsp` | core | `app/tests/chat/orchestrator/preparedReplayForce.test.ts` |
| `mcp_auth` | core | `app/tests/tools/mcpAuthTool.test.ts` |
| `mcp_resource` | core | `app/tests/tools/MCPResourceTool/resourceViaDriver.test.ts` |
| `mcp_tool` | core | `app/tests/tools/guestReadOnlyPolicy.test.ts` |
| `monitor` | community | —（无专属测试） |
| `music` | community | —（无专属测试） |
| `notebook` | core | `app/tests/tools/notebook.test.ts` |
| `pdf` | core | `app/tests/modules/doc/docPipelineTool.test.ts` |
| `plan` | core | `app/tests/chat/DecisionGate.test.ts` |
| `powershell` | core | `app/tests/query/circuitBreakerMessage.test.ts` |
| `read_project_file` | core | `app/tests/chat/budgetSuspendStream.test.ts` |
| `repl` | core | `app/tests/cli/maintenanceCommand.test.ts` |
| `save_conversation` | community | —（无专属测试） |
| `send_message` | core | `app/tests/chat/DecisionGate.test.ts` |
| `sessions` | core | `app/tests/chat/toolCwdScope.test.ts` |
| `sessions_yield` | core | `app/tests/query/reactLoopYield.test.ts` |
| `skill` | core | `app/tests/tasks/evolution/AdaptationEvolutionService.test.ts` |
| `sleep` | core | `app/tests/sandbox/dockerSandboxExitCode.test.ts` |
| `task_list` | community | —（无专属测试） |
| `task_output` | community | —（无专属测试） |
| `task_stop` | core | `app/tests/tools/toolOutputSchema.test.ts` |
| `team_create` | core | `app/tests/tools/toolNames.generated.test.ts` |
| `team_delete` | core | `app/tests/tools/toolNames.generated.test.ts` |
| `todo_write` | core | `app/tests/chat/budgetSuspendStream.test.ts` |
| `tool_search` | core | `app/tests/query/ReActLoopLoopDetect.test.ts` |
| `trace_recording` | community | —（无专属测试） |
| `tts` | community | —（无专属测试） |
| `tungsten` | community | —（无专属测试） |
| `vfs` | core | `app/tests/gates/skipRegistry.test.ts` |
| `video` | core | `app/tests/ai/deriveModelType.test.ts` |
| `video_analysis` | community | —（无专属测试） |
| `video_display` | community | —（无专属测试） |
| `video_generate` | core | `app/tests/chat/orchestrator/toolProfileInjection.test.ts` |
| `web_fetch` | community | —（无专属测试） |
| `web_search` | core | `app/tests/analytics/analyticsForgetTenant.test.ts` |
| `worktree` | community | —（无专属测试） |
| `write_project_file` | core | `app/tests/chat/resumePendingSplit.test.ts` |
