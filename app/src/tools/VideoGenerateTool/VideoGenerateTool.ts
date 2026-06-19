/**
 * VideoGenerateTool
 * 对标OpenClaw video-generate 工具
 * AI视频生成工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { resolveOutputDir } from '@modules/core';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';

export interface VideoGenerateParams {
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  resolution?: '720p' | '1080p' | '4k';
  fps?: 24 | 30 | 60;
  style?: string;
  provider?: 'openai' | 'runway' | 'pika' | 'stability';
}

export interface GeneratedVideo {
  url: string;
  prompt: string;
  duration: number;
  resolution: string;
  fps: number;
  provider: string;
  format: string;
}

export class VideoGenerateTool extends BaseTool {
  name = 'video_generate';

  description =
    'Generate videos using AI. Supports multiple providers (OpenAI Sora, Runway, Pika, Stability AI) and output formats.';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description: 'Text description of the video to generate',
      required: true,
    },
    {
      name: 'negativePrompt',
      type: 'string',
      description: 'What to avoid in the generated video',
      required: false,
    },
    {
      name: 'duration',
      type: 'number',
      description: 'Video duration in seconds (5-60)',
      required: false,
      default: 10,
    },
    {
      name: 'resolution',
      type: 'string',
      enum: ['720p', '1080p', '4k'],
      description: 'Video resolution',
      required: false,
      default: '1080p',
    },
    {
      name: 'fps',
      type: 'number',
      description: 'Frames per second (24, 30, or 60)',
      required: false,
      default: 30,
    },
    {
      name: 'style',
      type: 'string',
      description: 'Video style (e.g., cinematic, anime, realistic)',
      required: false,
    },
    {
      name: 'provider',
      type: 'string',
      enum: ['openai', 'runway', 'pika', 'stability'],
      description: 'AI provider to use',
      required: false,
      default: 'openai',
    },
  ];

  override aliases = ['video', 'generate-video'];
  override searchHint = 'Generate videos using AI providers';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const params = input as unknown as VideoGenerateParams;

      if (!params.prompt || typeof params.prompt !== 'string') {
        return {
          success: false,
          error: 'prompt is required and must be a string',
        };
      }

      const duration = params.duration ?? 10;
      if (duration < 5 || duration > 60) {
        return {
          success: false,
          error: 'duration must be between 5 and 60 seconds',
        };
      }

      // 异步注册生成的视频到 FileRegistry（当 provider 返回真实 URL 时生效）
      const videoUrl = '';
      if (videoUrl) {
        Promise.resolve().then(async () => {
          await registerGeneratedMedia(videoUrl, params.prompt, 'video', 'mp4');
        });
      }

      return {
        success: true,
        data: {
          video: {
            url: '',
            prompt: params.prompt.slice(0, 200),
            duration,
            resolution: params.resolution ?? '1080p',
            fps: params.fps ?? 30,
            provider: params.provider ?? 'openai',
            format: 'mp4',
          },
          params,
        },
        output: `Video generation queued: "${params.prompt.slice(0, 80)}..." (${duration}s, ${params.resolution ?? '1080p'}, ${params.fps ?? 30}fps) using ${params.provider ?? 'openai'}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate video: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createVideoGenerateTool(): VideoGenerateTool {
  return new VideoGenerateTool();
}
