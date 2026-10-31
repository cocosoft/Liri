<!-- 由 `bun run gen:support-levels` 生成，请勿手改；校验见 `bun run lint:support-levels` -->
# 支持等级台账（SUPPORT LEVELS）

> 目的：把「哪些通道 / 工具在被持续验证」摊开，避免上游 API 变更后长期无人发现。
> 更新：`cd app && bun run gen:support-levels` ｜ 校验：`bun run lint:support-levels`（CI + pre-commit 门禁）。

## 口径（可核对，不替代产品判断）

| 等级 | 判据 |
|---|---|
| `core` | 有**专属信号**（见下方两种），见「专属测试证据」列 |
| `community` | 随包分发，但无专属信号 ⇒ 回归覆盖不足，优先补测试 |
| `experimental` | 维护者在 `.trae/architecture/support-levels.json` 显式标注 |

- 专属信号只有两种，**普通字符串提及不再计入**（2026-10-31 收紧）：
  ① 测试**文件名归一化后以该标识开头**（如 `bashPermissionInjection` ⇒ `bash`、
     `powerShellTrustLevel` ⇒ `powershell`、`notebook.test.ts` ⇒ `notebook`）；
  ② 测试**直接 import 其实现类**（如 `import { FileEditTool }` ⇒ `file_edit`）。
- 附加约束：通道证据须位于 `app/tests/channels/**`；单文件涉及 >5 个标识视为「列举型」测试，其 import 不作证据。
- 收紧原因（实证）：旧判据「任意测试里出现过带引号的标识」把埋点字符串（`analyticsIdentityBuckets` 的 `file_write`）、
  模型类型（`deriveModelType` 的 `image`）、XML 解析样本（`InvokeXmlParser` 的 `bash`）都算成「专属测试」，
  令 `core` 被稀释 —— 证据列看起来权威，实际只是"某处提到过"。
- 维护者可用 overrides 覆盖等级（如把有集成测试但文件名不指代的通道标为 `core`，或把新通道标 `experimental`）。

## 汇总

| 面 | 总数 | core | community |
|---|---:|---:|---:|
| 消息通道 | 27 | 16 | 11 |
| 内建工具 | 69 | 41 | 28 |

## 消息通道

| 标识 | 支持等级 | 专属测试证据 |
|---|---|---|
| `mobile` | core | `app/tests/channels/mobileAudit.test.ts`（测试文件名） |
| `telegram` | community | —（无专属测试） |
| `discord` | community | —（无专属测试） |
| `qq` | core | `app/tests/channels/qqFileTransferPayload.test.ts`（测试文件名） |
| `dingtalk` | core | `app/tests/channels/dingtalkRobotMessage.test.ts`（测试文件名） |
| `feishu` | core | `app/tests/channels/feishuCardAction.test.ts`（测试文件名） |
| `wechat` | core | `app/tests/channels/wechatConfig.test.ts`（测试文件名） |
| `slack` | community | —（无专属测试） |
| `line` | community | —（无专属测试） |
| `irc` | community | —（无专属测试） |
| `nostr` | community | —（无专属测试） |
| `email` | community | —（无专属测试） |
| `sms` | community | —（无专属测试） |
| `webhook` | core | `app/tests/channels/WebhookVerify.test.ts`（测试文件名） |
| `wecom` | community | —（无专属测试） |
| `googlechat` | community | —（无专属测试） |
| `msteams` | core | `app/tests/channels/msteamsConfig.test.ts`（测试文件名） |
| `zalo` | core | `app/tests/channels/zaloConfig.test.ts`（测试文件名） |
| `yuanbao` | core | `app/tests/channels/yuanbaoConfig.test.ts`（测试文件名） |
| `whatsapp` | core | `app/tests/channels/whatsappConfig.test.ts`（测试文件名） |
| `signal` | community | —（无专属测试） |
| `matrix` | core | `app/tests/channels/matrixConfig.test.ts`（测试文件名） |
| `facebook` | core | `app/tests/channels/facebookmessengerConfig.test.ts`（测试文件名） |
| `twitter` | core | `app/tests/channels/twitterConfig.test.ts`（测试文件名） |
| `claude` | core | `app/tests/channels/claudeConfig.test.ts`（测试文件名） |
| `mattermost` | core | `app/tests/channels/mattermostConfig.test.ts`（测试文件名） |
| `bluebubbles` | core | `app/tests/channels/bluebubblesConfig.test.ts`（测试文件名） |

## 内建工具

