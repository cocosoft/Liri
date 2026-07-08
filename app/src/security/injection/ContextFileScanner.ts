/**
 * 上下文文件扫描器
 * 对标 Hermes prompt_builder.py 的 AGENTS.md/SOUL.md 上下文文件扫描
 * 扫描并提取项目中的上下文文件内容
 */
import fs from 'node:fs';
import path from 'path';

/**
 * 上下文文件类型
 */
export type ContextFileType =
  | 'agents'
  | 'soul'
  | 'rules'
  | 'instructions'
  | 'unknown';

/**
 * 上下文文件条目
 */
export interface ContextFileEntry {
  path: string;
  type: ContextFileType;
  content: string;
  size: number;
  mtime: number;
  valid: boolean;
}

/**
 * 上下文文件名映射
 */
const CONTEXT_FILE_NAMES: Record<string, ContextFileType> = {
  'AGENTS.md': 'agents',
  'AGENTS.txt': 'agents',
  'SOUL.md': 'soul',
  'SOUL.txt': 'soul',
  '.cursorrules': 'rules',
  '.windsurfrules': 'rules',
  '.github/copilot-instructions.md': 'instructions',
  'CLAUDE.md': 'agents',
  'COPILOT.md': 'instructions',
};

/**
 * 上下文文件扫描器
 */
export class ContextFileScanner {
  private maxFileSize: number;
  private scanDepth: number;

  /**
   * 构造函数
   * @param maxFileSize 最大文件大小（字节）
   * @param scanDepth 扫描深度（0 = 无限）
   */
  constructor(maxFileSize: number = 100_000, scanDepth: number = 3) {
    this.maxFileSize = maxFileSize;
    this.scanDepth = scanDepth;
  }

  /**
   * 扫描目录中的上下文文件
   * @param rootDir 根目录
   * @returns 上下文文件列表
   */
  scan(rootDir: string): ContextFileEntry[] {
    const entries: ContextFileEntry[] = [];

    this.scanDirectory(rootDir, rootDir, 0, entries);

    return entries.sort((a, b) => {
      const typeOrder: ContextFileType[] = [
        'agents',
        'soul',
        'rules',
        'instructions',
        'unknown',
      ];
      const typeDiff = typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
      if (typeDiff !== 0) return typeDiff;

      return a.path.localeCompare(b.path);
    });
  }

  /**
   * 递归扫描目录
   * @param rootDir 根目录
   * @param currentDir 当前目录
   * @param depth 当前深度
   * @param entries 累积条目
   */
  private scanDirectory(
    rootDir: string,
    currentDir: string,
    depth: number,
    entries: ContextFileEntry[]
  ): void {
    if (this.scanDepth > 0 && depth > this.scanDepth) {
      return;
    }

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = path.join(currentDir, item.name);

      if (item.isDirectory()) {
        if (
          item.name === 'node_modules' ||
          item.name === '.git' ||
          item.name === '__pycache__'
        ) {
          continue;
        }
        this.scanDirectory(rootDir, fullPath, depth + 1, entries);
      } else if (item.isFile()) {
        const entry = this.tryReadContextFile(fullPath);
        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  /**
   * 尝试读取上下文文件
   * @param filePath 文件路径
   * @returns 上下文文件条目
   */
  private tryReadContextFile(filePath: string): ContextFileEntry | null {
    const fileName = path.basename(filePath);
    const type = CONTEXT_FILE_NAMES[fileName];

    if (!type) {
      const relativePath = filePath.replace(/\\/g, '/');
      for (const [key, value] of Object.entries(CONTEXT_FILE_NAMES)) {
        if (relativePath.endsWith('/' + key) || filePath.endsWith('\\' + key)) {
          const fullKey = key;
          if (CONTEXT_FILE_NAMES[fullKey]) {
            try {
              const stat = fs.statSync(filePath);
              if (stat.size > this.maxFileSize) {
                return {
                  path: filePath,
                  type: CONTEXT_FILE_NAMES[fullKey],
                  content: '',
                  size: stat.size,
                  mtime: stat.mtimeMs,
                  valid: false,
                };
              }
            } catch {
              return null;
            }

            return null;
          }
        }
      }
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > this.maxFileSize) {
        return {
          path: filePath,
          type,
          content: '',
          size: stat.size,
          mtime: stat.mtimeMs,
          valid: false,
        };
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      return {
        path: filePath,
        type,
        content,
        size: stat.size,
        mtime: stat.mtimeMs,
        valid: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * 生成格式化的上下文文本
   * @param entries 上下文文件列表
   * @returns 格式化文本
   */
  formatAsContext(entries: ContextFileEntry[]): string {
    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = [];
    const validEntries = entries.filter((e) => e.valid);

    lines.push('--- 上下文文件 ---');

    for (const entry of validEntries) {
      const typeLabel = {
        agents: 'AGENTS',
        soul: 'SOUL',
        rules: 'Rules',
        instructions: 'Instructions',
        unknown: 'Unknown',
      }[entry.type];

      lines.push(
        `\n[${typeLabel}] ${path.relative(process.cwd(), entry.path)}:`
      );
      lines.push('```');
      lines.push(entry.content.slice(0, 8000));
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * 扫描并返回格式化的上下文
   * @param rootDir 根目录
   * @returns 格式化的上下文字符串
   */
  scanAndFormat(rootDir: string): string {
    const entries = this.scan(rootDir);

    return this.formatAsContext(entries);
  }

  /**
   * 获取扫描的文件类型摘要
   * @param entries 上下文文件列表
   */
  getSummary(entries: ContextFileEntry[]): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const entry of entries) {
      summary[entry.type] = (summary[entry.type] || 0) + 1;
    }

    return summary;
  }
}

/**
 * 全局上下文文件扫描器实例
 */
let globalScanner: ContextFileScanner | null = null;

/**
 * 获取全局上下文文件扫描器
 */
export function getContextFileScanner(): ContextFileScanner {
  if (!globalScanner) {
    globalScanner = new ContextFileScanner();
  }

  return globalScanner;
}
