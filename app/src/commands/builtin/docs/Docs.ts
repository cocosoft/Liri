/**
 * Docs命令实现
 * 文档查看与搜索
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { fileDocsProvider } from '@modules/docs/FileDocsProvider.js';
import type { FileDocEntry } from '@modules/docs/FileDocsProvider.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:docs:Docs',
  level: LogLevel.INFO,
});

interface DocSection {
  title: string;
  content: string;
  keywords: string[];
}

const DOC_SECTIONS: DocSection[] = [
  {
    title: '快速开始',
    content: [
      '快速开始指南帮助你迅速上手 Liri。',
      '',
      '1. 启动应用后，直接输入 /help 查看所有可用命令',
      '2. 使用 /chat 命令开启对话模式',
      '3. 使用 /skill list 查看已安装的技能',
      '4. 使用 /config 命令配置应用设置',
      '',
      '更多详情请访问官方文档网站。',
    ].join('\n'),
    keywords: ['quickstart', 'start', 'begin', '开始', '入门', '快速'],
  },
  {
    title: '命令系统',
    content: [
      'Liri 拥有丰富的命令系统：',
      '',
      '基础命令:',
      '  /help     - 显示帮助信息',
      '  /status   - 显示系统状态',
      '  /version  - 显示版本信息',
      '  /clear    - 清空屏幕',
      '  /exit     - 退出应用',
      '',
      '文件操作:',
      '  /read     - 读取文件内容',
      '  /write    - 写入文件内容',
      '  /search   - 搜索文件内容',
      '  /list     - 列出目录内容',
      '',
      '技能与插件:',
      '  /skill    - 管理技能',
      '  /plugins  - 管理插件',
      '  /upgrade  - 检查更新',
      '',
      '使用 /help <命令名> 获取具体命令的帮助信息。',
    ].join('\n'),
    keywords: ['command', 'commands', '命令', 'cmd', '指令'],
  },
  {
    title: '工具系统',
    content: [
      'Liri 提供了一系列内置工具：',
      '',
      '文件工具:',
      '  FileReadTool  - 读取文件内容，支持多种格式',
      '  FileEditTool  - 编辑文件内容，支持搜索替换',
      '  FileWriteTool - 写入文件内容',
      '',
      '搜索工具:',
      '  SearchTool    - 搜索项目文件',
      '  GlobTool      - 使用 Glob 模式匹配文件',
      '',
      '网络工具:',
      '  WebFetchTool  - 获取网页内容',
      '  WebSearchTool - 执行网络搜索',
      '',
      '使用 /tool <工具名> 查看具体工具的详细信息。',
    ].join('\n'),
    keywords: ['tool', 'tools', '工具', '功能', 'capability'],
  },
  {
    title: '技能系统',
    content: [
      '技能系统允许你创建和复用自动化工作流：',
      '',
      '技能可以是:',
      '  - 用户技能: 保存在用户目录下的自定义技能',
      '  - 项目技能: 项目自带的技能文件',
      '  - 插件技能: 由插件提供的技能',
      '  - MCP 技能: 通过 MCP 协议加载的技能',
      '',
      '常用操作:',
      '  /skill list           - 列出所有技能',
      '  /skill info <名称>    - 查看技能详情',
      '  /skill run <名称>     - 执行技能',
      '  /skill reload         - 重新加载技能',
    ].join('\n'),
    keywords: ['skill', 'skills', '技能', '自动化', 'workflow'],
  },
  {
    title: '插件系统',
    content: [
      '插件系统扩展 Liri 的功能：',
      '',
      '插件类型:',
      '  - 功能插件: 添加新功能或命令',
      '  - 工具插件: 注册新工具',
      '  - 主题插件: 自定义界面主题',
      '  - 钩子插件: 在特定事件触发时执行',
      '',
      '常用操作:',
      '  /plugins list   - 列出所有已安装插件',
      '  /plugins status - 查看插件状态',
      '  /plugins --test - 测试插件连接',
      '',
      '使用 /plugins help 获取完整命令说明。',
    ].join('\n'),
    keywords: ['plugin', 'plugins', '插件', '扩展', 'extension'],
  },
  {
    title: 'Agent 系统',
    content: [
      'Agent 系统提供自主智能体能力：',
      '',
      'Agent 类型:',
      '  - 通用 Agent: 处理多种任务',
      '  - 代码 Agent: 专注于代码生成与分析',
      '  - 搜索 Agent: 执行信息检索任务',
      '',
      '常用操作:',
      '  /agent list    - 列出所有 Agent',
      '  /agent start   - 启动一个 Agent',
      '  /agent stop    - 停止一个 Agent',
      '',
      'Agent 支持多 Agent 协作模式，可同时运行多个 Agent 协同工作。',
    ].join('\n'),
    keywords: ['agent', 'agents', '智能体', 'ai', 'AI'],
  },
  {
    title: '配置管理',
    content: [
      'Liri 支持丰富的配置选项：',
      '',
      '配置类别:',
      '  - 主题配置: 自定义界面主题和颜色',
      '  - 模型配置: 选择 AI 模型和参数',
      '  - 工具配置: 启用/禁用工具',
      '  - 安全配置: 管理权限和安全策略',
      '',
      '常用操作:',
      '  /config list           - 列出所有配置项',
      '  /config get <key>     - 获取配置值',
      '  /config set <key> <值> - 设置配置值',
      '  /theme list            - 列出可用主题',
      '',
      '配置文件保存在用户目录下的 ~/.pyapp/config.json。',
    ].join('\n'),
    keywords: ['config', 'configuration', '配置', '设置', 'settings'],
  },
  {
    title: '会话管理',
    content: [
      'Liri 的会话系统管理你的工作状态：',
      '',
      '会话功能:',
      '  - 多会话支持: 同时管理多个工作会话',
      '  - 会话持久化: 会话状态自动保存',
      '  - 会话恢复: 重启后可恢复之前的会话',
      '',
      '常用操作:',
      '  /session list    - 列出所有会话',
      '  /session switch  - 切换会话',
      '  /session close   - 关闭当前会话',
      '',
      '每个会话独立维护上下文和历史记录。',
    ].join('\n'),
    keywords: ['session', 'sessions', '会话', '历史', 'history'],
  },
  {
    title: '安全与权限',
    content: [
      'Liri 实现了多层次安全机制：',
      '',
      '安全特性:',
      '  - 命令沙箱: 在隔离环境中执行命令',
      '  - 文件系统权限: 控制文件访问范围',
      '  - 网络请求过滤: 防止 SSRF 攻击',
      '  - 敏感信息保护: 自动检测和脱敏',
      '',
      '常用操作:',
      '  /security status   - 查看安全状态',
      '  /security scan     - 执行安全扫描',
      '  /permissions list  - 查看权限配置',
      '',
      '安全策略可通过 /config 命令自定义调整。',
    ].join('\n'),
    keywords: ['security', '安全', 'permission', '权限', 'privacy'],
  },
  {
    title: '性能与监控',
    content: [
      'Liri 提供性能监控和分析工具：',
      '',
      '监控指标:',
      '  - Token 使用统计',
      '  - API 调用延迟',
      '  - 内存使用情况',
      '  - 命令执行时间',
      '',
      '常用操作:',
      '  /performance report   - 生成性能报告',
      '  /performance snapshot - 查看实时快照',
      '  /usage                - 查看用量统计',
      '  /cost                 - 查看费用统计',
      '',
      '使用 /tokens 查看详细的 Token 使用情况。',
    ].join('\n'),
    keywords: ['performance', '性能', '监控', 'monitor', 'metrics'],
  },
  {
    title: '通知系统',
    content: [
      'Liri 的通知系统提供事件驱动的消息推送能力：',
      '',
      '通知类型:',
      '  - info     - 信息提示（一般性通知）',
      '  - success  - 成功提示（操作完成确认）',
      '  - warning  - 警告提示（需要注意的情况）',
      '  - error    - 错误提示（操作失败通知）',
      '',
      '内置通知钩子:',
      '  - 启动通知（useStartupNotification）      - 应用启动时推送状态信息',
      '  - 插件安装通知（usePluginInstallationNotification） - 插件安装失败时告警',
      '  - 任务完成通知（useTaskCompletionNotification）  - 任务完成/失败/取消时通知',
      '',
      '通知优先级:',
      '  - low      - 低优先级，可延迟查看',
      '  - medium   - 中优先级，常规提醒',
      '  - high     - 高优先级，需要立即关注',
      '',
      '使用 /hooks 查看所有已注册的钩子和通知事件。',
    ].join('\n'),
    keywords: [
      'notification',
      'notif',
      '通知',
      '提醒',
      'alert',
      'hook',
      '钩子',
    ],
  },
];

const docsCommand = {
  /** 文件文档缓存 */
  _fileDocCache: null as FileDocEntry[] | null,

  /**
   * 初始化文件文档缓存
   */
  async _ensureFileDocs(): Promise<FileDocEntry[]> {
    if (!this._fileDocCache) {
      this._fileDocCache = await fileDocsProvider.buildIndex();
    }
    return this._fileDocCache;
  },

  /**
   * 执行 docs 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const cleanArgs = args.trim().toLowerCase();

      if (
        cleanArgs === 'help' ||
        cleanArgs === '--help' ||
        cleanArgs === '-h'
      ) {
        return this.showHelp();
      }

      if (
        cleanArgs === 'list' ||
        cleanArgs === '--list' ||
        cleanArgs === '-l'
      ) {
        return this.listSections();
      }

      if (
        cleanArgs === '' ||
        cleanArgs === 'overview' ||
        cleanArgs === 'index'
      ) {
        return this.showOverview();
      }

      if (cleanArgs.startsWith('search') || cleanArgs.startsWith('find')) {
        const query = cleanArgs.replace(/^(search|find)\s+/, '');
        if (!query) {
          return {
            success: false,
            type: 'text',
            message: '请提供搜索关键词: /docs search <关键词>',
          };
        }
        return this.searchDocs(query);
      }

      // 先在硬编码章节中查找
      const section = DOC_SECTIONS.find(
        (s) => s.title.toLowerCase() === cleanArgs
      );
      if (section) {
        return this.showSection(section);
      }

      // 未找到时，尝试从 docs/ 目录加载
      const fileDocs = await this._ensureFileDocs();
      const matchedFile = fileDocs.find(
        (d) =>
          d.title.toLowerCase() === cleanArgs ||
          d.relativePath.toLowerCase().replace(/\.md$/i, '') === cleanArgs ||
          d.fileName.toLowerCase().replace(/\.md$/i, '') === cleanArgs
      );
      if (matchedFile) {
        const lines = [`📄 ${matchedFile.title}`, '', matchedFile.content];
        return { success: true, type: 'text', message: lines.join('\n') };
      }

      return this.searchDocs(cleanArgs);
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Docs 文档命令使用帮助',
      '',
      '用法:',
      '  /docs                       - 显示文档概览',
      '  /docs list                  - 列出所有文档章节',
      '  /docs <章节名>               - 查看指定章节',
      '  /docs search <关键词>        - 搜索文档内容',
      '  /docs help                  - 显示此帮助信息',
      '',
      '内置章节:',
      ...DOC_SECTIONS.map((s) => `  - ${s.title}`),
      '',
      'docs/ 目录下的所有 markdown 文件也可直接通过路径或标题访问。',
      '',
      '示例:',
      '  /docs 快速开始',
      '  /docs search 技能',
      '  /docs list',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 列出所有文档章节（内置 + 文件）
   */
  async listSections(): Promise<CommandResult> {
    const fileDocs = await this._ensureFileDocs();
    const lines = [
      '📚 文档章节列表',
      '',
      '内置章节:',
      ...DOC_SECTIONS.map((s, i) => `  ${i + 1}. ${s.title}`),
      '',
      `文件章节 (docs/):`,
      ...fileDocs.map(
        (d, i) => `  ${i + 1}. ${d.title} (docs/${d.relativePath})`
      ),
      '',
      `共 ${DOC_SECTIONS.length + fileDocs.length} 个章节`,
      '',
      '使用 /docs <章节名> 查看具体内容。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 显示文档概览
   */
  async showOverview(): Promise<CommandResult> {
    const fileDocs = await this._ensureFileDocs();
    const lines = [
      '📖 Liri 文档中心',
      '',
      '欢迎使用 Liri 文档系统。',
      '这里提供应用所有功能的详细说明和指南。',
      '',
      '快速链接:',
      ...DOC_SECTIONS.map((s) => `  📄 ${s.title}`),
      '',
      'docs/ 目录文档:',
      ...fileDocs.map((d) => `  📄 ${d.title}`),
      '',
      '官网: https://openliri.com',
      '',
      '常用命令:',
      '  /docs list           - 查看所有文档章节',
      '  /docs <章节名>       - 查看具体章节',
      '  /docs search <关键词> - 搜索文档',
      '  /docs help           - 查看文档命令帮助',
      '',
      '提示: 直接输入 /docs <关键词> 会自动搜索相关内容。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 显示指定章节
   */
  showSection(section: DocSection): CommandResult {
    const lines = [`📄 ${section.title}`, '', section.content];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 搜索文档内容（内置 + 文件）
   */
  async searchDocs(query: string): Promise<CommandResult> {
    const lowerQuery = query.toLowerCase();

    const results = DOC_SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(lowerQuery) ||
        s.content.toLowerCase().includes(lowerQuery) ||
        s.keywords.some((k) => k.toLowerCase().includes(lowerQuery))
    );

    // 同时在文件文档中搜索
    const fileDocs = await this._ensureFileDocs();
    const fileResults = fileDocs.filter(
      (d) =>
        d.title.toLowerCase().includes(lowerQuery) ||
        d.content.toLowerCase().includes(lowerQuery) ||
        d.category.toLowerCase().includes(lowerQuery)
    );

    const total = results.length + fileResults.length;

    if (total === 0) {
      return {
        success: true,
        type: 'text',
        message: `未找到与"${query}"相关的文档内容。\n\n请尝试使用 /docs list 查看所有可用章节。`,
      };
    }

    const lines = [
      `🔍 找到 ${total} 个与"${query}"相关的结果`,
      '',
      ...(results.length > 0
        ? [
            '内置章节:',
            ...results.map(
              (s, i) =>
                `${i + 1}. ${s.title}\n   ${s.content.split('\n')[0].replace(/[#*]/g, '').trim()}`
            ),
            '',
          ]
        : []),
      ...(fileResults.length > 0
        ? [
            'docs/ 目录文档:',
            ...fileResults.map(
              (d, i) =>
                `${i + 1}. ${d.title} (docs/${d.relativePath})\n   ${d.content.split('\n')[0].replace(/[#*]/g, '').trim()}`
            ),
            '',
          ]
        : []),
      '使用 /docs <章节名> 查看完整内容。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },
};

export default docsCommand;
