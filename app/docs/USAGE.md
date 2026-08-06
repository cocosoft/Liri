# Liri 用户使用指南

## 概述

Liri 是一个基于 AI 的智能助手应用，提供交互式命令行界面，支持多种工具和技能来帮助完成各种任务。

## 快速开始

### 安装

```bash
# 进入项目目录
cd e:\PY\CODES\Liri\backend

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
  Liri - 交互式REPL模式
═══════════════════════════════════════════════════════════════

欢迎使用 Liri - AI Agent

ℹ 输入命令开始交互，输入 exit 退出

ℹ 系统信息:
ℹ   Node.js 版本: v24.3.0
ℹ   操作系统: win32 x64
```

## 命令系统

Liri 使用 `/` 开头的命令语法。输入 `/help` 可以查看所有可用命令。

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

Liri 提供多种内置工具：

### 文件工具
- `file_read` - 读取文件内容
- `file_write` - 写入文件内容
- `file_edit` - 编辑文件内容（SearchReplace 模式）
- `GlobTool` - 文件匹配
- `grep` - 文本搜索（正则表达式文件内容搜索）

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

---

`/grep` 命令用于在文件中搜索文本内容，对标 CC 源码 `cc_code/backend/tools/GrepTool/GrepTool.ts`：

```bash
# 基本搜索
/grep <pattern>

# 忽略大小写搜索
/grep -i <pattern>

# 搜索指定目录
/grep <pattern> <searchPath>

# 仅显示匹配的文件名（默认模式）
/grep --outputMode files_with_matches <pattern>

# 显示匹配的具体内容
/grep --outputMode content <pattern>

# 显示匹配次数统计
/grep --outputMode count <pattern>

# 带上下文行显示
/grep -C 3 <pattern>

# 文件类型过滤
/grep --type ts <pattern>

# 文件通配符过滤
/grep --include "*.ts" <pattern>

# 分页遍历大量结果
/grep --headLimit 50 --offset 0 <pattern>
/grep --headLimit 50 --offset 50 <pattern>
```

**选项说明：**

| 选项 | 短标志 | 说明 |
|------|--------|------|
| `--help` | `-h` | 显示帮助信息 |
| `--caseInsensitive` | `-i` | 忽略大小写搜索 |
| `--showLineNumbers` | `-n` | 显示行号（默认启用） |
| `--multiline` | | 启用多行匹配模式 |
| `--outputMode <mode>` | | 输出模式: `content` / `files_with_matches`(默认) / `count` |
| `--searchPath <path>` | | 搜索目录路径（默认当前目录） |
| `--include <pattern>` | | 文件通配符过滤（如 `*.ts`, `*.{ts,tsx}`） |
| `--type <filetype>` | | 文件类型过滤（如 `ts`, `js`, `rs`, `py`） |
| `--headLimit <num>` | | 最大返回结果数（默认 250，0=无限制） |
| `--offset <num>` | | 结果偏移量，用于分页 |
| `--context <num>` | `-C` | 匹配前后各显示的行数 |
| `--contextBefore <num>` | `-B` | 匹配前显示的行数 |
| `--contextAfter <num>` | `-A` | 匹配后显示的行数 |

**输出模式：**
| 模式 | 说明 |
|------|------|
| `content` | 显示匹配的具体内容行（含文件名和行号） |
| `files_with_matches` | 仅显示包含匹配的文件名（默认） |
| `count` | 显示每个文件的匹配次数统计 |

**与 ripgrep 对标：**
| Liri 选项 | ripgrep 对应 | 说明 |
|-------------|--------------|------|
| `-i` | `rg -i` | 忽略大小写 |
| `-n` | `rg -n` | 显示行号 |
| `-C <num>` | `rg -C <num>` | 上下文行 |
| `-B <num>` | `rg -B <num>` | 前文行 |
| `-A <num>` | `rg -A <num>` | 后文行 |
| `--type ts` | `rg --type ts` | 文件类型 |
| `--multiline` | `rg -U` | 多行匹配 |

**别名：** `/search`, `/regex`

---

### 系统工具

```bash
# 执行 shell 命令
/bash <command>
```

`/bash` 命令用于执行 shell 命令，对标 CC 源码 `cc_code/backend/tools/BashTool/bashSecurity.ts` 和 `bashPermissions.ts` 的安全体系：

```bash
# 带超时执行
/bash --timeout 10000 npm install

# 指定工作目录
/bash --cwd /home/project git status

# 设置环境变量
/bash --env NODE_ENV=production npm run build

# 多环境变量
/bash --env VAR1=val1 --env VAR2=val2 echo $VAR1

# 组合使用
/bash --timeout 30000 --cwd /app --env DEBUG=true node server.js

# 查看帮助
/bash --help
```

**选项说明：**
| 选项 | 说明 |
|------|------|
| `-h, --help` | 显示帮助信息 |
| `--timeout <ms>` | 执行超时时间（默认 60000ms，最大 300000ms） |
| `--cwd <path>` | 指定工作目录（默认当前目录） |
| `--env <key=value>` | 设置环境变量（可重复使用） |
| `--skip-security-check` | 跳过安全检查（危险，不推荐） |

