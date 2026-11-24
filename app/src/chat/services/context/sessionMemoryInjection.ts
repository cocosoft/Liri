// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话记忆注入预算（P0-1，2026-11-25）
 *
 * 此前 `memory.md` 是**全文无预算**注入系统提示（随轮次线性增长）。本模块只做一件事：
 * 给注入加预算 —— 未超预算时原文注入；超预算时**降级为索引 + 召回提示**（不截断正文）。
 *
 * 依据：`.trae/specs/agent-memory-optimization.md` §4 P0-1（对齐 Anthropic A8「注入层必须小」）。
 * 配置键：`memory.injection.maxTokens`（默认 1500）；预算只影响"注入多少"，不改变记忆文件本身。
 */

import { configManager } from '@openliri/infra/config';
import { estimateTokens } from '@modules/ai/tokenizer/TokenEstimator.js';

/** 会话记忆注入上限（tokens）默认值 */
export const DEFAULT_SESSION_MEMORY_MAX_TOKENS = 1500;

/** 配置键：会话记忆注入预算（tokens） */
export const SESSION_MEMORY_MAX_TOKENS_KEY = 'memory.injection.maxTokens';

/** 配置键：项目级「记忆用途」（P2-2，2026-11-25；如 coding / research / customer-support） */
export const MEMORY_PURPOSE_KEY = 'memory.purpose';

/**
 * 解析「记忆用途」（会话级覆盖项目级）：
 * `session.metadata.memoryPurpose` > `config.json#memory.purpose` > 空（不注入）。
 */
export function resolveMemoryPurpose(
  sessionMetadata?: Record<string, unknown>
): string {
  const fromSession = sessionMetadata?.memoryPurpose;
  if (typeof fromSession === 'string' && fromSession.trim()) {
    return fromSession.trim();
  }
  const configured = configManager.getValue<string>(MEMORY_PURPOSE_KEY, '');
  return typeof configured === 'string' ? configured.trim() : '';
}

/**
 * 构建「记忆用途」段（P2-2）：只告诉模型"记忆用来干什么"，**不预设硬规则**
 * （如"只记失败"会伤害强模型表现，见方案 A5）。空用途 ⇒ 空串（零注入）。
 */
export function buildMemoryPurposeSection(purpose: string): string {
  const trimmed = purpose.trim();
  if (!trimmed) return '';
  return [
    '## 记忆用途',
    `- 本会话/项目的记忆主要用于：${trimmed}`,
    '- 只记录与该用途相关的长期事实、规则与陷阱；与用途无关的运行时细节不要写入记忆。',
  ].join('\n');
}

export interface SessionMemoryInjection {
  /** 注入正文（full = 原文；index = 超预算后的索引） */
  text: string;
  /** full = 原文注入；index = 超预算降级 */
  mode: 'full' | 'index';
  /** 记忆条目数（index 模式用于提示；full 模式不求值，为 0） */
  itemCount: number;
}

/**
 * 结构化来源（结构化而非具体类 ⇒ 便于单测；`SessionMemoryManager` 天然满足）。
 */
export interface SessionMemorySource {
  getMemoryContext(sessionId: string): string;
  loadMemory(sessionId: string): {
    items: Array<{ type: string; content: string }>;
  };
}

/** 索引分组顺序与展示名（与 `buildMemoryContextText` 的分组一致） */
const TYPE_LABELS: Array<[string, string]> = [
  ['decision', '决策记录'],
  ['todo', '待办事项'],
  ['session_summary', '会话摘要'],
  ['discussion', '历史讨论'],
  ['code_reference', '代码引用'],
  ['file_change', '文件变更'],
];

/** 读取注入预算（配置键非法/缺失 ⇒ 默认值） */
export function resolveSessionMemoryMaxTokens(): number {
  const configured = configManager.getValue<number>(
    SESSION_MEMORY_MAX_TOKENS_KEY,
    DEFAULT_SESSION_MEMORY_MAX_TOKENS
  );
  return typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
    ? configured
    : DEFAULT_SESSION_MEMORY_MAX_TOKENS;
}

/**
 * 构建会话记忆注入内容：预算内原文，超预算降级为索引 + 召回提示。
 */
export function buildSessionMemoryInjection(
  source: SessionMemorySource,
  sessionId: string,
  maxTokens: number = resolveSessionMemoryMaxTokens()
): SessionMemoryInjection {
  const full = source.getMemoryContext(sessionId);
  if (!full) return { text: '', mode: 'full', itemCount: 0 };

  const tokens = estimateTokens(full);
  if (tokens <= maxTokens) return { text: full, mode: 'full', itemCount: 0 };

  const items = source.loadMemory(sessionId).items;
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  const countLines = TYPE_LABELS.filter(([type]) => counts.has(type)).map(
    ([type, label]) => `- ${label}：${counts.get(type)} 条`
  );

  const text = [
    `### 会话记忆索引（超出注入预算）`,
    `本会话已积累 ${items.length} 条记忆，全文约 ${tokens} tokens，超过注入预算 ${maxTokens} tokens，因此只注入索引：`,
    '',
    ...(countLines.length > 0
      ? countLines
      : ['- （结构化条目不可用，请用 recall_memory 检索）']),
    '',
    '需要具体条目时用 recall_memory 检索（未直接可见时先用 tool_search 查找 recall_memory）。',
    '索引来自记忆库（可能已过期）；与当前事实冲突时以当前为准。',
  ].join('\n');

  return { text, mode: 'index', itemCount: items.length };
}
