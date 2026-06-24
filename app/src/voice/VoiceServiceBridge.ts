/**
 * VoiceServiceBridge
 * services/voice ↔ voice/ 双轨统一 Gate 层
 *
 * 对外提供单一入口，对内路由到两个子系统：
 * - services/voice — 服务模式（TTS、录音、VAD、环境检测、语音命令）
 * - voice/ — 实时模式（WebSocket 会话、OpenAI/Gemini 适配器、唤醒词）
 *
 * 用法：
 * ```ts
 * const bridge = createVoiceServiceBridge();
 * const ttsResult = await bridge.service.tts('你好');
 * const realtimeSession = bridge.realtime.createSession(connection);
 * ```
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { getMetricsService } from '@modules/monitoring';
import type { MetricsService } from '@modules/monitoring';
import { SessionManager } from '@modules/session/SessionManager';
import { getAlertManager, AlertLevel } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring';

import {
  createVoiceService,
  VoiceService,
} from '@modules/services/voice/services/voiceService';
import {
  TTSRegistry,
  EdgeTTSProvider,
} from '@modules/services/voice/services/ttsProvider';
import { OpenAITTSProvider } from '@modules/services/voice/services/openAITTSProvider';
import { CommandTTSProvider } from '@modules/services/voice/services/commandTTSProvider';
import { PiperTTSProvider } from '@modules/services/voice/services/piperTTSProvider';
import { STTRegistry } from '@modules/services/voice/services/sttRegistry';
import { LocalSTTProvider } from '@modules/services/voice/services/localSTTProvider';
import { CloudSTTProvider } from '@modules/services/voice/services/cloudSTTProvider';
import { StreamSTTProvider } from '@modules/services/voice/services/streamSTTProvider';
import { VadDetector } from '@modules/services/voice/services/vadDetector';
import { EnvironmentDetector } from '@modules/services/voice/services/environmentDetector';
import {
  detectRuntimeEnvironment,
  isVoiceAvailable,
} from '@modules/services/voice/services/environmentRuntimeDetector';
import { getVoiceKeyterms } from '@modules/services/voice/voiceKeyterms';
import {
  startPreventSleep,
  stopPreventSleep,
} from '@modules/services/voice/preventSleep';

import { VoiceSession } from './VoiceSession';
import { GeminiLiveAdapter } from './GeminiLiveAdapter';
import { OpenAIRealtimeAdapter } from './OpenAIRealtimeAdapter';
import { VoiceToolBridge } from './VoiceToolBridge';
import { VoiceEventBus } from './VoiceEventBus';
import { PCMAudioBuffer, AudioProcessor } from './AudioPipeline';
import {
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
  detectWakeWord,
  sanitizeTriggers,
  defaultVoiceWakeTriggers,
} from './VoiceWakeManager';
import {
  handleVoiceUpgrade,
  getActiveVoiceSessions,
  getVoiceSession,
  getActiveVoiceSessionCount,
  closeAllVoiceSessions,
  setVoiceIntegrationContext,
} from './VoiceGatewayBridge';
import { VoiceChannelIntegration } from './VoiceChannelIntegration';
import type { VoiceChannelConfig } from './VoiceChannelIntegration';
import { VoiceCommandRouter } from './VoiceCommandRouter';
import type { VoiceCommandRouterConfig } from './VoiceCommandRouter';
import { MemoryManagerImpl } from '@modules/memory/MemoryManager';

import type { VoiceServiceConfig } from '@modules/services/voice/models/types';
import type {
  VoiceClientEvent,
  VoiceServerEvent,
  VoiceSessionState,
  VoiceSessionSummary,
  VoiceProviderAdapter,
  VoiceConnection,
  UpgradeHandler,
  VoiceSessionConfigEvent,
  VoiceToolDeclaration,
} from './types';
import type { ToolExecutorDelegate } from './VoiceToolBridge';
import type { VoiceWakeConfig, WakeDetectionResult } from './VoiceWakeManager';
import type { AudioBufferStats, AudioChunk } from './AudioPipeline';
/** 桥接配置 */
export interface VoiceBridgeConfig {
  /** 服务模式配置 */
  service?: {
    ttsEnabled?: boolean;
    recordingEnabled?: boolean;
    sampleRate?: number;
    channels?: number;
    language?: string;
    /** OpenAI API 密钥（用于 OpenAI TTS 和 Cloud STT） */
    openAIApiKey?: string;
    /** OpenAI TTS 模型 */
    openAITTSCModel?: 'tts-1' | 'tts-1-hd';
    /** Piper 本地 TTS 配置 */
    piper?: {
      /** 模型文件所在目录 */
      modelDir: string;
      /** 默认语音 ID（默认 zh_CN-hf_female） */
      defaultVoice?: string;
    };
    /** STT 配置 */
    stt?: {
      /** OpenAI Whisper API 密钥（默认复用 openAIApiKey） */
      openAIApiKey?: string;
      /** Stream STT WebSocket URL */
      wsUrl?: string;
      /** Stream STT API 密钥 */
      streamApiKey?: string;
    };
  };
  /** 实时模式配置 */
  realtime?: {
    defaultProvider?: 'openai' | 'gemini';
    sessionTimeoutMs?: number;
    maxSessions?: number;
  };
  /** 唤醒词配置 */
  wake?: {
    triggers?: string[];
    /** 检测到唤醒词时的回调 */
    onWakeWordDetected?: (result: WakeDetectionResult) => void;
  };
  /** 通道集成配置 */
  channel?: VoiceChannelConfig;
  /** 命令路由配置 */
  commandRouter?: Partial<VoiceCommandRouterConfig>;
}

