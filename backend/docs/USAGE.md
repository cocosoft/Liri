# PY_APP 用户使用指南

## 概述

PY_APP 是一个基于 AI 的智能助手应用，提供交互式命令行界面，支持多种工具和技能来帮助完成各种任务。

## 快速开始

### 安装

```bash
# 进入项目目录
cd e:\PY\CODES\PY_APP\backend

# 安装依赖
bun install
```

### 启动应用

```bash
# 方式1：开发模式
bun run dev

# 方式2：生产构建运行
bun run start

# 方式3：直接运行
bun --bun run src/index.ts
```

启动后会进入交互式 REPL 模式：

```
═══════════════════════════════════════════════════════════════
  PY_APP - 交互式REPL模式
═══════════════════════════════════════════════════════════════

欢迎使用 PY_APP - AI Agent

ℹ 输入命令开始交互，输入 exit 退出

ℹ 系统信息:
ℹ   Node.js 版本: v24.3.0
ℹ   操作系统: win32 x64
```

## 命令系统

PY_APP 使用 `/` 开头的命令语法。输入 `/help` 可以查看所有可用命令。

### 核心命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/help` | 显示帮助信息 | `/help` |
| `/exit` | 退出应用 | `/exit` |
| `/clear` | 清空屏幕 | `/clear` |
| `/version` | 显示版本信息 | `/version` |

### 会话管理

```bash
# 查看会话列表
/session list

# 创建新会话
/session create "我的项目"

# 切换会话
/session switch session_123456

# 删除会话
/session delete session_123456

# 查看当前会话信息
/session current

# 重命名会话
/session rename session_123456 "新项目名称"
```

### 工具管理

```bash
# 查看所有工具
/tool list

# 启用工具
/tool enable <tool_name>

# 禁用工具
/tool disable <tool_name>
```

### 技能管理

```bash
# 查看所有技能
/skill list

# 启用技能
/skill enable <skill_name>

# 禁用技能
/skill disable <skill_name>
```

### 任务管理

`/task` 命令通过 `TaskTool` 系列管理任务，基于 CC 源码 `cc_code/backend/tools/TaskTool` 实现。

```bash
# 查看任务帮助
/task help

# 创建任务
/task create "任务标题" "任务描述"

# 列出所有任务
/task list

# 按状态筛选任务
/task list pending
/task list in_progress
/task list completed

# 获取任务详情
/task get <task_id>

# 更新任务状态（可选更新标题和描述）
/task update <task_id> <status>
/task update <task_id> completed
/task update <task_id> in_progress "新标题" "新描述"

# 删除任务
/task delete <task_id>
```

### 待办事项

`/todo` 命令通过 `TodoWriteTool` 管理待办事项，基于 CC 源码 `cc_code/backend/tools/TodoWriteTool` 实现。

```bash
# 查看待办帮助
/todo help

# 添加待办
/todo add "完成项目文档"

# 查看待办列表
/todo list

# 按状态筛选待办
/todo list pending
/todo list in_progress
/todo list completed

# 更新待办状态或内容
/todo update <todo_id> <status>
/todo update <todo_id> completed
/todo update <todo_id> in_progress "新内容"

# 删除待办
/todo delete <todo_id>

# 清除所有已完成事项
/todo clear-completed
```

### 后台任务管理

后台任务是由 Agent 工具（如 `/agent`、`/subagent`）创建的异步执行任务。`/tasks` 命令对标 CC 的 BackgroundTasksDialog，提供完善的任务生命周期管理。

```bash
# 列出所有后台任务（按状态分组显示）
/tasks

# 列出运行中的任务
/tasks running

# 列出等待中的任务
/tasks pending

# 列出已完成的任务
/tasks completed

# 列出失败的任务
/tasks failed

# 列出所有任务
/tasks all

# 查看任务详情
/tasks show <task-id>

# 停止后台任务
/tasks stop <task-id>

# 显示统计摘要
/tasks stats

# 查看命令帮助
/tasks help

# 清理已完成的任务
/tasks clear
```

**主要功能：**

- **分组显示** — 任务按状态分组（运行中 / 等待中 / 已完成 / 失败 / 已中断），每组显示数量
- **统计头部** — 显示各类别的汇总计数，类似 CC 的 "X active agents · Y active shells" 风格
- **筛选过滤** — 通过子命令筛选特定状态的任务：`running`、`pending`、`completed`、`failed`、`aborted`、`active`、`all`
- **详情查看** — `/tasks show <task-id>` 显示完整的任务详情，包括执行时长、Token 用量、进度消息、结果预览、错误信息，以及运行中任务的进度条
- **ANSI 彩色输出** — 运行中（青色）、已完成（绿色）、失败（红色）、已中断（黄色）、等待中（灰色）
- **统计摘要** — `/tasks stats` 显示完整的任务统计数据和当前活跃任务列表

