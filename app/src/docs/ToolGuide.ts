/**
 * 工具使用指南
 * 为每个工具提供详细说明和使用场景
 *
 * ⚠️ 【冻结】此文件已停止新增内容
 *
 * 新的工具指南请直接添加到 docs/工具参考/ 目录下的 Markdown 文件，
 * 不要在本文件中新增内容。未来将逐步将现有内容迁移到 docs/ 目录。
 */

import chalk from 'chalk';

interface ToolGuide {
  name: string;
  category: string;
  description: string;
  fullDescription: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: string;
  }>;
  examples: Array<{
    title: string;
    code: string;
    explanation: string;
  }>;
  bestPractices: string[];
  commonMistakes: string[];
  relatedTools: string[];
}

const toolGuideData: ToolGuide[] = [
  {
    name: 'SearchCodebase',
    category: '代码搜索',
    description: '在代码库中搜索内容',
    fullDescription:
      'SearchCodebase 是一个强大的代码搜索工具，可以根据自然语言描述查找代码。它使用语义搜索技术，能够理解代码的上下文和意图，而不仅仅是简单的字符串匹配。',
    parameters: [
      {
        name: 'information_request',
        type: 'string',
        required: true,
        description: '要搜索的信息，使用自然语言描述',
      },
      {
        name: 'target_directories',
        type: 'string[]',
        required: false,
        description: '要搜索的目标目录列表，如果不指定则搜索整个代码库',
        default: '整个代码库',
      },
    ],
    examples: [
      {
        title: '查找数据库连接代码',
        code: `SearchCodebase(
  information_request: "找到数据库连接相关的代码，包括连接池配置和数据库操作"
)`,
        explanation:
          '搜索整个代码库中与数据库连接相关的代码，包括连接池配置和CRUD操作。',
      },
      {
        title: '在特定目录中搜索',
        code: `SearchCodebase(
  information_request: "查找API路由定义和请求处理逻辑",
  target_directories: ["app/src/routes", "app/src/api"]
)`,
        explanation:
          '只在指定的目录中搜索API路由定义和请求处理逻辑，缩小搜索范围提高效率。',
      },
      {
        title: '查找React组件',
        code: `SearchCodebase(
  information_request: "找到所有React组件的定义，特别是使用Hooks的组件"
)`,
        explanation:
          '搜索所有React组件定义，重点关注使用Hooks（如useState、useEffect）的组件。',
      },
    ],
    bestPractices: [
      '使用明确的自然语言描述搜索意图',
      '尽可能缩小搜索范围到相关目录',
      '在搜索描述中包含技术术语和概念',
      '如果搜索结果太多，可以添加更多限定词',
    ],
    commonMistakes: [
      '使用过于模糊的搜索描述',
      '忘记指定目录导致搜索范围过大',
      '不检查搜索结果的相关性',
    ],
    relatedTools: ['Read', 'Glob'],
  },
  {
    name: 'Read',
    category: '文件操作',
    description: '读取文件内容',
    fullDescription:
      'Read 工具用于读取文件内容。它支持读取整个文件或指定行数的内容。读取的内容会带有行号标记，方便定位和引用。',
    parameters: [
      {
        name: 'file_path',
        type: 'string',
        required: true,
        description: '要读取的文件的绝对路径',
      },
      {
        name: 'offset',
        type: 'number',
        required: false,
        description: '起始行号（从0开始）',
        default: '0',
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: '最大读取行数',
        default: '200',
      },
    ],
    examples: [
      {
        title: '读取整个文件',
        code: `Read(
  file_path: "/project/src/index.ts"
)`,
        explanation: '读取指定文件的全部内容（最多200行）。',
      },
      {
        title: '读取文件的前N行',
        code: `Read(
  file_path: "/project/package.json",
  offset: 0,
  limit: 50
)`,
        explanation: '读取package.json文件的前50行内容。',
      },
      {
        title: '读取文件的中间部分',
        code: `Read(
  file_path: "/project/src/app.ts",
  offset: 100,
  limit: 50
)`,
        explanation: '从第100行开始读取，读取50行内容。',
      },
    ],
    bestPractices: [
      '先使用Glob找到正确的文件路径',
      '对于大文件使用offset和limit分段读取',
      '读取前确认文件存在',
      '注意文件编码格式',
    ],
    commonMistakes: [
      '使用相对路径而非绝对路径',
      '对非常大的文件不使用limit导致输出过长',
      '忘记检查文件是否存在',
    ],
    relatedTools: ['Write', 'Edit', 'Glob'],
  },
  {
    name: 'Write',
    category: '文件操作',
    description: '写入内容到文件',
    fullDescription:
      'Write 工具用于创建新文件或完全覆盖现有文件的内容。它接受文件路径和内容字符串，将内容写入指定文件。如果文件不存在会自动创建。',
    parameters: [
      {
        name: 'file_path',
        type: 'string',
        required: true,
        description: '要写入的文件的绝对路径',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: '要写入的完整内容字符串',
      },
    ],
    examples: [
      {
        title: '创建新配置文件',
        code: `Write(
  file_path: "/project/config/default.json",
  content: JSON.stringify({
    api_url: "https://api.example.com",
    timeout: 5000,
    retry_count: 3
  }, null, 2)
)`,
        explanation: '创建一个新的JSON配置文件，并格式化输出。',
      },
      {
        title: '创建新的代码文件',
        code: `Write(
  file_path: "/project/src/utils/helpers.ts",
  content: \`// Utility helpers
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
\`
)`,
        explanation: '创建一个新的TypeScript工具函数文件。',
      },
    ],
    bestPractices: [
      '先检查文件是否存在，避免意外覆盖',
      '使用模板字符串组织代码内容',
      '对于JSON文件使用JSON.stringify进行格式化',
      '确保目录存在',
    ],
    commonMistakes: [
      '不检查文件就直接覆盖',
      '忘记创建目录就写入文件',
      '内容格式不正确（如缺少换行符）',
    ],
    relatedTools: ['Read', 'Edit'],
  },
  {
    name: 'Edit',
    category: '文件操作',
    description: '编辑文件内容',
    fullDescription:
      'Edit 工具用于修改文件中的特定内容。它使用精确的字符串匹配找到要替换的内容，然后用新内容替换。这种方式确保了修改的精确性和可预测性。',
    parameters: [
      {
        name: 'file_path',
        type: 'string',
        required: true,
        description: '要编辑的文件的绝对路径',
      },
      {
        name: 'old_string',
        type: 'string',
        required: true,
        description: '要替换的原始字符串（必须精确匹配）',
      },
      {
        name: 'new_string',
        type: 'string',
        required: true,
        description: '替换后的新字符串',
      },
    ],
    examples: [
      {
        title: '更新版本号',
        code: `Edit(
  file_path: "/project/package.json",
  old_string: '"version": "1.0.0"',
  new_string: '"version": "1.0.1"'
)`,
        explanation: '精确匹配版本号字符串并进行更新。',
      },
      {
        title: '修改API配置',
        code: `Edit(
  file_path: "/project/src/config.ts",
  old_string: 'const API_BASE = "http://localhost:3000";',
  new_string: 'const API_BASE = "https://api.production.com";'
)`,
        explanation: '修改API基础URL配置。',
      },
      {
        title: '重构函数签名',
        code: `Edit(
  file_path: "/project/src/services/user.ts",
  old_string: 'function getUser(id: string): Promise<User> {',
  new_string: 'async function getUser(id: string, options?: FetchOptions): Promise<User> {'
)`,
        explanation: '修改函数签名，添加async关键字和新参数。',
      },
    ],
    bestPractices: [
      '先使用Read工具查看文件内容',
      '确保old_string精确匹配，包括空白字符',
      '一次只做一个小的修改',
      '修改后用Read验证结果',
    ],
    commonMistakes: [
      'old_string不精确匹配（缩进、空格不同）',
      '一次修改太多内容导致不可预测的结果',
      '忘记验证修改后的文件',
    ],
    relatedTools: ['Read', 'Write'],
  },
  {
    name: 'Glob',
    category: '文件操作',
    description: '使用glob模式匹配文件',
    fullDescription:
      'Glob 工具使用glob模式语法来匹配文件名和路径。它支持通配符、递归匹配等功能，非常适合批量查找文件。',
    parameters: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: 'glob模式字符串',
      },
      {
        name: 'path',
        type: 'string',
        required: false,
        description: '要搜索的基础路径',
        default: '当前工作目录',
      },
    ],
    examples: [
      {
        title: '查找所有TypeScript文件',
        code: `Glob(
  pattern: "**/*.ts"
)`,
        explanation: '递归查找所有.ts文件。',
      },
      {
        title: '在特定目录查找',
        code: `Glob(
  pattern: "src/**/*.tsx",
  path: "/project"
)`,
        explanation: '在项目目录下查找src子目录中的所有.tsx文件。',
      },
      {
        title: '查找配置文件',
        code: `Glob(
  pattern: "**/*.config.*"
)`,
        explanation:
          '查找所有配置文件（如webpack.config.js、tsconfig.json等）。',
      },
    ],
    bestPractices: [
      '使用**表示递归匹配',
      '*匹配任意字符，?匹配单个字符',
      '从简单的模式开始，逐步细化',
      '注意区分大小写',
    ],
    commonMistakes: [
      '忘记使用**进行递归搜索',
      '模式过于宽泛匹配了太多文件',
      '没有测试模式的效果',
    ],
    relatedTools: ['Read', 'SearchCodebase'],
  },
  {
    name: 'RunCommand',
    category: '命令执行',
    description: '执行shell命令',
    fullDescription:
      'RunCommand 工具用于执行shell命令。它支持同步和异步执行，可以指定工作目录、终端等参数。对于长时间运行的进程如开发服务器，建议使用非阻塞模式。',
    parameters: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: '要执行的shell命令',
      },
      {
        name: 'target_terminal',
        type: 'string',
        required: false,
        description: '目标终端标识或"new"创建新终端',
        default: '自动分配',
      },
      {
        name: 'command_type',
        type: 'string',
        required: false,
        description:
          '命令类型：web_server、long_running_process、short_running_process、other',
        default: 'short_running_process',
      },
      {
        name: 'cwd',
        type: 'string',
        required: false,
        description: '工作目录',
        default: '当前工作目录',
      },
      {
        name: 'blocking',
        type: 'boolean',
        required: false,
        description: '是否阻塞执行',
        default: 'true',
      },
      {
        name: 'requires_approval',
        type: 'boolean',
        required: false,
        description: '是否需要用户批准',
        default: 'false',
      },
    ],
    examples: [
      {
        title: '安装依赖',
        code: `RunCommand(
  command: "npm install",
  cwd: "/project/backend",
  blocking: true,
  requires_approval: false
)`,
        explanation: '在backend目录中同步执行npm install。',
      },
      {
        title: '启动开发服务器',
        code: `RunCommand(
  command: "npm run dev",
  cwd: "/project/frontend",
  blocking: false,
  command_type: "web_server",
  wait_ms_before_async: 2000
)`,
        explanation: '非阻塞模式启动开发服务器，等待2秒后检查状态。',
      },
      {
        title: '运行测试',
        code: `RunCommand(
  command: "npm test",
  cwd: "/project",
  blocking: true
)`,
        explanation: '同步运行测试套件并等待完成。',
      },
    ],
    bestPractices: [
      '对于长时间运行的进程使用blocking: false',
      '明确指定command_type有助于正确处理进程',
      '使用wait_ms_before_async给服务器启动时间',
      '对于破坏性操作设置requires_approval: true',
    ],
    commonMistakes: [
      '用阻塞模式启动服务器导致无法继续',
      '忘记指定正确的cwd',
      '不处理命令执行错误',
    ],
    relatedTools: [],
  },
];

