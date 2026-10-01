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
// 2026-10-01 D-202（子批 C，auto-reply 域）：原以**相对路径** `'../../../auto-reply'`
// 静态导入 app 层（`autoReplyEngine` + `ReplyRule` / `StoredPattern`）
// ⇒ `infrastructure -> app` 倒挂。改经 **服务层端口** `AutoReplyPort`
// （`runtime/api/autoReplyPorts.ts`，与 `toolsPorts` 同构；驱动实现内聚 `CoreAPIImpl`）。
import type {
  AutoReplyRuleDto,
  AutoReplyRuleInput,
} from '@modules/runtime/api/autoReplyPorts';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

/** 序列化规则（RegExp → { type, value, flags }，函数 response 不传输） */
function serializeRule(rule: AutoReplyRuleDto): Record<string, unknown> {
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

/**
 * 前端传入的 pattern 载荷（string 或 `{ type, value, flags }`）
 *
 * ⚠️ 就地声明的**边界结构**（校验外部 JSON 输入），非 app 层 `StoredPattern` 的端口镜像
 * ⇒ 有意不复用端口 DTO（该结构只在此处消费）。
 */
type PatternPayload = {
  type: 'regexp' | 'substring';
  value: string;
  flags?: string;
};

/** 解析前端传入的 pattern（string 或 { type, value, flags }） */
function parsePattern(p: unknown): RegExp | string {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    const sp = p as PatternPayload;
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
    const port = await getCoreAPI().getAutoReplyPort();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        rules: port.getAllRules().map(serializeRule),
        stats: port.getStats(),
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
    const port = await getCoreAPI().getAutoReplyPort();
    const rule = port.registerRule({
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

    const updates: Partial<AutoReplyRuleInput> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.pattern !== undefined)
      updates.pattern = parsePattern(body.pattern);
    if (body.response !== undefined) updates.response = body.response;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.channel !== undefined) updates.channel = body.channel;
    if (body.cooldown !== undefined) updates.cooldown = body.cooldown;

    const port = await getCoreAPI().getAutoReplyPort();
    const updated = port.updateRule(ruleId, updates);
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
    const port = await getCoreAPI().getAutoReplyPort();
    const deleted = port.deleteRule(ruleId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted }));
  } catch (err) {
    sendError(res, err);
  }
}