## 内置工具

PY_APP 提供多种内置工具：

### 文件工具
- `file_read` - 读取文件内容
- `file_write` - 写入文件内容
- `file_edit` - 编辑文件内容（SearchReplace 模式）
- `GlobTool` - 文件匹配
- `grep` - 文本搜索

```bash
# 编辑文件（替换首个匹配项）
/edit <file_path> <old_string> <new_string>

# 替换文件中所有匹配项
/edit <file_path> <old_string> <new_string> -a

# 示例：替换文件中的文本
/edit test.txt Hello Hi

# 示例：全局替换（所有匹配项）
/edit src/config.json localhost 127.0.0.1 -a
```

`/edit` 命令基于 SearchReplace 模式，支持以下特性：

- **唯一性检查** — 默认要求 `old_string` 在文件中唯一出现，避免误替换
- **全局替换** — 使用 `-a` 或 `--all` 标志可替换所有匹配项
- **引号规范化** — 自动处理弯引号/智能引号（`'` `"`）与直引号的转换
- **文件大小限制** — 最大支持 1 GiB 的文件编辑
- **安全校验** — 当 `old_string` 与 `new_string` 完全相同时会拒绝执行

### 系统工具
- `bash` - 执行 shell 命令
- `SleepTool` - 延迟执行
- `MonitorTool` - 系统监控

### AI 工具
- `Agent` - 创建子代理
- `Skill` - 执行技能

### 网络工具

```bash
# 获取网页内容
/fetch <url>
```

`/fetch` 命令用于获取指定 URL 的网页内容，支持以下特性：
- **内容截断** — 自动将返回内容截断至 1000 字符，避免信息过载
- **错误处理** — 当无法访问目标 URL 时返回友好的错误提示

示例：
```bash
# 获取网页内容
/fetch https://example.com

# 获取 API 数据
/fetch https://api.example.com/data

```bash
# 执行网络搜索
/websearch <query>
```

`/websearch` 命令用于执行网络搜索，通过 Bing 搜索引擎获取互联网信息。支持以下特性：
- **结果格式化** — 自动以编号列表展示搜索结果（标题、链接、摘要）
- **搜索语言** — 默认使用英文搜索，可根据需要调整查询词的语言

示例：
```bash
# 搜索技术资料
/websearch "Python programming"

# 搜索最新资讯
/websearch "最新人工智能进展"
```

- `web_fetch` - 获取网页内容（内部工具接口）
- `web_search` - 网络搜索（内部工具接口）

### 开发工具

`/lsp` 命令用于执行语言服务器协议（LSP）操作，提供代码智能提示、定义跳转、引用查找、实现查找、符号搜索、调用层次分析等功能，对标 CC 源码 `cc_code/backend/tools/LSPTool/LSPTool.ts`：

```bash
# 查找定义
/lsp definition <file> <line> <col>

# 查找引用
/lsp references <file> <line> <col>

# 获取悬停信息
/lsp hover <file> <line> <col>

# 代码补全
/lsp completion <file> <line> <col>

# 查找实现
/lsp goToImplementation <file> <line> <col>

# 获取文档符号列表
/lsp documentSymbol <file>

# 搜索工作区符号
/lsp workspaceSymbol <query>

# 准备调用层次
/lsp prepareCallHierarchy <file> <line> <col>

# 查找传入调用
/lsp incomingCalls <file> <line> <col>

# 查找传出调用
/lsp outgoingCalls <file> <line> <col>

# 查看帮助（列出所有操作）
/lsp help
```

**注意：** `line` 和 `col` 使用从 1 开始的坐标（人类友好格式），内部会自动转换为 LSP 协议的 0 基坐标。

---

`/repl_tool` 命令用于在 REPL（交互式解释器）环境中执行代码，支持多种语言：

```bash
# 交互式执行 Python 代码
/repl_tool python "print('Hello, world!')"

# 执行 JavaScript 代码
/repl_tool javascript "console.log('Hello, world!')"

# 执行 TypeScript 代码
/repl_tool typescript "const x: number = 42;"

# 执行 Shell 命令
/repl_tool bash "ls -la"

# 执行 PowerShell 命令
/repl_tool powershell "Get-Process | Select-Object -First 5"

