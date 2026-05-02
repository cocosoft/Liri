# Commands 模块对标分析报告

**分析日期**: 2026-05-01（重新分析）
**模块范围**: commands
**对标状态**: 🟡 部分对标（架构超越，实现深度不足）

---

## 1. CC源码实现

### 1.1 命令注册机制

CC源码的命令系统入口在 [commands.ts](file:///e:/PY/CODES/PY_APP/cc_code/backend/commands.ts)，使用 `memoize()` 缓存命令列表：

```typescript
const COMMANDS = memoize((): Command[] => [
  addDir, advisor, agents, branch, btw, chrome, clear, color,
  compact, config, copy, desktop, context, contextNonInteractive,
  cost, diff, doctor, effort, exit, fast, files, heapDump,
  help, ide, init, keybindings, installGitHubApp, installSlackApp,
  mcp, memory, mobile, model, outputStyle, remoteEnv, plugin,
  pr_comments, releaseNotes, reloadPlugins, rename, resume,
  session, skills, stats, status, statusline, stickers, tag,
  theme, feedback, review, ultrareview, rewind, securityReview,
  terminalSetup, upgrade, extraUsage, rateLimitOptions, usage,
  usageReport, vim, thinkback, thinkbackPlay, permissions, plan,
  privacySettings, hooks, exportCommand, sandboxToggle, passes, tasks,
  ...conditionalCommands
])
```

### 1.2 命令类型系统

CC源码使用联合类型定义命令（[types/command.ts](file:///e:/PY/CODES/PY_APP/cc_code/backend/types/command.ts)）：

```typescript
type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
```

| 类型 | 说明 | 特点 |
|------|------|------|
| `prompt` | 提示词命令 | 返回ContentBlockParam，由模型处理 |
| `local` | 本地命令 | 返回text/compact/skip，纯逻辑处理 |
| `local-jsx` | 交互式命令 | 返回ReactNode，有UI组件 |

### 1.3 命令分类清单

CC源码共包含 **86个子目录命令 + 15个根级命令文件**，按功能分类如下：

#### 核心交互命令（10个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `help` | local-jsx | 帮助系统 |
| `status` | local-jsx | 状态查看 |
| `exit` | local-jsx | 退出 |
| `clear` | local | 清屏（含缓存/会话清理） |
| `compact` | local | 上下文压缩 |
| `resume` | local-jsx | 恢复会话 |
| `session` | local-jsx | 会话管理 |
| `rename` | local | 重命名会话 |
| `rewind` | local | 回退会话 |
| `init` | prompt | 项目初始化 |

#### 配置与设置命令（12个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `config` | local-jsx | 配置面板 |
| `model` | local-jsx | 模型选择 |
| `effort` | local-jsx | Effort设置 |
| `fast` | local-jsx | 快速模式 |
| `theme` | local-jsx | 主题设置 |
| `color` | local | 颜色设置 |
| `output-style` | local-jsx | 输出风格 |
| `keybindings` | local | 快捷键管理 |
| `vim` | local | Vim模式 |
| `permissions` | local-jsx | 权限管理 |
| `privacy-settings` | local-jsx | 隐私设置 |
| `rate-limit-options` | local-jsx | 速率限制选项 |

#### 用户与认证命令（5个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `login` | local-jsx | 登录 |
| `logout` | local-jsx | 登出 |
| `passes` | local-jsx | Pass管理 |
| `upgrade` | local-jsx | 升级 |
| `feedback` | local-jsx | 反馈 |

#### 开发工具命令（10个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `commit` | prompt | Git提交 |
| `commit-push-pr` | prompt | 提交推送PR |
| `review` / `ultrareview` | prompt/local-jsx | 代码审查 |
| `security-review` | prompt | 安全审查 |
| `diff` | local-jsx | 差异查看 |
| `doctor` | local-jsx | 诊断检查 |
| `files` | local | 文件管理 |
| `add-dir` | local-jsx | 添加工作目录 |
| `branch` | local | 分支管理 |
| `terminalSetup` | local-jsx | 终端设置 |

#### AI/Agent命令（4个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `advisor` | prompt | 顾问 |
| `agents` | local-jsx | Agent管理 |
| `skills` | local-jsx | 技能管理 |
| `tasks` | local-jsx | 任务管理 |

#### 集成命令（8个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `mcp` | local-jsx | MCP管理 |
| `ide` | local-jsx | IDE集成 |
| `chrome` | local-jsx | Chrome集成 |
| `desktop` | local-jsx | 桌面模式 |
| `mobile` | local-jsx | 移动端 |
| `install-github-app` | local-jsx | GitHub App安装 |
| `install-slack-app` | local | Slack App安装 |
| `plugin` | local-jsx | 插件管理 |

#### 数据与统计命令（6个）

| 命令 | 类型 | 功能 |
|------|------|------|
| `cost` | local | 成本查看 |
| `usage` | local-jsx | 使用统计 |
| `extra-usage` | local-jsx/local | 额外使用量 |
| `stats` | local-jsx | 统计信息 |
| `memory` | local-jsx | 记忆管理 |
| `context` | local-jsx/local | 上下文管理 |

#### 条件编译命令（15+个）

| 命令 | Feature Flag | 功能 |
|------|-------------|------|
| `bridge` | BRIDGE_MODE | Bridge模式 |
| `voice` | VOICE_MODE | 语音模式 |
| `buddy` | BUDDY | 伙伴模式 |
| `proactive` | PROACTIVE/KAIROS | 主动模式 |
| `brief` | KAIROS/KAIROS_BRIEF | 简报 |
| `assistant` | KAIROS | 助手 |
| `remoteControlServer` | DAEMON+BRIDGE_MODE | 远程控制 |
| `workflows` | WORKFLOW_SCRIPTS | 工作流 |
| `web` | CCR_REMOTE_SETUP | 远程设置 |
| `fork` | FORK_SUBAGENT | 子代理分叉 |
| `peers` | UDS_INBOX | 对等通信 |
| `ultraplan` | ULTRAPLAN | 超级计划 |
| `torch` | TORCH | Torch |
| `subscribe-pr` | KAIROS_GITHUB_WEBHOOKS | PR订阅 |
| `force-snip` | HISTORY_SNIP | 历史裁剪 |

#### 内部命令（Ant员工专用，15+个）

| 命令 | 功能 |
|------|------|
| `backfill-sessions` | 回填会话 |
| `break-cache` | 破坏缓存 |
| `bughunter` | Bug猎手 |
| `good-claude` | 评价 |
| `issue` | Issue管理 |
| `mock-limits` | 模拟限制 |
| `ant-trace` | Ant追踪 |
| `perf-issue` | 性能问题 |
| `reset-limits` | 重置限制 |
| `oauth-refresh` | OAuth刷新 |
| `debug-tool-call` | 调试工具调用 |
| `ctx_viz` | 上下文可视化 |
| `autofix-pr` | 自动修复PR |
| `share` | 分享 |
| `teleport` | 传送 |
| `summary` | 摘要 |

#### 其他命令

| 命令 | 功能 |
|------|------|
| `copy` | 复制 |
| `export` | 导出 |
| `hooks` | 钩子管理 |
| `heapdump` | 堆转储 |
| `reload-plugins` | 重载插件 |
| `release-notes` | 发布说明 |
| `sandbox-toggle` | 沙箱开关 |
| `stickers` | 贴纸 |
| `tag` | 标签 |
| `thinkback` / `thinkback-play` | 思考回放 |
| `remote-env` | 远程环境 |
| `pr_comments` | PR评论 |
| `onboarding` | 引导 |
| `env` | 环境变量 |
| `version` | 版本 |
| `statusline` | 状态栏 |
| `insights` | 洞察报告 |
| `install` | 安装 |
| `bridge-kick` | Bridge启动 |

### 1.4 CC源码命令系统关键特性

1. **可用性过滤** (`meetsAvailabilityRequirement`)：根据认证类型（claude-ai/console）过滤命令可见性
2. **动态命令源**：从技能目录、插件、工作流动态加载命令
3. **懒加载**：每个命令通过 `load()` 函数延迟加载实现
4. **条件编译**：使用 `feature()` 实现编译时命令排除
5. **内部命令隔离**：`INTERNAL_ONLY_COMMANDS` 分离内部和外部命令
6. **命令启用检查**：`isCommandEnabled()` 检查feature flag
7. **技能命令**：`getSkillDirCommands()` 从文件系统发现技能命令
8. **插件命令**：`getPluginCommands()` + `getPluginSkills()` 从插件加载
9. **工作流命令**：`getWorkflowCommands()` 从工作流脚本加载
10. **动态技能**：`getDynamicSkills()` 运行时发现新技能

---

## 2. PY_APP实现

### 2.1 架构概览

PY_APP的命令系统采用分层架构，比CC源码的结构化程度更高：

```
commands/
├── builtin/          # 内置命令实现（40+子目录）
├── registry/         # 命令注册表（基础 + 增强）
├── executor/         # 命令执行器
├── pipeline/         # 命令管道（6阶段）
├── loader/           # 命令加载器（4种源）
├── manager/          # 命令管理器
├── parser/           # 命令解析器（Commander.js）
├── history/          # 命令历史（3种实现）
├── interactive/      # 交互式执行器
├── format/           # 输出格式化
├── progress/         # 进度条
├── prompt/           # 命令提示
├── completion/       # 命令补全
├── cache/            # 命令缓存
├── constants/        # 命令常量
├── table/            # 表格格式化
├── tools/            # 工具命令（7个子目录）
│   ├── ai/           # agent, agents
│   ├── dev/          # lsp, notebook, repl
│   ├── file/         # edit, glob, write
│   ├── network/      # fetch, mcp, websearch
│   ├── remote/       # remote-session
│   ├── system/       # bash, grep
│   └── task/         # task, todo
└── 顶层命令/         # agents, branch, bridge, chrome等
```

### 2.2 命令类型系统

PY_APP定义了6种命令类型（[types/index.ts](file:///e:/PY/CODES/PY_APP/backend/src/commands/types/index.ts)）：

```typescript
type CommandType = 'prompt' | 'action' | 'tool' | 'chat' | 'local' | 'local-jsx';
```

| 类型 | 说明 | CC源码对应 |
|------|------|-----------|
| `prompt` | 提示词命令 | PromptCommand |
| `local` | 本地命令 | LocalCommand |
| `local-jsx` | 交互式命令 | LocalJSXCommand |
| `action` | 动作命令 | 无对应（新增） |
| `tool` | 工具命令 | 无对应（新增） |
| `chat` | 聊天命令 | 无对应（新增） |

### 2.3 核心架构组件

#### CommandRegistry（命令注册表）

基础注册表，提供命令的注册、查找、别名管理、搜索等功能。

#### EnhancedCommandRegistry（增强命令注册表）

PY_APP独有，提供：
- **命令分类**（13个类别：GENERAL/DEVELOPMENT/FILE_MANAGEMENT/SYSTEM/AI/CHAT/MEMORY/CONFIG/SECURITY/NETWORK/TOOLS/PLUGINS/UTILITY）
- **依赖管理**（CommandDependency + DependencyGraph）
- **权限控制**（CommandPermission）
- **标签系统**（tags）
- **分类树**（getCategoryTree）

#### CommandPipeline（命令管道）

PY_APP独有，6阶段管道：
1. `PRE_VALIDATE` - 预验证
2. `PRE_AUTHORIZE` - 预授权
3. `PRE_PROCESS` - 预处理
4. `EXECUTE` - 执行
5. `POST_PROCESS` - 后处理
6. `POST_LOG` - 后日志

#### CommandLoaderRegistry（命令加载器注册表）

4种命令加载器：
1. `BuiltinCommandLoader` - 内置命令（60+模块路径）
2. `SkillCommandLoader` - 技能命令
3. `PluginCommandLoader` - 插件命令
4. `MCPCommandLoader` - MCP命令

#### CommandManager（命令管理器）

统一管理命令生命周期，包含：
- 命令初始化和注册
- 命令执行（含可用性检查、启用检查）
- 命令实现缓存

#### CommandParser（命令解析器）

使用Commander.js实现，支持：
- 命令注册
- 子命令
- 选项解析

#### CommandConstants（命令常量）

从CC源码移植的关键常量：
- `REMOTE_SAFE_COMMANDS` - 远程安全命令
- `BRIDGE_SAFE_COMMANDS` - Bridge安全命令

### 2.4 内置命令清单

PY_APP的 `builtin/` 目录包含 **40+命令实现**：

| 命令 | 实现文件 | CC源码对应 |
|------|---------|-----------|
| `help` | Help.ts | ✅ help |
| `status` | Status.ts | ✅ status |
| `clear` | Clear.ts | ✅ clear |
| `exit` | - | ✅ exit |
| `version` | - | ✅ version |
| `session` | Session.ts | ✅ session |
| `config` | Config.ts | ✅ config |
| `skill` | Skill.ts | ✅ skills（部分） |
| `tool` | Tool.ts | ❌ 无对应 |
| `compact` | Compact.ts | ✅ compact |
| `history` | History.ts | ❌ 无对应（PY_APP新增） |
| `advisor` | Advisor.ts | ✅ advisor |
| `brief` | Brief.ts | ✅ brief（条件编译） |
| `cache` | Cache.ts | ❌ 无对应（PY_APP新增） |
| `chat` | Chat.ts | ❌ 无对应（PY_APP新增） |
| `commit` | Commit.ts | ✅ commit |
| `complete` | Complete.ts | ❌ 无对应（PY_APP新增） |
| `parallel` | Parallel.ts | ❌ 无对应（PY_APP新增） |
| `permission` | Permission.ts | ✅ permissions（部分） |
| `security` | Security.ts | ✅ security-review |
| `vim` | Vim.ts | ✅ vim |
| `copy` | Copy.ts | ✅ copy |
| `voice` | Voice.ts | ✅ voice（条件编译） |
| `export` | Export.ts | ✅ export |
| `share` | Share.ts | ✅ share |
| `stats` | Stats.ts | ✅ stats |
| `cost` | Cost.ts | ✅ cost |
| `usage` | Usage.ts | ✅ usage |
| `doctor` | Doctor.ts | ✅ doctor |
| `fast` | Fast.ts | ✅ fast |
| `memory` | Memory.ts | ✅ memory |
| `skills` | Skills.ts | ✅ skills |
| `hooks` | Hooks.ts | ✅ hooks |
| `mcp` | MCP.ts | ✅ mcp |
| `plugins` | Plugins.ts | ✅ plugin |
| `branch` | Branch.ts | ✅ branch |
| `models` | - | ✅ model |
| `permissions` | - | ✅ permissions |
| `tokens` | - | ❌ 无对应（PY_APP新增） |
| `settings` | - | ✅ config（别名） |
| `env` | - | ✅ env |
| `debug` | - | ❌ 无对应（PY_APP新增） |
| `resume` | resume.ts | ✅ resume |

### 2.5 顶层命令清单

PY_APP在 `commands/` 根目录还有以下命令子目录：

| 命令 | CC源码对应 |
|------|-----------|
| `agents` | ✅ agents |
| `branch` | ✅ branch |
| `bridge` | ✅ bridge（条件编译） |
| `btw` | ✅ btw |
| `chrome` | ✅ chrome |
| `color` | ✅ color |
| `cost` | ✅ cost |
| `diff` | ✅ diff |
| `doctor` | ✅ doctor |
| `env` | ✅ env |
| `fast` | ✅ fast |
| `hooks` | ✅ hooks |
| `ide` | ✅ ide |
| `login` | ✅ login |
| `logout` | ✅ logout |
| `mcp` | ✅ mcp |
| `memory` | ✅ memory |
| `model` | ✅ model |
| `plan` | ✅ plan |
| `plugin-settings` | ✅ plugin（部分） |
| `stats` | ✅ stats |
| `tag` | ✅ tag |
| `tasks` | ✅ tasks |
| `theme` | ✅ theme |
| `usage` | ✅ usage |

### 2.6 工具命令清单

PY_APP独有的工具命令（将工具暴露为斜杠命令）：

| 目录 | 命令 | 功能 |
|------|------|------|
| `tools/ai/` | agent, agents | AI代理 |
| `tools/dev/` | lsp, notebook, repl | 开发工具 |
| `tools/file/` | edit, glob, write | 文件操作 |
| `tools/network/` | fetch, mcp, websearch | 网络工具 |
| `tools/remote/` | remote-session | 远程会话 |
| `tools/system/` | bash, grep | 系统工具 |
| `tools/task/` | task, todo | 任务工具 |

---

## 3. 对比分析

### 3.1 架构对比

| 维度 | CC源码 | PY_APP | 评估 |
|------|--------|--------|------|
| 架构模式 | 扁平注册（commands.ts单文件） | 分层架构（registry/executor/pipeline/loader/manager） | PY_APP更结构化 |
| 命令类型 | 3种（prompt/local/local-jsx） | 6种（prompt/local/local-jsx/action/tool/chat） | PY_APP更细分 |
| 注册机制 | memoize + 数组 | CommandRegistry + EnhancedCommandRegistry | PY_APP更完善 |
| 执行机制 | 直接调用load() | CommandExecutor + CommandPipeline（6阶段） | PY_APP更完善 |
| 加载机制 | 静态import + require() | 4种Loader（Builtin/Skill/Plugin/MCP） | PY_APP更结构化 |
| 解析机制 | 自定义 | Commander.js | PY_APP更标准 |
| 历史管理 | 基础 | 3种实现（Advanced/Enhanced/Manager） | PY_APP更丰富 |
| 分类系统 | 无 | 13个CommandCategory | PY_APP独有 |
| 依赖管理 | 无 | DependencyGraph | PY_APP独有 |
| 权限系统 | 无（在CommandBase中） | CommandPermission | PY_APP更独立 |
| 管道系统 | 无 | 6阶段Pipeline | PY_APP独有 |
| 交互执行 | 无独立实现 | InteractiveCommandExecutor | PY_APP独有 |
| 命令补全 | 无独立实现 | CommandCompletionManager | PY_APP独有 |
| 输出格式 | 无独立实现 | OutputFormatter + TableFormatter | PY_APP独有 |
| 进度条 | 无独立实现 | ProgressBar | PY_APP独有 |
| 命令缓存 | 无 | CommandCache | PY_APP独有 |

### 3.2 命令覆盖对比

#### 已对标命令（CC源码有，PY_APP也有）

| 命令 | CC源码实现深度 | PY_APP实现深度 | 差距 |
|------|--------------|--------------|------|
| `help` | local-jsx + 完整UI | 基础实现 | 🟡 中 |
| `status` | local-jsx + 完整UI | 基础实现 | 🟡 中 |
| `clear` | local + 缓存/会话清理 | 基础实现 | 🟡 中 |
| `compact` | local + CompactionResult | 基础实现 | 🟡 中 |
| `config` | local-jsx + 完整配置面板 | 基础文本实现 | 🔴 大 |
| `doctor` | local-jsx + Doctor屏幕 | 基础文本诊断 | 🔴 大 |
| `resume` | local-jsx + 会话选择UI | 基础会话列表 | 🟡 中 |
| `session` | local-jsx + 会话管理UI | 基础实现 | 🟡 中 |
| `cost` | local + 成本格式化 | 基础实现 | 🟡 中 |
| `usage` | local-jsx + 使用统计UI | 基础实现 | 🟡 中 |
| `mcp` | local-jsx + MCP管理UI | 基础实现 | 🟡 中 |
| `memory` | local-jsx + 记忆管理UI | 基础实现 | 🟡 中 |
| `skills` | local-jsx + 技能管理UI | 基础实现 | 🟡 中 |
| `hooks` | local-jsx + 钩子管理UI | 基础实现 | 🟡 中 |
| `model` | local-jsx + 模型选择UI | 基础实现 | 🟡 中 |
| `theme` | local-jsx + 主题选择UI | 基础实现 | 🟡 中 |
| `diff` | local-jsx + 差异查看UI | 基础实现 | 🟡 中 |
| `commit` | prompt + 完整提交流程 | 基础实现 | 🟡 中 |
| `review` | prompt + ultrareview | 基础实现 | 🔴 大 |
| `login` | local-jsx + 登录流程 | 基础实现 | 🔴 大 |
| `logout` | local-jsx + 登出流程 | 基础实现 | 🟡 中 |
| `vim` | local + Vim模式切换 | 基础实现 | 🟢 小 |
| `voice` | local（条件编译） | 基础实现 | 🟢 小 |
| `agents` | local-jsx + Agent管理UI | 基础实现 | 🟡 中 |
| `branch` | local + 分支管理 | 基础实现 | 🟢 小 |
| `advisor` | prompt | 基础实现 | 🟢 小 |
| `export` | local-jsx | 基础实现 | 🟢 小 |

#### CC源码有，PY_APP缺失的命令

| 命令 | 功能 | 优先级 |
|------|------|--------|
| `add-dir` | 添加工作目录 | 🔴 高 |
| `context` | 上下文管理 | 🔴 高 |
| `rename` | 重命名会话 | 🔴 高 |
| `rewind` | 回退会话 | 🔴 高 |
| `init` | 项目初始化 | 🔴 高 |
| `effort` | Effort设置 | 🟡 中 |
| `keybindings` | 快捷键管理 | 🟡 中 |
| `permissions` | 权限管理 | 🟡 中 |
| `privacy-settings` | 隐私设置 | 🟡 中 |
| `rate-limit-options` | 速率限制选项 | 🟡 中 |
| `output-style` | 输出风格 | 🟡 中 |
| `desktop` | 桌面模式 | 🟡 中 |
| `mobile` | 移动端 | 🟡 中 |
| `install-github-app` | GitHub App安装 | 🟡 中 |
| `install-slack-app` | Slack App安装 | 🟢 低 |
| `upgrade` | 升级 | 🟡 中 |
| `passes` | Pass管理 | 🟡 中 |
| `feedback` | 反馈 | 🟢 低 |
| `files` | 文件管理 | 🟡 中 |
| `terminalSetup` | 终端设置 | 🟢 低 |
| `sandbox-toggle` | 沙箱开关 | 🟡 中 |
| `stickers` | 贴纸 | 🟢 低 |
| `thinkback` / `thinkback-play` | 思考回放 | 🟢 低 |
| `remote-env` | 远程环境 | 🟡 中 |
| `pr_comments` | PR评论 | 🟢 低 |
| `heapdump` | 堆转储 | 🟢 低 |
| `reload-plugins` | 重载插件 | 🟡 中 |
| `release-notes` | 发布说明 | 🟢 低 |
| `extra-usage` | 额外使用量 | 🟢 低 |
| `chrome` | Chrome集成 | 🟢 低 |
| `btw` | 反馈 | 🟢 低 |
| `insights` | 洞察报告 | 🟡 中 |
| `statusline` | 状态栏 | 🟢 低 |
| `tag` | 标签 | 🟢 低 |
| `copy` | 复制 | 🟢 低 |
| `plan` | 计划 | 🟡 中 |

#### PY_APP独有命令（CC源码无对应）

| 命令 | 功能 | 价值 |
|------|------|------|
| `tool` | 工具管理 | 🟡 中 |
| `history` | 命令历史 | 🟡 中 |
| `cache` | 缓存管理 | 🟢 低 |
| `chat` | 聊天管理 | 🟡 中 |
| `complete` | 自动完成 | 🟢 低 |
| `parallel` | 并行执行 | 🟡 中 |
| `tokens` | Token管理 | 🟡 中 |
| `debug` | 调试命令 | 🟢 低 |
| `plugin-settings` | 插件设置 | 🟡 中 |
| 工具命令（14个） | 将工具暴露为斜杠命令 | 🟡 中 |

### 3.3 实现深度对比

| 维度 | CC源码 | PY_APP | 评估 |
|------|--------|--------|------|
| UI组件 | 每个local-jsx命令有独立.tsx | 大部分命令无UI组件 | CC源码远超 |
| 懒加载 | 每个命令load()延迟加载 | BuiltinCommandLoader批量加载 | CC源码更精细 |
| 可用性过滤 | meetsAvailabilityRequirement | CommandManager中基本实现 | CC源码更完善 |
| 条件编译 | feature()编译时排除 | feature()运行时检查 | CC源码更高效 |
| 动态命令 | 技能目录+插件+工作流 | 4种Loader | 各有优势 |
| 命令别名 | 完整别名系统 | 基本别名支持 | 基本对标 |
| 命令隐藏 | isHidden字段 | isHidden字段 | 对标 |
| 命令启用 | isEnabled()函数 | CommandManager中检查 | 基本对标 |
| 命令来源 | source字段（builtin/mcp/plugin/bundled） | loadedFrom字段 | 基本对标 |
| 命令参数 | argumentHint + argNames | argumentHint | CC源码更完善 |
| 命令描述 | description + whenToUse | description + whenToUse | 对标 |
| 敏感参数 | isSensitive字段 | 无 | CC源码独有 |
| 即时执行 | immediate字段 | 无 | CC源码独有 |
| 用户可调用 | userInvocable字段 | userInvocable字段 | 对标 |
| 模型调用禁用 | disableModelInvocation | disableModelInvocation | 对标 |

---

## 4. 差距分析

### 4.1 架构层面

**PY_APP优势**：
1. 分层架构远超CC源码的扁平注册模式
2. CommandPipeline提供了可扩展的命令处理管道
3. EnhancedCommandRegistry的分类、依赖、权限系统是创新
4. 4种Loader的统一加载机制更灵活
5. Commander.js提供标准化的命令解析
6. 工具命令（将工具暴露为斜杠命令）是创新设计

**PY_APP不足**：
1. 缺少CC源码的编译时条件编译优化
2. 命令懒加载粒度不如CC源码（CC每个命令独立load，PY_APP批量加载）
3. 缺少CC源码的可用性过滤（auth/provider级别）

### 4.2 命令覆盖层面

**已对标**: ~30个命令有基本实现
**缺失**: ~35个命令完全缺失
**PY_APP独有**: ~10个命令 + 14个工具命令

**对标率**: 约 30/65 ≈ 46%（按CC源码公开命令计算）

### 4.3 实现深度层面

即使已对标的命令，PY_APP的实现深度也普遍不如CC源码：
- CC源码的local-jsx命令都有完整的React UI组件
- PY_APP大部分命令只有基础文本输出
- CC源码的命令与API/MCP/Bridge深度集成
- PY_APP的命令集成度较低

---

## 5. 缺失命令优先级清单

### 5.1 高优先级（核心功能缺失）

| 命令 | 功能 | 实现难度 | 理由 |
|------|------|---------|------|
| `add-dir` | 添加工作目录 | 低 | 基础功能 |
| `context` | 上下文管理 | 中 | 核心交互 |
| `rename` | 重命名会话 | 低 | 会话管理 |
| `rewind` | 回退会话 | 中 | 会话管理 |
| `init` | 项目初始化 | 中 | 首次使用 |

### 5.2 中优先级（功能增强）

| 命令 | 功能 | 实现难度 | 理由 |
|------|------|---------|------|
| `effort` | Effort设置 | 低 | 配置增强 |
| `keybindings` | 快捷键管理 | 中 | 交互增强 |
| `permissions` | 权限管理 | 中 | 安全增强 |
| `privacy-settings` | 隐私设置 | 低 | 隐私保护 |
| `output-style` | 输出风格 | 低 | 用户体验 |
| `files` | 文件管理 | 中 | 开发工具 |
| `sandbox-toggle` | 沙箱开关 | 低 | 安全工具 |
| `remote-env` | 远程环境 | 高 | 远程开发 |
| `insights` | 洞察报告 | 高 | 数据分析 |
| `plan` | 计划模式 | 中 | 工作流 |
| `upgrade` | 升级 | 中 | 版本管理 |
| `passes` | Pass管理 | 中 | 订阅管理 |
| `reload-plugins` | 重载插件 | 低 | 插件管理 |

### 5.3 低优先级（扩展功能）

| 命令 | 功能 | 实现难度 | 理由 |
|------|------|---------|------|
| `desktop` | 桌面模式 | 高 | 特定场景 |
| `mobile` | 移动端 | 高 | 特定场景 |
| `install-github-app` | GitHub App | 高 | 特定集成 |
| `install-slack-app` | Slack App | 中 | 特定集成 |
| `feedback` | 反馈 | 低 | 非核心 |
| `terminalSetup` | 终端设置 | 低 | 非核心 |
| `stickers` | 贴纸 | 低 | 非核心 |
| `thinkback` | 思考回放 | 中 | 非核心 |
| `pr_comments` | PR评论 | 中 | 特定场景 |
| `heapdump` | 堆转储 | 中 | 调试工具 |
| `release-notes` | 发布说明 | 低 | 非核心 |
| `extra-usage` | 额外使用量 | 低 | 非核心 |
| `chrome` | Chrome集成 | 高 | 特定场景 |
| `statusline` | 状态栏 | 中 | 非核心 |

---

## 6. 改进建议

### 6.1 架构改进

1. **命令懒加载精细化**: 参考CC源码，每个命令独立 `load()` 函数，而非BuiltinCommandLoader批量加载
2. **可用性过滤**: 实现 `meetsAvailabilityRequirement()` 根据认证类型过滤命令
3. **条件编译优化**: 评估接入 `bun:bundle feature()` 实现编译时命令排除
4. **内部命令隔离**: 参考 `INTERNAL_ONLY_COMMANDS` 分离内部和外部命令

### 6.2 命令补充

1. **第一阶段**: 补充5个高优先级命令（add-dir、context、rename、rewind、init）
2. **第二阶段**: 补充13个中优先级命令（effort、keybindings、permissions等）
3. **第三阶段**: 补充14个低优先级命令（desktop、mobile、feedback等）

### 6.3 实现深度提升

1. **UI组件**: 为local-jsx类型命令补充React UI组件
2. **深度集成**: 加强命令与API/MCP/Bridge的集成
3. **命令参数**: 补充argNames、isSensitive、immediate等字段
4. **动态命令**: 实现技能目录命令发现（getSkillDirCommands）

---

## 7. 总体评估

### 对标完成度: 🟡 部分对标

| 维度 | 完成度 | 说明 |
|------|--------|------|
| 架构设计 | 🟢 85% | 分层架构超越CC源码 |
| 命令覆盖 | 🟡 46% | 约30/65命令已对标 |
| 实现深度 | 🟡 35% | 大部分命令缺少UI组件和深度集成 |
| 条件编译 | 🟡 40% | 有feature()但缺少编译时优化 |
| 动态命令 | 🟡 45% | 有4种Loader但缺少技能目录发现 |

### 综合对标完成度: 🟡 约45%

Commands模块从之前的"差距较大"提升为"部分对标"，主要原因是：
1. 重新分析发现PY_APP实际有40+内置命令 + 25顶层命令 + 14工具命令，远超之前估计的10+
2. PY_APP的架构设计（Pipeline/Registry/Loader）超越CC源码
3. 但实现深度和命令覆盖仍有明显差距
