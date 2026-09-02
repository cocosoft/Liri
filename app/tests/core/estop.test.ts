// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * estop 全局急停测试（2026-09-02，P3-4 对标 Hermes estop）
 *
 * 验证：sentinel 生命周期（engage/disengage/isEngaged）、损坏文件 fail-safe、
 * getEstopState、checkEstop 每组件每次暂停只记一次日志的返回值语义。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
} from '../../src/core/paths';
import {
  engageEstop,
  disengageEstop,
  isEstopEngaged,
  getEstopState,
  checkEstop,
  estopSentinelPath,
} from '../../src/core/estop/estop';

describe('estop 全局急停', () => {
  let baseDir: string;
  const prevOverride = getUserDataDirOverride();

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'estop-test-'));
    setUserDataDirOverride(baseDir);
  });

  afterEach(() => {
    disengageEstop();
    setUserDataDirOverride(prevOverride);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('默认未启用', () => {
    expect(isEstopEngaged()).toBe(false);
    expect(getEstopState()).toBeNull();
  });

  it('engage 后启用，disengage 后解除', () => {
    engageEstop('维护中');
    expect(isEstopEngaged()).toBe(true);
    expect(estopSentinelPath()).toContain('ESTOP');
    const state = getEstopState();
    expect(state).not.toBeNull();
    expect(state!.reason).toBe('维护中');
    expect(state!.engagedAt).toBeDefined();

    expect(disengageEstop()).toBe(true);
    expect(isEstopEngaged()).toBe(false);
  });

  it('损坏 sentinel 文件仍视为已启用（fail-safe）', () => {
    mkdirSync(estopSentinelPath().replace(/ESTOP$/, ''), { recursive: true });
    writeFileSync(estopSentinelPath(), 'not-json{{', 'utf-8');
    expect(isEstopEngaged()).toBe(true);
    const state = getEstopState();
    expect(state).not.toBeNull();
    expect(state!.reason).toBeUndefined();
  });

  it('checkEstop：启用时返回 true，解除后返回 false', () => {
    expect(checkEstop('cron')).toBe(false);
    engageEstop();
    expect(checkEstop('cron')).toBe(true);
    disengageEstop();
    expect(checkEstop('cron')).toBe(false);
  });

  it('重复 engage 幂等（仅更新文件）', () => {
    engageEstop('第一次');
    engageEstop('第二次');
    expect(isEstopEngaged()).toBe(true);
    expect(getEstopState()!.reason).toBe('第二次');
  });
});
