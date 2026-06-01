import { create } from 'zustand';
import { Message, MessageBlock } from '../types';
import type { ToolCall } from '../types';
import { chatService } from '../services/chatService';
import { useSessionStore } from './sessionStore';

interface ChatStore {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  addMessage: (message: Message) => void;
  sendMessage: (content: string, sessionId?: string) => Promise<void>;
  streamMessage: (content: string, sessionId?: string) => Promise<void>;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
}

import { sessionService } from '../services/sessionService';

/**
 * 判断是否需要自动重命名会话
 * 优先从 currentSession 查找，若 sessionId 不匹配则降级到 sessions 列表中查找
 */
function shouldAutoRename(sessionId?: string): boolean {
  if (!sessionId) {
    console.log('[shouldAutoRename] sessionId is undefined');
    return false;
  }

  const store = useSessionStore.getState();

  // 优先从 currentSession 查找
  if (store.currentSession?.id === sessionId) {
    const title = store.currentSession.title || '';
    const shouldRename = title.startsWith('新会话') || title.startsWith('New Session');
    console.log('[shouldAutoRename] title:', title, 'shouldRename:', shouldRename);
    return shouldRename;
  }

  // 降级：从 sessions 列表中按 sessionId 查找
  const found = store.sessions.find((s) => s.id === sessionId);
  if (found) {
    const title = found.title || '';
    const shouldRename = title.startsWith('新会话') || title.startsWith('New Session');
    console.log('[shouldAutoRename] fallback found, title:', title, 'shouldRename:', shouldRename);
    return shouldRename;
  }

  console.log('[shouldAutoRename] session not found for id:', sessionId);
  return false;
}

async function doAutoRename(sessionId: string, userMessage: string, assistantResponse: string): Promise<void> {
  console.log('[doAutoRename] Starting auto-rename for session:', sessionId);
  console.log('[doAutoRename] User message:', userMessage.slice(0, 50), '...');
  
  try {
    const title = await sessionService.generateTitle(sessionId, userMessage, assistantResponse);
    console.log('[doAutoRename] Backend returned title:', title);
    
    if (title) {
      console.log('[doAutoRename] Renaming session to:', title);
      useSessionStore.getState().renameSession(sessionId, title);
    } else {
      console.log('[doAutoRename] Backend returned null, using fallback');
      const fallbackTitle = userMessage.length > 30 ? userMessage.slice(0, 30) + '…' : userMessage;
      useSessionStore.getState().renameSession(sessionId, fallbackTitle);
    }
  } catch (error) {
    console.warn('[doAutoRename] Failed to generate title from backend, using fallback', error);
    const fallbackTitle = userMessage.length > 30 ? userMessage.slice(0, 30) + '…' : userMessage;
    useSessionStore.getState().renameSession(sessionId, fallbackTitle);
  }
}

function generateBlockId(): string {
  return 'blk_' + crypto.randomUUID().slice(0, 8);
}

/**
 * 时序块构建器
 * 按流顺序构建 MessageBlock[]，确保工具调用前后的文本正确分段。
 * 对标 Cline 的 assistantMessageContent[] 顺序管理。
 * 
 * 设计原理：
 *   1. text/thinking chunk → 写入当前活跃块
 *   2. tool_call chunk → 冻结当前文本块，新建 tool_call 块
 *   3. status chunk → 追加，标记工具调用的开始/结束
 *   4. 工具调用后，新 text chunk → 新建 text 块
 */
class ChronologicalBlockBuilder {
  private blocks: MessageBlock[] = [];
  private activeTextBlock: MessageBlock | null = null;
  private activeThinkingBlock: MessageBlock | null = null;
  private hasToolCallSinceLastText = false;
  private currentToolCallId: string | null = null;

