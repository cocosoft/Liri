/**
 * AskUserQuestionTool 契约（补既有空白）
 *
 * **为什么补**：交互链路的既有测试（`ReActToolLoop*.test.ts`、`plan-mode-loop.test.ts`、
 * `events-trailing-turn.test.ts`）**全部使用** `{ requiresUserInteraction: () => true } **桩**，
 * 真实现的该标记与 execute 契约此前**无任何守卫**；而 `propose-plan.test.ts` 侧已有 ④/⑤。
 *
 * **与 `propose_plan` 的边界（2026-10-16 终局裁定「保留两个」，见
 * `dev_docs/20261016/工具可见性治理-P4a-影子工具评估.md` §6）**：
 * 二者**共用同一条 question 通道**（`requiresUserInteraction()` → `ReActToolLoop` yield question
 * → 答复经 `_userAnswers` 注入 → 同一 `QuestionBlock` 渲染），只是**语义不同** ——
 * `ask_user_question` 是通用提问（choice/open/confirm），`propose_plan` 是「提交计划 → 等批准 →
 * 按计划续跑」的专用通道 ⇒ **不构成事实源双轨**。本文件 ④ 是该裁定前提的另一半机器校验
 * （另一半在 `propose-plan.test.ts` ④/⑤）：若任一被改走独立通道，裁定前提失效，须重开裁定。
 */

import { describe, it, expect } from 'bun:test';
import { AskUserQuestionTool } from '../../src/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';

const ctx = { sessionId: 'sess-ask' } as unknown as ToolUseContext;

describe('AskUserQuestionTool 契约', () => {
  it('① choice：用户选择经 _userAnswers 注入 ⇒ 原样回填并保持 questionType', async () => {
    const tool = new AskUserQuestionTool();
    const result = await tool.execute(
      {
        question: '选哪个技术栈？',
        header: '技术栈',
        options: [{ label: 'React' }, { label: 'Vue' }],
        questionType: 'choice',
        _userAnswers: ['Vue'],
      },
      ctx
    );
    expect(result.error).toBeUndefined();
    const parsed = JSON.parse(String(result.data));
    expect(parsed.answers).toEqual(['Vue']);
    expect(parsed.questionType).toBe('choice');
    expect(parsed.questionId).toBeTruthy();
  });

  it('② confirm：无选项亦可作答（是/否确认，即「请求批准」的通用形态）', async () => {
    const tool = new AskUserQuestionTool();
    const result = await tool.execute(
      {
        question: '是否继续执行？',
        header: '确认',
        questionType: 'confirm',
        _userAnswers: ['确认'],
      },
      ctx
    );
    const parsed = JSON.parse(String(result.data));
    expect(parsed.questionType).toBe('confirm');
    expect(parsed.answers).toEqual(['确认']);
  });

  it('③ 无 _userAnswers（非流式路径）⇒ 引导错误，不静默吞掉', async () => {
    const tool = new AskUserQuestionTool();
    const result = await tool.execute({ question: 'x', header: 'h' }, ctx);
    const data = result.data as { error?: string };
    expect(data.error).toBeDefined();
    expect(String(data.error)).toContain('_userAnswers');
  });

  it('④ 标记 requiresUserInteraction ⇒ 与 propose_plan 同处一条 question 通道（裁定前提）', () => {
    expect(new AskUserQuestionTool().requiresUserInteraction()).toBe(true);
    expect(new AskUserQuestionTool().isReadOnly()).toBe(true);
  });
});
