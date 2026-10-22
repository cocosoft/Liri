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
// C1（2026-09-30 D-111，零散单点收尾）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('http:commands');

/**
 * 处理列出所有命令请求 GET /v1/commands
 */
export async function handleListCommands(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const commands = await (
      await getCoreAPI().getCommandsOpsPort()
    ).listCommands();
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

    const { command, session_id } = parsedBody;

    if (!command) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'command is required' } }));
      return;
    }

    // 2026-10-22：会话级命令（如 `brief`）需要本会话 id，否则 `getSessionMessages(undefined)`
    // 必然失败。字段名沿用 HTTP 契约的 snake_case（与 `POST /v1/chat/completions` 一致）。
    const sessionId =
      typeof session_id === 'string' && session_id.trim()
        ? session_id.trim()
        : undefined;

    // 多租户 P3（2026-10-23）：会话级命令（brief / insights 等）会按 session_id 读取本会话消息。
    // 跨身份 / 不存在的会话 ⇒ 404，与 `chat-handlers.respond404IfSessionUnavailable` 同口径
    // （不泄露存在性）。聊天管理器未提供该能力（测试替身 / 早期启动）⇒ 放行，不把守卫变成硬依赖。
    if (sessionId) {
      const canUse = await getCoreAPI().chatManager?.canUseSession?.(sessionId);
      if (canUse === false) {
        logger.info('会话不可用（跨身份或不存在），命令执行前返回 404', {
          sessionId,
          command,
        });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Session not found', type: 'not_found_error' },
          })
        );
        return;
      }
    }

    const result = await (
      await getCoreAPI().getCommandsOpsPort()
    ).executeCommand(command, sessionId);

    // 2026-10-22：`call` 形态的命令（brief / help 等）结果被 `CommandManager` 包成
    // `{ success, data: { type, value } }` ⇒ 只读顶层 `value` 会得到空串（HTTP 200 + 空输出）。
    // 依次回退：顶层 → data 内层 → message。`data` 在端口上是 `unknown`，此处边界收窄。
    const data = (result.data ?? {}) as {
      value?: string;
      message?: string;
      type?: string;
      error?: string;
    };
    const payloadType = result.type ?? data.type;
    const output =
      result.value?.toString() ||
      data.value?.toString() ||
      result.message?.toString() ||
      data.message?.toString() ||
      '';
    // 2026-10-22（BUG-17）：失败时把**命令级 error** 也透出。
    // 原实现只认 `type === 'error'`，而多数命令的失败形态是 `{ success:false, error }`
    // （不带 type）⇒ error 被丢成空串，前端只能退化成通用失败文案（真实原因丢失）。
    // 现在：显式 error 字段优先；无该字段时仍按旧口径用 output（与既有行为兼容）。
    const payloadError =
      result.error?.toString() || data.error?.toString() || '';
    const failed = result.success === false || payloadType === 'error';
    const error = failed ? payloadError || output : '';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: result.success !== false,
        output,
        error,
        // 2026-10-23（方案 B）：`execute` 形态命令（如 `insights report`）把结构化载荷放在
        // 顶层 `result.data`；`call` 形态的 `data` 是 `{type, value}` 文本包装。
        // 这里原样透出，由前端决定用结构化渲染还是纯文本。缺省不带该字段（保持旧响应形状）。
        ...(result.data === undefined ? {} : { data: result.data }),
      })
    );
  } catch (err) {
    ctx.sendError(res, err);
  }
}
