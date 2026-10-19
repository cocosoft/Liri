/**
 * 「产出后交付提示」行为回归（2026-10-19 根因修复）。
 *
 * 背景：旧文案在每次 file_write/file_edit 成功后都要求「并结束本轮」，长任务每写一个
 * 中间文件就被迫收尾，用户必须反复回「继续」。本测试钉住新契约：
 * - 提示不再命令结束本轮，而是按任务完成度二选一（交付说明 / 继续执行）；
 * - 同一 assistant 消息（同一用户轮）只提示一次，避免逐轮打断；
 * - 写入失败 / 非产出型工具不提示。
 */
import { describe, it, expect } from 'bun:test';

import { ChatStreamMessageLifecycle } from '../../src/chat/pipeline/streamMessageLifecycle';

function makeLifecycle(): ChatStreamMessageLifecycle {
  return new ChatStreamMessageLifecycle({
    setLastStreamBuildWindowed: () => {},
    setLastStreamBuildCodeContext: () => {},
    getLastStreamBuildCodeContext: () => false,
    getCurrentSessionId: () => 'sess-test',
  });
}

function buildRound(
  lifecycle: ChatStreamMessageLifecycle,
  assistantId: string,
  toolName: string,
  error?: string
): Array<Record<string, unknown>> {
  const call = {
    id: `call-${assistantId}-${toolName}`,
    name: toolName,
    arguments: { file_path: 'x.md' },
  };
  return lifecycle.buildToolRoundMessages(
    [],
    { id: assistantId, role: 'assistant', content: '' } as never,
    [call] as never,
    [
      {
        normalizedToolCall: call,
        result: {
          toolCallId: call.id,
          toolName,
          result: 'ok',
          error,
        },
      },
    ] as never
  );
}

function systemHints(messages: Array<Record<string, unknown>>): string[] {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => String(m.content ?? ''));
}

describe('产出后交付提示', () => {
  it('成功后注入条件式提示，不再命令结束本轮', () => {
    const lifecycle = makeLifecycle();
    const hints = systemHints(buildRound(lifecycle, 'a1', 'file_write'));

    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('[交付提示]');
    expect(hints[0]).toContain('继续执行后续步骤');
    expect(hints[0]).not.toContain('结束本轮');
    expect(hints[0]).not.toContain('不要在没有新需求的情况下继续');
  });

  it('同一用户轮（同一 assistant 消息 id）只提示一次', () => {
    const lifecycle = makeLifecycle();

    expect(systemHints(buildRound(lifecycle, 'a1', 'file_write'))).toHaveLength(
      1
    );
    expect(systemHints(buildRound(lifecycle, 'a1', 'file_edit'))).toHaveLength(
      0
    );
  });

  it('下一个用户轮（新 assistant 消息 id）重新提示', () => {
    const lifecycle = makeLifecycle();

    expect(systemHints(buildRound(lifecycle, 'a1', 'file_write'))).toHaveLength(
      1
    );
    expect(systemHints(buildRound(lifecycle, 'a2', 'file_write'))).toHaveLength(
      1
    );
  });

  it('写入失败或非产出型工具不提示', () => {
    const lifecycle = makeLifecycle();

    expect(
      systemHints(buildRound(lifecycle, 'a1', 'file_write', 'disk full'))
    ).toHaveLength(0);
    expect(systemHints(buildRound(lifecycle, 'a2', 'file_read'))).toHaveLength(
      0
    );
  });
});
