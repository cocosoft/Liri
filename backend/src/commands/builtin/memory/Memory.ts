/**
 * Memory命令实现 - 记忆文件管理
 * 根据 CC 源码实现
 */
import { mkdir, writeFile, readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import type { CommandImplementation } from '../../types/index.js';

/**
 * 获取记忆文件目录
 */
function getMemoryDir(): string {
  return `${homedir()}/.pyapp/memory`;
}

/**
 * 获取记忆文件路径
 */
function getMemoryFilePath(name: string): string {
  return `${getMemoryDir()}/${name}.md`;
}

/**
 * Memory命令实现类
 */
export class Memory implements CommandImplementation {
  /**
   * 执行memory命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      const params = this.parseArgs(args);
      
      if (params.list) {
        return await this.listMemoryFiles();
      } else if (params.create) {
        return await this.createMemoryFile(params.create);
      } else if (params.delete) {
        return await this.deleteMemoryFile(params.delete);
      } else if (params.show) {
        return await this.showMemoryFile(params.show);
      } else if (params.edit) {
        return await this.editMemoryFile(params.edit);
      } else if (args.trim()) {
        // 如果有参数但不是命令，尝试编辑或显示该文件
        return await this.showMemoryFile(args.trim());
      } else {
        return await this.showMemoryOverview();
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to execute memory command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   */
  private parseArgs(args: string): {
    list: boolean;
    create?: string;
    delete?: string;
    show?: string;
    edit?: string;
  } {
    const params: {
      list: boolean;
      create?: string;
      delete?: string;
      show?: string;
      edit?: string;
    } = {
      list: false,
    };

    const parts = args.trim().split(' ');
    let i = 0;
    
    while (i < parts.length) {
      const part = parts[i];
      
      switch (part) {
        case '--list':
        case '-l':
          params.list = true;
          break;
        case '--create':
        case '-c':
          params.create = parts[i + 1];
          i++;
          break;
        case '--delete':
        case '-d':
          params.delete = parts[i + 1];
          i++;
          break;
        case '--show':
        case '-s':
          params.show = parts[i + 1];
          i++;
          break;
        case '--edit':
        case '-e':
          params.edit = parts[i + 1];
          i++;
          break;
      }
      i++;
    }

    return params;
  }

  /**
   * 显示记忆概览
   */
  private async showMemoryOverview(): Promise<any> {
    try {
      const memoryDir = getMemoryDir();
      await mkdir(memoryDir, { recursive: true });
      
      const files = await readdir(memoryDir);
      const memoryFiles = files.filter(f => f.endsWith('.md'));
      
      let content = `📚 Memory Files (${memoryFiles.length} files)\n\n`;
      
      if (memoryFiles.length === 0) {
        content += '  No memory files found. Create one with:\n';
        content += '    /memory --create <name>\n';
      } else {
        content += '  Available memory files:\n';
        memoryFiles.forEach(file => {
          const name = file.replace('.md', '');
          content += `    • ${name}\n`;
        });
      }
      
      content += '\nUsage:\n';
      content += '  /memory --list          - List all memory files\n';
      content += '  /memory --create <name> - Create new memory file\n';
      content += '  /memory --show <name>   - Show memory file content\n';
      content += '  /memory --edit <name>   - Edit memory file\n';
      content += '  /memory --delete <name> - Delete memory file\n';
      content += '  /memory <name>          - Show memory file\n';
      
      return {
        success: true,
        message: content,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error showing memory overview: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 列出所有记忆文件
   */
  private async listMemoryFiles(): Promise<any> {
    try {
      const memoryDir = getMemoryDir();
      await mkdir(memoryDir, { recursive: true });
      
      const files = await readdir(memoryDir);
      const memoryFiles = files.filter(f => f.endsWith('.md'));
      
      if (memoryFiles.length === 0) {
        return {
          success: true,
          message: 'No memory files found.',
        };
      }
      
      let content = '📋 Memory Files:\n\n';
      memoryFiles.forEach((file, index) => {
        const name = file.replace('.md', '');
        content += `${index + 1}. ${name}\n`;
      });
      
      return {
        success: true,
        message: content,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error listing memory files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 创建记忆文件
   */
  private async createMemoryFile(name: string): Promise<any> {
    if (!name) {
      return {
        success: false,
        message: 'Please provide a name for the memory file.',
      };
    }
    
    try {
      const memoryDir = getMemoryDir();
      await mkdir(memoryDir, { recursive: true });
      
      const filePath = getMemoryFilePath(name);
      
      // 检查文件是否已存在
      try {
        await stat(filePath);
        return {
          success: false,
          message: `Memory file "${name}" already exists.`,
        };
      } catch {
        // 文件不存在，继续创建
      }
      
      // 创建空文件
      await writeFile(filePath, '', { encoding: 'utf8' });
      
      return {
        success: true,
        message: `✅ Created memory file: ${name}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error creating memory file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 删除记忆文件
   */
  private async deleteMemoryFile(name: string): Promise<any> {
    if (!name) {
      return {
        success: false,
        message: 'Please provide a name for the memory file to delete.',
      };
    }
    
    try {
      const filePath = getMemoryFilePath(name);
      
      // 使用 fs.promises.unlink 删除文件
      const fs = await import('fs/promises');
      await fs.unlink(filePath);
      
      return {
        success: true,
        message: `🗑️ Deleted memory file: ${name}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error deleting memory file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 显示记忆文件内容
   */
  private async showMemoryFile(name: string): Promise<any> {
    if (!name) {
      return {
        success: false,
        message: 'Please provide a memory file name.',
      };
    }
    
    try {
      const filePath = getMemoryFilePath(name);
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf8');
      
      return {
        success: true,
        message: `📄 ${name}\n\n${content || '(empty)'}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error reading memory file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 编辑记忆文件
   */
  private async editMemoryFile(name: string): Promise<any> {
    if (!name) {
      return {
        success: false,
        message: 'Please provide a memory file name to edit.',
      };
    }
    
    try {
      const memoryDir = getMemoryDir();
      await mkdir(memoryDir, { recursive: true });
      
      const filePath = getMemoryFilePath(name);
      
      // 确保文件存在
      try {
        await stat(filePath);
      } catch {
        // 文件不存在，创建空文件
        await writeFile(filePath, '', { encoding: 'utf8' });
      }
      
      // 检查编辑器环境变量
      const editor = process.env.VISUAL || process.env.EDITOR || 'notepad';
      
      return {
        success: true,
        message: `📝 Opening "${name}" in ${editor}\n\nTo use a different editor, set the $EDITOR or $VISUAL environment variable.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error opening memory file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}