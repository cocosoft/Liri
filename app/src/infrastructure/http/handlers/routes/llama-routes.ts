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
 * llama-routes.ts — dispatchLlamaRoutes
 *
 * llama.cpp 集成领域路由分发（Phase 1：/v1/llama/status）
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleLlamaConfig,
  handleLlamaRestart,
  handleLlamaStatus,
} from '../llama-handlers';

/**
 * dispatchLlamaRoutes — llama 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchLlamaRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  if (method === 'GET' && url === '/v1/llama/status') {
    await handleLlamaStatus(req, res);
    return true;
  }
  if (url === '/v1/llama/config') {
    await handleLlamaConfig(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/llama/restart') {
    await handleLlamaRestart(req, res);
    return true;
  }

  return false;
}
