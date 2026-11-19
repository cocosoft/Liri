// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * UW-6 观察期（2026-11-19 裁定 ①）：`PermissionPolicyManager` 标 `@deprecated` 后，
 * 一旦被调用必须发**一次** `DeprecationWarning`（每进程一次，避免刷屏）。
 *
 * 为什么单独锁：本类生产侧零调用 ⇒ 若将来有人接线（或误用），告警是唯一的发现信号；
 * 而"每进程只发一次"的标记是模块级状态，必须显式验证否则会在测试间互相干扰。
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  PermissionPolicyManager,
  resetPermissionPolicyDeprecationWarnForTest,
} from '@openliri/infra/permission/PermissionPolicies';

type EmitWarningSpy = ReturnType<typeof spyOn>;

let spy: EmitWarningSpy;

beforeEach(() => {
  resetPermissionPolicyDeprecationWarnForTest();
  spy = spyOn(process, 'emitWarning');
});

afterEach(() => {
  spy.mockRestore();
  resetPermissionPolicyDeprecationWarnForTest();
});

describe('PermissionPolicyManager 观察期废弃告警', () => {
  it('调用 checkCommandPermission ⇒ 发一次 DeprecationWarning（带稳定 code）', () => {
    PermissionPolicyManager.checkCommandPermission('bash', 'ls');

    expect(spy).toHaveBeenCalledTimes(1);
    const [, options] = spy.mock.calls[0] as [string, { code?: string }];
    expect(options?.code).toBe('LIRI_DEPRECATED_PERMISSION_POLICY_MANAGER');
  });

  it('同类其它 check* 再调用 ⇒ 不再重复告警（每进程一次）', () => {
    PermissionPolicyManager.checkCommandPermission('bash', 'ls');
    PermissionPolicyManager.checkFilePermission('read', 'a.txt', process.cwd());
    PermissionPolicyManager.checkNetworkPermission('https://example.com');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('未被调用 ⇒ 不发任何告警（零调用时不制造噪音）', () => {
    expect(spy).not.toHaveBeenCalled();
  });
});
