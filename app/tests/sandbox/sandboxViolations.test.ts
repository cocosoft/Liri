/**
 * G4 围栏 M0-①（2026-11-12）：沙箱违规记账。
 *
 * 背景：`SandboxManager.recordViolation()` 此前**全仓零调用** ⇒ `violationCount` 恒 0，
 * 围栏（`sandbox-posture.json`）的"违规上升"规则永不触发。本用例钉住两条契约：
 * ① 统一写入口 `recordSandboxViolation()` 真的落到管理器（类型/说明/详情/时间戳）；
 * ② 保留上限生效（超限丢最旧），内存不无界增长。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  MAX_RECORDED_SANDBOX_VIOLATIONS,
  recordSandboxViolation,
} from '@modules/sandbox';
import { SandboxManager } from '@modules/sandbox/SandboxManager';

describe('M0-①：沙箱违规记账', () => {
  const manager = SandboxManager.getInstance();

  beforeEach(() => {
    manager.clearViolations();
  });

  afterEach(() => {
    // 单例在测试进程内共享：清空避免污染其它用例（快照用例会读这份记录）
    manager.clearViolations();
  });

  it('统一写入口落到管理器（不再是无写入点的空面）', () => {
    recordSandboxViolation('write-denied', '写入越界', { tool: 'bash' });

    const records = manager.getViolations();
    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe('write-denied');
    expect(records[0]?.message).toBe('写入越界');
    expect(records[0]?.details).toEqual({ tool: 'bash' });
    expect(records[0]?.timestamp).toBeInstanceOf(Date);
  });

  it(`超过保留上限（${MAX_RECORDED_SANDBOX_VIOLATIONS}）⇒ 丢最旧，保留最新`, () => {
    const overflow = 5;
    for (let i = 0; i < MAX_RECORDED_SANDBOX_VIOLATIONS + overflow; i++) {
      recordSandboxViolation('write-denied', `v${i}`);
    }

    const records = manager.getViolations();
    expect(records).toHaveLength(MAX_RECORDED_SANDBOX_VIOLATIONS);
    // 最旧的 overflow 条被裁掉
    expect(records[0]?.message).toBe(`v${overflow}`);
    expect(records.at(-1)?.message).toBe(
      `v${MAX_RECORDED_SANDBOX_VIOLATIONS + overflow - 1}`
    );
  });
});
