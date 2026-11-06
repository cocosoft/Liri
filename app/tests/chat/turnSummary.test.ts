// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-3（2026-11-06）回归锁：跨轮摘要必须保留**任务目标**与**助手结论**。
//
// 真机 `session_mw458fpp3ea32a050e` 的 metadata.contextSummary 曾是：
//   此前对话决策摘要:
//   用户选择: Continue.
//   用户选择: 继续
//   用户选择: 没看到命令审批卡啊，哥们。
// —— 任务目标与计划全部丢失，下一轮模型只能重新规划。

import { describe, expect, it } from 'bun:test';
import { persistTurnSummary } from '../../src/chat/services/MessageContextPipeline';
import type { ChatSession } from '@modules/session/types/session.js';

function msg(role: 'user' | 'assistant', content: string) {
  return { role, content } as unknown as ChatSession['messages'][number];
}

function sessionWith(messages: ReturnType<typeof msg>[]): ChatSession {
  return { id: 's-summary', messages, metadata: {} } as unknown as ChatSession;
}

describe('P2-3：跨轮对话摘要', () => {
  it('保留任务目标 + 用户指令 + 助手结论（修复前只剩短指令）', () => {
    const session = sessionWith([
      msg(
        'user',
        '测试长程任务，完成俄罗斯方块小游戏的开发，然后出具开发完成报告。'
      ),
      msg('assistant', '### 俄罗斯方块开发 · 执行计划\nS1 初始化目录'),
      msg('user', '按计划直接执行'),
      msg('user', '继续'),
      msg('user', '没看到命令审批卡啊，哥们。'),
      msg('assistant', '已完成 S1-S3，下一步执行测试。'),
    ]);

    persistTurnSummary(session);
    const summary = String(session.metadata?.contextSummary ?? '');

    expect(summary).toContain(
      '任务目标: 测试长程任务，完成俄罗斯方块小游戏的开发'
    );
    expect(summary).toContain('用户指令:');
    expect(summary).toContain('继续');
    expect(summary).toContain('助手最近结论: 已完成 S1-S3');
    // 修复前：只有「用户选择: …」三条短指令
    expect(summary).not.toContain('用户选择: Continue.');
  });

  it('助手结论先剥 <think>（不把思考当结论）', () => {
    const session = sessionWith([
      msg('user', '这是一个足够长的任务描述，用于触发摘要生成。'),
      msg(
        'assistant',
        '<think>内部推理内容不应出现</think>最终结论：测试全绿。'
      ),
      msg('user', '继续'),
    ]);

    persistTurnSummary(session);
    const summary = String(session.metadata?.contextSummary ?? '');
    expect(summary).toContain('最终结论：测试全绿');
    expect(summary).not.toContain('内部推理内容不应出现');
  });

  it('短指令去重（连续两次"继续"只留一条）', () => {
    const session = sessionWith([
      msg('user', '这是一个足够长的任务描述，用于触发摘要生成。'),
      msg('assistant', 'ok'),
      msg('user', '继续'),
      msg('user', '继续'),
    ]);

    persistTurnSummary(session);
    const summary = String(session.metadata?.contextSummary ?? '');
    expect(summary.match(/用户指令: 继续/g)?.length).toBe(1);
  });

  it('负向：消息不足 3 条 / 无用户消息 ⇒ 不写摘要（零行为变更）', () => {
    const few = sessionWith([msg('user', '你好')]);
    persistTurnSummary(few);
    expect(few.metadata?.contextSummary).toBeUndefined();

    const noUser = sessionWith([
      msg('assistant', 'a'),
      msg('assistant', 'b'),
      msg('assistant', 'c'),
    ]);
    persistTurnSummary(noUser);
    expect(noUser.metadata?.contextSummary).toBeUndefined();
  });
});
