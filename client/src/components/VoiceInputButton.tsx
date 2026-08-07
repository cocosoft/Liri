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
import { getSupportedMimeType, getRecordedBlobType } from "../utils/audioMime";
import { getPcmWorkletUrl, PCM_WORKLET_PROCESSOR } from "../utils/pcmWorklet";

const logger = createLogger("components:voiceInput");
import { useVoiceStore } from "../stores/voiceStore";
import {
  voiceService,
  createSTTStream,
  type STTStreamClient,
} from "../services/voiceService";
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
    /** 按住说话已录制秒数（电平可视化增强） */
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const recordingStartRef = useRef<number | null>(null);

    // 3.4/P1-1：流式 STT（字幕与最终转录统一走后端链路）
    const sttStreamRef = useRef<STTStreamClient | null>(null);
    const pcmCollectorRef = useRef<{ stop: () => void } | null>(null);
    const streamingActiveRef = useRef(false);
    /** 停止请求标记：async 采集器启动期间（worklet 加载等）用户已松手 → 避免 AudioContext 泄漏 */
    const stopRequestedRef = useRef(false);
    const finalTextRef = useRef("");

    /** 浏览器 SpeechRecognition 是否可用 */
    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

    useEffect(() => {
      return () => {
        stopAudioAnalysis();
        cleanupStream();
        stopSubtitleRecognition();
        recordingStartRef.current = null;
        // 3.4/P1-1：组件卸载时关闭流式 STT 连接
        streamingActiveRef.current = false;
        stopRequestedRef.current = true;
        pcmCollectorRef.current?.stop();
        pcmCollectorRef.current = null;
        sttStreamRef.current?.close();
        sttStreamRef.current = null;
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
        // 顺带更新已录制时长（rAF 循环中计算，避免额外定时器）
        if (recordingStartRef.current) {
          setRecordingSeconds(
            Math.floor((Date.now() - recordingStartRef.current) / 1000),
          );
        }
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

    /**
     * 3.4/P1-1 + 3.1 推荐项：PCM16 采集（AudioWorklet 优先，ScriptProcessorNode 降级）
     * 将麦克风流降采样为 16kHz mono PCM16 原始字节，逐块推给流式 STT。
     * AudioWorklet 独立线程处理减少主线程压力；运行环境不支持（addModule 失败）
     * 或模块加载失败时回退 ScriptProcessorNode（兼容 WKWebView/Firefox）。
     */
    const startPcmCollector = async (
      stream: MediaStream,
    ): Promise<{ stop: () => void }> => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);

      // AudioWorklet 优先
      const workletUrl = getPcmWorkletUrl();
      if (workletUrl) {
        try {
          await audioContext.audioWorklet.addModule(workletUrl);
          const node = new AudioWorkletNode(
            audioContext,
            PCM_WORKLET_PROCESSOR,
          );
          node.port.onmessage = (e: MessageEvent) => {
            sttStreamRef.current?.sendPcm(new Uint8Array(e.data));
          };
          source.connect(node);
          logger.debug("PCM 采集使用 AudioWorklet");
          return {
            stop: () => {
              try {
                node.port.close();
                node.disconnect();
                source.disconnect();
                audioContext.close();
              } catch {
                // 停止采集失败不影响主流程
              }
            },
          };
        } catch (err) {
          logger.warn("AudioWorklet 初始化失败，降级 ScriptProcessorNode", err);
        }
      }

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        sttStreamRef.current?.sendPcm(new Uint8Array(pcm.buffer));
      };

      return {
        stop: () => {
          try {
            processor.disconnect();
            source.disconnect();
            audioContext.close();
          } catch {
            // 停止采集失败不影响主流程
          }
        },
      };
    };

    /** 3.4/P1-1：结束流式 STT（发 finalize，结果由 onFinal 回调处理） */
    const stopStreamingSTT = () => {
      stopRequestedRef.current = true;
      pcmCollectorRef.current?.stop();
      pcmCollectorRef.current = null;
      sttStreamRef.current?.finalize();
      // 连接保留到 onFinal 到达后关闭（避免 final 帧丢失）
    };

    /**
     * 3.4/P1-1：启动流式 STT（字幕与最终转录统一走后端）
     * 流式不可用时降级到浏览器 SpeechRecognition（保留降级开关）。
     */
    const startStreamingSTT = async (stream: MediaStream) => {
      // 新一轮录音启动，清除上一轮可能残留的停止请求标记
      stopRequestedRef.current = false;
      // 3.4 降级开关：关闭流式时直接用浏览器 SpeechRecognition
      const useStreaming =
        useVoiceStore.getState().settings?.config?.useStreamingSTT !== false;

      if (!useStreaming) {
        startSubtitleRecognition();
        return;
      }

      try {
        const settings = useVoiceStore.getState().settings?.config;
        const sttStream = await createSTTStream({
          language: settings?.sttLanguage || subtitleLang.split("-")[0],
          providerId: settings?.sttProviderId || undefined,
        });
        if (stopRequestedRef.current) {
          // 连接建立期间用户已松手 → 直接关闭，不启动采集
          sttStream.close();
          return;
        }
        sttStreamRef.current = sttStream;

        sttStream.onInterim((text) => {
          if (!streamingActiveRef.current) return;
          if (text) {
            useVoiceStore.setState({
              interimText: text,
              subtitleStatus: "listening",
            });
          }
        });

        sttStream.onFinal((text) => {
          if (!streamingActiveRef.current) return;
          stopRequestedRef.current = true;
          // 转录完成即停采集器：后端自动 final（如静音检测）时用户未松手，
          // handleMouseUp 不会走 stopStreamingSTT，此处必须主动回收，避免 AudioContext 空转。
          // 正常路径（stopStreamingSTT 已 stop）下重复调用幂等无害。
          pcmCollectorRef.current?.stop();
          pcmCollectorRef.current = null;
          finalTextRef.current = text;
          useVoiceStore.setState({
            interimText: "",
            finalText: text,
            subtitleStatus: text ? "done" : "idle",
          });
          if (text) {
            onTranscribed?.(text);
            if (autoSubmit && onShouldSubmit) {
              onShouldSubmit(text);
            }
          }
          // 转录完成，关闭连接
          sttStreamRef.current?.close();
          sttStreamRef.current = null;
          streamingActiveRef.current = false;
        });

        sttStream.onError((err) => {
          logger.warn("流式 STT 错误，降级到浏览器识别", err);
          stopRequestedRef.current = true;
          sttStreamRef.current?.close();
          sttStreamRef.current = null;
          streamingActiveRef.current = false;
          pcmCollectorRef.current?.stop();
          pcmCollectorRef.current = null;
          startSubtitleRecognition();
        });

        streamingActiveRef.current = true;
        pcmCollectorRef.current = await startPcmCollector(stream);
        // 竞态保护：await worklet 加载期间用户已松手（stopRequestedRef 已置位）
        // → 立即回收采集器，避免 AudioContext / worklet 节点泄漏。
        // 不重置 streamingActiveRef：stopStreamingSTT 已发 finalize，
        // onFinal 仍会到达并完成 UI 收尾（done/idle）。
        if (stopRequestedRef.current && pcmCollectorRef.current) {
          pcmCollectorRef.current.stop();
          pcmCollectorRef.current = null;
        }
      } catch (err) {
        // 流式 STT 不可用（后端未启用/连接失败）→ 降级
        logger.warn("流式 STT 启动失败，降级到浏览器 SpeechRecognition", err);
        streamingActiveRef.current = false;
        startSubtitleRecognition();
      }
    };

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

        const recorder = new MediaRecorder(stream, {
          mimeType: getSupportedMimeType(),
        });
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
          recordingStartRef.current = null;
          setRecordingSeconds(0);

          // 3.4/P1-1：流式路径 —— 最终转录由 onFinal 回调处理，不重复文件级转写
          if (streamingActiveRef.current) {
            useVoiceStore.setState({ subtitleStatus: "processing" });
            return;
          }

          // 收集完整音频 Blob（格式与录音一致，供后端嗅探）
          const audioBlob = new Blob(audioChunksRef.current, {
            type: getRecordedBlobType(),
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
        recordingStartRef.current = Date.now();
        setRecordingSeconds(0);
        await startRecording();
        startAudioAnalysis(stream);
        // 3.4/P1-1：启动流式 STT（字幕与最终转录统一走后端；不可用时降级浏览器 SpeechRecognition）
        startStreamingSTT(stream);
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

        // 3.4/P1-1：无论流式是否已启动，都标记停止请求。
        // 若 startStreamingSTT 仍在 await（createSTTStream / worklet 加载），
        // 由 startStreamingSTT 内部的 stopRequestedRef 检查完成清理。
        stopRequestedRef.current = true;

        // 3.4/P1-1：流式路径 → finalize 获取最终转录；降级路径 → 停止浏览器 SpeechRecognition
        if (streamingActiveRef.current) {
          stopStreamingSTT();
          // finalize 已由 stopStreamingSTT 之前的 onFinal 链路处理
          useVoiceStore.setState({ subtitleStatus: "processing" });
        } else {
          stopSubtitleRecognition();
          // 标记字幕状态为处理中（等待后端 STT 结果）
          useVoiceStore.setState({ subtitleStatus: "processing" });
        }
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
        {/* 录音时长徽章（按住说话时显示） */}
        {isRecording && (
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums rounded-full bg-red-500/90 text-white shadow">
            {recordingSeconds}s
          </span>
        )}
        {/* 电平指示环（实时音量可视化） */}
        {isRecording && (
          <svg
            className="absolute -inset-1 pointer-events-none"
            viewBox="0 0 48 48"
            fill="none"
          >
            <circle
              cx="24"
              cy="24"
              r="21"
              className="text-red-500/25"
              stroke="currentColor"
              strokeWidth="3"
            />
            <circle
              cx="24"
              cy="24"
              r="21"
              className="text-red-500"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 21}
              strokeDashoffset={2 * Math.PI * 21 * (1 - audioLevel / 100)}
              transform="rotate(-90 24 24)"
              style={{ transition: "stroke-dashoffset 60ms linear" }}
            />
          </svg>
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
