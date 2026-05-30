import { Command } from 'commander';
import { MemoryManagerImpl } from '../MemoryManager';
import { MemoryType } from '../types/MemoryType';
import { createMemoryMetadata } from '../types/MemoryMetadata';

/**
 * 记忆模块命令行工具
 */
export class MemoryCLI {
  /**
   * 记忆管理器
   */
  private memoryManager: MemoryManagerImpl;

  /**
   * 命令行程序
   */
  private program: Command;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = join(resolveDataDir(), 'memory')) {
    this.memoryManager = new MemoryManagerImpl(memoryDir);
    this.program = new Command();
    this.setupCommands();
  }

  /**
   * 设置命令
   */
  private setupCommands() {
    // 主命令
    this.program
      .name('memory')
      .description('Memory module CLI for Liri')
      .version('1.0.0');

    // 创建记忆命令
    this.program
      .command('create')
      .description('Create a new memory')
      .option('-n, --name <name>', 'Memory name')
      .option('-d, --description <description>', 'Memory description')
      .option(
        '-t, --type <type>',
        'Memory type (user, feedback, project, reference)'
      )
      .option('-g, --tags <tags>', 'Memory tags (comma-separated)')
      .option('-p, --priority <priority>', 'Memory priority')
      .action(async (options) => {
        try {
          const content = await this.promptForContent();
          const tags = options.tags ? options.tags.split(',') : [];

          const memory = await this.memoryManager.createMemory({
            content,
            metadata: createMemoryMetadata({
              name: options.name || 'Untitled Memory',
              description: options.description || '',
              type: options.type || MemoryType.USER_FACT,
              tags,
              priority: options.priority,
            }),
          });

          console.log(`Memory created successfully with ID: ${memory.id}`);
        } catch (error) {
          console.error('Error creating memory:', error);
        }
      });

    // 列出记忆命令
    this.program
      .command('list')
      .description('List all memories')
      .action(async () => {
        try {
          const memories = await this.memoryManager.getAllMemories();
          console.log('Memories:');
          console.log('='.repeat(80));

          memories.forEach((memory) => {
            console.log(`ID: ${memory.id}`);
            console.log(`Name: ${memory.metadata.name}`);
            console.log(`Type: ${memory.metadata.type}`);
            console.log(`Created: ${memory.createdAt.toISOString()}`);
            console.log(`Tags: ${memory.metadata.tags?.join(', ') || 'None'}`);
            console.log('='.repeat(80));
          });
        } catch (error) {
          console.error('Error listing memories:', error);
        }
      });

    // 搜索记忆命令
    this.program
      .command('search')
      .description('Search memories')
      .argument('<query>', 'Search query')
      .action(async (query) => {
        try {
          const memories = await this.memoryManager.getRelevantMemories(query);
          console.log(`Search results for "${query}":`);
          console.log('='.repeat(80));

          memories.forEach((memory) => {
            console.log(`ID: ${memory.id}`);
            console.log(`Name: ${memory.metadata.name}`);
            console.log(`Type: ${memory.metadata.type}`);
            console.log(
              `Content: ${memory.content.substring(0, 100)}${memory.content.length > 100 ? '...' : ''}`
            );
            console.log('='.repeat(80));
          });
        } catch (error) {
          console.error('Error searching memories:', error);
        }
      });

    // 获取记忆命令
    this.program
      .command('get')
      .description('Get a memory by ID')
      .argument('<id>', 'Memory ID')
      .action(async (id) => {
        try {
          const memory = await this.memoryManager.getMemory(id);
          if (memory) {
            console.log('Memory details:');
            console.log('='.repeat(80));
            console.log(`ID: ${memory.id}`);
            console.log(`Name: ${memory.metadata.name}`);
            console.log(`Description: ${memory.metadata.description}`);
            console.log(`Type: ${memory.metadata.type}`);
            console.log(`Created: ${memory.createdAt.toISOString()}`);
            console.log(`Updated: ${memory.updatedAt.toISOString()}`);
            console.log(`Tags: ${memory.metadata.tags?.join(', ') || 'None'}`);
            console.log(`Priority: ${memory.metadata.priority || 'None'}`);
            console.log('Content:');
            console.log(memory.content);
            console.log('='.repeat(80));
          } else {
            console.log(`Memory with ID ${id} not found`);
          }
        } catch (error) {
          console.error('Error getting memory:', error);
        }
      });

    // 删除记忆命令
    this.program
      .command('delete')
      .description('Delete a memory by ID')
      .argument('<id>', 'Memory ID')
      .action(async (id) => {
        try {
          await this.memoryManager.deleteMemory(id);
          console.log(`Memory with ID ${id} deleted successfully`);
        } catch (error) {
          console.error('Error deleting memory:', error);
        }
      });

    // 获取记忆统计信息命令
    this.program
      .command('stats')
      .description('Get memory statistics')
      .action(async () => {
        try {
          const stats = await this.memoryManager.getMemoryStats();
          console.log('Memory Statistics:');
          console.log('='.repeat(80));
          console.log(`Total memories: ${stats.total}`);
          console.log(`Recent memories (7 days): ${stats.recent}`);
          console.log(`Total size: ${stats.totalSize} bytes`);
          console.log('Memories by type:');
          Object.entries(stats.byType).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });
          console.log('='.repeat(80));
        } catch (error) {
          console.error('Error getting memory statistics:', error);
        }
      });
  }

  /**
   * 提示用户输入记忆内容
   * @returns 记忆内容
   */
  private promptForContent(): Promise<string> {
    return new Promise((resolve) => {
      console.log('Enter memory content (press Ctrl+D to finish):');
      let content = '';

      process.stdin.on('data', (data) => {
        content += data.toString();
      });

      process.stdin.on('end', () => {
        resolve(content.trim());
      });

      process.stdin.setEncoding('utf8');
      process.stdin.resume();
    });
  }

  /**
   * 运行命令行工具
   * @param args 命令行参数
   */
  run(args: string[]) {
    this.program.parse(args);
  }
}

// 导出命令行工具实例
export const memoryCLI = new MemoryCLI();