| 标识 | 支持等级 | 专属测试证据 |
|---|---|---|
| `agent` | core | `app/tests/agent/agentAssignment.test.ts`（测试文件名） |
| `agents_list` | core | `app/tests/tools/agentsListTool.test.ts`（测试文件名） |
| `ask_user_question` | core | `app/tests/tools/ask-user-question.test.ts`（测试文件名） |
| `audio_play` | community | —（无专属测试） |
| `bash` | core | `app/tests/permission/bashPermissionInjection.test.ts`（测试文件名） |
| `brief` | core | `app/tests/commands/briefCommand.test.ts`（测试文件名） |
| `broadcast` | community | —（无专属测试） |
| `browser` | community | —（无专属测试） |
| `browser_vision` | community | —（无专属测试） |
| `canvas` | community | —（无专属测试） |
| `channel` | core | `app/tests/channels/channelBudgetNotice.test.ts`（测试文件名） |
| `clipboard` | community | —（无专属测试） |
| `code_run` | core | `app/tests/tools/codeRunnerLandlockConfig.test.ts`（测试文件名） |
| `computer_use` | community | —（无专属测试） |
| `config` | core | `app/tests/config/ConfigLayers.test.ts`（测试文件名） |
| `create_project` | core | `app/tests/tools/createProjectIdentity.test.ts`（测试文件名） |
| `cron` | core | `app/tests/chronos/cron.test.ts`（测试文件名） |
| `doc_generate` | community | —（无专属测试） |
| `file_convert` | core | `app/tests/tools/FileConvertTool.test.ts`（测试文件名） |
| `file_edit` | community | —（无专属测试） |
| `file_read` | core | `app/tests/tools/FileReadTool.test.ts`（测试文件名） |
| `file_write` | core | `app/tests/tools/fileWriteToolPath.test.ts`（测试文件名） |
| `glob` | core | `app/tests/tools/GlobTool/globAsync.test.ts`（测试文件名） |
| `grep` | core | `app/tests/tools/grepSearchCacheInvalidation.test.ts`（测试文件名） |
| `image` | core | `app/tests/tools/imageSafetyFilter.test.ts`（测试文件名） |
| `image_analysis` | community | —（无专属测试） |
| `image_display` | community | —（无专属测试） |
| `image_generate` | community | —（无专属测试） |
| `image_svg_generate` | community | —（无专属测试） |
| `kanban` | core | `app/tests/tools/kanbanTool.test.ts`（测试文件名） |
| `knowledge_save` | core | `app/tests/tools/knowledgeSaveTool.test.ts`（测试文件名） |
| `list_peers` | community | —（无专属测试） |
| `lsp` | core | `app/tests/tools/lspRequestTimeout.test.ts`（测试文件名） |
| `mcp_auth` | core | `app/tests/tools/mcpAuthTool.test.ts`（测试文件名） |
| `mcp_resource` | core | `app/tests/vfs/mcpResourcesDriver.test.ts`（测试文件名） |
| `mcp_tool` | core | `app/tests/mcp/mcpToolRegistrationPath.test.ts`（测试文件名） |
| `monitor` | community | —（无专属测试） |
| `music` | community | —（无专属测试） |
| `notebook` | core | `app/tests/tools/notebook.test.ts`（测试文件名） |
| `pdf` | core | `app/tests/tools/PDFTool.test.ts`（测试文件名） |
| `plan` | core | `app/tests/core/planDrivenLoop.test.ts`（测试文件名） |
| `powershell` | core | `app/tests/tools/powerShellTrustLevel.test.ts`（测试文件名） |
| `read_project_file` | core | `app/tests/tools/readProjectFile-failure.test.ts`（测试文件名） |
| `repl` | core | `app/tests/chat/replyEffort.test.ts`（测试文件名） |
| `save_conversation` | community | —（无专属测试） |
| `send_message` | community | —（无专属测试） |
| `sessions` | core | `app/tests/ai/sessionStickyRouting.test.ts`（测试文件名） |
| `sessions_yield` | core | `app/tests/tools/sessionsYield.test.ts`（测试文件名） |
| `skill` | core | `app/tests/memory/utils/SkillMemoryGraph.test.ts`（测试文件名） |
| `sleep` | core | `app/tests/chat/orchestrator/abortTurnEndBackfill.test.ts`（实现类导入） |
| `task_list` | community | —（无专属测试） |
| `task_output` | community | —（无专属测试） |
| `task_stop` | community | —（无专属测试） |
| `team_create` | community | —（无专属测试） |
| `team_delete` | community | —（无专属测试） |
| `todo_write` | core | `app/tests/tools/TodoWriteTool.normalize.test.ts`（测试文件名） |
| `tool_search` | core | `app/tests/tools/toolSearchCoverage.test.ts`（测试文件名） |
| `trace_recording` | core | `app/tests/integration/trace-recording.test.ts`（测试文件名） |
| `tts` | core | `app/tests/voice/ttsStreaming.test.ts`（测试文件名） |
| `tungsten` | community | —（无专属测试） |
| `vfs` | core | `app/tests/http/vfs-mounts.test.ts`（测试文件名） |
| `video` | core | `app/tests/http/videoMetadataDuration.test.ts`（测试文件名） |
| `video_analysis` | community | —（无专属测试） |
| `video_display` | community | —（无专属测试） |
| `video_generate` | core | `app/tests/tools/VideoGenerateTool.test.ts`（测试文件名） |
| `web_fetch` | core | `app/tests/tools/webFetchSsrf.test.ts`（测试文件名） |
| `web_search` | community | —（无专属测试） |
| `worktree` | community | —（无专属测试） |
| `write_project_file` | core | `app/tests/tools/writeProjectFile-failure.test.ts`（测试文件名） |
