/**
 * 接线层 seam 用例（N15）—— `execute()` 中"解析 fail-closed ⇒ 结算台账 ⇒ 释放并发槽位"
 * 这条**接线**（非纯函数）的闭环。
 *
 * 背景：`agentDescriptorResolver.test.ts` 只覆盖纯函数与注入依赖；`AgentTool.ts:1512-1516`
 * 的接线此前**无覆盖**（台账见 N15）。该接线一旦漏掉 `settleRun`，条目会以 `running`
 * **永久占用并发槽位**（该处代码注释已写明此风险）—— 因此这里断言的重点是"槽位未泄漏"，
 * 而不只是"返回了错误"。
 *
 * 说明：本用例**不注入** resolver 桩，走真实四级回退 ⇒ 传未知 `subagent_type` 必然在
 * 第 ④ 级被显式拒绝（fail-closed），从而覆盖真实接线的全部三步。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import { getAgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';
import { getAgentRunLedger } from '../../../src/tools/AgentTool/AgentRunLedger';

describe('接线层 seam（N15）：解析 fail-closed 的台账/落盘闭环', () => {
  beforeEach(() => {
    setAgentToolManager(() => []);
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('未知 subagent_type ⇒ FAILURE + 台账已结算（槽位未泄漏）+ 磁盘行 failed', async () => {
    const before = await getAgentRunStore().listRuns();
    const liveBefore = getAgentRunLedger().liveCount();

    const tool = new AgentTool();
    const result = await tool.execute({
      description: '未知类型',
      prompt: '做点事',
      subagent_type: 'no-such-type-xyz',
    });

    // ① 显式拒绝（fail-closed），文案含类型名（便于模型/用户纠正）
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(result.error)).toContain('no-such-type-xyz');

    // ② 台账已结算 ⇒ 并发槽位释放（**本用例的核心断言**）
    expect(getAgentRunLedger().liveCount()).toBe(liveBefore);

    // ③ 磁盘：恰好新增一条，且为终态 failed
    const after = await getAgentRunStore().listRuns();
    const added = after.filter(
      (r) => !before.some((b) => b.toolCallId === r.toolCallId)
    );
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('failed');
  });

  test('工具集校验失败发生在**登记之前** ⇒ FAILURE 且不产生任何运行态行', async () => {
    const before = await getAgentRunStore().listRuns();
    const liveBefore = getAgentRunLedger().liveCount();

    const tool = new AgentTool();
    const result = await tool.execute({
      description: '空清单',
      prompt: '做点事',
      // O7③ fail-closed：显式空清单会被拒绝（原语义会放开全部工具）
      allowedTools: [],
    });

    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    // 拒绝在登记前 ⇒ 既无内存条目也无磁盘行（不产生副作用）
    expect(getAgentRunLedger().liveCount()).toBe(liveBefore);
    expect((await getAgentRunStore().listRuns()).length).toBe(before.length);
  });
});
