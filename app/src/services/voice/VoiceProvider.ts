/**
 * 由 VOICE_MODE feature flag 控制加载
 */
import { FEATURE_FLAGS } from '@modules/core/featureFlags';
const feature = (name: keyof typeof FEATURE_FLAGS) =>
  FEATURE_FLAGS[name] ?? false;

export interface VoiceConfig {
  enabled: boolean;
  inputDevice?: string;
  outputDevice?: string;
  language?: string;
  wakeWord?: string;
}

export interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: string | null;
}

const defaultConfig: VoiceConfig = {
  enabled: false,
  language: 'en-US',
};

let voiceState: VoiceState = {
  isListening: false,
  isSpeaking: false,
  transcript: '',
  error: null,
};

export function isVoiceModeEnabled(): boolean {
  return feature('VOICE_MODE') && defaultConfig.enabled;
}

export function getVoiceConfig(): VoiceConfig {
  return { ...defaultConfig };
}

export function setVoiceConfig(config: Partial<VoiceConfig>): void {
  Object.assign(defaultConfig, config);
}

export function getVoiceState(): VoiceState {
  return { ...voiceState };
}

export function startListening(): void {
  if (!isVoiceModeEnabled()) return;
  voiceState = {
    ...voiceState,
    isListening: true,
    error: null,
    transcript: '',
  };
}

export function stopListening(): void {
  voiceState = { ...voiceState, isListening: false };
}

export function appendTranscript(text: string): void {
  voiceState = { ...voiceState, transcript: voiceState.transcript + text };
}

export class VoiceProvider {
  private config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  get isEnabled(): boolean {
    return feature('VOICE_MODE') && this.config.enabled;
  }

  async requestMicrophonePermission(): Promise<boolean> {
    return this.isEnabled;
  }

  createAudioContext(): VoiceState {
    return getVoiceState();
  }
}
