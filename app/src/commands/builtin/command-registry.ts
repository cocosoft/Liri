/**
 * 内置命令注册表（数据驱动归集）
 *
 * 将 45 个"标准 execute 模式"命令的命令定义从独立 index.ts 归集到本文件。
 * 每个命令的实现类仍保留在各自目录（如 context/Context.ts），
 * 本文件通过 loadExecute() 统一动态加载。
 *
 * 归集依据：架构暴胀分析（模式 E 碎片化）+ 命令加载架构
 * - 原 index.ts 中 21 行 MIT License 头 × 45 文件 = 945 行重复已消除
 * - 每个命令从 ~40 行文件缩减为 ~8 行注册条目
 *
 * 特殊模式命令（内联实现/自定义包装）保留在各自 index.ts，不归集。
 *
 * 关联：
 * - 加载器：../loader/CommandLoader.ts（LazyCommand 动态 import 本文件取命名导出）
 * - 类型：@modules/commands → Command
 */
import type { Command } from '@modules/commands';

/**
 * 统一 loader：动态 import 实现类并绑定 execute
 * 对应原 index.ts 中的标准模式：
 *   load: async () => import('./Xxx.js').then((m) => ({
 *     execute: m.default.execute.bind(m.default),
 *   }))
 */
function loadExecute(modulePath: string): Command['load'] {
  return async () => {
    const m = await import(modulePath);
    return { execute: m.default.execute.bind(m.default) };
  };
}

/**
 * 统一 loader：动态导入实现模块并整体返回 default（m.default 模式）
 * 对应 Phase 2 归集的特殊命令模式：load: () => import('./X.js').then((m) => m.default)
 */
function loadDefault(modulePath: string): Command['load'] {
  return async () => (await import(modulePath)).default;
}

/** 上下文管理 */
export const contextCommand: Command = {
  type: 'action',
  name: 'context',
  description: '上下文管理',
  aliases: ['ctx'],
  argumentHint:
    '[show|clear|compact|info|trim <tokens>|history|snapshot|debug|wallet]',
  whenToUse: '当你需要管理会话上下文时',
  load: loadExecute('./context/Context.js'),
};

/** 颜色设置 */
export const colorCommand: Command = {
  type: 'action',
  name: 'color',
  description: '颜色设置',
  aliases: ['colorscheme', 'theme'],
  argumentHint: '[show|theme|scheme|reset|help]',
  whenToUse: '当你需要配置界面颜色时',
  load: loadExecute('./color/Color.js'),
};

/** Chrome集成 */
export const chromeCommand: Command = {
  type: 'action',
  name: 'chrome',
  description: 'Chrome集成',
  argumentHint: '[status|connect|disconnect|tabs|screenshot|help]',
  whenToUse: '当你需要与Chrome浏览器交互时',
  load: loadExecute('./chrome/Chrome.js'),
};

/** 桌面模式 */
export const desktopCommand: Command = {
  type: 'action',
  name: 'desktop',
  description: '桌面模式',
  argumentHint: '[toggle|on|off|status|settings|help]',
  whenToUse: '当你需要管理桌面应用模式时',
  load: loadExecute('./desktop/Desktop.js'),
};

/** 设置Effort级别 */
export const effortCommand: Command = {
  type: 'action',
  name: 'effort',
  description: '设置Effort级别',
  argumentHint: '[low|medium|high|auto]',
  whenToUse: '当你需要调整AI响应的详细程度时',
  load: loadExecute('./effort/Effort.js'),
};

/** 快速备注 */
export const btwCommand: Command = {
  type: 'action',
  name: 'btw',
  description: '快速备注',
  argumentHint: '<备注内容>',
  whenToUse: '当你需要快速记录一个简短备注时',
  load: loadExecute('./btw/Btw.js'),
};

/** 添加工作目录 */
export const addDirCommand: Command = {
  type: 'action',
  name: 'add-dir',
  description: '添加工作目录',
  aliases: ['add', 'cd'],
  argumentHint: '<目录路径>',
  whenToUse: '当你需要切换或添加工作目录时',
  load: loadExecute('./add-dir/AddDir.js'),
};

