/**
 * API文档
 * 为公共API提供详细文档和示例
 */

import chalk from 'chalk';

interface ApiDoc {
  name: string;
  category: string;
  description: string;
  signature: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }>;
  returns: string;
  examples: Array<{
    title: string;
    code: string;
  }>;
  notes?: string[];
}

const apiDocs: ApiDoc[] = [
  {
    name: 'getLogger',
    category: '日志系统',
    description: '获取日志记录器实例',
    signature: 'getLogger(): Logger',
    parameters: [],
    returns: 'Logger - 日志记录器实例',
    examples: [
      {
        title: '基本使用',
        code: `import { getLogger } from '../monitoring';

const logger = getLogger();
logger.info('Hello, World!');
logger.error('Something went wrong');`,
      },
    ],
  },
  {
    name: 'createLogger',
    category: '日志系统',
    description: '创建自定义配置的日志记录器',
    signature: 'createLogger(config?: LoggerConfig): Logger',
    parameters: [
      {
        name: 'config',
        type: 'LoggerConfig',
        required: false,
        description: '日志配置对象',
      },
    ],
    returns: 'Logger - 新的日志记录器实例',
    examples: [
      {
        title: '自定义日志文件',
        code: `import { createLogger, LogLevel } from '../monitoring';

const logger = createLogger({
  level: LogLevel.DEBUG,
  logFile: '/path/to/custom.log',
  consoleOutput: true,
  fileOutput: true
});

logger.debug('Debug message');`,
      },
    ],
  },
  {
    name: 'getMetricsService',
    category: '指标系统',
    description: '获取指标服务实例',
    signature: 'getMetricsService(): MetricsService',
    parameters: [],
    returns: 'MetricsService - 指标服务实例',
    examples: [
      {
        title: '创建计数器',
        code: `import { getMetricsService } from '../monitoring';

const metrics = getMetricsService();
const counter = metrics.createCounter({ name: 'request_count' });

counter.inc();
counter.inc(5);
console.log('Count:', counter.get());`,
      },
    ],
  },
  {
    name: 'createMetricsService',
    category: '指标系统',
    description: '创建新的指标服务实例',
    signature: 'createMetricsService(): MetricsService',
    parameters: [],
    returns: 'MetricsService - 新的指标服务实例',
    examples: [
      {
        title: '独立的指标服务',
        code: `import { createMetricsService } from '../monitoring';

const metrics = createMetricsService();
const gauge = metrics.createGauge({ name: 'memory_usage' });

gauge.set(256);
gauge.inc(128);`,
      },
    ],
  },
  {
    name: 'getCacheService',
    category: '缓存系统',
    description: '获取缓存服务实例',
    signature: 'getCacheService(): CacheService',
    parameters: [],
    returns: 'CacheService - 缓存服务实例',
    examples: [
      {
        title: '基本缓存操作',
        code: `import { getCacheService } from '../cache';

const cache = getCacheService();

// 设置缓存
await cache.set('key', 'value', 60000); // 60秒过期

// 获取缓存
const value = await cache.get('key');
console.log(value);

// 删除缓存
await cache.delete('key');`,
      },
    ],
  },
  {
    name: 'getErrorService',
    category: '错误处理',
    description: '获取错误处理服务实例',
    signature: 'getErrorService(): ErrorService',
    parameters: [],
    returns: 'ErrorService - 错误处理服务实例',
    examples: [
      {
        title: '记录错误',
        code: `import { getErrorService } from '../error';

const errorService = getErrorService();

try {
  // 可能出错的代码
} catch (error) {
  errorService.handleError(error, {
    context: 'operation_name',
    severity: 'high'
  });
}`,
      },
    ],
  },
  {
    name: 'getHelpSystem',
    category: '帮助系统',
    description: '获取帮助系统实例',
    signature: 'getHelpSystem(): HelpSystem',
    parameters: [],
    returns: 'HelpSystem - 帮助系统实例',
    examples: [
      {
        title: '查看命令帮助',
        code: `import { getHelpSystem } from '../docs/HelpSystem';

const helpSystem = getHelpSystem();
helpSystem.displayCommandHelp('read');`,
      },
    ],
  },
  {
    name: 'getToolGuideSystem',
    category: '帮助系统',
    description: '获取工具指南系统实例',
    signature: 'getToolGuideSystem(): ToolGuideSystem',
    parameters: [],
    returns: 'ToolGuideSystem - 工具指南系统实例',
    examples: [
      {
        title: '查看工具指南',
        code: `import { getToolGuideSystem } from '../docs/ToolGuide';

const guideSystem = getToolGuideSystem();
guideSystem.displayToolGuide('SearchCodebase');`,
      },
    ],
  },
  {
    name: 'getPluginDevGuideSystem',
    category: '帮助系统',
    description: '获取插件开发指南系统实例',
    signature: 'getPluginDevGuideSystem(): PluginDevGuideSystem',
    parameters: [],
    returns: 'PluginDevGuideSystem - 插件开发指南系统实例',
    examples: [
      {
        title: '查看插件模板',
        code: `import { getPluginDevGuideSystem } from '../docs/PluginDevGuide';

const guideSystem = getPluginDevGuideSystem();
guideSystem.displayTemplate('basic-plugin');`,
      },
    ],
  },
  {
    name: 'getVoiceService',
    category: '语音服务',
    description: '获取语音服务实例',
    signature: 'getVoiceService(): VoiceService',
    parameters: [],
    returns: 'VoiceService - 语音服务实例',
    examples: [
      {
        title: '使用语音服务',
        code: `import { getVoiceService } from '../services/voice';

const voiceService = getVoiceService();

// 检查录音可用性
const available = await voiceService.checkRecordingAvailability();
if (available) {
  // 开始录音
  await voiceService.startRecording(
    (chunk) => console.log('Received chunk'),
    () => console.log('Recording finished')
  );
}`,
      },
    ],
  },
  {
    name: 'getSkillService',
    category: '技能系统',
    description: '获取技能服务实例',
    signature: 'getSkillService(): SkillService',
    parameters: [],
    returns: 'SkillService - 技能服务实例',
    examples: [
      {
        title: '使用技能服务',
        code: `import { getSkillService } from '../skills';

const skillService = getSkillService();

// 获取所有技能
const skills = skillService.getSkills();

// 执行技能
const result = await skillService.executeSkill('debug', '', context);
console.log(result);`,
      },
    ],
  },
  {
    name: 'createToolManager',
    category: '工具管理',
    description: '创建工具管理器实例',
    signature: 'createToolManager(): ToolManager',
    parameters: [],
    returns: 'ToolManager - 工具管理器实例',
    examples: [
      {
        title: '使用工具管理器',
        code: `import { createToolManager } from '../tools/ToolManager';

const toolManager = createToolManager();

// 获取所有工具
const tools = toolManager.getAllTools();

// 获取特定工具
const searchTool = toolManager.getTool('SearchCodebase');`,
      },
    ],
  },
];

