/**
 * TTS 插件化提供者系统
 *
 * 定义 TTS 提供者接口和注册表，支持插件式扩展。
 * 内置提供者：Edge（微软神经网络语音）、None（静默占位）。
 *
 * 用法：
 * ```ts
 * import { TTSRegistry, EdgeTTSProvider } from './ttsProvider';
 *
 * TTSRegistry.register(new EdgeTTSProvider());
 * await TTSRegistry.speak({ text: '你好', voice: 'zh-CN-XiaoxiaoNeural' });
 * ```
 */

/** TTS 语音信息 */
export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female';
}

/** TTS 合成选项 */
export interface TTSSpeakOptions {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
}

/** TTS 合成结果 */
export interface TTSSpeakResult {
  /** 是否成功 */
  success: boolean;
  /** 音频时长（秒），仅 speak 动作返回 */
  audioDurationSec?: number;
  /** 音频文件路径，仅 save 动作返回 */
  filePath?: string;
  /** 语音信息 */
  voice?: TTSVoice;
  /** 错误信息 */
  error?: string;
}

/** TTS 提供者接口 */
export interface TTSProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 获取支持的语音列表 */
  getVoices(): TTSVoice[];
  /** 合成语音 */
  speak(options: TTSSpeakOptions): Promise<TTSSpeakResult>;
  /** 合成并保存到文件 */
  save?(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult>;
  /** 停止合成 */
  stop?(): void;
}

/**
 * Edge TTS 提供者（微软神经网络语音）
 *
 * 内置语音列表，实际合成需通过 Edge TTS API 或 HTTP 请求调用。
 * 当前实现返回合成参数元数据，后续可扩展实际音频生成。
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = 'edge';

  private static readonly VOICES: TTSVoice[] = [
    {
      id: 'zh-CN-XiaoxiaoNeural',
      name: 'Xiaoxiao',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-YunxiNeural',
      name: 'Yunxi',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'zh-CN-YunjianNeural',
      name: 'Yunjian',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'zh-CN-XiaoyiNeural',
      name: 'Xiaoyi',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-YunyangNeural',
      name: 'Yunyang',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'zh-CN-XiaochenNeural',
      name: 'Xiaochen',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaohanNeural',
      name: 'Xiaohan',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaomengNeural',
      name: 'Xiaomeng',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaomoNeural',
      name: 'Xiaomo',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoqiuNeural',
      name: 'Xiaoqiu',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoruiNeural',
      name: 'Xiaorui',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoshuangNeural',
      name: 'Xiaoshuang',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoxuanNeural',
      name: 'Xiaoxuan',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoyanNeural',
      name: 'Xiaoyan',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-XiaoyouNeural',
      name: 'Xiaoyou',
      language: 'zh-CN',
      gender: 'female',
    },
    {
      id: 'zh-CN-YunxiaoNeural',
      name: 'Yunxiao',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'zh-CN-YunyeNeural',
      name: 'Yunye',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'zh-CN-YunzeNeural',
      name: 'Yunze',
      language: 'zh-CN',
      gender: 'male',
    },
    {
      id: 'en-US-JennyNeural',
      name: 'Jenny',
      language: 'en-US',
      gender: 'female',
    },
    { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
    {
      id: 'en-US-AriaNeural',
      name: 'Aria',
      language: 'en-US',
      gender: 'female',
    },
    {
      id: 'en-US-ChristopherNeural',
      name: 'Christopher',
      language: 'en-US',
      gender: 'male',
    },
    { id: 'en-US-EricNeural', name: 'Eric', language: 'en-US', gender: 'male' },
    {
      id: 'en-US-JaneNeural',
      name: 'Jane',
      language: 'en-US',
      gender: 'female',
    },
    {
      id: 'en-US-NancyNeural',
      name: 'Nancy',
      language: 'en-US',
      gender: 'female',
    },
    {
      id: 'en-US-SaraNeural',
      name: 'Sara',
      language: 'en-US',
      gender: 'female',
    },
    { id: 'en-US-TonyNeural', name: 'Tony', language: 'en-US', gender: 'male' },
    {
      id: 'en-GB-SoniaNeural',
      name: 'Sonia',
      language: 'en-GB',
      gender: 'female',
    },
    { id: 'en-GB-RyanNeural', name: 'Ryan', language: 'en-GB', gender: 'male' },
    {
      id: 'en-GB-LibbyNeural',
      name: 'Libby',
      language: 'en-GB',
      gender: 'female',
    },
    {
      id: 'ja-JP-NanamiNeural',
      name: 'Nanami',
      language: 'ja-JP',
      gender: 'female',
    },
    {
      id: 'ja-JP-KeitaNeural',
      name: 'Keita',
      language: 'ja-JP',
      gender: 'male',
    },
    {
      id: 'ko-KR-SunHiNeural',
      name: 'SunHi',
      language: 'ko-KR',
      gender: 'female',
    },
    {
      id: 'ko-KR-InJoonNeural',
      name: 'InJoon',
      language: 'ko-KR',
      gender: 'male',
    },
    {
      id: 'fr-FR-DeniseNeural',
      name: 'Denise',
      language: 'fr-FR',
      gender: 'female',
    },
    {
      id: 'fr-FR-HenriNeural',
      name: 'Henri',
      language: 'fr-FR',
      gender: 'male',
    },
    {
      id: 'de-DE-KatjaNeural',
      name: 'Katja',
      language: 'de-DE',
      gender: 'female',
    },
    {
      id: 'de-DE-ConradNeural',
      name: 'Conrad',
      language: 'de-DE',
      gender: 'male',
    },
    {
      id: 'es-ES-ElviraNeural',
      name: 'Elvira',
      language: 'es-ES',
      gender: 'female',
    },
    {
      id: 'es-ES-AlvaroNeural',
      name: 'Alvaro',
      language: 'es-ES',
      gender: 'male',
    },
    {
      id: 'ru-RU-SvetlanaNeural',
      name: 'Svetlana',
      language: 'ru-RU',
      gender: 'female',
    },
    {
      id: 'ru-RU-DmitryNeural',
      name: 'Dmitry',
      language: 'ru-RU',
      gender: 'male',
    },
  ];

  getVoices(): TTSVoice[] {
    return EdgeTTSProvider.VOICES;
  }

  async speak(options: TTSSpeakOptions): Promise<TTSSpeakResult> {
    const voices = this.getVoices();
    const voiceId = options.voice || 'zh-CN-XiaoxiaoNeural';
    const voice = voices.find((v) => v.id === voiceId);

    if (!voice) {
      return { success: false, error: `Voice "${voiceId}" not found` };
    }

    const speed = options.speed ?? 1.0;
    const audioDurationSec = Math.round((options.text.length * 0.15) / speed);

    return {
      success: true,
      audioDurationSec,
      voice,
    };
  }

  async save(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult> {
    const speakResult = await this.speak(options);
    if (!speakResult.success) {
      return speakResult;
    }

    return {
      ...speakResult,
      filePath: options.filename,
    };
  }
}

/**
 * TTS 提供者注册表
 */
