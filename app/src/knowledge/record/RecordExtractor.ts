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
 * RecordExtractor — LLM 驱动字段级业务记录抽取（K2）
 *
 * 编译完成后，按用户 records.yaml 声明的记录类型从编译页面抽取结构化行：
 *   - prompt 内联 schema（类型/字段/主键/值域），要求输出 type/fields/evidence
 *   - 抽取结果逐条过 SchemaLoader.validateRecord（必填+类型+enum/regex/range+主键）
 *   - 合法记录 upsert 进 RecordStore；非法记录告警日志并跳过（不静默入库）
 *
 * 仅当对应文档未配置记录 schema 时跳过，不影响既有编译/图谱管线。
 */

import { readFile } from 'fs/promises';
import { modelRouter } from '@modules/ai';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { SchemaLoader } from '../schema/SchemaLoader';
import type { RecordSchema, FieldDef } from '../schema/SchemaLoader';
import { RecordStore } from './RecordStore';

const logger = new OTelAwareLogger({
  module: 'knowledge:record:extract',
  level: LogLevel.INFO,
});

/** LLM 候选记录（未校验） */
export interface RecordCandidate {
  type: string;
  fields: Record<string, unknown>;
  evidence: Record<string, string>;
}

/** 单页抽取结果汇总 */
export interface PageRecordResult {
  saved: number;
  invalid: number;
  reasons: string[];
}

/** 抽取后单页落库汇总（供批量函数聚合） */
export interface BatchRecordResult {
  pagesProcessed: number;
  saved: number;
  invalid: number;
  reasons: string[];
}

/** 单批抽取页数上限（与图谱提取 GRAPH_EXTRACT_MAX_PAGES 对齐，防止无限排空） */
const RECORD_EXTRACT_MAX_PAGES = 50;

/** 构造字段约束描述（enum/regex/range 展示给 LLM） */
function describeField(name: string, def: FieldDef, primary: boolean): string {
  const parts: string[] = [
    `${name}(type=${def.type}${def.required || primary ? ',required' : ''})`,
  ];
  if (primary) parts.push('主键');
  if (def.description) parts.push(def.description);
  if (def.enum && def.enum.length > 0)
    parts.push(`枚举: ${def.enum.join('|')}`);
  if (def.regex) parts.push(`格式: ${def.regex}`);
  if (def.range) {
    const rangeParts: string[] = [];
    if (def.range.min !== undefined) rangeParts.push(`>=${def.range.min}`);
    if (def.range.max !== undefined) rangeParts.push(`<=${def.range.max}`);
    if (rangeParts.length > 0) parts.push(`范围: ${rangeParts.join(' 且 ')}`);
  }
  return parts.join('；');
}

/** 构造记录抽取系统 prompt */
function buildRecordsPrompt(schemas: Map<string, RecordSchema>): string {
  const lines: string[] = [];
  for (const schema of schemas.values()) {
    const fields = Object.entries(schema.fields)
      .map(
        ([name, def]) =>
          `      - ${describeField(name, def, name === schema.primaryKey)}`
      )
      .join('\n');
    lines.push(
      `  - type: ${schema.type}（${schema.displayName}）\n` +
        `    description: ${schema.description}\n` +
        `    primaryKey: ${schema.primaryKey}\n` +
        `    fields:\n${fields}`
    );
  }

  return `你是知识库结构化记录抽取助手。从给定文档内容中抽取与以下记录类型匹配的业务对象记录。

可用的记录类型定义：
${lines.join('\n')}

规则：
1. 每条记录必须：type 属于上面列表；fields 值全部来自原文或合理推导（不许编造）；字段值必须满足字段声明的类型/枚举/格式/范围约束
2. primaryKey 字段必须填写且唯一（作为记录标识，如合同编号）
3. 每条记录附带 evidence：{ 字段名: "支撑该字段值的原文摘句" }，摘句必须逐字来自文档
4. 文档中没有匹配的记录时，返回 {"records": []}

请严格以 JSON 返回：
{
  "records": [
    {
      "type": "记录类型",
      "fields": { "字段名": 值 },
      "evidence": { "字段名": "原文摘句" }
    }
  ]
}`;
}

/** 将 LLM 输出的 JSON 文本解析为候选记录列表 */
function parseCandidates(rawOutput: string): RecordCandidate[] {
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as {
    records?: Array<{
      type?: unknown;
      fields?: unknown;
      evidence?: unknown;
    }>;
  };
  const records = parsed.records ?? [];
  return records
    .map((r) => ({
      type: typeof r.type === 'string' ? r.type : '',
      fields:
        r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields)
          ? (r.fields as Record<string, unknown>)
          : {},
      evidence:
        r.evidence &&
        typeof r.evidence === 'object' &&
        !Array.isArray(r.evidence)
          ? Object.fromEntries(
              Object.entries(r.evidence).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string'
              )
            )
          : {},
    }))
    .filter((r) => r.type.length > 0);
}

