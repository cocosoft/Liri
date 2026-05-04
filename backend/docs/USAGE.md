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

```bash
# 查看任务帮助
/task help

# 创建任务
/task create "任务标题" "任务描述"

# 列出所有任务
/task list

# 获取任务详情
/task get <task_id>

# 更新任务状态
/task update <task_id> <status>
```

### 待办事项

```bash
# 查看待办帮助
/todo help

# 添加待办
/todo add "完成项目文档"

# 查看待办列表
/todo list

# 标记完成
/todo done <index>

# 删除待办
/todo remove <index>
```

## 内置工具

PY_APP 提供多种内置工具：

### 文件工具
- `file_read` - 读取文件内容
- `file_write` - 写入文件内容
- `GlobTool` - 文件匹配
- `grep` - 文本搜索

### 系统工具
- `bash` - 执行 shell 命令
- `SleepTool` - 延迟执行
- `MonitorTool` - 系统监控

### AI 工具
- `Agent` - 创建子代理
- `Skill` - 执行技能

### 网络工具
- `web_fetch` - 获取网页内容
- `web_search` - 网络搜索

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