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
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import {
  buildLearningCandidates,
  computeCategoryDecisions,
  computeLearningCandidateStats,
  LEARNING_CANDIDATE_APPROVED,
  LEARNING_CANDIDATE_PENDING,
  LEARNING_CANDIDATE_REJECTED,
  LEARNING_CANDIDATE_VERIFIED,
  LEARNING_POLICY_MIN_DECIDED,
  LEARNING_POLICY_REJECTION_SHARE,
  LearningCandidateStore,
  suggestCategoryCutoffs,
  type LearningCandidate,
  type LearningCandidateStats,
} from '@modules/tasks';

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
  };
}

const learnCommand = createLearnCommand({
  store: new LearningCandidateStore(),
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
