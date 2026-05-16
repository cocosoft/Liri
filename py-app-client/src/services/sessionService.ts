import type { Session } from '../types';

// 检查是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// 安全导入 Tauri API
async function getTauriCore() {
  if (!isTauri) {
    return null;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    return core;
  } catch (e) {
    console.error('Failed to load Tauri core:', e);
    return null;
  }
}

// 创建 mock session service
function createMockSessionService() {
  const mockSessions: Session[] = [
    { id: 'mock-1', title: '第一个会话', created_at: Date.now() - 86400000, last_modified_at: Date.now() - 86400000, message_count: 5 },
    { id: 'mock-2', title: '第二个会话', created_at: Date.now() - 3600000, last_modified_at: Date.now() - 3600000, message_count: 3 },
  ];
  let currentSessionId: string | null = mockSessions[0].id;

  return {
    list: (): Promise<Session[]> => {
      console.warn('Mock: sessionService.list called');
      return Promise.resolve([...mockSessions]);
    },
    create: (title: string): Promise<Session> => {
      console.warn('Mock: sessionService.create called');
      const newSession: Session = {
        id: 'mock-' + Date.now(),
        title,
        created_at: Date.now(),
        last_modified_at: Date.now(),
        message_count: 0,
      };
      mockSessions.push(newSession);
      currentSessionId = newSession.id;
      return Promise.resolve(newSession);
    },
    switch: (id: string): Promise<void> => {
      console.warn('Mock: sessionService.switch called');
      currentSessionId = id;
      return Promise.resolve();
    },
    delete: (id: string): Promise<void> => {
      console.warn('Mock: sessionService.delete called');
      const index = mockSessions.findIndex(s => s.id === id);
      if (index > -1) {
        mockSessions.splice(index, 1);
        if (currentSessionId === id && mockSessions.length > 0) {
          currentSessionId = mockSessions[0].id;
        } else if (mockSessions.length === 0) {
          currentSessionId = null;
        }
      }
      return Promise.resolve();
    },
    getCurrent: (): Promise<Session | null> => {
      console.warn('Mock: sessionService.getCurrent called');
      if (!currentSessionId) return Promise.resolve(null);
      return Promise.resolve(mockSessions.find(s => s.id === currentSessionId) || null);
    },
  };
}

// 创建实际 Tauri session service
function createTauriSessionService() {
  return {
    list: async (): Promise<Session[]> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockSessionService().list();
      }
      return core.invoke<Session[]>('list_sessions');
    },
    create: async (title: string): Promise<Session> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockSessionService().create(title);
      }
      return core.invoke<Session>('create_session', { title });
    },
    switch: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockSessionService().switch(id);
      }
      return core.invoke<void>('switch_session', { id });
    },
    delete: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockSessionService().delete(id);
      }
      return core.invoke<void>('delete_session', { id });
    },
    getCurrent: async (): Promise<Session | null> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockSessionService().getCurrent();
      }
      return core.invoke<Session | null>('get_current_session');
    },
  };
}

export const sessionService = isTauri ? createTauriSessionService() : createMockSessionService();