/** 额外使用量 */
export const extraUsageCommand: Command = {
  type: 'action',
  name: 'extra-usage',
  description: '额外使用量',
  aliases: ['usage:extra', 'extratokens'],
  argumentHint: '[show|purchase|history|status|help]',
  whenToUse: '当你需要查看或购买额外使用量时',
  load: loadExecute('./extra-usage/ExtraUsage.js'),
};

/** 用户反馈 */
export const feedbackCommand: Command = {
  type: 'action',
  name: 'feedback',
  description: '用户反馈',
  aliases: ['report'],
  argumentHint: '[send|type|list|help]',
  whenToUse: '当你需要提交反馈或建议时',
  load: loadExecute('./feedback/Feedback.js'),
};

/** 文件管理 */
export const filesCommand: Command = {
  type: 'action',
  name: 'files',
  description: '文件管理',
  aliases: ['ls', 'dir'],
  argumentHint: '[list|find|view|tree|clean|help]',
  whenToUse: '当你需要管理或查看文件时',
  load: loadExecute('./files/Files.js'),
};

/** 生成堆转储 */
export const heapdumpCommand: Command = {
  type: 'action',
  name: 'heapdump',
  description: '生成堆转储',
  aliases: ['heap'],
  whenToUse: '当你需要调试内存问题时',
  load: loadExecute('./heapdump/Heapdump.js'),
};

/** 初始化项目 */
export const initCommand: Command = {
  type: 'action',
  name: 'init',
  description: '初始化项目',
  aliases: ['create'],
  argumentHint: '[项目名称]',
  whenToUse: '当你需要创建一个新的项目目录时',
  load: loadExecute('./init/Init.js'),
};

/** 洞察分析 */
export const insightsCommand: Command = {
  type: 'action',
  name: 'insights',
  description: '洞察分析',
  aliases: ['analyze'],
  argumentHint: '[show|summary|suggestions|performance|help]',
  whenToUse: '当你需要获取会话分析和建议时',
  load: loadExecute('./insights/Insights.js'),
};

/** 安装GitHub App */
export const installGithubAppCommand: Command = {
  type: 'action',
  name: 'install-github-app',
  description: '安装GitHub App',
  aliases: ['github-app'],
  whenToUse: '当你需要安装GitHub集成时',
  load: loadExecute('./install-github-app/InstallGitHubApp.js'),
};

/** 安装Slack App */
export const installSlackAppCommand: Command = {
  type: 'action',
  name: 'install-slack-app',
  description: '安装Slack App',
  aliases: ['slack-app'],
  whenToUse: '当你需要安装Slack集成时',
  load: loadExecute('./install-slack-app/InstallSlackApp.js'),
};

/** 快捷键管理 */
export const keybindingsCommand: Command = {
  type: 'action',
  name: 'keybindings',
  description: '快捷键管理',
  aliases: ['kb', 'keys'],
  argumentHint: '[list|show <键>|reset|help]',
  whenToUse: '当你需要查看或管理键盘快捷键时',
  load: loadExecute('./keybindings/Keybindings.js'),
};

/** 登出 */
export const logoutCommand: Command = {
  type: 'action',
  name: 'logout',
  description: '登出',
  aliases: ['signout'],
  whenToUse: '当你需要登出账户时',
  load: loadExecute('./logout/Logout.js'),
};

/** 键盘快捷键 */
export const keyboardCommand: Command = {
  type: 'action',
  name: 'keyboard',
  description: '键盘快捷键',
  aliases: ['shortcuts', 'keys'],
  argumentHint: '[list|show|customize|reset|help]',
  whenToUse: '当你需要管理键盘快捷键时',
  load: loadExecute('./keyboard/Keyboard.js'),
};

/** 登录 */
export const loginCommand: Command = {
  type: 'action',
  name: 'login',
  description: '登录',
  aliases: ['signin'],
  argumentHint: '[provider]',
  whenToUse: '当你需要登录账户时',
  load: loadExecute('./login/Login.js'),
};

/** 移动端连接 */
export const mobileCommand: Command = {
  type: 'action',
  name: 'mobile',
  description: '移动端连接',
  aliases: ['phone', 'device'],
  argumentHint: '[status|qr|pair|unpair|help]',
  whenToUse: '当你需要管理移动端连接时',
  load: loadExecute('./mobile/Mobile.js'),
};

