// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/learn` —— 学习候选（M1，2026-11-15）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3 / §5-M1。
 *
 * M1 **只有读与拒绝**，没有 `approve`：
 *   `/learn list`              待决候选 + 统计（已拒绝占比）
 *   `/learn show <id>`         查看候选证据
 *   `/learn scan [会话数]`     扫最近 N 个会话的低分轮 → 归因 → 落候选（默认 5）
 *   `/learn reject <id> [原因]` 拒绝候选（M1 唯一决定动作）
 *   `/learn stats`             仅看统计
 *
 * 不产生任何行为变更：不写语料、不改提示词、不装技能（那些是 M2，且需 `evals --gate` + 人工批准）。
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import {
  buildLearningCandidates,
  computeLearningCandidateStats,
  LEARNING_CANDIDATE_PENDING,
  LEARNING_CANDIDATE_REJECTED,
  LearningCandidateStore,
  type LearningCandidate,
  type LearningCandidateStats,
} from '@modules/tasks';

const LEARN_USAGE = [
  '用法：',
  '  /learn                    列出待决候选与统计',
  '  /learn scan [会话数]      扫最近 N 个会话的低分轮并归因（默认 5；只产候选，不改行为）',
  '  /learn show <id>          查看候选证据',
  '  /learn reject <id> [原因] 拒绝候选（M1 唯一决定动作）',
  '  /learn stats              仅看统计',
].join('\n');

/** 扫描时读取的事件类型（最小面；水位由 `turn/quality` 决定） */
const SCAN_EVENT_TYPES: LiriEventType[] = [
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
  return `待决 ${stats.pending} / 已拒绝 ${stats.rejected}（共 ${stats.total}）；已拒绝占比 ${formatShare(stats.rejectedShare)}`;
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
      if (action === 'stats') return this.stats();
      // M1 明确不提供 approve（见文件头）：落到未知子命令会更早暴露"以为能批准"的误解
      if (action === 'approve') {
        return fail(
          'M1 不提供 /learn approve（候选不产生行为变更）；批准链在 M2 随 evals --gate 一起落地'
        );
      }
      return fail(`未知子命令：${action}\n${LEARN_USAGE}`);
    },

    list(): CommandResult {
      const items = deps.store.list();
      const stats = computeLearningCandidateStats(items);
      const rows = items
        .filter((c) => c.status === LEARNING_CANDIDATE_PENDING)
        .map(
          (c) =>
            `  [${c.status}] ${c.id}  ${c.summary}  ← ${c.sessionId}#${c.turnNumber}`
        );
      const body =
        rows.length > 0
          ? rows.join('\n')
          : '  （暂无待决候选；用 /learn scan 扫描最近会话的低分轮）';
      return ok(
        [
          `学习候选（${deps.store.getDir()}）：`,
          body,
          '',
          `统计：${statsLine(stats)}`,
          'M1 只读：候选不写入语料、不改提示词；/learn reject <id> 可标记拒绝。',
        ].join('\n'),
        stats
      );
    },

    stats(): CommandResult {
      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(statsLine(stats), stats);
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
          ...(c.note ? [`  拒绝原因：${c.note}`] : []),
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
        });
        for (const c of candidates) {
          if (deps.store.save(c) === 'created') created++;
          else existing++;
        }
      }

      const stats = computeLearningCandidateStats(deps.store.list());
      return ok(
        [
          `已扫描 ${scannedTurns} 个会话（低分阈值 ${cutoff}）：新增候选 ${created} 条，已存在 ${existing} 条。`,
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
