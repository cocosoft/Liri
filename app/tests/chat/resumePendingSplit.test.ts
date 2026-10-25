// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-13a（2026-10-25）：续跑时按幂等性拆分「未完成工具」。
//
// 口径：幂等（`TOOL_EFFECTS.idempotent === true`）⇒ 可自动重放；非幂等 / **未声明** ⇒ 人工确认。
// 判据唯一事实源 = `tools/toolEffects.ts`（`canReplayAfterUnknown`），本文件只做拆分。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { splitResumePending } from '../../src/chat/manager/resumePending';

describe('T25-13a：续跑未完成工具拆分', () => {
  it('空 / 缺省 ⇒ 两侧均为空（零行为变更）', () => {
    expect(splitResumePending(undefined)).toEqual({
      replayable: [],
      manual: [],
    });
    expect(splitResumePending(null)).toEqual({ replayable: [], manual: [] });
    expect(splitResumePending([])).toEqual({ replayable: [], manual: [] });
  });

  it('只读工具 ⇒ replayable（可写进"请继续"清单）', () => {
    const r = splitResumePending([
      { toolCallId: 't1', toolName: 'read_project_file' },
      { toolCallId: 't2', toolName: 'grep' },
    ]);
    expect(r.replayable.map((p) => p.toolName)).toEqual([
      'read_project_file',
      'grep',
    ]);
    expect(r.manual).toHaveLength(0);
  });

  it('非幂等工具 ⇒ manual（bash / 写文件）', () => {
    const r = splitResumePending([
      {
        toolCallId: 'b1',
        toolName: 'bash',
        args: { command: 'npm run build' },
      },
      { toolCallId: 'w1', toolName: 'write_project_file' },
    ]);
    expect(r.manual.map((p) => p.toolName)).toEqual([
      'bash',
      'write_project_file',
    ]);
    expect(r.replayable).toHaveLength(0);
  });

  it('未声明效果（MCP / 插件）⇒ manual（fail-closed）', () => {
    const r = splitResumePending([
      { toolCallId: 'm1', toolName: 'mcp__unknown__tool' },
    ]);
    expect(r.manual).toHaveLength(1);
    expect(r.replayable).toHaveLength(0);
  });

  it('混合清单 ⇒ 两侧各自保序（replayable 在前判断依据不变）', () => {
    const r = splitResumePending([
      { toolCallId: 'a', toolName: 'read_project_file' },
      { toolCallId: 'b', toolName: 'bash' },
      { toolCallId: 'c', toolName: 'grep' },
      { toolCallId: 'd', toolName: 'code_run' },
    ]);
    expect(r.replayable.map((p) => p.toolCallId)).toEqual(['a', 'c']);
    expect(r.manual.map((p) => p.toolCallId)).toEqual(['b', 'd']);
  });
});

describe('T25-13a：接线防回流（源码级）', () => {
  it('两条续跑路径都使用 splitResumePending，且不再直接把原始 pending 交给提示', () => {
    const src = readFileSync(
      new URL('../../src/chat/ChatManager.ts', import.meta.url),
      'utf8'
    );
    // 两个拆分变量各出现一次（resumeSuspendedSession / _resumeSuspendedStream）
    expect(src).toContain('splitResumePending(latest?.pendingToolCalls)');
    expect(src).toContain('splitResumePending(pending)');
    // 提示只消费 replayable（原始清单不得直接进提示）
    expect(src).toContain('buildBudgetResumePrompt(resumeSplit.replayable)');
    expect(src).toContain('buildBudgetResumePrompt(streamSplit.replayable)');
    expect(src).not.toContain(
      'buildBudgetResumePrompt(latest?.pendingToolCalls)'
    );
    expect(src).not.toContain('buildBudgetResumePrompt(pending)');
  });
});
