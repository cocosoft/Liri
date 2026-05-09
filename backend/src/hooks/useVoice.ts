/**
 * 语音输入Hook
 * 基于CC源码 cc_code/backend/hooks/useVoice.ts 实现
 *
 * 支持语音识别和语音合成功能
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 语音状态
 */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * 语音识别结果
 */
export interface VoiceRecognitionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
}

/**
 * 语音配置
 */
export interface VoiceConfig {
  /** 语言代码 */
  language: string;
  /** 是否启用连续识别 */
  continuous: boolean;
  /** 是否自动停止 */
  autoStop: boolean;
  /** 静音超时（毫秒） */
  silenceTimeout: number;
}

/**
 * useVoice Hook结果
 */
export interface UseVoiceResult {
  /** 当前状态 */
  state: VoiceState;
  /** 语音识别文本 */
  transcript: string;
  /** 识别结果列表 */
  results: VoiceRecognitionResult[];
  /** 是否支持语音 */
  isSupported: boolean;
  /** 开始监听 */
  startListening: () => void;
  /** 停止监听 */
  stopListening: () => void;
  /** 清除文本 */
  clear: () => void;
  /** 语音合成 */
  speak: (text: string) => void;
  /** 停止语音合成 */
  stopSpeaking: () => void;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: VoiceConfig = {
  language: 'zh-CN',
  continuous: false,
  autoStop: true,
  silenceTimeout: 2000,
};

/**
 * useVoice Hook
 * @param config 语音配置
 * @returns 语音状态和操作方法
 */
export function useVoice(config: Partial<VoiceConfig> = {}): UseVoiceResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [results, setResults] = useState<VoiceRecognitionResult[]>([]);
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // 检查浏览器支持
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition && !!window.speechSynthesis);
  }, []);

  // 创建识别器
  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = mergedConfig.language;
    recognition.continuous = mergedConfig.continuous;
    recognition.interimResults = true;

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [isSupported, mergedConfig.language, mergedConfig.continuous]);

  // 设置识别事件监听
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
          setResults((prev) => [
            ...prev,
            {
              text: transcript,
              confidence: event.results[i][0].confidence,
              isFinal: true,
            },
          ]);
        } else {
          interimTranscript += transcript;
        }
      }

      setTranscript((prev) => {
        const newTranscript = finalTranscript || prev + interimTranscript;
        return newTranscript.trim();
      });

      // 重置静音计时器
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      if (mergedConfig.autoStop && finalTranscript) {
        silenceTimerRef.current = setTimeout(() => {
          recognition.stop();
        }, mergedConfig.silenceTimeout);
      }
    };

    recognition.onerror = (event: SpeechRecognitionError) => {
      logger.error('语音识别错误:', { event: event.error });
      setState('idle');
    };

    recognition.onend = () => {
      setState('idle');
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    };
  }, [mergedConfig.autoStop, mergedConfig.silenceTimeout]);

  // 开始监听
  const startListening = useCallback(() => {
    if (!isSupported || state !== 'idle') return;

    setState('listening');
    recognitionRef.current?.start();
  }, [isSupported, state]);

  // 停止监听
  const stopListening = useCallback(() => {
    if (state !== 'listening') return;

    setState('processing');
    recognitionRef.current?.stop();
  }, [state]);

  // 清除文本
  const clear = useCallback(() => {
    setTranscript('');
    setResults([]);
  }, []);

  // 语音合成
  const speak = useCallback(
    (text: string) => {
      if (!isSupported) return;

      setState('speaking');

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = mergedConfig.language;
      utteranceRef.current = utterance;

      utterance.onend = () => {
        setState('idle');
      };

      utterance.onerror = () => {
        setState('idle');
      };

      window.speechSynthesis.speak(utterance);
    },
    [isSupported, mergedConfig.language]
  );

  // 停止语音合成
  const stopSpeaking = useCallback(() => {
    if (state !== 'speaking') return;

    window.speechSynthesis.cancel();
    setState('idle');
  }, [state]);

  return {
    state,
    transcript,
    results,
    isSupported,
    startListening,
    stopListening,
    clear,
    speak,
    stopSpeaking,
  };
}
