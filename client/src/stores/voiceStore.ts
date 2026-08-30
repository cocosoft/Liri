/**
 * Voice Store — 独立 Zustand Store
 *
 * 语音设置、录制、WebSocket、字幕、唤醒词、TTS 全部合并为一个 Store。
 * 原状态从 appStore 迁出，现已为真实独立 Store。
 */

import { create } from "zustand";
import {
  voiceService,
  connectVoiceWebSocket,
  disconnectVoiceWebSocket,
  onVoiceStateChange,
  onVoiceDisconnect,
  connectWakeWordWebSocket,
  disconnectWakeWordWebSocket,
  onWakeWordDetected,
  onWakeDisconnect,
  type VoiceSettings,
  type VoiceSession,
} from "../services/voiceService";
import { handleClientError } from "@/utils/handleError";
import { http as apiHttp } from "../services/httpClient";

export type { VoiceSettings, VoiceSession };

/** 字幕条目 */
export interface SubtitleEntry {
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence?: number;
}

interface VoiceState {
  // ---- Voice ----
  settings: VoiceSettings | null;
  sessions: VoiceSession[];
  currentSession: VoiceSession | null;
  sessionState: string;
  wsConnected: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  error: string | null;
  audioLevel: number;
  micStatus: { status: string; audioLevel: number } | null;

  // ---- Subtitle ----
  interimText: string;
  finalText: string;
  subtitleHistory: SubtitleEntry[];
  subtitleStatus: "idle" | "listening" | "processing" | "done";

  // ---- Wake Word ----
  wakeWordEnabled: boolean;
  wakeWordTriggers: string[];
  wakeWordListening: boolean;
  wakeWordTriggered: string | null;
  wakeWsConnected: boolean;

  // ---- TTS ----
  ttsProviders: string[];
  ttsVoices: { id: string; name: string; language: string }[];
  ttsHealth: { status: string; message?: string };

  // ---- Actions ----
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<VoiceSettings>) => Promise<void>;
  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  playResponse: (audioUrl: string) => Promise<void>;
  stopPlayback: () => void;
  clearError: () => void;

  toggleWakeWord: () => Promise<void>;
  setWakeWordTriggers: (triggers: string[]) => Promise<void>;
  connectWakeWordWebSocket: () => Promise<void>;
  disconnectWakeWordWebSocket: () => void;

  loadTTSProviders: () => Promise<void>;
  loadTTSVoices: (provider: string) => Promise<void>;
  checkTTSHealth: () => Promise<void>;
}

let voiceCallbacksRegistered = false;

/** 注册一次性的语音状态变更回调（幂等） */
function ensureVoiceCallbacksRegistered(
  set: (partial: Partial<VoiceState>) => void,
  get: () => VoiceState,
) {
  if (voiceCallbacksRegistered) return;
  voiceCallbacksRegistered = true;

  onVoiceStateChange((state, _previous) => {
    set({ sessionState: state });

    if (state === "disconnected" || state === "error") {
      set({
        isRecording: false,
        isProcessing: false,
        currentSession: null,
      });
    }
  });

  onVoiceDisconnect(() => {
    set({
      wsConnected: false,
      sessionState: "idle",
      isRecording: false,
      isProcessing: false,
      currentSession: null,
    });
  });

  onWakeWordDetected((data) => {
    const store = get();

    set({
      wakeWordTriggered: data.matchedTrigger,
      wakeWordListening: false,
    });

    if (!store.isRecording && !store.isProcessing) {
      store.startRecording().catch((e) => {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "wakeWordAutoRecord" },
          "warn",
        );
      });
    }
  });

  onWakeDisconnect(() => {
    set({ wakeWsConnected: false });
  });
}

