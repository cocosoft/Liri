/**
 * 项目上下文服务
 *
 * 解析 rules.md 中 ### [type] 标记，提取结构化 ProjectContext 条目。
 * 存量无标记内容自动归为 constraint 类型。
 *
 * rules.md 格式：
 *   ## 领域名称
 *   ### [goal] 项目目标：xxxx
 *   ### [scope] 范围：xxxx
 *   普通约束内容（无标记 → constraint）
 */

import { readFileSync, existsSync } from 'fs';
import type {
  ProjectContext,
  ProjectContextType,
} from '@modules/workspace/types';

/** type 标记正则：匹配 ### [xxx] 的内容 */
const TYPE_MARKER_RE =
  /^###\s+\[(goal|scope|constraint|requirement|knowledge)\]\s+(.+)/;

export class ProjectContextService {
  /**
   * 从 rules.md 文件解析 ProjectContext 条目
   * @param rulesPath rules.md 文件绝对路径
   * @returns 解析出的结构化上下文条目列表
   */
  static parseRulesFile(rulesPath: string): ProjectContext[] {
    if (!existsSync(rulesPath)) return [];

    const lines = readFileSync(rulesPath, 'utf-8').split('\n');
    return this.parseLines(lines);
  }

  /**
   * 从 lines 数组解析（公开，便于测试）
   */
  static parseLines(lines: string[]): ProjectContext[] {
    const entries: ProjectContext[] = [];
    let currentDomain: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;

      // ## 级别：领域标题
      if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
        currentDomain = trimmed.slice(3).trim();
        continue;
      }

      // ### [type] 标记行
      const markerMatch = trimmed.match(TYPE_MARKER_RE);
      if (markerMatch) {
        const type = markerMatch[1] as ProjectContextType;
        const content = markerMatch[2].trim();
        if (content) {
          entries.push({ type, content, domain: currentDomain, line: i + 1 });
        }
        continue;
      }

      // 普通内容行（无标记的规则文本）→ 归类为 constraint
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.slice(2).trim();
        if (content) {
          entries.push({
            type: 'constraint',
            content,
            domain: currentDomain,
            line: i + 1,
          });
        }
        continue;
      }

      // 纯文本段落 → 约束
      if (
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('```') &&
        trimmed.length > 3
      ) {
        entries.push({
          type: 'constraint',
          content: trimmed,
          domain: currentDomain,
          line: i + 1,
        });
      }
    }

    return entries;
  }

  /**
   * 将 ProjectContext 条目序列化回 rules.md 格式的 lines（用于 AI 写回）
   * 按 domain 分组，每组内按 type 排序。
   */
  static serializeToLines(entries: ProjectContext[]): string[] {
    const lines: string[] = [];
    const byDomain = new Map<string | undefined, ProjectContext[]>();

    for (const entry of entries) {
      const domain = entry.domain;
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(entry);
    }

    const domainOrder = Array.from(byDomain.keys());

    for (const domain of domainOrder) {
      if (domain) {
        lines.push('');
        lines.push(`## ${domain}`);
      }

      const items = byDomain.get(domain)!;
      // 排序：goal → scope → requirement → constraint → knowledge
      const typeOrder: ProjectContextType[] = [
        'goal',
        'scope',
        'requirement',
        'constraint',
        'knowledge',
      ];

      for (const t of typeOrder) {
        const typeItems = items.filter((e) => e.type === t);
        for (const item of typeItems) {
          lines.push(`### [${item.type}] ${item.content}`);
        }
      }
    }

    return lines;
  }
}
