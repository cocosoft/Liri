/**
 * 帮助系统
 *
 * 提供交互式帮助功能
 */

import { keyboardShortcuts } from '../ui/KeyboardShortcuts';
import { ThemeManager } from '../ui/ThemeManager';
import { exampleCommands } from './ExampleCommands';
import { releaseNotes } from './ReleaseNotes';
import { languageManager } from './i18n/LanguageManager';
import { contextHelp } from './ContextHelp';
import { FileDocsProvider, fileDocsProvider } from './FileDocsProvider';

/**
 * 上下文类型
 */
export enum ContextType {
  COMMAND = 'command',
  TOOL = 'tool',
  SKILL = 'skill',
  ERROR = 'error',
  GENERAL = 'general',
  EDITOR = 'editor',
  TERMINAL = 'terminal',
  PLUGIN = 'plugin',
  SETTINGS = 'settings',
  PROJECT = 'project',
  DEBUG = 'debug',
  TEST = 'test',
  DEPLOYMENT = 'deployment',
  PERFORMANCE = 'performance',
  SECURITY = 'security',
  NETWORK = 'network',
  FILESYSTEM = 'filesystem',
}

/**
 * 上下文接口
 */
export interface Context {
  type: ContextType;
  name?: string;
  args?: Record<string, unknown>;
  currentFile?: string;
  currentDirectory?: string;
  currentCommand?: string;
  currentTool?: string;
  currentSkill?: string;
  errorCode?: string;
  environment?: string;
  platform?: string;
  userRole?: string;
  projectType?: string;
  [key: string]: any;
}

export interface HelpTopic {
  id: string;
  title: string;
  description: string;
  content: string;
  relatedTopics?: string[];
  keywords?: string[];
}

export class HelpSystem {
  private static instance: HelpSystem | null = null;
  private topics: Map<string, HelpTopic> = new Map();
  private listeners: Set<(topic: HelpTopic | null) => void> = new Set();
  private currentTopic: HelpTopic | null = null;

  private constructor() {
    this.registerDefaultTopics();
  }

  static getInstance(): HelpSystem {
    if (!HelpSystem.instance) {
      HelpSystem.instance = new HelpSystem();
    }
    return HelpSystem.instance;
  }

