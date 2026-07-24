import { useTranslation } from "react-i18next";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:voiceInput");
import { useVoiceStore } from "../stores/voiceStore";
import { voiceService } from "../services/voiceService";
import { handleClientError } from "../utils/handleError";

// 浏览器 SpeechRecognition API 类型声明（非标准 API，手动补充）
declare class SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface VoiceInputButtonProps {
  isDark: boolean;
  /** 转录完成后回调，将文字填入聊天输入框 */
  onTranscribed?: (text: string) => void;
  /** 浏览器 SpeechRecognition 语言（默认中文） */
  subtitleLang?: string;
  /** 转录完成后自动触发提交（为 true 时需同时提供 onShouldSubmit） */
  autoSubmit?: boolean;
  /** 自动提交回调，仅 autoSubmit=true 时有效 */
  onShouldSubmit?: (text: string) => void;
}

/** VoiceInputButton 暴露的句柄，用于外部触发录音/停止 */
export interface VoiceInputHandle {
  start(): void;
  stop(): void;
}

/**
 * 语音输入按钮
 *
 * 按住录音 → 松手后自动调用后端 STT 转文字 → 通过 onTranscribed 回调传出。
 * 录音前会检测麦克风健康状态（静音/低音量/无设备/权限拒绝）。
 * 集成音频电平可视化，支持 pulsating 动画反馈。
 */