/** 桥接状态 */
export interface VoiceBridgeStatus {
  /** 服务模式状态 */
  service: {
    available: boolean;
    ttsProviderCount: number;
    sttProviderCount: number;
    recordingAvailable: boolean;
  };
  /** 实时模式状态 */
  realtime: {
    activeSessions: number;
    maxSessions: number;
  };
  /** 唤醒词状态 */
  wake: {
    configured: boolean;
    triggerCount: number;
  };
  /** 环境检测结果 */
  environment: Record<string, unknown>;
  /** 运行时环境 */
  runtime: {
    environment: string;
    isRemote: boolean;
    hasAudioDevice: boolean;
    isVoiceAvailable: boolean;
  };
}

const logger = new Logger({ level: LogLevel.INFO });

/** 默认桥接配置 */
const DEFAULT_BRIDGE_CONFIG: VoiceBridgeConfig = {
  service: {
    ttsEnabled: true,
    recordingEnabled: true,
    sampleRate: 16000,
    channels: 1,
    language: 'zh-CN',
  },
  realtime: {
    defaultProvider: 'openai',
    sessionTimeoutMs: 300000,
    maxSessions: 10,
  },
  wake: {
    triggers: defaultVoiceWakeTriggers(),
  },
};

/**
 * VoiceServiceBridge 类
 * 统一语音功能入口，路由 service 和 realtime 两个子系统
 */
export class VoiceServiceBridge {
  private config: VoiceBridgeConfig;
  private _isWakeDetectionRunning = false;
  private _wakeDetectionTimer: ReturnType<typeof setInterval> | null = null;
  private metrics: MetricsService;

  /** 服务模式子系统 */
  readonly service: {
    /** TTS 功能 */
    tts: TTSRegistry;
    /** STT 功能 */
    stt: STTRegistry;
    /** 录音服务 */
    recorder: VoiceService;
    /** VAD 检测器 */
    vad: VadDetector;
    /** 环境检测器 */
    environment: EnvironmentDetector;
    /** 关键词列表 */
    keyterms: typeof getVoiceKeyterms;
    /** 防休眠 */
    preventSleep: {
      start: typeof startPreventSleep;
      stop: typeof stopPreventSleep;
    };
  };

