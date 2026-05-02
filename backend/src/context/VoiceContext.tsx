/**
 * 语音上下文（参考CC源码 cc_code/context/voice.tsx）
 * 管理语音输入/输出功能
 */

import { createContext, useContext, useCallback, ReactNode } from 'react';

export type VoiceState = 'idle' | 'listening' | 'speaking' | 'processing';

export interface VoiceContextType {
  state: VoiceState;
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
  startSpeaking: (text: string) => void;
  stopSpeaking: () => void;
  toggleMute: () => void;
  isMuted: boolean;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const VoiceProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = React.useState<VoiceState>('idle');
  const [isMuted, setIsMuted] = React.useState(false);

  const startListening = useCallback(() => {
    setState('listening');
  }, []);

  const stopListening = useCallback(() => {
    setState('idle');
  }, []);

  const startSpeaking = useCallback((text: string) => {
    setState('speaking');
  }, []);

  const stopSpeaking = useCallback(() => {
    setState('idle');
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  return (
    <VoiceContext.Provider value={{
      state,
      isListening: state === 'listening',
      isSpeaking: state === 'speaking',
      startListening,
      stopListening,
      startSpeaking,
      stopSpeaking,
      toggleMute,
      isMuted,
    }}>
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = (): VoiceContextType => {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
};