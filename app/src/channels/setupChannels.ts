/**
 * 通道自动注册集成函数
 * 将 channels/ 各平台实现自动注册到 ChannelRegistry
 * 优化：先检查环境变量配置，仅导入已启用的通道模块
 */
import { getLogger } from '@modules/monitoring';
import { channelBootstrapper } from './bootstrap/ChannelBootstrapper';
import type { ChannelBootstrapConfig } from './bootstrap/ChannelBootstrapper';
import { channelRegistry } from './registry/ChannelRegistry';
import type { ChannelInterface } from './registry/ChannelRegistry';
import { ChannelSecretStore, initRegistry } from './secrets/ChannelSecretStore';
// 多租户 P3：租户通道实例在归属者身份作用域内连接与处理消息
import {
  principalFromKey,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';
import { getCoreAPI } from '../runtime/api/CoreAPIImpl';
import type {
  IChannelPlugin,
  MessageContext,
  ChannelId,
} from './types/IChannel';
import { routeChannelMessage } from './routing/messageRouter';
import { configManager } from '@modules/config';
import { feature } from '@openliri/kernel';
import { handleError } from '@modules/error';
import { getDeliveryRouter } from './DeliveryRouter';
import {
  CHANNEL_CATALOG,
  describeChannelUnavailable,
  getChannelCatalogEntry,
} from './ChannelCatalog';

const logger = getLogger('channels:setup');

// ─── Feature Flag: Inbox ↔ 渠道桥接开关 ───
// `isBridgeEnabled` 已下沉到叶子模块 `./bridgeEnabled`（2026-10-19 断环：textApproval/messageRouter
// 曾反向 import 本文件，与 `setupChannels → messageRouter` 构成静态环）。
/** 渠道 ← Inbox 回复回传开关（默认开启，显式设为 'false' 时关闭） */
export function isReplyEnabled(): boolean {
  return configManager.env('INBOX_CHANNEL_REPLY_ENABLED') !== 'false';
}
/** DeliveryRouter 统一出站开关（默认开启，显式设为 '0' 时切回旧 onOutbound 路径） */
export function useDeliveryRouterOutbound(): boolean {
  return configManager.env('DELIVERY_ROUTER_OUTBOUND') !== '0';
}

/**
 * 全部支持的通道类型清单（含显示名称）
 * 用于前端列表展示，即使通道未注册也能显示在 UI 中
 *
 * 2026-09-30 · 台账 D-134：改为从 `CHANNEL_CATALOG`（单一事实源）派生 ——
 * 此前这里是与目录**逐字重复**的另一份 type/name 清单。
 */
export const ALL_CHANNEL_DEFS: Array<{ type: string; name: string }> =
  CHANNEL_CATALOG.map(({ type, name }) => ({ type, name }));

/**
 * 根据配置自动注册 IChannelPlugin 通道
 * 读取环境变量确定哪些通道已启用，仅导入已启用的通道模块
 */
export async function setupChannelsFromConfig(): Promise<{
  registered: number;
  errors: string[];
}> {
  const t0 = Date.now();

  // 初始化 ChannelSecretStore 的 channelRegistry 引用
  initRegistry(channelRegistry);

  // 第一步：筛选已启用的通道
  // 此处只保留「启动策略」（type + 环境变量启用判据）；**路径、导出键与启用判据
  // 统一取自 `CHANNEL_CATALOG` 单一事实源**（2026-09-30 · 台账 D-134；B-1 2026-10-18
  // 把启用判据也下沉，本文件不再持有任何平台凭据判断）。
  const catalogEnabled = (type: string): boolean => {
    const entry = getChannelCatalogEntry(type);
    if (!entry) return false;
    return entry.isEnabled((key) => configManager.env(key));
  };

  const channelCandidates: Array<{ type: string; enabled: boolean }> =
    CHANNEL_CATALOG.map(({ type }) => ({
      type,
      enabled: catalogEnabled(type),
    }));

  const enabledDefs = channelCandidates.filter((c) => c.enabled);

  // 补充：DB 中已持久化且有实际凭据配置的通道也视为"已启用"（凭据来自前端保存，不依赖 .env）
  // 仅当通道的 options 非空时才启用，避免"已启用但无凭据"的空壳状态
  const persistedConfigs = channelRegistry.getAllConfigs();

  // 主包瘦身 R4：被 `DROP_*` 裁掉的通道会**从目录里物理消失**，DB 里的持久化配置却还在。
  // 此前这类配置被候选表静默过滤（用户只看到"配了却不生效"），这里显式给出可操作原因。
  for (const cfg of persistedConfigs) {
    if (!cfg.enabled) continue;
    if (getChannelCatalogEntry(cfg.type)) continue;
    logger.warning(describeChannelUnavailable(cfg.type));
  }

  const persistedTypesWithCredentials = new Set(
    persistedConfigs
      .filter(
        (cfg) =>
          cfg.enabled && cfg.options && Object.keys(cfg.options).length > 0
      )
      .map((cfg) => cfg.type)
  );
  const dbEnabledDefs: typeof channelCandidates = [];
  for (const candidate of channelCandidates) {
    if (
      !candidate.enabled &&
      persistedTypesWithCredentials.has(candidate.type)
    ) {
      dbEnabledDefs.push({ ...candidate, enabled: true });
    }
  }
  const allEnabledDefs = [...enabledDefs, ...dbEnabledDefs];

  if (allEnabledDefs.length === 0) {
    logger.info('通道自动注册: 无启用的通道, 跳过');
    return { registered: 0, errors: [] };
  }

  // DB 来源的通道不受 MAX_CHANNELS 限制（前端显式配置的凭据 → 始终注册）
  const MAX_CHANNELS = parseInt(
    configManager.env('CHANNEL_MAX_COUNT') || '10',
    10
  );
  const priorityStr = configManager.env('CHANNEL_PRIORITY') || '';

  logger.info(
    `通道上限配置: ${MAX_CHANNELS} 个（可通过 CHANNEL_MAX_COUNT 环境变量调整）`
  );

  // 环境变量通道按优先级选择（上限 MAX_CHANNELS）
  let selectedEnvDefs: typeof channelCandidates;
  if (priorityStr) {
    const priorityOrder = priorityStr
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const priorityMap = new Map(priorityOrder.map((t, i) => [t, i]));
    selectedEnvDefs = enabledDefs
      .filter((d) => priorityMap.has(d.type))
      .sort(
        (a, b) =>
          (priorityMap.get(a.type) ?? 999) - (priorityMap.get(b.type) ?? 999)
      )
      .slice(0, MAX_CHANNELS);
    const skippedUnprioritized = enabledDefs.filter(
      (d) => !priorityMap.has(d.type)
    ).length;
    if (skippedUnprioritized > 0) {
      logger.info(
        `CHANNEL_PRIORITY 未包含的通道跳过: ${skippedUnprioritized} 个`
      );
    }
  } else {
    selectedEnvDefs = enabledDefs.slice(0, MAX_CHANNELS);
  }

  // DB 来源通道 + 环境变量通道（去重：DB 优先）
  const envTypes = new Set(selectedEnvDefs.map((d) => d.type));
  const dedupedDbDefs = dbEnabledDefs.filter((d) => !envTypes.has(d.type));
  const selectedDefs = [...dedupedDbDefs, ...selectedEnvDefs];

  if (dbEnabledDefs.length > 0) {
    logger.info(
      `DB 持久化通道自动注册: ${dbEnabledDefs.map((d) => d.type).join(', ')}`
    );
  }

  const totalEnvSkipped = enabledDefs.length - selectedEnvDefs.length;
  if (totalEnvSkipped > 0) {
    const skippedTypes = enabledDefs
      .filter((d) => !selectedEnvDefs.find((s) => s.type === d.type))
      .map((d) => d.type);
    logger.info(
      `通道上限 ${MAX_CHANNELS} 个, 跳过: ${skippedTypes.join(', ')}`
    );
  }
  // 第三步：仅导入选中的通道模块（并行导入）
  // 路径 / 导出键取自 `CHANNEL_CATALOG`（位置无关加载器）
  const importResults = await Promise.allSettled(
    selectedDefs.map(async (def) => {
      const t1 = Date.now();
      const entry = getChannelCatalogEntry(def.type);
      if (!entry) {
        throw new Error(describeChannelUnavailable(def.type));
      }
      const mod = await entry.load();
      const factory = (mod as Record<string, unknown>)[entry.exportKey];
      logger.info(`通道模块导入: ${def.type} (${Date.now() - t1}ms)`);
      return { type: def.type, factory, exportKey: entry.exportKey };
    })
  );

  // 第四步：注册通道工厂 + 构建配置
  const errors: string[] = [];
  const configChannels: { type: string; enabled: boolean }[] = [];

  for (const result of importResults) {
    if (result.status === 'fulfilled') {
      const { type, factory, exportKey } = result.value;
      if (factory) {
        channelBootstrapper.registerPluginChannel(
          type,
          () => factory as IChannelPlugin
        );
        logger.info(`通道工厂已注册: ${type}`);
      } else {
        const msg = `通道 ${type} 模块已导入但未找到工厂属性 "${exportKey}"`;
        logger.warning(msg);
        errors.push(msg);
      }
      configChannels.push({ type, enabled: true });
    } else {
      const msg = `通道模块导入失败: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
      logger.warning(msg);
      errors.push(msg);
    }
  }

  // 第五步：过滤已被 Gateway 系统（ChannelManager）管理的通道，避免双注册
  const gatewayManagedNames = new Set(
    channelRegistry.getAll().map((c) => c.name)
  );
  const preFilterCount = configChannels.length;
  const filteredChannels = configChannels.filter(
    (c) => !gatewayManagedNames.has(c.type)
  );
  const skippedCount = preFilterCount - filteredChannels.length;
  if (skippedCount > 0) {
    const skipped = configChannels
      .filter((c) => gatewayManagedNames.has(c.type))
      .map((c) => c.type);
    logger.info(`跳过已被 Gateway 系统管理的通道: ${skipped.join(', ')}`);
  }

  // 第六步：执行 bootstrap
  const config: ChannelBootstrapConfig = { channels: filteredChannels };
  const result = await channelBootstrapper.bootstrap(config);

  if (result.registered > 0) {
    logger.info(`通道自动注册完成: ${result.registered} 通道已注册`);
  }

  // 第七步：返回（连接延迟到应用启动后由 lazyConnectChannels() 执行）
  logger.info(`通道自动注册结束, 总耗时: ${Date.now() - t0}ms`);
  return result;
}

/** lazyConnectChannels 是否已执行过（防重复连接守卫） */
let _channelsConnected = false;

/**
 * 一个待连接的通道实例。
 *
 * - **部署级**（`ownerKey` 缺省）：来自 `channelRegistry.getEnabled()`，行为与改造前逐字一致；
 * - **租户级**（多租户 P3）：每个 `(ownerKey, type)` 一个新实例，实例键 `<ownerKey>::<type>`
 *   —— 消息路由与渠道会话映射据此天然隔离。
 */
interface ChannelConnectEntry {
  /** 实例键（同时作为 `routeChannelMessage` 的 channelName） */
  name: string;
  plugin: IChannelPlugin;
  /** 部署级通道接口视图（connect 走它：凭据解析/启用语义与改造前一致） */
  channel?: ChannelInterface;
  /** 归属键（多租户 P3）；部署级为空 */
  ownerKey?: string;
}

/**
 * 汇总待连接实例：部署级（既有）+ 租户级（按归属逐个新建插件实例）。
 *
 * 租户实例**不注册进 `channelRegistry`**：注册会污染 `broadcast()`（系统广播）与通道列表，
 * 且租户实例的出站目标由各自 `plugin` 闭包持有 —— 也**不走 `DeliveryRouter`**
 * （它按 name 反查注册表，查不到租户实例）。
 */
async function collectConnectEntries(
  errors: string[]
): Promise<ChannelConnectEntry[]> {
  const entries: ChannelConnectEntry[] = [];

  // ① 部署级通道：与改造前完全一致（Gateway 管理的通道仍然跳过）
  for (const deployed of channelRegistry.getEnabled()) {
    const plugin = channelBootstrapper.getPluginInstance(deployed.name);
    if (!plugin) {
      logger.info(
        `lazyConnectChannels: 跳过 Gateway 管理的通道 — ${deployed.name}`
      );
      continue;
    }
    entries.push({ name: deployed.name, plugin, channel: deployed });
  }

  // ② 租户级通道：每个 (ownerKey, type) 一个独立实例
  entries.push(
    ...(await buildTenantEntries(
      channelRegistry.listAllConfigs(),
      async (type) => {
        const catalogEntry = getChannelCatalogEntry(type);
        if (!catalogEntry) {
          throw new Error(describeChannelUnavailable(type));
        }
        const mod = await catalogEntry.load();
        const factory = (mod as Record<string, unknown>)[
          catalogEntry.exportKey
        ] as (() => IChannelPlugin | undefined) | undefined;
        return factory?.();
      },
      errors
    ))
  );

  return entries;
}

/**
 * 依据配置汇总**租户通道实例**（多租户 P3）。
 *
 * 规则：
 *   - 只取 `ownerKey` 非空、`enabled`、且**有凭据**（options 非空）的配置；
 *   - 实例键 = `<ownerKey>::<type>`（同一类型不同租户互不干扰）；
 *   - 单个配置失败只记错误、不影响其余通道。
 */
export async function buildTenantEntries(
  configs: ReadonlyArray<{
    type: string;
    enabled: boolean;
    options?: Record<string, unknown>;
    ownerKey?: string;
  }>,
  loadPlugin: (type: string) => Promise<IChannelPlugin | undefined>,
  errors: string[]
): Promise<ChannelConnectEntry[]> {
  const entries: ChannelConnectEntry[] = [];

  for (const config of configs) {
    if (!config.ownerKey || !config.enabled) continue;
    if (!config.options || Object.keys(config.options).length === 0) continue;

    const ownerKey = config.ownerKey;
    try {
      const plugin = await loadPlugin(config.type);
      if (!plugin) {
        errors.push(`租户通道 ${ownerKey}::${config.type} 工厂返回空`);
        continue;
      }
      entries.push({
        name: `${ownerKey}::${config.type}`,
        plugin,
        ownerKey,
      });
    } catch (error) {
      await handleError(error, {
        module: 'channels:setup',
        action: 'buildTenantEntries',
        context: { ownerKey, type: config.type },
      });
      errors.push(
        `租户通道 ${ownerKey}::${config.type} 实例化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return entries;
}

/**
 * 多租户 P3：租户实例的消息处理包装 —— **每次收到消息时**重入归属者作用域。
 *
 * 为什么不能在注册时包一层：`AsyncLocalStorage` 绑定的是**调用时刻**的上下文，
 * `setMessageHandler` 只是保存函数引用；真实调用发生在渠道连接的异步链里（无请求作用域）。
 */
export function wrapHandlerWithOwnerScope(
  handler: (message: MessageContext) => Promise<void>,
  principal: Principal | null
): (message: MessageContext) => Promise<void> {
  if (!principal) return handler;
  return (message) => runWithPrincipal(principal, () => handler(message));
}

/** 已连接的租户实例（部署级实例仍由 `ChannelBootstrapper` 管理；此处只管租户侧） */
const _tenantInstances: Array<{
  ownerKey: string;
  /** 实例名（`<ownerKey>::<type>`）—— 与监控器登记键同构，注销时需要 */
  name: string;
  plugin: IChannelPlugin;
}> = [];

/**
 * 断开租户通道实例（幂等）
 *
 * @param ownerPrefix 只断开**归属键**以该前缀开头的实例（删除租户时传 `<tenantId>:`）；
 *                    缺省 ⇒ 断开全部（优雅退出时调用，与改造前一致）
 * @returns 断开的实例数
 */
export async function stopTenantChannels(
  ownerPrefix?: string
): Promise<number> {
  const matched: Array<{
    ownerKey: string;
    name: string;
    plugin: IChannelPlugin;
  }> = [];
  for (let i = _tenantInstances.length - 1; i >= 0; i--) {
    const entry = _tenantInstances[i];
    if (ownerPrefix && !entry.ownerKey.startsWith(ownerPrefix)) continue;
    matched.push(entry);
    _tenantInstances.splice(i, 1);
  }

  for (const { name, plugin } of matched) {
    try {
      await plugin.lifecycle.disconnect();
    } catch (error) {
      await handleError(error, {
        module: 'channels:setup',
        action: 'stopTenantChannels',
        context: { channelId: plugin.id },
      });
    }
    // 同步撤销监控登记（否则监控面会继续展示已断开实例、并对它做无效探测）
    await unregisterTenantChannelFromMonitor(name);
  }
  return matched.length;
}

/** 把租户实例登记进实时监控（失败只告警：监控是旁路，不影响连接结果） */
async function registerTenantChannelWithMonitor(
  name: string,
  plugin: IChannelPlugin
): Promise<void> {
  try {
    const { getChannelRealtimeMonitor } =
      await import('./monitoring/ChannelRealtimeMonitor');
    const monitor = getChannelRealtimeMonitor();
    // 自愈执行器（幂等注入）：监控器只有 `<ownerKey>::<type>` 这个键、不持有凭据，
    // 重连必须回到归属者身份作用域内重新解析凭据 ⇒ 由本模块提供执行器。
    monitor.setTenantReconnector(reconnectTenantChannel);
    monitor.registerTenantChannel(name, plugin);
  } catch (error) {
    await handleError(error, {
      module: 'channels:setup',
      action: 'registerTenantChannelMonitor',
      context: { channelName: name },
    });
  }
}

/**
 * `reconnectTenantChannelInScope` 的可替换依赖（缺省走真实实现；测试注入用）
 */
export interface TenantReconnectDeps {
  /** 解析该身份下该通道的凭据（缺省 `ChannelSecretStore#get`，会随当前身份返回不同值） */
  resolveCredentials?: (channelId: string) => Record<string, unknown>;
}

/**
 * 在**归属者身份作用域**内重连一个租户通道
 *
 * 为什么不能由监控器自己做：它只有 `<ownerKey>::<type>` 这个键、**不持有凭据**；
 * 租户凭据由 `ChannelSecretStore` 按身份解析 —— 在宿主作用域里取会拿到宿主的凭据
 *（= 跨身份复用）。故这里先 `principalFromKey` 还原身份，再在 `runWithPrincipal`
 * 内重新取凭据并 `disconnect → connect`。
 *
 * @param ownerKey 归属键 `<tenantId>:<userId>`（非法 ⇒ `false`，**不编造身份**）
 * @returns 是否已重新连通（以 `lifecycle.getStatus().connected` 为准）
 */
export async function reconnectTenantChannelInScope(
  ownerKey: string,
  plugin: IChannelPlugin,
  deps: TenantReconnectDeps = {}
): Promise<boolean> {
  const principal = principalFromKey(ownerKey);
  if (!principal) {
    logger.warning(`租户通道重连跳过（归属键非法，不编造身份）: ${ownerKey}`);
    return false;
  }

  const resolveCredentials =
    deps.resolveCredentials ??
    ((channelId: string) => ChannelSecretStore.getInstance().get(channelId));

  return runWithPrincipal(principal, async () => {
    try {
      await plugin.lifecycle.disconnect();
    } catch (error) {
      // 断连失败不阻断重连尝试（可能已处于半断开态），但要留痕（CS03-002）
      await handleError(error, {
        module: 'channels:setup',
        action: 'reconnectTenantChannel.disconnect',
        context: { channelId: plugin.id, ownerKey },
      });
    }
    const credentials = resolveCredentials(plugin.id);
    await plugin.lifecycle.connect(credentials);
    return plugin.lifecycle.getStatus().connected;
  });
}

/** 监控器自愈入口：按实例名重连；实例已停止/删除 ⇒ `false`（不复活） */
async function reconnectTenantChannel(name: string): Promise<boolean> {
  const entry = _tenantInstances.find((item) => item.name === name);
  if (!entry) return false;
  return reconnectTenantChannelInScope(entry.ownerKey, entry.plugin);
}

async function unregisterTenantChannelFromMonitor(name: string): Promise<void> {
  try {
    const { getChannelRealtimeMonitor } =
      await import('./monitoring/ChannelRealtimeMonitor');
    getChannelRealtimeMonitor().unregisterTenantChannel(name);
  } catch (error) {
    await handleError(error, {
      module: 'channels:setup',
      action: 'unregisterTenantChannelMonitor',
      context: { channelName: name },
    });
  }
}

/**
 * 延迟连接所有已注册的通道（部署级 + 租户级）
 * 在应用完全启动后在后台执行，不阻塞主流程
 * 每个通道带 5 秒超时保护
 * 内置防重复执行守卫（_channelsConnected），确保只连接一次
 */
export async function lazyConnectChannels(options?: {
  /**
   * 只托管**租户通道**（headless / 服务端部署用）。
   *
   * 此时部署级通道保持既有行为（headless 下本就不连接）—— 只把各租户的通道
   * 在各自身份作用域内连起来，不让服务端因为"顺便"而连上部署级通道。
   */
  tenantOnly?: boolean;
}): Promise<void> {
  if (_channelsConnected) {
    return;
  }
  _channelsConnected = true;

  const t0 = Date.now();
  // 幂等：headless 路径不经 `setupChannelsFromConfig`，这里补上凭据存储的 registry 引用
  initRegistry(channelRegistry);

  const errors: string[] = [];
  const collected = await collectConnectEntries(errors);
  const entries = options?.tenantOnly
    ? collected.filter((entry) => !!entry.ownerKey)
    : collected;
  if (entries.length === 0) {
    if (errors.length > 0) logger.warning('延迟通道连接存在错误', { errors });
    return;
  }

  logger.info(`lazyConnectChannels: 开始后台连接 ${entries.length} 个通道...`);
  let connectedCount = 0;

  for (const entry of entries) {
    const plugin = entry.plugin;
    const channelName = entry.name;
    // 多租户 P3：租户实例的连接与消息处理都在**归属者身份作用域**内
    //（凭据解析、会话创建、工具 cwd、事件投递都随身份落位）
    const principal = entry.ownerKey ? principalFromKey(entry.ownerKey) : null;

    const connectOnce = async (): Promise<void> => {
      try {
        // 必须在 connect() 之前注册 messageHandler，否则连接建立后立即到达的消息会因
        // handler 未注册而被丢弃（'hasHandler: false' → 消息丢弃日志）
        if (plugin.inbound) {
          const handleMessage = async (message: MessageContext) => {
            logger.info('[TRACE] setupChannels messageHandler 被调用', {
              channelName: channelName,
              messageId: message.messageId,
              senderId: message.senderId,
              hasCoreAPI: !!getCoreAPI(),
            });
            // 终端回显：显示来源通道、发送者、消息内容
            const senderDisplay =
              message.senderName || message.senderId || 'unknown';
            logger.info(
              `── [${channelName.toUpperCase()}] ${senderDisplay} ──\n${message.content}`,
              { module: 'channels:setup' }
            );

            const coreAPI = getCoreAPI();
            const result = await routeChannelMessage(message, {
              coreAPI,
              channelName: channelName,
              enableTracing: true,
              // AC-5③（2026-08-20 渠道对齐）：仅被动回复窗口渠道（QQ 等）启用长任务占位提示
              enableLongTaskPlaceholder:
                plugin.capabilities?.passiveReplyWindow === true,
              // U-05b（2026-10-17）：交互问答灰度 —— 开关 + 渠道 interactive 能力双门控
              supportsQuestionAnswer:
                feature('CHANNEL_QUESTION_ANSWER') &&
                plugin.capabilities?.interactive === true,
              // 2026-08-06（P0-2）：传入渠道 DM 策略配置，启用授权检查（未提供时默认不拦截）
              dmPolicy: {
                policy: plugin.security?.dmPolicy ?? 'open',
                allowFrom: plugin.security?.allowFrom ?? [],
              },
              // 2026-08-20 spec qq-file-transfer：渠道声明 fileUpload 能力时绑定
              // （sendFile 返回 SendResult 不抛错，此处转 throw 供编排层统一捕获）
              ...(plugin.capabilities?.fileUpload === true && plugin.outbound
                ? {
                    onOutboundFile: async (
                      filePath: string,
                      fileTarget: string
                    ): Promise<void> => {
                      const result = await plugin.outbound!.sendFile(
                        fileTarget,
                        filePath
                      );
                      if (!result.success) {
                        throw new Error(result.error || '文件发送失败');
                      }
                    },
                  }
                : {}),
              onOutbound: async (content, target) => {
                logger.info('[TRACE] setupChannels onOutbound 回调被调用', {
                  channelName: channelName,
                  target,
                  contentLength: content.length,
                  hasOutbound: !!plugin.outbound,
                });

                // AI 回复回显
                logger.info(
                  `── [${channelName.toUpperCase()}] Liri ──\n${content}`,
                  { module: 'channels:setup' }
                );

                // 多租户 P3：租户实例不走 DeliveryRouter（它按 name 反查注册表，
                // 租户实例刻意不注册）⇒ 直接用本实例的 plugin.outbound 回目标渠道
                if (!entry.ownerKey && useDeliveryRouterOutbound()) {
                  // Phase 2: 走 DeliveryRouter 统一出站路径（降级、并发控制、OTel 追踪）
                  try {
                    const router = getDeliveryRouter();
                    const result = await router.deliverToOrigin(
                      channelName as ChannelId,
                      target,
                      { format: 'text', content }
                    );
                    logger.info('[TRACE] setupChannels DeliveryRouter 返回', {
                      channelName: channelName,
                      success: result.success,
                      actualFormat: result.actualFormat,
                      fallbackSteps: result.fallbackSteps,
                      durationMs: result.durationMs,
                    });
                    if (!result.success) {
                      logger.warning(
                        `通道 ${channelName} 消息发送失败 (DeliveryRouter)`,
                        {
                          target,
                          error: result.error,
                          fallbackSteps: result.fallbackSteps,
                        }
                      );
                    }
                  } catch (sendError) {
                    handleError(sendError, {
                      module: 'channels:setup',
                      action: 'inbound:deliveryRouter',
                      context: { target, channelName: channelName },
                    });
                  }
                } else if (plugin.outbound) {
                  try {
                    logger.info(
                      '[TRACE] setupChannels 调用 plugin.outbound.sendText',
                      {
                        channelName: channelName,
                        target,
                      }
                    );
                    const sendResult = await plugin.outbound.sendText(
                      target,
                      content
                    );
                    logger.info('[TRACE] setupChannels sendText 返回', {
                      channelName: channelName,
                      success: sendResult.success,
                      error: sendResult.error,
                      messageId: sendResult.messageId,
                    });
                    if (!sendResult.success) {
                      logger.warning(`通道 ${channelName} 消息发送失败`, {
                        target,
                        error: sendResult.error,
                        messageId: sendResult.messageId,
                      });
                    }
                  } catch (sendError) {
                    handleError(sendError, {
                      module: 'channels:setup',
                      action: 'inbound:sendMessage',
                      context: { target, channelName: channelName },
                    });
                  }
                } else {
                  logger.warning(
                    `通道 ${channelName} 缺少 outbound 适配器，AI 回复无法发送到渠道`,
                    { target, channelName: channelName }
                  );
                }
              },
            });

            if (!result.valid) {
              logger.warning('消息路由返回无效结果', {
                channel: channelName,
                messageId: message.messageId,
                errorCode: result.errorCode,
                errorMessage: result.errorMessage,
              });
            }
          };
          // 租户实例：handler 在**每次收到消息时**重入归属者作用域
          //（ALS 绑定的是调用时刻，注册时包一层没有用）
          plugin.inbound.setMessageHandler(
            wrapHandlerWithOwnerScope(handleMessage, principal)
          );
          logger.info(`通道入站消息处理器已注册: ${channelName}`);
        }

        // handler 已注册，现在建立连接。连接后到达的 WS 消息将能正确路由到 messageHandler
        // 部署级：走接口视图（凭据解析/启用语义与改造前一致）；
        // 租户级：在本作用域内解析**该租户**凭据后直接 connect 插件实例
        const connectPromise = entry.channel
          ? entry.channel.connect()
          : (async () => {
              const credentials = ChannelSecretStore.getInstance().get(
                entry.plugin.id
              );
              await entry.plugin.lifecycle.connect(credentials);
              return entry.plugin.lifecycle.getStatus().connected;
            })();
        await Promise.race([
          connectPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`通道 ${channelName} 连接超时 (5s)`)),
              5000
            )
          ),
        ]);
        connectedCount++;
        // 多租户 P3：登记租户实例，优雅退出时统一断开（部署级由 ChannelBootstrapper 负责）；
        // P5：连同归属键登记 ⇒ 删除租户时可只断开该租户的实例
        if (entry.ownerKey) {
          _tenantInstances.push({
            ownerKey: entry.ownerKey,
            name: channelName,
            plugin: entry.plugin,
          });
          // 多租户 P3：租户实例不在 `channelRegistry` 里 ⇒ 单独登记进实时监控，
          // 否则它们的健康状态/断连在监控面与事件流里完全不可见。
          await registerTenantChannelWithMonitor(channelName, entry.plugin);
        }
        logger.info(`通道已连接: ${channelName}`);
      } catch (error) {
        handleError(error, {
          module: 'channels:setup',
          action: 'lazyConnectChannels',
          context: { channelName: channelName },
        });
        errors.push(
          `连接通道失败: ${channelName} — ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    if (principal) {
      await runWithPrincipal(principal, connectOnce);
    } else {
      await connectOnce();
    }
  }

  logger.info(
    `lazyConnectChannels: 连接完成 (connected=${connectedCount}, failed=${errors.length}), 耗时=${Date.now() - t0}ms`
  );
  if (errors.length > 0) {
    logger.warning('延迟通道连接存在错误', { errors });
  }

  // 第八步：启动渠道实时监控（探测循环 unref 不阻止退出；start 幂等）
  try {
    const { getChannelRealtimeMonitor } =
      await import('./monitoring/ChannelRealtimeMonitor');
    getChannelRealtimeMonitor().start();
  } catch (error) {
    await handleError(error, {
      module: 'channels:setup',
      action: 'startChannelRealtimeMonitor',
    });
  }
}
