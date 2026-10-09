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
 * B-05 执行者侧**逐工具** fail-closed 定向单测（第九轮审查专项 B §十五，2026-10-09）
 *
 * 被测：`ChatManagerImpl.executeTool` —— `executionId` 下传后，工具执行**前**做
 * `beginToolCall` 记账；落盘失败 ⇒ **拒绝该工具**（不调用底层执行）。
 *
 * 构造方式：`Object.create(ChatManagerImpl.prototype)` 绕开重型构造器（只注入被测方法
 * 需要的三个内部 seam），避免拉起 messageService/sessionGateway 等无关依赖。
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { getExecutionManager } from '@modules/execution';
import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import type { ToolResult } from '../../src/session/types/tool.js';

/** 被测方法依赖的内部 seam（白盒打桩） */
interface ManagerSeams {
  _toolExecutionService: {
    deps: Record<string, unknown>;
    execute: () => Promise<ToolResult>;
  };
  _currentSessionId: string | null;
  _sessionExecutionIds: Map<string, string>;
}

type ExecuteToolArg = Parameters<ChatManagerImpl['executeTool']>[0];

function makeManager(executionId: string | undefined, result: ToolResult) {
  const mgr = Object.create(ChatManagerImpl.prototype) as ChatManagerImpl;
  const calls: string[] = [];
  const seams = mgr as unknown as ManagerSeams;
  seams._toolExecutionService = {
    deps: {},
    execute: async (): Promise<ToolResult> => {
      calls.push('execute');
      return result;
    },
  };
  seams._currentSessionId = 's1';
  seams._sessionExecutionIds = new Map(
    executionId ? [['s1', executionId]] : []
  );
  return { mgr, calls };
}

const toolCall = {
  id: 't1',
  name: 'BashTool',
  arguments: {},
} as ExecuteToolArg;

describe('B-05 执行者侧逐工具 fail-closed（ChatManager.executeTool）', () => {
  it('有 executionId 且记账落盘失败 ⇒ 拒绝该工具，**不**调用底层执行', async () => {
    const em = getExecutionManager();
    const begin = spyOn(em, 'beginToolCall').mockResolvedValue(false);
    try {
      const { mgr, calls } = makeManager('exec-x', {
        toolCallId: 't1',
        toolName: 'BashTool',
        result: 'should-not-run',
      });

      const r = await mgr.executeTool(toolCall);

      expect(String(r.error)).toContain('fail-closed');
      expect(r.result ?? null).toBeNull();
      expect(calls).toEqual([]); // 底层执行器**未被调用**
    } finally {
      begin.mockRestore();
    }
  });

  it('有 executionId 且落盘成功 ⇒ 正常执行 + 结算（completed）', async () => {
    const em = getExecutionManager();
    const begin = spyOn(em, 'beginToolCall').mockResolvedValue(true);
    const settle = spyOn(em, 'settleToolCall');
    try {
      const { mgr, calls } = makeManager('exec-y', {
        toolCallId: 't1',
        toolName: 'BashTool',
        result: 'ok',
      });

      const r = await mgr.executeTool(toolCall);

      expect(calls).toEqual(['execute']);
      expect(r.result).toBe('ok');
      expect(begin).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle.mock.calls[0][3]).toBe('completed');
    } finally {
      begin.mockRestore();
      settle.mockRestore();
    }
  });

  it('无 executionId ⇒ 不记账、不结算（零行为变更）', async () => {
    const em = getExecutionManager();
    const begin = spyOn(em, 'beginToolCall');
    const settle = spyOn(em, 'settleToolCall');
    try {
      const { mgr, calls } = makeManager(undefined, {
        toolCallId: 't1',
        toolName: 'BashTool',
        result: 'ok',
      });

      await mgr.executeTool(toolCall);

      expect(calls).toEqual(['execute']);
      expect(begin).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    } finally {
      begin.mockRestore();
      settle.mockRestore();
    }
  });
});
