/**
 * 知识库健康检查器 (KnowledgeLinter)
 * 对标 CC/OpenClaw 文档检查实践，对知识库做 6 类诊断：
 *   A. 结构完整性 — frontmatter/title 必填字段
 *   B. 新鲜度 — 90 天未更新的文档
 *   C. 断链检测 — [[内部链接]] 目标不可达
 *   D. 一致性问题 (LLM) — 可选，需 AI 服务
 *   E. 质量评分 (LLM) — 可选，需 AI 服务
 *   F. 关联性 — 孤立文档（无入链）
 */
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import type { AIService } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { resolvePyappHome } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:knowledgeLinter',
  level: LogLevel.INFO,
});

export interface LintResult {
  /** 文档总数 */
  totalDocs: number;
  /** 各诊断类别的问题列表 */
  issues: LintIssue[];
  /** 汇总统计 */
  summary: {
    totalIssues: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

export interface LintIssue {
  category:
    | 'structure'
    | 'freshness'
    | 'broken_link'
    | 'consistency'
    | 'quality'
    | 'isolation';
  severity: 'error' | 'warning' | 'info';
  docPath: string;
  message: string;
  detail?: string;
}

/**
 * 获取用户知识库根目录
 */
function getKnowledgeRoot(): string {
  return join(resolvePyappHome(), 'knowledge');
}

/**
 * 解析 Markdown frontmatter
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const frontmatter: Record<string, string> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const fmText = content.slice(3, endIndex).trim();
      body = content.slice(endIndex + 3).trim();
      for (const line of fmText.split('\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      }
    }
  }

  return { frontmatter, body };
}

/**
 * 提取文档中的 [[内部链接]]
 */
function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const link = match[1].split('|')[0].split('#')[0].trim();
    if (link) links.push(link);
  }
  return links;
}

/**
 * 知识库健康检查器
 */
export class KnowledgeLinter {
  private knowledgeRoot: string;
  private aiService?: AIService;

  constructor(aiService?: AIService) {
    this.knowledgeRoot = getKnowledgeRoot();
    this.aiService = aiService;
  }

  /**
   * 执行全部诊断检查
   */
  async lintAll(): Promise<LintResult> {
    const issues: LintIssue[] = [];
    const docFiles = await this.collectDocFiles();

    if (docFiles.length === 0) {
      return {
        totalDocs: 0,
        issues: [],
        summary: { totalIssues: 0, byCategory: {}, bySeverity: {} },
      };
    }

    // A. 结构完整性检查
    const structureIssues = await this.checkStructure(docFiles);
    issues.push(...structureIssues);

    // B. 新鲜度检查
    const freshnessIssues = await this.checkFreshness(docFiles);
    issues.push(...freshnessIssues);

    // C. 断链检测
    const brokenLinkIssues = await this.checkBrokenLinks(docFiles);
    issues.push(...brokenLinkIssues);

    // D. 一致性问题 (LLM)
    if (this.aiService) {
      const consistencyIssues = await this.checkConsistency(docFiles);
      issues.push(...consistencyIssues);
    }

    // E. 质量评分 (LLM)
    if (this.aiService) {
      const qualityIssues = await this.checkQuality(docFiles);
      issues.push(...qualityIssues);
    }

    // F. 关联性检查
    const isolationIssues = await this.checkIsolation(docFiles);
    issues.push(...isolationIssues);

    return this.buildResult(docFiles.length, issues);
  }

