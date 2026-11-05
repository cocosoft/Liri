/**
 * 通道运行时初始化（2026-11-05，从 `main.ts` 外移并抽为共用实现）
 *
 * 背景（P38 取证）：这段逻辑此前**只内联在 `launchREPL`** ⇒ `daemon` 模式（桌面端/后台
 * 的实际启动方式）**通道全挂**：`/v1/channels/health` 恒为空、没有任何入站消息，
 * `effect_queue` / `channel_message_states` 长期 0 行，P38 影子双跑因此永远拿不到渠道样本。
 *
 * 口径：REPL 与 DAEMON 调**同一实现**（单一来源，CS01），失败只记 error、不阻断启动。
 */
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('entrypoints:channelRuntime');

/**
 * 初始化通道持久化 → 从 DB 恢复配置 → 注册通道就地放行端口 → 后台连接。
 *
 * 注意：`lazyConnectChannels()` 刻意**不 await**（连接不阻塞启动）。
 */
export async function startChannelRuntime(): Promise<void> {
  try {
    const { setupChannelsFromConfig, lazyConnectChannels } =
      await import('../channels/setupChannels');
    const { channelRegistry } =
      await import('../channels/registry/ChannelRegistry');

    await channelRegistry.initPersistence();
    logger.info('通道持久化初始化完成');

    // 从 DB 恢复已保存的通道配置（注册到内存）
    await setupChannelsFromConfig();
    logger.info('通道配置已从 DB 恢复');

    // 2026-10-17（Spec `.trae/specs/channel-budget-inline-relief.md` §D4）：注册**通道就地放行**
    // 动作端口 —— channels 层**不得**反依赖 `query/**`（R01-007）⇒ 由**组合根**在此装配：
    // 入站按钮动作只把 `{sessionId, kind}` 交上来，放行链（协调器复核 + 既有 `applyRelief`）留在这里。
    // 端口缺省**不注册**时通道侧会如实回 `{code:1}` 并 warn（不静默，见 `budgetReliefAction`）。
    try {
      const { setBudgetReliefActionHandler } =
        await import('../channels/bridge/budgetReliefAction');
      const { getBudgetSuspendCoordinator } =
        await import('../query/budgetSuspend');
      const { getDailyBudget } = await import('../query/DailyBudgetManager');
      setBudgetReliefActionHandler(async ({ sessionId, kind }) => {
        // **复核**（守 spec §D3 边界）：按 `sessionId` 反查确处于**有效**挂起态才放行
        // —— 按钮数据可被伪造/陈旧，不能只信它自报。
        const coordinator = getBudgetSuspendCoordinator();
        if (!coordinator.isSuspended(sessionId)) {
          return { code: 3, message: '该会话当前不在挂起中（可能已放行）' };
        }
        getDailyBudget().applyRelief(
          kind === 'boost'
            ? { kind: 'boost', factor: 2, ttlMs: 3_600_000 }
            : { kind },
          // **收窄**：只唤醒本会话（与桌面端卡片同口径，见 `long-task-suspend-resume` v1.11）
          sessionId
        );
        return { code: 0, message: '已放行，本会话将自动续跑' };
      });
      logger.info('通道就地放行动作端口已注册');
    } catch (err) {
      logger.error('通道就地放行动作端口注册失败', { error: String(err) });
    }

    // 后台连接已启用的通道（不阻塞启动）
    lazyConnectChannels().catch((err) => {
      logger.error('延迟通道连接异常', { error: String(err) });
    });
  } catch (err) {
    logger.error('通道初始化失败', { error: String(err) });
  }
}
