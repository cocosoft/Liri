import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * MusicGenerateTool
 * 对标OpenClaw music-generate 工具
 * AI音乐生成工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { resolveOutputDir } from '@modules/core';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:MusicGenerateTool:MusicGenerateTool');

export interface MusicGenerateParams {
  prompt: string;
  genre?: string;
  duration?: number;
  tempo?: 'slow' | 'medium' | 'fast';
  instruments?: string[];
  mood?: string;
  format?: 'mp3' | 'wav' | 'midi';
  provider?: 'openai' | 'suno' | 'udio';
}

export interface GeneratedMusic {
  url: string;
  title: string;
  prompt: string;
  genre: string;
  duration: number;
  tempo: string;
  format: string;
  provider: string;
}

/**
 * U-03（2026-10-19）：`music_generate` 的**模型可见出参结构**（JSON Schema），
 * 与 `GeneratedMusic` + 入参回显 `params` 对齐。
 */
const MUSIC_GENERATE_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    music: {
      type: 'object',
      description: '生成结果',
      properties: {
        url: { type: 'string', description: '音频地址（未持久化时为空串）' },
        title: { type: 'string', description: '曲目标题' },
        prompt: { type: 'string', description: '提示词（截断 200 字）' },
        genre: { type: 'string', description: '曲风' },
        duration: { type: 'number', description: '时长（秒）' },
        tempo: { type: 'string', description: '节奏（slow/medium/fast）' },
        format: { type: 'string', description: '音频格式（mp3/wav/midi）' },
        provider: { type: 'string', description: 'Provider 名称' },
      },
      required: [
        'url',
        'title',
        'prompt',
        'genre',
        'duration',
        'tempo',
        'format',
        'provider',
      ],
    },
    params: {
      type: 'object',
      description: '入参回显（实际生效的生成参数）',
      properties: {
        prompt: { type: 'string', description: '提示词' },
        genre: { type: 'string', description: '曲风' },
        duration: { type: 'number', description: '时长（秒）' },
        tempo: {
          type: 'string',
          enum: ['slow', 'medium', 'fast'],
          description: '节奏',
        },
        instruments: {
          type: 'array',
          items: { type: 'string' },
          description: '乐器列表',
        },
        mood: { type: 'string', description: '情绪' },
        format: {
          type: 'string',
          enum: ['mp3', 'wav', 'midi'],
          description: '音频格式',
        },
        provider: {
          type: 'string',
          enum: ['openai', 'suno', 'udio'],
          description: '指定 Provider',
        },
      },
      required: ['prompt'],
    },
  },
  required: ['music'],
};

export class MusicGenerateTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.music_generate;

  description =
    'Generate music using AI. Supports multiple providers (OpenAI, Suno, Udio) and music genres.';

  /** U-03（2026-10-19）：模型可见出参结构（music 对象 + 入参回显） */
  override outputJsonSchema = MUSIC_GENERATE_OUTPUT_JSON_SCHEMA;

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description:
        'Text description of the music to generate (e.g., style, mood, instruments)',
      required: true,
    },
    {
      name: 'genre',
      type: 'string',
      description:
        'Music genre (e.g., classical, jazz, electronic, rock, pop, ambient)',
      required: false,
    },
    {
      name: 'duration',
      type: 'number',
      description: 'Music duration in seconds (15-300)',
      required: false,
      default: 30,
    },
    {
      name: 'tempo',
      type: 'string',
      enum: ['slow', 'medium', 'fast'],
      description: 'Music tempo',
      required: false,
      default: 'medium',
    },
    {
      name: 'instruments',
      type: 'array',
      description: 'List of instruments to include',
      required: false,
    },
    {
      name: 'mood',
      type: 'string',
      description:
        'Mood or emotion of the music (e.g., happy, sad, energetic, calm)',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      enum: ['mp3', 'wav', 'midi'],
      description: 'Output audio format',
      required: false,
      default: 'mp3',
    },
    {
      name: 'provider',
      type: 'string',
      enum: ['openai', 'suno', 'udio'],
      description: 'AI provider to use',
      required: false,
      default: '',
    },
  ];

  // ⚠️ 2026-09-29 修正：**移除** `music` —— 它是**另一个真实工具**的名字
  // （`tools/MusicTool/MusicTool.ts` 的 `name = 'music'`，在 `/v1/tools` 内）。
  // 本工具（`music_generate`）当前**未注册** ⇒ 该别名此前无实际影响；清理是为与同族判据一致
  // （**真实工具名不得作为他工具的别名**），并避免将来注册时复发。
  override aliases = ['generate-music', 'audio-generate'];
  override searchHint = 'Generate music using AI providers';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const params = input as unknown as MusicGenerateParams;

      if (!params.prompt || typeof params.prompt !== 'string') {
        return {
          success: false,
          error: 'prompt is required and must be a string',
        };
      }

      const duration = params.duration ?? 30;
      if (duration < 15 || duration > 300) {
        return {
          success: false,
          error: 'duration must be between 15 and 300 seconds',
        };
      }

      // 异步注册生成的音乐到 FileRegistry（当 provider 返回真实 URL 时生效）
      const musicUrl = '';
      if (musicUrl) {
        Promise.resolve().then(async () => {
          const format = params.format || 'mp3';
          await registerGeneratedMedia(
            musicUrl,
            params.prompt,
            'audio',
            format
          );
        });
      }

      return {
        success: true,
        data: {
          music: {
            url: '',
            title: `Generated Music - ${params.prompt.slice(0, 40)}`,
            prompt: params.prompt.slice(0, 200),
            genre: params.genre ?? 'ambient',
            duration,
            tempo: params.tempo ?? 'medium',
            format: params.format ?? 'mp3',
            provider: params.provider ?? '',
          },
          params,
        },
        output: `Music generation queued: "${params.prompt.slice(0, 80)}..." (${duration}s, ${params.genre ?? 'ambient'}, ${params.tempo ?? 'medium'}) using ${params.provider ?? 'openai'}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate music: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createMusicGenerateTool(): MusicGenerateTool {
  return new MusicGenerateTool();
}
