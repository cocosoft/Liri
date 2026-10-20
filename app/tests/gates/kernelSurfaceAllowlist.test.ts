/**
 * C2 内核面 allowlist · **负向自证**（内核瘦身 P3）
 *
 * 复用纯逻辑（`app/scripts/kernelSurfaceCore.ts`），不扫真实文件系统（保测试快）。
 * 断言：
 *  ① 全部归类 ⇒ 通过；② **新增顶层条目未归类 ⇒ 必报**（棘轮）；
 *  ③ 域不在 6 个域内 ⇒ 必报；④ 归属理由/例外理由缺失 ⇒ 必报；
 *  ⑤ 同一条目既算域内又算例外 ⇒ 必报（归属必须唯一）；
 *  ⑥ 清单 kind 与实际结构不符 ⇒ 必报（说明被重构，需重新裁定）；
 *  ⑦ 清单条目已消失 ⇒ 只提示、不阻断（重构不该被门禁卡住）。
 */
import { describe, expect, it } from 'bun:test';

import {
  compareKernelSurface,
  KERNEL_DOMAINS,
  type KernelSurfaceActual,
  type KernelSurfaceAllowlist,
} from '../../scripts/kernelSurfaceCore.js';

function makeAllowlist(): KernelSurfaceAllowlist {
  return {
    version: 1,
    recordedAt: '2026-10-21',
    root: 'app/src/core',
    domains: Object.fromEntries(KERNEL_DOMAINS.map((d) => [d, `${d} 说明`])),
    entries: [
      {
        id: 'paths.ts',
        kind: 'file',
        domain: 'base-utils',
        note: '统一路径管理',
      },
      { id: 'events', kind: 'dir', domain: 'state-events', note: '事件总线' },
    ],
    exceptions: [
      { id: 'persona', kind: 'dir', reason: '人格服务，属产品能力' },
    ],
  };
}

const ACTUAL: KernelSurfaceActual[] = [
  { id: 'paths.ts', kind: 'file' },
  { id: 'events', kind: 'dir' },
  { id: 'persona', kind: 'dir' },
];

describe('内核面 allowlist · 负向自证', () => {
  it('全部已归类 ⇒ 无违规、无提示', () => {
    const result = compareKernelSurface(ACTUAL, makeAllowlist());
    expect(result.violations).toEqual([]);
    expect(result.hints).toEqual([]);
    expect(result.domainCounts['base-utils']).toBe(1);
    expect(result.domainCounts['state-events']).toBe(1);
  });

  it('**新增顶层条目未归类** ⇒ 必报', () => {
    const result = compareKernelSurface(
      [...ACTUAL, { id: 'newsubsystem', kind: 'dir' }],
      makeAllowlist()
    );
    expect(
      result.violations.some(
        (v) => v.includes('newsubsystem/') && v.includes('未归类')
      )
    ).toBe(true);
  });

  it('域不在 6 个域内 ⇒ 必报', () => {
    const allowlist = makeAllowlist();
    allowlist.entries[0]!.domain = 'misc' as never;
    const result = compareKernelSurface(ACTUAL, allowlist);
    expect(
      result.violations.some(
        (v) => v.includes('misc') && v.includes('不在 6 个域内')
      )
    ).toBe(true);
  });

  it('归属理由 / 例外理由缺失 ⇒ 必报', () => {
    const allowlist = makeAllowlist();
    allowlist.entries[0]!.note = '  ';
    allowlist.exceptions[0]!.reason = '';
    const result = compareKernelSurface(ACTUAL, allowlist);
    expect(
      result.violations.some(
        (v) => v.includes('paths.ts') && v.includes('缺少归属理由')
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.includes('persona') && v.includes('缺少理由')
      )
    ).toBe(true);
  });

  it('同一条目既在 entries 又在 exceptions ⇒ 必报（归属必须唯一）', () => {
    const allowlist = makeAllowlist();
    allowlist.exceptions.push({
      id: 'events',
      kind: 'dir',
      reason: '重复登记',
    });
    const result = compareKernelSurface(ACTUAL, allowlist);
    expect(
      result.violations.some(
        (v) => v.includes('events') && v.includes('二选一')
      )
    ).toBe(true);
  });

  it('清单 kind 与实际不符 ⇒ 必报（结构变了，需重新裁定）', () => {
    const result = compareKernelSurface(
      [
        { id: 'paths.ts', kind: 'dir' },
        ...ACTUAL.filter((a) => a.id !== 'paths.ts'),
      ],
      makeAllowlist()
    );
    expect(
      result.violations.some(
        (v) => v.includes('paths.ts') && v.includes('结构已变')
      )
    ).toBe(true);
  });

  it('清单条目已消失 ⇒ 只提示、不阻断', () => {
    const result = compareKernelSurface(
      [{ id: 'paths.ts', kind: 'file' }],
      makeAllowlist()
    );
    expect(result.violations.some((v) => v.includes('paths.ts'))).toBe(false);
    expect(
      result.hints.some((h) => h.includes('events') && h.includes('已不存在'))
    ).toBe(true);
  });
});
