// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 轻量索引管理器 — IndexManager
 *
 * 管理知识库的 index.md（页面索引）和 log.md（活动日志）。
 * 对标 Karpathy LLM Wiki 纯文本索引方案——中等规模知识库
 * 无需向量数据库，纯 Markdown 即可满足检索需求。
 *
 * 文件位置：
 *   ~/.pyapp/knowledge/index.md  — 按 kind 分组的页面索引
 *   ~/.pyapp/knowledge/log.md    — 编译/更新活动日志
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveKnowledgeDir, resolveDomainDir } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/** 单次活动记录 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: number;
  /** 操作类型 */
  action: 'compile' | 'update' | 'delete' | 'lint';
  /** 源文件或触发者 */
  source: string;
  /** 涉及的页面列表 */
  pages: string[];
  /** 详情 */
  detail?: string;
}

/**
 * 索引管理器
 * 负责 index.md 和 log.md 的生成和维护
 *
 * Domain-First 模式下，通过 domainName 指定域：
 *   读写 ~/.pyapp/knowledge/domains/{domain}/ 下的 index.md 和 log.md
 */
export class IndexManager {
  private knowledgeRoot: string;
  private domainName?: string;

  /**
   * @param knowledgeRoot 知识库根目录，默认 ~/.pyapp/knowledge/
   * @param domainName 域名称（可选）。指定后默认路径为域目录
   */
  constructor(knowledgeRoot?: string, domainName?: string) {
    this.domainName = domainName;
    if (knowledgeRoot) {
      this.knowledgeRoot = knowledgeRoot;
    } else if (domainName) {
      this.knowledgeRoot = resolveDomainDir(domainName);
    } else {
      this.knowledgeRoot = resolveKnowledgeDir();
    }
  }

  /**
   * 获取域名称（可能为空）
   */
  getDomainName(): string | undefined {
    return this.domainName;
  }

  // -----------------------------------------------------------------------
  // index.md
  // -----------------------------------------------------------------------

  /**
   * 生成/更新 index.md
   * 扫描所有 wiki 页面，按 kind 分组生成索引，每页附带摘要
   */
  async updateIndexMd(): Promise<void> {
    const pages = await this.listPages();

    if (pages.length === 0) {
      await this.writeIndex(
        `---\nid: index\ntitle: 知识库索引\nkind: index\n---\n\n# 知识库索引\n\n知识库当前为空。\n`
      );
      return;
    }

    // 按 kind 分组，同时提取摘要
    const byKind = new Map<string, Array<{ id: string; title: string; summary: string }>>();

    for (const page of pages) {
      const filePath = join(this.knowledgeRoot, page);
      let kind = '其他';
      let title = page.replace(/\.md$/, '');
      let id = title;
      let summary = '';

      try {
        const content = await readFile(filePath, 'utf-8');
        const kindMatch = content.match(/^kind:\s*(.+)$/m);
        if (kindMatch) {
          kind = kindMatch[1].trim().replace(/["'"]/g, '');
        }
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        if (titleMatch) {
          title = titleMatch[1].trim().replace(/["'"]/g, '');
        }
        const idMatch = content.match(/^id:\s*(.+)$/m);
        if (idMatch) {
          id = idMatch[1].trim().replace(/["'"]/g, '');
        }
        const summaryMatch = content.match(/^summary:\s*(.+)$/m);
        if (summaryMatch) {
          summary = summaryMatch[1].trim().replace(/["'"]/g, '');
        }
      } catch {
        // 无法读取时使用默认值
      }

      const list = byKind.get(kind) || [];
      list.push({ id, title, summary });
      byKind.set(kind, list);
    }

    const lines: string[] = [];
    lines.push('---');
    lines.push('id: index');
    lines.push('title: 知识库索引');
    lines.push('kind: index');
    lines.push('---');
    lines.push('');
    lines.push('# 知识库索引');
    lines.push('');
    lines.push('> 自动生成 — 最后更新: ' + new Date().toISOString().slice(0, 10));
    lines.push('');
    lines.push(`共 ${pages.length} 个页面`);
    lines.push('');

    for (const [kind, pageList] of byKind) {
      lines.push(`## ${kind}（${pageList.length}）`);
      lines.push('');
      for (const item of pageList) {
        const display = item.title !== item.id
          ? `${item.title} — \`${item.id}\``
          : item.id;
        const summaryLine = item.summary
          ? `  — ${item.summary.slice(0, 60)}`
          : '';
        lines.push(`- [[${item.id}|${display}]]${summaryLine}`);
      }
      lines.push('');
    }

    await this.writeIndex(lines.join('\n'));
    logger.info(`index.md 已更新: ${pages.length} 个页面, ${byKind.size} 个分类`);
  }

