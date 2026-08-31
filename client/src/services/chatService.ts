import type { Message, BackendStatus, ToolCall, AttachedImage } from "../types";
import { getBackendBaseUrl, getBackendPort, getApiSecret } from "./backendUrl";
import { useModelSwitchStore } from "../stores/modelSwitchStore";
import { useConfigStore } from "../stores/configStore";
import { createLogger } from "../utils/logger";
import { handleClientError } from "../utils/handleError";
import { friendlyErrorSummary } from "../utils/friendlyError";
import {
  readWithIdleTimeout,
  STREAM_IDLE_TIMEOUT_MS,
  FIRST_CHUNK_TIMEOUT_MS,
} from "../utils/readWithIdleTimeout";
import { getOTelTracing } from "../monitoring/otel";
import { staleSessionCache } from "../stores/chat/chat-history.slice";
import { registerResumeWaiter } from "./streamPause";

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
      // 方案六 P2-3：切换前校验目标模型已注册，不存在则跳过（回退当前/全局默认），
      // 避免会话绑定已移除/未启用模型时每次发消息都报"模型不存在"
      try {
        const { modelService } = await import("./modelService");
        const models = await modelService.list();
        const target = models.find(
          (m) => m.id === session.modelId || m.modelId === session.modelId,
        );
        if (!target) return;
      } catch {
        // 校验接口失败按原逻辑尝试切换
      }
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
    | "reconnect_status" // P2-2: 重连状态提示
    | "paused" // 阶段2: 断连挂起（重试耗尽，等待后端恢复后续传）
    | "doc_workflow";
  content: string;
  toolCall?: ToolCall;
  questionData?: QuestionData;
  todoData?: import("../types").TaskCardData;
  /** P1-7（2026-08-23）：text/thinking chunk 携带归属 assistant 消息 id（后端 SSE 透传） */
  messageId?: string;
  executionPhase?: {
    phase: string;
    progress: number;
    description: string;
    steps?: { name: string; status: string }[];
    totalSteps?: number;
    truncated?: boolean;
    currentStep?: string;
  };
  progressData?: import("../types").ProgressData;
  deliverableData?: import("../types").DeliverableData;
  diffData?: import("../types").DiffData;
  docWorkflowData?: import("../types").DocWorkflowProgressData;
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
  /** tool_completed / status（工具状态块）事件携带的 tool_call_id，用于匹配前端 blocks 中的 tool call */
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
  /** 状态子类型 — SSE 协议增强字段 (CS02)，替代前端字符串匹配 */
  statusType?:
    | "ai_thinking"
    | "retry"
    | "task_all_done"
    | "resume"
    | "tool_retry"
    | "compaction";
  /** 压缩状态阶段（仅 statusType='compaction' 时存在）：compacting=进行中 / done=完成 */
  phase?: "compacting" | "done";
  /** 结构化错误码 — SSE 协议增强字段 (CS02)，替代前端字符串匹配 */
  errorCode?:
    | "UNKNOWN"
    | "RATE_LIMITED"
    | "AUTH_ERROR"
    | "QUOTA_EXCEEDED"
    | "CONNECTION_RESET"
    | "BACKEND_UNREACHABLE"
    | "PROXY_ERROR"
    | "TIMEOUT";
  /** 后端注入的前端导航/提示元数据（如 create_project 后建议跳转） */
  _meta?: Record<string, unknown>;
}

/**
 * P2-1: 共享 SSE chunk 解析 —— 流式主链路与断线 resume 路径共用。
 * 修复前 resume 只识别 text/error/status，恢复后 thinking/tool_call/question 等决策块丢失。
 * 纯解析无副作用（tool_completed 的 window.dispatchEvent 等副作用仍由主链路处理）。
 */
