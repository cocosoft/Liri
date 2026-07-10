/**
 * VideoGenerateTool
 * AI 视频生成工具 — 模型管理驱动（照搬 ImageGenerateTool 模式）
 *
 * 支持双路径：
 *   - Router 模式（推荐）：resolveModelRoute → modelPricingService → providerRegistry
 *   - 兼容模式：params.provider 指定时直调 providerRegistry
 *
 * 异步支持（P0 简化版）：
 *   - 同步模式（默认）：等待生成完成
 *   - 异步模式（async: true）：立即返回 taskId，后台执行
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import type {
  AIProvider,
  VideoGenerationResult,
} from '../../ai/providers/AIProvider';
import {
  resolveModelRoute,
  RouteKey,
} from '../../ai/router/resolveModelRoute.js';
import { VideoGenerationRouter } from './VideoGenerationRouter';
import { RegistryVideoProvider } from './providers/RegistryVideoProvider';
import { randomUUID } from 'crypto';
import { globalEventBus, SystemEvents } from '../../core/events/EventBus';
import { getVideoTaskPersistence } from './VideoTaskPersistence';
import { getImageSafetyFilter } from '../ImageGenerateTool/ImageSafetyFilter';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:videoGenerate',
});

export interface VideoGenerateParams {
  prompt: string;

  /** 可选 Provider 指定（兼容旧调用方式），未指定则从模型管理解析 */
  provider?: string;

  /** 可选覆盖模型，不传则从模型管理解析 */
  model?: string;

  /** 图生视频：本地图片路径 */
  imagePath?: string;

  /** 图生视频：远程图片 URL */
  imageUrl?: string;

  /** 反向提示词 */
  negativePrompt?: string;

  /** 视频时长（秒） */
  duration?: number;

  /** 宽高比，如 "16:9"、"9:16"、"1:1" */
  aspectRatio?: string;

  /** 分辨率，如 "720p"、"1080p" */
  resolution?: string;

  /** 随机种子 */
  seed?: number;

  /** 风格 */
  style?: string;

  /** 生成数量，默认 1 */
  n?: number;

  /** 是否异步模式（立即返回 taskId） */
  async?: boolean;
}

export class VideoGenerateTool extends BaseTool {
  name = 'video_generate';