export class ApiDocSystem {
  /**
   * 获取API文档
   */
  getApiDoc(name: string): ApiDoc | undefined {
    return apiDocs.find((doc) => doc.name === name);
  }

  /**
   * 获取所有API文档
   */
  getAllApiDocs(): ApiDoc[] {
    return apiDocs;
  }

  /**
   * 按类别获取API文档
   */
  getApiDocsByCategory(category: string): ApiDoc[] {
    return apiDocs.filter((doc) => doc.category === category);
  }

  /**
   * 获取所有类别
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    apiDocs.forEach((doc) => categories.add(doc.category));
    return Array.from(categories);
  }

  /**
   * 显示API文档
   */
  displayApiDoc(name: string): void {
    const doc = this.getApiDoc(name);
    if (!doc) {
      console.log(chalk.red('✗'), `Unknown API: ${name}`);
      return;
    }

    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold(`  ${doc.name}`));
    console.log(chalk.gray(`  ${doc.category} - ${doc.description}`));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    console.log(chalk.green('签名:'));
    console.log(`  ${chalk.yellow(doc.signature)}`);
    console.log();

    if (doc.parameters.length > 0) {
      console.log(chalk.green('参数:'));
      doc.parameters.forEach((param) => {
        const reqMark = param.required ? chalk.red('*') : chalk.gray('?');
        console.log(
          `  ${reqMark} ${chalk.yellow(param.name)}: ${chalk.cyan(param.type)}`
        );
        console.log(`    ${param.description}`);
        console.log();
      });
    }

    console.log(chalk.green('返回值:'));
    console.log(`  ${doc.returns}`);
    console.log();

    console.log(chalk.green('示例:'));
    doc.examples.forEach((example, index) => {
      console.log(`  ${chalk.yellow(index + 1)}. ${example.title}`);
      console.log();
      console.log(chalk.gray('  ' + example.code.replace(/\\n/g, '\\n  ')));
      console.log();
    });

    if (doc.notes && doc.notes.length > 0) {
      console.log(chalk.yellow('注意:'));
      doc.notes.forEach((note) => {
        console.log(`  ${chalk.yellow('⚠')} ${note}`);
      });
      console.log();
    }

    console.log(chalk.cyan('═'.repeat(80)));
  }

  /**
   * 显示API列表
   */
  displayApiList(): void {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  公共API文档'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    const categories = this.getCategories();
    categories.forEach((category) => {
      console.log(chalk.green(`${category}:`));
      const docs = this.getApiDocsByCategory(category);
      docs.forEach((doc) => {
        console.log(
          `  ${chalk.yellow(doc.name.padEnd(25))} ${doc.description}`
        );
      });
      console.log();
    });

    console.log(chalk.gray('使用 api-doc <apiName> 查看详细文档'));
    console.log(chalk.cyan('═'.repeat(80)));
  }
}

let apiDocInstance: ApiDocSystem | undefined;

export function getApiDocSystem(): ApiDocSystem {
  if (!apiDocInstance) {
    apiDocInstance = new ApiDocSystem();
  }
  return apiDocInstance;
}