function parseSseChunk(chunk: Record<string, unknown>): StreamChunk | null {
  const pyappType = chunk.__pyapp_type as string | undefined;
  const choices = chunk.choices as
    | Array<{
        delta?: Record<string, unknown>;
        finish_reason?: string;
      }>
    | undefined;
  const delta = choices?.[0]?.delta;
  const deltaContent = (delta?.content as string) || "";

  if (pyappType === "thinking") {
    return {
      type: "thinking",
      content: deltaContent,
      messageId: (chunk.__pyapp_message_id as string) || undefined,
    };
  }
  if (pyappType === "status") {
    return {
      type: "status",
      content: deltaContent,
      statusType:
        (chunk.__pyapp_status_type as StreamChunk["statusType"]) || undefined,
      phase: (chunk.__pyapp_phase as StreamChunk["phase"]) || undefined,
      tool_call_id: (chunk.__pyapp_tool_call_id as string) || undefined,
    };
  }
  if (pyappType === "context_state") {
    return {
      type: "context_state",
      content: deltaContent,
      watermarkState: chunk.watermarkState as StreamChunk["watermarkState"],
    };
  }
  if (pyappType === "tool_completed") {
    return {
      type: "tool_completed",
      content: "",
      tool_call_id: chunk.tool_call_id as string,
      tool_name: chunk.tool_name as string,
      result_data: chunk.result_data as Record<string, unknown>,
    };
  }
  if (pyappType === "error") {
    return {
      type: "error",
      content: deltaContent || "Unknown error",
      errorCode:
        (chunk.__pyapp_error_code as StreamChunk["errorCode"]) || "UNKNOWN",
    };
  }
  if (pyappType === "tool_call") {
    const tc = (
      delta?.tool_calls as
        | Array<{
            id?: string;
            function?: { name?: string; arguments?: unknown };
          }>
        | undefined
    )?.[0];
    if (tc) {
      const rawArgs = tc.function?.arguments;
      let parsedArgs: Record<string, unknown> = {};
      if (typeof rawArgs === "string") {
        try {
          parsedArgs = JSON.parse(rawArgs || "{}");
        } catch {
          parsedArgs = {};
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        parsedArgs = rawArgs as Record<string, unknown>;
      }
      return {
        type: "tool_call",
        content: "",
        toolCall: {
          id: tc.id || "",
          name: tc.function?.name || "",
          arguments: parsedArgs,
          status:
            (chunk.__pyapp_tool_status as "running" | "completed" | "failed") ||
            "running",
        },
        _meta: chunk.__pyapp_meta as Record<string, unknown> | undefined,
      };
    }
  }
  if (pyappType === "usage" && chunk.usage) {
    const u = chunk.usage as Record<string, unknown>;
    return {
      type: "usage",
      content: "",
      usage: {
        inputTokens: (u.prompt_tokens as number) || 0,
        outputTokens: (u.completion_tokens as number) || 0,
        totalTokens: (u.total_tokens as number) || 0,
        estimatedCostUsd: u.estimated_cost_usd as number | undefined,
        cacheReadTokens: u.cache_read_input_tokens as number | undefined,
        cacheCreationTokens: u.cache_creation_input_tokens as
          number | undefined,
      },
      finishReason: choices?.[0]?.finish_reason || undefined,
      _meta: chunk.__pyapp_meta as Record<string, unknown> | undefined,
    };
  }
  if (choices?.[0]?.finish_reason === "error") {
    return {
      type: "error",
      content: "AI 服务返回错误，请检查 API 密钥和模型配置",
    };
  }
  if (choices?.[0]?.finish_reason) {
    return {
      type: "usage",
      content: "",
      finishReason: choices[0].finish_reason,
      _meta: chunk.__pyapp_meta as Record<string, unknown> | undefined,
    };
  }
  if (pyappType === "question" && chunk.__pyapp_question) {
    return {
      type: "question",
      content: "",
      questionData: chunk.__pyapp_question as QuestionData,
    };
  }
  if (pyappType === "todo" && chunk.__pyapp_todo) {
    return {
      type: "todo",
      content: "",
      todoData: chunk.__pyapp_todo as import("../types").TaskCardData,
    };
  }
  // AB-9 修复：execution_phase 心跳此前无解析分支，工具执行进度全链路丢失。
  // 后端经 __pyapp_execution_phase 结构化转发，此处还原为 StreamChunk 交给 processChunk。
  if (pyappType === "execution_phase" && chunk.__pyapp_execution_phase) {
    return {
      type: "execution_phase",
      content: deltaContent || "",
      executionPhase:
        chunk.__pyapp_execution_phase as StreamChunk["executionPhase"],
    };
  }
  if (pyappType === "doc_workflow" && chunk.__pyapp_doc_workflow) {
    return {
      type: "doc_workflow",
      content: deltaContent || "",
      docWorkflowData:
        chunk.__pyapp_doc_workflow as StreamChunk["docWorkflowData"],
    };
  }
  if (deltaContent) {
    return {
      type: "text",
      content: deltaContent,
      messageId: (chunk.__pyapp_message_id as string) || undefined,
    };
  }
  return null;
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

/**
 * 构建带鉴权的请求头（与 httpClient.buildHeaders 对齐）：
 * 启用 LIRI_API_SECRET 时注入 X-API-Key，登录态注入 Bearer token。
 * 裸 fetch 统一走此函数，避免配置 API Secret 后全部 401（P2 修复）。
 * 导出供 connectionMonitor/sseService 等裸 fetch 复用（BUG-2/BUG-4 修复）。
 */
export function buildAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  const secret = getApiSecret();
  if (secret) {
    headers["X-API-Key"] = secret;
  }
  if (typeof localStorage !== "undefined") {
    const authToken = localStorage.getItem("liri-auth-token");
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
  }
  return headers;
}

/** 断线重连专用异常：streamMessage 在可恢复错误（CONNECTION_RESET）时向外抛出，
 * streamMessageWithReconnect 捕获后进入检查点重试（修复 P0 自动重连死代码）。 */
export class StreamConnectionError extends Error {
  constructor(
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "StreamConnectionError";
  }
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(
      options?.headers as Record<string, string> | undefined,
    ),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    // 附加 HTTP 状态码：调用方按 statusCode 做业务判断（如 404 = 交互已失效），
    // 对齐 sessionService.switch 的既有模式，避免字符串匹配状态
    const httpError = new Error(error.message || `HTTP ${response.status}`);
    (httpError as { statusCode?: number }).statusCode = response.status;
    throw httpError;
  }

  return response.json();
}

async function checkHealth(): Promise<boolean> {
  try {
    // W6 闭环（2026-08-31）：健康检查改走统一 http 客户端——Tauri 下经 Rust
    // http_proxy 注入 X-API-Key（JS 无密钥），浏览器直连（后端默认不鉴权）。
    const { http } = await import("./httpClient");
    const res = await http.get<unknown>("/health");
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
    const healthy = await checkHealth();
    if (healthy) {
      if (i > 0) {
        logger.info(
          `[pollHealth] 第 ${i + 1}/${maxRetries} 次探测成功（此前失败 ${i} 次）`,
        );
      }
      return true;
    }
    logger.warn(`[pollHealth] 健康检查失败（${i + 1}/${maxRetries}）`);
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  logger.error(`[pollHealth] ${maxRetries} 次重试后后端仍未就绪`);
  return false;
}

// ── 写前持久化 outbox（根因 B：断网消息暂存与恢复补发）─────────────
const CHAT_OUTBOX_KEY = "liri-chat-outbox-v1";

interface ChatOutboxEntry {
  id: string;
  sessionId: string;
  message: {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    session_id: string;
    replyToId?: string;
  };
  queuedAt: number;
}

function readOutbox(): ChatOutboxEntry[] {
  try {
    const raw = localStorage.getItem(CHAT_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatOutboxEntry[]) : [];
  } catch (e) {
    handleClientError(e, { module: "services:chat", action: "readOutbox" });
    return [];
  }
}

function writeOutbox(entries: ChatOutboxEntry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(CHAT_OUTBOX_KEY);
    } else {
      localStorage.setItem(CHAT_OUTBOX_KEY, JSON.stringify(entries));
    }
  } catch (e) {
    handleClientError(e, { module: "services:chat", action: "writeOutbox" });
  }
}

