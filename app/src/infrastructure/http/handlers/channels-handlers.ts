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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { tryDynamicRegister } from './channel-handlers';

// ========== Channels Handlers ==========

export async function handleListChannels(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const { ALL_CHANNEL_DEFS } =
        await import('@modules/channels/setupChannels');

      // 已注册通道 → map
      const registeredMap = new Map<string, any>();
      for (const ch of channelRegistry.getAll()) {
        const cfg = channelRegistry.getConfig(ch.name);
        registeredMap.set(ch.name, {
          id: ch.name,
          name: ch.name,
          type: ch.type,
          enabled: ch.enabled,
          connected: (ch as any).connected ?? false,
          config: cfg?.options || {},
        });
      }

      // 合并：全部候选 + 已注册数据
      const result = ALL_CHANNEL_DEFS.map((def) => {
        const registered = registeredMap.get(def.type);
        if (registered) {
          // 已注册的保留实际数据，但名使用定义中的显示名
          return { ...registered, name: def.name, registered: true };
        }
        // 未注册的显示为已知但未配置
        return {
          id: def.type,
          name: def.name,
          type: def.type,
          enabled: false,
          connected: false,
          registered: false,
          config: {},
        };
      });

      // 追加注册了但不在候选表中的通道（如有）
      for (const [name, reg] of registeredMap) {
        if (!ALL_CHANNEL_DEFS.some((d) => d.type === name)) {
          result.push(reg);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
    }
  }

  /**
   * 处理获取通道详情请求
   */
export async function handleGetChannel(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: channel.name,
          name: channel.name,
          type: channel.type,
          enabled: channel.enabled,
          connected: channel.connected,
        })
      );
    } catch (err) {
    }
  }

  /**
   * 处理切换通道启用状态请求
   */
export async function handleToggleChannel(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { enabled } = JSON.parse(body);
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        // 尝试动态注册（可能 registry 状态已丢失）
        const dynRegistered = await tryDynamicRegister(channelId);
        if (!dynRegistered) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
          return;
        }
      }
      if (enabled) {
        await channelRegistry.connect(channelId);
      } else {
        await channelRegistry.disconnect(channelId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: channelId, enabled }));
    } catch (err) {
    }
  }

  /**
   * 处理删除通道请求
   */
export async function handleDeleteChannel(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const result = channelRegistry.unregister(channelId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: result }));
    } catch (err) {
    }
  }