  /**
   * 收集知识库中的所有 Markdown 文件
   */
  private async collectDocFiles(): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    }

    await walk(this.knowledgeRoot);
    return files;
  }

  /**
   * A. 结构完整性检查
   */
  private async checkStructure(docFiles: string[]): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];

    for (const filePath of docFiles) {
      const relPath = relative(this.knowledgeRoot, filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        if (!frontmatter.title && !content.startsWith('#')) {
          issues.push({
            category: 'structure',
            severity: 'error',
            docPath: relPath,
            message: '文档缺少标题（frontmatter title 或 h1 标题）',
          });
        }

        if (!body || body.trim().length === 0) {
          issues.push({
            category: 'structure',
            severity: 'warning',
            docPath: relPath,
            message: '文档正文为空',
          });
        }

        if (content.length > 50000) {
          issues.push({
            category: 'structure',
            severity: 'warning',
            docPath: relPath,
            message: `文档过长 (${content.length} 字符)，建议拆分`,
          });
        }
      } catch (error) {
        issues.push({
          category: 'structure',
          severity: 'error',
          docPath: relPath,
          message: `无法读取文档: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return issues;
  }

  /**
   * B. 新鲜度检查
   */
  private async checkFreshness(docFiles: string[]): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const now = Date.now();
    const staledDays = 90;
    const staleThreshold = staledDays * 24 * 60 * 60 * 1000;

    for (const filePath of docFiles) {
      const relPath = relative(this.knowledgeRoot, filePath);
      try {
        const stats = await stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > staleThreshold) {
          const daysOld = Math.floor(age / (24 * 60 * 60 * 1000));
          issues.push({
            category: 'freshness',
            severity: 'warning',
            docPath: relPath,
            message: `文档已 ${daysOld} 天未更新（超过 ${staledDays} 天阈值）`,
            detail: `最后修改: ${stats.mtime.toISOString()}`,
          });
        }
      } catch (err) {
        // 忽略无法 stat 的文件
      }
    }

    return issues;
  }

  /**
   * C. 断链检测
   */
  private async checkBrokenLinks(docFiles: string[]): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];

    for (const filePath of docFiles) {
      const relPath = relative(this.knowledgeRoot, filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        const links = extractWikiLinks(content);

        for (const link of links) {
          const linkFile = link.endsWith('.md') ? link : `${link}.md`;
          const targetPath = join(this.knowledgeRoot, linkFile);

          if (!existsSync(targetPath)) {
            issues.push({
              category: 'broken_link',
              severity: 'error',
              docPath: relPath,
              message: `断链: [[${link}]] -> ${linkFile} 文件不存在`,
            });
          }
        }
      } catch (err) {
        // 忽略无法读取的文件
      }
    }

    return issues;
  }

  /**
   * D. 一致性问题检查 (LLM)
   */
  private async checkConsistency(docFiles: string[]): Promise<LintIssue[]> {
    if (!this.aiService) return [];

    const issues: LintIssue[] = [];
    const contentMap = new Map<string, string>();

    for (const filePath of docFiles) {
      const relPath = relative(this.knowledgeRoot, filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        contentMap.set(relPath, content);
      } catch (err) {
        // 忽略无法读取的文件
      }
    }

    if (contentMap.size < 2) return [];

    const allContent = Array.from(contentMap.entries())
      .slice(0, 10)
      .map(([path, content]) => `--- ${path} ---\n${content.slice(0, 3000)}`)
      .join('\n\n');

    try {
      const response = await this.aiService.generate([
        {
          role: AIMessageRole.SYSTEM,
          content:
            '你是知识库一致性检查助手。分析以下多个文档，找出内容矛盾或不一致的地方。' +
            '仅输出矛盾点，每行一条，格式: "文档路径: 矛盾描述"。如果没有矛盾，输出 "无矛盾"。',
          timestamp: Date.now(),
        },
        {
          role: AIMessageRole.USER,
          content: allContent,
          timestamp: Date.now(),
        },
      ]);

      const result = response.content.trim();
      if (result && result !== '无矛盾') {
        for (const line of result.split('\n')) {
          if (line.trim()) {
            const pathMatch = line.match(/^([^:]+):\s*(.+)/);
            issues.push({
              category: 'consistency',
              severity: 'warning',
              docPath: pathMatch ? pathMatch[1].trim() : '多个文档',
              message: '可能存在内容矛盾',
              detail: pathMatch ? pathMatch[2].trim() : line.trim(),
            });
          }
        }
      }
    } catch (error) {
      logger.warning('一致性检查 LLM 调用失败', { error });
    }

    return issues;
  }

  /**
   * E. 质量评分 (LLM)
   */
  private async checkQuality(docFiles: string[]): Promise<LintIssue[]> {
    if (!this.aiService) return [];

    const issues: LintIssue[] = [];

    for (const filePath of docFiles.slice(0, 5)) {
      const relPath = relative(this.knowledgeRoot, filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        if (content.length < 500) {
          issues.push({
            category: 'quality',
            severity: 'info',
            docPath: relPath,
            message: '文档较短，建议补充详细内容',
          });
          continue;
        }

        const response = await this.aiService.generate([
          {
            role: AIMessageRole.SYSTEM,
            content:
              '作为知识库质量评估助手，从完整性、清晰度、结构三方面评分（0-100）。' +
              '仅输出分数，格式: "完整性/清晰度/结构"。例如: "85/70/90"。',
            timestamp: Date.now(),
          },
          {
            role: AIMessageRole.USER,
            content: `文档: ${relPath}\n\n${content.slice(0, 2000)}`,
            timestamp: Date.now(),
          },
        ]);

        const scoreStr = response.content.trim();
        if (/^\d{1,3}\/\d{1,3}\/\d{1,3}$/.test(scoreStr)) {
          const [completeness, clarity, structure] = scoreStr
            .split('/')
            .map(Number);
          if (completeness < 50 || clarity < 50 || structure < 50) {
            issues.push({
              category: 'quality',
              severity: 'info',
              docPath: relPath,
              message: `质量评分偏低 (完整性:${completeness}, 清晰度:${clarity}, 结构:${structure})`,
              detail: '建议补充内容、优化表达或改善结构',
            });
          }
        }
      } catch (err) {
        // 忽略 LLM 调用失败
      }
    }

    return issues;
  }

  /**
   * F. 关联性检查 — 孤立文档检测
   */
  private async checkIsolation(docFiles: string[]): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const inboundLinks = new Set<string>();
    const docNames = new Set(
      docFiles.map((f) => relative(this.knowledgeRoot, f))
    );

    for (const filePath of docFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const links = extractWikiLinks(content);
        for (const link of links) {
          inboundLinks.add(
            link.endsWith('.md')
              ? link.toLowerCase()
              : `${link}.md`.toLowerCase()
          );
        }
      } catch (err) {
        // 忽略无法读取的文件
      }
    }

    for (const filePath of docFiles) {
      const relPath = relative(this.knowledgeRoot, filePath);
      const fileName = relPath.toLowerCase();

      const hasInbound = Array.from(inboundLinks).some(
        (link) => fileName === link || fileName.endsWith(`/${link}`)
      );

      if (!hasInbound && docNames.size > 1) {
        issues.push({
          category: 'isolation',
          severity: 'info',
          docPath: relPath,
          message: '孤立文档：没有被其他任何文档引用',
          detail: '建议在相关文档中添加对本文档的 [[引用]]',
        });
      }
    }

    return issues;
  }

  /**
   * 构建检查结果
   */
  private buildResult(totalDocs: number, issues: LintIssue[]): LintResult {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const issue of issues) {
      byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    return {
      totalDocs,
      issues,
      summary: {
        totalIssues: issues.length,
        byCategory,
        bySeverity,
      },
    };
  }
}

/**
 * 一键执行知识库健康检查
 */
export async function runKnowledgeLint(
  aiService?: AIService
): Promise<LintResult> {
  const linter = new KnowledgeLinter(aiService);
  const result = await linter.lintAll();
  return result;
}

/**
 * 格式化检查结果为可读文本
 */
export function formatLintResult(result: LintResult): string {
  const lines: string[] = [];
  const emojis: Record<string, string> = {
    structure: '📐',
    freshness: '⏰',
    broken_link: '🔗',
    consistency: '⚖️',
    quality: '⭐',
    isolation: '🔍',
  };
  const severityLabels: Record<string, string> = {
    error: '🔴 错误',
    warning: '🟡 警告',
    info: '🔵 提示',
  };

  lines.push(`📋 知识库健康检查报告`);
  lines.push(
    `共检查 ${result.totalDocs} 个文档，发现 ${result.summary.totalIssues} 个问题`
  );
  lines.push('');

  // 汇总
  lines.push('--- 汇总 ---');
  for (const [cat, count] of Object.entries(result.summary.byCategory)) {
    lines.push(`  ${emojis[cat] || '📄'} ${cat}: ${count} 个问题`);
  }
  for (const [sev, count] of Object.entries(result.summary.bySeverity)) {
    lines.push(`  ${severityLabels[sev] || sev}: ${count} 个`);
  }
  lines.push('');

  // 详细信息
  if (result.issues.length > 0) {
    lines.push('--- 详细信息 ---');
    const sorted = [...result.issues].sort((a, b) => {
      const sevOrder = { error: 0, warning: 1, info: 2 };
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    });

    for (const issue of sorted) {
      lines.push(
        `  ${emojis[issue.category] || ''} ${severityLabels[issue.severity] || issue.severity}: ${issue.docPath}`
      );
      lines.push(`    ${issue.message}`);
      if (issue.detail) {
        lines.push(`    详情: ${issue.detail}`);
      }
    }
  } else {
    lines.push('✅ 没有发现问题！');
  }

  return lines.join('\n');
}