  /**
   * 注册默认帮助主题
   */
  private registerDefaultTopics(): void {
    this.registerTopic({
      id: 'quickstart',
      title: '快速开始',
      description: '了解PY_APP的基本使用方法',
      content: `
# 快速开始

## 基本概念

PY_APP是一个智能编程助手，帮助你更高效地编写代码。

## 常用命令

- \`/help\` - 显示帮助信息
- \`/tools\` - 列出所有可用工具
- \`/skills\` - 列出所有可用技能
- \`/stats\` - 显示系统统计信息
- \`/doctor\` - 运行系统诊断

## 快捷键

- \`Ctrl+C\` - 中断当前操作
- \`Ctrl+Z\` - 撤销
- \`Ctrl+D\` - 复制
- \`Ctrl+U\` - 清除行

## 技巧

1. 使用自然语言描述你的需求
2. 明确说明期望的结果
3. 提供相关的上下文信息
`,
      relatedTopics: ['commands', 'shortcuts', 'tips'],
      keywords: ['快速开始', '入门', '基础', 'quickstart'],
    });

    this.registerTopic({
      id: 'commands',
      title: '命令参考',
      description: '所有可用命令的详细说明',
      content: `
# 命令参考

## 系统命令

### /help [topic]
显示帮助信息。可以指定主题名称来查看特定帮助。

### /tool
管理系统工具。

别名: \`/tools\`, \`/t\`

子命令:
- \`/tool list\` - 列出所有可用工具
- \`/tool enable <工具名>\` - 启用指定工具
- \`/tool disable <工具名>\` - 禁用指定工具

示例:
- \`/tool list\` - 查看所有工具
- \`/tool enable bash\` - 启用bash工具
- \`/tool disable websearch\` - 禁用网络搜索工具

### /skills
列出所有可用技能及其描述。

### /stats
显示系统统计信息，包括会话数、工具使用情况等。

### /doctor
运行系统诊断，检查环境配置和问题。

### /config
管理系统配置。

子命令:
- \`/config list\` - 列出所有配置项
- \`/config get <key>\` - 获取指定配置项的值
- \`/config set <key> <value>\` - 设置配置项的值

示例:
- \`/config list\` - 查看所有配置
- \`/config get model\` - 获取模型配置
- \`/config set theme light\` - 设置主题为亮色

### /compact
手动压缩对话历史，减少上下文大小。

别名: \`/compress\`, \`/shrink\`

选项:
- \`--preserve-recent <number>\` - 保留最近的消息数量（默认5）
- \`--no-summarize\` - 不生成摘要
- \`--no-extract-key-info\` - 不提取关键信息

示例:
- \`/compact\` - 压缩对话历史（保留最近5条）
- \`/compact --preserve-recent 10\` - 压缩对话历史，保留最近10条消息
- \`/compact --no-summarize\` - 压缩对话历史，不生成摘要

### /exit
退出应用程序。

别名: \`/quit\`, \`/q\`

选项:
- \`--force\` - 强制退出，不保存当前会话

示例:
- \`/exit\` - 退出应用（会提示确认）
- \`/exit --force\` - 强制退出，不确认

### /advisor
代码建议和优化顾问，提供代码质量分析、性能分析和安全性分析。

子命令:
- \`/advisor code <文件路径>\` - 分析代码质量
- \`/advisor performance <文件路径>\` - 分析性能
- \`/advisor security <文件路径>\` - 分析安全性

示例:
- \`/advisor code ./src/index.ts\` - 分析指定文件的代码质量
- \`/advisor performance ./src/utils/\` - 分析性能
- \`/advisor security ./src/auth/\` - 分析安全性

### /brief
生成当前会话的摘要，提取关键信息和决策点。

选项:
- \`--length=<数字>\` - 摘要最大长度（默认1000）
- \`--count=<数字>\` - 考虑的消息数量（默认20）
- \`--type=<类型>\` - 摘要类型：concise（简洁）、detailed（详细）、actionable（可操作）

示例:
- \`/brief\` - 生成简洁摘要
- \`/brief --length=2000\` - 生成2000字符的摘要
- \`/brief --type=detailed\` - 生成详细摘要
- \`/brief --count=50 --type=actionable\` - 基于50条消息生成可操作摘要

### /cache
管理工具缓存。

子命令:
- \`/cache clear [工具名称]\` - 清除缓存（可选指定工具名称）
- \`/cache stats\` - 显示缓存统计信息
- \`/cache size\` - 显示缓存大小
- \`/cache list [工具名称]\` - 列出缓存项（可选指定工具名称）
- \`/cache info <工具名称>\` - 显示指定工具的缓存详情
- \`/cache purge\` - 清除所有缓存（包括未过期的）
- \`/cache cleanup\` - 清理过期的缓存项

示例:
- \`/cache clear\` - 清除所有工具缓存
- \`/cache clear bash\` - 清除bash工具的缓存
- \`/cache stats\` - 查看缓存统计信息
- \`/cache size\` - 查看缓存大小
- \`/cache list\` - 列出所有缓存项
- \`/cache list git\` - 列出git工具的缓存项
- \`/cache info bash\` - 显示bash工具的缓存详情
- \`/cache cleanup\` - 清理过期缓存

### /chat
与LLM进行对话。

别名: \`/c\`, \`/talk\`

用法:
- \`/chat <消息内容> [选项]\` - 发送消息给LLM

选项:
- \`--stream\` - 使用流式输出
- \`--model=<模型名称>\` - 指定使用的模型

示例:
- \`/chat 你好\` - 向LLM打招呼
- \`/chat 帮我写一段Python代码\` - 请求代码帮助
- \`/chat 解释一下这个概念\` - 请求解释
- \`/chat --stream 请给我写一个算法\` - 使用流式输出
- \`/chat --model=gpt-4 请分析这段代码\` - 指定模型

注意: 需要配置 DEEPSEEK_API_KEY 环境变量才能使用此命令。

## 历史记录命令

### /history show [数量]
显示历史命令记录。数量参数可选，默认显示最近10条。

示例:
- \`/history show\` - 显示最近10条历史记录
- \`/history show 50\` - 显示最近50条历史记录
- \`/history show 100\` - 显示最近100条历史记录

### /history clear
清空所有历史记录。

### /history search <关键词>
搜索包含指定关键词的历史记录。

## 技能管理命令

### /skill list
列出所有可用技能。

### /skill info <技能名>
查看技能的详细信息，包括描述、参数和使用场景。

### /skill enable <技能名>
启用指定的技能。

### /skill disable <技能名>
禁用指定的技能。

## 版本控制命令

### /branch
管理Git分支。查看、创建、切换和删除分支。

### /diff
查看代码差异。比较工作区和暂存区的差异。

### /review
启动代码审查流程。

### /tag
管理Git标签。创建、列出和删除标签。

## 会话管理命令

### /session
管理会话（创建、切换、删除会话等）。

子命令:
- \`/session list\` - 列出所有可用会话
- \`/session create <title>\` - 创建新会话
- \`/session switch <session_id>\` - 切换到指定会话
- \`/session delete <session_id>\` - 删除指定会话
- \`/session rename <id> <title>\` - 重命名会话
- \`/session info <session_id>\` - 显示会话详情
- \`/session current\` - 显示当前会话

示例:
- \`/session list\` - 查看所有会话
- \`/session create "My Project"\` - 创建名为 "My Project" 的新会话
- \`/session switch session_123456\` - 切换到指定会话
- \`/session delete session_123456\` - 删除指定会话
- \`/session current\` - 查看当前会话信息

## 聊天增强命令

### /fast
启用快速模式，获得简洁、重点突出的响应。

### /btw
添加旁注或额外上下文。

### /plan
生成任务计划。

### /advisor
获取智能建议和推荐。

## 文件操作命令

### /convert <file_path>
将文件转换为 Markdown 格式。

别名: 无

支持的格式:
- 文本类: .txt .md .json .csv .tsv .xml .html .yaml
- Office: .docx .xlsx .xls .pptx
- 文档类: .pdf .epub
- 媒体类: .jpg .png .gif .bmp .svg .webp .mp3 .wav .m4a .flac .ogg
- 其他: .ipynb .rss .atom .msg .zip

示例:
- \`/convert document.docx\` - 将 Word 文档转换为 Markdown
- \`/convert report.pdf\` - 将 PDF 转换为 Markdown
- \`/convert notebook.ipynb\` - 将 Jupyter Notebook 转换为 Markdown

注意: 部分格式需要安装相应的可选依赖，缺失时会提示安装命令。

### /write <file_path> <content>
将内容写入文件。

### /edit <file_path>
编辑文件内容。

### /glob <pattern>
路径匹配和文件搜索。

### /bash <command>
执行 Shell 命令。

### /grep <pattern>
文本搜索和模式匹配。
`,
      relatedTopics: ['quickstart', 'shortcuts'],
      keywords: ['命令', 'command', '参考'],
    });

    this.registerTopic({
      id: 'shortcuts',
      title: '快捷键',
      description: '键盘快捷键列表',
      content: `
# 快捷键

## 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+C | 中断当前操作 |
| Ctrl+Z | 撤销 |
| Ctrl+D | 复制 |
| Ctrl+U | 清除当前行 |

## 导航快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+A | 移动到行首 |
| Ctrl+E | 移动到行尾 |
| Ctrl+K | 删除到行尾 |
| Ctrl+W | 删除上一个单词 |

## 搜索快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+F | 向前搜索 |
| Ctrl+B | 向后搜索 |
| Ctrl+R | 替换 |
`,
      relatedTopics: ['quickstart', 'commands'],
      keywords: ['快捷键', 'shortcut', 'keyboard'],
    });

    this.registerTopic({
      id: 'tools',
      title: '工具列表',
      description: '所有可用工具的详细说明',
      content: `
# 工具列表

## 文件操作工具

### FileReadTool
读取文件内容。自动识别文件格式，对二进制文件（如 .docx、.pdf、.xlsx 等）自动转换为 Markdown。

### FileWriteTool
写入文件内容。

### FileEditTool
编辑文件内容。

### FileConvertTool
将文件转换为 Markdown 格式。支持多种文件格式，包括 Office 文档、PDF、图片、音频等。

### GlobTool
路径匹配和文件搜索。

### GrepTool
文本搜索和模式匹配。

## 开发工具

### WebSearchTool
网络搜索。

### WebFetchTool
获取网页内容。

### LSPTool
语言服务器协议工具，提供代码智能提示。

### NotebookToolAdapter
Notebook 创建和执行工具（替代 NotebookEditTool）。

## 系统工具

### BashTool
执行Shell命令。

### TaskTool
任务管理。

### SkillTool
技能执行。

## 语音工具

### VoiceInputTool
语音输入。

### VoiceOutputTool
语音输出。
`,
      relatedTopics: ['commands', 'skills'],
      keywords: ['工具', 'tool', '列表'],
    });

    this.registerTopic({
      id: 'skills',
      title: '技能列表',
      description: '所有可用技能的详细说明',
      content: `
# 技能列表

## 内置技能

### debug
启用调试日志并帮助诊断问题。

用法: \`/skill info debug\`

### loop
按定期间隔运行提示或命令。

用法: \`/skill info loop\`

### simplify
简化和解释复杂代码。

用法: \`/skill info simplify\`

### remember
记住信息供以后参考。

用法: \`/skill info remember\`

### verify
验证代码变更并建议改进。

用法: \`/skill info verify\`

### batch
批量处理多个文件或任务。

用法: \`/skill info batch\`

### stuck
当用户遇到问题卡住时提供帮助。

用法: \`/skill info stuck\`

## 测试技能

### test-skill
用于验证技能系统的测试技能。

## 技能管理命令

### /skill list
列出所有可用技能。

### /skill info <技能名>
查看技能详细信息。

### /skill enable <技能名>
启用指定技能。

### /skill disable <技能名>
禁用指定技能。

## 技能来源

技能来自以下来源：
- **内置技能** (bundled) - 随应用一起发布的核心技能
- **用户技能** (user) - 用户自定义的技能
- **项目技能** (project) - 项目级别的技能
- **插件技能** (plugin) - 通过插件安装的技能
- **MCP技能** (mcp) - 通过MCP协议获取的技能
`,
      relatedTopics: ['commands', 'tools'],
      keywords: ['技能', 'skill', '列表'],
    });

    this.registerTopic({
      id: 'examples',
      title: '示例命令',
      description: '常用示例命令，帮助你快速上手',
      content: `
# 示例命令

## 常用命令示例

- **fix lint errors** - 修复代码中的 lint 错误
- **fix typecheck errors** - 修复类型检查错误
- **how does [file] work?** - 解释文件的工作原理
- **refactor [file]** - 重构指定文件
- **how do I log an error?** - 学习如何记录错误
- **edit [file] to...** - 编辑文件以实现特定功能
- **write a test for [file]** - 为指定文件编写测试
- **create a util logging.py that...** - 创建一个工具文件

## 基于项目的示例

${this.getExampleCommandsContent()}
`,
      relatedTopics: ['quickstart', 'commands'],
      keywords: ['示例', 'example', '命令', 'command'],
    });

    this.registerTopic({
      id: 'release-notes',
      title: '释放说明',
      description: '版本更新的释放说明',
      content: `
# 释放说明

${this.getReleaseNotesContent()}

## 查看完整释放说明

你可以在 GitHub 上查看完整的释放说明：
[查看完整释放说明](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
`,
      relatedTopics: ['quickstart'],
      keywords: ['释放说明', '版本更新', 'changelog', 'release notes'],
    });
  }

