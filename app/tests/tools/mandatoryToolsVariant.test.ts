/**
 * 变体收敛（2026-10-20）：恒保留集（mandatory）必须随**能力开关**收敛。
 *
 * 背景（变体矩阵方案 §3.1）：`core` 变体的 `excludeFeatures` 已排除 `AGENT`，
 * 但旧恒集写死 `{ todo_write, agent }` ⇒ "变体裁掉了 agent，mandatory 又把它强制可见"
 * 的自相矛盾；P1 计划移除 `todo_write` 时会再撞一次。
 *
 * 本测试锁住三件事：
 *   ① 默认变体（AGENT + TODO 皆开）⇒ 与旧行为**逐字一致**（零行为变更）；
 *   ② 能力关闭 ⇒ 对应工具**退出恒集**（不再强制可见）；
 *   ③ 不变量：生效恒集里的每个工具，其能力前置必须已开启（正向子集断言）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  MANDATORY_TOOL_REQUIRES,
  MANDATORY_TOOLS,
  filterToolsByTask,
  getMandatoryTools,
  isMandatoryTool,
} from '../../src/tools/toolCategories';
import { feature } from '@openliri/kernel/featureFlags';

const ENV_KEYS = ['FEATURE_AGENT', 'FEATURE_TODO'] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('mandatory 恒集随变体能力收敛', () => {
  it('名义集与能力映射同源（单一事实源）', () => {
    expect([...MANDATORY_TOOLS].sort()).toEqual(
      Object.keys(MANDATORY_TOOL_REQUIRES).sort()
    );
  });

  it('AGENT + TODO 皆开 ⇒ { todo_write, agent }（与旧行为一致）', () => {
    delete process.env.FEATURE_AGENT;
    delete process.env.FEATURE_TODO;
    expect([...getMandatoryTools()].sort()).toEqual(['agent', 'todo_write']);
  });

  it('core 变体（AGENT 关）⇒ 只剩 todo_write，agent 不再恒保留', () => {
    process.env.FEATURE_AGENT = 'false';
    delete process.env.FEATURE_TODO;

    expect([...getMandatoryTools()]).toEqual(['todo_write']);
    expect(isMandatoryTool('agent')).toBe(false);

    const kept = filterToolsByTask(
      [{ name: 'agent' }, { name: 'todo_write' }, { name: 'bash' }],
      'chat'
    ).map((t) => t.name);
    expect(kept).toContain('todo_write');
    expect(kept).not.toContain('agent');
  });

  it('core 再移除 TODO ⇒ 恒集为空（不会凭空保留任何工具）', () => {
    process.env.FEATURE_AGENT = 'false';
    process.env.FEATURE_TODO = 'false';

    expect(getMandatoryTools().size).toBe(0);
    expect(isMandatoryTool('todo_write')).toBe(false);
  });

  it('不变量：生效恒集里每个工具的能力前置必须已开启', () => {
    for (const [name, flag] of Object.entries(MANDATORY_TOOL_REQUIRES)) {
      if (getMandatoryTools().has(name)) {
        expect(feature(flag)).toBe(true);
      }
    }
  });
});
