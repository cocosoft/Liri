/**
 * channel-surface-routes.ts — 通道面路由（自 `cost-channel-routes.ts` 拆出，2026-10-20）
 *
 * ⚠️ **匹配顺序与拆分前逐字一致**（含既存的"`GET /v1/channels/plugins` 会被
 * `/v1/channels/(.+)` 通配先匹配"这一现状 —— 本次只做拆分，不改语义）。
 * 精确路径（mobile 配对 / schema / health / metrics / monitor / trace）必须排在通配之前。
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleApplyChannelConfig,
  handleChannelHealth,
  handleChannelMetrics,
  handleChannelMonitorForceReconnect,
  handleChannelMonitorStatus,
  handleChannelMessageTrace,
  handleChannelMessageTraces,
  handleChannelMonitorStream,
  handleChannelSchema,
  handleDeleteChannel,
  handleGetChannel,
  handleListChannels,
  handleMobileInboundMessage,
  handleMobilePairingStart,
  handleMobilePairingVerify,
  handleToggleChannel,
  handleUpdateChannel,
  handleWechatCliStatus,
} from '../channel-handlers';
import {
  handleInstallChannelPlugin,
  handleListChannelPlugins,
  handleUninstallChannelPlugin,
} from '../channel-plugin-handlers';

/** 通道面总入口（顺序即语义，勿调换） */
export async function dispatchChannelSurfaceRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, handlerCtx, broadcastEvent } = args;

  if (method === 'GET' && url === '/v1/channels') {
    await handleListChannels(req, res);
    return true;
  }
  if (await dispatchMobileRoutes(args)) return true;
  if (await dispatchChannelObservabilityRoutes(args)) return true;

  // ---- 通道 CRUD（通配在前，精确 apply 在后：与原顺序一致）----
  const byId = url.match(/^\/v1\/channels\/(.+)$/);
  if (method === 'GET' && byId) {
    await handleGetChannel(req, res, byId[1]);
    return true;
  }
  const toggle = url.match(/^\/v1\/channels\/(.+)\/toggle$/);
  if (method === 'POST' && toggle) {
    await handleToggleChannel(req, res, toggle[1], (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'DELETE' && byId) {
    await handleDeleteChannel(req, res, byId[1], (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'PUT' && byId) {
    await handleUpdateChannel(req, res, byId[1], (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/config/apply') {
    await handleApplyChannelConfig(req, res);
    return true;
  }

  if (await dispatchChannelPluginRoutes(args)) return true;

  // ---- WeChat CLI Status ----
  if (method === 'GET' && url === '/v1/wechat/cli-status') {
    await handleWechatCliStatus(handlerCtx, req, res);
    return true;
  }
  return false;
}

/** P2.5（2026-10-20）：移动端配对与入站（`DROP_CHANNELS_ALL` 构建下 handler 返回 404） */
async function dispatchMobileRoutes(args: RouteDispatchArgs): Promise<boolean> {
  const { req, res, method, url } = args;
  if (method !== 'POST') return false;

  if (url === '/v1/channels/mobile/pairing/code') {
    await handleMobilePairingStart(req, res);
    return true;
  }
  if (url === '/v1/channels/mobile/pairing/verify') {
    await handleMobilePairingVerify(req, res);
    return true;
  }
  if (url === '/v1/channels/mobile/messages') {
    await handleMobileInboundMessage(req, res);
    return true;
  }
  return false;
}

/** 通道可观测性：schema / 健康 / 指标 / 五态机监控 / 消息级追踪 / 强制重连 */
async function dispatchChannelObservabilityRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url } = args;

  if (method === 'POST' && url === '/v1/channels/monitor/force-reconnect') {
    await handleChannelMonitorForceReconnect(req, res);
    return true;
  }
  if (method !== 'GET') return false;

  if (url === '/v1/channels/schema') {
    await handleChannelSchema(req, res);
    return true;
  }
  if (url === '/v1/channels/health') {
    await handleChannelHealth(req, res);
    return true;
  }
  if (url === '/v1/channels/metrics') {
    await handleChannelMetrics(req, res);
    return true;
  }
  if (url === '/v1/channels/monitor/status') {
    await handleChannelMonitorStatus(req, res);
    return true;
  }
  if (url === '/v1/channels/monitor/stream') {
    await handleChannelMonitorStream(req, res);
    return true;
  }
  // 方案 A：消息级全链路追踪（精确路径先于 /v1/channels/(.+) 通配匹配）
  if (url.startsWith('/v1/channels/messages/trace')) {
    const remainder = url.slice('/v1/channels/messages/trace'.length);
    if (remainder === '' || remainder.startsWith('?')) {
      await handleChannelMessageTraces(req, res);
    } else {
      await handleChannelMessageTrace(
        req,
        res,
        decodeURIComponent(remainder.replace(/^\//, '').split('?')[0])
      );
    }
    return true;
  }
  return false;
}

/** 通道插件（列表 / 安装 / 卸载） */
async function dispatchChannelPluginRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url } = args;

  if (method === 'GET' && url === '/v1/channels/plugins') {
    await handleListChannelPlugins(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/plugins/install') {
    await handleInstallChannelPlugin(req, res);
    return true;
  }
  const uninstall = url.match(/^\/v1\/channels\/plugins\/(.+)$/);
  if (method === 'DELETE' && uninstall) {
    await handleUninstallChannelPlugin(req, res, uninstall[1]);
    return true;
  }
  return false;
}