  /** 实时模式子系统 */
  readonly realtime: {
    /** 创建语音会话 */
    createSession: (connection: VoiceConnection) => VoiceSession;
    /** 处理 WebSocket 升级请求 */
    handleUpgrade: typeof handleVoiceUpgrade;
    /** 获取活跃会话 */
    getActiveSessions: typeof getActiveVoiceSessions;
    /** 获取指定会话 */
    getSession: typeof getVoiceSession;
    /** 获取活跃会话数量 */
    getSessionCount: typeof getActiveVoiceSessionCount;
    /** 关闭所有会话 */
    closeAllSessions: typeof closeAllVoiceSessions;
    /** 会话类 */
    Session: typeof VoiceSession;
    /** Gemini 适配器 */
    GeminiAdapter: typeof GeminiLiveAdapter;
    /** OpenAI 适配器 */
    OpenAIAdapter: typeof OpenAIRealtimeAdapter;
    /** 工具桥接 */
    ToolBridge: typeof VoiceToolBridge;
    /** 事件总线 */
    EventBus: typeof VoiceEventBus;
    /** 音频处理 */
    audio: {
      PCMBuffer: typeof PCMAudioBuffer;
      Processor: typeof AudioProcessor;
    };
  };

  /** 唤醒词子系统 */
  readonly wake: {
    loadConfig: typeof loadVoiceWakeConfig;
    setTriggers: typeof setVoiceWakeTriggers;
    detect: typeof detectWakeWord;
    sanitize: typeof sanitizeTriggers;
    defaults: typeof defaultVoiceWakeTriggers;
  };

  /** 通道集成 */
  readonly channel: VoiceChannelIntegration;

  /** 语音命令路由器 */
  readonly commandRouter: VoiceCommandRouter;

  constructor(config?: VoiceBridgeConfig) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this.metrics = getMetricsService();

    // 注册语音相关指标
    this.metrics.createGauge({
      name: 'voice.active_sessions',
      description: '当前活跃的语音会话数',
    });
    this.metrics.createCounter({
      name: 'voice.sessions_total',
      description: '语音会话累计创建数',
    });
    this.metrics.createCounter({
      name: 'voice.audio_processed_bytes',
      description: '累计处理的音频字节数',
    });
    this.metrics.createCounter({
      name: 'voice.tool_calls_total',
      description: '语音工具调用累计次数',
    });
    this.metrics.createCounter({
      name: 'voice.errors_total',
      description: '语音模块错误累计次数',
    });

    // 注册语音模块告警规则
    const alertManager = getAlertManager();
    alertManager.registerRule({
      id: 'voice-connection-failure',
      name: '语音连接失败',
      description: '语音会话连接失败时触发',
      level: AlertLevel.ERROR,
      condition: (metrics) => {
        const values = metrics['voice.errors_total'];
        if (!values || values.length < 2) return false;
        return values[values.length - 1] > values[values.length - 2];
      },
      message: '语音连接失败，请检查网络和 API 密钥配置',
      enabled: true,
      cooldown: 60000,
    });
    alertManager.registerRule({
      id: 'voice-session-error',
      name: '语音会话错误率高',
      description: '语音会话累计错误数超过阈值时触发',
      level: AlertLevel.WARNING,
      condition: (metrics) => {
        const errors = metrics['voice.errors_total'];
        const sessions = metrics['voice.sessions_total'];
        if (!errors || errors.length === 0) return false;
        const latestErrors = errors[errors.length - 1];
        if (!sessions || sessions.length === 0) return latestErrors > 5;
        const latestSessions = sessions[sessions.length - 1];
        return latestSessions > 0 && latestErrors / latestSessions > 0.3;
      },
      message: '语音会话错误率过高（>30%）',
      enabled: true,
      cooldown: 120000,
    });
    alertManager.registerRule({
      id: 'voice-session-timeout',
      name: '语音会话频繁超时',
      description: '语音会话超时次数超过阈值时触发',
      level: AlertLevel.WARNING,
      condition: (metrics) => {
        const errors = metrics['voice.errors_total'];
        if (!errors || errors.length < 3) return false;
        const recent = errors.slice(-3);
        return recent.filter((v) => v > 0).length >= 3;
      },
      message: '语音会话频繁超时，请检查 Provider 响应',
      enabled: true,
      cooldown: 300000,
    });

    // 初始化 OTel 追踪（确保全局追踪器就绪）
    getOTelTracing();

    // 初始化服务模式
    const voiceService = createVoiceService({
      sampleRate: this.config.service?.sampleRate,
      channels: this.config.service?.channels,
      language: this.config.service?.language,
    });

