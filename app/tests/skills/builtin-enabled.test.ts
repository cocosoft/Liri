/**
 * BuiltinEnabledStore 单元测试（3.5.7 内置技能禁用持久化）
 * 覆盖：persist/load round-trip、空文件、损坏文件降级。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadBuiltinEnabled,
  persistBuiltinEnabled,
} from '../../src/skills/BuiltinEnabledStore';

describe('BuiltinEnabledStore（3.5.7）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'builtin-enabled-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trip：persist 后 load 返回相同状态', () => {
    const state = new Map<string, boolean>([
      ['builtin-a', false],
      ['builtin-b', true],
    ]);
    persistBuiltinEnabled(state, dir);

    const loaded = loadBuiltinEnabled(dir);
    expect(loaded.size).toBe(2);
    expect(loaded.get('builtin-a')).toBe(false);
    expect(loaded.get('builtin-b')).toBe(true);
  });

  it('文件不存在时返回空 Map（按默认全部启用）', () => {
    expect(loadBuiltinEnabled(dir).size).toBe(0);
  });

  it('损坏文件返回空 Map（降级为默认启用）', () => {
    writeFileSync(join(dir, 'builtin-enabled.json'), 'not-json{', 'utf-8');
    expect(loadBuiltinEnabled(dir).size).toBe(0);
  });
});
