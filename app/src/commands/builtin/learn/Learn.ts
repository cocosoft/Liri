// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/learn` —— 学习候选（M1 + M2，2026-11-15）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3 / §5。
 *
 * M1（只读 + 拒绝）：
 *   `/learn list`              待决候选 + 统计（已拒绝占比）
 *   `/learn show <id>`         查看候选证据
 *   `/learn scan [会话数]`     扫最近 N 个会话的低分轮 → 归因 → 落候选（默认 5）
 *   `/learn reject <id> [原因]` 拒绝候选
 *   `/learn stats`             仅看统计
 *
 * M2（结构化校验 → 批准 → 种子导出）：
 *   `/learn verify <id>`       结构化校验（不跑模型/evals）⇒ `lc_verified`
 *   `/learn approve <id>`      批准已校验候选 ⇒ `lc_approved`，追加语料种子行（`expectation: null`）
 *   `/learn revoke <id> <原因>` 撤销已批准候选（种子行写 `revokedAt`，不删行）
 *   `/learn export`            展示语料种子文件与条数
 *
 * **仍不改变模型行为**：不写提示词、不装技能；`evals --gate` 与语料合入由人工执行（spec §5-M3）。
 * M4（到期收口）：`list` / `stats` / `export` 在读路径**惰性**把过期批准转 `lc_rejected`（不起定时器）。
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { MS_PER_DAY } from '@openliri/infra/constants';
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import {
  buildLearningCandidates,
  computeCategoryDecisions,
  computeLearningCandidateStats,
  computePromptSnippetId,
  judgeSnippetObservation,
  LEARNING_CANDIDATE_APPROVED,
  LEARNING_CANDIDATE_PENDING,
  LEARNING_CANDIDATE_REJECTED,
  LEARNING_CANDIDATE_VERIFIED,
  LEARNING_POLICY_MIN_DECIDED,
  LEARNING_POLICY_REJECTION_SHARE,
  LearningCandidateStore,
  PROMPT_SNIPPET_ACTIVE,
  PROMPT_SNIPPET_DEFAULT_APPROVER,
  PROMPT_SNIPPET_OBSERVATION_DAYS,
  PROMPT_SNIPPET_OBSERVATION_SESSIONS,
  PromptSnippetStore,
  renderPromptSnippetSection,
  suggestCategoryCutoffs,
  summarizeSnippetObservation,
  validatePromptSnippet,
  type LearningCandidate,
  type LearningCandidateStats,
  type PromptSnippet,
} from '@modules/tasks';
// 片段作用域键（项目根归一）；创建与注入必须同源，避免两套键
import { promptSnippetWorkspaceId } from '@modules/context';

const LEARN_USAGE = [
  '用法：',
  '  /learn                    列出待决候选与统计',
  '  /learn scan [会话数]      扫最近 N 个会话的低分轮并归因（默认 5；只产候选，不改行为）',
  '  /learn show <id>          查看候选证据',
  '  /learn verify <id>        结构化校验候选（不跑模型/evals）→ 待批准',
  '  /learn approve <id>       批准已校验候选，导出语料种子（expectation 留空待人工补）',
  '  /learn revoke <id> <原因> 撤销已批准候选（种子行标记 revokedAt，不删行）',
  '  /learn export             展示语料种子文件与条数',
  '  /learn reject <id> [原因] 拒绝候选',
  '  /learn stats              仅看统计',
  '  /learn snippet [list]     片段台账（只读）',
  '  /learn snippet show <id>  查看片段详情（来源/证据/有效期）',
  '  /learn snippet draft <候选id> <正文> 以已批准候选为来源创建草稿（正文必须人工撰写）',
  '  /learn snippet approve <id> [审批人] 批准草稿（唯一生效动作；默认 14 天）',
  '  /learn snippet revoke <id> <原因>    撤销生效片段（下一轮即不再注入）',
  '  /learn snippet preview [项目] 预览渲染结果（只渲染，未接入装配）',
  '  /learn snippet observe <id> [天数] 观察期度量（默认 7 天 / 需 ≥ 20 轮）',
].join('\n');