export class ToolGuideSystem {
  /**
   * 获取工具指南
   */
  getToolGuide(name: string): ToolGuide | undefined {
    return toolGuideData.find((tool) => tool.name === name);
  }

  /**
   * 获取所有工具指南
   */
  getAllToolGuides(): ToolGuide[] {
    return toolGuideData;
  }

  /**
   * 按类别获取工具指南
   */
  getToolGuidesByCategory(category: string): ToolGuide[] {
    return toolGuideData.filter((tool) => tool.category === category);
  }

  /**
   * 获取所有类别
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    toolGuideData.forEach((tool) => categories.add(tool.category));
    return Array.from(categories);
  }

  /**
   * 显示工具指南
   */
  displayToolGuide(name: string): void {
    const guide = this.getToolGuide(name);
    if (!guide) {
      console.log(chalk.red('✗'), `Unknown tool: ${name}`);
      return;
    }

    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold(`  ${guide.name}`));
    console.log(chalk.gray(`  ${guide.category} - ${guide.description}`));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    console.log(chalk.green('描述:'));
    console.log(guide.fullDescription);
    console.log();

    console.log(chalk.green('参数:'));
    guide.parameters.forEach((param) => {
      const reqMark = param.required ? chalk.red('*') : chalk.gray('?');
      console.log(
        `  ${reqMark} ${chalk.yellow(param.name)} (${chalk.cyan(param.type)})`
      );
      console.log(`    ${param.description}`);
      if (param.default) {
        console.log(`    ${chalk.gray('Default:')} ${param.default}`);
      }
      console.log();
    });

