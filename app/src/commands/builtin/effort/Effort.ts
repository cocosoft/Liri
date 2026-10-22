//
/**
 * Effort设置命令实现
 *
 * 2026-10-22（`/effort` 后端接线）：此前只写 `context.environment.EFFORT_LEVEL`，
 * 而 **只有 REPL 会读它**（聊天/HTTP 链路零读取）⇒ 命令"看起来生效"但对话行为不变。
 * 现在：
 *  ① 有会话上下文 ⇒ 写会话 `metadata.effortLevel`（内存 + 持久层，两条路径都写，
 *     否则下发消息读到的是旧内存对象）+ 预留的 `metadata.thinkingBudget`；
 *  ② 仍然写 `context.environment`（REPL 语境保持不变）；
 *  ③ 读取路径：`chat/services/MessageContextPipeline` 在组装 system prompt 时注入
 *     对应详略指令（`auto` ⇒ 不注入）。
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import {
  isReplyEffortLevel,
  resolveEffortThinkingBudget,
  type ReplyEffortLevel,
} from '@modules/chat';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:effort:Effort');

export type EffortLevel = ReplyEffortLevel;

/**
 * `context.chatManager` 的**窄契约**（只用本命令需要的成员）——
 * 与 `Brief.ts` 同一做法，避免 commands 侧引入 ChatManager 全量类型。
 */
interface SessionMetaHost {
  getSessions?: () => Array<{ id: string; metadata: Record<string, unknown> }>;
  getSessionGateway?: () =>
    | {
        getSession: (
          id: string
        ) => Promise<{ metadata: Record<string, unknown> } | null>;
        updateSession: (session: unknown) => Promise<void>;
      }
    | undefined;
}

export default {
  /**
   * 执行effort命令
   * @param args effort级别
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const level = args.trim().toLowerCase();

    if (!level || level === 'show') {
      return this.handleShow(context);
    }

    if (!isReplyEffortLevel(level)) {
      return {
        success: false,
        type: 'error',
        error: `无效的effort级别: ${level}`,
        message: '有效的级别: low, medium, high, auto',
      };
    }

    return this.handleSet(level, context);
  },

  /**
   * 显示当前effort设置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const currentLevel = await this.readEffectiveLevel(context);

    const levelDescriptions: Record<string, string> = {
      low: '低 - 快速响应，较少细节',
      medium: '中 - 平衡响应速度和详细程度',
      high: '高 - 详细分析，较慢响应',
      auto: '自动 - 根据任务自动调整',
    };

    return {
      success: true,
      type: 'text',
      message:
        `当前 Effort 级别: ${levelDescriptions[currentLevel] || currentLevel}\n\n` +
        '使用 /effort <级别> 更改设置\n' +
        '级别: low, medium, high, auto',
      data: { level: currentLevel },
    };
  },

  /**
   * 设置effort级别
   */
  async handleSet(
    level: ReplyEffortLevel,
    context: CommandContext
  ): Promise<CommandResult> {
    const levelDescriptions: Record<string, string> = {
      low: '低级别',
      medium: '中级别',
      high: '高级别',
      auto: '自动模式',
    };

    // ① 会话级（聊天链路真正读取的位置）
    const persisted = await this.persistToSession(level, context);

    // ② REPL 语境（保持原有语义，不读取会话时仍然生效）
    if (context.environment) {
      context.environment.EFFORT_LEVEL = level;
    }

    const scopeNote = persisted
      ? ''
      : '\n（当前无会话上下文：仅对本次 REPL 生效，不影响会话内回复）';

    context.onDone?.(`Effort级别已设置为: ${levelDescriptions[level]}`, {
      display: 'system',
    });

    return {
      success: true,
      type: 'text',
      message: `Effort级别已设置为: ${levelDescriptions[level]}${scopeNote}`,
      data: { level, sessionApplied: persisted },
    };
  },

  /**
   * 读取当前生效档位：会话元数据优先，其次 REPL 环境，最后默认 auto
   */
  async readEffectiveLevel(context: CommandContext): Promise<ReplyEffortLevel> {
    const fromSession = context.sessionId
      ? await this.readSessionLevel(context)
      : undefined;
    if (fromSession) return fromSession;

    const fromEnv = context.environment?.EFFORT_LEVEL;
    return isReplyEffortLevel(fromEnv) ? fromEnv : 'auto';
  },

  /**
   * 读会话级档位（内存对象；取不到返回 undefined）
   */
  async readSessionLevel(
    context: CommandContext
  ): Promise<ReplyEffortLevel | undefined> {
    const sid = context.sessionId;
    if (!sid || !context.chatManager) return undefined;
    const host = context.chatManager as SessionMetaHost;
    const session = host.getSessions?.().find((s) => s.id === sid);
    const value = session?.metadata?.effortLevel;
    return isReplyEffortLevel(value) ? value : undefined;
  },

  /**
   * 写会话元数据（内存 + 持久层）。返回是否真正落到了会话上。
   */
  async persistToSession(
    level: ReplyEffortLevel,
    context: CommandContext
  ): Promise<boolean> {
    const sid = context.sessionId;
    if (!sid || !context.chatManager) return false;

    const host = context.chatManager as SessionMetaHost;
    const budget = resolveEffortThinkingBudget(level);
    // `auto` ⇒ budget 为 undefined ⇒ 清掉预留字段（避免留下与档位不符的旧值）
    const applyPatch = (metadata: Record<string, unknown>): void => {
      metadata.effortLevel = level;
      if (budget !== undefined) metadata.thinkingBudget = budget;
      else delete metadata.thinkingBudget;
    };

    const memory = host.getSessions?.().find((s) => s.id === sid);
    if (memory) applyPatch(memory.metadata);

    const gateway = host.getSessionGateway?.();
    if (!gateway) return Boolean(memory);

    try {
      const stored = await gateway.getSession(sid);
      if (!stored) return Boolean(memory);
      applyPatch(stored.metadata);
      await gateway.updateSession(stored);
      return true;
    } catch (error) {
      logger.warning('Effort: 会话元数据持久化失败', {
        sessionId: sid,
        error: String(error),
      });
      return Boolean(memory);
    }
  },
};
