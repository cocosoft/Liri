/**
 * 示例命令管理器
 * 管理示例命令的注册、获取和展示
 */

import { ExampleCommand, ExampleCategory } from './types.js';

/**
 * 默认示例命令
 */
const DEFAULT_EXAMPLES: ExampleCommand[] = [
  {
    id: 'fix-lint',
    category: ExampleCategory.GENERAL,
    description: '修复代码中的 lint 错误',
    command: 'fix lint errors',
    tags: ['fix', 'lint', 'error'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'fix-typecheck',
    category: ExampleCategory.GENERAL,
    description: '修复代码中的类型检查错误',
    command: 'fix typecheck errors',
    tags: ['fix', 'type', 'error'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'how-file-works',
    category: ExampleCategory.CODE_ANALYSIS,
    description: '了解文件的工作原理',
    command: 'how does <filepath> work?',
    tags: ['how', 'file', 'work'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'refactor-file',
    category: ExampleCategory.REFACTORING,
    description: '重构指定文件',
    command: 'refactor <filepath>',
    tags: ['refactor', 'file'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'write-test',
    category: ExampleCategory.TESTING,
    description: '为指定文件编写测试',
    command: 'write a test for <filepath>',
    tags: ['test', 'file'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'create-util',
    category: ExampleCategory.FILE_OPERATIONS,
    description: '创建工具文件',
    command: 'create a util <filename> that...',
    tags: ['create', 'util'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'git-status',
    category: ExampleCategory.GIT_OPERATIONS,
    description: '查看 Git 状态',
    command: 'show git status',
    tags: ['git', 'status'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'git-commit',
    category: ExampleCategory.GIT_OPERATIONS,
    description: '提交 Git 更改',
    command: '/commit "fix: 修复bug"',
    tags: ['git', 'commit'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'debug-error',
    category: ExampleCategory.DEBUGGING,
    description: '调试错误',
    command: 'debug this error',
    tags: ['debug', 'error'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'explain-code',
    category: ExampleCategory.CODE_ANALYSIS,
    description: '解释代码',
    command: 'explain this code',
    tags: ['explain', 'code'],
    usageCount: 0,
    createdAt: Date.now(),
  },
  {
    id: 'optimize-code',
    category: ExampleCategory.REFACTORING,
    description: '优化代码性能',
    command: 'optimize this code',
    tags: ['optimize', 'performance'],
    usageCount: 0,
    createdAt: Date.now(),
  },
];

/**
 * 示例命令管理器类
 */
export class ExampleCommands {
  private examples: Map<string, ExampleCommand> = new Map();
  private userExamples: Map<string, ExampleCommand> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    // 加载默认示例命令
    for (const example of DEFAULT_EXAMPLES) {
      this.examples.set(example.id, example);
    }
  }

  /**
   * 注册示例命令
   * @param example 示例命令
   */
  registerExample(example: ExampleCommand): void {
    this.userExamples.set(example.id, example);
  }

  /**
   * 获取示例命令
   * @param id 示例命令ID
   * @returns 示例命令或undefined
   */
  getExample(id: string): ExampleCommand | undefined {
    return this.examples.get(id) || this.userExamples.get(id);
  }

  /**
   * 获取所有示例命令
   * @returns 示例命令数组
   */
  getAllExamples(): ExampleCommand[] {
    return [
      ...Array.from(this.examples.values()),
      ...Array.from(this.userExamples.values()),
    ];
  }

  /**
   * 按分类获取示例命令
   * @param category 分类
   * @returns 示例命令数组
   */
  getExamplesByCategory(category: ExampleCategory): ExampleCommand[] {
    return this.getAllExamples().filter(
      (example) => example.category === category
    );
  }

  /**
   * 搜索示例命令
   * @param query 搜索关键词
   * @returns 匹配的示例命令数组
   */
  searchExamples(query: string): ExampleCommand[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllExamples().filter(
      (example) =>
        example.command.toLowerCase().includes(lowerQuery) ||
        example.description.toLowerCase().includes(lowerQuery) ||
        example.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 获取热门示例命令
   * @param limit 数量限制
   * @returns 热门示例命令数组
   */
  getPopularExamples(limit: number = 5): ExampleCommand[] {
    return this.getAllExamples()
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * 获取随机示例命令
   * @returns 随机示例命令
   */
  getRandomExample(): ExampleCommand | undefined {
    const allExamples = this.getAllExamples();
    if (allExamples.length === 0) {
      return undefined;
    }
    return allExamples[Math.floor(Math.random() * allExamples.length)];
  }

  /**
   * 记录示例命令使用
   * @param id 示例命令ID
   */
  recordUsage(id: string): void {
    const example = this.examples.get(id) || this.userExamples.get(id);
    if (example) {
      example.usageCount++;
      example.lastUsedAt = Date.now();
    }
  }

  /**
   * 删除示例命令
   * @param id 示例命令ID
   */
  removeExample(id: string): void {
    this.examples.delete(id);
    this.userExamples.delete(id);
  }

  /**
   * 清除所有用户自定义示例
   */
  clearUserExamples(): void {
    this.userExamples.clear();
  }

  /**
   * 获取示例命令数量
   * @returns 示例命令数量
   */
  getExampleCount(): number {
    return this.examples.size + this.userExamples.size;
  }

  /**
   * 格式化示例命令为字符串
   * @param example 示例命令
   * @returns 格式化字符串
   */
  formatExample(example: ExampleCommand): string {
    return `${example.description}\n  ${example.command}`;
  }

  /**
   * 获取格式化的示例命令列表
   * @param category 分类（可选）
   * @returns 格式化字符串数组
   */
  getFormattedExamples(category?: ExampleCategory): string[] {
    const examples = category
      ? this.getExamplesByCategory(category)
      : this.getAllExamples();

    return examples.map((example) => this.formatExample(example));
  }
}

// 导出单例实例
export const exampleCommands = new ExampleCommands();
