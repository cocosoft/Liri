// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `prompt_snippet` 台账与渲染（红线 S1，2026-11-15）
 *
 * 规格：`.trae/specs/prompt-snippet-injection-redline.md`。
 *
 * **S1 范围**：台账 + 纯函数（校验 / 渲染 / 预算 / 过期）。**不接线** —— 装配层零改动，
 * 因此本文件合入后行为与今天逐字一致（默认关闭的纪律见 spec §3-G5）。
 *
 * 红线要点（全部在这里兑现，S2 的命令层只是调用）：
 * - 内容命中「覆盖既有约束 / 安全旁路 / 协议文本 / 模板占位 / 包裹标记」⇒ **拒绝生效**（不是清洗）；
 * - 超限（单条 / 总量 / 条数）⇒ **整条不注入**，绝不截断；
 * - 渲染确定性：按 id 升序拼接，同一输入恒得同一输出。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { MS_PER_DAY } from '@openliri/infra/constants';
import { resolveDataSubDir } from '@openliri/infra/environment';

const logger = getLogger('tasks:evolution:promptSnippet');

/** 草稿（尚未批准；不注入） */
export const PROMPT_SNIPPET_DRAFT = 'ps_draft';
/** 生效（已批准且在有效期内；总开关打开才注入） */
export const PROMPT_SNIPPET_ACTIVE = 'ps_active';
/** 已撤销 / 已过期（终态；不注入） */
export const PROMPT_SNIPPET_REVOKED = 'ps_revoked';

export type PromptSnippetStatus =
  | typeof PROMPT_SNIPPET_DRAFT
  | typeof PROMPT_SNIPPET_ACTIVE
  | typeof PROMPT_SNIPPET_REVOKED;

/** 单条正文上限（字符；超限整条不注入） */
export const PROMPT_SNIPPET_MAX_CHARS = 800;

/** 一次注入的正文总量上限（字符；含包裹标记） */
export const PROMPT_SNIPPET_TOTAL_MAX_CHARS = 2000;

/** 同时生效条数上限 */
export const PROMPT_SNIPPET_MAX_ACTIVE = 3;

/** 默认有效期（天；spec §7-4 裁定） */
export const PROMPT_SNIPPET_TTL_DAYS = 14;

/** 审批人缺省值（命令层可覆盖；不允许空） */
export const PROMPT_SNIPPET_DEFAULT_APPROVER = 'cli';

/** 到期收口的备注（客观结果，与人工撤销区分） */
export const PROMPT_SNIPPET_EXPIRED_NOTE = '已过期（批准后未复核）';

/** 观察期默认窗（天；与 SOP 观察期同口径） */
export const PROMPT_SNIPPET_OBSERVATION_DAYS = 7;

/** 观察期最小样本（轮次数；不足不下结论） */
export const PROMPT_SNIPPET_MIN_OBSERVED_TURNS = 20;

/** 观察期单次扫描的会话数上限 */
export const PROMPT_SNIPPET_OBSERVATION_SESSIONS = 20;

const SNIPPET_FILE_PREFIX = 'prompt-snippet_';

/** 片段内容（不含状态与生命周期） */
export interface PromptSnippetContent {
  /** 作用域：项目 id（spec §7-2 裁定：仅项目级） */
  workspaceId: string;
  /** 片段正文（不含包裹标记） */
  text: string;
  /** 来源候选 id（≥1，保证可归因） */
  sourceCandidateIds: string[];
  /** 归因证据（人读） */
  evidence: string[];
  /** 人读标题 */
  title: string;
}

/** 一条已落盘片段 */
export interface PromptSnippet extends PromptSnippetContent {
  id: string;
  status: PromptSnippetStatus;
  version: number;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
  expiresAt?: number;
  revokedAt?: number;
  note?: string;
}

/** 保存结果：新建 / 已存在 / 内容不合红线 */
export type PromptSnippetSaveResult = 'created' | 'existing' | 'invalid';

/** 校验违规项（`id` 稳定，便于测试与命令展示） */
export interface PromptSnippetViolation {
  id: string;
  message: string;
}

/** 校验结果 */
export interface PromptSnippetValidation {
  ok: boolean;
  violations: PromptSnippetViolation[];
}

interface ForbiddenRule {
  id: string;
  pattern: RegExp;
  message: string;
}

