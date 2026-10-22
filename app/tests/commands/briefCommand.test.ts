/**
 * `/brief` 的提取实现收敛（2026-10-23）
 *
 * 背景：摘要提取此前有**三套**实现 —— `Brief` 命令、`BriefTool`、`InsightsEngine`。
 * 本轮把前两者的私有正则上收进 `InsightsEngine`，命令/工具只保留排版。
 *
 * 本用例锁三件事：
 *  ① 引擎**独有**的事实模式（`结论：`）能出现在 brief 输出里 ⇒ 证明已委派；
 *  ② brief 原有的覆盖（`讨论了…` / `需求是…`）不丢 ⇒ 证明模式是上收而非删除；
 *  ③ 空会话如实提示。
 */
import { describe, it, expect } from 'bun:test';

import { briefCommand } from '../../src/commands/builtin/brief/Brief';
import type { CommandContext } from '../../src/commands/types';

function makeContext(messages: Array<Record<string, unknown>>): CommandContext {
  return {
    sessionId: 's-1',
    chatManager: { getSessionMessages: async () => messages },
  } as unknown as CommandContext;
}

describe('/brief 提取实现收敛到 InsightsEngine', () => {
  it('引擎独有的事实/行动项模式出现在 brief 输出里', async () => {
    const result = await briefCommand.call(
      '--type=detailed',
      makeContext([
        {
          role: 'assistant',
          content: '结论：根因是锁竞争。决定：改用队列。下一步：补并发测试。',
        },
      ])
    );

    expect(result.value).toContain('根因是锁竞争');
    expect(result.value).toContain('改用队列');
    expect(result.value).toContain('补并发测试');
  });

  it('brief 原有覆盖（讨论 / 需求）不丢（模式已上收进引擎）', async () => {
    const result = await briefCommand.call(
      '--type=detailed',
      makeContext([
        {
          role: 'assistant',
          // 上收的模式本身要求「讨论…」后有空白（原 Brief 正则如此），此处按原样构造
          content: '讨论了 部署方案。需求是支持多租户。',
        },
      ])
    );

    expect(result.value).toContain('部署方案');
    expect(result.value).toContain('支持多租户');
  });

  it('空会话 ⇒ 如实提示', async () => {
    const result = await briefCommand.call('', makeContext([]));

    expect(result.value).toContain('暂无消息');
  });
});