export const useVoiceStore = create<VoiceState>((set, get) => {
  ensureVoiceCallbacksRegistered(set, get);

  return {
    // ---- Voice ----
    settings: null,
    sessions: [],
    currentSession: null,
    sessionState: "idle",
    wsConnected: false,
    isRecording: false,
    isProcessing: false,
    isPlaying: false,
    error: null,
    audioLevel: 0,
    micStatus: null,

    // ---- Subtitle ----
    interimText: "",
    finalText: "",
    subtitleHistory: [],
    subtitleStatus: "idle",

    // ---- Wake Word ----
    wakeWordEnabled: false,
    wakeWordTriggers: [],
    wakeWordListening: false,
    wakeWordTriggered: null,
    wakeWsConnected: false,

    // ---- TTS ----
    ttsProviders: [],
    ttsVoices: [],
    ttsHealth: { status: "unknown" },

    // ---- Voice Actions ----
    loadSettings: async () => {
      try {
        const settings = await voiceService.getSettings();
        set({ settings, error: null });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "loadSettings" },
          "warn",
        );
        set({ error: e instanceof Error ? e.message : "加载语音设置失败" });
      }
    },

    updateSettings: async (updates) => {
      const { settings } = get();
      if (!settings) return;
      set({ isProcessing: true, error: null });
      try {
        const updated = await voiceService.updateSettings({
          ...settings,
          ...updates,
        });
        set({ settings: updated });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "updateSettings" },
          "warn",
        );
        set({ error: e instanceof Error ? e.message : "更新语音设置失败" });
      } finally {
        set({ isProcessing: false });
      }
    },

    connectWebSocket: async () => {
      try {
        await connectVoiceWebSocket();
        set({ wsConnected: true, sessionState: "connected" });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "connectWebSocket" },
          "warn",
        );
        set({ wsConnected: false });
      }
    },

    disconnectWebSocket: () => {
      disconnectVoiceWebSocket();
      set({ wsConnected: false, sessionState: "idle" });
    },

    startRecording: async () => {
      set({ isRecording: true, error: null, audioLevel: 0 });
      try {
        if (!get().wsConnected) {
          await get().connectWebSocket();
        }

        const session = await voiceService.startSession();
        set({ currentSession: session, sessionState: "active" });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "startRecording" },
          "warn",
        );
        set({
          error: e instanceof Error ? e.message : "开始录音失败",
          isRecording: false,
        });
      }
    },

    stopRecording: async () => {
      const { currentSession } = get();
      if (!currentSession) {
        set({ isRecording: false });
        return;
      }
      set({ isRecording: false, isProcessing: true });
      try {
        await voiceService.endSession(currentSession.id);
        set({ currentSession: null });

        get().disconnectWebSocket();
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "stopRecording" },
          "warn",
        );
        set({ error: e instanceof Error ? e.message : "停止录音失败" });
      } finally {
        set({ isProcessing: false });

        const { wakeWordEnabled } = get();
        if (wakeWordEnabled) {
          set({ wakeWordListening: true, wakeWordTriggered: null });
        }
      }
    },

    playResponse: async (audioUrl) => {
      try {
        set({ isPlaying: true });
        const audio = new Audio(audioUrl);
        audio.onended = () => set({ isPlaying: false });
        audio.onerror = () => {
          set({ isPlaying: false, error: "音频播放失败" });
        };
        await audio.play();
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "playResponse" },
          "warn",
        );
        set({ isPlaying: false, error: "音频播放失败" });
      }
    },

    stopPlayback: () => {
      set({ isPlaying: false });
    },

    clearError: () => set({ error: null }),

    // ---- Wake Word Actions ----
    toggleWakeWord: async () => {
      const { wakeWordEnabled } = get();
      const newEnabled = !wakeWordEnabled;
      set({ wakeWordEnabled: newEnabled });

      if (newEnabled) {
        try {
          // 加固部署鉴权专项（2026-08-30）：原裸 fetch("/v1/voice/wake/start")——
          // Tauri 下相对路径到不了后端 + 无 X-API-Key 必 401。改走 apiHttp（proxyFetch 注入密钥）。
          const res = await apiHttp.post<{ status: string }>(
            "/v1/voice/wake/start",
          );
          if (res.ok) {
            set({ wakeWordListening: res.data?.status === "listening" });

            await get().connectWakeWordWebSocket();
          }
        } catch (e) {
          handleClientError(
            e,
            { module: "stores:voiceStore", action: "toggleWakeWord:start" },
            "warn",
          );
          set({ wakeWordEnabled: false, wakeWordListening: false });
        }
      } else {
        try {
          await apiHttp.post("/v1/voice/wake/stop");
        } catch (e) {
          handleClientError(
            e,
            { module: "stores:voiceStore", action: "toggleWakeWord:stop" },
            "warn",
          );
        }
        get().disconnectWakeWordWebSocket();
        set({ wakeWordListening: false, wakeWordTriggered: null });
      }
    },

    setWakeWordTriggers: async (triggers) => {
      set({ wakeWordTriggers: triggers });
      try {
        await apiHttp.post("/v1/voice/wake/start", { triggers });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "setWakeWordTriggers" },
          "warn",
        );
      }
    },

    connectWakeWordWebSocket: async () => {
      try {
        await connectWakeWordWebSocket();
        set({ wakeWsConnected: true });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "connectWakeWordWebSocket" },
          "warn",
        );
        set({ wakeWsConnected: false });
      }
    },

    disconnectWakeWordWebSocket: () => {
      disconnectWakeWordWebSocket(true);
      set({ wakeWsConnected: false });
    },

    // ---- TTS Actions ----
    loadTTSProviders: async () => {
      try {
        const providers = await voiceService.getTTSProviders();
        set({ ttsProviders: providers });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "loadTTSProviders" },
          "warn",
        );
      }
    },

    loadTTSVoices: async (provider) => {
      try {
        const voices = await voiceService.getVoices(provider);
        set({ ttsVoices: voices });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:voiceStore", action: "loadTTSVoices" },
          "warn",
        );
      }
    },

    checkTTSHealth: async () => {
      const health = await voiceService.checkTTSHealth();
      set({ ttsHealth: health });
    },
  };
});
