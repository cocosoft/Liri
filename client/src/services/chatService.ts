import type { Message, BackendStatus } from '../types';
import { getBackendBaseUrl, getBackendPort } from './backendUrl';

async function getTauriCore() {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!('__TAURI__' in window)) {
    return null;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    if (core && typeof core.invoke === 'function') {
      return core;
    }
    return null;
  } catch {
    return null;
  }
}

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

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollHealth(maxRetries = 10, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkHealth()) {
      return true;
    }
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

export const chatService = {
  startBackend: async (): Promise<BackendStatus> => {
    const core = await getTauriCore();
    if (core) {
      const status = await core.invoke<BackendStatus>('start_backend');
      const healthy = await pollHealth();
      return { ...status, running: healthy };
    }

    const healthy = await checkHealth();
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  stopBackend: async (): Promise<void> => {
    const core = await getTauriCore();
    if (core) {
      await core.invoke<void>('stop_backend');
      return;
    }
  },

  getBackendStatus: async (): Promise<BackendStatus> => {
    const core = await getTauriCore();
    if (core) {
      const status = await core.invoke<BackendStatus>('get_backend_status');
      if (status.running) {
        const healthy = await checkHealth();
        return { ...status, running: healthy };
      }
      return status;
    }

    const healthy = await checkHealth();
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  sendMessage: async (content: string, sessionId?: string): Promise<Message> => {
    const response = await fetchJSON<{
      id: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
      }>;
    }>(`${getBackendBaseUrl()}/v1/chat/completions`, {
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
    const response = await fetch(`${getBackendBaseUrl()}/v1/chat/completions`, {
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

  fetchModels: async (): Promise<Array<{ id: string; name: string; provider: string }>> => {
    try {
      const response = await fetchJSON<{ data: Array<{ id: string; owned_by?: string }> }>(`${getBackendBaseUrl()}/v1/models`);
      return response.data.map((m) => ({
        id: m.id,
        name: m.id,
        provider: m.owned_by || 'pyapp',
      }));
    } catch {
      return [];
    }
  },
};
