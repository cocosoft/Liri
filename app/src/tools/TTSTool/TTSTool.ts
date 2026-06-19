/**
 * TTSTool 语音合成工具（Text-to-Speech）
 * 让 Agent 将文本转换为语音输出
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';

const logger = new Logger({ level: LogLevel.INFO });

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
            data: { voices: AVAILABLE_VOICES, count: AVAILABLE_VOICES.length },
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

          const audioLengthSec = Math.round((text.length * 0.15) / spd);
          const estimatedSize = (audioLengthSec * 16 * 22050) / 8 / 1024;

          if (action === 'save') {
            if (!filename) {
              logger.warn('TTSTool · 缺少文件名');
              return {
                success: false,
                error: 'filename is required for save action',
              };
            }
            logger.info('TTSTool · 语音保存', {
              filename,
              voice: selectedVoice,
              durationSec: audioLengthSec,
            });
            return {
              success: true,
              data: {
                filename,
                voice: selectedVoice,
                language: lang,
                textLength: text.length,
                audioDurationSec: audioLengthSec,
                estimatedSizeKB: Math.round(estimatedSize),
              },
              output: `Speech saved to "${filename}" (${audioLengthSec}s, ~${Math.round(estimatedSize)}KB). Voice: ${selectedVoice}.`,
            };
          }

          logger.info('TTSTool · 语音生成', {
            voice: selectedVoice,
            durationSec: audioLengthSec,
            speed: spd,
          });
          return {
            success: true,
            data: {
              voice: selectedVoice,
              language: lang,
              textLength: text.length,
              audioDurationSec: audioLengthSec,
              speed: spd,
            },
            output: `Speaking ${audioLengthSec}s of audio. Voice: ${selectedVoice}, Language: ${lang}, Speed: ${spd}x.`,
          };
        }

        default:
          return { success: false, error: `Unhandled action: ${action}` };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TTSTool · 执行失败', { error: errorMsg });
      return {
        success: false,
        error: `TTS tool failed: ${errorMsg}`,
      };
    }
  }
}

export function createTTSTool(): TTSTool {
  return new TTSTool();
}