/** 主键值 → record_key（归一化：去空白→下划线，截断防超长） */
function toRecordKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

/**
 * 抽取单个文档页面的记录（校验 + 落库）
 * 当 store 为空时仅校验统计（供无持久化场景/测试）
 */
export async function extractRecordsFromPage(
  aiService: AIService,
  schemas: Map<string, RecordSchema>,
  content: string,
  sourceFile: string,
  store?: RecordStore
): Promise<PageRecordResult> {
  const result: PageRecordResult = { saved: 0, invalid: 0, reasons: [] };
  if (schemas.size === 0) return result;

  const modelName = modelRouter.resolve('quick');
  if (!modelName) {
    logger.warn('记录抽取跳过：未配置 quick 任务模型');
    return result;
  }

  const messages: AIMessage[] = [
    {
      role: AIMessageRole.SYSTEM,
      content: buildRecordsPrompt(schemas),
      timestamp: Date.now(),
    },
    {
      role: AIMessageRole.USER,
      content: content.slice(0, 16000),
      timestamp: Date.now(),
    },
  ];

  // 与 GraphExtractor 同模式：JSON 解析失败时翻倍 max_tokens 重试一次
  const loader = new SchemaLoader();
  let candidates: RecordCandidate[] = [];
  let maxTokens = 8192;
  let parsed = false;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    const response = await aiService.generate(messages, modelName, {
      max_tokens: maxTokens,
    });
    try {
      candidates = parseCandidates(response.content.trim());
      parsed = true;
    } catch (err) {
      if (attempt < 2) {
        maxTokens *= 2;
        logger.warn('记录抽取 JSON 解析失败，翻倍 max_tokens 重试', {
          attempt,
          maxTokens,
          error: (err as Error).message,
          sourceFile,
        });
        continue;
      }
      logger.warn('记录抽取失败：无法解析 JSON', {
        sourceFile,
        error: (err as Error).message,
      });
      return result;
    }
  }
  if (!parsed) return result;

  for (const candidate of candidates) {
    const schema = schemas.get(candidate.type);
    if (!schema) {
      result.invalid++;
      result.reasons.push(
        `${candidate.type}: 未在 records.yaml 中声明的记录类型`
      );
      continue;
    }
    const validation = loader.validateRecord(schema, candidate.fields);
    if (!validation.valid) {
      result.invalid++;
      result.reasons.push(`${candidate.type}: ${validation.errors.join('；')}`);
      continue;
    }
    const key = toRecordKey(candidate.fields[schema.primaryKey]);
    if (!key) {
      result.invalid++;
      result.reasons.push(
        `${candidate.type}: primaryKey(${schema.primaryKey}) 为空`
      );
      continue;
    }

    if (store) {
      await store.upsert({
        type: schema.type,
        key,
        data: candidate.fields,
        evidence: candidate.evidence,
        domain: 'knowledge',
        sourceFile,
      });
    }
    result.saved++;
  }

  logger.info('页面记录抽取完成', {
    sourceFile,
    candidates: candidates.length,
    saved: result.saved,
    invalid: result.invalid,
    reasons: result.reasons,
  });
  return result;
}

/**
 * 编译后批量抽取记录（runner 用）：遍历本次编译页面，读文件 → 抽取
 */
export async function extractRecordsFromCompiledPages(
  aiService: AIService,
  schemas: Map<string, RecordSchema>,
  pages: string[],
  store?: RecordStore
): Promise<BatchRecordResult> {
  const summary: BatchRecordResult = {
    pagesProcessed: 0,
    saved: 0,
    invalid: 0,
    reasons: [],
  };
  if (schemas.size === 0 || pages.length === 0) return summary;

  const limited = pages.slice(0, RECORD_EXTRACT_MAX_PAGES);
  if (limited.length < pages.length) {
    logger.warn('记录抽取页数超上限，截断', {
      total: pages.length,
      kept: limited.length,
    });
  }

  // 先清理旧行：同一页面重编译后字段/主键可能变化，先按 source 删除避免残留
  if (store) {
    for (const pageFile of limited) {
      try {
        await store.deleteBySource(pageFile);
      } catch (err) {
        logger.warn('清理旧记录失败，跳过', {
          file: pageFile,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const pageFile of limited) {
    try {
      const content = await readFile(pageFile, 'utf-8');
      const pageResult = await extractRecordsFromPage(
        aiService,
        schemas,
        content,
        pageFile,
        store
      );
      summary.pagesProcessed++;
      summary.saved += pageResult.saved;
      summary.invalid += pageResult.invalid;
      summary.reasons.push(...pageResult.reasons);
    } catch (err) {
      logger.warn('单页记录抽取失败，跳过该页', {
        file: pageFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('编译记录抽取完成', {
    pagesProcessed: summary.pagesProcessed,
    saved: summary.saved,
    invalid: summary.invalid,
  });
  return summary;
}
