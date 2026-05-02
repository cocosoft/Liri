import { invoke } from '@tauri-apps/api/core';

export const configService = {
  get: (key: string): Promise<unknown> =>
    invoke<unknown>('get_config', { key }),

  set: (key: string, value: unknown): Promise<void> =>
    invoke<void>('set_config', { key, value }),

  list: (): Promise<Record<string, unknown>> =>
    invoke<Record<string, unknown>>('list_config'),
};