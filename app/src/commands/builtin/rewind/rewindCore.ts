// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * rewindCore —— 「回退上一步」的**目标选择 + 执行编排**（G4 接线，2026-11-14）
 *
 * 背景（取证后纠正）：方案 G4 原判「主工作区无通用执行前备份/undo」**不成立** ——
 * `packages/infra/src/security/rollback/` 已具备**轮粒度快照 + 工具级文件追踪 + undo/redo**
 * （`RollbackIntegration` 每轮 `onRoundStart`/`onRoundEnd`，快照落 `~/.pyapp/data/snapshots/`
 * 自有影子库、不碰用户仓库 `.git`），且消息截断路径已级联文件回滚
 * （`messageMutation.truncateMessages` → `undoRoundsSince`）。
 *
 * 真正缺口：用户命令 `/rewind`（别名 `/undo`）调用**不存在的** `chatManager.rewindSession`
 * ⇒ 入口是死的。本模块只做两件事：
 *   ① 选目标：把「回退 N 步 / 回退到某条消息」翻译成**目标用户消息 id**（纯函数）；
 *   ② 编排：调既有 `truncateMessages`（消息截断 + 文件级联回滚的**唯一实现**），不重造。
 *
 * 边界（如实）：
 * - 只允许回退到**用户消息**（与 `truncateMessages` 的服务端约束同口径）；
 * - 回退次数上限、streaming 冲突、404 等由 `truncateMessages` 判定并上抛，本模块**不预判**；
 * - 不做「只回滚文件、保留对话」的第二种语义（既有能力已覆盖"改坏后恢复"的诉求）。
 */

/** 选择所需的最小消息形状（避免依赖具体 Message 类型） */
export interface RewindMessageLike {
  id: string;
  role?: string;
}

export type RewindTargetResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/** `truncateMessages` 的最小返回面（既有实现返回更多字段，这里只声明用到的） */
export interface RewindTruncateResult {
  success?: boolean;
  deletedMessageIds?: string[];
  undoResults?: Array<{ roundId: number; success: boolean; error?: string }>;
}

/**
 * 按**步数**选择目标：`steps=1` ⇒ 最近一个用户轮次（连同其后的助手消息一并删除）。
 *
 * 语义取"倒数第 N 个用户消息作为截断起点"：与「回退 N 步对话」一致。
 */
export function selectRewindTargetBySteps(
  messages: readonly RewindMessageLike[],
  steps: number
): RewindTargetResult {
  if (!Number.isInteger(steps) || steps <= 0) {
    return { ok: false, error: '回退步数必须为正整数' };
  }
  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) {
    return { ok: false, error: '当前会话没有可回退的用户消息' };
  }
  const index = userMessages.length - steps;
  if (index < 0) {
    return {
      ok: false,
      error: `最多可回退 ${userMessages.length} 步（请求 ${steps} 步）`,
    };
  }
  return { ok: true, messageId: userMessages[index].id };
}

/** 按**消息 id** 选择目标：必须是用户消息且存在于当前会话 */
export function selectRewindTargetByMessage(
  messages: readonly RewindMessageLike[],
  messageId: string
): RewindTargetResult {
  const trimmed = messageId.trim();
  if (!trimmed) return { ok: false, error: '消息 ID 不能为空' };
  const target = messages.find((m) => m.id === trimmed);
  if (!target) return { ok: false, error: `未找到消息 ${trimmed}` };
  if (target.role !== 'user') {
    return { ok: false, error: '只能回退到用户消息' };
  }
  return { ok: true, messageId: trimmed };
}

export interface RunRewindInput {
  sessionId: string;
  messages: readonly RewindMessageLike[];
  /** 与 `messageId` 二选一：步数 */
  steps?: number;
  /** 与 `steps` 二选一：目标消息 id */
  messageId?: string;
  /** 既有截断实现（生产 = `CoreAPI.truncateMessages`；测试注入） */
  truncate: (
    sessionId: string,
    beforeMessageId: string
  ) => Promise<RewindTruncateResult>;
}

export interface RunRewindOutcome {
  ok: boolean;
  /** 实际截断起点（成功时） */
  messageId?: string;
  deletedMessageIds?: string[];
  /** 文件级联回滚中**成功**的轮次数（供用户确认"文件也回去了"） */
  undoneRounds?: number;
  error?: string;
}

/**
 * 执行一次回退：选目标 → 调既有 `truncateMessages`（消息 + 文件级联回滚）。
 *
 * 失败直接返回错误文案（不吞异常、不假装成功）。
 */
export async function runRewind(
  input: RunRewindInput
): Promise<RunRewindOutcome> {
  const { sessionId, messages, truncate } = input;
  if (!sessionId) return { ok: false, error: '当前没有活动会话' };

  const target =
    input.messageId !== undefined
      ? selectRewindTargetByMessage(messages, input.messageId)
      : selectRewindTargetBySteps(messages, input.steps ?? 1);
  if (!target.ok) return { ok: false, error: target.error };

  try {
    const result = await truncate(sessionId, target.messageId);
    return {
      ok: true,
      messageId: target.messageId,
      deletedMessageIds: result.deletedMessageIds ?? [],
      undoneRounds: (result.undoResults ?? []).filter((r) => r.success).length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
