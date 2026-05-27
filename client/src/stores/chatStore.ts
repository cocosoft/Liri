import { create } from 'zustand';
import { Message } from '../types';
import { chatService } from '../services/chatService';

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

    set({ messages: [...get().messages, userMessage] });

    try {
      const assistantId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        session_id: sessionId || 'default',
      };

      set({ messages: [...get().messages, assistantMessage] });

      const generator = chatService.streamMessage(content, sessionId);

      for await (const chunk of generator) {
        const current = get().messages;
        set({
          messages: current.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + chunk }
              : m
          ),
        });
      }

      set({ isLoading: false, isStreaming: false });
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