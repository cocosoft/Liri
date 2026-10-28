/**
 * 启动全局 Cron 调度器（附带真实 AI 执行器）
 * REPL 与 DAEMON 模式共用入口（DAEMON 常驻模式此前不启动 cron，定时任务全挂）。
 * 内部完成：模型路由解析 → provider 探测 → AI 执行器 → 投递队列/路由器 → 调度器启动。
 * 无可用 provider 时自动降级为默认执行器（不依赖 AI），不阻塞调用方。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { buildCronDeliveryMessage } from './cronDeliveryMessage';

const logger = getLogger('cron:startEngine');

export interface StartCronEngineResult {
  /** true = AI 执行引擎就绪；false = 降级默认执行器（无 AI Provider） */
  realExecutor: boolean;
  providerName?: string;
}

interface CronDispatchJob {
  name: string;
  deliver?: string;
  origin?: { platform?: string; chatId?: string };
  sessionKey?: string;
  id?: string;
}

interface CronDispatchResult {
  output?: string;
  finalResponse?: string;
  success?: boolean;
  error?: string;
  durationMs?: number;
}

/**
 * 构造 Cron 投递器（origin → sessionKey → 主动队列 → 通知中心 → 本地日志）。
 *
 * U-01（2026-10-19）：投递能力**不依赖 AI Provider** —— 无 Provider / AI 初始化失败时
 * 也必须向用户汇报任务完成/失败，故本工厂在全部启动分支共用。
 */
function createCronDispatchDelivery(): (
  job: CronDispatchJob,
  result: CronDispatchResult
) => Promise<void> {
  return async (job, result): Promise<void> => {
    // 2026-10-19 修复：失败结果 output/finalResponse 为空，不能回退成「执行完成」
    const { title, content: message } = buildCronDeliveryMessage(
      job.name,
      result
    );

    // 1) 直接 origin 投递（需同时有 platform 和 chatId）
    if (
      job.deliver === 'origin' &&
      job.origin?.platform &&
      job.origin?.chatId
    ) {
      const { channelRegistry } = await import('@modules/channels');
      const platform = job.origin.platform;
      const chatId = job.origin.chatId;
      const channel = channelRegistry.get(platform);
      if (channel?.enabled) {
        await channel.sendMessage(chatId, message);
        logger.info('Cron 投递（origin）成功', {
          jobName: job.name,
          platform,
          chatId,
        });
        return;
      }
      logger.warn('Cron 投递（origin）失败：通道未注册或已禁用', {
        jobName: job.name,
        platform,
      });
    }

    // 2) sessionKey 反查：通过 ChannelSessionManager 查找渠道
    //    sessionKey = context.sessionId = message.conversationId ?? message.senderId
    //    ChannelSession.conversationId 正是此值，用 find() 按 conversationId 匹配
    if (job.sessionKey) {
      const { channelSessionManager } =
        await import('../../channels/session/ChannelSessionManager');
      const sessions = channelSessionManager.find({
        conversationId: job.sessionKey,
      });
      const channelSession = sessions.length > 0 ? sessions[0] : undefined;
      if (channelSession) {
        const { channelRegistry } = await import('@modules/channels');
        const channel = channelRegistry.get(channelSession.channelId);
        if (channel?.enabled) {
          await channel.sendMessage(channelSession.conversationId, message);
          logger.info('Cron 投递（sessionKey 反查）成功', {
            jobName: job.name,
            channelId: channelSession.channelId,
            conversationId: channelSession.conversationId,
          });
          return;
        }
      }
    }

    // 3) 主动队列（G-10 生产者；`PROACTIVE` 关闭时返回 false ⇒ 走原兜底）
    // U-01：区分「队列未启用」与「队列已启用但被门禁丢弃」—— 后者不得走兜底，
    // 否则 DND / 每小时上限 / 冷却会被通知中心兜底绕过。
    let droppedByProactiveGate = false;
    try {
      const { enqueueCronResultProactive } =
        await import('../../proactive/ProactiveCronProducer');
      const queued = await enqueueCronResultProactive({
        job: { id: job.id, name: job.name },
        result,
        title,
        body: message,
      });
      if (queued) {
        logger.info('Cron 投递（主动队列）', {
          jobName: job.name,
          jobId: job.id,
        });
        return;
      }
      const { getActiveProactiveQueue } =
        await import('../../proactive/ProactiveRuntime');
      droppedByProactiveGate = getActiveProactiveQueue() !== null;
    } catch (err) {
      await handleError(err, {
        module: 'cron:startEngine',
        action: 'proactiveEnqueue',
      });
    }

    if (droppedByProactiveGate) {
      logger.debug('Cron 投递：主动队列已启用但本次被门禁丢弃，跳过兜底', {
        jobName: job.name,
        jobId: job.id,
      });
      return;
    }

    // 4) 最终兜底：写入通知中心
    try {
      const { notificationPersistence } =
        await import('@modules/runtime/NotificationPersistence.js');
      await notificationPersistence().create({
        category: 'system',
        priority: 'normal',
        title,
        content: message,
        source: 'cron',
        source_ref: job.id,
      });
      logger.info('Cron 投递（通知中心兜底）', {
        jobName: job.name,
        jobId: job.id,
      });
    } catch {
      // 通知中心不可用 → 最后 resort: local log
      const { getDeliveryRouter } =
        await import('../../channels/DeliveryRouter');
      await getDeliveryRouter().deliverLocal({
        format: 'text',
        content: message,
      });
    }
  };
}

