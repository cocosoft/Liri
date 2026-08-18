/**
 * TTSTool 语音合成工具（Text-to-Speech）
 * 让 Agent 将文本转换为语音输出
 *
 * 实际调用 voiceService → TTS Provider → PCMAudioPlayer 完整链路。
 * 同步维护 speak 队列，避免多轮会话冲突。
 */
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';
import voiceService from '@modules/services/voice';
import { globalEventBus } from '@modules/core';
import type { EventSubscription } from '@modules/core';
import { parse, join } from 'path';
import { sanitizeFileName } from '@modules/services/file/fileNaming';

const logger = getLogger('tools:tts');

/**
 * 令牌桶限流
 * 用于控制 TTS 调用频率，防止短时间内过量请求。
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  /**
   * @param maxTokens 桶容量上限
   * @param refillRate 每秒补充的令牌数
   */
  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * 消耗一个令牌
   * 如果没有足够令牌，等待直到补充
   */
  async consume(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // 等待足够的令牌补充
    const waitMs = Math.ceil(1000 / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
    }
  }

  /** 补充令牌 */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;
  }
}

interface TTSInput {
  action: 'speak' | 'list-voices' | 'save';
  text?: string;
  voice?: string;
  language?: string;
  speed?: number;
  filename?: string;
}

const AVAILABLE_VOICES = [
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: 'Xiaoxiao',
    language: 'zh-CN',
    gender: 'female',
  },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi', language: 'zh-CN', gender: 'male' },
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny',
    language: 'en-US',
    gender: 'female',
  },
  { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
  {
    id: 'ja-JP-NanamiNeural',
    name: 'Nanami',
    language: 'ja-JP',
    gender: 'female',
  },
  {
    id: 'ko-KR-SunHiNeural',
    name: 'SunHi',
    language: 'ko-KR',
    gender: 'female',
  },
];

export class TTSTool extends BaseTool<Record<string, unknown>> {
  name = 'tts';
  description =
    'Convert text to speech using neural voices. Supports multiple languages and voices for generating spoken audio output.';
  /** TTS 调用限流器（默认每秒 10 次，桶容量 20） */
  private tokenBucket = new TokenBucket(20, 10);

  /** 当前是否正在合成 */
  private isSynthesizing = false;

  /**
   * 人设解析结果缓存（方案 6：订阅驱动缓存）
   * 键为人设 ID，值为解析后的语音/语速等配置
   * 配置变更时主动失效对应 key，无需 TTL
   */
  private personaCache = new Map<string, unknown>();
  /** 配置变更订阅句柄 */
  private configSubscription: EventSubscription | null = null;

  /**
   * 初始化缓存（注册配置变更监听）
   * 监听 config:tts:changed 事件，配置变更时精准失效对应 key
   */
  initCache(): void {
    this.configSubscription = globalEventBus.subscribe(
      'config:tts:changed',
      (event: any) => {
        const personaId = event?.payload?.personaId;
        if (personaId) {
          this.personaCache.delete(personaId);
        } else {
          this.personaCache.clear();
        }
      }
    );
  }