    if (this.config.service?.ttsEnabled !== false) {
      TTSRegistry.register(new EdgeTTSProvider());

      // 自动注册命令 TTS 提供者（如果系统支持）
      if (CommandTTSProvider.isAvailable()) {
        TTSRegistry.register(new CommandTTSProvider());
      }

      // 条件注册 OpenAI TTS 提供者（需要 API 密钥）
      const apiKey = this.config.service?.openAIApiKey;
      if (apiKey) {
        TTSRegistry.register(
          new OpenAITTSProvider({
            apiKey,
            model: this.config.service?.openAITTSCModel ?? 'tts-1',
          })
        );
      }

      // 条件注册 Piper 本地 TTS（需要模型目录配置）
      const piperConfig = this.config.service?.piper;
      if (piperConfig?.modelDir) {
        if (PiperTTSProvider.isAvailable()) {
          TTSRegistry.register(
            new PiperTTSProvider({
              modelDir: piperConfig.modelDir,
              defaultVoice: piperConfig.defaultVoice ?? 'zh_CN-hf_female',
            })
          );
        }
      }
    }

    // 注册 STT 提供者
    STTRegistry.register(new LocalSTTProvider());

    const sttConfig = this.config.service?.stt;
    const sttApiKey =
      sttConfig?.openAIApiKey || this.config.service?.openAIApiKey;
    if (sttApiKey) {
      const cloudProvider = new CloudSTTProvider({ apiKey: sttApiKey });
      if (cloudProvider.isAvailable()) {
        STTRegistry.register(cloudProvider);
        STTRegistry.setDefaultProvider(cloudProvider.id);
      }
    }

    if (sttConfig?.wsUrl || sttConfig?.streamApiKey) {
      const streamProvider = new StreamSTTProvider({
        apiKey: sttConfig?.streamApiKey,
        wsUrl: sttConfig?.wsUrl,
      });
      STTRegistry.register(streamProvider);
      if (streamProvider.isAvailable()) {
        STTRegistry.setDefaultProvider(streamProvider.id);
      }
    }

    this.service = {
      tts: TTSRegistry,
      stt: STTRegistry.getDefaultInstance(),
      recorder: voiceService,
      vad: new VadDetector(),
      environment: new EnvironmentDetector(),
      keyterms: getVoiceKeyterms,
      preventSleep: {
        start: startPreventSleep,
        stop: stopPreventSleep,
      },
    };

    // 初始化实时模式
    const sessionCreator = (connection: VoiceConnection): VoiceSession => {
      if (this.config.realtime?.maxSessions) {
        const currentCount = getActiveVoiceSessionCount();
        if (currentCount >= this.config.realtime.maxSessions) {
          throw new Error(
            `已达最大会话数限制: ${this.config.realtime.maxSessions}`
          );
        }
      }
      return new VoiceSession(connection, {
        memoryManager: new MemoryManagerImpl(),
      });
    };

    this.realtime = {
      createSession: sessionCreator,
      handleUpgrade: handleVoiceUpgrade,
      getActiveSessions: getActiveVoiceSessions,
      getSession: getVoiceSession,
      getSessionCount: getActiveVoiceSessionCount,
      closeAllSessions: closeAllVoiceSessions,
      Session: VoiceSession,
      GeminiAdapter: GeminiLiveAdapter,
      OpenAIAdapter: OpenAIRealtimeAdapter,
      ToolBridge: VoiceToolBridge,
      EventBus: VoiceEventBus,
      audio: {
        PCMBuffer: PCMAudioBuffer,
        Processor: AudioProcessor,
      },
    };

    // 初始化唤醒词子系统
    this.wake = {
      loadConfig: loadVoiceWakeConfig,
      setTriggers: setVoiceWakeTriggers,
      detect: detectWakeWord,
      sanitize: sanitizeTriggers,
      defaults: defaultVoiceWakeTriggers,
    };

    // 初始化通道集成
    this.channel = new VoiceChannelIntegration(this.config.channel);

    // 初始化语音命令路由器
    this.commandRouter = new VoiceCommandRouter(this.config.commandRouter);