/**
 * 构建"连接已断开且无可用检查点"的报错文案（§13.9 报错语义拆分）
 *
 * @param messagePersisted 用户消息是否已落盘（前端写前落盘成功 → 后端已持久化；
 *   失败 → 已入 outbox 待网络恢复后自动补发）
 * @param progressInfo 断线前已生成的内容统计（无内容时为"尚未产生内容"）
 */
export function buildStreamFailureMessage(
  messagePersisted: boolean,
  progressInfo: string,
): string {
  const actionHint = messagePersisted
    ? "您的消息已保存，可直接重新发送以继续（将从当前进度重新生成）"
    : "您的消息暂存在本地，网络恢复后将自动补发，无需重复发送";
  return `连接已断开，且无可用检查点。${progressInfo}。${actionHint}`;
}

/** 断网时暂存待补发的用户消息（幂等：同 id 不重复入队） */
export function enqueueOutbox(
  message: ChatOutboxEntry["message"],
  sessionId: string,
): void {
  const entries = readOutbox();
  if (entries.some((en) => en.id === message.id)) return;
  entries.push({ id: message.id, sessionId, message, queuedAt: Date.now() });
  writeOutbox(entries);
  logger.info("用户消息进入 outbox，待网络恢复后补发", {
    messageId: message.id,
    sessionId,
  });
}

/** 发送成功后清除该会话待补发消息（后端已持久化该轮用户消息，避免重复） */
export function clearOutboxForSession(sessionId: string): void {
  const entries = readOutbox().filter((en) => en.sessionId !== sessionId);
  writeOutbox(entries);
}

/**
 * AB-13 修复：同步截断后端持久化消息（编辑/regenerate 场景）。
 * POST /v1/sessions/:sessionId/messages/truncate { beforeMessageId }
 * 后端删除 beforeMessageId 及其之后的所有消息（含附件清理/审计），
 * 防止前端已截断、切会话/重载后旧消息全部回显。
 */
