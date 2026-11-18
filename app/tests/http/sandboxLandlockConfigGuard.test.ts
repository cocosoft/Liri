// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * S3（2026-11-17，设置方案 §11.2 / §11.5）：命令执行沙箱 landlock 配置的写入校验。
 *
 * 锁六件事：
 * 1. 只有四个字段可写（未知字段拒绝，防拼写错误静默落盘）；
 * 2. `bashExtraWritablePaths` **必须绝对路径**，根目录无条件拒绝（否则等于全盘可写）；
 * 3. 应用数据目录**本身与其祖先**无条件拒绝（放行祖先 = 放行 app home 整树）；
 * 4. 应用数据目录**子树**需显式 `forceWithReason`，且被回报为 `forcedPaths`（供审计）；
 * 5. 保存时即做规范化（`resolve` + 去重），UI 回显 = 生效值；
 * 6. 未提供的字段保持原值（补丁语义，不是整段覆盖）。
 */
import { describe, expect, it } from 'bun:test';
import { join, parse as parsePath, resolve, sep } from 'node:path';

import {
  applyLandlockConfigPatch,
  MAX_EXTRA_WRITABLE_PATHS,
  MAX_FORCE_REASON_LENGTH,
  type LandlockConfigView,
} from '../../src/infrastructure/http/handlers/sandbox-config-guard';

const APP_HOME = join(resolve(process.cwd()), 'data', 'app-home');
const EXTRA = join(resolve(process.cwd()), 'data', 'extra-writable');

const CURRENT: LandlockConfigView = {
  enabled: true,
  bashEnabled: false,
  failClosed: false,
  bashExtraWritablePaths: [EXTRA],
};

function run(patch: unknown, forceWithReason?: unknown) {
  return applyLandlockConfigPatch({
    current: CURRENT,
    patch,
    appHome: APP_HOME,
    forceWithReason,
  });
}

describe('S3：landlock 配置写入校验', () => {
  it('合法布尔补丁 ⇒ 合并并保留未提供的字段', () => {
    const result = run({ bashEnabled: true, failClosed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toEqual({
      enabled: true,
      bashEnabled: true,
      failClosed: true,
      bashExtraWritablePaths: [EXTRA],
    });
    expect(result.forcedPaths).toEqual([]);
  });

  it('非对象 / 数组 / null ⇒ 拒绝', () => {
    for (const patch of [null, 42, 'x', []]) {
      const result = run(patch);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.field).toBe('sandbox.landlock');
    }
  });

  it('未知字段 ⇒ 拒绝并指名字段（不静默落盘）', () => {
    const result = run({ bashEnabled: true, unknownField: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('sandbox.landlock.unknownField');
    expect(result.message).toContain('unknownField');
  });

  it('布尔字段类型错误 ⇒ 拒绝', () => {
    const result = run({ failClosed: 'true' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('sandbox.landlock.failClosed');
  });

  it('额外可写路径：非数组 / 相对路径 / 根目录 ⇒ 拒绝', () => {
    expect(run({ bashExtraWritablePaths: 'x' }).ok).toBe(false);
    const relative = run({ bashExtraWritablePaths: ['relative/dir'] });
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.message).toContain('绝对路径');

    const root = parsePath(resolve(process.cwd())).root;
    const rootResult = run({ bashExtraWritablePaths: [root] });
    expect(rootResult.ok).toBe(false);
    if (!rootResult.ok) expect(rootResult.message).toContain('根目录');
  });

  it('应用数据目录本身与其祖先 ⇒ 无条件拒绝', () => {
    const self = run({ bashExtraWritablePaths: [APP_HOME] });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.message).toContain('应用数据目录');

    const ancestor = run({
      bashExtraWritablePaths: [resolve(APP_HOME, '..', '..')],
    });
    expect(ancestor.ok).toBe(false);
    if (!ancestor.ok) expect(ancestor.message).toContain('祖先');
  });

  it('应用数据目录子树 ⇒ 无理由拒绝；带理由放行并回报 forcedPaths', () => {
    const inside = join(APP_HOME, 'cache', 'tmp');
    const denied = run({ bashExtraWritablePaths: [inside] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toContain('forceWithReason');

    const allowed = run(
      { bashExtraWritablePaths: [inside] },
      '需要让构建脚本写缓存'
    );
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.forcedPaths).toEqual([inside]);
    expect(allowed.next.bashExtraWritablePaths).toEqual([inside]);
  });

  it('规范化：尾分隔符与重复项收敛（保持声明顺序）', () => {
    const duplicated = EXTRA + sep;
    const result = run({
      bashExtraWritablePaths: [duplicated, EXTRA, join(EXTRA, 'sub')],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.bashExtraWritablePaths).toEqual([
      EXTRA,
      join(EXTRA, 'sub'),
    ]);
  });

  it('条数上限与理由长度上限 ⇒ 拒绝', () => {
    const tooMany = Array.from(
      { length: MAX_EXTRA_WRITABLE_PATHS + 1 },
      (_unused, index) => join(EXTRA, `dir-${index}`)
    );
    const overLimit = run({ bashExtraWritablePaths: tooMany });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok)
      expect(overLimit.field).toBe('sandbox.landlock.bashExtraWritablePaths');

    const longReason = 'x'.repeat(MAX_FORCE_REASON_LENGTH + 1);
    const longResult = run(
      { bashExtraWritablePaths: [join(APP_HOME, 'cache')] },
      longReason
    );
    expect(longResult.ok).toBe(false);
    if (!longResult.ok) expect(longResult.field).toBe('forceWithReason');
  });
});
