// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/patterns` —— 编排模式决策的只读统计（2026-11-15）
 *
 * 规格：`.trae/specs/self-verify-turn-surface.md` §3.3 +
 * `.trae/specs/default-off-switches-review-gates.md` §2 #11（判据①）/ §3-O5（观测点）。
 *
 * **只读**：读既有 `pattern/decision` 事件并按 `sessionId` 去重统计，不改行为、不落盘。
 * 用途：季度复评时**一条命令**回答「`verify` 意图命中多少会话 / 是否达到 20」。
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import type { LiriEvent } from '@modules/session/types/events';
import {
  PATTERN_DECISION_GATE_MIN_SESSIONS,
  summarizePatternDecisions,
} from '@modules/tasks';

/** 默认扫描会话数（与 `/learn scan` 同量级：够覆盖一个复评窗口） */
const DEFAULT_STATS_SESSIONS = 20;
/** 单会话读取上限（决策事件低频，一次拉满即可） */
const EVENTS_PER_SESSION = 1000;

const PATTERNS_USAGE = [
  '用法：',
  `  /patterns stats [会话数]   编排模式决策统计（只读；默认 ${DEFAULT_STATS_SESSIONS} 个会话）`,
  '',
  `判据①（SELF_VERIFY_PATTERN）：verify 意图命中 ≥${PATTERN_DECISION_GATE_MIN_SESSIONS} 会话。`,
].join('\n');

/** 命令依赖（测试注入；生产沿用 `/learn` 的 CoreAPI 只读端口） */
export interface PatternsCommandDeps {
  /** 列出最近更新的会话 id（磁盘层） */
  listSessionIds: (limit: number) => Promise<string[]>;
  /** 读某会话的事件（只读） */
  readEvents: (sessionId: string, limit: number) => Promise<LiriEvent[]>;
}

/** 结果构造：省略可选 `type` 字段（避免引入状态词汇表裸字面量，同 `/learn` 口径） */
function ok(message: string, data?: unknown): CommandResult {
  return { success: true, message, data };
}

function fail(error: string): CommandResult {
  return { success: false, error };
}

export function createPatternsCommand(deps: PatternsCommandDeps) {
  return {
    async execute(
      args: string,
      _context: CommandContext
    ): Promise<CommandResult> {
      const [action = 'stats', ...rest] = args.trim().split(/\s+/);
      const payload = rest.join(' ').trim();
      if (action === 'help' || action === '--help' || action === '-h') {
        return ok(PATTERNS_USAGE);
      }
      if (action === 'stats') return this.stats(payload);
      return fail(`未知子命令：${action}\n${PATTERNS_USAGE}`);
    },

    async stats(payload: string): Promise<CommandResult> {
      const requested = payload ? Number(payload) : DEFAULT_STATS_SESSIONS;
      const limit =
        Number.isFinite(requested) && requested > 0
          ? Math.floor(requested)
          : DEFAULT_STATS_SESSIONS;

      const sessionIds = await deps.listSessionIds(limit);
      const sessions = await Promise.all(
        sessionIds.map(async (sessionId) => ({
          sessionId,
          events: await deps.readEvents(sessionId, EVENTS_PER_SESSION),
        }))
      );
      const summary = summarizePatternDecisions(sessions);

      return ok(
        [
          '编排模式决策统计（只读；数据源 pattern/decision）：',
          `  扫描会话：${summary.sessionsScanned}（含决策事件 ${summary.sessionsWithDecision}）｜决策事件 ${summary.decisionEvents} 条`,
          `  验证线路命中会话：${summary.verifySessions} / ${PATTERN_DECISION_GATE_MIN_SESSIONS}` +
            `（self_verify ${summary.selfVerifySessions} · iterative_refine ${summary.refineSessions}）`,
          `  其中实际启用（applied）：${summary.appliedSessions}｜门控开启会话：${summary.gateEnabledSessions}`,
          `  研究分流命中会话：${summary.researchSessions}`,
          `  判据①：${summary.meetsGateThreshold ? '已达阈值' : `未达阈值（还差 ${PATTERN_DECISION_GATE_MIN_SESSIONS - summary.verifySessions}）`}`,
          '注：仅统计**点了回复/命中意图**的会话；未命中不等于能力缺失（默认关门控见登记表 §2 #11）。',
        ].join('\n'),
        summary
      );
    },
  };
}

const patternsCommand = createPatternsCommand({
  listSessionIds: async (limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI().getChatManager().listRecentSessionIds(limit);
  },
  readEvents: async (sessionId, limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI()
      .getChatManager()
      .readSessionEvents(sessionId, {
        types: ['pattern/decision'],
        limit,
      });
  },
});

export default patternsCommand;