/** 扫描时读取的事件类型（最小面；水位由 `turn/quality` 决定） */
const SCAN_EVENT_TYPES: LiriEventType[] = [
  'user/message',
  'turn/start',
  'assistant/tool_call',
  'tool/result',
  'turn/quality',
];

/** 单会话读取上限（覆盖数轮；与 U4 评估器的 1000 同量级） */
const SCAN_EVENTS_PER_SESSION = 1000;

/** 默认扫描会话数 */
const DEFAULT_SCAN_SESSIONS = 5;

/** 命令依赖（测试注入；生产用默认实现） */
export interface LearnCommandDeps {
  store: LearningCandidateStore;
  /** prompt_snippet 台账（S2：只读） */
  snippetStore: PromptSnippetStore;
  /** 列出最近更新的会话 id（磁盘层） */
  listSessionIds: (limit: number) => Promise<string[]>;
  /** 读某会话的事件（只读） */
  readEvents: (sessionId: string, limit: number) => Promise<LiriEvent[]>;
  /** 低分阈值（单源：生产取 `@modules/evals` 的 `SUSPICIOUS_SCORE_THRESHOLD`） */
  readScoreCutoff: () => Promise<number>;
}

/**
 * 结果构造：**不写 `type` 字段**。
 *
 * `CommandResult.type` 是可选字符串；而 `'error'` / `'text'` 属状态词汇表的既有取值，
 * 在本文件写裸字面量会被 `lint:state-ratchet` 判为"未报备的状态字面量"（同族命令文件
 * 是历史基线收编的）。省略该可选字段即可避免把 CLI 结果类型混进状态机词汇。
 */
function ok(message: string, data?: unknown): CommandResult {
  return { success: true, message, data };
}

function fail(error: string): CommandResult {
  return { success: false, error };
}

function formatShare(share: number | null): string {
  return share === null ? '暂无候选' : `${(share * 100).toFixed(1)}%`;
}

function statsLine(stats: LearningCandidateStats): string {
  return [
    `待决 ${stats.pending}`,
    `待批准 ${stats.verified}`,
    `已批准 ${stats.approved}`,
    `已拒绝 ${stats.rejected}`,
    `（共 ${stats.total}）`,
    `已拒绝占比 ${formatShare(stats.rejectedShare)}`,
  ].join(' / ');
}

/**
 * 解析唯一候选（前缀匹配；歧义/未命中 ⇒ `candidate: null` + 文案）。
 *
 * 用 `candidate: null` 而不是 `'error' in found` 判别 —— 后者的 `'error'` 字面量属
 * 状态词汇表既有取值，会被 `lint:state-ratchet` 判为未报备（同族命令文件是历史基线）。
 */
function resolveCandidate(
  store: LearningCandidateStore,
  idOrPrefix: string
): { candidate: LearningCandidate | null; error?: string } {
  if (!idOrPrefix)
    return { candidate: null, error: `缺少候选 id\n${LEARN_USAGE}` };
  const matches = store.find(idOrPrefix);
  if (matches.length === 0) {
    return {
      candidate: null,
      error: `未找到候选：${idOrPrefix}（用 /learn list 查看）`,
    };
  }
  if (matches.length > 1) {
    const ids = matches.map((c) => c.id).join(', ');
    return {
      candidate: null,
      error: `候选 id 前缀「${idOrPrefix}」不唯一：${ids}`,
    };
  }
  return { candidate: matches[0] };
}

