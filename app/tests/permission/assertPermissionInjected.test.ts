// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D2（2026-10-11 用户裁定「启动 fail-fast 断言」）—— 权限管理器注入断言测试。
 *
 * 语义：生产/开发路径未注入权限管理器 ⇒ **fail-fast（抛错拒绝执行）**；
 * 测试环境（`NODE_ENV==='test'`）保留 fail-open（既有单测约定）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { assertPermissionManagerInjected } from '../../src/permission/assertPermissionInjected';
import { AppError } from '@openliri/kernel/errors.js';

const prevNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
});

describe('D2 权限管理器注入断言（fail-fast）', () => {
  it('已注入（非空）⇒ 任何环境都不抛', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertPermissionManagerInjected({ ok: true }, 'chat:toolExecution')
    ).not.toThrow();
  });

  it('未注入 + 测试环境 ⇒ 不抛（保留既有 fail-open 约定）', () => {
    process.env.NODE_ENV = 'test';
    expect(() =>
      assertPermissionManagerInjected(null, 'chat:toolExecution')
    ).not.toThrow();
  });

  it('未注入 + 非测试环境 ⇒ 抛 PERMISSION_MANAGER_NOT_INJECTED（fail-fast）', () => {
    process.env.NODE_ENV = 'production';
    let caught: unknown;
    try {
      assertPermissionManagerInjected(undefined, 'chat:toolExecution');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('PERMISSION_MANAGER_NOT_INJECTED');
    expect((caught as AppError).context?.context).toBe('chat:toolExecution');
  });
});
