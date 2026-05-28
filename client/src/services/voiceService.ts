import { http } from './httpClient';

export type VoiceProvider = 'gemini' | 'openai' | 'webapi';

export interface VoiceState {
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  currentSessionId: string | null;
  error: string | null;
}

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
}

export interface WakeWord {
  id: string;
  phrase: string;
  sensitivity: number;
  enabled: boolean;
}

export interface VoiceSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  duration: number | null;
  transcript: string;
  responseAudioUrl: string | null;
  status: 'active' | 'completed' | 'failed';
}

export interface VoiceSettings {
  config: AudioConfig;
  wakeWords: WakeWord[];
  hotkeys: Record<string, string>;
}

const voiceService = {
  async getSettings(): Promise<VoiceSettings> {
    const response = await http.get<VoiceSettings>('/api/voice/settings');
    return response;
  },

  async updateSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const response = await http.put<VoiceSettings>('/api/voice/settings', settings);
    return response;
  },

  async startSession(): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>('/api/voice/session/start');
    return response;
  },

  async endSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>(`/api/voice/session/${sessionId}/end`);
    return response;
  },

  async getSessions(limit: number = 20): Promise<{ sessions: VoiceSession[]; total: number }> {
    const response = await http.get<{ sessions: VoiceSession[]; total: number }>(`/api/voice/sessions?limit=${limit}`);
    return response;
  },

  async getSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.get<VoiceSession>(`/api/voice/session/${sessionId}`);
    return response;
  },

  async uploadAudio(sessionId: string, audioBlob: Blob): Promise<{ transcript: string; audioUrl?: string }> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('sessionId', sessionId);

    const response = await fetch(`${window.location.origin}/api/voice/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload audio');
    }

    return response.json();
  },

  async getAudioStream(sessionId: string): Promise<MediaStream> {
    const response = await fetch(`/api/voice/stream/${sessionId}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    return new MediaStream();
  },

  async synthesizeSpeech(text: string, voiceId?: string): Promise<string> {
    const response = await http.post<{ audioUrl: string }>('/api/voice/tts', { text, voiceId });
    return response.audioUrl;
  },

  async getProviders(): Promise<VoiceProvider[]> {
    const response = await http.get<VoiceProvider[]>('/api/voice/providers');
    return response;
  },

  async getVoices(provider: VoiceProvider): Promise<{ id: string; name: string; language: string }[]> {
    const response = await http.get<{ id: string; name: string; language: string }[]>(`/api/voice/voices?provider=${provider}`);
    return response;
  },

  async testWakeWord(wakeWordId: string): Promise<boolean> {
    const response = await http.post<{ detected: boolean }>(`/api/voice/wakeword/${wakeWordId}/test`);
    return response.detected;
  },
};

export { voiceService };