  /**
   * 注册帮助主题
   * @param topic 帮助主题
   */
  registerTopic(topic: HelpTopic): void {
    this.topics.set(topic.id, topic);

    if (topic.keywords) {
      for (const keyword of topic.keywords) {
        this.topics.set(`keyword:${keyword}`, topic);
      }
    }
  }

  /**
   * 注销帮助主题
   * @param topicId 主题ID
   */
  unregisterTopic(topicId: string): boolean {
    const topic = this.topics.get(topicId);
    if (topic) {
      if (topic.keywords) {
        for (const keyword of topic.keywords) {
          this.topics.delete(`keyword:${keyword}`);
        }
      }
      return this.topics.delete(topicId);
    }
    return false;
  }

  /**
   * 获取帮助主题
   * @param id 主题ID或关键词
   */
  getTopic(id: string): HelpTopic | undefined {
    return this.topics.get(id);
  }

  /**
   * 搜索帮助主题
   * @param query 搜索查询
   */
  search(query: string): HelpTopic[] {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) {
      return [];
    }

    const results: Array<{ topic: HelpTopic; score: number }> = [];
    const seen = new Set<string>();

    for (const topic of this.topics.values()) {
      if (topic.id === 'keyword:' + lowerQuery || seen.has(topic.id)) {
        continue;
      }

      const score = this.calculateSearchScore(topic, lowerQuery);
      if (score > 0) {
        results.push({ topic, score });
        seen.add(topic.id);
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    // 返回前10个结果
    return results.slice(0, 10).map((item) => item.topic);
  }

  /**
   * 计算搜索分数
   * @param topic 帮助主题
   * @param query 搜索查询
   */
  private calculateSearchScore(topic: HelpTopic, query: string): number {
    let score = 0;
    const queryWords = query.split(/\s+/);

    // 标题匹配 (最高权重)
    if (topic.title.toLowerCase().includes(query)) {
      score += 100;
    } else if (topic.title.toLowerCase().includes(queryWords[0])) {
      score += 50;
    }

    // 描述匹配 (高权重)
    if (topic.description.toLowerCase().includes(query)) {
      score += 80;
    } else if (topic.description.toLowerCase().includes(queryWords[0])) {
      score += 40;
    }

    // 关键词匹配 (中等权重)
    if (topic.keywords?.some((k) => k.toLowerCase().includes(query))) {
      score += 60;
    } else if (
      topic.keywords?.some((k) => k.toLowerCase().includes(queryWords[0]))
    ) {
      score += 30;
    }

    // 内容匹配 (低权重)
    if (topic.content.toLowerCase().includes(query)) {
      score += 40;
    } else if (topic.content.toLowerCase().includes(queryWords[0])) {
      score += 20;
    }

    // 精确匹配加分
    if (topic.title.toLowerCase() === query) {
      score += 200;
    } else if (topic.id === query) {
      score += 150;
    }

    return score;
  }

  /**
   * 获取搜索建议
   * @param query 搜索查询
   */
  getSearchSuggestions(query: string): string[] {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) {
      return [];
    }

    const suggestions = new Set<string>();

    // 从主题标题和关键词中获取建议
    for (const topic of this.topics.values()) {
      if (topic.id.startsWith('keyword:')) {
        continue;
      }

      if (topic.title.toLowerCase().includes(lowerQuery)) {
        suggestions.add(topic.title);
      }

      if (topic.keywords) {
        for (const keyword of topic.keywords) {
          if (keyword.toLowerCase().includes(lowerQuery)) {
            suggestions.add(keyword);
          }
        }
      }
    }

    // 返回前5个建议
    return Array.from(suggestions).slice(0, 5);
  }

