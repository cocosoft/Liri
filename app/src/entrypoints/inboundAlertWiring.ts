/**
 * 入站阈值告警接线（入站监视 G3/P4，2026-11-21）
 *
 * 为什么放在组合根（app/entrypoints）而不是 channels 包内：
 * - 开关解析（`feature()`）与收件箱投递（`@openliri/service/runtime/NotificationPersistence`）
 *   都属于**装配**职责；channels 只提供评估器（读者可注入），保持 service 层内聚；
 * - 生命周期与通道运行时同源：REPL / DAEMON 都经 `startChannelRuntime()` ⇒ 同一处启动。
 *
 * 开关 `CHANNEL_INBOUND_ALERTS` **默认关**：关 ⇒ 零定时器、零通知（见 `.trae/specs/inbound-message-monitoring-gaps.md` §6）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { feature } from '@openliri/kernel';

const logger = getLogger('entrypoints:inbound-alerts');

/**
 * 启动入站告警评估器（幂等由 evaluator 自身保证；失败只记 error，不阻断启动）。
 */
export async function startInboundAlertRuntime(): Promise<void> {
  if (!feature('CHANNEL_INBOUND_ALERTS')) {
    logger.info('入站阈值告警未启用（CHANNEL_INBOUND_ALERTS=false）');
    return;
  }

  try {
    const { InboundAlertEvaluator } =
      await import('@modules/channels/monitoring/InboundAlertEvaluator');
    const { getChannelRealtimeMonitor } =
      await import('@modules/channels/monitoring/ChannelRealtimeMonitor');
    // 静默规则读 `lastMessageAt` ⇒ 监控器必须在跑（start 幂等）
    getChannelRealtimeMonitor().start();

    const evaluator = new InboundAlertEvaluator({
      notify: async (alert) => {
        // 单例在 main.ts 启动期已初始化；`create()` 内部会惰性取 DB。
        // ⚠️ 不要在这里调 `init()`：它会重复起过期调度定时器。
        const { notificationPersistence } =
          await import('@openliri/service/runtime/NotificationPersistence');
        await notificationPersistence().create({
          category: 'system',
          priority: 'urgent',
          title: alert.title,
          content: alert.content,
          source: 'channel:inbound-alert',
          source_ref: alert.ruleId,
        });
      },
    });
    await evaluator.start();
    logger.info('入站阈值告警评估器已接线');
  } catch (err) {
    logger.error('入站阈值告警启动失败', { error: String(err) });
  }
}
