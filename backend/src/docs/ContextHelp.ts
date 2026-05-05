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
  /commit "fix: 修复bug"    - 使用指定消息提交
  /commit 功能描述           - 直接提交（消息需不含空格）

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
- 输入需要使用引号包裹，支持 JSON 格式

/parallel 命令用法:
  /parallel bash "echo hello" ; bash "echo world"
  /parallel read "file1.txt" ; read "file2.txt"
  /parallel bash "{\"command\":\"ls\"}" ; bash "{\"command\":\"pwd\"}"

别名: /async, /multi

注意: 最大并行数为4，超过的任务将按顺序排队执行。
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

/permissions - 快速权限管理（别名: /perm, /auth）
  融合常用权限快速操作与细粒度权限控制

快速操作:
  /permissions list                        - 列出所有权限
  /permissions show <权限名>               - 查看权限详情
  /permissions grant <权限名>              - 授予权限
  /permissions revoke <权限名>             - 撤销权限
  /permissions status                      - 显示权限状态

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
  /permissions add allow tool bash execute
    `.trim(),
    relatedCommands: ['permissions', 'perm', 'auth'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'permission', matchType: 'startsWith' },
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
- 支持安全扫描、输入验证和输入清理

/security 命令用法:
  /security scan ./src              - 运行安全扫描
  /security validate <类型> <输入>  - 验证输入安全性
  /security sanitize <输入>         - 清理输入

子命令说明:
  scan      - 运行安全扫描（扫描路径默认当前目录）
  validate  - 验证输入安全性
  sanitize  - 清理输入，移除潜在危险内容

验证类型:
  safeString         - 安全字符串验证
  safeFileName       - 安全文件名验证
  noCommandInjection - 命令注入检测
  noSqlInjection     - SQL注入检测

示例:
  /security scan ./src
  /security validate safeString "<script>alert(1)</script>"
  /security sanitize "<script>alert(1)</script>"

别名: /sec
    `.trim(),
    relatedCommands: ['security', 'sec', 'scan', 'validate'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'security', matchType: 'startsWith' },
      { type: 'command', value: 'sec', matchType: 'startsWith' },
      { type: 'command', value: 'scan', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'vim-editor',
    description: 'Vim编辑器帮助',
    helpContent: `
Vim编辑器帮助:
- 使用 "/vim" 命令打开文件进行编辑
- 支持基本的Vim编辑操作

/vim 命令用法:
  /vim <文件路径>           - 打开文件
  /vim <文件路径> -i        - 直接进入插入模式
  /vim <文件路径> -r        - 只读模式
  /vim <文件路径> -l <行号> - 跳转到指定行

选项说明:
  --insert, -i     - 直接进入插入模式
  --readonly, -r   - 只读模式，无法修改文件
  --line=<行号>    - 跳转到指定行
  -l <行号>        - 跳转到指定行（简写形式）

常用Vim操作:
  i              - 进入插入模式
  Esc            - 返回普通模式
  :w             - 保存文件
  :q             - 退出
  :wq            - 保存并退出
  :q!            - 强制退出不保存
  dd             - 删除当前行
  yy             - 复制当前行
  p              - 粘贴
  /<搜索内容>    - 搜索
  n              - 下一个搜索结果
  N              - 上一个搜索结果
  :%s/old/new/g  - 替换所有匹配

示例:
  /vim test.txt
  /vim src/main.ts -i
  /vim README.md -l 10

别名: /vi, /edit
    `.trim(),
    relatedCommands: ['vim', 'vi', 'edit'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'vim', matchType: 'startsWith' },
      { type: 'command', value: 'vi', matchType: 'startsWith' },
      { type: 'command', value: 'edit', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'voice-mode',
    description: '语音模式帮助',
    helpContent: `
语音模式帮助:
- 使用 "/voice" 命令切换语音模式
- 支持语音输入和语音输出功能

/voice 命令用法:
  /voice           - 切换语音模式（默认启用）
  /voice on        - 启用语音模式
  /voice off       - 禁用语音模式

功能说明:
  语音输入         - 按住快捷键开始录音，松开后自动识别
  语音输出         - 自动朗读回复内容
  语音命令         - 支持语音唤醒和语音指令

系统要求:
  - 需要安装录音工具（如 sox、ffmpeg）
  - 需要安装语音识别服务
  - 需要安装语音合成服务

快捷键:
  Ctrl+Shift+V    - 开始/停止录音
  Ctrl+Shift+S    - 切换语音输出

示例:
  /voice
  /voice on
  /voice off

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
- 支持自定义文件名和默认文件名

/export 命令用法:
  /export                    - 导出对话（使用默认文件名）
  /export <文件名>          - 导出对话到指定文件

文件名说明:
  - 如果不提供文件名，将使用默认格式: conversation-YYYY-MM-DD-HHMMSS.txt
  - 如果提供文件名但没有 .txt 扩展名，会自动添加
  - 文件将保存在当前工作目录下

导出格式:
  - 纯文本格式
  - 包含导出时间和分隔线
  - 用户消息标记为 [用户]
  - 助手消息标记为 [Claude]

示例:
  /export
  /export my-conversation
  /export chat-log.txt

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
- 使用 "/share" 命令分享当前对话记录
- 自动生成 Markdown 格式的分享文件

/share 命令用法:
  /share                    - 分享当前对话

分享格式:
  - Markdown 格式
  - 包含分享时间和分隔线
  - 用户消息标记为 ### 用户
  - 助手消息标记为 ### Claude
  - 文件格式: share-ISO时间戳.md

示例:
  /share

别名: /分享

注意: 分享文件将保存在当前工作目录下。
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
- 使用 "/cost" 命令查看API调用成本和使用统计
- 支持多种统计视图：总览、明细、使用情况、时间范围

/cost 命令用法:
  /cost                    - 显示成本总览
  /cost --breakdown (-b)   - 显示成本明细
  /cost --usage (-u)       - 显示使用统计
  /cost --time (-t)        - 显示时间范围统计

示例:
  /cost
  /cost -b
  /cost --usage
  /cost -t

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
    contextId: 'usage-stats',
    description: '使用统计帮助',
    helpContent: `
使用统计帮助:
- 使用 "/usage" 命令查看详细的使用统计和趋势分析
- 支持多种统计视图：总体、趋势、命令、工具、行为、性能

/usage 命令用法:
  /usage                    - 显示总体使用统计
  /usage --trends (-t)      - 显示使用趋势分析
  /usage --commands (-c)    - 显示命令使用统计
  /usage --tools (-o)       - 显示工具使用统计
  /usage --behavior (-b)    - 显示用户行为分析
  /usage --performance (-p) - 显示性能指标

示例:
  /usage
  /usage -t
  /usage --commands
  /usage -p

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
- 使用 "/doctor" 命令检查系统健康状态和潜在问题
- 支持多种诊断模式：完整诊断、快速诊断、详细诊断

/doctor 命令用法:
  /doctor                   - 执行完整系统诊断
  /doctor --quick (-q)      - 执行快速诊断
  /doctor --detailed (-d)   - 执行详细诊断
  /doctor --fix (-f)        - 自动修复检测到的问题

子命令说明:
  --quick, -q     - 快速诊断（主要检查项）
  --detailed, -d  - 详细诊断（完整检查项）
  --fix, -f       - 自动修复模式

诊断检查项:
  - 系统版本检查
  - 内存使用检查
  - 磁盘空间检查
  - 互联网连接检查
  - API服务连接检查
  - DNS解析检查
  - 配置文件完整性检查
  - 安全配置检查
  - 敏感信息检查

示例:
  /doctor
  /doctor -q
  /doctor --detailed
  /doctor -f

别名: /诊断, /system-check
    `.trim(),
    relatedCommands: ['doctor', '诊断', 'system-check'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'doctor', matchType: 'startsWith' },
      { type: 'command', value: '诊断', matchType: 'startsWith' },
      { type: 'command', value: 'system-check', matchType: 'startsWith' },
    ],
  },
  {
    contextId: 'fast',
    description: '快速模式帮助',
    helpContent: `
快速模式帮助:
- 使用 "/fast" 命令切换 AI 模型的快速模式
- 快速模式提供更快的响应速度，但按溢价计费

/fast 命令用法:
  /fast           - 显示当前快速模式状态
  /fast on        - 启用快速模式
  /fast off       - 禁用快速模式

功能说明:
  快速模式        - 启用后使用专门的快速响应模型
  溢价计费        - 快速模式按更高费率计费
  独立限流        - 快速模式有独立的速率限制

示例:
  /fast
  /fast on
  /fast off

别名: /fast-mode, /快速模式
    `.trim(),
    relatedCommands: ['fast', 'fast-mode', '快速模式'],
    relatedTools: [],
    matchConditions: [
      { type: 'command', value: 'fast', matchType: 'startsWith' },
      { type: 'command', value: '快速模式', matchType: 'startsWith' },
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
- 使用 "/memory" 命令管理 Claude memory 文件
- 支持创建、查看、编辑和删除记忆文件

/memory 命令用法:
  /memory                    - 显示记忆文件概览
  /memory --list (-l)        - 列出所有记忆文件
  /memory --create <name>    - 创建新的记忆文件
  /memory --show <name>      - 显示记忆文件内容
  /memory --edit <name>      - 编辑记忆文件
  /memory --delete <name>    - 删除记忆文件
  /memory <name>             - 显示指定记忆文件

功能说明:
  创建记忆文件   - 在 ~/.pyapp/memory/ 目录下创建 .md 文件
  编辑记忆文件   - 使用 $EDITOR 或 $VISUAL 环境变量指定的编辑器
  显示记忆文件   - 查看记忆文件内容
  删除记忆文件   - 从磁盘删除记忆文件

示例:
  /memory
  /memory --list
  /memory --create my-knowledge
  /memory --show my-knowledge
  /memory --edit my-knowledge
  /memory --delete old-memory
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
- 使用 "/hooks" 命令管理和查看钩子系统
- 钩子是在特定事件触发时执行的脚本

/hooks 命令用法:
  /hooks                    - 显示钩子系统概览
  /hooks --list (-l)        - 列出所有钩子
  /hooks --stats (-s)       - 显示钩子统计信息
  /hooks --execute <钩子名>  - 执行指定钩子
  /hooks --test (-t)        - 测试所有钩子
  /hooks --manage (-m)      - 管理钩子

钩子类型:
  pre-command     - 命令执行前触发
  post-command    - 命令执行后触发
  pre-execution   - 执行操作前触发
  post-execution  - 执行操作后触发
  custom          - 自定义钩子

示例:
  /hooks
  /hooks --list
  /hooks --stats
  /hooks --execute pre-command-validation
  /hooks --test
  /hooks --manage

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
- 使用 "/mcp" 命令管理和查看MCP（Model Context Protocol）服务器
- MCP是用于扩展AI助手功能的协议

/mcp 命令用法:
  /mcp                    - 显示MCP系统概览
  /mcp --list (-l)        - 列出所有MCP服务器
  /mcp --status (-s)      - 显示MCP状态报告
  /mcp --resources (-r)   - 显示MCP资源列表
  /mcp --tools (-t)       - 显示MCP工具列表
  /mcp --manage (-m)      - 管理MCP服务器
  /mcp --test (-e)        - 测试MCP连接

服务器类型:
  file        - 文件类型服务器
  database    - 数据库服务器
  api         - API服务器
  custom      - 自定义服务器

示例:
  /mcp
  /mcp --list
  /mcp --status
  /mcp --resources
  /mcp --tools
  /mcp --manage
  /mcp --test

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
- 使用 "/model" 命令查看和切换当前 AI 模型

用法:
  /model                    - 显示当前模型和完整可用模型列表
  /model <model-id>         - 切换到指定模型（支持别名）

常用别名:
  sonnet, sonnet[1m]        - Claude Sonnet 4
  opus, opus[1m], best      - Claude Opus 4
  haiku                     - Claude 3.5 Haiku
  opusplan                  - Claude Opus 4 Plan

运行 /model 查看所有可用模型和当前使用模型。

示例:
  /model
  /model sonnet
  /model opus

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
- 使用 "/plugins" 命令管理和查看插件系统
- 插件是扩展应用功能的模块化组件

/plugins 命令用法:
  /plugins                    - 显示插件系统概览
  /plugins --list (-l)        - 列出所有插件
  /plugins --status (-s)      - 显示插件状态报告
  /plugins --manage (-m)      - 管理插件
  /plugins --dependencies (-d) - 显示依赖关系
  /plugins --test (-t)        - 测试所有插件
  /plugins --search=<关键词>   - 搜索插件

插件类型:
  utility     - 实用工具插件
  integration - 集成插件
  analytics   - 数据分析插件
  security    - 安全插件
  ui          - 用户界面插件

示例:
  /plugins
  /plugins --list
  /plugins --status
  /plugins --manage
  /plugins --dependencies
  /plugins --test
  /plugins --search=security

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