/** 解析唯一片段（前缀匹配；歧义/未命中 ⇒ `item: null` + 文案） */
function resolveSnippet(
  store: PromptSnippetStore,
  idOrPrefix: string
): { item: PromptSnippet | null; error?: string } {
  if (!idOrPrefix) return { item: null, error: `缺少片段 id\n${LEARN_USAGE}` };
  const matches = store.find(idOrPrefix);
  if (matches.length === 0) {
    return {
      item: null,
      error: `未找到片段：${idOrPrefix}（用 /learn snippet list 查看）`,
    };
  }
  if (matches.length > 1) {
    return {
      item: null,
      error: `片段 id 前缀「${idOrPrefix}」不唯一：${matches.map((m) => m.id).join(', ')}`,
    };
  }
  return { item: matches[0] };
}

export function createLearnCommand(deps: LearnCommandDeps) {
  return {
    async execute(
      args: string,
      _context: CommandContext
    ): Promise<CommandResult> {
      const [action = 'list', ...rest] = args.trim().split(/\s+/);
      const payload = rest.join(' ').trim();

      if (action === 'help' || action === '--help' || action === '-h') {
        return ok(LEARN_USAGE);
      }
      if (action === 'list' || action === '') return this.list();
      if (action === 'show') return this.show(payload);
      if (action === 'scan') return this.scan(payload);
      if (action === 'reject' || action === 'rm') return this.reject(payload);
      if (action === 'verify') return this.verify(payload);
      if (action === 'approve') return this.approve(payload);
      if (action === 'revoke') return this.revoke(payload);
      if (action === 'export') return this.export();
      if (action === 'snippet') return this.snippet(payload);
      if (action === 'stats') return this.stats();
      return fail(`未知子命令：${action}\n${LEARN_USAGE}`);
    },

    list(): CommandResult {
      const expired = deps.store.expireOverdue();
      const items = deps.store.list();
      const stats = computeLearningCandidateStats(items);
      const actionable = items.filter(
        (c) =>
          c.status === LEARNING_CANDIDATE_PENDING ||
          c.status === LEARNING_CANDIDATE_VERIFIED
      );
      const rows = actionable.map(
        (c) =>
          `  [${c.status}] ${c.id}  ${c.summary}  ← ${c.sessionId}#${c.turnNumber}`
      );
      const body =
        rows.length > 0
          ? rows.join('\n')
          : '  （暂无待办候选；用 /learn scan 扫描最近会话的低分轮）';
      return ok(
        [
          `学习候选（${deps.store.getDir()}）：`,
          body,
          '',
          `统计：${statsLine(stats)}`,
          ...(expired > 0
            ? [`已自动过期 ${expired} 条批准（超过有效期未复核）`]
            : []),
          '候选本身不改行为：verify → approve 只导出语料种子（expectation 由人工补），revoke 可回滚。',
        ].join('\n'),
        stats
      );
    },

    stats(): CommandResult {
      const expired = deps.store.expireOverdue();
      const items = deps.store.list();
      const stats = computeLearningCandidateStats(items);
      const policies = computeCategoryDecisions(items);
      const categoryLines = policies.map(
        (p) =>
          `  ${p.category}：已决 ${p.decided}（拒绝 ${p.rejected}，占比 ${(p.rejectedShare * 100).toFixed(0)}%）`
      );
      const prefix = expired > 0 ? `已自动过期 ${expired} 条批准；` : '';
      return ok(
        [
          `${prefix}${statsLine(stats)}`,
          ...(categoryLines.length > 0
            ? ['按类别（仅已决）：', ...categoryLines]
            : []),
          `阈值回流门槛：样本 ≥ ${LEARNING_POLICY_MIN_DECIDED} 且拒绝占比 ≥ ${LEARNING_POLICY_REJECTION_SHARE}（在 /learn scan 时应用）`,
        ].join('\n'),
        stats
      );
    },

    show(payload: string): CommandResult {
      const found = resolveCandidate(deps.store, payload);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const c = found.candidate;
      return ok(
        [
          `候选 ${c.id}`,
          `  状态：${c.status}`,
          `  来源：${c.sessionId} 第 ${c.turnNumber} 轮`,
          `  类别：${c.category}（score ${c.score.toFixed(2)}）`,
          `  证据：${c.evidence.join('；')}`,
          `  用户输入：${c.input ? c.input : '（未取到）'}`,
          ...(c.gate
            ? [`  结构化校验：${c.gate.kind} @ ${c.gate.checkedAt}`]
            : []),
          ...(c.expiresAt
            ? [`  批准有效期至：${new Date(c.expiresAt).toISOString()}`]
            : []),
          ...(c.note ? [`  备注：${c.note}`] : []),
        ].join('\n'),
        { id: c.id, status: c.status, category: c.category }
      );
    },

    async scan(payload: string): Promise<CommandResult> {
      const parsed = payload ? Number(payload) : DEFAULT_SCAN_SESSIONS;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return fail(`会话数必须是正整数：${payload}`);
      }
      let sessionIds: string[];
      try {
        sessionIds = await deps.listSessionIds(parsed);
      } catch (e) {
        return fail(
          `读取会话列表失败：${e instanceof Error ? e.message : String(e)}`
        );
      }
      if (sessionIds.length === 0) {
        return ok('没有可扫描的会话（还没有已落盘的会话事件）');
      }

      const cutoff = await deps.readScoreCutoff();
      const policy = suggestCategoryCutoffs(deps.store.list(), {
        baseCutoff: cutoff,
      });
      let created = 0;
      let existing = 0;
      let scannedTurns = 0;
      for (const sessionId of sessionIds) {
        let events: LiriEvent[];
        try {
          events = await deps.readEvents(sessionId, SCAN_EVENTS_PER_SESSION);
        } catch {
          // @ignore-catch — 单会话读取失败 ⇒ 跳过（不中断整轮扫描）
          continue;
        }
        scannedTurns++;
        const candidates = buildLearningCandidates({
          sessionId,
          events,
          scoreCutoff: cutoff,
          categoryCutoffs: policy.cutoffs,
        });
        for (const c of candidates) {
          if (deps.store.save(c) === 'created') created++;
          else existing++;
        }
      }

      const stats = computeLearningCandidateStats(deps.store.list());
      const tightened = policy.policies.filter((p) => p.cutoff !== null);
      const policyLine =
        tightened.length > 0
          ? `已按拒绝占比收紧 ${tightened.length} 个类别：${tightened
              .map((p) => `${p.category} → ${p.cutoff}`)
              .join(
                '；'
              )}（样本 ≥ ${LEARNING_POLICY_MIN_DECIDED}、拒绝占比 ≥ ${LEARNING_POLICY_REJECTION_SHARE}）`
          : `阈值回流：暂无类别达到收紧条件（样本 ≥ ${LEARNING_POLICY_MIN_DECIDED} 且拒绝占比 ≥ ${LEARNING_POLICY_REJECTION_SHARE}）`;
      return ok(
        [
          `已扫描 ${scannedTurns} 个会话（低分阈值 ${cutoff}）：新增候选 ${created} 条，已存在 ${existing} 条。`,
          policyLine,
          `统计：${statsLine(stats)}`,
          '用 /learn list 查看；/learn reject <id> 拒绝。',
        ].join('\n'),
        { created, existing, scannedSessions: scannedTurns }
      );
    },

    reject(payload: string): CommandResult {
      const [idOrPrefix = '', ...noteParts] = payload.split(/\s+/);
      const found = resolveCandidate(deps.store, idOrPrefix);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const candidate = found.candidate;
      if (candidate.status === LEARNING_CANDIDATE_REJECTED) {
        return ok(`候选 ${candidate.id} 已被拒绝（未重复记录）`);
      }
      const updated = deps.store.reject(candidate, noteParts.join(' '));
      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(
        `已拒绝候选 ${updated.id}${updated.note ? `（原因：${updated.note}）` : ''}；${statsLine(stats)}`,
        stats
      );
    },

    verify(payload: string): CommandResult {
      const found = resolveCandidate(deps.store, payload);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const candidate = found.candidate;
      if (candidate.status === LEARNING_CANDIDATE_VERIFIED) {
        return ok(`候选 ${candidate.id} 已通过结构化校验（未重复记录）`);
      }
      if (candidate.status !== LEARNING_CANDIDATE_PENDING) {
        return fail(
          `候选 ${candidate.id} 当前状态 ${candidate.status}，不能再校验（只有待决候选可校验）`
        );
      }
      const updated = deps.store.markVerified(candidate);
      if (!updated) {
        return fail(
          `候选 ${candidate.id} 未通过结构化校验（id 不可复算 / 证据为空 / 分数越界），请用 /learn reject 拒绝`
        );
      }
      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(
        `已校验候选 ${updated.id}（结构化，未跑模型/evals）；${statsLine(stats)}`,
        stats
      );
    },

    approve(payload: string): CommandResult {
      const found = resolveCandidate(deps.store, payload);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const candidate = found.candidate;
      if (candidate.status === LEARNING_CANDIDATE_APPROVED) {
        return ok(`候选 ${candidate.id} 已批准（未重复导出种子）`);
      }
      if (candidate.status !== LEARNING_CANDIDATE_VERIFIED) {
        return fail(
          `候选 ${candidate.id} 当前状态 ${candidate.status}，需先 /learn verify ${candidate.id} 再批准`
        );
      }
      const updated = deps.store.approve(candidate);
      if (!updated) {
        return fail(
          `候选 ${candidate.id} 批准失败（语料种子写入失败），状态未变更`
        );
      }
      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(
        [
          `已批准候选 ${updated.id}，语料种子已追加：${deps.store.getApprovedCasesPath()}`,
          `  expectation 需人工补齐后合入 evals 语料；到期时间 ${new Date(
            updated.expiresAt ?? Date.now()
          ).toISOString()}`,
          statsLine(stats),
        ].join('\n'),
        stats
      );
    },

    revoke(payload: string): CommandResult {
      const [idOrPrefix = '', ...reasonParts] = payload.split(/\s+/);
      const reason = reasonParts.join(' ').trim();
      if (!reason) {
        return fail(
          `撤销必须写原因：/learn revoke <id> <原因>\n${LEARN_USAGE}`
        );
      }
      const found = resolveCandidate(deps.store, idOrPrefix);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const candidate = found.candidate;
      if (candidate.status !== LEARNING_CANDIDATE_APPROVED) {
        return fail(
          `候选 ${candidate.id} 当前状态 ${candidate.status}，只有已批准候选可撤销`
        );
      }
      const updated = deps.store.revoke(candidate, reason);
      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(
        `已撤销候选 ${updated.id}（种子行已标记 revokedAt，不删行）；${statsLine(stats)}`,
        stats
      );
    },

    export(): CommandResult {
      const expired = deps.store.expireOverdue();
      const cases = deps.store.listApprovedCases();
      const active = cases.filter((c) => c.revokedAt === undefined);
      const ready = active.filter((c) => (c.expectation ?? '').trim());
      return ok(
        [
          `语料种子：${deps.store.getApprovedCasesPath()}`,
          `  条数 ${cases.length}（有效 ${active.length} / 已撤销 ${cases.length - active.length}）`,
          `  可成题 ${ready.length}（expectation 已填、未撤销、未过期）`,
          ...(expired > 0 ? [`已自动过期 ${expired} 条批准`] : []),
          '  物料化：补 expectation 后执行 bun app/scripts/gen-learning-eval-cases.ts -- --write（落盘前先脱敏），再跑 evals --gate。',
          '  回归审计：bun run report:learning-regressions（读最近一次跑批报告；有回归 ⇒ 非 0 退出）。',
        ].join('\n'),
        { total: cases.length, active: active.length, ready: ready.length }
      );
    },

    /** `/learn snippet <list|show|approve|revoke|preview|observe>`（S4：写操作 + 观察期度量） */
    async snippet(payload: string): Promise<CommandResult> {
      const [sub = 'list', ...rest] = payload.split(/\s+/);
      const arg = rest.join(' ').trim();
      if (sub === 'list' || sub === '') return this.snippetList();
      if (sub === 'draft') return this.snippetDraft(arg);
      if (sub === 'show') return this.snippetShow(arg);
      if (sub === 'approve') return this.snippetApprove(arg);
      if (sub === 'revoke') return this.snippetRevoke(arg);
      if (sub === 'preview') return this.snippetPreview(arg);
      if (sub === 'observe') return await this.snippetObserve(arg);
      return fail(`未知 snippet 子命令：${sub}\n${LEARN_USAGE}`);
    },

    /** 到期收口（惰性；读路径统一调用） */
    expireSnippets(): number {
      return deps.snippetStore.expireOverdue();
    },

    snippetList(): CommandResult {
      const expired = this.expireSnippets();
      const items = deps.snippetStore.list();
      const active = items.filter(
        (item) => item.status === PROMPT_SNIPPET_ACTIVE
      ).length;
      const rows = items.map(
        (item) =>
          `  [${item.status}] ${item.id}  ${item.title}  ← ${item.workspaceId}`
      );
      return ok(
        [
          `prompt_snippet 台账（${deps.snippetStore.getDir()}）：`,
          rows.length > 0
            ? rows.join('\n')
            : '  （暂无片段；创建草稿尚未提供命令——片段正文必须人工撰写，见 spec §5-M9）',
          '',
          `统计：生效 ${active} / 共 ${items.length}`,
          ...(expired > 0 ? [`已自动过期 ${expired} 条片段（未复核）`] : []),
        ].join('\n'),
        { total: items.length, active }
      );
    },

    snippetShow(payload: string): CommandResult {
      this.expireSnippets();
      if (!payload) return fail(`缺少片段 id\n${LEARN_USAGE}`);
      const matches = deps.snippetStore.find(payload);
      if (matches.length === 0) {
        return fail(`未找到片段：${payload}（用 /learn snippet list 查看）`);
      }
      if (matches.length > 1) {
        return fail(
          `片段 id 前缀「${payload}」不唯一：${matches.map((m) => m.id).join(', ')}`
        );
      }
      const item = matches[0];
      return ok(
        [
          `片段 ${item.id}（v${item.version}）`,
          `  状态：${item.status}`,
          `  项目：${item.workspaceId}`,
          `  标题：${item.title}`,
          `  来源候选：${item.sourceCandidateIds.join(', ')}`,
          `  证据：${item.evidence.join('；')}`,
          `  创建：${new Date(item.createdAt).toISOString()}`,
          ...(item.approvedBy ? [`  批准人：${item.approvedBy}`] : []),
          ...(item.expiresAt
            ? [`  有效期至：${new Date(item.expiresAt).toISOString()}`]
            : []),
          ...(item.note ? [`  备注：${item.note}`] : []),
          '',
          '正文：',
          item.text,
        ].join('\n'),
        { id: item.id, status: item.status }
      );
    },

    snippetPreview(payload: string): CommandResult {
      this.expireSnippets();
      const workspaceId = payload.trim();
      const items = workspaceId
        ? deps.snippetStore
            .list()
            .filter((item) => item.workspaceId === workspaceId)
        : deps.snippetStore.list();
      const rendered = renderPromptSnippetSection(items);
      const skipLine =
        rendered.skipped.length > 0
          ? `；跳过 ${rendered.skipped.length} 条：${rendered.skipped
              .map((s) => `${s.id}:${s.reason}`)
              .join('、')}`
          : '';
      return ok(
        [
          `预览（渲染结果）：${workspaceId ? `项目 ${workspaceId}` : '全部项目'}`,
          rendered.injected.length > 0 ? '' : '  无生效片段（渲染结果为空串）',
          ...(rendered.injected.length > 0 ? [rendered.text, ''] : []),
          `注入 ${rendered.injected.length} 条 / ${rendered.chars} 字符${skipLine}`,
          'S2 只预览：真正是否注入取决于总开关 LIRI_PROMPT_SNIPPET（默认关闭）。',
        ].join('\n'),
        {
          injected: rendered.injected,
          chars: rendered.chars,
          skipped: rendered.skipped.length,
        }
      );
    },

    /**
     * 创建草稿（S5）：以**已批准候选**为来源，正文必须由命令一次性给出（人工撰写）。
     *
     * 为什么不做自动生成：由候选摘要拼正文等于编造判据（CS04）；`text` 必填且走同一套红线校验。
     */
    snippetDraft(payload: string): CommandResult {
      const [candidateId = '', ...textParts] = payload.split(/\s+/);
      const text = textParts.join(' ').trim();
      if (!candidateId || !text) {
        return fail(
          `用法：/learn snippet draft <候选id> <正文>\n${LEARN_USAGE}`
        );
      }
      const found = resolveCandidate(deps.store, candidateId);
      if (!found.candidate) return fail(found.error ?? '候选不可用');
      const candidate = found.candidate;
      if (candidate.status !== LEARNING_CANDIDATE_APPROVED) {
        return fail(
          `候选 ${candidate.id} 未批准（当前 ${candidate.status}）：片段来源必须是已批准候选`
        );
      }
      const content = {
        workspaceId: promptSnippetWorkspaceId(),
        text,
        sourceCandidateIds: [candidate.id],
        evidence: [...candidate.evidence],
        title: candidate.summary,
      };
      const saved = deps.snippetStore.save(content);
      if (saved === 'invalid') {
        const violations = validatePromptSnippet(text).violations.map(
          (v) => v.message
        );
        return fail(`片段正文未通过红线：${violations.join('；')}`);
      }
      const id = computePromptSnippetId(content);
      return ok(
        [
          saved === 'created'
            ? `已创建草稿 ${id}`
            : `草稿已存在：${id}（未重复创建）`,
          `  来源候选：${candidate.id}`,
          `  项目：${content.workspaceId}`,
          '下一步：/learn snippet preview 查看渲染；确认无误后 /learn snippet approve <id>。',
        ].join('\n'),
        { id, created: saved === 'created' }
      );
    },

    snippetApprove(payload: string): CommandResult {
      const [idOrPrefix = '', ...approverParts] = payload.split(/\s+/);
      const found = resolveSnippet(deps.snippetStore, idOrPrefix);
      if (!found.item) return fail(found.error ?? '片段不可用');
      const item = found.item;
      if (item.status === PROMPT_SNIPPET_ACTIVE) {
        return ok(`片段 ${item.id} 已生效（未重复批准）`);
      }
      const approver =
        approverParts.join(' ').trim() || PROMPT_SNIPPET_DEFAULT_APPROVER;
      const updated = deps.snippetStore.approve(item, approver);
      if (!updated) {
        return fail(
          `片段 ${item.id} 批准失败（需草稿态、正文过红线、来源非空、审批人非空；当前 ${item.status}）`
        );
      }
      return ok(
        [
          `已批准片段 ${updated.id}（审批人 ${updated.approvedBy}）`,
          `  有效期至：${new Date(updated.expiresAt ?? Date.now()).toISOString()}`,
          '注入还需总开关 LIRI_PROMPT_SNIPPET=1；可先用 /learn snippet preview 查看渲染结果。',
        ].join('\n'),
        { id: updated.id, expiresAt: updated.expiresAt }
      );
    },

    snippetRevoke(payload: string): CommandResult {
      const [idOrPrefix = '', ...reasonParts] = payload.split(/\s+/);
      const reason = reasonParts.join(' ').trim();
      if (!reason) {
        return fail(
          `撤销必须写原因：/learn snippet revoke <id> <原因>\n${LEARN_USAGE}`
        );
      }
      const found = resolveSnippet(deps.snippetStore, idOrPrefix);
      if (!found.item) return fail(found.error ?? '片段不可用');
      if (found.item.status !== PROMPT_SNIPPET_ACTIVE) {
        return fail(
          `片段 ${found.item.id} 未生效（当前 ${found.item.status}），无需撤销`
        );
      }
      const updated = deps.snippetStore.revoke(found.item, reason);
      return ok(
        `已撤销片段 ${updated.id}（${updated.note ?? '已撤销'}）；下一轮起不再注入`,
        { id: updated.id, status: updated.status }
      );
    },

    /**
     * 观察期度量（**只读**）：片段生效后观察窗内的轮次与低分轮。
     *
     * 口径：`since = max(approvedAt, now - days)`；只取 `turn/quality` 的 `score`（结构化字段）。
     * 判定：有低分 ⇒ `flagged`；轮次 < 20 ⇒ `insufficient`；否则 `supported`。
     */
    async snippetObserve(payload: string): Promise<CommandResult> {
      const [idOrPrefix = '', daysRaw = ''] = payload.split(/\s+/);
      const found = resolveSnippet(deps.snippetStore, idOrPrefix);
      if (!found.item) return fail(found.error ?? '片段不可用');
      const item = found.item;
      if (item.status !== PROMPT_SNIPPET_ACTIVE) {
        return fail(
          `片段 ${item.id} 未生效（当前 ${item.status}）：观察期只针对生效片段`
        );
      }
      const days = daysRaw ? Number(daysRaw) : PROMPT_SNIPPET_OBSERVATION_DAYS;
      if (!Number.isInteger(days) || days <= 0) {
        return fail(`观察天数必须是正整数：${daysRaw}`);
      }

      const now = Date.now();
      const since = Math.max(
        item.approvedAt ?? item.createdAt,
        now - days * MS_PER_DAY
      );

      let sessionIds: string[];
      try {
        sessionIds = await deps.listSessionIds(
          PROMPT_SNIPPET_OBSERVATION_SESSIONS
        );
      } catch (e) {
        return fail(
          `读取会话列表失败：${e instanceof Error ? e.message : String(e)}`
        );
      }

      const cutoff = await deps.readScoreCutoff();
      const scores: Array<{ score: number }> = [];
      for (const sessionId of sessionIds) {
        let events: LiriEvent[];
        try {
          events = await deps.readEvents(sessionId, SCAN_EVENTS_PER_SESSION);
        } catch {
          // @ignore-catch — 单会话读取失败 ⇒ 跳过（不中断观测）
          continue;
        }
        for (const event of events) {
          if (event.type !== 'turn/quality' || event.time < since) continue;
          const data = event.data as LiriEventMap['turn/quality'];
          if (typeof data.score === 'number')
            scores.push({ score: data.score });
        }
      }

      const observation = summarizeSnippetObservation(scores, cutoff);
      const judgement = judgeSnippetObservation(observation);
      return ok(
        [
          `片段观察期度量：${item.id}`,
          `  观察窗：最近 ${days} 天（自 ${new Date(since).toISOString()} 起）｜扫描会话 ${sessionIds.length} 个｜低分阈值 ${cutoff}`,
          `  观察轮次：${observation.turns}｜伴随低分：${observation.lowScoreTurns}`,
          `  判定：${judgement.verdict} —— ${judgement.reasons.join('；')}`,
        ].join('\n'),
        {
          id: item.id,
          turns: observation.turns,
          lowScoreTurns: observation.lowScoreTurns,
          verdict: judgement.verdict,
        }
      );
    },
  };
}

const learnCommand = createLearnCommand({
  store: new LearningCandidateStore(),
  snippetStore: new PromptSnippetStore(),
  listSessionIds: async (limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI().getChatManager().listRecentSessionIds(limit);
  },
  readEvents: async (sessionId, limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI().getChatManager().readSessionEvents(sessionId, {
      types: SCAN_EVENT_TYPES,
      limit,
    });
  },
  readScoreCutoff: async () => {
    const { SUSPICIOUS_SCORE_THRESHOLD } = await import('@modules/evals');
    return SUSPICIOUS_SCORE_THRESHOLD;
  },
});

export default learnCommand;
