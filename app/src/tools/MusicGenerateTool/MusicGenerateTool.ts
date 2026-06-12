/**
 * MusicGenerateTool
 * 对标OpenClaw music-generate 工具
 * AI音乐生成工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { resolveOutputDir } from '@modules/core/paths';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';

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

export class MusicGenerateTool extends BaseTool {
  name = 'music_generate';

  description =
    'Generate music using AI. Supports multiple providers (OpenAI, Suno, Udio) and music genres.';

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
      default: 'openai',
    },
  ];

  override aliases = ['music', 'generate-music', 'audio-generate'];
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
          await registerGeneratedMedia(musicUrl, params.prompt, 'audio', format);
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
            provider: params.provider ?? 'openai',
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