  /** 追加文本块，工具调用后自动新建 */
  addText(content: string, isStreaming: boolean): void {
    if (this.hasToolCallSinceLastText || !this.activeTextBlock) {
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: 'text',
        content,
        isStreaming,
      };
      this.blocks.push(newBlock);
      this.activeTextBlock = newBlock;
      this.hasToolCallSinceLastText = false;
    } else {
      this.activeTextBlock.content += content;
      this.activeTextBlock.isStreaming = isStreaming;
    }
  }

  /** 追加 thinking 块 */
  addThinking(content: string, isStreaming: boolean): void {
    if (!this.activeThinkingBlock) {
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: 'thinking',
        content,
        isStreaming,
      };
      this.blocks.push(newBlock);
      this.activeThinkingBlock = newBlock;
    } else {
      this.activeThinkingBlock.content += content;
      this.activeThinkingBlock.isStreaming = isStreaming;
    }
  }

  /** 冻结 thinking 块（text 到来时调用） */
  freezeThinking(): void {
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }
  }

  /** 添加状态块，连续重复时去重 */
  addStatus(status: string): void {
    const lastBlock = this.blocks[this.blocks.length - 1];
    if (lastBlock?.type === 'status' && lastBlock.content === status) {
      return;
    }
    this.blocks.push({
      id: generateBlockId(),
      type: 'status',
      content: status,
      isStreaming: true,
      toolCallId: this.currentToolCallId ?? undefined,
    });
  }

  /** 添加工具调用块，冻结当前文本 */
  addToolCall(toolCall: ToolCall): void {
    this.currentToolCallId = toolCall.id;

    if (this.activeTextBlock) {
      this.activeTextBlock.isStreaming = false;
    }
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }

    const existingIdx = this.blocks.findIndex(
      (b) => b.type === 'tool_call' && b.toolCall?.id === toolCall.id
    );

    if (existingIdx !== -1) {
      const existing = this.blocks[existingIdx];
      existing.toolCall = { ...toolCall, status: toolCall.status || 'completed' as const };
      existing.isStreaming = toolCall.status === 'running';
    } else {
      this.blocks.push({
        id: generateBlockId(),
        type: 'tool_call',
        content: '',
        toolCall,
        isStreaming: true,
        toolCallId: toolCall.id,
      });
      this.hasToolCallSinceLastText = true;
    }
  }

  /** 更新已有工具调用的状态 */
  updateToolCallStatus(toolCallId: string, status: 'running' | 'completed' | 'failed'): void {
    const block = this.blocks.find(
      (b) => b.type === 'tool_call' && b.toolCall?.id === toolCallId
    );
    if (block && block.toolCall) {
      block.toolCall.status = status;
      block.isStreaming = status === 'running';
    }
  }

  /** 冻结所有块 */
  freezeAll(): void {
    for (const block of this.blocks) {
      block.isStreaming = false;
    }
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
  }

  /** 获取构建好的 blocks */
  getBlocks(): MessageBlock[] {
    return [...this.blocks];
  }

  /** 重置构建器 */
  reset(): void {
    this.blocks = [];
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
    this.hasToolCallSinceLastText = false;
    this.currentToolCallId = null;
  }
}

// 防抖保存 blocks：流式传输中实时持久化，避免用户切换会话时丢失
let _saveBlocksTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSaveSessionId: string | null = null;
let _pendingSaveMessageId: string | null = null;
let _pendingSaveBlocks: MessageBlock[] | null = null;

async function flushSaveBlocks(): Promise<void> {
  if (_pendingSaveSessionId && _pendingSaveMessageId && _pendingSaveBlocks) {
    const sid = _pendingSaveSessionId;
    const mid = _pendingSaveMessageId;
    const blk = _pendingSaveBlocks;
    _pendingSaveSessionId = null;
    _pendingSaveMessageId = null;
    _pendingSaveBlocks = null;
    try {
      await chatService.updateMessageBlocks(sid, mid, blk as unknown as Array<Record<string, unknown>>);
    } catch {
      // 保存失败不影响主流程
    }
  }
}

