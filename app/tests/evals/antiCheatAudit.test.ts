/**
 * 反作弊面自检单测（P1-1 形态 B，2026-09-28）
 *
 * 锁定 4 件事：
 *  ① **三态语义**：`blocked` / `exposed`（必挡未挡 ⇒ 可 fail-closed）/ `knownGap`（已登记缺口，
 *     **不**参与 fail-closed —— 否则 D-5 会让所有题立即全废）；
 *  ② C-1 / C-2 是**真检查**（报告目录在不在屏蔽清单内、声明是否等于生效）；
 *  ③ C-3 / C-4 / C-5 **恒为 knownGap**（含"即使开关打开"的分支）⇒ 不许被静默升格为 blocked；
 *  ④ **路径归一**：Windows `\` 与 `/` 判定一致（此坑 P0-3-b 实测踩过：不归一会**空集假绿**）。
 */
import { describe, expect, it } from 'bun:test';
import {
  auditAntiCheatSurface,
  type AntiCheatContext,
} from '../../src/evals/antiCheatAudit';

const TMP = 'C:\\Temp';

/** 基线：一切正常（沙箱根不在临时根下、bash 有内核约束） */
function baseCtx(over: Partial<AntiCheatContext> = {}): AntiCheatContext {
  return {
    declaredShields: ['C:\\repo\\src\\answer.ts', 'C:\\repo\\dev_docs\\evals'],
    appliedShields: ['C:\\repo\\src\\answer.ts', 'C:\\repo\\dev_docs\\evals'],
    reportDir: 'C:\\repo\\dev_docs\\evals',
    sandboxRoot: 'C:\\sandboxes\\liri-eval-1',
    platform: 'win32',
    bashLandlockEnabled: true,
    tmpRoot: TMP,
    ...over,
  };
}

describe('反作弊面自检（P1-1 形态 B）', () => {
  it('基线（报告已屏蔽 + 声明=生效 + 沙箱根不在临时区 + bash 有约束）⇒ 无 exposed', () => {
    const r = auditAntiCheatSurface(baseCtx());
    expect(r.exposed).toEqual([]);
    // 5 条向量恒被覆盖（不因"全通过"而少报）
    expect(r.findings.map((f) => f.id)).toEqual([
      'C-1',
      'C-2',
      'C-3',
      'C-4',
      'C-5',
    ]);
    // 仅 C-5（pathShield 能力边界）是恒定的 knownGap
    expect(r.knownGaps.map((f) => f.id)).toEqual(['C-5']);
  });

  it('C-1：报告目录**不在**屏蔽清单内 ⇒ exposed（防 k>1 经报告读到期望值）', () => {
    const r = auditAntiCheatSurface(
      baseCtx({ declaredShields: ['C:\\repo\\src\\answer.ts'] })
    );
    expect(r.exposed.map((f) => f.id)).toEqual(['C-1']);
    expect(r.exposed[0].detail).toContain('dev_docs\\evals');
  });

  it('C-1：报告目录写法差异（尾分隔符 / 正反斜杠）**不算**不在清单', () => {
    const r = auditAntiCheatSurface(
      baseCtx({ declaredShields: ['C:/repo/dev_docs/evals/'] })
    );
    expect(r.exposed).toEqual([]);
  });

  it('C-2：声明的屏蔽**未**被沙箱接受 ⇒ exposed，且 detail 带出缺失项', () => {
    const r = auditAntiCheatSurface(
      baseCtx({ appliedShields: ['C:\\repo\\dev_docs\\evals'] })
    );
    expect(r.exposed.map((f) => f.id)).toEqual(['C-2']);
    expect(r.exposed[0].detail).toContain('answer.ts');
  });

  it('C-3：沙箱根落在临时根下 ⇒ **knownGap**（不参与 fail-closed）', () => {
    const r = auditAntiCheatSurface(
      baseCtx({ sandboxRoot: 'C:\\Temp\\liri-eval-abc' })
    );
    const c3 = r.findings.find((f) => f.id === 'C-3')!;
    expect(c3.verdict).toBe('knownGap');
    expect(c3.detail).toContain('D-5');
    // 关键：不因 knownGap 而作废运行
    expect(r.exposed).toEqual([]);
  });

  it('C-3：bash 未开 Landlock 时，同一条向量也要说清"约束更弱"', () => {
    const r = auditAntiCheatSurface(
      baseCtx({
        sandboxRoot: 'C:\\Temp\\liri-eval-abc',
        bashLandlockEnabled: false,
      })
    );
    const c3 = r.findings.find((f) => f.id === 'C-3')!;
    expect(c3.detail).toContain('plain');
  });

  it('C-4：bash 无内核级约束 ⇒ knownGap；开启 ⇒ blocked（同一条向量，两态）', () => {
    const off = auditAntiCheatSurface(baseCtx({ bashLandlockEnabled: false }));
    expect(off.findings.find((f) => f.id === 'C-4')!.verdict).toBe('knownGap');
    const on = auditAntiCheatSurface(baseCtx({ bashLandlockEnabled: true }));
    expect(on.findings.find((f) => f.id === 'C-4')!.verdict).toBe('blocked');
  });

  it('三态互斥：exposed 与 knownGaps 不重叠，且覆盖全部 5 条向量', () => {
    const r = auditAntiCheatSurface(
      baseCtx({
        declaredShields: [],
        appliedShields: [],
        sandboxRoot: 'C:\\Temp\\liri-eval-abc',
        bashLandlockEnabled: false,
      })
    );
    const ids = new Set(r.findings.map((f) => f.id));
    expect(r.exposed.length + r.knownGaps.length + 1).toBe(5); // 余下 1 条为 blocked
    for (const f of r.exposed) expect(ids.has(f.id)).toBe(true);
    // 无重叠
    const exposedIds = new Set(r.exposed.map((f) => f.id));
    for (const f of r.knownGaps) expect(exposedIds.has(f.id)).toBe(false);
  });
});
