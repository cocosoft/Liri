/**
 * reply effects 运行时接线（P38-b，2026-11-10）
 *
 * **为什么单独成文件**：这段装配原先只写在 `bootstrap/pipeline/BootPipelineIntegrator` 的
 * Phase 5，而该组合根**在生产启动路径未被引用**（唯一消费方是 benchmark 脚本）⇒
 * `setReplyEffectPort` 从未执行 ⇒ `relayReplyToChannel` 的影子写（`effect_queue`，
 * `kind='reply'`）在生产（daemon / REPL / CLI）**永远不发生** ⇒ P38 观察期样本恒为 0，
 * 与"有没有真实渠道流量"无关。
 *
 * 现口径：**唯一实现**（CS01），由 `entrypoints/channelRuntime.startChannelRuntime()`
 * （REPL 与 DAEMON 共用）与 BootPipelineIntegrator 同时调用；模块级幂等。
 */
import { feature } from '@openliri/kernel';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('entrypoints:replyEffects');

let wired = false;

/**
 * 注入「入队 / 影子写」端口；`FEATURE_EFFECT_REPLY_MIGRATION` 开启时同时启动派发扫描器。
 *
 * 失败只留痕，不阻断启动（回滚即回到"只有直发"的既有链路）。
 */
export async function wireReplyEffectRuntime(): Promise<void> {
  if (wired) return;
  wired = true;
  try {
    const { setReplyEffectPort } =
      await import('@modules/channels/bridge/inboxChannelReply.js');
    const {
      createDefaultReplyDispatchDeps,
      enqueueReplyEffect,
      kickReplyEffectDispatcher,
      shadowReplyRelay,
      startReplyEffectDispatcher,
    } = await import('@modules/tasks');

    setReplyEffectPort({
      enqueue: async (input) => {
        const queued = await enqueueReplyEffect(input);
        if (queued) kickReplyEffectDispatcher();
        return queued;
      },
      shadow: (input) => shadowReplyRelay(input),
    });
    logger.info('reply effects 端口已注入（影子写/入队）');

    if (feature('EFFECT_REPLY_MIGRATION')) {
      const deps = await createDefaultReplyDispatchDeps();
      startReplyEffectDispatcher(deps);
      logger.info('reply effects 派发扫描器已启动（迁移开关开启）');
    }
  } catch (err) {
    wired = false; // 允许后续重试（启动期模块时序）
    void handleError(err, {
      module: 'entrypoints:replyEffects',
      action: 'wireReplyEffectRuntime',
    });
  }
}
