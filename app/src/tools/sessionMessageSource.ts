/**
 * 工具侧读取会话消息的唯一入口（2026-10-23）
 *
 * 背景：`BriefTool` / `SaveConversationTool` 此前直接调用旧服务
 * `chatService.getSessionMessages`（`@modules/chat` 的 `ChatServiceImpl`）。
 * 该服务读的是历史目录 `chat_sessions/*.json`，**没有任何写入方**，也不带归属信息
 * ⇒ 工具拿到的永远是空数组，且是一条绕过身份分区的旁路。
 *
 * 现在统一改走 `CoreAPI.getSessionMessages`（事件派生 + 身份作用域存储）。
 * 采用**动态导入**，与 `SessionsTool` 同款，避免 tools → runtime 的静态环。
 */
import type { SessionMessage } from '@modules/session';

/** CoreAPI 返回的消息形状（见 `SessionMessagesRead.getSessionMessages`） */
export interface CoreSessionMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

/** 读取端口（默认走 CoreAPI；测试可注入，见 `tests/tools/toolSessionSource.test.ts`） */
export type SessionMessagesReader = (
  sessionId: string
) => Promise<{ messages: CoreSessionMessage[] }>;

/**
 * 把 CoreAPI 消息映射为 `SessionMessage` 形状（`createdAt` 由 `timestamp` 还原）。
 *
 * 纯函数，便于单独验证边界（`content` 非字符串 / 空集合）。
 */
export function toSessionMessages(
  messages: CoreSessionMessage[]
): SessionMessage[] {
  return messages.map(
    (message) =>
      ({
        id: message.id,
        type: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
        createdAt: new Date(message.timestamp),
      }) as unknown as SessionMessage
  );
}

/**
 * 读取指定会话的消息（按当前请求身份过滤；无权限 / 不存在 ⇒ 空数组）。
 *
 * @param sessionId 会话 ID
 * @param reader 可选的读取端口（缺省走 CoreAPI）
 * @returns 会话消息（`SessionMessage` 形状）
 */
export async function loadSessionMessages(
  sessionId: string,
  reader?: SessionMessagesReader
): Promise<SessionMessage[]> {
  const read: SessionMessagesReader =
    reader ??
    (async (id) => {
      const { getCoreAPI } = await import('../runtime/api/CoreAPIImpl');
      return getCoreAPI().getSessionMessages(id);
    });

  const { messages } = await read(sessionId);
  return toSessionMessages(messages);
}
