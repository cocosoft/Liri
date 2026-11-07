// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-08（真机 `pdca_mw6p0s5t` / `pdca_mw6rx5kr`）：PDCA **终态回执**文案。
 *
 * 背景：HTTP 启动的编排器没有 `onTaskMessage` ⇒ 会话拿不到任何消息（真机 4/4 步完成、
 * 产物正确，`messages.jsonl` 仍 0 字节）。回执下沉到编排层（`lro/terminalReceipt`）后，
 * completed / failed（含 escalate）/ 挂起/续跑 三个落点统一发出。
 *
 * 口径：**不做状态词汇比较**（`lint:state-ratchet`：状态字面量须收敛到唯一事实源），
 * 只用「步数事实 + 阶段名（数据）」决定文案。
 */
import { describe, expect, it } from 'bun:test';
import { formatPdcaReceipt } from '../../src/tasks/lro/terminalReceipt';

const base = { taskId: 'pdca_demo', completed: 4, total: 4, failed: 0 };

describe('formatPdcaReceipt — 终态回执文案', () => {
  it('全部完成且无失败 ⇒ ✅ 完成（带步数与 taskId）', () => {
    const text = formatPdcaReceipt({ ...base, phase: 'completed' });
    expect(text).toContain('长程任务完成');
    expect(text).toContain('4/4 步');
    expect(text).toContain('pdca_demo');
  });

  it('尚未结束（如等待审批）⇒ ⏸ 并展示阶段名', () => {
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'stage_awaiting_approval',
      completed: 2,
      total: 4,
      failed: 0,
    });
    expect(text).toContain('未结束');
    expect(text).toContain('2/4 步');
    expect(text).toContain('stage_awaiting_approval');
  });

  it('有失败/取消步 ⇒ ⚠️ 且带失败步数', () => {
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'execute',
      completed: 2,
      total: 4,
      failed: 1,
    });
    expect(text).toContain('未完成');
    expect(text).toContain('2/4 步');
    expect(text).toContain('1 步失败');
  });

  it('步数全完成但有失败步 ⇒ 不冒充完成', () => {
    const text = formatPdcaReceipt({ ...base, phase: 'completed', failed: 1 });
    expect(text).toContain('未完成');
    expect(text).not.toContain('长程任务完成');
  });

  it('挂起等待审批（即使可见步骤全部完成）⇒ ⏸ 挂起，不冒充完成', () => {
    // 真机 `pdca_mw6tie3k`：产物已写好、只剩一条 shell 命令等批准 ⇒ 2/2 步完成，
    // 但任务确实在等审批；只按步数判定会输出假的「✅ 完成」。
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'stage_awaiting_approval',
      completed: 2,
      total: 2,
      failed: 0,
      paused: true,
    });
    expect(text).toContain('已挂起等待审批');
    expect(text).not.toContain('长程任务完成');
  });
});
