/**
 * llama.cpp 集成 API 服务层
 * 提供：状态查询、专业配置读写、服务重启、硬件检测、模型推荐、
 *       模型下载、模型迁移、模型删除
 */

import { http, type HttpClientConfig } from "./httpClient";
import { getBackendBaseUrl } from "./backendUrl";

export type LlamaServerStatus =
  | "stopped" | "downloading" | "starting" | "running" | "error";

export type LlamaKvCacheTier = "low" | "medium" | "high";

export type LlamaFlashAttn = "off" | "on" | "auto";

export interface LlamaConfig {
  host: string;
  port: number;
  /** GGUF 模型绝对路径 */
  model: string;
  /** 是否随应用自动启动 */
  autoStart: boolean;
  /** GPU 层数（0 = 纯 CPU） */
  gpuLayers: number;
  /** 上下文窗口 */
  contextWindow: number;
  /** KV cache 量化档位（low=q4_0 / medium=q8_0 / high=f16） */
  kvCache: LlamaKvCacheTier;
  /** 计算线程（0 = 自动） */
  threads: number;
  /** 批大小（0 = 自动，默认 2048） */
  batchSize: number;
  /** 采样温度 */
  temperature: number;
  /** top-k */
  topK: number;
  /** top-p */
  topP: number;
  /** repeat-penalty */
  repeatPenalty: number;
  /** seed（-1 = 随机） */
  seed: number;
  /** --no-mmap */
  noMmap: boolean;
  /** --mlock */
  mlock: boolean;
  /** --flash-attn */
  flashAttn: LlamaFlashAttn;
  /** GGUF 模型存储目录（空 = 使用默认路径） */
  modelsDir?: string;
}

export interface LlamaStatus {
  status: LlamaServerStatus;
  version: string;
  binaryExists: boolean;
  running: boolean;
  host: string;
  port: number;
  model: string;
  models: string[];
  modelsDir: string;
  lastError: string | null;
  restartCount: number;
}

// ─── 硬件检测 / 模型推荐类型 ────────────────────────────────────────

export interface LlamaHardwareInfo {
  platform: "win32" | "darwin" | "linux";
  cpuCores: number;
  systemMemoryGB: number;
  gpu: {
    name: string | null;
    memoryGB: number;
    backend: "cuda" | "vulkan" | "metal" | "cpu" | null;
  };
  llamaCppBackend: "cpu" | "cuda" | "vulkan" | "metal";
  lastUpdated: number;
}

export interface LlamaModelRecommendation {
  modelId: string;
  displayName: string;
  quantVersion: string;
  fileSizeGB: number;
  qualityScore: number;
  suitability: "high" | "medium" | "low";
  estimatedRamGB: number;
  recommendedGpuLayers: number;
  recommendationReason: string;
}

export type MigratePhase = "migrating" | "error" | "skipped";

export interface MigrateProgress {
  current: number;
  total: number;
  file: string;
  percent: number;
  phase: MigratePhase;
  error?: string;
}

export interface MigratedFileInfo {
  source: string;
  destination: string;
  size: number;
}

export interface LlamaMigrateResponse {
  success: boolean;
  migratedFiles: MigratedFileInfo[];
  skippedFiles: string[];
  failedFiles: Array<{ path: string; error: string }>;
  elapsedMs: number;
}

export interface ModelDownloadRequest {
  modelId: string;
  quantVersion: string;
  fileSizeGB: number;
  qualityScore: number;
  suitability: "high" | "medium" | "low";
  estimatedRamGB: number;
  recommendationReason: string;
}

export interface LlamaDownloadedModelInfo {
  modelId: string;
  quantVersion: string;
  filePath: string;
  autoStart: boolean;
  gpuLayers: number;
}

export interface LlamaSseEvent {
  event: "progress" | "complete" | "error" | "cancelled" | "message";
  data: unknown;
}

// ─── 核心 API 服务 ──────────────────────────────────────────────────

