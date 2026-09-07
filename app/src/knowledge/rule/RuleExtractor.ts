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
 * RuleExtractor — LLM 驱动规则类知识抽取（K3）
 *
 * 编译完成后按 .schema/rules.yaml 声明的规则类型/强度白名单，从编译页面抽取规则行：
 *   - prompt 内联规则类别与允许强度；识别"必须/严禁/禁止/不得（mandatory）、
 *     应当/宜/建议（should）、可以/允许（may）"句式
 *   - 输出 {kind, statement, triggers, constraintStrength, appliesTo, conflictOf, evidence{statement:原句}}
 *   - 逐条校验（kind/strength 白名单 + statement/evidence 非空），非法告警跳过
 *   - 合法规则落 kg_rules 表；对本次抽取集合做 conflictOf 配对校验（K3.3 lint 用）
 *
 * 仅当 rules.yaml 存在（opt-in）时启用，避免对全量文档引入无谓 LLM 开销。
 */

import { readFile } from 'fs/promises';
import { modelRouter } from '@modules/ai';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import type { RuleSchema } from '../schema/SchemaLoader';
import type { RuleRecord, RuleKind, ConstraintStrength } from './types';
import { RuleStore } from './RuleStore';

const logger = new OTelAwareLogger({
  module: 'knowledge:rule:extract',
  level: LogLevel.INFO,
});

/** 规则抽取批处理页数上限（对齐图谱/记录抽取） */
const RULE_EXTRACT_MAX_PAGES = 50;

/** LLM 候选规则（未校验） */
export interface RuleCandidate {
  kind: string;
  statement: string;
  triggers?: unknown;
  constraintStrength: string;
  appliesTo?: unknown;
  conflictOf?: unknown;
  evidence?: Record<string, unknown>;
}

/** 单页抽取结果汇总 */
export interface PageRuleResult {
  saved: number;
  invalid: number;
  reasons: string[];
}

/** 整批抽取结果汇总 */
export interface BatchRuleResult {
  pagesProcessed: number;
  saved: number;
  invalid: number;
  reasons: string[];
  conflictWarnings: string[];
}

/** djb2 稳定短哈希（规则 id 用，避免引入加密依赖） */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/** 规则 id：{kind}:{statementHash8} */
export function buildRuleId(kind: RuleKind, statement: string): string {
  const hash = djb2Hex(statement.trim()).slice(0, 8);
  return `${kind}:${hash}`;
}

/** 构建规则抽取 prompt */
function buildRulesPrompt(schemas: Map<string, RuleSchema>): string {
  const lines: string[] = [];
  for (const schema of schemas.values()) {
    lines.push(
      `  - kind=${schema.kind}（${schema.displayName}）：${schema.description}` +
        (schema.strengths.length > 0
          ? `；允许强度: ${schema.strengths.join('|')}`
          : '')
    );
  }

  return `你是知识库规范抽取助手。从给定文档中抽取"规则类陈述"（对公司/业务具有约束力的要求、指导或允许项），
与普通事实/概念描述相区分——只有带规范性模态词（必须/严禁/禁止/不得/应当/应/宜/建议/可以/允许等）的句子才算规则。

可用规则类别（kind 必须属于此列表）：
${lines.join('\n')}

强度判定：
- mandatory：必须、严禁、禁止、不得、不允许 → 强制
- should：应当、应、宜、建议、原则上 → 推荐
- may：可以、允许、可 → 可选

规则：
1. statement 用一句话完整陈述规则内容（不改写原意）
2. triggers 列触发场景/动作；appliesTo 列适用范围（无则省略）
3. conflictOf 填与本规则语义冲突的其它规则 id（若同页存在；无则空数组）
4. 每条必须附 evidence.statement：逐字摘录支撑该规则的原文句子
5. 不要输出事实性描述、无模态词的建议性知识

请严格以 JSON 返回：
{
  "rules": [
    {
      "kind": "policy",
      "statement": "……",
      "triggers": ["场景A"],
      "constraintStrength": "mandatory",
      "appliesTo": ["对象B"],
      "conflictOf": [],
      "evidence": { "statement": "原文逐字摘句" }
    }
  ]
}`;
}

/** 解析 LLM 输出 JSON → 候选规则 */
function parseRuleCandidates(rawOutput: string): RuleCandidate[] {
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as {
    rules?: Array<Record<string, unknown>>;
  };
  const rules = parsed.rules ?? [];
  return rules.map((r) => r as unknown as RuleCandidate);
}

