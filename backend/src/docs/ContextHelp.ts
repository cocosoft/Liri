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
- 使用 "git status" 查看状态
- 使用 "git diff" 查看差异
- 使用 "git log" 查看提交历史
- 使用 "git commit" 提交更改
    `.trim(),
    relatedCommands: ['git', 'commit', 'diff', 'log'],
    relatedTools: ['BashTool'],
    matchConditions: [
      { type: 'command', value: 'git', matchType: 'startsWith' },
      { type: 'command', value: 'commit', matchType: 'contains' },
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