export const llamaService = {
  /** 查询集成状态（含 GGUF 模型列表） */
  async getStatus(): Promise<LlamaStatus> {
    const res = await http.get<{ success: boolean; status: LlamaStatus }>(
      "/v1/llama/status",
    );
    if (!res.ok) throw new Error(res.error?.message ?? "获取 llama 状态失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data.status;
  },

  /** 查询当前专业配置 + 状态 */
  async getConfig(): Promise<{ config: LlamaConfig; status: LlamaStatus }> {
    const res = await http.get<{
      success: boolean;
      config: LlamaConfig;
      status: LlamaStatus;
    }>("/v1/llama/config");
    if (!res.ok) throw new Error(res.error?.message ?? "获取 llama 配置失败");
    if (!res.data) throw new Error("响应数据为空");
    return { config: res.data.config, status: res.data.status };
  },

  /** 保存专业配置（后端校验 + 持久化 config.json llama 段） */
  async saveConfig(config: Partial<LlamaConfig>): Promise<LlamaConfig> {
    const res = await http.put<{ success: boolean; config: LlamaConfig }>(
      "/v1/llama/config",
      config,
    );
    if (!res.ok) throw new Error(res.error?.message ?? "保存 llama 配置失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data.config;
  },

  /** 应用配置并重启服务 */
  async restart(): Promise<void> {
    const res = await http.post<{ success: boolean }>("/v1/llama/restart");
    if (!res.ok) throw new Error(res.error?.message ?? "重启 llama 服务失败");
  },

  /** 强制杀掉所有 llama-server 进程（紧急恢复） */
  async forceKill(): Promise<{ success: boolean; remainingProcesses: number; message: string }> {
    const res = await http.post<{
      success: boolean;
      remainingProcesses: number;
      message: string;
    }>("/v1/llama/force-kill");
    if (!res.ok) throw new Error(res.error?.message ?? "强制杀死 llama 服务失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data;
  },

  /** 强制杀掉并重启 llama-server（一键恢复） */
  async forceRestart(): Promise<{ success: boolean; providerRegistered: boolean; status: string; message: string }> {
    const res = await http.post<{
      success: boolean;
      providerRegistered: boolean;
      status: string;
      message: string;
      error?: string;
    }>("/v1/llama/force-restart");
    if (!res.ok) throw new Error(res.error?.message ?? "强制重启 llama 服务失败");
    if (!res.data) throw new Error("响应数据为空");
    if (!res.data.success && res.data.error) {
      throw new Error(res.data.error);
    }
    return res.data;
  },

  /** 获取 llama-server 日志 */
  async getLogs(lines = 200): Promise<string> {
    const res = await http.get<{ success: boolean; logs: string }>(
      `/v1/llama/logs?lines=${lines}`,
    );
    if (!res.ok) throw new Error(res.error?.message ?? "获取 llama 日志失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data.logs;
  },

  /**
   * 订阅 llama-server 实时日志流（SSE）
   * @returns AbortController，可用于取消订阅
   */
  async subscribeLogsStream(
    handlers: {
      onInitial?: (logs: string) => void;
      onLog?: (logs: string) => void;
      onError?: (error: string) => void;
    },
    initialLines = 100,
  ): Promise<AbortController> {
    const url = `${getBackendBaseUrl().replace(/\/+$/, "")}/v1/llama/logs/stream?initialLines=${initialLines}`;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };

    const secret = typeof localStorage !== "undefined" ? localStorage.getItem("liri-api-secret") : null;
    if (secret) headers["X-API-Key"] = secret;

    const token = typeof localStorage !== "undefined" ? localStorage.getItem("liri-auth-token") : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();

    const doFetch = async (): Promise<void> => {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          handlers.onError?.(`HTTP ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "message";
        const pendingData: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              if (pendingData.length === 0) continue;
              const payload = pendingData.join("\n");
              pendingData.length = 0;

              try {
                const parsed = JSON.parse(payload);
                if (currentEvent === "initial") {
                  handlers.onInitial?.(parsed.logs || "");
                } else if (currentEvent === "log") {
                  handlers.onLog?.(parsed.logs || "");
                }
              } catch {
                // 心跳或其他非 JSON 事件忽略
              }
              currentEvent = "message";
              continue;
            }
            if (trimmed.startsWith("event:")) {
              const evt = trimmed.slice(6).trim();
              currentEvent = evt === "initial" || evt === "log" ? evt : "message";
            } else if (trimmed.startsWith("data:")) {
              pendingData.push(trimmed.slice(5).trimStart());
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
    };

    doFetch();
    return controller;
  },

  // ─── 硬件检测 ────────────────────────────────────────────────────

  /** 获取硬件检测结果（可传 forceRefresh 强制刷新） */
  async detectHardware(forceRefresh = false): Promise<LlamaHardwareInfo> {
    const params = forceRefresh ? { forceRefresh: "1" } : undefined;
    const res = await http.get<{
      success: boolean;
      hardware: LlamaHardwareInfo;
    }>("/v1/llama/hardware", { params });
    if (!res.ok) throw new Error(res.error?.message ?? "硬件检测失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data.hardware;
  },

  /** 获取模型推荐列表（后端按当前硬件自动生成） */
  async getRecommendations(): Promise<LlamaModelRecommendation[]> {
    const res = await http.get<{
      success: boolean;
      recommendations: LlamaModelRecommendation[];
    }>("/v1/llama/recommendations");
    if (!res.ok) throw new Error(res.error?.message ?? "获取模型推荐失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data.recommendations;
  },

  // ─── 模型删除 ────────────────────────────────────────────────────

  /** 删除指定 GGUF 模型文件 */
  async deleteModel(filename: string): Promise<{
    success: boolean;
    deleted: string;
    message: string;
  }> {
    const res = await http.delete<{
      success: boolean;
      deleted: string;
      message: string;
    }>(`/v1/llama/models/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(res.error?.message ?? "删除模型失败");
    if (!res.data) throw new Error("响应数据为空");
    return res.data;
  },

  // ─── 迁移 / 下载（SSE POST） ────────────────────────────────────

  /**
   * 启动模型迁移（SSE 流式推送进度）
   * @returns AbortController，可用于取消迁移
   */
  async startMigration(
    params: {
      targetDir: string;
      copy?: boolean;
      overwrite?: boolean;
    },
    handlers: {
      onProgress?: (progress: MigrateProgress) => void;
      onComplete?: (result: LlamaMigrateResponse) => void;
      onError?: (error: string) => void;
      onCancelled?: () => void;
    },
  ): Promise<AbortController> {
    return postSseRequest(
      "/v1/llama/migrate",
      params,
      (event: LlamaSseEvent) => {
        switch (event.event) {
          case "progress":
            handlers.onProgress?.(event.data as MigrateProgress);
            break;
          case "complete":
            handlers.onComplete?.(event.data as LlamaMigrateResponse);
            break;
          case "error":
            handlers.onError?.((event.data as { error: string }).error ?? String(event.data));
            break;
          case "cancelled":
            handlers.onCancelled?.();
            break;
        }
      },
    );
  },

  /** 取消正在进行的迁移（通知后端 abort，幂等） */
  async cancelMigration(): Promise<void> {
    const res = await http.post<{ success: boolean; message: string }>(
      "/v1/llama/migrate/cancel",
    );
    if (!res.ok) throw new Error(res.error?.message ?? "取消迁移失败");
  },

  /**
   * 下载并自动配置模型（SSE 流式推送进度）
   * @returns AbortController，可用于取消下载
   */
  async downloadModel(
    model: ModelDownloadRequest,
    options: { autoStart?: boolean } & {
      onProgress?: (payload: { percent?: number; status?: string; error?: string }) => void;
      onComplete?: (info: LlamaDownloadedModelInfo) => void;
      onError?: (error: string) => void;
    },
  ): Promise<AbortController> {
    const { onProgress, onComplete, onError } = options;
    return postSseRequest(
      "/v1/llama/download",
      { ...model, autoStart: options.autoStart },
      (event: LlamaSseEvent) => {
        switch (event.event) {
          case "progress":
            onProgress?.(event.data as { percent?: number; status?: string; error?: string });
            break;
          case "complete":
            onComplete?.(event.data as LlamaDownloadedModelInfo);
            break;
          case "error":
            onError?.((event.data as { error: string }).error ?? String(event.data));
            break;
        }
      },
    );
  },
};

// ─── SSE POST 辅助 ──────────────────────────────────────────────────

/**
 * 发起 POST SSE 请求，按事件边界解析，调用方回调。
 * 与 http.stream 不同，本函数使用 fetch 直接发起 POST + body，
 * 因为 EventSource 仅支持 GET。
 */
async function postSseRequest(
  path: string,
  body: unknown,
  onEvent: (event: LlamaSseEvent) => void,
  config?: HttpClientConfig,
): Promise<AbortController> {
  const url = `${getBackendBaseUrl().replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...config?.headers,
  };

  const secret = typeof localStorage !== "undefined" ? localStorage.getItem("liri-api-secret") : null;
  if (secret) headers["X-API-Key"] = secret;

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("liri-auth-token") : null;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();

  const doFetch = async (): Promise<void> => {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      onEvent({ event: "error", data: { error: `HTTP ${res.status}` } });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent: "message" | "progress" | "complete" | "error" | "cancelled" = "message";
    const pendingData: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (pendingData.length === 0) continue;
          const payload = pendingData.join("\n");
          pendingData.length = 0;
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            onEvent({ event: currentEvent, data: parsed });
          } catch {
            onEvent({ event: currentEvent, data: payload });
          }
          currentEvent = "message";
          continue;
        }
        if (trimmed.startsWith("event:")) {
          const evt = trimmed.slice(6).trim();
          currentEvent =
            evt === "progress" || evt === "complete" || evt === "error" || evt === "cancelled"
              ? evt
              : "message";
        } else if (trimmed.startsWith("data:")) {
          pendingData.push(trimmed.slice(5).trimStart());
        }
      }
    }

    if (pendingData.length > 0) {
      const payload = pendingData.join("\n");
      try {
        const parsed = JSON.parse(payload);
        onEvent({ event: currentEvent, data: parsed });
      } catch {
        onEvent({ event: currentEvent, data: payload });
      }
    }
  };

  doFetch().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") return;
    onEvent({ event: "error", data: { error: err instanceof Error ? err.message : String(err) } });
  });

  return controller;
}
