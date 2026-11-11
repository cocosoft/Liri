// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 消息级读时覆盖（2026-11-11）。
 *
 * 背景：`getSessionMessages` 以**事件派生**为主源（`sessionMessagesRead`），投影
 * （`messages.jsonl`）只做兜底。因此对历史消息的 `updateMessageBlocks` 只写投影时，
 * 前端/导出读到的仍是事件里的旧文案。
 *
 * 口径：会话元数据 `metadata.messageOverrides[messageId] = { content?, hiddenBlockIds? }`，
 * 仅在派生读路径**读时覆盖**，不重写不可变事件日志。
 *
 * ⚠️ 只允许存**小字段**：早期实现存了整份 `blocks`，单个会话 `session.json` 从 2.9KB
 * 涨到 199KB（其中一条消息 170 个 block）。现改为「正文 + 需要隐藏的块 id」——
 * 工具卡片等块仍来自事件派生，覆盖只负责"去掉哪一块"。
 */
export interface MessageOverride {
  content?: string;
  /** 需要在读时从 `blocks` 中剔除的块 id（如被清理的重复提示 text 块） */
  hiddenBlockIds?: string[];
}

export type MessageOverrideMap = Record<string, MessageOverride>;

function isOverrideMap(value: unknown): value is MessageOverrideMap {
  return Boolean(value) && typeof value === 'object';
}

/**
 * 得到「旧版整份 blocks」覆盖的兼容投影（仅用于读出存量数据，避免历史覆盖失效）。
 *
 * 存量条目形如 `{ content, blocks }`；新版只认 `content` / `hiddenBlockIds`。
 * 读时若发现 `blocks`，按原样覆盖一次，调用方写回新版后该分支自然消失。
 */
function legacyBlocksOf(
  override: Record<string, unknown>
): unknown[] | undefined {
  const blocks = override.blocks;
  return Array.isArray(blocks) ? blocks : undefined;
}

/** 读时覆盖：按消息 id 覆盖 `content` / 剔除 `hiddenBlockIds`（返回副本，不改入参） */
export function applyMessageOverrides<
  T extends { id: string; blocks?: unknown },
>(messages: T[], overrides: unknown): T[] {
  if (!isOverrideMap(overrides)) return messages;
  const map = overrides as MessageOverrideMap;
  if (Object.keys(map).length === 0) return messages;
  return messages.map((message) => {
    const raw = map[message.id] as Record<string, unknown> | undefined;
    if (!raw) return message;

    const content = typeof raw.content === 'string' ? raw.content : undefined;
    const hidden = Array.isArray(raw.hiddenBlockIds)
      ? new Set(
          raw.hiddenBlockIds.filter((v): v is string => typeof v === 'string')
        )
      : undefined;
    const legacyBlocks = legacyBlocksOf(raw);
    const currentBlocks = Array.isArray(message.blocks)
      ? (message.blocks as Array<Record<string, unknown>>)
      : undefined;

    let nextBlocks: unknown = message.blocks;
    if (legacyBlocks) {
      nextBlocks = legacyBlocks.map((block) => ({ ...(block as object) }));
    } else if (hidden && currentBlocks) {
      nextBlocks = currentBlocks
        .filter((block) => !hidden.has(String(block.id ?? '')))
        .map((block) => ({ ...block }));
    }

    return {
      ...message,
      ...(content !== undefined ? { content } : {}),
      ...(nextBlocks !== message.blocks ? { blocks: nextBlocks } : {}),
    };
  });
}
