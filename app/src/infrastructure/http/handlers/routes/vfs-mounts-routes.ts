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
 * vfs-mounts-routes.ts — dispatchVfsMountRoutes
 *
 * AI-VFS 用户可配置挂载面（冻结契约：`.trae/specs/ai-vfs-user-mountable.md §8.2`）。
 * 由 `route-table.ts` 统一调度（路由注册唯一入口）。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleGetVfsMounts, handlePutVfsMounts } from '../vfs-mounts-handlers';

/**
 * dispatchVfsMountRoutes — AI-VFS 挂载领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchVfsMountRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  if (method === 'GET' && url === '/v1/vfs/mounts') {
    await handleGetVfsMounts(req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/vfs/mounts') {
    await handlePutVfsMounts(req, res);
    return true;
  }

  return false;
}