  description =
    'Generate videos using AI. Supports text-to-video and image-to-video via FAL.ai (Kling, Runway, MiniMax, etc.).';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description: 'Text description of the video to generate',
      required: true,
    },
    {
      name: 'provider',
      type: 'string',
      description:
        'AI provider to use (optional, auto-resolved from model management)',
      required: false,
    },
    {
      name: 'model',
      type: 'string',
      description: 'Model ID override (optional)',
      required: false,
    },
    {
      name: 'imagePath',
      type: 'string',
      description: 'Local image path for image-to-video generation',
      required: false,
    },
    {
      name: 'imageUrl',
      type: 'string',
      description: 'Remote image URL for image-to-video generation',
      required: false,
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
      description: 'Video duration in seconds',
      required: false,
    },
    {
      name: 'aspectRatio',
      type: 'string',
      description: 'Aspect ratio (e.g. "16:9", "9:16", "1:1")',
      required: false,
    },
    {
      name: 'resolution',
      type: 'string',
      description: 'Video resolution (e.g. "720p", "1080p")',
      required: false,
    },
    {
      name: 'seed',
      type: 'number',
      description: 'Random seed for reproducible generation',
      required: false,
    },
    {
      name: 'style',
      type: 'string',
      description: 'Video style (e.g., cinematic, anime, realistic)',
      required: false,
    },
    {
      name: 'async',
      type: 'boolean',
      description:
        'Run asynchronously in background (returns taskId immediately)',
      required: false,
      default: false,
    },
  ];

  override aliases = ['video', 'generate-video'];
  override searchHint = 'Generate videos using AI providers';

  // ----- Router 缓存（5 分钟 TTL）-----

  private static router: VideoGenerationRouter | null = null;
  private static routerCreatedAt: number = 0;
  private static readonly ROUTER_TTL = 5 * 60 * 1000;

  /** 缓存解析到的模型名（用于 Router 模式透传） */
  private static resolvedModelName: string = '';

  // ----- 异步任务持久化 -----

  private static getPersistence(): ReturnType<typeof getVideoTaskPersistence> {
    return getVideoTaskPersistence();
  }

  // ================================================================
  //  入口
  // ================================================================

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const params = input as unknown as VideoGenerateParams;

    if (!params.prompt || typeof params.prompt !== 'string') {
      return {
        success: false,
        error: 'prompt is required and must be a string',
      };
    }

    // 内容安全审核（复用 ImageSafetyFilter 的 prompt 关键词检测）
    const safetyCheck = getImageSafetyFilter().beforeGenerate(params.prompt);
    if (!safetyCheck.passed) {
      return {
        success: false,
        error: `内容安全审核未通过: ${safetyCheck.reason}`,
      };
    }

    try {
      // 异步模式：立即返回 taskId，后台执行
      if (params.async === true) {
        return this.executeAsync(params);
      }

      // 同步模式：等待生成完成
      const result = await this.runVideoGeneration(params);
      return this.buildToolResult(result);
    } catch (error) {
      logger.error('VideoGenerateTool . execute() 异常', {
        error: error instanceof Error ? error.message : String(error),
      });
      await handleError(error, {
        module: 'tools:videoGenerate',
        action: 'execute',
      });
      return {
        success: false,
        error: `视频生成失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ================================================================
  //  异步模式
  // ================================================================

  /** 异步模式：立即返回 taskId，后台执行，结果持久化到 video_tasks 表 */
  private executeAsync(params: VideoGenerateParams): ToolResult {
    const taskId = randomUUID();
    const persistence = VideoGenerateTool.getPersistence();

    // 判断生成模式
    const isImageToVideo = !!(params.imageUrl || params.imagePath);
    const mode: 'text-to-video' | 'image-to-video' = isImageToVideo
      ? 'image-to-video'
      : 'text-to-video';

    // 持久化任务记录（重启后不丢失）
    persistence.create({
      id: taskId,
      status: 'pending',
      mode,
      prompt: params.prompt,
      model: params.model,
      sourceImageUrl: params.imageUrl || params.imagePath || undefined,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    this.runVideoGeneration(params)
      .then(async (result) => {
        if (result.success) {
          const toolResult = await this.buildToolResult(result);
          const videoData = toolResult.data as any;
          const resultVideoUrl =
            videoData?.video?.url || videoData?.videos?.[0]?.url || undefined;

          persistence.update(taskId, {
            status: 'completed',
            progress: 100,
            resultJson: JSON.stringify(result.data),
            resultVideoUrl,
            completedAt: Date.now(),
          });
          globalEventBus.publish(SystemEvents.TASK_COMPLETED, {
            taskId,
            taskType: 'video_generation',
            result: {
              model: result.model,
              videos: result.data,
              durationMs: result.durationMs,
              resultVideoUrl,
            },
          });
        } else {
          persistence.update(taskId, {
            status: 'failed',
            progress: 0,
            error: result.error,
            completedAt: Date.now(),
          });
          globalEventBus.publish(SystemEvents.TASK_FAILED, {
            taskId,
            taskType: 'video_generation',
            error: result.error,
          });
        }
      })
      .catch((error) => {
        persistence.update(taskId, {
          status: 'failed',
          progress: 0,
          error: error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
        });
        globalEventBus.publish(SystemEvents.TASK_FAILED, {
          taskId,
          taskType: 'video_generation',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    logger.info('VideoGenerateTool 异步任务已提交', { taskId, mode });
    return {
      success: true,
      data: { taskId, status: 'pending' },
      output: `视频生成任务已提交 (taskId: ${taskId})，生成完成后将自动保存。`,
    };
  }

  // ================================================================
  //  统一生成入口
  // ================================================================

  /** 统一生成入口（同步/异步共享） */
  private async runVideoGeneration(
    params: VideoGenerateParams
  ): Promise<VideoGenerationResult> {
    // 归一化：imagePath → imageUrl（Provider 层只认 imageUrl）
    const resolvedParams = { ...params };

    if (resolvedParams.imagePath && !resolvedParams.imageUrl) {
      // 如果是远程 URL（http/https），直接作为 imageUrl
      if (
        resolvedParams.imagePath.startsWith('http://') ||
        resolvedParams.imagePath.startsWith('https://')
      ) {
        resolvedParams.imageUrl = resolvedParams.imagePath;
      }
      // 本地路径后续可扩展为 upload → URL 流程
    }

    // 兼容模式：指定 provider 时直调 providerRegistry
    if (resolvedParams.provider) {
      logger.info('VideoGenerateTool . 走兼容模式', {
        provider: resolvedParams.provider,
      });
      const provider = providerRegistry.get(resolvedParams.provider);
      if (!provider.generateVideo) {
        return {
          success: false,
          data: [],
          error: `Provider "${resolvedParams.provider}" 不支持视频生成`,
          durationMs: 0,
        };
      }
      const model =
        resolvedParams.model ||
        (await resolveModelRoute(RouteKey.VIDEO_GENERATE)) ||
        '';
      return provider.generateVideo({ ...resolvedParams, model });
    }

    // Router 模式：从模型管理解析 Provider（推荐路径）
    logger.info('VideoGenerateTool . 走 Router 模式');
    const router = await this.getRouter();
    const model =
      resolvedParams.model || VideoGenerateTool.resolvedModelName || '';
    return router.generate({ ...resolvedParams, model });
  }

  // ================================================================
  //  Router 创建（照搬 ImageGenerateTool.getRouter()）
  // ================================================================

  /** 获取 Router 实例（模型驱动 + TTL 刷新） */
  private async getRouter(): Promise<VideoGenerationRouter> {
    // TTL 过期时自动重建
    if (
      VideoGenerateTool.router &&
      Date.now() - VideoGenerateTool.routerCreatedAt >
        VideoGenerateTool.ROUTER_TTL
    ) {
      logger.info('VideoGenerateTool.getRouter() . Router TTL 过期，重建');
      VideoGenerateTool.router = null;
    }

    // 空 Provider 时重建
    if (
      VideoGenerateTool.router &&
      VideoGenerateTool.router.getProviders().length === 0
    ) {
      VideoGenerateTool.router = null;
    }

    if (!VideoGenerateTool.router) {
      logger.info('VideoGenerateTool.getRouter() . 创建 Router（模型驱动）');
      VideoGenerateTool.router = new VideoGenerationRouter();
      VideoGenerateTool.routerCreatedAt = Date.now();

      try {
        // 1. 从模型管理/任务分工解析视频模型
        const resolvedModel = await resolveModelRoute(RouteKey.VIDEO_GENERATE);
        if (!resolvedModel) {
          throw new AppError(
            '未配置生视频模型，请在模型管理 → 任务分工中设置生视频模型',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'NO_VIDEO_MODEL_CONFIGURED'
          );
        }

        // 2. 从 DB 匹配模型记录
        const { modelPricingService } =
          await import('../../ai/models/ModelPricingService.js');
        await modelPricingService.initialize();
        const allModels = await modelPricingService.getAllPricing();
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            resolvedModel
          );
        const modelRecord = allModels.find((m) =>
          isUuid ? m.id === resolvedModel : m.modelId === resolvedModel
        );
        if (!modelRecord) {
          throw new AppError(
            `模型 "${resolvedModel}" 未在 DB 中注册`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'MODEL_NOT_FOUND'
          );
        }

        // 3. 通过 ProviderSyncService 解析 registry ID
        let providerRegistryId = modelRecord.providerId;
        try {
          const { getRegistryId } =
            await import('../../ai/providers/ProviderSyncService.js');
          const mapped = getRegistryId(modelRecord.providerId);
          if (mapped) providerRegistryId = mapped;
        } catch {
          /* 不可用时用原始值 */
        }

        // 4. 从 ProviderRegistry 获取 AIProvider 实例
        let aiProvider: AIProvider;
        try {
          aiProvider = providerRegistry.get(providerRegistryId);
        } catch {
          throw new AppError(
            `Provider "${modelRecord.providerId}" 未注册`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NOT_FOUND'
          );
        }

        // 5. 鸭子类型检查
        if (!aiProvider.generateVideo) {
          throw new AppError(
            `Provider "${aiProvider.displayName}" 不支持视频生成`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NO_VIDEO_SUPPORT'
          );
        }

        // 6. 归一化 Provider 类型
        const realType = providerRegistry.getProviderTypeById(aiProvider.id);
        const normalized = (realType ?? '').toLowerCase();
        let mappedType: 'fal' | 'openai' | null = null;
        if (normalized === 'fal') mappedType = 'fal';
        else if (
          normalized === 'openai' ||
          normalized === 'custom' ||
          normalized === 'siliconflow'
        )
          mappedType = 'openai';

        if (!mappedType) {
          throw new AppError(
            `无法确定 Provider "${aiProvider.displayName}" 的类型`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_TYPE_UNKNOWN'
          );
        }

        VideoGenerateTool.router.setProviders([
          new RegistryVideoProvider(aiProvider, mappedType),
        ]);
        VideoGenerateTool.resolvedModelName = modelRecord.modelId;
        logger.info('VideoGenerateTool.getRouter() . 模型匹配完成', {
          modelId: modelRecord.modelId,
          provider: aiProvider.displayName,
          mappedType,
        });
      } catch (error) {
        logger.error('VideoGenerateTool . 创建 Router 失败', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return VideoGenerateTool.router;
  }

  // ================================================================
  //  结果转换
  // ================================================================

  /** 将 VideoGenerationResult 转为 ToolResult + 注册到 FileRegistry */
  private async buildToolResult(
    result: VideoGenerationResult
  ): Promise<ToolResult> {
    if (!result.success) {
      return {
        success: false,
        error: result.error || '视频生成失败',
      };
    }

    const videos = result.data || [];

    // 异步注册生成的视频到 FileRegistry
    for (const video of videos) {
      if (!video.url) continue;
      const ext = video.format || 'mp4';
      Promise.resolve().then(async () => {
        try {
          await registerGeneratedMedia(video.url, `AI 生成视频`, 'video', ext);
        } catch (e) {
          logger.warn('VideoGenerateTool . registerMediaFile 失败', {
            url: video.url,
            error: String(e),
          });
        }
      });
    }

    const firstVideo = videos[0];
    return {
      success: true,
      data: {
        video: firstVideo
          ? {
              url: firstVideo.url,
              prompt: `AI 生成视频 - ${videoUrlsToText(videos)}`,
              duration: firstVideo.duration ?? 0,
              format: firstVideo.format || 'mp4',
            }
          : null,
        videos: videos.map((v) => ({
          url: v.url,
          width: v.width,
          height: v.height,
          duration: v.duration,
          format: v.format,
        })),
        model: result.model,
        durationMs: result.durationMs,
        cost: {
          durationSeconds: (result.durationMs || 0) / 1000,
          estimatedCostUsd: ((result.durationMs || 0) / 1000) * 0.001,
          billedBy: 'duration',
          model: result.model,
        },
      },
      output: `视频生成完成: ${videos.length} 个视频，耗时 ${(result.durationMs / 1000).toFixed(1)}s，模型 ${result.model || 'unknown'}`,
    };
  }
}

/** 将视频 URL 列表转为简要文本 */
function videoUrlsToText(videos: Array<{ url: string }>): string {
  if (videos.length === 0) return '';
  if (videos.length === 1) return videos[0].url;
  return `${videos[0].url} (共 ${videos.length} 个)`;
}

export function createVideoGenerateTool(): VideoGenerateTool {
  return new VideoGenerateTool();
}
