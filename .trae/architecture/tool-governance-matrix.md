# 工具治理矩阵（自动生成）

> 由 `bun run gen:tool-governance` 生成，**请勿手改**。规范见 `.trae/specs/tool-security-governance-plan.md`。
> 实测工具 **69** 个 · pass 67 · accepted-gap 2 · gap 0

## shell（4）

| 工具 | effects | sandbox | risk（声明 / 派生 / 来源） | 只读 | 上限 | 指纹 | 自定义权限 | verdict |
|---|---|---|---|---|---|---|---|---|
| `bash` | external | execution | — / shell / derived:sandboxLevel | no | 100000 | — | — | pass |
| `code_run` | external | execution | — / shell / derived:sandboxLevel | no | — | — | — | accepted-gap（G9） |
| `powershell` | external | execution | — / shell / derived:sandboxLevel | no | — | — | — | accepted-gap（G9） |
| `repl` | local | execution | shell / shell / declared:static | no | 10000 | — | yes | pass |

## external（12）

| 工具 | effects | sandbox | risk（声明 / 派生 / 来源） | 只读 | 上限 | 指纹 | 自定义权限 | verdict |
|---|---|---|---|---|---|---|---|---|
| `agent` | external | none | external / external / declared:static | no | — | — | yes | pass |
| `ask_user_question` | external | none | — / external / derived:effects | yes | — | — | — | pass |
| `broadcast` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `browser` | external | none | — / external / derived:effects | no | 100000 | — | — | pass |
| `browser_vision` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `channel` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `computer_use` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `mcp_auth` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `mcp_tool` | external | none | external / external / declared:static | no | — | — | yes | pass |
| `send_message` | external | none | — / external / derived:effects | no | — | — | — | pass |
| `team_create` | external | none | — / external / derived:effects | no | 100000 | — | — | pass |
| `team_delete` | external | none | — / external / derived:effects | no | 100000 | — | — | pass |

## write（32）

| 工具 | effects | sandbox | risk（声明 / 派生 / 来源） | 只读 | 上限 | 指纹 | 自定义权限 | verdict |
|---|---|---|---|---|---|---|---|---|
| `brief` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `canvas` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `clipboard` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `config` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `create_project` | local | none | write / write / declared:static | no | — | — | yes | pass |
| `doc_generate` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `file_edit` | local | file-io | — / write / derived:effects | no | — | yes | — | pass |
| `file_write` | local | file-io | — / write / derived:effects | no | 10000 | yes | — | pass |
| `image` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `image_generate` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `image_svg_generate` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `kanban` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `knowledge_save` | local | none | write / write / declared:static | no | — | — | yes | pass |
| `lsp` | local | none | write / write / declared:static | no | 10000 | — | yes | pass |
| `monitor` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `music` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `notebook` | local | none | write / write / declared:static | no | 10000 | — | yes | pass |
| `plan` | local | none | — / write / derived:effects | no | 100000 | — | — | pass |
| `save_conversation` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `sessions` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `sessions_yield` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `skill` | local(op) | none | write / write / declared:dynamic | no | — | — | — | pass |
| `sleep` | none | none | write / write / declared:dynamic | no | — | — | — | pass |
| `task_stop` | local | none | — / write / derived:effects | no | 10000 | — | — | pass |
| `todo_write` | local | none | — / write / derived:effects | no | 10000 | — | — | pass |
| `tts` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `tungsten` | local | none | write / write / declared:static | no | — | — | yes | pass |
| `vfs` | local(op) | none | write / write / declared:dynamic | no | — | — | — | pass |
| `video` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `video_generate` | local | none | — / write / derived:effects | no | — | — | — | pass |
| `worktree` | local | none | write / write / declared:dynamic | no | — | — | — | pass |
| `write_project_file` | local | file-io | write / write / declared:static | no | — | — | yes | pass |

## read（21）

| 工具 | effects | sandbox | risk（声明 / 派生 / 来源） | 只读 | 上限 | 指纹 | 自定义权限 | verdict |
|---|---|---|---|---|---|---|---|---|
| `agents_list` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `audio_play` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `cron` | local(op) | none | read / read / declared:dynamic | yes | — | — | — | pass |
| `file_convert` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `file_read` | none | none | — / read / derived:effects | yes | Infinity | — | — | pass |
| `glob` | none | none | — / read / derived:effects | yes | — | — | yes | pass |
| `grep` | none | none | — / read / derived:effects | yes | — | — | yes | pass |
| `image_analysis` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `image_display` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `list_peers` | none | none | — / read / derived:effects | yes | 100000 | — | — | pass |
| `mcp_resource` | none | none | — / read / derived:effects | yes | 100000 | — | — | pass |
| `pdf` | local | none | read / read / declared:dynamic | yes | — | — | — | pass |
| `read_project_file` | none | none | read / read / declared:static | yes | — | — | yes | pass |
| `task_list` | local(op) | none | read / read / declared:dynamic | yes | — | — | — | pass |
| `task_output` | none | none | — / read / derived:effects | yes | 100000 | — | — | pass |
| `tool_search` | none | none | — / read / derived:effects | yes | 100000 | — | — | pass |
| `trace_recording` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `video_analysis` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `video_display` | none | none | — / read / derived:effects | yes | — | — | — | pass |
| `web_fetch` | none | none | — / read / derived:effects | yes | 500000 | — | — | pass |
| `web_search` | none | none | — / read / derived:effects | yes | 100000 | — | — | pass |

