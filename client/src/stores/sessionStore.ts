import { create } from 'zustand';
import { Session } from '../types';
import { sessionService } from '../services/sessionService';
import { useChatStore } from './chatStore';

interface SessionStore {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
  loadSessions: () => Promise<void>;
  createSession: (title: string) => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSession: null,
  isLoading: false,
  error: null,

  loadSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await sessionService.list();
      const currentSession = await sessionService.getCurrent();
      set({ sessions, currentSession, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  createSession: async (title: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await sessionService.create(title);
      set({
        sessions: [...get().sessions, session],
        currentSession: session,
        isLoading: false,
      });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  switchSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await sessionService.switch(id);
      const messages = await sessionService.getMessages(id);
      useChatStore.getState().setMessages(messages);
      set({ currentSession: session, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await sessionService.delete(id);
      const sessions = get().sessions.filter((s) => s.id !== id);
      const currentSession =
        get().currentSession?.id === id
          ? sessions[0] || null
          : get().currentSession;
      set({ sessions, currentSession, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  renameSession: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      await sessionService.rename(id, title);
      const sessions = get().sessions.map((s) =>
        s.id === id ? { ...s, title } : s
      );
      const current = get().currentSession;
      const updatedSession: Session | null =
        current?.id === id ? { ...current, title } : current;
      set({ sessions, currentSession: updatedSession, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },
}));
