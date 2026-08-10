/**
 * AudioPlayTool
 * AI 可调用的音频播放工具 — 在聊天中直接播放音频
 *
 * 参数: audios (string[]) — 音频路径或 URL 列表
 * 输出: { audios: DisplayAudio[] } — 前端渲染音频播放器
 */
import { getLogger } from '@modules/monitoring';
import { BaseTool } from '../BaseTool';
import { ToolResult, ToolUseContext, ToolParam, ToolTag } from '../types/index';
import { AudioUrlHelper } from '../AudioUrlHelper';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const logger = getLogger('tools:audioPlay');

export interface DisplayAudio {
  url: string;
  name: string;
  size?: number;
  originalPath: string;
}

export interface AudioPlayOutput {
  audios: DisplayAudio[];
  count: number;
}

export class AudioPlayTool extends BaseTool {
  name = 'audio_play';

  override tags = [ToolTag.READ];

  description =
    'Play audio files directly in the chat conversation. MUST call this after generating music/audio with music_generate to let users listen. ' +
    'Users cannot open file paths themselves — audio is only playable when you use this tool. ' +
    'Accepts local file paths or URLs. Supports audio playback with controls.';

  params: ToolParam[] = [
    {
      name: 'audios',
      type: 'array',
      description:
        'Array of audio file paths or URLs to play. ' +
        'e.g. ["/path/to/music.mp3", "https://example.com/audio.wav"]',
      required: true,
      items: {
        type: 'string',
        description: '音频文件路径或 URL',
      },
    },
  ];

  async execute(
    params: { audios: string[] },
    _context: ToolUseContext
  ): Promise<ToolResult<AudioPlayOutput>> {
    const { audios } = params;

    if (!Array.isArray(audios) || audios.length === 0) {
      return {
        success: false,
        error: 'audios 参数必须是非空数组',
      };
    }

    const displayAudios: DisplayAudio[] = [];

    for (const input of audios) {
      if (typeof input !== 'string' || !input.trim()) {
        continue;
      }

      const trimmed = input.trim();

      if (/^https?:\/\//i.test(trimmed)) {
        const urlParts = trimmed.split('/');
        const name = urlParts[urlParts.length - 1]?.split('?')[0] || 'audio';
        displayAudios.push({
          url: trimmed,
          name,
          originalPath: trimmed,
        });
        continue;
      }

      const resolvedPath = resolve(trimmed);
      if (!existsSync(resolvedPath)) {
        logger.warn('音频文件不存在，跳过', { path: resolvedPath });
        continue;
      }

      const displayUrl = AudioUrlHelper.toDisplayUrl(resolvedPath);
      const name =
        AudioUrlHelper.extractFilename(resolvedPath) ||
        resolvedPath.split(/[\\/]/).pop() ||
        'audio';

      let size: number | undefined;
      try {
        size = statSync(resolvedPath).size;
      } catch (err) {
        // 忽略 stat 错误
      }

      displayAudios.push({
        url: displayUrl,
        name,
        size,
        originalPath: resolvedPath,
      });
    }

    if (displayAudios.length === 0) {
      return {
        success: false,
        error: '没有有效的音频可播放（文件不存在或路径无效）',
      };
    }

    logger.info(`播放 ${displayAudios.length} 个音频`, {
      count: displayAudios.length,
    });

    return {
      success: true,
      data: {
        audios: displayAudios,
        count: displayAudios.length,
      },
    };
  }
}
