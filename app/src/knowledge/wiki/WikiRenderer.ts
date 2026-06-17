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
 * 结构化 Wiki 渲染器 — WikiRenderer
 *
 * 根据 schema + 实体数据 + 关联边，渲染为带 frontmatter 的结构化
 * Markdown 页面。与现有的 KnowledgeCompiler 互补：
 *   - KnowledgeCompiler：自由文本 raw → 自由格式 wiki（LLM 驱动）
 *   - WikiRenderer：结构化数据 → 带 frontmatter 的 wiki（模板驱动）
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { Edge } from '@modules/knowledge/graph/KnowledgeGraph';
import type {
  EntitySchema,
  FieldDef,
} from '@modules/knowledge/schema/SchemaLoader';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 待渲染实体输入
 */
export interface RenderEntityInput {
  /** 实体类型标识 */
  kind: string;
  /** 实体 ID */
  id: string;
  /** 实体字段值 */
  fields: Record<string, unknown>;
  /** 入边列表（指向该实体的关系） */
  inboundEdges?: Edge[];
  /** 出边列表（从该实体出发的关系） */
  outboundEdges?: Edge[];
  /** 实体 schema */
  schema?: EntitySchema;
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 按类型统计的实体数量 */
  byKind: Record<string, number>;
  /** 最近编辑列表 */
  recentEdits: Array<{
    id: string;
    title: string;
    updatedAt: number;
  }>;
}

/**
 * Wiki 渲染器
 * 将结构化实体数据渲染为带 frontmatter 的 Markdown 文件
 */
export class WikiRenderer {
  private templateDir: string;

  /**
   * @param templateDir 模板目录路径（可选，当前版本使用内建模板）
   */
  constructor(templateDir?: string) {
    this.templateDir = templateDir || '';
  }

  /**
   * 渲染单个实体为结构化 Markdown
   * @param input 实体渲染输入
   * @returns 完整的 .md 文件内容（含 frontmatter）
   */
  async render(input: RenderEntityInput): Promise<string> {
    const title = (input.fields.title as string) || input.id;
    const kind = input.kind;
    const now = new Date().toISOString();
    const lines: string[] = [];

    // frontmatter
    lines.push('---');
    lines.push(`id: ${input.id}`);
    lines.push(`kind: ${kind}`);
    lines.push(`title: ${title}`);
    lines.push(`created_at: ${now}`);
    lines.push(`updated_at: ${now}`);

    // 将字段写入 frontmatter
    for (const [key, value] of Object.entries(input.fields)) {
      if (key === 'title' || key === 'content') continue;
      if (value === undefined || value === null) continue;
      lines.push(this.formatFrontmatterValue(key, value));
    }

    // 边统计
    const inCount = input.inboundEdges?.length ?? 0;
    const outCount = input.outboundEdges?.length ?? 0;
    if (inCount > 0 || outCount > 0) {
      lines.push(`inbound_edges: ${inCount}`);
      lines.push(`outbound_edges: ${outCount}`);
    }

    lines.push('---');
    lines.push('');

    // 标题
    const displayName = input.schema?.displayName || kind;
    lines.push(`# ${title}`);
    lines.push('');

    // 类型标签
    lines.push(`> **类型**: ${displayName} | **ID**: \`${input.id}\``);
    lines.push('');

    // 描述（取自 content 字段或 schema 描述）
    const content = input.fields.content as string | undefined;
    if (content) {
      lines.push(content);
      lines.push('');
    }

    // 出边列表
    if (input.outboundEdges && input.outboundEdges.length > 0) {
      lines.push('## 关联（出边）');
      lines.push('');
      for (const edge of input.outboundEdges) {
        lines.push(`- **${edge.type}** → [[${edge.to}]]`);
        if (Object.keys(edge.attributes).length > 0) {
          lines.push(`  - 属性: ${JSON.stringify(edge.attributes)}`);
        }
      }
      lines.push('');
    }

    // 入边列表
    if (input.inboundEdges && input.inboundEdges.length > 0) {
      lines.push('## 被关联（入边）');
      lines.push('');
      for (const edge of input.inboundEdges) {
        lines.push(`- [[${edge.from}]] → **${edge.type}**`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 渲染 index.md 索引页
   * @param stats 索引统计信息
   * @returns index.md 文件内容
   */
  async renderIndex(stats: IndexStats): Promise<string> {
    const lines: string[] = [];

    lines.push('---');
    lines.push('id: index');
    lines.push('kind: index');
    lines.push('title: 知识库索引');
    lines.push('---');
    lines.push('');
    lines.push('# 📚 知识库索引');
    lines.push('');
    lines.push('## 按类型统计');
    lines.push('');
    lines.push('| 类型 | 数量 |');
    lines.push('|------|:----:|');

    for (const [kind, count] of Object.entries(stats.byKind)) {
      lines.push(`| ${kind} | ${count} |`);
    }

    if (stats.recentEdits.length > 0) {
      lines.push('');
      lines.push('## 最近更新');
      lines.push('');
      lines.push('| 页面 | 更新时间 |');
      lines.push('|------|---------|');

      const sorted = [...stats.recentEdits].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      for (const edit of sorted.slice(0, 20)) {
        const date = new Date(edit.updatedAt).toISOString().slice(0, 10);
        lines.push(`| [[${edit.id}]] | ${date} |`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * 将字段值格式化为 frontmatter YAML 行
   */
  private formatFrontmatterValue(key: string, value: unknown): string {
    if (typeof value === 'string') {
      // 包含特殊字符时加引号
      if (
        value.includes(':') ||
        value.includes('#') ||
        value.includes("'") ||
        value.includes('"')
      ) {
        return `${key}: "${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}: ${value}`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${key}: ${value}`;
    }

    if (Array.isArray(value)) {
      const items = value.map((v) => `"${String(v)}"`).join(', ');
      return `${key}: [${items}]`;
    }

    return `${key}: ${JSON.stringify(value)}`;
  }

  /**
   * 将 FieldDef 描述渲染为 Markdown 表格行
   * @param schema 实体 schema
   * @returns Markdown 字段文档
   */
  renderFieldDoc(schema: EntitySchema): string {
    const lines: string[] = [];
    lines.push(`### ${schema.displayName}（${schema.kind}）`);
    lines.push('');
    lines.push(schema.description);
    lines.push('');
    lines.push('| 字段 | 类型 | 必填 | 描述 |');
    lines.push('|------|------|:----:|------|');

    for (const [name, def] of Object.entries(schema.fields)) {
      const required = def.required ? '是' : '否';
      const desc = def.description || '';
      lines.push(`| ${name} | ${def.type} | ${required} | ${desc} |`);
    }

    lines.push('');
    return lines.join('\n');
  }
}
