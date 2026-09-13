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

/**
 * a2a-routes.ts — dispatchA2aRoutes（D3）
 *
 * 与其它领域分发模块同构（R06-001 注册式路由，禁 if/else 巨型路由）：
 * 只做「路径匹配 → 调 handler → 返回是否命中」，业务在 `a2a-handlers.ts`。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleA2aRpc, handleAgentCard } from '../a2a-handlers';

/** Agent Card 端点路径（§5.1：RFC 8615 well-known URI） */
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

/** JSON-RPC 端点路径（§4.4 / §6.1） */
export const A2A_RPC_PATH = '/a2a';

export async function dispatchA2aRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  if (method === 'GET' && url === AGENT_CARD_PATH) {
    await handleAgentCard(handlerCtx, req, res);
    return true;
  }

  if (method === 'POST' && url === A2A_RPC_PATH) {
    await handleA2aRpc(handlerCtx, req, res);
    return true;
  }

  return false;
}