/** 内容红线（拒绝生效；不做清洗） */
const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    id: 'override-cn',
    pattern: /忽略(上述|以上|之前|前面|所有)[^。\n]{0,12}(规则|约束|指令|设定)/,
    message: '含「忽略既有规则/约束」类措辞',
  },
  {
    id: 'override-en',
    pattern:
      /\b(ignore|disregard)\s+(all\s+|any\s+)?(previous|above|prior|system)\s+(instructions?|rules?|prompts?)\b/i,
    message: '含 "ignore previous instructions" 类措辞',
  },
  {
    id: 'bypass-cn',
    pattern: /(跳过|绕过|关闭|禁用|取消)[^。\n]{0,8}(审批|确认|沙箱|权限|安全)/,
    message: '含「绕过/关闭审批或安全」类措辞',
  },
  {
    id: 'bypass-en',
    pattern:
      /\b(bypass|disable|skip)\s+(the\s+)?(approval|sandbox|permission|safety)\b/i,
    message: '含 "bypass approval/sandbox" 类措辞',
  },
  {
    id: 'protocol-think',
    pattern: /<think>/i,
    message: '含协议标签 <think>',
  },
  {
    id: 'protocol-file-op',
    pattern: /\[FILE_OPERATION\]/i,
    message: '含协议标签 [FILE_OPERATION]',
  },
  {
    id: 'protocol-file-action',
    pattern: /<(create|modify|delete)>/i,
    message: '含协议标签 <create|modify|delete>',
  },
  {
    id: 'template',
    pattern: /\{\{|\$\{|<%/,
    message: '含模板占位符（本面不接受变量，防二次注入）',
  },
  {
    id: 'marker',
    pattern: /PROMPT_SNIPPET:(BEGIN|END)/i,
    message: '含包裹标记（会破坏块解析）',
  },
];

/**
 * 内容校验（纯函数，拒绝而非清洗）。
 *
 * 空正文、超单条上限、命中任一红线 ⇒ `ok: false`。
 */
export function validatePromptSnippet(text: string): PromptSnippetValidation {
  const trimmed = text.trim();
  const violations: PromptSnippetViolation[] = [];
  if (trimmed.length === 0) {
    violations.push({ id: 'empty', message: '正文为空' });
  }
  if (trimmed.length > PROMPT_SNIPPET_MAX_CHARS) {
    violations.push({
      id: 'too-long',
      message: `正文 ${trimmed.length} 字符，超过上限 ${PROMPT_SNIPPET_MAX_CHARS}`,
    });
  }
  for (const rule of FORBIDDEN_RULES) {
    if (rule.pattern.test(trimmed)) {
      violations.push({ id: rule.id, message: rule.message });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** 片段 id：内容确定性哈希（同项目同正文同来源 ⇒ 同 id，保存幂等） */
export function computePromptSnippetId(content: PromptSnippetContent): string {
  return createHash('sha256')
    .update(
      `${content.workspaceId}#${content.sourceCandidateIds.join(',')}#${content.text}`
    )
    .digest('hex')
    .slice(0, 12);
}

/** 渲染为包裹块（机器可识别，便于审计与回滚） */
export function renderPromptSnippetBlock(
  snippet: Pick<PromptSnippet, 'id' | 'version' | 'text'>
): string {
  return [
    `<!-- PROMPT_SNIPPET:BEGIN id=${snippet.id} v=${snippet.version} -->`,
    snippet.text.trim(),
    '<!-- PROMPT_SNIPPET:END -->',
  ].join('\n');
}

/** 未注入的原因（确定性上报，不静默吞掉） */
export type PromptSnippetSkipReason =
  | 'not-active'
  | 'revoked'
  | 'expired'
  | 'redline'
  | 'over-count'
  | 'over-budget';

/** 渲染结果 */
export interface PromptSnippetRender {
  /** 可直接拼进动态段尾部的文本（空串 = 无片段） */
  text: string;
  /** 实际注入的片段 id（按 id 升序） */
  injected: string[];
  skipped: Array<{ id: string; reason: PromptSnippetSkipReason }>;
  /** 注入正文的字符数（含包裹标记） */
  chars: number;
}

/**
 * 渲染生效片段（纯函数）。
 *
 * 顺序固定为 id 升序；先按状态/过期/红线过滤，再按条数与总量截断（**跳过整条，不截断正文**）。
 */
export function renderPromptSnippetSection(
  items: readonly PromptSnippet[],
  now: number = Date.now()
): PromptSnippetRender {
  const skipped: PromptSnippetRender['skipped'] = [];
  const eligible: PromptSnippet[] = [];
  const sorted = [...items].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  for (const item of sorted) {
    if (item.status === PROMPT_SNIPPET_REVOKED) {
      skipped.push({ id: item.id, reason: 'revoked' });
      continue;
    }
    if (item.status !== PROMPT_SNIPPET_ACTIVE) {
      skipped.push({ id: item.id, reason: 'not-active' });
      continue;
    }
    if (item.expiresAt !== undefined && item.expiresAt <= now) {
      skipped.push({ id: item.id, reason: 'expired' });
      continue;
    }
    // 渲染期再校验一次（防手改台账绕过批准期校验）
    if (!validatePromptSnippet(item.text).ok) {
      skipped.push({ id: item.id, reason: 'redline' });
      continue;
    }
    eligible.push(item);
  }

  const withinCount = eligible.slice(0, PROMPT_SNIPPET_MAX_ACTIVE);
  for (const rest of eligible.slice(PROMPT_SNIPPET_MAX_ACTIVE)) {
    skipped.push({ id: rest.id, reason: 'over-count' });
  }

  const blocks: string[] = [];
  const injected: string[] = [];
  let chars = 0;
  for (const item of withinCount) {
    const block = renderPromptSnippetBlock(item);
    if (chars + block.length > PROMPT_SNIPPET_TOTAL_MAX_CHARS) {
      skipped.push({ id: item.id, reason: 'over-budget' });
      continue;
    }
    chars += block.length;
    injected.push(item.id);
    blocks.push(block);
  }

  return { text: blocks.join('\n\n'), injected, skipped, chars };
}

/** 已到期但仍为 active 的片段（纯函数；供惰性收口） */
export function findExpiredSnippets(
  items: readonly PromptSnippet[],
  now: number
): PromptSnippet[] {
  return items.filter(
    (item) =>
      item.status === PROMPT_SNIPPET_ACTIVE &&
      item.expiresAt !== undefined &&
      item.expiresAt <= now
  );
}

/** 观察期汇总（只统计观察窗内、片段生效之后的轮次） */
export interface SnippetObservation {
  turns: number;
  lowScoreTurns: number;
}

/** 观察期判定三态（与 SOP 观察期同口径） */
export type SnippetObservationVerdict =
  | 'supported'
  | 'insufficient'
  | 'flagged';

/** 观察期判定结果 */
export interface SnippetObservationJudgement {
  verdict: SnippetObservationVerdict;
  reasons: string[];
}

/** 汇总观察样本（纯函数）：分数低于阈值的轮次计为「伴随低分」 */
export function summarizeSnippetObservation(
  scores: readonly { score: number }[],
  scoreCutoff: number
): SnippetObservation {
  let lowScoreTurns = 0;
  for (const { score } of scores) {
    if (score < scoreCutoff) lowScoreTurns++;
  }
  return { turns: scores.length, lowScoreTurns };
}

/** 判定（纯函数）：有低分 ⇒ flagged（优先）；样本不足 ⇒ insufficient；否则 supported */
export function judgeSnippetObservation(
  observation: SnippetObservation,
  minTurns: number = PROMPT_SNIPPET_MIN_OBSERVED_TURNS
): SnippetObservationJudgement {
  if (observation.lowScoreTurns > 0) {
    return {
      verdict: 'flagged',
      reasons: [`${observation.lowScoreTurns}/${observation.turns} 轮伴随低分`],
    };
  }
  if (observation.turns < minTurns) {
    return {
      verdict: 'insufficient',
      reasons: [`观察窗内仅 ${observation.turns} 轮（需 ≥ ${minTurns} 轮）`],
    };
  }
  return {
    verdict: 'supported',
    reasons: [`观察窗内 ${observation.turns} 轮，未见低分`],
  };
}

/** 片段台账（JSON 文件，与候选 / SOP 草案同构：一文件一条 + 原子写） */
export class PromptSnippetStore {
  constructor(
    private readonly dir: string = resolveDataSubDir('prompt-snippets')
  ) {}

  /** 目录（供命令展示） */
  getDir(): string {
    return this.dir;
  }

  private filePath(id: string): string {
    return join(this.dir, `${SNIPPET_FILE_PREFIX}${id}.json`);
  }

  /** 列出全部片段：生效优先，其次按创建时间倒序 */
  list(): PromptSnippet[] {
    if (!existsSync(this.dir)) return [];
    let files: string[];
    try {
      files = readdirSync(this.dir).filter(
        (f) => f.startsWith(SNIPPET_FILE_PREFIX) && f.endsWith('.json')
      );
    } catch (err) {
      logger.warn('读取片段目录失败', { dir: this.dir, error: String(err) });
      return [];
    }
    const items: PromptSnippet[] = [];
    for (const file of files) {
      const item = this.readFile(join(this.dir, file));
      if (item) items.push(item);
    }
    items.sort((a, b) => {
      const pa = a.status === PROMPT_SNIPPET_ACTIVE ? 0 : 1;
      const pb = b.status === PROMPT_SNIPPET_ACTIVE ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
    return items;
  }

  /** 按 id / 前缀查找（命令侧判定歧义） */
  find(idOrPrefix: string): PromptSnippet[] {
    const key = idOrPrefix.trim();
    if (!key) return [];
    return this.list().filter((s) => s.id === key || s.id.startsWith(key));
  }

  /** 保存草稿（幂等；内容不合红线 ⇒ `invalid`） */
  save(
    content: PromptSnippetContent,
    now: number = Date.now()
  ): PromptSnippetSaveResult {
    if (!validatePromptSnippet(content.text).ok) return 'invalid';
    const id = computePromptSnippetId(content);
    const path = this.filePath(id);
    if (existsSync(path)) return 'existing';
    mkdirSync(this.dir, { recursive: true });
    this.writeFile(path, {
      ...content,
      id,
      status: PROMPT_SNIPPET_DRAFT,
      version: 1,
      createdAt: now,
    });
    return 'created';
  }

  /**
   * 批准（人工）：`ps_draft → ps_active`，写 `expiresAt = now + 14 天`。
   *
   * 前置（任一不满足 ⇒ `null`，不改写）：草稿态、正文过红线、来源非空、审批人非空。
   */
  approve(
    snippet: PromptSnippet,
    approvedBy: string,
    now: number = Date.now()
  ): PromptSnippet | null {
    if (snippet.status !== PROMPT_SNIPPET_DRAFT) return null;
    if (!validatePromptSnippet(snippet.text).ok) return null;
    if (snippet.sourceCandidateIds.length === 0) return null;
    if (!snippet.workspaceId.trim()) return null;
    const approver = approvedBy.trim();
    if (!approver) return null;
    const next: PromptSnippet = {
      ...snippet,
      status: PROMPT_SNIPPET_ACTIVE,
      approvedAt: now,
      approvedBy: approver,
      expiresAt: now + PROMPT_SNIPPET_TTL_DAYS * MS_PER_DAY,
    };
    this.writeFile(this.filePath(snippet.id), next);
    return next;
  }

  /** 撤销（人工）：`ps_active → ps_revoked`（终态，下一轮即不再注入） */
  revoke(
    snippet: PromptSnippet,
    note: string,
    now: number = Date.now()
  ): PromptSnippet {
    if (snippet.status !== PROMPT_SNIPPET_ACTIVE) return snippet;
    const reason = note.trim();
    const next: PromptSnippet = {
      ...snippet,
      status: PROMPT_SNIPPET_REVOKED,
      revokedAt: now,
      note: reason ? `已撤销（${reason}）` : '已撤销',
    };
    this.writeFile(this.filePath(snippet.id), next);
    return next;
  }

  /** 到期收口（惰性）：过期生效片段 ⇒ `ps_revoked` + 固定备注；返回本次条数 */
  expireOverdue(now: number = Date.now()): number {
    const expired = findExpiredSnippets(this.list(), now);
    for (const snippet of expired) {
      this.writeFile(this.filePath(snippet.id), {
        ...snippet,
        status: PROMPT_SNIPPET_REVOKED,
        revokedAt: now,
        note: PROMPT_SNIPPET_EXPIRED_NOTE,
      });
    }
    return expired.length;
  }

  private writeFile(path: string, item: PromptSnippet): void {
    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(item, null, 2), 'utf-8');
      renameSync(tmp, path);
    } catch (err) {
      void handleError(err, {
        module: 'tasks:evolution:promptSnippet',
        action: 'writeSnippet',
        context: { id: item.id },
      });
    }
  }

  private readFile(path: string): PromptSnippet | null {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as PromptSnippet;
      if (!parsed || typeof parsed.id !== 'string') return null;
      return parsed;
    } catch (err) {
      // @ignore-catch — 单文件损坏 ⇒ 跳过（不伪造片段）
      logger.warn('片段文件解析失败，已跳过', {
        file: path,
        error: String(err),
      });
      return null;
    }
  }
}
