import type { Message, BackendStatus, ToolCall, AttachedImage } from "../types";
import { getBackendBaseUrl, getBackendPort, setApiSecret } from "./backendUrl";
import { useModelSwitchStore } from "../stores/modelSwitchStore";
import { createLogger } from "../utils/logger";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

const logger = createLogger("chatService");

/** 哨兵值：同步自 app/src/constants/common.ts 的 DEFAULT_MODEL_SENTINEL */
const DEFAULT_MODEL_SENTINEL = "pyapp-default";

/**
 * 获取当前选择的模型名。
 * modelSwitchStore 为唯一事实源（状态栏/侧边栏切换的模型）。
 * 未选择时返回哨兵值，由后端 SmartRouter 自动决策。
 */
function getModelFromConfig(): string {
  return (
    useModelSwitchStore.getState().currentModelName || DEFAULT_MODEL_SENTINEL
  );
}

/**
 * 获取当前工作空间路径，用于注入工具执行默认 cwd
 */
async function getWorkspacePath(): Promise<string | undefined> {
  try {
    const { useSessionStore } = await import("../stores/sessionStore");
    return useSessionStore.getState().currentSession?.workspacePath;
  } catch (e) {
    handleClientError(e, {
      module: "services:chat",
      action: "getWorkspacePath",
    });
    return undefined;
  }
}

/**
 * 发消息前检查会话绑定的模型与后端当前模型是否一致
 * 不一致时先同步模型，确保消息发送使用正确的模型
 */
async function ensureSessionModelSync(sessionId?: string): Promise<void> {
  if (!sessionId) return;
  try {
    const { useSessionStore } = await import("../stores/sessionStore");
    const session = useSessionStore.getState().currentSession;
    if (!session?.modelId) return; // 会话未绑定模型，使用全局默认

    const { modelSwitchService } = await import("./modelSwitchService");
    const current = await modelSwitchService.getCurrent();
    // 用 UUID 比较（current.modelId 是模型名，session.modelId 是 UUID）
    if (current.modelUuid && current.modelUuid !== session.modelId) {
      await modelSwitchService.switch(session.modelId);
    }
  } catch (e) {
    handleClientError(e, {
      module: "services:chat",
      action: "ensureSessionModelSync",
    });
    // 模型同步失败不阻断消息发送，使用当前模型
  }
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
  type:
    | "text"
    | "thinking"
    | "tool_call"
    | "status"
    | "usage"
    | "done"
    | "error"
    | "question"
    | "todo"
    | "execution_phase"
    | "progress"
    | "deliverable"
    | "diff"
    | "context_state"
    | "tool_completed"
    | "reconnect_status"; // P2-2: 重连状态提示
  content: string;
  toolCall?: ToolCall;
  questionData?: QuestionData;
  todoData?: import("../types").TaskCardData;
  executionPhase?: {
    phase: string;
    progress: number;
    description: string;
    steps?: { name: string; status: string }[];
    currentStep?: string;
  };
  progressData?: import("../types").ProgressData;
  deliverableData?: import("../types").DeliverableData;
  diffData?: import("../types").DiffData;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  /** 来自后端的终止原因（'stop' | 'length' | 'error'），仅 usage 或 done 类型时存在 */
  finishReason?: string;
  /** tool_completed 事件携带的 tool_call_id，用于匹配前端 blocks 中的 tool call */
  tool_call_id?: string;
  /** tool_completed 事件携带的工具名 */
  tool_name?: string;
  /** tool_completed 事件携带的结构化 result data（如 image_generate 的 images 数组） */
  result_data?: Record<string, unknown>;
  /** context_state 事件携带的结构化水位数据（替代前端正则解析） */
  watermarkState?: {
    currentTokens: number;
    contextLimit: number;
    ratio: number;
    severity: "normal" | "warn" | "compact";
  };
}

