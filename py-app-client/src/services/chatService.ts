import type { Message } from '../types';

export interface BackendStatus {
  running: boolean;
  port: number | null;
}

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const chatService = {
  startBackend: async (): Promise<BackendStatus> => {
    try {
      await fetchJSON<{ status: string; service: string }>(`${API_BASE}/health`);
      return { running: true, port: 7890 };
    } catch {
      return { running: false, port: null };
    }
  },

  stopBackend: async (): Promise<void> => {
  },

  getBackendStatus: async (): Promise<BackendStatus> => {
    try {
      await fetchJSON<{ status: string; service: string }>(`${API_BASE}/health`);
      return { running: true, port: 7890 };
    } catch {
      return { running: false, port: null };
    }
  },

  setBackendUrl: async (_url: string): Promise<void> => {
  },

  sendMessage: async (content: string, sessionId?: string): Promise<Message> => {
    const response = await fetchJSON<{
      id: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
      }>;
    }>(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({
        model: 'pyapp-default',
        messages: [{ role: 'user', content }],
        max_tokens: 2000,
      }),
    });

    const choice = response.choices[0];
    return {
      id: response.id,
      role: choice.message.role as 'user' | 'assistant' | 'system',
      content: choice.message.content,
      timestamp: Date.now(),
      session_id: sessionId || 'default',
    };
  },

  streamMessage: async function* (content: string, _sessionId?: string): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'pyapp-default',
        messages: [{ role: 'user', content }],
        max_tokens: 2000,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            try {
              const chunk = JSON.parse(data);
              if (chunk.choices?.[0]?.delta?.content) {
                yield chunk.choices[0].delta.content;
              }
            } catch {
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
