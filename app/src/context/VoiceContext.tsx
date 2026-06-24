/**
 * 语音上下文（参考CC源码 cc_code/context/voice.tsx）
 * 管理语音输入/输出功能
 *
 * 该 context 将底层的 voiceService（录音/STT/TTS）封装为 React 友好的接口。
 * 组件通过 useVoice() hook 使用语音能力，而非直接操作 voiceService。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import voiceService from '@modules/services/voice';

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
  const [state, setState] = useState<VoiceState>('idle');
  const [isMuted, setIsMuted] = useState(false);

  // 同步语音服务事件到 React state
  useEffect(() => {
    const handleStart = (): void => {
      setState((prev) => {
        if (prev === 'idle') return 'listening';
        return prev;
      });
    };
    const handleStop = (): void => {
      setState('idle');
    };
    const handleError = (): void => {
      setState('idle');
    };

    voiceService.addEventListener('start', handleStart);
    voiceService.addEventListener('stop', handleStop);
    voiceService.addEventListener('error', handleError);

    return () => {
      voiceService.removeEventListener('start', handleStart);
      voiceService.removeEventListener('stop', handleStop);
      voiceService.removeEventListener('error', handleError);
    };
  }, []);

  const startListening = useCallback(() => {
    voiceService.startRecording(
      () => {
        // onData: 实时音频数据回调（当前无需处理，留作电平表扩展）
      },
      () => {
        // onEnd: 录音结束回调
        setState('processing');
      }
    );
    setState('listening');
  }, []);

  const stopListening = useCallback(() => {
    voiceService.stopRecording();
    setState('processing');
  }, []);

  const startSpeaking = useCallback((text: string) => {
    setState('speaking');
    voiceService.speak({ text }).catch(() => {
      setState('idle');
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    voiceService.stopSpeaking();
    setState('idle');
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  return (
    <VoiceContext.Provider
      value={{
        state,
        isListening: state === 'listening',
        isSpeaking: state === 'speaking',
        startListening,
        stopListening,
        startSpeaking,
        stopSpeaking,
        toggleMute,
        isMuted,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = (): VoiceContextType => {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useVoice', provider: 'VoiceProvider' }
    );
  }
  return context;
};
