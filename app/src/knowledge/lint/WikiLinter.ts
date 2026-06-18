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
 * Wiki Lint 框架 — WikiLinter
 *
 * 检查 wiki 页面的完整性和一致性。
 * 与 KnowledgeLinter（检查聊天格式的健康状况）互为补充：
 *   - KnowledgeLinter：检查 raw 目录中每条记录的格式是否正确
 *   - WikiLinter：检查 wiki 目录下渲染好的 .md 文件是否完整一致
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { resolveDomainDir, resolveKnowledgeDir } from '@modules/core/paths';
import type { FieldDef } from '@modules/knowledge/schema/SchemaLoader';
import { load } from 'js-yaml';

const logger = new Logger({ level: LogLevel.INFO });

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * 检查结果的严重等级
 */
export type Severity = 'error' | 'warning' | 'info';

/**
 * 单条检查结果
 */
export interface LintResult {
  /** 规则名称 */
  rule: string;
  /** 严重等级 */
  severity: Severity;
  /** 关联文件路径（相对于 wiki 目录） */
  file: string;
  /** 人类可读的描述 */
  message: string;
  /** 可选的自动修复函数 */
  fix?: () => Promise<void>;
}

/**
 * Lint 报告（一次 run 的输出）
 */
export interface LintReport {
  /** 所有结果 */
  results: LintResult[];
  /** 按严重等级汇总的计数 */
  summary: Record<Severity, number>;
}

/**
 * 一条 lint 规则的定义
 * 每个规则实现 check 方法即可自由注入。
 */
export interface LintRule {
  /** 规则名称 */
  name: string;
  /** 默认严重等级 */
  severity: Severity;
  /** 执行检查，返回扫描结果列表 */
  check: (wikiDir: string) => Promise<LintResult[]>;
}

// ---------------------------------------------------------------------------
// 内建规则实现
// ---------------------------------------------------------------------------

/**
 * 规则 1: orphan-files（warning）
 * 发现未被 index.md 引用的独立 .md 文件。
 */
async function checkOrphanFiles(wikiDir: string): Promise<LintResult[]> {
  const results: LintResult[] = [];
  const indexFile = join(wikiDir, 'index.md');

  if (!existsSync(indexFile)) {
    // 没有 index.md 时跳过孤儿文件检查
    return results;
  }

  const indexContent = readFileSync(indexFile, 'utf-8');

  // 读取 wiki 目录下所有 .md 文件
  let files: string[];
  try {
    files = readdirSync(wikiDir).filter(
      (f) => f.endsWith('.md') && f !== 'index.md'
    );
  } catch {
    return results;
  }

  for (const file of files) {
    const pageName = basename(file, '.md');
    // 检查是否被 index.md 以 [[pageName]] 形式引用
    const linkPattern = new RegExp(`\\[\\[${escapeRegex(pageName)}\\]\\]`);
    if (!linkPattern.test(indexContent)) {
      results.push({
        rule: 'orphan-files',
        severity: 'warning',
        file,
        message: `页面 "${pageName}" 未被 index.md 引用`,
      });
    }
  }

  return results;
}

/**
 * 规则 2: broken-links（error）
 * 检查 wiki 中 [[link]] 指向的页面是否存在。
 */
async function checkBrokenLinks(wikiDir: string): Promise<LintResult[]> {
  const results: LintResult[] = [];

  let files: string[];
  try {
    files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
  } catch {
    return results;
  }

  // 收集所有现有页面名
  const existingPages = new Set(files.map((f) => basename(f, '.md')));

  for (const file of files) {
    const content = readFileSync(join(wikiDir, file), 'utf-8');
    // 匹配 [[target]] 双链
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(content)) !== null) {
      const target = match[1].trim();
      // 跳过 index 引用
      if (target === 'index') continue;
      if (!existingPages.has(target)) {
        results.push({
          rule: 'broken-links',
          severity: 'error',
          file,
          message: `页面 "${file}" 存在断裂链接: [[${target}]]`,
        });
      }
    }
  }

  return results;
}

/**
 * 规则 3: stale-entities（info）
 * 标记超过 90 天未更新的页面。
 */
async function checkStaleEntities(wikiDir: string): Promise<LintResult[]> {
  const results: LintResult[] = [];
  const staleDays = 90;
  const now = Date.now();

  let files: string[];
  try {
    files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
  } catch {
    return results;
  }

  for (const file of files) {
    if (file === 'index.md') continue;

    const filePath = join(wikiDir, file);
    const stat = statSync(filePath);
    const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);

    if (ageDays > staleDays) {
      results.push({
        rule: 'stale-entities',
        severity: 'info',
        file,
        message: `页面 "${file}" 已 ${Math.floor(ageDays)} 天未更新（阈值: ${staleDays} 天）`,
      });
    }
  }

  return results;
}

