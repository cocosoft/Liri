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
 * 命令领域 HTTP Handlers（从 LocalHTTPService.ts 迁移）
 *
 * - GET /v1/commands          — 列出所有命令
 * - POST /v1/commands/execute — 执行命令
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';

/**
 * 处理列出所有命令请求 GET /v1/commands
 */
export async function handleListCommands(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCommandManager } = await import('@modules/commands');
    const commandManager = getCommandManager();
    const commands = await commandManager.getAllCommands();
    const result = commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      aliases: cmd.aliases || [],
      argumentHint: cmd.argumentHint || '',
      userInvocable: cmd.userInvocable !== false,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理执行命令请求 POST /v1/commands/execute
 */
export async function handleExecuteCommand(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'request body is required' } })
      );
      return;
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch (_err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'invalid JSON in request body' } })
      );
      return;
    }

    const { command } = parsedBody;

    if (!command) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'command is required' } }));
      return;
    }

    const { commandExecutor } =
      await import('@modules/commands/executor/CommandExecutor.js');
    const result = await commandExecutor.execute(command);

    const output = result.value?.toString() || result.message?.toString() || '';
    const error = result.type === 'error' ? output : '';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: result.success !== false,
        output,
        error,
      })
    );
  } catch (err) {
    ctx.sendError(res, err);
  }
}
