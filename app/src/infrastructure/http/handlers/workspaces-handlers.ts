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
import { handleError } from '@modules/error/handleError';

// ========== Workspaces Handlers ==========

export async function handleListWorkspaces(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { buildEntries } =
      await import('@modules/commands/builtin/workspace/WorkspaceStorage');
    const entries = await buildEntries();

    const workspaces = entries.map((entry) => ({
      id: entry.meta.id,
      name: entry.name,
      description: entry.meta.description,
      createdAt: new Date(entry.meta.createdAt).getTime(),
      updatedAt: new Date(entry.meta.updatedAt).getTime(),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workspaces));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}
