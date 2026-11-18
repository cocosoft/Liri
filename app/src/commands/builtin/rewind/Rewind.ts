/**
 * 回退会话命令实现（`/rewind`，别名 `/undo`）
 *
 * G4 接线（2026-11-14）：原实现调用**不存在**的 `chatManager.rewindSession` ⇒ 命令是死的。
 * 现改为复用既有「消息截断 + 文件级联回滚」唯一实现 `CoreAPI.truncateMessages`
 * （其内部走 `undoRoundsSince` → `security/rollback` 的轮快照；快照落
 * `~/.pyapp/data/snapshots/` 影子库，不碰用户仓库 `.git`）。
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { runRewind, type RewindMessageLike } from './rewindCore.js';

/** 从命令上下文取当前会话消息（宿主为 `ChatManagerInterface`；缺失则视为空） */
function readMessages(context: CommandContext): RewindMessageLike[] {
  const cm = context.chatManager as
    | { getSessionMessages?: (sessionId: string) => RewindMessageLike[] }
    | undefined;
  if (!context.sessionId || typeof cm?.getSessionMessages !== 'function') {
    return [];
  }
  return cm.getSessionMessages(context.sessionId) ?? [];
}

function toCommandResult(
  outcome: Awaited<ReturnType<typeof runRewind>>,
  context: CommandContext,
  label: string
): CommandResult {
  if (!outcome.ok) {
    return {
      success: false,
      type: 'error',
      error: outcome.error ?? '回退失败',
    };
  }
  const undone =
    outcome.undoneRounds && outcome.undoneRounds > 0
      ? `（文件已回滚 ${outcome.undoneRounds} 轮）`
      : '';
  const message = `${label}${undone}`;
  context.onDone?.(message, { display: 'system' });
  return {
    success: true,
    type: 'text',
    message,
    data: {
      messageId: outcome.messageId,
      deletedMessageIds: outcome.deletedMessageIds,
      undoneRounds: outcome.undoneRounds,
    },
  };
}

export default {
  /**
   * 执行回退命令
   * @param args 回退步数或消息ID（空 = 1 步）
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const arg = args.trim();
    if (!context.sessionId) {
      return { success: false, type: 'error', error: '当前没有活动会话' };
    }
    if (arg && !/^\d+$/.test(arg)) {
      return this.handleRewindToMessage(arg, context);
    }
    return this.handleRewindSteps(arg ? Number(arg) : 1, context);
  },

  /** 按步数回退（最近 N 个用户轮次及其后的助手消息） */
  async handleRewindSteps(
    steps: number,
    context: CommandContext
  ): Promise<CommandResult> {
    const outcome = await runRewind({
      sessionId: context.sessionId as string,
      messages: readMessages(context),
      steps,
      truncate: (sessionId, beforeMessageId) =>
        getCoreAPI().truncateMessages(sessionId, beforeMessageId),
    });
    return toCommandResult(outcome, context, `会话已回退 ${steps} 步`);
  },

  /** 回退到指定用户消息（该消息及其后全部删除） */
  async handleRewindToMessage(
    messageId: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const outcome = await runRewind({
      sessionId: context.sessionId as string,
      messages: readMessages(context),
      messageId,
      truncate: (sessionId, beforeMessageId) =>
        getCoreAPI().truncateMessages(sessionId, beforeMessageId),
    });
    return toCommandResult(outcome, context, `会话已回退到消息 ${messageId}`);
  },
};
