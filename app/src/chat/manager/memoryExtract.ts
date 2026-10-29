// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * memoryExtract — 「按会话聚合的对话记忆」抽取外移（issue #17 · D2，2026-10-29）
 *
 * 迁出来源：`ChatManager.extractMemoryFromChat` 的方法体（原 2123–2191，约 69 行）。
 *
 * 语义（与迁移前逐字一致）：
 * - ① 快路径：进程内缓存命中 ⇒ 追加到同一条（缓存条目已被删除 ⇒ 清缓存走重建）；
 * - ② 慢路径：按会话标签查找既有条目（进程重启后续写同一条）；
 * - ③ 首次：新建一条，此后每轮追加；
 * - 单条内容按 {@link CONVERSATION_MEMORY_MAX_CHARS} 封顶（保留最近内容）；
 * - 失败只记错误日志（记忆提取不阻断主流程）。
 *
 * 会话 → memoryId 的 Map 由**宿主**持有（实例级生命周期），以端口传入 ——
 * **不得**做成模块级单例（会跨 ChatManager 实例 / 测试串扰）。
 */

import { handleError } from '@modules/error';

/** D5-A：单条对话记忆的**内容上限**（按会话聚合后必须封顶，否则单条无界增长） */
const CONVERSATION_MEMORY_MAX_CHARS = 20_000;

export interface MemoryExtractPorts {
  /** 会话 → 该会话「对话记忆」的 memoryId（宿主实例字段，用于按会话聚合） */
  conversationMemoryIdBySession: Map<string, string>;
}

export async function extractMemoryFromChat(
  ports: MemoryExtractPorts,
  userContent: string,
  assistantContent: string,
  sessionId: string
): Promise<void> {
  try {
    const { getMemoryManager } = await import('@modules/memory');
    const mm = getMemoryManager();
    const turnText = `用户: ${userContent}\n助手: ${assistantContent}`;

    /** 追加一轮对话并封顶（保留最近内容） */
    const appendTurn = (prev: string): string => {
      const joined = prev ? `${prev}\n\n${turnText}` : turnText;
      const cap = CONVERSATION_MEMORY_MAX_CHARS;
      return joined.length > cap ? joined.slice(joined.length - cap) : joined;
    };

    // `updateMemory` 是**合并语义**（metadata 浅合并、updatedAt 由它自设）⇒ 只传 content
    const writeInto = async (
      id: string,
      prevContent: string
    ): Promise<void> => {
      await mm.updateMemory(id, { content: appendTurn(prevContent) });
    };

    // ① 快路径：进程内缓存命中 ⇒ 追加（不再新建）
    const cachedId = ports.conversationMemoryIdBySession.get(sessionId);
    if (cachedId) {
      const existing = await mm.getMemory(cachedId);
      if (existing) {
        await writeInto(cachedId, existing.content ?? '');
        return;
      }
      // 该条已被删除（维护期去重/清理）⇒ 清缓存，走重建分支
      ports.conversationMemoryIdBySession.delete(sessionId);
    }

    // ② 慢路径：按会话标签查找既有条目（进程重启后仍能续写同一条，而非另起一条）
    const all = await mm.getAllMemories();
    const found = all.find(
      (m) =>
        m.metadata?.type === 'conversation' &&
        Array.isArray(m.metadata?.tags) &&
        m.metadata.tags.includes(sessionId)
    );
    if (found) {
      ports.conversationMemoryIdBySession.set(sessionId, found.id);
      await writeInto(found.id, found.content ?? '');
      return;
    }

    // ③ 首次：新建（此后每轮都追加到这一条）
    const created = await mm.createMemory({
      content: turnText,
      metadata: {
        name: `会话 ${sessionId.slice(0, 8)} 对话`,
        description: '从对话中自动提取（按会话聚合，逐轮追加）',
        type: 'conversation',
        tags: ['auto-extracted', sessionId],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ports.conversationMemoryIdBySession.set(sessionId, created.id);
  } catch (err) {
    // 记忆提取失败不影响主流程
    handleError(err, { module: 'chat:manager', action: 'extractMemory' });
  }
}
