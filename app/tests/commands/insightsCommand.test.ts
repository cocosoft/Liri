/**
 * `/insights` 命令真实数据化测试（2026-10-23）
 *
 * 改造前：四个子命令全部返回硬编码常量（`totalCommands: 42` / `avgResponseTime: 1250` …），
 * 接 UI 等于把假数据摆上界面（CS04）。
 * 改造后：会话数据来自 `chatManager.getSessionMessages`，结构化提取来自 `insightsEngine`，
 * 性能数据来自 `PerformanceMonitorService` 的真实采样；无数据时如实提示。
 */
import { describe, it, expect } from 'bun:test';

import insightsCommand from '../../src/commands/builtin/insights/Insights';
import type { CommandContext } from '../../src/commands/types';

interface FakeMessage {
  role?: string;
  type?: string;
  content: string;
  createdAt?: Date;
}

function makeContext(
  messages: FakeMessage[],
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    sessionId: 's-1',
    chatManager: {
      getSessionMessages: async () => messages,
    },
    ...overrides,
  } as unknown as CommandContext;
}

describe('/insights 真实数据源', () => {
  it('缺少聊天管理器 ⇒ 明确报错，不返回假数据', async () => {
    const result = await insightsCommand.execute('show', {
      sessionId: 's-1',
    } as unknown as CommandContext);

    expect(result.success).toBe(false);
    expect(result.message).toContain('聊天管理器不可用');
    expect(result.message).not.toContain('42');
  });

  it('空会话 ⇒ 如实提示「暂无消息」，不出现任何常量指标', async () => {
    const result = await insightsCommand.execute('show', makeContext([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain('暂无消息');
    expect(result.message).not.toContain('1250');
    expect(result.message).not.toContain('terminal');
  });

  it('show ⇒ 角色分布来自真实消息', async () => {
    const result = await insightsCommand.execute(
      'show',
      makeContext([
        { role: 'user', content: '请帮我看看这个报错' },
        { role: 'assistant', content: '结论：是空指针导致的' },
        { role: 'user', content: '好的，谢谢' },
      ])
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('消息总数: 3');
    expect(result.message).toContain(
      '用户 / 助手 / 工具 / 系统: 2 / 1 / 0 / 0'
    );
  });

  it('summary ⇒ 决策与关键事实由会话文本提取', async () => {
    const result = await insightsCommand.execute(
      'summary',
      makeContext([
        { role: 'assistant', content: '决定：采用方案 B 进行迁移' },
        { role: 'assistant', content: '结论：旧接口需要保留一个版本' },
      ])
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('采用方案 B 进行迁移');
    expect(result.message).toContain('旧接口需要保留一个版本');
  });

  it('suggestions ⇒ 由待决问题派生，不引入常量建议', async () => {
    const result = await insightsCommand.execute(
      'suggestions',
      makeContext([{ role: 'user', content: '是否需要继续？' }])
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('待决问题');
    expect(result.message).not.toContain('上下文大小已超过推荐阈值');
  });

  it('performance ⇒ 只报告进程内采样现状', async () => {
    const result = await insightsCommand.execute(
      'performance',
      {} as unknown as CommandContext
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('性能洞察');
    expect(result.message).not.toContain('overallScore');
  });

  it('help ⇒ 用法说明不再声称有"智能评分"', async () => {
    const result = await insightsCommand.execute(
      'help',
      {} as unknown as CommandContext
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('/insights performance');
  });

  it('未知子命令 ⇒ 返回用法并标记失败', async () => {
    const result = await insightsCommand.execute(
      'unknown',
      makeContext([{ role: 'user', content: '随便说点什么' }])
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('/insights help');
  });
});