/** 字符串数组字段归一化 */
function toStrArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** 候选规则 → 校验后落库（已落库规则追加到 savedSink，供 conflictOf 配对校验） */
async function persistValidRules(
  candidates: RuleCandidate[],
  schemas: Map<string, RuleSchema>,
  sourceFile: string,
  store: RuleStore,
  result: PageRuleResult,
  savedSink: RuleRecord[]
): Promise<void> {
  for (const candidate of candidates) {
    const schema = schemas.get(candidate.kind);
    const reason = validateRuleCandidate(candidate, schema);
    if (reason) {
      result.invalid++;
      result.reasons.push(`${candidate.kind ?? '(未知kind)'}: ${reason}`);
      continue;
    }

    const kind = candidate.kind as RuleKind;
    const strength = candidate.constraintStrength as ConstraintStrength;
    const statement = candidate.statement.trim();
    const id = buildRuleId(kind, statement);
    const evidence = toStrMap(candidate.evidence);

    const rule: RuleRecord = {
      id,
      kind,
      statement,
      triggers: toStrArray(candidate.triggers),
      constraintStrength: strength,
      appliesTo: toStrArray(candidate.appliesTo),
      conflictOf: toStrArray(candidate.conflictOf),
      evidence,
      sourceFile,
      domain: 'knowledge',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.upsert({
      id: rule.id,
      kind: rule.kind,
      statement: rule.statement,
      triggers: rule.triggers,
      constraintStrength: rule.constraintStrength,
      appliesTo: rule.appliesTo,
      conflictOf: rule.conflictOf,
      evidence: rule.evidence,
      domain: rule.domain,
      sourceFile: rule.sourceFile,
    });
    result.saved++;
    savedSink.push(rule);
  }
}

/** 候选校验：通过返回 null，失败返回原因（导出便于单测） */
export function validateRuleCandidate(
  candidate: RuleCandidate,
  schema: RuleSchema | undefined
): string | null {
  if (!schema) return '未在 rules.yaml 中声明的 kind';
  const kind = candidate.kind as RuleKind;
  if (!kind) return '缺少 kind';

  const strength = candidate.constraintStrength;
  if (!CONSTRAINT_STRENGTH_VALUES.has(strength)) {
    return `非法强度 ${strength}（允许: ${schema.strengths.join('|') || 'mandatory|should|may'}）`;
  }
  if (
    schema.strengths.length > 0 &&
    !schema.strengths.includes(strength as ConstraintStrength)
  ) {
    return `强度 ${strength} 不在 ${schema.kind} 的允许列表（${schema.strengths.join('|')}）`;
  }

  const statement = candidate.statement?.trim();
  if (!statement) return 'statement 为空';

  const evidence = toStrMap(candidate.evidence);
  if (!evidence.statement) return '缺少 evidence.statement（原文摘句）';

  return null;
}

const CONSTRAINT_STRENGTH_VALUES: ReadonlySet<string> = new Set([
  'mandatory',
  'should',
  'may',
]);

/** evidence 对象 → 字符串映射 */
function toStrMap(
  raw: Record<string, unknown> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') result[k] = v;
  }
  return result;
}

/**
 * K3.3 conflictOf 配对校验（lint 语义，纯函数便于单测）
 * 返回 warning 列表：
 *   - 引用了本次集合中不存在的规则 id
 *   - conflictOf 不对称（A 声明与 B 冲突但 B 未声明与 A 冲突）
 */
export function detectRuleConflicts(
  rules: Array<Pick<RuleRecord, 'id' | 'statement' | 'conflictOf'>>
): string[] {
  const warnings: string[] = [];
  const idSet = new Set(rules.map((r) => r.id));
  const byId = new Map(rules.map((r) => [r.id, r]));

  for (const rule of rules) {
    for (const target of rule.conflictOf) {
      const targetRule = byId.get(target);
      if (!targetRule) {
        if (idSet.has(target)) continue; // 防御：正常应命中
        warnings.push(
          `${rule.id} 声明与 ${target} 冲突，但该规则不存在于本次集合`
        );
        continue;
      }
      if (!targetRule.conflictOf.includes(rule.id)) {
        warnings.push(
          `${rule.id} 与 ${target} 冲突声明不对称（对方未反向声明）`
        );
      }
    }
  }
  return warnings;
}