# 执行 Ruby 代码
/repl_tool ruby "puts 'Hello'"

# 查看帮助
/repl_tool help
```

**支持的语言：** Python、JavaScript、TypeScript、Bash、PowerShell、Ruby。

---

`/notebook` 命令用于编辑和运行 Jupyter 笔记本（`.ipynb` 文件），支持创建、打开、添加/编辑/删除单元格、运行、保存等操作，对标 CC 源码 `cc_code/backend/tools/NotebookEditTool/NotebookEditTool.ts`：

```bash
# 创建新笔记本
/notebook create "My Notebook"

# 打开现有笔记本
/notebook open notebook.ipynb

# 添加代码单元格
/notebook add code "print('Hello')"

# 添加 Markdown 单元格
/notebook add markdown "## Section Title"

# 替换指定单元格内容（cell_id 支持 cell-N 格式的 0 基索引）
/notebook replace notebook.ipynb cell-0 "print('Modified')"

# 在指定位置插入新单元格
/notebook insert notebook.ipynb cell-0 markdown "## New Section"

# 删除指定单元格
/notebook delete notebook.ipynb cell-2

# 运行笔记本
/notebook run notebook.ipynb

# 保存笔记本
/notebook save notebook.ipynb

# 查看帮助
/notebook help
```

**单元格编辑说明：**
- `replace` - 替换指定单元格的源代码（重置执行计数和输出）
- `insert` - 在指定单元格后插入新单元格（需要指定 `cell_type`: code/markdown）
- `delete` - 删除指定单元格
- `cell_id` 支持实际 UUID（如 `cell_xxx`）和 0 基索引格式（如 `cell-0`、`cell-2`）

### IDE 集成

```bash
# 查看所有已安装/可检测的IDE状态
/ide

# 在当前IDE中打开项目目录
/ide open
```

`/ide` 命令会检测系统上安装的 IDE，支持的 IDE 包括：VS Code、Cursor、Trae、Windsurf、Zed、IntelliJ IDEA、PyCharm、WebStorm。

检测方式（按优先级）：
1. **开始菜单扫描** — 扫描 Windows 开始菜单中的 IDE 快捷方式
2. **PATH 环境变量** — 检测 IDE 命令行工具是否在 PATH 中（如 `code` 命令）
3. **常见安装路径** — 检查 Windows 上 IDE 的默认安装路径

`/ide open` 会优先使用 VS Code 打开项目，若未安装则使用第一个检测到的 IDE。

### MCP 协议

#### `/mcp` — MCP 服务器管理（内置）

管理 MCP（Model Context Protocol）服务器，包括服务器列表查看、状态监控、资源配置和工具管理：

```bash
# 列出所有 MCP 服务器
/mcp --list

# 查看 MCP 系统状态
/mcp --status

# 管理 MCP 服务器（交互式菜单）
/mcp --manage

# 查看 MCP 资源
/mcp --resources

# 查看 MCP 工具
/mcp --tools

# 测试 MCP 连接
/mcp --test
```

别名: `mcp-server`, `model-context`

#### `/mcp run` — 执行 MCP 操作

通过 ToolManager 执行 MCP 操作，使用 `run` 子命令指定要执行的动作：

```bash
# 获取上下文
/mcp run get_context

# 设置上下文
/mcp run set_context "Hello, world!"
```

> `run` 是 `/mcp` 的子命令，将原 `/mcp_tool` 的功能合并到了统一的 MCP 管理入口中。

## 配置管理

```bash
# 查看配置
/config

# 设置配置项
/config set <key> <value>

# 获取配置项
/config get <key>

# 重置配置
/config reset
```

别名: `/settings`, `/preferences`, `/opts`

## 成本统计

```bash
# 查看 API 调用成本总览
/cost

# 查看各模型成本明细
/cost --breakdown

# 查看使用量统计
/cost --usage

# 查看时间维度统计
/cost --time
```

别名: `/costs`, `/usage-cost`

## Token 统计

```bash
# 查看 Token 使用统计
/tokens

# 查看各模型 Token 使用明细
/tokens --breakdown

# 重置会话级 Token 统计
/tokens --reset
```

别名: `/token-stats`

## 环境变量

```bash
# 查看应用环境配置
/env

# 查看全部环境变量（含系统变量）
/env --all
```

别名: `/environment`

## 调试命令

```bash
# 显示调试状态
/debug status

# 查看最近日志
/debug logs

# 开启调试模式
/debug enable

# 关闭调试模式
/debug disable

# 检查应用运行状态
/debug inspect

