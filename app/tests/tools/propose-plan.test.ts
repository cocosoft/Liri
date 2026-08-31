/**
 * M3-T3.1 — 计划模式 propose_plan 工具契约
 *
 *   ① 用户批准（_userAnswers=['批准']）→ status: approved，返回计划内容供 AI 继续执行
 *   ② 用户驳回（_userAnswers=['驳回']）→ status: rejected，AI 调整后重新提交
 *   ③ 非流式路径（无 _userAnswers）→ 引导错误，不静默吞掉
 *   ④ 计划内容在 question 字段 → 经 assistant/question 事件落盘可回放
 */

import { describe, it, expect } from 'bun:test';
import { ProposePlanTool } from '../../src/tools/ProposePlanTool/ProposePlanTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';

const ctx: ToolUseContext = {
  sessionId: 'sess-plan',
  userId: 'u1',
  workingDirectory: '/tmp',
  environment: {},
  parameters: {},
  config: {},
  options: {},
} as unknown as ToolUseContext;

const planInput = {
  header: '批量删除计划',
  question: '计划：\n1. 扫描 downloads 目录\n2. 删除 30 天前的临时文件\n3. 清理空目录',
  plan: [
    { step: '扫描 downloads 目录' },
    { step: '删除 30 天前的临时文件', detail: '跳过正在使用的文件' },
  ],
};

describe('ProposePlanTool 计划模式（M3-T3.1）', () => {
  it('① 批准 → status approved，返回计划供继续执行', async () => {
    const tool = new ProposePlanTool();
    const result = await tool.execute(
      { ...planInput, _userAnswers: ['批准'] },
      ctx
    );
    expect(result.error).toBeUndefined();
    const parsed = JSON.parse(String(result.data));
    expect(parsed.status).toBe('approved');
    expect(parsed.header).toBe('批量删除计划');
    expect(parsed.plan).toContain('删除 30 天前的临时文件');
    expect(parsed.steps).toHaveLength(2);
  });

  it('② 驳回 → status rejected，AI 需调整后重新提交', async () => {
    const tool = new ProposePlanTool();
    const result = await tool.execute(
      { ...planInput, _userAnswers: ['驳回'] },
      ctx
    );
    expect(result.error).toBeUndefined();
    const parsed = JSON.parse(String(result.data));
    expect(parsed.status).toBe('rejected');
    expect(parsed.message).toContain('驳回');
  });

  it('③ 非流式路径（无 _userAnswers）→ 引导错误不静默', async () => {
    const tool = new ProposePlanTool();
    const result = await tool.execute(planInput, ctx);
    const data = result.data as { error?: string };
    expect(data.error).toBeDefined();
    expect(String(data.error)).toContain('_userAnswers');
  });

  it('④ 工具标记 requiresUserInteraction → ReActToolLoop 走 question 挂起通道', () => {
    const tool = new ProposePlanTool();
    expect(tool.requiresUserInteraction()).toBe(true);
  });

  it('⑤ 工具标记只读（读类判定，不触发写审批）', () => {
    const tool = new ProposePlanTool();
    expect(tool.isReadOnly()).toBe(true);
  });
});