  /**
   * 销毁缓存和订阅
   * 清理缓存并取消配置变更监听，防止内存泄漏
   */
  dispose(): void {
    this.configSubscription?.unsubscribe();
    this.personaCache.clear();
  }

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        'Action: speak (generate speech), list-voices (available voices), save (save to file)',
      required: true,
      enum: ['speak', 'list-voices', 'save'],
    },
    {
      name: 'text',
      type: 'string',
      description: 'Text to convert to speech (required for speak/save)',
      required: false,
    },
    {
      name: 'voice',
      type: 'string',
      description: 'Voice ID to use (default: zh-CN-XiaoxiaoNeural)',
      required: false,
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language code (e.g., zh-CN, en-US, ja-JP)',
      required: false,
    },
    {
      name: 'speed',
      type: 'number',
      description: 'Speech speed (0.5 to 2.0, default: 1.0)',
      required: false,
      minimum: 0.5,
      maximum: 2.0,
    },
    {
      name: 'filename',
      type: 'string',
      description: 'Output audio filename (required for save action)',
      required: false,
    },
  ];

  override aliases = ['speak', 'text-to-speech', 'speech'];
  override searchHint = 'Convert text to speech audio';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'tool.tts.execute',
        attributes: {
          action: String(input.action ?? 'unknown'),
          textLength: typeof input.text === 'string' ? input.text.length : 0,
        },
      },
      async () => {
        try {
          const { action, text, voice, language, speed, filename } =
            input as unknown as TTSInput;

          const validActions = ['speak', 'list-voices', 'save'];
          if (!action || !validActions.includes(action)) {
            logger.warn('TTSTool · 无效操作', { action });
            return {
              success: false,
              error: `action must be one of: ${validActions.join(', ')}`,
            };
          }

          logger.info('TTSTool · 执行', { action, voice, language, speed });
          switch (action) {
            case 'list-voices': {
              return {
                success: true,
                data: {
                  voices: AVAILABLE_VOICES,
                  count: AVAILABLE_VOICES.length,
                },
                output: `Available voices (${AVAILABLE_VOICES.length}):\n${AVAILABLE_VOICES.map(
                  (v) => `  - ${v.id} (${v.name}, ${v.language}, ${v.gender})`
                ).join('\n')}`,
              };
            }

            case 'speak':
            case 'save': {
              if (!text || typeof text !== 'string') {
                logger.warn('TTSTool · 缺少文本内容');
                return {
                  success: false,
                  error: 'text is required and must be a string',
                };
              }

              const selectedVoice = voice || 'zh-CN-XiaoxiaoNeural';
              const validVoiceIds = AVAILABLE_VOICES.map((v) => v.id);
              if (!validVoiceIds.includes(selectedVoice)) {
                logger.warn('TTSTool · 无效语音', { selectedVoice });
                return {
                  success: false,
                  error: `Invalid voice "${selectedVoice}". Use list-voices to see available voices.`,
                };
              }

              const lang =
                language || selectedVoice.split('-').slice(0, 2).join('-');
              const spd = speed || 1.0;
              if (spd < 0.5 || spd > 2.0) {
                logger.warn('TTSTool · 语速超出范围', { speed: spd });
                return {
                  success: false,
                  error: 'speed must be between 0.5 and 2.0',
                };
              }

              if (this.isSynthesizing) {
                logger.warn('TTSTool · 正在合成中，拒绝并发请求');
                return {
                  success: false,
                  error: 'A TTS synthesis is already in progress. Please wait.',
                };
              }

              // 令牌桶限流 — 必须在 speak 调用之前，否则限流不生效
              await this.tokenBucket.consume();

              if (action === 'save') {
                if (!filename) {
                  logger.warn('TTSTool · 缺少文件名');
                  return {
                    success: false,
                    error: 'filename is required for save action',
                  };
                }

                // 清理文件名中的非法字符（含全角符号），保留路径结构
                // filename 可能是完整路径或仅文件名，分离后只清理文件名部分
                const pathInfo = parse(filename);
                const safeFilename = pathInfo.dir
                  ? join(
                      pathInfo.dir,
                      sanitizeFileName(pathInfo.name) + pathInfo.ext
                    )
                  : sanitizeFileName(pathInfo.name) + pathInfo.ext;

                this.isSynthesizing = true;
                try {
                  logger.info('TTSTool · 语音保存', {
                    filename: safeFilename,
                    voice: selectedVoice,
                  });

                  // 通过 voiceService.synthesizeSpeech 获取音频数据
                  const audioBuffer = await voiceService.synthesizeSpeech(text);

                  if (!audioBuffer) {
                    return {
                      success: false,
                      error: 'TTS synthesis returned no audio data',
                    };
                  }

                  // 使用 fs 保存文件
                  const { writeFile } = await import('fs/promises');
                  await writeFile(safeFilename, audioBuffer);

                  return {
                    success: true,
                    data: {
                      filename: safeFilename,
                      voice: selectedVoice,
                      language: lang,
                      textLength: text.length,
                      audioDurationSec: Math.round(text.length / 15),
                    },
                    output: `Speech saved to "${safeFilename}". Voice: ${selectedVoice}.`,
                  };
                } catch (error) {
                  const errorMsg =
                    error instanceof Error ? error.message : String(error);
                  void handleError(error, {
                    module: 'tools:tts',
                    action: 'save',
                    context: { filename: safeFilename, voice: selectedVoice },
                  });
                  return {
                    success: false,
                    error: `TTS save failed: ${errorMsg}`,
                  };
                } finally {
                  this.isSynthesizing = false;
                }
              }

              // speak 分支 — 真实调用 voiceService
              this.isSynthesizing = true;
              try {
                logger.info('TTSTool · 语音生成', {
                  voice: selectedVoice,
                  speed: spd,
                  textLength: text.length,
                });

                await voiceService.speak({
                  text,
                  voice: selectedVoice,
                  speed: spd,
                });

                return {
                  success: true,
                  data: {
                    voice: selectedVoice,
                    language: lang,
                    textLength: text.length,
                    speed: spd,
                  },
                  output: `Spoken ${text.length} characters. Voice: ${selectedVoice}, Language: ${lang}, Speed: ${spd}x.`,
                };
              } catch (error) {
                const errorMsg =
                  error instanceof Error ? error.message : String(error);
                void handleError(error, {
                  module: 'tools:tts',
                  action: 'speak',
                  context: {
                    voice: selectedVoice,
                    speed: spd,
                    textLength: text.length,
                  },
                });
                return {
                  success: false,
                  error: `TTS synthesis failed: ${errorMsg}`,
                };
              } finally {
                this.isSynthesizing = false;
              }
            }

            default:
              return { success: false, error: `Unhandled action: ${action}` };
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'tools:tts',
            action: 'execute',
          });
          return {
            success: false,
            error: `TTS tool failed: ${errorMsg}`,
          };
        }
      }
    )();
  }
}

export function createTTSTool(): TTSTool {
  return new TTSTool();
}