# 显示调试命令帮助
/debug help
```

别名: `/dev`, `/developer`

## Bridge 远程控制

```bash
# 查看 Bridge 连接状态
/bridge status

# 查看 Bridge 配置详情
/bridge config

# 启动 Bridge 服务
/bridge start

# 停止 Bridge 服务
/bridge stop

# 连接到远程控制
/bridge connect [session_id]

# 显示帮助
/bridge help
```

子命令别名：
- `status` 也可用 `st`
- `config` 也可用 `cfg`
- `start` 也可用 `on`
- `stop` 也可用 `off`、`disconnect`

别名: `/rc`, `/remote-control`

> 注意：Bridge 功能需启用 `BRIDGE_MODE` 功能开关方可使用。
> 通过设置环境变量 `FEATURE_BRIDGE_MODE=true` 或 `BRIDGE_MODE=true` 启用。

## Agent 管理

### 子代理任务执行

```bash
# 运行一个新 Agent 任务
/agent run general "编写一个 Python 脚本"

# 使用特定类型的 Agent
/agent run explore "分析项目结构"
/agent run plan "制定功能实现计划"
/agent run verification "验证代码质量"

# 在后台运行 Agent 任务（不阻塞终端）
/agent run general "长时间任务" --background
```

支持的 Agent 类型：`general`, `explore`, `plan`, `verification`, `claude-code-guide`, `statusline-setup`

### 子代理状态管理

```bash
# 列出所有活跃的子代理、引擎任务和后台任务
/agent list

# 查看特定 Agent 或后台任务的状态
/agent status <agent_id>

# 停止运行中的 Agent
/agent stop <agent_id>

# 列出所有后台任务（含统计信息）
/agent bg-list

# 显示帮助
/agent help
```

别名: `/agents`

### Agent 定义管理

```bash
# 列出所有已定义的 Agent（按来源分组显示）
/agent list

# 查看 Agent 详情
/agent info <名称>

# 创建新 Agent（支持 --tools 指定可用工具）
/agent create <名称> <描述>

# 创建带工具限制的 Agent
/agent create code-reviewer "代码审查助手" --tools "file_read,grep"

# 删除自定义 Agent
/agent delete <名称>
```

### Agent 来源说明

Agent 按来源分组，高优先级覆盖低优先级同名 Agent：

| 来源 | 优先级 | 说明 |
|------|--------|------|
| 用户设置 | 高 | `~/.claude/agents/` 目录下的配置文件 |
| 项目设置 | 中 | 项目 `.claude/agents/` 目录下的配置文件 |
| 内置 | 低 | 应用内置的通用 Agent（general-purpose, explore, plan, verification 等） |

### 自定义 Agent 文件格式

创建 Agent 后，编辑生成的 Markdown 文件可配置完整属性：

```yaml
---
name: my-agent
description: 我的自定义助手
tools: file_read, file_write, grep
model: sonnet
memory: project
color: blue
---
```

支持的前置元数据字段：`name`, `description`, `tools`, `disallowedTools`, `model`, `memory`, `color`, `background`, `effort`, `permissionMode`。

### 子代理架构说明

子代理（SubAgent）是基于 AgentTool 创建的子任务执行单元，支持：

- **完整查询循环**：多轮工具调用，直至任务完成或达到最大轮次
- **后台运行**：将长时间任务提交到 BackgroundTaskManager 异步执行
- **隐式 Fork**：当未指定 Agent 类型时，自动创建 Fork 子代理隔离执行
- **并发控制**：限制最大并发 Agent 数量，防止资源耗尽
- **可中断**：支持通过 `/agent stop` 中止运行中的 Agent
- **Token 统计**：记录每次执行的提示/补全 Token 用量

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + C` | 中断当前操作 |
| `Ctrl + D` | 退出应用 |
| `↑ / ↓` | 浏览命令历史 |
| `Tab` | 自动补全 |

## 退出应用

```bash
# 方法1：使用命令
/exit

# 方法2：快捷键
Ctrl + D

# 方法3：输入 exit
exit
```

## 常见问题

### Q: 如何创建新会话？
A: 使用 `/session create "会话名称"` 命令。

### Q: 如何查看可用工具？
A: 使用 `/tool list` 命令。

### Q: 命令执行失败怎么办？
A: 检查命令语法是否正确，使用 `/help` 查看命令用法。

### Q: 如何获取帮助？
A: 使用 `/help` 查看所有命令，使用 `/help <command>` 查看特定命令的帮助。

---

**文档版本**: v1.0  
**最后更新**: 2026-05-04  
**适用版本**: PY_APP v1.0+