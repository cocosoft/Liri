/**
 * 多租户 P5：删除租户时清除**自主运行配额**账本（`AlwaysOnQuota`）
 *
 * 缺陷：`AlwaysOnQuota.forgetOwnerPrefix()` 早就有了，但**零调用方** —— 删租户后
 * `runsToday` / `running` 仍挂在进程内账本上，同名新租户一上来就继承旧用量，
 * 甚至被"上一世"占满并发位而无法开始。
 *
 * 为什么需要模块级入口：账本挂在**管理器实例**上（`Cg3Bootstrap` / `alwaysOnEntry`
 * 各建一个），`runtime/tenantPurge` 拿不到实例 ⇒ 只能遍历进程内已创建的账本。
 *
 * 说明：账本集合是**进程级**的，其他用例文件可能也建过实例 ⇒ 本文件用**独有租户标识**
 * （`quota-ten-*` / `quota-purge`），只对本租户做绝对断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@modules/core/paths.js';
import {
  AlwaysOnQuota,
  forgetAlwaysOnQuotaForTenant,
} from '../../../src/tasks/alwayson/AlwaysOnQuota.js';
import { purgeTenant } from '../../../src/runtime/tenantPurge.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-quota-forget-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('forgetAlwaysOnQuotaForTenant', () => {
  it('只清目标租户的归属条目（前缀隔离 + 幂等），同前缀的其他用户一并清', () => {
    const quota = new AlwaysOnQuota({ maxConcurrentPerOwner: 1 });
    quota.tryAcquire('quota-ten-a:alice');
    quota.recordRun('quota-ten-a:alice');
    quota.tryAcquire('quota-ten-a:bob');
    quota.tryAcquire('quota-ten-b:alice');

    // a 的两个成员都被清；b 不受影响
    expect(forgetAlwaysOnQuotaForTenant('quota-ten-a')).toBe(2);
    expect(quota.usageOf('quota-ten-a:alice')).toEqual({
      runsToday: 0,
      running: 0,
    });
    expect(quota.usageOf('quota-ten-b:alice')).toEqual({
      runsToday: 0,
      running: 1,
    });
    // 幂等：`usageOf` 重建的空条目可再被清（1 条），不会把已清零的旧账重复计
    expect(forgetAlwaysOnQuotaForTenant('quota-ten-a')).toBe(1);
  });

  it('覆盖**全部**进程内账本（多实例场景：管理器各持一份）', () => {
    const first = new AlwaysOnQuota();
    const second = new AlwaysOnQuota();
    first.tryAcquire('quota-ten-multi:alice');
    second.tryAcquire('quota-ten-multi:alice');

    expect(forgetAlwaysOnQuotaForTenant('quota-ten-multi')).toBe(2);
    expect(first.usageOf('quota-ten-multi:alice').running).toBe(0);
    expect(second.usageOf('quota-ten-multi:alice').running).toBe(0);
  });
});

describe('purgeTenant：自主运行配额接线', () => {
  it('删租户后该租户的配额归零（含被占满的并发位），计数进 scopedCaches', async () => {
    const tenantId = 'quota-purge';
    const quota = new AlwaysOnQuota({ maxConcurrentPerOwner: 1 });
    expect(quota.tryAcquire(`${tenantId}:alice`)).toEqual({ allowed: true });
    quota.recordRun(`${tenantId}:alice`);
    // 并发位已被占满 ⇒ 同归属第二个运行被拒（旧账本的"实际危害"证据）
    expect(quota.tryAcquire(`${tenantId}:alice`)).toEqual({
      allowed: false,
      reason: 'concurrent_quota',
    });

    const report = await purgeTenant(tenantId);

    expect(report.removed.scopedCaches).toBe(1);
    expect(quota.usageOf(`${tenantId}:alice`)).toEqual({
      runsToday: 0,
      running: 0,
    });
    // 清空后同名新租户可以正常开始
    expect(quota.tryAcquire(`${tenantId}:alice`)).toEqual({ allowed: true });
  });
});