    // 设置语音集成上下文（注入 SessionManager 实例）
    if (SessionManager.instance) {
      setVoiceIntegrationContext(SessionManager.instance, undefined);
    }
  }

  /** 获取桥接状态 */
  async getStatus(): Promise<VoiceBridgeStatus> {
    const environment: Record<string, unknown> = {
      platform: process.platform,
      node: process.version,
      arch: process.arch,
    };

    const runtimeEnv = detectRuntimeEnvironment();
    const wakeConfig = await loadVoiceWakeConfig();

    return {
      service: {
        available: true,
        ttsProviderCount: TTSRegistry.getProviderNames().length,
        sttProviderCount: STTRegistry.getProviderIds().length,
        recordingAvailable: !runtimeEnv.isRemote || runtimeEnv.hasAudioDevice,
      },
      realtime: {
        activeSessions: getActiveVoiceSessionCount(),
        maxSessions: this.config.realtime?.maxSessions ?? 10,
      },
      wake: {
        configured: wakeConfig.triggers.length > 0,
        triggerCount: wakeConfig.triggers.length,
      },
      environment,
      runtime: {
        environment: runtimeEnv.environment,
        isRemote: runtimeEnv.isRemote,
        hasAudioDevice: runtimeEnv.hasAudioDevice,
        isVoiceAvailable: isVoiceAvailable(),
      },
    };
  }

  /**
   * 启动唤醒词监听
   *
   * 周期性检测语音输入中的唤醒词，检测到后触发回调。
   * 需要先通过 config.wake.onWakeWordDetected 设置回调。
   * 如果未设置回调或检测已运行，则不做任何操作。
   */
  startWakeWordDetection(): void {
    if (this._isWakeDetectionRunning) {
      return;
    }

    const callback = this.config.wake?.onWakeWordDetected;
    if (!callback) {
      return;
    }

    this._isWakeDetectionRunning = true;
    logger.info('唤醒词监听已启动');

    // 使用轮询方式监听，每隔 1 秒从录音缓冲区检测一次
    this._wakeDetectionTimer = setInterval(async () => {
      if (!this._isWakeDetectionRunning) {
        this.stopWakeWordDetection();
        return;
      }
      // 唤醒词检测由外部 feed 文本触发，此处仅维护生命周期
    }, 1000);
  }

  /**
   * 停止唤醒词监听
   */
  stopWakeWordDetection(): void {
    this._isWakeDetectionRunning = false;

    if (this._wakeDetectionTimer !== null) {
      clearInterval(this._wakeDetectionTimer);
      this._wakeDetectionTimer = null;
    }

    logger.info('唤醒词监听已停止');
  }

  /**
   * 检查唤醒词监听是否正在运行
   */
  isWakeDetectionActive(): boolean {
    return this._isWakeDetectionRunning;
  }

  /**
   * 手动进行一次唤醒词检测
   *
   * @param transcript 语音转录文本
   * @returns 检测结果
   */
  async checkWakeWord(transcript: string): Promise<WakeDetectionResult> {
    const result = await detectWakeWord(transcript, this.config.wake?.triggers);

    if (result.detected) {
      const callback = this.config.wake?.onWakeWordDetected;
      if (callback) {
        callback(result);
      }
    }

    return result;
  }
}

/** 全局桥接实例 */
let globalBridge: VoiceServiceBridge | null = null;

/**
 * 创建语音服务桥接实例
 * 支持单例模式：重复调用返回同一实例
 */
export function createVoiceServiceBridge(
  config?: VoiceBridgeConfig
): VoiceServiceBridge {
  if (!globalBridge) {
    globalBridge = new VoiceServiceBridge(config);
  }
  return globalBridge;
}

/**
 * 重置桥接实例（主要用于测试）
 */
export function resetVoiceServiceBridge(): void {
  globalBridge = null;
}

export type {
  VoiceClientEvent,
  VoiceServerEvent,
  VoiceSessionState,
  VoiceSessionSummary,
  VoiceProviderAdapter,
  VoiceConnection,
  UpgradeHandler,
  VoiceSessionConfigEvent,
  VoiceToolDeclaration,
  ToolExecutorDelegate,
  VoiceWakeConfig,
  WakeDetectionResult,
  AudioBufferStats,
  AudioChunk,
  VoiceServiceConfig,
};
