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

import type http from 'http';
import type { HandlerCtx } from './handler-utils';

/**
 * GET /v1/state/all — 聚合 StateMachineRegistry 中所有已注册状态机（§十 阶段 D）
 *
 * 前端运行状况面板据此展示应用全局状态（AppStateMachine 等）。
 * 满足 R09-005：新增状态机必须在 /v1/state/all 中暴露。
 */
export async function handleStateAll(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { StateMachineRegistry } = await import('../../../state');
    const registry = StateMachineRegistry.getInstance();
    const machines = registry
      .listActive()
      .map((id: string) => {
        const machine = registry.find<string>(id);
        if (!machine) return null;
        return {
          id,
          state: machine.getState(),
          isTerminal: machine.isTerminal(),
          isActive: machine.isActive(),
          history: machine.getHistory().slice(-10),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ generatedAt: Date.now(), machines }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
    );
  }
}
