# 新手引导

本文档帮助新用户了解 Liri 的核心概念和使用流程。如果您是第一次使用，请按顺序阅读。

---

## 什么是 Liri？

Liri 是一个 **AI 智能助手**，运行在命令行终端中。您可以像聊天一样向它提问，它能够：

- 回答技术问题、解释代码
- 读取、写入、搜索文件
- 执行 Shell 命令
- 搜索网络信息、抓取网页
- 管理任务和待办事项
- 编写和调试代码

---

## 核心概念

### Agent（代理）

Agent 是 Liri 的核心 AI 实体，负责理解用户意图、调用工具、生成回复。每个会话由一个 Agent 实例管理。

### Tool（工具）

工具是 Agent 可以调用的能力单元，包括文件操作、网络搜索、代码执行等。Agent 根据用户请求自动选择合适的工具。

### Skill（技能）

技能是预定义的工作流程模板，将多个工具调用组合成完整的工作流。例如"调试分析"技能会自动收集日志、分析错误、给出建议。

### Session（会话）

会话代表一次连续的交互过程，包含历史消息、上下文状态和配置信息。

---

## 首次使用流程

### 第一步：启动

```bash
cd backend
bun run dev
```

启动后您将看到：

```
═══════════════════════════════════════════════════════════════
  Liri - 交互式REPL模式
═══════════════════════════════════════════════════════════════

欢迎使用 Liri - AI Agent

ℹ 输入命令开始交互，输入 exit 退出
```

### 第二步：探索

输入 `/help` 查看所有可用命令。输入 `/skill list` 查看可用的技能。

### 第三步：提问

直接用自然语言提问，Agent 会自动处理：

```
# 让 AI 读取文件
请读取 src/main.ts 的内容

# 让 AI 搜索代码
请在所有 TypeScript 文件中搜索 "launch" 关键字

# 让 AI 搜索网络
帮我搜索最新的 TypeScript 新闻

# 让 AI 执行命令
请查看当前目录下有哪些文件
```

### 第四步：使用技能

```bash
/skill debug "Error: Connection refused"
/skill review src/index.ts
```

---

## 常用功能速览

### 📁 文件操作

```bash
# 让 AI 读取文件
请读取 config.json

# 让 AI 编辑文件
请把 README.md 中的 "old" 替换为 "new"
```

也可以直接使用命令：

```bash
# 搜索文件内容（类似 grep）
/grep "function" --type ts

# 编辑文件（替换文本）
/edit README.md 旧文本 新文本
```

### 🌐 网络功能

```bash
# 搜索网络
/websearch Python 异步编程教程

# 获取网页内容
/fetch https://example.com
```

### 📋 任务管理

```bash
# 查看任务列表
/task list

# 创建任务
/task create "完成文档" "编写用户指南"

# 更新任务状态
/task update <task_id> completed
```

### ⚡ 执行命令

```bash
# 执行 Shell 命令
/bash ls -la

# 指定超时和工作目录
/bash --timeout 10000 --cwd /project git status
```

### 🤖 子代理（后台任务）

```bash
# 在后台运行一个分析任务（不阻塞当前会话）
/subagent-run run explore "分析项目结构" --background

# 查看后台任务
/subagent-run list

# 停止任务
/subagent-run stop <agent_id>
```

---

## 运行模式

Liri 支持多种启动方式：

| 命令 | 模式 | 适用场景 |
|------|------|----------|
| `bun run dev` | 开发模式（热重载） | 开发调试 |
| `bun run start` | 生产运行 | 正式使用 |
| `bun run memory` | 内存管理 CLI | 管理技能和工具 |
| `bun run src/index.ts` | 直接运行 | 快速启动 |

---

## 最佳实践

- 使用 `/task` 管理长时间运行的任务
- 使用 `/config` 调整应用设置
- 定期查看日志了解系统状态
- 利用技能系统提高工作效率