/** 输出风格设置 */
export const outputStyleCommand: Command = {
  type: 'action',
  name: 'output-style',
  description: '输出风格设置',
  aliases: ['output', 'style'],
  argumentHint: '[show|format|color|reset|help]',
  whenToUse: '当你需要调整输出格式或显示风格时',
  load: loadExecute('./output-style/OutputStyle.js'),
};

/** Pass管理 */
export const passesCommand: Command = {
  type: 'action',
  name: 'passes',
  description: 'Pass管理',
  aliases: ['subscription'],
  argumentHint: '[list|activate|deactivate|status|info|help]',
  whenToUse: '当你需要管理订阅Pass时',
  load: loadExecute('./passes/Passes.js'),
};

/** 计划管理 */
export const planCommand: Command = {
  type: 'action',
  name: 'plan',
  description: '计划管理',
  argumentHint: '[show|create|add|remove|clear|execute|help]',
  whenToUse: '当你需要管理任务计划时',
  load: loadExecute('./plan/Plan.js'),
};

/** PR评论 */
export const prCommentsCommand: Command = {
  type: 'action',
  name: 'pr-comments',
  description: 'PR评论',
  aliases: ['prc', 'comments'],
  argumentHint: '[list|show|add|resolve|help]',
  whenToUse: '当你需要管理PR评论时',
  load: loadExecute('./pr-comments/PRComments.js'),
};

/** 隐私设置 */
export const privacySettingsCommand: Command = {
  type: 'action',
  name: 'privacy-settings',
  description: '隐私设置',
  aliases: ['privacy'],
  argumentHint: '[show|update <项> <值>|reset|help]',
  whenToUse: '当你需要管理隐私设置时',
  load: loadExecute('./privacy-settings/PrivacySettings.js'),
};

/** 发布说明 */
export const releaseNotesCommand: Command = {
  type: 'action',
  name: 'release-notes',
  description: '发布说明',
  aliases: ['changelog', 'releases'],
  argumentHint: '[latest|all|version|search|help]',
  whenToUse: '当你需要查看版本更新历史时',
  load: loadExecute('./release-notes/ReleaseNotes.js'),
};

/** 速率限制选项 */
export const rateLimitOptionsCommand: Command = {
  type: 'action',
  name: 'rate-limit-options',
  description: '速率限制选项',
  aliases: ['ratelimit', 'limits'],
  argumentHint: '[show|set|reset|help]',
  whenToUse: '当你需要配置API速率限制时',
  load: loadExecute('./rate-limit-options/RateLimitOptions.js'),
};

/** 重载插件 */
export const reloadPluginsCommand: Command = {
  type: 'action',
  name: 'reload-plugins',
  description: '重载插件',
  aliases: ['reload'],
  argumentHint: '[插件名]',
  whenToUse: '当你需要重新加载插件时',
  load: loadExecute('./reload-plugins/ReloadPlugins.js'),
};

/** 重命名会话 */
export const renameCommand: Command = {
  type: 'action',
  name: 'rename',
  description: '重命名会话',
  aliases: ['rn'],
  argumentHint: '<新名称>',
  whenToUse: '当你需要重命名当前会话时',
  load: loadExecute('./rename/Rename.js'),
};

/** 重启应用 */
export const restartCommand: Command = {
  type: 'action',
  name: 'restart',
  description: '重启应用',
  aliases: ['reboot'],
  whenToUse: '当你需要重启应用时',
  load: loadExecute('./restart/Restart.js'),
};

/** 远程环境管理 */
export const remoteEnvCommand: Command = {
  type: 'action',
  name: 'remote-env',
  description: '远程环境管理',
  aliases: ['remote'],
  argumentHint: '[status|connect|disconnect|list|info|help]',
  whenToUse: '当你需要管理远程开发环境时',
  load: loadExecute('./remote-env/RemoteEnv.js'),
};

/** 回退会话 */
export const rewindCommand: Command = {
  type: 'action',
  name: 'rewind',
  description: '回退会话',
  aliases: ['undo'],
  argumentHint: '[步数或消息ID]',
  whenToUse: '当你需要撤销之前的对话内容时',
  load: loadExecute('./rewind/Rewind.js'),
};

/** 切换沙箱模式 */
export const sandboxToggleCommand: Command = {
  type: 'action',
  name: 'sandbox-toggle',
  description: '切换沙箱模式',
  aliases: ['sandbox'],
  argumentHint: '[on|off|toggle|status]',
  whenToUse: '当你需要控制代码执行的沙箱隔离时',
  load: loadExecute('./sandbox-toggle/SandboxToggle.js'),
};

