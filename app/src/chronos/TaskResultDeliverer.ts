/**
 * F-10: 任务结果投递模块
 * 监听 Chronos 定时任务执行结果，通过 ChannelRegistry 广播到所有已启用的通道
 */
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { globalEventBus, SystemEvents } from '@modules/core';
import { channelRegistry } from '@modules/channels';

const logger = getLogger('chronos:taskResultDeliverer');

let initialized = false;

/**
 * 格式化任务结果消息
 */
function formatTaskMessage(
  eventType: string,
  data: Record<string, unknown>
): string {
  const taskId = data.taskId || data.cronTaskId || 'unknown';
  const status =
    eventType === SystemEvents.TASK_COMPLETED ? '✅ 完成' : '❌ 失败';
  const cronExpr = data.cron ? ` (${data.cron})` : '';
  const prompt = data.prompt ? `\n描述: ${data.prompt}` : '';

  return [
    `[Chronos] 定时任务 ${status}`,
    `任务ID: ${taskId}${cronExpr}${prompt}`,
    `时间: ${new Date().toLocaleString('zh-CN')}`,
  ].join('\n');
}

/**
 * 初始化任务结果投递
 * 订阅 TASK_COMPLETED 和 TASK_FAILED 事件，结果广播到所有通道
 */
export function initializeTaskResultDelivery(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  globalEventBus.subscribe(SystemEvents.TASK_COMPLETED, (data: unknown) => {
    const eventData = data as Record<string, unknown>;
    // 静默任务不投递通知
    if (eventData.silent === true) {
      logger.info(`[F-10] 静默任务完成（跳过通知）`, {
        taskId: eventData.taskId || eventData.cronTaskId,
      });
      return;
    }
    const message = formatTaskMessage(SystemEvents.TASK_COMPLETED, eventData);
    channelRegistry
      .broadcast(message)
      .then((results) => {
        const delivered = results.filter((r) => r.success).length;
        logger.info(
          `[F-10] 任务完成结果已投递到 ${delivered}/${results.length} 个通道`,
          {
            taskId: eventData.taskId || eventData.cronTaskId,
          }
        );
      })
      .catch((error) => {
        void handleError(error, {
          module: 'chronos:deliver',
          action: 'broadcastTaskCompleted',
        });
      });
  });

  globalEventBus.subscribe(SystemEvents.TASK_FAILED, (data: unknown) => {
    const eventData = data as Record<string, unknown>;
    const message = formatTaskMessage(SystemEvents.TASK_FAILED, eventData);
    channelRegistry
      .broadcast(message)
      .then((results) => {
        const delivered = results.filter((r) => r.success).length;
        logger.warning(
          `[F-10] 任务失败结果已投递到 ${delivered}/${results.length} 个通道`,
          {
            taskId: eventData.taskId || eventData.cronTaskId,
          }
        );
      })
      .catch((error) => {
        void handleError(error, {
          module: 'chronos:deliver',
          action: 'broadcastTaskFailed',
        });
      });
  });

  logger.info(
    '[F-10] 任务结果投递模块已初始化，监听 TASK_COMPLETED / TASK_FAILED 事件'
  );
}

/**
 * 关闭任务结果投递
 */
export function shutdownTaskResultDelivery(): void {
  initialized = false;
  logger.info('[F-10] 任务结果投递模块已关闭');
}