/**
 * 规则 4: missing-frontmatter（error）
 * 检查 .md 文件是否包含 YAML frontmatter（--- 分隔）。
 */
async function checkMissingFrontmatter(wikiDir: string): Promise<LintResult[]> {
  const results: LintResult[] = [];

  let files: string[];
  try {
    files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
  } catch {
    return results;
  }

  for (const file of files) {
    const content = readFileSync(join(wikiDir, file), 'utf-8');
    const trimmed = content.trim();

    // frontmatter 必须以 --- 开头，然后是 YAML，再以 --- 结尾
    if (!trimmed.startsWith('---')) {
      results.push({
        rule: 'missing-frontmatter',
        severity: 'error',
        file,
        message: `页面 "${file}" 缺少 frontmatter（未以 --- 开头）`,
      });
    } else {
      // 检查是否有闭合的 ---
      const secondLineBreak = trimmed.indexOf('\n', 3);
      if (secondLineBreak === -1) {
        results.push({
          rule: 'missing-frontmatter',
          severity: 'error',
          file,
          message: `页面 "${file}" 的 frontmatter 未正确闭合`,
        });
      }
    }
  }

  return results;
}

/**
 * 规则 5: schema-mismatch（error）
 * 检测 wiki 页面的 frontmatter 字段是否与 schema 定义一致。
 *
 * 检查项：
 *   1. kind 字段必须对应 SchemaLoader 中已注册的 EntitySchema
 *   2. 所有 required 字段必须在 frontmatter 中存在
 *   3. 未知字段（不在 schema 中定义的）给出 warning
 *
 * schema 来源：wikiDir/../.schema/entities.yaml（域级别 schema）
 */
