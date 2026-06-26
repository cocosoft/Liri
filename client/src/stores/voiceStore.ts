/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore, type SubtitleEntry } from "./appStore";
import type { VoiceSettings, VoiceSession } from "../services/voiceService";

export type { VoiceSettings, VoiceSession };
export type { SubtitleEntry };

/** Voice 状态切片 */
interface VoiceSlice {
  settings: VoiceSettings | null;
  sessions: VoiceSession[];
  currentSession: VoiceSession | null;
  sessionState: string;
  wsConnected: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  error: string | null;
  voiceError: string | null;
  audioLevel: number;
  micStatus: { status: string; audioLevel: number } | null;

  // === 字幕状态 ===
  interimText: string;
  finalText: string;
  subtitleHistory: SubtitleEntry[];
  subtitleStatus: "idle" | "listening" | "processing" | "done";

  // === 唤醒状态 ===
  wakeWordEnabled: boolean;
  wakeWordTriggers: string[];
  wakeWordListening: boolean;
  wakeWordTriggered: string | null;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<VoiceSettings>) => Promise<void>;
  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  playResponse: (audioUrl: string) => Promise<void>;
  stopPlayback: () => void;
  clearError: () => void;
  toggleWakeWord: () => Promise<void>;
  setWakeWordTriggers: (triggers: string[]) => Promise<void>;
}

function voiceSlice(s: any): VoiceSlice {
  return {
    settings: s.voiceSettings,
    sessions: s.voiceSessions,
    currentSession: s.voiceCurrentSession,
    sessionState: s.voiceSessionState,
    wsConnected: s.voiceWsConnected,
    isRecording: s.voiceIsRecording,
    isProcessing: s.voiceIsProcessing,
    isPlaying: s.voiceIsPlaying,
    error: s.voiceError,
    voiceError: s.voiceError,
    audioLevel: s.audioLevel,
    micStatus: s.micStatus,
    interimText: s.interimText,
    finalText: s.finalText,
    subtitleHistory: s.subtitleHistory,
    subtitleStatus: s.subtitleStatus,
    wakeWordEnabled: s.wakeWordEnabled,
    wakeWordTriggers: s.wakeWordTriggers,
    wakeWordListening: s.wakeWordListening,
    wakeWordTriggered: s.wakeWordTriggered,
    loadSettings: s.loadVoiceSettings,
    updateSettings: s.updateVoiceSettings,
    connectWebSocket: s.connectVoiceWebSocket,
    disconnectWebSocket: s.disconnectVoiceWebSocket,
    startRecording: s.startRecording,
    stopRecording: s.stopRecording,
    playResponse: s.playResponse,
    stopPlayback: s.stopPlayback,
    clearError: s.clearVoiceError,
    toggleWakeWord: s.toggleWakeWord,
    setWakeWordTriggers: s.setWakeWordTriggers,
  };
}

