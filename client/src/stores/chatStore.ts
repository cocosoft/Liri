import { create } from 'zustand';
import { Message, MessageBlock } from '../types';
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

function shouldAutoRename(sessionId?: string): boolean {
  if (!sessionId) {
    console.log('[shouldAutoRename] sessionId is undefined');
    return false;
  }
  const session = useSessionStore.getState().currentSession;
  if (!session) {
    console.log('[shouldAutoRename] currentSession is null');
    return false;
  }
  if (session.id !== sessionId) {
    console.log('[shouldAutoRename] sessionId mismatch:', session.id, 'vs', sessionId);
    return false;
  }
  const title = session.title || '';
  const shouldRename = title.startsWith('新会话') || title.startsWith('New Session');
  console.log('[shouldAutoRename] title:', title, 'shouldRename:', shouldRename);
  return shouldRename;
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

function findOrCreateBlock(
  blocks: MessageBlock[],
  type: MessageBlock['type'],
  isStreaming: boolean
): { blocks: MessageBlock[]; block: MessageBlock } {
  let block = blocks.find((b) => b.type === type);
  if (!block) {
    block = {
      id: generateBlockId(),
      type,
      content: '',
      isStreaming,
    };
    blocks = [...blocks, block];
  }
  return { blocks, block };
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

      for await (const chunk of generator) {
        const current = get().messages;
        const msgIdx = current.findIndex((m) => m.id === assistantId);

        if (msgIdx === -1) continue;

        const msg = current[msgIdx];
        let updatedMsg: Message;

        if (chunk.type === 'text') {
          const { blocks, block } = findOrCreateBlock(msg.blocks || [], 'text', true);
          const newBlock: MessageBlock = { ...block, content: block.content + chunk.content, isStreaming: true };
          const newBlocks = blocks.map((b) => (b.id === block.id ? newBlock : b));
          updatedMsg = { ...msg, content: msg.content + chunk.content, blocks: newBlocks };
        } else if (chunk.type === 'thinking') {
          const { blocks, block } = findOrCreateBlock(msg.blocks || [], 'thinking', true);
          const newBlock: MessageBlock = { ...block, content: block.content + chunk.content, isStreaming: true };
          const newBlocks = blocks.map((b) => (b.id === block.id ? newBlock : b));
          updatedMsg = { ...msg, blocks: newBlocks };
        } else if (chunk.type === 'status') {
          console.log(`[chatStore] Received status chunk: "${chunk.content}"`);
          const blocks = msg.blocks || [];
          
          const hasSameStatus = blocks.some((b) => {
            if (b.type !== 'status') return false;
            return b.content === chunk.content;
          });
          
          console.log(`[chatStore] hasSameStatus: ${hasSameStatus}`);
          
          if (hasSameStatus) {
            updatedMsg = msg;
          } else {
            const logBlock: MessageBlock = {
              id: generateBlockId(),
              type: 'status',
              content: chunk.content,
              isStreaming: true,
            };
            updatedMsg = { ...msg, blocks: [...blocks, logBlock] };
          }
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          const tc = chunk.toolCall;
          const existingBlock = (msg.blocks || []).find(
            (b) => b.type === 'tool_call' && b.toolCall?.id === tc.id
          );
          if (existingBlock) {
            const updatedToolCall = { ...existingBlock, toolCall: { ...tc, status: tc.status || 'completed' as const } };
            const newBlocks = (msg.blocks || []).map((b) => (b.id === existingBlock.id ? updatedToolCall : b));
            updatedMsg = { ...msg, blocks: newBlocks };
          } else {
            const newBlock: MessageBlock = {
              id: generateBlockId(),
              type: 'tool_call',
              content: '',
              toolCall: tc,
              isStreaming: true,
            };
            const newBlocks = [...(msg.blocks || []), newBlock];
            updatedMsg = { ...msg, blocks: newBlocks };
          }
        } else if (chunk.type === 'usage' && chunk.usage) {
          updatedMsg = { ...msg, usage: chunk.usage };
        } else {
          updatedMsg = msg;
        }

        const newMessages = [...current];
        newMessages[msgIdx] = updatedMsg;
        set({ messages: newMessages });
      }

      const finalMessages = get().messages;
      const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
      if (finalMsgIdx !== -1) {
        const finalMsg = finalMessages[finalMsgIdx];
        const finalBlocks = (finalMsg.blocks || []).map((b) => ({
          ...b,
          isStreaming: false,
        }));
        const newMessages = [...finalMessages];
        newMessages[finalMsgIdx] = { ...finalMsg, blocks: finalBlocks };
        set({ messages: newMessages });
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

  setMessages: (messages: Message[]) => {
    set({ messages });
  },
}));