**安全特性：**
`/bash` 命令集成了多层安全检查体系，参考自 CC 源码的 BashTool 安全实现：

| 检查层 | 说明 | CC 参考实现 |
|--------|------|-------------|
| 危险命令检测 | 拦截 `rm -rf /`、`sudo`、系统管理命令等 | `bashSecurity.ts` - 20+ 验证器 |
| 危险模式检测 | 检测命令替换、eval 调用、注入攻击等 | `bashPermissions.ts` - 权限规则 |
| AST 级安全分析 | 解析命令结构检测深层风险 | `bashCommandHelpers.ts` - 管道分段检查 |
| 敏感路径保护 | 禁止操作系统关键目录 | `bashPermissions.ts` - `BARE_SHELL_PREFIXES` |
| 命令分类检查 | 按命令类别分级管控 | `bashClassifier.ts` - 分类器 |

被安全系统拦截的命令会返回详细的拦截原因和安全检查报告。

**输出格式：**
- 成功时显示 stdout 输出
- stderr 输出带 `[stderr]` 前缀
- 命令失败时显示退出码 `[exit code: N]`
- 显示执行耗时

**别名：** `/sh`, `/shell`

---

- `SleepTool` - 延迟执行
- `MonitorTool` - 系统监控

### AI 工具
- `Agent` - 创建子代理
- `Skill` - 执行技能

### 网络工具

`/fetch` 命令用于获取指定 URL 的网页内容或调用 HTTP API，对标 CC 源码 `cc_code/tools/WebFetchTool.ts`。

```bash
# 获取网页内容
/fetch https://example.com

# HTML→Markdown 转换（对标 CC htmlToMarkdown）
/fetch https://example.com --md

# 提示词提取（对标 CC applyPrompt）
/fetch https://example.com --prompt "Extract the main content"

# 获取 API 数据（JSON 自动格式化）
/fetch https://api.github.com/repos/vercel/next.js

# POST 请求
/fetch https://httpbin.org/post -X POST -d '{"key":"value"}'

# 自定义请求头
/fetch https://api.example.com/data -H "Authorization: Bearer token123"

# 查看完整内容（不截断）
/fetch https://example.com --raw

# 自定义超时
/fetch https://slow-api.example.com --timeout 60000
```

#### 参数说明

| 参数 | 说明 |
|------|------|
| `<url>` | 目标 URL（必填） |
| `-X, --method <method>` | HTTP 方法（GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS，默认 GET） |
| `-H, --header <"Key: Value">` | 请求头，可重复使用 |
| `-d, --data <body>` | 请求体（自动切换为 POST） |
| `--timeout <ms>` | 超时时间，默认 30000ms，最大 120000ms |
| `--raw` | 显示完整内容，不截断（默认截断至 2000 字符） |
| `--max-length <n>` | 自定义截断长度（字符数） |
| `--md, --markdown` | HTML→Markdown 转换（对标 CC htmlToMarkdown） |
| `--prompt, --extract <p>` | 提示词提取（对标 CC applyPrompt，默认 "Extract the main content"） |

#### 输出格式

成功时显示：
```
URL: https://example.com
Duration: 1.2s
Status: 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 45231 chars
Processing: HTML→Markdown converted
────────────────────────────────────────────────────────────
... Markdown 格式内容 ...
[Content truncated. Original length: 15231 chars. Use --raw to see full content.]
```

#### 别名

`/web_fetch`

---

### `/websearch`

```bash
# 执行网络搜索
/websearch <query> [-n count] [-l lang] [--allow domain] [--block domain]
```

`/websearch` 命令用于执行网络搜索，通过 Bing 搜索引擎获取互联网信息。

#### 特性
- **结果元数据** — 显示搜索耗时、结果总数、域名过滤信息
- **域名过滤** — 对标 CC 的 `allowed_domains`/`blocked_domains` 设计，支持指定/排除域名
- **参数控制** — 支持指定结果数、语言、安全搜索开关、超时时间

#### 参数

| 参数 | 说明 |
|------|------|
| `-n, --count <count>` | 返回结果数（1-100，默认 10） |
| `-l, --lang <lang>` | 搜索语言代码（如 `zh-CN`、`en-US`，默认 `zh-CN`） |
| `--no-safe` | 关闭安全搜索（默认启用） |
| `--timeout <ms>` | 超时时间（默认 30000，最大 120000） |
| `--allow, --allow-domain <domain>` | 仅搜索指定域名（可重复使用） |
| `--block, --block-domain <domain>` | 排除指定域名（可重复使用） |

#### 示例

```bash
# 基本搜索
/websearch Python 异步编程

# 限制返回结果数
/websearch "React server components" -n 5

# 指定语言
/websearch 最新 AI 新闻 -l zh-CN

# 仅搜索指定域名
/websearch TypeScript 教程 --allow github.io --allow typescriptlang.org

# 排除指定域名
/websearch "Node.js performance" --block medium.com --block dev.to

# 关闭安全搜索
/websearch "advanced hacking techniques" --no-safe

# 设置超时
/websearch "large dataset" --timeout 60000
```

