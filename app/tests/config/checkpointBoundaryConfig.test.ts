/**
 * Checkpoint 边界配置解析（P5-4，2026-10-28）
 *
 * 规格 `.trae/specs/p5-runtime-hardening-specs.md` §3.3：默认**关闭** + `relaxed`；
 * 任何读不懂的值都必须 fail-closed 到"关闭"（不得因配置损坏而改变执行行为）。
 */
import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_CHECKPOINT_BOUNDARY_CONFIG,
  parseCheckpointBoundaryConfig,
} from '../../src/config/settings/CheckpointBoundaryConfig';

describe('checkpointBoundary 配置解析', () => {
  it('缺省 / 非对象 / null ⇒ 默认关闭 + relaxed', () => {
    for (const raw of [undefined, null, 'yes', 42, []]) {
      expect(parseCheckpointBoundaryConfig(raw)).toEqual(
        DEFAULT_CHECKPOINT_BOUNDARY_CONFIG
      );
    }
    expect(DEFAULT_CHECKPOINT_BOUNDARY_CONFIG).toEqual({
      enabled: false,
      mode: 'relaxed',
    });
  });

  it('`enabled` 只认严格 `true`（字符串/1 等真值一律不启用）', () => {
    expect(parseCheckpointBoundaryConfig({ enabled: 'true' }).enabled).toBe(
      false
    );
    expect(parseCheckpointBoundaryConfig({ enabled: 1 }).enabled).toBe(false);
    expect(parseCheckpointBoundaryConfig({ enabled: true }).enabled).toBe(true);
  });

  it('`mode` 只认 `strict`；其余值回落 `relaxed`（不会误升级为拒绝）', () => {
    expect(parseCheckpointBoundaryConfig({ mode: 'strict' }).mode).toBe(
      'strict'
    );
    expect(parseCheckpointBoundaryConfig({ mode: 'relaxed' }).mode).toBe(
      'relaxed'
    );
    expect(parseCheckpointBoundaryConfig({ mode: 'STRICT' }).mode).toBe(
      'relaxed'
    );
    expect(parseCheckpointBoundaryConfig({ mode: 1 }).mode).toBe('relaxed');
  });

  it('未知字段被忽略（向前兼容）', () => {
    expect(
      parseCheckpointBoundaryConfig({ enabled: true, future: 'x' })
    ).toEqual({ enabled: true, mode: 'relaxed' });
  });
});
