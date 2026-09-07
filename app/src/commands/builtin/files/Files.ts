/**
 * 文件管理命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:files:Files');

/**
 * P1-2（2026-09-07）：递归守卫——clean/tree/find 共享的深度/黑名单/符号链接保护。
 * 防止遍历巨型目录（node_modules 等）、符号链接循环或超深层级导致卡死/误删。
 */
const MAX_DEPTH = 4;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cache',
  '.next',
  'target',
  '.venv',
  'venv',
  '__pycache__',
]);
const FIND_MAX_RESULTS = 200;
const CLEAN_PATTERNS = ['*.log', '*.tmp', '*.bak', '.DS_Store', 'Thumbs.db'];

/** 是否应跳过某条目（不进入/不处理）：符号链接一律跳过；目录超深或在黑名单则跳过进入 */
function shouldSkipEntry(
  name: string,
  depth: number,
  stat: { isSymbolicLink(): boolean; isDirectory(): boolean }
): boolean {
  if (stat.isSymbolicLink()) return true;
  if (!stat.isDirectory()) return false;
  return depth > MAX_DEPTH || SKIP_DIRS.has(name);
}

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
        return this.handleClean(parts.slice(1), context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出文件
   */
  async handleList(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
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
      const fileInfo = files.map((file) => {
        const fullPath = pathModule.join(targetPath, file);
        const stat = fs.statSync(fullPath);
        return {
          name: file,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.isFile() ? stat.size : '-',
          mtime: stat.mtime.toLocaleString(),
        };
      });

      const table = fileInfo
        .map(
          (f) =>
            `${f.type === 'directory' ? '[DIR]' : '[FILE]'} ${f.name.padEnd(30)} ${(f.size + '').padEnd(10)} ${f.mtime}`
        )
        .join('\n');

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
  async handleFind(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
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

      const search = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (foundFiles.length >= FIND_MAX_RESULTS) return;
          const fullPath = pathModule.join(dir, file);
          const stat = fs.lstatSync(fullPath);

          if (shouldSkipEntry(file, depth, stat)) continue;

          if (file.includes(pattern)) {
            foundFiles.push(fullPath);
          }

          if (stat.isDirectory()) {
            // P1-2：深度/黑名单按"将进入的层级"判定（root=0）
            if (!shouldSkipEntry(file, depth + 1, stat)) {
              search(fullPath, depth + 1);
            }
          }
        }
      };

      search(searchDir, 0);

      if (foundFiles.length === 0) {
        return {
          success: false,
          type: 'text',
          message: `未找到匹配 "${pattern}" 的文件`,
        };
      }

      const truncated = foundFiles.length >= FIND_MAX_RESULTS;
      return {
        success: true,
        type: 'text',
        message: `找到 ${foundFiles.length} 个匹配文件${
          truncated ? `（已达 ${FIND_MAX_RESULTS} 条上限，结果截断）` : ''
        }:\n\n${foundFiles.join('\n')}`,
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
  async handleView(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
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

      const fullPath = pathModule.resolve(
        context.cwd || process.cwd(),
        filePath
      );

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
  async handleTree(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
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

      const buildTree = (
        dir: string,
        prefix: string = '',
        depth: number = 0
      ) => {
        const files = fs.readdirSync(dir).sort();

        files.forEach((file, index) => {
          const fullPath = pathModule.join(dir, file);
          const stat = fs.lstatSync(fullPath);
          const isLast = index === files.length - 1;
          const connector = isLast ? '└──' : '├──';

          tree.push(`${prefix}${connector} ${file}`);

          // P1-2：目录条目仍显示，但黑名单/符号链接/超深目录不展开（防巨目录/链接循环）
          if (stat.isDirectory()) {
            const newDepth = depth + 1;
            if (!shouldSkipEntry(file, newDepth, stat)) {
              const newPrefix = prefix + (isLast ? '    ' : '│   ');
              buildTree(fullPath, newPrefix, newDepth);
            }
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
   * 默认 dry-run（仅列出清单不删除）；显式传 `--delete` 才真正删除。
   * 递归受守卫保护：跳过符号链接 / node_modules 等黑名单目录 / 超深目录（P1-2）。
   */
  async handleClean(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const doDelete = args.includes('--delete');
    const candidates: string[] = [];

    try {
      const fs = await import('fs');
      const pathModule = await import('path');

      const searchDir = context.cwd || process.cwd();

      const collect = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = pathModule.join(dir, file);
          const stat = fs.lstatSync(fullPath);

          if (shouldSkipEntry(file, depth, stat)) continue;

          if (stat.isDirectory()) {
            // P1-2：深度/黑名单按"将进入的层级"判定（root=0），与 find/tree 一致
            if (!shouldSkipEntry(file, depth + 1, stat)) {
              collect(fullPath, depth + 1);
            }
          } else {
            for (const pattern of CLEAN_PATTERNS) {
              const regex = new RegExp(
                '^' + pattern.replace(/\*/g, '.*') + '$'
              );
              if (regex.test(file)) {
                candidates.push(fullPath);
                break;
              }
            }
          }
        }
      };

      collect(searchDir, 0);

      // 默认 dry-run：输出待清理清单，需 --delete 确认后执行（防误删）
      if (!doDelete) {
        const preview = candidates
          .slice(0, 50)
          .map((p) => `  - ${p}`)
          .join('\n');
        const truncated = candidates.length > 50 ? '\n  …(仅显示前 50 条)' : '';
        return {
          success: true,
          type: 'text',
          message:
            `[dry-run] 检测到 ${candidates.length} 个临时文件（默认不删除；确认后执行 /files clean --delete）：\n` +
            (preview || '  （无匹配）') +
            truncated,
          data: { dryRun: true, count: candidates.length },
        };
      }

      let deletedCount = 0;
      for (const fullPath of candidates) {
        try {
          fs.unlinkSync(fullPath);
          deletedCount++;
        } catch (err) {
          logger.warn('clean 删除失败跳过', {
            path: fullPath,
            error: (err as Error).message,
          });
        }
      }

      context.onDone?.(`已清理 ${deletedCount} 个临时文件`, {
        display: 'system',
      });

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
/files clean           - 清理临时文件（默认 dry-run 预览；加 --delete 才删除）
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
