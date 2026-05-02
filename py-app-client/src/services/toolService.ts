import { invoke } from '@tauri-apps/api/core';
import { Tool } from '../types';

export const toolService = {
  list: (): Promise<Tool[]> => invoke<Tool[]>('list_tools'),

  execute: (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> =>
    invoke<unknown>('execute_tool', { toolName, args }),
};