import { create } from "zustand";
import {
  voiceService,
  type VoiceSettings,
  type VoiceSession,
} from "../services/voiceService";

interface VoiceStore {
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

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  settings: null,
  sessions: [],
  currentSession: null,
  isRecording: false,
  isProcessing: false,
  isPlaying: false,
  error: null,
  audioLevel: 0,

  loadSettings: async () => {
    try {
      const settings = await voiceService.getSettings();
      set({ settings, error: null });
    } catch (e) {
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
      set({ error: e instanceof Error ? e.message : "更新语音设置失败" });
    } finally {
      set({ isProcessing: false });
    }
  },

  startRecording: async () => {
    set({ isRecording: true, error: null, audioLevel: 0 });
    try {
      const session = await voiceService.startSession();
      set({ currentSession: session });
    } catch (e) {
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
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "停止录音失败" });
    } finally {
      set({ isProcessing: false });
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
      set({ isPlaying: false, error: "音频播放失败" });
    }
  },

  stopPlayback: () => {
    set({ isPlaying: false });
  },

  clearError: () => set({ error: null }),
}));

export { voiceService } from "../services/voiceService";