async function getTauriCore() {
  if (typeof window === "undefined") {
    return null;
  }
  if (!("__TAURI__" in window) && !("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  try {
    const core = await import("@tauri-apps/api/core");
    if (core && typeof core.invoke === "function") {
      return core;
    }
    return null;
  } catch (e) {
    handleClientError(e, { module: "services:chat", action: "getTauriCore" });
    // 非 Tauri 环境（浏览器运行）时无需警告
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
  } catch (e) {
    handleClientError(e, { module: "services:chat", action: "checkHealth" });
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
      } catch (e) {
        handleClientError(e, {
          module: "services:chat",
          action: "startBackend-getSecret",
        });
        /* Tauri 旧版本不支持此命令时忽略 */
      }
      const healthy = await pollHealth();
      // 健康检查失败时，查询进程是否已崩溃（获取退出码和 stderr）
      if (!healthy) {
        const updatedStatus =
          await core.invoke<BackendStatus>("get_backend_status");
        return updatedStatus;
      }
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

  sendMessage: (
    content: string,
    sessionId?: string,
    images?: AttachedImage[],
  ): Promise<Message & { pendingInteraction?: QuestionData }> => {
    return getOTelTracing().asyncWrap("services:chat:sendMessage", async () => {
      // 发消息前确保会话绑定的模型与后端一致
      await ensureSessionModelSync(sessionId);

      // 获取当前工作空间路径，注入工具默认 cwd
      const workspacePath = await getWorkspacePath();

      const body: Record<string, unknown> = {
        model: getModelFromConfig(),
        messages: [{ role: "user", content }],
        max_tokens: 4096,
      };
      if (sessionId) body.session_id = sessionId;
      if (workspacePath) body.workspace_path = workspacePath;
      if (images && images.length > 0) body.images = images;

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

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error("AI 服务返回了空的 choices 列表");
      }
      return {
        id: response.id,
        role: choice.message.role as "user" | "assistant" | "system",
        content: choice.message.content,
        timestamp: Date.now(),
        session_id: sessionId || "default",
      };
    });
  },

  streamMessage: async function* (
    content: string,
    sessionId?: string,
    signal?: AbortSignal,
    options?: { workMode?: "plan" | "do"; images?: AttachedImage[] },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const otel = getOTelTracing();
    const span = otel.startSpan("services:chat:streamMessage");
    try {
      // 发消息前确保会话绑定的模型与后端一致
      await ensureSessionModelSync(sessionId);

      // 获取当前工作空间路径，注入工具默认 cwd
      const workspacePath = await getWorkspacePath();

      const body: Record<string, unknown> = {
        model: getModelFromConfig(),
        messages: [{ role: "user", content }],
        max_tokens: 8192,
        stream: true,
      };
      if (sessionId) body.session_id = sessionId;
      if (workspacePath) body.workspace_path = workspacePath;
      if (options?.workMode) body.work_mode = options.workMode;
      if (options?.images && options.images.length > 0)
        body.images = options.images;

      const response = await fetch(
        `${getBackendBaseUrl()}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        },
      );

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
        let parseFailCount = 0;
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
                } else if (pyappType === "context_state") {
                  yield {
                    type: "context_state",
                    content: chunk.choices?.[0]?.delta?.content || "",
                    watermarkState: (chunk as Record<string, unknown>)
                      .watermarkState as
                      | {
                          currentTokens: number;
                          contextLimit: number;
                          ratio: number;
                          severity: "normal" | "warn" | "compact";
                        }
                      | undefined,
                  };
                } else if (pyappType === "tool_completed") {
                  // 生图完成事件 → 通知图库刷新 + 传递结构化数据给 chatStore 渲染
                  logger.debug("tool_completed SSE", {
                    tool_name: chunk.tool_name,
                    tool_call_id: (chunk as Record<string, unknown>)
                      .tool_call_id,
                    hasResultData: !!(chunk as Record<string, unknown>)
                      .result_data,
                    resultDataKeys: (chunk as Record<string, unknown>)
                      .result_data
                      ? Object.keys(
                          (chunk as Record<string, unknown>)
                            .result_data as Record<string, unknown>,
                        )
                      : "N/A",
                  });
                  if (chunk.tool_name === "image_generate") {
                    window.dispatchEvent(
                      new CustomEvent("pyapp:image_generated", {
                        detail: { images: chunk.images },
                      }),
                    );
                  }
                  yield {
                    type: "tool_completed",
                    content: "",
                    tool_call_id: (chunk as Record<string, unknown>)
                      .tool_call_id as string,
                    tool_name: (chunk as Record<string, unknown>)
                      .tool_name as string,
                    result_data: (chunk as Record<string, unknown>)
                      .result_data as Record<string, unknown>,
                  };
                } else if (pyappType === "error") {
                  yield {
                    type: "error",
                    content:
                      chunk.choices?.[0]?.delta?.content || "Unknown error",
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
                    } catch (e) {
                      handleClientError(e, {
                        module: "services:chat",
                        action: "streamMessage-parseArgs",
                      });
                      // JSON 解析失败使用空对象，不阻塞流
                    }
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
                    finishReason:
                      chunk.choices?.[0]?.finish_reason || undefined,
                  };
                } else if (chunk.choices?.[0]?.finish_reason === "error") {
                  // error 必须在通用 finish_reason 之前检测，否则被通用分支拦截
                  yield {
                    type: "error",
                    content: "AI 服务返回错误，请检查 API 密钥和模型配置",
                  };
                } else if (chunk.choices?.[0]?.finish_reason) {
                  // 无 usage 时的独立 finish_reason 信号（修复 BUG #10）
                  yield {
                    type: "usage",
                    content: "",
                    finishReason: chunk.choices[0].finish_reason, // guarded by above ?
                  };
                } else if (pyappType === "question" && chunk.__pyapp_question) {
                  logger.debug("解析到 question chunk", {
                    questionId: chunk.__pyapp_question.questionId,
                    question: chunk.__pyapp_question.question?.slice(0, 40),
                    options: chunk.__pyapp_question.options?.length,
                  });
                  yield {
                    type: "question",
                    content: "",
                    questionData: chunk.__pyapp_question,
                  };
                } else if (pyappType === "todo" && chunk.__pyapp_todo) {
                  yield {
                    type: "todo",
                    content: "",
                    todoData: chunk.__pyapp_todo,
                  };
                } else if (chunk.choices?.[0]?.delta?.content) {
                  yield {
                    type: "text",
                    content: chunk.choices[0].delta.content,
                  };
                }
              } catch (e) {
                parseFailCount++;
                handleClientError(e, {
                  module: "services:chat",
                  action: "streamMessage-parseChunk",
                });
                // 连续 5 次解析失败时向前端报告（低于阈值静默跳过）
                if (parseFailCount >= 5) {
                  yield {
                    type: "error",
                    content: "SSE 数据流解析异常，部分内容可能丢失",
                  };
                  parseFailCount = 0; // 重置以免重复报告
                }
              }
            }
          }
        }
      } catch (e) {
        handleClientError(e, {
          module: "services:chat",
          action: "streamMessage-readerLoop",
        });
        if (e instanceof DOMException && e.name === "AbortError") {
          yield { type: "error", content: "请求已取消" };
          return;
        }
        // TODO: CS02-ROOTFIX — 浏览器网络错误无结构化错误码，
        // 后端 SSE 断开时应发送带 errorCode 的 error 事件，前端据此判断。
        // 处理连接意外关闭的情况
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (
          errorMessage.includes("socket connection was closed unexpectedly") ||
          errorMessage.includes("ERR_CONNECTION_RESET") ||
          errorMessage.includes("net::ERR_INCOMPLETE_CHUNKED_ENCODING")
        ) {
          yield { type: "error", content: "连接已断开，请重试" };
          return;
        }
        // 其他网络错误
        yield { type: "error", content: `网络错误: ${errorMessage}` };
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      handleClientError(e, {
        module: "services:chat",
        action: "streamMessage-outer",
      });
      otel.recordError(span, e);
      throw e;
    } finally {
      otel.endSpan(span);
    }
  },

  /**
   * P2-2: 带自动重连的流式消息发送
   * 包装 streamMessage，断开时自动从检查点恢复，最多重试 3 次。
   */
  streamMessageWithReconnect: async function* (
    content: string,
    sessionId: string,
    signal?: AbortSignal,
    options?: { workMode?: "plan" | "do"; images?: AttachedImage[] },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    let checkpointId: string | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      // 恢复路径：直接 fetch resume 端点
      if (checkpointId) {
        try {
          const resumeResp = await fetch(
            `${getBackendBaseUrl()}/v1/sessions/${sessionId}/resume`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_id: sessionId,
                checkpoint_id: checkpointId,
              }),
              signal,
            },
          );
          if (!resumeResp.ok)
            throw new Error(`Resume HTTP ${resumeResp.status}`);
          if (!resumeResp.body) throw new Error("No resume response body");

          // 复用内联 SSE 解析逻辑（与 streamMessage 一致）
          const reader = resumeResp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") return;
                try {
                  const chunk = JSON.parse(data);
                  // 简单类型识别（与 streamMessage 内联逻辑一致）
                  const pyappType = chunk.__pyapp_type;
                  if (
                    pyappType === "text" &&
                    chunk.choices?.[0]?.delta?.content
                  ) {
                    yield {
                      type: "text",
                      content: chunk.choices[0].delta.content,
                    } as StreamChunk;
                  } else if (pyappType === "error") {
                    yield {
                      type: "error",
                      content: chunk.content || "",
                    } as StreamChunk;
                  } else if (pyappType === "status" || chunk.content) {
                    yield {
                      type: "status",
                      content: chunk.content || "",
                    } as StreamChunk;
                  }
                } catch {
                  /* skip malformed */
                }
              }
            }
          }
          return; // 恢复成功，正常结束
        } catch (err: unknown) {
          const e = err as Error & { name?: string };
          if (e.name === "AbortError") return;
          // 恢复失败 → 进入重试逻辑
        }
      } else {
        // 正常路径：委托现有 streamMessage
        try {
          yield* chatService.streamMessage(content, sessionId, signal, options);
          return; // 正常结束
        } catch (err: unknown) {
          const e = err as Error & { name?: string };
          if (e.name === "AbortError") return;
          // streamMessage 本身已 yield error chunk，此处进入重试
        }
      }

      // 重试逻辑
      retryCount++;
      if (retryCount > maxRetries) {
        yield { type: "error", content: "重连失败，请手动重试" } as StreamChunk;
        return;
      }

      // 获取最新检查点
      try {
        const cpResp = await fetch(
          `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
          { signal: AbortSignal.timeout(5000) },
        );
        const cpData = (await cpResp.json()) as {
          checkpointAvailable?: boolean;
          checkpointId?: string;
          stepIndex?: number;
        };
        if (cpData.checkpointAvailable && cpData.checkpointId) {
          checkpointId = cpData.checkpointId;
          yield {
            type: "reconnect_status",
            content: `连接已断开，正在从第 ${cpData.stepIndex ?? "?"} 步恢复...`,
          } as StreamChunk;
          const delay = Math.min(1000 * 2 ** (retryCount - 1), 30000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      } catch {
        // 检查点查询失败
      }

      yield {
        type: "error",
        content: "连接已断开，且无可用检查点",
      } as StreamChunk;
      return;
    }
  },

  fetchModels: (): Promise<
    Array<{ id: string; name: string; provider: string }>
  > => {
    return getOTelTracing().asyncWrap("services:chat:fetchModels", async () => {
      try {
        const response = await fetchJSON<{
          data: Array<{ id: string; owned_by?: string }>;
        }>(`${getBackendBaseUrl()}/v1/models`);
        return response.data.map((m) => ({
          id: m.id,
          name: m.id,
          provider: m.owned_by || "pyapp",
        }));
      } catch (e) {
        handleClientError(e, {
          module: "services:chat",
          action: "fetchModels",
        });
        return [];
      }
    });
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

  submitQuestionAnswer: (
    questionId: string,
    answers: string[],
    sessionId?: string,
  ): Promise<{ success: boolean; content?: string }> => {
    return getOTelTracing().asyncWrap(
      "services:chat:submitQuestionAnswer",
      async () => {
        try {
          const response = await fetchJSON<{
            success: boolean;
            content?: string;
          }>(`${getBackendBaseUrl()}/v1/chat/question-answer`, {
            method: "POST",
            body: JSON.stringify({ questionId, answers, sessionId }),
          });
          return response;
        } catch (err) {
          handleClientError(err, {
            module: "services:chat",
            action: "submitQuestionAnswer",
          });
          logger.warn("提交回答失败", err);
          return { success: false };
        }
      },
    );
  },

  /** Phase 3: Steering API — 在任务执行中注入指导消息 */
  steerSession: async (
    sessionId: string,
    message: string,
  ): Promise<{ queued: boolean }> => {
    return getOTelTracing().asyncWrap(
      "services:chat:steerSession",
      async () => {
        return fetchJSON<{ queued: boolean }>(
          `${getBackendBaseUrl()}/v1/sessions/${sessionId}/steer`,
          {
            method: "POST",
            body: JSON.stringify({ message }),
          },
        );
      },
    );
  },
};
