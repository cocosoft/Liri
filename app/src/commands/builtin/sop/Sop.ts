// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/sop` —— 成功轨迹 → SOP 草案（D10，2026-11-14）
 *
 * 闭环（**全程人工**，不新增后台调度器）：
 *   `/sop distill`  读已完成的 PDCA 计划（成功轨迹）→ 确定性蒸馏 → 落**草案**（pending）
 *   `/sop list`     查看待决草案 + 统计（含**拒绝率**）
 *   `/sop show <id>`  查看草案正文
 *   `/sop approve <id>` 写入 `~/.pyapp/skills/<name>/SKILL.md`（**唯一注册动作**）
 *   `/sop reject <id> [原因]`  标记拒绝（拒绝率可观测）
 *   `/sop observe <id> [天数]` 观察期度量：批准后的技能被真实执行几次、是否伴随低分（M7，只读）
 *
 * 不自动注册（方案 §3-4）、不改写用户已有技能（同名目录存在 ⇒ 拒绝安装）。
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import { MS_PER_DAY } from '@openliri/infra/constants';
import {
  collectSopSkillObservations,
  computeSopDraftStats,
  distillSopDrafts,
  judgeSopObservation,
  readCompletedPlanTrajectories,
  sopSkillName,
  summarizeSopObservations,
  SopDraftStore,
  SOP_MAX_TRAJECTORIES,
  SOP_DRAFT_APPROVED,
  SOP_DRAFT_REJECTED,
  SOP_OBSERVATION_EVENTS,
  SOP_OBSERVATION_MIN_USES,
  SOP_OBSERVATION_SESSIONS,
  SOP_OBSERVATION_WINDOW_DAYS,
  type SopDraft,
  type SopDraftContent,
  type SopTurnObservation,
} from '@modules/tasks';

const SOP_USAGE = [
  '用法：',
  '  /sop                       列出草案与统计（含拒绝率）',
  '  /sop distill [n]           从最近 n 条成功轨迹蒸馏草案（默认 5，不注册）',
  '  /sop show <id>             查看草案正文',
  '  /sop approve <id>          批准并写入技能目录（唯一的注册动作）',
  '  /sop observe <id> [天数]   观察期度量（默认 7 天）：执行次数 / 是否伴随低分',
  '  /sop reject <id> [原因]    拒绝草案（拒绝率可观测）',
  '  /sop stats                 仅看统计',
].join('\n');

/** 观察期读取的事件类型（最小面） */
const SOP_OBSERVE_EVENT_TYPES: LiriEventType[] = [
  'turn/start',
  'assistant/tool_call',
  'turn/quality',
];

/** 命令依赖（测试注入；生产用默认实现） */
export interface SopCommandDeps {
  store: SopDraftStore;
  distill: (limit: number) => SopDraftContent[];
  /** 观察期度量：列出最近会话 id（只读） */
  listSessionIds: (limit: number) => Promise<string[]>;
  /** 观察期度量：读某会话事件（只读） */
  readEvents: (sessionId: string, limit: number) => Promise<LiriEvent[]>;
  /** 观察期度量：低分阈值（单源：`@modules/evals` 的 `SUSPICIOUS_SCORE_THRESHOLD`） */
  readScoreCutoff: () => Promise<number>;
}

function ok(message: string, data?: unknown): CommandResult {
  return { success: true, type: 'text', message, data };
}

function fail(error: string): CommandResult {
  return { success: false, type: 'error', error };
}

function formatRate(rate: number | null): string {
  return rate === null ? '暂无已决草案' : `${(rate * 100).toFixed(1)}%`;
}

/** 解析唯一草案（前缀匹配；歧义/未命中 ⇒ `draft: null` + 文案） */
function resolveDraft(
  store: SopDraftStore,
  idOrPrefix: string
): { draft: SopDraft | null; error?: string } {
  if (!idOrPrefix) return { draft: null, error: `缺少草案 id\n${SOP_USAGE}` };
  const matches = store.find(idOrPrefix);
  if (matches.length === 0) {
    return {
      draft: null,
      error: `未找到草案：${idOrPrefix}（用 /sop list 查看）`,
    };
  }
  if (matches.length > 1) {
    const ids = matches.map((d) => d.id).join(', ');
    return {
      draft: null,
      error: `草案 id 前缀「${idOrPrefix}」不唯一：${ids}`,
    };
  }
  return { draft: matches[0] };
}

