import type { Tool } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) {
    return null;
  }
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

function createFallbackToolService() {
  return {
    list: async (): Promise<Tool[]> => {
      return [];
    },
    execute: async (
      _toolName: string,
      _args: Record<string, unknown>
    ): Promise<unknown> => {
      return 'Fallback: tool execution unavailable';
    },
  };
}

function createTauriToolService() {
  return {
    list: async (): Promise<Tool[]> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackToolService().list();
      }
      return core.invoke<Tool[]>('list_tools');
    },
    execute: async (
      toolName: string,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackToolService().execute(toolName, args);
      }
      return core.invoke<unknown>('execute_tool', { toolName, args });
    },
  };
}

export const toolService = isTauri ? createTauriToolService() : createFallbackToolService();
