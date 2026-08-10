/**
 * VideoDisplayTool
 * AI 可调用的视频预览工具 — 在聊天中直接播放视频
 *
 * 参数: videos (string[]) — 视频路径或 URL 列表
 * 输出: { videos: DisplayVideo[] } — 前端渲染视频播放器
 */
import { getLogger } from '@modules/monitoring';
import { BaseTool } from '../BaseTool';
import { ToolResult, ToolUseContext, ToolParam, ToolTag } from '../types/index';
import { VideoUrlHelper } from '../VideoUrlHelper';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const logger = getLogger('tools:videoDisplay');

export interface DisplayVideo {
  url: string;
  name: string;
  size?: number;
  originalPath: string;
}

export interface VideoDisplayOutput {
  videos: DisplayVideo[];
  count: number;
}

export class VideoDisplayTool extends BaseTool {
  name = 'video_display';

  override tags = [ToolTag.READ];

  description =
    'Display/preview videos directly in the chat conversation. MUST call this after generating videos with video_generate to show results to the user. ' +
    'Users cannot open file paths themselves — videos are only visible when you use this tool. ' +
    'Accepts local file paths or URLs. Supports video playback with controls.';

  params: ToolParam[] = [
    {
      name: 'videos',
      type: 'array',
      description:
        'Array of video file paths or URLs to display. ' +
        'e.g. ["/path/to/video.mp4", "https://example.com/video.webm"]',
      required: true,
      items: {
        type: 'string',
        description: '视频文件路径或 URL',
      },
    },
  ];

  async execute(
    params: { videos: string[] },
    _context: ToolUseContext
  ): Promise<ToolResult<VideoDisplayOutput>> {
    const { videos } = params;

    if (!Array.isArray(videos) || videos.length === 0) {
      return {
        success: false,
        error: 'videos 参数必须是非空数组',
      };
    }

    const displayVideos: DisplayVideo[] = [];

    for (const input of videos) {
      if (typeof input !== 'string' || !input.trim()) {
        continue;
      }

      const trimmed = input.trim();

      if (/^https?:\/\//i.test(trimmed)) {
        const urlParts = trimmed.split('/');
        const name = urlParts[urlParts.length - 1]?.split('?')[0] || 'video';
        displayVideos.push({
          url: trimmed,
          name,
          originalPath: trimmed,
        });
        continue;
      }

      const resolvedPath = resolve(trimmed);
      if (!existsSync(resolvedPath)) {
        logger.warn('视频文件不存在，跳过', { path: resolvedPath });
        continue;
      }

      const displayUrl = VideoUrlHelper.toDisplayUrl(resolvedPath);
      const name =
        VideoUrlHelper.extractFilename(resolvedPath) ||
        resolvedPath.split(/[\\/]/).pop() ||
        'video';

      let size: number | undefined;
      try {
        size = statSync(resolvedPath).size;
      } catch (err) {
        // 忽略 stat 错误
      }

      displayVideos.push({
        url: displayUrl,
        name,
        size,
        originalPath: resolvedPath,
      });
    }

    if (displayVideos.length === 0) {
      return {
        success: false,
        error: '没有有效的视频可显示（文件不存在或路径无效）',
      };
    }

    logger.info(`显示 ${displayVideos.length} 个视频`, {
      count: displayVideos.length,
    });

    return {
      success: true,
      data: {
        videos: displayVideos,
        count: displayVideos.length,
      },
    };
  }
}
