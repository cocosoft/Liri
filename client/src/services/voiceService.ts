import { httpLegacy as http } from "./httpClient";
import { getOTelTracing } from "../monitoring/otel";

// STTResult、STTSegment、VoiceSession 来自共享类型定义
import type { STTResult, STTSegment, VoiceSession } from "@shared/types";

// 保持向后兼容：原有从 voiceService 导入这些类型的地方仍可正常工作
export type { STTResult, STTSegment, VoiceSession };

/** STT 提供者类型，值由后端 STTRegistry 动态注册 */
export type VoiceProvider = string;

/** 前端 UI 语音状态 */
export interface VoiceState {
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  currentSessionId: string | null;
  error: string | null;
}

/** 前端音频配置 */
export interface AudioConfig {
  provider: VoiceProvider;
  inputDeviceId?: string;
  outputDeviceId?: string;
  wakeWordEnabled: boolean;
  wakeWord: string;
  autoPlayTTS: boolean;
  voiceId: string;
  inputLanguage: string;
  outputLanguage: string;
  /** STT 引擎提供者 ID（如 "local"、"cloud"） */
  sttProviderId: string;
}

/** 唤醒词配置 */
export interface WakeWord {
  id: string;
  phrase: string;
  sensitivity: number;
  enabled: boolean;
}

/** 前端语音设置（含配置、唤醒词、快捷键） */
export interface VoiceSettings {
  config: AudioConfig;
  wakeWords: WakeWord[];
  hotkeys: Record<string, string>;
}

// ============================================================
// P2-2: WebSocket 连接管理 + 心跳检测
// ============================================================

/** 前端 WebSocket 连接实例 */
let voiceWs: WebSocket | null = null;

/** 心跳定时器句柄 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** 连续未收到 pong 的次数 */
let missedPongs = 0;

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 最大允许连续未收到 pong 的次数 */
const MAX_MISSED_PONGS = 2;

/** 状态变更回调 */
let onStateChangeCb: ((state: string, previous: string) => void) | null = null;

/** 连接断开回调 */
let onDisconnectCb: (() => void) | null = null;

// ============================================================
// P2-4: 唤醒词 WebSocket 连接管理
// ============================================================

/** 唤醒词 WebSocket 连接实例 */
let wakeWs: WebSocket | null = null;

/** 唤醒词 WebSocket 重连定时器 */
let wakeReconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 唤醒词检测回调 */
let onWakeWordDetectedCb:
  | ((data: {
      matchedTrigger: string | null;
      remainingText: string | null;
    }) => void)
  | null = null;

/** 唤醒 WS 连接断开回调 — 保留供后续使用 */
// @ts-expect-error TS6133: reserved for future use
let onWakeDisconnectCb: (() => void) | null = null;

/** 唤醒 WS 是否已主动断开 */
let wakeDisconnectRequested = false;

/** 重连延迟基数（毫秒） */
const WAKE_RECONNECT_BASE_MS = 2000;

/** 重连最大延迟（毫秒） */
const WAKE_RECONNECT_MAX_MS = 30000;

/** 重连指数退避计数器 */
let wakeReconnectAttempt = 0;

/**
 * 注册唤醒词检测回调
 * 当后端检测到唤醒词时通过 WebSocket 推送，此回调被触发
 */
export function onWakeWordDetected(
  cb: (data: {
    matchedTrigger: string | null;
    remainingText: string | null;
  }) => void,
): void {
  onWakeWordDetectedCb = cb;
}

/**
 * 注册唤醒 WS 连接断开回调
 */
export function onWakeDisconnect(cb: () => void): void {
  onWakeDisconnectCb = cb;
}

/**
 * 建立唤醒词 WebSocket 连接到后端的 /wake 端点
 * 连接成功后自动监听 wakeword_detected 事件
 * 断开时自动重连（指数退避）
 */
