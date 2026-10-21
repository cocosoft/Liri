/**
 * 租户通道托管启动（headless / 服务端，多租户 P3）
 *
 * `--http-only`（含 `DROP_UI` headless 构建）原先**不启动任何通道**。多租户服务端需要把
 * 每个租户自己的通道实例连起来（各自身份作用域内），同时**保持部署级通道"不连接"的既有行为**
 * ⇒ 走 `lazyConnectChannels({ tenantOnly: true })`。
 *
 * 单独成文件的原因：`main.ts` 已逼近 R04-001 的 2000 行上限，启动细节应下沉。
 */
import { getLogger } from '@modules/monitoring';

const logger = getLogger('entrypoints:tenantChannels');

/** 启动 headless 模式下的租户通道托管（失败只记日志，不阻塞 HTTP 常驻） */
export async function startTenantChannelsForHeadless(): Promise<void> {
  try {
    const { channelRegistry } =
      await import('../channels/registry/ChannelRegistry');
    await channelRegistry.initPersistence();
    const { lazyConnectChannels } = await import('../channels/setupChannels');
    // 后台连接（不阻塞信号等待）；`tenantOnly` ⇒ 只挑归属非空的配置
    lazyConnectChannels({ tenantOnly: true }).catch((err) => {
      logger.error('租户通道后台连接异常', { error: String(err) });
    });
  } catch (err) {
    logger.error('租户通道初始化失败', { error: String(err) });
  }
}