export function createSopCommand(deps: SopCommandDeps) {
  return {
    async execute(
      args: string,
      _context: CommandContext
    ): Promise<CommandResult> {
      const [action = 'list', ...rest] = args.trim().split(/\s+/);
      const payload = rest.join(' ').trim();

      if (action === 'help' || action === '--help' || action === '-h') {
        return ok(SOP_USAGE);
      }
      if (action === 'list' || action === '') return this.list();
      if (action === 'distill') return this.distill(payload);
      if (action === 'show') return this.show(payload);
      if (action === 'approve') return this.approve(payload);
      if (action === 'observe') return this.observe(payload);
      if (action === 'reject' || action === 'rm') return this.reject(payload);
      if (action === 'stats') return this.stats();
      return fail(`未知子命令：${action}\n${SOP_USAGE}`);
    },

    list(): CommandResult {
      const drafts = deps.store.list();
      const stats = computeSopDraftStats(drafts);
      const rows = drafts
        .filter((d) => d.status !== SOP_DRAFT_APPROVED)
        .map(
          (d) =>
            `  [${d.status}] ${d.id}  ${d.title || '(无标题)'}  ← plan ${d.planId}`
        );
      const body =
        rows.length > 0
          ? rows.join('\n')
          : '  （暂无待决草案；用 /sop distill 从成功轨迹生成）';
      return ok(
        [
          `SOP 草案（${deps.store.getDir()}）：`,
          body,
          '',
          `统计：待决 ${stats.pending} / 已批准 ${stats.approved} / 已拒绝 ${stats.rejected}（共 ${stats.total}）；拒绝率 ${formatRate(stats.rejectedRate)}`,
        ].join('\n'),
        stats
      );
    },

    stats(): CommandResult {
      const stats = computeSopDraftStats(deps.store.list());
      return ok(
        `待决 ${stats.pending} / 已批准 ${stats.approved} / 已拒绝 ${stats.rejected}（共 ${stats.total}）；拒绝率 ${formatRate(stats.rejectedRate)}`,
        stats
      );
    },

    distill(payload: string): CommandResult {
      const parsed = payload ? Number(payload) : SOP_MAX_TRAJECTORIES;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return fail(`蒸馏条数必须是正整数：${payload}`);
      }
      const drafts = deps.distill(parsed);
      if (drafts.length === 0) {
        return ok(
          '未找到可蒸馏的成功轨迹（需要已完成的 PDCA 计划且每步均完成）'
        );
      }
      let created = 0;
      let existing = 0;
      for (const draft of drafts) {
        if (deps.store.save(draft) === 'created') created++;
        else existing++;
      }
      const ids = drafts.map((d) => `${d.id}  ${d.title}`).join('\n  ');
      return ok(
        [
          `已从 ${drafts.length} 条成功轨迹蒸馏：新建 ${created} 条草案，已存在 ${existing} 条（未注册）。`,
          `  ${ids}`,
          '',
          '用 /sop approve <id> 确认后才写入技能目录；/sop reject <id> 拒绝。',
        ].join('\n'),
        { created, existing }
      );
    },

    show(payload: string): CommandResult {
      const found = resolveDraft(deps.store, payload);
      if (!found.draft) return fail(found.error ?? '草案不可用');
      return ok(found.draft.markdown, {
        id: found.draft.id,
        status: found.draft.status,
      });
    },

    approve(payload: string): CommandResult {
      const found = resolveDraft(deps.store, payload);
      if (!found.draft) return fail(found.error ?? '草案不可用');
      const draft = found.draft;
      if (draft.status === SOP_DRAFT_APPROVED) {
        return ok(`草案 ${draft.id} 已批准过（未重复写入技能）`);
      }
      if (draft.status === SOP_DRAFT_REJECTED) {
        return fail(`草案 ${draft.id} 已被拒绝，不能批准（终态不可改写）`);
      }
      let skillPath: string | null;
      try {
        skillPath = deps.store.installSkill(draft);
      } catch (e) {
        return fail(
          `写入技能失败：${e instanceof Error ? e.message : String(e)}`
        );
      }
      if (!skillPath) {
        return fail(
          `同名技能目录已存在，拒绝覆盖：${draft.title}（如需更新请手动处理）`
        );
      }
      deps.store.decide(draft, SOP_DRAFT_APPROVED);
      return ok(`已批准并写入技能：${skillPath}（下次技能加载生效）`, {
        id: draft.id,
        skillPath,
      });
    },

    reject(payload: string): CommandResult {
      const [idOrPrefix = '', ...noteParts] = payload.split(/\s+/);
      const found = resolveDraft(deps.store, idOrPrefix);
      if (!found.draft) return fail(found.error ?? '草案不可用');
      const draft = found.draft;
      if (draft.status === SOP_DRAFT_REJECTED) {
        return ok(`草案 ${draft.id} 已被拒绝（未重复记录）`);
      }
      if (draft.status === SOP_DRAFT_APPROVED) {
        return fail(`草案 ${draft.id} 已批准为技能，不能拒绝（终态不可改写）`);
      }
      const updated = deps.store.decide(
        draft,
        SOP_DRAFT_REJECTED,
        noteParts.join(' ')
      );
      const stats = computeSopDraftStats(deps.store.list());
      return ok(
        `已拒绝草案 ${updated.id}${updated.note ? `（原因：${updated.note}）` : ''}；当前拒绝率 ${formatRate(stats.rejectedRate)}`,
        stats
      );
    },

    /**
     * 观察期度量（M7，**只读**）：批准后的技能在观察窗内被真实执行几次、是否伴随低分。
     *
     * 数据源：会话事件 `assistant/tool_call`（`skill` + `op=run` + `args.name`）与 `turn/quality`
     * 按轮 join。**不改台账、不改技能、不新增埋点**；未批准草案一律拒绝观测。
     */
    async observe(payload: string): Promise<CommandResult> {
      const [idOrPrefix = '', daysRaw = ''] = payload.split(/\s+/);
      const found = resolveDraft(deps.store, idOrPrefix);
      if (!found.draft) return fail(found.error ?? '草案不可用');
      const draft = found.draft;
      if (draft.status !== SOP_DRAFT_APPROVED) {
        return fail(
          `草案 ${draft.id} 未批准（当前 ${draft.status}）：观察期只针对已写入技能目录的 SOP`
        );
      }
      const days = daysRaw ? Number(daysRaw) : SOP_OBSERVATION_WINDOW_DAYS;
      if (!Number.isInteger(days) || days <= 0) {
        return fail(`观察天数必须是正整数：${daysRaw}`);
      }

      const skillName = sopSkillName(draft.id);
      const since = Date.now() - days * MS_PER_DAY;

      let sessionIds: string[];
      try {
        sessionIds = await deps.listSessionIds(SOP_OBSERVATION_SESSIONS);
      } catch (e) {
        return fail(
          `读取会话列表失败：${e instanceof Error ? e.message : String(e)}`
        );
      }

      const cutoff = await deps.readScoreCutoff();
      const turns: SopTurnObservation[] = [];
      for (const sessionId of sessionIds) {
        let events: LiriEvent[];
        try {
          events = await deps.readEvents(sessionId, SOP_OBSERVATION_EVENTS);
        } catch {
          // @ignore-catch — 单会话读取失败 ⇒ 跳过（不中断整轮观测）
          continue;
        }
        turns.push(
          ...collectSopSkillObservations(sessionId, events, {
            skillName,
            since,
          })
        );
      }

      const observation = summarizeSopObservations(skillName, turns, cutoff);
      const judgement = judgeSopObservation(observation);
      const refs = observation.turns
        .slice(0, 5)
        .map((turn) => `${turn.sessionId}#${turn.turnNumber}`)
        .join(', ');

      return ok(
        [
          `SOP 观察期度量：${skillName}（草案 ${draft.id}）`,
          `  观察窗：最近 ${days} 天｜扫描会话 ${sessionIds.length} 个｜低分阈值 ${cutoff}`,
          `  执行次数：${observation.uses}（需 ≥ ${SOP_OBSERVATION_MIN_USES}）`,
          `  有执行的轮次：${observation.turns.length}${refs ? `（${refs}）` : ''}`,
          `  伴随低分：${observation.lowScoreTurns.length} 轮｜缺质量事件：${observation.unscoredTurns.length} 轮`,
          `  判定：${judgement.verdict} —— ${judgement.reasons.join('；')}`,
        ].join('\n'),
        {
          id: draft.id,
          skillName,
          uses: observation.uses,
          lowScoreTurns: observation.lowScoreTurns.length,
          unscoredTurns: observation.unscoredTurns.length,
          verdict: judgement.verdict,
        }
      );
    },
  };
}

const sopCommand = createSopCommand({
  store: new SopDraftStore(),
  distill: (limit) =>
    distillSopDrafts(readCompletedPlanTrajectories({ limit }), limit),
  listSessionIds: async (limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI().getChatManager().listRecentSessionIds(limit);
  },
  readEvents: async (sessionId, limit) => {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    return await getCoreAPI().getChatManager().readSessionEvents(sessionId, {
      types: SOP_OBSERVE_EVENT_TYPES,
      limit,
    });
  },
  readScoreCutoff: async () => {
    const { SUSPICIOUS_SCORE_THRESHOLD } = await import('@modules/evals');
    return SUSPICIOUS_SCORE_THRESHOLD;
  },
});

export default sopCommand;
