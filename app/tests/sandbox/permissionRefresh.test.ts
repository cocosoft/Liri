/**
 * P1-2（2026-10-27）：运行期改沙箱级别即时生效（不再"改完要重启"）。
 *
 * 修复前：工作区权限位是**创建时快照**（`WorkspaceBase.hasPermission` 读
 * `config.allowedPermissions`）⇒ `PUT /v1/sandbox/config` 只改配置，已存在的默认工作区
 * 仍按旧权限判定。
 *
 * 修复后：`permissionLevel` 的映射收敛到 `permissionsForPermissionLevel()`（单一事实源），
 * handler 保存后经 SPI `refreshDefaultWorkspacePermissions()` 刷新默认工作区权限位。
 */
import { describe, expect, it } from 'bun:test';
import { SandboxPermission } from '@openliri/kernel/sandboxPermission.js';
import { resolveSandbox } from '@openliri/kernel/spi';
import { permissionsForPermissionLevel } from '../../src/sandbox/permissionLevel';
import {
  SandboxPlatform,
  createDefaultSandboxConfig,
} from '../../src/sandbox/SandboxTypes';
import { LocalWorkspace } from '../../src/sandbox/adapters/LocalWorkspace';
import { refreshScopedDefaultWorkspacePermissions } from '../../src/sandbox/scopedDefaultWorkspace';

describe('P1-2 级别 → 权限位映射（单一事实源）', () => {
  it('readonly / standard / full 三档', () => {
    expect(permissionsForPermissionLevel('readonly')).toEqual([
      SandboxPermission.READ_FILE,
    ]);
    expect(permissionsForPermissionLevel('standard')).toEqual([
      SandboxPermission.READ_FILE,
      SandboxPermission.WRITE_FILE,
    ]);
    expect(permissionsForPermissionLevel('full')).toEqual([
      SandboxPermission.READ_FILE,
      SandboxPermission.WRITE_FILE,
      SandboxPermission.EXECUTE,
    ]);
  });

  it('负向对照：standard 不含 EXECUTE（Q-30 收窄口径）', () => {
    expect(permissionsForPermissionLevel('standard')).not.toContain(
      SandboxPermission.EXECUTE
    );
  });
});

describe('P1-2 已有工作区权限位可运行时刷新', () => {
  function makeWorkspace(): LocalWorkspace {
    return new LocalWorkspace(
      createDefaultSandboxConfig(SandboxPlatform.WINDOWS, {
        allowedPermissions: permissionsForPermissionLevel('standard'),
      })
    );
  }

  it('standard ⇒ 可写；刷新为 readonly ⇒ 立即不可写（不需重建工作区）', () => {
    const workspace = makeWorkspace();
    expect(workspace.hasPermission(SandboxPermission.WRITE_FILE)).toBe(true);

    workspace.updateAllowedPermissions(
      permissionsForPermissionLevel('readonly')
    );
    expect(workspace.hasPermission(SandboxPermission.READ_FILE)).toBe(true);
    expect(workspace.hasPermission(SandboxPermission.WRITE_FILE)).toBe(false);
  });

  it('刷新为 full ⇒ 获得 EXECUTE（再回到 standard 即失去）', () => {
    const workspace = makeWorkspace();
    workspace.updateAllowedPermissions(permissionsForPermissionLevel('full'));
    expect(workspace.hasPermission(SandboxPermission.EXECUTE)).toBe(true);

    workspace.updateAllowedPermissions(
      permissionsForPermissionLevel('standard')
    );
    expect(workspace.hasPermission(SandboxPermission.EXECUTE)).toBe(false);
  });
});

describe('P1-2 刷新入口的边界', () => {
  it('无默认工作区 ⇒ 返回 false（不建、不抛）', () => {
    // 本用例不建 `default` 工作区（本地身份缺失时不会惰性创建）
    expect(refreshScopedDefaultWorkspacePermissions()).toBe(false);
  });

  it('SPI 未注册 ⇒ 代理返回 false（空值语义）', () => {
    expect(resolveSandbox().refreshDefaultWorkspacePermissions()).toBe(false);
  });
});
