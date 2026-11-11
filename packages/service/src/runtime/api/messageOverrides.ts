// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 消息级读时覆盖（2026-11-11）。
 *
 * 背景：`getSessionMessages` 以**事件派生**为主源（`sessionMessagesRead`），投影
 * （`messages.jsonl`）只做兜底。因此对历史消息的 `updateMessageBlocks` 只写投影时，
 * 前端/导出读到的仍是事件里的旧文案（真机：清理重复「⏸ 等待审批」提示时，
 * 投影已改、界面不变）。
 *
 * 口径：会话元数据 `metadata.messageOverrides[messageId] = { content?, blocks? }`，
 * 仅在派生读路径**读时覆盖**，不重写不可变事件日志。
 *  - 无该字段 ⇒ 零成本原样返回（绝大多数会话）；
 *  - 只覆盖显式提供的字段，其余保持派生值。
 */
export interface MessageOverride {
  content?: string;
  blocks?: Array<Record<string, unknown>>;
}

export type MessageOverrideMap = Record<string, MessageOverride>;

/** 读时覆盖：按消息 id 覆盖 `content` / `blocks`（副本，不改入参） */
export function applyMessageOverrides<T extends { id: string }>(
  messages: T[],
  overrides: unknown
): T[] {
  if (!overrides || typeof overrides !== 'object') return messages;
  const map = overrides as MessageOverrideMap;
  if (Object.keys(map).length === 0) return messages;
  return messages.map((message) => {
    const override = map[message.id];
    if (!override) return message;
    return {
      ...message,
      ...(typeof override.content === 'string'
        ? { content: override.content }
        : {}),
      ...(Array.isArray(override.blocks)
        ? {
            blocks: override.blocks.map((block) => ({ ...block })),
          }
        : {}),
    };
  });
}
