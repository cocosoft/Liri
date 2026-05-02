/**
 * 文件管理命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行文件管理命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(parts.slice(1), context);
      case 'find':
        return this.handleFind(parts.slice(1), context);
      case 'view':
        return this.handleView(parts.slice(1), context);
      case 'tree':
        return this.handleTree(parts.slice(1), context);
      case 'clean':
        return this.handleClean(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出文件
   */
  async handleList(args: string[], context: CommandContext): Promise<CommandResult> {
    const path = args.join(' ') || '.';
    
    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      
      const targetPath = pathModule.resolve(context.cwd || process.cwd(), path);
      
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          type: 'error',
          error: `路径不存在: ${targetPath}`,
        };
      }

      const files = fs.readdirSync(targetPath);
      const fileInfo = files.map(file => {
        const fullPath = pathModule.join(targetPath, file);
        const stat = fs.statSync(fullPath);
        return {
          name: file,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.isFile() ? stat.size : '-',
          mtime: stat.mtime.toLocaleString(),
        };
      });

      const table = fileInfo.map(f => 
        `${f.type === 'directory' ? '[DIR]' : '[FILE]'} ${f.name.padEnd(30)} ${(f.size + '').padEnd(10)} ${f.mtime}`
      ).join('\n');

      return {
        success: true,
        type: 'text',
        message: `目录内容 (${targetPath}):\n\n${table}`,
        data: fileInfo,
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `列出文件失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 查找文件
   */
  async handleFind(args: string[], context: CommandContext): Promise<CommandResult> {
    const pattern = args.join(' ') || '';
    
    if (!pattern) {
      return {
        success: false,
        type: 'error',
        error: '请提供查找模式',
        message: '用法: /files find <模式>',
      };
    }

    const foundFiles: string[] = [];
    
    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      
      const searchDir = context.cwd || process.cwd();
      
      const search = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = pathModule.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (file.includes(pattern)) {
            foundFiles.push(fullPath);
          }
          
          if (stat.isDirectory()) {
            search(fullPath);
          }
        }
      };
      
      search(searchDir);

      if (foundFiles.length === 0) {
        return {
          success: false,
          type: 'text',
          message: `未找到匹配 "${pattern}" 的文件`,
        };
      }

      return {
        success: true,
        type: 'text',
        message: `找到 ${foundFiles.length} 个匹配文件:\n\n${foundFiles.join('\n')}`,
        data: foundFiles,
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `查找文件失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 查看文件内容
   */
  async handleView(args: string[], context: CommandContext): Promise<CommandResult> {
    const filePath = args.join(' ');
    
    if (!filePath) {
      return {
        success: false,
        type: 'error',
        error: '请提供文件路径',
        message: '用法: /files view <文件路径>',
      };
    }

    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      
      const fullPath = pathModule.resolve(context.cwd || process.cwd(), filePath);
      
      if (!fs.existsSync(fullPath)) {
        return {
          success: false,
          type: 'error',
          error: `文件不存在: ${fullPath}`,
        };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const maxLines = 50;
      const lines = content.split('\n');
      const truncated = lines.length > maxLines;
      const displayContent = lines.slice(0, maxLines).join('\n');

      let message = `文件内容 (${fullPath}):\n\n${displayContent}`;
      if (truncated) {
        message += `\n\n... (显示前 ${maxLines} 行，共 ${lines.length} 行)`;
      }

      return {
        success: true,
        type: 'text',
        message,
        data: { content, truncated: truncated, totalLines: lines.length },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `查看文件失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 显示目录树
   */
  async handleTree(args: string[], context: CommandContext): Promise<CommandResult> {
    const path = args.join(' ') || '.';
    
    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      
      const targetPath = pathModule.resolve(context.cwd || process.cwd(), path);
      
      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          type: 'error',
          error: `路径不存在: ${targetPath}`,
        };
      }

      const tree: string[] = [];
      
      const buildTree = (dir: string, prefix: string = '') => {
        const files = fs.readdirSync(dir).sort();
        
        files.forEach((file, index) => {
          const fullPath = pathModule.join(dir, file);
          const stat = fs.statSync(fullPath);
          const isLast = index === files.length - 1;
          const connector = isLast ? '└──' : '├──';
          
          tree.push(`${prefix}${connector} ${file}`);
          
          if (stat.isDirectory()) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            buildTree(fullPath, newPrefix);
          }
        });
      };
      
      tree.push(targetPath);
      buildTree(targetPath);

      return {
        success: true,
        type: 'text',
        message: tree.join('\n'),
        data: { path: targetPath },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `生成目录树失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 清理临时文件
   */
  async handleClean(context: CommandContext): Promise<CommandResult> {
    const tempFiles = ['*.log', '*.tmp', '*.bak', '.DS_Store', 'Thumbs.db'];
    let deletedCount = 0;
    
    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      
      const searchDir = context.cwd || process.cwd();
      
      const clean = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = pathModule.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            clean(fullPath);
          } else {
            for (const pattern of tempFiles) {
              const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
              if (regex.test(file)) {
                fs.unlinkSync(fullPath);
                deletedCount++;
                break;
              }
            }
          }
        }
      };
      
      clean(searchDir);

      context.onDone?.(`已清理 ${deletedCount} 个临时文件`, { display: 'system' });
      
      return {
        success: true,
        type: 'text',
        message: `已清理 ${deletedCount} 个临时文件`,
        data: { deletedCount },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `清理失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `文件管理命令用法:

/files list [路径]     - 列出目录内容
/files find <模式>     - 查找匹配的文件
/files view <文件>     - 查看文件内容
/files tree [路径]     - 显示目录树
/files clean           - 清理临时文件
/files help            - 显示此帮助信息

示例:
  /files list
  /files find *.txt
  /files view package.json
  /files tree src`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
