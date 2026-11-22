// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F12（2026-11-22）：bypass 档接入 killswitch。
 *
 * 背景（二次复查）：`handleBypassPermissions` 无条件放行，全仓无 killswitch 调用点。
 * 现口径：运行时 `disable()` 或 `PERMISSION_BYPASS_DISABLED=true` ⇒ deny。
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { PermissionDecisionType } from '@openliri/infra/permission/types/PermissionDecision';
import { bypassPermissionsKillswitch } from '@openliri/infra/permission/utils/BypassPermissionsKillswitch';
import { handleBypassPermissions } from '../../../packages/infra/src/permission/manager/modeHandlers';

afterEach(() => {
  bypassPermissionsKillswitch.reenable();
  delete process.env['PERMISSION_BYPASS_DISABLED'];
});

describe('F12：bypass killswitch', () => {
  it('未禁用 ⇒ 保持原行为（放行）', () => {
    expect(handleBypassPermissions().type).toBe(PermissionDecisionType.ALLOW);
  });

  it('运行时 disable ⇒ deny', () => {
    bypassPermissionsKillswitch.disable('test');
    expect(handleBypassPermissions().type).toBe(PermissionDecisionType.DENY);
  });

  it('PERMISSION_BYPASS_DISABLED=true ⇒ deny', () => {
    process.env['PERMISSION_BYPASS_DISABLED'] = 'true';
    expect(handleBypassPermissions().type).toBe(PermissionDecisionType.DENY);
  });
});