function debouncedSaveBlocks(sessionId: string, messageId: string, blocks: MessageBlock[]): void {
  _pendingSaveSessionId = sessionId;
  _pendingSaveMessageId = messageId;
  _pendingSaveBlocks = blocks;
  if (_saveBlocksTimer) {
    clearTimeout(_saveBlocksTimer);
  }
  _saveBlocksTimer = setTimeout(() => {
    flushSaveBlocks();
  }, 800);
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,

  addMessage: (message: Message) => {
    set({ messages: [...get().messages, message] });
  },

  sendMessage: async (content: string, sessionId?: string) => {
    set({ isLoading: true, error: null });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      session_id: sessionId || 'default',
    };

    set({ messages: [...get().messages, userMessage] });

    try {
      const response = await chatService.sendMessage(content, sessionId);
      set({
        messages: [...get().messages, response],
        isLoading: false,
      });
      if (shouldAutoRename(sessionId)) {
        await doAutoRename(sessionId!, content, response.content);
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  streamMessage: async (content: string, sessionId?: string) => {
    set({ isLoading: true, isStreaming: true, error: null });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      session_id: sessionId || 'default',
    };

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      session_id: sessionId || 'default',
      blocks: [],
    };

    set({ messages: [...get().messages, userMessage, assistantMessage] });

    try {
      const generator = chatService.streamMessage(content, sessionId);
      const blockBuilder = new ChronologicalBlockBuilder();

      for await (const chunk of generator) {
        const current = get().messages;
        const msgIdx = current.findIndex((m) => m.id === assistantId);

        if (msgIdx === -1) continue;

        const msg = current[msgIdx];
        let updatedMsg: Message;

        if (chunk.type === 'thinking') {
          blockBuilder.addThinking(chunk.content, true);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === 'text') {
          blockBuilder.freezeThinking();
          blockBuilder.addText(chunk.content, true);
          updatedMsg = { ...msg, content: msg.content + chunk.content, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === 'status') {
          blockBuilder.addStatus(chunk.content);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          blockBuilder.addToolCall(chunk.toolCall);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === 'usage' && chunk.usage) {
          updatedMsg = { ...msg, usage: chunk.usage };
        } else {
          updatedMsg = msg;
        }

        const newMessages = [...current];
        newMessages[msgIdx] = updatedMsg;
        set({ messages: newMessages });

        // 流式传输中实时防抖保存 blocks，避免用户提前切换会话时丢失
        if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
          debouncedSaveBlocks(sessionId, assistantId, updatedMsg.blocks);
        }
      }

      // 清除防抖定时器，确保最终 blocks 被保存
      if (_saveBlocksTimer) {
        clearTimeout(_saveBlocksTimer);
        _saveBlocksTimer = null;
      }
      await flushSaveBlocks();

      // 流结束，冻结所有块
      blockBuilder.freezeAll();
      const finalBlocks = blockBuilder.getBlocks();

      const finalMessages = get().messages;
      const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
      if (finalMsgIdx !== -1) {
        const newMessages = [...finalMessages];
        newMessages[finalMsgIdx] = { ...finalMessages[finalMsgIdx], blocks: finalBlocks };
        set({ messages: newMessages });

        // 将 blocks 结构保存到后端
        if (sessionId && finalBlocks.length > 0) {
          try {
            await chatService.updateMessageBlocks(sessionId, assistantId, finalBlocks as unknown as Array<Record<string, unknown>>);
          } catch (error) {
            console.warn('[chatStore] Failed to update message blocks:', error);
          }
        }
      }

      set({ isLoading: false, isStreaming: false });

      if (shouldAutoRename(sessionId)) {
        const finalMessages = get().messages;
        const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
        const assistantResponse = finalMsgIdx !== -1 ? finalMessages[finalMsgIdx].content : '';
        await doAutoRename(sessionId!, content, assistantResponse);
      }
    } catch (error) {
      set({ error: String(error), isLoading: false, isStreaming: false });
    }
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  /**
   * 加载历史消息时为 assistant 消息重建 blocks 结构
   * 确保 AssistantMessage 组件能正确分组渲染（text / tool_call 等）
   * 如果后端已保存 blocks，则直接使用，否则自动重建
   */
  setMessages: (messages: Message[]) => {
    const enhancedMessages = messages.map((msg) => {
      if (msg.role !== 'assistant') return msg;

      // 如果后端已保存 blocks，直接使用
      if (msg.blocks && msg.blocks.length > 0) {
        return { ...msg, blocks: msg.blocks.map((b) => ({ ...b, isStreaming: false })) };
      }

      // 否则自动重建 blocks
      const newBlocks: MessageBlock[] = [];

      if (msg.content) {
        newBlocks.push({
          id: generateBlockId(),
          type: 'text',
          content: msg.content,
          isStreaming: false,
        });
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        msg.tool_calls.forEach((tc) => {
          newBlocks.push({
            id: generateBlockId(),
            type: 'tool_call',
            content: '',
            toolCall: tc,
            isStreaming: false,
          });
        });
      }

      return { ...msg, blocks: newBlocks };
    });

    set({ messages: enhancedMessages });
  },
}));
