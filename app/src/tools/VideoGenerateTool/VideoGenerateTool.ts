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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTempDir } from '@modules/core/paths';

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

    // 图生视频：有图片时 prompt 可选；文生视频：必须输入 prompt
    const hasImage = !!(params.imagePath || params.imageUrl);
    if (!hasImage && (!params.prompt || typeof params.prompt !== 'string')) {
      return {
        success: false,
        error:
          'prompt is required and must be a string (optional when image is provided)',
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
    const startedAt = Date.now();

    // 判断生成模式
    const isImageToVideo = !!(params.imageUrl || params.imagePath);
    const mode: 'text-to-video' | 'image-to-video' = isImageToVideo
      ? 'image-to-video'
      : 'text-to-video';

    // 大模型预估耗时（Wan2.2-I2V-A14B 约 20 分钟，T2V 约 10 分钟）
    const estimatedMs = isImageToVideo ? 20 * 60 * 1000 : 10 * 60 * 1000;

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

    // 定时更新进度：基于已用时间 + 对数曲线模拟（上限 90%，完成时跳到 100%）
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // 对数曲线：前期快、后期慢，更接近真实生成感知
      const raw = Math.log(1 + (elapsed / estimatedMs) * 9) / Math.log(10);
      const progress = Math.min(Math.round(raw * 90), 90);
      persistence.update(taskId, { progress });
    }, 5000);

    // 确保 interval 不会无限运行（安全上限）
    const maxTimer = setTimeout(() => {
      clearInterval(progressInterval);
    }, estimatedMs * 2);

    this.runVideoGeneration(params)
      .then(async (result) => {
        clearInterval(progressInterval);
        clearTimeout(maxTimer);

        if (result.success) {
          // 先跳到 95% 让用户感知即将完成
          persistence.update(taskId, { progress: 95 });
          const toolResult = await this.buildToolResult(result);
          const videoData = toolResult.data as any;
          const resultVideoUrl =
            videoData?.video?.url || videoData?.videos?.[0]?.url || undefined;

          // 检测下载是否成功：本地 URL 以 /v1/videos/static/ 开头
          const isLocalUrl =
            resultVideoUrl && resultVideoUrl.startsWith('/v1/videos/static/');

          if (!isLocalUrl && resultVideoUrl) {
            logger.error(
              'VideoGenerateTool . 视频生成成功但下载到本地失败（URL非本地）',
              { taskId, resultVideoUrl: resultVideoUrl.slice(0, 120) }
            );
          }

          persistence.update(taskId, {
            status: isLocalUrl || !resultVideoUrl ? 'completed' : 'completed',
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
          logger.error('VideoGenerateTool 异步任务失败', {
            taskId,
            mode,
            error: result.error,
            prompt: params.prompt?.slice(0, 80),
          });
          await handleError(
            new AppError(
              result.error || '未知错误',
              ErrorCategory.API,
              ErrorSeverity.HIGH,
              'VIDEO_GEN_FAILED'
            ),
            { module: 'tools:videoGenerate', action: 'executeAsync' }
          );
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
      .catch(async (error) => {
        clearInterval(progressInterval);
        clearTimeout(maxTimer);

        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('VideoGenerateTool 异步任务异常崩溃', {
          taskId,
          mode,
          error: errorMsg,
          stack: error instanceof Error ? error.stack : undefined,
        });
        await handleError(error, {
          module: 'tools:videoGenerate',
          action: 'executeAsync',
        });
        persistence.update(taskId, {
          status: 'failed',
          progress: 0,
          error: errorMsg,
          completedAt: Date.now(),
        });
        globalEventBus.publish(SystemEvents.TASK_FAILED, {
          taskId,
          taskType: 'video_generation',
          error: errorMsg,
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

    // 图生视频：将本地/内网 imageUrl 下载到临时文件（供 Provider 上传用）
    // 注意：同时保留 imageUrl 和 imagePath，各 Provider 按能力选用
    if (resolvedParams.imageUrl && !resolvedParams.imagePath) {
      const localFile = await this.normalizeImageUrlToPath(
        resolvedParams.imageUrl
      );
      if (localFile) {
        resolvedParams.imagePath = localFile;
        // 不清空 imageUrl！保留原始 URL 供能够直接访问的 Provider 使用
        logger.info('VideoGenerateTool . imageUrl 转本地临时文件', {
          imagePath: localFile,
          imageUrl: resolvedParams.imageUrl?.slice(0, 80),
        });
      }
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
    logger.info('VideoGenerateTool . 走 Router 模式', {
      mode:
        resolvedParams.imageUrl || resolvedParams.imagePath
          ? 'image-to-video'
          : 'text-to-video',
      prompt: resolvedParams.prompt?.slice(0, 60),
    });
    try {
      // 按生成模式选择任务分工：文生视频 / 图生视频
      const isImageToVideo = !!(
        resolvedParams.imageUrl || resolvedParams.imagePath
      );

      // 每次都重新解析模型名（不依赖静态缓存 resolvedModelName）
      let model = resolvedParams.model || '';
      if (!model) {
        const routeKey = isImageToVideo
          ? RouteKey.IMAGE_TO_VIDEO
          : RouteKey.TEXT_TO_VIDEO;

        // 图生视频回退链：IMAGE_TO_VIDEO → TEXT_TO_VIDEO → VIDEO_GENERATE
        // resolveModelRoute() 对未配置任务类型会回退到 default（对话模型）
        // 因此每一步都必须校验视频能力，不通过则继续尝试下一个 fallback
        model = await resolveModelRoute(routeKey);

        if (model && !(await this.checkModelVideoCapability(model))) {
          logger.warning('VideoGenerateTool . 路由解析到非视频模型，继续回退', {
            model,
            routeKey,
            mode: isImageToVideo ? 'image-to-video' : 'text-to-video',
          });
          model = '';
        }

        if (!model && isImageToVideo) {
          model = await resolveModelRoute(RouteKey.TEXT_TO_VIDEO);

          if (model && !(await this.checkModelVideoCapability(model))) {
            logger.warning(
              'VideoGenerateTool . TEXT_TO_VIDEO 回退解析到非视频模型，继续回退',
              { model }
            );
            model = '';
          }
        }

        if (!model) {
          model = await resolveModelRoute(RouteKey.VIDEO_GENERATE);

          if (model && !(await this.checkModelVideoCapability(model))) {
            logger.warning(
              'VideoGenerateTool . VIDEO_GENERATE 回退解析到非视频模型',
              { model }
            );
            model = '';
          }
        }

        logger.info('VideoGenerateTool . 路由解析模型（任务分工）', {
          mode: isImageToVideo ? 'image-to-video' : 'text-to-video',
          routeKey,
          resolved: model || '(空)',
        });
      }

      const router = await this.getRouter(model);

      if (!model) {
        logger.error('VideoGenerateTool . 未解析到生视频模型');
        return {
          success: false,
          data: [],
          error:
            '未配置生视频模型。请在 模型管理 → 任务分工 中为"生视频"任务指定一个支持视频生成的模型。',
          durationMs: 0,
        };
      }

      logger.info('VideoGenerateTool . Router 已就绪', {
        model,
        providers: router.getProviders().map((p) => p.type),
      });

      const result = await router.generate({ ...resolvedParams, model });

      if (!result.success) {
        logger.error('VideoGenerateTool . Router 生成失败', {
          model,
          error: result.error,
          providerCount: router.getProviders().length,
        });
        await handleError(
          new AppError(
            result.error || '所有 Provider 均失败',
            ErrorCategory.API,
            ErrorSeverity.HIGH,
            'VIDEO_ROUTER_ALL_FAILED'
          ),
          { module: 'tools:videoGenerate', action: 'generate' }
        );
      }

      return result;
    } catch (e) {
      logger.error('VideoGenerateTool . Router 模式异常', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      await handleError(e, {
        module: 'tools:videoGenerate',
        action: 'generate',
      });
      return {
        success: false,
        data: [],
        error: `视频生成路由异常: ${e instanceof Error ? e.message : String(e)}`,
        durationMs: 0,
      };
    }
  }

  // ================================================================
  //  Router 创建（照搬 ImageGenerateTool.getRouter()）
  // ================================================================

  /**
   * 检查模型是否具备视频生成能力
   *
   * 通过 DB model_registry.capabilities 字段校验，
   * 防止 modelRouter.resolve() 回退链将对话模型泄漏到视频 API。
   */
  private async checkModelVideoCapability(modelId: string): Promise<boolean> {
    try {
      const { modelPricingService } =
        await import('../../ai/models/ModelPricingService.js');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();
      const modelRecord = allModels.find(
        (m) => m.modelId === modelId || m.id === modelId
      );
      if (!modelRecord) return false;
      const caps = modelRecord.capabilities || [];
      return caps.some((c) =>
        ['video_generation', 'text_to_video', 'image_to_video'].includes(c)
      );
    } catch (err) {
      return false;
    }
  }

  // ================================================================
  //  Router 创建（照搬 ImageGenerateTool.getRouter()）
  // ================================================================

  /**
   * 将 imageUrl（可能是 localhost 或 /v1 路径）下载到本地临时文件
   *
   * 外部 Provider 无法访问本地 URL，需要先下载到文件，再由 Provider 上传。
   */
  private async normalizeImageUrlToPath(
    imageUrl: string
  ): Promise<string | null> {
    // 如果是外部可访问的 URL（非 localhost/127.0.0.1），不需要下载
    if (
      imageUrl.startsWith('https://') &&
      !imageUrl.includes('localhost') &&
      !imageUrl.includes('127.0.0.1')
    ) {
      return null; // 外部可访问，Provider 可直接用
    }

    logger.info('VideoGenerateTool . 下载本地 imageUrl', {
      url: imageUrl.slice(0, 120),
    });

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        logger.warn('VideoGenerateTool . 下载 imageUrl 失败', {
          status: response.status,
          url: imageUrl.slice(0, 120),
        });
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const tempDir = resolveTempDir();
      mkdirSync(tempDir, { recursive: true });

      const ext = response.headers.get('content-type')?.includes('png')
        ? '.png'
        : response.headers.get('content-type')?.includes('jpeg')
          ? '.jpg'
          : response.headers.get('content-type')?.includes('webp')
            ? '.webp'
            : '.png';

      const tempPath = join(tempDir, `video-src-${randomUUID()}${ext}`);
      writeFileSync(tempPath, buffer);

      logger.info('VideoGenerateTool . imageUrl 下载完成', {
        path: tempPath,
        size: buffer.length,
      });

      return tempPath;
    } catch (e) {
      logger.warn('VideoGenerateTool . imageUrl 下载异常', {
        error: String(e),
        url: imageUrl.slice(0, 120),
      });
      await handleError(e, {
        module: 'tools:videoGenerate',
        action: 'normalizeImageUrlToPath',
      });
      return null;
    }
  }

  // ================================================================
  //  Router 创建（照搬 ImageGenerateTool.getRouter()）
  // ================================================================

  /** 获取 Router 实例（模型驱动 + TTL 刷新）
   *
   * @param model — 可选：显式传入要使用的模型名，跳过 modelRouter 解析
   */
  private async getRouter(model?: string): Promise<VideoGenerationRouter> {
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
        // 1. 解析模型名：优先使用显式传入的模型，否则从任务分工解析（兼容旧路径）
        let resolvedModel = model || '';
        if (!resolvedModel) {
          resolvedModel = await resolveModelRoute(RouteKey.VIDEO_GENERATE);
        }

        if (!resolvedModel) {
          throw new AppError(
            '未配置生视频模型，请在模型管理 → 任务分工中设置生视频模型',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'NO_VIDEO_MODEL_CONFIGURED'
          );
        }

        // 2. 从 DB 匹配模型记录
        // model 可能是 UUID 或 modelId，需要同时按 id 和 modelId 匹配
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

        // 3. 验证模型能力：防止回退链将对话模型泄漏到视频 API
        const caps = modelRecord.capabilities || [];
        if (
          !caps.some((c) =>
            ['video_generation', 'text_to_video', 'image_to_video'].includes(c)
          )
        ) {
          throw new AppError(
            `模型 "${resolvedModel}" 不具备视频生成能力（当前 capabilities: [${caps.join(', ')}]）。请在模型管理中将该模型的 capabilities 添加 video_generation / text_to_video / image_to_video，或在任务分工中指定支持视频的模型。`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'MODEL_NOT_VIDEO_CAPABLE'
          );
        }

        // 4. 通过 ProviderSyncService 解析 registry ID
        let providerRegistryId = modelRecord.providerId;
        try {
          const { getRegistryId } =
            await import('../../ai/providers/ProviderSyncService.js');
          const mapped = getRegistryId(modelRecord.providerId);
          if (mapped) providerRegistryId = mapped;
        } catch (err) {
          /* 不可用时用原始值 */
        }

        // 5. 从 ProviderRegistry 获取 AIProvider 实例
        let aiProvider: AIProvider;
        try {
          aiProvider = providerRegistry.get(providerRegistryId);
        } catch (err) {
          throw new AppError(
            `Provider "${modelRecord.providerId}" 未注册`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NOT_FOUND'
          );
        }

        // 6. 鸭子类型检查
        if (!aiProvider.generateVideo) {
          throw new AppError(
            `Provider "${aiProvider.displayName}" 不支持视频生成`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NO_VIDEO_SUPPORT'
          );
        }

        // 7. 归一化 Provider 类型
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

    // 同步下载视频到本地并注册到 FileRegistry（对照 ImageGenerateTool）
    // 优先使用 Provider 层已下载的 Buffer（带鉴权），避免 FileRegistry 单独 fetch
    const persistedVideos = await Promise.all(
      videos.map(async (video) => {
        if (!video.url) return video;
        const ext = video.format || 'mp4';
        try {
          const regResult = await registerGeneratedMedia(
            video.url,
            `AI 生成视频`,
            'video',
            ext,
            result.videoBuffer
          );
          if (regResult?.savedPath) {
            return {
              ...video,
              localUrl: `/v1/videos/static/${regResult.savedPath}`,
              filePath: regResult.savedFullPath,
            };
          }
        } catch (e) {
          logger.warn('VideoGenerateTool . registerMediaFile 失败', {
            url: video.url,
            error: String(e),
          });
        }
        return video;
      })
    );

    const firstVideo = persistedVideos[0];
    const localUrl = (firstVideo as any)?.localUrl || firstVideo?.url;

    return {
      success: true,
      data: {
        video: firstVideo
          ? {
              url: localUrl,
              prompt: `AI 生成视频`,
              duration: firstVideo.duration ?? 0,
              format: firstVideo.format || 'mp4',
            }
          : null,
        videos: persistedVideos.map((v) => ({
          url: (v as any).localUrl || v.url,
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
      output: `视频生成完成: ${persistedVideos.length} 个视频，耗时 ${(result.durationMs / 1000).toFixed(1)}s，模型 ${result.model || 'unknown'}`,
    };
  }
}

export function createVideoGenerateTool(): VideoGenerateTool {
  return new VideoGenerateTool();
}
