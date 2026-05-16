import type { Tool } from '../types';

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

// 创建 mock tool service
function createMockToolService() {
  const mockTools: Tool[] = [
    { name: 'calculator', description: '简单计算器', enabled: true, read_only: false, destructive: false },
    { name: 'timer', description: '计时器', enabled: true, read_only: false, destructive: false },
    { name: 'weather', description: '天气查询', enabled: false, read_only: true, destructive: false },
  ];

  return {
    list: (): Promise<Tool[]> => {
      console.warn('Mock: toolService.list called');
      return Promise.resolve([...mockTools]);
    },
    execute: async (
      toolName: string,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      console.warn('Mock: toolService.execute called', { toolName, args });
      return Promise.resolve(`Mock result for ${toolName}`);
    },
  };
}

// 创建实际 Tauri tool service
function createTauriToolService() {
  return {
    list: async (): Promise<Tool[]> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockToolService().list();
      }
      return core.invoke<Tool[]>('list_tools');
    },
    execute: async (
      toolName: string,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockToolService().execute(toolName, args);
      }
      return core.invoke<unknown>('execute_tool', { toolName, args });
    },
  };
}

export const toolService = isTauri ? createTauriToolService() : createMockToolService();
