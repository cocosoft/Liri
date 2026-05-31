import { http } from './httpClient';

export type VoiceProvider = 'gemini' | 'openai' | 'webapi';

export interface STTResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  duration?: number;
  language?: string;
  timing: {
    elapsed: number;
    unit: string;
  };
  provider: {
    id: string;
    name: string;
    type: string;
    available?: boolean;
  } | null;
  status?: string;
}

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
    const response = await http.get<VoiceSettings>('/v1/voice/settings');
    return response;
  },

  async updateSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const response = await http.put<VoiceSettings>('/v1/voice/settings', settings);
    return response;
  },

  async startSession(): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>('/v1/voice/session/start');
    return response;
  },

  async endSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.post<VoiceSession>(`/v1/voice/session/${sessionId}/end`);
    return response;
  },

  async getSessions(limit: number = 20): Promise<{ sessions: VoiceSession[]; total: number }> {
    const response = await http.get<{ sessions: VoiceSession[]; total: number }>(`/v1/voice/sessions?limit=${limit}`);
    return response;
  },

  async getSession(sessionId: string): Promise<VoiceSession> {
    const response = await http.get<VoiceSession>(`/v1/voice/session/${sessionId}`);
    return response;
  },

  async uploadAudio(sessionId: string, audioBlob: Blob): Promise<{ transcript: string; audioUrl?: string }> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('sessionId', sessionId);

    const response = await fetch(`${window.location.origin}/v1/voice/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload audio');
    }

    return response.json();
  },

  async getAudioStream(sessionId: string): Promise<MediaStream> {
    const response = await fetch(`/v1/voice/stream/${sessionId}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    return new MediaStream();
  },

  async synthesizeSpeech(text: string, voiceId?: string): Promise<string> {
    const response = await http.post<{ audioUrl: string }>('/v1/voice/tts', { text, voiceId });
    return response.audioUrl;
  },

  async getProviders(): Promise<VoiceProvider[]> {
    const response = await http.get<VoiceProvider[]>('/v1/voice/providers');
    return response;
  },

  async getVoices(provider: VoiceProvider): Promise<{ id: string; name: string; language: string }[]> {
    const response = await http.get<{ id: string; name: string; language: string }[]>(`/v1/voice/voices?provider=${provider}`);
    return response;
  },

  async testWakeWord(wakeWordId: string): Promise<boolean> {
    const response = await http.post<{ detected: boolean }>(`/v1/voice/wakeword/${wakeWordId}/test`);
    return response.detected;
  },

  /**
   * STT 语音转录
   * 将音频数据发送到后端进行语音识别
   * @param audioBlob 音频 Blob 数据
   * @param options 转录选项
   */
  async transcribe(
    audioBlob: Blob,
    options?: {
      providerId?: string;
      language?: string;
      keyterms?: string[];
    }
  ): Promise<STTResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];

          const response = await http.post<STTResult>('/v1/voice/transcribe', {
            audioData: base64,
            providerId: options?.providerId,
            language: options?.language,
            keyterms: options?.keyterms,
          });

          resolve(response);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('读取音频文件失败'));
      reader.readAsDataURL(audioBlob);
    });
  },
};

export { voiceService };