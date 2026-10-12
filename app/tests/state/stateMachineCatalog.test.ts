/**
 * 状态机定义目录（状态机规范管理方案 阶段 1 / 1.3，2026-10-12）。
 *
 * 四重断言：
 * ① **目录 ↔ 运行时锚点一致**（`verification: 'runtime-import'` 的条目逐一动态载入比对 —— **防目录漂移**）；
 * ② `verification` 与 `verifyRef` **自洽**（标了 `runtime-import` 必须有锚点 —— 不谎称有机器校验）；
 * ③ id 唯一（`STATE_MACHINES` ∪ `BOUNDARY_STATE_MACHINES`）、`sourceFile` 真实存在（不登记幽灵文件）；
 * ④ 同名不同物**显式登记**且带理由（不假装"全仓只有一个 TaskStatus"）。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  STATE_MACHINES,
  BOUNDARY_STATE_MACHINES,
  findStateMachine,
  listStateMachineIds,
  type StateMachineVerifyRef,
} from '../../src/state/engine/stateMachineCatalog.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** 动态载入源码中的运行时锚点（数组原样 / enum 取 values / 转移表取 keys） */
async function loadAnchor(ref: StateMachineVerifyRef): Promise<string[]> {
  const mod = (await import(
    pathToFileURL(join(REPO_ROOT, ref.module)).href
  )) as Record<string, unknown>;
  const value = mod[ref.exportName];
  if (value === undefined) {
    throw new Error(`锚点导出不存在: ${ref.module}#${ref.exportName}`);
  }
  if (ref.anchor === 'array') return [...(value as readonly string[])];
  // 阶段 3（2026-10-12）：3 态会话状态机为**类型联合**（无 enum）⇒ 锚点取转移规则表的键
  if (ref.anchor === 'objectKeys') {
    return Object.keys(value as Record<string, unknown>);
  }
  return Object.values(value as Record<string, string>);
}

describe('状态机定义目录（阶段 1 / 1.3）', () => {
  it('目录 ↔ 运行时锚点逐一比对（防目录漂移）', async () => {
    const checked = STATE_MACHINES.filter((m) => m.verifyRef);
    // 至少覆盖 Execution / ToolCall / AppState / SessionState / Task（5 项）
    expect(checked.length).toBeGreaterThanOrEqual(5);

    for (const m of checked) {
      const actual = await loadAnchor(m.verifyRef as StateMachineVerifyRef);
      expect({ id: m.id, states: [...m.states] }).toEqual({
        id: m.id,
        states: actual,
      });
    }
  });

  it('verification 与 verifyRef 自洽（不谎称有机器校验）', () => {
    for (const m of STATE_MACHINES) {
      if (m.verification === 'runtime-import') {
        expect(m.verifyRef).toBeDefined();
      } else {
        expect(m.verifyRef).toBeUndefined();
      }
    }
  });

  it('id 唯一（已登记 ∪ 同名不同物，无重复）', () => {
    const ids = [
      ...listStateMachineIds(),
      ...BOUNDARY_STATE_MACHINES.map((b) => b.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sourceFile 真实存在（不登记幽灵文件，CS06）', () => {
    for (const m of [...STATE_MACHINES, ...BOUNDARY_STATE_MACHINES]) {
      expect(existsSync(join(REPO_ROOT, m.sourceFile))).toBe(true);
    }
  });

  it('同名不同物显式登记且带理由（不假装全仓唯一）', () => {
    expect(BOUNDARY_STATE_MACHINES.length).toBeGreaterThanOrEqual(4);
    for (const b of BOUNDARY_STATE_MACHINES) {
      expect(b.reason.length).toBeGreaterThan(0);
    }
    // 关键边界：TaskStatus 的两套必须都被识别
    expect(BOUNDARY_STATE_MACHINES.some((b) => b.id === 'uiTaskStatus')).toBe(
      true
    );
    expect(findStateMachine('task')?.sourceFile).toBe(
      'app/src/core/taskStatus.ts'
    );
  });

  it('未登记 id ⇒ undefined（不臆造条目）', () => {
    expect(findStateMachine('not-exist')).toBeUndefined();
  });
});
