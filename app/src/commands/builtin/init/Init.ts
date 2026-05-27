/**
 * 项目初始化命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行初始化命令
   * @param args 项目名称或路径
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const projectName = args.trim() || 'my-project';

    try {
      const fs = await import('fs');
      const path = await import('path');

      const projectPath = path.resolve(
        context.cwd || process.cwd(),
        projectName
      );

      // 检查项目目录是否已存在
      if (fs.existsSync(projectPath)) {
        return {
          success: false,
          type: 'error',
          error: `目录已存在: ${projectPath}`,
        };
      }

      // 创建项目目录结构
      fs.mkdirSync(projectPath, { recursive: true });

      // 创建基本文件
      const filesToCreate = [
        {
          path: path.join(projectPath, '.gitignore'),
          content: `node_modules/
dist/
.build/
.env
.DS_Store
`,
        },
        {
          path: path.join(projectPath, 'README.md'),
          content: `# ${projectName}

项目描述
`,
        },
        {
          path: path.join(projectPath, 'package.json'),
          content: JSON.stringify(
            {
              name: projectName,
              version: '1.0.0',
              description: '',
              main: 'index.js',
              scripts: {
                start: 'node index.js',
                test: 'echo "Error: no test specified" && exit 1',
              },
              keywords: [],
              author: '',
              license: 'MIT',
            },
            null,
            2
          ),
        },
        {
          path: path.join(projectPath, 'index.js'),
          content: `console.log('Hello, World!');
`,
        },
      ];

      for (const file of filesToCreate) {
        fs.writeFileSync(file.path, file.content);
      }

      context.onDone?.(`项目已初始化: ${projectPath}`, { display: 'system' });

      return {
        success: true,
        type: 'text',
        message:
          `项目初始化完成!\n\n已创建目录: ${projectPath}\n\n创建的文件:\n` +
          `- .gitignore\n` +
          `- README.md\n` +
          `- package.json\n` +
          `- index.js`,
        data: { projectPath, files: filesToCreate.map((f) => f.path) },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `初始化项目失败: ${(error as Error).message}`,
      };
    }
  },
};
