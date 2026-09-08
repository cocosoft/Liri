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
 * openai-gateway-routes.ts — OpenAI 兼容网关路由分发（TRAE/第三方接入 dawate）
 *
 * 与既有 `/v1/chat/completions`（ChatManager 全栈）区分：
 * 网关路由走无状态直连 Provider（见 openai-gateway-handlers.ts）。
 * 鉴权沿用全局 LIRI_API_SECRET。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleOpenAIGatewayChatCompletions } from '../openai-gateway-handlers';

/**
 * dispatchOpenAIGatewayRoutes — OpenAI 兼容网关领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchOpenAIGatewayRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  // ---- OpenAI 兼容 Chat Completions（无状态直连 Provider） ----
  if (method === 'POST' && url === '/v1/openai/chat/completions') {
    await handleOpenAIGatewayChatCompletions(handlerCtx, req, res);
    return true;
  }
  return false;
}
