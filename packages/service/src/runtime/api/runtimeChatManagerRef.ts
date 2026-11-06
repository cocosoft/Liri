/**
 * P38（2026-11-06）：消息读写路径对 **app 侧 `ChatManager`** 的最小结构契约。
 *
 * `messageMutation` / `sessionMessagesRead` 只需要 ChatManager 的两个能力：
 * 取会话网关（`getSessionGateway`）与按块改消息（`updateMessageBlocks`）。
 * 直接 `import type { ChatManager } from '@modules/chat'` 会让 `packages/service`
 * 依赖 **app 层模块**（lint:infra R8 判倒挂），故以结构类型收窄，
 * 真实 `ChatManager` 仍可结构赋值过来（方法参数按双变处理）。
 */
import type { UnifiedMessage } from '@modules/session/types/UnifiedMessage.js';

/** 会话网关的最小结构（删除 / 更新 / 读取路径实际用到的方法） */
export interface RuntimeSessionGatewayRef {
  getSession(sessionId: string): Promise<unknown>;
  getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<UnifiedMessage[]>;
  updateSession(session: unknown): Promise<void>;
  deleteMessages(sessionId: string, messageIds: string[]): Promise<void>;
}

/** ChatManager 的最小结构（runtime 读写路径实际用到的成员） */
export interface RuntimeChatManagerRef {
  getSessionGateway(): RuntimeSessionGatewayRef | undefined;
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string
  ): Promise<void>;
  undoRoundsSince(
    sessionId: string,
    sinceRoundId: number,
    maxRound: number,
    roundIndex: Record<string, number>
  ): Promise<Array<{ roundId: number; success: boolean; error?: string }>>;
}
