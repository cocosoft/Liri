// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { broadcastEvent } from './handler-utils';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:config-handlers',
  level: LogLevel.INFO,
});

// ========== Config Handlers ==========

export async function handleListConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { configManager } = await import('@modules/config/ConfigManager');
    const globalConfig = configManager.getGlobalConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(globalConfig || {}));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  }
}

/**
 * 处理获取指定配置项请求
 */
export async function handleGetConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const { configManager } = await import('@modules/config/ConfigManager');
    const value = configManager.getConfigValue(key);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key, value }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key, value: null }));
  }
}

/**
 * 处理设置配置项请求
 */
export async function handleSetConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { value } = JSON.parse(body);
    const { configManager } = await import('@modules/config/ConfigManager');
    configManager.setConfigValue(key, value);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key, value }));
    broadcastEvent('config:updated', { key, value });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleDeleteConfig(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const { configManager } = await import('@modules/config/ConfigManager');
    // ConfigManager 没有 deleteConfigValue，通过 saveGlobalConfig 移除 key
    const { getConfig } = await import('@modules/config');
    const current = { ...(getConfig() as Record<string, unknown>) };
    delete current[key];
    configManager.setConfigValue(key, undefined as unknown);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key }));
    broadcastEvent('config:deleted', { key });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

// ========== Router（智能路由）==========

/**
 * 获取 SmartRouter 当前配置与最近一次路由决策
 */
export async function handleRouterGetConfig(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    const core = getCoreAPI();
    const router = core.getSmartRouter();

    const config = router?.getConfig() || null;
    const lastDecision = core.getLastRouteDecision();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          enabled: config?.enabled ?? false,
          config,
          lastDecision,
          active: router !== null,
        },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 更新 SmartRouter 配置（运行时动态切换 + 持久化到 GlobalConfig）
 */
export async function handleRouterUpdateConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { config } = JSON.parse(body);
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    const core = getCoreAPI();
    const router = core.getSmartRouter();

    if (!router) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: false, error: 'SmartRouter 未初始化' })
      );
      return;
    }

    // 更新运行时
    router.updateConfig(config);

    // 持久化到 GlobalConfig.models.router，使重启后配置不丢失
    const { configManager } = await import('@modules/config/ConfigManager');
    configManager.saveGlobalConfig((globalCfg) => ({
      ...globalCfg,
      models: {
        ...globalCfg.models,
        router: { ...globalCfg.models?.router, ...config },
      },
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    broadcastEvent('router:updated', { config });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        logger.debug('Operation skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

// ========== SSE Event Bus ==========

const _clients = new Set<http.ServerResponse>();
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 处理 SSE 事件订阅
 */
export async function handleEvents(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  _clients.add(res);

  if (!_heartbeatTimer) {
    _heartbeatTimer = setInterval(() => {
      const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
      for (const client of _clients) {
        client.write(`event: heartbeat\ndata: ${payload}\n\n`);
      }
    }, 15000);
  }

  req.on('close', () => {
    _clients.delete(res);
    if (_clients.size === 0 && _heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  });
}