  /**
   * 获取 index.md 内容，用于 L0 注入（注入 system prompt 时使用）
   * 仅返回页面摘要列表（精简版），适合 token 受限的场景
   *
   * @param maxEntries 最大条目数，默认 50
   * @returns 精简索引文本
   */
  async getIndexContext(maxEntries: number = 50): Promise<string> {
    const pages = await this.listPages();
    if (pages.length === 0) return '';

    const entries: string[] = [];
    entries.push(`# 知识库索引（${this.domainName || 'default'}）`);
    entries.push(`页面数: ${pages.length}`);
    entries.push('');

    let count = 0;
    for (const page of pages) {
      if (count >= maxEntries) break;
      const filePath = join(this.knowledgeRoot, page);
      let title = page.replace(/\.md$/, '');
      let summary = '';
      let kind = '';

      try {
        const content = await readFile(filePath, 'utf-8');
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim().replace(/["'"]/g, '');
        const summaryMatch = content.match(/^summary:\s*(.+)$/m);
        if (summaryMatch) summary = summaryMatch[1].trim().replace(/["'"]/g, '');
        const kindMatch = content.match(/^kind:\s*(.+)$/m);
        if (kindMatch) kind = kindMatch[1].trim().replace(/["'"]/g, '');
      } catch { /* 忽略 */ }

      const kindTag = kind ? `[${kind}] ` : '';
      const summarySuffix = summary ? ` — ${summary.slice(0, 80)}` : '';
      entries.push(`- ${kindTag}${title}${summarySuffix}`);
      count++;
    }

    return entries.join('\n');
  }

  /**
   * 写入 index.md
   */
  private async writeIndex(content: string): Promise<void> {
    const filePath = join(this.knowledgeRoot, 'index.md');

    if (!existsSync(dirname(filePath))) {
      await mkdir(dirname(filePath), { recursive: true });
    }

    await writeFile(filePath, content, 'utf-8');
  }

  // -----------------------------------------------------------------------
  // log.md
  // -----------------------------------------------------------------------

  /**
   * 追加一条活动日志到 log.md
   * @param entry 活动记录
   */
  async appendLog(entry: LogEntry): Promise<void> {
    const logFile = join(this.knowledgeRoot, 'log.md');
    let existingLog = '';

    if (existsSync(logFile)) {
      try {
        existingLog = await readFile(logFile, 'utf-8');
      } catch {
        existingLog = '';
      }
    }

    const dateStr = new Date(entry.timestamp).toISOString();
    const pageList = entry.pages.join(', ');

    const actionLabel: Record<string, string> = {
      compile: '编译',
      update: '更新',
      delete: '删除',
      lint: '检查',
    };

    const logLine = [
      `- **${dateStr}** — ${actionLabel[entry.action] || entry.action}`,
      `  - 来源: ${entry.source}`,
      `  - 页面: ${pageList}`,
      entry.detail ? `  - 详情: ${entry.detail}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    // 检查 frontmatter
    let newLog: string;
    if (existingLog.trim().startsWith('---')) {
      // 已有 frontmatter，直接追加
      newLog = existingLog.trimEnd() + '\n' + logLine;
    } else {
      // 首次创建，加 frontmatter
      newLog = [
        '---',
        'id: log',
        'title: 知识库活动日志',
        'kind: log',
        '---',
        '',
        '# 知识库活动日志',
        '',
        logLine,
      ].join('\n');
    }

    await writeFile(logFile, newLog, 'utf-8');
  }

  /**
   * 读取 log.md 最近 N 条记录
   * @param count 返回条数，默认 20
   */
  async getRecentLogs(count: number = 20): Promise<string[]> {
    const logFile = join(this.knowledgeRoot, 'log.md');

    if (!existsSync(logFile)) return [];

    try {
      const content = await readFile(logFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.startsWith('- **'));

      return lines.slice(-count);
    } catch {
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // 内部工具
  // -----------------------------------------------------------------------

  /**
   * 列出已有 wiki 页面（不含 index.md 和 log.md）
   */
  async listPages(): Promise<string[]> {
    try {
      const entries = await readdir(this.knowledgeRoot);
      return entries
        .filter(
          (e) =>
            e.endsWith('.md') &&
            e !== 'index.md' &&
            e !== 'log.md' &&
            !e.includes('DIARY')
        )
        .sort();
    } catch {
      return [];
    }
  }
}