export class TTSRegistry {
  private static providers: Map<string, TTSProvider> = new Map();
  private static defaultProviderName: string = '';

  /**
   * 注册 TTS 提供者
   */
  static register(provider: TTSProvider, setAsDefault: boolean = false): void {
    TTSRegistry.providers.set(provider.name, provider);
    if (TTSRegistry.providers.size === 1 || setAsDefault) {
      TTSRegistry.defaultProviderName = provider.name;
    }
  }

  /**
   * 注销 TTS 提供者
   */
  static unregister(name: string): void {
    TTSRegistry.providers.delete(name);
    if (TTSRegistry.defaultProviderName === name) {
      const firstProvider = TTSRegistry.providers.keys().next().value;
      TTSRegistry.defaultProviderName = firstProvider ?? '';
    }
  }

  /**
   * 获取 TTS 提供者
   */
  static getProvider(name?: string): TTSProvider | undefined {
    const providerName = name || TTSRegistry.defaultProviderName;
    return providerName ? TTSRegistry.providers.get(providerName) : undefined;
  }

  /**
   * 获取默认 TTS 提供者
   */
  static getDefaultProvider(): TTSProvider | undefined {
    return TTSRegistry.defaultProviderName
      ? TTSRegistry.providers.get(TTSRegistry.defaultProviderName)
      : undefined;
  }

  /**
   * 获取所有已注册的提供者名称
   */
  static getProviderNames(): string[] {
    return Array.from(TTSRegistry.providers.keys());
  }

  /**
   * 获取所有提供者的语音列表（按提供者分组）
   */
  static getAllVoices(): Map<string, TTSVoice[]> {
    const result = new Map<string, TTSVoice[]>();
    for (const [name, provider] of TTSRegistry.providers) {
      result.set(name, provider.getVoices());
    }
    return result;
  }

  /**
   * 合成语音
   */
  static async speak(
    options: TTSSpeakOptions,
    providerName?: string
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      return {
        success: false,
        error: `No TTS provider available${providerName ? `: "${providerName}" not found` : ''}`,
      };
    }
    return provider.speak(options);
  }

  /**
   * 合成并保存到文件
   */
  static async save(
    options: TTSSpeakOptions & { filename: string },
    providerName?: string
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      return {
        success: false,
        error: `No TTS provider available${providerName ? `: "${providerName}" not found` : ''}`,
      };
    }
    if (!provider.save) {
      // Fallback: speak 后保存结果
      return provider.speak(options).then((r) => ({
        ...r,
        filePath: options.filename,
      }));
    }
    return provider.save(options);
  }

  /**
   * 停止所有提供者的语音输出
   */
  static stopAll(): void {
    for (const provider of TTSRegistry.providers.values()) {
      provider.stop?.();
    }
  }

  /**
   * 注册默认 TTS 提供者
   *
   * 注册 EdgeTTS（始终注册为默认），并可选注册额外提供者。
   * 额外提供者的自动检测由调用方（如 VoiceServiceBridge）负责，
   * 保持注册表与具体提供者解耦。
   *
   * @param extraProviders 额外注册的提供者列表
   * @returns 已注册的提供者名称列表
   */
  static registerDefaults(extraProviders?: TTSProvider[]): string[] {
    if (TTSRegistry.providers.size === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    if (extraProviders) {
      for (const provider of extraProviders) {
        if (!TTSRegistry.providers.has(provider.name)) {
          TTSRegistry.register(provider);
        }
      }
    }

    return TTSRegistry.getProviderNames();
  }

  /**
   * 清除所有注册的提供者
   */
  static clear(): void {
    TTSRegistry.providers.clear();
    TTSRegistry.defaultProviderName = '';
  }
}

// 默认注册 Edge TTS 提供者
TTSRegistry.register(new EdgeTTSProvider(), true);