export async function startCronEngine(): Promise<StartCronEngineResult> {
  try {
    const { ensureGlobalCronSchedulerStarted } =
      await import('./GlobalCronScheduler');
    const { createCronExecutor } = await import('./CronExecutor');
    const { modelRouter } = await import('@modules/ai');
    const { resolveModelRoute, RouteKey } = await import('@modules/ai');
    const { providerRegistry } = await import('@modules/ai');

    const cronModel =
      (await resolveModelRoute(RouteKey.SCHEDULED)) ||
      modelRouter.getCurrentModel();
    let provider = cronModel
      ? providerRegistry.getByModel(cronModel)
      : undefined;
    if (!provider) {
      const { detectUnifiedProviders } =
        await import('../../ai/providers/detectUnifiedProviders.js');
      const envProviders = detectUnifiedProviders();
      const envProvider = envProviders[0];

      if (envProvider) {
        provider = providerRegistry.getOrCreate(
          envProvider.providerType as unknown as string,
          {
            apiKey: envProvider.apiKey || '',
            baseUrl: envProvider.baseUrl,
            model: envProvider.model || cronModel,
          }
        );
      }
    }

    // 防御：若 provider 仍为空，回退到默认执行器（不依赖 AI provider）
    if (!provider) {
      logger.warn(
        'Cron AI 执行器初始化失败：无可用的 AI Provider，降级为默认执行器'
      );
      // U-01：即使无 AI Provider，也必须汇报 Cron 完成/失败（投递器不依赖 Provider）
      await ensureGlobalCronSchedulerStarted({
        dispatchDelivery: createCronDispatchDelivery(),
      });
      return { realExecutor: false };
    }

    const realExecutor = createCronExecutor(provider);

    // 初始化投递队列和路由器（AI 定时任务 → 渠道主动推送）
    const { resolveDbPath } = await import('@modules/environment');
    const { DeliveryQueue } = await import('./DeliveryQueue');
    const deliveryQueue = new DeliveryQueue(resolveDbPath());
    await deliveryQueue.init();

    // U-01：投递器与 AI Provider 解耦（同一工厂也用于“无 Provider / 启动失败”分支）
    const dispatchDelivery = createCronDispatchDelivery();

    await ensureGlobalCronSchedulerStarted(
      { executeJob: realExecutor, dispatchDelivery },
      deliveryQueue
    );
    logger.info('Cron 调度器已启动（AI 执行引擎就绪）', {
      providerName: cronModel,
    });
    return { realExecutor: true, providerName: cronModel };
  } catch (cronError) {
    await handleError(cronError, {
      module: 'cron:startEngine',
      action: 'start',
    });
    // AI provider 不可用时仍启动占位调度器
    try {
      const { ensureGlobalCronSchedulerStarted } =
        await import('./GlobalCronScheduler');
      // U-01：AI 初始化失败也不能静默 —— 仍注入投递器汇报任务结果
      await ensureGlobalCronSchedulerStarted({
        dispatchDelivery: createCronDispatchDelivery(),
      });
      logger.info('Cron 调度器已启动（默认执行模式）');
    } catch (err) {
      // @ignore-catch: 彻底启动失败，不阻塞上层启动流程
      logger.error('Cron 调度器启动失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { realExecutor: false };
  }
}