/** 搜索 */
export const searchCommand: Command = {
  type: 'action',
  name: 'search',
  description: '搜索',
  aliases: ['find'],
  argumentHint: '<关键词>',
  whenToUse: '当你需要搜索内容时',
  load: loadExecute('./search/Search.js'),
};

/** Review code for issues, security, and best practices */
export const reviewCommand: Command = {
  type: 'local',
  name: 'review',
  description: 'Review code for issues, security, and best practices',
  argumentHint: '[files...]',
  whenToUse: 'Use this command to review your code for potential issues',
  userInvocable: true,
  version: '1.0.0',
  load: loadExecute('./review/Review.js'),
};

/** 状态栏设置 */
export const statuslineCommand: Command = {
  type: 'action',
  name: 'statusline',
  description: '状态栏设置',
  aliases: ['statusline'],
  argumentHint: '[show|set|reset|help]',
  whenToUse: '当你需要配置状态栏显示时',
  load: loadExecute('./statusline/Statusline.js'),
};

/** 显示系统状态信息（system/agent/gateway/channels） */
export const statusCommand: Command = {
  type: 'action',
  name: 'status',
  description: '显示系统状态信息（system/agent/gateway/channels）',
  aliases: ['st'],
  argumentHint: '[system|agent|gateway|channels|help]',
  whenToUse: '当你需要了解系统当前状态时',
  load: loadExecute('./status/Status.js'),
};

/** 贴纸管理 */
export const stickersCommand: Command = {
  type: 'action',
  name: 'stickers',
  description: '贴纸管理',
  aliases: ['emoji'],
  argumentHint: '[list|add|remove|help]',
  whenToUse: '当你需要管理贴纸时',
  load: loadExecute('./stickers/Stickers.js'),
};

/** 标签管理 */
export const tagCommand: Command = {
  type: 'action',
  name: 'tag',
  description: '标签管理',
  argumentHint: '[list|add|remove|sessions|help]',
  whenToUse: '当你需要管理会话标签时',
  load: loadExecute('./tag/Tag.js'),
};

/** 终端设置 */
export const terminalSetupCommand: Command = {
  type: 'action',
  name: 'terminalSetup',
  description: '终端设置',
  aliases: ['term', 'terminal'],
  argumentHint: '[show|shell|theme|font|size|reset|help]',
  whenToUse: '当你需要配置终端设置时',
  load: loadExecute('./terminalSetup/TerminalSetup.js'),
};

/** 主题设置 — 列出/切换/预览/导入主题 */
export const themeCommand: Command = {
  type: 'action',
  name: 'theme',
  description: '主题设置 — 列出/切换/预览/导入主题',
  aliases: ['appearance', 'look'],
  argumentHint:
    '[list|set <name>|current|preview [name]|import <path>|reset|help]',
  whenToUse: '当你需要更改界面主题、预览配色或导入自定义主题时',
  load: loadExecute('./theme/Theme.js'),
};

/** 思考回放 */
export const thinkbackCommand: Command = {
  type: 'action',
  name: 'thinkback',
  description: '思考回放',
  aliases: ['thinking', 'thoughts'],
  argumentHint: '[list|play|show|delete|help]',
  whenToUse: '当你需要回放之前的思考过程时',
  load: loadExecute('./thinkback/Thinkback.js'),
};

/** 教程 */
export const tutorialCommand: Command = {
  type: 'action',
  name: 'tutorial',
  description: '教程',
  aliases: ['guide', 'learn'],
  argumentHint: '[list|start|progress|help]',
  whenToUse: '当你需要学习使用应用时',
  load: loadExecute('./tutorial/Tutorial.js'),
};

/** 计时器 */
export const timerCommand: Command = {
  type: 'action',
  name: 'timer',
  description: '计时器',
  aliases: ['stopwatch', 'countdown'],
  argumentHint: '[start|stop|pause|resume|status|help]',
  whenToUse: '当你需要使用计时器时',
  load: loadExecute('./timer/Timer.js'),
};

