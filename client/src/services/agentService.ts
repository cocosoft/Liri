import type { AgentTask } from '../types';
import { http } from './httpClient';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

async function tryTauri<T>(method: string, args?: Record<string, unknown>): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch {
    return null;
  }
}

function createMemoryAgentService() {
  return {
    listTasks: async (): Promise<AgentTask[]> => [],
    executeTask: async (name: string, _params?: Record<string, unknown>): Promise<AgentTask> => ({
      id: `local-${Date.now()}`,
      name,
      status: 'completed',
      result: 'Agent execution unavailable',
      created_at: Date.now(),
    }),
    cancelTask: async (_id: string): Promise<void> => {},
  };
}

export const agentService = {
  listTasks: async (): Promise<AgentTask[]> => {
    try {
      return await http.get<AgentTask[]>('/v1/agents/tasks');
    } catch {
      const result = await tryTauri<AgentTask[]>('list_agent_tasks');
      if (result) return result;
      return createMemoryAgentService().listTasks();
    }
  },

  executeTask: async (name: string, params?: Record<string, unknown>): Promise<AgentTask> => {
    try {
      return await http.post<AgentTask>('/v1/agents/tasks', { name, ...params });
    } catch {
      const result = await tryTauri<AgentTask>('execute_agent_task', { name, params });
      if (result) return result;
      return createMemoryAgentService().executeTask(name, params);
    }
  },

  cancelTask: async (id: string): Promise<void> => {
    try {
      await http.post<void>(`/v1/agents/tasks/${id}/cancel`);
    } catch {
      const result = await tryTauri<void>('cancel_agent_task', { id });
      if (result !== null) return;
      return createMemoryAgentService().cancelTask(id);
    }
  },
};