/**
 * 抽取单个编译页面中的规则（校验 + 落库）
 * @param savedSink 已落库规则输出（供批处理做 conflictOf 配对校验）
 */
export async function extractRulesFromPage(
  aiService: AIService,
  schemas: Map<string, RuleSchema>,
  content: string,
  sourceFile: string,
  store: RuleStore,
  savedSink: RuleRecord[]
): Promise<PageRuleResult> {
  const result: PageRuleResult = { saved: 0, invalid: 0, reasons: [] };
  if (schemas.size === 0) return result;

  const modelName = modelRouter.resolve('quick');
  if (!modelName) {
    logger.warn('规则抽取跳过：未配置 quick 任务模型');
    return result;
  }

  const messages: AIMessage[] = [
    {
      role: AIMessageRole.SYSTEM,
      content: buildRulesPrompt(schemas),
      timestamp: Date.now(),
    },
    {
      role: AIMessageRole.USER,
      content: content.slice(0, 16000),
      timestamp: Date.now(),
    },
  ];

  let candidates: RuleCandidate[] = [];
  let parsed = false;
  let maxTokens = 8192;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    const response = await aiService.generate(messages, modelName, {
      max_tokens: maxTokens,
    });
    try {
      candidates = parseRuleCandidates(response.content.trim());
      parsed = true;
    } catch (err) {
      if (attempt < 2) {
        maxTokens *= 2;
        logger.warn('规则抽取 JSON 解析失败，翻倍 max_tokens 重试', {
          attempt,
          maxTokens,
          error: (err as Error).message,
          sourceFile,
        });
        continue;
      }
      logger.warn('规则抽取失败：无法解析 JSON', {
        sourceFile,
        error: (err as Error).message,
      });
      return result;
    }
  }
  if (!parsed) return result;

  await persistValidRules(
    candidates,
    schemas,
    sourceFile,
    store,
    result,
    savedSink
  );

  logger.info('页面规则抽取完成', {
    sourceFile,
    candidates: candidates.length,
    saved: result.saved,
    invalid: result.invalid,
  });
  return result;
}

/**
 * 编译后批量抽取规则：清理旧行 → 逐页抽取 → 对本批集合做 conflictOf 配对校验
 */
export async function extractRulesFromCompiledPages(
  aiService: AIService,
  schemas: Map<string, RuleSchema>,
  pages: string[],
  store: RuleStore
): Promise<BatchRuleResult> {
  const summary: BatchRuleResult = {
    pagesProcessed: 0,
    saved: 0,
    invalid: 0,
    reasons: [],
    conflictWarnings: [],
  };
  if (schemas.size === 0 || pages.length === 0) return summary;

  const limited = pages.slice(0, RULE_EXTRACT_MAX_PAGES);
  if (limited.length < pages.length) {
    logger.warn('规则抽取页数超上限，截断', {
      total: pages.length,
      kept: limited.length,
    });
  }

  const savedRules: RuleRecord[] = [];

  for (const pageFile of limited) {
    try {
      // 先清旧行（重编译字段/强度可能变化）
      await store.deleteBySource(pageFile);
      const content = await readFile(pageFile, 'utf-8');
      const pageResult = await extractRulesFromPage(
        aiService,
        schemas,
        content,
        pageFile,
        store,
        savedRules
      );
      summary.pagesProcessed++;
      summary.saved += pageResult.saved;
      summary.invalid += pageResult.invalid;
      summary.reasons.push(...pageResult.reasons);
    } catch (err) {
      logger.warn('单页规则抽取失败，跳过该页', {
        file: pageFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // conflictOf 配对校验（lint）：仅对本批抽取集合（含来源信息）执行
  const conflictWarnings = detectRuleConflicts(
    savedRules.map((r) => ({
      id: r.id,
      statement: r.statement,
      conflictOf: r.conflictOf,
    }))
  );
  summary.conflictWarnings = conflictWarnings;
  for (const w of conflictWarnings) {
    logger.warn('规则冲突校验: ' + w);
  }

  logger.info('编译规则抽取完成', {
    pagesProcessed: summary.pagesProcessed,
    saved: summary.saved,
    invalid: summary.invalid,
    conflicts: conflictWarnings.length,
  });
  return summary;
}
