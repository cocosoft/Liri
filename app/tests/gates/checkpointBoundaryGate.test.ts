/**
 * Checkpoint 边界判定表 —— 规格 `.trae/specs/p5-runtime-hardening-specs.md` §3.2（P5-4，2026-10-28）
 *
 * 锁住四条：
 * ① 边界清单**派生自** `TOOL_EFFECTS`（不可逆 = 有副作用 ∧ 非幂等），与 AC-11 的 54 条一致；
 * ② 只读 / 幂等工具**不触发**（防空转与噪声）；
 * ③ `strict` 缺快照 ⇒ `deny`；`relaxed` 缺快照 ⇒ `create-then-allow`（建失败由调用方转 deny）；
 * ④ 未声明工具（MCP / 插件）⇒ 按不可逆处理（fail-closed）。
 *
 * ⚠️ 本策略**尚未接线**到执行链（缺 default-off 开关，内核体量棘轮已顶格，见方案附录 D.6）；
 * 本文件保证的是"接线前的语义已被钉死"，接线时不再改判据。
 */
import { describe, expect, it } from 'bun:test';

import { TOOL_EFFECTS } from '../../src/tools/toolEffects';
import {
  decideCheckpointBoundary,
  deriveCheckpointBoundaryTools,
  isCheckpointBoundaryTool,
} from '../../src/tools/policy/checkpointBoundary';

describe('Checkpoint 边界 · 派生与判定', () => {
  it('边界清单派生自 TOOL_EFFECTS，且与 AC-11 不可逆集一致（54 条）', () => {
    const derived = deriveCheckpointBoundaryTools();
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.length).toBe(54);
    // 抽查三个代表：写盘（local）/ 命令执行（external）/ 只读（none，不应在列）
    expect(derived).toContain('file_write');
    expect(derived).toContain('bash');
    expect(derived).not.toContain('file_read');
    // 幂等（NONE）项一律不在列：派生口径 = 有副作用 ∧ 非幂等
    for (const name of derived) {
      const e = TOOL_EFFECTS[name as keyof typeof TOOL_EFFECTS];
      expect(e.sideEffect).not.toBe('none');
      expect(e.idempotent).toBe(false);
    }
  });

  it('只读与幂等工具不触发边界（true/false 双向）', () => {
    expect(isCheckpointBoundaryTool('file_read')).toBe(false);
    expect(isCheckpointBoundaryTool('grep')).toBe(false);
    expect(isCheckpointBoundaryTool('sleep')).toBe(false);
    expect(isCheckpointBoundaryTool('file_write')).toBe(true);
    expect(isCheckpointBoundaryTool('bash')).toBe(true);
    expect(isCheckpointBoundaryTool('send_message')).toBe(true);
  });

  it('未声明工具（MCP / 插件）⇒ 按不可逆处理（fail-closed）', () => {
    expect(isCheckpointBoundaryTool('acme__create_issue')).toBe(true);
    expect(
      decideCheckpointBoundary({
        toolName: 'acme__create_issue',
        hasCheckpoint: false,
        mode: 'strict',
      })
    ).toEqual({
      decision: 'deny',
      reason: expect.stringContaining('checkpoint'),
    });
  });

  it('strict：缺快照 ⇒ deny；已有快照 ⇒ allow', () => {
    expect(
      decideCheckpointBoundary({
        toolName: 'file_write',
        hasCheckpoint: false,
        mode: 'strict',
      }).decision
    ).toBe('deny');
    expect(
      decideCheckpointBoundary({
        toolName: 'file_write',
        hasCheckpoint: true,
        mode: 'strict',
      }).decision
    ).toBe('allow');
  });

  it('relaxed：缺快照 ⇒ create-then-allow（先补建再执行）', () => {
    expect(
      decideCheckpointBoundary({
        toolName: 'file_write',
        hasCheckpoint: false,
        mode: 'relaxed',
      })
    ).toEqual({ decision: 'create-then-allow' });
  });

  it('只读工具在任何模式下都 allow（不受边界约束）', () => {
    for (const mode of ['strict', 'relaxed'] as const) {
      expect(
        decideCheckpointBoundary({
          toolName: 'file_read',
          hasCheckpoint: false,
          mode,
        }).decision
      ).toBe('allow');
    }
  });

  it('门禁自证（负向夹具）：把不可逆工具误标为只读 ⇒ 派生清单必报差异', () => {
    const fixture = {
      file_read: { idempotent: true, sideEffect: 'none' as const },
      // 违规样本：远端写被标成幂等只读（真实缺陷形态：重复执行/无快照）
      pay_invoice: { idempotent: true, sideEffect: 'external' as const },
    };
    // 有副作用但被标 idempotent ⇒ 不进边界清单（这正是需要人工评审的"假幂等"）
    expect(deriveCheckpointBoundaryTools(fixture)).toEqual([]);
    // 反向：正确声明时应进清单
    expect(
      deriveCheckpointBoundaryTools({
        ...fixture,
        pay_invoice: { idempotent: false, sideEffect: 'external' },
      })
    ).toEqual(['pay_invoice']);
  });
});
