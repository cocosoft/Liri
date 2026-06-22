/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { VoiceSettings, VoiceSession } from "../services/voiceService";

export type { VoiceSettings, VoiceSession };

/** Voice 状态切片 */
interface VoiceSlice {
  settings: VoiceSettings | null;
  sessions: VoiceSession[];
  currentSession: VoiceSession | null;
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  error: string | null;
  audioLevel: number;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<VoiceSettings>) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  playResponse: (audioUrl: string) => Promise<void>;
  stopPlayback: () => void;
  clearError: () => void;
}

function voiceSlice(s: any): VoiceSlice {
  return {
    settings: s.voiceSettings,
    sessions: s.voiceSessions,
    currentSession: s.voiceCurrentSession,
    isRecording: s.voiceIsRecording,
    isProcessing: s.voiceIsProcessing,
    isPlaying: s.voiceIsPlaying,
    error: s.voiceError,
    audioLevel: s.audioLevel,
    loadSettings: s.loadVoiceSettings,
    updateSettings: s.updateVoiceSettings,
    startRecording: s.startRecording,
    stopRecording: s.stopRecording,
    playResponse: s.playResponse,
    stopPlayback: s.stopPlayback,
    clearError: s.clearVoiceError,
  };
}

export function useVoiceStore(): VoiceSlice;
export function useVoiceStore<T>(selector: (slice: VoiceSlice) => T): T;
export function useVoiceStore(selector?: any): any {
  const settings = useAppStore((s) => s.voiceSettings);
  const sessions = useAppStore((s) => s.voiceSessions);
  const currentSession = useAppStore((s) => s.voiceCurrentSession);
  const isRecording = useAppStore((s) => s.voiceIsRecording);
  const isProcessing = useAppStore((s) => s.voiceIsProcessing);
  const isPlaying = useAppStore((s) => s.voiceIsPlaying);
  const error = useAppStore((s) => s.voiceError);
  const audioLevel = useAppStore((s) => s.audioLevel);
  const loadSettings = useAppStore((s) => s.loadVoiceSettings);
  const updateSettings = useAppStore((s) => s.updateVoiceSettings);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const playResponse = useAppStore((s) => s.playResponse);
  const stopPlayback = useAppStore((s) => s.stopPlayback);
  const clearError = useAppStore((s) => s.clearVoiceError);
  const slice: VoiceSlice = { settings, sessions, currentSession, isRecording, isProcessing, isPlaying, error, audioLevel, loadSettings, updateSettings, startRecording, stopRecording, playResponse, stopPlayback, clearError };
  return selector ? selector(slice) : slice;
}

useVoiceStore.getState = () => voiceSlice(useAppStore.getState());
useVoiceStore.setState = (partial: Partial<VoiceSlice>) => {
  useAppStore.setState({
    ...(partial.settings !== undefined && { voiceSettings: partial.settings }),
    ...(partial.sessions !== undefined && { voiceSessions: partial.sessions }),
    ...(partial.currentSession !== undefined && { voiceCurrentSession: partial.currentSession }),
    ...(partial.isRecording !== undefined && { voiceIsRecording: partial.isRecording }),
    ...(partial.isProcessing !== undefined && { voiceIsProcessing: partial.isProcessing }),
    ...(partial.isPlaying !== undefined && { voiceIsPlaying: partial.isPlaying }),
    ...(partial.error !== undefined && { voiceError: partial.error }),
    ...(partial.audioLevel !== undefined && { audioLevel: partial.audioLevel }),
  } as any);
};
