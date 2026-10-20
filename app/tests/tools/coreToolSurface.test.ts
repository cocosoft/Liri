/**
 * core 变体工具面（P1，2026-10-20）
 *
 * 目标：`CORE_MINIMAL` 开启时，**装配点**把工具面收敛为 7 项下限
 * （bash / file_read / file_write / file_edit / grep / glob / ask_user_question）。
 *
 * 三条锁：
 *   ① 默认（非 core）**零行为变更** —— 工具面不收敛；
 *   ② `CORE_MINIMAL=true` ⇒ 恰好 7 个工具（不多不少）；
 *   ③ **全量视图**（`getAllBuiltinToolLoaders`，供 `gen-tool-names` 与门禁）不受开关影响
 *      —— 否则生成物会随变体漂移。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ToolFactory } from '../../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  getBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';

/** core 的 7 项下限（唯一口径见 ToolManagerUtils 的 CORE_MINIMAL_TOOL_KEYS） */
const CORE_TOOL_NAMES = [
  'ask_user_question',
  'bash',
  'file_edit',
  'file_read',
  'file_write',
  'glob',
  'grep',
].sort();

const ENV_KEYS = ['FEATURE_CORE_MINIMAL'] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  delete process.env.FEATURE_CORE_MINIMAL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function loadedNames(): string[] {
  return loadTools(new ToolFactory(), getBuiltinToolLoaders())
    .map((tool) => tool.name)
    .sort();
}

describe('core 变体工具面（CORE_MINIMAL）', () => {
  it('默认（非 core）：不收敛，web_fetch / todo_write 等仍在', () => {
    const names = loadedNames();
    expect(names).toContain('web_fetch');
    expect(names).toContain('todo_write');
    expect(names.length).toBeGreaterThan(CORE_TOOL_NAMES.length);
  });

  it('CORE_MINIMAL 开 ⇒ 恰好 7 个工具', () => {
    process.env.FEATURE_CORE_MINIMAL = 'true';
    expect(loadedNames()).toEqual(CORE_TOOL_NAMES);
  });

  it('全量视图不受 CORE_MINIMAL 影响（生成物与变体无关）', () => {
    process.env.FEATURE_CORE_MINIMAL = 'true';
    expect(getBuiltinToolLoaders()).toHaveLength(CORE_TOOL_NAMES.length);
    expect(getAllBuiltinToolLoaders().length).toBeGreaterThan(
      CORE_TOOL_NAMES.length
    );
  });
});