/** 升级管理 */
export const upgradeCommand: Command = {
  type: 'action',
  name: 'upgrade',
  description: '升级管理',
  aliases: ['update'],
  argumentHint: '[check|update|upgrade|version|changelog|help]',
  whenToUse: '当你需要检查更新或升级应用时',
  load: loadExecute('./upgrade/Upgrade.js'),
};

// ============ Phase 2 归集：m.default 模式命令（22 个） ============

/** 工作活动统计 */
export const activityCommand: Command = {
  type: 'action',
  name: 'activity',
  description: '工作活动统计（代码、任务、时间）',
  aliases: ['worksummary', 'act', '工作统计'],
  argumentHint: '[summary|code|tasks|time|status|--json|help]',
  load: loadDefault('./activity/ActivityStats.js'),
};

/** 成本统计 */
export const costCommand: Command = {
  type: 'local',
  name: 'cost',
  description: '显示 API 调用成本和使用统计',
  aliases: ['costs', 'usage-cost'],
  argumentHint:
    '[--breakdown|-b] [--usage|-u] [--time|-t] [status] [--json] [help]',
  load: loadDefault('./cost/Cost.js'),
};

/** 调试工具 */
export const debugCommand: Command = {
  type: 'local',
  name: 'debug',
  description: '调试工具，显示系统状态和进程信息',
  aliases: ['dev', 'developer'],
  argumentHint: '[status|inspect|--json|help]',
  load: loadDefault('./debug/Debug.js'),
};

/** 对话演示 */
export const demoCommand: Command = {
  type: 'local',
  name: 'demo',
  description: '离线模式下展示 Liri 对话能力预览（模拟对话示例）',
  aliases: ['preview', 'example', 'demo-chat'],
  argumentHint: '[help]',
  load: loadDefault('./demo/Demo.js'),
};

/** 查看文档 */
export const docsCommand: Command = {
  type: 'local',
  name: 'docs',
  description: '查看文档（快速开始、命令系统、工具、技能、插件等详细说明）',
  aliases: ['doc', 'documentation', 'help-docs'],
  argumentHint: '[list|<章节名>|search <关键词>|help]',
  load: loadDefault('./docs/Docs.js'),
};

/** 系统诊断 */
export const doctorCommand: Command = {
  type: 'local',
  name: 'doctor',
  description: '系统健康检查和问题诊断',
  aliases: ['diagnose', 'health-check'],
  argumentHint:
    '[--quick|-q] [--detailed|-d] [--fix|-f] [status] [--json] [help]',
  load: loadDefault('./doctor/Doctor.js'),
};

/** 环境配置 */
export const envCommand: Command = {
  type: 'local',
  name: 'env',
  description: '显示应用环境配置，使用 --all 查看全部',
  aliases: ['environment'],
  argumentHint: '[--all|-a|--json|help]',
  load: loadDefault('./env/Env.js'),
};

/** 快速模式 */
export const fastCommand: Command = {
  type: 'local',
  name: 'fast',
  description: '快速模式切换',
  aliases: ['fast-mode'],
  argumentHint: '[on|off] [status] [--json] [help]',
  load: loadDefault('./fast/Fast.js'),
};

/** 系统健康检查 */
export const healthCommand: Command = {
  type: 'local',
  name: 'health',
  description: '系统健康检查与状态诊断（内存/CPU/运行时间/组件状态）',
  aliases: ['status', 'healthcheck', 'sysinfo'],
  argumentHint: '[quick|all|check <组件>|help]',
  load: loadDefault('./health/Health.js'),
};

/** 钩子系统 */
export const hooksCommand: Command = {
  type: 'local',
  name: 'hooks',
  description: '钩子系统管理和查看（查看已注册的钩子、统计信息和执行测试）',
  aliases: ['hook', 'triggers'],
  argumentHint: '[--list|-l] [--stats|-s] [--test|-t] [status] [--json] [help]',
  load: loadDefault('./hooks/Hooks.js'),
};

/** 知识库管理 */
export const knowledgeCommand: Command = {
  type: 'local',
  name: 'knowledge',
  description: '管理用户知识库（创建、编辑、删除、搜索文档）',
  aliases: ['kb', 'wiki', 'note'],
  argumentHint:
    '[list|<标题>|create <标题>|edit <标题>|delete <标题>|search <关键词>|help]',
  load: loadDefault('./knowledge/Knowledge.js'),
};

