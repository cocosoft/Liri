# Liri — 编译运行说明

本文档随编译产物一并发布，供首次运行参考。

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10+ / macOS 12+ / Linux (x86_64) |
| 磁盘空间 | 不少于 200MB |
| 内存 | 不少于 2GB |

## 可选命令

以下命令不是运行必需，缺少时对应功能不可用：

| 命令 | 用途 | 安装方式 |
|------|------|----------|
| **PowerShell** | PowerShell 工具执行 | Windows 系统自带 |
| **Git** | Git 操作（提交、分支、日志等） | https://git-scm.com/downloads |
| **where** (Windows) / **which** (Unix) | 外部命令检测 | 系统自带 |

## 首次运行

直接双击 `Liri_coding.exe` 即可启动，默认进入交互模式（REPL）。

启动后系统会自动执行健康检查，并展示一份包含资源使用情况和可选依赖状态的控制台报告。

## 数据存储

用户数据存储在 `~/.pyapp/` 目录下：
- `~/.pyapp/SOUL.md` — AI 人格定义（首次启动自动创建）
- `~/.pyapp/USER.md` — 用户身份定义（首次启动自动创建）
- `~/.pyapp/memory/` — 用户个人记忆（跨项目共享）
- `~/.pyapp/skills/` — 用户自定义技能
- `~/.pyapp/settings.json` — 用户全局设置

## 编译构建

如需从源码重新编译，在 `app/` 目录执行：

```bash
bun run build:win:coding
```

编译产物输出到项目根目录下的 `dist/` 文件夹。

更多信息请参考项目源码中的 `app/docs/` 目录。