    console.log(chalk.green('示例:'));
    guide.examples.forEach((example, index) => {
      console.log(`  ${chalk.yellow(index + 1)}. ${example.title}`);
      console.log();
      console.log(chalk.gray('  代码:'));
      console.log(chalk.gray('  ' + example.code.replace(/\n/g, '\n  ')));
      console.log();
      console.log(chalk.gray('  说明: ' + example.explanation));
      console.log();
    });

    console.log(chalk.green('最佳实践:'));
    guide.bestPractices.forEach((practice) => {
      console.log(`  ${chalk.green('✓')} ${practice}`);
    });
    console.log();

    console.log(chalk.yellow('常见错误:'));
    guide.commonMistakes.forEach((mistake) => {
      console.log(`  ${chalk.yellow('⚠')} ${mistake}`);
    });
    console.log();

    if (guide.relatedTools.length > 0) {
      console.log(chalk.cyan('相关工具:'));
      console.log(`  ${guide.relatedTools.join(', ')}`);
      console.log();
    }

    console.log(chalk.cyan('═'.repeat(80)));
  }

  /**
   * 显示所有工具列表
   */
  displayToolList(): void {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  可用工具指南'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    const categories = this.getCategories();
    categories.forEach((category) => {
      console.log(chalk.green(`${category}:`));
      const tools = this.getToolGuidesByCategory(category);
      tools.forEach((tool) => {
        console.log(
          `  ${chalk.yellow(tool.name.padEnd(20))} ${tool.description}`
        );
      });
      console.log();
    });

    console.log(chalk.gray('使用 tool-guide <toolName> 查看详细指南'));
    console.log(chalk.cyan('═'.repeat(80)));
  }
}

let toolGuideInstance: ToolGuideSystem | undefined;

export function getToolGuideSystem(): ToolGuideSystem {
  if (!toolGuideInstance) {
    toolGuideInstance = new ToolGuideSystem();
  }
  return toolGuideInstance;
}
