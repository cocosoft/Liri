// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-1（2026-11-04）：`PERMISSION_MODE` 环境变量接线回归。
 *
 * 背景：方案 §1.1 实测该变量**全仓无读取点** —— 用户写进 `.env` 也不生效
 * （与 `JWT_SECRET` / `CORS_ORIGIN` 同类"配置幻觉"）。现在它成为
 * `PermissionManager` 的**进程默认档**，会话级 `setMode()` 仍可覆盖。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createPermissionManager } from '@openliri/infra/permission/PermissionManager';
import type { PermissionMode } from '@openliri/infra/permission/PermissionMode';

const original = process.env['PERMISSION_MODE'];

function modeOf(value: string | undefined): PermissionMode {
  if (value === undefined) delete process.env['PERMISSION_MODE'];
  else process.env['PERMISSION_MODE'] = value;
  return createPermissionManager().getMode();
}

describe('P1-1：PERMISSION_MODE 接线', () => {
  beforeEach(() => {
    delete process.env['PERMISSION_MODE'];
  });

  afterEach(() => {
    if (original === undefined) delete process.env['PERMISSION_MODE'];
    else process.env['PERMISSION_MODE'] = original;
  });

  it('未设置 ⇒ default（与改造前逐字一致）', () => {
    expect(modeOf(undefined)).toBe('default');
  });

  it('合法值直接生效', () => {
    expect(modeOf('bypass')).toBe('bypass');
    expect(modeOf('plan')).toBe('plan');
  });

  it('大小写不敏感（.env 里的 DEFAULT / 驼峰值都能认）', () => {
    expect(modeOf('DEFAULT')).toBe('default');
    expect(modeOf('PLAN')).toBe('plan');
    expect(modeOf('Plan')).toBe('plan');
  });

  it('收缩前的旧值读取时归一（升级不改变既有 .env 行为）', () => {
    // ask / alwaysAsk ⇒ plan（每步确认）
    expect(modeOf('ask')).toBe('plan');
    expect(modeOf('alwaysAsk')).toBe('plan');
    // acceptEdits / strict ⇒ default（无独立分支）
    expect(modeOf('acceptEdits')).toBe('default');
    expect(modeOf('ACCEPTEDITS')).toBe('default');
    expect(modeOf('strict')).toBe('default');
  });

  it('非法值 ⇒ 回退 default（不阻断构造）', () => {
    expect(modeOf('nonsense-mode')).toBe('default');
    expect(modeOf('   ')).toBe('default');
  });
});
