/**
 * 上下文篱笆
 * 对标 Hermes <memory-context> 篱笆标签
 * 确保记忆内容被正确包裹在安全的上下文标签中
 */
import fs from 'node:fs';
import path from 'path';

/**
 * 上下文篱笆标签
 */
export const CONTEXT_FENCE = {
  open: '<memory-context>',
  close: '</memory-context>',
  openInjection: '<injected-context>',
  closeInjection: '</injected-context>',
} as const;

/**
 * 上下文篱笆管理器
 */
export class ContextFence {
  /**
   * 将内容包裹在上下文篱笆中
   * @param content 原始内容
   * @param tag 标签类型
   * @returns 包裹后的内容
   */
  wrap(content: string, tag: 'memory' | 'injected' = 'memory'): string {
    const openTag =
      tag === 'memory' ? CONTEXT_FENCE.open : CONTEXT_FENCE.openInjection;
    const closeTag =
      tag === 'memory' ? CONTEXT_FENCE.close : CONTEXT_FENCE.closeInjection;

    return `${openTag}\n${content}\n${closeTag}`;
  }

  /**
   * 从内容中提取篱笆内的文本
   * @param content 包含篱笆的内容
   * @returns 提取的内容数组
   */
  extractFencedContent(content: string): string[] {
    const results: string[] = [];
    const pattern = /<memory-context>([\s\S]*?)<\/memory-context>/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      results.push(match[1].trim());
    }

    const injectionPattern =
      /<injected-context>([\s\S]*?)<\/injected-context>/g;
    while ((match = injectionPattern.exec(content)) !== null) {
      results.push(match[1].trim());
    }

    return results;
  }

  /**
   * 剥离所有篱笆标签
   * @param content 包含篱笆的内容
   * @returns 剥离后的内容
   */
  stripFences(content: string): string {
    return content
      .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, '')
      .replace(/<injected-context>[\s\S]*?<\/injected-context>/g, '')
      .trim();
  }

  /**
   * 检查内容是否包含有效的篱笆结构
   * @param content 内容
   * @returns 是否包含
   */
  hasFences(content: string): boolean {
    return (
      /<memory-context>[\s\S]*?<\/memory-context>/g.test(content) ||
      /<injected-context>[\s\S]*?<\/injected-context>/g.test(content)
    );
  }

  /**
   * 从文件读取并包裹内容
   * @param filePath 文件路径
   * @returns 包裹后的内容
   */
  wrapFromFile(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return '';
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    return this.wrap(content);
  }

  /**
   * 构建记忆上下文（聚合多个文件）
   * @param memoryDir 记忆目录
   * @param maxFiles 最大文件数
   * @returns 格式化的上下文字符串
   */
  buildMemoryContext(memoryDir: string, maxFiles: number = 10): string {
    if (!fs.existsSync(memoryDir)) {
      return '';
    }

    const files = fs
      .readdirSync(memoryDir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.json'))
      .map((f) => ({
        name: f,
        path: path.join(memoryDir, f),
        mtime: fs.statSync(path.join(memoryDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxFiles);

    const contents: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const wrapped = this.wrap(`[${file.name}]\n${content}`);
      contents.push(wrapped);
    }

    return contents.join('\n\n');
  }
}

/**
 * 全局上下文篱笆实例
 */
let globalContextFence: ContextFence | null = null;

/**
 * 获取全局上下文篱笆
 * @returns ContextFence 实例
 */
export function getContextFence(): ContextFence {
  if (!globalContextFence) {
    globalContextFence = new ContextFence();
  }

  return globalContextFence;
}