  /**
   * 获取所有主题
   */
  getAllTopics(): HelpTopic[] {
    const topics = new Map<string, HelpTopic>();
    for (const [id, topic] of this.topics.entries()) {
      if (!id.startsWith('keyword:')) {
        topics.set(id, topic);
      }
    }
    return Array.from(topics.values());
  }

  /**
   * 显示主题
   * @param id 主题ID
   */
  showTopic(id: string): boolean {
    const topic = this.getTopic(id);
    if (topic) {
      this.currentTopic = topic;
      this.notifyListeners(topic);
      return true;
    }
    return false;
  }

  /**
   * 获取当前主题
   */
  getCurrentTopic(): HelpTopic | null {
    return this.currentTopic;
  }

  /**
   * 添加监听器
   * @param listener 监听器
   */
  addListener(listener: (topic: HelpTopic | null) => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   * @param listener 监听器
   */
  removeListener(listener: (topic: HelpTopic | null) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   * @param topic 主题
   */
  private notifyListeners(topic: HelpTopic | null): void {
    this.listeners.forEach((listener) => listener(topic));
  }

  /**
   * 格式化帮助内容
   * @param topic 帮助主题
   */
  formatTopic(topic: HelpTopic): string {
    return topic.content;
  }

  /**
   * 获取目录
   */
  getIndex(): { id: string; title: string; description: string }[] {
    return this.getAllTopics().map((topic) => ({
      id: topic.id,
      title: topic.title,
      description: topic.description,
    }));
  }

  /**
   * 获取工具帮助
   */
  getToolHelp(toolName: string): string | null {
    const topic = this.getTopic(toolName);
    return topic ? topic.content : null;
  }

  /**
   * 显示工具帮助
   */
  displayToolHelp(toolName: string): void {
    const help = this.getToolHelp(toolName);
    console.log(help || `没有找到工具 ${toolName} 的帮助`);
  }

  /**
   * 显示命令帮助
   */
  displayCommandHelp(commandName: string): void {
    const topic = this.getTopic(commandName);
    console.log(topic ? topic.content : `没有找到命令 ${commandName} 的帮助`);
  }

  /**
   * 显示完整帮助
   */
  displayFullHelp(): void {
    console.log('PY_APP 帮助系统');
    console.log('==============');
    this.getAllTopics().forEach((topic) => {
      console.log(`- ${topic.title}: ${topic.description}`);
    });
  }

  /**
   * 获取示例命令内容
   */
  private getExampleCommandsContent(): string {
    const examples = exampleCommands.getAllExamples();
    if (examples.length === 0) {
      return '根据项目文件生成的示例命令将显示在这里。';
    }

    let content = '常用示例命令：\n\n';
    examples.slice(0, 5).forEach((example) => {
      content += `- ${example.command}\n`;
      content += `  ${example.description}\n\n`;
    });

    return content;
  }

  /**
   * 从文件文档提供器加载帮助主题
   * 读取 docs/ 文件夹下的 Markdown 文件并注册为帮助主题
   */
  async loadFromFileDocs(provider: FileDocsProvider): Promise<number> {
    const entries = await provider.buildIndex();
    let count = 0;

    for (const entry of entries) {
      const topicId = entry.relativePath
        .replace(/\.md$/i, '')
        .replace(/[/\\]/g, '-')
        .toLowerCase();

      if (!this.topics.has(topicId)) {
        this.registerTopic({
          id: topicId,
          title: entry.title,
          description: `docs/${entry.relativePath}`,
          content: entry.content,
          keywords: [entry.title, entry.category, entry.fileName],
        });
        count++;
      }
    }

    return count;
  }

  /**
   * 获取按分类分组的文档索引
   */
  async getFileDocsIndex(
    provider: FileDocsProvider
  ): Promise<Record<string, Array<{ path: string; title: string }>>> {
    const entries = await provider.buildIndex();
    const groups: Record<string, Array<{ path: string; title: string }>> = {};

    for (const entry of entries) {
      if (!groups[entry.category]) {
        groups[entry.category] = [];
      }
      groups[entry.category].push({
        path: entry.relativePath,
        title: entry.title,
      });
    }

    return groups;
  }

  /**
   * 获取释放说明内容
   */
  private getReleaseNotesContent(): string {
    const releaseNotesList = releaseNotes.getAllReleaseNotes();
    if (releaseNotesList.length === 0) {
      return '释放说明将显示在这里。\n\n正在尝试从 GitHub 获取最新的释放说明...';
    }

    let content = '';
    releaseNotesList.slice(-3).forEach((note) => {
      content += `## ${note.version}${note.releaseDate ? ` - ${note.releaseDate}` : ''}\n\n`;
      note.notes.forEach((item) => {
        content += `- ${item}\n`;
      });
      content += '\n';
    });

    return content;
  }

  /**
   * 切换语言
   * @param languageCode 语言代码
   * @returns 是否切换成功
   */
  setLanguage(languageCode: string): boolean {
    const success = languageManager.setCurrentLanguage(languageCode);
    if (success) {
      // 重新注册默认主题以使用新语言
      this.topics.clear();
      this.registerDefaultTopics();
    }
    return success;
  }

  /**
   * 获取当前语言
   * @returns 当前语言代码
   */
  getCurrentLanguage(): string {
    return languageManager.getCurrentLanguage();
  }

  /**
   * 获取可用语言
   * @returns 可用语言列表
   */
  getAvailableLanguages(): Array<{
    code: string;
    name: string;
    nativeName: string;
  }> {
    return languageManager.getAvailableLanguages().map((pack) => ({
      code: pack.code,
      name: pack.name,
      nativeName: pack.nativeName,
    }));
  }

  /**
   * 翻译文本
   * @param key 翻译键
   * @param variables 变量替换
   * @returns 翻译后的文本
   */
  translate(key: string, variables: Record<string, string> = {}): string {
    return languageManager.translate(key, variables);
  }

  /**
   * 获取上下文相关的帮助
   * @param context 上下文信息
   * @returns 帮助内容
   */
  getContextHelp(context: Partial<Context>): string {
    const matchingHelp = contextHelp.findMatchingHelp({
      command: context.currentCommand,
      tool: context.currentTool,
      file: context.currentFile,
      error: context.errorCode,
    });

    if (matchingHelp.length === 0) {
      return '没有找到相关的帮助内容。';
    }

    return matchingHelp
      .map((entry) => contextHelp.formatHelpContent(entry))
      .join('\n\n');
  }

  /**
   * 显示上下文相关的帮助
   * @param context 上下文信息
   */
  showContextHelp(context: Partial<Context>): void {
    const helpContent = this.getContextHelp(context);
    console.log(helpContent);
  }

  /**
   * 自动检测上下文并显示相关帮助
   */
  showAutoContextHelp(): void {
    // 简化版的上下文检测
    const context = {
      command: '',
      tool: '',
      file: '',
      error: '',
    };
    this.showContextHelp(context);
  }

  /**
   * 获取上下文的建议操作
   * @param context 上下文信息
   * @returns 建议操作列表
   */
  getContextSuggestedActions(context: Partial<Context>): string[] {
    const matchingHelp = contextHelp.findMatchingHelp({
      command: context.currentCommand,
      tool: context.currentTool,
      file: context.currentFile,
      error: context.errorCode,
    });

    const suggestedActions: string[] = [];
    matchingHelp.forEach((entry) => {
      suggestedActions.push(...entry.relatedCommands);
    });

    return [...new Set(suggestedActions)].slice(0, 5);
  }

  /**
   * 注册上下文帮助映射
   * @param contextKey 上下文键
   * @param topicIds 帮助主题ID列表
   */
  registerContextHelpMapping(contextKey: string, topicIds: string[]): void {
    // 简化实现
    console.log(`注册上下文帮助映射: ${contextKey} -> ${topicIds.join(', ')}`);
  }
}

export const helpSystem = HelpSystem.getInstance();

export function getHelpSystem(): HelpSystem {
  return helpSystem;
}

export default helpSystem;

// 自动加载 docs/ 目录下的文件文档（非阻塞，后台加载）
helpSystem.loadFromFileDocs(fileDocsProvider).catch(() => {
  // 文件文档加载失败不影响核心功能
});