/** MCP 管理 */
export const mcpCommand: Command = {
  type: 'local',
  name: 'mcp',
  description:
    'MCP（Model Context Protocol）服务器查看和管理（列出服务器、工具和连接状态）',
  aliases: ['mcp-server', 'mcp-manager', 'model-context'],
  argumentHint:
    '[--list|-l] [--status|-s] [--tools|-t] [--test|-e] [status] [install <name>] [run <action>] [--json] [help]',
  load: loadDefault('./mcp/MCP.js'),
};

/** 记忆文件管理 */
export const memoryCommand: Command = {
  type: 'local',
  name: 'memory',
  description: '记忆文件管理（查看、创建、编辑、删除 .md 记忆文件）',
  aliases: ['mem', '记忆'],
  argumentHint:
    '[--list|-l] [--create|-c <name>] [--show|-s <name>] [--edit|-e <name>] [--delete|-d <name>] [status] [--json] [help]',
  load: loadDefault('./memory/Memory.js'),
};

/** 入手指引 */
export const onboardCommand: Command = {
  type: 'local',
  name: 'onboard',
  description: '应用入手指引和新手向导（启动配置向导/查看状态/快速入门）',
  aliases: ['welcome', 'setup', 'getting-started'],
  argumentHint: '[status|reset|skip|quick|model|soul|channel|help]',
  load: loadDefault('./onboard/Onboard.js'),
};

/** 权限管理 */
export const permissionsCommand: Command = {
  type: 'local',
  name: 'permissions',
  description: '权限管理（权限模式切换、规则管理、细粒度控制）',
  aliases: ['perm', 'auth', 'permission'],
  argumentHint:
    '[list|show|grant|revoke|status|mode|rules|add|remove|resource|role|user|help]',
  load: loadDefault('./permissions/Permissions.js'),
};

/** 插件管理 */
export const pluginsCommand: Command = {
  type: 'local',
  name: 'plugins',
  description: '插件管理和状态查看（列出插件、查看状态和连接测试）',
  aliases: ['plugin', 'extensions'],
  argumentHint:
    '[--list|-l] [--status|-s] [--test|-t] [status] [--json] [help]',
  load: loadDefault('./plugins/Plugins.js'),
};

/** 模型定价 */
export const pricingCommand: Command = {
  type: 'local',
  name: 'pricing',
  description: '查看和管理模型定价',
  aliases: ['prices', 'model-pricing'],
  argumentHint: '[list|set|sync|reset|help] [--model=] [--json] [--source=]',
  load: loadDefault('./pricing/Pricing.js'),
};

/** 任务管理 */
export const tasksCommand: Command = {
  type: 'local',
  name: 'tasks',
  description: '任务管理与跟踪（创建/查看/完成/删除/统计）',
  aliases: ['task', 'todo', 'todos'],
  argumentHint: '[list|add|done|delete|priority|stats|<ID>|help]',
  load: loadDefault('../../tasks/tasks.js'),
};

/** 思考回放动画 */
export const thinkbackPlayCommand: Command = {
  type: 'local',
  name: 'thinkback-play',
  description: '回放思考过程动画',
  aliases: [],
  argumentHint: '<思考记录ID>',
  load: loadDefault('./thinkback-play/ThinkbackPlay.js'),
};

/** Token 统计 */
export const tokensCommand: Command = {
  type: 'local',
  name: 'tokens',
  description: '显示 Token 使用统计',
  aliases: ['token-stats'],
  argumentHint: '[--breakdown|-b|--json|--reset|help]',
  load: loadDefault('./tokens/Tokens.js'),
};

/** 卸载组件 */
export const uninstallCommand: Command = {
  type: 'local',
  name: 'uninstall',
  description: '卸载组件（插件、技能、工具、主题、Agent等）',
  aliases: ['remove', 'delete-component'],
  argumentHint: '<类型> <名称> [--confirm|--force|help]',
  load: loadDefault('./uninstall/Uninstall.js'),
};

/** 使用统计 */
export const usageCommand: Command = {
  type: 'local',
  name: 'usage',
  description: '显示详细的使用统计和趋势分析',
  aliases: ['statistics', 'usage-stats'],
  argumentHint:
    '[--trends|-t] [--commands|-c] [--tools|-o] [--behavior|-b] [--performance|-p] [status] [--json] [help]',
  load: loadDefault('./usage/Usage.js'),
};
