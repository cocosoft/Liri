/**
 * 插件开发指南
 * 提供插件开发文档和模板
 */

import chalk from 'chalk';

export interface PluginTemplate {
  name: string;
  description: string;
  files: Array<{
    name: string;
    content: string;
  }>;
}

const pluginTemplates: PluginTemplate[] = [
  {
    name: 'basic-plugin',
    description: '基础插件模板',
    files: [
      {
        name: 'index.ts',
        content: `/**
 * 基础插件模板
 */

import type { PluginDefinition, PluginContext } from '@modules/plugins/types';

export const plugin: PluginDefinition = {
  name: 'basic-plugin',
  version: '1.0.0',
  description: '一个基础的插件示例',
  author: 'Your Name',
  
  async activate(context: PluginContext): Promise<void> {
    console.log('Basic plugin activated!');
    
    // 注册命令
    context.registerCommand('hello', async () => {
      console.log('Hello from basic plugin!');
      return { success: true, message: 'Hello!' };
    });
  },
  
  async deactivate(): Promise<void> {
    console.log('Basic plugin deactivated!');
  }
};

export default plugin;
`,
      },
      {
        name: 'package.json',
        content: `{
  "name": "basic-plugin",
  "version": "1.0.0",
  "description": "A basic plugin template",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "keywords": ["plugin"],
  "author": "",
  "license": "MIT"
}
`,
      },
      {
        name: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
    ],
  },
  {
    name: 'tool-plugin',
    description: '工具插件模板',
    files: [
      {
        name: 'index.ts',
        content: `/**
 * 工具插件模板
 */

import type { PluginDefinition, PluginContext } from '@modules/plugins/types';
import type { ToolDefinition } from '@modules/tools/types';

const customTool: ToolDefinition = {
  name: 'custom-tool',
  description: '一个自定义工具示例',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: '输入参数'
      }
    },
    required: ['input']
  },
  
  async execute(args: any): Promise<unknown> {
    const { input } = args;
    console.log('Custom tool called with:', input);
    return {
      success: true,
      result: \`Processed: \${input}\`
    };
  }
};

export const plugin: PluginDefinition = {
  name: 'tool-plugin',
  version: '1.0.0',
  description: '一个提供自定义工具的插件',
  author: 'Your Name',
  
  async activate(context: PluginContext): Promise<void> {
    console.log('Tool plugin activated!');
    
    // 注册自定义工具
    context.registerTool(customTool);
    
    // 注册命令
    context.registerCommand('use-tool', async (args: string[]) => {
      const input = args[0] || 'default';
      return await customTool.execute({ input });
    });
  },
  
  async deactivate(): Promise<void> {
    console.log('Tool plugin deactivated!');
  }
};

export default plugin;
`,
      },
      {
        name: 'package.json',
        content: `{
  "name": "tool-plugin",
  "version": "1.0.0",
  "description": "A plugin with custom tools",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "keywords": ["plugin", "tool"],
  "author": "",
  "license": "MIT"
}
`,
      },
      {
        name: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
    ],
  },
  {
    name: 'chat-plugin',
    description: '聊天插件模板',
    files: [
      {
        name: 'index.ts',
        content: `/**
 * 聊天插件模板
 */

import type { PluginDefinition, PluginContext } from '@modules/plugins/types';
import type { Message, ChatHandler } from '@modules/chat/types';

const chatHandler: ChatHandler = {
  name: 'custom-chat-handler',
  description: '处理自定义聊天消息',
  
  async handle(message: Message, context: any): Promise<Message | null> {
    if (message.content.includes('hello') || message.content.includes('你好')) {
      return {
        role: 'assistant',
        content: '你好！很高兴见到你！我是来自聊天插件的助手。',
        timestamp: Date.now()
      };
    }
    
    // 如果不是我们处理的消息，返回null
    return null;
  }
};

export const plugin: PluginDefinition = {
  name: 'chat-plugin',
  version: '1.0.0',
  description: '一个扩展聊天功能的插件',
  author: 'Your Name',
  
  async activate(context: PluginContext): Promise<void> {
    console.log('Chat plugin activated!');
    
    // 注册聊天处理器
    context.registerChatHandler(chatHandler);
    
    // 注册命令
    context.registerCommand('chat-demo', async (args: string[]) => {
      const msg = args.join(' ') || 'Hello!';
      return {
        success: true,
        message: \`聊天演示: \${msg}\`
      };
    });
  },
  
  async deactivate(): Promise<void> {
    console.log('Chat plugin deactivated!');
  }
};

export default plugin;
`,
      },
      {
        name: 'package.json',
        content: `{
  "name": "chat-plugin",
  "version": "1.0.0",
  "description": "A plugin that extends chat functionality",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "keywords": ["plugin", "chat"],
  "author": "",
  "license": "MIT"
}
`,
      },
      {
        name: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
    ],
  },
];

export class PluginDevGuideSystem {
  /**
   * 获取所有插件模板
   */
  getPluginTemplates(): PluginTemplate[] {
    return pluginTemplates;
  }

  /**
   * 获取插件模板
   */
  getPluginTemplate(name: string): PluginTemplate | undefined {
    return pluginTemplates.find((template) => template.name === name);
  }

  /**
   * 显示插件开发指南
   */
  displayDevGuide(): void {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  插件开发指南'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    console.log(chalk.green('1. 入门'));
    console.log('   插件是扩展 Liri 功能的强大方式。');
    console.log('   每个插件都有 activate 和 deactivate 生命周期方法。');
    console.log();

    console.log(chalk.green('2. 基本结构'));
    console.log('   - index.ts: 插件主入口');
    console.log('   - package.json: 插件元数据');
    console.log('   - tsconfig.json: TypeScript配置');
    console.log();

    console.log(chalk.green('3. 插件能力'));
    console.log('   - 注册自定义命令');
    console.log('   - 注册自定义工具');
    console.log('   - 注册聊天处理器');
    console.log('   - 访问插件上下文');
    console.log();

    console.log(chalk.green('4. 可用模板'));
    pluginTemplates.forEach((template) => {
      console.log(
        `   - ${chalk.yellow(template.name.padEnd(15))} ${template.description}`
      );
    });
    console.log();

    console.log(chalk.gray('使用 plugin-template <templateName> 查看模板详情'));
    console.log(chalk.cyan('═'.repeat(80)));
  }

  /**
   * 显示插件模板
   */
  displayTemplate(name: string): void {
    const template = this.getPluginTemplate(name);
    if (!template) {
      console.log(chalk.red('✗'), `Unknown template: ${name}`);
      return;
    }

    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold(`  ${template.name}`));
    console.log(chalk.gray(`  ${template.description}`));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    console.log(chalk.green('文件列表:'));
    template.files.forEach((file, index) => {
      console.log(`  ${chalk.yellow(index + 1)}. ${file.name}`);
    });
    console.log();

    template.files.forEach((file) => {
      console.log(chalk.cyan(`--- ${file.name} ---`));
      console.log(chalk.gray(file.content));
      console.log();
    });

    console.log(chalk.cyan('═'.repeat(80)));
  }

  /**
   * 显示快速参考
   */
  displayQuickRef(): void {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  插件开发快速参考'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();

    console.log(chalk.green('PluginDefinition 接口:'));
    console.log(
      chalk.gray(`
{
  name: string;
  version: string;
  description: string;
  author?: string;
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
}
`)
    );

    console.log(chalk.green('PluginContext API:'));
    console.log('   registerCommand(name: string, handler: Function)');
    console.log('   registerTool(tool: ToolDefinition)');
    console.log('   registerChatHandler(handler: ChatHandler)');
    console.log('   getConfig(): PluginConfig');
    console.log('   getStorage(): PluginStorage');
    console.log();

    console.log(chalk.green('常用命令:'));
    console.log('   plugin-template <name>  - 查看模板');
    console.log('   plugin-guide           - 查看完整指南');
    console.log();

    console.log(chalk.cyan('═'.repeat(80)));
  }
}

let pluginDevGuideInstance: PluginDevGuideSystem | undefined;

export function getPluginDevGuideSystem(): PluginDevGuideSystem {
  if (!pluginDevGuideInstance) {
    pluginDevGuideInstance = new PluginDevGuideSystem();
  }
  return pluginDevGuideInstance;
}