const VoiceInputButton = forwardRef<VoiceInputHandle, VoiceInputButtonProps>(
  (
    {
      isDark,
      onTranscribed,
      subtitleLang = "zh-CN",
      autoSubmit = false,
      onShouldSubmit,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const {
      isRecording,
      isProcessing,
      audioLevel,
      startRecording,
      stopRecording,
    } = useVoiceStore();

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const analyzerRef = useRef<AudioContext | null>(null);
    const animationRef = useRef<number | null>(null);
    const recognitionRef = useRef<InstanceType<
      typeof SpeechRecognition
    > | null>(null);
    const [micWarning, setMicWarning] = useState<string | null>(null);

    /** 浏览器 SpeechRecognition 是否可用 */
    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

    useEffect(() => {
      return () => {
        stopAudioAnalysis();
        cleanupStream();
        stopSubtitleRecognition();
      };
    }, []);

    /** 清理音频流 */
    const cleanupStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    /** 停止音频电平分析 */
    const stopAudioAnalysis = () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (analyzerRef.current) {
        analyzerRef.current.close();
        analyzerRef.current = null;
      }
    };

    /**
     * 启动音频电平分析
     * 用 AnalyserNode 采集频域数据，归一化后写入 store
     */
    const startAudioAnalysis = (stream: MediaStream) => {
      const audioContext = new AudioContext();
      analyzerRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);

      const dataArray = new Uint8Array(analyzer.frequencyBinCount);

      const updateLevel = () => {
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const normalizedLevel = Math.min(100, (average / 128) * 100);
        useVoiceStore.setState({ audioLevel: normalizedLevel });
        animationRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    };

    /**
     * 启动浏览器原生 SpeechRecognition 获取实时字幕
     * 仅在录音时同步启用，松手后自动停止
     */
    const startSubtitleRecognition = useCallback(() => {
      if (!hasSpeechRecognition) return;

      // 清除旧的字幕状态
      useVoiceStore.setState({
        interimText: "",
        finalText: "",
        subtitleStatus: "listening",
      });

      try {
        const SpeechRecognitionAPI =
          (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognitionAPI() as SpeechRecognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = subtitleLang;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          let final = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }

          useVoiceStore.setState({
            interimText: interim,
            finalText: final || useVoiceStore.getState().finalText,
            subtitleStatus: "listening",
          });
        };

        recognition.onerror = () => {
          // SpeechRecognition 出错时不中断录音，静默降级
          useVoiceStore.setState({
            subtitleStatus: "idle",
          });
        };

        recognition.onend = () => {
          // 自动重连：如果还在录音中，重启识别
          if (useVoiceStore.getState().isRecording) {
            try {
              recognition.start();
            } catch (e) {
              handleClientError(e, {
                module: "components:voice:VoiceInput",
                action: "recognitionRestart",
              });
              // 忽略重启失败
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        handleClientError(e, {
          module: "components:voice:VoiceInput",
          action: "startSubtitleRecognition",
        });
        // SpeechRecognition 初始化失败，静默降级
        useVoiceStore.setState({ subtitleStatus: "idle" });
      }
    }, [hasSpeechRecognition, subtitleLang]);

    /**
     * 停止浏览器 SpeechRecognition
     */
    const stopSubtitleRecognition = useCallback(() => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          handleClientError(e, {
            module: "components:voice:VoiceInput",
            action: "stopSubtitleRecognition",
          });
          // 忽略停止错误
        }
        recognitionRef.current = null;
      }
    }, []);

    /** 暴露给父组件的录音控制方法 */
    useImperativeHandle(ref, () => ({
      start: handleMouseDown,
      stop: handleMouseUp,
    }));

    /**
     * 麦克风健康检测
     * 采集 500ms 样本计算平均能量，判断麦克风状态
     */
    const checkMicHealth = useCallback(async (): Promise<{
      ok: boolean;
      warning?: string;
    }> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        // 采集 500ms 样本，计算平均能量
        const samples: number[] = [];
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 50));
          analyser.getByteFrequencyData(dataArray);
          samples.push(dataArray.reduce((a, b) => a + b, 0) / dataArray.length);
        }
        const avgLevel = samples.reduce((a, b) => a + b, 0) / samples.length;

        // 停止测试流
        stream.getTracks().forEach((t) => t.stop());
        audioContext.close();

        useVoiceStore.setState({
          micStatus: {
            status:
              avgLevel >= 5 ? "ok" : avgLevel >= 1 ? "low_volume" : "muted",
            audioLevel: Math.round(avgLevel * 10),
          },
        });

        if (avgLevel < 1) {
          return {
            ok: true,
            warning: t("voice.muted"),
          };
        }
        if (avgLevel < 5) {
          return {
            ok: true,
            warning: t("voice.lowVolume"),
          };
        }
        return { ok: true };
      } catch (err) {
        if ((err as DOMException).name === "NotAllowedError") {
          useVoiceStore.setState({
            micStatus: { status: "permission_denied", audioLevel: 0 },
          });
          return { ok: false, warning: t("voice.micPermissionDenied") };
        }
        useVoiceStore.setState({
          micStatus: { status: "no_device", audioLevel: 0 },
        });
        return { ok: false, warning: "未检测到麦克风，请连接麦克风设备" };
      }
    }, []);

    /**
     * 开始录音
     * 先检测麦克风健康，通过后启动 MediaRecorder + 电平分析
     */
    const handleMouseDown = async () => {
      setMicWarning(null);

      // 麦克风健康检测
      const health = await checkMicHealth();
      if (!health.ok) {
        setMicWarning(health.warning ?? null);
        return;
      }
      if (health.warning) {
        setMicWarning(health.warning);
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;
        audioChunksRef.current = [];

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        mediaRecorderRef.current = recorder;

        // 收集音频数据块
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          cleanupStream();
          stopAudioAnalysis();
          useVoiceStore.setState({ audioLevel: 0 });

          // 收集完整音频 Blob
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm",
          });
          audioChunksRef.current = [];

          // 有音频数据且有关联回调 → 调用后端 STT
          if (audioBlob.size > 0 && onTranscribed) {
            useVoiceStore.setState({ isProcessing: true });
            try {
              // 从设置中读取用户选择的 STT 引擎
              const sttProviderId =
                useVoiceStore.getState().settings?.config?.sttProviderId;
              const result = await voiceService.transcribe(audioBlob, {
                providerId: sttProviderId || undefined,
              });
              if (result.text && result.text.trim()) {
                onTranscribed(result.text);
                // 自动提交模式：转录完成后触发提交
                if (autoSubmit && onShouldSubmit) {
                  onShouldSubmit(result.text);
                }
                // 后端 STT 成功，标记字幕完成
                useVoiceStore.setState({ subtitleStatus: "done" });
              }
            } catch (err) {
              logger.error("语音转录失败", err);
              useVoiceStore.setState({
                error:
                  err instanceof Error ? err.message : t("voice.sttFailed"),
                subtitleStatus: "idle",
              });
            } finally {
              useVoiceStore.setState({ isProcessing: false });
            }
          } else {
            // 无音频数据或无回调，字幕直接结束
            useVoiceStore.setState({ subtitleStatus: "idle" });
          }
        };

        recorder.start();
        await startRecording();
        startAudioAnalysis(stream);
        // 同步启动浏览器 SpeechRecognition 获取实时字幕
        startSubtitleRecognition();
      } catch (e) {
        logger.error("无法启动录音", e);
        setMicWarning(t("voice.micAccessFailed"));
      }
    };

    /**
     * 停止录音
     */
    const handleMouseUp = async () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "recording"
      ) {
        mediaRecorderRef.current.stop();
        await stopRecording();
        // 停止浏览器 SpeechRecognition
        stopSubtitleRecognition();
        // 标记字幕状态为处理中（等待后端 STT 结果）
        useVoiceStore.setState({ subtitleStatus: "processing" });
      }
    };

    const pulseScale = isRecording ? 1 + (audioLevel / 100) * 0.3 : 1;

    return (
      <div className="relative">
        {/* 麦克风警告提示 */}
        {micWarning && !isRecording && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-48 px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded shadow whitespace-nowrap">
            {micWarning}
          </div>
        )}
        <button
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={isRecording ? handleMouseUp : undefined}
          disabled={isProcessing}
          className={`relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-150 ${
            isProcessing
              ? isDark
                ? "bg-gray-700 cursor-not-allowed"
                : "bg-gray-300 cursor-not-allowed"
              : isRecording
                ? "bg-red-500 hover:bg-red-600"
                : isDark
                  ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                  : "bg-gray-200 hover:bg-gray-300 text-gray-600"
          }`}
          style={{ transform: `scale(${pulseScale})` }}
          title={
            isProcessing
              ? "语音识别中..."
              : isRecording
                ? "松开发送"
                : "按住说话"
          }
        >
          {isProcessing ? (
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : isRecording ? (
            <svg
              className="w-5 h-5 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}

          {isRecording && (
            <span
              className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30"
              style={{ animationDuration: "1s" }}
            />
          )}
        </button>
      </div>
    );
  },
);

export default VoiceInputButton;
