import { invoke } from '@tauri-apps/api/core';
import { Session } from '../types';

export const sessionService = {
  list: (): Promise<Session[]> => invoke<Session[]>('list_sessions'),

  create: (title: string): Promise<Session> =>
    invoke<Session>('create_session', { title }),

  switch: (id: string): Promise<void> =>
    invoke<void>('switch_session', { id }),

  delete: (id: string): Promise<void> =>
    invoke<void>('delete_session', { id }),

  getCurrent: (): Promise<Session | null> =>
    invoke<Session | null>('get_current_session'),
};