export function useVoiceStore(): VoiceSlice;
export function useVoiceStore<T>(selector: (slice: VoiceSlice) => T): T;
export function useVoiceStore(selector?: any): any {
  const settings = useAppStore((s) => s.voiceSettings);
  const sessions = useAppStore((s) => s.voiceSessions);
  const currentSession = useAppStore((s) => s.voiceCurrentSession);
  const sessionState = useAppStore((s) => s.voiceSessionState);
  const wsConnected = useAppStore((s) => s.voiceWsConnected);
  const isRecording = useAppStore((s) => s.voiceIsRecording);
  const isProcessing = useAppStore((s) => s.voiceIsProcessing);
  const isPlaying = useAppStore((s) => s.voiceIsPlaying);
  const error = useAppStore((s) => s.voiceError);
  const voiceError = useAppStore((s) => s.voiceError);
  const audioLevel = useAppStore((s) => s.audioLevel);
  const micStatus = useAppStore((s) => s.micStatus);
  const interimText = useAppStore((s) => s.interimText);
  const finalText = useAppStore((s) => s.finalText);
  const subtitleHistory = useAppStore((s) => s.subtitleHistory);
  const subtitleStatus = useAppStore((s) => s.subtitleStatus);
  const wakeWordEnabled = useAppStore((s) => s.wakeWordEnabled);
  const wakeWordTriggers = useAppStore((s) => s.wakeWordTriggers);
  const wakeWordListening = useAppStore((s) => s.wakeWordListening);
  const wakeWordTriggered = useAppStore((s) => s.wakeWordTriggered);
  const loadSettings = useAppStore((s) => s.loadVoiceSettings);
  const updateSettings = useAppStore((s) => s.updateVoiceSettings);
  const connectWebSocket = useAppStore((s) => s.connectVoiceWebSocket);
  const disconnectWebSocket = useAppStore((s) => s.disconnectVoiceWebSocket);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const playResponse = useAppStore((s) => s.playResponse);
  const stopPlayback = useAppStore((s) => s.stopPlayback);
  const clearError = useAppStore((s) => s.clearVoiceError);
  const toggleWakeWord = useAppStore((s) => s.toggleWakeWord);
  const setWakeWordTriggers = useAppStore((s) => s.setWakeWordTriggers);
  const slice: VoiceSlice = { settings, sessions, currentSession, sessionState, wsConnected, isRecording, isProcessing, isPlaying, error, voiceError, audioLevel, micStatus, interimText, finalText, subtitleHistory, subtitleStatus, wakeWordEnabled, wakeWordTriggers, wakeWordListening, wakeWordTriggered, loadSettings, updateSettings, connectWebSocket, disconnectWebSocket, startRecording, stopRecording, playResponse, stopPlayback, clearError, toggleWakeWord, setWakeWordTriggers };
  return selector ? selector(slice) : slice;
}

useVoiceStore.getState = () => voiceSlice(useAppStore.getState());
useVoiceStore.setState = (partial: Partial<VoiceSlice>) => {
  useAppStore.setState({
    ...(partial.settings !== undefined && { voiceSettings: partial.settings }),
    ...(partial.sessions !== undefined && { voiceSessions: partial.sessions }),
    ...(partial.currentSession !== undefined && { voiceCurrentSession: partial.currentSession }),
    ...(partial.isRecording !== undefined && { voiceIsRecording: partial.isRecording }),
    ...(partial.sessionState !== undefined && { voiceSessionState: partial.sessionState }),
    ...(partial.wsConnected !== undefined && { voiceWsConnected: partial.wsConnected }),
    ...(partial.isProcessing !== undefined && { voiceIsProcessing: partial.isProcessing }),
    ...(partial.isPlaying !== undefined && { voiceIsPlaying: partial.isPlaying }),
    ...(partial.error !== undefined && { voiceError: partial.error }),
    ...(partial.voiceError !== undefined && { voiceError: partial.voiceError }),
    ...(partial.audioLevel !== undefined && { audioLevel: partial.audioLevel }),
    ...(partial.micStatus !== undefined && { micStatus: partial.micStatus }),
    ...(partial.interimText !== undefined && { interimText: partial.interimText }),
    ...(partial.finalText !== undefined && { finalText: partial.finalText }),
    ...(partial.subtitleHistory !== undefined && { subtitleHistory: partial.subtitleHistory }),
    ...(partial.subtitleStatus !== undefined && { subtitleStatus: partial.subtitleStatus }),
    ...(partial.wakeWordEnabled !== undefined && { wakeWordEnabled: partial.wakeWordEnabled }),
    ...(partial.wakeWordTriggers !== undefined && { wakeWordTriggers: partial.wakeWordTriggers }),
    ...(partial.wakeWordListening !== undefined && { wakeWordListening: partial.wakeWordListening }),
    ...(partial.wakeWordTriggered !== undefined && { wakeWordTriggered: partial.wakeWordTriggered }),
  } as any);
};