#### 输出格式

```
Search results for "Python 异步编程"
Found: 10 results
Duration: 1.35s
──────────────────────────────────────────────────────────────
1. Python 异步编程入门指南
   URL: https://example.com/python-async
   本文介绍 Python asyncio 库的基本用法和高级特性...

2. ...
```

#### 别名

`/web_search`

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

Agent 系统分为三个独立命令，职责分明：

| 命令 | 职责 | 使用场景 |
|------|------|----------|
| `/subagent-run` | 子代理任务执行器 | 运行/查看/停止子代理的执行任务 |
| `/subagent` | 子代理配置管理器 | 查看/创建/删除子代理定义（.md 配置文件） |
| `/agent-instance` | Agent 实例管理器 | 创建/删除命名的 Agent 实例配置，查看活跃子代理 |

### 子代理任务执行

```bash
# 运行一个新 Agent 任务
/subagent-run run general "编写一个 Python 脚本"

# 使用特定类型的 Agent
/subagent-run run explore "分析项目结构"
/subagent-run run plan "制定功能实现计划"
/subagent-run run verification "验证代码质量"

# 在后台运行 Agent 任务（不阻塞终端）
/subagent-run run general "长时间任务" --background

# 指定模型运行
/subagent-run run plan "制定重构计划" --model your-model-id

# 以 JSON 格式列出所有 Agent
/subagent-run list --json
```

支持的 Agent 类型：`general`, `explore`, `plan`, `verification`, `code-guide`, `statusline-setup`

#### 参数说明

| 参数 | 适用子命令 | 说明 |
|------|------------|------|
| `--background` / `--bg` | `run` | 在后台运行任务，立即返回控制权 |
| `--model <model>` | `run` | 指定模型 ID（填写已注册的模型 ID），覆盖 Agent 定义的默认模型 |
| `--json` | `list`, `bg-list` | 以 JSON 格式输出，便于程序化处理 |

### Agent 实例管理

```bash
# 列出所有已注册实例和活跃子代理
/agent-instance list

# 以 JSON 格式输出
/agent-instance list --json

# 创建命名 Agent 实例
/agent-instance create my-code-reviewer

# 创建指定类型的 Agent 实例
/agent-instance create my-explorer --type explore

# 删除 Agent 实例（或停止活跃子代理）
/agent-instance delete my-code-reviewer

# 显示帮助
/agent-instance help
/agent-instance -h
```

#### 参数说明

| 参数 | 适用子命令 | 说明 |
|------|------------|------|
| `--type <type>` | `create` | 指定 Agent 类型（默认: general） |
| `--json` | `list` | 以 JSON 格式输出已注册实例和活跃子代理 |

可用类型：`general`, `explore`, `plan`, `verification`, `code-guide`, `statusline-setup`

别名: `/agents_tool`

### 子代理状态管理

```bash
# 列出所有活跃的子代理、引擎任务和后台任务
/subagent-run list

# 以 JSON 格式查看（便于程序化处理）
/subagent-run list --json

# 查看特定 Agent 或后台任务的状态
/subagent-run status <agent_id>

# 停止运行中的 Agent
/subagent-run stop <agent_id>

# 列出所有后台任务（含统计信息）
/subagent-run bg-list

# 以 JSON 格式查看后台任务
/subagent-run bg-list --json

# 显示帮助
/subagent-run help
/subagent-run -h
```

别名: `/agent_tool`

### Agent 定义管理

> 以下命令属于 `/subagent` 配置管理器，并非 `/subagent-run`。

```bash
# 列出所有已定义的 Agent（按来源分组显示）
/subagent list

# 查看 Agent 详情
/subagent info <名称>

# 创建新 Agent（支持 --tools 指定可用工具）
/subagent create <名称> <描述>

# 创建带工具限制的 Agent
/subagent create code-reviewer "代码审查助手" --tools "file_read,grep"

# 删除自定义 Agent
/subagent delete <名称>
```

### Agent 来源说明

Agent 按来源分组，高优先级覆盖低优先级同名 Agent：

| 来源 | 优先级 | 说明 |
|------|--------|------|
| 用户设置 | 高 | `~/.pyapp/agents/` 目录下的配置文件 |
| 项目设置 | 中 | 项目 `.pyapp/agents/` 目录下的配置文件 |
| 内置 | 低 | 应用内置的通用 Agent（general-purpose, explore, plan, verification 等） |

### 自定义 Agent 文件格式

通过 `/subagent create` 创建 Agent 后，编辑生成的 Markdown 文件可配置完整属性：

```yaml
---
name: my-agent
description: 我的自定义助手
tools: file_read, file_write, grep
model: your-model-id
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
- **可中断**：支持通过 `/subagent-run stop` 中止运行中的 Agent
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
**适用版本**: Liri v1.0+