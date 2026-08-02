/**
 * Chat History Slice — 会话历史与重命名工具函数
 *
 * 无 Zustand 状态字段，仅提供工具函数导出。
 * 被 chat-message.slice 引用（flushSaveBlocks、doAutoRename 等）。
 */
import { useRootStore } from "@/stores/root-store";
import { chatService } from "@/services/chatService";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { chatCoordinator } from "./chatCoordinator";
import type { Message } from "@/types";
import type { MessageBlock } from "@/types";

// 会话消息缓存：避免快速切换时重复 fetch
const _sessionMessageCache = new Map<string, Message[]>();
const MAX_CACHED_SESSIONS = 15;

/** 导出供 sessionStore 使用：获取缓存的会话消息 */
export function _getCachedMessages(sessionId: string): Message[] | null {
  return _sessionMessageCache.get(sessionId) ?? null;
}

/** 标记会话缓存为 stale（发送新消息后调用） */
export function staleSessionCache(sessionId: string): void {
  _sessionMessageCache.delete(sessionId);
}

/** 写入会话消息缓存（带 LRU 淘汰） */
export function setSessionCache(sessionId: string, messages: Message[]): void {
  if (
    _sessionMessageCache.size >= MAX_CACHED_SESSIONS &&
    !_sessionMessageCache.has(sessionId)
  ) {
    const oldest = _sessionMessageCache.keys().next().value;
    if (oldest) _sessionMessageCache.delete(oldest);
  }
  _sessionMessageCache.set(sessionId, messages);
}

// ─── SaveQueue：防抖持久化 blocks，避免切会话时丢失 ───

export class SaveQueue {
  private _sessionId: string | null = null;
  private _messageId: string | null = null;
  private _blocks: MessageBlock[] | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _isFlushing = false;
  private _hasPending = false;
  private readonly _debounceMs: number;

  constructor(debounceMs: number = 200) {
    this._debounceMs = debounceMs;
  }

  /** 入队待保存（immediate=true 时跳过防抖，直接保存） */
  enqueue(
    sessionId: string,
    messageId: string,
    blocks: MessageBlock[],
    immediate: boolean = false,
  ): void {
    this._sessionId = sessionId;
    this._messageId = messageId;
    this._blocks = blocks;
    this._hasPending = true;
    if (immediate) {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
      this._doFlush();
      return;
    }
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._doFlush(), this._debounceMs);
  }

  /** 立即 flush（会清除防抖 timer） */
  async flush(): Promise<void> {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this._doFlush();
  }

  private async _doFlush(): Promise<void> {
    if (this._isFlushing) return;
    this._isFlushing = true;
    try {
      if (this._sessionId && this._messageId && this._blocks) {
        const sid = this._sessionId;
        const mid = this._messageId;
        const blk = this._blocks;
        this._sessionId = null;
        this._messageId = null;
        this._blocks = null;
        this._hasPending = false;
        try {
          await chatService.updateMessageBlocks(
            sid,
            mid,
            blk as unknown as Array<Record<string, unknown>>,
          );
        } catch (err) {
          handleClientError(
            err,
            { module: "stores:chat:history", action: "SaveQueue.flush" },
            "warn",
          );
        }
      }
    } finally {
      this._isFlushing = false;
      if (this._hasPending) {
        await this._doFlush();
      }
    }
  }

  get hasPending(): boolean {
    return this._hasPending;
  }

  get isFlushing(): boolean {
    return this._isFlushing;
  }

  /** 取消所有待保存操作（流中断时使用） */
  reset(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._sessionId = null;
    this._messageId = null;
    this._blocks = null;
    this._hasPending = false;
  }
}

// ─── 全局 SaveQueue 实例（供 flushPendingSaves 使用）───

const _globalSaveQueue = new SaveQueue();

/** 将 blocks 入队到全局 SaveQueue（流式传输中使用） */
export function enqueueSaveBlocks(
  sessionId: string,
  messageId: string,
  blocks: MessageBlock[],
  immediate: boolean = false,
): void {
  _globalSaveQueue.enqueue(sessionId, messageId, blocks, immediate);
}

/** 立即 flush 全局 SaveQueue（切会话时使用） */
export function flushSaveBlocks(): Promise<void> {
  return _globalSaveQueue.flush();
}

/** 全局 SaveQueue 是否有待保存数据 */
export function getHasPendingSave(): boolean {
  return _globalSaveQueue.hasPending;
}

/** Reset 全局 SaveQueue */
export function resetSaveQueue(): void {
  _globalSaveQueue.reset();
}

/**
 * 自动生成会话标题，失败时用用户消息前30字符作为降级标题
 * 添加延迟 + 二次检查防御后端 autoGenerateTitle 的竞态条件
 */
export async function doAutoRename(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  // 延迟 2 秒，给后端 fire-and-forget 的 autoGenerateTitle 时间先完成
  await new Promise((r) => setTimeout(r, 2000));

  // 二次检查：后端可能已通过 SSE 更新了标记
  if (!chatCoordinator.shouldAutoRename(sessionId)) {
    return;
  }

  try {
    const title = await sessionService.generateTitle(
      sessionId,
      userMessage,
      assistantResponse,
    );

    const finalTitle =
      title || userMessage.slice(0, 30) + (userMessage.length > 30 ? "…" : "");
    useRootStore.getState().renameChatSession(sessionId, finalTitle);
  } catch (_error) {
    handleClientError(
      _error,
      { module: "stores:chat:history", action: "doAutoRename" },
      "warn",
    );
    // LLM 生成标题失败，用用户消息前30字符降级
    const fallbackTitle =
      userMessage.length > 30 ? userMessage.slice(0, 30) + "…" : userMessage;
    useRootStore.getState().renameChatSession(sessionId, fallbackTitle);
  }
}
