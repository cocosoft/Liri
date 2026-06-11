import type { Message, BackendStatus, ToolCall } from "../types";
import { getBackendBaseUrl, getBackendPort, setApiSecret } from "./backendUrl";
import { useConfigStore } from "../stores/configStore";

function getModelFromConfig(): string {
  return (useConfigStore.getState().config.model as string) || "pyapp-default";
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "status" | "usage" | "done" | "error" | "question" | "todo";
  content: string;
  toolCall?: ToolCall;
  questionData?: QuestionData;
  todoData?: import("../types").TaskCardData;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

async function getTauriCore() {
  if (typeof window === "undefined") {
    return null;
  }
  if (!("__TAURI__" in window)) {
    return null;
  }
  try {
    const core = await import("@tauri-apps/api/core");
    if (core && typeof core.invoke === "function") {
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
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollHealth(
  maxRetries = 10,
  intervalMs = 1000,
): Promise<boolean> {
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
      const status = await core.invoke<BackendStatus>("start_backend");
      // 获取共享密钥，后续所有 HTTP 请求将自动携带
      try {
        const secret = await core.invoke<string | null>("get_backend_secret");
        if (secret) setApiSecret(secret);
      } catch {
        /* Tauri 旧版本不支持此命令时忽略 */
      }
      const healthy = await pollHealth();
      return { ...status, running: healthy };
    }

    const healthy = await checkHealth();
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  stopBackend: async (): Promise<void> => {
    const core = await getTauriCore();
    if (core) {
      await core.invoke<void>("stop_backend");
      return;
    }
  },

  getBackendStatus: async (): Promise<BackendStatus> => {
    const core = await getTauriCore();
    if (core) {
      const status = await core.invoke<BackendStatus>("get_backend_status");
      if (status.running) {
        const healthy = await checkHealth();
        return { ...status, running: healthy };
      }
      return status;
    }

    const healthy = await checkHealth();
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  sendMessage: async (
    content: string,
    sessionId?: string,
  ): Promise<Message & { pendingInteraction?: QuestionData }> => {
    const body: Record<string, unknown> = {
      model: getModelFromConfig(),
      messages: [{ role: "user", content }],
      max_tokens: 2000,
    };
    if (sessionId) body.session_id = sessionId;

    const response = await fetchJSON<
      {
        id: string;
        choices: Array<{
          message: { role: string; content: string };
          finish_reason: string;
        }>;
        pending_interaction?: QuestionData;
      } & Record<string, unknown>
    >(`${getBackendBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    // 检测是否返回了待处理的用户交互
    if (response.pending_interaction) {
      return {
        id: response.id,
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
        session_id: sessionId || "default",
        pendingInteraction: response.pending_interaction,
      };
    }

    const choice = response.choices[0];
    return {
      id: response.id,
      role: choice.message.role as "user" | "assistant" | "system",
      content: choice.message.content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
    };
  },

  streamMessage: async function* (
    content: string,
    sessionId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const body: Record<string, unknown> = {
      model: getModelFromConfig(),
      messages: [{ role: "user", content }],
      max_tokens: 2000,
      stream: true,
    };
    if (sessionId) body.session_id = sessionId;

    const response = await fetch(`${getBackendBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            try {
              const chunk = JSON.parse(data);

              const pyappType = chunk.__pyapp_type;
              if (pyappType === "thinking") {
                yield {
                  type: "thinking",
                  content: chunk.choices?.[0]?.delta?.content || "",
                };
              } else if (pyappType === "status") {
                yield {
                  type: "status",
                  content: chunk.choices?.[0]?.delta?.content || "",
                };
              } else if (pyappType === "error") {
                yield {
                  type: "error",
                  content: chunk.choices?.[0]?.delta?.content || "Unknown error",
                };
              } else if (pyappType === "tool_call") {
                const tc = chunk.choices?.[0]?.delta?.tool_calls?.[0];
                if (tc) {
                  const rawArgs = tc.function?.arguments;
                  let parsedArgs: Record<string, unknown> = {};
                  try {
                    parsedArgs =
                      typeof rawArgs === "string"
                        ? JSON.parse(rawArgs || "{}")
                        : rawArgs || {};
                  } catch {}
                  yield {
                    type: "tool_call",
                    content: "",
                    toolCall: {
                      id: tc.id,
                      name: tc.function?.name || "",
                      arguments: parsedArgs,
                      status: chunk.__pyapp_tool_status || "running",
                    },
                  };
                }
              } else if (pyappType === "usage" && chunk.usage) {
                yield {
                  type: "usage",
                  content: "",
                  usage: {
                    inputTokens: chunk.usage.prompt_tokens || 0,
                    outputTokens: chunk.usage.completion_tokens || 0,
                    totalTokens: chunk.usage.total_tokens || 0,
                    estimatedCostUsd: chunk.usage.estimated_cost_usd,
                    cacheReadTokens: chunk.usage.cache_read_input_tokens,
                    cacheCreationTokens:
                      chunk.usage.cache_creation_input_tokens,
                  },
                };
              } else if (pyappType === "question" && chunk.__pyapp_question) {
                yield {
                  type: "question",
                  content: "",
                  questionData: chunk.__pyapp_question,
                };
              } else if (chunk.choices?.[0]?.delta?.content) {
                yield {
                  type: "text",
                  content: chunk.choices[0].delta.content,
                };
              } else if (chunk.choices?.[0]?.finish_reason === "error") {
                yield {
                  type: "error",
                  content: "AI 服务返回错误，请检查 API 密钥和模型配置",
                };
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        yield { type: "error", content: "请求已取消" };
        return;
      }
    } finally {
      reader.releaseLock();
    }
  },

  fetchModels: async (): Promise<
    Array<{ id: string; name: string; provider: string }>
  > => {
    try {
      const response = await fetchJSON<{
        data: Array<{ id: string; owned_by?: string }>;
      }>(`${getBackendBaseUrl()}/v1/models`);
      return response.data.map((m) => ({
        id: m.id,
        name: m.id,
        provider: m.owned_by || "pyapp",
      }));
    } catch {
      return [];
    }
  },

  updateMessageBlocks: async (
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
  ): Promise<void> => {
    await fetchJSON<void>(
      `${getBackendBaseUrl()}/api/session/${sessionId}/message/${messageId}/blocks`,
      {
        method: "PUT",
        body: JSON.stringify({ blocks }),
      },
    );
  },

  submitQuestionAnswer: async (
    questionId: string,
    answers: string[],
    sessionId?: string,
  ): Promise<{ success: boolean; content?: string }> => {
    try {
      const response = await fetchJSON<{ success: boolean; content?: string }>(
        `${getBackendBaseUrl()}/v1/chat/question-answer`,
        {
          method: "POST",
          body: JSON.stringify({ questionId, answers, sessionId }),
        },
      );
      return response;
    } catch {
      return { success: false };
    }
  },
};
