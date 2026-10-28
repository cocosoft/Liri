import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
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
import path from 'path';
import { resolveMediaDir } from '@modules/environment';
import { resolveAccessibleMediaUrl } from '../MediaUrlResolver';

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

/**
 * U-03（2026-10-19）：`video_display` 的**模型可见出参结构**（JSON Schema），
 * 与 `VideoDisplayOutput` 逐字段对齐（失败分支无 `data` 载荷）。
 */
const VIDEO_DISPLAY_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    videos: {
      type: 'array',
      description: '可播放的视频列表',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '可访问的播放地址' },
          name: { type: 'string', description: '视频名称' },
          size: { type: 'number', description: '文件大小（字节）' },
          originalPath: {
            type: 'string',
            description: '原始路径或 URL（入参回显）',
          },
        },
        required: ['url', 'name', 'originalPath'],
      },
    },
    count: { type: 'number', description: '有效视频数量' },
  },
  required: ['videos', 'count'],
};

export class VideoDisplayTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.video_display;

  override tags = [ToolTag.READ];

  description =
    'Display/preview videos directly in the chat conversation. MUST call this after generating videos with video_generate to show results to the user. ' +
    'Users cannot open file paths themselves — videos are only visible when you use this tool. ' +
    'Accepts local file paths or URLs. Supports video playback with controls.';

  /** U-03（2026-10-19）：模型可见出参结构（videos/count） */
  override outputJsonSchema = VIDEO_DISPLAY_OUTPUT_JSON_SCHEMA;

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

      const resolvedPath = path.resolve(trimmed);
      if (!existsSync(resolvedPath)) {
        logger.warn('视频文件不存在，跳过', { path: resolvedPath });
        continue;
      }

      // 2026-08-12 统一修复：按文件实际位置生成可访问 URL（视频库内直接映射，非安全根复制到视频库 imported/）
      const displayUrl = resolveAccessibleMediaUrl(resolvedPath, {
        mediaRoot: path.join(resolveMediaDir(), 'video'),
        mediaPrefix: '/v1/videos/static/',
      });
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