export async function truncateMessages(
  sessionId: string,
  beforeMessageId: string,
): Promise<{ success: boolean; deletedMessageIds?: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetchJSON<{
      success: boolean;
      deletedMessageIds?: string[];
    }>(
      `${getBackendBaseUrl()}/v1/sessions/${encodeURIComponent(
        sessionId,
      )}/messages/truncate`,
      {
        method: "POST",
        body: JSON.stringify({ beforeMessageId }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** POST 落盘用户消息（3s 超时保护，符合写前持久化规范） */
async function addMessageRequest(
  sessionId: string,
  message: ChatOutboxEntry["message"],
): Promise<{ success: boolean; idempotent: boolean; messageId: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetchJSON<{
      success: boolean;
      idempotent: boolean;
      messageId: string;
    }>(
      `${getBackendBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify(message),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 网络恢复后补发 outbox 中所有消息；成功/幂等命中则移除 */
export async function flushOutbox(): Promise<void> {
  const entries = readOutbox();
  if (entries.length === 0) return;
  logger.info("网络恢复，补发 outbox 消息", { count: entries.length });
  let remaining = entries;
  for (const entry of entries) {
    try {
      await addMessageRequest(entry.sessionId, entry.message);
      remaining = remaining.filter((en) => en.id !== entry.id);
    } catch (e) {
      // 补发失败保留，等待下次连接恢复
      handleClientError(e, {
        module: "services:chat",
        action: "flushOutbox",
      });
    }
  }
  writeOutbox(remaining);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushOutbox();
  });
  // M7 修复：应用启动时若已联网也补发一次 outbox。
  // 仅监听 online 事件在"启动时已联网"的场景不触发（上次离线关闭留滞的消息无法补发）。
  // 后端未就绪时补发失败会保留消息（flushOutbox 失败不清除），幂等安全。
  if (navigator.onLine) {
    void flushOutbox();
  }
}

export const chatService = {
  startBackend: async (): Promise<BackendStatus> => {
    logger.info("[startBackend] 前端发起启动后端请求");
    const core = await getTauriCore();
    if (core) {
      logger.info("[startBackend] Tauri 模式，invoke start_backend");
      const status = await core.invoke<BackendStatus>("start_backend");
      logger.info("[startBackend] start_backend 返回", status);
      // W6 闭环（2026-08-31）：BackendStatus.secret 已回收——共享密钥仅由 Rust
      // http_proxy 注入，JS 不接触明文。健康检查等直连请求改走统一 http 客户端
      // （Tauri 下经 Rust 代理注入密钥；浏览器直连后端默认不鉴权）。
      const healthy = await pollHealth();
      logger.info("[startBackend] pollHealth 健康检查结果", { healthy });
      // 健康检查失败时，查询进程是否已崩溃（获取退出码和 stderr）
      if (!healthy) {
        logger.warn("[startBackend] 健康检查失败，查询进程崩溃状态");
        const updatedStatus =
          await core.invoke<BackendStatus>("get_backend_status");
        logger.warn("[startBackend] 后端崩溃状态", updatedStatus);
        return updatedStatus;
      }
      return { ...status, running: healthy };
    }

    const healthy = await checkHealth();
    logger.info("[startBackend] 浏览器模式健康检查结果", { healthy });
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  stopBackend: async (): Promise<void> => {
    logger.info("[stopBackend] 前端发起停止后端请求");
    const core = await getTauriCore();
    if (core) {
      await core.invoke<void>("stop_backend");
      logger.info("[stopBackend] stop_backend 已调用");
      return;
    }
  },

  getBackendStatus: async (): Promise<BackendStatus> => {
    const core = await getTauriCore();
    if (core) {
      const status = await core.invoke<BackendStatus>("get_backend_status");
      logger.info("[getBackendStatus] Rust 状态返回", status);
      if (status.running) {
        const healthy = await checkHealth();
        logger.info("[getBackendStatus] 健康检查结果", {
          healthy,
          port: getBackendPort(),
        });
        return { ...status, running: healthy };
      }
      return status;
    }

    const healthy = await checkHealth();
    return { running: healthy, port: healthy ? getBackendPort() : null };
  },

  /** 写前落盘用户消息（发送前先持久化，断网时由 outbox 补发） */
  addMessage: (
    sessionId: string,
    message: unknown,
  ): Promise<{ success: boolean; idempotent: boolean; messageId: string }> =>
    addMessageRequest(sessionId, message as ChatOutboxEntry["message"]),

  sendMessage: (
    content: string,
    sessionId?: string,
    images?: AttachedImage[],
    opts?: { messageId?: string },
  ): Promise<Message & { pendingInteraction?: QuestionData }> => {
    return getOTelTracing().asyncWrap("services:chat:sendMessage", async () => {
      // 发消息前确保会话绑定的模型与后端一致
      await ensureSessionModelSync(sessionId);

      // 获取当前工作空间路径，注入工具默认 cwd
      const workspacePath = await getWorkspacePath();

      const chatParams = useConfigStore
        .getState()
        .getEffectiveChatParams(sessionId);
      const body: Record<string, unknown> = {
        model: getModelFromConfig(),
        messages: [{ role: "user", content }],
        max_tokens: chatParams.maxTokens,
        temperature: chatParams.temperature,
        top_p: chatParams.topP,
        system_prompt: chatParams.systemPrompt || undefined,
      };
      if (sessionId) body.session_id = sessionId;
      if (opts?.messageId) body.message_id = opts.messageId;
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
    options?: {
      workMode?: "plan" | "do";
      images?: AttachedImage[];
      messageId?: string;
      /** P0 根治（2026-08-14）：前端流式消息 id，后端 createAssistantMessage 复用，
       *  使 updateMessageBlocks(assistantId) 直接命中落盘 */
      assistantMessageId?: string;
      /** P0: 可恢复错误（CONNECTION_RESET）时向外抛 StreamConnectionError，
       *  供 streamMessageWithReconnect 捕获进入检查点重试。默认 false 保持原行为。 */
      throwOnRecoverable?: boolean;
      /** P0-1（2026-08-26）：流中断续写——携带已生成内容，请求从断点继续而非从头重发 */
      continueFrom?: { content: string; messageId?: string };
    },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const otel = getOTelTracing();
    const span = otel.startSpan("services:chat:streamMessage");
    try {
      // 发消息前确保会话绑定的模型与后端一致
      await ensureSessionModelSync(sessionId);

      // 获取当前工作空间路径，注入工具默认 cwd
      const workspacePath = await getWorkspacePath();

      const chatParams = useConfigStore
        .getState()
        .getEffectiveChatParams(sessionId);
      const body: Record<string, unknown> = {
        model: getModelFromConfig(),
        messages: [{ role: "user", content }],
        max_tokens: chatParams.maxTokens,
        temperature: chatParams.temperature,
        top_p: chatParams.topP,
        system_prompt: chatParams.systemPrompt || undefined,
        stream: true,
      };
      if (sessionId) body.session_id = sessionId;
      if (options?.messageId) body.message_id = options.messageId;
      if (options?.assistantMessageId)
        body.assistant_message_id = options.assistantMessageId;
      // P0-1（2026-08-26）：流中断续写（从断点继续而非从头重发）
      if (options?.continueFrom?.content)
        body.continue_from = options.continueFrom;
      if (workspacePath) body.workspace_path = workspacePath;
      if (options?.workMode) body.work_mode = options.workMode;
      if (options?.images && options.images.length > 0)
        body.images = options.images;

      // W6 收尾（2026-08-31）：聊天主链路改走统一流式通道——Tauri 下经 Rust
      // http_proxy_stream（密钥 Rust 侧注入，JS 不接触明文），浏览器直连 fetch。
      // createStreamReader 模拟 ReadableStreamDefaultReader 接口，下方解析循环不变。
      const { createStreamReader } = await import("./httpClient");
      const reader = await createStreamReader("/v1/chat/completions", {
        method: "POST",
        body,
        headers: buildAuthHeaders(),
        signal,
      });
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        let parseFailCount = 0;

        // P3（第四份导出 #2）：SSE 按事件边界（空行）解析——支持多行 data
        // continuation（多个 data: 行以 \n 连接成一条消息）与 `data:` 无空格前缀。
        // 原实现逐行 JSON.parse，data 跨行时解析异常。parsePayload 为嵌套生成器，
        // 可 yield chunk 并访问外层 parseFailCount（闭包）。
        async function* parsePayload(
          payload: string,
        ): AsyncGenerator<StreamChunk, void, unknown> {
          try {
            const chunk = JSON.parse(payload);

            const pyappType = chunk.__pyapp_type;
            if (pyappType === "thinking") {
              yield {
                type: "thinking",
                content: chunk.choices?.[0]?.delta?.content || "",
                // F1 修复（2026-08-24）：主链路与 parseSseChunk 对齐透传 messageId，
                // 否则流式期间工具轮正文不按 messageId 归组，与回放视图不一致
                messageId: (chunk.__pyapp_message_id as string) || undefined,
              };
            } else if (pyappType === "status") {
              yield {
                type: "status",
                content: chunk.choices?.[0]?.delta?.content || "",
                statusType: chunk.__pyapp_status_type || undefined,
                phase: chunk.__pyapp_phase || undefined,
                tool_call_id:
                  (chunk.__pyapp_tool_call_id as string) || undefined,
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
                tool_call_id: (chunk as Record<string, unknown>).tool_call_id,
                hasResultData: !!(chunk as Record<string, unknown>).result_data,
                resultDataKeys: (chunk as Record<string, unknown>).result_data
                  ? Object.keys(
                      (chunk as Record<string, unknown>).result_data as Record<
                        string,
                        unknown
                      >,
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
              const sseErrorCode = chunk.__pyapp_error_code;
              yield {
                type: "error",
                content: chunk.choices?.[0]?.delta?.content || "Unknown error",
                errorCode: sseErrorCode || "UNKNOWN",
              };
              // P1-1（2026-08-26）：后端"流式响应中断"（STREAM_INTERRUPTED）是
              // 可恢复的 provider 中断——抛 StreamConnectionError 让
              // streamMessageWithReconnect 走检查点/续写恢复（此前仅 yield 不 throw，
              // 恢复链路成为死代码）。先 yield 保留现有错误提示，再 throw。
              if (
                options?.throwOnRecoverable &&
                sseErrorCode === "STREAM_INTERRUPTED"
              ) {
                throw new StreamConnectionError(
                  "STREAM_INTERRUPTED",
                  chunk.choices?.[0]?.delta?.content || "流式响应中断",
                );
              }
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
                  // F1 修复（2026-08-24）：主链路透传 messageId（与 parseSseChunk 对齐）
                  messageId: (chunk.__pyapp_message_id as string) || undefined,
                  // 转发后端 _meta（如 create_project 的导航建议）
                  _meta: chunk.__pyapp_meta as
                    Record<string, unknown> | undefined,
                };
              }
            } else if (
              pyappType === "execution_phase" &&
              chunk.__pyapp_execution_phase
            ) {
              // AB-9 补全：主链路内联解析此前缺 execution_phase 分支（resume 的 parseSseChunk 有），
              // 心跳 SSE 的 delta.content='正在执行工具' 落入下方通用文本分支 → 作为正文泄漏。
              // 此处还原为 execution_phase chunk，processChunk 走 addProgress（进度卡），不进入正文。
              yield {
                type: "execution_phase",
                content: chunk.choices?.[0]?.delta?.content || "",
                executionPhase:
                  chunk.__pyapp_execution_phase as StreamChunk["executionPhase"],
              };
            } else if (
              pyappType === "doc_workflow" &&
              chunk.__pyapp_doc_workflow
            ) {
              yield {
                type: "doc_workflow",
                content: chunk.choices?.[0]?.delta?.content || "",
                docWorkflowData:
                  chunk.__pyapp_doc_workflow as StreamChunk["docWorkflowData"],
              };
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
                  cacheCreationTokens: chunk.usage.cache_creation_input_tokens,
                },
                finishReason: chunk.choices?.[0]?.finish_reason || undefined,
                // 转发后端 _meta（如自动建项目的导航建议）
                _meta: chunk.__pyapp_meta as
                  Record<string, unknown> | undefined,
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
                // 转发后端 _meta（如自动建项目的导航建议）
                _meta: chunk.__pyapp_meta as
                  Record<string, unknown> | undefined,
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
                // F1 修复（2026-08-24）：主链路透传 messageId（与 parseSseChunk 对齐）
                messageId: (chunk.__pyapp_message_id as string) || undefined,
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

        const pendingData: string[] = [];
        // 首块区分（2026-08-19）：首 chunk 用 120s 超时对齐后端首块等待，
        // 避免智谱 GLM 等思考型模型长 TTFB / 后端上下文预处理耗时被误判为断连
        let isFirstChunk = true;
        while (true) {
          // 无数据超时兜底（对齐后端 60s idle）：SSE 流中断时不永久挂起
          const { done, value } = await readWithIdleTimeout(
            reader,
            isFirstChunk ? FIRST_CHUNK_TIMEOUT_MS : STREAM_IDLE_TIMEOUT_MS,
          );
          if (done) break;
          isFirstChunk = false;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              // 空行 = SSE 事件结束：处理累积的多行 data
              if (pendingData.length === 0) continue;
              const payload = pendingData.join("\n");
              pendingData.length = 0;
              if (payload !== "[DONE]") yield* parsePayload(payload);
              continue;
            }
            // 兼容 `data:` 与 `data: ` 前缀（SSE 规范允许无空格）
            if (trimmed.startsWith("data:")) {
              pendingData.push(trimmed.slice(5).trimStart());
            }
            // 其他 SSE 字段（event:/id:/retry:）忽略
          }
        }
        // 流结束：flush 未闭合的残留 data（最后一条无空行结尾）
        if (pendingData.length > 0) {
          const payload = pendingData.join("\n");
          if (payload !== "[DONE]") yield* parsePayload(payload);
        }
      } catch (e) {
        handleClientError(e, {
          module: "services:chat",
          action: "streamMessage-readerLoop",
        });
        // 无数据超时（readWithIdleTimeout 抛 TimeoutError）——与用户取消（AbortError）区分，
        // 便于日志定位"网络超时"环节：超时需 cancel reader 释放挂起的 read
        if (e instanceof DOMException && e.name === "TimeoutError") {
          logger.warn("[streamMessage] 流式读取超时（idle 60s 无数据）", {
            sessionId,
            error: e.message,
          });
          try {
            await reader.cancel();
          } catch {
            // cancel 失败不影响主流程（releaseLock 仍会执行）
          }
          yield {
            type: "error",
            content: "流式响应超时，请重试（连接可能已中断）",
            errorCode: "TIMEOUT",
          };
          return;
        }
        if (
          (e instanceof DOMException && e.name === "AbortError") ||
          // 2026-08-14 排查：fetch 流被 abort 时 Chromium 抛 "BodyStreamBuffer was aborted"，
          // 其 message 含 "aborted" 会误命中下方 isConnectionReset → 误报 CONNECTION_RESET
          // 错误并上报（用户停止/新消息接管旧流属正常取消，非网络故障）。
          // 归为主动取消（与 AbortError 同类），不上报 error、不触发重连。
          (e instanceof Error &&
            e.message.includes("BodyStreamBuffer was aborted"))
        ) {
          // 取消路径诊断日志（2026-08-14 第五十次补充）：记录错误对象细节，便于确认
          // ① 误报是否已消除（此后不应再出现 services:chat 的 CONNECTION_RESET 上报）
          // ② 取消类型分布（用户停止 vs 新消息接管旧流 vs 其他 abort）
          logger.info("[streamMessage] 流式请求已中止（取消/新消息接管旧流）", {
            sessionId,
            errorName:
              e instanceof DOMException ? e.name : e?.constructor?.name,
            errorMessage: e instanceof Error ? e.message : String(e),
            isStandardAbortError:
              e instanceof DOMException && e.name === "AbortError",
            isBodyStreamAbort:
              e instanceof Error &&
              e.message.includes("BodyStreamBuffer was aborted"),
            abortedFlag: (e as { aborted?: boolean })?.aborted ?? false,
          });
          yield { type: "error", content: "请求已取消", errorCode: "UNKNOWN" };
          return;
        }
        // 使用结构化 errorCode 替代字符串匹配 (CS02)
        const errorMessage = e instanceof Error ? e.message : String(e);
        // 可恢复的流中断类（后端进程仍存活，检查点恢复重连有意义）——并入 CONNECTION_RESET
        // （2026-08-12 会话排查导出：原仅识别 3 种，ERR_EMPTY_RESPONSE/socket hang up/aborted
        //   等常见断流落入"其他网络错误"分支 → 不触发重连直接结束对话）
        const isConnectionReset =
          errorMessage.includes("socket connection was closed unexpectedly") ||
          errorMessage.includes("ERR_CONNECTION_RESET") ||
          errorMessage.includes("ERR_INCOMPLETE_CHUNKED_ENCODING") ||
          errorMessage.includes("ERR_EMPTY_RESPONSE") ||
          errorMessage.includes("ERR_CONNECTION_ABORTED") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("socket hang up") ||
          errorMessage.toLowerCase().includes("aborted") ||
          errorMessage.toLowerCase().includes("network connection was lost") ||
          // P1-1（2026-08-26）：瞬态网络/TLS 错误（与后端 provider 错误同源）——
          // SSL 证书/CDN 边缘节点/FailedToOpenSocket/URL 解析错误均属可恢复。
          // 注意：不加 abort/timeout（AbortError 与 TimeoutError 已有独立分支，避免误判主动取消）
          errorMessage.toLowerCase().includes("certificate") ||
          errorMessage.toLowerCase().includes("ssl") ||
          errorMessage.toLowerCase().includes("tls") ||
          errorMessage.toLowerCase().includes("failedtoopensocket") ||
          errorMessage.toLowerCase().includes("was there a typo");
        if (isConnectionReset) {
          // P0-fix: 中断时失效会话缓存，确保下次切换从后端读取最新消息
          if (sessionId) {
            staleSessionCache(sessionId);
          }
          yield {
            type: "error",
            content: "连接已断开，请刷新页面重试（中断前的消息已保存）",
            errorCode: "CONNECTION_RESET",
          };
          // P0: 断线可恢复场景向外抛专用异常，让 streamMessageWithReconnect
          // 捕获后进入检查点重试（此前所有异常路径只 yield 不 throw，重连机制是死代码）
          if (options?.throwOnRecoverable) {
            throw new StreamConnectionError("CONNECTION_RESET", errorMessage);
          }
          return;
        }
        // 代理软件拦截（Clash/V2Ray 等全局/系统代理劫持 127.0.0.1 是本地开发经典坑）
        const isProxyInterception =
          errorMessage.includes("ERR_PROXY_CONNECTION_FAILED") ||
          errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
          errorMessage.includes("ERR_PROXY_CONNECTION_RESET");
        if (isProxyInterception) {
          yield {
            type: "error",
            content:
              "网络请求被代理拦截，请关闭代理软件的全局/系统代理（或添加 127.0.0.1 例外）后重试",
            errorCode: "PROXY_ERROR",
          };
          return;
        }
        // 后端不可达（请求未建立：后端未启动/地址错误），重连无意义故不 throw
        const isBackendUnreachable =
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("Failed to fetch") ||
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.toLowerCase().includes("network error") ||
          errorMessage.toLowerCase().includes("fetch failed");
        if (isBackendUnreachable) {
          yield {
            type: "error",
            content: "无法连接后端服务，请确认后端已启动后重试",
            errorCode: "BACKEND_UNREACHABLE",
          };
          return;
        }
        // 其他网络错误（友好化主文案；原始技术信息走日志/错误弹层详情）
        yield {
          type: "error",
          content: `网络错误: ${friendlyErrorSummary(errorMessage)}`,
          errorCode: "BACKEND_UNREACHABLE",
        };
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      // BUG-3 修复：fetch 阶段（fetch 尚未 resolve）被 abort 也落入外层 catch——
      // 与内层 reader 循环（AbortError → "请求已取消"）语义一致，用户主动取消
      // 不再误报"请求失败/BACKEND_UNREACHABLE"（触发"无法连接后端服务"提示）。
      if (e instanceof DOMException && e.name === "AbortError") {
        yield { type: "error", content: "请求已取消", errorCode: "UNKNOWN" };
        return;
      }
      handleClientError(e, {
        module: "services:chat",
        action: "streamMessage-outer",
      });
      otel.recordError(span, e);
      // P1 修复（1.4）：失败必有反馈兜底——外层异常（HTTP 非 200 / 无响应体）不再直接 throw。
      // 直接 throw 会让前端 for await 抛异常、落到 store 外层 catch 仅设 error 状态，
      // 聊天界面无任何可见反馈（用户"无回复"）。统一转为 error chunk 走正常错误渲染。
      yield {
        type: "error",
        content: `请求失败: ${friendlyErrorSummary(e)}`,
        errorCode: "BACKEND_UNREACHABLE",
      };
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
    options?: {
      workMode?: "plan" | "do";
      images?: AttachedImage[];
      messageId?: string;
      /** P0 根治（2026-08-14）：前端流式消息 id（透传给 streamMessage） */
      assistantMessageId?: string;
    },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    let checkpointId: string | null = null;
    let retryCount = 0;
    const maxRetries = 3;
    // 已生成内容统计（断线且无检查点时用于提示，避免报"无可用检查点"后用户无从判断进度）
    let receivedTextChars = 0;
    let receivedToolCalls = 0;
    let receivedThinkingBlocks = 0;
    // P0-1（2026-08-26）：已接收正文全文——中断重试时作为 continueFrom 传给后端续写
    let receivedText = "";
    let pendingContinueFrom: { content: string; messageId?: string } | null =
      null;

    while (retryCount <= maxRetries) {
      // 恢复路径：直接 fetch resume 端点
      if (checkpointId) {
        try {
          const resumeResp = await fetch(
            `${getBackendBaseUrl()}/v1/sessions/${sessionId}/resume`,
            {
              method: "POST",
              headers: buildAuthHeaders(),
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

          // 复用主链路一致的 SSE 事件边界解析（M8 修复）：
          // ① 兼容 `data:` 无空格前缀（主链路已支持，resume 原只认 `data: `）
          // ② 多行 data continuation 按空行事件边界累积（原逐行 JSON.parse，跨行即丢）
          // ③ readWithIdleTimeout 无数据超时兜底，防止恢复路径挂起
          const reader = resumeResp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const pendingData: string[] = [];
          // 竞态排查：恢复路径事件统计——[DONE]/流结束/残留 flush 时打印，
          // 便于确认恢复链路上事件是否丢失或重复（对比主链路事件数）
          let resumeEventCount = 0;
          logger.info("resume:start", {
            sessionId,
            checkpointId,
            retryCount,
          });
          // 首块区分（2026-08-19）：恢复路径同样用 120s 首块超时，
          // 后端重建状态可能耗时较长，避免误判断连
          let resumeFirstChunk = true;
          while (true) {
            const { done, value } = await readWithIdleTimeout(
              reader,
              resumeFirstChunk
                ? FIRST_CHUNK_TIMEOUT_MS
                : STREAM_IDLE_TIMEOUT_MS,
            );
            if (done) break;
            resumeFirstChunk = false;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) {
                // 空行 = SSE 事件结束：处理累积的多行 data
                if (pendingData.length === 0) continue;
                const payload = pendingData.join("\n");
                pendingData.length = 0;
                if (payload === "[DONE]") {
                  logger.info("resume:done", {
                    sessionId,
                    checkpointId,
                    eventCount: resumeEventCount,
                  });
                  return;
                }
                try {
                  // P2-1: 复用与主链路一致的共享解析，恢复后 thinking/tool_call/question 等决策块不丢失
                  const chunk = JSON.parse(payload);
                  const parsed = parseSseChunk(chunk);
                  if (parsed) {
                    resumeEventCount++;
                    yield parsed;
                  }
                } catch {
                  /* skip malformed */
                }
                continue;
              }
              // 兼容 `data:` 与 `data: ` 前缀（SSE 规范允许无空格）
              if (trimmed.startsWith("data:")) {
                pendingData.push(trimmed.slice(5).trimStart());
              }
              // 其他 SSE 字段（event:/id:/retry:）忽略
            }
          }
          // 流结束：flush 未闭合的残留 data（最后一条无空行结尾）
          if (pendingData.length > 0) {
            const payload = pendingData.join("\n");
            if (payload !== "[DONE]") {
              try {
                const chunk = JSON.parse(payload);
                const parsed = parseSseChunk(chunk);
                if (parsed) {
                  resumeEventCount++;
                  yield parsed;
                }
              } catch {
                /* skip malformed */
              }
            }
          }
          logger.info("resume:complete", {
            sessionId,
            checkpointId,
            eventCount: resumeEventCount,
            flushRemainder: pendingData.length > 0,
          });
          return; // 恢复成功，正常结束
        } catch (err: unknown) {
          const e = err as Error & { name?: string };
          if (e.name === "AbortError") return;
          // 恢复失败 → 进入重试逻辑
        }
      } else {
        // 正常路径：委托现有 streamMessage，并统计已生成内容（断线时用于进度提示）
        try {
          for await (const chunk of chatService.streamMessage(
            content,
            sessionId,
            signal,
            {
              ...options,
              // P0: 断线时向外抛 StreamConnectionError 进入本函数 catch 重试
              throwOnRecoverable: true,
              // P0-1（2026-08-26）：中断续写——携带已生成内容，请求从断点继续而非从头
              continueFrom: pendingContinueFrom ?? undefined,
            },
          )) {
            if (chunk.type === "text" && chunk.content) {
              receivedTextChars += chunk.content.length;
              receivedText += chunk.content;
            } else if (chunk.type === "tool_call") {
              receivedToolCalls++;
            } else if (chunk.type === "thinking" && chunk.content) {
              receivedThinkingBlocks++;
            }
            yield chunk;
          }
          return; // 正常结束
        } catch (err: unknown) {
          const e = err as Error & { name?: string };
          if (e.name === "AbortError") return;
          // P0-1（2026-08-26）：后端"流式响应中断"（STREAM_INTERRUPTED）——
          // 已生成正文的，重试改走"续写"（continueFrom），避免从头重发重复内容
          if (
            e instanceof StreamConnectionError &&
            e.errorCode === "STREAM_INTERRUPTED" &&
            receivedText.length > 0
          ) {
            pendingContinueFrom = {
              content: receivedText,
              messageId: options?.assistantMessageId,
            };
            logger.info("[streamMessage-outer] 流中断，重试走续写", {
              sessionId,
              receivedTextLength: receivedText.length,
            });
          }
          // streamMessage 本身已 yield error chunk，此处进入重试
        }
      }

      // 重试逻辑
      retryCount++;
      // 根因 D：streamMessage-outer 记录重试次数与 reconnect state
      logger.warn(
        `[streamMessage-outer] 连接断开进入重试 ${retryCount}/${maxRetries}`,
        {
          sessionId,
          retryCount,
          maxRetries,
          reconnectState: checkpointId ? "resume" : "restart",
          checkpointId,
          receivedTextChars,
          receivedToolCalls,
          receivedThinkingBlocks,
        },
      );
      if (retryCount > maxRetries) {
        // 阶段2 断连挂起-恢复：重试耗尽后不结束流、不 yield 致命错误，
        // 已渲染内容全部保留，挂起等待后端恢复（connectionMonitor onBackendUp
        // 自动恢复，或用户点"立即恢复"）后再从检查点续传——避免"从头开始"。
        logger.warn("[streamMessage-outer] 重试次数耗尽，进入挂起等待", {
          sessionId,
          retryCount,
          checkpointId,
        });
        yield {
          type: "paused",
          content: "后端连接已断开，回复已暂停，等待后端恢复后自动继续",
        } as StreamChunk;
        try {
          await registerResumeWaiter(sessionId);
        } catch (err) {
          // 被放弃（abortPausedStream）或流已中止：结束流，不继续重试
          logger.info("[streamMessage-outer] 挂起被放弃，流结束", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        // 恢复后：重置重试计数，重新走 while 循环（有检查点则 resume 续传）
        retryCount = 0;
        logger.info("[streamMessage-outer] 挂起已恢复，重新尝试续传", {
          sessionId,
        });
        continue;
      }

      // 获取最新检查点
      try {
        const cpResp = await fetch(
          `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
          { headers: buildAuthHeaders(), signal: AbortSignal.timeout(5000) },
        );
        const cpData = (await cpResp.json()) as {
          checkpointAvailable?: boolean;
          checkpointId?: string;
          stepIndex?: number;
        };
        if (cpData.checkpointAvailable && cpData.checkpointId) {
          checkpointId = cpData.checkpointId;
          logger.info("[streamMessage-outer] 已获取检查点，将从检查点恢复", {
            sessionId,
            retryCount,
            checkpointId: cpData.checkpointId,
            stepIndex: cpData.stepIndex,
          });
          yield {
            type: "reconnect_status",
            content: `连接已断开，正在从第 ${cpData.stepIndex ?? "?"} 步恢复...`,
          } as StreamChunk;
          const delay = Math.min(1000 * 2 ** (retryCount - 1), 30000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.warn("[streamMessage-outer] 后端无可用检查点", {
          sessionId,
          retryCount,
        });
      } catch {
        // 检查点查询失败
        logger.warn("[streamMessage-outer] 检查点查询失败", {
          sessionId,
          retryCount,
        });
      }

      // 无可用检查点：保留已生成内容并给出进度提示，而不是简单报错
      const progressParts: string[] = [];
      if (receivedTextChars > 0) {
        progressParts.push(`已生成 ${receivedTextChars} 字符内容`);
      }
      if (receivedToolCalls > 0) {
        progressParts.push(`完成 ${receivedToolCalls} 次工具调用`);
      }
      if (receivedThinkingBlocks > 0) {
        progressParts.push(`${receivedThinkingBlocks} 次思考`);
      }
      const progressInfo =
        progressParts.length > 0 ? progressParts.join("、") : "尚未产生内容";
      // 报错语义拆分（§13.9 建议）：按"消息是否已落盘"区分后续动作，
      // 避免一律"请重新发送"——已落盘可直接重发；未落盘将由 outbox 在恢复后自动补发。
      yield {
        type: "error",
        content: buildStreamFailureMessage(
          Boolean(options?.messageId),
          progressInfo,
        ),
      } as StreamChunk;
      return;
    }
  },

  fetchModels: (): Promise<
    Array<{ id: string; name: string; provider: string }>
  > => {
    return getOTelTracing().asyncWrap("services:chat:fetchModels", async () => {
      try {
        // K-4 修复 (2026-08-21)：后端 GET /v1/models 已由 ModelManagementAPI
        // 统一接管（返回 modelId / name / provider / providerId 新格式，不再是
        // OpenAI 兼容的 {id, owned_by}）。原解析会导致：
        //   id = DB row UUID / name = DB row UUID / provider = "pyapp"(永远兜底)
        // → 聊天选择器里模型名是乱码 UUID，provider 全为 pyapp，与管理页不一致。
        // 改为解析新格式，并以 modelId 作为聊天实际传入的 model 参数标识。
        const response = await fetchJSON<{
          object: string;
          data: Array<{
            id: string;
            modelId: string;
            name: string;
            provider: string;
            providerId?: string;
            enabled?: boolean;
          }>;
        }>(`${getBackendBaseUrl()}/v1/models`);
        return (response.data || [])
          .filter((m) => m.enabled !== false)
          .map((m) => ({
            id: m.modelId, // 聊天传入的模型名
            name: m.name || m.modelId, // 显示名
            provider: m.provider, // 与模型管理页同源的显示名
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
  ): Promise<{ success: boolean; content?: string; notFound?: boolean }> => {
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
          // 404 = 后端无对应待处理交互（会话中断/后端重启/交互超时已清理），
          // 交由调用方锁定 question 块并提示，避免无限重试
          if ((err as { statusCode?: number }).statusCode === 404) {
            return { success: false, notFound: true };
          }
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
