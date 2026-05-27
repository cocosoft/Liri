import type { AgentTask } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

function createFallbackAgentService() {
  return {
    listTasks: async (): Promise<AgentTask[]> => {
      return [];
    },
    executeTask: async (name: string, _params?: Record<string, unknown>): Promise<AgentTask> => {
      return {
        id: `local-${Date.now()}`,
        name,
        status: 'completed',
        result: 'Agent execution unavailable outside Tauri',
        created_at: Date.now(),
      };
    },
    cancelTask: async (_id: string): Promise<void> => {},
  };
}

function createTauriAgentService() {
  return {
    listTasks: async (): Promise<AgentTask[]> => {
      const core = await getTauriCore();
      if (!core) return createFallbackAgentService().listTasks();
      return core.invoke<AgentTask[]>('list_agent_tasks');
    },
    executeTask: async (name: string, params?: Record<string, unknown>): Promise<AgentTask> => {
      const core = await getTauriCore();
      if (!core) return createFallbackAgentService().executeTask(name, params);
      return core.invoke<AgentTask>('execute_agent_task', { name, params });
    },
    cancelTask: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) return createFallbackAgentService().cancelTask(id);
      return core.invoke<void>('cancel_agent_task', { id });
    },
  };
}

export const agentService = isTauri ? createTauriAgentService() : createFallbackAgentService();
