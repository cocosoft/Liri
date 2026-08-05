/**
 * AuthUserStore 单测（M0d admin 播种链路，§4.2d 验收②前置）
 *
 * 覆盖：LIRI_ADMIN_PASSWORD 首次播种 admin（无默认口令、fail-safe）、
 * 已有用户时不覆盖播种、角色持久化与密码校验。
 *
 * 注：曾因 @modules/core/paths 的 TDZ（循环 import）并入 AuthAdminCheck.test.ts；
 * 2026-08-05 已根治 TDZ（paths 直连 monitoring/logs/Logger，plugins 构造惰性化），
 * 恢复为独立文件。
 */

import { describe, expect, it, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthUserStore } from '../AuthUserStore';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

describe('AuthUserStore（admin 播种，M0d）', () => {
  it('LIRI_ADMIN_PASSWORD 设置且无用户时首次播种 admin', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    process.env.LIRI_ADMIN_PASSWORD = 'TestAdmin123!';
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const store = new AuthUserStore(join(tmpDir, 'users.json'));
      const admin = store.getUser('admin');
      expect(admin).toBeDefined();
      expect(admin!.role).toBe('admin');
      expect(store.verify('admin', 'TestAdmin123!')).toBe(true);
      expect(store.verify('admin', 'wrong')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.LIRI_ADMIN_PASSWORD;
      else process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('已有用户时不覆盖播种（无默认口令回退）', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    delete process.env.LIRI_ADMIN_PASSWORD; // 第一阶段不播种
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const filePath = join(tmpDir, 'users.json');
      const store = new AuthUserStore(filePath);
      store.addUser('alice', 'pass1'); // 已存在用户（落盘）
      // 模拟重启：设置 env 后重新实例化 → 已有用户 → 不播种
      process.env.LIRI_ADMIN_PASSWORD = 'ShouldNotSeed';
      const reloaded = new AuthUserStore(filePath);
      expect(reloaded.getUser('admin')).toBeUndefined();
      expect(reloaded.getUser('alice')).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.LIRI_ADMIN_PASSWORD;
      else process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('未设置 LIRI_ADMIN_PASSWORD 时不播种（无默认口令，fail-safe）', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    delete process.env.LIRI_ADMIN_PASSWORD;
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const store = new AuthUserStore(join(tmpDir, 'users.json'));
      expect(store.getUser('admin')).toBeUndefined();
      expect(store.size).toBe(0);
    } finally {
      if (prev !== undefined) process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('addUser 默认 user 角色，密码哈希落盘不存明文', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    tmpDirs.push(tmpDir);
    const filePath = join(tmpDir, 'users.json');
    const store = new AuthUserStore(filePath);
    store.addUser('carol', 'secret-pass');
    const carol = store.getUser('carol');
    expect(carol).toBeDefined();
    expect(carol!.role).toBe('user');
    expect(carol!.passwordHash).not.toContain('secret-pass');
  });
});