export function connectWakeWordWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    // 如果已有连接，先关闭（但不设为主动断开，让重连逻辑继续生效）
    disconnectWakeWordWebSocket(false);

    wakeDisconnectRequested = false;
    wakeReconnectAttempt = 0;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // P1-2.16: 注入 traceparent 查询参数
    const span = getOTelTracing().getActiveSpan();
    let tpParam = "";
    if (span) {
      const ctx = span.spanContext();
      if (ctx.traceId) {
        tpParam = `?traceparent=00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags}`;
      }
    }
    const url = `${protocol}//${window.location.host}/wake${tpParam}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      wakeWs = ws;
      wakeReconnectAttempt = 0;
      resolve();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // 处理唤醒词检测事件
        if (data.type === "wakeword_detected") {
          onWakeWordDetectedCb?.({
            matchedTrigger: data.data?.matchedTrigger ?? null,
            remainingText: data.data?.remainingText ?? null,
          });
          return;
        }

        // 服务端 ping → 回复 pong
        if (data.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          }
          return;
        }
      } catch {
        // 非 JSON 消息忽略
      }
    };

    ws.onclose = () => {
      wakeWs = null;

      if (wakeDisconnectRequested) {
        return;
      }

      // 自动重连（指数退避）
      const delay = Math.min(
        WAKE_RECONNECT_BASE_MS * Math.pow(2, wakeReconnectAttempt),
        WAKE_RECONNECT_MAX_MS,
      );
      wakeReconnectAttempt++;

      wakeReconnectTimer = setTimeout(() => {
        if (!wakeDisconnectRequested) {
          connectWakeWordWebSocket().catch(() => {
            // 重连失败由 onclose 再次触发
          });
        }
      }, delay);
    };

    ws.onerror = () => {
      // onerror 后会有 onclose，由 onclose 处理重连
      reject(new Error("唤醒 WS 连接失败"));
    };
  });
}

/**
 * 断开唤醒词 WebSocket 连接
 * @param requested 是否为主动断开（主动断开不触发重连）
 */
export function disconnectWakeWordWebSocket(requested: boolean = true): void {
  if (requested) {
    wakeDisconnectRequested = true;
  }

  if (wakeReconnectTimer) {
    clearTimeout(wakeReconnectTimer);
    wakeReconnectTimer = null;
  }

  if (wakeWs) {
    wakeWs.onclose = null;
    wakeWs.close(1000, "normal closure");
    wakeWs = null;
  }
}

/**
 * 注册状态变更回调
 * 当后端 VoiceSession 状态变更时通过 WebSocket 推送，此回调被触发
 */
export function onVoiceStateChange(
  cb: (state: string, previous: string) => void,
): void {
  onStateChangeCb = cb;
}

/**
 * 注册连接断开回调
 * 心跳超时或 WebSocket 断开时触发
 */
export function onVoiceDisconnect(cb: () => void): void {
  onDisconnectCb = cb;
}

/**
 * 建立前端 WebSocket 连接到后端的 /voice 端点
 * 连接成功后自动启动心跳定时器
 */
export function connectVoiceWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    // 如果已有连接，先关闭
    disconnectVoiceWebSocket();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // P1-2.16: 注入 traceparent 查询参数，实现跨进程 TraceContext 传递
    const span = getOTelTracing().getActiveSpan();
    let tpParam = "";
    if (span) {
      const ctx = span.spanContext();
      if (ctx.traceId) {
        tpParam = `?traceparent=00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags}`;
      }
    }
    const url = `${protocol}//${window.location.host}/voice${tpParam}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      voiceWs = ws;
      missedPongs = 0;

      // 启动心跳：每 30s 发送 ping
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        missedPongs++;

        // 连续两次未收到 pong → 连接已失效
        if (missedPongs >= MAX_MISSED_PONGS) {
          onDisconnectCb?.();
          disconnectVoiceWebSocket();
        }
      }, HEARTBEAT_INTERVAL_MS);

      resolve();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // P2-2: 心跳响应 — 重置计数器
        if (data.type === "pong") {
          missedPongs = 0;
          return;
        }

        // P2-2: 状态变更事件 — 分发到注册的回调
        if (data.type === "session.state_change") {
          onStateChangeCb?.(data.state, data.previous);
          return;
        }
      } catch {
        // 非 JSON 消息（如二进制帧）忽略
      }
    };

    ws.onclose = () => {
      disconnectVoiceWebSocket();
      onDisconnectCb?.();
    };

    ws.onerror = () => {
      reject(new Error("WebSocket 连接失败"));
    };
  });
}

