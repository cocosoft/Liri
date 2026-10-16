/**
 * AskUserQuestionTool 契约（补既有空白）
 *
 * **为什么补**：交互链路的既有测试（`ReActToolLoop*.test.ts`、`events-trailing-turn.test.ts`）
 * **全部使用** `{ requiresUserInteraction: () => true } **桩**，
 * 真实现的该标记与 execute 契约此前**无任何守卫**（同族工具 `propose_plan` 已下线，其侧守卫一并移除）。
 *
 * **与 `propose_plan` 的关系（2026-10-16 两次裁定，后者推翻前者）**：
 * 先裁定「保留两个」（理由：二者共用同一条 question 通道 ⇒ 非事实源双轨），随后用户裁定
 * **合并下线** `propose_plan`（其 loader / 工厂 / 类别 / `TOOL_EFFECTS` / 常量 / 实现体已同批移除，
 * 生成物 78 → 77）。⇒ **本工具现为唯一的用户交互（含审批）入口**：提交计划并请批准的语义由
 * `questionType='confirm'` 承接。本文件 ④ 保留 `requiresUserInteraction` 断言 —— 它现在钉的是
 * 「本工具走 question 通道」这一**不可回退**的前提（唯一入口若失联，交互链路整体不可用）。
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

  it('④ 标记 requiresUserInteraction ⇒ 走 question 通道（现为唯一交互入口，失联即链路不可用）', () => {
    expect(new AskUserQuestionTool().requiresUserInteraction()).toBe(true);
    expect(new AskUserQuestionTool().isReadOnly()).toBe(true);
  });
});
