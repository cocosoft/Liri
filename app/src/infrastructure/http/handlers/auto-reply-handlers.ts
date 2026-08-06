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
 * auto-reply-handlers.ts — 自动回复规则管理 HTTP handler（S2）
 *
 * 暴露 GET/POST /v1/auto-reply/rules、PUT/DELETE /v1/auto-reply/rules/:id。
 * 复用 AutoReplyEngine 规则 CRUD，规则持久化于运行时数据目录
 * auto-reply/rules.json（引擎构造时注入 storagePath）。
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import {
  autoReplyEngine,
  type ReplyRule,
  type StoredPattern,
} from '../../../auto-reply';

/** 序列化规则（RegExp → { type, value, flags }，函数 response 不传输） */
function serializeRule(rule: ReplyRule): Record<string, unknown> {
  return {
    id: rule.id,
    name: rule.name,
    pattern:
      rule.pattern instanceof RegExp
        ? {
            type: 'regexp',
            value: rule.pattern.source,
            flags: rule.pattern.flags,
          }
        : { type: 'substring', value: rule.pattern },
    response: typeof rule.response === 'function' ? '' : rule.response,
    priority: rule.priority,
    channel: rule.channel,
    enabled: rule.enabled,
    cooldown: rule.cooldown,
  };
}

/** 解析前端传入的 pattern（string 或 { type, value, flags }） */
function parsePattern(p: unknown): RegExp | string {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    const sp = p as StoredPattern;
    if (sp.type === 'regexp') return new RegExp(sp.value, sp.flags ?? '');
    if (sp.type === 'substring') return sp.value;
  }
  throw new Error('pattern 必须是字符串或 { type, value, flags } 结构');
}

/** 列出规则 GET /v1/auto-reply/rules */
export async function handleListAutoReplyRules(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        rules: autoReplyEngine.getAllRules().map(serializeRule),
        stats: autoReplyEngine.getStats(),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/** 注册规则 POST /v1/auto-reply/rules */
export async function handleCreateAutoReplyRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}') as {
      name?: string;
      pattern?: unknown;
      response?: string;
      priority?: number;
      enabled?: boolean;
      channel?: string;
      cooldown?: number;
    };

    if (
      !body.name ||
      body.pattern === undefined ||
      body.response === undefined
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'name / pattern / response 为必填项' },
        })
      );
      return;
    }

    const pattern = parsePattern(body.pattern);
    const rule = autoReplyEngine.registerRule({
      name: body.name,
      pattern,
      response: body.response,
      priority: body.priority ?? 1,
      enabled: body.enabled ?? true,
      channel: body.channel,
      cooldown: body.cooldown,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(serializeRule(rule)));
  } catch (err) {
    sendError(
      res,
      err,
      err instanceof Error && err.message.includes('pattern') ? 400 : 500
    );
  }
}

/** 更新规则 PUT /v1/auto-reply/rules/:id */
export async function handleUpdateAutoReplyRule(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}') as {
      name?: string;
      pattern?: unknown;
      response?: string;
      priority?: number;
      enabled?: boolean;
      channel?: string;
      cooldown?: number;
    };

    const updates: Partial<Omit<ReplyRule, 'id'>> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.pattern !== undefined)
      updates.pattern = parsePattern(body.pattern);
    if (body.response !== undefined) updates.response = body.response;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.channel !== undefined) updates.channel = body.channel;
    if (body.cooldown !== undefined) updates.cooldown = body.cooldown;

    const updated = autoReplyEngine.updateRule(ruleId, updates);
    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `规则不存在: ${ruleId}` } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(serializeRule(updated)));
  } catch (err) {
    sendError(
      res,
      err,
      err instanceof Error && err.message.includes('pattern') ? 400 : 500
    );
  }
}

/** 删除规则 DELETE /v1/auto-reply/rules/:id */
export async function handleDeleteAutoReplyRule(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    const deleted = autoReplyEngine.deleteRule(ruleId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted }));
  } catch (err) {
    sendError(res, err);
  }
}