async function checkSchemaFieldMatch(wikiDir: string): Promise<LintResult[]> {
  const results: LintResult[] = [];

  // 解析 domain schema 目录
  let schemaDir: string;
  try {
    // wikiDir 可能形如 .../domains/{name}/wiki，取其父目录的父目录
    const parent = dirname(wikiDir);
    const grandParent = dirname(parent);
    const domainSchema = join(grandParent, '.schema');
    const globalSchema = join(parent, '.schema');

    if (existsSync(domainSchema)) {
      schemaDir = domainSchema;
    } else if (existsSync(globalSchema)) {
      schemaDir = globalSchema;
    } else {
      // 无 schema 时跳过此规则
      return results;
    }
  } catch {
    return results;
  }

  // 加载 entities.yaml
  const entitiesPath = join(schemaDir, 'entities.yaml');
  if (!existsSync(entitiesPath)) return results;

  let schemaEntities: Array<{
    kind: string;
    fields: Record<string, FieldDef>;
    displayName: string;
  }>;
  try {
    const raw = readFileSync(entitiesPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = load(raw) as any;
    schemaEntities = (parsed?.entities || []) as typeof schemaEntities;
  } catch {
    results.push({
      rule: 'schema-mismatch',
      severity: 'error',
      file: '.schema/entities.yaml',
      message: `entities.yaml 解析失败，无法执行 schema 字段匹配检查`,
    });
    return results;
  }

  // 建立 kind → schema 映射
  const schemaMap = new Map<
    string,
    { fields: Record<string, FieldDef>; displayName: string }
  >();
  for (const entity of schemaEntities) {
    schemaMap.set(entity.kind, {
      fields: entity.fields || {},
      displayName: entity.displayName,
    });
  }

  if (schemaMap.size === 0) return results;

  // 扫描 wiki 页面
  let files: string[];
  try {
    files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
  } catch {
    return results;
  }

  for (const file of files) {
    if (file === 'index.md') continue;

    const content = readFileSync(join(wikiDir, file), 'utf-8');
    const trimmed = content.trim();

    // 跳过无 frontmatter 的页面（由 missing-frontmatter 规则处理）
    if (!trimmed.startsWith('---')) continue;

    // 解析 frontmatter（简单逐行解析，避免引入 YAML 解析器依赖）
    const fmEnd = trimmed.indexOf('---', 3);
    if (fmEnd === -1) continue;

    const fmLines = trimmed.slice(3, fmEnd).split('\n').filter(Boolean);
    const fmFields = new Map<string, string>();
    let kind = '';

    for (const line of fmLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      fmFields.set(key, value);
      if (key === 'kind') kind = value;
    }

    if (!kind) continue; // 无 kind 字段，跳过（由其他规则处理）

    const entitySchema = schemaMap.get(kind);
    if (!entitySchema) {
      results.push({
        rule: 'schema-mismatch',
        severity: 'error',
        file,
        message: `页面 kind="${kind}" 未在 entities.yaml 中定义（已注册: ${Array.from(schemaMap.keys()).join(', ')}）`,
      });
      continue;
    }

    // 检查 required 字段是否缺失
    for (const [fieldName, fieldDef] of Object.entries(entitySchema.fields)) {
      if (fieldDef.required && !fmFields.has(fieldName)) {
        results.push({
          rule: 'schema-mismatch',
          severity: 'error',
          file,
          message: `缺少必填字段 "${fieldName}"（kind="${kind}"，schema 定义: ${entitySchema.displayName}）`,
        });
      }
    }

    // 检查未知字段（warning）：不在 schema 中定义的字段
    const knownFields = new Set([
      'kind',
      'title',
      'description',
      'tags',
      'created',
      'updated',
      ...Object.keys(entitySchema.fields),
    ]);
    for (const fieldName of fmFields.keys()) {
      if (!knownFields.has(fieldName)) {
        results.push({
          rule: 'schema-mismatch',
          severity: 'warning',
          file,
          message: `未知字段 "${fieldName}"（不在 ${kind} 的 schema 定义中）`,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 对正则表达式中的特殊字符进行转义
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 默认规则集
// ---------------------------------------------------------------------------

/**
 * 内建默认规则集
 */
export const defaultRules: LintRule[] = [
  { name: 'orphan-files', severity: 'warning', check: checkOrphanFiles },
  { name: 'broken-links', severity: 'error', check: checkBrokenLinks },
  { name: 'stale-entities', severity: 'info', check: checkStaleEntities },
  {
    name: 'missing-frontmatter',
    severity: 'error',
    check: checkMissingFrontmatter,
  },
  { name: 'schema-mismatch', severity: 'error', check: checkSchemaFieldMatch },
];

// ---------------------------------------------------------------------------
// WikiLinter 类
// ---------------------------------------------------------------------------

/**
 * Wiki Linter
 * 运行一组规则来检查 wiki 目录的完整性，返回结构化报告。
 *
 * 用法：
 *   const linter = new WikiLinter(rules);
 *   const report = await linter.run('/path/to/wiki');
 *   console.log(report.summary); // { error: 2, warning: 1, info: 3 }
 */
export class WikiLinter {
  private rules: LintRule[];

  /**
   * @param rules 规则列表，默认使用 defaultRules
   */
  constructor(rules: LintRule[] = defaultRules) {
    this.rules = rules;
  }

  /**
   * 运行所有规则，生成 lint 报告
   *
   * Domain-First 模式下，通过 domainName 限缩到特定域的 wiki：
   *   run(domainName='botany') → 检查 domains/botany/wiki/
   *
   * @param wikiDir wiki 目录路径，默认 ~/.pyapp/knowledge/wiki/
   * @param domainName 域名称（可选）。指定后 wikiDir 参数被忽略
   * @returns 结构化报告（结果列表 + 摘要）
   */
  async run(wikiDir?: string, domainName?: string): Promise<LintReport> {
    const targetDir = domainName
      ? join(resolveDomainDir(domainName), 'wiki')
      : wikiDir || join(resolveKnowledgeDir(), 'wiki');

    if (!existsSync(targetDir)) {
      logger.info(`wiki 目录不存在，跳过 lint: ${targetDir}`);
      return { results: [], summary: { error: 0, warning: 0, info: 0 } };
    }

    const allResults: LintResult[] = [];

    for (const rule of this.rules) {
      try {
        const ruleResults = await rule.check(targetDir);
        allResults.push(...ruleResults);
      } catch (err) {
        await handleError(err, {
          module: 'knowledge:linter',
          action: 'check_rule',
          context: { ruleName: rule.name },
        });
      }
    }

    // 汇总
    const summary: Record<Severity, number> = {
      error: allResults.filter((r) => r.severity === 'error').length,
      warning: allResults.filter((r) => r.severity === 'warning').length,
      info: allResults.filter((r) => r.severity === 'info').length,
    };

    logger.info(
      `Lint 完成: ${summary.error} errors, ${summary.warning} warnings, ${summary.info} info`
    );

    return { results: allResults, summary };
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: LintRule): void {
    this.rules.push(rule);
  }
}