/**
 * 断开 WebSocket 连接并清理心跳定时器
 */
export function disconnectVoiceWebSocket(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (voiceWs) {
    voiceWs.onclose = null; // 防止递归触发
    voiceWs.close(1000, "normal closure");
    voiceWs = null;
  }

  missedPongs = 0;
}

const voiceService = {
  /**
   * 获取语音设置
   * Phase 2.3: 端点从 /v1/voice/settings 迁移到统一设置端点
   *   GET /v1/settings/voice，存储后端为 ConfigManager。
   *   响应格式: { namespace, value: VoiceSettings }
   */
  async getSettings(): Promise<VoiceSettings> {
    const response = await http.get<{
      namespace: string;
      value: VoiceSettings;
      success?: boolean;
    }>("/v1/settings/voice");
    if (response?.value && response.value.config) {
      return response.value;
    }
    // 回退：旧端点格式
    const legacyResponse = await http.get<VoiceSettings>("/v1/voice/settings");
    return legacyResponse;
  },

  /**
   * 更新语音设置
   * Phase 2.3: 端点从 /v1/voice/settings 迁移到统一设置端点
   */
  async updateSettings(
    settings: Partial<VoiceSettings>,
  ): Promise<VoiceSettings> {
    const response = await http.put<{
      success: boolean;
      value: VoiceSettings;
      namespace: string;
    }>("/v1/settings/voice", settings);
    // 新 API 返回 { success, namespace, value }，value 中即为 VoiceSettings
    if (response?.value && response.value.config) {
      return response.value;
    }
    // 回退：旧端点格式
    const legacyResponse = await http.put<VoiceSettings>(
      "/v1/voice/settings",
      settings,
    );
    return legacyResponse;
  },

  async startSession(): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>("/v1/voice/session/start");
    return response;
  },

  async endSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>(
      `/v1/voice/session/${sessionId}/end`,
    );
    return response;
  },

  async getSessions(
    limit: number = 20,
  ): Promise<{ sessions: VoiceSession[]; total: number }> {
    const response = await http.get<{
      sessions: VoiceSession[];
      total: number;
    }>(`/v1/voice/sessions?limit=${limit}`);
    return response;
  },

  async getSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.get<VoiceSession>(
      `/v1/voice/session/${sessionId}`,
    );
    return response;
  },

  async uploadAudio(
    sessionId: string,
    audioBlob: Blob,
  ): Promise<{ transcript: string; audioUrl?: string }> {
    return getOTelTracing().asyncWrap(
      "services:voice:uploadAudio",
      async () => {
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");
        formData.append("sessionId", sessionId);

        const response = await fetch(
          `${window.location.origin}/v1/voice/upload`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error("Failed to upload audio");
        }

        return response.json();
      },
    );
  },

  async getAudioStream(sessionId: string): Promise<MediaStream> {
    return getOTelTracing().asyncWrap(
      "services:voice:getAudioStream",
      async () => {
        const response = await fetch(`/v1/voice/stream/${sessionId}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        return new MediaStream();
      },
    );
  },

  async synthesizeSpeech(text: string, voiceId?: string): Promise<string> {
    const response = await http.post<{ audioUrl: string }>("/v1/voice/tts", {
      text,
      voiceId,
    });
    return response.audioUrl;
  },

  async getProviders(): Promise<VoiceProvider[]> {
    const response = await http.get<VoiceProvider[]>("/v1/voice/providers");
    return response;
  },

  async getVoices(
    provider: VoiceProvider,
  ): Promise<{ id: string; name: string; language: string }[]> {
    const response = await http.get<
      { id: string; name: string; language: string }[]
    >(`/v1/voice/voices?provider=${provider}`);
    return response;
  },

  async testWakeWord(wakeWordId: string): Promise<boolean> {
    const response = await http.post<{ detected: boolean }>(
      `/v1/voice/wakeword/${wakeWordId}/test`,
    );
    return response.detected;
  },

  /**
   * STT 语音转录
   * 优先使用二进制（FormData）上传，规避 base64 编解码开销；
   * 不支持时回退到 JSON + base64。
   * 离线时抛出友好提示而非原始网络异常。
   *
   * @param audioBlob 音频 Blob 数据
   * @param options 转录选项
   */
  async transcribe(
    audioBlob: Blob,
    options?: {
      providerId?: string;
      language?: string;
      keyterms?: string[];
    },
  ): Promise<STTResult> {
    return getOTelTracing().asyncWrap("services:voice:transcribe", async () => {
      // L15: 离线检测 — 网络不可用时给出友好提示
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return Promise.reject(
          new Error("网络不可用，语音识别暂不可用，请连接网络后重试"),
        );
      }

      // L4/L5: 优先使用二进制传输（FormData / multipart）
      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.wav");
        if (options?.providerId)
          formData.append("providerId", options.providerId);
        if (options?.language) formData.append("language", options.language);
        if (options?.keyterms) {
          formData.append("keyterms", JSON.stringify(options.keyterms));
        }

        const response = await fetch("/v1/voice/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`服务器响应异常 (${response.status})`);
        }

        return await response.json();
      } catch {
        // 降级：二进制传输失败时回退到 JSON + base64
        return new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = async () => {
            try {
              const base64 = (reader.result as string).split(",")[1];
              const result = await http.post<STTResult>(
                "/v1/voice/transcribe",
                {
                  audioData: base64,
                  providerId: options?.providerId,
                  language: options?.language,
                  keyterms: options?.keyterms,
                },
              );
              resolve(result);
            } catch (err) {
              reject(err);
            }
          };

          reader.onerror = () => reject(new Error("读取音频文件失败"));
          reader.readAsDataURL(audioBlob);
        });
      }
    });
  },

  // ═══════════════════════════════════════════
  // TTS 合成相关方法
  // ═══════════════════════════════════════════

  /**
   * 获取 TTS 提供商列表
   * 底层调用 GET /v1/voice/providers，由后端返回已注册的语音提供商 ID 列表。
   */
  async getTTSProviders(): Promise<string[]> {
    const response = await http.get<string[]>("/v1/voice/providers");
    return response;
  },

  /**
   * 获取 TTS 提供商详细信息列表
   * 底层调用 GET /v1/tts/providers，返回含 supportedFormats 的详情。
   */
  async getTTSProvidersDetail(): Promise<
    Array<{ name: string; supportedFormats: string[] }>
  > {
    const response =
      await http.get<Array<{ name: string; supportedFormats: string[] }>>(
        "/v1/tts/providers",
      );
    return response;
  },

  /**
   * 获取 TTS 健康状态
   * 底层调用 GET /v1/tts/health。
   */
  async getTTSHealth(): Promise<{
    status: string;
    providers: string[];
    providerDetails: Array<{ name: string; supportedFormats: string[] }>;
  }> {
    const response = await http.get<{
      status: string;
      providers: string[];
      providerDetails: Array<{ name: string; supportedFormats: string[] }>;
    }>("/v1/tts/health");
    return response;
  },

  /**
   * 保存指定提供商的配置信息
   *
   * @param provider 提供商 ID（如 "openai"、"piper"）
   * @param config   Provider 专用配置对象
   */
  async saveProviderConfig(
    provider: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await http.post(`/v1/tts/providers/${provider}/config`, config);
  },

  /**
   * 合成语音（含格式选择）
   * 在基础 synthesizeSpeech 上扩展 format 参数；后端当前可能忽略 format。
   *
   * @param text    待合成文本
   * @param options 合成选项（voiceId / format 等）
   */
  async synthesizeWithFormat(
    text: string,
    options?: { voiceId?: string; format?: string },
  ): Promise<string> {
    const response = await http.post<{ audioUrl: string }>("/v1/voice/tts", {
      text,
      voiceId: options?.voiceId,
      format: options?.format,
    });
    return response.audioUrl;
  },

  /**
   * 检测 TTS 服务健康状态
   * 后端应返回 { status: "ok" } 或 { status: "error", message: string }。
   * 后端尚未实现此端点时返回 "unavailable"。
   */
  async checkTTSHealth(): Promise<{ status: string; message?: string }> {
    try {
      return await http.get("/v1/voice/health");
    } catch {
      return { status: "unavailable", message: "健康检测端点未实现" };
    }
  },
};

export { voiceService };
