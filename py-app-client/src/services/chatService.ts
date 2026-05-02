import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Message } from '../types';

export const chatService = {
  sendMessage: (
    content: string,
    sessionId?: string
  ): Promise<Message> =>
    invoke<Message>('send_message', { content, sessionId }),

  streamMessage: async function* (
    content: string,
    sessionId?: string
  ): AsyncGenerator<string, void, unknown> {
    await invoke('stream_message', { content, sessionId });

    await listen<{ chunk: string; index: number }>('stream-chunk', () => {
      return;
    });

    yield '';
  },
};